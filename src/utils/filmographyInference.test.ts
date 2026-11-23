import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import type { OnlineRelationsResponse } from '../services/archiveApi';
import {
  buildCategoryBridgeEdges,
  computeBatchLinkItems,
  discoverMetadataFilmographyLinks,
  matchFilmographyFromCredits,
  mergeInferredFilmographyEdges,
} from './filmographyInference';

function makeItem(
  partial: Partial<ArchiveItem> & { id: string; title: string }
): ArchiveItem {
  return {
    accessionNo: 'CA-001',
    category: 'film',
    summary: '',
    notes: '',
    rating: 5,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...partial,
  };
}

test('discoverMetadataFilmographyLinks auto-connects bilingual films, people, and characters without manual relatedIds', () => {
  const items: ArchiveItem[] = [
    makeItem({
      id: 'film-inception',
      category: 'film',
      title: '盗梦空间',
      originalTitle: 'Inception',
      subtitle: '克里斯托弗·诺兰 · 科幻 / 悬疑',
      year: '2010',
    }),
    makeItem({
      id: 'person-nolan',
      category: 'person',
      title: '克里斯托弗·诺兰',
      originalTitle: 'Christopher Nolan',
      subtitle: '导演 · 编剧',
      relatedWorkTitle: '星际穿越 / 盗梦空间',
    }),
    makeItem({
      id: 'person-leo',
      category: 'person',
      title: '莱昂纳多·迪卡普里奥',
      originalTitle: 'Leonardo DiCaprio',
      subtitle: '演员',
    }),
    makeItem({
      id: 'char-cobb',
      category: 'character',
      title: '多姆·科布',
      originalTitle: 'Dom Cobb',
      relatedWorkTitle: 'Inception',
      portrayedBy: 'Leonardo DiCaprio',
    }),
  ];

  const edges = discoverMetadataFilmographyLinks(items);
  const findPair = (a: string, b: string) =>
    edges.find(
      (e) =>
        (e.sourceId === a && e.targetId === b) ||
        (e.sourceId === b && e.targetId === a)
    );

  // Film <-> Director via subtitle & relatedWorkTitle
  const nolanFilm = findPair('person-nolan', 'film-inception');
  assert.ok(nolanFilm);
  assert.equal(nolanFilm.roleType, 'directs');

  // Character <-> Film via bilingual originalTitle match (Inception <-> 盗梦空间)
  const cobbFilm = findPair('char-cobb', 'film-inception');
  assert.ok(cobbFilm);
  assert.equal(cobbFilm.roleType, 'appears_in');

  // Character <-> Person via bilingual originalTitle match (Leonardo DiCaprio)
  const cobbLeo = findPair('char-cobb', 'person-leo');
  assert.ok(cobbLeo);
  assert.equal(cobbLeo.roleType, 'portrays');

  // Transitive triad completion: Person Leo <-> Film Inception inferred via Character Cobb!
  const leoFilm = findPair('person-leo', 'film-inception');
  assert.ok(leoFilm);
  assert.equal(leoFilm.roleType, 'acts');
  assert.equal(leoFilm.roleCharacterName, '多姆·科布');

  // Transitive co-collaboration: Nolan <-> Leo share Inception
  const nolanLeo = findPair('person-nolan', 'person-leo');
  assert.ok(nolanLeo);
  assert.equal(nolanLeo.roleType, 'co_stars');
});

test('discoverMetadataFilmographyLinks detects same-creator films and same-work characters even when bridge item is absent', () => {
  const items: ArchiveItem[] = [
    makeItem({
      id: 'f1',
      category: 'film',
      title: '千与千寻',
      subtitle: '宫崎骏 · 动画 / 奇幻',
      year: '2001',
    }),
    makeItem({
      id: 'f2',
      category: 'film',
      title: '幽灵公主',
      subtitle: '宫崎骏 · 动画 / 冒险',
      year: '1997',
    }),
    makeItem({
      id: 'c1',
      category: 'character',
      title: '周慕云',
      relatedWorkTitle: '花样年华',
    }),
    makeItem({
      id: 'c2',
      category: 'character',
      title: '苏丽珍',
      relatedWorkTitle: '花样年华',
    }),
  ];

  const edges = discoverMetadataFilmographyLinks(items);
  const ghibliEdge = edges.find(
    (e) =>
      (e.sourceId === 'f1' && e.targetId === 'f2') ||
      (e.sourceId === 'f2' && e.targetId === 'f1')
  );
  assert.ok(ghibliEdge);
  assert.equal(ghibliEdge.roleType, 'same_creator');
  assert.equal(ghibliEdge.bridgeTitle, '宫崎骏');

  const charEdge = edges.find(
    (e) =>
      (e.sourceId === 'c1' && e.targetId === 'c2') ||
      (e.sourceId === 'c2' && e.targetId === 'c1')
  );
  assert.ok(charEdge);
  assert.equal(charEdge.roleType, 'co_work');
  assert.equal(charEdge.bridgeTitle, '花样年华');
});

