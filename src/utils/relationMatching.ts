import { normalizeEntityKey } from './wikiCast';

export function normalizeStrictTitleKey(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const withoutParens = raw
    .replace(/\s*[（(][^）)]*(?:电影|剧集|电视剧|动画|动漫|美剧|日剧|韩剧|英剧|18\d{2}|19\d{2}|20\d{2})[^）)]*[）)]\s*$/gi, '')
    .trim();
  return normalizeEntityKey(withoutParens);
}

export function extractYearNumber(raw?: string | number | null): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const rounded = Math.round(raw);
    return rounded >= 1880 && rounded <= 2100 ? rounded : null;
  }
  if (!raw || typeof raw !== 'string') return null;
  const match = /\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(raw);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function yearsAreCompatible(
  itemYear?: string | number | null,
  candYear?: string | number | null,
  maxDiff = 2
): boolean {
  const y1 = extractYearNumber(itemYear);
  const y2 = extractYearNumber(candYear);
  if (y1 === null || y2 === null) return true;
  return Math.abs(y1 - y2) <= maxDiff;
}

export function collectNormalizedTitleKeys(
  titles: Array<string | undefined | null>
): Set<string> {
  const keys = new Set<string>();
  for (const raw of titles) {
    if (!raw || typeof raw !== 'string') continue;
    const direct = normalizeStrictTitleKey(raw);
    if (direct) keys.add(direct);
    for (const part of raw.split(/[／/]/)) {
      const pk = normalizeStrictTitleKey(part);
      if (pk.length >= 2) keys.add(pk);
    }
  }
  return keys;
}

export function hasStrictTitleOverlap(
  candidateTitles: Array<string | undefined | null>,
  targetTitles: Array<string | undefined | null>
): boolean {
  const targetKeys = collectNormalizedTitleKeys(targetTitles);
  if (targetKeys.size === 0) return false;
  const candKeys = collectNormalizedTitleKeys(candidateTitles);
  for (const ck of candKeys) {
    if (targetKeys.has(ck)) return true;
  }
  return false;
}

export interface BangumiSubjectCandidate {
  id: number;
  type?: number; // 2 = anime, 6 = real/live-action
  name?: string;
  name_cn?: string;
  date?: string;
  infobox?: Array<{ key?: string; value?: unknown }>;
}

function extractBangumiAliases(
  infobox?: Array<{ key?: string; value?: unknown }>
): string[] {
  if (!Array.isArray(infobox)) return [];
  const out: string[] = [];
  for (const row of infobox) {
    const key = String(row?.key || '').trim();
    if (!/^(中文名|简体中文名|别名|英文名|外文名|原名)$/.test(key)) continue;
    if (typeof row?.value === 'string' && row.value.trim()) {
      out.push(row.value.trim());
    } else if (Array.isArray(row?.value)) {
      for (const entry of row.value) {
        if (typeof entry?.v === 'string' && entry.v.trim()) {
          out.push(entry.v.trim());
        }
      }
    }
  }
  return out;
}

/**
 * Strictly resolves a Bangumi film/anime subject ID without ever falling back
 * to an unrelated top search result (e.g. matching a 2026 live-action Resident Evil
 * film to a 2000 Japanese anime OVA).
 */
export function matchBangumiSubjectCandidate(
  candidates: BangumiSubjectCandidate[] | undefined | null,
  params: {
    title: string;
    originalTitle?: string;
    year?: string;
    isAnimeHint?: boolean;
  }
): number | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const targetYear = extractYearNumber(params.year);
  const titleKeys = collectNormalizedTitleKeys([params.title]);
  const allTargetKeys = collectNormalizedTitleKeys([
    params.title,
    params.originalTitle,
  ]);
  if (allTargetKeys.size === 0) return null;

  let best: { id: number; score: number } | null = null;

  for (const cand of candidates) {
    if (!cand || typeof cand.id !== 'number') continue;
    const candTitles = [
      cand.name_cn,
      cand.name,
      ...extractBangumiAliases(cand.infobox),
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

    const candKeys = collectNormalizedTitleKeys(candTitles);
    let matchedPrimaryTitle = false;
    let matchedAnyTitle = false;
    for (const ck of candKeys) {
      if (titleKeys.has(ck)) {
        matchedPrimaryTitle = true;
        matchedAnyTitle = true;
        break;
      }
      if (allTargetKeys.has(ck)) {
        matchedAnyTitle = true;
      }
    }
    if (!matchedAnyTitle) continue;

    const candYear = extractYearNumber(cand.date);
    if (targetYear !== null && candYear !== null) {
      const diff = Math.abs(candYear - targetYear);
      if (diff > 2) continue;
    }

    // Extra guard: if Bangumi candidate is Anime (type === 2) and the item is NOT hinted as anime,
    // require year agreement when the archive item has a known year so live-action remakes
    // never pull anime OVA staff lists.
    if (cand.type === 2 && !params.isAnimeHint && targetYear !== null) {
      if (candYear === null || Math.abs(candYear - targetYear) > 1) {
        continue;
      }
    }

    let score = matchedPrimaryTitle ? 100 : 75;
    if (cand.type === 6 && !params.isAnimeHint) score += 15;
    if (cand.type === 2 && params.isAnimeHint) score += 15;
    if (targetYear !== null && candYear !== null) {
      const diff = Math.abs(candYear - targetYear);
      score += diff === 0 ? 30 : diff === 1 ? 18 : 5;
    }

    if (!best || score > best.score) {
      best = { id: cand.id, score };
    }
  }

  return best?.id ?? null;
}

