import type { ArchiveCategory, OnlineSearchResult } from '../types/archive';
import type { CoverCandidate } from '../utils/coverPicker';
import { parseDoubanUrlOrId } from '../utils/doubanParsers';
import {
  buildImdbCoverCandidates,
  extractImdbIdFromUrl,
  hasCjkCharacters,
  mergeImdbWithDoubanAssist,
  normalizeImdbImageUrl,
  parseCinemetaMeta,
  parseCinemetaSearchPayload,
  parseImdbSuggestPayload,
  parseImdbUrlOrId,
  rankImdbResults,
  type ImdbEnrichedTitle,
} from '../utils/imdbParsers';
import { normalizeEntityKey } from '../utils/wikiCast';
import {
  hasStrictTitleOverlap,
  matchFilmRelationCandidate,
  normalizeStrictTitleKey,
} from '../utils/relationMatching';
import {
  buildImdbSingleTokenSlug,
  latinPersonNamesMatch,
} from '../utils/bilingualMerge';
import {
  searchDoubanMedia,
  type DoubanClientOptions,
} from './doubanClient';

export interface ImdbClientOptions {
  mode: 'server' | 'browser';
  doubanOptions?: DoubanClientOptions;
  /** Whether to run Douban Chinese info assist in parallel (default: true) */
  enableDoubanAssist?: boolean;
  signal?: AbortSignal;
}

export interface ImdbSearchBundle {
  results: OnlineSearchResult[];
  hasDoubanAssist: boolean;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 240;

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const cacheStore = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): T | undefined {
  const entry = cacheStore.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cacheStore.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function writeCache(key: string, value: unknown): void {
  if (cacheStore.size >= MAX_CACHE_ENTRIES) {
    const oldest = cacheStore.keys().next().value;
    if (oldest !== undefined) cacheStore.delete(oldest);
  }
  cacheStore.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

async function waitWithGrace<T>(
  promise: Promise<T>,
  graceMs: number,
  fallback: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, graceMs);
    promise
      .then((val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function fetchJsonCached<T>(
  url: string,
  options: {
    mode: 'server' | 'browser';
    timeoutMs?: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  }
): Promise<T | null> {
  const cached = readCache<T>(url);
  if (cached !== undefined) return cached;

  const existing = inFlight.get(url);
  if (existing) return (await existing) as T | null;

  const task = (async (): Promise<T | null> => {
    const controller = new AbortController();
    const ext = options.signal;
    const onAbort = () => controller.abort();
    if (ext) {
      if (ext.aborted) return null;
      ext.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5500);
    try {
      const init: RequestInit = { signal: controller.signal };
      if (options.mode === 'server' && options.headers) {
        init.headers = options.headers;
      }
      const res = await fetch(url, init);
      if (!res.ok) return null;
      const data = (await res.json()) as T;
      writeCache(url, data);
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      if (ext) ext.removeEventListener('abort', onAbort);
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, task);
  return task;
}

/**
 * Browser-safe JSONP helper for IMDb's `sg.media-imdb.com/suggests/{c}/{slug}.json`.
 * Only invoked for clean single-token ASCII slugs (like `nm0504897`, `tt0118694`, `inception`)
 * where IMDb invokes `window["imdb$" + slug](payload)` without `%20` syntax issues.
 */
function fetchImdbSuggestJsonp(
  slug: string,
  timeoutMs = 4500,
  signal?: AbortSignal
): Promise<Record<string, any> | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9]{2,40}$/.test(clean)) {
    return Promise.resolve(null);
  }
  const cacheKey = `imdb-jsonp:${clean}`;
  const cached = readCache<Record<string, any>>(cacheKey);
  if (cached !== undefined) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    const cbKey = `imdb$${clean}`;
    const win = window as unknown as Record<string, unknown>;
    const prevCb = win[cbKey];
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        if (prevCb === undefined) {
          delete win[cbKey];
        } else {
          win[cbKey] = prevCb;
        }
      } catch {
        win[cbKey] = prevCb;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    const done = (val: Record<string, any> | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (val) writeCache(cacheKey, val);
      resolve(val);
    };

    const onAbort = () => done(null);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const timer = window.setTimeout(() => done(null), timeoutMs);
    win[cbKey] = (payload: Record<string, any>) => done(payload ?? null);

    script.src = `https://sg.media-imdb.com/suggests/${clean[0]}/${clean}.json`;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.onerror = () => done(null);
    (document.head || document.body || document.documentElement).appendChild(script);
  });
}

async function fetchImdbSuggestRaw(
  query: string,
  scope: 'all' | 'titles' | 'names',
  options: ImdbClientOptions
): Promise<Record<string, any> | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (options.mode === 'server') {
    const pathPrefix =
      scope === 'titles'
        ? 'titles/x'
        : scope === 'names'
          ? 'names/x'
          : 'x';
    return fetchJsonCached<Record<string, any>>(
      `https://v3.sg.media-imdb.com/suggestion/${pathPrefix}/${encodeURIComponent(
        trimmed
      )}.json`,
      {
        mode: 'server',
        timeoutMs: 4200,
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      }
    );
  }

  // Browser mode: convert exact tt.../nm... IDs or Latin names (e.g. "Robert Downey Jr." -> "robertdowney")
  // into a clean single-token ASCII slug safe for IMDb JSONP callback syntax.
  const singleToken = buildImdbSingleTokenSlug(trimmed);
  if (singleToken) {
    return fetchImdbSuggestJsonp(singleToken, 3800, options.signal);
  }
  return null;
}

