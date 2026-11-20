import type { ArchiveCategory, OnlineSearchResult } from '../types/archive';
import type { CoverCandidate } from './coverPicker';
import { latinPersonNamesMatch, splitCandidateAliases } from './bilingualMerge';
import { normalizeEntityKey } from './wikiCast';

export interface ImdbDirectRef {
  kind: 'title' | 'name';
  id: string;
}

export interface ImdbEnrichedTitle {
  imdbId: string;
  mediaType: 'movie' | 'series';
  result: OnlineSearchResult;
  backgroundUrl?: string;
  directors: string[];
  writers: string[];
  cast: string[];
}

const GENRE_ZH_MAP: Record<string, string> = {
  action: '动作',
  adventure: '冒险',
  animation: '动画',
  biography: '传记',
  comedy: '喜剧',
  crime: '犯罪',
  documentary: '纪录片',
  drama: '剧情',
  family: '家庭',
  fantasy: '奇幻',
  'film-noir': '黑色电影',
  history: '历史',
  horror: '恐怖',
  music: '音乐',
  musical: '歌舞',
  mystery: '悬疑',
  romance: '爱情',
  'sci-fi': '科幻',
  'science fiction': '科幻',
  short: '短片',
  sport: '运动',
  thriller: '惊悚',
  war: '战争',
  western: '西部',
};

const COUNTRY_ZH_MAP: Record<string, string> = {
  'united states': '美国',
  usa: '美国',
  'united kingdom': '英国',
  uk: '英国',
  china: '中国大陆',
  'hong kong': '中国香港',
  taiwan: '中国台湾',
  japan: '日本',
  'south korea': '韩国',
  korea: '韩国',
  france: '法国',
  germany: '德国',
  italy: '意大利',
  spain: '西班牙',
  canada: '加拿大',
  australia: '澳大利亚',
  india: '印度',
  russia: '俄罗斯',
  sweden: '瑞典',
  denmark: '丹麦',
  iran: '伊朗',
  mexico: '墨西哥',
  brazil: '巴西',
  thailand: '泰国',
  'new zealand': '新西兰',
};

/**
 * Recognizes direct IMDb URLs or shorthand IDs pasted into the search box:
 * - https://www.imdb.com/title/tt0118694/
 * - https://m.imdb.com/name/nm0504897/
 * - tt0118694
 * - nm0000375
 * - imdb:tt1375666
 */
