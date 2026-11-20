import type {
  ArchiveCategory,
  CharacterProfile,
  OnlineSearchResult,
} from '../types/archive';
import {
  isAcceptableCharacterFallbackPhoto,
  isAcceptablePhoto,
  isFilmPosterImage,
  normalizeEntityKey,
  parseZhWikiCastHtml,
  scoreCharacterImage,
} from '../utils/wikiCast';
import {
  cleanWikiExtract,
  isSameEntityTitle,
  parseBangumiCharacterInfobox,
  parseZhWikiCharacterInfobox,
} from '../utils/characterProfile';
import {
  aggregatePersonCharacters,
  extractFilmographySubpageTitle,
  parseZhWikiFilmographyHtml,
} from '../utils/wikiFilmography';
import {
  rankAndFilterCoverCandidates,
  unwrapProxyImageUrl,
  type CoverCandidate,
} from '../utils/coverPicker';
import {
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
import { extractImdbIdFromUrl } from '../utils/imdbParsers';
import {
  extractYearNumber,
  hasStrictTitleOverlap,
  isRelevantFilmCrewRole,
  matchBangumiCharacterCandidate,
  matchBangumiSubjectCandidate,
  yearsAreCompatible,
} from '../utils/relationMatching';
import {
  hasCjkChars,
  latinPersonNamesMatch,
  mergeBilingualResults,
} from '../utils/bilingualMerge';
import {
  parseBaiduBaikeCard,
  parseMoegirlPages,
} from '../utils/chinaSearchParsers';
import {
  cleanBangumiCharacterName,
  isPlausibleCharacterBaikeBundle,
  parseBangumiCharacterSearch,
  parseBangumiSubjectCharacters,
  parseTvmazeShowCharacters,
  rankCharacterResults,
} from '../utils/characterSearchParsers';

export type MediaEngineMode = 'server' | 'browser';

export interface MediaSearchResponse {
  query: string;
  category: ArchiveCategory;
  results: OnlineSearchResult[];
  activeSources: string[];
  failedSources: string[];
}

export interface CoverSearchResponse {
  query?: string;
  category?: ArchiveCategory;
  candidates: CoverCandidate[];
}

export interface OnlineRelationsResponse {
  films: OnlineSearchResult[];
  people: OnlineSearchResult[];
  characters: OnlineSearchResult[];
  sources: string[];
}

export interface CharacterProfileResponse {
  profile: Partial<CharacterProfile>;
  sources: string[];
}

const BGM_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)',
  Accept: 'application/json',
};

const WIKI_HEADERS: Record<string, string> = {
  'User-Agent': 'CineArchive/1.0 (contact@cinearchive.local)',
  Accept: 'application/json',
};

export function prepareUpstreamRequest(
  rawUrl: string,
  init: RequestInit | undefined,
  mode: MediaEngineMode
): { url: string; init: RequestInit } {
  const baseInit: RequestInit = init ? { ...init } : {};
  if (mode === 'server') {
    return { url: rawUrl, init: baseInit };
  }

  let nextUrl = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const isWikimediaApi =
      (host.endsWith('.wikipedia.org') ||
        host.endsWith('.wikimedia.org') ||
        host === 'www.wikidata.org') &&
      parsed.pathname.endsWith('/w/api.php');
    if (isWikimediaApi && parsed.searchParams.get('origin') !== '*') {
      parsed.searchParams.set('origin', '*');
    }
    nextUrl = parsed.toString();
  } catch {
    // Keep rawUrl if URL parsing fails
  }

  if (baseInit.headers) {
    const cleaned: Record<string, string> = {};
    if (baseInit.headers instanceof Headers) {
      baseInit.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'user-agent') {
          cleaned[key] = value;
        }
      });
    } else if (Array.isArray(baseInit.headers)) {
      for (const [key, value] of baseInit.headers) {
        if (key.toLowerCase() !== 'user-agent') {
          cleaned[key] = value;
        }
      }
    } else {
      for (const [key, value] of Object.entries(baseInit.headers)) {
        if (key.toLowerCase() !== 'user-agent' && value !== undefined) {
          cleaned[key] = String(value);
        }
      }
    }

    const method = (baseInit.method || 'GET').toUpperCase();
    if (Object.keys(cleaned).length === 0) {
      delete baseInit.headers;
    } else if (
      method === 'GET' &&
      Object.keys(cleaned).length === 1 &&
      cleaned.Accept === 'application/json'
    ) {
      // Keep simple CORS-safelisted headers or omit on GET if desired; Accept is safelisted
      baseInit.headers = cleaned;
    } else {
      baseInit.headers = cleaned;
    }
  }

  return { url: nextUrl, init: baseInit };
}

export function formatEngineImageUrl(
  rawUrl: string | null | undefined,
  mode: MediaEngineMode
): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('/src/assets/')) {
    return trimmed;
  }

  if (mode === 'browser') {
    const unwrapped = unwrapProxyImageUrl(trimmed);
    if (
      unwrapped.startsWith('data:image/') ||
      unwrapped.startsWith('/src/assets/')
    ) {
      return unwrapped;
    }
    const normalized = unwrapped.startsWith('//')
      ? `https:${unwrapped}`
      : unwrapped;
    if (!/^https?:\/\//i.test(normalized)) return undefined;
    return normalized;
  }

  if (trimmed.startsWith('/api/img-proxy')) {
    return trimmed;
  }
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(normalized)) return undefined;
  return `/api/img-proxy?url=${encodeURIComponent(normalized)}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 6500,
  mode: MediaEngineMode = 'server',
  externalSignal?: AbortSignal
): Promise<globalThis.Response> {
  const prepared = prepareUpstreamRequest(url, init, mode);
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(prepared.url, {
      ...prepared.init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function cleanText(raw?: string | null, maxLen = 220): string {
  if (!raw) return '';
  const stripped = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxLen) return stripped;
  return `${stripped.slice(0, maxLen).trim()}…`;
}

function extractYear(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const match = /\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(raw);
  return match ? match[1] : undefined;
}

function normalizeCategory(rawCat?: string): ArchiveCategory {
  return rawCat === 'person' || rawCat === 'character' ? rawCat : 'film';
}

// Source 1: Bangumi (番组计划) — Native Chinese API for Movies/TV, People, Characters
async function searchBangumi(
  query: string,
  category: ArchiveCategory,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (category === 'film') {
    const res = await fetchWithTimeout(
      'https://api.bgm.tv/v0/search/subjects?limit=8&offset=0',
      {
        method: 'POST',
        headers: BGM_HEADERS,
        body: JSON.stringify({
          keyword: query,
          filter: { type: [6, 2] }, // 6 = Real/影视剧, 2 = Anime/动画
        }),
      },
      6500,
      mode,
      signal
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Record<string, any>> };
    return (json.data || []).map((item) => {
      const title = (item.name_cn || item.name || '').trim();
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
        coverUrl: formatEngineImageUrl(img, mode),
        summary: cleanText(item.summary || `${title}（${typeLabel}作品）`),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/subject/${item.id}`,
        tags,
      };
    });
  }

  if (category === 'person') {
    const res = await fetchWithTimeout(
      'https://api.bgm.tv/v0/search/persons?limit=8&offset=0',
      {
        method: 'POST',
        headers: BGM_HEADERS,
        body: JSON.stringify({ keyword: query }),
      },
      6500,
      mode,
      signal
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Record<string, any>> };
    return (json.data || []).map((item) => {
      const careerMap: Record<string, string> = {
        actor: '演员 / 声优',
        seiyu: '声优',
        director: '导演',
        producer: '制片人',
        writer: '编剧',
        artist: '音乐 / 美术',
        mangaka: '原作者',
      };
      const careers = Array.isArray(item.career)
        ? item.career
            .map((c: string) => careerMap[c] || c)
            .slice(0, 3)
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
      const img =
        item.images?.large || item.images?.medium || item.images?.grid;

      return {
        externalId: `bgm-person-${item.id}`,
        category: 'person',
        title,
        originalTitle,
        subtitle: careers.length > 0 ? careers.join(' · ') : '影视人物',
        year: extractYear(
          item.birth_year ? String(item.birth_year) : undefined
        ),
        coverUrl: formatEngineImageUrl(img, mode),
        summary: cleanText(
          item.short_summary || item.summary || `${title} 人物档案`
        ),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/person/${item.id}`,
        tags: careers.length > 0 ? careers : ['影人'],
      };
    });
  }

  const res = await fetchWithTimeout(
    'https://api.bgm.tv/v0/search/characters?limit=8&offset=0',
    {
      method: 'POST',
      headers: BGM_HEADERS,
      body: JSON.stringify({ keyword: query }),
    },
    6500,
    mode,
    signal
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<Record<string, any>> };
  return (json.data || []).map((item) => {
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
      coverUrl: formatEngineImageUrl(img, mode),
      summary: cleanText(item.summary || `${title} 角色档案`),
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/character/${item.id}`,
      tags: ['角色'],
    };
  });
}

// Source 2: Chinese Wikipedia MediaWiki API
async function searchZhWikipedia(
  query: string,
  category: ArchiveCategory,
  mode: MediaEngineMode,
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

  const res = await fetchWithTimeout(
    url,
    { headers: WIKI_HEADERS },
    6500,
    mode,
    signal
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: { pages?: Record<string, Record<string, any>> };
  };
  const pages = Object.values(data.query?.pages || {});
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
        coverUrl: formatEngineImageUrl(page.thumbnail?.source, mode),
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

// Source 3: Apple iTunes Search API (CN Storefront)
async function searchITunesCN(
  query: string,
  category: ArchiveCategory,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (category === 'character') return [];
  const entity = category === 'film' ? 'movie' : 'movieArtist';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&country=cn&lang=zh_cn&media=movie&entity=${entity}&limit=6`;

  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: 'application/json' } },
    6500,
    mode,
    signal
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: Array<Record<string, any>> };
  const results = data.results || [];

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
        sourceUrl: r.artistLinkUrl,
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
        coverUrl: formatEngineImageUrl(highResPoster, mode),
        summary: cleanText(
          r.longDescription || r.shortDescription || `${r.trackName}`
        ),
        sourceName: 'iTunes 影视库',
        sourceUrl: r.trackViewUrl,
        tags: r.primaryGenreName ? [String(r.primaryGenreName)] : ['电影'],
      };
    });
}

// Source 4: TVMaze API (Global TV series, actors & cast characters)
async function searchTVMaze(
  query: string,
  category: ArchiveCategory,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (category === 'person') {
    const res = await fetchWithTimeout(
      `https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`,
      {},
      6500,
      mode,
      signal
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ person?: Record<string, any> }>;
    return data.slice(0, 6).flatMap((entry) => {
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
          coverUrl: formatEngineImageUrl(
            p.image?.original || p.image?.medium,
            mode
          ),
          summary: cleanText(
            `${p.name}${p.country?.name ? `，来自 ${p.country.name}` : ''}${
              p.birthday ? `，生于 ${p.birthday}` : ''
            }。`
          ),
          sourceName: 'TVMaze 剧集库',
          sourceUrl: p.url,
          tags: ['剧集演员'],
        },
      ];
    });
  }

  const res = await fetchWithTimeout(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
    {},
    6500,
    mode,
    signal
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ show?: Record<string, any> }>;

  if (category === 'character') {
    const topShow = data[0]?.show;
    if (!topShow?.id) return [];
    const castRes = await fetchWithTimeout(
      `https://api.tvmaze.com/shows/${topShow.id}/cast`,
      {},
      6500,
      mode,
      signal
    );
    if (!castRes.ok) return [];
    const cast = (await castRes.json()) as Array<{
      person?: Record<string, any>;
      character?: Record<string, any>;
    }>;
    return cast.slice(0, 6).flatMap((entry) => {
      const ch = entry.character;
      const actor = entry.person;
      if (!ch?.name) return [];
      return [
        {
          externalId: `tvmaze-char-${ch.id}`,
          category: 'character',
          title: String(ch.name),
          subtitle: `出自《${topShow.name}》${
            actor?.name ? ` · 饰演者 ${actor.name}` : ''
          }`,
          year: extractYear(topShow.premiered),
          coverUrl: formatEngineImageUrl(
            ch.image?.original || ch.image?.medium || actor?.image?.medium,
            mode
          ),
          summary: cleanText(
            `剧集《${topShow.name}》中的主要角色，由 ${actor?.name || '未知演员'} 饰演。`
          ),
          relatedWorkTitle: String(topShow.name),
          portrayedBy: actor?.name ? String(actor.name) : undefined,
          sourceName: 'TVMaze 剧集库',
          sourceUrl: ch.url || topShow.url,
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
        coverUrl: formatEngineImageUrl(
          s.image?.original || s.image?.medium,
          mode
        ),
        summary: cleanText(s.summary || `${s.name} 剧集资料`),
        sourceName: 'TVMaze 剧集库',
        sourceUrl: s.url,
        tags: genres.length > 0 ? genres : ['剧集'],
      },
    ];
  });
}

