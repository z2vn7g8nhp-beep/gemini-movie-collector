import type { ArchiveCategory, OnlineSearchResult } from '../types/archive';
import type { CoverCandidate } from './coverPicker';

export interface DoubanDirectRef {
  kind: 'subject' | 'celebrity';
  id: string;
}

export interface ParsedCardSubtitle {
  score?: string;
  year?: string;
  region?: string;
  genres: string[];
  credits: string[];
}

export interface DoubanImageFormatter {
  (rawUrl?: string | null): string | undefined;
}

/**
 * Recognizes direct Douban URLs or shorthand IDs pasted into the search box:
 * - https://movie.douban.com/subject/1291557/
 * - https://m.douban.com/movie/subject/1291557/
 * - https://movie.douban.com/celebrity/1115918/
 * - https://www.douban.com/personage/27321759/
 * - douban:1291557
 */
export function parseDoubanUrlOrId(input: string): DoubanDirectRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const subjectMatch =
    /douban\.com\/(?:movie\/|tv\/)?subject\/(\d{5,12})/i.exec(trimmed);
  if (subjectMatch) {
    return { kind: 'subject', id: subjectMatch[1] };
  }

  const celebMatch =
    /douban\.com\/(?:celebrity|personage)\/(\d{5,12})/i.exec(trimmed);
  if (celebMatch) {
    return { kind: 'celebrity', id: celebMatch[1] };
  }

  const prefixSubject = /^(?:douban|db|subject)[:：\s#]+(\d{5,12})$/i.exec(
    trimmed
  );
  if (prefixSubject) {
    return { kind: 'subject', id: prefixSubject[1] };
  }

  const prefixCeleb = /^(?:celebrity|personage|影人)[:：\s#]+(\d{5,12})$/i.exec(
    trimmed
  );
  if (prefixCeleb) {
    return { kind: 'celebrity', id: prefixCeleb[1] };
  }

  return null;
}

/**
 * Normalizes Douban CDN image URLs into stable, high-resolution HTTPS URLs.
 * Converts ephemeral/tiny `qnmob3-sign.doubanio.com/.../public/p12345.jpg?...h/120...`
 * URLs to permanent `img3.doubanio.com/view/photo/{variant}/public/p12345.jpg`.
 */
export function normalizeDoubanImageUrl(
  rawUrl?: string | null,
  variant: 'poster' | 'photo' | 'avatar' = 'poster'
): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  let url = rawUrl.trim();
  if (!url) return undefined;
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^http:\/\//i.test(url)) url = `https://${url.slice(7)}`;
  if (!/^https:\/\//i.test(url)) return undefined;

  // Skip Douban default placeholder avatars/posters
  if (
    /default_(?:small|medium|large)|movie_default|celebrity-default|user_normal/i.test(
      url
    )
  ) {
    return undefined;
  }

  // Convert signed/resized qnmob3-sign photo URLs into clean, non-expiring img3 URLs
  const photoFileMatch =
    /doubanio\.com\/view\/photo\/[^/]+\/public\/(p\d+\.(?:jpg|jpeg|png|webp))/i.exec(
      url
    );
  if (photoFileMatch) {
    const file = photoFileMatch[1];
    const targetSize = variant === 'poster' ? 'm_ratio_poster' : 'm';
    return `https://img3.doubanio.com/view/photo/${targetSize}/public/${file}`;
  }

  // Upgrade small celebrity/personage thumbnails (s -> m or l)
  if (/doubanio\.com\/view\/(?:celebrity|personage)\/s\//i.test(url)) {
    return url.replace(
      /\/view\/(celebrity|personage)\/s\//i,
      '/view/$1/m/'
    );
  }

  // Strip trailing imageView2 tiny-thumbnail query on other doubanio URLs
  if (url.includes('imageView2/') && url.includes('/h/120/')) {
    return url.replace('/h/120/', '/h/600/');
  }

  return url;
}

export function cleanDoubanText(raw?: string | null, maxLen = 240): string {
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
  const match = /\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(raw);
  return match ? match[1] : undefined;
}

/**
 * Parses Douban's slash-delimited `card_subtitle` such as:
 *   "8.8分 / 2000 / 中国香港 / 剧情 爱情 / 王家卫 / 张曼玉 梁朝伟"
 *   "中国香港 / 剧情 爱情 / 王家卫 / 张曼玉 梁朝伟"
 */
