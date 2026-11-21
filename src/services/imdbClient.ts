import type { ArchiveCategory, OnlineSearchResult } from '../types/archive';
import type { CoverCandidate } from '../utils/coverPicker';
import { parseDoubanUrlOrId } from '../utils/doubanParsers';
import {
  buildImdbCoverCandidates,
  extractImdbIdFromExternalId,
  extractImdbIdFromUrl,
  hasCjkCharacters,
  isPlausibleBaikeFilmOrPerson,
  mergeImdbWithDoubanAssist,
  normalizeImdbImageUrl,
  parseCinemetaMeta,
  parseCinemetaSearchPayload,
  parseImdbSuggestPayload,
  parseImdbUrlOrId,
  rankImdbResults,
  type ImdbEnrichedTitle,
} from '../utils/imdbParsers';
import {
  parseBaiduBaikeCard,
  parseBangumiLegacySubjects,
} from '../utils/chinaSearchParsers';
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

import { localizeFilm, searchFilmIndex } from '../utils/filmIndex';

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
  hasChineseAssist?: boolean;
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

let imdbClientJsonpSeq = 0;

function fetchBrowserJsonpCached<T>(
  rawUrl: string,
  callbackParam = 'callback',
  timeoutMs = 3200,
  signal?: AbortSignal
): Promise<T | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  const cacheKey = `jsonp:${rawUrl}`;
  const cached = readCache<T>(cacheKey);
  if (cached !== undefined) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    imdbClientJsonpSeq += 1;
    const cbName = `__cineImdbJsonp_${Date.now()}_${imdbClientJsonpSeq}`;
    const win = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        delete win[cbName];
      } catch {
        win[cbName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    const done = (val: T | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (val) writeCache(cacheKey, val);
      resolve(val);
    };

    const onAbort = () => done(null);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const timer = window.setTimeout(() => done(null), timeoutMs);
    win[cbName] = (payload: T) => done(payload ?? null);

    const sep = rawUrl.includes('?') ? '&' : '?';
    script.src = `${rawUrl}${sep}${encodeURIComponent(callbackParam)}=${encodeURIComponent(cbName)}`;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.onerror = () => done(null);
    (document.head || document.body || document.documentElement).appendChild(script);
  });
}

/**
 * Fast, CORS-open Bangumi Chinese assist (`api.bgm.tv`, simple GET without CORS preflight).
 * Supplies canonical Chinese titles AND full Chinese plot synopses even when Douban's
 * static bridge (`r.jina.ai`) is rate-limited or lacks a plot synopsis.
 */
async function fetchBangumiChineseAssist(
  query: string,
  category: ArchiveCategory,
  options: ImdbClientOptions
): Promise<OnlineSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed || category === 'character') return [];

  if (category === 'film') {
    const [realRaw, animeRaw] = await Promise.all([
      fetchJsonCached<Record<string, any>>(
        `https://api.bgm.tv/search/subject/${encodeURIComponent(
          trimmed
        )}?type=6&responseGroup=medium`,
        {
          mode: options.mode,
          timeoutMs: 3200,
          signal: options.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)',
          },
        }
      ),
      fetchJsonCached<Record<string, any>>(
        `https://api.bgm.tv/search/subject/${encodeURIComponent(
          trimmed
        )}?type=2&responseGroup=medium`,
        {
          mode: options.mode,
          timeoutMs: 3200,
          signal: options.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)',
          },
        }
      ),
    ]);

    const combined = [
      ...parseBangumiLegacySubjects(realRaw),
      ...parseBangumiLegacySubjects(animeRaw),
    ];
    return combined.filter((item) => hasCjkCharacters(item.title));
  }

  return [];
}

