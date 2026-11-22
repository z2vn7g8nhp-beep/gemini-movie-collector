import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import { buildGlobalRelationGraph } from './globalGraph';

function makeItem(partial: Partial<ArchiveItem> & { id: string; title: string }): ArchiveItem {
  return {
    accessionNo: 'CA-001',
    category: 'film',
    summary: '',
    notes: '',
    rating: 4,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...partial,
  };
}

test('buildGlobalRelationGraph identifies hubs, explicit edges, and isolated items', () => {
  const items: ArchiveItem[] = [
    makeItem({
      id: 'f1',
      accessionNo: 'CA-001',
      category: 'film',
      title: '花样年华',
      relatedIds: ['p1', 'c1'],
      tags: ['港片美学'],
    }),
    makeItem({
      id: 'p1',
      accessionNo: 'CA-002',
      category: 'person',
      title: '王家卫',
      relatedIds: ['f1'],
      tags: ['港片美学'],
    }),
    makeItem({
      id: 'c1',
      accessionNo: 'CA-003',
      category: 'character',
      title: '周慕云',
      relatedIds: ['f1'],
      tags: ['港片美学'],
    }),
    makeItem({
      id: 'f2',
      accessionNo: 'CA-004',
      category: 'film',
      title: '独立孤片',
      relatedIds: [],
      tags: ['科幻'],
    }),
  ];

  const graph = buildGlobalRelationGraph(items);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.explicitEdgeCount, 2);
  assert.equal(graph.hubs[0]?.id, 'f1');
  assert.equal(graph.hubs[0]?.degree, 2);
  assert.equal(graph.isolatedNodes.length, 1);
  assert.equal(graph.isolatedNodes[0]?.id, 'f2');

  // Every node has deterministic finite coordinates inside viewbox bounds
  for (const node of graph.nodes) {
    assert.ok(node.x >= 40 && node.x <= graph.width - 40);
    assert.ok(node.y >= 40 && node.y <= graph.height - 40);
  }
});

test('buildGlobalRelationGraph supports isolatedOnly filter and tag edges', () => {
  const items: ArchiveItem[] = [
    makeItem({ id: 'a', accessionNo: 'CA-001', title: '片A', tags: ['赛博朋克'] }),
    makeItem({ id: 'b', accessionNo: 'CA-002', title: '片B', tags: ['赛博朋克'] }),
  ];

  const withTags = buildGlobalRelationGraph(items, { includeTagEdges: true });
  assert.equal(withTags.tagEdgeCount, 1);
  assert.equal(withTags.isolatedNodes.length, 2);

  const isoOnly = buildGlobalRelationGraph(items, { isolatedOnly: true });
  assert.equal(isoOnly.nodes.length, 2);
});