function deduplicateResults(
  results: OnlineSearchResult[]
): OnlineSearchResult[] {
  const seen = new Set<string>();
  const out: OnlineSearchResult[] = [];
  for (const item of results) {
    if (!item.title) continue;
    const key = item.externalId || `${item.category}::${item.title.toLowerCase()}::${item.year || ''}::${item.sourceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchBaikeCharacterServer(
  query: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(
        query
      )}`,
      {},
      3800,
      mode,
      signal
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as Record<string, any>;
    const bundle = parseBaiduBaikeCard(payload, 'character');
    if (isPlausibleCharacterBaikeBundle(bundle, query) && bundle.searchResult) {
      return [
        {
          ...bundle.searchResult,
          coverUrl: formatEngineImageUrl(bundle.searchResult.coverUrl, mode),
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

async function searchBangumiCharactersStrictServer(
  query: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      'https://api.bgm.tv/v0/search/characters?limit=12&offset=0',
      {
        method: 'POST',
        headers: BGM_HEADERS,
        body: JSON.stringify({ keyword: query }),
      },
      4500,
      mode,
      signal
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Record<string, any>> };
    return parseBangumiCharacterSearch(json, query).map((item) => ({
      ...item,
      coverUrl: formatEngineImageUrl(item.coverUrl, mode),
    }));
  } catch {
    return [];
  }
}

async function searchMoegirlServer(
  query: string,
  category: ArchiveCategory,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  try {
    const url =
      `https://zh.moegirl.org.cn/api.php?action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=6` +
      `&prop=pageimages|extracts|info&inprop=url` +
      `&piprop=thumbnail&pithumbsize=480&exintro=1&explaintext=1&exsentences=2`;
    const res = await fetchWithTimeout(url, { headers: WIKI_HEADERS }, 4200, mode, signal);
    if (!res.ok) return [];
    const payload = (await res.json()) as Record<string, any>;
    return parseMoegirlPages(payload, category, query).map((item) => ({
      ...item,
      coverUrl: formatEngineImageUrl(item.coverUrl, mode),
    }));
  } catch {
    return [];
  }
}

async function enrichCharacterNamesServer(
  items: OnlineSearchResult[],
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  if (items.length === 0 || signal?.aborted) return items;
  const cloned = items.map((it) => ({ ...it }));
  const targets = cloned
    .filter((it) => !hasCjkChars(it.title) || !it.coverUrl)
    .slice(0, 8);
  if (targets.length === 0) return cloned;

  const CONCURRENCY = 4;
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length && !signal?.aborted) {
      const item = targets[cursor++];
      const bgmMatch = /^bgm-char-(\d+)$/.exec(item.externalId);
      if (bgmMatch && !hasCjkChars(item.title)) {
        try {
          const res = await fetchWithTimeout(
            `https://api.bgm.tv/v0/characters/${bgmMatch[1]}`,
            { headers: BGM_HEADERS },
            2800,
            mode,
            signal
          );
          if (res.ok) {
            const detail = (await res.json()) as Record<string, any>;
            if (Array.isArray(detail.infobox)) {
              const zhRow = detail.infobox.find(
                (r: any) => r?.key === '简体中文名' || r?.key === '中文名'
              );
              const zhName =
                typeof zhRow?.value === 'string'
                  ? cleanBangumiCharacterName(zhRow.value)
                  : '';
              if (zhName && hasCjkChars(zhName)) {
                if (!item.originalTitle) item.originalTitle = item.title;
                item.title = zhName;
              }
            }
            if (typeof detail.summary === 'string' && detail.summary.trim().length > 20) {
              item.summary = cleanText(detail.summary, 220);
            }
          }
        } catch {
          // Ignore individual character detail timeout
        }
      }

      if ((!hasCjkChars(item.title) || !item.coverUrl) && !signal?.aborted) {
        const lookupKey = item.title.split(/\s*[/／]\s*/)[0]?.trim() || item.title;
        const baikeHits = await fetchBaikeCharacterServer(lookupKey, mode, signal);
        const hit = baikeHits[0];
        if (hit) {
          if (!hasCjkChars(item.title) && hasCjkChars(hit.title)) {
            if (!item.originalTitle) item.originalTitle = item.title;
            item.title = hit.title;
          }
          if (!item.coverUrl && hit.coverUrl) {
            item.coverUrl = hit.coverUrl;
          }
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker())
  );
  return cloned;
}

export async function searchOnlineMedia(params: {
  query: string;
  category?: string;
  source?: string;
  mode: MediaEngineMode;
  signal?: AbortSignal;
}): Promise<MediaSearchResponse> {
  const query = params.query.trim();
  const category = normalizeCategory(params.category);
  const { mode, signal } = params;

  if (!query) {
    return {
      query: '',
      category,
      results: [],
      activeSources: [],
      failedSources: [],
    };
  }

  // Film & Person: strictly IMDb primary + Douban Chinese info assist
  if (category !== 'character') {
    const bundle = await searchImdbMedia(query, category, {
      mode,
      doubanOptions: mode === 'server' ? { transport: 'server', signal } : undefined,
      enableDoubanAssist: mode === 'server',
      signal,
    });
    const activeSources: string[] = [];
    if (bundle.results.length > 0) {
      activeSources.push(
        bundle.hasDoubanAssist
          ? 'IMDb · 豆瓣辅助'
          : bundle.hasChineseAssist
            ? 'IMDb · 中文资料'
            : 'IMDb'
      );
    }
    return {
      query,
      category,
      results: mergeBilingualResults(deduplicateResults(bundle.results)).slice(0, 22),
      activeSources,
      failedSources: [],
    };
  }

  // Character search: parallel multi-source character discovery
  const [imdbOut, baikeOut, bgmCharOut, bgmWorkOut, tvmazeOut, moegirlOut] =
    await Promise.allSettled([
      searchImdbMedia(query, 'character', {
        mode,
        doubanOptions: mode === 'server' ? { transport: 'server', signal } : undefined,
        enableDoubanAssist: mode === 'server',
        signal,
      }),
      fetchBaikeCharacterServer(query, mode, signal),
      searchBangumiCharactersStrictServer(query, mode, signal),
      (async () => {
        const subject = await resolveBangumiFilmSubject(query, undefined, mode, signal);
        if (!subject) return [] as OnlineSearchResult[];
        const rel = await fetchBangumiFilmRelations(
          subject.id,
          subject.workTitle,
          mode,
          signal,
          { isLiveAction: subject.isLiveAction }
        );
        return rel.characters;
      })(),
      (async () => {
        const res = await fetchWithTimeout(
          `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
          {},
          4200,
          mode,
          signal
        );
        if (!res.ok) return [] as OnlineSearchResult[];
        const data = (await res.json()) as Array<{ show?: Record<string, any> }>;
        const topShow = (data || [])
          .map((row) => row.show)
          .find(
            (s) => s?.id && s?.name && hasStrictTitleOverlap([String(s.name)], [query])
          );
        if (!topShow?.id) return [] as OnlineSearchResult[];
        const castRes = await fetchWithTimeout(
          `https://api.tvmaze.com/shows/${topShow.id}/cast`,
          {},
          4200,
          mode,
          signal
        );
        if (!castRes.ok) return [] as OnlineSearchResult[];
        const cast = (await castRes.json()) as Array<{
          person?: Record<string, any>;
          character?: Record<string, any>;
        }>;
        return parseTvmazeShowCharacters(topShow, cast, 16).map((item) => ({
          ...item,
          coverUrl: formatEngineImageUrl(item.coverUrl, mode),
        }));
      })(),
      searchMoegirlServer(query, 'character', mode, signal),
    ]);

  const rawChars: OnlineSearchResult[] = [];
  const activeSources: string[] = [];

  if (baikeOut.status === 'fulfilled' && baikeOut.value.length > 0) {
    activeSources.push('百度百科');
    rawChars.push(...baikeOut.value);
  }
  if (bgmCharOut.status === 'fulfilled' && bgmCharOut.value.length > 0) {
    activeSources.push('番组计划 Bangumi');
    rawChars.push(...bgmCharOut.value);
  }
  if (bgmWorkOut.status === 'fulfilled' && bgmWorkOut.value.length > 0) {
    if (!activeSources.includes('番组计划 Bangumi')) {
      activeSources.push('番组计划 Bangumi');
    }
    rawChars.push(...bgmWorkOut.value);
  }
  if (imdbOut.status === 'fulfilled' && imdbOut.value.results.length > 0) {
    activeSources.push(imdbOut.value.hasDoubanAssist ? 'IMDb · 豆瓣辅助' : 'IMDb');
    rawChars.push(...imdbOut.value.results);
  }
  if (tvmazeOut.status === 'fulfilled' && tvmazeOut.value.length > 0) {
    activeSources.push('TVMaze 剧集库');
    rawChars.push(...tvmazeOut.value);
  }
  if (moegirlOut.status === 'fulfilled' && moegirlOut.value.length > 0) {
    activeSources.push('萌娘百科');
    rawChars.push(...moegirlOut.value);
  }

  const enriched = await enrichCharacterNamesServer(rawChars, mode, signal);
  const merged = mergeBilingualResults(deduplicateResults(enriched));
  const ranked = rankCharacterResults(merged, query);

  return {
    query,
    category,
    results: ranked.slice(0, 22),
    activeSources,
    failedSources: [],
  };
}

async function searchEnWikiCovers(
  query: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<CoverCandidate[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=8` +
    `&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json&origin=*`;
  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)' } },
    6500,
    mode,
    signal
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          thumbnail?: { source?: string; width?: number; height?: number };
        }
      >;
    };
  };
  const pages = Object.values(data.query?.pages || {});
  const out: CoverCandidate[] = [];
  for (const page of pages) {
    const src = page.thumbnail?.source;
    if (!src || !isAcceptablePhoto(src)) continue;
    const formatted = formatEngineImageUrl(src, mode);
    if (!formatted) continue;
    out.push({
      id: `enwiki-${out.length}-${page.title || 'img'}`,
      url: formatted,
      source: '英文维基',
      caption: page.title || undefined,
    });
  }
  return out;
}

async function searchCommonsCovers(
  query: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<CoverCandidate[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=14` +
    `&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=640&format=json&origin=*`;
  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)' } },
    6500,
    mode,
    signal
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            thumburl?: string;
            url?: string;
            width?: number;
            height?: number;
            mime?: string;
          }>;
        }
      >;
    };
  };
  const pages = Object.values(data.query?.pages || {});
  const out: CoverCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const mime = (info.mime || '').toLowerCase();
    if (
      !mime.startsWith('image/') ||
      mime.includes('svg') ||
      mime.includes('tiff')
    ) {
      continue;
    }
    if ((info.width || 0) < 200 || (info.height || 0) < 200) continue;
    const src = info.thumburl || info.url;
    if (!src || !isAcceptablePhoto(src)) continue;
    const formatted = formatEngineImageUrl(src, mode);
    if (!formatted) continue;
    const cleanTitle = (page.title || '')
      .replace(/^File:/i, '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/_/g, ' ')
      .slice(0, 32);
    out.push({
      id: `commons-${out.length}-${cleanTitle || 'img'}`,
      url: formatted,
      source: '维基媒体',
      caption: cleanTitle || undefined,
    });
  }
  return out;
}

export async function searchCoverCandidates(params: {
  query: string;
  originalTitle?: string;
  category?: string;
  mode: MediaEngineMode;
  signal?: AbortSignal;
}): Promise<CoverSearchResponse> {
  const query = params.query.trim();
  const originalTitle = (params.originalTitle || '').trim();
  const category = normalizeCategory(params.category);
  const { mode, signal } = params;

  if (!query) {
    return { query: '', category, candidates: [] };
  }

  const searchQueries = Array.from(
    new Set([query, originalTitle].filter((s) => s.length > 0))
  );

  const tasks: Array<Promise<CoverCandidate[]>> = [];

  for (const q of searchQueries) {
    tasks.push(
      searchBangumi(q, category, mode, signal).then((items) =>
        items
          .filter((item) => Boolean(item.coverUrl))
          .map((item, idx) => ({
            id: `bgm-${q}-${idx}`,
            url: item.coverUrl!,
            source: '番组计划',
            caption: item.title,
          }))
      )
    );
    tasks.push(
      searchZhWikipedia(q, category, mode, signal).then((items) =>
        items
          .filter((item) => Boolean(item.coverUrl))
          .map((item, idx) => ({
            id: `zhwiki-${q}-${idx}`,
            url: item.coverUrl!,
            source: '中文维基',
            caption: item.title,
          }))
      )
    );
    if (category !== 'character') {
      tasks.push(
        searchITunesCN(q, category, mode, signal).then((items) =>
          items
            .filter((item) => Boolean(item.coverUrl))
            .map((item, idx) => ({
              id: `itunes-${q}-${idx}`,
              url: item.coverUrl!,
              source: 'iTunes 影视库',
              caption: item.title,
            }))
        )
      );
    }
    tasks.push(
      searchTVMaze(q, category, mode, signal).then((items) =>
        items
          .filter((item) => Boolean(item.coverUrl))
          .map((item, idx) => ({
            id: `tvmaze-${q}-${idx}`,
            url: item.coverUrl!,
            source: 'TVMaze 图库',
            caption: item.title,
          }))
      )
    );
  }

  const globalQuery = originalTitle || query;
  const priorityTasks: Array<Promise<CoverCandidate[]>> = [
    searchImdbCoverCandidates(query, category, originalTitle || undefined, {
      mode,
      signal,
    }),
    ...(mode === 'server'
      ? [
          searchDoubanCoverCandidates(
            query,
            category,
            originalTitle || undefined,
            { transport: 'server', signal }
          ),
        ]
      : []),
    searchCommonsCovers(globalQuery, mode, signal),
    searchEnWikiCovers(globalQuery, mode, signal),
  ];
  if (originalTitle && originalTitle !== query) {
    priorityTasks.push(searchCommonsCovers(query, mode, signal));
  }

  const settled = await Promise.allSettled([...priorityTasks, ...tasks]);
  const rawCandidates: CoverCandidate[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
      rawCandidates.push(...outcome.value);
    }
  }

  const candidates = rankAndFilterCoverCandidates(
    rawCandidates,
    query,
    originalTitle || undefined,
    18
  );

  return {
    query,
    category,
    candidates,
  };
}