export function parseImdbUrlOrId(input: string): ImdbDirectRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const titleUrlMatch = /imdb\.com\/title\/(tt\d{5,10})/i.exec(trimmed);
  if (titleUrlMatch) {
    return { kind: 'title', id: titleUrlMatch[1].toLowerCase() };
  }

  const nameUrlMatch = /imdb\.com\/name\/(nm\d{5,10})/i.exec(trimmed);
  if (nameUrlMatch) {
    return { kind: 'name', id: nameUrlMatch[1].toLowerCase() };
  }

  const bareTitle = /^(?:imdb[:：\s#]+)?(tt\d{5,10})$/i.exec(trimmed);
  if (bareTitle) {
    return { kind: 'title', id: bareTitle[1].toLowerCase() };
  }

  const bareName = /^(?:imdb[:：\s#]+)?(nm\d{5,10})$/i.exec(trimmed);
  if (bareName) {
    return { kind: 'name', id: bareName[1].toLowerCase() };
  }

  return null;
}

export function extractImdbIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = /imdb\.com\/(?:title|name)\/((?:tt|nm)\d{5,10})/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export function extractImdbIdFromExternalId(externalId?: string | null): string | null {
  if (!externalId) return null;
  const m = /\b((?:tt|nm)\d{5,10})\b/i.exec(externalId);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Normalizes IMDb / Metahub image URLs for crisp, fast, anti-hotlink-free rendering.
 * - Upgrades Metahub `poster/small/` -> `poster/medium/`
 * - Resizes raw multi-MB `m.media-amazon.com/..._V1_.jpg` -> `..._V1_UX600_.jpg`
 */
export function normalizeImdbImageUrl(
  rawUrl?: string | null,
  variant: 'poster' | 'background' | 'avatar' = 'poster'
): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  let url = rawUrl.trim();
  if (!url) return undefined;
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^http:\/\//i.test(url)) url = `https://${url.slice(7)}`;
  if (!/^https:\/\//i.test(url)) return undefined;

  if (url.includes('images.metahub.space/poster/small/')) {
    return url.replace('/poster/small/', '/poster/medium/');
  }

  if (
    /m\.media-amazon\.com\/images\/M\//i.test(url) &&
    /\._V1_\.(jpg|jpeg|png|webp)$/i.test(url)
  ) {
    const width = variant === 'background' ? 960 : 600;
    return url.replace(/\._V1_\.(jpg|jpeg|png|webp)$/i, `._V1_UX${width}_.$1`);
  }

  return url;
}

export function translateImdbGenre(raw: string): string {
  const key = raw.trim().toLowerCase();
  return GENRE_ZH_MAP[key] || raw.trim();
}

export function translateImdbCountry(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const parts = raw
    .split(/[,/／、]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => COUNTRY_ZH_MAP[p.toLowerCase()] || p);
  return parts.length > 0 ? parts.join(' / ') : undefined;
}

export function cleanImdbText(raw?: string | null, maxLen = 240): string {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}…`;
}

function extractYear(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const m = /\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(raw);
  return m ? m[1] : undefined;
}

export function hasCjkCharacters(text: string): boolean {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
}

/**
 * Parses Stremio Cinemeta search payload (`/catalog/{movie|series}/top/search=....json`).
 */
export function parseCinemetaSearchPayload(
  payload: Record<string, any> | null | undefined,
  fallbackType: 'movie' | 'series' = 'movie'
): Array<{
  imdbId: string;
  mediaType: 'movie' | 'series';
  result: OnlineSearchResult;
  backgroundUrl?: string;
}> {
  const metas = Array.isArray(payload?.metas) ? payload.metas : [];
  const out: Array<{
    imdbId: string;
    mediaType: 'movie' | 'series';
    result: OnlineSearchResult;
    backgroundUrl?: string;
  }> = [];
  const seen = new Set<string>();

  for (const row of metas) {
    if (!row || typeof row !== 'object') continue;
    const rawId = String(row.imdb_id || row.id || '').trim().toLowerCase();
    if (!/^tt\d{5,10}$/.test(rawId) || seen.has(rawId)) continue;
    seen.add(rawId);

    const name = String(row.name || '').trim();
    if (!name) continue;
    const mediaType: 'movie' | 'series' =
      row.type === 'series' || fallbackType === 'series' ? 'series' : 'movie';
    const mediaLabel = mediaType === 'series' ? '剧集' : '电影';
    const year = extractYear(String(row.releaseInfo || row.year || ''));
    const ratingVal = Number(row.imdbRating || 0);
    const ratingLabel =
      Number.isFinite(ratingVal) && ratingVal > 0
        ? `IMDb ${ratingVal.toFixed(1)}`
        : undefined;

    const rawGenres: string[] = Array.isArray(row.genres || row.genre)
      ? (row.genres || row.genre)
          .filter((g: unknown): g is string => typeof g === 'string' && g.trim().length > 0)
          .slice(0, 4)
      : [];
    const zhGenres = rawGenres.map(translateImdbGenre);

    const poster = normalizeImdbImageUrl(row.poster, 'poster');
    const bg = normalizeImdbImageUrl(row.background, 'background');

    const subtitle = [
      mediaLabel,
      ratingLabel,
      zhGenres.slice(0, 2).join(' / '),
    ]
      .filter(Boolean)
      .join(' · ');

    out.push({
      imdbId: rawId,
      mediaType,
      backgroundUrl: bg,
      result: {
        externalId: `imdb-${rawId}`,
        category: 'film',
        title: name,
        year,
        subtitle,
        coverUrl: poster,
        summary:
          cleanImdbText(row.description, 220) ||
          `${name}${year ? `（${year}）` : ''} — IMDb ${mediaLabel}条目（${rawId}）。`,
        sourceName: 'IMDb',
        sourceUrl: `https://www.imdb.com/title/${rawId}/`,
        tags: zhGenres.length > 0 ? zhGenres : [mediaLabel],
      },
    });
  }

  return out;
}

/**
 * Parses full Stremio Cinemeta metadata (`/meta/{movie|series}/{ttId}.json`).
 */
