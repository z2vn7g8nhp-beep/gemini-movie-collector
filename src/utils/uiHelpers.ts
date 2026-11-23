import type {
  ArchiveCategory,
  ArchiveItem,
  CollectionStatus,
  SortOption,
} from '../types/archive';

const RECENT_SEARCH_KEY = 'cinearchive.recentSearches.v1';
export const MAX_RECENT_SEARCHES = 6;
export const VISIBLE_RECENT_SEARCHES = 3;

export interface ActiveLibraryFilterState {
  category: 'all' | ArchiveCategory;
  status: 'all' | CollectionStatus;
  tag: string;
  albumId: string;
  decade?: string;
  region?: string;
  ratingBucket?: string;
  completeness?: string;
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
  if (state.decade && state.decade !== 'all') count += 1;
  if (state.region && state.region.trim()) count += 1;
  if (state.ratingBucket && state.ratingBucket !== 'all') count += 1;
  if (state.completeness && state.completeness !== 'all') count += 1;
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

export function getVisibleRecentSearches(
  queries: string[],
  limit = VISIBLE_RECENT_SEARCHES
): string[] {
  if (!Array.isArray(queries) || limit <= 0) return [];
  return queries.slice(0, limit);
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

export function clearRecentSearches(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_SEARCH_KEY);
  } catch {
    // Ignore storage errors
  }
}

export const CURATED_SEARCH_SUGGESTIONS: Record<ArchiveCategory, string[]> = {
  film: ['花样年华', '千与千寻', '星际穿越', '霸王别姬', '盗梦空间'],
  person: ['王家卫', '梁朝伟', '宫崎骏', '克里斯托弗·诺兰', '张曼玉'],
  character: ['周慕云', '无脸男', '小丑', '甄嬛', '苏丽珍'],
};

export interface ArchiveCardVisualInput {
  status: CollectionStatus;
  isMasterpiece: boolean;
  isSelected: boolean;
  isPressing: boolean;
  viewMode: 'grid' | 'list';
}

export interface ArchiveCardVisualResult {
  frameClassName: string;
  hasFavoriteGlow: boolean;
}

/**
 * Computes consistent archival card frame classes across both gallery grid and
 * list views, giving "favorite" (挚爱) items a subtle golden outline glow while
 * preserving batch-selection and long-press priority states.
 */
export function getArchiveCardVisualClasses({
  status,
  isMasterpiece,
  isSelected,
  isPressing,
  viewMode,
}: ArchiveCardVisualInput): ArchiveCardVisualResult {
  const isFavorite = status === 'favorite';

  if (viewMode === 'list') {
    if (isSelected) {
      return {
        frameClassName:
          'border-[#B43B2B] bg-[#FDF6F4] ring-2 ring-[#B43B2B]/70 dark:bg-[#2F1A17] dark:border-[#D95B48]',
        hasFavoriteGlow: false,
      };
    }
    if (isPressing) {
      return {
        frameClassName:
          'scale-[0.992] border-[#B43B2B]/70 bg-[#F6F1E7] ring-2 ring-[#B43B2B]/20 dark:bg-[#28221D] dark:border-[#D95B48]/70',
        hasFavoriteGlow: false,
      };
    }
    if (isFavorite) {
      return {
        frameClassName:
          'archive-card-favorite archive-card-favorite-list border-[#C9A45C]/90 bg-[#FFFDF9] dark:border-[#C9A45C]/70 dark:bg-[#211D18]',
        hasFavoriteGlow: true,
      };
    }
    if (isMasterpiece) {
      return {
        frameClassName:
          'border-[#DDD2BE] bg-[#FFFDF9] hover:border-[#CFC1A6] hover:bg-[#FAF7F0] dark:border-[#4B4132] dark:bg-[#1D1A17] dark:hover:border-[#6A5A42] dark:hover:bg-[#24201B]',
        hasFavoriteGlow: false,
      };
    }
    return {
      frameClassName:
        'border-[#E4DFD5] bg-[#FFFDF9] hover:border-[#CFC5B4] hover:bg-[#FAF7F0] dark:border-[#322D27] dark:bg-[#1D1A17] dark:hover:border-[#4A433A] dark:hover:bg-[#24201C]',
      hasFavoriteGlow: false,
    };
  }

  if (isSelected) {
    return {
      frameClassName:
        'border-[#B43B2B] ring-2 ring-[#B43B2B]/80 dark:border-[#D95B48]',
      hasFavoriteGlow: false,
    };
  }
  if (isPressing) {
    return {
      frameClassName:
        'scale-[0.985] border-[#B43B2B]/70 ring-2 ring-[#B43B2B]/25 dark:border-[#D95B48]/70',
      hasFavoriteGlow: false,
    };
  }
  if (isFavorite) {
    return {
      frameClassName:
        'archive-card-favorite archive-card-favorite-grid border-[#C9A45C]/90 dark:border-[#C9A45C]/70',
      hasFavoriteGlow: true,
    };
  }
  if (isMasterpiece) {
    return {
      frameClassName:
        'gallery-card-masterpiece border-[#DFD2B8] hover:border-[#CBB892] dark:border-[#534634] dark:hover:border-[#786548]',
      hasFavoriteGlow: false,
    };
  }
  return {
    frameClassName:
      'border-[#E6E0D4] hover:border-[#CFC5B4] dark:border-[#322D27] dark:hover:border-[#4B443B]',
    hasFavoriteGlow: false,
  };
}

