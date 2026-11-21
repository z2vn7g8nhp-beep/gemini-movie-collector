import type {
  ArchiveCategory,
  ArchiveDraftInput,
  ArchiveFilterState,
  ArchiveItem,
  ArchiveStats,
  CollectionStatus,
  ValidationErrors,
} from '../types/archive';
import { getApiBaseUrl, isStaticAppMode } from '../services/apiClient';
import { unwrapProxyImageUrl } from './coverPicker';
import {
  collectNormalizedTitleKeys,
  yearsAreCompatible,
} from './relationMatching';

export const CATEGORY_LABELS: Record<ArchiveCategory, string> = {
  film: '影视',
  person: '影人',
  character: '角色',
};

export function getStatusLabel(
  status: CollectionStatus,
  category?: ArchiveCategory
): string {
  if (status === 'favorite') return '挚爱';
  if (status === 'watching') return category === 'film' ? '在追' : '关注中';
  if (status === 'watchlist') return category === 'film' ? '想看' : '待补档';
  return category === 'film' ? '已看' : '已收录';
}

export function buildProxyImageUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  const staticOnly = isStaticAppMode() && !getApiBaseUrl();
  if (staticOnly) {
    if (trimmed.startsWith('/api/img-proxy')) {
      return unwrapProxyImageUrl(trimmed);
    }
    if (
      trimmed.startsWith('/src/assets/') ||
      trimmed.startsWith('data:image/') ||
      /^https?:\/\//i.test(trimmed)
    ) {
      return trimmed;
    }
    return trimmed;
  }

  if (
    trimmed.startsWith('/src/assets/') ||
    trimmed.startsWith('/api/img-proxy') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return `/api/img-proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export function parseTagsInput(raw: string): string[] {
  const parts = raw
    .split(/[，,、/\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 12);
}

export function nextAccessionNo(items: ArchiveItem[]): string {
  let maxNum = 0;
  for (const item of items) {
    const match = /^CA-(\d+)$/.exec(item.accessionNo || '');
    if (match) {
      const num = Number.parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `CA-${String(maxNum + 1).padStart(3, '0')}`;
}

export function validateArchiveInput(input: ArchiveDraftInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!input.title || !input.title.trim()) {
    errors.title = '请填写名称或片名';
  } else if (input.title.trim().length > 80) {
    errors.title = '名称请控制在 80 字以内';
  }

  if (input.year && input.year.trim()) {
    const yearTrimmed = input.year.trim();
    if (!/^\d{4}$/.test(yearTrimmed)) {
      errors.year = '年份请填写 4 位数字，例如 2000';
    } else {
      const y = Number.parseInt(yearTrimmed, 10);
      if (y < 1880 || y > 2100) {
        errors.year = '年份需在 1880 至 2100 之间';
      }
    }
  }

  if (
    typeof input.rating !== 'number' ||
    Number.isNaN(input.rating) ||
    input.rating < 0 ||
    input.rating > 5
  ) {
    errors.rating = '评分须在 0 到 5 之间';
  }

  if (input.coverUrl && input.coverUrl.trim()) {
    const url = input.coverUrl.trim();
    const envBase =
      typeof import.meta !== 'undefined' &&
      typeof (import.meta as unknown as { env?: { BASE_URL?: string } }).env
        ?.BASE_URL === 'string'
        ? (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL
        : '/';
    const normalizedBase = envBase.endsWith('/') ? envBase : `${envBase}/`;
    const isValidLocal =
      url.startsWith('/src/assets/') ||
      url.startsWith('src/assets/') ||
      url.startsWith(`${normalizedBase}src/assets/`) ||
      url.startsWith('/api/img-proxy') ||
      url.startsWith('data:image/');
    const isValidHttp = /^https?:\/\/.+/i.test(url);
    if (!isValidLocal && !isValidHttp) {
      errors.coverUrl = '封面链接需以 http:// 或 https:// 开头';
    }
  }

  return errors;
}

export function hasValidationErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function filterAndSortItems(
  items: ArchiveItem[],
  filter: ArchiveFilterState
): ArchiveItem[] {
  const normalizedQuery = filter.query.trim().toLowerCase();
  const normalizedTag = (filter.tag || '').trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (filter.category !== 'all' && item.category !== filter.category) {
      return false;
    }
    if (filter.status !== 'all' && item.status !== filter.status) {
      return false;
    }
    if (
      normalizedTag &&
      !item.tags.some((t) => t.trim().toLowerCase() === normalizedTag)
    ) {
      return false;
    }
    if (!normalizedQuery) return true;

    const haystack = [
      item.title,
      item.originalTitle,
      item.subtitle,
      item.region,
      item.year,
      item.summary,
      item.quote,
      item.notes,
      item.relatedWorkTitle,
      item.portrayedBy,
      item.characterProfile?.alias,
      item.characterProfile?.identity,
      item.characterProfile?.affiliation,
      item.characterProfile?.origin,
      item.characterProfile?.abilities,
      item.characterProfile?.highlights,
      item.characterProfile?.bio,
      item.accessionNo,
      ...item.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (filter.sortBy === 'rating') {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (filter.sortBy === 'year') {
      const ya = Number.parseInt(a.year || '0', 10) || 0;
      const yb = Number.parseInt(b.year || '0', 10) || 0;
      if (yb !== ya) return yb - ya;
      return a.title.localeCompare(b.title, 'zh-CN');
    }
    if (filter.sortBy === 'title') {
      return a.title.localeCompare(b.title, 'zh-CN');
    }
    return b.createdAt.localeCompare(a.createdAt);
  });

  return sorted;
}

export function getRelatedItems(
  target: ArchiveItem,
  allItems: ArchiveItem[]
): ArchiveItem[] {
  const relatedMap = new Map<string, ArchiveItem>();
  const targetTitleLower = target.title.trim().toLowerCase();
  const targetWorkLower = (target.relatedWorkTitle || '').trim().toLowerCase();
  const targetActorLower = (target.portrayedBy || '').trim().toLowerCase();

  for (const candidate of allItems) {
    if (candidate.id === target.id) continue;

    const explicitLink =
      target.relatedIds.includes(candidate.id) ||
      candidate.relatedIds.includes(target.id);

    const candidateTitleLower = candidate.title.trim().toLowerCase();
    const candidateWorkLower = (candidate.relatedWorkTitle || '').trim().toLowerCase();
    const candidateActorLower = (candidate.portrayedBy || '').trim().toLowerCase();

    const inferredLink =
      (targetWorkLower.length >= 2 &&
        candidateTitleLower.length >= 2 &&
        targetWorkLower.includes(candidateTitleLower)) ||
      (targetActorLower.length >= 2 &&
        candidateTitleLower.length >= 2 &&
        targetActorLower.includes(candidateTitleLower)) ||
      (candidateWorkLower.length >= 2 &&
        targetTitleLower.length >= 2 &&
        candidateWorkLower.includes(targetTitleLower)) ||
      (candidateActorLower.length >= 2 &&
        targetTitleLower.length >= 2 &&
        candidateActorLower.includes(targetTitleLower));

    if (explicitLink || inferredLink) {
      relatedMap.set(candidate.id, candidate);
    }
  }

  return Array.from(relatedMap.values());
}

export function computeArchiveStats(items: ArchiveItem[]): ArchiveStats {
  let film = 0;
  let person = 0;
  let character = 0;
  let favorites = 0;
  let ratingSum = 0;
  let ratedCount = 0;

  for (const item of items) {
    if (item.category === 'film') film += 1;
    else if (item.category === 'person') person += 1;
    else if (item.category === 'character') character += 1;

    if (item.status === 'favorite') favorites += 1;
    if (item.rating > 0) {
      ratingSum += item.rating;
      ratedCount += 1;
    }
  }

  return {
    total: items.length,
    film,
    person,
    character,
    favorites,
    averageRating: ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : 0,
  };
}

export interface ExistingItemMatchOptions {
  originalTitle?: string;
  sourceUrl?: string;
  year?: string;
}

function extractCanonicalExternalKey(
  category: ArchiveCategory,
  sourceUrl?: string
): string | null {
  if (!sourceUrl) return null;
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;

  if (category === 'film') {
    const imdbTitle = /imdb\.com\/title\/(tt\d{5,10})/i.exec(trimmed);
    if (imdbTitle) return `imdb:${imdbTitle[1].toLowerCase()}`;
    const doubanSubj = /douban\.com\/(?:movie\/|tv\/)?subject\/(\d{5,12})/i.exec(
      trimmed
    );
    if (doubanSubj) return `douban:subject:${doubanSubj[1]}`;
    const bgmSubj = /bgm\.tv\/subject\/(\d+)/i.exec(trimmed);
    if (bgmSubj) return `bgm:subject:${bgmSubj[1]}`;
    return null;
  }

  if (category === 'person') {
    const imdbName = /imdb\.com\/name\/(nm\d{5,10})/i.exec(trimmed);
    if (imdbName) return `imdb:${imdbName[1].toLowerCase()}`;
    const doubanCeleb = /douban\.com\/(?:celebrity|personage)\/(\d{5,12})/i.exec(
      trimmed
    );
    if (doubanCeleb) return `douban:celebrity:${doubanCeleb[1]}`;
    const bgmPerson = /bgm\.tv\/person\/(\d+)/i.exec(trimmed);
    if (bgmPerson) return `bgm:person:${bgmPerson[1]}`;
    return null;
  }

  const bgmChar = /bgm\.tv\/character\/(\d+)/i.exec(trimmed);
  if (bgmChar) return `bgm:character:${bgmChar[1]}`;
  return null;
}

export function isAlreadyCollected(
  items: ArchiveItem[],
  category: ArchiveCategory,
  title: string,
  options?: ExistingItemMatchOptions
): boolean {
  return Boolean(findExistingItemByTitle(items, category, title, options));
}

export function findExistingItemByTitle(
  items: ArchiveItem[],
  category: ArchiveCategory,
  title: string,
  options?: ExistingItemMatchOptions
): ArchiveItem | undefined {
  const candCanonical = extractCanonicalExternalKey(
    category,
    options?.sourceUrl
  );
  const candKeys = collectNormalizedTitleKeys([title, options?.originalTitle]);
  if (!candCanonical && candKeys.size === 0) return undefined;

  return items.find((item) => {
    if (item.category !== category) return false;

    if (candCanonical) {
      const itemCanonical = extractCanonicalExternalKey(
        category,
        item.sourceUrl
      );
      if (itemCanonical && itemCanonical === candCanonical) {
        return true;
      }
    }

    const itemKeys = collectNormalizedTitleKeys([
      item.title,
      item.originalTitle,
    ]);
    let titleOverlap = false;
    for (const ck of candKeys) {
      if (itemKeys.has(ck)) {
        titleOverlap = true;
        break;
      }
    }
    if (!titleOverlap) return false;

    // For films/TV, allow collecting remakes from different years (e.g. Resident Evil 2002 vs 2026)
    if (
      category === 'film' &&
      !yearsAreCompatible(item.year, options?.year, 2)
    ) {
      return false;
    }

    return true;
  });
}

export function findAutoLinkIds(
  candidate: {
    title: string;
    category: ArchiveCategory;
    relatedWorkTitle?: string;
    portrayedBy?: string;
    relatedIds?: string[];
  },
  existingItems: ArchiveItem[]
): string[] {
  const linked = new Set<string>(candidate.relatedIds || []);
  const titleLower = candidate.title.trim().toLowerCase();
  const workLower = (candidate.relatedWorkTitle || '').trim().toLowerCase();
  const actorLower = (candidate.portrayedBy || '').trim().toLowerCase();

  for (const item of existingItems) {
    const itemTitle = item.title.trim().toLowerCase();
    const itemWork = (item.relatedWorkTitle || '').trim().toLowerCase();
    const itemActor = (item.portrayedBy || '').trim().toLowerCase();

    const matched =
      (workLower.length >= 2 &&
        itemTitle.length >= 2 &&
        workLower.includes(itemTitle)) ||
      (actorLower.length >= 2 &&
        itemTitle.length >= 2 &&
        actorLower.includes(itemTitle)) ||
      (itemWork.length >= 2 &&
        titleLower.length >= 2 &&
        itemWork.includes(titleLower)) ||
      (itemActor.length >= 2 &&
        titleLower.length >= 2 &&
        itemActor.includes(titleLower));

    if (matched) {
      linked.add(item.id);
    }
  }

  return Array.from(linked);
}

export function formatRelatedSummary(related: ArchiveItem[]): string {
  if (related.length === 0) return '';
  let film = 0;
  let person = 0;
  let character = 0;
  for (const r of related) {
    if (r.category === 'film') film += 1;
    else if (r.category === 'person') person += 1;
    else if (r.category === 'character') character += 1;
  }
  const parts: string[] = [];
  if (film > 0) parts.push(`${film} 影视`);
  if (person > 0) parts.push(`${person} 影人`);
  if (character > 0) parts.push(`${character} 角色`);
  return parts.join(' · ');
}

const VALID_CATEGORIES = new Set<ArchiveCategory>(['film', 'person', 'character']);
const VALID_STATUSES = new Set<CollectionStatus>([
  'favorite',
  'watched',
  'watching',
  'watchlist',
]);

export function parseImportPayload(jsonText: string): {
  items: ArchiveItem[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonText);
    const rawList = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : null;

    if (!rawList) {
      return {
        items: [],
        error: '备份格式不正确：需要包含藏品数组（items）的 JSON 文件',
      };
    }

    const now = new Date().toISOString();
    const cleaned: ArchiveItem[] = [];

    for (const entry of rawList) {
      if (!entry || typeof entry !== 'object') continue;
      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      const category = entry.category as ArchiveCategory;
      if (!title || !VALID_CATEGORIES.has(category)) continue;

      const status = VALID_STATUSES.has(entry.status)
        ? (entry.status as CollectionStatus)
        : 'watched';
      const rating =
        typeof entry.rating === 'number' && entry.rating >= 0 && entry.rating <= 5
          ? Math.round(entry.rating)
          : 0;

      cleaned.push({
        id:
          typeof entry.id === 'string' && entry.id.trim()
            ? entry.id.trim()
            : `imp-${Date.now()}-${cleaned.length}`,
        accessionNo:
          typeof entry.accessionNo === 'string' ? entry.accessionNo : '',
        category,
        title,
        originalTitle:
          typeof entry.originalTitle === 'string' ? entry.originalTitle : undefined,
        subtitle: typeof entry.subtitle === 'string' ? entry.subtitle : undefined,
        year: typeof entry.year === 'string' ? entry.year : undefined,
        region: typeof entry.region === 'string' ? entry.region : undefined,
        coverUrl:
          typeof entry.coverUrl === 'string'
            ? buildProxyImageUrl(entry.coverUrl)
            : undefined,
        summary: typeof entry.summary === 'string' ? entry.summary : '',
        quote: typeof entry.quote === 'string' ? entry.quote : undefined,
        notes: typeof entry.notes === 'string' ? entry.notes : '',
        rating,
        status,
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((t: unknown): t is string => typeof t === 'string')
          : [],
        relatedIds: Array.isArray(entry.relatedIds)
          ? entry.relatedIds.filter(
              (id: unknown): id is string => typeof id === 'string'
            )
          : [],
        relatedWorkTitle:
          typeof entry.relatedWorkTitle === 'string'
            ? entry.relatedWorkTitle
            : undefined,
        portrayedBy:
          typeof entry.portrayedBy === 'string' ? entry.portrayedBy : undefined,
        characterProfile:
          entry.characterProfile && typeof entry.characterProfile === 'object'
            ? {
                alias:
                  typeof entry.characterProfile.alias === 'string'
                    ? entry.characterProfile.alias
                    : undefined,
                identity:
                  typeof entry.characterProfile.identity === 'string'
                    ? entry.characterProfile.identity
                    : undefined,
                affiliation:
                  typeof entry.characterProfile.affiliation === 'string'
                    ? entry.characterProfile.affiliation
                    : undefined,
                origin:
                  typeof entry.characterProfile.origin === 'string'
                    ? entry.characterProfile.origin
                    : undefined,
                abilities:
                  typeof entry.characterProfile.abilities === 'string'
                    ? entry.characterProfile.abilities
                    : undefined,
                firstAppearance:
                  typeof entry.characterProfile.firstAppearance === 'string'
                    ? entry.characterProfile.firstAppearance
                    : undefined,
                creator:
                  typeof entry.characterProfile.creator === 'string'
                    ? entry.characterProfile.creator
                    : undefined,
                highlights:
                  typeof entry.characterProfile.highlights === 'string'
                    ? entry.characterProfile.highlights
                    : undefined,
                bio:
                  typeof entry.characterProfile.bio === 'string'
                    ? entry.characterProfile.bio
                    : undefined,
                dossierSource:
                  typeof entry.characterProfile.dossierSource === 'string'
                    ? entry.characterProfile.dossierSource
                    : undefined,
                enrichedAt:
                  typeof entry.characterProfile.enrichedAt === 'string'
                    ? entry.characterProfile.enrichedAt
                    : undefined,
              }
            : undefined,
        summaryRevision:
          typeof entry.summaryRevision === 'number' && Number.isSafeInteger(entry.summaryRevision)
          && entry.summaryRevision > 0 ? entry.summaryRevision : undefined,
        sourceName:
          typeof entry.sourceName === 'string' ? entry.sourceName : '导入备份',
        sourceUrl:
          typeof entry.sourceUrl === 'string' ? entry.sourceUrl : undefined,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : now,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : now,
      });
    }

    if (cleaned.length === 0) {
      return {
        items: [],
        error: '未在文件中找到有效的影视、影人或角色记录',
      };
    }

    return { items: cleaned };
  } catch {
    return {
      items: [],
      error: 'JSON 解析失败，请确认粘贴或上传的是有效的备份文件',
    };
  }
}

export function mergeImportedItems(
  existing: ArchiveItem[],
  incoming: ArchiveItem[]
): { merged: ArchiveItem[]; addedCount: number; skippedCount: number } {
  const merged = [...existing];
  const existingKeys = new Set(
    existing.map((i) => `${i.category}::${i.title.trim().toLowerCase()}`)
  );
  const existingIds = new Set(existing.map((i) => i.id));

  let addedCount = 0;
  let skippedCount = 0;

  for (const item of incoming) {
    const key = `${item.category}::${item.title.trim().toLowerCase()}`;
    if (existingIds.has(item.id) || existingKeys.has(key)) {
      skippedCount += 1;
      continue;
    }
    const assignedItem: ArchiveItem = {
      ...item,
      accessionNo: item.accessionNo || nextAccessionNo(merged),
    };
    merged.unshift(assignedItem);
    existingIds.add(assignedItem.id);
    existingKeys.add(key);
    addedCount += 1;
  }

  return { merged, addedCount, skippedCount };
}