export function parseCinemetaMeta(
  payload: Record<string, any> | null | undefined,
  fallbackType: 'movie' | 'series' = 'movie'
): ImdbEnrichedTitle | null {
  const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : payload;
  if (!meta || typeof meta !== 'object') return null;

  const rawId = String(meta.imdb_id || meta.id || '').trim().toLowerCase();
  if (!/^tt\d{5,10}$/.test(rawId)) return null;

  const name = String(meta.name || '').trim();
  if (!name) return null;

  const mediaType: 'movie' | 'series' =
    meta.type === 'series' || fallbackType === 'series' ? 'series' : 'movie';
  const mediaLabel = mediaType === 'series' ? '剧集' : '电影';

  const year = extractYear(
    String(meta.year || meta.releaseInfo || meta.released || '')
  );
  const ratingVal = Number(meta.imdbRating || 0);
  const ratingLabel =
    Number.isFinite(ratingVal) && ratingVal > 0
      ? `IMDb ${ratingVal.toFixed(1)}`
      : undefined;

  const directors: string[] = Array.isArray(meta.director)
    ? meta.director
        .map((d: unknown) => (typeof d === 'string' ? d.trim() : ''))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const writers: string[] = Array.isArray(meta.writer)
    ? meta.writer
        .map((w: unknown) => (typeof w === 'string' ? w.trim() : ''))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const cast: string[] = Array.isArray(meta.cast)
    ? meta.cast
        .map((c: unknown) => (typeof c === 'string' ? c.trim() : ''))
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const rawGenres: string[] = Array.isArray(meta.genres || meta.genre)
    ? (meta.genres || meta.genre)
        .filter((g: unknown): g is string => typeof g === 'string' && g.trim().length > 0)
        .slice(0, 4)
    : [];
  const zhGenres = rawGenres.map(translateImdbGenre);

  const region = translateImdbCountry(meta.country);
  const poster = normalizeImdbImageUrl(meta.poster, 'poster');
  const backgroundUrl = normalizeImdbImageUrl(meta.background, 'background');

  const subtitle = [
    mediaLabel,
    ratingLabel,
    directors.length > 0
      ? `导演 ${directors[0]}`
      : zhGenres.slice(0, 2).join(' / '),
  ]
    .filter(Boolean)
    .join(' · ');

  const desc = cleanImdbText(meta.description, 220);
  const awards =
    typeof meta.awards === 'string' && meta.awards.trim() && meta.awards !== 'N/A'
      ? cleanImdbText(meta.awards, 90)
      : '';
  const summary = [desc, awards ? `奖项：${awards}` : '']
    .filter(Boolean)
    .join(' · ');

  return {
    imdbId: rawId,
    mediaType,
    backgroundUrl,
    directors,
    writers,
    cast,
    result: {
      externalId: `imdb-${rawId}`,
      category: 'film',
      title: name,
      year,
      region,
      subtitle,
      coverUrl: poster,
      summary:
        summary ||
        `${name}${year ? `（${year}）` : ''} — IMDb ${mediaLabel}档案。`,
      sourceName: 'IMDb',
      sourceUrl: `https://www.imdb.com/title/${rawId}/`,
      tags: zhGenres.length > 0 ? zhGenres : [mediaLabel],
    },
  };
}

/**
 * Parses official IMDb Suggest payloads from BOTH:
 * - `v3.sg.media-imdb.com/suggestion/...json` (`i: { imageUrl, width, height }`)
 * - `sg.media-imdb.com/suggests/...json` JSONP (`i: [url, width, height]`)
 */
export function parseImdbSuggestPayload(
  payload: Record<string, any> | null | undefined
): {
  titles: Array<{
    imdbId: string;
    mediaType: 'movie' | 'series';
    result: OnlineSearchResult;
  }>;
  names: OnlineSearchResult[];
} {
  const rows = Array.isArray(payload?.d) ? payload.d : [];
  const titles: Array<{
    imdbId: string;
    mediaType: 'movie' | 'series';
    result: OnlineSearchResult;
  }> = [];
  const names: OnlineSearchResult[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim().toLowerCase();
    const label = String(row.l || '').trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);

    let rawImageUrl: string | undefined;
    if (Array.isArray(row.i) && typeof row.i[0] === 'string') {
      rawImageUrl = row.i[0];
    } else if (row.i && typeof row.i === 'object' && typeof row.i.imageUrl === 'string') {
      rawImageUrl = row.i.imageUrl;
    }

    const starLine = typeof row.s === 'string' ? row.s.trim() : '';

    if (id.startsWith('tt')) {
      const qid = String(row.qid || row.q || '').toLowerCase();
      // Skip non-screen items like video games or podcast episodes if obvious
      if (qid === 'videogame' || qid === 'podcastepisode') continue;
      const isSeries =
        qid.includes('tv') || qid.includes('series') || qid.includes('mini');
      const mediaType: 'movie' | 'series' = isSeries ? 'series' : 'movie';
      const mediaLabel = isSeries ? '剧集' : '电影';
      const year = extractYear(String(row.y || row.yr || row.tl || ''));

      titles.push({
        imdbId: id,
        mediaType,
        result: {
          externalId: `imdb-${id}`,
          category: 'film',
          title: label,
          year,
          subtitle: mediaLabel,
          coverUrl: normalizeImdbImageUrl(rawImageUrl, 'poster'),
          summary: starLine
            ? `${label}${year ? `（${year}）` : ''} · 主演：${starLine}`
            : `${label}${year ? `（${year}）` : ''} — IMDb ${mediaLabel}条目。`,
          sourceName: 'IMDb',
          sourceUrl: `https://www.imdb.com/title/${id}/`,
          tags: [mediaLabel],
        },
      });
    } else if (id.startsWith('nm')) {
      const roleMatch = /^([A-Za-z\s/-]+?),\s*(.+)$/.exec(starLine);
      const rawRole = roleMatch ? roleMatch[1].trim() : '';
      const knownFor = roleMatch ? roleMatch[2].trim() : starLine;
      const roleMap: Record<string, string> = {
        actor: '演员',
        actress: '演员',
        director: '导演',
        producer: '制片人',
        writer: '编剧',
        composer: '配乐',
        cinematographer: '摄影',
        editor: '剪辑',
      };
      const zhRole = roleMap[rawRole.toLowerCase()] || rawRole || '影人';

      names.push({
        externalId: `imdb-${id}`,
        category: 'person',
        title: label,
        subtitle: knownFor ? `${zhRole} · 代表作 ${knownFor}` : `IMDb ${zhRole}`,
        coverUrl: normalizeImdbImageUrl(rawImageUrl, 'avatar'),
        summary: knownFor
          ? `${label}，IMDb 档案（${zhRole}），代表作：${knownFor}。`
          : `${label}，IMDb 影人档案（${id}）。`,
        relatedWorkTitle: knownFor ? knownFor.replace(/\s*\(\d{4}\)\s*$/, '') : undefined,
        sourceName: 'IMDb',
        sourceUrl: `https://www.imdb.com/name/${id}/`,
        tags: [zhRole],
      });
    }
  }

  return { titles, names };
}

