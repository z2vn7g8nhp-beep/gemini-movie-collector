import type {
  ArchiveCategory,
  CharacterProfile,
  OnlineSearchResult,
} from '../types/archive';

/**
 * Safely normalizes remote URLs to HTTPS so GitHub Pages (HTTPS) never suffers
 * mixed-content image blocks on mobile Safari/Chrome.
 */
export function upgradeToHttpsUrl(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  if (/^http:\/\//i.test(trimmed)) {
    return `https://${trimmed.slice(7)}`;
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * Strips Baidu Baike HTML fragments including citation superscripts like
 * `<sup>74</sup><a name="ref_74"></a>` so clean Chinese text remains.
 */
export function stripBaikeHtml(raw?: string | null, maxLen = 240): string {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<a\b[^>]*name=["']?ref_[^"']*["']?[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\[\d+(?:-\d+)?\]/g, '')
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

function splitChineseList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[、，,\/／;；|]+/)
        .map((part) =>
          part
            .replace(/[《》「」『』""''（）()]/g, '')
            .replace(/等$/, '')
            .trim()
        )
        .filter((part) => part.length >= 2 && part.length <= 28)
    )
  );
}

function extractBookTitles(raw: string): string[] {
  const bracketed: string[] = [];
  const regex = /《([^《》]{1,32})》/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const title = match[1].trim();
    if (title) bracketed.push(title);
  }
  if (bracketed.length > 0) {
    return Array.from(new Set(bracketed));
  }
  return splitChineseList(raw);
}

export interface ParsedBaikeBundle {
  searchResult: OnlineSearchResult | null;
  relatedPeople: OnlineSearchResult[];
  relatedFilms: OnlineSearchResult[];
  characterProfile: Partial<CharacterProfile>;
}

/**
 * Parses a Baidu Baike `BaikeLemmaCardApi` response into:
 * - an OnlineSearchResult card,
 * - related people / films extracted from infobox fields,
 * - and structured CharacterProfile dossier fields.
 */
