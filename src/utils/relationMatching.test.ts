import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRelevantFilmCrewRole,
  matchBangumiCharacterCandidate,
  matchBangumiSubjectCandidate,
  matchFilmRelationCandidate,
} from './relationMatching';

test('matchBangumiSubjectCandidate rejects unrelated anime when Bangumi lacks a 2026 live-action film', () => {
  const bgmFuzzyNoise = [
    {
      id: 2306,
      type: 2,
      name: '吸血鬼ハンターD',
      name_cn: '吸血鬼猎人D',
      date: '2000-08-25',
    },
    {
      id: 1122,
      type: 2,
      name: 'バイオハザード: ディジェネレーション',
      name_cn: '生化危机：恶化',
      date: '2008-10-18',
    },
  ];

  // Must NOT blindly fall back to data[0] (吸血鬼猎人D / 生化危机：恶化)
  const hit = matchBangumiSubjectCandidate(bgmFuzzyNoise, {
    title: '生化危机：爆发夜',
    originalTitle: 'Resident Evil',
    year: '2026',
  });
  assert.equal(hit, null);
});

test('matchBangumiSubjectCandidate rejects same-title older anime/film when year differs by >2 years', () => {
  const candidates = [
    {
      id: 9001,
      type: 6,
      name: 'Resident Evil',
      name_cn: '生化危机',
      date: '2002-03-15',
    },
    {
      id: 9002,
      type: 2,
      name: 'Resident Evil',
      name_cn: '生化危机动画版',
      date: '2000-01-01',
    },
  ];

  const wrongYear = matchBangumiSubjectCandidate(candidates, {
    title: '生化危机：爆发夜',
    originalTitle: 'Resident Evil',
    year: '2026',
  });
  assert.equal(wrongYear, null);

  // Exact match for 2002 Resident Evil still succeeds
  const rightYear = matchBangumiSubjectCandidate(candidates, {
    title: '生化危机',
    originalTitle: 'Resident Evil',
    year: '2002',
  });
  assert.equal(rightYear, 9001);
});

test('matchBangumiSubjectCandidate matches genuine anime when title and year align', () => {
  const candidates = [
    {
      id: 311,
      type: 2,
      name: '千と千尋の神隠し',
      name_cn: '千与千寻',
      date: '2001-07-20',
    },
  ];

  assert.equal(
    matchBangumiSubjectCandidate(candidates, {
      title: '千与千寻',
      originalTitle: 'Spirited Away',
      year: '2001',
    }),
    311
  );
});

test('matchBangumiCharacterCandidate requires strict title/alias match', () => {
  const candidates = [
    { id: 100, name: 'Totally Unrelated Character' },
    {
      id: 200,
      name: 'Tony Stark',
      infobox: [{ key: '简体中文名', value: '托尼·斯塔克' }],
    },
  ];

  assert.equal(
    matchBangumiCharacterCandidate(candidates, {
      title: '无脸男',
    }),
    null
  );
  assert.equal(
    matchBangumiCharacterCandidate(candidates, {
      title: '托尼·斯塔克',
      originalTitle: 'Tony Stark',
    }),
    200
  );
});

test('matchFilmRelationCandidate matches exact title + compatible year and rejects mismatches', () => {
  const list = [
    { title: '生化危机', originalTitle: 'Resident Evil', year: '2002' },
    { title: '生化危机：爆发夜', originalTitle: 'Resident Evil', year: '2026' },
  ];

  const hit2026 = matchFilmRelationCandidate(list, {
    title: '生化危机：爆发夜',
    originalTitle: 'Resident Evil',
    year: '2026',
  });
  assert.equal(hit2026?.year, '2026');

  const noMatch = matchFilmRelationCandidate(
    [{ title: '生化危机', originalTitle: 'Resident Evil', year: '2002' }],
    {
      title: '生化危机：爆发夜',
      originalTitle: 'Resident Evil',
      year: '2026',
    }
  );
  assert.equal(noMatch, null);
});

test('isRelevantFilmCrewRole filters out anime key-animation/technical staff while keeping core talent', () => {
  assert.equal(isRelevantFilmCrewRole('原画'), false);
  assert.equal(isRelevantFilmCrewRole('作画监督'), false);
  assert.equal(isRelevantFilmCrewRole('美术监督'), false);
  assert.equal(isRelevantFilmCrewRole('摄影监督'), false);
  assert.equal(isRelevantFilmCrewRole('第二原画'), false);

  assert.equal(isRelevantFilmCrewRole('导演'), true);
  assert.equal(isRelevantFilmCrewRole('主演'), true);
  assert.equal(isRelevantFilmCrewRole('编剧'), true);
  assert.equal(isRelevantFilmCrewRole('音乐'), true);
  assert.equal(isRelevantFilmCrewRole('演员'), true);
});
