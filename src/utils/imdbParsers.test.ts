import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImdbCoverCandidates,
  extractBaiduSuggestZhAlias,
  isPlausibleBaikeFilmOrPerson,
  mergeImdbWithDoubanAssist,
  normalizeImdbImageUrl,
  parseCinemetaMeta,
  parseCinemetaSearchPayload,
  parseImdbSuggestPayload,
  parseImdbUrlOrId,
  translateImdbCountry,
  translateImdbGenre,
} from './imdbParsers';
import type { OnlineSearchResult } from '../types/archive';

test('parseImdbUrlOrId recognizes full IMDb URLs, bare IDs, and shorthand', () => {
  assert.deepEqual(parseImdbUrlOrId('https://www.imdb.com/title/tt0118694/'), {
    kind: 'title',
    id: 'tt0118694',
  });
  assert.deepEqual(parseImdbUrlOrId('https://m.imdb.com/name/NM0504897/?ref_=nv'), {
    kind: 'name',
    id: 'nm0504897',
  });
  assert.deepEqual(parseImdbUrlOrId('tt1375666'), {
    kind: 'title',
    id: 'tt1375666',
  });
  assert.deepEqual(parseImdbUrlOrId('imdb:nm0000375'), {
    kind: 'name',
    id: 'nm0000375',
  });
  assert.equal(parseImdbUrlOrId('花样年华'), null);
});

test('normalizeImdbImageUrl upgrades metahub posters and resizes m.media-amazon images', () => {
  assert.equal(
    normalizeImdbImageUrl('https://images.metahub.space/poster/small/tt0118694/img'),
    'https://images.metahub.space/poster/medium/tt0118694/img'
  );
  assert.equal(
    normalizeImdbImageUrl(
      'https://m.media-amazon.com/images/M/MV5BMjAxMzY3._V1_.jpg',
      'poster'
    ),
    'https://m.media-amazon.com/images/M/MV5BMjAxMzY3._V1_UX600_.jpg'
  );
  assert.equal(
    normalizeImdbImageUrl(
      'https://m.media-amazon.com/images/M/MV5BMjAxMzY3._V1_.jpg',
      'background'
    ),
    'https://m.media-amazon.com/images/M/MV5BMjAxMzY3._V1_UX960_.jpg'
  );
});

test('translateImdbGenre and translateImdbCountry localize genres and regions', () => {
  assert.equal(translateImdbGenre('Sci-Fi'), '科幻');
  assert.equal(translateImdbGenre('Drama'), '剧情');
  assert.equal(translateImdbCountry('Hong Kong, France'), '中国香港 / 法国');
  assert.equal(translateImdbCountry('United Kingdom, United States'), '英国 / 美国');
});

