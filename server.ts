import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isAcceptableCharacterFallbackPhoto,
  isAcceptablePhoto,
  isFilmPosterImage,
  normalizeEntityKey,
  parseZhWikiCastHtml,
  scoreCharacterImage,
} from './src/utils/wikiCast.ts';
import {
  cleanWikiExtract,
  isSameEntityTitle,
  parseBangumiCharacterInfobox,
  parseZhWikiCharacterInfobox,
} from './src/utils/characterProfile.ts';
import {
  aggregatePersonCharacters,
  extractFilmographySubpageTitle,
  parseZhWikiFilmographyHtml,
} from './src/utils/wikiFilmography.ts';
import {
  rankAndFilterCoverCandidates,
  type CoverCandidate,
} from './src/utils/coverPicker.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(__dirname, 'data');
const COLLECTION_FILE = path.join(DATA_DIR, 'collection.json');
const COLLECTOR_FILE = path.join(DATA_DIR, 'collector.json');

interface ServerArchiveItem {
  id: string;
  accessionNo: string;
  category: 'film' | 'person' | 'character';
  title: string;
  originalTitle?: string;
  subtitle?: string;
  year?: string;
  region?: string;
  coverUrl?: string;
  summary: string;
  quote?: string;
  notes: string;
  rating: number;
  status: 'favorite' | 'watched' | 'watching' | 'watchlist';
  tags: string[];
  relatedIds: string[];
  relatedWorkTitle?: string;
  portrayedBy?: string;
  characterProfile?: Record<string, any>;
  sourceName?: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface OnlineSearchResult {
  externalId: string;
  category: 'film' | 'person' | 'character';
  title: string;
  originalTitle?: string;
  subtitle?: string;
  year?: string;
  region?: string;
  coverUrl?: string;
  summary: string;
  relatedWorkTitle?: string;
  portrayedBy?: string;
  sourceName: string;
  sourceUrl?: string;
  tags: string[];
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStoredCollection(): ServerArchiveItem[] | null {
  try {
    if (!fs.existsSync(COLLECTION_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(COLLECTION_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as ServerArchiveItem[];
    }
    if (Array.isArray(parsed?.items)) {
      return parsed.items as ServerArchiveItem[];
    }
    return null;
  } catch (err) {
    console.error('[collection] Failed to read collection file:', err);
    return null;
  }
}

function writeStoredCollection(items: ServerArchiveItem[]): void {
  ensureDataDir();
  fs.writeFileSync(
    COLLECTION_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2),
    'utf-8'
  );
}

interface ServerCollectorState {
  checkInDates: string[];
  albums: Array<{
    id: string;
    name: string;
    description?: string;
    tag?: string;
    itemIds?: string[];
    targetCount: number;
    createdAt: string;
  }>;
}

function readStoredCollectorState(): ServerCollectorState {
  try {
    if (!fs.existsSync(COLLECTOR_FILE)) {
      return { checkInDates: [], albums: [] };
    }
    const raw = fs.readFileSync(COLLECTOR_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      checkInDates: Array.isArray(parsed?.checkInDates)
        ? parsed.checkInDates.filter((d: unknown): d is string => typeof d === 'string')
        : [],
      albums: Array.isArray(parsed?.albums) ? parsed.albums : [],
    };
  } catch {
    return { checkInDates: [], albums: [] };
  }
}

function writeStoredCollectorState(state: ServerCollectorState): void {
  ensureDataDir();
  fs.writeFileSync(
    COLLECTOR_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2),
    'utf-8'
  );
}

function toProxiedImage(rawUrl?: string | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/api/img-proxy') || trimmed.startsWith('/src/assets/')) {
    return trimmed;
  }
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(normalized)) return undefined;
  return `/api/img-proxy?url=${encodeURIComponent(normalized)}`;
}

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (/^10\./.test(lower) || /^192\.168\./.test(lower) || /^169\.254\./.test(lower)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) {
    return true;
  }
  return false;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 6500
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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

// Source 1: Bangumi (番组计划) — Native Chinese API for Movies/TV, People, Characters
async function searchBangumi(
  query: string,
  category: 'film' | 'person' | 'character'
): Promise<OnlineSearchResult[]> {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)',
    Accept: 'application/json',
  };

  if (category === 'film') {
    const res = await fetchWithTimeout(
      'https://api.bgm.tv/v0/search/subjects?limit=8&offset=0',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          keyword: query,
          filter: { type: [6, 2] }, // 6 = Real/影视剧, 2 = Anime/动画
        }),
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Record<string, any>> };
    return (json.data || []).map((item) => {
      const title = (item.name_cn || item.name || '').trim();
      const originalTitle =
        item.name && item.name !== title ? String(item.name) : undefined;
      const img =
        item.images?.large || item.images?.common || item.images?.medium || item.image;
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
        subtitle: item.score ? `${typeLabel} · Bangumi ${Number(item.score).toFixed(1)}` : typeLabel,
        year: extractYear(item.date),
        coverUrl: toProxiedImage(img),
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
        headers,
        body: JSON.stringify({ keyword: query }),
      }
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
        year: extractYear(item.birth_year ? String(item.birth_year) : undefined),
        coverUrl: toProxiedImage(img),
        summary: cleanText(item.short_summary || item.summary || `${title} 人物档案`),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/person/${item.id}`,
        tags: careers.length > 0 ? careers : ['影人'],
      };
    });
  }

  // Characters
  const res = await fetchWithTimeout(
    'https://api.bgm.tv/v0/search/characters?limit=8&offset=0',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ keyword: query }),
    }
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
      coverUrl: toProxiedImage(img),
      summary: cleanText(item.summary || `${title} 角色档案`),
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/character/${item.id}`,
      tags: ['角色'],
    };
  });
}