export function parseDoubanCardSubtitle(raw?: string | null): ParsedCardSubtitle {
  const out: ParsedCardSubtitle = { genres: [], credits: [] };
  if (!raw || typeof raw !== 'string') return out;

  const segments = raw
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  let idx = 0;
  if (segments[idx] && /^\d+(?:\.\d+)?分$/.test(segments[idx])) {
    out.score = segments[idx].replace(/分$/, '');
    idx += 1;
  }
  if (segments[idx] && /^(18\d{2}|19\d{2}|20\d{2})$/.test(segments[idx])) {
    out.year = segments[idx];
    idx += 1;
  }

  const remaining = segments.slice(idx);
  if (remaining.length >= 1) {
    out.region = remaining[0].split(/\s+/).slice(0, 2).join(' / ');
  }
  if (remaining.length >= 2) {
    out.genres = remaining[1]
      .split(/\s+/)
      .map((g) => g.trim())
      .filter((g) => g.length > 0 && g.length <= 10)
      .slice(0, 4);
  }
  if (remaining.length >= 3) {
    out.credits = remaining
      .slice(2)
      .flatMap((seg) => seg.split(/\s+/))
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return out;
}

/**
 * Extracts a clean character name from Douban credit role strings:
 *   "演员 Actress (饰 苏丽珍)" -> "苏丽珍"
 *   "饰 周慕云" -> "周慕云"
 *   "演员 (饰 陈永仁)" -> "陈永仁"
 *   "配音 Voice (配 千寻)" -> "千寻"
 * Returns `undefined` for non-character roles like "导演 Director", "编剧", "自己", "配音".
 */
export function extractDoubanCharacterName(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  let candidate: string | undefined;

  // Pattern 1: parenthetical "(饰 XXX)" or "（饰 XXX）" or "(配 XXX)"
  const parenMatch = /[（(]\s*(?:饰|饰演|配|配音)\s*([^）)]+?)\s*[）)]/.exec(
    trimmed
  );
  if (parenMatch) {
    candidate = parenMatch[1].trim();
  } else {
    // Pattern 2: leading "饰 XXX" or "饰演 XXX"
    const leadMatch = /^(?:饰|饰演|配音)\s+(.+)$/.exec(trimmed);
    if (leadMatch) {
      candidate = leadMatch[1].trim();
    } else {
      // Pattern 3: "演员 - XXX" (common in celebrity/works)
      const dashMatch = /^(?:演员|配音)\s*[-—–]\s*(.+)$/.exec(trimmed);
      if (dashMatch) {
        candidate = dashMatch[1].trim();
      }
    }
  }

  if (!candidate) return undefined;

  // Clean trailing notes or empty/meta roles
  candidate = candidate
    .replace(/\s*(?:配音|Voice|青年|老年|童年|客串|友情出演)$/i, '')
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
    .trim();

  if (
    !candidate ||
    candidate.length < 1 ||
    candidate.length > 36 ||
    /^(?:自己|本人|配音|旁白|演员|主演|导演|编剧|制片人|主持人|嘉宾|Himself|Herself|Self|Voice|Narrator|Actor|Actress)$/i.test(
      candidate
    )
  ) {
    return undefined;
  }

  return candidate;
}

/**
 * Parses `m.douban.com/rexxar/api/v2/search/movie` items into OnlineSearchResult[].
 */
export function parseDoubanMovieSearch(
  payload: Record<string, any> | null | undefined,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): OnlineSearchResult[] {
  const rawItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.subjects?.items)
      ? payload.subjects.items
      : [];

  const out: OnlineSearchResult[] = [];
  const seen = new Set<string>();

  for (const row of rawItems) {
    if (!row || (row.layout && row.layout !== 'subject')) continue;
    const tType = String(row.target_type || row.target?.type || '').toLowerCase();
    if (tType && tType !== 'movie' && tType !== 'tv') continue;

    const target = row.target;
    if (!target || !target.id || !target.title) continue;
    const id = String(target.id);
    if (seen.has(id)) continue;
    seen.add(id);

    const title = String(target.title).trim();
    const parsedSub = parseDoubanCardSubtitle(target.card_subtitle);
    const ratingVal = Number(target.rating?.value || parsedSub.score || 0);
    const ratingLabel = ratingVal > 0 ? `豆瓣 ${ratingVal.toFixed(1)}` : undefined;
    const mediaLabel = tType === 'tv' ? '剧集' : '电影';

    const subtitleParts = [
      mediaLabel,
      ratingLabel,
      parsedSub.genres.slice(0, 2).join(' / '),
    ].filter(Boolean);

    const normalizedCover = normalizeDoubanImageUrl(
      target.pic?.large || target.pic?.normal || target.cover_url,
      'poster'
    );

    const summaryPieces: string[] = [];
    if (target.card_subtitle) {
      summaryPieces.push(String(target.card_subtitle).trim());
    }
    if (target.abstract) {
      summaryPieces.push(cleanDoubanText(target.abstract, 180));
    }

    const tags = Array.from(
      new Set([
        ...parsedSub.genres.slice(0, 3),
        ...(parsedSub.genres.length === 0 ? [mediaLabel] : []),
      ])
    );

    out.push({
      externalId: `douban-subj-${id}`,
      category: 'film',
      title,
      year: extractYear(String(target.year || parsedSub.year || '')),
      region: parsedSub.region,
      subtitle: subtitleParts.join(' · '),
      coverUrl: formatImg(normalizedCover),
      summary:
        cleanDoubanText(summaryPieces.join(' — '), 220) ||
        `${title}（豆瓣${mediaLabel}）`,
      sourceName: '豆瓣影视',
      sourceUrl: `https://movie.douban.com/subject/${id}/`,
      tags,
    });
  }

  return out;
}