function getWikidataCommonsThumb(
  filename: string | undefined,
  mode: MediaEngineMode,
  options?: { isCharacterFallback?: boolean }
): string | undefined {
  if (!filename || typeof filename !== 'string') return undefined;
  const clean = filename.trim().replace(/\s+/g, '_');
  if (!clean) return undefined;
  const ok = options?.isCharacterFallback
    ? isAcceptableCharacterFallbackPhoto(clean)
    : isAcceptablePhoto(clean);
  if (!ok) return undefined;
  return formatEngineImageUrl(
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
      clean
    )}?width=400`,
    mode
  );
}

function personRolePriority(rel: string): number {
  if (/导演|监督|总导演/.test(rel)) return 1;
  if (/主演|主役/.test(rel)) return 2;
  if (/编剧|脚本|系列构成/.test(rel)) return 3;
  if (/原作/.test(rel)) return 4;
  if (/音乐|配乐/.test(rel)) return 5;
  if (/配角|出演|演员/.test(rel)) return 6;
  if (/人物设定|角色设计|摄影/.test(rel)) return 7;
  return 99;
}

function isIgnoredCrewRole(rel: string): boolean {
  return /发行|制作|出品|特效|3DCG|补间|上色|剪辑|录音|音效|字幕|协力|宣传|制片公司|动画制作|播放|代理/.test(
    rel
  );
}

async function resolveBangumiFilmSubject(
  title: string,
  sourceUrl: string | undefined,
  mode: MediaEngineMode,
  signal?: AbortSignal,
  options?: { originalTitle?: string; year?: string }
): Promise<{ id: number; isLiveAction: boolean; workTitle: string } | null> {
  if (sourceUrl) {
    const m = /bgm\.tv\/subject\/(\d+)/.exec(sourceUrl);
    if (m) return { id: Number(m[1]), isLiveAction: false, workTitle: title };
  }
  try {
    const queries = Array.from(
      new Set(
        [title, options?.originalTitle]
          .map((q) => (q || '').trim())
          .filter(Boolean)
      )
    );
    for (const keyword of queries) {
      // Search type [6] (live-action) and type [2] (anime) separately so anime
      // spinoffs do not crowd out live-action films.
      const [realRes, animeRes] = await Promise.all([
        fetchWithTimeout(
          'https://api.bgm.tv/v0/search/subjects?limit=6',
          {
            method: 'POST',
            headers: BGM_HEADERS,
            body: JSON.stringify({ keyword, filter: { type: [6] } }),
          },
          4800,
          mode,
          signal
        ),
        fetchWithTimeout(
          'https://api.bgm.tv/v0/search/subjects?limit=6',
          {
            method: 'POST',
            headers: BGM_HEADERS,
            body: JSON.stringify({ keyword, filter: { type: [2] } }),
          },
          4800,
          mode,
          signal
        ),
      ]);

      const realData = realRes.ok
        ? ((await realRes.json()) as { data?: Array<Record<string, any>> }).data || []
        : [];
      const animeData = animeRes.ok
        ? ((await animeRes.json()) as { data?: Array<Record<string, any>> }).data || []
        : [];

      const realId = matchBangumiSubjectCandidate(realData as any, {
        title,
        originalTitle: options?.originalTitle,
        year: options?.year,
      });
      if (realId) {
        const hit = realData.find((d) => d.id === realId);
        return {
          id: realId,
          isLiveAction: true,
          workTitle: String(hit?.name_cn || hit?.name || title).trim(),
        };
      }

      const animeId = matchBangumiSubjectCandidate(animeData as any, {
        title,
        originalTitle: options?.originalTitle,
        year: options?.year,
      });
      if (animeId) {
        const hit = animeData.find((d) => d.id === animeId);
        return {
          id: animeId,
          isLiveAction: false,
          workTitle: String(hit?.name_cn || hit?.name || title).trim(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveBangumiId(
  category: ArchiveCategory,
  title: string,
  sourceUrl: string | undefined,
  mode: MediaEngineMode,
  signal?: AbortSignal,
  options?: { originalTitle?: string; year?: string }
): Promise<number | null> {
  if (category === 'film') {
    const resolved = await resolveBangumiFilmSubject(
      title,
      sourceUrl,
      mode,
      signal,
      options
    );
    return resolved?.id ?? null;
  }
  if (sourceUrl) {
    const m = /bgm\.tv\/(subject|person|character)\/(\d+)/.exec(sourceUrl);
    if (m) return Number(m[2]);
  }
  try {
    if (category === 'person') {
      const res = await fetchWithTimeout(
        'https://api.bgm.tv/v0/search/persons?limit=5',
        {
          method: 'POST',
          headers: BGM_HEADERS,
          body: JSON.stringify({ keyword: title }),
        },
        5500,
        mode,
        signal
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: Array<Record<string, any>> };
      const targetKey = normalizeEntityKey(title);
      const exact = (json.data || []).find((d) => {
        const candidates: string[] = [String(d.name || '')];
        if (Array.isArray(d.infobox)) {
          for (const row of d.infobox) {
            if (typeof row?.value === 'string') candidates.push(row.value);
            else if (Array.isArray(row?.value)) {
              for (const v of row.value) {
                if (typeof v?.v === 'string') candidates.push(v.v);
              }
            }
          }
        }
        return candidates.some((c) => normalizeEntityKey(c) === targetKey);
      });
      return exact?.id ?? null;
    }
    const res = await fetchWithTimeout(
      'https://api.bgm.tv/v0/search/characters?limit=6',
      {
        method: 'POST',
        headers: BGM_HEADERS,
        body: JSON.stringify({ keyword: title }),
      },
      5500,
      mode,
      signal
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<Record<string, any>> };
    return matchBangumiCharacterCandidate(json.data as any, {
      title,
      originalTitle: options?.originalTitle,
    });
  } catch {
    return null;
  }
}

async function fetchBangumiFilmRelations(
  subjectId: number,
  filmTitle: string,
  mode: MediaEngineMode,
  signal?: AbortSignal,
  options?: { isLiveAction?: boolean; workYear?: string }
): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const [pRes, cRes] = await Promise.allSettled([
    fetchWithTimeout(
      `https://api.bgm.tv/v0/subjects/${subjectId}/persons`,
      { headers: BGM_HEADERS },
      6000,
      mode,
      signal
    ).then((r) => (r.ok ? r.json() : [])),
    fetchWithTimeout(
      `https://api.bgm.tv/v0/subjects/${subjectId}/characters`,
      { headers: BGM_HEADERS },
      6000,
      mode,
      signal
    ).then((r) => (r.ok ? r.json() : [])),
  ]);

  const rawPersons =
    pRes.status === 'fulfilled' && Array.isArray(pRes.value) ? pRes.value : [];
  const rawChars =
    cRes.status === 'fulfilled' && Array.isArray(cRes.value) ? cRes.value : [];

  const personSeen = new Set<string>();
  const people: OnlineSearchResult[] = rawPersons
    .filter((p: any) => {
      const rel = String(p.relation || '');
      if (p.type && p.type !== 1) return false;
      if (isIgnoredCrewRole(rel) || !isRelevantFilmCrewRole(rel)) return false;
      return personRolePriority(rel) < 99;
    })
    .sort(
      (a: any, b: any) =>
        personRolePriority(String(a.relation || '')) -
        personRolePriority(String(b.relation || ''))
    )
    .flatMap((p: any) => {
      const name = String(p.name || '').trim();
      if (!name || personSeen.has(name)) return [];
      personSeen.add(name);
      const rel = String(p.relation || '演职员');
      const img = p.images?.large || p.images?.medium || p.images?.grid;
      return [
        {
          externalId: `bgm-person-${p.id}`,
          category: 'person' as const,
          title: name,
          subtitle: rel,
          coverUrl: formatEngineImageUrl(img, mode),
          summary: `在《${filmTitle}》中担任${rel}。`,
          relatedWorkTitle: filmTitle,
          sourceName: '番组计划 Bangumi',
          sourceUrl: `https://bgm.tv/person/${p.id}`,
          tags: [rel],
        },
      ];
    })
    .slice(0, 30);

  const sortedChars = [...rawChars].sort((a: any, b: any) => {
    const pa = a.relation === '主角' ? 0 : 1;
    const pb = b.relation === '主角' ? 0 : 1;
    return pa - pb;
  });

  const characters: OnlineSearchResult[] = parseBangumiSubjectCharacters(
    sortedChars,
    filmTitle,
    {
      workYear: options?.workYear,
      isLiveAction: Boolean(options?.isLiveAction),
      limit: 40,
    }
  ).map((ch) => ({
    ...ch,
    coverUrl: formatEngineImageUrl(ch.coverUrl, mode),
  }));

  return { people, characters };
}