async function fetchCinemetaTitleMeta(
  imdbId: string,
  preferredType: 'movie' | 'series' | 'auto',
  options: ImdbClientOptions
): Promise<ImdbEnrichedTitle | null> {
  const id = imdbId.trim().toLowerCase();
  if (!/^tt\d{5,10}$/.test(id)) return null;

  const tryType = async (t: 'movie' | 'series') => {
    const raw = await fetchJsonCached<Record<string, any>>(
      `https://v3-cinemeta.strem.io/meta/${t}/${id}.json`,
      {
        mode: options.mode,
        timeoutMs: 4200,
        signal: options.signal,
      }
    );
    return parseCinemetaMeta(raw, t);
  };

  if (preferredType === 'movie') {
    const m = await tryType('movie');
    if (m) return m;
    return tryType('series');
  }
  if (preferredType === 'series') {
    const s = await tryType('series');
    if (s) return s;
    return tryType('movie');
  }

  const [m, s] = await Promise.all([tryType('movie'), tryType('series')]);
  return m || s;
}

interface WikidataImdbMapping {
  titleIds: string[];
  nameIds: string[];
  charEntries: Array<{
    qid: string;
    zhTitle?: string;
    enTitle?: string;
    description?: string;
    imdbCharId?: string;
  }>;
  crossIdMap: Map<string, string>; // ttId -> doubanSubjectId
  zhTitleMap: Map<string, string>; // ttId|nmId -> Chinese label
  enNameMap: Map<string, string>; // ttId|nmId -> English label
}

async function resolveWikidataImdbBridge(
  query: string,
  options: ImdbClientOptions
): Promise<WikidataImdbMapping> {
  const empty: WikidataImdbMapping = {
    titleIds: [],
    nameIds: [],
    charEntries: [],
    crossIdMap: new Map(),
    zhTitleMap: new Map(),
    enNameMap: new Map(),
  };

  const trimmed = query.trim();
  if (!trimmed) return empty;
  const lang = hasCjkCharacters(trimmed) ? 'zh' : 'en';

  const searchJson = await fetchJsonCached<{
    search?: Array<{ id?: string }>;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      trimmed
    )}&language=${lang}&uselang=zh&limit=6&format=json&origin=*`,
    {
      mode: options.mode,
      timeoutMs: 3600,
      signal: options.signal,
      headers: { 'User-Agent': 'CineArchive/1.0 (contact@cinearchive.local)' },
    }
  );

  const qids = (searchJson?.search || [])
    .map((x) => x.id)
    .filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id));
  if (qids.length === 0) return empty;

  const entJson = await fetchJsonCached<{
    entities?: Record<string, Record<string, any>>;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
      qids.join('|')
    )}&props=labels|descriptions|claims&languages=zh-cn|zh-hans|zh|en&format=json&origin=*`,
    {
      mode: options.mode,
      timeoutMs: 3600,
      signal: options.signal,
      headers: { 'User-Agent': 'CineArchive/1.0 (contact@cinearchive.local)' },
    }
  );

  const entities = entJson?.entities || {};
  for (const qid of qids) {
    const ent = entities[qid];
    if (!ent) continue;

    const labels = ent.labels || {};
    const zhLabel: string | undefined =
      labels['zh-cn']?.value || labels['zh-hans']?.value || labels.zh?.value;
    const enLabel: string | undefined = labels.en?.value;
    const desc = ent.descriptions || {};
    const zhDesc: string | undefined =
      desc['zh-cn']?.value || desc['zh-hans']?.value || desc.zh?.value || desc.en?.value;

    const imdbIdRaw = ent.claims?.P345?.[0]?.mainsnak?.datavalue?.value;
    const doubanIdRaw = ent.claims?.P4529?.[0]?.mainsnak?.datavalue?.value;
    const imdbId =
      typeof imdbIdRaw === 'string' ? imdbIdRaw.trim().toLowerCase() : undefined;
    const doubanId =
      typeof doubanIdRaw === 'string' ? doubanIdRaw.trim() : undefined;

    if (imdbId) {
      if (imdbId.startsWith('tt')) {
        if (!empty.titleIds.includes(imdbId)) empty.titleIds.push(imdbId);
        if (doubanId) empty.crossIdMap.set(imdbId, doubanId);
        if (zhLabel) empty.zhTitleMap.set(imdbId, zhLabel);
        if (enLabel) empty.enNameMap.set(imdbId, enLabel);
      } else if (imdbId.startsWith('nm')) {
        if (!empty.nameIds.includes(imdbId)) empty.nameIds.push(imdbId);
        if (zhLabel) empty.zhTitleMap.set(imdbId, zhLabel);
        if (enLabel) empty.enNameMap.set(imdbId, enLabel);
      } else if (imdbId.startsWith('ch')) {
        empty.charEntries.push({
          qid,
          zhTitle: zhLabel,
          enTitle: enLabel,
          description: zhDesc,
          imdbCharId: imdbId,
        });
      }
    } else if (
      zhDesc &&
      /(虚构角色|漫画角色|电影角色|电视角色|主角|反派|fictional character)/i.test(
        zhDesc
      )
    ) {
      empty.charEntries.push({
        qid,
        zhTitle: zhLabel,
        enTitle: enLabel,
        description: zhDesc,
      });
    }
  }

  return empty;
}

async function runDoubanAssistSafe(
  query: string,
  category: ArchiveCategory,
  options: ImdbClientOptions,
  graceMs: number
): Promise<OnlineSearchResult[]> {
  if (options.enableDoubanAssist === false || !options.doubanOptions) {
    return [];
  }
  const promise = searchDoubanMedia(query, category, {
    ...options.doubanOptions,
    signal: options.signal,
  }).catch(() => []);
  return waitWithGrace(promise, graceMs, []);
}