function extractRatingBadge(subtitle: string | undefined, prefix: 'IMDb' | '豆瓣'): string | undefined {
  if (!subtitle) return undefined;
  const re = prefix === 'IMDb' ? /IMDb\s*(\d+(?:\.\d+)?)/i : /豆瓣\s*(\d+(?:\.\d+)?)/;
  const m = re.exec(subtitle);
  return m ? `${prefix} ${m[1]}` : undefined;
}

function yearsClose(y1?: string, y2?: string): boolean {
  if (!y1 || !y2) return true;
  const n1 = Number(y1);
  const n2 = Number(y2);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return true;
  return Math.abs(n1 - n2) <= 2;
}

function extractMediaLabel(item: OnlineSearchResult): string {
  const s = item.subtitle || '';
  if (s.includes('剧集') || item.tags.includes('剧集')) return '剧集';
  return '电影';
}

function extractDirectorSnippet(subtitle?: string): string | undefined {
  if (!subtitle) return undefined;
  const m = /导演\s+(.+?)(?=\s+·\s+|[|]|$)/.exec(subtitle);
  return m ? `导演 ${m[1].trim()}` : undefined;
}

function isRichChineseSynopsis(summary?: string): boolean {
  if (!summary) return false;
  const trimmed = summary.trim();
  if (!hasCjkCharacters(trimmed)) return false;
  if (
    /(?:豆瓣(?:电影|剧集|影视条目|影人档案)|影视作品|动画作品|百度百科词条|IMDb\s*(?:电影|剧集)?(?:条目|档案))[。）)\s。]*$/.test(
      trimmed
    ) &&
    trimmed.length < 48
  ) {
    return false;
  }
  return trimmed.length >= 24;
}

const NON_MEDIA_BAIKE_RE =
  /(?:游戏|手游|网游|端游|单机|iphone游戏|android游戏|网络小说|言情小说|轻小说|文学作品|诗歌|散文|音乐专辑|单曲|歌曲|唱片|乐队|植物|动物|昆虫|成语|词语|汉语词汇|地名|行政区|软件|应用程序|手机应用|车型|汽车品牌|公司|企业|品牌|工具|器具|家具|服饰)/i;

const FILM_MEDIA_BAIKE_RE =
  /(?:电影|影片|剧集|电视剧|美剧|英剧|日剧|韩剧|港剧|台剧|国产剧|网剧|网络剧|迷你剧|动画|番剧|动漫|纪录片|短片|执导|主演|导演|编剧|播出|首播|上映|出品|HBO|Netflix|DC|漫威|影业)/i;

const PERSON_MEDIA_BAIKE_RE =
  /(?:演员|导演|编剧|制片|监制|配音|声优|歌手|主持人|电影人|影星|男演员|女演员|影视)/i;

/**
 * Validates whether a Baidu Baike lemma card genuinely represents a film/TV work
 * or film person rather than an unrelated homonym (e.g. "Lanterns" -> "灯笼 iphone游戏").
 */
export function isPlausibleBaikeFilmOrPerson(
  item: OnlineSearchResult | null | undefined,
  category: ArchiveCategory
): boolean {
  if (!item || !item.title || !hasCjkCharacters(item.title)) return false;
  const combined = `${item.subtitle || ''} ${item.summary || ''} ${(item.tags || []).join(' ')}`;
  if (!combined.trim()) return false;

  if (category === 'film') {
    if (NON_MEDIA_BAIKE_RE.test(item.subtitle || '') && !FILM_MEDIA_BAIKE_RE.test(item.subtitle || '')) {
      return false;
    }
    if (NON_MEDIA_BAIKE_RE.test(combined) && !FILM_MEDIA_BAIKE_RE.test(combined)) {
      return false;
    }
    return FILM_MEDIA_BAIKE_RE.test(combined);
  }

  if (category === 'person') {
    if (NON_MEDIA_BAIKE_RE.test(item.subtitle || '') && !PERSON_MEDIA_BAIKE_RE.test(item.subtitle || '')) {
      return false;
    }
    return PERSON_MEDIA_BAIKE_RE.test(combined);
  }

  return true;
}

