import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  entityNamesMatch,
  extractEntityNames,
  findDraftLinkRecommendations,
  findRecommendedUnlinkedItems,
} from './smartLink';

function makeItem(
  partial: Partial<ArchiveItem> &
    Pick<ArchiveItem, 'id' | 'title' | 'category'>
): ArchiveItem {
  return {
    accessionNo: 'CA-001',
    summary: '',
    notes: '',
    rating: 0,
    status: 'watched',
    tags: [],
    relatedIds: [],
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...partial,
  };
}

test('extractEntityNames handles colon subtitles, slash aliases, and book brackets', () => {
  const workNames = extractEntityNames('《复仇者联盟5：毁灭之日》');
  assert.ok(workNames.includes('复仇者联盟5：毁灭之日'));
  assert.ok(workNames.includes('复仇者联盟5'));

  const charNames = extractEntityNames('维克多·冯·杜姆／末日博士');
  assert.ok(charNames.includes('维克多·冯·杜姆'));
  assert.ok(charNames.includes('末日博士'));

  assert.equal(entityNamesMatch('复仇者联盟5', '复仇者联盟5：毁灭之日'), true);
  assert.equal(entityNamesMatch('Robert Downey Jr.', 'robert downey jr'), true);
  assert.equal(entityNamesMatch('A', 'Avengers'), false);
});

test('findRecommendedUnlinkedItems matches by work title, actor name, and co-work ecosystem', () => {
  const film = makeItem({
    id: 'film-avengers5',
    category: 'film',
    title: '复仇者联盟5：毁灭之日',
    relatedIds: ['person-rdj', 'char-doom'],
  });
  const rdj = makeItem({
    id: 'person-rdj',
    category: 'person',
    title: '小罗伯特·唐尼',
    originalTitle: 'Robert Downey Jr.',
    relatedIds: ['film-avengers5'],
  });
  const doom = makeItem({
    id: 'char-doom',
    category: 'character',
    title: '维克多·冯·杜姆／末日博士',
    relatedWorkTitle: '复仇者联盟5：毁灭之日',
    relatedIds: ['film-avengers5'],
  });
  const unrelated = makeItem({
    id: 'film-totoro',
    category: 'film',
    title: '龙猫',
  });

  // Newly collected character mentioning work & actor
  const ironMan = makeItem({
    id: 'char-ironman',
    category: 'character',
    title: '托尼·斯塔克／钢铁侠',
    relatedWorkTitle: '复仇者联盟5',
    portrayedBy: '小罗伯特·唐尼',
    relatedIds: [],
  });

  const recs = findRecommendedUnlinkedItems(ironMan, [
    ironMan,
    film,
    rdj,
    doom,
    unrelated,
  ]);
  const ids = recs.map((r) => r.item.id);

  assert.deepEqual(ids, ['film-avengers5', 'person-rdj', 'char-doom']);
  assert.equal(recs[0].kind, 'work_title');
  assert.equal(recs[1].kind, 'actor_name');
  assert.equal(recs[2].kind, 'shared_work');
  assert.ok(!ids.includes('film-totoro'));
});

test('findRecommendedUnlinkedItems excludes already explicitly linked items and supports co-work discovery', () => {
  const film = makeItem({
    id: 'film-avengers5',
    category: 'film',
    title: '复仇者联盟5：毁灭之日',
    relatedIds: ['person-rdj', 'char-doom'],
  });
  const rdj = makeItem({
    id: 'person-rdj',
    category: 'person',
    title: '小罗伯特·唐尼',
    relatedIds: ['film-avengers5'],
  });
  const doom = makeItem({
    id: 'char-doom',
    category: 'character',
    title: '维克多·冯·杜姆／末日博士',
    relatedIds: ['film-avengers5'],
  });

  // Doom is already linked to film-avengers5, NOT yet linked to rdj
  const recs = findRecommendedUnlinkedItems(doom, [film, rdj, doom]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].item.id, 'person-rdj');
  assert.equal(recs[0].kind, 'shared_work');
  assert.match(recs[0].reason, /复仇者联盟5：毁灭之日/);
});

test('findDraftLinkRecommendations finds live matches while typing work or actor name', () => {
  const rdj = makeItem({
    id: 'person-rdj',
    category: 'person',
    title: '小罗伯特·唐尼',
  });
  const recs = findDraftLinkRecommendations(
    {
      title: '夏洛克·福尔摩斯',
      category: 'character',
      portrayedBy: '小罗伯特·唐尼',
      relatedIds: [],
    },
    [rdj]
  );

  assert.equal(recs.length, 1);
  assert.equal(recs[0].item.id, 'person-rdj');
  assert.equal(recs[0].kind, 'actor_name');
});