async function fetchWikidataEntitiesBatch(
  ids: string[],
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<Record<string, any>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) {
    chunks.push(ids.slice(i, i + 50));
  }
  const merged: Record<string, any> = {};
  const settled = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const res = await fetchWithTimeout(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
          chunk.join('|')
        )}&props=labels|descriptions|claims|sitelinks&sitefilter=enwiki|zhwiki&languages=zh-cn|zh-hans|zh|en&format=json`,
        { headers: WIKI_HEADERS },
        6500,
        mode,
        signal
      );
      if (!res.ok) return {};
      const json = (await res.json()) as { entities?: Record<string, any> };
      return json.entities || {};
    })
  );
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      Object.assign(merged, outcome.value);
    }
  }
  return merged;
}

async function fetchWikiPageImages(
  lang: 'en' | 'zh',
  wikiTitles: string[],
  mode: MediaEngineMode,
  options: {
    allowFairUse?: boolean;
    isCharacter?: boolean;
    includeEnLanglinks?: boolean;
    excludeTitles?: string[];
  } = {},
  signal?: AbortSignal
): Promise<{ thumbs: Map<string, string>; enLanglinks: Map<string, string> }> {
  const thumbs = new Map<string, string>();
  const enLanglinks = new Map<string, string>();
  const uniqueTitles = Array.from(
    new Set(wikiTitles.map((t) => t.trim()).filter(Boolean))
  ).slice(0, 80);
  if (uniqueTitles.length === 0) return { thumbs, enLanglinks };

  const excludeSet = new Set(
    (options.excludeTitles || [])
      .map((t) => normalizeEntityKey(t))
      .filter(Boolean)
  );

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueTitles.length; i += 40) {
    chunks.push(uniqueTitles.slice(i, i + 40));
  }

  const host =
    lang === 'en' ? 'https://en.wikipedia.org' : 'https://zh.wikipedia.org';
  const prop = options.includeEnLanglinks
    ? 'pageimages|langlinks'
    : 'pageimages';
  const extraParams = [
    options.allowFairUse ? '&pilicense=any' : '',
    options.includeEnLanglinks ? '&lllang=en&lllimit=500' : '',
  ].join('');

  await Promise.allSettled(
    chunks.map(async (chunk) => {
      const res = await fetchWithTimeout(
        `${host}/w/api.php?action=query&format=json&redirects=1&prop=${prop}${extraParams}&piprop=thumbnail&pithumbsize=400&titles=${encodeURIComponent(
          chunk.join('|')
        )}`,
        { headers: WIKI_HEADERS },
        6500,
        mode,
        signal
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        query?: {
          normalized?: Array<{ from: string; to: string }>;
          redirects?: Array<{ from: string; to: string }>;
          pages?: Record<string, any>;
        };
      };

      const titleToImage = new Map<string, string>();
      const titleToEnLink = new Map<string, string>();

      for (const page of Object.values(json.query?.pages || {})) {
        if (!page || page.missing !== undefined || !page.title) continue;
        const resolvedTitle = String(page.title);

        if (
          options.isCharacter &&
          excludeSet.has(normalizeEntityKey(resolvedTitle))
        ) {
          continue;
        }

        if (options.includeEnLanglinks) {
          const enLink = page.langlinks?.[0]?.['*'];
          if (enLink) {
            titleToEnLink.set(resolvedTitle, String(enLink));
          }
        }

        const src = page?.thumbnail?.source as string | undefined;
        if (!src) continue;
        const ok = options.isCharacter
          ? isAcceptableCharacterFallbackPhoto(src) && !isFilmPosterImage(src)
          : isAcceptablePhoto(src);
        if (ok) {
          const formatted = formatEngineImageUrl(src, mode);
          if (formatted) {
            titleToImage.set(resolvedTitle, formatted);
          }
        }
      }

      const normMap = new Map<string, string>();
      for (const n of json.query?.normalized || []) {
        normMap.set(n.from, n.to);
      }
      const redirMap = new Map<string, string>();
      for (const r of json.query?.redirects || []) {
        redirMap.set(r.from, r.to);
      }

      for (const reqTitle of chunk) {
        const step1 = normMap.get(reqTitle) || reqTitle;
        const step2 = redirMap.get(step1) || step1;
        const img =
          titleToImage.get(step2) ||
          titleToImage.get(step1) ||
          titleToImage.get(reqTitle);
        if (img) thumbs.set(reqTitle, img);

        if (options.includeEnLanglinks) {
          const enL =
            titleToEnLink.get(step2) ||
            titleToEnLink.get(step1) ||
            titleToEnLink.get(reqTitle);
          if (enL) enLanglinks.set(reqTitle, enL);
        }
      }
    })
  );

  return { thumbs, enLanglinks };
}

function pickBetterCharacterImage(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return scoreCharacterImage(b) > scoreCharacterImage(a) ? b : a;
}

async function fetchWikidataFilmRelations(
  filmTitle: string,
  originalTitle: string | undefined,
  mode: MediaEngineMode,
  signal?: AbortSignal,
  options?: { sourceUrl?: string; year?: string }
): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { people: [], characters: [] };
  try {
    const targetYear = extractYearNumber(options?.year);
    const targetImdbId = extractImdbIdFromUrl(options?.sourceUrl);
    const expectedImdbTitleId =
      targetImdbId && targetImdbId.startsWith('tt') ? targetImdbId : null;

    const rawLookupTitles: Array<string | undefined> = [];
    if (targetYear) {
      rawLookupTitles.push(`${filmTitle} (${targetYear}年电影)`);
      if (originalTitle) {
        rawLookupTitles.push(`${originalTitle} (${targetYear}年电影)`);
      }
    }
    rawLookupTitles.push(filmTitle, originalTitle);
    const lookupTitles = Array.from(
      new Set(
        rawLookupTitles
          .map((t) => (t || '').trim())
          .filter(Boolean)
      )
    );

    let claims: Record<string, any> | null = null;
    const seenQids = new Set<string>();

    for (const t of lookupTitles) {
      const wpRes = await fetchWithTimeout(
        `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&variant=zh-cn&prop=pageprops&titles=${encodeURIComponent(
          t
        )}`,
        { headers: WIKI_HEADERS },
        5000,
        mode,
        signal
      );
      if (!wpRes.ok) continue;
      const wpJson = (await wpRes.json()) as {
        query?: { pages?: Record<string, any> };
      };
      const page = Object.values(wpJson.query?.pages || {})[0];
      const candQid = page?.pageprops?.wikibase_item
        ? String(page.pageprops.wikibase_item)
        : undefined;
      if (!candQid || seenQids.has(candQid)) continue;
      seenQids.add(candQid);

      const entRes = await fetchWithTimeout(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
          candQid
        )}&props=claims&format=json`,
        { headers: WIKI_HEADERS },
        5500,
        mode,
        signal
      );
      if (!entRes.ok) continue;
      const entJson = (await entRes.json()) as { entities?: Record<string, any> };
      const candClaims = entJson.entities?.[candQid]?.claims || {};

      // Reject video game / franchise / comic / novel entities that have no film cast or director
      const p31Ids: string[] = (candClaims.P31 || [])
        .map((c: any) => String(c?.mainsnak?.datavalue?.value?.id || ''))
        .filter(Boolean);
      const isNonFilmFranchise = p31Ids.some((id) =>
        ['Q7889', 'Q7058673', 'Q196600', 'Q559618', 'Q8274', 'Q21198342'].includes(id)
      );
      const hasFilmCredits =
        (candClaims.P57 && candClaims.P57.length > 0) ||
        (candClaims.P161 && candClaims.P161.length > 0);
      if (isNonFilmFranchise && !hasFilmCredits) {
        continue;
      }

      // Validate IMDb ID (P345) when known
      const wdImdbIds: string[] = (candClaims.P345 || [])
        .map((c: any) => String(c?.mainsnak?.datavalue?.value || '').trim().toLowerCase())
        .filter(Boolean);
      if (
        expectedImdbTitleId &&
        wdImdbIds.length > 0 &&
        !wdImdbIds.includes(expectedImdbTitleId)
      ) {
        continue;
      }

      // Validate publication/inception/start year (P577 / P571 / P580) when targetYear is known
      if (targetYear !== null) {
        const wdYears: number[] = [
          ...(candClaims.P577 || []),
          ...(candClaims.P571 || []),
          ...(candClaims.P580 || []),
        ]
          .map((c: any) =>
            extractYearNumber(String(c?.mainsnak?.datavalue?.value?.time || ''))
          )
          .filter((y: number | null): y is number => y !== null);
        if (
          wdYears.length > 0 &&
          !wdYears.some((y) => yearsAreCompatible(targetYear, y, 2))
        ) {
          continue;
        }
      }

      claims = candClaims;
      break;
    }

    if (!claims) return empty;

    const directorIds: string[] = (claims.P57 || [])
      .slice(0, 5)
      .map((c: any) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    const writerIds: string[] = (claims.P58 || [])
      .slice(0, 6)
      .map((c: any) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    const castEntries: Array<{ actorId: string; charId?: string }> = (
      claims.P161 || []
    )
      .slice(0, 60)
      .map((c: any) => ({
        actorId: c.mainsnak?.datavalue?.value?.id,
        charId: c.qualifiers?.P453?.[0]?.datavalue?.value?.id,
      }))
      .filter((x: any) => Boolean(x.actorId));
    const extraCharIds: string[] = (claims.P674 || [])
      .slice(0, 25)
      .map((c: any) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);

    const allCharIds = Array.from(
      new Set([
        ...castEntries
          .map((c) => c.charId)
          .filter((x): x is string => Boolean(x)),
        ...extraCharIds,
      ])
    );

    const allIds = Array.from(
      new Set([
        ...directorIds,
        ...writerIds,
        ...castEntries.map((c) => c.actorId),
        ...allCharIds,
      ])
    ).slice(0, 140);

    if (allIds.length === 0) return empty;

    const entities = await fetchWikidataEntitiesBatch(allIds, mode, signal);

    const enCharTitles: string[] = [];
    const zhCharTitles: string[] = [];
    for (const cid of allCharIds) {
      const sl = entities[cid]?.sitelinks;
      if (sl?.enwiki?.title) enCharTitles.push(String(sl.enwiki.title));
      if (sl?.zhwiki?.title) zhCharTitles.push(String(sl.zhwiki.title));
    }
    const excludeTitles = [filmTitle, originalTitle].filter(
      (t): t is string => Boolean(t)
    );
    const [enStillRes, zhStillRes] = await Promise.all([
      fetchWikiPageImages(
        'en',
        enCharTitles,
        mode,
        {
          allowFairUse: true,
          isCharacter: true,
          excludeTitles,
        },
        signal
      ),
      fetchWikiPageImages(
        'zh',
        zhCharTitles,
        mode,
        {
          allowFairUse: true,
          isCharacter: true,
          excludeTitles,
        },
        signal
      ),
    ]);

    const getMeta = (id: string, isCharacter = false) => {
      const ent = entities[id];
      const l = ent?.labels || {};
      const d = ent?.descriptions || {};
      const name =
        l['zh-cn']?.value ||
        l['zh-hans']?.value ||
        l.zh?.value ||
        l.en?.value ||
        '';
      const enName = l.en?.value;
      const desc =
        d['zh-cn']?.value ||
        d['zh-hans']?.value ||
        d.zh?.value ||
        d.en?.value ||
        '';
      const p18File = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      const enTitle = ent?.sitelinks?.enwiki?.title as string | undefined;
      const zhTitle = ent?.sitelinks?.zhwiki?.title as string | undefined;

      let coverUrl: string | undefined;
      if (isCharacter) {
        const enStill = enTitle ? enStillRes.thumbs.get(enTitle) : undefined;
        const zhStill = zhTitle ? zhStillRes.thumbs.get(zhTitle) : undefined;
        const commonsStill = getWikidataCommonsThumb(p18File, mode, {
          isCharacterFallback: true,
        });
        coverUrl = pickBetterCharacterImage(
          pickBetterCharacterImage(enStill, zhStill),
          commonsStill
        );
      } else {
        coverUrl = getWikidataCommonsThumb(p18File, mode, {
          isCharacterFallback: false,
        });
      }

      return {
        name: String(name).trim(),
        originalTitle: enName && enName !== name ? String(enName) : undefined,
        desc: String(desc).trim(),
        coverUrl,
      };
    };

    const people: OnlineSearchResult[] = [];
    const personSeen = new Set<string>();
    const pushPerson = (id: string, roleLabel: string, charName?: string) => {
      const m = getMeta(id, false);
      if (!m.name || personSeen.has(normalizeEntityKey(m.name))) return;
      personSeen.add(normalizeEntityKey(m.name));
      people.push({
        externalId: `wd-person-${id}`,
        category: 'person',
        title: m.name,
        originalTitle: m.originalTitle,
        subtitle: charName ? `演员 · 饰 ${charName}` : roleLabel,
        coverUrl: m.coverUrl,
        summary:
          m.desc ||
          `在《${filmTitle}》中担任${roleLabel}${
            charName ? `（饰演 ${charName}）` : ''
          }。`,
        relatedWorkTitle: filmTitle,
        sourceName: '维基数据 Wikidata',
        sourceUrl: `https://www.wikidata.org/wiki/${id}`,
        tags: [roleLabel],
      });
    };

    directorIds.forEach((id) => pushPerson(id, '导演'));
    writerIds.forEach((id) => pushPerson(id, '编剧'));

    const characters: OnlineSearchResult[] = [];
    const charSeen = new Set<string>();
    const pushChar = (charId: string, actorName?: string) => {
      const m = getMeta(charId, true);
      if (!m.name || charSeen.has(normalizeEntityKey(m.name))) return;
      charSeen.add(normalizeEntityKey(m.name));
      characters.push({
        externalId: `wd-char-${charId}`,
        category: 'character',
        title: m.name,
        originalTitle: m.originalTitle,
        subtitle: actorName ? `${actorName} 饰演` : '登场角色',
        coverUrl: m.coverUrl,
        summary:
          m.desc ||
          `《${filmTitle}》中的登场角色${
            actorName ? `，由 ${actorName} 饰演` : ''
          }。`,
        relatedWorkTitle: filmTitle,
        portrayedBy: actorName,
        sourceName: '维基数据 Wikidata',
        sourceUrl: `https://www.wikidata.org/wiki/${charId}`,
        tags: ['角色'],
      });
    };

    for (const c of castEntries) {
      const actorMeta = getMeta(c.actorId, false);
      const charMeta = c.charId ? getMeta(c.charId, true) : undefined;
      pushPerson(c.actorId, '演员', charMeta?.name || undefined);
      if (c.charId) {
        pushChar(c.charId, actorMeta.name || undefined);
      }
    }
    extraCharIds.forEach((cid) => pushChar(cid));

    return { people, characters };
  } catch {
    return empty;
  }
}

