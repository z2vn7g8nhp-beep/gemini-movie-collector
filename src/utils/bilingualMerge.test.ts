import test from 'node:test';
import assert from 'node:assert/strict';
import type { OnlineSearchResult } from '../types/archive';
import {
  buildImdbSingleTokenSlug,
  latinPersonNamesMatch,
  mergeBilingualResults,
} from './bilingualMerge';

test('latinPersonNamesMatch handles middle names and generational suffixes', () => {
  assert.equal(
    latinPersonNamesMatch('Robert Downey Jr.', 'Robert John Downey Jr.'),
    true
  );
  assert.equal(
    latinPersonNamesMatch('Gwyneth Paltrow', 'Gwyneth Kate Paltrow'),
    true
  );
  assert.equal(latinPersonNamesMatch('Jon Favreau', 'Jon Favreau'), true);
  assert.equal(
    latinPersonNamesMatch('Jon Favreau', 'Robert Downey Jr.'),
    false
  );
});

test('buildImdbSingleTokenSlug produces safe single-token ASCII slugs for IMDb JSONP', () => {
  assert.equal(buildImdbSingleTokenSlug('Robert Downey Jr.'), 'robertdowney');
  assert.equal(buildImdbSingleTokenSlug('Gwyneth Paltrow'), 'gwynethpaltrow');
  assert.equal(buildImdbSingleTokenSlug('Jon Favreau'), 'jonfavreau');
  assert.equal(buildImdbSingleTokenSlug('tt0371746'), 'tt0371746');
  assert.equal(buildImdbSingleTokenSlug('小罗伯特·唐尼'), null);
});

test('mergeBilingualResults eliminates Chinese/English duplicate cast entries (Iron Man regression)', () => {
  const raw: OnlineSearchResult[] = [
    {
      externalId: 'baike-person-小罗伯特·唐尼',
      category: 'person',
      title: '小罗伯特·唐尼',
      originalTitle: 'Robert John Downey Jr.',
      subtitle: '主演',
      coverUrl: 'https://bkimg.cdn.bcebos.com/pic/rdj.jpg',
      summary: '在《钢铁侠》中担任主演。',
      sourceName: '百度百科',
      tags: ['主演'],
    },
    {
      externalId: 'baike-person-格温妮丝·帕特洛',
      category: 'person',
      title: '格温妮丝·帕特洛',
      originalTitle: 'Gwyneth Paltrow',
      subtitle: '主演',
      coverUrl: 'https://bkimg.cdn.bcebos.com/pic/gp.jpg',
      summary: '在《钢铁侠》中担任主演。',
      sourceName: '百度百科',
      tags: ['主演'],
    },
    {
      externalId: 'imdb-rel-tt0371746-robertdowneyjr',
      category: 'person',
      title: 'Robert Downey Jr.',
      subtitle: '主演',
      coverUrl: 'https://m.media-amazon.com/images/rdj.jpg',
      summary: '在《钢铁侠》中担任主演（IMDb tt0371746）。',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/name/nm0000375/',
      tags: ['演员'],
    },
    {
      externalId: 'imdb-rel-tt0371746-gwynethpaltrow',
      category: 'person',
      title: 'Gwyneth Paltrow',
      subtitle: '主演',
      coverUrl: 'https://m.media-amazon.com/images/gp.jpg',
      summary: '在《钢铁侠》中担任主演（IMDb tt0371746）。',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/name/nm0000569/',
      tags: ['演员'],
    },
  ];

  const merged = mergeBilingualResults(raw);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, '小罗伯特·唐尼');
  assert.equal(merged[0].originalTitle, 'Robert Downey Jr.');
  assert.equal(merged[0].coverUrl, 'https://m.media-amazon.com/images/rdj.jpg');
  assert.equal(merged[0].sourceUrl, 'https://www.imdb.com/name/nm0000375/');

  assert.equal(merged[1].title, '格温妮丝·帕特洛');
  assert.equal(merged[1].originalTitle, 'Gwyneth Paltrow');
  assert.equal(merged[1].coverUrl, 'https://m.media-amazon.com/images/gp.jpg');
});

