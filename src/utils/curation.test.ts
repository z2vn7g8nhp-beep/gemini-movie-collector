import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem, CollectorAlbum } from '../types/archive';
import { filterAndSortItems } from './archive';
import { buildEraTimeline, buildWatchedTimeline } from './timeline';
import {
  addWatchLogToItem,
  applyBatchAddToAlbum,
  applyBatchStatusUpdate,
  applyBatchTagAdd,
  extractQuoteEntries,
  extractRegionRegistry,
  filterWatchlistPool,
  matchYearToDecade,
  pickWatchlistBlindBoxItem,
  removeWatchLogFromItem,
} from './curation';

function makeItem(partial: Partial<ArchiveItem> & { id: string; title: string }): ArchiveItem {
  return {
    accessionNo: 'CA-001',
    category: 'film',
    summary: '简介',
    notes: '',
    rating: 0,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...partial,
  };
}

test('matchYearToDecade and advanced filterAndSortItems criteria', () => {
  assert.equal(matchYearToDecade('2024', '2020s'), true);
  assert.equal(matchYearToDecade('1994', '1990s'), true);
  assert.equal(matchYearToDecade('1972', 'classic'), true);
  assert.equal(matchYearToDecade('2001', '1990s'), false);

  const items: ArchiveItem[] = [
    makeItem({
      id: '1',
      title: '花样年华',
      year: '2000',
      region: '中国香港 / 法国',
      rating: 5,
      status: 'favorite',
      coverUrl: 'https://example.com/a.jpg',
      quote: '如果多一张船票',
      tags: ['港片', '爱情'],
      relatedIds: ['p1'],
    }),
    makeItem({
      id: '2',
      title: '沙丘2',
      year: '2024',
      region: '美国',
      rating: 0,
      status: 'watchlist',
      tags: ['科幻'],
    }),
  ];

  assert.equal(
    filterAndSortItems(items, {
      category: 'all',
      status: 'all',
      decade: '2000s',
      query: '',
      sortBy: 'recent',
    }).length,
    1
  );

  assert.equal(
    filterAndSortItems(items, {
      category: 'all',
      status: 'all',
      region: '中国香港',
      query: '',
      sortBy: 'recent',
    })[0]?.id,
    '1'
  );

  assert.equal(
    filterAndSortItems(items, {
      category: 'all',
      status: 'all',
      ratingBucket: 'unrated',
      completeness: 'needs-polish',
      query: '',
      sortBy: 'recent',
    })[0]?.id,
    '2'
  );

  const regions = extractRegionRegistry(items);
  assert.equal(regions.length, 3);
});

test('watch logs CRUD and 3-mode timeline builders (watched & era)', () => {
  const film = makeItem({
    id: 'f1',
    title: '千与千寻',
    year: '2001',
    watchLogs: [
      { id: 'w1', watchedAt: '2024-03-10', medium: 'streaming', note: '初见惊艳' },
    ],
  });

  const logsAfterAdd = addWatchLogToItem(film, {
    id: 'w2',
    watchedAt: '2026-11-21',
    medium: 'imax',
    note: '大银幕重映二刷',
  });
  assert.equal(logsAfterAdd.length, 2);
  assert.equal(logsAfterAdd[0].watchedAt, '2026-11-21');

  const updatedFilm = { ...film, watchLogs: logsAfterAdd };
  const watchedTl = buildWatchedTimeline([updatedFilm]);
  assert.equal(watchedTl.totalEvents, 2);
  assert.equal(watchedTl.rewatchCount, 1);
  assert.equal(watchedTl.months[0].events[0].watchNumber, 2);
  assert.equal(watchedTl.months[1].events[0].watchNumber, 1);

  const afterRemove = removeWatchLogFromItem(updatedFilm, 'w2');
  assert.equal(afterRemove.length, 1);

  const eraTl = buildEraTimeline([
    updatedFilm,
    makeItem({ id: 'f2', title: '霸王别姬', year: '1993' }),
    makeItem({ id: 'p1', category: 'person', title: '未知年代角色' }),
  ]);
  assert.equal(eraTl.totalDatedItems, 2);
  assert.equal(eraTl.undatedItems.length, 1);
  assert.equal(eraTl.earliestYear, 1993);
  assert.equal(eraTl.latestYear, 2001);
  assert.equal(eraTl.decades[0].decadeKey, '2000s');
  assert.equal(eraTl.decades[1].decadeKey, '1990s');
});

test('watchlist blind box, quotes wall extraction, and batch curation helpers', () => {
  const items: ArchiveItem[] = [
    makeItem({
      id: 'w1',
      title: '盗梦空间',
      year: '2010',
      status: 'watchlist',
      tags: ['科幻'],
      quote: '不要去回想它',
    }),
    makeItem({
      id: 'w2',
      title: '重庆森林',
      year: '1994',
      status: 'watchlist',
      tags: ['港片'],
    }),
    makeItem({
      id: 'done1',
      title: '花样年华',
      year: '2000',
      status: 'favorite',
      rating: 5,
      quote: '如果多一张船票，你会不会跟我一起走？',
    }),
  ];

  assert.equal(filterWatchlistPool(items).length, 2);
  const draw = pickWatchlistBlindBoxItem(items, { decade: '1990s' });
  assert.equal(draw.poolCount, 1);
  assert.equal(draw.picked?.id, 'w2');

  const quotes = extractQuoteEntries(items);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].item.id, 'done1');

  const statusBatch = applyBatchStatusUpdate(items, ['w1', 'w2'], 'watching');
  assert.equal(statusBatch.updatedCount, 2);
  assert.equal(statusBatch.items[0].status, 'watching');

  const tagBatch = applyBatchTagAdd(items, ['w1', 'w2'], '周末片单');
  assert.equal(tagBatch.updatedCount, 2);
  assert.ok(tagBatch.items[0].tags.includes('周末片单'));

  const albums: CollectorAlbum[] = [
    {
      id: 'alb-1',
      name: '深夜影院',
      itemIds: ['done1'],
      targetCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const albBatch = applyBatchAddToAlbum(albums, 'alb-1', ['w1', 'done1']);
  assert.equal(albBatch.addedCount, 1);
  assert.deepEqual(albBatch.albums[0].itemIds, ['done1', 'w1']);
});