/**
 * Parses `movie.douban.com/j/subject_suggest` entries into movies & celebrities.
 */
export function parseDoubanSuggest(
  payload: unknown,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): {
  movies: OnlineSearchResult[];
  celebrities: OnlineSearchResult[];
} {
  const movies: OnlineSearchResult[] = [];
  const celebrities: OnlineSearchResult[] = [];
  if (!Array.isArray(payload)) return { movies, celebrities };

  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;
    const id = String((row as any).id || '').trim();
    const title = String((row as any).title || '').trim();
    if (!id || !title) continue;

    const subTitle =
      typeof (row as any).sub_title === 'string' &&
      (row as any).sub_title.trim() &&
      (row as any).sub_title.trim() !== title
        ? (row as any).sub_title.trim()
        : undefined;
    const type = String((row as any).type || '').toLowerCase();

    if (type === 'celebrity') {
      const cover = normalizeDoubanImageUrl((row as any).img, 'avatar');
      celebrities.push({
        externalId: `douban-celeb-${id}`,
        category: 'person',
        title,
        originalTitle: subTitle,
        subtitle: '豆瓣影人',
        coverUrl: formatImg(cover),
        summary: `${title}${subTitle ? `（${subTitle}）` : ''}，收录自豆瓣影人档案。`,
        sourceName: '豆瓣影视',
        sourceUrl: `https://movie.douban.com/celebrity/${id}/`,
        tags: ['影人'],
      });
    } else if (type === 'movie' || type === 'tv' || !type) {
      const cover = normalizeDoubanImageUrl((row as any).img, 'poster');
      const episode = String((row as any).episode || '').trim();
      const mediaLabel = episode ? `剧集 · ${episode}集` : '影视';
      movies.push({
        externalId: `douban-subj-${id}`,
        category: 'film',
        title,
        originalTitle: subTitle,
        year: extractYear(String((row as any).year || '')),
        subtitle: mediaLabel,
        coverUrl: formatImg(cover),
        summary: `${title}${subTitle ? `（${subTitle}）` : ''}，豆瓣影视条目。`,
        sourceName: '豆瓣影视',
        sourceUrl: `https://movie.douban.com/subject/${id}/`,
        tags: [episode ? '剧集' : '电影'],
      });
    }
  }

  return { movies, celebrities };
}

/**
 * Parses `m.douban.com/rexxar/api/v2/movie/{id}` (works for both movies & TV)
 * into a rich OnlineSearchResult with full Chinese synopsis, Douban rating,
 * countries, genres, and original title.
 */
