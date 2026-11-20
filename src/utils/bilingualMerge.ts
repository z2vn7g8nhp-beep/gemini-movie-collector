import type { OnlineSearchResult } from '../types/archive';
import { normalizeEntityKey } from './wikiCast';

export function hasCjkChars(text?: string | null): boolean {
  return Boolean(text && /[\u4e00-\u9fff]/.test(text));
}

/**
 * Strips diacritics (e.g. `Chloé` -> `chloe`, `Renée` -> `renee`) and normalizes
 * Latin punctuation while preserving word boundaries.
 */
function foldLatinWords(raw: string): string[] {
  const folded = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!folded) return [];
  return folded.split(/\s+/).filter(Boolean);
}

const PERSON_GENERATIONAL_SUFFIXES = new Set([
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'v',
]);

/**
 * Splits a potentially multi-alias field (e.g. `"Robert Downey Jr. / Robert John Downey Jr."`
 * or `"钢铁侠（电影）"`) into clean candidate name variants.
 */
export function splitCandidateAliases(raw?: string | null): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const cleaned = raw
    .replace(/[《》「」『』]/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' / ')
    .replace(/\s*（[^）]*）\s*/g, ' / ');
  const parts = cleaned
    .split(/[／/、,;；|]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return Array.from(new Set(parts));
}

/**
 * Computes Latin identity keys for matching across full/shortened names,
 * e.g. `"Robert John Downey Jr."` <-> `"Robert Downey Jr."` -> both share `firstlast:robert_downey`.
 */
export function extractLatinPersonKeys(raw: string): string[] {
  if (!raw || hasCjkChars(raw)) return [];
  const words = foldLatinWords(raw);
  if (words.length === 0) return [];

  const keys = new Set<string>();
  const joined = words.join('');
  if (joined.length >= 3) {
    keys.add(`latin:${joined}`);
  }

  const coreWords = words.filter((w) => !PERSON_GENERATIONAL_SUFFIXES.has(w));
  if (coreWords.length >= 2) {
    const coreJoined = coreWords.join('');
    if (coreJoined.length >= 4) {
      keys.add(`latin:${coreJoined}`);
    }
    const first = coreWords[0];
    const last = coreWords[coreWords.length - 1];
    if (first.length >= 2 && last.length >= 2) {
      keys.add(`latin-fl:${first}_${last}`);
    }
  }

  return Array.from(keys);
}

/**
 * Checks if two Latin person names refer to the same person, tolerating middle names
 * and suffixes (e.g. `Robert John Downey Jr.` vs `Robert Downey Jr.`).
 */
export function latinPersonNamesMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const keysA = new Set(extractLatinPersonKeys(a));
  if (keysA.size === 0) return false;
  const keysB = extractLatinPersonKeys(b);
  for (const k of keysB) {
    if (keysA.has(k)) return true;
  }
  return false;
}

/**
 * Builds a single-token ASCII slug safe for IMDb JSONP `sg.media-imdb.com/suggests/{c}/{slug}.json`
 * (which invokes `window["imdb$" + slug](payload)` without invalid `%20` callback identifiers).
 * Example: `"Robert Downey Jr."` -> `"robertdowney"`, `"Jon Favreau"` -> `"jonfavreau"`.
 */