async function fetchBaikePerson(query: string, options: ImdbClientOptions): Promise<OnlineSearchResult[]> {
  const fetchCard = async (keyword: string): Promise<Record<string, any> | null> => {
    const url = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(
      keyword
    )}`;
    if (options.mode === 'browser') {
      return fetchBrowserJsonpCached<Record<string, any>>(
        url,
        'callback',
        2600,
        options.signal
      );
    }
    return fetchJsonCached<Record<string, any>>(url, {
      mode: 'server',
      timeoutMs: 2600,
      signal: options.signal,
      headers: { Accept: 'application/json' },
    });
  };

  const { searchResult } = parseBaiduBaikeCard(await fetchCard(query), 'person');
  return searchResult && isPlausibleBaikeFilmOrPerson(searchResult, 'person') ? [searchResult] : [];
}

async function resolveWikidataByImdbIds(
  imdbIds: string[],
  options: ImdbClientOptions,
  includeFilmPages = false,
): Promise<{ zhTitleMap: Map<string, string>; crossIdMap: Map<string, string>; pages: Map<string, string> }> {
  const zhTitleMap = new Map<string, string>();
  const crossIdMap = new Map<string, string>();
  const pages = new Map<string, string>();
  const ids = [...new Set(imdbIds.filter(id => /^(tt|nm)\d{5,10}$/.test(id)))].slice(0, 12);
  if (!ids.length || options.signal?.aborted) return { zhTitleMap, crossIdMap, pages };
  const languages = ['zh-cn', 'zh-hans', 'zh', 'zh-sg', 'zh-hk', 'zh-tw'];
  const query = `SELECT ?id ?label ?douban ${includeFilmPages ? '?page' : ''} WHERE {
    VALUES ?id { ${ids.map(id => JSON.stringify(id)).join(' ')} }
    ?work wdt:P345 ?id.
    OPTIONAL { ?work rdfs:label ?label FILTER(LANGMATCHES(LANG(?label), "zh")) }
    OPTIONAL { ?work wdt:P4529 ?douban }
    ${includeFilmPages ? 'OPTIONAL { ?page schema:about ?work; schema:isPartOf <https://zh.wikipedia.org/>. }' : ''}
  }`;
  type Row = { id: { value: string }; label?: { value: string; 'xml:lang': string }; douban?: { value: string }; page?: { value: string } };
  const data = await fetchJsonCached<{ results: { bindings: Row[] } }>(
    'https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }),
    { ...options, timeoutMs: 2300 }
  );
  const priority = new Map<string, number>();
  for (const row of data?.results?.bindings || []) {
    const id = row.id.value;
    if (!ids.includes(id)) continue;
    if (row.page?.value.startsWith('https://zh.wikipedia.org/wiki/')) {
      const name = decodeURIComponent(row.page.value.slice('https://zh.wikipedia.org/wiki/'.length)).replace(/_/g, ' ');
      // Reject multiple article identities for a single provider ID.
      pages.set(id, !pages.has(id) || pages.get(id) === name ? name : '');
    }
    if (row.douban?.value) crossIdMap.set(id, row.douban.value);
    const rank = languages.indexOf(row.label?.['xml:lang'] || '');
    if (row.label && hasCjkCharacters(row.label.value) && rank >= 0 && rank < (priority.get(id) ?? Infinity)) {
      priority.set(id, rank);
      zhTitleMap.set(id, row.label.value);
    }
  }
  return { zhTitleMap, crossIdMap, pages };
}

async function fetchLinkedFilmProfiles(pages: Map<string, string>, options: ImdbClientOptions) {
  const output = new Map<string, { title?: string; summary: string; summaryRevision: number }>();
  const titles = [...new Set(pages.values())].filter(Boolean);
  if (!titles.length) return output;
  const params = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*',
    variant: 'zh-cn', prop: 'extracts|info', exintro: '1', explaintext: '1', exlimit: 'max', titles: titles.join('|') });
  type WikiPage = { title: string; extract?: string; lastrevid?: number };
  const data = await fetchJsonCached<{ query?: { pages?: WikiPage[] } }>(
    'https://zh.wikipedia.org/w/api.php?' + params, { ...options, timeoutMs: 2500 });
  for (const page of data?.query?.pages || []) {
    const summary = page.extract?.trim().split('\n')[0];
    if (!page.lastrevid || !summary || !hasCjkCharacters(summary)) continue;
    const ids = [...pages].filter(([, name]) => name === page.title);
    if (ids.length !== 1) continue;
    const title = /^《([^《》]+)》/.exec(summary)?.[1];
    output.set(ids[0][0], { title, summary: summary.length > 320 ? summary.slice(0, 320) + '…' : summary,
      summaryRevision: page.lastrevid });
  }
  return output;
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
type FilmHit = {
  imdbId: string;
  mediaType: 'movie' | 'series' | 'auto';
  result: OnlineSearchResult;
};

async function discoverFilmTitles(query: string, options: ImdbClientOptions): Promise<FilmHit[]> {
  const catalog = async (kind: 'movie' | 'series') => {
    const raw = await fetchJsonCached<Record<string, unknown>>(
      `https://v3-cinemeta.strem.io/catalog/${kind}/top/search=${encodeURIComponent(query)}.json`,
      { ...options, timeoutMs: 3000 }
    );
    return parseCinemetaSearchPayload(raw, kind);
  };
  const suggested = fetchImdbSuggestRaw(query, 'titles', options)
    .then(raw => parseImdbSuggestPayload(raw).titles);
  // Keep source order deterministic even when one catalog is slow or unavailable.
  const batches = await Promise.all([suggested, catalog('movie'), catalog('series')]
    .map(request => waitWithGrace(request, 3100, [])));
  return batches.flat();
}

