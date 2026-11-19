import type { ArchiveCategory, OnlineSearchResult } from '../types/archive';
import type { CoverCandidate } from '../utils/coverPicker';
import {
  extractJsonFromJinaEnvelope,
  normalizeDoubanImageUrl,
  normalizeRelayBaseUrl,
  parseDoubanCelebrityDetail,
  parseDoubanCelebrityWorks,
  parseDoubanCredits,
  parseDoubanMovieSearch,
  parseDoubanPhotos,
  parseDoubanSubjectAbstract,
  parseDoubanSubjectDetail,
  parseDoubanSuggest,
  parseDoubanUrlOrId,
  parseWmdbMovieRecord,
  parseWmdbSearchPayload,
} from '../utils/doubanParsers';
import { normalizeEntityKey } from '../utils/wikiCast';

export interface DoubanClientOptions {
  /**
   * - 'server': calls Douban directly with Referer headers on Node/Express backend
   * - 'relay': routes through an optional custom Cloudflare Worker / Express relay
   * - 'static-direct': zero-config browser-direct mode for GitHub Pages / static mobile PWA
   */
  transport: 'server' | 'relay' | 'static-direct';
  /** Base URL of Cloudflare Worker or Express server when transport === 'relay' */
  relayBaseUrl?: string;
  signal?: AbortSignal;
}

const WX_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40',
  Referer: 'https://servicewechat.com/wx2f9b06c1de1ccfba/91/page-frame.html',
  Accept: 'application/json, text/plain, */*',
};

const WEB_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://movie.douban.com/',
  Accept: 'application/json, text/plain, */*',
};