test('parseCinemetaMeta extracts IMDb rating, awards, cast, director, and translated metadata', () => {
  const parsed = parseCinemetaMeta({
    meta: {
      imdb_id: 'tt1375666',
      type: 'movie',
      name: 'Inception',
      year: '2010',
      imdbRating: '8.8',
      awards: 'Won 4 Oscars. 160 wins & 220 nominations total',
      director: ['Christopher Nolan'],
      writer: ['Christopher Nolan'],
      cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt'],
      genre: ['Adventure', 'Sci-Fi', 'Thriller'],
      country: 'United Kingdom, United States',
      description: 'A thief who steals corporate secrets through dream-sharing.',
      poster: 'https://images.metahub.space/poster/small/tt1375666/img',
      background: 'https://images.metahub.space/background/medium/tt1375666/img',
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.imdbId, 'tt1375666');
  assert.equal(parsed.result.title, 'Inception');
  assert.equal(parsed.result.year, '2010');
  assert.equal(parsed.result.region, '英国 / 美国');
  assert.match(parsed.result.subtitle || '', /IMDb 8\.8/);
  assert.match(parsed.result.subtitle || '', /导演 Christopher Nolan/);
  assert.equal(
    parsed.result.coverUrl,
    'https://images.metahub.space/poster/medium/tt1375666/img'
  );
  assert.deepEqual(parsed.result.tags, ['冒险', '科幻', '惊悚']);
  assert.match(parsed.result.summary, /Won 4 Oscars/);
  assert.deepEqual(parsed.directors, ['Christopher Nolan']);
  assert.deepEqual(parsed.cast, ['Leonardo DiCaprio', 'Joseph Gordon-Levitt']);
});

test('parseCinemetaSearchPayload parses movie and series search hits', () => {
  const hits = parseCinemetaSearchPayload(
    {
      metas: [
        {
          id: 'tt0903747',
          imdb_id: 'tt0903747',
          type: 'series',
          name: 'Breaking Bad',
          releaseInfo: '2008',
          poster: 'https://images.metahub.space/poster/small/tt0903747/img',
        },
      ],
    },
    'series'
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].mediaType, 'series');
  assert.equal(hits[0].result.sourceUrl, 'https://www.imdb.com/title/tt0903747/');
  assert.equal(hits[0].result.year, '2008');
});

test('parseImdbSuggestPayload handles both v3 object images and JSONP array images for titles & names', () => {
  const parsed = parseImdbSuggestPayload({
    d: [
      {
        id: 'tt0118694',
        l: 'In the Mood for Love',
        qid: 'movie',
        y: 2000,
        s: 'Maggie Cheung, Tony Leung Chiu-wai',
        i: {
          imageUrl: 'https://m.media-amazon.com/images/M/MV5BN2Q4._V1_.jpg',
        },
      },
      {
        id: 'nm0504897',
        l: 'Tony Leung Chiu-wai',
        s: 'Actor, In the Mood for Love (2000)',
        i: ['https://m.media-amazon.com/images/M/MV5BODYz._V1_.jpg', 267, 400],
      },
    ],
  });

  assert.equal(parsed.titles.length, 1);
  assert.equal(parsed.titles[0].imdbId, 'tt0118694');
  assert.equal(
    parsed.titles[0].result.coverUrl,
    'https://m.media-amazon.com/images/M/MV5BN2Q4._V1_UX600_.jpg'
  );

  assert.equal(parsed.names.length, 1);
  assert.equal(parsed.names[0].externalId, 'imdb-nm0504897');
  assert.equal(parsed.names[0].category, 'person');
  assert.match(parsed.names[0].subtitle || '', /演员/);
  assert.equal(parsed.names[0].relatedWorkTitle, 'In the Mood for Love');
});

test('mergeImdbWithDoubanAssist fuses dual ratings, Chinese title/synopsis, and IMDb poster', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt1375666',
      category: 'film',
      title: 'Inception',
      year: '2010',
      region: '英国 / 美国',
      subtitle: '电影 · IMDb 8.8 · 导演 Christopher Nolan',
      coverUrl: 'https://images.metahub.space/poster/medium/tt1375666/img',
      summary: 'A thief who steals corporate secrets through dream-sharing.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt1375666/',
      tags: ['冒险', '科幻', '惊悚'],
    },
  ];

  const doubanItems: OnlineSearchResult[] = [
    {
      externalId: 'douban-subj-3541415',
      category: 'film',
      title: '盗梦空间',
      originalTitle: 'Inception',
      year: '2010',
      region: '美国 / 英国',
      subtitle: '电影 · 豆瓣 9.4 · 导演 克里斯托弗·诺兰',
      coverUrl: '/api/img-proxy?url=https%3A%2F%2Fimg3.doubanio.com%2Fp1.jpg',
      summary: '道姆·柯布与同事阿瑟和纳什在一次针对日本能源大亨齐藤的盗梦行动中失败，反被齐藤利用。',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/3541415/',
      tags: ['剧情', '科幻', '悬疑'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, doubanItems, {
    query: '盗梦空间',
  });

  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, '盗梦空间');
  assert.equal(fused[0].originalTitle, 'Inception');
  assert.equal(fused[0].sourceName, 'IMDb · 豆瓣辅助');
  assert.equal(fused[0].sourceUrl, 'https://www.imdb.com/title/tt1375666/');
  assert.equal(
    fused[0].coverUrl,
    'https://images.metahub.space/poster/medium/tt1375666/img'
  );
  assert.match(fused[0].subtitle || '', /IMDb 8\.8/);
  assert.match(fused[0].subtitle || '', /豆瓣 9\.4/);
  assert.match(fused[0].subtitle || '', /导演 克里斯托弗·诺兰/);
  assert.match(fused[0].summary, /道姆·柯布/);
});

test('mergeImdbWithDoubanAssist degrades gracefully with zero Douban results and applies zhTitleMap', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt0118694',
      category: 'film',
      title: 'In the Mood for Love',
      year: '2000',
      subtitle: '电影 · IMDb 8.0',
      coverUrl: 'https://images.metahub.space/poster/medium/tt0118694/img',
      summary: 'Two neighbors form a strong bond.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt0118694/',
      tags: ['剧情', '爱情'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, [], {
    zhTitleMap: new Map([['tt0118694', '花样年华']]),
    query: '花样年华',
  });

  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, '花样年华');
  assert.equal(fused[0].originalTitle, 'In the Mood for Love');
  assert.equal(fused[0].sourceName, 'IMDb');
  assert.match(fused[0].subtitle || '', /IMDb 8\.0/);
});

