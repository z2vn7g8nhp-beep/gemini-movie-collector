import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  countActiveLibraryFilters,
  getAdjacentArchiveItem,
  pushRecentSearchQuery,
  removeRecentSearchQuery,
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
});