export function parseDoubanSubjectDetail(
  detail: Record<string, any> | null | undefined,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): OnlineSearchResult | null {
  if (!detail || !detail.id || !detail.title) return null;
  const id = String(detail.id);
  const title = String(detail.title).trim();
  const originalTitle =
    typeof detail.original_title === 'string' &&
    detail.original_title.trim() &&
    detail.original_title.trim() !== title
      ? detail.original_title.trim()
      : undefined;

  const isTv =
    detail.type === 'tv' ||
    detail.is_tv === true ||
    Number(detail.episodes_count || 0) > 1;
  const mediaLabel = isTv ? '剧集' : '电影';

  const ratingVal = Number(detail.rating?.value || 0);
  const ratingLabel = ratingVal > 0 ? `豆瓣 ${ratingVal.toFixed(1)}` : undefined;

  const genres: string[] = Array.isArray(detail.genres)
    ? detail.genres
        .filter((g: unknown): g is string => typeof g === 'string' && g.trim().length > 0)
        .slice(0, 4)
    : [];

  const countries: string[] = Array.isArray(detail.countries)
    ? detail.countries
        .filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
        .slice(0, 2)
    : [];

  const directors: string[] = Array.isArray(detail.directors)
    ? detail.directors
        .map((d: any) => (typeof d === 'string' ? d : d?.name))
        .filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0)
        .slice(0, 2)
    : [];

  const subtitle = [
    mediaLabel,
    ratingLabel,
    directors.length > 0 ? `导演 ${directors[0]}` : genres.slice(0, 2).join(' / '),
  ]
    .filter(Boolean)
    .join(' · ');

  const cover = normalizeDoubanImageUrl(
    detail.pic?.large || detail.pic?.normal || detail.cover_url,
    'poster'
  );

  const intro = cleanDoubanText(detail.intro, 240);
  const fallbackSummary = cleanDoubanText(
    detail.card_subtitle || `${title}（豆瓣${mediaLabel}）`,
    220
  );

  const tags = Array.from(
    new Set([...genres.slice(0, 3), ...(genres.length === 0 ? [mediaLabel] : [])])
  );

  return {
    externalId: `douban-subj-${id}`,
    category: 'film',
    title,
    originalTitle,
    subtitle,
    year: extractYear(String(detail.year || '')),
    region: countries.length > 0 ? countries.join(' / ') : undefined,
    coverUrl: formatImg(cover),
    summary: intro || fallbackSummary,
    sourceName: '豆瓣影视',
    sourceUrl: `https://movie.douban.com/subject/${id}/`,
    tags,
  };
}

/**
 * Parses `m.douban.com/rexxar/api/v2/movie/{id}/credits` into both:
 * - `people`: Directors, writers, actors with Douban portraits & celebrity IDs
 * - `characters`: Named characters parsed from `(饰 XXX)` with actor & work links
 */
export function parseDoubanCredits(
  payload: Record<string, any> | null | undefined,
  filmTitle: string,
  filmSourceUrl?: string,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): {
  people: OnlineSearchResult[];
  characters: OnlineSearchResult[];
} {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const people: OnlineSearchResult[] = [];
  const characters: OnlineSearchResult[] = [];
  const seenPeople = new Set<string>();
  const seenChars = new Set<string>();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim();
    if (!name) continue;
    const celebId = item.id ? String(item.id) : undefined;
    const latinName =
      typeof item.latin_name === 'string' &&
      item.latin_name.trim() &&
      item.latin_name.trim() !== name
        ? item.latin_name.trim()
        : undefined;
    const rawChar = String(item.character || item.simple_character || '').trim();
    const simpleChar = String(item.simple_character || rawChar).trim();
    const charName =
      extractDoubanCharacterName(rawChar) ||
      extractDoubanCharacterName(simpleChar);

    const avatar = normalizeDoubanImageUrl(
      item.avatar?.large || item.avatar?.normal,
      'avatar'
    );
    const formattedAvatar = formatImg(avatar);

    const isDirector = /导演|Director/i.test(rawChar);
    const isWriter = /编剧|Writer/i.test(rawChar);
    const roleTag = isDirector ? '导演' : isWriter ? '编剧' : '演员';
    const roleLabel = charName
      ? `饰 ${charName}`
      : isDirector
        ? '导演'
        : isWriter
          ? '编剧'
          : simpleChar || '演员';

    const personKey = celebId || name.toLowerCase();
    if (!seenPeople.has(personKey)) {
      seenPeople.add(personKey);
      people.push({
        externalId: celebId ? `douban-celeb-${celebId}` : `douban-person-${name}`,
        category: 'person',
        title: name,
        originalTitle: latinName,
        subtitle: roleLabel,
        coverUrl: formattedAvatar,
        summary: charName
          ? `在《${filmTitle}》中饰演 ${charName}。`
          : `在《${filmTitle}》中担任${roleTag}。`,
        relatedWorkTitle: filmTitle,
        sourceName: '豆瓣影视',
        sourceUrl: celebId
          ? `https://movie.douban.com/celebrity/${celebId}/`
          : filmSourceUrl,
        tags: [roleTag],
      });
    }

    if (charName) {
      const charKey = charName.toLowerCase();
      if (!seenChars.has(charKey)) {
        seenChars.add(charKey);
        characters.push({
          externalId: `douban-char-${celebId || name}-${charName}`,
          category: 'character',
          title: charName,
          subtitle: `出自《${filmTitle}》 · ${name} 饰演`,
          coverUrl: formattedAvatar,
          summary: `《${filmTitle}》中的角色「${charName}」，由 ${name} 饰演。`,
          relatedWorkTitle: filmTitle,
          portrayedBy: name,
          sourceName: '豆瓣影视',
          sourceUrl: filmSourceUrl,
          tags: ['影视角色', filmTitle],
        });
      }
    }
  }

  return { people, characters };
}