test('buildImdbCoverCandidates emits deduplicated poster and background images', () => {
  const candidates = buildImdbCoverCandidates([
    {
      imdbId: 'tt0118694',
      title: '花样年华',
      posterUrl: 'https://images.metahub.space/poster/small/tt0118694/img',
      backgroundUrl: 'https://images.metahub.space/background/medium/tt0118694/img',
    },
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, 'IMDb 海报');
  assert.equal(
    candidates[0].url,
    'https://images.metahub.space/poster/medium/tt0118694/img'
  );
  assert.equal(candidates[1].source, 'IMDb 剧照');
});

test('mergeImdbWithDoubanAssist rejects making-of documentary false positive and picks canonical HK film', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt0118694',
      category: 'film',
      title: 'In the Mood for Love',
      year: '2000',
      subtitle: '电影 · IMDb 8.0 · 导演 Wong Kar-Wai',
      coverUrl: 'https://images.metahub.space/poster/medium/tt0118694/img',
      summary: 'Two neighbors form a strong bond.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt0118694/',
      tags: ['剧情', '爱情'],
    },
  ];

  const doubanItems: OnlineSearchResult[] = [
    {
      externalId: 'douban-subj-9999999',
      category: 'film',
      title: '《花样年华》的背后',
      originalTitle: '@ in the Mood for Love',
      year: '2001',
      subtitle: '电影 · 导演 王家卫',
      summary: '《花样年华》的纪录片',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/9999999/',
      tags: ['纪录片'],
    },
    {
      externalId: 'douban-subj-1291557',
      category: 'film',
      title: '花样年华',
      originalTitle: '花樣年華',
      year: '2000',
      region: '中国香港 / 法国',
      subtitle: '电影 · 豆瓣 8.8 · 导演 王家卫',
      summary: '1960年代的香港，报馆编辑周慕云与太太搬进一间住户多是上海人的公寓，与陈先生太太苏丽珍成为邻居。',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/1291557/',
      tags: ['剧情', '爱情'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, doubanItems, {
    zhTitleMap: new Map([['tt0118694', '花样年华']]),
    fallbackThreshold: 0,
    query: 'In the Mood for Love',
  });

  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, '花样年华');
  assert.equal(fused[0].originalTitle, 'In the Mood for Love');
  assert.equal(fused[0].sourceName, 'IMDb · 豆瓣辅助');
  assert.match(fused[0].subtitle || '', /IMDb 8\.0/);
  assert.match(fused[0].subtitle || '', /豆瓣 8\.8/);
  assert.match(fused[0].summary, /周慕云/);
});

test('mergeImdbWithDoubanAssist matches slash-separated Douban aliases and +-2 year release offsets', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt0371746',
      category: 'film',
      title: 'Iron Man',
      year: '2008',
      subtitle: '电影 · IMDb 7.9',
      coverUrl: 'https://images.metahub.space/poster/medium/tt0371746/img',
      summary: 'After being held captive in an Afghan cave, billionaire engineer Tony Stark creates a unique weaponized suit of armor.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt0371746/',
      tags: ['动作', '科幻'],
    },
  ];

  const doubanItems: OnlineSearchResult[] = [
    {
      externalId: 'douban-subj-1432146',
      category: 'film',
      title: '钢铁侠',
      originalTitle: 'Iron Man / 铁甲奇侠(港)',
      year: '2008',
      subtitle: '电影 · 豆瓣 8.4',
      summary: '斯塔克军火公司是美军在全球范围内第一大军火供应商。',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/1432146/',
      tags: ['动作', '科幻'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, doubanItems, {
    query: 'Iron Man',
  });
  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, '钢铁侠');
  assert.equal(fused[0].originalTitle, 'Iron Man');
  assert.equal(fused[0].sourceName, 'IMDb · 豆瓣辅助');
});

