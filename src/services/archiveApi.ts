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
  rankAndFilterCoverCandidates,
  type CoverCandidate,
} from '../utils/coverPicker';
import {
  detectInitialStaticHint,
  type RuntimeMode,
} from '../utils/runtimeEnv';
import {
  isAcceptablePhoto,
  normalizeEntityKey,
  parseZhWikiCastHtml,
} from '../utils/wikiCast';
import {
  aggregatePersonCharacters,
  parseZhWikiFilmographyHtml,
} from '../utils/wikiFilmography';

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
let modeProbePromise: Promise<RuntimeMode> | null = null;

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
  return 'server';
}

/**
 * Probes once whether the Express `/api/*` backend is available.
 * On GitHub Pages (`*.github.io`, `VITE_STATIC_MODE=true`, or `?static=1`),
 * resolves immediately to `'static'` without triggering a 404 network request.
 */
export async function detectRuntimeMode(): Promise<RuntimeMode> {
  if (cachedMode) return cachedMode;
  if (detectInitialStaticHint(getInitialSignals())) {
    cachedMode = 'static';
    return 'static';
  }
  if (modeProbePromise) return modeProbePromise;

  modeProbePromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2200);
      try {
        const res = await fetch('/api/health', {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          cachedMode = 'static';
          return 'static';
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          cachedMode = 'static';
          return 'static';
        }
        const json = (await res.json()) as { ok?: boolean };
        cachedMode = json?.ok ? 'server' : 'static';
        return cachedMode;
      } finally {
        window.clearTimeout(timer);
      }
    } catch {
      cachedMode = 'static';
      return 'static';
    }
  })();

  return modeProbePromise;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 7000
): Promise<T | null> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) return null;
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
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

function toDirectHttps(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  return /^https?:\/\//i.test(normalized) ? normalized : undefined;
}

// ---------- Direct Browser CORS Sources (GitHub Pages Static Mode) ----------

async function searchBangumiBrowser(
  query: string,
  category: ArchiveCategory
): Promise<OnlineSearchResult[]> {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (category === 'film') {
    const json = await fetchJsonWithTimeout<{ data?: Array<Record<string, any>> }>(
      'https://api.bgm.tv/v0/search/subjects?limit=8&offset=0',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ keyword: query, filter: { type: [6, 2] } }),
      }
    );
    return (json?.data || []).map((item) => {
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
        coverUrl: toDirectHttps(img),
        summary: cleanText(item.summary || `${title}（${typeLabel}作品）`),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/subject/${item.id}`,
        tags,
      };
    });
  }

  if (category === 'person') {
    const json = await fetchJsonWithTimeout<{ data?: Array<Record<string, any>> }>(
      'https://api.bgm.tv/v0/search/persons?limit=8&offset=0',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ keyword: query }),
      }
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
        coverUrl: toDirectHttps(img),
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
    }
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
      coverUrl: toDirectHttps(img),
      summary: cleanText(item.summary || `${title} 角色档案`),
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/character/${item.id}`,
      tags: ['角色'],
    };
  });
}

async function searchZhWikiBrowser(
  query: string,
  category: ArchiveCategory
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
  }>(url);
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
        coverUrl: toDirectHttps(page.thumbnail?.source),
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