const BAIDU_SUGGEST_NOISE_RE =
  /(?:在线观看|免费观看|百度网盘|网盘|下载|剧情介绍|剧情|演员表|豆瓣|评分|预告片|预告|高清|完整版|资源|评价|影评|好看吗|什么时候|播出时间|更新时间|第一季|第二季|第三季|第[一二三四五六七八九十\d]+[集季期]|什么意思|是什么意思|怎么读|怎么念|翻译|百科|官网|美剧|英剧|日剧|韩剧|电影|电视剧|剧集|动漫|动画|英文|中文|名字|叫什么)/g;

/**
 * Extracts a clean Chinese title alias from Baidu Search Suggest entries paired
 * with a Latin work title (e.g. `"LANTERNS绿灯军团"` for `"Lanterns"` -> `"绿灯军团"`).
 */
export function extractBaiduSuggestZhAlias(
  suggestions: string[],
  latinTitle: string
): string | null {
  const normLatin = normalizeEntityKey(latinTitle);
  if (!normLatin || normLatin.length < 3) return null;

  const escapedWords = latinTitle
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const latinPrefixRe =
    escapedWords.length > 0
      ? new RegExp(escapedWords.join('[\\s:：\\-—·]*'), 'gi')
      : null;

  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const raw of suggestions) {
    if (!raw || !hasCjkCharacters(raw)) continue;
    const normRaw = normalizeEntityKey(raw);
    if (!normRaw.includes(normLatin)) continue;

    let stripped = latinPrefixRe ? raw.replace(latinPrefixRe, ' ') : raw;
    stripped = stripped
      .replace(BAIDU_SUGGEST_NOISE_RE, ' ')
      .replace(/[A-Za-z0-9\-_:：·•()（）《》「」『』\[\]【】/\\.,!?！？\s]+/g, ' ')
      .trim();

    // Pick the longest contiguous CJK segment remaining (2..14 chars)
    const cjkSegments = stripped.match(/[\u4e00-\u9fff]{2,14}/g) || [];
    for (const seg of cjkSegments) {
      if (seg.length < 2 || seg.length > 14) continue;
      if (/^(?:大结局|分集|全集|解说|结局|主演|导演|海报|剧照|壁纸|片尾曲|主题曲)$/.test(seg)) {
        continue;
      }
      if (!counts.has(seg)) order.push(seg);
      counts.set(seg, (counts.get(seg) || 0) + 1);
    }
  }

  if (order.length === 0) return null;
  order.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
  return order[0];
}

const MAKING_OF_RE =
  /(?:的背后|幕后|花絮|制作特辑|纪录片|访谈|making\s+of|behind\s+the\s+scenes|featurette|documentary|^@\s+)/i;

function isMakingOfLikeTitle(title?: string, originalTitle?: string, tags?: string[]): boolean {
  if (tags?.includes('纪录片')) return true;
  if (title && MAKING_OF_RE.test(title.trim())) return true;
  if (originalTitle && MAKING_OF_RE.test(originalTitle.trim())) return true;
  return false;
}

function scoreImdbDoubanMatch(
  imdb: OnlineSearchResult,
  douban: OnlineSearchResult,
  crossIdMap?: Map<string, string>,
  wikiZhTitle?: string
): number {
  if (imdb.category !== douban.category) return 0;

  // 1. Explicit cross-ID match (IMDb ID -> Douban subject ID)
  if (crossIdMap && crossIdMap.size > 0) {
    const imdbId =
      extractImdbIdFromExternalId(imdb.externalId) ||
      extractImdbIdFromUrl(imdb.sourceUrl);
    if (imdbId) {
      const mappedDoubanId = crossIdMap.get(imdbId);
      if (
        mappedDoubanId &&
        (douban.externalId === `douban-subj-${mappedDoubanId}` ||
          douban.sourceUrl?.includes(`/subject/${mappedDoubanId}`))
      ) {
        return 120;
      }
    }
  }

  // Reject making-of / documentary Douban items when matching a regular feature/series
  const imdbIsDoc = isMakingOfLikeTitle(imdb.title, imdb.originalTitle, imdb.tags);
  const doubanIsDoc = isMakingOfLikeTitle(douban.title, douban.originalTitle, douban.tags);
  if (imdb.category === 'film' && !imdbIsDoc && doubanIsDoc) {
    return 0;
  }

  const exactYearBonus =
    imdb.year && douban.year && imdb.year === douban.year ? 10 : 0;
  const yearOk = imdb.category === 'person' || yearsClose(imdb.year, douban.year);

  const imdbRawValues = [imdb.title, imdb.originalTitle]
    .filter((s): s is string => Boolean(s && s.trim()))
    .flatMap((s) => [s, ...splitCandidateAliases(s)]);
  const dbRawValues = [douban.title, douban.originalTitle]
    .filter((s): s is string => Boolean(s && s.trim()))
    .flatMap((s) => [s, ...splitCandidateAliases(s)]);

  const imdbKeys = Array.from(
    new Set(imdbRawValues.map((s) => normalizeEntityKey(s)).filter(Boolean))
  );
  const dbKeys = Array.from(
    new Set(dbRawValues.map((s) => normalizeEntityKey(s)).filter(Boolean))
  );
  const wikiKey = wikiZhTitle ? normalizeEntityKey(wikiZhTitle) : '';

  if (imdbKeys.length === 0 || dbKeys.length === 0) return 0;

  let best = 0;

  // 2. Exact normalized title/originalTitle (including slash-separated aliases) match
  for (const ik of imdbKeys) {
    for (const dk of dbKeys) {
      if (ik === dk && yearOk) {
        best = Math.max(best, 95 + exactYearBonus);
      }
    }
  }

  // 2B. Person Latin name match (e.g. "Robert John Downey Jr." <-> "Robert Downey Jr.")
  if (best === 0 && imdb.category === 'person') {
    for (const ir of imdbRawValues) {
      for (const dr of dbRawValues) {
        if (latinPersonNamesMatch(ir, dr)) {
          best = Math.max(best, 92);
        }
      }
    }
  }

  // 3. Exact match via Wikidata Chinese title (critical for HK/Asian films where Douban originalTitle is Traditional Chinese)
  if (wikiKey && yearOk) {
    for (const dk of dbKeys) {
      if (wikiKey === dk) {
        best = Math.max(best, 90 + exactYearBonus);
      }
    }
  }

  // 4. Tight substring match (only when lengths are close so spin-offs/documentaries never hijack main works)
  if (best === 0 && yearOk) {
    for (const ik of imdbKeys) {
      for (const dk of dbKeys) {
        if (ik.length < 4 || dk.length < 4) continue;
        if (ik.includes(dk) || dk.includes(ik)) {
          const ratio = Math.min(ik.length, dk.length) / Math.max(ik.length, dk.length);
          if (ratio >= 0.72) {
            best = Math.max(best, 55 + exactYearBonus);
          }
        }
      }
    }
  }

  return best;
}