export interface BangumiCharacterCandidate {
  id: number;
  name?: string;
  infobox?: Array<{ key?: string; value?: unknown }>;
}

/**
 * Strictly resolves a Bangumi character ID by normalized name/alias match.
 */
export function matchBangumiCharacterCandidate(
  candidates: BangumiCharacterCandidate[] | undefined | null,
  params: { title: string; originalTitle?: string }
): number | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const targets = [params.title, params.originalTitle];
  for (const cand of candidates) {
    if (!cand || typeof cand.id !== 'number') continue;
    const candTitles = [cand.name, ...extractBangumiAliases(cand.infobox)];
    if (hasStrictTitleOverlap(candTitles, targets)) {
      return cand.id;
    }
  }
  return null;
}

/**
 * Strictly selects a matching film/TV record from Douban / IMDb search results
 * for relation lookup, rejecting wrong-title or wrong-year entries instead of
 * blindly falling back to candidates[0].
 */
export function matchFilmRelationCandidate<
  T extends { title: string; originalTitle?: string; year?: string },
>(
  candidates: T[] | undefined | null,
  params: { title: string; originalTitle?: string; year?: string }
): T | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const targetYear = extractYearNumber(params.year);
  const primaryKeys = collectNormalizedTitleKeys([params.title]);
  const allTargetKeys = collectNormalizedTitleKeys([
    params.title,
    params.originalTitle,
  ]);
  if (allTargetKeys.size === 0) return null;

  let best: { item: T; score: number } | null = null;

  for (const cand of candidates) {
    const candKeys = collectNormalizedTitleKeys([
      cand.title,
      cand.originalTitle,
    ]);
    let matchedPrimary = false;
    let matchedAny = false;
    for (const ck of candKeys) {
      if (primaryKeys.has(ck)) {
        matchedPrimary = true;
        matchedAny = true;
        break;
      }
      if (allTargetKeys.has(ck)) {
        matchedAny = true;
      }
    }
    if (!matchedAny) continue;

    const candYear = extractYearNumber(cand.year);
    if (targetYear !== null && candYear !== null) {
      if (Math.abs(candYear - targetYear) > 2) continue;
    }

    let score = matchedPrimary ? 100 : 80;
    if (targetYear !== null && candYear !== null) {
      const diff = Math.abs(candYear - targetYear);
      score += diff === 0 ? 30 : diff === 1 ? 18 : 6;
    } else if (targetYear !== null && candYear === null) {
      // Slightly prefer dated matches over undated ones when item has a year
      score -= 5;
    }

    if (!best || score > best.score) {
      best = { item: cand, score };
    }
  }

  return best?.item ?? null;
}

/**
 * Filters Bangumi/external crew roles down to core creative talent (directors,
 * lead actors, writers, composers, voice actors) and excludes technical anime
 * production roles like 原画 / 作画监督 / 美术监督 / 摄影监督.
 */
export function isRelevantFilmCrewRole(role: string): boolean {
  const rel = role.trim();
  if (!rel) return false;
  if (
    /原画|第二原画|作画监督|总作画监督|作画|动画检查|补间|上色|色彩设计|美术监督|美术设计|摄影监督|背景美术|分镜|演出|设定|构图|监修|企划|发行|制作|出品|特效|3DCG|CG|剪辑|录音|音响监督|音效|字幕|协力|宣传|制片公司|动画制作|播放|代理/.test(
      rel
    )
  ) {
    return false;
  }
  return /导演|监督|总导演|主演|主役|演员|出演|配角|声优|配音|编剧|脚本|系列构成|原作|音乐|配乐|作曲/.test(
    rel
  );
}