// Source 2: Chinese Wikipedia MediaWiki API (proxied via server, works without VPN!)
async function searchZhWikipedia(
  query: string,
  category: 'film' | 'person' | 'character'
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

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'CineArchive/1.0 (contact@cinearchive.local)',
      Accept: 'application/json',
    },
  });
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
        subtitle: cleanText(page.description || (category === 'film' ? '影视条目' : category === 'person' ? '影人词条' : '角色词条'), 50),
        year: extractYear(summary),
        coverUrl: toProxiedImage(page.thumbnail?.source),
        summary: summary || `${page.title}（中文维基百科词条）`,
        sourceName: '中文维基百科',
        sourceUrl: page.fullurl || `https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        tags: [category === 'film' ? '影视' : category === 'person' ? '影人' : '角色'],
      };
    });
}

// Source 3: Apple iTunes Search API (CN Storefront — fast, Chinese metadata + high-res posters)
async function searchITunesCN(
  query: string,
  category: 'film' | 'person' | 'character'
): Promise<OnlineSearchResult[]> {
  if (category === 'character') return [];
  const entity = category === 'film' ? 'movie' : 'movieArtist';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&country=cn&lang=zh_cn&media=movie&entity=${entity}&limit=6`;

  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });
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
        subtitle: r.primaryGenreName ? `影人 · ${r.primaryGenreName}` : '影视创作者',
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
        coverUrl: toProxiedImage(highResPoster),
        summary: cleanText(r.longDescription || r.shortDescription || `${r.trackName}`),
        sourceName: 'iTunes 影视库',
        sourceUrl: r.trackViewUrl,
        tags: r.primaryGenreName ? [String(r.primaryGenreName)] : ['电影'],
      };
    });
}

// Source 4: TVMaze API (Global TV series, actors & cast characters)
async function searchTVMaze(
  query: string,
  category: 'film' | 'person' | 'character'
): Promise<OnlineSearchResult[]> {
  if (category === 'person') {
    const res = await fetchWithTimeout(
      `https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`
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
          coverUrl: toProxiedImage(p.image?.original || p.image?.medium),
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
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ show?: Record<string, any> }>;

  if (category === 'character') {
    // Pull cast characters from the top matching show
    const topShow = data[0]?.show;
    if (!topShow?.id) return [];
    const castRes = await fetchWithTimeout(
      `https://api.tvmaze.com/shows/${topShow.id}/cast`
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
          subtitle: `出自《${topShow.name}》${actor?.name ? ` · 饰演者 ${actor.name}` : ''}`,
          year: extractYear(topShow.premiered),
          coverUrl: toProxiedImage(
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
        coverUrl: toProxiedImage(s.image?.original || s.image?.medium),
        summary: cleanText(s.summary || `${s.name} 剧集资料`),
        sourceName: 'TVMaze 剧集库',
        sourceUrl: s.url,
        tags: genres.length > 0 ? genres : ['剧集'],
      },
    ];
  });
}

