import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  buildGlobalRelationGraph,
  describeRelationBetween,
  getEdgeVisualStyle,
  getFocusedNodeConnections,
  getNodeVisualStyle,
} from './globalGraph';

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

test('getFocusedNodeConnections highlights direct neighbors separately from tag neighbors with readable explanations', () => {
  const items: ArchiveItem[] = [
    makeItem({
      id: 'film-mfl',
      accessionNo: 'CA-001',
      category: 'film',
      title: '花样年华',
      subtitle: '王家卫 · 剧情 / 爱情',
      year: '2000',
      region: '中国香港',
      relatedIds: ['person-wkw', 'person-tony', 'char-chow'],
      tags: ['港片美学'],
    }),
    makeItem({
      id: 'person-wkw',
      accessionNo: 'CA-002',
      category: 'person',
      title: '王家卫',
      subtitle: '导演 · 编剧',
      relatedIds: ['film-mfl', 'person-tony'],
      tags: ['港片美学'],
    }),
    makeItem({
      id: 'person-tony',
      accessionNo: 'CA-003',
      category: 'person',
      title: '梁朝伟',
      subtitle: '演员 · 戛纳影帝',
      relatedIds: ['film-mfl', 'person-wkw', 'char-chow'],
      tags: ['眼神杀'],
    }),
    makeItem({
      id: 'char-chow',
      accessionNo: 'CA-004',
      category: 'character',
      title: '周慕云',
      subtitle: '报社编辑',
      relatedWorkTitle: '花样年华',
      portrayedBy: '梁朝伟',
      relatedIds: ['film-mfl', 'person-tony'],
      tags: ['克制深情'],
    }),
    makeItem({
      id: 'film-tag-only',
      accessionNo: 'CA-005',
      category: 'film',
      title: '重庆森林',
      year: '1994',
      relatedIds: [],
      tags: ['港片美学'],
    }),
  ];

  const graph = buildGlobalRelationGraph(items, { includeTagEdges: true });

  // Focus on film-mfl: 3 explicit direct neighbors + 1 tag-only neighbor
  const filmCtx = getFocusedNodeConnections(graph, 'film-mfl', items);
  assert.ok(filmCtx);
  assert.equal(filmCtx.directRelations.length, 3);
  assert.deepEqual(
    Array.from(filmCtx.directNeighborIds).sort(),
    ['char-chow', 'person-tony', 'person-wkw']
  );
  assert.equal(filmCtx.tagRelations.length, 1);
  assert.ok(filmCtx.tagNeighborIds.has('film-tag-only'));
  assert.ok(!filmCtx.directNeighborIds.has('film-tag-only'));

  const wkwRel = filmCtx.directRelations.find((r) => r.node.id === 'person-wkw');
  assert.equal(wkwRel?.shortLabel, '导演');
  assert.match(wkwRel?.description || '', /执导本片/);

  const tonyRel = filmCtx.directRelations.find((r) => r.node.id === 'person-tony');
  assert.equal(tonyRel?.shortLabel, '主演');
  assert.match(tonyRel?.description || '', /周慕云/);

  const chowRel = filmCtx.directRelations.find((r) => r.node.id === 'char-chow');
  assert.equal(chowRel?.shortLabel, '角色');
  assert.match(chowRel?.description || '', /梁朝伟饰演/);

  // Focus on char-chow: directional descriptions flip cleanly
  const charCtx = getFocusedNodeConnections(graph, 'char-chow', items);
  assert.ok(charCtx);
  const toFilm = charCtx.directRelations.find((r) => r.node.id === 'film-mfl');
  assert.equal(toFilm?.shortLabel, '出处');
  assert.match(toFilm?.description || '', /《花样年华》/);

  const toActor = charCtx.directRelations.find((r) => r.node.id === 'person-tony');
  assert.equal(toActor?.shortLabel, '饰演者');
  assert.match(toActor?.description || '', /由梁朝伟饰演/);

  // Focus on person-tony: collaboration with person-wkw detects shared film
  const tonyCtx = getFocusedNodeConnections(graph, 'person-tony', items);
  assert.ok(tonyCtx);
  const collab = tonyCtx.directRelations.find((r) => r.node.id === 'person-wkw');
  assert.equal(collab?.shortLabel, '合作');
  assert.match(collab?.description || '', /《花样年华》/);

  // Tag-only node has 0 direct relations and 1+ tag relations
  const tagOnlyCtx = getFocusedNodeConnections(graph, 'film-tag-only', items);
  assert.ok(tagOnlyCtx);
  assert.equal(tagOnlyCtx.directRelations.length, 0);
  assert.ok(tagOnlyCtx.tagRelations.length >= 1);
  assert.match(tagOnlyCtx.tagRelations[0].description, /港片美学/);
});