export interface MergeImdbDoubanOptions {
  /** Optional map of IMDb ttId -> Douban subjectId (e.g. from Wikidata P345/P4529) */
  crossIdMap?: Map<string, string>;
  /** Optional map of IMDb ttId/nmId -> Chinese display title (e.g. from Wikidata zh-cn label) */
  zhTitleMap?: Map<string, string>;
  /** Optional secondary Chinese assist candidates (Bangumi / Baidu Baike) used when Douban misses or lacks synopsis */
  secondaryZhItems?: OnlineSearchResult[];
  /** Append unmatched Douban items when IMDb has fewer than this count (default: 4) */
  fallbackThreshold?: number;
  /** Original search query for final ranking */
  query?: string;
}

/**
 * Core Fusion Engine: IMDb Primary + Douban & Chinese Assist.
 * - Preserves IMDb canonical ID, IMDb rating, awards, and anti-hotlink-free posters
 * - Enriches matched entries with Douban Chinese title, Douban rating, Chinese synopsis,
 *   Chinese region & genres, and marks source as `'IMDb · 豆瓣辅助'`.
 * - Falls back cleanly to secondary Chinese sources (Bangumi / Baidu Baike / Wikidata)
 *   for Chinese title and synopsis when Douban is throttled or lacks a plot summary.
 */