function deduplicateResults(results: OnlineSearchResult[]): OnlineSearchResult[] {
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

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // 1. Health & direct-link info
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, mode: 'direct-proxy' });
  });

  // 2. Collection REST API (Server-side JSON persistence)
  app.get('/api/collection', (_req: Request, res: Response) => {
    const stored = readStoredCollection();
    res.json({
      initialized: stored !== null,
      items: stored ?? [],
    });
  });

  app.post('/api/collection/init', (req: Request, res: Response) => {
    const existing = readStoredCollection();
    if (existing !== null) {
      res.json({ items: existing });
      return;
    }
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as ServerArchiveItem[])
      : [];
    writeStoredCollection(items);
    res.json({ items });
  });

  app.post('/api/collection', (req: Request, res: Response) => {
    const item = req.body as ServerArchiveItem;
    if (!item || !item.id || !item.title || !item.category) {
      res.status(400).json({ error: '缺少必填字段（id / title / category）' });
      return;
    }
    const items = readStoredCollection() ?? [];
    const next = [item, ...items.filter((i) => i.id !== item.id)];
    writeStoredCollection(next);
    res.status(201).json({ item, items: next });
  });

  app.put('/api/collection/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const patch = req.body as Partial<ServerArchiveItem>;
    const items = readStoredCollection() ?? [];
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) {
      res.status(404).json({ error: '未找到对应的馆藏条目' });
      return;
    }
    const updated: ServerArchiveItem = {
      ...items[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    if (patch.coverUrl === '' || patch.coverUrl === null) {
      delete updated.coverUrl;
    }
    const next = [...items];
    next[index] = updated;
    writeStoredCollection(next);
    res.json({ item: updated, items: next });
  });

  app.delete('/api/collection/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const items = readStoredCollection() ?? [];
    const next = items
      .filter((i) => i.id !== id)
      .map((i) => ({
        ...i,
        relatedIds: Array.isArray(i.relatedIds)
          ? i.relatedIds.filter((rid) => rid !== id)
          : [],
      }));
    writeStoredCollection(next);
    res.json({ items: next });
  });

  app.post('/api/collection/replace', (req: Request, res: Response) => {
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as ServerArchiveItem[])
      : null;
    if (!items) {
      res.status(400).json({ error: '无效的馆藏数据' });
      return;
    }
    writeStoredCollection(items);
    res.json({ items });
  });

  // 2b. Collector Rituals & Custom Albums API (check-in streak + themed collector sets)
  app.get('/api/collector', (_req: Request, res: Response) => {
    res.json(readStoredCollectorState());
  });

  app.put('/api/collector', (req: Request, res: Response) => {
    const checkInDates = Array.isArray(req.body?.checkInDates)
      ? (req.body.checkInDates as unknown[]).filter(
          (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
        )
      : [];
    const albums = Array.isArray(req.body?.albums)
      ? req.body.albums.filter(
          (a: unknown): a is ServerCollectorState['albums'][number] =>
            Boolean(
              a &&
                typeof a === 'object' &&
                typeof (a as { id?: unknown }).id === 'string' &&
                typeof (a as { name?: unknown }).name === 'string'
            )
        )
      : [];
    const next: ServerCollectorState = {
      checkInDates: Array.from(new Set(checkInDates)).sort(),
      albums,
    };
    writeStoredCollectorState(next);
    res.json(next);
  });

  // 3. Direct Online Multi-Source Search (No VPN needed on client!)
  app.get('/api/search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    const rawCat = String(req.query.category || 'film');
    const category: 'film' | 'person' | 'character' =
      rawCat === 'person' || rawCat === 'character' ? rawCat : 'film';
    const source = String(req.query.source || 'all');

    if (!query) {
      res.status(400).json({ error: '请输入搜索关键词', results: [] });
      return;
    }

    const tasks: Array<{ name: string; promise: Promise<OnlineSearchResult[]> }> = [];

    if (source === 'all' || source === 'bangumi') {
      tasks.push({ name: '番组计划 Bangumi', promise: searchBangumi(query, category) });
    }
    if (source === 'all' || source === 'wiki') {
      tasks.push({ name: '中文维基百科', promise: searchZhWikipedia(query, category) });
    }
    if ((source === 'all' || source === 'itunes') && category !== 'character') {
      tasks.push({ name: 'iTunes 影视库', promise: searchITunesCN(query, category) });
    }
    if (source === 'all' || source === 'tvmaze') {
      tasks.push({ name: 'TVMaze 剧集库', promise: searchTVMaze(query, category) });
    }

    const settled = await Promise.allSettled(tasks.map((t) => t.promise));
    const combined: OnlineSearchResult[] = [];
    const activeSources: string[] = [];
    const failedSources: string[] = [];

    settled.forEach((outcome, idx) => {
      const name = tasks[idx].name;
      if (outcome.status === 'fulfilled') {
        if (outcome.value.length > 0) {
          activeSources.push(name);
          combined.push(...outcome.value);
        }
      } else {
        failedSources.push(name);
      }
    });

    const results = deduplicateResults(combined).slice(0, 18);
    res.json({
      query,
      category,
      results,
      activeSources,
      failedSources,
    });
  });

  // 3.2. Multi-Source Cover Image Candidate Search (VPN-free)
  async function searchEnWikiCovers(query: string): Promise<CoverCandidate[]> {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=8` +
      `&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json&origin=*`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          { title?: string; thumbnail?: { source?: string; width?: number; height?: number } }
        >;
      };
    };
    const pages = Object.values(data.query?.pages || {});
    const out: CoverCandidate[] = [];
    for (const page of pages) {
      const src = page.thumbnail?.source;
      if (!src || !isAcceptablePhoto(src)) continue;
      const proxied = toProxiedImage(src);
      if (!proxied) continue;
      out.push({
        id: `enwiki-${out.length}-${page.title || 'img'}`,
        url: proxied,
        source: '英文维基',
        caption: page.title || undefined,
      });
    }
    return out;
  }

  async function searchCommonsCovers(query: string): Promise<CoverCandidate[]> {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
      `&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=14` +
      `&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=640&format=json&origin=*`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)' },
    });
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
      if (!mime.startsWith('image/') || mime.includes('svg') || mime.includes('tiff')) {
        continue;
      }
      if ((info.width || 0) < 200 || (info.height || 0) < 200) continue;
      const src = info.thumburl || info.url;
      if (!src || !isAcceptablePhoto(src)) continue;
      const proxied = toProxiedImage(src);
      if (!proxied) continue;
      const cleanTitle = (page.title || '')
        .replace(/^File:/i, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/_/g, ' ')
        .slice(0, 32);
      out.push({
        id: `commons-${out.length}-${cleanTitle || 'img'}`,
        url: proxied,
        source: '维基媒体',
        caption: cleanTitle || undefined,
      });
    }
    return out;
  }

  app.get('/api/cover-search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    const originalTitle = String(req.query.originalTitle || '').trim();
    const rawCat = String(req.query.category || 'film');
    const category: 'film' | 'person' | 'character' =
      rawCat === 'person' || rawCat === 'character' ? rawCat : 'film';

    if (!query) {
      res.status(400).json({ error: '请输入封面搜索关键词', candidates: [] });
      return;
    }

    const searchQueries = Array.from(
      new Set([query, originalTitle].filter((s) => s.length > 0))
    );

    const tasks: Array<Promise<CoverCandidate[]>> = [];

    for (const q of searchQueries) {
      tasks.push(
        searchBangumi(q, category).then((items) =>
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
        searchZhWikipedia(q, category).then((items) =>
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
          searchITunesCN(q, category).then((items) =>
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
        searchTVMaze(q, category).then((items) =>
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

    // Prefer English/original name for Wikimedia & EnWiki first for high-res photos
    const globalQuery = originalTitle || query;
    const priorityTasks: Array<Promise<CoverCandidate[]>> = [
      searchCommonsCovers(globalQuery),
      searchEnWikiCovers(globalQuery),
    ];
    if (originalTitle && originalTitle !== query) {
      priorityTasks.push(searchCommonsCovers(query));
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
    res.json({
      query,
      category,
      candidates,
    });
  });

  // 3.5. Cross-Entity Relations Discovery (Film <-> People <-> Characters, VPN-free!)
  const BGM_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'CineArchive/1.0 (https://cinearchive.local)',
    Accept: 'application/json',
  };

  const WIKI_HEADERS = {
    'User-Agent': 'CineArchive/1.0 (contact@cinearchive.local)',
    Accept: 'application/json',
  };

  function getWikidataCommonsThumb(
    filename?: string,
    options?: { isCharacterFallback?: boolean }
  ): string | undefined {
    if (!filename || typeof filename !== 'string') return undefined;
    const clean = filename.trim().replace(/\s+/g, '_');
    if (!clean) return undefined;
    const ok = options?.isCharacterFallback
      ? isAcceptableCharacterFallbackPhoto(clean)
      : isAcceptablePhoto(clean);
    if (!ok) return undefined;
    return toProxiedImage(
      `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        clean
      )}?width=400`
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

  async function resolveBangumiId(
    category: 'film' | 'person' | 'character',
    title: string,
    sourceUrl?: string
  ): Promise<number | null> {
    if (sourceUrl) {
      const m = /bgm\.tv\/(subject|person|character)\/(\d+)/.exec(sourceUrl);
      if (m) return Number(m[2]);
    }
    try {
      if (category === 'film') {
        const res = await fetchWithTimeout(
          'https://api.bgm.tv/v0/search/subjects?limit=3',
          {
            method: 'POST',
            headers: BGM_HEADERS,
            body: JSON.stringify({ keyword: title, filter: { type: [6, 2] } }),
          },
          5500
        );
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: Array<Record<string, any>> };
        const exact = json.data?.find(
          (d) =>
            String(d.name_cn || '').trim() === title ||
            String(d.name || '').trim() === title
        );
        return (exact || json.data?.[0])?.id ?? null;
      }
      if (category === 'person') {
        const res = await fetchWithTimeout(
          'https://api.bgm.tv/v0/search/persons?limit=5',
          {
            method: 'POST',
            headers: BGM_HEADERS,
            body: JSON.stringify({ keyword: title }),
          },
          5500
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
        'https://api.bgm.tv/v0/search/characters?limit=3',
        {
          method: 'POST',
          headers: BGM_HEADERS,
          body: JSON.stringify({ keyword: title }),
        },
        5500
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: Array<Record<string, any>> };
      return json.data?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  async function fetchBangumiFilmRelations(
    subjectId: number,
    filmTitle: string
  ): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
    const [pRes, cRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://api.bgm.tv/v0/subjects/${subjectId}/persons`,
        { headers: BGM_HEADERS },
        6000
      ).then((r) => (r.ok ? r.json() : [])),
      fetchWithTimeout(
        `https://api.bgm.tv/v0/subjects/${subjectId}/characters`,
        { headers: BGM_HEADERS },
        6000
      ).then((r) => (r.ok ? r.json() : [])),
    ]);

    const rawPersons =
      pRes.status === 'fulfilled' && Array.isArray(pRes.value) ? pRes.value : [];
    const rawChars =
      cRes.status === 'fulfilled' && Array.isArray(cRes.value) ? cRes.value : [];

    // Deduplicate & sort persons by creative role priority
    const personSeen = new Set<string>();
    const people: OnlineSearchResult[] = rawPersons
      .filter((p: any) => {
        const rel = String(p.relation || '');
        // type 1 = individual person in Bangumi (2 = company, 3 = group)
        if (p.type && p.type !== 1) return false;
        if (isIgnoredCrewRole(rel)) return false;
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
            coverUrl: toProxiedImage(img),
            summary: `在《${filmTitle}》中担任${rel}。`,
            relatedWorkTitle: filmTitle,
            sourceName: '番组计划 Bangumi',
            sourceUrl: `https://bgm.tv/person/${p.id}`,
            tags: [rel],
          },
        ];
      })
      .slice(0, 30);

    // Characters sorted by 主角 first
    const characters: OnlineSearchResult[] = rawChars
      .sort((a: any, b: any) => {
        const pa = a.relation === '主角' ? 0 : 1;
        const pb = b.relation === '主角' ? 0 : 1;
        return pa - pb;
      })
      .slice(0, 40)
      .flatMap((c: any) => {
        const name = String(c.name || '').trim();
        if (!name) return [];
        const actor = Array.isArray(c.actors) ? c.actors[0] : undefined;
        const actorName = actor?.name ? String(actor.name).trim() : undefined;
        const rel = String(c.relation || '角色');
        const img = c.images?.large || c.images?.medium || c.images?.grid;
        return [
          {
            externalId: `bgm-char-${c.id}`,
            category: 'character' as const,
            title: name,
            subtitle: actorName ? `${rel} · ${actorName}` : rel,
            coverUrl: toProxiedImage(img),
            summary: `《${filmTitle}》中的${rel}${
              actorName ? `，由 ${actorName} 饰演/配音` : ''
            }。`,
            relatedWorkTitle: filmTitle,
            portrayedBy: actorName,
            sourceName: '番组计划 Bangumi',
            sourceUrl: `https://bgm.tv/character/${c.id}`,
            tags: [rel],
          },
        ];
      });

    return { people, characters };
  }

  async function fetchWikidataEntitiesBatch(
    ids: string[]
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
          6500
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
    options: {
      allowFairUse?: boolean;
      isCharacter?: boolean;
      includeEnLanglinks?: boolean;
      excludeTitles?: string[];
    } = {}
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
          6500
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

          // Prevent a character redirect (e.g. Dom Cobb -> Inception) from returning the movie's own poster
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
            const proxied = toProxiedImage(src);
            if (proxied) {
              titleToImage.set(resolvedTitle, proxied);
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
    originalTitle?: string
  ): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
    const empty = { people: [], characters: [] };
    try {
      // Step 1: Resolve exact Wikidata QID via zh.Wikipedia (auto converts 简/繁!)
      const lookupTitles = [filmTitle, originalTitle].filter(
        (t): t is string => Boolean(t && t.trim())
      );
      let qid: string | undefined;
      for (const t of lookupTitles) {
        const wpRes = await fetchWithTimeout(
          `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&prop=pageprops&titles=${encodeURIComponent(
            t.trim()
          )}`,
          { headers: WIKI_HEADERS },
          5000
        );
        if (!wpRes.ok) continue;
        const wpJson = (await wpRes.json()) as {
          query?: { pages?: Record<string, any> };
        };
        const page = Object.values(wpJson.query?.pages || {})[0];
        if (page?.pageprops?.wikibase_item) {
          qid = String(page.pageprops.wikibase_item);
          break;
        }
      }
      if (!qid) return empty;

      // Step 2: Fetch claims for the film entity
      const entRes = await fetchWithTimeout(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
          qid
        )}&props=claims&format=json`,
        { headers: WIKI_HEADERS },
        5500
      );
      if (!entRes.ok) return empty;
      const entJson = (await entRes.json()) as { entities?: Record<string, any> };
      const claims = entJson.entities?.[qid]?.claims || {};

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

      // Step 3: Batch resolve labels, descriptions, P18 claims, and enwiki/zhwiki sitelinks
      const entities = await fetchWikidataEntitiesBatch(allIds);

      // Step 4: Batch fetch REAL in-character stills via enwiki & zhwiki fair-use pageimages!
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
        fetchWikiPageImages('en', enCharTitles, {
          allowFairUse: true,
          isCharacter: true,
          excludeTitles,
        }),
        fetchWikiPageImages('zh', zhCharTitles, {
          allowFairUse: true,
          isCharacter: true,
          excludeTitles,
        }),
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
          const commonsStill = getWikidataCommonsThumb(p18File, {
            isCharacterFallback: true,
          });
          coverUrl = pickBetterCharacterImage(
            pickBetterCharacterImage(enStill, zhStill),
            commonsStill
          );
        } else {
          coverUrl = getWikidataCommonsThumb(p18File, {
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
        // Strictly use in-character stills/art ONLY — never duplicate the actor's real-life headshot!
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
    originalTitle?: string
  ): Promise<{ people: OnlineSearchResult[]; characters: OnlineSearchResult[] }> {
    const empty = { people: [], characters: [] };
    try {
      const candidates = [filmTitle, originalTitle].filter(
        (t): t is string => Boolean(t && t.trim())
      );

      let pageTitle: string | undefined;
      let castSectionIdx: string | undefined;

      for (const title of candidates) {
        const secRes = await fetchWithTimeout(
          `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=sections&page=${encodeURIComponent(
            title.trim()
          )}`,
          { headers: WIKI_HEADERS },
          5500
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
        if (match && secJson.parse?.title) {
          pageTitle = secJson.parse.title;
          castSectionIdx = match.index;
          break;
        }
      }

      if (!pageTitle || !castSectionIdx) return empty;

      const htmlRes = await fetchWithTimeout(
        `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=text&section=${encodeURIComponent(
          castSectionIdx
        )}&page=${encodeURIComponent(pageTitle)}`,
        { headers: WIKI_HEADERS },
        6000
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

      // Step 1 (Parallel): Fetch actor portraits AND zh.wiki character fair-use stills + enwiki langlinks
      const [actorRes, zhCharRes] = await Promise.all([
        fetchWikiPageImages(
          'zh',
          castEntries
            .map((e) => e.actorWikiTitle)
            .filter((t): t is string => Boolean(t)),
          { allowFairUse: false, isCharacter: false }
        ),
        fetchWikiPageImages(
          'zh',
          castEntries
            .map((e) => e.characterWikiTitle)
            .filter((t): t is string => Boolean(t)),
          {
            allowFairUse: true,
            isCharacter: true,
            includeEnLanglinks: true,
            excludeTitles,
          }
        ),
      ]);

      // Step 2: Fetch en.wikipedia fair-use in-character stills via resolved langlinks + English alias fallbacks
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

      const enCharRes = await fetchWikiPageImages('en', enCharLookups, {
        allowFairUse: true,
        isCharacter: true,
        excludeTitles,
      });

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

        // Strictly pick in-character still/artwork ONLY — never copy actorPhoto onto the character!
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
        const characterStill = pickBetterCharacterImage(
          enCharStill,
          zhCharStill
        );

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
    sourceUrl?: string
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
        5500
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
            coverUrl: toProxiedImage(p.image?.medium || p.image?.original),
            summary: `在《${filmTitle}》中饰演 ${ch?.name || '主要角色'}。`,
            relatedWorkTitle: filmTitle,
            sourceName: 'TVMaze 剧集库',
            sourceUrl: p.url,
            tags: ['演员'],
          });
        }
        if (ch?.name) {
          // Only use TVMaze's dedicated character image — never reuse actor photo p.image
          characters.push({
            externalId: `tvmaze-char-${ch.id}`,
            category: 'character',
            title: String(ch.name),
            subtitle: p?.name ? `${p.name} 饰演` : '剧集角色',
            coverUrl: toProxiedImage(ch.image?.medium || ch.image?.original),
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
    entityTitle: string
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
          5500
        ).then((r) => (r.ok ? r.json() : [])),
        fetchWithTimeout(
          `https://api.bgm.tv/v0/persons/${bgmId}/characters`,
          { headers: BGM_HEADERS },
          5500
        ).then((r) => (r.ok ? r.json() : [])),
      ]);
      const rawSubs =
        sRes.status === 'fulfilled' && Array.isArray(sRes.value) ? sRes.value : [];
      const rawChars =
        cRes.status === 'fulfilled' && Array.isArray(cRes.value) ? cRes.value : [];

      for (const s of rawSubs.filter((x: any) => x.type === 2 || x.type === 6).slice(0, 50)) {
        const title = String(s.name_cn || s.name || '').trim();
        if (!title) continue;
        films.push({
          externalId: `bgm-subj-${s.id}`,
          category: 'film',
          title,
          originalTitle: s.name && s.name !== title ? String(s.name) : undefined,
          subtitle: s.staff ? `${entityTitle} · ${s.staff}` : '相关影视作品',
          coverUrl: toProxiedImage(s.image),
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
          subtitle: workName ? `出自《${workName}》` : `${entityTitle} 演绎角色`,
          coverUrl: toProxiedImage(c.images?.large || c.images?.medium || c.images?.grid),
          summary: `由 ${entityTitle} 饰演/配音的角色${workName ? `（出自《${workName}》）` : ''}。`,
          relatedWorkTitle: workName || undefined,
          portrayedBy: entityTitle,
          sourceName: '番组计划 Bangumi',
          sourceUrl: `https://bgm.tv/character/${c.id}`,
          tags: ['角色'],
        });
      }
      return { films, people, characters };
    }

    // Character -> Films + Actors
    const [sRes, pRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://api.bgm.tv/v0/characters/${bgmId}/subjects`,
        { headers: BGM_HEADERS },
        5500
      ).then((r) => (r.ok ? r.json() : [])),
      fetchWithTimeout(
        `https://api.bgm.tv/v0/characters/${bgmId}/persons`,
        { headers: BGM_HEADERS },
        5500
      ).then((r) => (r.ok ? r.json() : [])),
    ]);
    const rawSubs =
      sRes.status === 'fulfilled' && Array.isArray(sRes.value) ? sRes.value : [];
    const rawPers =
      pRes.status === 'fulfilled' && Array.isArray(pRes.value) ? pRes.value : [];

    for (const s of rawSubs.filter((x: any) => x.type === 2 || x.type === 6).slice(0, 8)) {
      const title = String(s.name_cn || s.name || '').trim();
      if (!title) continue;
      films.push({
        externalId: `bgm-subj-${s.id}`,
        category: 'film',
        title,
        originalTitle: s.name && s.name !== title ? String(s.name) : undefined,
        subtitle: `${entityTitle} 出场作品`,
        coverUrl: toProxiedImage(s.image),
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
        coverUrl: toProxiedImage(p.images?.large || p.images?.medium || p.images?.grid),
        summary: `为角色「${entityTitle}」担任饰演或配音的影人。`,
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/person/${p.id}`,
        tags: ['演职员'],
      });
    }
    return { films, people, characters };
  }

  function hasChineseChars(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  function mergeUniqueByTitle(list: OnlineSearchResult[]): OnlineSearchResult[] {
    const out: OnlineSearchResult[] = [];
    const keyToIndex = new Map<string, number>();

    const getMatchKeys = (item: OnlineSearchResult): string[] => {
      const keys: string[] = [];
      const titleKey = normalizeEntityKey(item.title);
      if (titleKey) keys.push(`${item.category}::${titleKey}`);
      // Also split slash aliases like "维克多·冯·杜姆／毁灭博士"
      for (const part of item.title.split(/[／/]/)) {
        const pk = normalizeEntityKey(part);
        if (pk.length >= 2) keys.push(`${item.category}::${pk}`);
      }
      if (item.originalTitle) {
        for (const part of item.originalTitle.split(/[／/]/)) {
          const ok = normalizeEntityKey(part);
          if (ok.length >= 3) keys.push(`${item.category}::orig::${ok}`);
        }
      }
      // If item itself is English-only, allow matching against another entry's originalTitle
      if (!hasChineseChars(item.title) && titleKey.length >= 3) {
        keys.push(`${item.category}::orig::${titleKey}`);
      }
      return keys;
    };

    for (const item of list) {
      const keys = getMatchKeys(item);
      let existingIdx: number | undefined;
      for (const k of keys) {
        const idx = keyToIndex.get(k);
        if (idx !== undefined) {
          existingIdx = idx;
          break;
        }
      }

      if (existingIdx !== undefined) {
        const prev = out[existingIdx];
        // Backfill missing photo or upgrade English-only title to Chinese title!
        const upgradedTitle =
          !hasChineseChars(prev.title) && hasChineseChars(item.title)
            ? item.title
            : prev.title;
        const mergedCover =
          prev.category === 'character'
            ? pickBetterCharacterImage(prev.coverUrl, item.coverUrl)
            : prev.coverUrl || item.coverUrl;
        out[existingIdx] = {
          ...prev,
          title: upgradedTitle,
          originalTitle:
            prev.originalTitle ||
            (upgradedTitle !== prev.title ? prev.title : item.originalTitle),
          coverUrl: mergedCover,
          summary:
            item.summary.length > prev.summary.length ? item.summary : prev.summary,
          portrayedBy: prev.portrayedBy || item.portrayedBy,
        };
        for (const k of keys) keyToIndex.set(k, existingIdx);
        continue;
      }

      const nextIdx = out.length;
      out.push(item);
      for (const k of keys) keyToIndex.set(k, nextIdx);
    }

    return out;
  }

  app.get('/api/relations', async (req: Request, res: Response) => {
    const rawCat = String(req.query.category || 'film');
    const category: 'film' | 'person' | 'character' =
      rawCat === 'person' || rawCat === 'character' ? rawCat : 'film';
    const title = String(req.query.title || '').trim();
    const originalTitle = String(req.query.originalTitle || '').trim() || undefined;
    const sourceUrl = String(req.query.sourceUrl || '').trim() || undefined;

    if (!title) {
      res.status(400).json({ error: '缺少 title 参数', films: [], people: [], characters: [] });
      return;
    }

    const sources: string[] = [];

    if (category === 'film') {
      const bgmId = await resolveBangumiId('film', title, sourceUrl);
      const [zhWikiOutcome, wdOutcome, bgmOutcome, tvOutcome] =
        await Promise.allSettled([
          fetchZhWikiFilmRelations(title, originalTitle),
          fetchWikidataFilmRelations(title, originalTitle),
          bgmId
            ? fetchBangumiFilmRelations(bgmId, title)
            : Promise.resolve({ people: [], characters: [] }),
          fetchTVMazeFilmRelations(title, sourceUrl),
        ]);

      const rawPeople: OnlineSearchResult[] = [];
      const rawChars: OnlineSearchResult[] = [];

      // People: Wikidata first (has directors, writers & Mainland zh-cn names + photos),
      // then zh.Wikipedia (complete full cast), then Bangumi, then TVMaze.
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
        // Characters: zh.Wikipedia first (full Chinese character names + bios + real actor photos!)
        rawChars.push(...zhWikiOutcome.value.characters);
      }
      if (wdOutcome.status === 'fulfilled') {
        rawChars.push(...wdOutcome.value.characters);
      }
      if (bgmOutcome.status === 'fulfilled') {
        if (bgmOutcome.value.people.length || bgmOutcome.value.characters.length) {
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

      res.json({
        films: [],
        people: mergeUniqueByTitle(rawPeople).slice(0, 60),
        characters: mergeUniqueByTitle(rawChars).slice(0, 60),
        sources,
      });
      return;
    }

    // Person: Complete Filmography & Portrayed Characters (zh.Wikipedia + Bangumi + TVMaze!)
    if (category === 'person') {
      const fetchZhWikiPersonRelations = async (): Promise<{
        films: OnlineSearchResult[];
        characters: OnlineSearchResult[];
      }> => {
        const empty = { films: [], characters: [] };
        try {
          // 1. Resolve canonical zh.Wikipedia page title (handles 简/繁 variants like 小罗伯特·唐尼 -> 小勞勃·道尼)
          let zhPageTitle: string | undefined;

          const wdMatch = sourceUrl
            ? /wikidata\.org\/wiki\/(Q\d+)/i.exec(sourceUrl)
            : null;
          if (wdMatch) {
            const wdRes = await fetchWithTimeout(
              `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdMatch[1].toUpperCase()}&props=sitelinks&sitefilter=zhwiki&format=json`,
              { headers: WIKI_HEADERS },
              4500
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
              5000
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
              5000
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

          // 2. Inspect actor's sections for filmography tables or dedicated "...作品列表" subpage
          const secRes = await fetchWithTimeout(
            `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=sections&page=${encodeURIComponent(
              zhPageTitle
            )}`,
            { headers: WIKI_HEADERS },
            5500
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
                6000
              );
              if (!r.ok) return '';
              const j = (await r.json()) as { parse?: { text?: { '*'?: string } } };
              return j.parse?.text?.['*'] || '';
            })
          );
          let combinedHtml = secHtmlParts.join('\n');

          // Follow dedicated "...作品列表" subpage when main section delegates to it (e.g. 小勞勃·道尼作品列表)
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
              7000
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

          // Build deduplicated films sorted by newest year first (up to 80)
          const filmMap = new Map<string, (typeof rawEntries)[number]>();
          for (const e of rawEntries) {
            const fk = normalizeEntityKey(e.filmTitle);
            if (!fk) continue;
            const prev = filmMap.get(fk);
            if (!prev) {
              filmMap.set(fk, e);
            } else {
              if (!prev.characterName && e.characterName) prev.characterName = e.characterName;
              if (!prev.filmWikiTitle && e.filmWikiTitle) prev.filmWikiTitle = e.filmWikiTitle;
              if (!prev.year && e.year) prev.year = e.year;
            }
          }
          const sortedFilmEntries = Array.from(filmMap.values())
            .sort((a, b) => (Number(b.year || '0') || 0) - (Number(a.year || '0') || 0))
            .slice(0, 80);

          // Aggregate fictional characters (deduplicating recurring roles like Tony Stark / Iron Man)
          const aggChars = aggregatePersonCharacters(rawEntries).slice(0, 80);

          // Batch fetch movie posters (zh + en fallback) AND dedicated in-character stills (zh + en fallback)
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
            fetchWikiPageImages('zh', filmZhTitles, {
              allowFairUse: true,
              isCharacter: false,
              includeEnLanglinks: true,
            }),
            fetchWikiPageImages('zh', charZhTitles, {
              allowFairUse: true,
              isCharacter: true,
              includeEnLanglinks: true,
              excludeTitles: excludeCharTitles,
            }),
          ]);

          // Step 2: Enrich missing posters & in-character movie stills from en.wikipedia
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
            fetchWikiPageImages('en', enFilmLookups, {
              allowFairUse: true,
              isCharacter: false,
            }),
            fetchWikiPageImages('en', enCharLookups, {
              allowFairUse: true,
              isCharacter: true,
              excludeTitles: excludeCharTitles,
            }),
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
              4500
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
            5000
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
                coverUrl: toProxiedImage(sh.image?.medium || sh.image?.original),
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
                coverUrl: toProxiedImage(ch.image?.medium || ch.image?.original),
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

      const bgmId = await resolveBangumiId('person', title, sourceUrl);
      const [zhWikiOutcome, bgmOutcome, tvOutcome] = await Promise.allSettled([
        fetchZhWikiPersonRelations(),
        bgmId
          ? fetchBangumiPersonOrCharRelations('person', bgmId, title)
          : Promise.resolve({ films: [], people: [], characters: [] }),
        fetchTVMazePersonRelations(),
      ]);

      const rawFilms: OnlineSearchResult[] = [];
      const rawChars: OnlineSearchResult[] = [];

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
        if (
          tvOutcome.value.films.length ||
          tvOutcome.value.characters.length
        ) {
          sources.push('TVMaze 剧集库');
        }
        rawFilms.push(...tvOutcome.value.films);
        rawChars.push(...tvOutcome.value.characters);
      }

      res.json({
        films: mergeUniqueByTitle(rawFilms).slice(0, 80),
        people: [],
        characters: mergeUniqueByTitle(rawChars).slice(0, 80),
        sources,
      });
      return;
    }

    res.json({ films: [], people: [], characters: [], sources });
  });

  // 3.6. Dedicated Character Dossier Enrichment (zh.Wikipedia + Wikidata + exact Bangumi ID, VPN-free!)
  async function fetchZhWikiCharacterDossier(pageTitle: string): Promise<{
    resolvedTitle?: string;
    qid?: string;
    bio?: string;
    infobox: Record<string, string | undefined>;
  }> {
    const [extractRes, parseRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1&converttitles=1&variant=zh-cn&prop=extracts|pageprops&exintro=1&explaintext=1&exsentences=6&titles=${encodeURIComponent(
          pageTitle
        )}`,
        { headers: WIKI_HEADERS },
        6000
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        `https://zh.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&variant=zh-cn&prop=text&section=0&page=${encodeURIComponent(
          pageTitle
        )}`,
        { headers: WIKI_HEADERS },
        6000
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

    let infobox: Record<string, string | undefined> = {};
    if (parseRes.status === 'fulfilled' && parseRes.value?.parse?.text?.['*']) {
      infobox = parseZhWikiCharacterInfobox(
        String(parseRes.value.parse.text['*'])
      ) as Record<string, string | undefined>;
    }

    return { resolvedTitle, qid, bio, infobox };
  }

  async function fetchWikidataCharacterDossier(qid: string): Promise<{
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
        6000
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

      let labelMap: Record<string, string> = {};
      if (lookupIds.length > 0) {
        const subEntities = await fetchWikidataEntitiesBatch(lookupIds);
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
        Array.from(
          new Set(ids.map((id) => labelMap[id]).filter(Boolean))
        ).join(' · ') || undefined;

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

  app.get('/api/character-profile', async (req: Request, res: Response) => {
    const title = String(req.query.title || '').trim();
    const originalTitle = String(req.query.originalTitle || '').trim() || undefined;
    const relatedWorkTitle =
      String(req.query.relatedWorkTitle || '').trim() || undefined;
    const sourceUrl = String(req.query.sourceUrl || '').trim() || undefined;

    if (!title) {
      res.status(400).json({ error: '缺少 title 参数', profile: {}, sources: [] });
      return;
    }

    const sources: string[] = [];
    const profile: Record<string, string | undefined> = {};

    try {
      // Path A: Exact Bangumi character ID (zero fuzzy mismatches!)
      const bgmMatch = sourceUrl
        ? /bgm\.tv\/character\/(\d+)/.exec(sourceUrl)
        : null;
      if (bgmMatch) {
        const charRes = await fetchWithTimeout(
          `https://api.bgm.tv/v0/characters/${bgmMatch[1]}`,
          { headers: BGM_HEADERS },
          6000
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
        res.json({ profile, sources });
        return;
      }

      // Path B: Direct Wikidata QID or zh.Wikipedia character page
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

      // If no direct character article yet, try exact zh.wikipedia / en.wikipedia lookups using character aliases
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
            4500
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
            4500
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

      // Fetch Wikidata structured facts first if we already have QID (may also reveal zhWikiTitle)
      let wdData: Awaited<ReturnType<typeof fetchWikidataCharacterDossier>> = {};
      if (qid) {
        wdData = await fetchWikidataCharacterDossier(qid);
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

      // Fetch zh.Wikipedia lead bio + structured character infobox
      let zhData: Awaited<ReturnType<typeof fetchZhWikiCharacterDossier>> = {
        infobox: {},
      };
      if (zhWikiTitle) {
        zhData = await fetchZhWikiCharacterDossier(zhWikiTitle);
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
            wdData = await fetchWikidataCharacterDossier(qid);
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

      // Merge zh.Wikipedia infobox first (richer Chinese prose), backfilled by Wikidata claims
      profile.alias = zhData.infobox.alias || wdData.alias;
      profile.identity = zhData.infobox.identity || wdData.identity;
      profile.affiliation = zhData.infobox.affiliation || wdData.affiliation;
      profile.origin = zhData.infobox.origin || wdData.origin;
      profile.abilities = zhData.infobox.abilities || wdData.abilities;
      profile.firstAppearance = zhData.infobox.firstAppearance;
      profile.creator = zhData.infobox.creator || wdData.creator;
      profile.bio = zhData.bio || wdData.description;

      // Fallback to English Wikipedia intro only when no zh.wiki bio exists
      if (!profile.bio && enWikiTitle) {
        const enRes = await fetchWithTimeout(
          `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=extracts&exintro=1&explaintext=1&exsentences=4&titles=${encodeURIComponent(
            enWikiTitle
          )}`,
          { headers: WIKI_HEADERS },
          5000
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

      res.json({ profile, sources: uniqueSources });
    } catch {
      res.json({ profile: {}, sources: [] });
    }
  });

  // 4. Server-Side Image Proxy (So images from Bangumi/Wikipedia/TVMaze/iTunes load with zero VPN!)
  app.get('/api/img-proxy', async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      res.status(400).send('Missing url');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).send('Invalid url');
      return;
    }

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      isBlockedHost(parsed.hostname)
    ) {
      res.status(403).send('Forbidden url');
      return;
    }

    try {
      const upstream = await fetchWithTimeout(
        parsed.toString(),
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; CineArchive/1.0; +https://cinearchive.local)',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          redirect: 'follow',
        },
        7000
      );

      if (!upstream.ok) {
        res.status(404).send('Image unavailable');
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        res.status(415).send('Not an image');
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.byteLength > 8 * 1024 * 1024) {
        res.status(413).send('Image too large');
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch {
      res.status(404).send('Image fetch failed');
    }
  });

  // 5. Vite Middleware (Dev) or Static Assets (Prod)
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CineArchive] Server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('[CineArchive] Failed to start server:', err);
  process.exit(1);
});
