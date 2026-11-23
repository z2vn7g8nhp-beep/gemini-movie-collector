import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { buildCategoryDistribution } from './collectionStats';

function makeItem(id: string, category: ArchiveCategory): ArchiveItem {
  return {
    id,
    accessionNo: `CA-${id}`,
    category,
    title: `Item ${id}`,
    summary: '',
    notes: '',
    rating: 5,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

test('buildCategoryDistribution handles empty collection cleanly', () => {
  const result = buildCategoryDistribution([]);
  assert.equal(result.total, 0);
  assert.equal(result.activeSegments.length, 0);
  assert.equal(result.dominantCategory, null);
  assert.equal(result.coveredCategoryCount, 0);
  assert.deepEqual(
    result.segments.map((s) => s.percent),
    [0, 0, 0]
  );
});

test('buildCategoryDistribution guarantees balanced 100% sum on repeating thirds', () => {
  const items = [
    makeItem('1', 'film'),
    makeItem('2', 'person'),
    makeItem('3', 'character'),
  ];
  const result = buildCategoryDistribution(items);
  assert.equal(result.total, 3);
  assert.equal(result.coveredCategoryCount, 3);
  assert.equal(
    result.segments.reduce((sum, s) => sum + s.percent, 0),
    100
  );
  assert.match(result.achievementHint, /三类齐备/);
});

test('buildCategoryDistribution computes exact proportions and dominant category', () => {
  const items = [
    makeItem('1', 'film'),
    makeItem('2', 'film'),
    makeItem('3', 'person'),
    makeItem('4', 'character'),
  ];
  const result = buildCategoryDistribution(items);
  assert.equal(result.total, 4);
  assert.equal(result.dominantCategory, 'film');
  assert.deepEqual(
    result.segments.map((s) => ({ key: s.key, count: s.count, percent: s.percent })),
    [
      { key: 'film', count: 2, percent: 50 },
      { key: 'person', count: 1, percent: 25 },
      { key: 'character', count: 1, percent: 25 },
    ]
  );
});

test('buildCategoryDistribution filters activeSegments for single-category archive', () => {
  const items = [makeItem('1', 'film'), makeItem('2', 'film')];
  const result = buildCategoryDistribution(items);
  assert.equal(result.activeSegments.length, 1);
  assert.equal(result.activeSegments[0].key, 'film');
  assert.equal(result.activeSegments[0].percent, 100);
  assert.equal(result.coveredCategoryCount, 1);
});