export function mergeImdbWithDoubanAssist(
  imdbItems: OnlineSearchResult[],
  doubanItems: OnlineSearchResult[],
  options: MergeImdbDoubanOptions = {}
): OnlineSearchResult[] {
  const {
    crossIdMap,
    zhTitleMap,
    secondaryZhItems = [],
    fallbackThreshold = 4,
    query = '',
  } = options;
  const usedDoubanIndexes = new Set<number>();
  const usedSecondaryIndexes = new Set<number>();

  const findBestSecondary = (
    target: OnlineSearchResult,
    wikiZhTitle?: string
  ): { item: OnlineSearchResult; idx: number } | null => {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < secondaryZhItems.length; i += 1) {
      if (usedSecondaryIndexes.has(i)) continue;
      const cand = secondaryZhItems[i];
      if (!hasCjkCharacters(cand.title)) continue;
      const score = scoreImdbDoubanMatch(target, cand, undefined, wikiZhTitle);
      // Require strong title/name match (>= 80) so secondary sources never mis-match
      if (score >= 80 && score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? { item: secondaryZhItems[bestIdx], idx: bestIdx } : null;
  };

  const fused: OnlineSearchResult[] = imdbItems.map((imdb) => {
    const imdbId =
      extractImdbIdFromExternalId(imdb.externalId) ||
      extractImdbIdFromUrl(imdb.sourceUrl);
    const wikiZhTitle = imdbId ? zhTitleMap?.get(imdbId) : undefined;

    let matchIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < doubanItems.length; i += 1) {
      if (usedDoubanIndexes.has(i)) continue;
      const score = scoreImdbDoubanMatch(imdb, doubanItems[i], crossIdMap, wikiZhTitle);
      if (score > bestScore) {
        bestScore = score;
        matchIdx = i;
      }
    }

    if (matchIdx === -1) {
      // No Douban match — try secondary Chinese assist (Bangumi / Baidu Baike) first!
      const secMatch = findBestSecondary(imdb, wikiZhTitle);
      if (secMatch) {
        usedSecondaryIndexes.add(secMatch.idx);
        const sec = secMatch.item;
        const preferZhTitle = hasCjkCharacters(sec.title)
          ? sec.title
          : wikiZhTitle && hasCjkCharacters(wikiZhTitle)
            ? wikiZhTitle
            : imdb.title;
        const canonicalOriginal =
          normalizeEntityKey(imdb.title) !== normalizeEntityKey(preferZhTitle)
            ? imdb.title
            : imdb.originalTitle || sec.originalTitle;

        const mergedTags = Array.from(
          new Set([
            ...(sec.tags || []).filter((t) => hasCjkCharacters(t)),
            ...(imdb.tags || []),
          ])
        ).slice(0, 4);

        const summary = isRichChineseSynopsis(sec.summary)
          ? sec.summary
          : imdb.summary || sec.summary;

        return {
          ...imdb,
          title: preferZhTitle,
          originalTitle: canonicalOriginal,
          year: imdb.year || sec.year,
          region: sec.region || imdb.region,
          subtitle: imdb.subtitle || sec.subtitle,
          coverUrl: imdb.coverUrl || sec.coverUrl,
          summary,
          sourceName: 'IMDb · 中文资料',
          sourceUrl: imdb.sourceUrl || sec.sourceUrl,
          tags: mergedTags.length > 0 ? mergedTags : imdb.tags,
        };
      }

      // Fallback: apply Wikidata Chinese title if available
      if (
        wikiZhTitle &&
        hasCjkCharacters(wikiZhTitle) &&
        normalizeEntityKey(wikiZhTitle) !== normalizeEntityKey(imdb.title)
      ) {
        return {
          ...imdb,
          title: wikiZhTitle,
          originalTitle: imdb.originalTitle || imdb.title,
        };
      }
      return imdb;
    }

    usedDoubanIndexes.add(matchIdx);
    const db = doubanItems[matchIdx];

    // Always consume any matching secondary Chinese entry (e.g. Bangumi / Baike) that corresponds
    // to this same entity so an older homonym film (e.g. Lanterns 2014) or namesake actor never
    // steals it, while also borrowing its rich Chinese synopsis if Douban only had a short stub.
    let secForSynopsis: OnlineSearchResult | undefined;
    if (secondaryZhItems.length > 0) {
      const probeTarget: OnlineSearchResult = {
        ...imdb,
        title: hasCjkCharacters(db.title) ? db.title : imdb.title,
        originalTitle: imdb.title,
      };
      const secMatch = findBestSecondary(probeTarget, wikiZhTitle || db.title);
      if (secMatch) {
        usedSecondaryIndexes.add(secMatch.idx);
        if (!isRichChineseSynopsis(db.summary)) {
          secForSynopsis = secMatch.item;
        }
      }
    }

    const preferZhTitle = hasCjkCharacters(db.title)
      ? db.title
      : wikiZhTitle && hasCjkCharacters(wikiZhTitle)
        ? wikiZhTitle
        : imdb.title;

    const canonicalOriginal =
      normalizeEntityKey(imdb.title) !== normalizeEntityKey(preferZhTitle)
        ? imdb.title
        : imdb.originalTitle || db.originalTitle;

    if (imdb.category === 'film') {
      const mediaLabel = extractMediaLabel(imdb);
      const imdbRating = extractRatingBadge(imdb.subtitle, 'IMDb');
      const doubanRating = extractRatingBadge(db.subtitle, '豆瓣');
      const directorSnippet =
        extractDirectorSnippet(db.subtitle) || extractDirectorSnippet(imdb.subtitle);

      const subtitle = [mediaLabel, imdbRating, doubanRating, directorSnippet]
        .filter(Boolean)
        .join(' · ');

      const mergedTags = Array.from(
        new Set([
          ...(db.tags || []).filter((t) => hasCjkCharacters(t)),
          ...(secForSynopsis?.tags || []).filter((t) => hasCjkCharacters(t)),
          ...(imdb.tags || []),
        ])
      ).slice(0, 4);

      const summary = isRichChineseSynopsis(db.summary)
        ? db.summary
        : isRichChineseSynopsis(secForSynopsis?.summary)
          ? secForSynopsis!.summary
          : imdb.summary || db.summary;

      return {
        ...imdb,
        title: preferZhTitle,
        originalTitle: canonicalOriginal,
        year: imdb.year || db.year || secForSynopsis?.year,
        region: db.region || secForSynopsis?.region || imdb.region,
        subtitle: subtitle || imdb.subtitle,
        coverUrl: imdb.coverUrl || db.coverUrl || secForSynopsis?.coverUrl,
        summary,
        sourceName: 'IMDb · 豆瓣辅助',
        sourceUrl: imdb.sourceUrl || db.sourceUrl,
        tags: mergedTags.length > 0 ? mergedTags : imdb.tags,
      };
    }

    // Person / Character fusion
    const mergedTags = Array.from(
      new Set([...(db.tags || []), ...(imdb.tags || [])])
    ).slice(0, 4);

    const subtitle =
      db.subtitle && db.subtitle !== '豆瓣影人'
        ? db.subtitle
        : imdb.subtitle || db.subtitle;

    const summary = isRichChineseSynopsis(db.summary)
      ? db.summary
      : isRichChineseSynopsis(secForSynopsis?.summary)
        ? secForSynopsis!.summary
        : imdb.summary || db.summary;

    return {
      ...imdb,
      title: preferZhTitle,
      originalTitle: canonicalOriginal,
      year: db.year || imdb.year,
      region: db.region || imdb.region,
      subtitle,
      coverUrl: imdb.coverUrl || db.coverUrl,
      summary,
      relatedWorkTitle: db.relatedWorkTitle || imdb.relatedWorkTitle,
      portrayedBy: db.portrayedBy || imdb.portrayedBy,
      sourceName: 'IMDb · 豆瓣辅助',
      sourceUrl: imdb.sourceUrl || db.sourceUrl,
      tags: mergedTags.length > 0 ? mergedTags : imdb.tags,
    };
  });

  // If IMDb returned very few hits (e.g. domestic Chinese show/person), append top unmatched Douban assist items
  if (fused.length < fallbackThreshold && doubanItems.length > 0) {
    const existingKeys = new Set(
      fused.map((item) => `${item.category}::${normalizeEntityKey(item.title)}`)
    );
    for (let i = 0; i < doubanItems.length; i += 1) {
      if (usedDoubanIndexes.has(i)) continue;
      const db = doubanItems[i];
      const key = `${db.category}::${normalizeEntityKey(db.title)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      fused.push({
        ...db,
        sourceName: '豆瓣辅助',
      });
      if (fused.length >= 12) break;
    }
  }

  return query ? rankImdbResults(fused, query) : fused;
}

/**
 * Ranks IMDb + Douban Assist results so exact query matches, dual-rated items,
 * and higher-rated entries appear first.
 */
export function rankImdbResults(
  items: OnlineSearchResult[],
  query: string
): OnlineSearchResult[] {
  const qNorm = normalizeEntityKey(query);
  if (!qNorm || items.length <= 1) return items;

  const scoreItem = (item: OnlineSearchResult): number => {
    const tNorm = normalizeEntityKey(item.title || '');
    const oNorm = normalizeEntityKey(item.originalTitle || '');
    let score = 0;

    if (tNorm === qNorm || (oNorm && oNorm === qNorm)) {
      score += 140;
    } else if (tNorm.startsWith(qNorm) || (oNorm && oNorm.startsWith(qNorm))) {
      score += 75;
    } else if (tNorm.includes(qNorm) || (oNorm && oNorm.includes(qNorm))) {
      score += 40;
    }

    if (item.sourceName === 'IMDb · 豆瓣辅助') score += 35;
    else if (item.sourceName === 'IMDb · 中文资料') score += 30;
    else if (item.sourceName === 'IMDb') score += 20;

    const imdbMatch = /IMDb\s*(\d+(?:\.\d+)?)/i.exec(item.subtitle || '');
    if (imdbMatch) {
      score += 22 + Math.min(10, Number(imdbMatch[1]) || 0);
    }
    const dbMatch = /豆瓣\s*(\d+(?:\.\d+)?)/.exec(item.subtitle || '');
    if (dbMatch) {
      score += 15 + Math.min(10, Number(dbMatch[1]) || 0);
    }

    if (item.coverUrl) score += 10;
    if (item.summary && item.summary.length >= 36) score += 4;
    return score;
  };

  return items
    .map((item, idx) => ({ item, score: scoreItem(item), idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((row) => row.item);
}

/**
 * Builds Cover Picker candidates (Poster + Widescreen Background) from IMDb entries.
 */
export function buildImdbCoverCandidates(
  entries: Array<{
    imdbId: string;
    title: string;
    posterUrl?: string;
    backgroundUrl?: string;
  }>
): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const poster = normalizeImdbImageUrl(entry.posterUrl, 'poster');
    if (poster && !seen.has(poster)) {
      seen.add(poster);
      out.push({
        id: `imdb-poster-${entry.imdbId}-${i}`,
        url: poster,
        source: 'IMDb 海报',
        caption: `${entry.title} · IMDb 官方海报`,
      });
    }
    const bg = normalizeImdbImageUrl(entry.backgroundUrl, 'background');
    if (bg && !seen.has(bg)) {
      seen.add(bg);
      out.push({
        id: `imdb-bg-${entry.imdbId}-${i}`,
        url: bg,
        source: 'IMDb 剧照',
        caption: `${entry.title} · IMDb 宽屏剧照`,
      });
    }
  }

  return out;
}
