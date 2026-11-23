import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem, CollectorAlbum } from '../types/archive';
import {
  buildCrossJumpLibraryState,
  getAvailableAlbumsForItem,
  getItemAlbums,
} from './drawerNavigation';

function makeItem(overrides: Partial<ArchiveItem>): ArchiveItem {
  return {
    id: overrides.id ?? 'item-1',
    accessionNo: overrides.accessionNo ?? 'CA-001',
    category: overrides.category ?? 'film',
    title: overrides.title ?? '花样年华',
    summary: overrides.summary ?? '',
    notes: overrides.notes ?? '',
    rating: overrides.rating ?? 5,
    status: overrides.status ?? 'favorite',
    tags: overrides.tags ?? ['香港', '爱情'],
    relatedIds: overrides.relatedIds ?? [],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('getItemAlbums resolves manual, tag-based, and combined album memberships with accurate counts', () => {
  const itemA = makeItem({ id: 'a', title: '钢铁侠', tags: ['漫威', '科幻'] });
  const itemB = makeItem({ id: 'b', title: '美国队长', tags: ['漫威'] });
  const itemC = makeItem({ id: 'c', title: '花样年华', tags: ['王家卫'] });
  const allItems = [itemA, itemB, itemC];

  const albums: CollectorAlbum[] = [
    {
      id: 'alb-tag',
      name: '漫威专题图鉴',
      tag: '漫威',
      targetCount: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'alb-manual',
      name: '午夜必看清单',
      itemIds: ['a', 'c'],
      targetCount: 5,
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'alb-both',
      name: '科幻挚爱',
      tag: '科幻',
      itemIds: ['a'],
      targetCount: 3,
      createdAt: '2026-01-03T00:00:00.000Z',
    },
    {
      id: 'alb-other',
      name: '港片黄金时代',
      tag: '王家卫',
      targetCount: 5,
      createdAt: '2026-01-04T00:00:00.000Z',
    },
  ];

  const memberships = getItemAlbums(itemA, albums, allItems);
  assert.equal(memberships.length, 3);
  assert.equal(memberships[0].album.id, 'alb-tag');
  assert.equal(memberships[0].matchReason, 'tag');
  assert.equal(memberships[0].matchedCount, 2);

  assert.equal(memberships[1].album.id, 'alb-manual');
  assert.equal(memberships[1].matchReason, 'manual');
  assert.equal(memberships[1].matchedCount, 2);

  assert.equal(memberships[2].album.id, 'alb-both');
  assert.equal(memberships[2].matchReason, 'both');
  assert.equal(memberships[2].matchedCount, 1);

  const available = getAvailableAlbumsForItem(itemA, albums);
  assert.deepEqual(
    available.map((a) => a.id),
    ['alb-other']
  );
});

test('buildCrossJumpLibraryState resets conflicting filters and sets album or tag target with locatedItemId', () => {
  const albumJump = buildCrossJumpLibraryState({
    kind: 'album',
    albumId: 'alb-1',
    albumName: '漫威专题图鉴',
    itemId: 'item-42',
    itemTitle: '钢铁侠',
  });

  assert.equal(albumJump.activeTab, 'library');
  assert.equal(albumJump.activeCategory, 'all');
  assert.equal(albumJump.statusFilter, 'all');
  assert.equal(albumJump.activeAlbumId, 'alb-1');
  assert.equal(albumJump.activeTag, '');
  assert.equal(albumJump.libraryQuery, '');
  assert.equal(albumJump.decadeFilter, 'all');
  assert.equal(albumJump.regionFilter, '');
  assert.equal(albumJump.ratingBucketFilter, 'all');
  assert.equal(albumJump.completenessFilter, 'all');
  assert.equal(albumJump.locatedItemId, 'item-42');
  assert.match(albumJump.notice, /漫威专题图鉴/);
  assert.match(albumJump.notice, /钢铁侠/);

  const tagJump = buildCrossJumpLibraryState({
    kind: 'tag',
    tag: '科幻',
    itemId: 'item-42',
    itemTitle: '钢铁侠',
  });

  assert.equal(tagJump.activeTab, 'library');
  assert.equal(tagJump.activeAlbumId, '');
  assert.equal(tagJump.activeTag, '科幻');
  assert.equal(tagJump.locatedItemId, 'item-42');
  assert.match(tagJump.notice, /科幻/);
  assert.match(tagJump.notice, /钢铁侠/);
});