/**
 * Parses `m.douban.com/rexxar/api/v2/celebrity/{id}` into an OnlineSearchResult.
 */
export function parseDoubanCelebrityDetail(
  detail: Record<string, any> | null | undefined,
  fallbackId?: string,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): OnlineSearchResult | null {
  if (!detail || typeof detail !== 'object') return null;
  const title = String(detail.title || detail.name || '').trim();
  if (!title) return null;

  const id = String(fallbackId || detail.id || '').trim();
  const latin =
    typeof detail.latin_title === 'string' &&
    detail.latin_title.trim() &&
    detail.latin_title.trim() !== title
      ? detail.latin_title.trim()
      : typeof detail.latin_name === 'string' &&
          detail.latin_name.trim() &&
          detail.latin_name.trim() !== title
        ? detail.latin_name.trim()
        : undefined;

  const extraPairs = new Map<string, string>();
  const rawInfo = detail.extra?.info;
  if (Array.isArray(rawInfo)) {
    for (const pair of rawInfo) {
      if (Array.isArray(pair) && pair.length >= 2) {
        const k = String(pair[0] || '').trim();
        const v = String(pair[1] || '').trim();
        if (k && v) extraPairs.set(k, v);
      }
    }
  }

  const shortInfo =
    typeof detail.extra?.short_info === 'string'
      ? detail.extra.short_info.trim()
      : '';
  const [rawRolesPart, rawWorksPart] = shortInfo
    .split('/')
    .map((s: string) => s.trim());
  const roles = rawRolesPart
    ? rawRolesPart
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
    : Array.isArray(detail.roles)
      ? detail.roles.slice(0, 4)
      : [];

  const birthday = extraPairs.get('出生日期') || detail.birthday;
  const birthplace = extraPairs.get('出生地') || detail.birthplace;
  const cover = normalizeDoubanImageUrl(
    detail.cover?.large?.url ||
      detail.cover_img?.url ||
      detail.cover?.normal?.url,
    'avatar'
  );

  const summaryParts: string[] = [];
  if (detail.intro && typeof detail.intro === 'string' && detail.intro.trim()) {
    summaryParts.push(cleanDoubanText(detail.intro, 220));
  } else {
    if (roles.length > 0) summaryParts.push(`职业：${roles.join(' / ')}`);
    if (birthplace) summaryParts.push(`出生地：${birthplace}`);
    if (birthday) summaryParts.push(`出生日期：${birthday}`);
    if (rawWorksPart) summaryParts.push(`代表作：${rawWorksPart}`);
  }

  const canonicalUrl =
    typeof detail.url === 'string' && detail.url.startsWith('http')
      ? detail.url
      : id
        ? `https://movie.douban.com/celebrity/${id}/`
        : undefined;

  return {
    externalId: `douban-celeb-${id || title}`,
    category: 'person',
    title,
    originalTitle: latin,
    subtitle: roles.length > 0 ? roles.join(' · ') : '豆瓣影人',
    year: extractYear(birthday),
    region: birthplace || undefined,
    coverUrl: formatImg(cover),
    summary: summaryParts.join('；') || `${title}（豆瓣影人档案）`,
    sourceName: '豆瓣影视',
    sourceUrl: canonicalUrl,
    tags: roles.length > 0 ? roles.slice(0, 3) : ['影人'],
  };
}

/**
 * Parses `m.douban.com/rexxar/api/v2/celebrity/{id}/works` into:
 * - `films`: Top works with Douban ratings, years, high-res posters
 * - `characters`: Named characters played across those works (`演员 (饰 陈永仁)`)
 */