export function parseBaiduBaikeCard(
  payload: Record<string, any> | null | undefined,
  requestedCategory: ArchiveCategory
): ParsedBaikeBundle {
  const empty: ParsedBaikeBundle = {
    searchResult: null,
    relatedPeople: [],
    relatedFilms: [],
    characterProfile: {},
  };

  if (!payload || typeof payload !== 'object') return empty;
  const title = stripBaikeHtml(
    typeof payload.title === 'string' ? payload.title : payload.key,
    80
  );
  if (!title) return empty;

  const desc = stripBaikeHtml(payload.desc, 80);
  const abstract = stripBaikeHtml(payload.abstract, 360);
  const coverUrl = upgradeToHttpsUrl(payload.image);
  const sourceUrl = upgradeToHttpsUrl(payload.url) ||
    `https://baike.baidu.com/item/${encodeURIComponent(title)}`;

  const cardMap = new Map<string, string>();
  const rawCards = Array.isArray(payload.card) ? payload.card : [];
  for (const row of rawCards) {
    const key = stripBaikeHtml(row?.name, 40).replace(/\s+/g, '');
    if (!key) continue;
    const rawValues = Array.isArray(row?.value)
      ? row.value.map((v: unknown) => stripBaikeHtml(String(v ?? ''), 240)).filter(Boolean)
      : typeof row?.value === 'string'
        ? [stripBaikeHtml(row.value, 240)]
        : [];
    const joined = rawValues.join('、').trim();
    if (joined && !cardMap.has(key)) {
      cardMap.set(key, joined);
    }
  }

  const pickCard = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const hit = cardMap.get(k);
      if (hit) return hit;
    }
    return undefined;
  };

  const originalTitle = pickCard(['外文名', '英文名', '日文名', '原名']);
  const directorRaw = pickCard(['导演', '总导演', '执导']);
  const writerRaw = pickCard(['编剧', '原著', '作者']);
  const castRaw = pickCard(['主演', '领衔主演', '配音', '声优', '演员']);
  const genreRaw = pickCard(['类型', '作品类型', '题材']);
  const regionRaw = pickCard(['制片地区', '出品地区', '国家/地区', '国家', '出生地', '国籍']);
  const dateRaw = pickCard(['上映时间', '首播时间', '首映时间', '播出时间', '出品时间', '出生日期']);
  const portrayedByRaw = pickCard(['饰演', '饰演者', '扮演者', '配音', '演员']);
  const relatedWorkRaw = pickCard(['登场作品', '所属作品', '关联作品', '出自', '作品', '首次登场']);
  const representativeWorksRaw = pickCard(['代表作品', '主要作品']);

  const year = extractYear(dateRaw) || extractYear(desc) || extractYear(abstract);

  // Extract related people for films / characters
  const relatedPeople: OnlineSearchResult[] = [];
  const seenPeople = new Set<string>();
  const pushPerson = (name: string, roleLabel: string) => {
    const clean = name.trim();
    if (!clean || seenPeople.has(clean)) return;
    seenPeople.add(clean);
    relatedPeople.push({
      externalId: `baike-person-${clean}`,
      category: 'person',
      title: clean,
      subtitle: roleLabel,
      summary: `在《${title}》中担任${roleLabel}。`,
      relatedWorkTitle: requestedCategory === 'film' ? title : undefined,
      sourceName: '百度百科',
      sourceUrl: `https://baike.baidu.com/item/${encodeURIComponent(clean)}`,
      tags: [roleLabel],
    });
  };

  if (directorRaw) {
    splitChineseList(directorRaw)
      .slice(0, 4)
      .forEach((name) => pushPerson(name, '导演'));
  }
  if (writerRaw && requestedCategory === 'film') {
    splitChineseList(writerRaw)
      .slice(0, 3)
      .forEach((name) => pushPerson(name, '编剧'));
  }
  if (castRaw && requestedCategory === 'film') {
    splitChineseList(castRaw)
      .slice(0, 14)
      .forEach((name) => pushPerson(name, '主演'));
  }
  if (portrayedByRaw && requestedCategory === 'character') {
    splitChineseList(portrayedByRaw)
      .slice(0, 4)
      .forEach((name) => pushPerson(name, `饰演 ${title}`));
  }

  // Extract related films for people / characters
  const relatedFilms: OnlineSearchResult[] = [];
  const seenFilms = new Set<string>();
  const worksSource =
    requestedCategory === 'person' ? representativeWorksRaw : relatedWorkRaw;
  if (worksSource) {
    for (const work of extractBookTitles(worksSource).slice(0, 16)) {
      if (seenFilms.has(work)) continue;
      seenFilms.add(work);
      relatedFilms.push({
        externalId: `baike-work-${work}`,
        category: 'film',
        title: work,
        subtitle:
          requestedCategory === 'person'
            ? `${title} 代表作品`
            : `${title} 登场作品`,
        summary:
          requestedCategory === 'person'
            ? `${title}的代表影视作品之一。`
            : `角色「${title}」登场的作品。`,
        sourceName: '百度百科',
        sourceUrl: `https://baike.baidu.com/item/${encodeURIComponent(work)}`,
        tags: ['代表作'],
      });
    }
  }

  // Structured character dossier
  const characterProfile: Partial<CharacterProfile> = {};
  const alias = pickCard(['别名', '别称', '外号', '称号', '其他名称']);
  const identity = pickCard(['职业设定', '职业', '身份', '定位', '角色设定']);
  const affiliation = pickCard(['所属', '阵营', '所属势力', '门派', '组织', '家族']);
  const origin = pickCard(['出生地', '籍贯', '国籍', '原型', '种族']);
  const abilities = pickCard(['能力', '技能', '超能力', '武器', '装备', '绝技']);
  const firstAppearance = pickCard(['首次登场', '登场作品', '出自']);
  const creator = pickCard(['作者', '创造者', '原著', '设计者']);

  if (alias) characterProfile.alias = alias;
  if (identity || desc) characterProfile.identity = identity || desc;
  if (affiliation) characterProfile.affiliation = affiliation;
  if (origin) characterProfile.origin = origin;
  if (abilities) characterProfile.abilities = abilities;
  if (firstAppearance) characterProfile.firstAppearance = firstAppearance;
  if (creator) characterProfile.creator = creator;
  if (abstract) characterProfile.bio = abstract;

  // Build tags
  const tags: string[] = [];
  if (genreRaw) {
    tags.push(...splitChineseList(genreRaw).slice(0, 3));
  }
  if (tags.length === 0) {
    tags.push(
      requestedCategory === 'film'
        ? '影视'
        : requestedCategory === 'person'
          ? '影人'
          : '角色'
    );
  }

  const relatedWorkTitle =
    requestedCategory === 'character' && relatedWorkRaw
      ? extractBookTitles(relatedWorkRaw)[0]
      : undefined;
  const portrayedBy =
    requestedCategory === 'character' && portrayedByRaw
      ? splitChineseList(portrayedByRaw)[0]
      : undefined;

  const searchResult: OnlineSearchResult = {
    externalId: `baike-${payload.newLemmaId || payload.id || title}`,
    category: requestedCategory,
    title,
    originalTitle:
      originalTitle && originalTitle !== title ? originalTitle : undefined,
    subtitle:
      desc ||
      (requestedCategory === 'film' && directorRaw
        ? `导演 ${splitChineseList(directorRaw)[0]}`
        : requestedCategory === 'character' && portrayedBy
          ? `${portrayedBy} 饰演`
          : '百度百科词条'),
    year,
    region: regionRaw ? splitChineseList(regionRaw)[0] : undefined,
    coverUrl,
    summary: abstract || desc || `${title}（百度百科词条）`,
    relatedWorkTitle,
    portrayedBy,
    sourceName: '百度百科',
    sourceUrl,
    tags,
  };

  return {
    searchResult,
    relatedPeople,
    relatedFilms,
    characterProfile,
  };
}