async function fetchZhWikiFilmRelations(
  filmTitle: string,
  originalTitle: string | undefined,
  mode: MediaEngineMode,
  signal?: AbortSignal,
  year?: string
): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { people: [], characters: [] };
  try {
    const targetYear = extractYearNumber(year);
    const rawCandidates: Array<string | undefined> = [];
    if (targetYear) {
      rawCandidates.push(`${filmTitle} (${targetYear}年电影)`);
      if (originalTitle) {
        rawCandidates.push(`${originalTitle} (${targetYear}年电影)`);
      }
    }
    rawCandidates.push(filmTitle, originalTitle);
    const candidates = Array.from(
      new Set(rawCandidates.map((t) => (t || '').trim()).filter(Boolean))
    );

    let pageTitle: string | undefined;
    let castSectionIdx: string | undefined;

    for (const title of candidates) {
      const secRes = await fetchWithTimeout(
        `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=sections&page=${encodeURIComponent(
          title
        )}`,
        { headers: WIKI_HEADERS },
        5500,
        mode,
        signal
      );
      if (!secRes.ok) continue;
      const secJson = (await secRes.json()) as {
        parse?: {
          title?: string;
          sections?: Array<{ index: string; line: string }>;
        };
      };
      const sections = secJson.parse?.sections || [];
      const match = sections.find((s) =>
        /^(演员|演员表|主要演员|演员阵容|角色|登场人物|人物|主演|配音)/.test(
          s.line.replace(/<[^>]+>/g, '').trim()
        )
      );
      if (!match || !secJson.parse?.title) continue;

      const resolvedTitle = secJson.parse.title;
      if (targetYear !== null) {
        const titleYear = extractYearNumber(resolvedTitle);
        if (titleYear !== null && !yearsAreCompatible(targetYear, titleYear, 2)) {
          continue;
        }
        if (titleYear === null) {
          // Verify lead paragraph doesn't belong to an older/different remake
          const introRes = await fetchWithTimeout(
            `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&variant=zh-cn&prop=extracts&exintro=1&explaintext=1&exsentences=2&titles=${encodeURIComponent(
              resolvedTitle
            )}`,
            { headers: WIKI_HEADERS },
            4000,
            mode,
            signal
          );
          if (introRes.ok) {
            const introJson = (await introRes.json()) as {
              query?: { pages?: Record<string, any> };
            };
            const introPage = Object.values(introJson.query?.pages || {})[0];
            const introText = String(introPage?.extract || '');
            const introYears = Array.from(
              introText.matchAll(/\b(18\d{2}|19\d{2}|20\d{2})\b/g)
            ).map((m) => Number.parseInt(m[1], 10));
            if (
              introYears.length > 0 &&
              !introYears.some((y) => yearsAreCompatible(targetYear, y, 2))
            ) {
              continue;
            }
          }
        }
      }

      pageTitle = resolvedTitle;
      castSectionIdx = match.index;
      break;
    }

    if (!pageTitle || !castSectionIdx) return empty;

    const htmlRes = await fetchWithTimeout(
      `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=text&section=${encodeURIComponent(
        castSectionIdx
      )}&page=${encodeURIComponent(pageTitle)}`,
      { headers: WIKI_HEADERS },
      6000,
      mode,
      signal
    );
    if (!htmlRes.ok) return empty;
    const htmlJson = (await htmlRes.json()) as {
      parse?: { text?: { '*'?: string } };
    };
    const html = htmlJson.parse?.text?.['*'] || '';
    if (!html) return empty;

    const castEntries = parseZhWikiCastHtml(html).slice(0, 60);
    if (castEntries.length === 0) return empty;

    const excludeTitles = [filmTitle, originalTitle, pageTitle].filter(
      (t): t is string => Boolean(t)
    );

    const [actorRes, zhCharRes] = await Promise.all([
      fetchWikiPageImages(
        'zh',
        castEntries
          .map((e) => e.actorWikiTitle)
          .filter((t): t is string => Boolean(t)),
        mode,
        { allowFairUse: false, isCharacter: false },
        signal
      ),
      fetchWikiPageImages(
        'zh',
        castEntries
          .map((e) => e.characterWikiTitle)
          .filter((t): t is string => Boolean(t)),
        mode,
        {
          allowFairUse: true,
          isCharacter: true,
          includeEnLanglinks: true,
          excludeTitles,
        },
        signal
      ),
    ]);

    const enCharLookups: string[] = [];
    const entryEnKeys = castEntries.map((entry) => {
      const keys: string[] = [];
      const langlink = entry.characterWikiTitle
        ? zhCharRes.enLanglinks.get(entry.characterWikiTitle)
        : undefined;
      if (langlink) keys.push(langlink);
      if (entry.characterOriginalName) {
        for (const part of entry.characterOriginalName.split(/[／/]/)) {
          const trimmed = part.trim();
          if (trimmed.length >= 3 && !keys.includes(trimmed)) {
            keys.push(trimmed);
          }
        }
      }
      for (const k of keys) enCharLookups.push(k);
      return keys;
    });

    const enCharRes = await fetchWikiPageImages(
      'en',
      enCharLookups,
      mode,
      {
        allowFairUse: true,
        isCharacter: true,
        excludeTitles,
      },
      signal
    );

    const people: OnlineSearchResult[] = [];
    const characters: OnlineSearchResult[] = [];

    castEntries.forEach((entry, idx) => {
      const actorPhoto = entry.actorWikiTitle
        ? actorRes.thumbs.get(entry.actorWikiTitle)
        : undefined;
      const actorWikiUrl = entry.actorWikiTitle
        ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(
            entry.actorWikiTitle
          )}`
        : `https://zh.wikipedia.org/wiki/${encodeURIComponent(pageTitle!)}`;

      const zhCharStill = entry.characterWikiTitle
        ? zhCharRes.thumbs.get(entry.characterWikiTitle)
        : undefined;
      let enCharStill: string | undefined;
      for (const enKey of entryEnKeys[idx]) {
        const hit = enCharRes.thumbs.get(enKey);
        if (hit) {
          enCharStill = pickBetterCharacterImage(enCharStill, hit);
        }
      }
      const characterStill = pickBetterCharacterImage(enCharStill, zhCharStill);

      people.push({
        externalId: `zhwiki-person-${idx}-${normalizeEntityKey(entry.actorName)}`,
        category: 'person',
        title: entry.actorName,
        subtitle: `演员 · 饰 ${entry.characterName}`,
        coverUrl: actorPhoto,
        summary: `在《${filmTitle}》中饰演 ${entry.characterName}。`,
        relatedWorkTitle: filmTitle,
        sourceName: '中文维基百科',
        sourceUrl: actorWikiUrl,
        tags: ['演员'],
      });

      characters.push({
        externalId: `zhwiki-char-${idx}-${normalizeEntityKey(entry.characterName)}`,
        category: 'character',
        title: entry.characterName,
        originalTitle: entry.characterOriginalName,
        subtitle: `${entry.actorName} 饰演`,
        coverUrl: characterStill,
        summary:
          entry.summary ||
          `《${filmTitle}》中的角色，由 ${entry.actorName} 饰演。`,
        relatedWorkTitle: filmTitle,
        portrayedBy: entry.actorName,
        sourceName: '中文维基百科',
        sourceUrl: entry.characterWikiTitle
          ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(
              entry.characterWikiTitle
            )}`
          : `https://zh.wikipedia.org/wiki/${encodeURIComponent(pageTitle!)}`,
        tags: ['角色'],
      });
    });

    return { people, characters };
  } catch {
    return empty;
  }
}

async function fetchTVMazeFilmRelations(
  filmTitle: string,
  sourceUrl: string | undefined,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
  const empty = { people: [], characters: [] };
  try {
    let showId: string | undefined;
    if (sourceUrl) {
      const m = /tvmaze\.com\/shows\/(\d+)/.exec(sourceUrl);
      if (m) showId = m[1];
    }
    if (!showId) return empty;
    const res = await fetchWithTimeout(
      `https://api.tvmaze.com/shows/${showId}/cast`,
      {},
      5500,
      mode,
      signal
    );
    if (!res.ok) return empty;
    const cast = (await res.json()) as Array<{
      person?: Record<string, any>;
      character?: Record<string, any>;
    }>;
    const people: OnlineSearchResult[] = [];
    const characters: OnlineSearchResult[] = [];
    for (const entry of cast.slice(0, 30)) {
      const p = entry.person;
      const ch = entry.character;
      if (p?.name) {
        people.push({
          externalId: `tvmaze-person-${p.id}`,
          category: 'person',
          title: String(p.name),
          subtitle: ch?.name ? `演员 · 饰 ${ch.name}` : '演员',
          coverUrl: formatEngineImageUrl(
            p.image?.medium || p.image?.original,
            mode
          ),
          summary: `在《${filmTitle}》中饰演 ${ch?.name || '主要角色'}。`,
          relatedWorkTitle: filmTitle,
          sourceName: 'TVMaze 剧集库',
          sourceUrl: p.url,
          tags: ['演员'],
        });
      }
      if (ch?.name) {
        characters.push({
          externalId: `tvmaze-char-${ch.id}`,
          category: 'character',
          title: String(ch.name),
          subtitle: p?.name ? `${p.name} 饰演` : '剧集角色',
          coverUrl: formatEngineImageUrl(
            ch.image?.medium || ch.image?.original,
            mode
          ),
          summary: `剧集《${filmTitle}》中的角色${
            p?.name ? `，由 ${p.name} 饰演` : ''
          }。`,
          relatedWorkTitle: filmTitle,
          portrayedBy: p?.name ? String(p.name) : undefined,
          sourceName: 'TVMaze 剧集库',
          sourceUrl: ch.url,
          tags: ['剧集角色'],
        });
      }
    }
    return { people, characters };
  } catch {
    return empty;
  }
}

async function fetchBangumiPersonOrCharRelations(
  category: 'person' | 'character',
  bgmId: number,
  entityTitle: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<{
  films: OnlineSearchResult[];
  people: OnlineSearchResult[];
  characters: OnlineSearchResult[];
}> {
  const films: OnlineSearchResult[] = [];
  const people: OnlineSearchResult[] = [];
  const characters: OnlineSearchResult[] = [];

  if (category === 'person') {
    const [sRes, cRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://api.bgm.tv/v0/persons/${bgmId}/subjects`,
        { headers: BGM_HEADERS },
        5500,
        mode,
        signal
      ).then((r) => (r.ok ? r.json() : [])),
      fetchWithTimeout(
        `https://api.bgm.tv/v0/persons/${bgmId}/characters`,
        { headers: BGM_HEADERS },
        5500,
        mode,
        signal
      ).then((r) => (r.ok ? r.json() : [])),
    ]);
    const rawSubs =
      sRes.status === 'fulfilled' && Array.isArray(sRes.value) ? sRes.value : [];
    const rawChars =
      cRes.status === 'fulfilled' && Array.isArray(cRes.value) ? cRes.value : [];

    for (const s of rawSubs
      .filter((x: any) => x.type === 2 || x.type === 6)
      .slice(0, 50)) {
      const title = String(s.name_cn || s.name || '').trim();
      if (!title) continue;
      films.push({
        externalId: `bgm-subj-${s.id}`,
        category: 'film',
        title,
        originalTitle:
          s.name && s.name !== title ? String(s.name) : undefined,
        subtitle: s.staff ? `${entityTitle} · ${s.staff}` : '相关影视作品',
        coverUrl: formatEngineImageUrl(s.image, mode),
        summary: `${entityTitle}参与的影视作品（${s.staff || '主创'}）。`,
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/subject/${s.id}`,
        tags: [s.type === 2 ? '动画' : '影视'],
      });
    }
    for (const c of rawChars.slice(0, 60)) {
      const title = String(c.name || '').trim();
      if (!title) continue;
      const workName = String(c.subject_name_cn || c.subject_name || '').trim();
      characters.push({
        externalId: `bgm-char-${c.id}`,
        category: 'character',
        title,
        subtitle: workName
          ? `出自《${workName}》`
          : `${entityTitle} 演绎角色`,
        coverUrl: formatEngineImageUrl(
          c.images?.large || c.images?.medium || c.images?.grid,
          mode
        ),
        summary: `由 ${entityTitle} 饰演/配音的角色${
          workName ? `（出自《${workName}》）` : ''
        }。`,
        relatedWorkTitle: workName || undefined,
        portrayedBy: entityTitle,
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/character/${c.id}`,
        tags: ['角色'],
      });
    }
    return { films, people, characters };
  }

  const [sRes, pRes] = await Promise.allSettled([
    fetchWithTimeout(
      `https://api.bgm.tv/v0/characters/${bgmId}/subjects`,
      { headers: BGM_HEADERS },
      5500,
      mode,
      signal
    ).then((r) => (r.ok ? r.json() : [])),
    fetchWithTimeout(
      `https://api.bgm.tv/v0/characters/${bgmId}/persons`,
      { headers: BGM_HEADERS },
      5500,
      mode,
      signal
    ).then((r) => (r.ok ? r.json() : [])),
  ]);
  const rawSubs =
    sRes.status === 'fulfilled' && Array.isArray(sRes.value) ? sRes.value : [];
  const rawPers =
    pRes.status === 'fulfilled' && Array.isArray(pRes.value) ? pRes.value : [];

  for (const s of rawSubs
    .filter((x: any) => x.type === 2 || x.type === 6)
    .slice(0, 8)) {
    const title = String(s.name_cn || s.name || '').trim();
    if (!title) continue;
    films.push({
      externalId: `bgm-subj-${s.id}`,
      category: 'film',
      title,
      originalTitle: s.name && s.name !== title ? String(s.name) : undefined,
      subtitle: `${entityTitle} 出场作品`,
      coverUrl: formatEngineImageUrl(s.image, mode),
      summary: `角色「${entityTitle}」登场的影视作品。`,
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/subject/${s.id}`,
      tags: [s.type === 2 ? '动画' : '影视'],
    });
  }
  for (const p of rawPers.slice(0, 6)) {
    const title = String(p.name || '').trim();
    if (!title) continue;
    people.push({
      externalId: `bgm-person-${p.id}`,
      category: 'person',
      title,
      subtitle: `饰演 / 配音 ${entityTitle}`,
      coverUrl: formatEngineImageUrl(
        p.images?.large || p.images?.medium || p.images?.grid,
        mode
      ),
      summary: `为角色「${entityTitle}」担任饰演或配音的影人。`,
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/person/${p.id}`,
      tags: ['演职员'],
    });
  }
  return { films, people, characters };
}