export function buildImdbSingleTokenSlug(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || hasCjkChars(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (/^(?:tt|nm)\d{5,10}$/.test(lower)) {
    return lower;
  }
  const words = foldLatinWords(trimmed);
  if (words.length === 0) return null;

  // Drop trailing generational suffixes (jr/sr/ii) so "Robert Downey Jr." -> "robertdowney"
  const core = words.filter(
    (w, idx) => idx === 0 || !PERSON_GENERATIONAL_SUFFIXES.has(w)
  );
  const effective = core.length > 0 ? core : words;
  const slug = effective.join('').slice(0, 20);
  if (!/^[a-z0-9]{2,20}$/.test(slug)) return null;
  return slug;
}

function extractCanonicalSourceIds(sourceUrl?: string): string[] {
  if (!sourceUrl) return [];
  const ids: string[] = [];
  const imdbMatch = /imdb\.com\/(?:title|name)\/((?:tt|nm)\d{5,10})/i.exec(
    sourceUrl
  );
  if (imdbMatch) ids.push(`imdb:${imdbMatch[1].toLowerCase()}`);

  const doubanSub = /movie\.douban\.com\/subject\/(\d+)/i.exec(sourceUrl);
  if (doubanSub) ids.push(`douban-sub:${doubanSub[1]}`);

  const doubanCel = /douban\.com\/(?:celebrity|personage)\/(\d+)/i.exec(
    sourceUrl
  );
  if (doubanCel) ids.push(`douban-cel:${doubanCel[1]}`);

  const bgmMatch = /bgm\.tv\/(subject|person|character)\/(\d+)/i.exec(
    sourceUrl
  );
  if (bgmMatch) ids.push(`bgm:${bgmMatch[1]}:${bgmMatch[2]}`);

  return ids;
}

function extractMatchKeys(
  item: OnlineSearchResult,
  extraAliases?: string[]
): string[] {
  const keys = new Set<string>();
  const prefix = item.category;

  for (const id of extractCanonicalSourceIds(item.sourceUrl)) {
    keys.add(`${prefix}::id::${id}`);
  }

  const allTextCandidates: string[] = [item.title];
  if (item.originalTitle) allTextCandidates.push(item.originalTitle);
  if (extraAliases) allTextCandidates.push(...extraAliases);

  for (const raw of allTextCandidates) {
    const fullNorm = normalizeEntityKey(raw);
    if (fullNorm.length >= 2) {
      keys.add(`${prefix}::norm::${fullNorm}`);
    }

    for (const part of splitCandidateAliases(raw)) {
      const partNorm = normalizeEntityKey(part);
      if (partNorm.length >= 2) {
        keys.add(`${prefix}::norm::${partNorm}`);
      }
      if (item.category === 'person' && !hasCjkChars(part)) {
        for (const lk of extractLatinPersonKeys(part)) {
          keys.add(`${prefix}::${lk}`);
        }
      }
    }

    if (item.category === 'person' && !hasCjkChars(raw)) {
      for (const lk of extractLatinPersonKeys(raw)) {
        keys.add(`${prefix}::${lk}`);
      }
    }
  }

  return Array.from(keys);
}

function scoreSubtitleRichness(subtitle?: string): number {
  if (!subtitle) return 0;
  const s = subtitle.trim();
  if (!s) return 0;
  let score = Math.min(s.length, 40);
  if (/(饰|饰演|扮演|导演|编剧|配音|出自)/.test(s)) score += 30;
  if (/·/.test(s)) score += 12;
  if (/^(演员|主演|影视|人物|百度百科词条)$/.test(s)) score -= 10;
  return score;
}

function scoreSourceUrlPriority(url?: string): number {
  if (!url) return 0;
  if (/imdb\.com\/(title|name)\/(tt|nm)\d+/i.test(url)) return 50;
  if (/douban\.com/i.test(url)) return 45;
  if (/bgm\.tv/i.test(url)) return 35;
  if (/wikipedia\.org/i.test(url)) return 30;
  if (/baike\.baidu\.com/i.test(url)) return 25;
  return 10;
}

function scoreCoverQuality(url?: string): number {
  if (!url || !url.trim()) return 0;
  const u = url.trim();
  if (/doubanio\.com/i.test(u) && !u.startsWith('/api/img-proxy')) return 20;
  if (/m\.media-amazon\.com|images\.metahub\.space/i.test(u)) return 60;
  if (/bkimg\.cdn\.bcebos\.com/i.test(u)) return 55;
  if (/pic\d*\.iqiyipic\.com/i.test(u)) return 50;
  if (/upload\.wikimedia\.org|lain\.bgm\.tv/i.test(u)) return 52;
  return 40;
}

function pickConciseLatinOriginalTitle(
  a?: string,
  b?: string,
  chosenTitle?: string
): string | undefined {
  const candidates = [a, b]
    .map((x) => x?.trim())
    .filter((x): x is string => Boolean(x && x !== chosenTitle));
  if (candidates.length === 0) return undefined;

  // Prefer a Latin/non-CJK originalTitle when the primary title is Chinese
  const latinCandidates = candidates.filter((c) => !hasCjkChars(c));
  if (latinCandidates.length > 0) {
    // Prefer concise canonical name (e.g. "Robert Downey Jr." over "Robert John Downey Jr.")
    latinCandidates.sort((x, y) => x.length - y.length);
    return latinCandidates[0];
  }
  return candidates[0];
}

export interface MergeBilingualOptions {
  /** Optional alias lookup map keyed by item.externalId */
  aliasMap?: Map<string, string[]>;
  /** Custom cover chooser (e.g. pickBetterCharacterImage for characters) */
  pickCover?: (prev?: string, next?: string) => string | undefined;
}

/**
 * Deduplicates and fuses bilingual (`Chinese` + `English`) search/relation results
 * across IMDb, Douban, Baidu Baike, iQIYI, Bangumi, and Wikipedia.
 *
 * Guarantees that e.g. `Robert Downey Jr.` (IMDb) and `小罗伯特·唐尼` (Baike with
 * `外文名: Robert John Downey Jr.`) collapse into ONE single Chinese-first entry
 * retaining the English `originalTitle`, best portrait/poster `coverUrl`, and
 * richest role/character subtitle.
 */
export function mergeBilingualResults(
  list: OnlineSearchResult[],
  options: MergeBilingualOptions = {}
): OnlineSearchResult[] {
  const out: OnlineSearchResult[] = [];
  const keyToIndex = new Map<string, number>();

  for (const item of list) {
    if (!item || !item.title || !item.title.trim()) continue;
    const extraAliases = options.aliasMap?.get(item.externalId);
    const keys = extractMatchKeys(item, extraAliases);

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
      const prevHasCjk = hasCjkChars(prev.title);
      const itemHasCjk = hasCjkChars(item.title);

      const chosenTitle =
        !prevHasCjk && itemHasCjk ? item.title.trim() : prev.title.trim();

      const fallbackPrevLatin = !prevHasCjk ? prev.title.trim() : undefined;
      const fallbackItemLatin = !itemHasCjk ? item.title.trim() : undefined;

      const chosenOriginalTitle = pickConciseLatinOriginalTitle(
        prev.originalTitle || fallbackPrevLatin,
        item.originalTitle || fallbackItemLatin,
        chosenTitle
      );

      let chosenCover: string | undefined;
      if (options.pickCover) {
        chosenCover = options.pickCover(prev.coverUrl, item.coverUrl);
      } else {
        chosenCover =
          scoreCoverQuality(item.coverUrl) > scoreCoverQuality(prev.coverUrl)
            ? item.coverUrl
            : prev.coverUrl || item.coverUrl;
      }

      const chosenSubtitle =
        scoreSubtitleRichness(item.subtitle) >
        scoreSubtitleRichness(prev.subtitle)
          ? item.subtitle
          : prev.subtitle || item.subtitle;

      const chosenSourceUrl =
        scoreSourceUrlPriority(item.sourceUrl) >
        scoreSourceUrlPriority(prev.sourceUrl)
          ? item.sourceUrl
          : prev.sourceUrl || item.sourceUrl;

      const mergedTags = Array.from(
        new Set([...(prev.tags || []), ...(item.tags || [])].filter(Boolean))
      ).slice(0, 4);

      const merged: OnlineSearchResult = {
        ...prev,
        title: chosenTitle,
        originalTitle: chosenOriginalTitle,
        subtitle: chosenSubtitle,
        year: prev.year || item.year,
        region: prev.region || item.region,
        coverUrl: chosenCover,
        summary:
          (item.summary?.length || 0) > (prev.summary?.length || 0)
            ? item.summary
            : prev.summary,
        relatedWorkTitle: prev.relatedWorkTitle || item.relatedWorkTitle,
        portrayedBy: prev.portrayedBy || item.portrayedBy,
        sourceUrl: chosenSourceUrl,
        tags: mergedTags,
      };

      out[existingIdx] = merged;

      // Register all keys from both items onto the merged slot
      for (const k of keys) {
        keyToIndex.set(k, existingIdx);
      }
      for (const k of extractMatchKeys(merged)) {
        keyToIndex.set(k, existingIdx);
      }
    } else {
      const idx = out.length;
      out.push({
        ...item,
        title: item.title.trim(),
        originalTitle:
          item.originalTitle && item.originalTitle.trim() !== item.title.trim()
            ? item.originalTitle.trim()
            : undefined,
      });
      for (const k of keys) {
        keyToIndex.set(k, idx);
      }
    }
  }

  return out;
}
