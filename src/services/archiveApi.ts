import type {
  ArchiveCategory,
  CharacterProfile,
  OnlineSearchResult,
  SearchSourceOption,
} from '../types/archive';
import {
  cleanWikiExtract,
  parseBangumiCharacterInfobox,
  parseZhWikiCharacterInfobox,
} from '../utils/characterProfile';
import {
  parseBaiduBaikeCard,
  parseBangumiLegacySubjects,
  parseIqiyiSuggestData,
  parseMoegirlPages,
  settleSourcesWithFastWindow,
  stripBaikeHtml,
  upgradeToHttpsUrl,
  type NamedSourceTask,
  type ParsedBaikeBundle,
  type ParsedIqiyiBundle,
} from '../utils/chinaSearchParsers';
import {
  rankAndFilterCoverCandidates,
  type CoverCandidate,
} from '../utils/coverPicker';
import {
  detectInitialStaticHint,
  type RuntimeMode,
} from '../utils/runtimeEnv';
import {
  isAcceptablePhoto,
  parseZhWikiCastHtml,
} from '../utils/wikiCast';
import {
  aggregatePersonCharacters,
  parseZhWikiFilmographyHtml,
} from '../utils/wikiFilmography';
import { getConfiguredDoubanRelayUrl } from '../utils/doubanRelay';
import {
  DoubanBridgeError,
  fetchDoubanFilmRelations,
  fetchDoubanPersonRelations,
  searchDoubanCoverCandidates,
  searchDoubanMedia,
} from './doubanClient';
import {
  fetchImdbFilmRelations,
  fetchImdbPersonRelations,
  searchImdbCoverCandidates,
  searchImdbMedia,
} from './imdbClient';
import {
  extractYearNumber,
  hasStrictTitleOverlap,
  isRelevantFilmCrewRole,
  matchBangumiSubjectCandidate,
  yearsAreCompatible,
} from '../utils/relationMatching';
import {
  hasCjkChars,
  latinPersonNamesMatch,
  mergeBilingualResults,
} from '../utils/bilingualMerge';
import {
  loadPersistedRuntimeMode,
  savePersistedRuntimeMode,
} from '../utils/relationsCache';

export interface OnlineSearchResponse {
  results: OnlineSearchResult[];
  activeSources: string[];
  mode: RuntimeMode;
  error?: string;
}

export interface OnlineRelationsResponse {
  films: OnlineSearchResult[];
  people: OnlineSearchResult[];
  characters: OnlineSearchResult[];
  sources: string[];
}

export interface CharacterDossierResponse {
  profile: Partial<CharacterProfile>;
  sources: string[];
}

let cachedMode: RuntimeMode | null = null;
let softStaticUntil = 0;
let modeProbePromise: Promise<RuntimeMode> | null = null;

// Adaptive per-host slow/blocked tracking so GFW-blocked hosts do not stall
// repeated searches on Chinese mobile networks.
const SLOW_HOST_TTL_MS = 5 * 60 * 1000;
const slowHostUntil = new Map<string, number>();

function getHostKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getEffectiveTimeout(url: string, defaultMs: number): number {
  const host = getHostKey(url);
  if (!host) return defaultMs;
  const until = slowHostUntil.get(host);
  if (until && until > Date.now()) {
    return Math.min(defaultMs, 1800);
  }
  return defaultMs;
}

function markHostSlow(url: string): void {
  const host = getHostKey(url);
  if (host) {
    slowHostUntil.set(host, Date.now() + SLOW_HOST_TTL_MS);
  }
}

function markHostHealthy(url: string): void {
  const host = getHostKey(url);
  if (host) {
    slowHostUntil.delete(host);
  }
}

function getInitialSignals() {
  const envFlag =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_STATIC_MODE as string | boolean | undefined)
      : undefined;
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : '';
  return { staticEnvFlag: envFlag, search, hostname };
}

/**
 * Synchronous best-effort read of the current runtime mode (before or after probe).
 */
export function getRuntimeModeSync(): RuntimeMode {
  if (cachedMode) return cachedMode;
  if (detectInitialStaticHint(getInitialSignals())) {
    cachedMode = 'static';
    return 'static';
  }
  const remembered = loadPersistedRuntimeMode();
  if (remembered) {
    return remembered;
  }
  if (softStaticUntil > Date.now()) {
    return 'static';
  }
  return 'server';
}

/**
 * Probes whether the Express `/api/*` backend is available.
 * - On GitHub Pages (`*.github.io`, `VITE_STATIC_MODE=true`, or `?static=1`),
 *   resolves immediately to `'static'` without triggering a 404 request.
 * - Remembers confirmed origin mode in localStorage so subsequent PWA launches
 *   boot instantaneously without waiting on `/api/health`.
 */