test('describeRelationBetween handles voice actor phrasing and null focus gracefully', () => {
  const film = makeItem({
    id: 'f-sa',
    category: 'film',
    title: '千与千寻',
    year: '2001',
    relatedIds: ['c-nf'],
  });
  const noFace = makeItem({
    id: 'c-nf',
    category: 'character',
    title: '无脸男',
    relatedWorkTitle: '千与千寻',
    portrayedBy: '中村彰男（配音）',
    relatedIds: ['f-sa'],
  });

  const info = describeRelationBetween(film, noFace, [film, noFace], 'explicit');
  assert.equal(info.shortLabel, '角色');
  assert.equal(info.description, '片中角色 · 由中村彰男（配音）');

  const graph = buildGlobalRelationGraph([film, noFace]);
  assert.equal(getFocusedNodeConnections(graph, null, [film, noFace]), null);
  assert.equal(getFocusedNodeConnections(graph, 'nonexistent', [film, noFace]), null);
});

test('buildGlobalRelationGraph computes distinct edge strength tiers and node intensity tiers', () => {
  const items: ArchiveItem[] = [
    // Strong triangle cluster: f1 <-> p1 shares 2 mutual neighbors (p2, c1) -> strength 3
    makeItem({
      id: 'f1',
      accessionNo: 'CA-001',
      category: 'film',
      title: '花样年华',
      relatedIds: ['p1', 'p2', 'c1'],
      tags: ['港片美学', '王家卫宇宙'],
    }),
    makeItem({
      id: 'p1',
      accessionNo: 'CA-002',
      category: 'person',
      title: '梁朝伟',
      relatedIds: ['f1', 'p2', 'c1'],
      tags: ['港片美学'],
    }),
    makeItem({
      id: 'p2',
      accessionNo: 'CA-003',
      category: 'person',
      title: '王家卫',
      relatedIds: ['f1', 'p1', 'f2'],
      tags: ['王家卫宇宙'],
    }),
    makeItem({
      id: 'c1',
      accessionNo: 'CA-004',
      category: 'character',
      title: '周慕云',
      relatedIds: ['f1', 'p1'],
      tags: ['克制深情'],
    }),
    // 2-hop from f1 via p2, simple 1-to-1 explicit tie (0 mutual, 0 shared tags) -> strength 1
    makeItem({
      id: 'f2',
      accessionNo: 'CA-005',
      category: 'film',
      title: '重庆森林',
      relatedIds: ['p2'],
      tags: ['都市孤独'],
    }),
    // Tag-only multi-tag node sharing 2 thematic tags with f1
    makeItem({
      id: 'f3',
      accessionNo: 'CA-006',
      category: 'film',
      title: '阿飞正传',
      relatedIds: [],
      tags: ['港片美学', '王家卫宇宙'],
    }),
    // Purely isolated node
    makeItem({
      id: 'f4',
      accessionNo: 'CA-007',
      category: 'film',
      title: '孤立条目',
      relatedIds: [],
      tags: ['默片'],
    }),
  ];

  const graph = buildGlobalRelationGraph(items, { includeTagEdges: true });

  const strongEdge = graph.edges.find(
    (e) =>
      e.kind === 'explicit' &&
      ((e.sourceId === 'f1' && e.targetId === 'p1') ||
        (e.sourceId === 'p1' && e.targetId === 'f1'))
  );
  const mediumEdge = graph.edges.find(
    (e) =>
      e.kind === 'explicit' &&
      ((e.sourceId === 'f1' && e.targetId === 'c1') ||
        (e.sourceId === 'c1' && e.targetId === 'f1'))
  );
  const lightEdge = graph.edges.find(
    (e) =>
      e.kind === 'explicit' &&
      ((e.sourceId === 'p2' && e.targetId === 'f2') ||
        (e.sourceId === 'f2' && e.targetId === 'p2'))
  );
  const multiTagEdge = graph.edges.find(
    (e) =>
      e.kind === 'tag' &&
      ((e.sourceId === 'f1' && e.targetId === 'f3') ||
        (e.sourceId === 'f3' && e.targetId === 'f1'))
  );

  assert.ok(strongEdge && mediumEdge && lightEdge && multiTagEdge);
  assert.equal(strongEdge.strength, 3);
  assert.equal(strongEdge.mutualCount, 2);
  assert.equal(mediumEdge.strength, 2);
  assert.equal(mediumEdge.mutualCount, 1);
  assert.equal(lightEdge.strength, 1);
  assert.equal(lightEdge.mutualCount, 0);
  assert.equal(multiTagEdge.strength, 2);
  assert.equal(multiTagEdge.sharedTagCount, 2);

  // Node intensity tiers differentiate core hub vs peripheral vs isolated
  const hubNode = graph.nodes.find((n) => n.id === 'f1')!;
  const peripheralNode = graph.nodes.find((n) => n.id === 'f2')!;
  const isolatedNode = graph.nodes.find((n) => n.id === 'f4')!;
  assert.equal(hubNode.intensityTier, 3);
  assert.equal(peripheralNode.intensityTier, 1);
  assert.equal(isolatedNode.intensityTier, 0);
  assert.equal(isolatedNode.intensity, 0);
  assert.ok(hubNode.weightedDegree > peripheralNode.weightedDegree);

  // Focus context discovers 2-hop neighbor (f2 via p2) and orders strongest direct relation first
  const ctx = getFocusedNodeConnections(graph, 'f1', items)!;
  assert.equal(ctx.directRelations[0]?.node.id, 'p1');
  assert.equal(ctx.directRelations[0]?.strength, 3);
  assert.ok(ctx.secondHopNeighborIds.has('f2'));
  assert.equal(ctx.depthByNodeId.get('f1'), 0);
  assert.equal(ctx.depthByNodeId.get('p2'), 1);
  assert.equal(ctx.depthByNodeId.get('f2'), 2);
  assert.ok(ctx.secondHopEdgeIds.has(lightEdge.id));
});

