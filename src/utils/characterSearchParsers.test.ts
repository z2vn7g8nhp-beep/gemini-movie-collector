import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBaiduBaikeCard } from './chinaSearchParsers';
import {
  cleanBangumiCharacterName,
  isPlausibleCharacterBaikeBundle,
  parseBangumiCharacterSearch,
  parseBangumiSubjectCharacters,
  parseTvmazeShowCharacters,
  pickPreferredCharacterActor,
  rankCharacterResults,
} from './characterSearchParsers';

test('cleanBangumiCharacterName strips Earth-199999 / MCU suffixes cleanly', () => {
  assert.equal(
    cleanBangumiCharacterName('Anthony Stark / Iron Man (Earth-199999)'),
    'Anthony Stark / Iron Man'
  );
  assert.equal(
    cleanBangumiCharacterName('James Rhodes / War Machine (MCU)'),
    'James Rhodes / War Machine'
  );
});

test('pickPreferredCharacterActor prefers live-action Western actor over Japanese dub VA', () => {
  const actor = pickPreferredCharacterActor(
    [{ name: '藤原啓治' }, { name: 'Robert Downey Jr.' }],
    true
  );
  assert.equal(actor, 'Robert Downey Jr.');

  const animeVa = pickPreferredCharacterActor(
    [{ name: '花澤香菜' }, { name: 'Kana Hanazawa' }],
    false
  );
  assert.equal(animeVa, '花澤香菜');
});

test('parseBangumiCharacterSearch rejects partial-token false positives like Chopper for Tony Stark', () => {
  const payload = {
    data: [
      {
        id: 2371,
        name: 'トニートニー・チョッパー',
        images: { large: 'https://lain.bgm.tv/pic/crt/l/51/d7/2371.jpg' },
        infobox: [
          { key: '简体中文名', value: '托尼托尼·乔巴' },
          { key: '别名', value: [{ k: '罗马字', v: 'Tony Tony Chopper' }] },
        ],
        summary: '海贼王角色',
      },
      {
        id: 193350,
        name: 'Anthony Stark / Iron Man (Earth-199999)',
        images: { large: 'https://lain.bgm.tv/pic/crt/l/33/23/193350.jpg' },
        infobox: [
          { key: '简体中文名', value: '托尼·斯塔克' },
          { key: '别名', value: [{ k: '外号', v: '钢铁侠' }] },
        ],
        summary: '斯塔克工业CEO',
      },
    ],
  };

  const results = parseBangumiCharacterSearch(payload, '托尼·斯塔克');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, '托尼·斯塔克');
  assert.equal(results[0].originalTitle, 'Anthony Stark / Iron Man');
  assert.equal(results[0].coverUrl, 'https://lain.bgm.tv/pic/crt/l/33/23/193350.jpg');
});

test('parseBangumiSubjectCharacters parses live-action film characters with actors and portraits', () => {
  const rows = [
    {
      id: 193350,
      name: 'Anthony Stark / Iron Man (Earth-199999)',
      relation: '主角',
      actors: [{ name: '藤原啓治' }, { name: 'Robert Downey Jr.' }],
      images: { medium: 'https://lain.bgm.tv/r/400/pic/crt/l/33/23/193350.jpg' },
    },
    {
      id: 184373,
      name: 'Pepper Potts',
      relation: '配角',
      actors: [{ name: '岡寛恵' }, { name: 'Gwyneth Paltrow' }],
      images: { medium: 'https://lain.bgm.tv/r/400/pic/crt/l/58/30/184373.jpg' },
    },
  ];

  const chars = parseBangumiSubjectCharacters(rows, '钢铁侠', {
    workYear: '2008',
    isLiveAction: true,
  });
  assert.equal(chars.length, 2);
  assert.equal(chars[0].title, 'Anthony Stark / Iron Man');
  assert.equal(chars[0].portrayedBy, 'Robert Downey Jr.');
  assert.equal(chars[0].relatedWorkTitle, '钢铁侠');
  assert.equal(chars[1].portrayedBy, 'Gwyneth Paltrow');
});

test('isPlausibleCharacterBaikeBundle accepts character cards and rejects pure movie cards', () => {
  const charBundle = parseBaiduBaikeCard(
    {
      id: 1477134,
      title: '钢铁侠',
      desc: '美国漫威漫画旗下超级英雄',
      image: 'https://bkimg.cdn.bcebos.com/pic/ironman.jpg',
      abstract: '托尼·斯塔克是斯塔克工业董事长。',
      card: [
        { name: '中文名', value: ['安东尼·爱德华·“托尼”·史塔克'] },
        { name: '外文名', value: ['Tony Stark'] },
        { name: '饰演', value: ['小罗伯特·唐尼'] },
        { name: '登场作品', value: ['《钢铁侠》《复仇者联盟》'] },
      ],
    },
    'character'
  );
  assert.equal(isPlausibleCharacterBaikeBundle(charBundle, '托尼·斯塔克'), true);

  const pureFilmBundle = parseBaiduBaikeCard(
    {
      id: 999,
      title: '钢铁侠',
      desc: '美国2008年乔恩·费儒执导的动作科幻电影',
      abstract: '《钢铁侠》是由乔恩·费儒执导的美国科幻电影。',
      card: [
        { name: '导演', value: ['乔恩·费儒'] },
        { name: '主演', value: ['小罗伯特·唐尼'] },
      ],
    },
    'character'
  );
  assert.equal(isPlausibleCharacterBaikeBundle(pureFilmBundle, '钢铁侠'), false);
});

test('parseTvmazeShowCharacters extracts TV characters with portraits and actors', () => {
  const chars = parseTvmazeShowCharacters(
    { name: 'Breaking Bad', premiered: '2008-01-20', url: 'https://www.tvmaze.com/shows/169' },
    [
      {
        person: { name: 'Bryan Cranston' },
        character: {
          id: 1,
          name: 'Walter White',
          image: { medium: 'https://static.tvmaze.com/walter.jpg' },
          url: 'https://www.tvmaze.com/characters/1',
        },
      },
    ]
  );
  assert.equal(chars.length, 1);
  assert.equal(chars[0].title, 'Walter White');
  assert.equal(chars[0].portrayedBy, 'Bryan Cranston');
  assert.equal(chars[0].relatedWorkTitle, 'Breaking Bad');
});

test('rankCharacterResults prioritizes exact Chinese hits with portraits and metadata', () => {
  const ranked = rankCharacterResults(
    [
      {
        externalId: '1',
        category: 'character',
        title: 'Tony Stark',
        summary: 'Iron Man',
        sourceName: 'IMDb',
        tags: ['角色'],
      },
      {
        externalId: '2',
        category: 'character',
        title: '托尼·斯塔克',
        originalTitle: 'Tony Stark',
        coverUrl: 'https://bkimg.cdn.bcebos.com/pic/tony.jpg',
        relatedWorkTitle: '钢铁侠',
        portrayedBy: '小罗伯特·唐尼',
        summary: '漫威角色',
        sourceName: '百度百科',
        tags: ['角色'],
      },
    ],
    '托尼·斯塔克'
  );
  assert.equal(ranked[0].externalId, '2');
});