export async function detectRuntimeMode(): Promise<RuntimeMode> {
  if (cachedMode) return cachedMode;
  if (detectInitialStaticHint(getInitialSignals())) {
    cachedMode = 'static';
    return 'static';
  }
  const remembered = loadPersistedRuntimeMode();
  if (remembered === 'static') {
    cachedMode = 'static';
    return 'static';
  }
  if (softStaticUntil > Date.now()) {
    return 'static';
  }
  if (modeProbePromise) return modeProbePromise;

  modeProbePromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4500);
      try {
        const res = await fetch('/api/health', {
          signal: controller.signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (res.status === 404 || res.status === 405) {
          cachedMode = 'static';
          savePersistedRuntimeMode('static');
          return 'static';
        }
        if (!res.ok) {
          softStaticUntil = Date.now() + 15_000;
          return 'static';
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          cachedMode = 'static';
          savePersistedRuntimeMode('static');
          return 'static';
        }
        const json = (await res.json()) as { ok?: boolean };
        if (json?.ok) {
          cachedMode = 'server';
          softStaticUntil = 0;
          savePersistedRuntimeMode('server');
          return 'server';
        }
        cachedMode = 'static';
        savePersistedRuntimeMode('static');
        return 'static';
      } finally {
        window.clearTimeout(timer);
      }
    } catch {
      // Transient mobile timeout / cold start: fall back temporarily without permanently locking static mode
      softStaticUntil = Date.now() + 15_000;
      return 'static';
    } finally {
      modeProbePromise = null;
    }
  })();

  return modeProbePromise;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5500
): Promise<T | null> {
  const effectiveTimeout = getEffectiveTimeout(url, timeoutMs);
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) return null;
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeout);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    markHostHealthy(url);
    return (await res.json()) as T;
  } catch {
    if (timedOut || !externalSignal?.aborted) {
      markHostSlow(url);
    }
    return null;
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

let jsonpSeq = 0;

/**
 * Safe browser JSONP helper for China-native public APIs (such as Baidu Baike
 * OpenAPI and Baidu Search Suggest) that work without VPN or CORS headers.
 */
function fetchJsonpWithTimeout<T>(
  rawUrl: string,
  callbackParam = 'callback',
  timeoutMs = 5000,
  signal?: AbortSignal
): Promise<T | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    jsonpSeq += 1;
    const cbName = `__cineArchiveJsonp_${Date.now()}_${jsonpSeq}`;
    const win = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      try {
        delete win[cbName];
      } catch {
        win[cbName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const done = (val: T | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onAbort = () => done(null);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = window.setTimeout(() => done(null), timeoutMs);

    win[cbName] = (data: T) => {
      done(data ?? null);
    };

    const sep = rawUrl.includes('?') ? '&' : '?';
    script.src = `${rawUrl}${sep}${encodeURIComponent(callbackParam)}=${encodeURIComponent(cbName)}`;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.onerror = () => done(null);
    (document.head || document.body || document.documentElement).appendChild(
      script
    );
  });
}

function cleanText(raw?: string | null, maxLen = 220): string {
  return stripBaikeHtml(raw, maxLen);
}

function extractYear(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const match = /\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(raw);
  return match ? match[1] : undefined;
}

// ---------- China-Native Zero-VPN Browser Sources ----------

const baikeBrowserCache = new Map<string, ParsedBaikeBundle>();

async function fetchBaikeCardBrowser(
  keyword: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<ParsedBaikeBundle> {
  const cleanKey = keyword.trim();
  const cacheKey = `${category}::${cleanKey.toLowerCase()}`;
  const cached = baikeBrowserCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(
    cleanKey
  )}`;
  const payload = await fetchJsonpWithTimeout<Record<string, any>>(
    url,
    'callback',
    4000,
    signal
  );
  const parsed = parseBaiduBaikeCard(payload, category);
  if (parsed.searchResult) {
    if (baikeBrowserCache.size > 200) {
      const firstKey = baikeBrowserCache.keys().next().value;
      if (firstKey !== undefined) baikeBrowserCache.delete(firstKey);
    }
    baikeBrowserCache.set(cacheKey, parsed);
  }
  return parsed;
}

async function fetchBaiduSuggestTerms(
  query: string,
  signal?: AbortSignal
): Promise<string[]> {
  const url = `https://www.baidu.com/sugrec?prod=pc&wd=${encodeURIComponent(
    query.trim()
  )}`;
  const payload = await fetchJsonpWithTimeout<{
    g?: Array<{ q?: string }>;
  }>(url, 'cb', 3000, signal);
  const rawList = Array.isArray(payload?.g) ? payload.g : [];
  const cleaned: string[] = [];
  for (const row of rawList) {
    const q = typeof row?.q === 'string' ? row.q.trim() : '';
    if (!q || q.length > 24) continue;
    // Skip obvious noisy search phrases
    if (/(在线观看|免费观看|百度网盘|下载|剧情介绍|演员表|豆瓣|预告片|高清|完整版|资源)/.test(q)) {
      continue;
    }
    if (!cleaned.includes(q)) {
      cleaned.push(q);
    }
    if (cleaned.length >= 3) break;
  }
  return cleaned;
}

async function searchBaiduBaikeBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  const direct = await fetchBaikeCardBrowser(query, category, signal);
  const out: OnlineSearchResult[] = [];
  if (direct.searchResult) {
    out.push(direct.searchResult);
  }

  // If the exact lemma missed (e.g. partial query like "漫长的" or "复仇者"),
  // use Baidu Search Suggest JSONP to resolve the top 2 exact entity names.
  if (out.length === 0) {
    const suggestions = await fetchBaiduSuggestTerms(query, signal);
    const candidates = suggestions
      .filter((term) => term !== query.trim())
      .slice(0, 2);
    if (candidates.length > 0) {
      const resolved = await Promise.all(
        candidates.map((term) => fetchBaikeCardBrowser(term, category, signal))
      );
      for (const bundle of resolved) {
        if (bundle.searchResult) {
          out.push(bundle.searchResult);
        }
      }
    }
  }

  return out;
}

async function fetchIqiyiSuggestBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<ParsedIqiyiBundle> {
  const url = `https://suggest.video.iqiyi.com/?key=${encodeURIComponent(
    query.trim()
  )}&rltnum=10`;
  const payload = await fetchJsonWithTimeout<Record<string, any>>(
    url,
    { signal },
    4500
  );
  return parseIqiyiSuggestData(payload, category);
}

async function searchIqiyiBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (category === 'character') return [];
  const bundle = await fetchIqiyiSuggestBrowser(query, category, signal);
  return bundle.searchResults;
}

async function searchMoegirlBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  const url =
    `https://zh.moegirl.org.cn/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrsearch=${encodeURIComponent(query.trim())}&gsrlimit=6` +
    `&prop=pageimages|extracts|info&inprop=url` +
    `&piprop=thumbnail&pithumbsize=480&exintro=1&explaintext=1&exsentences=2`;
  const payload = await fetchJsonWithTimeout<Record<string, any>>(
    url,
    { signal },
    4800
  );
  return parseMoegirlPages(payload, category, query);
}

// ---------- Global / Overseas CORS Sources ----------