export interface ParsedIqiyiBundle {
  searchResults: OnlineSearchResult[];
  relatedPeople: OnlineSearchResult[];
  relatedFilms: OnlineSearchResult[];
}

/**
 * Parses iQIYI `suggest.video.iqiyi.com` JSON into structured films, people,
 * and cross-entity relations. Works natively via CORS in mainland China.
 */
export function parseIqiyiSuggestData(
  payload: Record<string, any> | null | undefined,
  category: ArchiveCategory
): ParsedIqiyiBundle {
  const empty: ParsedIqiyiBundle = {
    searchResults: [],
    relatedPeople: [],
    relatedFilms: [],
  };
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length === 0) return empty;

  const searchResults: OnlineSearchResult[] = [];
  const relatedPeople: OnlineSearchResult[] = [];
  const relatedFilms: OnlineSearchResult[] = [];
  const seenTitles = new Set<string>();
  const seenPeople = new Set<string>();
  const seenWorks = new Set<string>();

  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!name) continue;

    const pres = row?.presentation_element || {};
    const presTags: string[] = Array.isArray(pres.tags)
      ? pres.tags
          .map((t: any) => (typeof t?.name === 'string' ? t.name.trim() : ''))
          .filter(Boolean)
      : [];
    const reason =
      typeof pres.show_reason === 'string' ? pres.show_reason.trim() : '';
    const rawPic = row.picture_url || pres.picture_url;
    const coverUrl = upgradeToHttpsUrl(rawPic);
    const isPerson =
      Boolean(row.celebrity_id) || presTags.some((t) => t === '人物');
    const isSeriesCollection = presTags.some((t) => t === '系列');
    const isFilmEntity =
      !isPerson &&
      !isSeriesCollection &&
      (Number(row.cid) > 0 || Boolean(coverUrl));

    if (category === 'person') {
      if (isPerson && !seenTitles.has(name)) {
        seenTitles.add(name);
        const rolePart = reason.split('/')[0]?.trim() || '影视人物';
        const workTitles = extractBookTitles(reason);
        searchResults.push({
          externalId: `iqiyi-person-${row.celebrity_id || name}`,
          category: 'person',
          title: name,
          subtitle: rolePart,
          coverUrl,
          summary: reason
            ? `${name}，${reason.replace(/\s*\/\s*/g, '，')}。`
            : `${name} 影视人物档案。`,
          sourceName: '爱奇艺影视库',
          sourceUrl: row.celebrity_id
            ? `https://www.iqiyi.com/lib/s_${row.celebrity_id}.html`
            : undefined,
          tags: splitChineseList(rolePart).slice(0, 3),
        });
        for (const work of workTitles) {
          if (seenWorks.has(work)) continue;
          seenWorks.add(work);
          relatedFilms.push({
            externalId: `iqiyi-work-${work}`,
            category: 'film',
            title: work,
            subtitle: `${name} 相关作品`,
            summary: `由 ${name} 参与的影视作品《${work}》。`,
            sourceName: '爱奇艺影视库',
            tags: ['影视'],
          });
        }
      } else if (isSeriesCollection && reason) {
        for (const work of extractBookTitles(reason)) {
          if (seenWorks.has(work)) continue;
          seenWorks.add(work);
          relatedFilms.push({
            externalId: `iqiyi-work-${work}`,
            category: 'film',
            title: work,
            subtitle: '代表影视作品',
            summary: `影视作品《${work}》（${reason}）。`,
            sourceName: '爱奇艺影视库',
            tags: ['影视'],
          });
        }
      }
      continue;
    }

    if (category === 'film' && isFilmEntity) {
      // Skip redundant dub/language duplicates if base title already included
      const baseTitle = name.replace(/[（(][^）)]*(粤语|国语|普通话|英语|日语)[^）)]*[）)]$/u, '').trim();
      if (seenTitles.has(baseTitle) && baseTitle !== name) {
        continue;
      }
      if (seenTitles.has(name)) continue;
      seenTitles.add(name);
      if (baseTitle) seenTitles.add(baseTitle);

      const directors: string[] = Array.isArray(row.director)
        ? row.director.filter((d: unknown): d is string => typeof d === 'string' && d.trim().length > 0)
        : [];
      const actors: string[] = Array.isArray(row.main_actor)
        ? row.main_actor.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
        : [];
      const cname =
        typeof row.cname === 'string' && row.cname.trim()
          ? row.cname.trim()
          : presTags[0] || '影视';
      const yearStr =
        typeof row.year === 'number' && row.year >= 1900 && row.year <= 2035
          ? String(row.year)
          : extractYear(reason);
      const region =
        typeof row.region === 'string' && row.region.trim()
          ? row.region.trim()
          : undefined;

      const summaryParts: string[] = [];
      if (yearStr || region) {
        summaryParts.push([yearStr ? `${yearStr}年` : '', region, cname].filter(Boolean).join(' '));
      }
      if (directors.length > 0) summaryParts.push(`导演：${directors.join(' / ')}`);
      if (actors.length > 0) summaryParts.push(`主演：${actors.slice(0, 5).join('、')}`);
      if (reason && !summaryParts.some((s) => s.includes(reason))) {
        summaryParts.push(reason);
      }

      const tags = Array.from(
        new Set([cname, ...presTags.filter((t) => t !== cname)].slice(0, 3))
      );

      searchResults.push({
        externalId: `iqiyi-film-${row.aid || row.vid || name}`,
        category: 'film',
        title: name,
        subtitle:
          directors.length > 0
            ? `${cname} · 导演 ${directors[0]}`
            : reason || cname,
        year: yearStr,
        region,
        coverUrl,
        summary: summaryParts.join('；') || `${name}（${cname}）`,
        sourceName: '爱奇艺影视库',
        sourceUrl: upgradeToHttpsUrl(row.link),
        tags,
      });

      for (const d of directors) {
        if (seenPeople.has(d)) continue;
        seenPeople.add(d);
        relatedPeople.push({
          externalId: `iqiyi-dir-${d}`,
          category: 'person',
          title: d,
          subtitle: '导演',
          summary: `《${name}》的导演。`,
          relatedWorkTitle: name,
          sourceName: '爱奇艺影视库',
          tags: ['导演'],
        });
      }
      for (const a of actors) {
        if (seenPeople.has(a)) continue;
        seenPeople.add(a);
        relatedPeople.push({
          externalId: `iqiyi-act-${a}`,
          category: 'person',
          title: a,
          subtitle: '主演',
          summary: `在《${name}》中担任主演。`,
          relatedWorkTitle: name,
          sourceName: '爱奇艺影视库',
          tags: ['演员'],
        });
      }
    }
  }

  return { searchResults, relatedPeople, relatedFilms };
}

function normalizeSearchToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s·・:：\-—_《》「」『』（）()、，,。.!！?？]/g, '')
    .trim();
}

function isRelevantMoegirlPage(
  title: string,
  summary: string,
  query?: string
): boolean {
  // Filter out meme subpages, fandom lists, and game-skin cross-namespace pages
  if (
    /(\/恶搞|\/捏他|恶搞与捏他|梗$|表情包|角色列表|登场人物列表|消歧义)/.test(title)
  ) {
    return false;
  }
  if (!query || !query.trim()) return true;

  const normQuery = normalizeSearchToken(query);
  const normTitle = normalizeSearchToken(title);
  if (!normQuery || !normTitle) return false;

  // Reject game-skin / sub-colon pages unless the user typed a colon
  if (/[：:]/.test(title) && !/[：:]/.test(query)) {
    return false;
  }

  // 1. Title contains the full query (e.g. "钢铁侠" in "钢铁侠", "千与千寻" for "千与千寻")
  if (normTitle.includes(normQuery)) {
    return true;
  }

  // 2. Query contains a substantial title (>= 60% of query length, at least 2 chars)
  if (
    normTitle.length >= 2 &&
    normTitle.length >= Math.ceil(normQuery.length * 0.6) &&
    normQuery.includes(normTitle)
  ) {
    return true;
  }

  // 3. All characters of a short query (2-4 chars, e.g. "千寻" in "千与千寻") appear in order in title
  if (normQuery.length >= 2 && normQuery.length <= 4 && normTitle.length <= 10) {
    let qi = 0;
    for (let i = 0; i < normTitle.length && qi < normQuery.length; i += 1) {
      if (normTitle[i] === normQuery[qi]) qi += 1;
    }
    if (qi === normQuery.length) {
      return true;
    }
  }

  // 4. Exact query appears right at the start of the lead sentence (e.g. alias redirect)
  const lead = normalizeSearchToken(summary.slice(0, 80));
  if (normQuery.length >= 2 && lead.includes(normQuery) && normTitle.length <= 14) {
    // Only allow if at least half of query chars overlap or summary explicitly defines it as alias
    let overlap = 0;
    for (const ch of normQuery) {
      if (normTitle.includes(ch)) overlap += 1;
    }
    if (overlap >= Math.ceil(normQuery.length * 0.5)) {
      return true;
    }
  }

  return false;
}

