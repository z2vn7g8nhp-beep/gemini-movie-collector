import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  buildRelationGraph,
  getDetailEdgeVisualStyle,
  getDetailNodeVisualStyle,
} from './relationGraph';

function makeItem(overrides: Partial<ArchiveItem>): ArchiveItem {
  return {
    id: overrides.id ?? 'i-1',
    accessionNo: overrides.accessionNo ?? 'CA-001',
    category: overrides.category ?? 'film',
    title: overrides.title ?? '测试条目',
    summary: '',
    notes: '',
    rating: 0,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

test('buildRelationGraph discovers 1-hop direct and 2-hop deep bridge relations for a person', () => {
  const film = makeItem({
    id: 'film-1',
    category: 'film',
    title: '复仇者联盟5：毁灭之日',
    tags: ['电影', '漫威', '2026'],
    relatedIds: ['person-1', 'char-1'],
  });
  const person = makeItem({
    id: 'person-1',
    category: 'person',
    title: '小罗伯特·唐尼',
    tags: ['演员'],
    relatedIds: ['film-1'],
  });
  const character = makeItem({
    id: 'char-1',
    category: 'character',
    title: '末日博士',
    tags: ['角色'],
    relatedIds: ['film-1'],
  });

  const graph = buildRelationGraph(person, [film, person, character]);

  assert.equal(graph.center.item.id, 'person-1');
  assert.equal(graph.directCount, 1);
  assert.equal(graph.deepCount, 1);
  assert.equal(graph.nodes.length, 3);

  const filmNode = graph.nodes.find((n) => n.item.id === 'film-1');
  const charNode = graph.nodes.find((n) => n.item.id === 'char-1');
  assert.equal(filmNode?.hop, 1);
  assert.equal(filmNode?.strength, 3);
  assert.equal(charNode?.hop, 2);
  assert.ok(charNode?.reason.includes('复仇者联盟5'));

  assert.ok(
    graph.edges.some(
      (e) =>
        e.kind === 'direct' &&
        ((e.sourceId === 'person-1' && e.targetId === 'film-1') ||
          (e.sourceId === 'film-1' && e.targetId === 'person-1'))
    )
  );
  assert.ok(
    graph.edges.some(
      (e) =>
        e.kind === 'bridge' &&
        ((e.sourceId === 'film-1' && e.targetId === 'char-1') ||
          (e.sourceId === 'char-1' && e.targetId === 'film-1'))
    )
  );
});

test('buildRelationGraph includes shared thematic tag links and ignores generic/year tags', () => {
  const a = makeItem({
    id: 'a',
    category: 'character',
    title: '末日博士',
    tags: ['角色', '漫威', '2026'],
  });
  const b = makeItem({
    id: 'b',
    category: 'character',
    title: '钢铁侠',
    tags: ['角色', '漫威'],
  });
  const c = makeItem({
    id: 'c',
    category: 'character',
    title: '无关角色',
    tags: ['角色', '2026'],
  });

  const graph = buildRelationGraph(a, [a, b, c]);
  assert.equal(graph.directCount, 0);
  assert.equal(graph.tagLinkCount, 1);
  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.nodes.some((n) => n.item.id === 'b'));
  assert.equal(
    graph.nodes.some((n) => n.item.id === 'c'),
    false
  );
  assert.equal(graph.edges[0]?.kind, 'tag');
});

test('buildRelationGraph handles solo items and keeps all node coordinates within viewBox bounds', () => {
  const solo = makeItem({ id: 'solo', title: '独立条目' });
  const soloGraph = buildRelationGraph(solo, [solo]);
  assert.equal(soloGraph.nodes.length, 1);
  assert.equal(soloGraph.edges.length, 0);

  // Larger graph: verify bounding box and maxNeighbors cap
  const hub = makeItem({
    id: 'hub',
    relatedIds: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'],
  });
  const spokes = Array.from({ length: 10 }, (_, idx) =>
    makeItem({ id: `n${idx + 1}`, title: `关联${idx + 1}`, relatedIds: ['hub'] })
  );
  const bigGraph = buildRelationGraph(hub, [hub, ...spokes], 6);
  assert.equal(bigGraph.nodes.length, 7); // 1 center + 6 neighbors
  for (const node of bigGraph.nodes) {
    assert.ok(node.x >= 30 && node.x <= bigGraph.width - 30);
    assert.ok(node.y >= 24 && node.y <= bigGraph.height - 34);
  }
});

test('buildRelationGraph elevates multi-bridge 2-hop nodes and scales visual styles by strength', () => {
  const center = makeItem({
    id: 'center',
    category: 'film',
    title: '花样年华',
    relatedIds: ['b1', 'b2'],
  });
  const b1 = makeItem({
    id: 'b1',
    category: 'person',
    title: '王家卫',
    relatedIds: ['center', 'deep'],
  });
  const b2 = makeItem({
    id: 'b2',
    category: 'person',
    title: '梁朝伟',
    relatedIds: ['center', 'deep'],
  });
  const deep = makeItem({
    id: 'deep',
    category: 'film',
    title: '春光乍泄',
    relatedIds: ['b1', 'b2'],
  });

  const graph = buildRelationGraph(center, [center, b1, b2, deep]);
  const deepNode = graph.nodes.find((n) => n.item.id === 'deep');
  assert.ok(deepNode);
  assert.equal(deepNode.hop, 2);
  assert.equal(deepNode.bridgeCount, 2);
  assert.equal(deepNode.strength, 2);
  assert.equal(deepNode.intensityTier, 2);

  const eStrong = getDetailEdgeVisualStyle({ kind: 'direct', strength: 3, strengthWeight: 0.9 });
  const eDirect = getDetailEdgeVisualStyle({ kind: 'direct', strength: 2, strengthWeight: 0.6 });
  const eBridge = getDetailEdgeVisualStyle({ kind: 'bridge', strength: 1, strengthWeight: 0.3 });
  assert.ok(eStrong.strokeWidth > eDirect.strokeWidth);
  assert.ok(eDirect.strokeWidth > eBridge.strokeWidth);
  assert.ok(eStrong.haloWidth > 0);

  const nStrong = getDetailNodeVisualStyle({
    item: b1,
    hop: 1,
    strength: 3,
    intensityTier: 3,
  });
  const nWeak = getDetailNodeVisualStyle({
    item: b1,
    hop: 2,
    strength: 1,
    intensityTier: 1,
  });
  assert.notEqual(nStrong.ringColor, nWeak.ringColor);
  assert.ok(nStrong.ringWidth > nWeak.ringWidth);
  assert.ok(nStrong.imageOpacity > nWeak.imageOpacity);
});