// 15-minute TTL cache & in-flight deduplication to avoid hammering Douban
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 240;

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const jsonCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): T | undefined {
  const entry = jsonCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    jsonCache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function writeCache(key: string, value: unknown): void {
  if (jsonCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = jsonCache.keys().next().value;
    if (oldestKey !== undefined) {
      jsonCache.delete(oldestKey);
    }
  }
  jsonCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export function formatDoubanImageForTransport(
  rawUrl: string | null | undefined,
  options: DoubanClientOptions
): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (options.transport === 'server') {
    if (trimmed.startsWith('/api/img-proxy')) return trimmed;
    return `/api/img-proxy?url=${encodeURIComponent(trimmed)}`;
  }
  const relay = normalizeRelayBaseUrl(options.relayBaseUrl);
  if (relay) {
    return `${relay}/img?url=${encodeURIComponent(trimmed)}`;
  }
  // In zero-config static-direct mode, raw doubanio.com URLs return 418 anti-hotlink in browsers;
  // allow direct anti-hotlink-free CDNs (such as img.wmdb.tv) and omit raw doubanio.com URLs.
  if (options.transport === 'static-direct' && /doubanio\.com|douban\.com/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Zero-config CORS-open JSON bridge for pure static pages (GitHub Pages / mobile PWA)
 * using `https://r.jina.ai/<targetUrl>` with 15-minute caching & in-flight deduplication.
 */
async function fetchViaStaticBridgeJson<T>(
  targetUrl: string,
  options: DoubanClientOptions,
  timeoutMs = 7500
): Promise<T | null> {
  const cacheKey = `static-direct:${targetUrl}`;
  const cached = readCache<T>(cacheKey);
  if (cached !== undefined) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return (await existing) as T | null;

  const task = (async (): Promise<T | null> => {
    const controller = new AbortController();
    const ext = options.signal;
    const onAbort = () => controller.abort();
    if (ext) {
      if (ext.aborted) return null;
      ext.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://r.jina.ai/${targetUrl}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const envelope = (await res.json()) as unknown;
      const extracted = extractJsonFromJinaEnvelope(envelope) as T | null;
      if (extracted !== null) {
        writeCache(cacheKey, extracted);
      }
      return extracted;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      if (ext) ext.removeEventListener('abort', onAbort);
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, task);
  return task;
}

async function fetchStaticSubjectMerged(
  id: string,
  options: DoubanClientOptions
): Promise<{ result: OnlineSearchResult; people: OnlineSearchResult[] } | null> {
  const [wmdbRaw, absRaw] = await Promise.all([
    fetchViaStaticBridgeJson<Record<string, any>>(
      `https://api.wmdb.tv/movie/api?id=${encodeURIComponent(id)}`,
      options,
      6500
    ),
    fetchViaStaticBridgeJson<Record<string, any>>(
      `https://movie.douban.com/j/subject_abstract?subject_id=${encodeURIComponent(id)}`,
      options,
      6500
    ),
  ]);

  const wmdb = parseWmdbMovieRecord(wmdbRaw);
  const abs = parseDoubanSubjectAbstract(absRaw);
  if (!wmdb && !abs) return null;

  if (wmdb && abs) {
    const hasRatingInWmdb = /豆瓣\s*\d/.test(wmdb.result.subtitle || '');
    return {
      result: {
        ...wmdb.result,
        subtitle: hasRatingInWmdb ? wmdb.result.subtitle : abs.result.subtitle,
        year: wmdb.result.year || abs.result.year,
        region: wmdb.result.region || abs.result.region,
        tags:
          wmdb.result.tags && wmdb.result.tags.length > 0
            ? wmdb.result.tags
            : abs.result.tags,
      },
      people: wmdb.people.length >= abs.people.length ? wmdb.people : abs.people,
    };
  }
  return wmdb || abs;
}

async function searchDoubanStaticDirect(
  trimmed: string,
  category: ArchiveCategory,
  options: DoubanClientOptions
): Promise<OnlineSearchResult[]> {
  // 0. Direct Douban URL / ID paste
  const directRef = parseDoubanUrlOrId(trimmed);
  if (directRef) {
    if (directRef.kind === 'subject') {
      const merged = await fetchStaticSubjectMerged(directRef.id, options);
      if (merged) {
        return category === 'person' ? merged.people.slice(0, 10) : [merged.result];
      }
    }
  }

  // 1. Film & TV Search: parallel WMDB (Douban-indexed + direct img.wmdb.tv posters) + Douban Suggest
  if (category === 'film') {
    const [wmdbRaw, suggestRaw] = await Promise.all([
      fetchViaStaticBridgeJson<Record<string, any>>(
        `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(trimmed)}`,
        options,
        7000
      ),
      fetchViaStaticBridgeJson<unknown>(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(trimmed)}`,
        options,
        6500
      ),
    ]);

    const wmdbEntries = parseWmdbSearchPayload(wmdbRaw);
    const suggestParsed = parseDoubanSuggest(suggestRaw, () => undefined);

    const byId = new Map<string, OnlineSearchResult>();
    const order: string[] = [];

    const pushItem = (item: OnlineSearchResult) => {
      const existing = byId.get(item.externalId);
      if (!existing) {
        byId.set(item.externalId, item);
        order.push(item.externalId);
      } else {
        byId.set(item.externalId, {
          ...existing,
          originalTitle: existing.originalTitle || item.originalTitle,
          year: existing.year || item.year,
          coverUrl: existing.coverUrl || item.coverUrl,
          subtitle:
            /豆瓣\s*\d/.test(existing.subtitle || '')
              ? existing.subtitle
              : item.subtitle || existing.subtitle,
        });
      }
    };

    for (const entry of wmdbEntries) {
      pushItem(entry.result);
    }
    for (const sm of suggestParsed.movies) {
      pushItem(sm);
    }

    const merged = order.map((k) => byId.get(k)!).filter(Boolean);
    if (merged.length === 0) return [];

    // Hydrate up to top 2 hits missing live Douban score or poster via subject_abstract / wmdb-by-id
    const needHydrate = merged
      .slice(0, 2)
      .filter(
        (m) =>
          !/豆瓣\s*\d/.test(m.subtitle || '') || !m.coverUrl
      );

    if (needHydrate.length > 0) {
      const hydrated = await Promise.all(
        needHydrate.map(async (item) => {
          const sid = extractSubjectIdFromUrl(item.sourceUrl);
          if (!sid) return null;
          const rich = await fetchStaticSubjectMerged(sid, options);
          return rich ? { externalId: item.externalId, rich: rich.result } : null;
        })
      );
      const richMap = new Map<string, OnlineSearchResult>();
      for (const h of hydrated) {
        if (h) richMap.set(h.externalId, h.rich);
      }
      return merged.slice(0, 12).map((item) => {
        const rich = richMap.get(item.externalId);
        if (!rich) return item;
        return {
          ...item,
          subtitle: /豆瓣\s*\d/.test(rich.subtitle || '')
            ? rich.subtitle
            : item.subtitle || rich.subtitle,
          year: item.year || rich.year,
          region: item.region || rich.region,
          coverUrl: item.coverUrl || rich.coverUrl,
          summary:
            item.summary && item.summary.length > 35
              ? item.summary
              : rich.summary || item.summary,
          tags:
            item.tags && item.tags.length > 0 ? item.tags : rich.tags,
        };
      });
    }

    return merged.slice(0, 12);
  }

  // 2. Person Search via Douban Suggest celebrity hits + WMDB director/actor fallback
  if (category === 'person') {
    const [suggestRaw, wmdbRaw] = await Promise.all([
      fetchViaStaticBridgeJson<unknown>(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(trimmed)}`,
        options,
        6500
      ),
      fetchViaStaticBridgeJson<Record<string, any>>(
        `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(trimmed)}`,
        options,
        6500
      ),
    ]);

    const suggestParsed = parseDoubanSuggest(suggestRaw, () => undefined);
    const out: OnlineSearchResult[] = [...suggestParsed.celebrities];
    const seen = new Set(out.map((p) => normalizeEntityKey(p.title)));

    if (out.length === 0) {
      const entries = parseWmdbSearchPayload(wmdbRaw);
      for (const entry of entries) {
        for (const p of entry.people) {
          if (!matchesPersonName(p.title, p.originalTitle, trimmed)) continue;
          const key = normalizeEntityKey(p.title);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(p);
          if (out.length >= 4) break;
        }
        if (out.length >= 4) break;
      }
    }
    return out.slice(0, 6);
  }

  // 3. Character Search: resolve matched movie/TV via WMDB + Douban suggest for cast/work context
  const wmdbRaw = await fetchViaStaticBridgeJson<Record<string, any>>(
    `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(trimmed)}`,
    options,
    6500
  );
  const entries = parseWmdbSearchPayload(wmdbRaw);
  if (entries.length === 0) return [];
  const lead = entries[0];
  const actorNames = lead.people
    .filter((p) => p.subtitle === '主演')
    .map((p) => p.title)
    .slice(0, 3);
  return [
    {
      externalId: `douban-static-char-${trimmed}-${lead.result.externalId}`,
      category: 'character',
      title: trimmed,
      subtitle: actorNames[0]
        ? `出自《${lead.result.title}》 · ${actorNames[0]} 等主演`
        : `出自《${lead.result.title}》`,
      year: lead.result.year,
      coverUrl: lead.result.coverUrl,
      summary: `出自豆瓣条目《${lead.result.title}》${lead.result.year ? `（${lead.result.year}）` : ''}。${lead.result.summary}`,
      relatedWorkTitle: lead.result.title,
      portrayedBy: actorNames[0],
      sourceName: '豆瓣影视',
      sourceUrl: lead.result.sourceUrl,
      tags: ['影视角色', lead.result.title],
    },
  ];
}

async function fetchDoubanJson<T>(
  rawUrl: string,
  kind: 'rexxar' | 'web',
  options: DoubanClientOptions,
  timeoutMs = 5500
): Promise<T | null> {
  const relay =
    options.transport === 'relay'
      ? normalizeRelayBaseUrl(options.relayBaseUrl)
      : '';
  if (options.transport === 'relay' && !relay) {
    return null;
  }

  const cacheKey = `${options.transport}:${relay}:${rawUrl}`;
  const cached = readCache<T>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const existing = inFlight.get(cacheKey);
  if (existing) {
    return (await existing) as T | null;
  }

  const requestUrl =
    options.transport === 'relay'
      ? `${relay}/douban?url=${encodeURIComponent(rawUrl)}`
      : rawUrl;

  const task = (async (): Promise<T | null> => {
    const controller = new AbortController();
    const ext = options.signal;
    const onAbort = () => controller.abort();
    if (ext) {
      if (ext.aborted) return null;
      ext.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = {
        signal: controller.signal,
        ...(options.transport === 'server'
          ? { headers: kind === 'rexxar' ? WX_HEADERS : WEB_HEADERS }
          : {}),
      };
      const res = await fetch(requestUrl, init);
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) return null;
      const parsed = JSON.parse(text) as T;
      writeCache(cacheKey, parsed);
      return parsed;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      if (ext) {
        ext.removeEventListener('abort', onAbort);
      }
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, task);
  return task;
}

function extractSubjectIdFromUrl(sourceUrl?: string): string | null {
  if (!sourceUrl) return null;
  const m = /douban\.com\/(?:movie\/|tv\/)?subject\/(\d{5,12})/i.exec(
    sourceUrl
  );
  return m ? m[1] : null;
}

function extractCelebrityIdFromUrl(sourceUrl?: string): string | null {
  if (!sourceUrl) return null;
  const m = /douban\.com\/(?:celebrity|personage)\/(\d{5,12})/i.exec(sourceUrl);
  return m ? m[1] : null;
}

function matchesPersonName(
  candidateName: string,
  candidateLatin: string | undefined,
  query: string
): boolean {
  const nq = normalizeEntityKey(query);
  if (!nq) return false;
  const nn = normalizeEntityKey(candidateName);
  const nl = candidateLatin ? normalizeEntityKey(candidateLatin) : '';
  if (nn === nq || nl === nq) return true;
  if (nq.length >= 2 && (nn.includes(nq) || nq.includes(nn))) return true;
  if (nl && nq.length >= 3 && (nl.includes(nq) || nq.includes(nl))) return true;
  return false;
}

async function fetchSubjectDetail(
  id: string,
  options: DoubanClientOptions
): Promise<OnlineSearchResult | null> {
  const detail = await fetchDoubanJson<Record<string, any>>(
    `https://m.douban.com/rexxar/api/v2/movie/${encodeURIComponent(id)}`,
    'rexxar',
    options,
    4500
  );
  return parseDoubanSubjectDetail(detail, (u) =>
    formatDoubanImageForTransport(u, options)
  );
}

async function fetchCelebrityDetail(
  id: string,
  options: DoubanClientOptions
): Promise<OnlineSearchResult | null> {
  const detail = await fetchDoubanJson<Record<string, any>>(
    `https://m.douban.com/rexxar/api/v2/celebrity/${encodeURIComponent(id)}`,
    'rexxar',
    options,
    4500
  );
  return parseDoubanCelebrityDetail(detail, id, (u) =>
    formatDoubanImageForTransport(u, options)
  );
}

/**
 * Resolves a Douban movie/TV subject ID for a given title.
 */
async function resolveDoubanSubjectId(
  title: string,
  originalTitle: string | undefined,
  sourceUrl: string | undefined,
  options: DoubanClientOptions
): Promise<string | null> {
  const fromUrl = extractSubjectIdFromUrl(sourceUrl);
  if (fromUrl) return fromUrl;

  const queries = [title, originalTitle].filter(
    (s): s is string => Boolean(s && s.trim())
  );
  const targetKey = normalizeEntityKey(title);
  const origKey = originalTitle ? normalizeEntityKey(originalTitle) : '';

  for (const q of queries) {
    const data = await fetchDoubanJson<Record<string, any>>(
      `https://m.douban.com/rexxar/api/v2/search/movie?q=${encodeURIComponent(
        q.trim()
      )}&count=6`,
      'rexxar',
      options,
      4500
    );
    const parsed = parseDoubanMovieSearch(data);
    if (parsed.length === 0) continue;

    const exact = parsed.find((item) => {
      const k = normalizeEntityKey(item.title);
      return k === targetKey || (origKey && k === origKey);
    });
    const pick = exact || parsed[0];
    const id = extractSubjectIdFromUrl(pick.sourceUrl);
    if (id) return id;
  }

  return null;
}

/**
 * Two-stage Douban celebrity resolver:
 * 1. `movie.douban.com/j/subject_suggest` (fast direct celebrity hits)
 * 2. Fallback: `rexxar/api/v2/search/movie` -> top 2 movies' `/credits` -> exact person match!
 *    This guarantees celebrity lookup ALWAYS works even when `subject_suggest` throttles.
 */
async function resolveDoubanCelebrities(
  query: string,
  options: DoubanClientOptions,
  maxHits = 4
): Promise<Array<{ id: string; fallbackItem?: OnlineSearchResult }>> {
  const formatImg = (u?: string | null) =>
    formatDoubanImageForTransport(u, options);

  const [suggestRaw, movieSearchRaw] = await Promise.all([
    fetchDoubanJson<unknown>(
      `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(
        query.trim()
      )}`,
      'web',
      options,
      3200
    ),
    fetchDoubanJson<Record<string, any>>(
      `https://m.douban.com/rexxar/api/v2/search/movie?q=${encodeURIComponent(
        query.trim()
      )}&count=5`,
      'rexxar',
      options,
      4500
    ),
  ]);

  const hits: Array<{ id: string; fallbackItem?: OnlineSearchResult }> = [];
  const seenIds = new Set<string>();

  const suggestParsed = parseDoubanSuggest(suggestRaw, formatImg);
  for (const celeb of suggestParsed.celebrities) {
    const cid = extractCelebrityIdFromUrl(celeb.sourceUrl);
    if (cid && !seenIds.has(cid)) {
      seenIds.add(cid);
      hits.push({ id: cid, fallbackItem: celeb });
    }
  }

  // Stage 2: Extract matching celebrities from the credits of top matched movies
  if (hits.length < maxHits) {
    const movies = parseDoubanMovieSearch(movieSearchRaw, formatImg);
    const candidateMovies = movies.slice(0, 3);
    const creditsList = await Promise.all(
      candidateMovies.map(async (m) => {
        const sid = extractSubjectIdFromUrl(m.sourceUrl);
        if (!sid) return null;
        const cData = await fetchDoubanJson<Record<string, any>>(
          `https://m.douban.com/rexxar/api/v2/movie/${sid}/credits`,
          'rexxar',
          options,
          4200
        );
        return { movie: m, credits: cData };
      })
    );

    for (const block of creditsList) {
      if (!block?.credits) continue;
      const parsed = parseDoubanCredits(
        block.credits,
        block.movie.title,
        block.movie.sourceUrl,
        formatImg
      );
      for (const person of parsed.people) {
        if (!matchesPersonName(person.title, person.originalTitle, query)) {
          continue;
        }
        const cid = extractCelebrityIdFromUrl(person.sourceUrl);
        if (cid && !seenIds.has(cid)) {
          seenIds.add(cid);
          hits.push({ id: cid, fallbackItem: person });
          if (hits.length >= maxHits) break;
        }
      }
      if (hits.length >= maxHits) break;
    }
  }

  return hits.slice(0, maxHits);
}

/**
 * Unified Douban Search across Film/TV, Person (Celebrity), Character, AND Direct Douban URLs.
 */
export async function searchDoubanMedia(
  query: string,
  category: ArchiveCategory,
  options: DoubanClientOptions
): Promise<OnlineSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (options.transport === 'static-direct') {
    return searchDoubanStaticDirect(trimmed, category, options);
  }

  const formatImg = (u?: string | null) =>
    formatDoubanImageForTransport(u, options);

  // 0. Direct Douban URL / ID paste support!
  const directRef = parseDoubanUrlOrId(trimmed);
  if (directRef) {
    if (directRef.kind === 'subject') {
      const detail = await fetchSubjectDetail(directRef.id, options);
      if (detail) {
        if (category === 'character') {
          const credits = await fetchDoubanJson<Record<string, any>>(
            `https://m.douban.com/rexxar/api/v2/movie/${directRef.id}/credits`,
            'rexxar',
            options,
            4500
          );
          const parsed = parseDoubanCredits(
            credits,
            detail.title,
            detail.sourceUrl,
            formatImg
          );
          return parsed.characters.slice(0, 12);
        }
        return [detail];
      }
    } else if (directRef.kind === 'celebrity') {
      const celeb = await fetchCelebrityDetail(directRef.id, options);
      if (celeb) return [celeb];
    }
  }

  // 1. Film & TV Search
  if (category === 'film') {
    const [rexxarRaw, suggestRaw] = await Promise.all([
      fetchDoubanJson<Record<string, any>>(
        `https://m.douban.com/rexxar/api/v2/search/movie?q=${encodeURIComponent(
          trimmed
        )}&count=12`,
        'rexxar',
        options,
        5200
      ),
      fetchDoubanJson<unknown>(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(
          trimmed
        )}`,
        'web',
        options,
        2800
      ),
    ]);

    const rexxarItems = parseDoubanMovieSearch(rexxarRaw, formatImg);
    const suggestParsed = parseDoubanSuggest(suggestRaw, formatImg);

    // Build lookup from suggest for instant originalTitle / year enrichment
    const suggestById = new Map<string, OnlineSearchResult>();
    for (const sm of suggestParsed.movies) {
      suggestById.set(sm.externalId, sm);
    }

    const merged: OnlineSearchResult[] = [];
    const seen = new Set<string>();

    for (const item of rexxarItems) {
      seen.add(item.externalId);
      const sug = suggestById.get(item.externalId);
      merged.push({
        ...item,
        originalTitle: item.originalTitle || sug?.originalTitle,
        year: item.year || sug?.year,
        coverUrl: item.coverUrl || sug?.coverUrl,
      });
    }

    for (const sm of suggestParsed.movies) {
      if (!seen.has(sm.externalId)) {
        seen.add(sm.externalId);
        merged.push(sm);
      }
    }

    if (merged.length === 0) return [];

    // Hydrate top 3 hits in parallel for full Chinese plot synopsis, exact year, genres & directors
    const topIds = merged
      .slice(0, 3)
      .map((m) => extractSubjectIdFromUrl(m.sourceUrl))
      .filter((id): id is string => Boolean(id));

    const hydrated = await Promise.all(
      topIds.map((id) => fetchSubjectDetail(id, options))
    );
    const hydratedById = new Map<string, OnlineSearchResult>();
    for (const h of hydrated) {
      if (h) hydratedById.set(h.externalId, h);
    }

    return merged.slice(0, 12).map((item) => {
      const rich = hydratedById.get(item.externalId);
      if (!rich) return item;
      return {
        ...item,
        ...rich,
        coverUrl: rich.coverUrl || item.coverUrl,
        originalTitle: rich.originalTitle || item.originalTitle,
      };
    });
  }

  // 2. Person / Celebrity Search
  if (category === 'person') {
    const celebHits = await resolveDoubanCelebrities(trimmed, options, 4);
    if (celebHits.length === 0) return [];

    const hydrated = await Promise.all(
      celebHits.map(async (hit) => {
        const detail = await fetchCelebrityDetail(hit.id, options);
        if (detail) {
          return {
            ...detail,
            coverUrl: detail.coverUrl || hit.fallbackItem?.coverUrl,
            originalTitle:
              detail.originalTitle || hit.fallbackItem?.originalTitle,
          };
        }
        return hit.fallbackItem || null;
      })
    );

    return hydrated.filter((x): x is OnlineSearchResult => Boolean(x));
  }

  // 3. Character Search via Douban Movie/TV Credits
  const movieRaw = await fetchDoubanJson<Record<string, any>>(
    `https://m.douban.com/rexxar/api/v2/search/movie?q=${encodeURIComponent(
      trimmed
    )}&count=5`,
    'rexxar',
    options,
    5000
  );
  const movies = parseDoubanMovieSearch(movieRaw, formatImg).slice(0, 3);
  if (movies.length === 0) return [];

  const creditBundles = await Promise.all(
    movies.map(async (movie) => {
      const sid = extractSubjectIdFromUrl(movie.sourceUrl);
      if (!sid) return [];
      const credits = await fetchDoubanJson<Record<string, any>>(
        `https://m.douban.com/rexxar/api/v2/movie/${sid}/credits`,
        'rexxar',
        options,
        4500
      );
      const parsed = parseDoubanCredits(
        credits,
        movie.title,
        movie.sourceUrl,
        formatImg
      );
      return parsed.characters.map((ch) => ({
        ...ch,
        year: movie.year,
      }));
    })
  );

  const allChars = creditBundles.flat();
  const nq = normalizeEntityKey(trimmed);

  // Rank exact/partial character name matches first, then lead cast of the matched show
  const scored = allChars.map((ch, idx) => {
    const nc = normalizeEntityKey(ch.title);
    let score = 0;
    if (nc === nq) score = 100;
    else if (nc.includes(nq) || nq.includes(nc)) score = 70;
    else if (
      ch.relatedWorkTitle &&
      normalizeEntityKey(ch.relatedWorkTitle).includes(nq)
    ) {
      score = 30;
    }
    return { ch, score, idx };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

  const seenCharKeys = new Set<string>();
  const out: OnlineSearchResult[] = [];
  for (const row of scored) {
    const key = `${normalizeEntityKey(row.ch.title)}::${normalizeEntityKey(
      row.ch.relatedWorkTitle || ''
    )}`;
    if (seenCharKeys.has(key)) continue;
    seenCharKeys.add(key);
    out.push(row.ch);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * Fetches Film -> Cast/Crew + Characters directly from Douban `/credits`.
 */
export async function fetchDoubanFilmRelations(
  title: string,
  originalTitle: string | undefined,
  sourceUrl: string | undefined,
  options: DoubanClientOptions
): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { people: [], characters: [] };

  if (options.transport === 'static-direct') {
    let sid = extractSubjectIdFromUrl(sourceUrl);
    if (!sid) {
      const wmdbRaw = await fetchViaStaticBridgeJson<Record<string, any>>(
        `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(title.trim())}`,
        options,
        6500
      );
      const entries = parseWmdbSearchPayload(wmdbRaw);
      const exact =
        entries.find(
          (e) => normalizeEntityKey(e.result.title) === normalizeEntityKey(title)
        ) || entries[0];
      if (exact) {
        if (exact.people.length > 0) {
          return { people: exact.people, characters: [] };
        }
        sid = extractSubjectIdFromUrl(exact.result.sourceUrl);
      }
    }
    if (!sid) return empty;
    const merged = await fetchStaticSubjectMerged(sid, options);
    return merged ? { people: merged.people, characters: [] } : empty;
  }

  const subjectId = await resolveDoubanSubjectId(
    title,
    originalTitle,
    sourceUrl,
    options
  );
  if (!subjectId) return empty;

  const credits = await fetchDoubanJson<Record<string, any>>(
    `https://m.douban.com/rexxar/api/v2/movie/${subjectId}/credits`,
    'rexxar',
    options,
    5000
  );
  if (!credits) return empty;

  return parseDoubanCredits(
    credits,
    title,
    `https://movie.douban.com/subject/${subjectId}/`,
    (u) => formatDoubanImageForTransport(u, options)
  );
}

/**
 * Fetches Person -> Filmography + Played Characters directly from Douban `/celebrity/{id}/works`.
 */
export async function fetchDoubanPersonRelations(
  title: string,
  originalTitle: string | undefined,
  sourceUrl: string | undefined,
  options: DoubanClientOptions
): Promise<{ films: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { films: [], characters: [] };
  if (options.transport === 'static-direct') {
    const wmdbRaw = await fetchViaStaticBridgeJson<Record<string, any>>(
      `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(title.trim())}`,
      options,
      6500
    );
    const entries = parseWmdbSearchPayload(wmdbRaw);
    const matched = entries
      .filter((e) =>
        e.people.some((p) => matchesPersonName(p.title, p.originalTitle, title))
      )
      .map((e) => e.result);
    return { films: matched.slice(0, 12), characters: [] };
  }

  let celebId = extractCelebrityIdFromUrl(sourceUrl);

  if (!celebId) {
    const hits = await resolveDoubanCelebrities(title, options, 2);
    celebId = hits[0]?.id || null;
  }
  if (!celebId && originalTitle) {
    const hits = await resolveDoubanCelebrities(originalTitle, options, 2);
    celebId = hits[0]?.id || null;
  }
  if (!celebId) return empty;

  const worksPayload = await fetchDoubanJson<Record<string, any>>(
    `https://m.douban.com/rexxar/api/v2/celebrity/${celebId}/works?count=28`,
    'rexxar',
    options,
    5500
  );
  if (!worksPayload) return empty;

  return parseDoubanCelebrityWorks(worksPayload, title, (u) =>
    formatDoubanImageForTransport(u, options)
  );
}

/**
 * Fetches Douban high-res posters, stills, and celebrity portraits for the Cover Picker.
 */
export async function searchDoubanCoverCandidates(
  query: string,
  category: ArchiveCategory,
  originalTitle: string | undefined,
  options: DoubanClientOptions
): Promise<CoverCandidate[]> {
  if (options.transport === 'static-direct') {
    const wmdbRaw = await fetchViaStaticBridgeJson<Record<string, any>>(
      `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(query.trim())}`,
      options,
      6500
    );
    const entries = parseWmdbSearchPayload(wmdbRaw);
    const out: CoverCandidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < entries.length; i += 1) {
      const poster = entries[i].result.coverUrl;
      if (!poster || seen.has(poster)) continue;
      seen.add(poster);
      out.push({
        id: `douban-static-poster-${i}-${entries[i].result.externalId}`,
        url: poster,
        source: '豆瓣海报',
        caption: `${entries[i].result.title} · 豆瓣官方海报`,
      });
    }
    return out;
  }

  const formatImg = (u?: string | null) =>
    formatDoubanImageForTransport(u, options);

  if (category === 'person') {
    const hits = await resolveDoubanCelebrities(query, options, 2);
    const celebId = hits[0]?.id;
    if (!celebId) return [];

    const [detail, photosPayload] = await Promise.all([
      fetchDoubanJson<Record<string, any>>(
        `https://m.douban.com/rexxar/api/v2/celebrity/${celebId}`,
        'rexxar',
        options,
        4500
      ),
      fetchDoubanJson<Record<string, any>>(
        `https://m.douban.com/rexxar/api/v2/celebrity/${celebId}/photos?count=10`,
        'rexxar',
        options,
        4500
      ),
    ]);

    const out: CoverCandidate[] = [];
    const mainCover = normalizeDoubanImageUrl(
      detail?.cover?.large?.url || detail?.cover_img?.url,
      'avatar'
    );
    const formattedMain = formatImg(mainCover);
    if (formattedMain) {
      out.push({
        id: `douban-celeb-main-${celebId}`,
        url: formattedMain,
        source: '豆瓣影人',
        caption: `${query} · 豆瓣官方肖像`,
      });
    }
    out.push(...parseDoubanPhotos(photosPayload, query, formatImg));
    return out;
  }

  // Film or Character: fetch main poster + Douban movie/TV stills
  const subjectId = await resolveDoubanSubjectId(
    query,
    originalTitle,
    undefined,
    options
  );
  if (!subjectId) return [];

  const [detail, photosPayload] = await Promise.all([
    fetchDoubanJson<Record<string, any>>(
      `https://m.douban.com/rexxar/api/v2/movie/${subjectId}`,
      'rexxar',
      options,
      4500
    ),
    fetchDoubanJson<Record<string, any>>(
      `https://m.douban.com/rexxar/api/v2/movie/${subjectId}/photos?count=12`,
      'rexxar',
      options,
      4500
    ),
  ]);

  const out: CoverCandidate[] = [];
  const mainPoster = normalizeDoubanImageUrl(
    detail?.pic?.large || detail?.pic?.normal,
    'poster'
  );
  const formattedMain = formatImg(mainPoster);
  if (formattedMain) {
    out.push({
      id: `douban-poster-${subjectId}`,
      url: formattedMain,
      source: '豆瓣海报',
      caption: `${detail?.title || query} · 豆瓣官方海报`,
    });
  }
  out.push(
    ...parseDoubanPhotos(photosPayload, detail?.title || query, formatImg)
  );
  return out;
}