/**
 * Parses Moegirl (zh.moegirl.org.cn) MediaWiki query pages into OnlineSearchResult[].
 */
export function parseMoegirlPages(
  payload: Record<string, any> | null | undefined,
  category: ArchiveCategory,
  query?: string
): OnlineSearchResult[] {
  const pagesObj = payload?.query?.pages;
  if (!pagesObj || typeof pagesObj !== 'object') return [];

  const pages = Object.values(pagesObj as Record<string, Record<string, any>>);
  pages.sort((a, b) => (a.index || 99) - (b.index || 99));

  return pages
    .filter((p) => {
      if (typeof p.title !== 'string' || !p.title.trim()) return false;
      if (/^(Category|Template|Talk|User|File|Help|萌娘百科):/i.test(p.title)) {
        return false;
      }
      const cleanTitle = String(p.title)
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      const summary = stripBaikeHtml(p.extract || '', 220);
      return isRelevantMoegirlPage(cleanTitle, summary, query);
    })
    .map((page) => {
      const title = String(page.title)
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      const summary = stripBaikeHtml(page.extract || '', 220);
      return {
        externalId: `moegirl-${page.pageid}`,
        category,
        title,
        subtitle:
          category === 'film'
            ? '影视 / 动画条目'
            : category === 'person'
              ? '创作者 / 声优词条'
              : '角色设定词条',
        year: extractYear(summary),
        coverUrl: upgradeToHttpsUrl(page.thumbnail?.source),
        summary: summary || `${title}（萌娘百科词条）`,
        sourceName: '萌娘百科',
        sourceUrl:
          upgradeToHttpsUrl(page.fullurl) ||
          `https://zh.moegirl.org.cn/${encodeURIComponent(page.title)}`,
        tags: [
          category === 'film' ? '动画/影视' : category === 'person' ? '影人' : '角色',
        ],
      };
    });
}