function mergeUniqueByTitle(
  list: OnlineSearchResult[],
  aliasMap?: Map<string, string[]>
): OnlineSearchResult[] {
  const isCharacterList = list.length > 0 && list[0].category === 'character';
  return mergeBilingualResults(list, {
    aliasMap,
    ...(isCharacterList
      ? {
          pickCover: (prev, next) => {
            if (!prev) return next;
            if (!next) return prev;
            return pickBetterCharacterImage(prev, next);
          },
        }
      : {}),
  });
}

async function enrichRelationsWithBaikeServer(
  list: OnlineSearchResult[],
  targetCategory: 'film' | 'person',
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<OnlineSearchResult[]> {
  const preMerged = mergeUniqueByTitle(list);
  if (mode !== 'server' || preMerged.length === 0 || signal?.aborted) {
    return preMerged;
  }

  const candidateIndices: number[] = [];
  for (let i = 0; i < preMerged.length && candidateIndices.length < 14; i += 1) {
    const it = preMerged[i];
    if (!hasCjkChars(it.title) || !it.coverUrl || !it.originalTitle) {
      candidateIndices.push(i);
    }
  }
  if (candidateIndices.length === 0) return preMerged;

  const cloned = preMerged.map((entry) => ({ ...entry }));
  const aliasMap = new Map<string, string[]>();

  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidateIndices.length && !signal?.aborted) {
      const idx = candidateIndices[cursor++];
      const item = cloned[idx];
      try {
        const res = await fetchWithTimeout(
          `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(
            item.title
          )}`,
          {},
          3000,
          mode,
          signal
        );
        if (!res.ok) continue;
        const payload = (await res.json()) as Record<string, any>;
        const baike = parseBaiduBaikeCard(payload, targetCategory);
        const hit = baike.searchResult;
        if (!hit) continue;

        const contextText = `${hit.subtitle || ''} ${hit.summary || ''}`;
        const hasMediaSignal =
          targetCategory === 'person'
            ? /(演员|导演|编剧|制片|影人|电影|电视剧|配音|声优|好莱坞|明星|男演员|女演员)/.test(
                contextText
              )
            : /(电影|电视剧|剧集|动画|影片|导演|主演|上映|播出)/.test(contextText);

        const plausible = !hasCjkChars(item.title)
          ? latinPersonNamesMatch(item.title, hit.originalTitle) ||
            hasStrictTitleOverlap([item.title], [hit.title, hit.originalTitle]) ||
            (hasCjkChars(hit.title) && hasMediaSignal)
          : hasStrictTitleOverlap(
              [item.title, item.originalTitle],
              [hit.title, hit.originalTitle]
            ) && (hasMediaSignal || Boolean(hit.coverUrl));

        if (!plausible) continue;

        const aliases: string[] = [];
        if (hit.originalTitle) aliases.push(hit.originalTitle);
        if (baike.characterProfile.alias) aliases.push(baike.characterProfile.alias);
        if (hit.title && hit.title !== item.title) aliases.push(hit.title);
        if (aliases.length > 0) aliasMap.set(item.externalId, aliases);

        if (!hasCjkChars(item.title) && hasCjkChars(hit.title)) {
          const prevLatin = item.title;
          item.title = hit.title;
          if (!item.originalTitle) item.originalTitle = prevLatin;
        } else if (
          hasCjkChars(item.title) &&
          !item.originalTitle &&
          hit.originalTitle &&
          !hasCjkChars(hit.originalTitle)
        ) {
          item.originalTitle = hit.originalTitle;
        }

        if (!item.coverUrl && hit.coverUrl) {
          item.coverUrl = formatEngineImageUrl(hit.coverUrl, mode);
        }
      } catch {
        // Ignore individual Baike lookup timeout
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, candidateIndices.length) },
      () => worker()
    )
  );

  return mergeUniqueByTitle(cloned, aliasMap);
}

