import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArchiveItem } from '../types/archive';
import { getRelatedItems } from './archive';
import {
  applyItemPatch,
  buildRelationLookupMap,
  computeZoomPanAroundPoint,
  pruneDeletedItemReferences,
  pushGraphHistory,
  serializeClearablePatch,
  shouldAcceptMutationResponse,
} from './interactionHelpers';

function makeItem(overrides: Partial<ArchiveItem> = {}): ArchiveItem {
  return {
    id: overrides.id ?? 'arc-1',
    accessionNo: overrides.accessionNo ?? 'CA-001',
    category: overrides.category ?? 'film',
    title: overrides.title ?? '花样年华',
    summary: overrides.summary ?? '王家卫经典作品',
    notes: overrides.notes ?? '',
    rating: overrides.rating ?? 5,
    status: overrides.status ?? 'favorite',
    tags: overrides.tags ?? ['爱情'],
    relatedIds: overrides.relatedIds ?? [],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('serializeClearablePatch turns cleared optional strings into null so JSON preserves clearing', () => {
  const wire = serializeClearablePatch({
    quote: undefined,
    coverUrl: '   ',
    relatedWorkTitle: '',
    portrayedBy: '梁朝伟',
    notes: '更新手记',
  });
  const roundTripped = JSON.parse(JSON.stringify(wire)) as Record<string, unknown>;
  assert.equal(roundTripped.quote, null);
  assert.equal(roundTripped.coverUrl, null);
  assert.equal(roundTripped.relatedWorkTitle, null);
  assert.equal(roundTripped.portrayedBy, '梁朝伟');
  assert.equal(roundTripped.notes, '更新手记');
});

test('applyItemPatch clears optional fields when patch sends null, empty string, or undefined', () => {
  const existing = makeItem({
    quote: '如果多一张船票',
    coverUrl: 'https://example.com/poster.jpg',
    relatedWorkTitle: '花样年华',
    portrayedBy: '梁朝伟',
    year: '2000',
  });

  const updated = applyItemPatch(
    existing,
    {
      quote: null,
      coverUrl: '',
      relatedWorkTitle: '   ',
      portrayedBy: undefined,
    },
    '2026-05-01T00:00:00.000Z'
  );

  assert.equal(updated.quote, undefined);
  assert.equal('quote' in updated, false);
  assert.equal(updated.coverUrl, undefined);
  assert.equal(updated.relatedWorkTitle, undefined);
  assert.equal(updated.portrayedBy, undefined);
  assert.equal(updated.year, '2000');
  assert.equal(updated.updatedAt, '2026-05-01T00:00:00.000Z');
});

test('shouldAcceptMutationResponse rejects stale out-of-order server responses', () => {
  assert.equal(shouldAcceptMutationResponse(1, 2), false);
  assert.equal(shouldAcceptMutationResponse(2, 2), true);
  assert.equal(shouldAcceptMutationResponse(3, 5), false);
});

test('buildRelationLookupMap matches getRelatedItems for explicit and inferred links', () => {
  const film = makeItem({
    id: 'film-1',
    category: 'film',
    title: '花样年华',
    relatedIds: ['person-1'],
  });
  const person = makeItem({
    id: 'person-1',
    category: 'person',
    title: '梁朝伟',
    relatedIds: [],
  });
  const character = makeItem({
    id: 'char-1',
    category: 'character',
    title: '周慕云',
    relatedWorkTitle: '花样年华',
    portrayedBy: '梁朝伟',
    relatedIds: [],
  });
  const unrelated = makeItem({
    id: 'film-2',
    category: 'film',
    title: '盗梦空间',
    relatedIds: [],
  });

  const all = [film, person, character, unrelated];
  const map = buildRelationLookupMap(all);

  for (const item of all) {
    const fastIds = (map.get(item.id) || []).map((x) => x.id).sort();
    const slowIds = getRelatedItems(item, all)
      .map((x) => x.id)
      .sort();
    assert.deepEqual(fastIds, slowIds);
  }
});

test('pushGraphHistory deduplicates consecutive nodes and truncates forward stack on branch', () => {
  let state = { entries: ['a'], index: 0 };
  state = pushGraphHistory(state, 'a');
  assert.deepEqual(state, { entries: ['a'], index: 0 });

  state = pushGraphHistory(state, 'b');
  state = pushGraphHistory(state, 'c');
  assert.deepEqual(state, { entries: ['a', 'b', 'c'], index: 2 });

  // Go back to index 1 ('b') and branch to 'd'
  state = pushGraphHistory({ entries: state.entries, index: 1 }, 'd');
  assert.deepEqual(state, { entries: ['a', 'b', 'd'], index: 2 });
});

test('computeZoomPanAroundPoint keeps world point under pointer stationary', () => {
  const centerX = 480;
  const centerY = 320;
  const anchorX = 620;
  const anchorY = 240;
  const currentZoom = 1;
  const currentPan = { x: 20, y: -10 };

  const worldBeforeX = centerX + (anchorX - centerX - currentPan.x) / currentZoom;
  const worldBeforeY = centerY + (anchorY - centerY - currentPan.y) / currentZoom;

  const next = computeZoomPanAroundPoint({
    currentZoom,
    currentPan,
    targetZoom: 1.5,
    anchorX,
    anchorY,
    centerX,
    centerY,
  });

  assert.equal(next.zoom, 1.5);
  const worldAfterX = centerX + (anchorX - centerX - next.pan.x) / next.zoom;
  const worldAfterY = centerY + (anchorY - centerY - next.pan.y) / next.zoom;

  assert.ok(Math.abs(worldAfterX - worldBeforeX) < 0.05);
  assert.ok(Math.abs(worldAfterY - worldBeforeY) < 0.05);
});

test('pruneDeletedItemReferences removes deleted item from selection, located, and showcase refs', () => {
  const res = pruneDeletedItemReferences('arc-2', {
    batchSelectedIds: ['arc-1', 'arc-2', 'arc-3'],
    locatedItemId: 'arc-2',
    pinnedItemId: 'arc-2',
    customLinkItemId: 'arc-1',
  });
  assert.deepEqual(res.batchSelectedIds, ['arc-1', 'arc-3']);
  assert.equal(res.locatedItemId, null);
  assert.equal(res.clearPinnedItemId, true);
  assert.equal(res.clearCustomLinkItemId, false);
});