/**
 * Parses Bangumi legacy GET `/search/subject/{keyword}` response (simple GET,
 * no CORS preflight required on mobile browsers).
 */
export function parseBangumiLegacySubjects(
  payload: Record<string, any> | null | undefined
): OnlineSearchResult[] {
  const list = Array.isArray(payload?.list) ? payload.list : [];
  return list
    .filter((item: any) => item && (item.type === 2 || item.type === 6))
    .slice(0, 8)
    .map((item: any) => {
      const title = String(item.name_cn || item.name || '').trim();
      const originalTitle =
        item.name && item.name !== title ? String(item.name) : undefined;
      const img =
        item.images?.large ||
        item.images?.common ||
        item.images?.medium ||
        item.images?.small;
      const typeLabel = item.type === 2 ? '动画' : '影视';
      const score = item.rating?.score;

      return {
        externalId: `bgm-subj-${item.id}`,
        category: 'film' as const,
        title,
        originalTitle,
        subtitle: score
          ? `${typeLabel} · Bangumi ${Number(score).toFixed(1)}`
          : typeLabel,
        year: extractYear(item.air_date),
        coverUrl: upgradeToHttpsUrl(img),
        summary: stripBaikeHtml(
          item.summary || `${title}（${typeLabel}作品）`,
          220
        ),
        sourceName: '番组计划 Bangumi',
        sourceUrl: `https://bgm.tv/subject/${item.id}`,
        tags: [typeLabel],
      };
    })
    .filter((item: OnlineSearchResult) => Boolean(item.title));
}

export interface NamedSourceTask<T> {
  name: string;
  promise: Promise<T[]>;
}

/**
 * Runs all search source tasks concurrently, but once at least one source yields
 * non-empty results, caps waiting for remaining slow/blocked sources to
 * `graceWindowMs` so blocked overseas endpoints never stall mobile users.
 */
export async function settleSourcesWithFastWindow<T>(
  tasks: Array<NamedSourceTask<T>>,
  graceWindowMs = 1600
): Promise<{
  items: T[];
  activeSources: string[];
}> {
  if (tasks.length === 0) {
    return { items: [], activeSources: [] };
  }

  return new Promise((resolve) => {
    const resultsByIndex: Array<T[] | null> = tasks.map(() => null);
    let completedCount = 0;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      const items: T[] = [];
      const activeSources: string[] = [];
      resultsByIndex.forEach((arr, idx) => {
        if (arr && arr.length > 0) {
          activeSources.push(tasks[idx].name);
          items.push(...arr);
        }
      });
      resolve({ items, activeSources });
    };

    tasks.forEach((task, idx) => {
      task.promise
        .then((list) => {
          resultsByIndex[idx] = Array.isArray(list) ? list : [];
          if (resultsByIndex[idx]!.length > 0 && graceTimer === null && !settled) {
            graceTimer = setTimeout(finish, graceWindowMs);
          }
        })
        .catch(() => {
          resultsByIndex[idx] = [];
        })
        .finally(() => {
          completedCount += 1;
          if (completedCount >= tasks.length) {
            finish();
          }
        });
    });
  });
}