export async function fetchOnlineRelations(params: {
  category?: string;
  title: string;
  originalTitle?: string;
  sourceUrl?: string;
  year?: string;
  mode: MediaEngineMode;
  signal?: AbortSignal;
}): Promise<OnlineRelationsResponse> {
  const category = normalizeCategory(params.category);
  const title = params.title.trim();
  const originalTitle = params.originalTitle?.trim() || undefined;
  const sourceUrl = params.sourceUrl?.trim() || undefined;
  const year = params.year?.trim() || undefined;
  const { mode, signal } = params;

  if (!title) {
    return { films: [], people: [], characters: [], sources: [] };
  }

  const sources: string[] = [];

  if (category === 'film') {
    const bgmSubject = await resolveBangumiFilmSubject(
      title,
      sourceUrl,
      mode,
      signal,
      { originalTitle, year }
    );
    const [imdbOutcome, doubanOutcome, zhWikiOutcome, wdOutcome, bgmOutcome, tvOutcome] =
      await Promise.allSettled([
        fetchImdbFilmRelations(title, originalTitle, sourceUrl, {
          mode,
          year,
          signal,
        }),
        mode === 'server'
          ? fetchDoubanFilmRelations(title, originalTitle, sourceUrl, {
              transport: 'server',
              year,
              signal,
            })
          : Promise.resolve({ people: [], characters: [] }),
        fetchZhWikiFilmRelations(title, originalTitle, mode, signal, year),
        fetchWikidataFilmRelations(title, originalTitle, mode, signal, {
          sourceUrl,
          year,
        }),
        bgmSubject
          ? fetchBangumiFilmRelations(bgmSubject.id, title, mode, signal, {
              isLiveAction: bgmSubject.isLiveAction,
              workYear: year,
            })
          : Promise.resolve({ people: [], characters: [] }),
        fetchTVMazeFilmRelations(title, sourceUrl, mode, signal),
      ]);

    const rawPeople: OnlineSearchResult[] = [];
    const rawChars: OnlineSearchResult[] = [];

    if (doubanOutcome.status === 'fulfilled') {
      if (
        doubanOutcome.value.people.length ||
        doubanOutcome.value.characters.length
      ) {
        sources.push('豆瓣影视');
      }
      rawPeople.push(...doubanOutcome.value.people);
      rawChars.push(...doubanOutcome.value.characters);
    }
    if (imdbOutcome.status === 'fulfilled') {
      if (imdbOutcome.value.people.length || imdbOutcome.value.characters.length) {
        sources.push('IMDb');
      }
      rawPeople.push(...imdbOutcome.value.people);
      rawChars.push(...imdbOutcome.value.characters);
    }
    if (wdOutcome.status === 'fulfilled') {
      if (wdOutcome.value.people.length || wdOutcome.value.characters.length) {
        sources.push('维基数据 Wikidata');
      }
      rawPeople.push(...wdOutcome.value.people);
    }
    if (zhWikiOutcome.status === 'fulfilled') {
      if (
        zhWikiOutcome.value.people.length ||
        zhWikiOutcome.value.characters.length
      ) {
        sources.push('中文维基百科');
      }
      rawPeople.push(...zhWikiOutcome.value.people);
      rawChars.push(...zhWikiOutcome.value.characters);
    }
    if (wdOutcome.status === 'fulfilled') {
      rawChars.push(...wdOutcome.value.characters);
    }
    if (bgmOutcome.status === 'fulfilled') {
      if (
        bgmOutcome.value.people.length ||
        bgmOutcome.value.characters.length
      ) {
        sources.push('番组计划 Bangumi');
      }
      rawPeople.push(...bgmOutcome.value.people);
      rawChars.push(...bgmOutcome.value.characters);
    }
    if (tvOutcome.status === 'fulfilled') {
      if (tvOutcome.value.people.length || tvOutcome.value.characters.length) {
        sources.push('TVMaze 剧集库');
      }
      rawPeople.push(...tvOutcome.value.people);
      rawChars.push(...tvOutcome.value.characters);
    }

    const [enrichedPeople, enrichedChars] = await Promise.all([
      enrichRelationsWithBaikeServer(rawPeople, 'person', mode, signal),
      enrichCharacterNamesServer(rawChars, mode, signal),
    ]);

    return {
      films: [],
      people: enrichedPeople.slice(0, 60),
      characters: mergeUniqueByTitle(enrichedChars).slice(0, 60),
      sources: Array.from(new Set(sources)),
    };
  }

  if (category === 'person') {
    const fetchZhWikiPersonRelations = async (): Promise<{
      films: OnlineSearchResult[];
      characters: OnlineSearchResult[];
    }> => {
      const empty = { films: [], characters: [] };
      try {
        let zhPageTitle: string | undefined;

        const wdMatch = sourceUrl
          ? /wikidata\.org\/wiki\/(Q\d+)/i.exec(sourceUrl)
          : null;
        if (wdMatch) {
          const wdRes = await fetchWithTimeout(
            `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdMatch[1].toUpperCase()}&props=sitelinks&sitefilter=zhwiki&format=json`,
            { headers: WIKI_HEADERS },
            4500,
            mode,
            signal
          );
          if (wdRes.ok) {
            const wdJson = (await wdRes.json()) as {
              entities?: Record<string, any>;
            };
            const sl =
              wdJson.entities?.[wdMatch[1].toUpperCase()]?.sitelinks?.zhwiki
                ?.title;
            if (sl) zhPageTitle = String(sl);
          }
        }

        if (!zhPageTitle && sourceUrl) {
          const zm = /zh\.wikipedia\.org\/wiki\/([^#?]+)/i.exec(sourceUrl);
          if (zm) {
            try {
              zhPageTitle = decodeURIComponent(zm[1]).replace(/_/g, ' ');
            } catch {
              // ignore
            }
          }
        }

        if (!zhPageTitle) {
          const qRes = await fetchWithTimeout(
            `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&titles=${encodeURIComponent(
              title
            )}`,
            { headers: WIKI_HEADERS },
            5000,
            mode,
            signal
          );
          if (qRes.ok) {
            const qJson = (await qRes.json()) as {
              query?: { pages?: Record<string, any> };
            };
            const page = Object.values(qJson.query?.pages || {}).find(
              (p: any) => p && p.missing === undefined
            ) as any;
            if (page?.title) zhPageTitle = String(page.title);
          }
        }

        if (!zhPageTitle && originalTitle) {
          const enRes = await fetchWithTimeout(
            `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=langlinks&lllang=zh&titles=${encodeURIComponent(
              originalTitle
            )}`,
            { headers: WIKI_HEADERS },
            5000,
            mode,
            signal
          );
          if (enRes.ok) {
            const enJson = (await enRes.json()) as {
              query?: { pages?: Record<string, any> };
            };
            const page = Object.values(enJson.query?.pages || {}).find(
              (p: any) => p && p.missing === undefined
            ) as any;
            const zhLink = page?.langlinks?.[0]?.['*'];
            if (zhLink) zhPageTitle = String(zhLink);
          }
        }

        if (!zhPageTitle) return empty;

        const secRes = await fetchWithTimeout(
          `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=sections&page=${encodeURIComponent(
            zhPageTitle
          )}`,
          { headers: WIKI_HEADERS },
          5500,
          mode,
          signal
        );
        if (!secRes.ok) return empty;
        const secJson = (await secRes.json()) as {
          parse?: {
            title?: string;
            sections?: Array<{ index: string; line: string; toclevel?: number }>;
          };
        };
        const canonicalTitle = secJson.parse?.title || zhPageTitle;
        const sections = secJson.parse?.sections || [];
        const targetSection = sections.find((s) =>
          /^(影视作品|演出作品|作品列表|主要作品|演艺作品|影视演出|作品|电影作品|参演作品|演出)/.test(
            s.line.replace(/<[^>]+>/g, '').trim()
          )
        );
        const filmSections = targetSection
          ? [targetSection]
          : sections
              .filter((s) =>
                /^(电影|电视剧|电视|剧集|影视)$/.test(
                  s.line.replace(/<[^>]+>/g, '').trim()
                )
              )
              .slice(0, 2);

        if (filmSections.length === 0) return empty;

        const secHtmlParts = await Promise.all(
          filmSections.map(async (sec) => {
            const r = await fetchWithTimeout(
              `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=text&section=${encodeURIComponent(
                sec.index
              )}&page=${encodeURIComponent(canonicalTitle)}`,
              { headers: WIKI_HEADERS },
              6000,
              mode,
              signal
            );
            if (!r.ok) return '';
            const j = (await r.json()) as {
              parse?: { text?: { '*'?: string } };
            };
            return j.parse?.text?.['*'] || '';
          })
        );
        let combinedHtml = secHtmlParts.join('\n');

        const subpageTitle = extractFilmographySubpageTitle(combinedHtml);
        let filmographyPageUrl = `https://zh.wikipedia.org/wiki/${encodeURIComponent(
          canonicalTitle
        )}`;
        if (subpageTitle) {
          const subRes = await fetchWithTimeout(
            `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=text&page=${encodeURIComponent(
              subpageTitle
            )}`,
            { headers: WIKI_HEADERS },
            7000,
            mode,
            signal
          );
          if (subRes.ok) {
            const subJson = (await subRes.json()) as {
              parse?: { text?: { '*'?: string } };
            };
            const subHtml = subJson.parse?.text?.['*'] || '';
            if (subHtml.length > combinedHtml.length) {
              combinedHtml = subHtml;
              filmographyPageUrl = `https://zh.wikipedia.org/wiki/${encodeURIComponent(
                subpageTitle
              )}`;
            }
          }
        }

        const rawEntries = parseZhWikiFilmographyHtml(combinedHtml);
        if (rawEntries.length === 0) return empty;

        const filmMap = new Map<string, (typeof rawEntries)[number]>();
        for (const e of rawEntries) {
          const fk = normalizeEntityKey(e.filmTitle);
          if (!fk) continue;
          const prev = filmMap.get(fk);
          if (!prev) {
            filmMap.set(fk, e);
          } else {
            if (!prev.characterName && e.characterName)
              prev.characterName = e.characterName;
            if (!prev.filmWikiTitle && e.filmWikiTitle)
              prev.filmWikiTitle = e.filmWikiTitle;
            if (!prev.year && e.year) prev.year = e.year;
          }
        }
        const sortedFilmEntries = Array.from(filmMap.values())
          .sort(
            (a, b) => (Number(b.year || '0') || 0) - (Number(a.year || '0') || 0)
          )
          .slice(0, 80);

        const aggChars = aggregatePersonCharacters(rawEntries).slice(0, 80);

        const filmZhTitles = sortedFilmEntries
          .map((e) => e.filmWikiTitle)
          .filter((t): t is string => Boolean(t));
        const charZhLookupKeys = aggChars.map((c) => {
          const keys: string[] = [];
          if (c.characterWikiTitle) keys.push(c.characterWikiTitle);
          for (const part of c.characterName.split(/[／/]/)) {
            const tr = part.trim();
            if (tr.length >= 2 && !keys.includes(tr)) keys.push(tr);
          }
          return keys;
        });
        const charZhTitles = charZhLookupKeys.flat();

        const excludeCharTitles = [
          title,
          originalTitle,
          canonicalTitle,
          ...sortedFilmEntries.map((e) => e.filmTitle),
          ...sortedFilmEntries
            .map((e) => e.filmWikiTitle)
            .filter((t): t is string => Boolean(t)),
        ].filter((t): t is string => Boolean(t));

        const [zhFilmImgRes, zhCharImgRes] = await Promise.all([
          fetchWikiPageImages(
            'zh',
            filmZhTitles,
            mode,
            {
              allowFairUse: true,
              isCharacter: false,
              includeEnLanglinks: true,
            },
            signal
          ),
          fetchWikiPageImages(
            'zh',
            charZhTitles,
            mode,
            {
              allowFairUse: true,
              isCharacter: true,
              includeEnLanglinks: true,
              excludeTitles: excludeCharTitles,
            },
            signal
          ),
        ]);

        const enFilmLookups: string[] = [];
        const filmEnKeys = sortedFilmEntries.map((e) => {
          const keys: string[] = [];
          if (e.filmWikiTitle && !zhFilmImgRes.thumbs.get(e.filmWikiTitle)) {
            const ll = zhFilmImgRes.enLanglinks.get(e.filmWikiTitle);
            if (ll) keys.push(ll);
          }
          if (!e.filmWikiTitle && e.filmOriginalTitle) {
            keys.push(e.filmOriginalTitle);
          }
          for (const k of keys) enFilmLookups.push(k);
          return keys;
        });

        const enCharLookups: string[] = [];
        const charEnKeys = aggChars.map((c, idx) => {
          const keys: string[] = [];
          for (const zk of charZhLookupKeys[idx]) {
            const ll = zhCharImgRes.enLanglinks.get(zk);
            if (ll && !keys.includes(ll)) keys.push(ll);
          }
          if (c.characterOriginalName) {
            for (const part of c.characterOriginalName.split(/[／/]/)) {
              const tr = part.trim();
              if (tr.length >= 3 && !keys.includes(tr)) keys.push(tr);
            }
          }
          for (const k of keys) enCharLookups.push(k);
          return keys;
        });

        const [enFilmImgRes, enCharImgRes] = await Promise.all([
          fetchWikiPageImages(
            'en',
            enFilmLookups,
            mode,
            {
              allowFairUse: true,
              isCharacter: false,
            },
            signal
          ),
          fetchWikiPageImages(
            'en',
            enCharLookups,
            mode,
            {
              allowFairUse: true,
              isCharacter: true,
              excludeTitles: excludeCharTitles,
            },
            signal
          ),
        ]);

        const films: OnlineSearchResult[] = sortedFilmEntries.map((e, idx) => {
          const zhImg = e.filmWikiTitle
            ? zhFilmImgRes.thumbs.get(e.filmWikiTitle)
            : undefined;
          const enImg = filmEnKeys[idx]
            .map((k) => enFilmImgRes.thumbs.get(k))
            .find(Boolean);
          const mediaLabel = e.mediaType === 'tv' ? '剧集' : '电影';
          return {
            externalId: `zhwiki-pfilm-${idx}-${normalizeEntityKey(e.filmTitle)}`,
            category: 'film',
            title: e.filmTitle,
            originalTitle: e.filmOriginalTitle,
            year: e.year,
            subtitle: [
              e.year,
              e.characterName ? `饰 ${e.characterName}` : mediaLabel,
            ]
              .filter(Boolean)
              .join(' · '),
            coverUrl: zhImg || enImg,
            summary: `${title}参演的${mediaLabel}${
              e.characterName ? `，饰演 ${e.characterName}` : ''
            }。`,
            relatedWorkTitle: title,
            sourceName: '中文维基百科',
            sourceUrl: e.filmWikiTitle
              ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(
                  e.filmWikiTitle
                )}`
              : filmographyPageUrl,
            tags: [mediaLabel],
          };
        });

        const characters: OnlineSearchResult[] = aggChars.map((c, idx) => {
          let zhStill: string | undefined;
          for (const zk of charZhLookupKeys[idx]) {
            const hit = zhCharImgRes.thumbs.get(zk);
            if (hit) zhStill = pickBetterCharacterImage(zhStill, hit);
          }
          let enStill: string | undefined;
          for (const k of charEnKeys[idx]) {
            const hit = enCharImgRes.thumbs.get(k);
            if (hit) enStill = pickBetterCharacterImage(enStill, hit);
          }
          const coverUrl = pickBetterCharacterImage(enStill, zhStill);
          const workLabel =
            c.appearances > 1
              ? `《${c.primaryFilmTitle}》等 ${c.appearances} 部作品`
              : `出自《${c.primaryFilmTitle}》`;
          return {
            externalId: `zhwiki-pchar-${idx}-${normalizeEntityKey(c.characterName)}`,
            category: 'character',
            title: c.characterName,
            originalTitle: c.characterOriginalName,
            year: c.latestYear,
            subtitle: workLabel,
            coverUrl,
            summary: `由 ${title} 饰演的角色，登场于${workLabel}。`,
            relatedWorkTitle: c.primaryFilmTitle,
            portrayedBy: title,
            sourceName: '中文维基百科',
            sourceUrl: c.characterWikiTitle
              ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(
                  c.characterWikiTitle
                )}`
              : filmographyPageUrl,
            tags: ['角色'],
          };
        });

        return { films, characters };
      } catch {
        return empty;
      }
    };

    const fetchTVMazePersonRelations = async (): Promise<{
      films: OnlineSearchResult[];
      characters: OnlineSearchResult[];
    }> => {
      const empty = { films: [], characters: [] };
      try {
        let personId: string | undefined;
        if (sourceUrl) {
          const m = /tvmaze\.com\/people\/(\d+)/.exec(sourceUrl);
          if (m) personId = m[1];
        }
        if (!personId && originalTitle) {
          const sRes = await fetchWithTimeout(
            `https://api.tvmaze.com/search/people?q=${encodeURIComponent(
              originalTitle
            )}`,
            {},
            4500,
            mode,
            signal
          );
          if (sRes.ok) {
            const list = (await sRes.json()) as Array<{
              person?: { id?: number; name?: string };
            }>;
            const hit = list.find(
              (x) =>
                x.person?.name &&
                normalizeEntityKey(x.person.name) ===
                  normalizeEntityKey(originalTitle)
            );
            if (hit?.person?.id) personId = String(hit.person.id);
          }
        }
        if (!personId) return empty;

        const cRes = await fetchWithTimeout(
          `https://api.tvmaze.com/people/${personId}/castcredits?embed[]=show&embed[]=character`,
          {},
          5000,
          mode,
          signal
        );
        if (!cRes.ok) return empty;
        const credits = (await cRes.json()) as Array<{
          _embedded?: { show?: any; character?: any };
        }>;
        const films: OnlineSearchResult[] = [];
        const characters: OnlineSearchResult[] = [];
        for (const cr of credits.slice(0, 30)) {
          const sh = cr._embedded?.show;
          const ch = cr._embedded?.character;
          if (sh?.name) {
            films.push({
              externalId: `tvmaze-show-${sh.id}`,
              category: 'film',
              title: String(sh.name),
              year: extractYear(sh.premiered),
              subtitle: ch?.name ? `剧集 · 饰 ${ch.name}` : '剧集',
              coverUrl: formatEngineImageUrl(
                sh.image?.medium || sh.image?.original,
                mode
              ),
              summary: `${title} 参演剧集《${sh.name}》。`,
              sourceName: 'TVMaze 剧集库',
              sourceUrl: sh.url,
              tags: ['剧集'],
            });
          }
          if (ch?.name) {
            characters.push({
              externalId: `tvmaze-char-${ch.id}`,
              category: 'character',
              title: String(ch.name),
              year: extractYear(sh?.premiered),
              subtitle: sh?.name ? `出自《${sh.name}》` : `${title} 饰演`,
              coverUrl: formatEngineImageUrl(
                ch.image?.medium || ch.image?.original,
                mode
              ),
              summary: `由 ${title} 饰演的剧集角色${
                sh?.name ? `（出自《${sh.name}》）` : ''
              }。`,
              relatedWorkTitle: sh?.name ? String(sh.name) : undefined,
              portrayedBy: title,
              sourceName: 'TVMaze 剧集库',
              sourceUrl: ch.url,
              tags: ['剧集角色'],
            });
          }
        }
        return { films, characters };
      } catch {
        return empty;
      }
    };

    const bgmId = await resolveBangumiId(
      'person',
      title,
      sourceUrl,
      mode,
      signal
    );
    const [imdbOutcome, doubanOutcome, zhWikiOutcome, bgmOutcome, tvOutcome] =
      await Promise.allSettled([
        fetchImdbPersonRelations(title, originalTitle, sourceUrl, {
          mode,
          signal,
        }),
        mode === 'server'
          ? fetchDoubanPersonRelations(title, originalTitle, sourceUrl, {
              transport: 'server',
              signal,
            })
          : Promise.resolve({ films: [], characters: [] }),
        fetchZhWikiPersonRelations(),
        bgmId
          ? fetchBangumiPersonOrCharRelations('person', bgmId, title, mode, signal)
          : Promise.resolve({ films: [], people: [], characters: [] }),
        fetchTVMazePersonRelations(),
      ]);

    const rawFilms: OnlineSearchResult[] = [];
    const rawChars: OnlineSearchResult[] = [];

    if (doubanOutcome.status === 'fulfilled') {
      if (
        doubanOutcome.value.films.length ||
        doubanOutcome.value.characters.length
      ) {
        sources.push('豆瓣影视');
      }
      rawFilms.push(...doubanOutcome.value.films);
      rawChars.push(...doubanOutcome.value.characters);
    }
    if (imdbOutcome.status === 'fulfilled') {
      if (imdbOutcome.value.films.length || imdbOutcome.value.characters.length) {
        sources.push('IMDb');
      }
      rawFilms.push(...imdbOutcome.value.films);
      rawChars.push(...imdbOutcome.value.characters);
    }
    if (zhWikiOutcome.status === 'fulfilled') {
      if (
        zhWikiOutcome.value.films.length ||
        zhWikiOutcome.value.characters.length
      ) {
        sources.push('中文维基百科');
      }
      rawFilms.push(...zhWikiOutcome.value.films);
      rawChars.push(...zhWikiOutcome.value.characters);
    }
    if (bgmOutcome.status === 'fulfilled') {
      if (
        bgmOutcome.value.films.length ||
        bgmOutcome.value.characters.length
      ) {
        sources.push('番组计划 Bangumi');
      }
      rawFilms.push(...bgmOutcome.value.films);
      rawChars.push(...bgmOutcome.value.characters);
    }
    if (tvOutcome.status === 'fulfilled') {
      if (tvOutcome.value.films.length || tvOutcome.value.characters.length) {
        sources.push('TVMaze 剧集库');
      }
      rawFilms.push(...tvOutcome.value.films);
      rawChars.push(...tvOutcome.value.characters);
    }

    const enrichedFilms = await enrichRelationsWithBaikeServer(
      rawFilms,
      'film',
      mode,
      signal
    );

    return {
      films: enrichedFilms.slice(0, 80),
      people: [],
      characters: mergeUniqueByTitle(rawChars).slice(0, 80),
      sources,
    };
  }

  return { films: [], people: [], characters: [], sources };
}

async function fetchZhWikiCharacterDossier(
  pageTitle: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<{
  resolvedTitle?: string;
  qid?: string;
  bio?: string;
  infobox: Partial<CharacterProfile>;
}> {
  const [extractRes, parseRes] = await Promise.allSettled([
    fetchWithTimeout(
      `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&variant=zh-cn&prop=extracts|pageprops&exintro=1&explaintext=1&exsentences=6&titles=${encodeURIComponent(
        pageTitle
      )}`,
      { headers: WIKI_HEADERS },
      6000,
      mode,
      signal
    ).then((r) => (r.ok ? r.json() : null)),
    fetchWithTimeout(
      `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=text&section=0&page=${encodeURIComponent(
        pageTitle
      )}`,
      { headers: WIKI_HEADERS },
      6000,
      mode,
      signal
    ).then((r) => (r.ok ? r.json() : null)),
  ]);

  let resolvedTitle: string | undefined;
  let qid: string | undefined;
  let bio: string | undefined;

  if (extractRes.status === 'fulfilled' && extractRes.value?.query?.pages) {
    const pages = Object.values(extractRes.value.query.pages) as Array<any>;
    const page = pages.find((p) => p && p.missing === undefined);
    if (page) {
      resolvedTitle = String(page.title || '').trim() || undefined;
      if (page.pageprops?.wikibase_item) {
        qid = String(page.pageprops.wikibase_item);
      }
      const cleaned = cleanWikiExtract(page.extract, 460);
      if (cleaned) bio = cleaned;
    }
  }

  let infobox: Partial<CharacterProfile> = {};
  if (parseRes.status === 'fulfilled' && parseRes.value?.parse?.text?.['*']) {
    infobox = parseZhWikiCharacterInfobox(String(parseRes.value.parse.text['*']));
  }

  return { resolvedTitle, qid, bio, infobox };
}

async function fetchWikidataCharacterDossier(
  qid: string,
  mode: MediaEngineMode,
  signal?: AbortSignal
): Promise<{
  zhWikiTitle?: string;
  enWikiTitle?: string;
  description?: string;
  alias?: string;
  identity?: string;
  affiliation?: string;
  origin?: string;
  abilities?: string;
  creator?: string;
}> {
  try {
    const res = await fetchWithTimeout(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
        qid
      )}&props=labels|aliases|descriptions|claims|sitelinks&sitefilter=zhwiki|enwiki&languages=zh-cn|zh-hans|zh|en&format=json`,
      { headers: WIKI_HEADERS },
      6000,
      mode,
      signal
    );
    if (!res.ok) return {};
    const json = (await res.json()) as { entities?: Record<string, any> };
    const ent = json.entities?.[qid];
    if (!ent) return {};

    const claims = ent.claims || {};
    const grabIds = (prop: string, limit = 4): string[] =>
      (claims[prop] || [])
        .slice(0, limit)
        .map((c: any) => c?.mainsnak?.datavalue?.value?.id)
        .filter((x: unknown): x is string => typeof x === 'string');

    const occupationIds = grabIds('P106', 4);
    const affiliationIds = grabIds('P463', 4);
    const originIds = [...grabIds('P19', 2), ...grabIds('P27', 2)].slice(0, 3);
    const abilityIds = grabIds('P2563', 5);
    const creatorIds = grabIds('P170', 3);

    const lookupIds = Array.from(
      new Set([
        ...occupationIds,
        ...affiliationIds,
        ...originIds,
        ...abilityIds,
        ...creatorIds,
      ])
    );

    const labelMap: Record<string, string> = {};
    if (lookupIds.length > 0) {
      const subEntities = await fetchWikidataEntitiesBatch(
        lookupIds,
        mode,
        signal
      );
      for (const id of lookupIds) {
        const l = subEntities[id]?.labels || {};
        const text =
          l['zh-cn']?.value ||
          l['zh-hans']?.value ||
          l.zh?.value ||
          l.en?.value;
        if (text) labelMap[id] = String(text).trim();
      }
    }

    const joinLabels = (ids: string[]) =>
      Array.from(new Set(ids.map((id) => labelMap[id]).filter(Boolean))).join(
        ' · '
      ) || undefined;

    const zhAliases: string[] = [
      ...(ent.aliases?.['zh-cn'] || []),
      ...(ent.aliases?.['zh-hans'] || []),
      ...(ent.aliases?.zh || []),
    ]
      .map((a: any) => String(a?.value || '').trim())
      .filter(Boolean);

    const d = ent.descriptions || {};
    const description =
      d['zh-cn']?.value ||
      d['zh-hans']?.value ||
      d.zh?.value ||
      d.en?.value ||
      undefined;

    return {
      zhWikiTitle: ent.sitelinks?.zhwiki?.title
        ? String(ent.sitelinks.zhwiki.title)
        : undefined,
      enWikiTitle: ent.sitelinks?.enwiki?.title
        ? String(ent.sitelinks.enwiki.title)
        : undefined,
      description: description ? String(description).trim() : undefined,
      alias:
        zhAliases.length > 0
          ? Array.from(new Set(zhAliases)).slice(0, 3).join(' · ')
          : undefined,
      identity: joinLabels(occupationIds),
      affiliation: joinLabels(affiliationIds),
      origin: joinLabels(originIds),
      abilities: joinLabels(abilityIds),
      creator: joinLabels(creatorIds),
    };
  } catch {
    return {};
  }
}

export async function fetchCharacterProfile(params: {
  title: string;
  originalTitle?: string;
  relatedWorkTitle?: string;
  sourceUrl?: string;
  mode: MediaEngineMode;
  signal?: AbortSignal;
}): Promise<CharacterProfileResponse> {
  const title = params.title.trim();
  const originalTitle = params.originalTitle?.trim() || undefined;
  const relatedWorkTitle = params.relatedWorkTitle?.trim() || undefined;
  const sourceUrl = params.sourceUrl?.trim() || undefined;
  const { mode, signal } = params;

  if (!title) {
    return { profile: {}, sources: [] };
  }

  const sources: string[] = [];
  const profile: Partial<CharacterProfile> = {};

  try {
    const bgmMatch = sourceUrl
      ? /bgm\.tv\/character\/(\d+)/.exec(sourceUrl)
      : null;
    if (bgmMatch) {
      const charRes = await fetchWithTimeout(
        `https://api.bgm.tv/v0/characters/${bgmMatch[1]}`,
        { headers: BGM_HEADERS },
        6000,
        mode,
        signal
      );
      if (charRes.ok) {
        const json = (await charRes.json()) as Record<string, any>;
        const parsedBox = parseBangumiCharacterInfobox(json.infobox);
        Object.assign(profile, parsedBox);
        const bio = cleanWikiExtract(json.summary, 460);
        if (bio) profile.bio = bio;
        sources.push('番组计划 Bangumi');
      }
      profile.dossierSource = sources.join(' · ') || undefined;
      return { profile, sources };
    }

    let qid: string | undefined;
    let zhWikiTitle: string | undefined;
    let enWikiTitle: string | undefined;

    const wdMatch = sourceUrl
      ? /wikidata\.org\/wiki\/(Q\d+)/i.exec(sourceUrl)
      : null;
    if (wdMatch) {
      qid = wdMatch[1].toUpperCase();
    }

    const zhWikiMatch = sourceUrl
      ? /zh\.wikipedia\.org\/wiki\/([^#?]+)/i.exec(sourceUrl)
      : null;
    if (zhWikiMatch) {
      try {
        const decoded = decodeURIComponent(zhWikiMatch[1]).replace(/_/g, ' ');
        if (!isSameEntityTitle(decoded, relatedWorkTitle)) {
          zhWikiTitle = decoded;
        }
      } catch {
        // ignore malformed URI
      }
    }

    if (!zhWikiTitle && !qid) {
      const zhCandidates = Array.from(
        new Set(
          title
            .split(/[／/]/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 2)
        )
      );
      for (const cand of zhCandidates) {
        const checkRes = await fetchWithTimeout(
          `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&prop=pageprops&titles=${encodeURIComponent(
            cand
          )}`,
          { headers: WIKI_HEADERS },
          4500,
          mode,
          signal
        );
        if (!checkRes.ok) continue;
        const checkJson = (await checkRes.json()) as {
          query?: { pages?: Record<string, any> };
        };
        const page = Object.values(checkJson.query?.pages || {}).find(
          (p: any) => p && p.missing === undefined
        ) as any;
        if (
          page?.title &&
          !isSameEntityTitle(String(page.title), relatedWorkTitle)
        ) {
          zhWikiTitle = String(page.title);
          if (page.pageprops?.wikibase_item) {
            qid = String(page.pageprops.wikibase_item);
          }
          break;
        }
      }
    }

    if (!zhWikiTitle && !qid && originalTitle) {
      const enCandidates = Array.from(
        new Set(
          originalTitle
            .split(/[／/]/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 3)
        )
      );
      for (const cand of enCandidates) {
        const checkRes = await fetchWithTimeout(
          `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops|langlinks&lllang=zh&titles=${encodeURIComponent(
            cand
          )}`,
          { headers: WIKI_HEADERS },
          4500,
          mode,
          signal
        );
        if (!checkRes.ok) continue;
        const checkJson = (await checkRes.json()) as {
          query?: { pages?: Record<string, any> };
        };
        const page = Object.values(checkJson.query?.pages || {}).find(
          (p: any) => p && p.missing === undefined
        ) as any;
        if (
          page?.title &&
          !isSameEntityTitle(String(page.title), relatedWorkTitle)
        ) {
          enWikiTitle = String(page.title);
          if (page.langlinks?.[0]?.['*']) {
            const linkedZh = String(page.langlinks[0]['*']);
            if (!isSameEntityTitle(linkedZh, relatedWorkTitle)) {
              zhWikiTitle = linkedZh;
            }
          }
          if (page.pageprops?.wikibase_item) {
            qid = String(page.pageprops.wikibase_item);
          }
          break;
        }
      }
    }

    let wdData: Awaited<ReturnType<typeof fetchWikidataCharacterDossier>> = {};
    if (qid) {
      wdData = await fetchWikidataCharacterDossier(qid, mode, signal);
      if (
        !zhWikiTitle &&
        wdData.zhWikiTitle &&
        !isSameEntityTitle(wdData.zhWikiTitle, relatedWorkTitle)
      ) {
        zhWikiTitle = wdData.zhWikiTitle;
      }
      if (
        !enWikiTitle &&
        wdData.enWikiTitle &&
        !isSameEntityTitle(wdData.enWikiTitle, relatedWorkTitle)
      ) {
        enWikiTitle = wdData.enWikiTitle;
      }
    }

    let zhData: Awaited<ReturnType<typeof fetchZhWikiCharacterDossier>> = {
      infobox: {},
    };
    if (zhWikiTitle) {
      zhData = await fetchZhWikiCharacterDossier(zhWikiTitle, mode, signal);
      if (
        zhData.resolvedTitle &&
        isSameEntityTitle(zhData.resolvedTitle, relatedWorkTitle)
      ) {
        zhData = { infobox: {} };
      } else {
        if (zhData.bio || Object.keys(zhData.infobox).length > 0) {
          sources.push('中文维基百科');
        }
        if (!qid && zhData.qid) {
          qid = zhData.qid;
          wdData = await fetchWikidataCharacterDossier(qid, mode, signal);
        }
      }
    }

    if (
      wdData.identity ||
      wdData.affiliation ||
      wdData.origin ||
      wdData.abilities ||
      wdData.creator ||
      wdData.description
    ) {
      sources.push('维基数据 Wikidata');
    }

    profile.alias = zhData.infobox.alias || wdData.alias;
    profile.identity = zhData.infobox.identity || wdData.identity;
    profile.affiliation = zhData.infobox.affiliation || wdData.affiliation;
    profile.origin = zhData.infobox.origin || wdData.origin;
    profile.abilities = zhData.infobox.abilities || wdData.abilities;
    profile.firstAppearance = zhData.infobox.firstAppearance;
    profile.creator = zhData.infobox.creator || wdData.creator;
    profile.bio = zhData.bio || wdData.description;

    if (!profile.bio && enWikiTitle) {
      const enRes = await fetchWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=extracts&exintro=1&explaintext=1&exsentences=4&titles=${encodeURIComponent(
          enWikiTitle
        )}`,
        { headers: WIKI_HEADERS },
        5000,
        mode,
        signal
      );
      if (enRes.ok) {
        const enJson = (await enRes.json()) as {
          query?: { pages?: Record<string, any> };
        };
        const page = Object.values(enJson.query?.pages || {}).find(
          (p: any) => p && p.missing === undefined
        ) as any;
        const cleaned = cleanWikiExtract(page?.extract, 420);
        if (cleaned) {
          profile.bio = cleaned;
          sources.push('English Wikipedia');
        }
      }
    }

    const uniqueSources = Array.from(new Set(sources));
    profile.dossierSource =
      uniqueSources.length > 0 ? uniqueSources.join(' · ') : undefined;

    return { profile, sources: uniqueSources };
  } catch {
    return { profile: {}, sources: [] };
  }
}
