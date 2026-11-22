import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  buildGlobalRelationGraph,
  describeRelationBetween,
  getFocusedNodeConnections,
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