test('mergeImdbWithDoubanAssist matches Latin person names with middle names and falls back to English when unmatched', () => {
  const imdbPeople: OnlineSearchResult[] = [
    {
      externalId: 'imdb-nm0000375',
      category: 'person',
      title: 'Robert Downey Jr.',
      subtitle: '演员 · 代表作 Iron Man',
      coverUrl: 'https://m.media-amazon.com/images/M/rdj._V1_UX600_.jpg',
      summary: 'Robert Downey Jr., IMDb profile.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/name/nm0000375/',
      tags: ['演员'],
    },
    {
      externalId: 'imdb-nm9999999',
      category: 'person',
      title: 'Obscure Indie Actor',
      subtitle: '演员',
      summary: 'No Douban entry.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/name/nm9999999/',
      tags: ['演员'],
    },
  ];

  const doubanPeople: OnlineSearchResult[] = [
    {
      externalId: 'douban-celeb-1016681',
      category: 'person',
      title: '小罗伯特·唐尼',
      originalTitle: 'Robert John Downey Jr.',
      subtitle: '豆瓣影人',
      summary: '小罗伯特·唐尼，美国演员。',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/celebrity/1016681/',
      tags: ['影人'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbPeople, doubanPeople, {
    fallbackThreshold: 0,
    query: 'Robert Downey Jr.',
  });
  assert.equal(fused.length, 2);
  assert.equal(fused[0].title, '小罗伯特·唐尼');
  assert.equal(fused[0].originalTitle, 'Robert Downey Jr.');
  assert.equal(fused[0].sourceName, 'IMDb · 豆瓣辅助');
  assert.equal(fused[1].title, 'Obscure Indie Actor');
  assert.equal(fused[1].sourceName, 'IMDb');
});

test('mergeImdbWithDoubanAssist fuses Bangumi Chinese title & synopsis when Douban static bridge returns empty (Lanterns regression)', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt26545992',
      category: 'film',
      title: 'Lanterns',
      year: '2026',
      subtitle: '剧集 · IMDb 7.8 · 动作 / 犯罪',
      coverUrl: 'https://images.metahub.space/poster/medium/tt26545992/img',
      summary: 'Lanterns follows new recruit John Stewart and Lantern legend Hal Jordan.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt26545992/',
      tags: ['动作', '犯罪'],
    },
  ];

  const bangumiItems: OnlineSearchResult[] = [
    {
      externalId: 'bgm-subj-298360',
      category: 'film',
      title: '绿灯军团',
      originalTitle: 'Lanterns',
      subtitle: '影视',
      summary: '该剧将讲述灯侠新人约翰·斯图尔特，和绿灯侠中的传奇人物哈尔·乔丹搭档的故事，这两名星际警察在调查美国中心地带的一起谋杀案时，被意外卷入了地球上的黑暗谜团当中。',
      sourceName: '番组计划 Bangumi',
      sourceUrl: 'https://bgm.tv/subject/298360',
      tags: ['影视'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, [], {
    secondaryZhItems: bangumiItems,
    query: 'lanterns',
  });

  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, '绿灯军团');
  assert.equal(fused[0].originalTitle, 'Lanterns');
  assert.equal(fused[0].sourceName, 'IMDb · 中文资料');
  assert.match(fused[0].subtitle || '', /IMDb 7\.8/);
  assert.match(fused[0].summary, /约翰·斯图尔特/);
});

test('mergeImdbWithDoubanAssist upgrades stub Douban static-direct summary with secondary Bangumi Chinese synopsis', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt26545992',
      category: 'film',
      title: 'Lanterns',
      year: '2026',
      subtitle: '剧集 · IMDb 7.8',
      coverUrl: 'https://images.metahub.space/poster/medium/tt26545992/img',
      summary: 'Lanterns follows new recruit John Stewart and Lantern legend Hal Jordan.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt26545992/',
      tags: ['动作'],
    },
  ];

  const doubanStub: OnlineSearchResult[] = [
    {
      externalId: 'douban-subj-36225837',
      category: 'film',
      title: '绿灯军团',
      originalTitle: 'Lanterns',
      year: '2026',
      subtitle: '剧集 · 豆瓣 7.9',
      summary: '绿灯军团（Lanterns），豆瓣影视条目。',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/36225837/',
      tags: ['剧集'],
    },
  ];

  const bangumiItems: OnlineSearchResult[] = [
    {
      externalId: 'bgm-subj-298360',
      category: 'film',
      title: '绿灯军团',
      originalTitle: 'Lanterns',
      subtitle: '影视',
      summary: '该剧将讲述灯侠新人约翰·斯图尔特，和绿灯侠中的传奇人物哈尔·乔丹搭档的故事，被意外卷入了地球上的黑暗谜团当中。',
      sourceName: '番组计划 Bangumi',
      sourceUrl: 'https://bgm.tv/subject/298360',
      tags: ['影视'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, doubanStub, {
    secondaryZhItems: bangumiItems,
    query: 'lanterns',
  });

  assert.equal(fused.length, 1);
  assert.equal(fused[0].title, '绿灯军团');
  assert.equal(fused[0].sourceName, 'IMDb · 豆瓣辅助');
  assert.match(fused[0].subtitle || '', /IMDb 7\.8/);
  assert.match(fused[0].subtitle || '', /豆瓣 7\.9/);
  assert.match(fused[0].summary, /约翰·斯图尔特/);
});