test('matchFilmographyFromCredits resolves local credits into film-person-character relationships', () => {
  const items: ArchiveItem[] = [
    makeItem({
      id: 'f-interstellar',
      category: 'film',
      title: '星际穿越',
      originalTitle: 'Interstellar',
      sourceUrl: 'https://www.imdb.com/title/tt0816692/',
    }),
    makeItem({
      id: 'p-mcconaughey',
      category: 'person',
      title: '马修·麦康纳',
      originalTitle: 'Matthew McConaughey',
    }),
    makeItem({
      id: 'c-cooper',
      category: 'character',
      title: '库珀',
      originalTitle: 'Joseph Cooper',
    }),
  ];

  const creditsMap = new Map<string, OnlineRelationsResponse>([
    [
      'f-interstellar',
      {
        films: [],
        people: [
          {
            externalId: 'wd-person-Q188955',
            category: 'person',
            title: '马修·麦康纳',
            originalTitle: 'Matthew McConaughey',
            subtitle: '饰 Joseph Cooper',
            summary: '',
            sourceName: '维基数据 Wikidata',
            tags: ['演员'],
          },
        ],
        characters: [
          {
            externalId: 'wd-char-cooper',
            category: 'character',
            title: '库珀',
            originalTitle: 'Joseph Cooper',
            portrayedBy: '马修·麦康纳',
            subtitle: '饰演者 马修·麦康纳',
            summary: '',
            sourceName: '维基数据 Wikidata',
            tags: ['角色'],
          },
        ],
        sources: ['维基数据 Wikidata'],
      },
    ],
  ]);

  const edges = matchFilmographyFromCredits(items, creditsMap);
  assert.equal(edges.length, 3);

  const actorFilm = edges.find(
    (e) =>
      (e.sourceId === 'p-mcconaughey' && e.targetId === 'f-interstellar') ||
      (e.sourceId === 'f-interstellar' && e.targetId === 'p-mcconaughey')
  );
  assert.ok(actorFilm);
  assert.equal(actorFilm.roleCharacterName, '库珀');
  assert.equal(actorFilm.source, 'credits');

  const actorChar = edges.find(
    (e) =>
      (e.sourceId === 'p-mcconaughey' && e.targetId === 'c-cooper') ||
      (e.sourceId === 'c-cooper' && e.targetId === 'p-mcconaughey')
  );
  assert.ok(actorChar);
  assert.equal(actorChar.roleType, 'portrays');

  // Merge prefers credits over metadata for same pair
  const merged = mergeInferredFilmographyEdges(
    [
      {
        sourceId: 'p-mcconaughey',
        targetId: 'f-interstellar',
        roleType: 'acts',
        evidence: 'metadata guess',
        confidence: 'medium',
        source: 'metadata',
      },
    ],
    edges
  );
  const kept = merged.find(
    (e) =>
      (e.sourceId === 'p-mcconaughey' && e.targetId === 'f-interstellar') ||
      (e.sourceId === 'f-interstellar' && e.targetId === 'p-mcconaughey')
  );
  assert.equal(kept?.source, 'credits');
});

test('buildCategoryBridgeEdges projects 2-hop filmography bridges for single-category views', () => {
  const items: ArchiveItem[] = [
    makeItem({ id: 'f1', category: 'film', title: '花样年华' }),
    makeItem({ id: 'p1', category: 'person', title: '王家卫' }),
    makeItem({ id: 'p2', category: 'person', title: '梁朝伟' }),
  ];

  const bridges = buildCategoryBridgeEdges(items, 'person', [
    { sourceId: 'f1', targetId: 'p1' },
    { sourceId: 'f1', targetId: 'p2' },
  ]);

  assert.equal(bridges.length, 1);
  assert.equal(bridges[0].roleType, 'co_stars');
  assert.equal(bridges[0].bridgeTitle, '花样年华');
  assert.equal(bridges[0].source, 'category-bridge');
});

test('computeBatchLinkItems bidirectionally links pairs without mutating or duplicating', () => {
  const items: ArchiveItem[] = [
    makeItem({ id: 'a', title: 'A', relatedIds: [] }),
    makeItem({ id: 'b', title: 'B', relatedIds: ['a'] }),
    makeItem({ id: 'c', title: 'C', relatedIds: [] }),
  ];

  const { nextItems, linkedPairCount } = computeBatchLinkItems(
    items,
    [
      ['a', 'b'], // completes b->a to bidirectional
      ['a', 'c'],
      ['a', 'c'], // duplicate ignored
      ['a', 'missing'], // invalid ignored
    ],
    '2026-11-22T00:00:00.000Z'
  );

  assert.equal(linkedPairCount, 2);
  assert.deepEqual(nextItems.find((i) => i.id === 'a')?.relatedIds.sort(), ['b', 'c']);
  assert.deepEqual(nextItems.find((i) => i.id === 'b')?.relatedIds, ['a']);
  assert.deepEqual(nextItems.find((i) => i.id === 'c')?.relatedIds, ['a']);
  // Original array untouched
  assert.deepEqual(items[0].relatedIds, []);
});