test('getEdgeVisualStyle and getNodeVisualStyle scale thickness and color depth monotonically', () => {
  const s3 = getEdgeVisualStyle({ kind: 'explicit', strength: 3, strengthWeight: 1 }, 'idle');
  const s2 = getEdgeVisualStyle({ kind: 'explicit', strength: 2, strengthWeight: 0.6 }, 'idle');
  const s1 = getEdgeVisualStyle({ kind: 'explicit', strength: 1, strengthWeight: 0.3 }, 'idle');
  const tag1 = getEdgeVisualStyle({ kind: 'tag', strength: 1, strengthWeight: 0.15 }, 'idle');

  assert.ok(s3.strokeWidth > s2.strokeWidth);
  assert.ok(s2.strokeWidth > s1.strokeWidth);
  assert.ok(s1.strokeWidth > tag1.strokeWidth);
  assert.ok(s3.strokeOpacity > s2.strokeOpacity);
  assert.ok(s2.strokeOpacity > s1.strokeOpacity);
  assert.ok(s3.haloWidth > 0);

  const h3 = getEdgeVisualStyle({ kind: 'explicit', strength: 3, strengthWeight: 1 }, 'highlighted');
  const h1 = getEdgeVisualStyle({ kind: 'explicit', strength: 1, strengthWeight: 0.3 }, 'highlighted');
  assert.ok(h3.strokeWidth > h1.strokeWidth);
  assert.ok(h3.haloWidth > h1.haloWidth);

  for (const cat of ['film', 'person', 'character'] as const) {
    const t0 = getNodeVisualStyle(cat, 0, 'idle');
    const t1 = getNodeVisualStyle(cat, 1, 'idle');
    const t2 = getNodeVisualStyle(cat, 2, 'idle');
    const t3 = getNodeVisualStyle(cat, 3, 'idle');
    // Every intensity tier has a distinct fill color depth
    const fills = new Set([t0.fill, t1.fill, t2.fill, t3.fill]);
    assert.equal(fills.size, 4);
    assert.ok(t3.strokeWidth > t1.strokeWidth);
    assert.ok(t3.auraOpacity > 0);
    assert.equal(t0.auraOpacity, 0);
  }
});
