import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  countActiveLibraryFilters,
  getAdjacentArchiveItem,
  getArchiveCardVisualClasses,
  getVisibleRecentSearches,
  pushRecentSearchQuery,
  removeRecentSearchQuery,
  VISIBLE_RECENT_SEARCHES,
} from './uiHelpers';

const MOCK_ITEMS: ArchiveItem[] = [
  {
    id: 'a',
    accessionNo: 'CA-001',
    category: 'film',
    title: '花样年华',
    summary: '',
    notes: '',
    rating: 5,
    status: 'favorite',
    tags: [],
    relatedIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'b',
    accessionNo: 'CA-002',
    category: 'film',
    title: '千与千寻',
    summary: '',
    notes: '',
    rating: 5,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'c',
    accessionNo: 'CA-003',
    category: 'person',
    title: '王家卫',
    summary: '',
    notes: '',
    rating: 5,
    status: 'favorite',
    tags: [],
    relatedIds: [],
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  },
];

test('countActiveLibraryFilters counts only non-default filters', () => {
  assert.equal(
    countActiveLibraryFilters({
      category: 'all',
      status: 'all',
      tag: '',
      albumId: '',
      query: '   ',
      sortBy: 'recent',
    }),
    0
  );

  assert.equal(
    countActiveLibraryFilters({
      category: 'film',
      status: 'favorite',
      tag: '港片美学',
      albumId: '',
      query: '花样',
      sortBy: 'rating',
    }),
    5
  );
});

test('getAdjacentArchiveItem wraps cleanly around list bounds', () => {
  assert.equal(getAdjacentArchiveItem(MOCK_ITEMS, 'a', 'next')?.id, 'b');
  assert.equal(getAdjacentArchiveItem(MOCK_ITEMS, 'c', 'next')?.id, 'a');
  assert.equal(getAdjacentArchiveItem(MOCK_ITEMS, 'a', 'prev')?.id, 'c');
  assert.equal(getAdjacentArchiveItem([MOCK_ITEMS[0]], 'a', 'next'), null);
  assert.equal(getAdjacentArchiveItem(MOCK_ITEMS, 'missing', 'next'), null);
});

test('pushRecentSearchQuery deduplicates case-insensitively and enforces limit', () => {
  const step1 = pushRecentSearchQuery(['花样年华', 'In the Mood'], 'in the mood', 3);
  assert.deepEqual(step1, ['in the mood', '花样年华']);

  const step2 = pushRecentSearchQuery(['a', 'b', 'c'], 'd', 3);
  assert.deepEqual(step2, ['d', 'a', 'b']);

  const step3 = removeRecentSearchQuery(step2, 'A');
  assert.deepEqual(step3, ['d', 'b']);

  assert.equal(VISIBLE_RECENT_SEARCHES, 3);
  assert.deepEqual(
    getVisibleRecentSearches(['霸王别姬', '重庆森林', '千与千寻', '花样年华']),
    ['霸王别姬', '重庆森林', '千与千寻']
  );
  assert.deepEqual(getVisibleRecentSearches([]), []);
});

test('getArchiveCardVisualClasses applies golden outline glow for favorite cards in grid and list views', () => {
  const favGrid = getArchiveCardVisualClasses({
    status: 'favorite',
    isMasterpiece: false,
    isSelected: false,
    isPressing: false,
    viewMode: 'grid',
  });
  assert.equal(favGrid.hasFavoriteGlow, true);
  assert.match(favGrid.frameClassName, /archive-card-favorite-grid/);

  const favList = getArchiveCardVisualClasses({
    status: 'favorite',
    isMasterpiece: true,
    isSelected: false,
    isPressing: false,
    viewMode: 'list',
  });
  assert.equal(favList.hasFavoriteGlow, true);
  assert.match(favList.frameClassName, /archive-card-favorite-list/);

  const watchedGrid = getArchiveCardVisualClasses({
    status: 'watched',
    isMasterpiece: false,
    isSelected: false,
    isPressing: false,
    viewMode: 'grid',
  });
  assert.equal(watchedGrid.hasFavoriteGlow, false);
  assert.doesNotMatch(watchedGrid.frameClassName, /archive-card-favorite/);
  assert.match(watchedGrid.frameClassName, /archive-card-surface/);
  assert.match(watchedGrid.frameClassName, /archive-card-grid/);

  const watchedList = getArchiveCardVisualClasses({
    status: 'watched',
    isMasterpiece: false,
    isSelected: false,
    isPressing: false,
    viewMode: 'list',
  });
  assert.equal(watchedList.hasFavoriteGlow, false);
  assert.match(watchedList.frameClassName, /archive-card-surface/);
  assert.match(watchedList.frameClassName, /archive-card-list/);

  const masterpieceGrid = getArchiveCardVisualClasses({
    status: 'watched',
    isMasterpiece: true,
    isSelected: false,
    isPressing: false,
    viewMode: 'grid',
  });
  assert.equal(masterpieceGrid.hasFavoriteGlow, false);
  assert.match(masterpieceGrid.frameClassName, /archive-card-masterpiece/);
  assert.match(masterpieceGrid.frameClassName, /archive-card-grid/);

  // Batch selection takes visual precedence over favorite glow and default rim
  const selectedFav = getArchiveCardVisualClasses({
    status: 'favorite',
    isMasterpiece: true,
    isSelected: true,
    isPressing: false,
    viewMode: 'grid',
  });
  assert.equal(selectedFav.hasFavoriteGlow, false);
  assert.match(selectedFav.frameClassName, /ring-\[#B43B2B\]/);
  assert.doesNotMatch(selectedFav.frameClassName, /archive-card-surface/);

  // Cross-jump located state highlights the card in both grid and list views
  const locatedGrid = getArchiveCardVisualClasses({
    status: 'watched',
    isMasterpiece: false,
    isSelected: false,
    isLocated: true,
    isPressing: false,
    viewMode: 'grid',
  });
  assert.match(locatedGrid.frameClassName, /archive-card-located/);

  const locatedList = getArchiveCardVisualClasses({
    status: 'favorite',
    isMasterpiece: true,
    isSelected: false,
    isLocated: true,
    isPressing: false,
    viewMode: 'list',
  });
  assert.match(locatedList.frameClassName, /archive-card-located/);
  assert.equal(locatedList.hasFavoriteGlow, true);
});