/**
 * Primary IMDb Search with Non-Blocking Douban Chinese Info Assist.
 * Supports:
 * - Film / TV Series (Cinemeta CORS API + Official IMDb Suggest + Douban Chinese rating/synopsis fusion)
 * - People (IMDb Suggest + Wikidata P345 nm-ID bridge + Douban Chinese biography/roles fusion)
 * - Characters (IMDb work metadata + Wikidata ch-ID bridge + Douban credits character extraction)
 * - Direct IMDb URLs/IDs (`tt...`, `nm...`) AND direct Douban URLs/IDs
 */
export async function searchImdbMedia(
  query: string,
  category: ArchiveCategory,
  options: ImdbClientOptions
): Promise<ImdbSearchBundle> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], hasDoubanAssist: false };

  const doubanGraceMs = options.mode === 'server' ? 3500 : 4800;

  // 0A. Direct IMDb URL / ID paste (`tt...` or `nm...`)
  const directImdb = parseImdbUrlOrId(trimmed);
  if (directImdb) {
    if (directImdb.kind === 'title') {
      const [meta, suggestRaw] = await Promise.all([
        fetchCinemetaTitleMeta(directImdb.id, 'auto', options),
        fetchImdbSuggestRaw(directImdb.id, 'all', options),
      ]);
      const suggestParsed = parseImdbSuggestPayload(suggestRaw);
      const suggestHit = suggestParsed.titles.find((t) => t.imdbId === directImdb.id);
      const baseResult: OnlineSearchResult | null = meta
        ? {
            ...meta.result,
            coverUrl: meta.result.coverUrl || suggestHit?.result.coverUrl,
          }
        : suggestHit?.result || null;

      if (!baseResult) return { results: [], hasDoubanAssist: false };

      if (category === 'person' && meta) {
        const crew: OnlineSearchResult[] = [
          ...meta.directors.map((d) => ({
            externalId: `imdb-dir-${directImdb.id}-${d}`,
            category: 'person' as const,
            title: d,
            subtitle: `导演 · 《${baseResult.title}》`,
            summary: `《${baseResult.title}》导演（IMDb ${directImdb.id}）。`,
            relatedWorkTitle: baseResult.title,
            sourceName: 'IMDb',
            sourceUrl: baseResult.sourceUrl,
            tags: ['导演'],
          })),
          ...meta.cast.map((a) => ({
            externalId: `imdb-cast-${directImdb.id}-${a}`,
            category: 'person' as const,
            title: a,
            subtitle: `主演 · 《${baseResult.title}》`,
            summary: `在《${baseResult.title}》中担任主演（IMDb ${directImdb.id}）。`,
            relatedWorkTitle: baseResult.title,
            sourceName: 'IMDb',
            sourceUrl: baseResult.sourceUrl,
            tags: ['演员'],
          })),
        ];
        return { results: crew, hasDoubanAssist: false };
      }

      // Fetch Douban Chinese assist + Wikidata cross-ID/zh-title in parallel!
      const [doubanHits, wdMap] = await Promise.all([
        runDoubanAssistSafe(
          baseResult.title,
          'film',
          options,
          Math.max(doubanGraceMs, 3500)
        ),
        resolveWikidataImdbBridge(baseResult.title, options),
      ]);
      const merged = mergeImdbWithDoubanAssist([baseResult], doubanHits, {
        crossIdMap: wdMap.crossIdMap,
        zhTitleMap: wdMap.zhTitleMap,
        fallbackThreshold: 0,
        query: baseResult.title,
      });
      return {
        results: merged,
        hasDoubanAssist: merged.some((r) => r.sourceName === 'IMDb · 豆瓣辅助'),
      };
    }

    // Direct IMDb person ID (`nm...`)
    const suggestRaw = await fetchImdbSuggestRaw(directImdb.id, 'all', options);
    const parsed = parseImdbSuggestPayload(suggestRaw);
    const person = parsed.names[0];
    if (!person) return { results: [], hasDoubanAssist: false };

    const doubanHits = await runDoubanAssistSafe(
      person.title,
      'person',
      options,
      doubanGraceMs
    );
    const merged = mergeImdbWithDoubanAssist([person], doubanHits, {
      fallbackThreshold: 0,
      query: person.title,
    });
    return {
      results: merged,
      hasDoubanAssist: merged.some((r) => r.sourceName === 'IMDb · 豆瓣辅助'),
    };
  }

  // 0B. Direct Douban URL / ID paste while IMDb source is active -> enrich with IMDb!
  const directDouban = parseDoubanUrlOrId(trimmed);
  if (directDouban && options.doubanOptions) {
    const dbHits = await runDoubanAssistSafe(trimmed, category, options, 4500);
    if (dbHits.length > 0 && category === 'film') {
      const lead = dbHits[0];
      const lookupQ = lead.originalTitle || lead.title;
      const [cinMovie, cinSeries] = await Promise.all([
        fetchJsonCached<Record<string, any>>(
          `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(
            lookupQ
          )}.json`,
          { mode: options.mode, timeoutMs: 3800, signal: options.signal }
        ),
        fetchJsonCached<Record<string, any>>(
          `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(
            lookupQ
          )}.json`,
          { mode: options.mode, timeoutMs: 3800, signal: options.signal }
        ),
      ]);
      const candidates = [
        ...parseCinemetaSearchPayload(cinMovie, 'movie'),
        ...parseCinemetaSearchPayload(cinSeries, 'series'),
      ];
      if (candidates.length > 0) {
        const meta = await fetchCinemetaTitleMeta(
          candidates[0].imdbId,
          candidates[0].mediaType,
          options
        );
        if (meta) {
          const fused = mergeImdbWithDoubanAssist([meta.result], dbHits, {
            fallbackThreshold: 0,
          });
          return { results: fused, hasDoubanAssist: true };
        }
      }
      return { results: dbHits, hasDoubanAssist: true };
    }
    return { results: dbHits, hasDoubanAssist: dbHits.length > 0 };
  }

  // 1. FILM & TV SERIES SEARCH (IMDb Primary + Douban Assist)
  if (category === 'film') {
    // Kick off Douban assist immediately in parallel so it overlaps with IMDb search + hydration
    const doubanPromise =
      options.enableDoubanAssist !== false && options.doubanOptions
        ? searchDoubanMedia(trimmed, 'film', {
            ...options.doubanOptions,
            signal: options.signal,
          }).catch(() => [])
        : Promise.resolve([] as OnlineSearchResult[]);

    const [cinMovieRaw, cinSeriesRaw, suggestRaw, wdMap] = await Promise.all([
      fetchJsonCached<Record<string, any>>(
        `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(
          trimmed
        )}.json`,
        { mode: options.mode, timeoutMs: 4500, signal: options.signal }
      ),
      fetchJsonCached<Record<string, any>>(
        `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(
          trimmed
        )}.json`,
        { mode: options.mode, timeoutMs: 4500, signal: options.signal }
      ),
      fetchImdbSuggestRaw(trimmed, 'titles', options),
      resolveWikidataImdbBridge(trimmed, options),
    ]);

    const cinMovies = parseCinemetaSearchPayload(cinMovieRaw, 'movie');
    const cinSeries = parseCinemetaSearchPayload(cinSeriesRaw, 'series');
    const suggestTitles = parseImdbSuggestPayload(suggestRaw).titles;

    // Combine & deduplicate by IMDb tt-ID, prioritizing exact/Wikidata hits first
    const byId = new Map<
      string,
      {
        imdbId: string;
        mediaType: 'movie' | 'series';
        result: OnlineSearchResult;
      }
    >();
    const orderedIds: string[] = [];

    const register = (entry: {
      imdbId: string;
      mediaType: 'movie' | 'series';
      result: OnlineSearchResult;
    }) => {
      const existing = byId.get(entry.imdbId);
      if (!existing) {
        byId.set(entry.imdbId, entry);
        orderedIds.push(entry.imdbId);
      } else {
        byId.set(entry.imdbId, {
          ...existing,
          result: {
            ...existing.result,
            coverUrl: existing.result.coverUrl || entry.result.coverUrl,
            year: existing.result.year || entry.result.year,
          },
        });
      }
    };

    // Prioritize Wikidata exact tt-ID hits (crucial for Chinese queries that differ from English title!)
    for (const wdTtId of wdMap.titleIds.slice(0, 3)) {
      const matched =
        cinMovies.find((m) => m.imdbId === wdTtId) ||
        cinSeries.find((s) => s.imdbId === wdTtId) ||
        suggestTitles.find((t) => t.imdbId === wdTtId);
      if (matched) {
        register(matched);
      } else {
        register({
          imdbId: wdTtId,
          mediaType: 'movie',
          result: {
            externalId: `imdb-${wdTtId}`,
            category: 'film',
            title: wdMap.enNameMap.get(wdTtId) || wdMap.zhTitleMap.get(wdTtId) || trimmed,
            sourceName: 'IMDb',
            sourceUrl: `https://www.imdb.com/title/${wdTtId}/`,
            summary: `${wdMap.zhTitleMap.get(wdTtId) || trimmed} — IMDb 影视条目。`,
            tags: ['电影'],
          },
        });
      }
    }

    for (const s of suggestTitles.slice(0, 8)) register(s);
    for (const m of cinMovies.slice(0, 8)) register(m);
    for (const s of cinSeries.slice(0, 6)) register(s);

    // Hydrate top 6 IMDb titles in parallel via Cinemeta `/meta/{type}/{ttId}.json` for IMDb ratings, awards, director & cast
    const toHydrate = orderedIds.slice(0, 6);
    const hydratedMeta = await Promise.all(
      toHydrate.map((id) => {
        const entry = byId.get(id)!;
        return fetchCinemetaTitleMeta(id, entry.mediaType, options);
      })
    );

    const hydratedById = new Map<string, OnlineSearchResult>();
    for (const meta of hydratedMeta) {
      if (meta) {
        const orig = byId.get(meta.imdbId);
        hydratedById.set(meta.imdbId, {
          ...meta.result,
          // Keep sharp m.media-amazon.com poster from Suggest if available, else Metahub medium poster
          coverUrl: orig?.result.coverUrl || meta.result.coverUrl,
        });
      }
    }

    let imdbResults: OnlineSearchResult[] = orderedIds
      .slice(0, 12)
      .map((id) => hydratedById.get(id) || byId.get(id)!.result);

    // Wait for parallel Douban assist (already started at t=0!) so Chinese titles fuse reliably
    const doubanHits = await waitWithGrace(
      doubanPromise,
      imdbResults.length > 0 ? doubanGraceMs : 5500,
      []
    );

    // If the user searched in Chinese (e.g. on mainland China network where Wikidata is blocked)
    // and IMDb had 0 hits (or none matched Douban), bridge via Douban's Latin originalTitle -> Cinemeta!
    const hasAnyDoubanOverlap =
      imdbResults.length > 0 &&
      doubanHits.length > 0 &&
      mergeImdbWithDoubanAssist(imdbResults, doubanHits, {
        crossIdMap: wdMap.crossIdMap,
        zhTitleMap: wdMap.zhTitleMap,
        fallbackThreshold: 0,
      }).some((item) => item.sourceName === 'IMDb · 豆瓣辅助');

    if (
      (imdbResults.length === 0 || (hasCjkCharacters(trimmed) && !hasAnyDoubanOverlap)) &&
      doubanHits.length > 0
    ) {
      const latinFilmQueries = Array.from(
        new Set(
          doubanHits
            .map((d) => (d.originalTitle || '').split(/\s*[/／]\s*/)[0]?.trim() || '')
            .filter((t) => Boolean(t) && !hasCjkCharacters(t))
        )
      ).slice(0, 2);

      if (latinFilmQueries.length > 0) {
        const extraBatches = await Promise.all(
          latinFilmQueries.map(async (qLatin) => {
            const [mRaw, sRaw, sugRaw] = await Promise.all([
              fetchJsonCached<Record<string, any>>(
                `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(
                  qLatin
                )}.json`,
                { mode: options.mode, timeoutMs: 3600, signal: options.signal }
              ),
              fetchJsonCached<Record<string, any>>(
                `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(
                  qLatin
                )}.json`,
                { mode: options.mode, timeoutMs: 3600, signal: options.signal }
              ),
              fetchImdbSuggestRaw(qLatin, 'titles', options),
            ]);
            return [
              ...parseImdbSuggestPayload(sugRaw).titles.slice(0, 3),
              ...parseCinemetaSearchPayload(mRaw, 'movie').slice(0, 3),
              ...parseCinemetaSearchPayload(sRaw, 'series').slice(0, 2),
            ];
          })
        );

        const newlyAddedIds: string[] = [];
        for (const entry of extraBatches.flat()) {
          if (!byId.has(entry.imdbId)) {
            register(entry);
            newlyAddedIds.push(entry.imdbId);
          }
        }

        if (newlyAddedIds.length > 0) {
          const extraHydrated = await Promise.all(
            newlyAddedIds.slice(0, 4).map((id) => {
              const entry = byId.get(id)!;
              return fetchCinemetaTitleMeta(id, entry.mediaType, options);
            })
          );
          for (const meta of extraHydrated) {
            if (meta) {
              const orig = byId.get(meta.imdbId);
              hydratedById.set(meta.imdbId, {
                ...meta.result,
                coverUrl: orig?.result.coverUrl || meta.result.coverUrl,
              });
            }
          }
          imdbResults = orderedIds
            .slice(0, 12)
            .map((id) => hydratedById.get(id) || byId.get(id)!.result);
        }
      }
    }

    let fused = mergeImdbWithDoubanAssist(imdbResults, doubanHits, {
      crossIdMap: wdMap.crossIdMap,
      zhTitleMap: wdMap.zhTitleMap,
      fallbackThreshold: 4,
      query: trimmed,
    });

    // Prefer Douban Chinese titles first for top unmatched English IMDb hits (e.g. indirect queries);
    // fall back cleanly to IMDb English when Douban has no match.
    if (options.enableDoubanAssist !== false && options.doubanOptions) {
      const normalizedQuery = normalizeEntityKey(trimmed);
      const unmatchedTargets = fused
        .slice(0, 4)
        .filter(
          (item) =>
            item.sourceName === 'IMDb' &&
            !hasCjkCharacters(item.title) &&
            normalizeEntityKey(item.title) !== normalizedQuery
        )
        .slice(0, 3);

      if (unmatchedTargets.length > 0) {
        const extraDoubanArrays = await Promise.all(
          unmatchedTargets.map((item) =>
            runDoubanAssistSafe(item.title, 'film', options, 3400)
          )
        );
        const extraDouban = extraDoubanArrays.flat();
        if (extraDouban.length > 0) {
          const enrichedSubset = mergeImdbWithDoubanAssist(
            unmatchedTargets,
            extraDouban,
            {
              crossIdMap: wdMap.crossIdMap,
              zhTitleMap: wdMap.zhTitleMap,
              fallbackThreshold: 0,
            }
          );
          const enrichedById = new Map(
            enrichedSubset.map((item) => [item.externalId, item])
          );
          fused = rankImdbResults(
            fused.map((item) => enrichedById.get(item.externalId) || item),
            trimmed
          );
        }
      }
    }

    return {
      results: fused.slice(0, 12),
      hasDoubanAssist: fused.some(
        (r) => r.sourceName === 'IMDb · 豆瓣辅助' || r.sourceName === '豆瓣辅助'
      ),
    };
  }

  // 2. PERSON SEARCH (IMDb nm... via Suggest + Wikidata P345 Bridge + Douban Chinese Bio Assist)
  if (category === 'person') {
    const doubanPromise =
      options.enableDoubanAssist !== false && options.doubanOptions
        ? searchDoubanMedia(trimmed, 'person', {
            ...options.doubanOptions,
            signal: options.signal,
          }).catch(() => [])
        : Promise.resolve([] as OnlineSearchResult[]);

    const [directSuggestRaw, wdMap] = await Promise.all([
      hasCjkCharacters(trimmed)
        ? Promise.resolve(null)
        : fetchImdbSuggestRaw(trimmed, 'names', options),
      resolveWikidataImdbBridge(trimmed, options),
    ]);

    const imdbPeople: OnlineSearchResult[] = [];
    const seenIds = new Set<string>();

    const pushPerson = (p: OnlineSearchResult) => {
      if (seenIds.has(p.externalId)) return;
      seenIds.add(p.externalId);
      imdbPeople.push(p);
    };

    for (const p of parseImdbSuggestPayload(directSuggestRaw).names) {
      pushPerson(p);
    }

    // Look up each Wikidata-resolved IMDb `nm...` ID directly (works in BOTH server & browser JSONP!)
    if (wdMap.nameIds.length > 0) {
      const nmPayloads = await Promise.all(
        wdMap.nameIds
          .slice(0, 4)
          .map((nmId) => fetchImdbSuggestRaw(nmId, 'all', options))
      );
      for (const raw of nmPayloads) {
        for (const p of parseImdbSuggestPayload(raw).names) {
          pushPerson(p);
        }
      }
    }

    // Wait for Douban celebrity assist (gives Chinese bio, roles, birthplace, AND English name fallback!)
    const doubanHits = await waitWithGrace(
      doubanPromise,
      imdbPeople.length > 0 ? doubanGraceMs : 5500,
      []
    );

    // If IMDb still had 0 hits (e.g. Wikidata missed a Chinese actor), use Douban's `originalTitle` to look up IMDb!
    if (imdbPeople.length === 0 && doubanHits.length > 0) {
      const latinNames = doubanHits
        .map((d) => d.originalTitle)
        .filter((n): n is string => Boolean(n && n.trim() && !hasCjkCharacters(n)))
        .slice(0, 2);
      if (latinNames.length > 0) {
        const extraPayloads = await Promise.all(
          latinNames.map((n) => fetchImdbSuggestRaw(n, 'names', options))
        );
        for (const raw of extraPayloads) {
          for (const p of parseImdbSuggestPayload(raw).names.slice(0, 2)) {
            pushPerson(p);
          }
        }
      }
    }

    let fused = mergeImdbWithDoubanAssist(imdbPeople, doubanHits, {
      zhTitleMap: wdMap.zhTitleMap,
      fallbackThreshold: 3,
      query: trimmed,
    });

    // Prefer Douban Chinese names for top unmatched English person results (e.g. partial English search)
    if (options.enableDoubanAssist !== false && options.doubanOptions) {
      const normalizedQuery = normalizeEntityKey(trimmed);
      const unmatchedPeople = fused
        .slice(0, 3)
        .filter(
          (item) =>
            item.sourceName === 'IMDb' &&
            !hasCjkCharacters(item.title) &&
            normalizeEntityKey(item.title) !== normalizedQuery
        )
        .slice(0, 2);

      if (unmatchedPeople.length > 0) {
        const extraDoubanArrays = await Promise.all(
          unmatchedPeople.map((item) =>
            runDoubanAssistSafe(item.title, 'person', options, 3200)
          )
        );
        const extraDouban = extraDoubanArrays.flat();
        if (extraDouban.length > 0) {
          const enrichedSubset = mergeImdbWithDoubanAssist(
            unmatchedPeople,
            extraDouban,
            {
              zhTitleMap: wdMap.zhTitleMap,
              fallbackThreshold: 0,
            }
          );
          const enrichedById = new Map(
            enrichedSubset.map((item) => [item.externalId, item])
          );
          fused = rankImdbResults(
            fused.map((item) => enrichedById.get(item.externalId) || item),
            trimmed
          );
        }
      }
    }

    return {
      results: fused.slice(0, 10),
      hasDoubanAssist: fused.some(
        (r) => r.sourceName === 'IMDb · 豆瓣辅助' || r.sourceName === '豆瓣辅助'
      ),
    };
  }

  // 3. CHARACTER SEARCH (IMDb Work Context + Wikidata Character Bridge + Douban Credits Assist)
  const doubanPromise =
    options.enableDoubanAssist !== false && options.doubanOptions
      ? searchDoubanMedia(trimmed, 'character', {
          ...options.doubanOptions,
          signal: options.signal,
        }).catch(() => [])
      : Promise.resolve([] as OnlineSearchResult[]);

  const [cinMovieRaw, cinSeriesRaw, wdMap] = await Promise.all([
    fetchJsonCached<Record<string, any>>(
      `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(
        trimmed
      )}.json`,
      { mode: options.mode, timeoutMs: 4200, signal: options.signal }
    ),
    fetchJsonCached<Record<string, any>>(
      `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(
        trimmed
      )}.json`,
      { mode: options.mode, timeoutMs: 4200, signal: options.signal }
    ),
    resolveWikidataImdbBridge(trimmed, options),
  ]);

  const matchedWorks = [
    ...parseCinemetaSearchPayload(cinMovieRaw, 'movie'),
    ...parseCinemetaSearchPayload(cinSeriesRaw, 'series'),
  ];
  const strictWorkHit = matchedWorks.find(
    (w) =>
      wdMap.titleIds.includes(w.imdbId) ||
      hasStrictTitleOverlap([w.result.title], [trimmed])
  );
  const topWorkMeta = strictWorkHit
    ? await fetchCinemetaTitleMeta(
        strictWorkHit.imdbId,
        strictWorkHit.mediaType,
        options
      )
    : null;

  const doubanChars = await waitWithGrace(doubanPromise, 3400, []);

  const out: OnlineSearchResult[] = [];
  const seen = new Set<string>();
  const pushChar = (item: OnlineSearchResult) => {
    const key = `${normalizeEntityKey(item.title)}::${normalizeEntityKey(
      item.relatedWorkTitle || ''
    )}`;
    if (!item.title || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  // Enrich Douban character entries with IMDb work context/poster when applicable
  for (const ch of doubanChars) {
    const workMatches =
      topWorkMeta &&
      ch.relatedWorkTitle &&
      (normalizeEntityKey(ch.relatedWorkTitle) ===
        normalizeEntityKey(topWorkMeta.result.title) ||
        normalizeEntityKey(trimmed) === normalizeEntityKey(ch.title));

    const imdbRating = topWorkMeta
      ? /IMDb\s*\d+(?:\.\d+)?/i.exec(topWorkMeta.result.subtitle || '')?.[0]
      : undefined;

    pushChar({
      ...ch,
      coverUrl: ch.coverUrl || (workMatches ? topWorkMeta?.result.coverUrl : undefined),
      subtitle:
        workMatches && imdbRating && ch.subtitle && !ch.subtitle.includes('IMDb')
          ? `${ch.subtitle} · ${imdbRating}`
          : ch.subtitle,
      sourceName: workMatches ? 'IMDb · 豆瓣辅助' : '豆瓣辅助',
    });
  }

  // Add Wikidata IMDb character (`ch...`) or top IMDb work character entry if still sparse
  for (const wdChar of wdMap.charEntries) {
    const title = wdChar.zhTitle || wdChar.enTitle || trimmed;
    const orig =
      wdChar.enTitle && wdChar.enTitle !== title ? wdChar.enTitle : undefined;
    pushChar({
      externalId: wdChar.imdbCharId
        ? `imdb-${wdChar.imdbCharId}`
        : `imdb-wdchar-${wdChar.qid}`,
      category: 'character',
      title,
      originalTitle: orig,
      subtitle: topWorkMeta
        ? `影视角色 · 出自《${topWorkMeta.result.title}》`
        : '影视角色',
      year: topWorkMeta?.result.year,
      coverUrl: topWorkMeta?.result.coverUrl,
      summary:
        wdChar.description ||
        (topWorkMeta
          ? `出自 IMDb 条目《${topWorkMeta.result.title}》的角色「${title}」。`
          : `${title} — 影视虚构角色档案。`),
      relatedWorkTitle: topWorkMeta?.result.title,
      portrayedBy: topWorkMeta?.cast[0],
      sourceName: doubanChars.length > 0 ? 'IMDb · 豆瓣辅助' : 'IMDb',
      sourceUrl: topWorkMeta?.result.sourceUrl,
      tags: ['影视角色', ...(topWorkMeta?.result.tags.slice(0, 2) || [])],
    });
  }

  if (out.length === 0 && topWorkMeta) {
    pushChar({
      externalId: `imdb-workchar-${topWorkMeta.imdbId}-${trimmed}`,
      category: 'character',
      title: trimmed,
      subtitle: `出自《${topWorkMeta.result.title}》${
        topWorkMeta.cast[0] ? ` · ${topWorkMeta.cast[0]} 主演` : ''
      }`,
      year: topWorkMeta.result.year,
      coverUrl: topWorkMeta.result.coverUrl,
      summary: `出自 IMDb 作品《${topWorkMeta.result.title}》${
        topWorkMeta.result.year ? `（${topWorkMeta.result.year}）` : ''
      }。${topWorkMeta.result.summary}`,
      relatedWorkTitle: topWorkMeta.result.title,
      portrayedBy: topWorkMeta.cast[0],
      sourceName: 'IMDb',
      sourceUrl: topWorkMeta.result.sourceUrl,
      tags: ['影视角色', topWorkMeta.result.title],
    });
  }

  return {
    results: rankImdbResults(out, trimmed).slice(0, 10),
    hasDoubanAssist: out.some(
      (r) => r.sourceName === 'IMDb · 豆瓣辅助' || r.sourceName === '豆瓣辅助'
    ),
  };
}

/**
 * Fetches crisp, anti-hotlink-free IMDb official posters & widescreen backgrounds for Cover Picker.
 */
export async function searchImdbCoverCandidates(
  query: string,
  category: ArchiveCategory,
  originalTitle: string | undefined,
  options: ImdbClientOptions
): Promise<CoverCandidate[]> {
  const searchTerms = Array.from(
    new Set([originalTitle?.trim(), query.trim()].filter((s): s is string => Boolean(s)))
  );
  if (searchTerms.length === 0) return [];

  if (category === 'person') {
    const wdMap = await resolveWikidataImdbBridge(query, options);
    const lookups = [
      ...wdMap.nameIds.slice(0, 2),
      ...searchTerms.filter((t) => !hasCjkCharacters(t)).slice(0, 2),
    ];
    const payloads = await Promise.all(
      lookups.map((term) => fetchImdbSuggestRaw(term, 'all', options))
    );
    const out: CoverCandidate[] = [];
    const seen = new Set<string>();
    for (const raw of payloads) {
      for (const p of parseImdbSuggestPayload(raw).names) {
        if (!p.coverUrl || seen.has(p.coverUrl)) continue;
        seen.add(p.coverUrl);
        out.push({
          id: `imdb-person-${p.externalId}`,
          url: p.coverUrl,
          source: 'IMDb 影人',
          caption: `${p.title} · IMDb 官方肖像`,
        });
      }
    }
    return out;
  }

  const primaryQuery = searchTerms[0];
  const [cinMovieRaw, cinSeriesRaw, suggestRaw] = await Promise.all([
    fetchJsonCached<Record<string, any>>(
      `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(
        primaryQuery
      )}.json`,
      { mode: options.mode, timeoutMs: 3800, signal: options.signal }
    ),
    fetchJsonCached<Record<string, any>>(
      `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(
        primaryQuery
      )}.json`,
      { mode: options.mode, timeoutMs: 3800, signal: options.signal }
    ),
    fetchImdbSuggestRaw(primaryQuery, 'titles', options),
  ]);

  const entries: Array<{
    imdbId: string;
    title: string;
    posterUrl?: string;
    backgroundUrl?: string;
  }> = [];

  for (const s of parseImdbSuggestPayload(suggestRaw).titles.slice(0, 4)) {
    entries.push({
      imdbId: s.imdbId,
      title: query.trim() || s.result.title,
      posterUrl: s.result.coverUrl,
      backgroundUrl: `https://images.metahub.space/background/medium/${s.imdbId}/img`,
    });
  }
  for (const m of parseCinemetaSearchPayload(cinMovieRaw, 'movie').slice(0, 4)) {
    entries.push({
      imdbId: m.imdbId,
      title: query.trim() || m.result.title,
      posterUrl: m.result.coverUrl,
      backgroundUrl: m.backgroundUrl,
    });
  }
  for (const s of parseCinemetaSearchPayload(cinSeriesRaw, 'series').slice(0, 3)) {
    entries.push({
      imdbId: s.imdbId,
      title: query.trim() || s.result.title,
      posterUrl: s.result.coverUrl,
      backgroundUrl: s.backgroundUrl,
    });
  }

  return buildImdbCoverCandidates(entries);
}

/**
 * Fetches Film -> Directors, Writers & Lead Cast from IMDb Cinemeta metadata.
 */
export async function fetchImdbFilmRelations(
  title: string,
  originalTitle: string | undefined,
  sourceUrl: string | undefined,
  options: ImdbClientOptions & { year?: string }
): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { people: [], characters: [] };

  let imdbId = extractImdbIdFromUrl(sourceUrl);
  if (imdbId && !imdbId.startsWith('tt')) imdbId = null;

  let preferredType: 'movie' | 'series' | 'auto' = 'auto';
  if (!imdbId) {
    const q = (originalTitle || title).trim();
    const [cinMovieRaw, cinSeriesRaw] = await Promise.all([
      fetchJsonCached<Record<string, any>>(
        `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(q)}.json`,
        { mode: options.mode, timeoutMs: 3600, signal: options.signal }
      ),
      fetchJsonCached<Record<string, any>>(
        `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(q)}.json`,
        { mode: options.mode, timeoutMs: 3600, signal: options.signal }
      ),
    ]);
    const movies = parseCinemetaSearchPayload(cinMovieRaw, 'movie');
    const series = parseCinemetaSearchPayload(cinSeriesRaw, 'series');
    const all = [...movies, ...series];
    const matched = matchFilmRelationCandidate(
      all.map((entry) => ({
        title: entry.result.title,
        originalTitle: entry.result.originalTitle,
        year: entry.result.year,
        entry,
      })),
      { title, originalTitle, year: options.year }
    );
    if (matched) {
      imdbId = matched.entry.imdbId;
      preferredType = matched.entry.mediaType;
    }
  }

  if (!imdbId) return empty;
  const meta = await fetchCinemetaTitleMeta(imdbId, preferredType, options);
  if (!meta) return empty;

  const people: OnlineSearchResult[] = [];
  const seen = new Set<string>();
  const addPerson = (name: string, role: string, tag: string) => {
    const k = normalizeEntityKey(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    people.push({
      externalId: `imdb-rel-${imdbId}-${k}`,
      category: 'person',
      title: name,
      subtitle: role,
      summary: `在《${title}》中担任${role}（IMDb ${imdbId}）。`,
      relatedWorkTitle: title,
      sourceName: 'IMDb',
      tags: [tag],
    });
  };

  for (const d of meta.directors) addPerson(d, '导演', '导演');
  for (const w of meta.writers) addPerson(w, '编剧', '编剧');
  for (const a of meta.cast) addPerson(a, '主演', '演员');

  // Enrich top cast & directors with IMDb Suggest portraits and real nm... URLs in BOTH server & browser modes
  if (people.length > 0) {
    const enrichTargets = people.slice(0, 10);
    await Promise.allSettled(
      enrichTargets.map(async (person) => {
        if (hasCjkCharacters(person.title)) return;
        const suggestRaw = await fetchImdbSuggestRaw(
          person.title,
          'names',
          options
        );
        const targetKey = normalizeStrictTitleKey(person.title);
        const hit = parseImdbSuggestPayload(suggestRaw).names.find(
          (cand) =>
            normalizeStrictTitleKey(cand.title) === targetKey ||
            latinPersonNamesMatch(cand.title, person.title)
        );
        if (!hit) return;
        if (hit.coverUrl && !person.coverUrl) {
          person.coverUrl = hit.coverUrl;
        }
        if (hit.sourceUrl && /\/name\/nm\d+/i.test(hit.sourceUrl)) {
          person.sourceUrl = hit.sourceUrl;
        }
      })
    );
  }

  return { people, characters: [] };
}

/**
 * Fetches Person -> Known-for Films from IMDb Suggest + Cinemeta search.
 */
export async function fetchImdbPersonRelations(
  title: string,
  originalTitle: string | undefined,
  sourceUrl: string | undefined,
  options: ImdbClientOptions
): Promise<{ films: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { films: [], characters: [] };
  const lookupName = (originalTitle || title).trim();
  if (!lookupName) return empty;

  const nmId = extractImdbIdFromUrl(sourceUrl);
  const suggestRaw =
    nmId && nmId.startsWith('nm')
      ? await fetchImdbSuggestRaw(nmId, 'all', options)
      : !hasCjkCharacters(lookupName)
        ? await fetchImdbSuggestRaw(lookupName, 'names', options)
        : null;

  const knownWorkTitle = parseImdbSuggestPayload(suggestRaw).names[0]?.relatedWorkTitle;
  const searchQuery = knownWorkTitle || lookupName;

  const cinMovieRaw = await fetchJsonCached<Record<string, any>>(
    `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(
      searchQuery
    )}.json`,
    { mode: options.mode, timeoutMs: 3600, signal: options.signal }
  );

  const hits = parseCinemetaSearchPayload(cinMovieRaw, 'movie').slice(0, 6);
  const hydrated = await Promise.all(
    hits.slice(0, 3).map((h) => fetchCinemetaTitleMeta(h.imdbId, 'movie', options))
  );

  const films: OnlineSearchResult[] = [];
  for (const meta of hydrated) {
    if (!meta) continue;
    // Verify the person is actually in cast/director if we searched by person name
    if (!knownWorkTitle) {
      const target = normalizeEntityKey(lookupName);
      const credits = [...meta.directors, ...meta.writers, ...meta.cast].map((n) =>
        normalizeEntityKey(n)
      );
      if (!credits.some((c) => c === target || c.includes(target) || target.includes(c))) {
        continue;
      }
    }
    films.push({
      ...meta.result,
      relatedWorkTitle: title,
    });
  }

  return { films, characters: [] };
}

export { normalizeImdbImageUrl };