async function searchFilmTitles(query: string, options: ImdbClientOptions): Promise<ImdbSearchBundle> {
  const indexed = searchFilmIndex(query);
  const direct = parseImdbUrlOrId(query);
  const byId = new Map<string, FilmHit>();
  const register = (hit: FilmHit) => {
    if (!byId.has(hit.imdbId)) byId.set(hit.imdbId, hit);
  };
  const localLabel = (item: OnlineSearchResult, label?: string) => localizeFilm(
    label && hasCjkCharacters(label) && item.title !== label
      ? { ...item, title: label, originalTitle: item.originalTitle || item.title }
      : item
  );
  const lookup = indexed[0]?.title === query ? indexed[0].originalTitle || query : query;
  const douban = runDoubanAssistSafe(query, 'film', options, 2800);
  const wiki = direct ? Promise.resolve(undefined) : resolveWikidataImdbBridge(query, options);
  const [hits, dbHits, bridge] = await Promise.all([
    direct ? Promise.resolve([]) : discoverFilmTitles(lookup, options),
    douban,
    waitWithGrace(wiki, 3100, undefined),
  ]);

  hits.forEach(register);
  for (const item of indexed) {
    register({ imdbId: item.externalId.slice(5), mediaType: 'auto', result: item });
  }
  if (!direct) {
    for (const id of bridge?.titleIds || []) {
      const title = bridge?.enNameMap.get(id) || bridge?.zhTitleMap.get(id);
      if (title) register({ imdbId: id, mediaType: 'auto', result: {
        externalId: 'imdb-' + id, category: 'film', title, tags: [], summary: '',
        sourceName: 'IMDb', sourceUrl: 'https://www.imdb.com/title/' + id + '/',
      } });
    }
  }
  // A Chinese catalog entry may supply the original spelling for IMDb discovery.
  // The spelling retrieves candidates. It never establishes a cross-source identity.
  if (!direct && !byId.size && hasCjkCharacters(query)) {
    const alias = dbHits.find(item => item.originalTitle && !hasCjkCharacters(item.originalTitle))?.originalTitle;
    if (alias) (await discoverFilmTitles(alias, options)).forEach(register);
  }
  if (direct && !byId.has(direct.id)) {
    const found = await waitWithGrace(fetchImdbSuggestRaw(direct.id, 'titles', options), 2000, null);
    parseImdbSuggestPayload(found).titles.filter(hit => hit.imdbId === direct.id).forEach(register);
  }

  const candidates = [...byId.values()].map(hit => localLabel(hit.result, bridge?.zhTitleMap.get(hit.imdbId)));
  const ranked = rankImdbResults(candidates, query).slice(0, 12);
  const details = new Map<string, OnlineSearchResult>();
  const ids = ranked.slice(0, 6).map(item => item.externalId.slice(5));
  if (direct && !ids.length) ids.push(direct.id);
  const hydrate = Promise.all(ids.map(async id => {
    const meta = await fetchCinemetaTitleMeta(id, byId.get(id)?.mediaType || 'auto', options);
    if (meta?.imdbId === id) details.set(id, meta.result);
  }));
  const unknown = ranked.filter(item => !hasCjkCharacters(item.summary) || !hasCjkCharacters(item.title) || dbHits.length > 0).map(item => item.externalId.slice(5));
  if (direct && !ranked.length) unknown.push(direct.id);
  const [labels] = await Promise.all([
    waitWithGrace(resolveWikidataByImdbIds(unknown, options, true), 2400, undefined),
    waitWithGrace(hydrate, 2400, undefined),
  ]);
  if (direct && !ranked.length && details.has(direct.id)) ranked.push(details.get(direct.id)!);
  const profiles = labels?.pages.size ? await fetchLinkedFilmProfiles(labels.pages, options) : undefined;
  if (direct && !ranked.length) {
    const profile = profiles?.get(direct.id);
    const title = profile?.title || labels?.zhTitleMap.get(direct.id);
    if (title) ranked.push({ category: 'film', externalId: 'imdb-' + direct.id, title, tags: [], summary: '',
      sourceName: 'IMDb · 中文资料', sourceUrl: 'https://www.imdb.com/title/' + direct.id + '/' });
  }
  let usedDouban = false;
  const results = ranked.map(candidate => {
    const id = candidate.externalId.slice(5);
    const item = details.get(id) || candidate;
    const dbId = labels?.crossIdMap.get(id) || bridge?.crossIdMap.get(id);
    const db = dbId ? dbHits.find(hit => hit.externalId === 'douban-subj-' + dbId) : undefined;
    const crossIdMap = db && dbId ? new Map([[id, dbId]]) : undefined;
    if (db) usedDouban = true;
    const enriched = db ? mergeImdbWithDoubanAssist([item], [db], { crossIdMap })[0] : item;
    const profile = profiles?.get(id);
    const localized = localLabel(enriched, profile?.title || labels?.zhTitleMap.get(id) || bridge?.zhTitleMap.get(id));
    return profile && !hasCjkCharacters(localized.summary)
      ? { ...localized, summary: profile.summary, summaryRevision: profile.summaryRevision } : localized;
  });
  if (!direct && !results.length && dbHits.length) {
    results.push(...dbHits.slice(0, 12));
    usedDouban = true;
  }
  return {
    results: rankImdbResults(results, query),
    hasDoubanAssist: usedDouban,
    hasChineseAssist: results.some(item => hasCjkCharacters(item.title)),
  };
}

