import type {
  ArchiveCategory,
  ArchiveItem,
  CollectionStatus,
  SortOption,
} from '../types/archive';

const RECENT_SEARCH_KEY = 'cinearchive.recentSearches.v1';
export const MAX_RECENT_SEARCHES = 6;

export interface ActiveLibraryFilterState {
  category: 'all' | ArchiveCategory;
  status: 'all' | CollectionStatus;
  tag: string;
  albumId: string;
  query: string;
  sortBy: SortOption;
}

export function countActiveLibraryFilters(
  state: ActiveLibraryFilterState
): number {
  let count = 0;
  if (state.category !== 'all') count += 1;
  if (state.status !== 'all') count += 1;
  if (state.tag.trim()) count += 1;
  if (state.albumId.trim()) count += 1;
  if (state.query.trim()) count += 1;
  if (state.sortBy !== 'recent') count += 1;
  return count;
}

export function getAdjacentArchiveItem(
  items: ArchiveItem[],
  currentId: string,
  direction: 'prev' | 'next'
): ArchiveItem | null {
  if (items.length <= 1) return null;
  const idx = items.findIndex((it) => it.id === currentId);
  if (idx < 0) return null;
  const nextIdx =
    direction === 'next'
      ? (idx + 1) % items.length
      : (idx - 1 + items.length) % items.length;
  return items[nextIdx] ?? null;
}

export function pushRecentSearchQuery(
  existing: string[],
  rawQuery: string,
  maxCount = MAX_RECENT_SEARCHES
): string[] {
  const clean = rawQuery.trim();
  if (!clean) return existing;
  const deduped = existing.filter(
    (item) => item.toLowerCase() !== clean.toLowerCase()
  );
  return [clean, ...deduped].slice(0, maxCount);
}

export function removeRecentSearchQuery(
  existing: string[],
  target: string
): string[] {
  return existing.filter(
    (item) => item.toLowerCase() !== target.trim().toLowerCase()
  );
}

export function loadRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentSearches(queries: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RECENT_SEARCH_KEY,
      JSON.stringify(queries.slice(0, MAX_RECENT_SEARCHES))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export const CURATED_SEARCH_SUGGESTIONS: Record<ArchiveCategory, string[]> = {
  film: ['花样年华', '千与千寻', '星际穿越', '霸王别姬', '盗梦空间'],
  person: ['王家卫', '梁朝伟', '宫崎骏', '克里斯托弗·诺兰', '张曼玉'],
  character: ['周慕云', '无脸男', '小丑', '甄嬛', '苏丽珍'],
};