test('mergeBilingualResults upgrades English-first film entry to Chinese when matched', () => {
  const raw: OnlineSearchResult[] = [
    {
      externalId: 'imdb-ironman',
      category: 'film',
      title: 'Iron Man',
      year: '2008',
      subtitle: '电影',
      coverUrl: 'https://images.metahub.space/poster/medium/tt0371746/img',
      summary: 'Iron Man (2008)',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt0371746/',
      tags: ['电影'],
    },
    {
      externalId: 'baike-ironman',
      category: 'film',
      title: '钢铁侠',
      originalTitle: 'Iron Man',
      year: '2008',
      subtitle: '2008 · 导演 乔恩·费儒',
      summary: '漫威电影宇宙开篇之作《钢铁侠》。',
      sourceName: '百度百科',
      tags: ['科幻', '动作'],
    },
  ];

  const merged = mergeBilingualResults(raw);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, '钢铁侠');
  assert.equal(merged[0].originalTitle, 'Iron Man');
  assert.equal(
    merged[0].coverUrl,
    'https://images.metahub.space/poster/medium/tt0371746/img'
  );
  assert.equal(merged[0].sourceUrl, 'https://www.imdb.com/title/tt0371746/');
});

test('mergeBilingualResults merges Chinese transliteration variants via aliasMap', () => {
  const raw: OnlineSearchResult[] = [
    {
      externalId: 'baike-1',
      category: 'person',
      title: '格温妮丝·帕特洛',
      subtitle: '主演',
      summary: '主演',
      sourceName: '百度百科',
      tags: ['主演'],
    },
    {
      externalId: 'baike-2',
      category: 'person',
      title: '格温妮斯·帕特洛',
      subtitle: '演员',
      coverUrl: 'https://bkimg.cdn.bcebos.com/pic/gp.jpg',
      summary: '美国女演员',
      sourceName: '百度百科',
      tags: ['演员'],
    },
  ];
  const aliasMap = new Map<string, string[]>([
    ['baike-1', ['Gwyneth Paltrow', '格温妮斯·帕特洛']],
    ['baike-2', ['Gwyneth Paltrow']],
  ]);

  const merged = mergeBilingualResults(raw, { aliasMap });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].coverUrl, 'https://bkimg.cdn.bcebos.com/pic/gp.jpg');
});

test('mergeBilingualResults never collapses distinct characters sharing the same movie sourceUrl or universe suffix', () => {
  const raw: OnlineSearchResult[] = [
    {
      externalId: 'douban-char-1',
      category: 'character',
      title: '佩珀·波兹',
      subtitle: '饰 佩珀·波兹 · 格温妮丝·帕特洛',
      summary: '钢铁侠角色',
      portrayedBy: '格温妮丝·帕特洛',
      relatedWorkTitle: '钢铁侠',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/1432146/',
      tags: ['角色'],
    },
    {
      externalId: 'douban-char-2',
      category: 'character',
      title: '托尼·斯塔克 / 钢铁侠（地球199999）',
      subtitle: '饰 托尼·斯塔克 · 小罗伯特·唐尼',
      summary: '钢铁侠主角',
      portrayedBy: '小罗伯特·唐尼',
      relatedWorkTitle: '钢铁侠',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/1432146/',
      tags: ['角色'],
    },
    {
      externalId: 'bgm-char-3',
      category: 'character',
      title: '詹姆斯·罗德斯 / 战争机器（地球199999）',
      subtitle: '配角 · 钢铁侠',
      summary: '战争机器',
      relatedWorkTitle: '钢铁侠',
      sourceName: '番组计划 Bangumi',
      sourceUrl: 'https://bgm.tv/character/75114',
      tags: ['角色'],
    },
  ];

  const merged = mergeBilingualResults(raw);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].title, '佩珀·波兹');
  assert.equal(merged[1].title, '托尼·斯塔克 / 钢铁侠（地球199999）');
  assert.equal(merged[2].title, '詹姆斯·罗德斯 / 战争机器（地球199999）');
});