export async function searchImdbMedia(
  query: string,
  category: ArchiveCategory,
  options: ImdbClientOptions
): Promise<ImdbSearchBundle> {
  const trimmed = query.trim();
  if (trimmed && category === 'film' && !parseDoubanUrlOrId(trimmed) && parseImdbUrlOrId(trimmed)?.kind !== 'name') {
    return searchFilmTitles(trimmed, options);
  }
  return searchLiveMedia(trimmed, category, options);
}

async function searchLiveMedia(
  query: string, category: ArchiveCategory, options: ImdbClientOptions
): Promise<ImdbSearchBundle> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], hasDoubanAssist: false };

  const doubanGraceMs = options.mode === 'server' ? 4500 : 5200;

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

      // Fetch Douban + Bangumi Chinese assist + Wikidata exact P345/zh-title in parallel!
      const [doubanHits, bgmHits, wdById] = await Promise.all([
        runDoubanAssistSafe(
          baseResult.title,
          'film',
          options,
          Math.max(doubanGraceMs, 3500)
        ),
        fetchBangumiChineseAssist(baseResult.title, 'film', options).catch(() => []),
        resolveWikidataByImdbIds([directImdb.id], options).catch(() => ({
          zhTitleMap: new Map<string, string>(),
          crossIdMap: new Map<string, string>(),
        })),
      ]);
      const merged = mergeImdbWithDoubanAssist([baseResult], doubanHits, {
        crossIdMap: wdById.crossIdMap,
        zhTitleMap: wdById.zhTitleMap,
        secondaryZhItems: bgmHits,
        fallbackThreshold: 0,
        query: baseResult.title,
      });
      return {
        results: merged,
        hasDoubanAssist: merged.some((r) => r.sourceName === 'IMDb · 豆瓣辅助'),
        hasChineseAssist: merged.some(
          (r) => r.sourceName === 'IMDb · 中文资料' || hasCjkCharacters(r.title)
        ),
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
      const hits = await discoverFilmTitles(lead.originalTitle || lead.title, options);
      const { crossIdMap } = await resolveWikidataByImdbIds(hits.map(hit => hit.imdbId), options);
      const match = hits.find(hit => crossIdMap.get(hit.imdbId) === directDouban.id);
      if (match) {
        const meta = await fetchCinemetaTitleMeta(match.imdbId, match.mediaType, options);
        const results = mergeImdbWithDoubanAssist([meta?.result || match.result], [lead], { crossIdMap });
        return { results: results.map(localizeFilm), hasDoubanAssist: true };
      }
      return { results: dbHits, hasDoubanAssist: true };
    }
    return { results: dbHits, hasDoubanAssist: dbHits.length > 0 };
  }

  if (category === 'film') return { results: [], hasDoubanAssist: false };

  // 2. PERSON SEARCH (IMDb nm... via Suggest + Wikidata P345 Bridge + Douban Chinese Bio Assist)
  if (category === 'person') {
    const doubanPromise =
      options.enableDoubanAssist !== false && options.doubanOptions
        ? searchDoubanMedia(trimmed, 'person', {
            ...options.doubanOptions,
            signal: options.signal,
          }).catch(() => [])
        : Promise.resolve([] as OnlineSearchResult[]);

    const baikePersonPromise = !hasCjkCharacters(trimmed)
      ? fetchBaikePerson(trimmed, options).catch(
          () => [] as OnlineSearchResult[]
        )
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

    // Wait for Douban & Baidu Baike celebrity assists (gives Chinese name, bio, roles, AND English fallback!)
    const [doubanHits, baikePersonHits] = await Promise.all([
      waitWithGrace(
        doubanPromise,
        imdbPeople.length > 0 ? doubanGraceMs : 5500,
        []
      ),
      waitWithGrace(baikePersonPromise, 1800, []),
    ]);

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
      secondaryZhItems: baikePersonHits,
      fallbackThreshold: 3,
      query: trimmed,
    });

    // Multi-layer fallback for top unmatched English person results (Wikidata P345 + Baike + Douban)
    const unmatchedPeople = fused
      .slice(0, 3)
      .filter((item) => !hasCjkCharacters(item.title))
      .slice(0, 2);

    if (unmatchedPeople.length > 0 && !options.signal?.aborted) {
      const normalizedQuery = normalizeEntityKey(trimmed);
      const unmatchedNmIds = unmatchedPeople
        .map(
          (item) =>
            extractImdbIdFromExternalId(item.externalId) ||
            extractImdbIdFromUrl(item.sourceUrl)
        )
        .filter((id): id is string => Boolean(id));
      const extraDoubanTargets =
        options.enableDoubanAssist !== false && options.doubanOptions
          ? unmatchedPeople.filter(
              (item) =>
                item.sourceName === 'IMDb' &&
                normalizeEntityKey(item.title) !== normalizedQuery
            )
          : [];

      const [wdById, extraBaikeArrays, extraDoubanArrays] = await Promise.all([
        unmatchedNmIds.length > 0
          ? resolveWikidataByImdbIds(unmatchedNmIds, options).catch(() => ({
              zhTitleMap: new Map<string, string>(),
              crossIdMap: new Map<string, string>(),
            }))
          : Promise.resolve({
              zhTitleMap: new Map<string, string>(),
              crossIdMap: new Map<string, string>(),
            }),
        Promise.all(
          unmatchedPeople
            .filter((p) => normalizeEntityKey(p.title) !== normalizedQuery)
            .slice(0, 1)
            .map((p) =>
              fetchBaikePerson(p.title, options).catch(
                () => [] as OnlineSearchResult[]
              )
            )
        ),
        extraDoubanTargets.length > 0
          ? Promise.all(
              extraDoubanTargets.map((item) =>
                runDoubanAssistSafe(item.title, 'person', options, 2400)
              )
            )
          : Promise.resolve([] as OnlineSearchResult[][]),
      ]);

      const mergedZhTitleMap = new Map(wdMap.zhTitleMap);
      wdById.zhTitleMap.forEach((v, k) => mergedZhTitleMap.set(k, v));
      const extraDouban = extraDoubanArrays.flat();
      const extraBaike = extraBaikeArrays.flat();

      if (
        extraDouban.length > 0 ||
        extraBaike.length > 0 ||
        wdById.zhTitleMap.size > 0
      ) {
        const enrichedSubset = mergeImdbWithDoubanAssist(
          unmatchedPeople,
          extraDouban,
          {
            zhTitleMap: mergedZhTitleMap,
            secondaryZhItems: extraBaike,
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

    return {
      results: fused.slice(0, 10),
      hasDoubanAssist: fused.some(
        (r) => r.sourceName === 'IMDb · 豆瓣辅助' || r.sourceName === '豆瓣辅助'
      ),
      hasChineseAssist: fused.some(
        (r) =>
          r.sourceName === 'IMDb · 豆瓣辅助' ||
          r.sourceName === '豆瓣辅助' ||
          r.sourceName === 'IMDb · 中文资料'
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