async function searchBangumiBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (category === 'film') {
    // Run simple GET (no CORS preflight!) alongside v0 POST for mobile reliability
    const [v0Json, legacyJson] = await Promise.all([
      fetchJsonWithTimeout<{ data?: Array<Record<string, any>> }>(
        'https://api.bgm.tv/v0/search/subjects?limit=8&offset=0',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ keyword: query, filter: { type: [6, 2] } }),
          signal,
        },
        4800
      ),
      fetchJsonWithTimeout<Record<string, any>>(
        `https://api.bgm.tv/search/subject/${encodeURIComponent(
          query
        )}?responseGroup=large&max_results=8`,
        { signal },
        4800
      ),
    ]);

    const v0Results: OnlineSearchResult[] = (v0Json?.data || []).map((item) => {
      const title = String(item.name_cn || item.name || '').trim();
      const originalTitle =
        item.name && item.name !== title ? String(item.name) : undefined;
      const img =
        item.images?.large ||
        item.images?.common ||
        item.images?.medium ||
        item.image;
      const typeLabel = item.type === 2 ? '动画' : '影视';
      const tags = Array.isArray(item.tags)
        ? item.tags
            .slice(0, 4)
            .map((t: any) => (typeof t?.name === 'string' ? t.name : ''))
            .filter(Boolean)
        : [typeLabel];

      return {
        externalId: `bgm-subj-${item.id}`,
        category: 'film',
        title,
        originalTitle,
        subtitle: item.score
          ? `${typeLabel} · Bangumi ${Number(item.score).toFixed(1)}`
          : typeLabel,
        year: extractYear(item.date),
        coverUrl: upgradeToHttpsUrl(img),
        summary: cleanText(item.summary || `${title}（${typeLabel}作品）`),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/subject/${item.id}`,
        tags,
      };
    });

    if (v0Results.length > 0) return v0Results;
    return parseBangumiLegacySubjects(legacyJson);
  }

  if (category === 'person') {
    const json = await fetchJsonWithTimeout<{ data?: Array<Record<string, any>> }>(
      'https://api.bgm.tv/v0/search/persons?limit=8&offset=0',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ keyword: query }),
        signal,
      },
      4800
    );
    const careerMap: Record<string, string> = {
      actor: '演员 / 声优',
      seiyu: '声优',
      director: '导演',
      producer: '制片人',
      writer: '编剧',
      artist: '音乐 / 美术',
      mangaka: '原作者',
    };
    return (json?.data || []).map((item) => {
      const careers = Array.isArray(item.career)
        ? item.career.map((c: string) => careerMap[c] || c).slice(0, 3)
        : [];
      const infoboxCn = Array.isArray(item.infobox)
        ? item.infobox.find((row: any) => row?.key === '简体中文名')?.value
        : undefined;
      const title =
        typeof infoboxCn === 'string' && infoboxCn.trim()
          ? infoboxCn.trim()
          : String(item.name || '').trim();
      const originalTitle =
        item.name && item.name !== title ? String(item.name) : undefined;
      const img = item.images?.large || item.images?.medium || item.images?.grid;

      return {
        externalId: `bgm-person-${item.id}`,
        category: 'person',
        title,
        originalTitle,
        subtitle: careers.length > 0 ? careers.join(' · ') : '影视人物',
        year: extractYear(item.birth_year ? String(item.birth_year) : undefined),
        coverUrl: upgradeToHttpsUrl(img),
        summary: cleanText(
          item.short_summary || item.summary || `${title} 人物档案`
        ),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/person/${item.id}`,
        tags: careers.length > 0 ? careers : ['影人'],
      };
    });
  }

  const json = await fetchJsonWithTimeout<{ data?: Array<Record<string, any>> }>(
    'https://api.bgm.tv/v0/search/characters?limit=8&offset=0',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ keyword: query }),
      signal,
    },
    4800
  );
  return (json?.data || []).map((item) => {
    const infoboxCn = Array.isArray(item.infobox)
      ? item.infobox.find((row: any) => row?.key === '简体中文名')?.value
      : undefined;
    const title =
      typeof infoboxCn === 'string' && infoboxCn.trim()
        ? infoboxCn.trim()
        : String(item.name || '').trim();
    const originalTitle =
      item.name && item.name !== title ? String(item.name) : undefined;
    const img = item.images?.large || item.images?.medium || item.images?.grid;

    return {
      externalId: `bgm-char-${item.id}`,
      category: 'character',
      title,
      originalTitle,
      subtitle: item.gender ? `角色 · ${item.gender}` : '虚构角色',
      coverUrl: upgradeToHttpsUrl(img),
      summary: cleanText(item.summary || `${title} 角色档案`),
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/character/${item.id}`,
      tags: ['角色'],
    };
  });
}

async function searchZhWikiBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  const hint =
    category === 'film'
      ? '电影 OR 电视剧 OR 动画'
      : category === 'person'
        ? '导演 OR 演员'
        : '角色';
  const searchTerms = `${query} ${hint}`;
  const url =
    `https://zh.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrsearch=${encodeURIComponent(searchTerms)}&gsrlimit=6` +
    `&prop=pageimages|extracts|description|info&inprop=url` +
    `&piprop=thumbnail&pithumbsize=500&exintro=1&explaintext=1&exsentences=3`;

  const data = await fetchJsonWithTimeout<{
    query?: { pages?: Record<string, Record<string, any>> };
  }>(url, { signal }, 4500);
  const pages = Object.values(data?.query?.pages || {});
  pages.sort((a, b) => (a.index || 99) - (b.index || 99));

  return pages
    .filter((p) => typeof p.title === 'string' && p.title.trim())
    .map((page) => {
      const summary = cleanText(page.extract || page.description || '');
      return {
        externalId: `zhwiki-${page.pageid}`,
        category,
        title: String(page.title).replace(/\s*\([^)]*\)\s*$/, '').trim(),
        subtitle: cleanText(
          page.description ||
            (category === 'film'
              ? '影视条目'
              : category === 'person'
                ? '影人词条'
                : '角色词条'),
          50
        ),
        year: extractYear(summary),
        coverUrl: upgradeToHttpsUrl(page.thumbnail?.source),
        summary: summary || `${page.title}（中文维基百科词条）`,
        sourceName: '中文维基百科',
        sourceUrl:
          page.fullurl ||
          `https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        tags: [
          category === 'film' ? '影视' : category === 'person' ? '影人' : '角色',
        ],
      };
    });
}

async function searchITunesBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (category === 'character') return [];
  const entity = category === 'film' ? 'movie' : 'movieArtist';
  // Apple iTunes Search supports Access-Control-Allow-Origin: * directly.
  // Use US/HK storefronts because CN storefront closed its movie catalog.
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&country=us&lang=zh_cn&media=movie&entity=${entity}&limit=6`;

  const data = await fetchJsonWithTimeout<{
    results?: Array<Record<string, any>>;
  }>(url, { signal }, 4500);
  const results = data?.results || [];

  if (category === 'person') {
    return results
      .filter((r) => r.artistName)
      .map((r) => ({
        externalId: `itunes-artist-${r.artistId || r.artistName}`,
        category: 'person',
        title: String(r.artistName),
        subtitle: r.primaryGenreName
          ? `影人 · ${r.primaryGenreName}`
          : '影视创作者',
        summary: `${r.artistName} — 收录自 iTunes 影视资料库。`,
        sourceName: 'iTunes 影视库',
        sourceUrl: upgradeToHttpsUrl(r.artistLinkUrl),
        tags: r.primaryGenreName ? [String(r.primaryGenreName)] : ['影人'],
      }));
  }

  return results
    .filter((r) => r.trackName)
    .map((r) => {
      const highResPoster =
        typeof r.artworkUrl100 === 'string'
          ? r.artworkUrl100.replace('100x100bb', '600x900bb')
          : undefined;
      return {
        externalId: `itunes-movie-${r.trackId}`,
        category: 'film',
        title: String(r.trackName),
        subtitle: [r.artistName, r.primaryGenreName].filter(Boolean).join(' · '),
        year: extractYear(r.releaseDate),
        region: r.country === 'CHN' ? '中国' : r.country,
        coverUrl: upgradeToHttpsUrl(highResPoster),
        summary: cleanText(
          r.longDescription || r.shortDescription || `${r.trackName}`
        ),
        sourceName: 'iTunes 影视库',
        sourceUrl: upgradeToHttpsUrl(r.trackViewUrl),
        tags: r.primaryGenreName ? [String(r.primaryGenreName)] : ['电影'],
      };
    });
}

async function searchTVMazeBrowser(
  query: string,
  category: ArchiveCategory,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (category === 'person') {
    const data = await fetchJsonWithTimeout<
      Array<{ person?: Record<string, any> }>
    >(
      `https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`,
      { signal },
      4500
    );
    return (data || []).slice(0, 6).flatMap((entry) => {
      const p = entry.person;
      if (!p?.name) return [];
      return [
        {
          externalId: `tvmaze-person-${p.id}`,
          category: 'person',
          title: String(p.name),
          subtitle: p.country?.name ? `演员 · ${p.country.name}` : '剧集演员',
          year: extractYear(p.birthday),
          region: p.country?.name,
          coverUrl: upgradeToHttpsUrl(p.image?.original || p.image?.medium),
          summary: cleanText(
            `${p.name}${p.country?.name ? `，来自 ${p.country.name}` : ''}${
              p.birthday ? `，生于 ${p.birthday}` : ''
            }。`
          ),
          sourceName: 'TVMaze 剧集库',
          sourceUrl: upgradeToHttpsUrl(p.url),
          tags: ['剧集演员'],
        },
      ];
    });
  }

  const data = await fetchJsonWithTimeout<
    Array<{ show?: Record<string, any> }>
  >(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
    { signal },
    4500
  );
  if (!data || data.length === 0) return [];

  if (category === 'character') {
    const topShow = data[0]?.show;
    if (!topShow?.id) return [];
    const cast = await fetchJsonWithTimeout<
      Array<{ person?: Record<string, any>; character?: Record<string, any> }>
    >(
      `https://api.tvmaze.com/shows/${topShow.id}/cast`,
      { signal },
      4500
    );
    return (cast || []).slice(0, 6).flatMap((entry) => {
      const ch = entry.character;
      const actor = entry.person;
      if (!ch?.name) return [];
      return [
        {
          externalId: `tvmaze-char-${ch.id}`,
          category: 'character',
          title: String(ch.name),
          subtitle: `出自《${topShow.name}》${actor?.name ? ` · 饰演者 ${actor.name}` : ''}`,
          year: extractYear(topShow.premiered),
          coverUrl: upgradeToHttpsUrl(
            ch.image?.original || ch.image?.medium || actor?.image?.medium
          ),
          summary: cleanText(
            `剧集《${topShow.name}》中的主要角色，由 ${actor?.name || '未知演员'} 饰演。`
          ),
          relatedWorkTitle: String(topShow.name),
          portrayedBy: actor?.name ? String(actor.name) : undefined,
          sourceName: 'TVMaze 剧集库',
          sourceUrl: upgradeToHttpsUrl(ch.url || topShow.url),
          tags: ['剧集角色'],
        },
      ];
    });
  }

  return data.slice(0, 6).flatMap((entry) => {
    const s = entry.show;
    if (!s?.name) return [];
    const genres = Array.isArray(s.genres) ? s.genres.slice(0, 3) : [];
    return [
      {
        externalId: `tvmaze-show-${s.id}`,
        category: 'film',
        title: String(s.name),
        subtitle: genres.length > 0 ? `剧集 · ${genres.join(' / ')}` : '剧集',
        year: extractYear(s.premiered),
        region: s.network?.country?.name || s.webChannel?.country?.name,
        coverUrl: upgradeToHttpsUrl(s.image?.original || s.image?.medium),
        summary: cleanText(s.summary || `${s.name} 剧集资料`),
        sourceName: 'TVMaze 剧集库',
        sourceUrl: upgradeToHttpsUrl(s.url),
        tags: genres.length > 0 ? genres : ['剧集'],
      },
    ];
  });
}

function deduplicateSearchResults(
  results: OnlineSearchResult[]
): OnlineSearchResult[] {
  const seen = new Set<string>();
  const out: OnlineSearchResult[] = [];
  for (const item of results) {
    if (!item.title) continue;
    const key = `${item.category}::${item.title.toLowerCase()}::${item.sourceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Dual-mode online search (IMDb Primary + Douban Chinese Info Assist):
 * - `'server'` mode: queries Express `/api/search?source=imdb`
 * - `'static'` mode (GitHub Pages / mobile PWA): queries CORS-open IMDb Cinemeta +
 *   IMDb Suggest JSONP + Wikidata bridge with non-blocking Douban Chinese assist.
 */
export async function searchOnline(
  query: string,
  category: ArchiveCategory,
  _source: SearchSourceOption = 'imdb'
): Promise<OnlineSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      results: [],
      activeSources: [],
      mode: getRuntimeModeSync(),
      error: '请输入搜索关键词',
    };
  }

  const isExplicitStatic = detectInitialStaticHint(getInitialSignals());
  const useBackendSearch = !isExplicitStatic && cachedMode !== 'static';

  if (useBackendSearch) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 9500);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&category=${encodeURIComponent(
          category
        )}&source=imdb`,
        {
          signal: controller.signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        }
      );
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        cachedMode = 'server';
        softStaticUntil = 0;
        const data = (await res.json()) as {
          results?: OnlineSearchResult[];
          activeSources?: string[];
          error?: string;
        };
        return {
          results: Array.isArray(data.results) ? data.results : [],
          activeSources: Array.isArray(data.activeSources)
            ? data.activeSources
            : [],
          mode: 'server',
          error: data.error,
        };
      }
      if (
        res.status === 404 ||
        res.status === 405 ||
        (res.ok && !contentType.includes('application/json'))
      ) {
        cachedMode = 'static';
      }
    } catch {
      // Transient backend timeout or pure static fallback -> continue to browser-direct
    } finally {
      window.clearTimeout(timer);
    }
  }

  const mode = await detectRuntimeMode();
  const relayUrl = getConfiguredDoubanRelayUrl();
  const doubanOpts = relayUrl
    ? ({ transport: 'relay', relayBaseUrl: relayUrl } as const)
    : ({ transport: 'static-direct' } as const);

  const tasks: Array<NamedSourceTask<OnlineSearchResult>> = [
    {
      name: 'IMDb',
      promise: searchImdbMedia(trimmed, category, {
        mode: 'browser',
        doubanOptions: doubanOpts,
        enableDoubanAssist: true,
      })
        .then((b) => b.results)
        .catch(() => []),
    },
    {
      name: '百度百科',
      promise: searchBaiduBaikeBrowser(trimmed, category).catch(() => []),
    },
  ];
  if (category !== 'character') {
    tasks.push({
      name: '爱奇艺影视库',
      promise: searchIqiyiBrowser(trimmed, category).catch(() => []),
    });
  } else {
    tasks.push({
      name: '萌娘百科',
      promise: searchMoegirlBrowser(trimmed, category).catch(() => []),
    });
  }

  const settled = await settleSourcesWithFastWindow(tasks, 1800);
  const merged = mergeBilingualResults(
    deduplicateSearchResults(settled.items)
  ).slice(0, 16);

  return {
    results: merged,
    activeSources: settled.activeSources,
    mode,
  };
}

// ---------- Cover Image Candidate Search ----------

async function searchCommonsCoversBrowser(
  query: string
): Promise<CoverCandidate[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=12` +
    `&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=640&format=json&origin=*`;
  const data = await fetchJsonWithTimeout<{
    query?: { pages?: Record<string, any> };
  }>(url, {}, 4500);
  const pages = Object.values(data?.query?.pages || {});
  const out: CoverCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const mime = String(info.mime || '').toLowerCase();
    if (!mime.startsWith('image/') || mime.includes('svg') || mime.includes('tiff')) {
      continue;
    }
    if ((info.width || 0) < 200 || (info.height || 0) < 200) continue;
    const src = upgradeToHttpsUrl(info.thumburl || info.url);
    if (!src || !isAcceptablePhoto(src)) continue;
    const cleanTitle = String(page.title || '')
      .replace(/^File:/i, '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/_/g, ' ')
      .slice(0, 32);
    out.push({
      id: `commons-${out.length}-${cleanTitle || 'img'}`,
      url: src,
      source: '维基媒体',
      caption: cleanTitle || undefined,
    });
  }
  return out;
}

async function searchEnWikiCoversBrowser(
  query: string
): Promise<CoverCandidate[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=8` +
    `&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json&origin=*`;
  const data = await fetchJsonWithTimeout<{
    query?: { pages?: Record<string, any> };
  }>(url, {}, 4500);
  const pages = Object.values(data?.query?.pages || {});
  const out: CoverCandidate[] = [];
  for (const page of pages) {
    const src = upgradeToHttpsUrl(page.thumbnail?.source);
    if (!src || !isAcceptablePhoto(src)) continue;
    out.push({
      id: `enwiki-${out.length}-${page.title || 'img'}`,
      url: src,
      source: '英文维基',
      caption: page.title || undefined,
    });
  }
  return out;
}

export async function searchCovers(
  query: string,
  category: ArchiveCategory,
  originalTitle?: string
): Promise<CoverCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const mode = await detectRuntimeMode();
  if (mode === 'server') {
    try {
      const params = new URLSearchParams({ q: trimmed, category });
      if (originalTitle && originalTitle.trim()) {
        params.set('originalTitle', originalTitle.trim());
      }
      const res = await fetch(`/api/cover-search?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { candidates?: CoverCandidate[] };
        return Array.isArray(data.candidates) ? data.candidates : [];
      }
    } catch {
      // Fall through to browser direct cover search
    }
  }

  const globalQuery = (originalTitle || '').trim() || trimmed;
  const relayUrl = getConfiguredDoubanRelayUrl();
  const doubanCoverOpts = relayUrl
    ? ({ transport: 'relay', relayBaseUrl: relayUrl } as const)
    : ({ transport: 'static-direct' } as const);
  const tasks: Array<NamedSourceTask<CoverCandidate>> = [
    {
      name: 'IMDb 图库',
      promise: searchImdbCoverCandidates(
        trimmed,
        category,
        originalTitle?.trim() || undefined,
        { mode: 'browser' }
      ),
    },
    {
      name: '豆瓣图库',
      promise: searchDoubanCoverCandidates(
        trimmed,
        category,
        originalTitle?.trim() || undefined,
        doubanCoverOpts
      ),
    },
    {
      name: '百度百科',
      promise: searchBaiduBaikeBrowser(trimmed, category).then((items) =>
        items
          .filter((it) => Boolean(it.coverUrl))
          .map((it, idx) => ({
            id: `baike-${idx}-${it.title}`,
            url: it.coverUrl!,
            source: '百度百科',
            caption: it.title,
          }))
      ),
    },
    {
      name: '爱奇艺影视库',
      promise: searchIqiyiBrowser(trimmed, category).then((items) =>
        items
          .filter((it) => Boolean(it.coverUrl))
          .map((it, idx) => ({
            id: `iqiyi-${idx}-${it.title}`,
            url: it.coverUrl!,
            source: '爱奇艺图库',
            caption: it.title,
          }))
      ),
    },
    {
      name: '萌娘百科',
      promise: searchMoegirlBrowser(trimmed, category).then((items) =>
        items
          .filter((it) => Boolean(it.coverUrl))
          .map((it, idx) => ({
            id: `moegirl-${idx}-${it.title}`,
            url: it.coverUrl!,
            source: '萌娘百科',
            caption: it.title,
          }))
      ),
    },
    {
      name: '番组计划',
      promise: searchBangumiBrowser(trimmed, category).then((items) =>
        items
          .filter((it) => Boolean(it.coverUrl))
          .map((it, idx) => ({
            id: `bgm-${idx}-${it.title}`,
            url: it.coverUrl!,
            source: '番组计划',
            caption: it.title,
          }))
      ),
    },
    {
      name: '维基媒体',
      promise: searchCommonsCoversBrowser(globalQuery),
    },
    {
      name: '英文维基',
      promise: searchEnWikiCoversBrowser(globalQuery),
    },
    {
      name: '中文维基',
      promise: searchZhWikiBrowser(trimmed, category).then((items) =>
        items
          .filter((it) => Boolean(it.coverUrl))
          .map((it, idx) => ({
            id: `zhwiki-${idx}-${it.title}`,
            url: it.coverUrl!,
            source: '中文维基',
            caption: it.title,
          }))
      ),
    },
    {
      name: 'TVMaze 图库',
      promise: searchTVMazeBrowser(trimmed, category).then((items) =>
        items
          .filter((it) => Boolean(it.coverUrl))
          .map((it, idx) => ({
            id: `tvmaze-${idx}-${it.title}`,
            url: it.coverUrl!,
            source: 'TVMaze 图库',
            caption: it.title,
          }))
      ),
    },
  ];

  const { items: raw } = await settleSourcesWithFastWindow(tasks, 1800);
  return rankAndFilterCoverCandidates(
    raw,
    trimmed,
    originalTitle?.trim() || undefined,
    18
  );
}

// ---------- Cross-Entity Relations Discovery ----------

export async function fetchOnlineRelations(
  params: {
    category: 'film' | 'person';
    title: string;
    originalTitle?: string;
    sourceUrl?: string;
    year?: string;
  },
  signal?: AbortSignal
): Promise<OnlineRelationsResponse> {
  const mode = await detectRuntimeMode();
  if (mode === 'server') {
    const qs = new URLSearchParams({
      category: params.category,
      title: params.title,
    });
    if (params.originalTitle) qs.set('originalTitle', params.originalTitle);
    if (params.sourceUrl) qs.set('sourceUrl', params.sourceUrl);
    if (params.year) qs.set('year', params.year);
    const res = await fetch(`/api/relations?${qs.toString()}`, { signal });
    if (res.ok) {
      const data = (await res.json()) as Partial<OnlineRelationsResponse>;
      return {
        films: Array.isArray(data.films) ? data.films : [],
        people: Array.isArray(data.people) ? data.people : [],
        characters: Array.isArray(data.characters) ? data.characters : [],
        sources: Array.isArray(data.sources) ? data.sources : [],
      };
    }
  }

  // Browser-direct static discovery: China-native (Baidu Baike + iQIYI) + Global (IMDb + Douban + Bangumi + zh.Wikipedia)
  const rawFilms: OnlineSearchResult[] = [];
  const rawPeople: OnlineSearchResult[] = [];
  const rawCharacters: OnlineSearchResult[] = [];
  const sources: string[] = [];

  const bgmMatch = params.sourceUrl
    ? /bgm\.tv\/(subject|person)\/(\d+)/.exec(params.sourceUrl)
    : null;

  const relayUrl = getConfiguredDoubanRelayUrl();
  const doubanRelOpts = relayUrl
    ? ({ transport: 'relay', relayBaseUrl: relayUrl, signal } as const)
    : ({ transport: 'static-direct', signal } as const);

  const isPlausibleBaikeEnrichment = (
    item: OnlineSearchResult,
    baikeItem: OnlineSearchResult,
    category: 'film' | 'person'
  ): boolean => {
    const contextText = `${baikeItem.subtitle || ''} ${baikeItem.summary || ''}`;
    const hasMediaSignal =
      category === 'person'
        ? /(演员|导演|编剧|制片|影人|电影|电视剧|配音|声优|喜剧|奥斯卡|好莱坞|明星|男演员|女演员|监制|摄影|作曲)/.test(
            contextText
          )
        : /(电影|电视剧|剧集|动画|影片|导演|主演|上映|播出|漫威|科幻|动作|剧情|喜剧|悬疑|奇幻)/.test(
            contextText
          );
    if (!hasCjkChars(item.title)) {
      const latinMatch =
        latinPersonNamesMatch(item.title, baikeItem.originalTitle) ||
        hasStrictTitleOverlap(
          [item.title],
          [baikeItem.title, baikeItem.originalTitle]
        );
      return latinMatch || (hasCjkChars(baikeItem.title) && hasMediaSignal);
    }
    const titleMatch = hasStrictTitleOverlap(
      [item.title, item.originalTitle],
      [baikeItem.title, baikeItem.originalTitle]
    );
    return titleMatch && (hasMediaSignal || Boolean(baikeItem.coverUrl));
  };

  /**
   * Enriches top relation items via China-accessible Baidu Baike JSONP (+ iQIYI Suggest fallback)
   * so English-only IMDb entries resolve Chinese titles + portraits and Chinese entries get
   * bilingual English `originalTitle` + real portraits before final bilingual deduplication.
   */
  const enrichRelationsBrowser = async (
    items: OnlineSearchResult[],
    targetCategory: 'film' | 'person'
  ): Promise<OnlineSearchResult[]> => {
    const preMerged = mergeBilingualResults(items);
    if (preMerged.length === 0 || signal?.aborted) return preMerged;

    const aliasMap = new Map<string, string[]>();
    const cloned = preMerged.map((entry) => ({ ...entry }));

    // Prioritize items missing Chinese title, missing coverUrl, or missing originalTitle (top 16)
    const candidateIndices: number[] = [];
    for (let i = 0; i < cloned.length && candidateIndices.length < 16; i += 1) {
      const it = cloned[i];
      if (!hasCjkChars(it.title) || !it.coverUrl || !it.originalTitle) {
        candidateIndices.push(i);
      }
    }

    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidateIndices.length && !signal?.aborted) {
        const idx = candidateIndices[cursor++];
        const item = cloned[idx];
        const aliases: string[] = [];

        try {
          const baike = await fetchBaikeCardBrowser(
            item.title,
            targetCategory,
            signal
          );
          const hit = baike.searchResult;
          if (hit && isPlausibleBaikeEnrichment(item, hit, targetCategory)) {
            if (hit.originalTitle) aliases.push(hit.originalTitle);
            if (baike.characterProfile.alias) {
              aliases.push(baike.characterProfile.alias);
            }
            if (hit.title && hit.title !== item.title) {
              aliases.push(hit.title);
            }

            if (!hasCjkChars(item.title) && hasCjkChars(hit.title)) {
              const prevLatin = item.title;
              item.title = hit.title;
              if (!item.originalTitle) {
                item.originalTitle = prevLatin;
              }
            } else if (
              hasCjkChars(item.title) &&
              !item.originalTitle &&
              hit.originalTitle &&
              !hasCjkChars(hit.originalTitle)
            ) {
              item.originalTitle = hit.originalTitle;
            }

            if (!item.coverUrl && hit.coverUrl) {
              item.coverUrl = hit.coverUrl;
            }
            if (!item.year && hit.year) {
              item.year = hit.year;
            }
          }
        } catch {
          // Ignore individual Baike timeout
        }

        // Fallback portrait/poster lookup via China-native CORS iQIYI Suggest
        if (!item.coverUrl && !signal?.aborted) {
          try {
            const iqiyi = await fetchIqiyiSuggestBrowser(
              item.title,
              targetCategory,
              signal
            );
            const match = iqiyi.searchResults.find(
              (cand) =>
                cand.coverUrl &&
                hasStrictTitleOverlap(
                  [item.title, item.originalTitle],
                  [cand.title, cand.originalTitle]
                )
            );
            if (match?.coverUrl) {
              item.coverUrl = match.coverUrl;
            }
          } catch {
            // Ignore iQIYI fallback error
          }
        }

        if (aliases.length > 0) {
          aliasMap.set(item.externalId, aliases);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, candidateIndices.length) },
        () => worker()
      )
    );

    return mergeBilingualResults(cloned, { aliasMap });
  };

  if (params.category === 'film') {
    const targetYear = extractYearNumber(params.year);
    const [imdbOutcome, doubanOutcome, baikeOutcome, iqiyiOutcome, wikiOutcome, bgmOutcome] =
      await Promise.allSettled([
        fetchImdbFilmRelations(
          params.title,
          params.originalTitle,
          params.sourceUrl,
          { mode: 'browser', year: params.year, signal }
        ),
        fetchDoubanFilmRelations(
          params.title,
          params.originalTitle,
          params.sourceUrl,
          { ...doubanRelOpts, year: params.year }
        ),
        fetchBaikeCardBrowser(params.title, 'film', signal),
        fetchIqiyiSuggestBrowser(params.title, 'film', signal),
        fetchJsonWithTimeout<{
          parse?: { title?: string; text?: { '*'?: string } };
        }>(
          `https://zh.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&page=${encodeURIComponent(
            params.title
          )}`,
          { signal },
          3800
        ),
        (async () => {
          let subjectId =
            bgmMatch?.[1] === 'subject' ? Number(bgmMatch[2]) : null;
          if (!subjectId) {
            const searchRes = await fetchJsonWithTimeout<{
              data?: Array<{
                id: number;
                type?: number;
                name?: string;
                name_cn?: string;
                date?: string;
                infobox?: Array<{ key?: string; value?: unknown }>;
              }>;
            }>(
              'https://api.bgm.tv/v0/search/subjects?limit=6',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify({
                  keyword: params.title,
                  filter: { type: [6, 2] },
                }),
                signal,
              },
              3800
            );
            subjectId = matchBangumiSubjectCandidate(searchRes?.data, {
              title: params.title,
              originalTitle: params.originalTitle,
              year: params.year,
            });
          }
          if (!subjectId) return { people: [], characters: [] };
          const [bgmPersons, bgmChars] = await Promise.all([
            fetchJsonWithTimeout<Array<Record<string, any>>>(
              `https://api.bgm.tv/v0/subjects/${subjectId}/persons`,
              { signal },
              3800
            ),
            fetchJsonWithTimeout<Array<Record<string, any>>>(
              `https://api.bgm.tv/v0/subjects/${subjectId}/characters`,
              { signal },
              3800
            ),
          ]);
          const bgmPeople: OnlineSearchResult[] = [];
          const seen = new Set<string>();
          for (const p of bgmPersons || []) {
            if (p.type && p.type !== 1) continue;
            const rel = String(p.relation || '').trim();
            if (!isRelevantFilmCrewRole(rel)) continue;
            const name = String(p.name || '').trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            bgmPeople.push({
              externalId: `bgm-person-${p.id}`,
              category: 'person',
              title: name,
              subtitle: rel,
              coverUrl: upgradeToHttpsUrl(p.images?.large || p.images?.medium),
              summary: `在《${params.title}》中担任${rel}。`,
              relatedWorkTitle: params.title,
              sourceName: '番组计划 Bangumi',
              sourceUrl: `https://bgm.tv/person/${p.id}`,
              tags: [rel],
            });
            if (bgmPeople.length >= 20) break;
          }
          const bgmCharacters: OnlineSearchResult[] = [];
          for (const c of (bgmChars || []).slice(0, 24)) {
            const name = String(c.name || '').trim();
            if (!name) continue;
            const actorName = Array.isArray(c.actors)
              ? String(c.actors[0]?.name || '').trim() || undefined
              : undefined;
            const rel = String(c.relation || '角色');
            bgmCharacters.push({
              externalId: `bgm-char-${c.id}`,
              category: 'character',
              title: name,
              subtitle: actorName ? `${rel} · ${actorName}` : rel,
              coverUrl: upgradeToHttpsUrl(c.images?.large || c.images?.medium),
              summary: `《${params.title}》中的${rel}${actorName ? `，由 ${actorName} 饰演/配音` : ''}。`,
              relatedWorkTitle: params.title,
              portrayedBy: actorName,
              sourceName: '番组计划 Bangumi',
              sourceUrl: `https://bgm.tv/character/${c.id}`,
              tags: [rel],
            });
          }
          return { people: bgmPeople, characters: bgmCharacters };
        })(),
      ]);

    // Prefer Chinese sources first so canonical Chinese titles anchor the order,
    // followed by IMDb (which fuses into the Chinese entries & fills missing portraits/nm IDs).
    if (doubanOutcome.status === 'fulfilled') {
      if (doubanOutcome.value.people.length > 0 || doubanOutcome.value.characters.length > 0) {
        sources.push('豆瓣影视');
        rawPeople.push(...doubanOutcome.value.people);
        rawCharacters.push(...doubanOutcome.value.characters);
      }
    }

    if (
      baikeOutcome.status === 'fulfilled' &&
      baikeOutcome.value.relatedPeople.length > 0
    ) {
      const baikeItem = baikeOutcome.value.searchResult;
      const baikeTitleMatches =
        !baikeItem ||
        hasStrictTitleOverlap(
          [baikeItem.title, baikeItem.originalTitle],
          [params.title, params.originalTitle]
        );
      const baikeYearMatches =
        !baikeItem || yearsAreCompatible(params.year, baikeItem.year, 2);
      if (baikeTitleMatches && baikeYearMatches) {
        sources.push('百度百科');
        rawPeople.push(...baikeOutcome.value.relatedPeople);
      }
    }

    if (
      iqiyiOutcome.status === 'fulfilled' &&
      iqiyiOutcome.value.relatedPeople.length > 0
    ) {
      const iqiyiItem = iqiyiOutcome.value.searchResults[0];
      const iqiyiTitleMatches =
        Boolean(iqiyiItem) &&
        hasStrictTitleOverlap(
          [iqiyiItem.title, iqiyiItem.originalTitle],
          [params.title, params.originalTitle]
        );
      const iqiyiYearMatches =
        !iqiyiItem || yearsAreCompatible(params.year, iqiyiItem.year, 2);
      if (iqiyiTitleMatches && iqiyiYearMatches) {
        sources.push('爱奇艺影视库');
        rawPeople.push(...iqiyiOutcome.value.relatedPeople);
      }
    }

    if (wikiOutcome.status === 'fulfilled') {
      const resolvedWikiTitle = wikiOutcome.value?.parse?.title || '';
      const wikiTitleYear = extractYearNumber(resolvedWikiTitle);
      const wikiYearOk =
        targetYear === null ||
        wikiTitleYear === null ||
        yearsAreCompatible(targetYear, wikiTitleYear, 2);
      const html = wikiYearOk ? wikiOutcome.value?.parse?.text?.['*'] : undefined;
      if (html) {
        const parsedCast = parseZhWikiCastHtml(html);
        if (parsedCast.length > 0) {
          sources.push('中文维基百科');
          rawPeople.push(
            ...parsedCast.slice(0, 30).flatMap((entry) =>
              entry.actorName
                ? [
                    {
                      externalId: `zhwiki-actor-${entry.actorName}`,
                      category: 'person' as const,
                      title: entry.actorName,
                      subtitle: entry.characterName
                        ? `饰演 ${entry.characterName}`
                        : '演员',
                      summary: `在《${params.title}》中饰演${entry.characterName || '角色'}。`,
                      relatedWorkTitle: params.title,
                      sourceName: '中文维基百科',
                      sourceUrl: entry.actorWikiTitle
                        ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(entry.actorWikiTitle)}`
                        : undefined,
                      tags: ['演员'],
                    },
                  ]
                : []
            )
          );
          rawCharacters.push(
            ...parsedCast.slice(0, 30).flatMap((entry) =>
              entry.characterName
                ? [
                    {
                      externalId: `zhwiki-char-${entry.characterName}`,
                      category: 'character' as const,
                      title: entry.characterName,
                      subtitle: entry.actorName
                        ? `角色 · ${entry.actorName}`
                        : '影视角色',
                      summary: `《${params.title}》中的角色${entry.actorName ? `，由 ${entry.actorName} 饰演` : ''}。`,
                      relatedWorkTitle: params.title,
                      portrayedBy: entry.actorName || undefined,
                      sourceName: '中文维基百科',
                      sourceUrl: entry.characterWikiTitle
                        ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(entry.characterWikiTitle)}`
                        : undefined,
                      tags: ['角色'],
                    },
                  ]
                : []
            )
          );
        }
      }
    }

    if (bgmOutcome.status === 'fulfilled') {
      if (bgmOutcome.value.people.length > 0 || bgmOutcome.value.characters.length > 0) {
        sources.push('番组计划 Bangumi');
        rawPeople.push(...bgmOutcome.value.people);
        rawCharacters.push(...bgmOutcome.value.characters);
      }
    }

    if (imdbOutcome.status === 'fulfilled') {
      if (imdbOutcome.value.people.length > 0 || imdbOutcome.value.characters.length > 0) {
        sources.push('IMDb');
        rawPeople.push(...imdbOutcome.value.people);
        rawCharacters.push(...imdbOutcome.value.characters);
      }
    }

    const enrichedPeople = await enrichRelationsBrowser(rawPeople, 'person');
    const mergedCharacters = mergeBilingualResults(rawCharacters);

    return {
      films: [],
      people: enrichedPeople.slice(0, 60),
      characters: mergedCharacters.slice(0, 60),
      sources: Array.from(new Set(sources)),
    };
  } else {
    // Person -> Representative films & characters
    const [doubanOutcome, baikeOutcome, iqiyiOutcome, wikiOutcome, imdbOutcome] =
      await Promise.allSettled([
        fetchDoubanPersonRelations(
          params.title,
          params.originalTitle,
          params.sourceUrl,
          doubanRelOpts
        ),
        fetchBaikeCardBrowser(params.title, 'person', signal),
        fetchIqiyiSuggestBrowser(params.title, 'person', signal),
        fetchJsonWithTimeout<{ parse?: { text?: { '*'?: string } } }>(
          `https://zh.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&page=${encodeURIComponent(
            params.title
          )}`,
          { signal },
          3800
        ),
        fetchImdbPersonRelations(
          params.title,
          params.originalTitle,
          params.sourceUrl,
          { mode: 'browser', signal }
        ),
      ]);

    if (doubanOutcome.status === 'fulfilled') {
      if (doubanOutcome.value.films.length > 0 || doubanOutcome.value.characters.length > 0) {
        sources.push('豆瓣影视');
        rawFilms.push(...doubanOutcome.value.films);
        rawCharacters.push(...doubanOutcome.value.characters);
      }
    }

    if (wikiOutcome.status === 'fulfilled') {
      const html = wikiOutcome.value?.parse?.text?.['*'];
      if (html) {
        const filmography = parseZhWikiFilmographyHtml(html);
        if (filmography.length > 0) {
          sources.push('中文维基百科');
          rawFilms.push(
            ...filmography.slice(0, 30).map((row) => ({
              externalId: `zhwiki-work-${row.filmTitle}-${row.year || ''}`,
              category: 'film' as const,
              title: row.filmTitle,
              originalTitle: row.filmOriginalTitle,
              year: row.year,
              subtitle: row.characterName
                ? `${params.title} 饰演 ${row.characterName}`
                : row.mediaType === 'tv'
                  ? '电视剧'
                  : '电影',
              summary: `${row.year ? `${row.year}年` : ''}作品《${row.filmTitle}》，${params.title}参演。`,
              sourceName: '中文维基百科',
              sourceUrl: row.filmWikiTitle
                ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(row.filmWikiTitle)}`
                : undefined,
              tags: [row.mediaType === 'tv' ? '电视剧' : '电影'],
            }))
          );

          const aggregatedChars = aggregatePersonCharacters(filmography);
          rawCharacters.push(
            ...aggregatedChars.slice(0, 24).map((ch) => ({
              externalId: `zhwiki-pchar-${ch.characterName}`,
              category: 'character' as const,
              title: ch.characterName,
              originalTitle: ch.characterOriginalName,
              year: ch.latestYear,
              subtitle:
                ch.filmTitles.length > 1
                  ? `出自《${ch.primaryFilmTitle}》等 ${ch.filmTitles.length} 部作品`
                  : `出自《${ch.primaryFilmTitle}》`,
              summary: `由 ${params.title} 在《${ch.primaryFilmTitle}》中饰演的角色。`,
              relatedWorkTitle: ch.primaryFilmTitle,
              portrayedBy: params.title,
              sourceName: '中文维基百科',
              sourceUrl: ch.characterWikiTitle
                ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(ch.characterWikiTitle)}`
                : undefined,
              tags: ['角色'],
            }))
          );
        }
      }
    }

    if (baikeOutcome.status === 'fulfilled' && baikeOutcome.value.relatedFilms.length > 0) {
      sources.push('百度百科');
      rawFilms.push(...baikeOutcome.value.relatedFilms);
    }

    if (iqiyiOutcome.status === 'fulfilled' && iqiyiOutcome.value.relatedFilms.length > 0) {
      sources.push('爱奇艺影视库');
      rawFilms.push(...iqiyiOutcome.value.relatedFilms);
    }

    if (imdbOutcome.status === 'fulfilled') {
      if (imdbOutcome.value.films.length > 0 || imdbOutcome.value.characters.length > 0) {
        sources.push('IMDb');
        rawFilms.push(...imdbOutcome.value.films);
        rawCharacters.push(...imdbOutcome.value.characters);
      }
    }

    const enrichedFilms = await enrichRelationsBrowser(rawFilms, 'film');
    const mergedCharacters = mergeBilingualResults(rawCharacters);

    return {
      films: enrichedFilms.slice(0, 60),
      people: [],
      characters: mergedCharacters.slice(0, 60),
      sources: Array.from(new Set(sources)),
    };
  }
}