export function parseDoubanCelebrityWorks(
  payload: Record<string, any> | null | undefined,
  personName: string,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): {
  films: OnlineSearchResult[];
  characters: OnlineSearchResult[];
} {
  const works = Array.isArray(payload?.works) ? payload.works : [];
  const films: OnlineSearchResult[] = [];
  const characters: OnlineSearchResult[] = [];
  const seenFilms = new Set<string>();
  const seenChars = new Set<string>();

  for (const entry of works) {
    const work = entry?.work;
    if (!work || !work.id || !work.title) continue;
    const workId = String(work.id);
    if (seenFilms.has(workId)) continue;
    seenFilms.add(workId);

    const workTitle = String(work.title).trim();
    const rawRoles: string[] = Array.isArray(entry.roles)
      ? entry.roles.filter((r: unknown): r is string => typeof r === 'string')
      : [];
    const charName = rawRoles
      .map((r) => extractDoubanCharacterName(r))
      .find(Boolean);

    const ratingVal = Number(work.rating?.value || 0);
    const ratingLabel = ratingVal > 0 ? `豆瓣 ${ratingVal.toFixed(1)}` : undefined;
    const mediaLabel = work.type === 'tv' ? '剧集' : '电影';
    const cover = normalizeDoubanImageUrl(
      work.pic?.large || work.pic?.normal || work.cover_url,
      'poster'
    );
    const formattedCover = formatImg(cover);
    const workUrl = `https://movie.douban.com/subject/${workId}/`;

    const subtitle = [
      ratingLabel,
      charName ? `饰 ${charName}` : rawRoles[0] || mediaLabel,
    ]
      .filter(Boolean)
      .join(' · ');

    films.push({
      externalId: `douban-subj-${workId}`,
      category: 'film',
      title: workTitle,
      year: extractYear(String(work.year || '')),
      subtitle,
      coverUrl: formattedCover,
      summary: charName
        ? `${personName} 参演的${mediaLabel}《${workTitle}》，饰演 ${charName}。`
        : `${personName} 参与的${mediaLabel}《${workTitle}》（${rawRoles[0] || mediaLabel}）。`,
      relatedWorkTitle: personName,
      sourceName: '豆瓣影视',
      sourceUrl: workUrl,
      tags: Array.isArray(work.genres) && work.genres.length > 0
        ? work.genres.slice(0, 3)
        : [mediaLabel],
    });

    if (charName) {
      const charKey = charName.toLowerCase();
      if (!seenChars.has(charKey)) {
        seenChars.add(charKey);
        characters.push({
          externalId: `douban-pchar-${workId}-${charName}`,
          category: 'character',
          title: charName,
          year: extractYear(String(work.year || '')),
          subtitle: `出自《${workTitle}》`,
          coverUrl: formattedCover,
          summary: `由 ${personName} 在《${workTitle}》中饰演的角色「${charName}」。`,
          relatedWorkTitle: workTitle,
          portrayedBy: personName,
          sourceName: '豆瓣影视',
          sourceUrl: workUrl,
          tags: ['影视角色', workTitle],
        });
      }
    }
  }

  return { films, characters };
}

/**
 * Parses `m.douban.com/rexxar/api/v2/(movie|celebrity)/{id}/photos` into CoverCandidate[].
 */
export function parseDoubanPhotos(
  payload: Record<string, any> | null | undefined,
  captionPrefix: string,
  formatImg: DoubanImageFormatter = (u) => u ?? undefined
): CoverCandidate[] {
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  const out: CoverCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < photos.length; i += 1) {
    const imgObj = photos[i]?.image;
    const raw =
      imgObj?.normal?.url || imgObj?.large?.url || imgObj?.small?.url;
    const normalized = normalizeDoubanImageUrl(raw, 'photo');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const formatted = formatImg(normalized);
    if (!formatted) continue;
    out.push({
      id: `douban-photo-${i}-${photos[i]?.id || i}`,
      url: formatted,
      source: '豆瓣剧照',
      caption: photos[i]?.description
        ? `${captionPrefix} · ${cleanDoubanText(photos[i].description, 22)}`
        : `${captionPrefix} · 豆瓣图库`,
    });
  }

  return out;
}

/**
 * Normalizes a user-configured Douban Relay / Proxy base URL (for GitHub Pages static mode).
 */
export function normalizeRelayBaseUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/**
 * Extracts raw JSON from a `https://r.jina.ai/...` JSON envelope (`{ code: 200, data: { content } }`).
 */
export function extractJsonFromJinaEnvelope(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== 'object') return null;
  const content = (envelope as { data?: { content?: unknown } })?.data?.content;
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  // Strip optional markdown code fences or leading metadata lines
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1]) {
    const inside = tryParse(fenceMatch[1].trim());
    if (inside !== null) return inside;
  }

  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1
      ? firstArr
      : firstArr === -1
        ? firstObj
        : Math.min(firstObj, firstArr);
  if (start >= 0) {
    const lastEnd = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (lastEnd > start) {
      return tryParse(trimmed.slice(start, lastEnd + 1));
    }
  }
  return null;
}

export interface ParsedStaticDoubanEntry {
  result: OnlineSearchResult;
  people: OnlineSearchResult[];
}