test('isPlausibleBaikeFilmOrPerson rejects non-media homonyms and accepts films & actors', () => {
  assert.equal(
    isPlausibleBaikeFilmOrPerson(
      {
        externalId: 'baike-1',
        category: 'film',
        title: '灯笼',
        subtitle: 'iphone游戏',
        summary: '《灯笼》是一款休闲益智类手机游戏。',
        sourceName: '百度百科',
        tags: ['游戏'],
      },
      'film'
    ),
    false
  );

  assert.equal(
    isPlausibleBaikeFilmOrPerson(
      {
        externalId: 'baike-2',
        category: 'film',
        title: '盗梦空间',
        subtitle: '美国2010年克里斯托弗·诺兰执导的电影',
        summary: '《盗梦空间》是由克里斯托弗·诺兰执导的科幻悬疑电影。',
        sourceName: '百度百科',
        tags: ['科幻'],
      },
      'film'
    ),
    true
  );

  assert.equal(
    isPlausibleBaikeFilmOrPerson(
      {
        externalId: 'baike-3',
        category: 'person',
        title: '凯尔·钱德勒',
        subtitle: '美国男演员',
        summary: '凯尔·钱德勒，美国影视男演员。',
        sourceName: '百度百科',
        tags: ['演员'],
      },
      'person'
    ),
    true
  );
});

test('extractBaiduSuggestZhAlias extracts Chinese title from English+Chinese Baidu suggestions', () => {
  assert.equal(
    extractBaiduSuggestZhAlias(
      ['LANTERNS美剧', 'LANTERNS第三集', 'LANTERNS绿灯军团', 'LANTERNS什么意思'],
      'Lanterns'
    ),
    '绿灯军团'
  );
  assert.equal(
    extractBaiduSuggestZhAlias(['LANTERNS什么意思', 'LANTERNS美剧评价'], 'Lanterns'),
    null
  );
});

test('mergeImdbWithDoubanAssist prevents older homonym film from stealing yearless Bangumi entry already matched by Douban', () => {
  const imdbItems: OnlineSearchResult[] = [
    {
      externalId: 'imdb-tt26545992',
      category: 'film',
      title: 'Lanterns',
      year: '2026',
      subtitle: '剧集 · IMDb 7.8',
      summary: 'Lanterns follows John Stewart and Hal Jordan.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt26545992/',
      tags: ['动作'],
    },
    {
      externalId: 'imdb-tt10994580',
      category: 'film',
      title: 'Lanterns',
      year: '2014',
      subtitle: '电影',
      summary: 'In the 1920s, young people embarked on a new life.',
      sourceName: 'IMDb',
      sourceUrl: 'https://www.imdb.com/title/tt10994580/',
      tags: ['剧情'],
    },
  ];
  const doubanItems: OnlineSearchResult[] = [
    {
      externalId: 'douban-subj-36225837',
      category: 'film',
      title: '绿灯军团',
      originalTitle: 'Lanterns',
      year: '2026',
      subtitle: '剧集 · 豆瓣 7.9',
      summary: '星际和平守护者绿灯侠所戴的戒指赋予他们非凡的力量。传奇绿灯侠哈尔·乔丹和新人绿灯侠约翰·斯图尔特联手调查谋杀案。',
      sourceName: '豆瓣影视',
      sourceUrl: 'https://movie.douban.com/subject/36225837/',
      tags: ['剧情', '科幻'],
    },
  ];
  const bangumiItems: OnlineSearchResult[] = [
    {
      externalId: 'bgm-subj-298360',
      category: 'film',
      title: '绿灯军团',
      originalTitle: 'Lanterns',
      subtitle: '影视',
      summary: '该剧将讲述灯侠新人约翰·斯图尔特和哈尔·乔丹搭档的故事。',
      sourceName: '番组计划 Bangumi',
      sourceUrl: 'https://bgm.tv/subject/298360',
      tags: ['影视'],
    },
  ];

  const fused = mergeImdbWithDoubanAssist(imdbItems, doubanItems, {
    secondaryZhItems: bangumiItems,
    query: 'lanterns',
  });

  const item2026 = fused.find((r) => r.externalId === 'imdb-tt26545992');
  const item2014 = fused.find((r) => r.externalId === 'imdb-tt10994580');
  assert.equal(item2026?.title, '绿灯军团');
  assert.equal(item2026?.sourceName, 'IMDb · 豆瓣辅助');
  assert.equal(item2014?.title, 'Lanterns');
  assert.equal(item2014?.sourceName, 'IMDb');
});