async function searchTVMazeBrowser(
  query: string,
  category: ArchiveCategory
): Promise<OnlineSearchResult[]> {
  if (category === 'person') {
    const data = await fetchJsonWithTimeout<
      Array<{ person?: Record<string, any> }>
    >(`https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`);
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
          coverUrl: toDirectHttps(p.image?.original || p.image?.medium),
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

  const data = await fetchJsonWithTimeout<
    Array<{ show?: Record<string, any> }>
  >(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
  if (!data || data.length === 0) return [];

  if (category === 'character') {
    const topShow = data[0]?.show;
    if (!topShow?.id) return [];
    const cast = await fetchJsonWithTimeout<
      Array<{ person?: Record<string, any>; character?: Record<string, any> }>
    >(`https://api.tvmaze.com/shows/${topShow.id}/cast`);
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
          coverUrl: toDirectHttps(
            ch.image?.original || ch.image?.medium || actor?.image?.medium
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
        coverUrl: toDirectHttps(s.image?.original || s.image?.medium),
        summary: cleanText(s.summary || `${s.name} 剧集资料`),
        sourceName: 'TVMaze 剧集库',
        sourceUrl: s.url,
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
 * Dual-mode online search: uses Express `/api/search` when backend is live,
 * or directly queries CORS-enabled public APIs from the browser on GitHub Pages.
 */
export async function searchOnline(
  query: string,
  category: ArchiveCategory,
  source: SearchSourceOption
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

  const mode = await detectRuntimeMode();
  if (mode === 'server') {
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&category=${encodeURIComponent(
          category
        )}&source=${encodeURIComponent(source)}`
      );
      if (res.ok) {
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
    } catch {
      // Fall through to browser direct search
    }
  }

  const tasks: Array<{ name: string; promise: Promise<OnlineSearchResult[]> }> =
    [];
  if (source === 'all' || source === 'bangumi') {
    tasks.push({
      name: '番组计划 Bangumi',
      promise: searchBangumiBrowser(trimmed, category),
    });
  }
  if (source === 'all' || source === 'wiki') {
    tasks.push({
      name: '中文维基百科',
      promise: searchZhWikiBrowser(trimmed, category),
    });
  }
  if (source === 'all' || source === 'tvmaze' || source === 'itunes') {
    tasks.push({
      name: 'TVMaze 剧集库',
      promise: searchTVMazeBrowser(trimmed, category),
    });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.promise));
  const combined: OnlineSearchResult[] = [];
  const activeSources: string[] = [];

  settled.forEach((outcome, idx) => {
    if (outcome.status === 'fulfilled' && outcome.value.length > 0) {
      activeSources.push(tasks[idx].name);
      combined.push(...outcome.value);
    }
  });

  return {
    results: deduplicateSearchResults(combined).slice(0, 18),
    activeSources,
    mode: 'static',
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
  }>(url);
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
    const src = toDirectHttps(info.thumburl || info.url);
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
  }>(url);
  const pages = Object.values(data?.query?.pages || {});
  const out: CoverCandidate[] = [];
  for (const page of pages) {
    const src = toDirectHttps(page.thumbnail?.source);
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
  const tasks: Array<Promise<CoverCandidate[]>> = [
    searchCommonsCoversBrowser(globalQuery),
    searchEnWikiCoversBrowser(globalQuery),
    searchBangumiBrowser(trimmed, category).then((items) =>
      items
        .filter((it) => Boolean(it.coverUrl))
        .map((it, idx) => ({
          id: `bgm-${idx}-${it.title}`,
          url: it.coverUrl!,
          source: '番组计划',
          caption: it.title,
        }))
    ),
    searchZhWikiBrowser(trimmed, category).then((items) =>
      items
        .filter((it) => Boolean(it.coverUrl))
        .map((it, idx) => ({
          id: `zhwiki-${idx}-${it.title}`,
          url: it.coverUrl!,
          source: '中文维基',
          caption: it.title,
        }))
    ),
    searchTVMazeBrowser(trimmed, category).then((items) =>
      items
        .filter((it) => Boolean(it.coverUrl))
        .map((it, idx) => ({
          id: `tvmaze-${idx}-${it.title}`,
          url: it.coverUrl!,
          source: 'TVMaze 图库',
          caption: it.title,
        }))
    ),
  ];

  const settled = await Promise.allSettled(tasks);
  const raw: CoverCandidate[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') raw.push(...outcome.value);
  }
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

  // Browser-direct static discovery (Bangumi + Chinese Wikipedia CORS APIs)
  const films: OnlineSearchResult[] = [];
  const people: OnlineSearchResult[] = [];
  const characters: OnlineSearchResult[] = [];
  const sources: string[] = [];

  const bgmMatch = params.sourceUrl
    ? /bgm\.tv\/(subject|person)\/(\d+)/.exec(params.sourceUrl)
    : null;

  if (params.category === 'film') {
    // 1. Try Bangumi subject persons/characters if ID resolvable
    let subjectId = bgmMatch?.[1] === 'subject' ? Number(bgmMatch[2]) : null;
    if (!subjectId) {
      const searchRes = await fetchJsonWithTimeout<{
        data?: Array<{ id: number; name?: string; name_cn?: string }>;
      }>(
        'https://api.bgm.tv/v0/search/subjects?limit=3',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ keyword: params.title, filter: { type: [6, 2] } }),
          signal,
        },
        5500
      );
      const exact = searchRes?.data?.find(
        (d) =>
          String(d.name_cn || '').trim() === params.title ||
          String(d.name || '').trim() === params.title
      );
      subjectId = (exact || searchRes?.data?.[0])?.id ?? null;
    }

    if (subjectId) {
      const [bgmPersons, bgmChars] = await Promise.all([
        fetchJsonWithTimeout<Array<Record<string, any>>>(
          `https://api.bgm.tv/v0/subjects/${subjectId}/persons`,
          { signal },
          5500
        ),
        fetchJsonWithTimeout<Array<Record<string, any>>>(
          `https://api.bgm.tv/v0/subjects/${subjectId}/characters`,
          { signal },
          5500
        ),
      ]);
      if (bgmPersons?.length) {
        sources.push('番组计划 Bangumi');
        const seen = new Set<string>();
        for (const p of bgmPersons) {
          if (p.type && p.type !== 1) continue;
          const name = String(p.name || '').trim();
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const rel = String(p.relation || '演职员');
          people.push({
            externalId: `bgm-person-${p.id}`,
            category: 'person',
            title: name,
            subtitle: rel,
            coverUrl: toDirectHttps(p.images?.large || p.images?.medium),
            summary: `在《${params.title}》中担任${rel}。`,
            relatedWorkTitle: params.title,
            sourceName: '番组计划 Bangumi',
            sourceUrl: `https://bgm.tv/person/${p.id}`,
            tags: [rel],
          });
          if (people.length >= 20) break;
        }
      }
      if (bgmChars?.length) {
        if (!sources.includes('番组计划 Bangumi')) sources.push('番组计划 Bangumi');
        for (const c of bgmChars.slice(0, 24)) {
          const name = String(c.name || '').trim();
          if (!name) continue;
          const actorName = Array.isArray(c.actors)
            ? String(c.actors[0]?.name || '').trim() || undefined
            : undefined;
          const rel = String(c.relation || '角色');
          characters.push({
            externalId: `bgm-char-${c.id}`,
            category: 'character',
            title: name,
            subtitle: actorName ? `${rel} · ${actorName}` : rel,
            coverUrl: toDirectHttps(c.images?.large || c.images?.medium),
            summary: `《${params.title}》中的${rel}${actorName ? `，由 ${actorName} 饰演/配音` : ''}。`,
            relatedWorkTitle: params.title,
            portrayedBy: actorName,
            sourceName: '番组计划 Bangumi',
            sourceUrl: `https://bgm.tv/character/${c.id}`,
            tags: [rel],
          });
        }
      }
    }

    // 2. Chinese Wikipedia cast section parser (CORS native with origin=*)
    const wikiParse = await fetchJsonWithTimeout<{
      parse?: { text?: { '*'?: string } };
    }>(
      `https://zh.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&page=${encodeURIComponent(
        params.title
      )}`,
      { signal },
      6500
    );
    const html = wikiParse?.parse?.text?.['*'];
    if (html) {
      const parsedCast = parseZhWikiCastHtml(html);
      if (parsedCast.length > 0) {
        sources.push('中文维基百科');
        const seenPeople = new Set(people.map((p) => normalizeEntityKey(p.title)));
        const seenChars = new Set(characters.map((c) => normalizeEntityKey(c.title)));
        for (const entry of parsedCast.slice(0, 30)) {
          if (entry.actorName && !seenPeople.has(normalizeEntityKey(entry.actorName))) {
            seenPeople.add(normalizeEntityKey(entry.actorName));
            people.push({
              externalId: `zhwiki-actor-${entry.actorName}`,
              category: 'person',
              title: entry.actorName,
              subtitle: entry.characterName ? `饰演 ${entry.characterName}` : '演员',
              summary: `在《${params.title}》中饰演${entry.characterName || '角色'}。`,
              relatedWorkTitle: params.title,
              sourceName: '中文维基百科',
              sourceUrl: entry.actorWikiTitle
                ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(entry.actorWikiTitle)}`
                : undefined,
              tags: ['演员'],
            });
          }
          if (entry.characterName && !seenChars.has(normalizeEntityKey(entry.characterName))) {
            seenChars.add(normalizeEntityKey(entry.characterName));
            characters.push({
              externalId: `zhwiki-char-${entry.characterName}`,
              category: 'character',
              title: entry.characterName,
              subtitle: entry.actorName ? `角色 · ${entry.actorName}` : '影视角色',
              summary: `《${params.title}》中的角色${entry.actorName ? `，由 ${entry.actorName} 饰演` : ''}。`,
              relatedWorkTitle: params.title,
              portrayedBy: entry.actorName || undefined,
              sourceName: '中文维基百科',
              sourceUrl: entry.characterWikiTitle
                ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(entry.characterWikiTitle)}`
                : undefined,
              tags: ['角色'],
            });
          }
        }
      }
    }
  } else {
    // Person filmography & characters from Chinese Wikipedia (CORS native)
    const wikiParse = await fetchJsonWithTimeout<{
      parse?: { text?: { '*'?: string } };
    }>(
      `https://zh.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&page=${encodeURIComponent(
        params.title
      )}`,
      { signal },
      6500
    );
    const html = wikiParse?.parse?.text?.['*'];
    if (html) {
      const filmography = parseZhWikiFilmographyHtml(html);
      if (filmography.length > 0) {
        sources.push('中文维基百科');
        const seenFilms = new Set<string>();
        for (const row of filmography) {
          const key = normalizeEntityKey(row.filmTitle);
          if (!key || seenFilms.has(key)) continue;
          seenFilms.add(key);
          films.push({
            externalId: `zhwiki-work-${row.filmTitle}-${row.year || ''}`,
            category: 'film',
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
          });
          if (films.length >= 30) break;
        }

        const aggregatedChars = aggregatePersonCharacters(filmography);
        for (const ch of aggregatedChars.slice(0, 24)) {
          characters.push({
            externalId: `zhwiki-pchar-${ch.characterName}`,
            category: 'character',
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
          });
        }
      }
    }
  }

  return { films, people, characters, sources };
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

  // Direct browser-side enrichment via Chinese Wikipedia + Bangumi
  const profile: Partial<CharacterProfile> = {};
  const sources: string[] = [];

  const bgmCharMatch = params.sourceUrl
    ? /bgm\.tv\/character\/(\d+)/.exec(params.sourceUrl)
    : null;
  if (bgmCharMatch) {
    const bgmChar = await fetchJsonWithTimeout<Record<string, any>>(
      `https://api.bgm.tv/v0/characters/${bgmCharMatch[1]}`,
      { signal },
      5500
    );
    if (bgmChar) {
      const parsedBgm = parseBangumiCharacterInfobox(
        Array.isArray(bgmChar.infobox) ? bgmChar.infobox : []
      );
      Object.assign(profile, parsedBgm);
      if (typeof bgmChar.summary === 'string' && bgmChar.summary.trim() && !profile.bio) {
        profile.bio = cleanWikiExtract(bgmChar.summary);
      }
      sources.push('番组计划 Bangumi');
    }
  }

  const [wikiParse, wikiExtract] = await Promise.all([
    fetchJsonWithTimeout<{ parse?: { text?: { '*'?: string } } }>(
      `https://zh.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&page=${encodeURIComponent(
        params.title
      )}`,
      { signal },
      6000
    ),
    fetchJsonWithTimeout<{
      query?: { pages?: Record<string, { extract?: string }> };
    }>(
      `https://zh.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(
        params.title
      )}`,
      { signal },
      6000
    ),
  ]);

  const html = wikiParse?.parse?.text?.['*'];
  if (html) {
    const parsedInfo = parseZhWikiCharacterInfobox(html);
    for (const [k, v] of Object.entries(parsedInfo)) {
      if (v && !(profile as Record<string, unknown>)[k]) {
        (profile as Record<string, unknown>)[k] = v;
      }
    }
    if (Object.keys(parsedInfo).length > 0) {
      sources.push('中文维基百科');
    }
  }

  const pages = Object.values(wikiExtract?.query?.pages || {});
  const extract = cleanWikiExtract(pages[0]?.extract || '');
  if (extract && !profile.bio) {
    profile.bio = extract;
    if (!sources.includes('中文维基百科')) sources.push('中文维基百科');
  }

  if (sources.length > 0) {
    profile.dossierSource = sources.join(' · ');
  }

  return { profile, sources };
}