// ---------- Character Dossier Auto-Enrichment ----------

export async function fetchCharacterDossier(
  params: {
    title: string;
    originalTitle?: string;
    relatedWorkTitle?: string;
    sourceUrl?: string;
  },
  signal?: AbortSignal
): Promise<CharacterDossierResponse> {
  const mode = await detectRuntimeMode();
  if (mode === 'server') {
    const qs = new URLSearchParams({ title: params.title });
    if (params.originalTitle) qs.set('originalTitle', params.originalTitle);
    if (params.relatedWorkTitle) qs.set('relatedWorkTitle', params.relatedWorkTitle);
    if (params.sourceUrl) qs.set('sourceUrl', params.sourceUrl);
    const res = await fetch(`/api/character-profile?${qs.toString()}`, { signal });
    if (res.ok) {
      const data = (await res.json()) as Partial<CharacterDossierResponse>;
      return {
        profile: data.profile || {},
        sources: Array.isArray(data.sources) ? data.sources : [],
      };
    }
  }

  // Direct browser-side enrichment: China-native (Baidu Baike + Moegirl) + Bangumi + zh.Wikipedia
  const profile: Partial<CharacterProfile> = {};
  const sources: string[] = [];

  const mergeMissing = (incoming: Partial<CharacterProfile>) => {
    for (const [k, v] of Object.entries(incoming)) {
      if (v && !(profile as Record<string, unknown>)[k]) {
        (profile as Record<string, unknown>)[k] = v;
      }
    }
  };

  const bgmCharMatch = params.sourceUrl
    ? /bgm\.tv\/character\/(\d+)/.exec(params.sourceUrl)
    : null;

  const [bgmOutcome, baikeOutcome, moegirlOutcome, wikiParseOutcome, wikiExtractOutcome] =
    await Promise.allSettled([
      bgmCharMatch
        ? fetchJsonWithTimeout<Record<string, any>>(
            `https://api.bgm.tv/v0/characters/${bgmCharMatch[1]}`,
            { signal },
            4500
          )
        : Promise.resolve(null),
      fetchBaikeCardBrowser(params.title, 'character', signal),
      searchMoegirlBrowser(params.title, 'character', signal),
      fetchJsonWithTimeout<{ parse?: { text?: { '*'?: string } } }>(
        `https://zh.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&page=${encodeURIComponent(
          params.title
        )}`,
        { signal },
        4500
      ),
      fetchJsonWithTimeout<{
        query?: { pages?: Record<string, { extract?: string }> };
      }>(
        `https://zh.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(
          params.title
        )}`,
        { signal },
        4500
      ),
    ]);

  if (bgmOutcome.status === 'fulfilled' && bgmOutcome.value) {
    const bgmChar = bgmOutcome.value;
    const parsedBgm = parseBangumiCharacterInfobox(
      Array.isArray(bgmChar.infobox) ? bgmChar.infobox : []
    );
    mergeMissing(parsedBgm);
    if (typeof bgmChar.summary === 'string' && bgmChar.summary.trim() && !profile.bio) {
      profile.bio = cleanWikiExtract(bgmChar.summary);
    }
    sources.push('番组计划 Bangumi');
  }

  if (wikiParseOutcome.status === 'fulfilled') {
    const html = wikiParseOutcome.value?.parse?.text?.['*'];
    if (html) {
      const parsedInfo = parseZhWikiCharacterInfobox(html);
      mergeMissing(parsedInfo);
      if (Object.keys(parsedInfo).length > 0) {
        sources.push('中文维基百科');
      }
    }
  }

  if (wikiExtractOutcome.status === 'fulfilled') {
    const pages = Object.values(wikiExtractOutcome.value?.query?.pages || {});
    const extract = cleanWikiExtract(pages[0]?.extract || '');
    if (extract && !profile.bio) {
      profile.bio = extract;
      if (!sources.includes('中文维基百科')) sources.push('中文维基百科');
    }
  }

  if (baikeOutcome.status === 'fulfilled') {
    const baikeProfile = baikeOutcome.value.characterProfile;
    if (Object.keys(baikeProfile).length > 0) {
      mergeMissing(baikeProfile);
      sources.push('百度百科');
    }
  }

  if (moegirlOutcome.status === 'fulfilled' && moegirlOutcome.value.length > 0) {
    const topMoe = moegirlOutcome.value[0];
    if (topMoe.summary && !profile.bio) {
      profile.bio = topMoe.summary;
      sources.push('萌娘百科');
    }
  }

  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length > 0) {
    profile.dossierSource = uniqueSources.join(' · ');
  }

  return { profile, sources: uniqueSources };
}