function pickWmdbLocaleData(entries: unknown): Record<string, any> | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const cn = entries.find(
    (d) => d && typeof d === 'object' && String((d as any).lang || '').toLowerCase() === 'cn'
  );
  return (cn || entries[0]) as Record<string, any>;
}

function extractWmdbPersonNames(list: unknown, limit = 8): string[] {
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const loc = pickWmdbLocaleData(row?.data);
    const name = typeof loc?.name === 'string' ? loc.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

/**
 * Parses a WMDB (Douban-indexed) movie/TV record into an OnlineSearchResult + cast people list.
 * Uses direct anti-hotlink-free `img.wmdb.tv` posters so static mobile pages render crisp covers.
 */
export function parseWmdbMovieRecord(
  item: Record<string, any> | null | undefined
): ParsedStaticDoubanEntry | null {
  if (!item || typeof item !== 'object') return null;
  const doubanId = String(item.doubanId || '').trim();
  const loc = pickWmdbLocaleData(item.data);
  const title = cleanDoubanText(
    String(loc?.name || item.originalName || ''),
    80
  );
  if (!title) return null;

  const aliasFirst =
    typeof item.alias === 'string'
      ? item.alias
          .split('/')
          .map((s: string) => s.trim())
          .find((s: string) => s && s !== title)
      : undefined;
  const rawOrig =
    item.originalName && String(item.originalName).trim() !== title
      ? String(item.originalName).trim()
      : aliasFirst;

  const year = extractYear(String(item.year || item.dateReleased || ''));
  const ratingStr =
    typeof item.doubanRating === 'string' || typeof item.doubanRating === 'number'
      ? String(item.doubanRating).trim()
      : '';
  const ratingNum = ratingStr ? Number(ratingStr) : 0;
  const rating =
    Number.isFinite(ratingNum) && ratingNum > 0
      ? ratingNum.toFixed(1)
      : undefined;

  const isTv =
    String(item.type || '').toLowerCase().includes('tv') ||
    Number(item.episodes || 0) > 1;
  const typeLabel = isTv ? '剧集' : '电影';

  const directors = extractWmdbPersonNames(item.director, 3);
  const actors = extractWmdbPersonNames(item.actor, 10);

  const genres =
    typeof loc?.genre === 'string'
      ? loc.genre
          .split(/[\/／、,，\s]+/)
          .map((g: string) => g.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];
  const region =
    typeof loc?.country === 'string' && loc.country.trim()
      ? loc.country.split(/[\/／,，]+/)[0].trim()
      : undefined;

  const rawPoster =
    typeof loc?.poster === 'string' && /^https?:\/\//i.test(loc.poster.trim())
      ? loc.poster.trim().replace(/^http:\/\//i, 'https://')
      : undefined;

  const sourceUrl = doubanId
    ? `https://movie.douban.com/subject/${doubanId}/`
    : undefined;
  const externalId = doubanId
    ? `douban-subj-${doubanId}`
    : `douban-wmdb-${title}`;

  const subtitleParts: string[] = [typeLabel];
  if (rating) subtitleParts.push(`豆瓣 ${rating}`);
  if (directors.length > 0) subtitleParts.push(`导演 ${directors[0]}`);
  else if (genres.length > 0) subtitleParts.push(genres.slice(0, 2).join(' / '));

  const desc = cleanDoubanText(String(loc?.description || ''), 240);
  const fallbackSummary = [
    `${title}${year ? `（${year}）` : ''}`,
    rating ? `豆瓣评分 ${rating}` : '',
    directors.length > 0 ? `导演：${directors.join(' / ')}` : '',
    actors.length > 0 ? `主演：${actors.slice(0, 4).join(' / ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const result: OnlineSearchResult = {
    externalId,
    category: 'film',
    title,
    originalTitle: rawOrig,
    subtitle: subtitleParts.join(' · '),
    year,
    region,
    coverUrl: rawPoster,
    summary: desc || fallbackSummary,
    sourceName: '豆瓣影视',
    sourceUrl,
    tags: genres.length > 0 ? genres : [typeLabel],
  };

  const people: OnlineSearchResult[] = [];
  const seenNames = new Set<string>();
  for (const d of directors) {
    if (seenNames.has(d)) continue;
    seenNames.add(d);
    people.push({
      externalId: `douban-static-dir-${doubanId || title}-${d}`,
      category: 'person',
      title: d,
      subtitle: '导演',
      summary: `《${title}》导演。`,
      relatedWorkTitle: title,
      sourceName: '豆瓣影视',
      sourceUrl,
      tags: ['导演'],
    });
  }
  for (const a of actors) {
    if (seenNames.has(a)) continue;
    seenNames.add(a);
    people.push({
      externalId: `douban-static-act-${doubanId || title}-${a}`,
      category: 'person',
      title: a,
      subtitle: '主演',
      summary: `在《${title}》中担任主演。`,
      relatedWorkTitle: title,
      sourceName: '豆瓣影视',
      sourceUrl,
      tags: ['演员'],
    });
  }

  return { result, people };
}

export function parseWmdbSearchPayload(
  payload: Record<string, any> | null | undefined
): ParsedStaticDoubanEntry[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const out: ParsedStaticDoubanEntry[] = [];
  for (const row of rows) {
    const parsed = parseWmdbMovieRecord(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Parses `movie.douban.com/j/subject_abstract?subject_id={id}` (live Douban rating, cast, genres).
 */
export function parseDoubanSubjectAbstract(
  payload: Record<string, any> | null | undefined
): ParsedStaticDoubanEntry | null {
  const subj = payload?.subject;
  if (!subj || typeof subj !== 'object') return null;

  const id = String(subj.id || '').trim();
  const rawTitle = String(subj.title || '')
    .replace(/\u200e/g, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
  if (!rawTitle) return null;

  // Douban abstract titles sometimes concatenate Chinese + Original title with a space
  const title = rawTitle;
  const year = extractYear(String(subj.release_year || subj.title || ''));
  const ratingNum = Number(subj.rate || 0);
  const rating =
    Number.isFinite(ratingNum) && ratingNum > 0
      ? ratingNum.toFixed(1)
      : undefined;
  const typeLabel =
    subj.is_tv || String(subj.subtype || '').toLowerCase() === 'tv'
      ? '剧集'
      : '电影';
  const directors: string[] = Array.isArray(subj.directors)
    ? subj.directors.map((d: unknown) => String(d || '').trim()).filter(Boolean)
    : [];
  const actors: string[] = Array.isArray(subj.actors)
    ? subj.actors.map((a: unknown) => String(a || '').trim()).filter(Boolean)
    : [];
  const genres: string[] = Array.isArray(subj.types)
    ? subj.types.map((g: unknown) => String(g || '').trim()).filter(Boolean)
    : [];
  const region =
    typeof subj.region === 'string' && subj.region.trim()
      ? subj.region.trim()
      : undefined;
  const sourceUrl =
    typeof subj.url === 'string' && subj.url.trim()
      ? subj.url.trim()
      : id
        ? `https://movie.douban.com/subject/${id}/`
        : undefined;

  const subtitleParts: string[] = [typeLabel];
  if (rating) subtitleParts.push(`豆瓣 ${rating}`);
  if (directors.length > 0) subtitleParts.push(`导演 ${directors[0]}`);

  const summaryParts: string[] = [];
  if (directors.length > 0) summaryParts.push(`导演：${directors.slice(0, 2).join(' / ')}`);
  if (actors.length > 0) summaryParts.push(`主演：${actors.slice(0, 5).join(' / ')}`);
  if (subj.short_comment?.content) {
    summaryParts.push(`短评：「${cleanDoubanText(String(subj.short_comment.content), 90)}」`);
  }

  const result: OnlineSearchResult = {
    externalId: id ? `douban-subj-${id}` : `douban-abs-${title}`,
    category: 'film',
    title,
    subtitle: subtitleParts.join(' · '),
    year,
    region,
    summary:
      summaryParts.join(' · ') ||
      `${title}${year ? `（${year}）` : ''} · 豆瓣影视条目`,
    sourceName: '豆瓣影视',
    sourceUrl,
    tags: genres.length > 0 ? genres.slice(0, 4) : [typeLabel],
  };

  const people: OnlineSearchResult[] = [];
  const seen = new Set<string>();
  for (const d of directors.slice(0, 3)) {
    if (seen.has(d)) continue;
    seen.add(d);
    people.push({
      externalId: `douban-abs-dir-${id || title}-${d}`,
      category: 'person',
      title: d,
      subtitle: '导演',
      summary: `《${title}》导演。`,
      relatedWorkTitle: title,
      sourceName: '豆瓣影视',
      sourceUrl,
      tags: ['导演'],
    });
  }
  for (const a of actors.slice(0, 12)) {
    if (seen.has(a)) continue;
    seen.add(a);
    people.push({
      externalId: `douban-abs-act-${id || title}-${a}`,
      category: 'person',
      title: a,
      subtitle: '主演',
      summary: `在《${title}》中担任主演。`,
      relatedWorkTitle: title,
      sourceName: '豆瓣影视',
      sourceUrl,
      tags: ['演员'],
    });
  }

  return { result, people };
}
