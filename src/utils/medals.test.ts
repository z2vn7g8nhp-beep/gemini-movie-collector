import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  computeCinemaMedals,
  computeDynamicTagMedals,
  computeItemDisplayMedals,
  detectNewOrUpgradedMedals,
  isThematicTag,
  type MedalTier,
} from './medals';

function makeItem(overrides: Partial<ArchiveItem>): ArchiveItem {
  return {
    id: overrides.id ?? 'item-1',
    accessionNo: overrides.accessionNo ?? 'CA-001',
    category: overrides.category ?? 'film',
    title: overrides.title ?? '复仇者联盟5：毁灭之日',
    summary: overrides.summary ?? '简介',
    notes: overrides.notes ?? '',
    rating: overrides.rating ?? 0,
    status: overrides.status ?? 'watched',
    tags: overrides.tags ?? [],
    relatedIds: overrides.relatedIds ?? [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

test('isThematicTag filters years and generic category tags', () => {
  assert.equal(isThematicTag('2026'), false);
  assert.equal(isThematicTag('电影'), false);
  assert.equal(isThematicTag('演员'), false);
  assert.equal(isThematicTag('角色'), false);
  assert.equal(isThematicTag('漫威'), true);
  assert.equal(isThematicTag('#赛博朋克'), true);
});

test('computeCinemaMedals unlocks type, tag, and relation triangle medals dynamically', () => {
  const film = makeItem({
    id: 'f1',
    category: 'film',
    title: '复仇者联盟5：毁灭之日',
    tags: ['电影', '漫威', '欧美', '2026'],
    relatedIds: ['p1', 'c1'],
  });
  const person = makeItem({
    id: 'p1',
    category: 'person',
    title: '小罗伯特·唐尼',
    tags: ['演员'],
    relatedIds: ['f1'],
  });
  const character = makeItem({
    id: 'c1',
    category: 'character',
    title: '末日博士',
    tags: ['角色'],
    relatedIds: ['f1'],
  });

  const medals = computeCinemaMedals([film, person, character]);
  const byId = new Map(medals.map((m) => [m.id, m]));

  assert.equal(byId.get('type-film')?.tier, 'bronze');
  assert.equal(byId.get('type-person')?.tier, 'bronze');
  assert.equal(byId.get('type-character')?.tier, 'bronze');
  assert.equal(byId.get('type-trinity')?.tier, 'gold');

  assert.equal(byId.get('tag-constellation')?.tier, 'bronze');
  assert.equal(byId.get('tag-curator')?.tier, 'bronze');
  // Thematic tag 漫威 currently only has 1 item -> locked until 2 items
  assert.equal(byId.get('tag-universe')?.unlocked, false);

  assert.equal(byId.get('rel-bond')?.tier, 'bronze');
  assert.equal(byId.get('rel-nexus')?.tier, 'silver');
  assert.equal(byId.get('rel-triangle')?.tier, 'gold');
});

test('computeDynamicTagMedals mints signature thematic tag crest at >= 2 items', () => {
  const items = [
    makeItem({ id: 'f1', tags: ['电影', '漫威', '2026'] }),
    makeItem({ id: 'c1', category: 'character', tags: ['角色', '漫威'] }),
    makeItem({ id: 'p1', category: 'person', tags: ['演员', '漫威'] }),
    makeItem({ id: 'f2', tags: ['电影', '漫威'] }),
  ];

  const dynamicMedals = computeDynamicTagMedals(items);
  assert.equal(dynamicMedals.length, 1);
  assert.equal(dynamicMedals[0].id, 'dynamic-tag-漫威');
  assert.equal(dynamicMedals[0].tagName, '漫威');
  assert.equal(dynamicMedals[0].tier, 'silver'); // 4 items -> silver
  assert.equal(dynamicMedals[0].monogram, '漫威');
});

test('computeItemDisplayMedals returns earned item-relevant medals and actionable next hint', () => {
  const film = makeItem({
    id: 'f1',
    category: 'film',
    title: '复仇者联盟5',
    coverUrl: 'https://example.com/a.jpg',
    tags: ['电影', '漫威', '欧美'],
    relatedIds: ['p1', 'c1'],
  });
  const person = makeItem({
    id: 'p1',
    category: 'person',
    title: '小罗伯特·唐尼',
    tags: ['演员'],
    relatedIds: ['f1'],
  });
  const character = makeItem({
    id: 'c1',
    category: 'character',
    title: '末日博士',
    tags: ['角色'],
    relatedIds: ['f1'],
  });

  const filmShowcase = computeItemDisplayMedals(film, [film, person, character]);
  const filmMedalIds = filmShowcase.earnedMedals.map((m) => m.id);
  assert.ok(filmMedalIds.includes('rel-triangle'));
  assert.ok(filmMedalIds.includes('rel-nexus'));
  assert.ok(filmMedalIds.includes('type-trinity'));
  assert.ok(filmMedalIds.includes('tag-curator'));
  assert.ok(filmShowcase.nextMedal?.hint.includes('漫威'));

  // Person only has 1 link and 1 tag -> does NOT get nexus or tag-curator
  const personShowcase = computeItemDisplayMedals(person, [
    film,
    person,
    character,
  ]);
  const personMedalIds = personShowcase.earnedMedals.map((m) => m.id);
  assert.equal(personMedalIds.includes('rel-nexus'), false);
  assert.equal(personMedalIds.includes('tag-curator'), false);
  assert.ok(personMedalIds.includes('rel-triangle'));
  assert.ok(personShowcase.nextMedal?.hint.includes('核心枢纽'));
});

test('detectNewOrUpgradedMedals catches both newly unlocked and tier upgrades', () => {
  const prev = new Map<string, MedalTier>([
    ['type-film', 'bronze'],
    ['tag-universe', 'locked'],
  ]);
  const items = [
    makeItem({ id: 'f1', tags: ['漫威'] }),
    makeItem({ id: 'f2', tags: ['漫威'] }),
    makeItem({ id: 'f3', tags: ['科幻'] }),
    makeItem({ id: 'f4', tags: ['悬疑'] }),
    makeItem({ id: 'f5', tags: ['剧情'] }),
  ];

  const nextMedals = computeCinemaMedals(items);
  const events = detectNewOrUpgradedMedals(prev, nextMedals);

  const filmUpgrade = events.find((e) => e.medal.id === 'type-film');
  assert.ok(filmUpgrade);
  assert.equal(filmUpgrade.kind, 'upgraded');
  assert.equal(filmUpgrade.medal.tier, 'silver');

  const tagUnlock = events.find((e) => e.medal.id === 'tag-universe');
  assert.ok(tagUnlock);
  assert.equal(tagUnlock.kind, 'unlocked');
  assert.equal(tagUnlock.medal.tier, 'bronze');

  const dynamicUnlock = events.find((e) => e.medal.id === 'dynamic-tag-漫威');
  assert.ok(dynamicUnlock);
  assert.equal(dynamicUnlock.kind, 'unlocked');
});
