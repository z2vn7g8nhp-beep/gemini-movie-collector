import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDoubanCharacterName,
  extractJsonFromBridgeText,
  extractJsonFromJinaEnvelope,
  normalizeDoubanImageUrl,
  normalizeRelayBaseUrl,
  parseDoubanCardSubtitle,
  parseDoubanCelebrityDetail,
  parseDoubanCelebrityWorks,
  parseDoubanCredits,
  parseDoubanMovieSearch,
  parseDoubanPhotos,
  parseDoubanSubjectAbstract,
  parseDoubanSubjectDetail,
  parseDoubanSuggest,
  parseDoubanUrlOrId,
  parseWmdbSearchPayload,
  rankStaticDoubanFilmResults,
} from './doubanParsers';

test('parseDoubanUrlOrId recognizes movie, mobile, celebrity, personage, and shorthand IDs', () => {
  assert.deepEqual(
    parseDoubanUrlOrId('https://movie.douban.com/subject/1291557/'),
    { kind: 'subject', id: '1291557' }
  );
  assert.deepEqual(
    parseDoubanUrlOrId('https://m.douban.com/movie/subject/35588177/?from=search'),
    { kind: 'subject', id: '35588177' }
  );
  assert.deepEqual(
    parseDoubanUrlOrId('https://movie.douban.com/celebrity/1115918/'),
    { kind: 'celebrity', id: '1115918' }
  );
  assert.deepEqual(
    parseDoubanUrlOrId('https://www.douban.com/personage/27321759/'),
    { kind: 'celebrity', id: '27321759' }
  );
  assert.deepEqual(parseDoubanUrlOrId('douban:1291557'), {
    kind: 'subject',
    id: '1291557',
  });
  assert.equal(parseDoubanUrlOrId('花样年华'), null);
});

test('normalizeDoubanImageUrl upgrades signed tiny URLs to stable high-res img3 URLs', () => {
  const signed =
    'https://qnmob3-sign.doubanio.com/view/photo/large/public/p2918312477.jpg?sa_cv=abc&sa_ct=def&imageView2/0/q/80/w/9999/h/120/format/jpg';
  assert.equal(
    normalizeDoubanImageUrl(signed, 'poster'),
    'https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2918312477.jpg'
  );
  assert.equal(
    normalizeDoubanImageUrl(signed, 'photo'),
    'https://img3.doubanio.com/view/photo/m/public/p2918312477.jpg'
  );
  assert.equal(
    normalizeDoubanImageUrl(
      'https://img2.doubanio.com/view/personage/s/public/b896568be8b524ede111bedc47c8211e.jpg',
      'avatar'
    ),
    'https://img2.doubanio.com/view/personage/m/public/b896568be8b524ede111bedc47c8211e.jpg'
  );
  assert.equal(
    normalizeDoubanImageUrl(
      'https://img1.doubanio.com/f/movie/movie_default_large.png'
    ),
    undefined
  );
});

test('extractDoubanCharacterName parses actor roles cleanly and rejects crew/self labels', () => {
  assert.equal(extractDoubanCharacterName('演员 Actress (饰 苏丽珍)'), '苏丽珍');
  assert.equal(extractDoubanCharacterName('饰 周慕云'), '周慕云');
  assert.equal(extractDoubanCharacterName('演员 (饰 陈永仁)'), '陈永仁');
  assert.equal(extractDoubanCharacterName('配音 Voice (配 千寻)'), '千寻');
  assert.equal(extractDoubanCharacterName('导演 Director'), undefined);
  assert.equal(extractDoubanCharacterName('演员 - 自己'), undefined);
  assert.equal(extractDoubanCharacterName('演员 - 配音'), undefined);
});

test('parseDoubanCardSubtitle extracts score, year, region, genres, and credits', () => {
  const parsed = parseDoubanCardSubtitle(
    '8.8分 / 2000 / 中国香港 / 剧情 爱情 / 王家卫 / 张曼玉 梁朝伟'
  );
  assert.equal(parsed.score, '8.8');
  assert.equal(parsed.year, '2000');
  assert.equal(parsed.region, '中国香港');
  assert.deepEqual(parsed.genres, ['剧情', '爱情']);
  assert.ok(parsed.credits.includes('王家卫'));
});

test('parseDoubanMovieSearch filters books/doulists and preserves Douban ratings & normalized posters', () => {
  const results = parseDoubanMovieSearch({
    items: [
      { layout: 'doulist_cards', target_type: 'doulist_cards', target: {} },
      {
        layout: 'subject',
        target_type: 'book',
        target: { id: '999', title: '不该出现的图书' },
      },
      {
        layout: 'subject',
        target_type: 'tv',
        target: {
          id: '35588177',
          title: '漫长的季节',
          rating: { value: 9.4 },
          card_subtitle: '2023 / 中国大陆 / 剧情 悬疑 / 辛爽 / 范伟 秦昊',
          cover_url:
            'https://qnmob3-sign.doubanio.com/view/photo/large/public/p2890903284.jpg?imageView2/0/q/80/w/9999/h/120/format/jpg',
        },
      },
    ],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, '漫长的季节');
  assert.equal(results[0].year, '2023');
  assert.equal(results[0].region, '中国大陆');
  assert.match(results[0].subtitle || '', /豆瓣 9\.4/);
  assert.equal(
    results[0].coverUrl,
    'https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2890903284.jpg'
  );
});

test('parseDoubanSuggest splits celebrities and movies cleanly', () => {
  const parsed = parseDoubanSuggest([
    {
      id: '1115918',
      title: '梁朝伟',
      sub_title: 'Tony Leung Chiu Wai',
      type: 'celebrity',
      img: 'https://img2.doubanio.com/view/personage/m/public/abc.jpg',
    },
    {
      id: '1291557',
      title: '花样年华',
      sub_title: '花樣年華',
      type: 'movie',
      year: '2000',
      img: 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2918312477.jpg',
    },
  ]);
  assert.equal(parsed.celebrities.length, 1);
  assert.equal(parsed.celebrities[0].title, '梁朝伟');
  assert.equal(parsed.celebrities[0].originalTitle, 'Tony Leung Chiu Wai');
  assert.equal(parsed.movies.length, 1);
  assert.equal(parsed.movies[0].year, '2000');
});

test('parseDoubanSubjectDetail maps full synopsis, rating, directors, and countries', () => {
  const item = parseDoubanSubjectDetail({
    id: '1291557',
    title: '花样年华',
    original_title: '花樣年華',
    type: 'movie',
    year: '2000',
    countries: ['中国香港'],
    genres: ['剧情', '爱情'],
    rating: { value: 8.8 },
    directors: [{ name: '王家卫' }],
    pic: {
      large:
        'https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2918312477.jpg',
    },
    intro: '1960年代的香港，报馆编辑周慕云与邻居苏丽珍的故事。',
  });
  assert.ok(item);
  assert.equal(item.title, '花样年华');
  assert.equal(item.originalTitle, '花樣年華');
  assert.match(item.subtitle || '', /豆瓣 8\.8/);
  assert.match(item.subtitle || '', /导演 王家卫/);
  assert.equal(item.region, '中国香港');
  assert.match(item.summary, /周慕云/);
});

test('parseDoubanCredits extracts both people and characters with portrayedBy links', () => {
  const { people, characters } = parseDoubanCredits(
    {
      items: [
        {
          id: '1041024',
          name: '王家卫',
          latin_name: 'Kar Wai Wong',
          character: '导演 Director',
          simple_character: '导演',
          avatar: {
            large: 'https://img3.doubanio.com/view/celebrity/m/public/p1418226223.7.jpg',
          },
        },
        {
          id: '1274231',
          name: '张曼玉',
          latin_name: 'Maggie Cheung',
          character: '演员 Actress (饰 苏丽珍)',
          simple_character: '饰 苏丽珍',
          avatar: {
            large: 'https://img3.doubanio.com/view/personage/m/public/ae3b.jpg',
          },
        },
        {
          id: '1115918',
          name: '梁朝伟',
          latin_name: 'Tony Leung Chiu Wai',
          character: '演员 Actor (饰 周慕云)',
          simple_character: '饰 周慕云',
          avatar: {
            large: 'https://img2.doubanio.com/view/personage/m/public/b896.jpg',
          },
        },
      ],
    },
    '花样年华',
    'https://movie.douban.com/subject/1291557/'
  );

  assert.equal(people.length, 3);
  assert.equal(people[0].subtitle, '导演');
  assert.equal(people[1].subtitle, '饰 苏丽珍');
  assert.equal(characters.length, 2);
  assert.equal(characters[0].title, '苏丽珍');
  assert.equal(characters[0].portrayedBy, '张曼玉');
  assert.equal(characters[0].relatedWorkTitle, '花样年华');
  assert.equal(characters[1].title, '周慕云');
});

test('parseDoubanCelebrityDetail & parseDoubanCelebrityWorks parse profile, filmography, and characters', () => {
  const celeb = parseDoubanCelebrityDetail(
    {
      id: '27321759',
      title: '梁朝伟',
      latin_title: 'Tony Leung Chiu Wai',
      cover: {
        large: {
          url: 'https://img2.doubanio.com/view/personage/l/public/b896.jpg',
        },
      },
      extra: {
        short_info: '演员 配音 音乐人 / 无间道 重庆森林 花样年华',
        info: [
          ['出生日期', '1962年6月27日'],
          ['出生地', '中国香港'],
        ],
      },
    },
    '1115918'
  );
  assert.ok(celeb);
  assert.equal(celeb.title, '梁朝伟');
  assert.equal(celeb.year, '1962');
  assert.equal(celeb.region, '中国香港');
  assert.match(celeb.subtitle || '', /演员/);

  const works = parseDoubanCelebrityWorks(
    {
      works: [
        {
          roles: ['演员 (饰 陈永仁)'],
          work: {
            id: '1307914',
            title: '无间道',
            year: '2002',
            type: 'movie',
            rating: { value: 9.3 },
            pic: {
              large:
                'https://img3.doubanio.com/view/photo/m_ratio_poster/public/p2597979873.jpg',
            },
          },
        },
        {
          roles: ['演员 - 自己'],
          work: {
            id: '1476754',
            title: '今夜不设防',
            year: '1989',
            type: 'tv',
            rating: { value: 9.4 },
          },
        },
      ],
    },
    '梁朝伟'
  );
  assert.equal(works.films.length, 2);
  assert.equal(works.characters.length, 1);
  assert.equal(works.characters[0].title, '陈永仁');
  assert.equal(works.characters[0].relatedWorkTitle, '无间道');
});

test('parseDoubanPhotos & normalizeRelayBaseUrl behave safely', () => {
  const covers = parseDoubanPhotos(
    {
      photos: [
        {
          id: '1',
          description: '经典旗袍剧照',
          image: {
            normal: {
              url: 'https://img3.doubanio.com/view/photo/m/public/p2603766413.jpg',
            },
          },
        },
      ],
    },
    '花样年华'
  );
  assert.equal(covers.length, 1);
  assert.equal(covers[0].source, '豆瓣剧照');
  assert.equal(
    normalizeRelayBaseUrl('https://my-douban.workers.dev///'),
    'https://my-douban.workers.dev'
  );
  assert.equal(normalizeRelayBaseUrl('javascript:alert(1)'), '');
});

test('extractJsonFromJinaEnvelope parses raw, fenced, and prefixed JSON payloads', () => {
  assert.deepEqual(
    extractJsonFromJinaEnvelope({ data: { content: '[{"id":"123"}]' } }),
    [{ id: '123' }]
  );
  assert.deepEqual(
    extractJsonFromJinaEnvelope({
      data: { content: '```json\n{"ok":true}\n```' },
    }),
    { ok: true }
  );
  assert.equal(extractJsonFromJinaEnvelope({ data: { content: 'not json' } }), null);
});

test('parseWmdbSearchPayload and parseDoubanSubjectAbstract parse zero-config static Douban data', () => {
  const wmdbEntries = parseWmdbSearchPayload({
    data: [
      {
        doubanId: '35588177',
        originalName: '漫长的季节',
        alias: 'The Long Season',
        year: '2023',
        type: 'TVSeries',
        episodes: 12,
        doubanRating: '',
        data: [
          {
            lang: 'Cn',
            name: '漫长的季节',
            genre: '剧情/家庭/犯罪',
            country: '中国大陆',
            poster: 'https://img.wmdb.tv/movie/poster/1681986787702-a983ae.jpg',
            description: '小城桦林，出租司机王响的故事。',
          },
        ],
        director: [{ data: [{ lang: 'Cn', name: '辛爽' }] }],
        actor: [
          { data: [{ lang: 'Cn', name: '范伟' }] },
          { data: [{ lang: 'Cn', name: '秦昊' }] },
        ],
      },
    ],
  });

  assert.equal(wmdbEntries.length, 1);
  assert.equal(wmdbEntries[0].result.title, '漫长的季节');
  assert.equal(wmdbEntries[0].result.sourceName, '豆瓣影视');
  assert.equal(
    wmdbEntries[0].result.sourceUrl,
    'https://movie.douban.com/subject/35588177/'
  );
  assert.equal(
    wmdbEntries[0].result.coverUrl,
    'https://img.wmdb.tv/movie/poster/1681986787702-a983ae.jpg'
  );
  assert.equal(wmdbEntries[0].people.length, 3);
  assert.equal(wmdbEntries[0].people[0].title, '辛爽');

  const abs = parseDoubanSubjectAbstract({
    r: 0,
    subject: {
      id: '35588177',
      title: '漫长的季节\u200e (2023)',
      rate: '9.4',
      is_tv: true,
      directors: ['辛爽'],
      actors: ['范伟', '秦昊'],
      types: ['剧情', '犯罪'],
      region: '中国大陆',
      release_year: '2023',
      url: 'https://movie.douban.com/subject/35588177/',
    },
  });

  assert.ok(abs);
  assert.equal(abs.result.title, '漫长的季节');
  assert.match(abs.result.subtitle || '', /豆瓣 9\.4/);
  assert.equal(abs.people.length, 3);
});

test('extractJsonFromBridgeText parses headerless Jina plain text, JSON envelope, and raw JSON', () => {
  const jinaPlain =
    'Title: \n\nURL Source: https://api.wmdb.tv/api/v1/movie/search?q=test\n\nMarkdown Content:\n{"total":2,"data":[{"doubanId":"1306809"}]}';
  assert.deepEqual(extractJsonFromBridgeText(jinaPlain), {
    total: 2,
    data: [{ doubanId: '1306809' }],
  });

  const jinaJson = JSON.stringify({
    code: 200,
    data: { content: '[{"id":"1306809","title":"生化危机"}]' },
  });
  assert.deepEqual(extractJsonFromBridgeText(jinaJson), [
    { id: '1306809', title: '生化危机' },
  ]);

  assert.equal(extractJsonFromBridgeText('not json at all'), null);
});

test('rankStaticDoubanFilmResults prioritizes rated exact matches ahead of unrated upcoming stubs', () => {
  const ranked = rankStaticDoubanFilmResults(
    [
      {
        externalId: 'douban-subj-37068446',
        category: 'film',
        title: '生化危机',
        year: '2026',
        subtitle: '电影 · 科幻 / 恐怖',
        coverUrl: 'https://img.wmdb.tv/p1.jpg',
        summary: '2026 reboot',
        sourceName: '豆瓣影视',
        tags: ['科幻', '恐怖'],
      },
      {
        externalId: 'douban-subj-34806914',
        category: 'film',
        title: '生化危机4：孵化',
        year: '2006',
        subtitle: '电影 · 豆瓣 7.4',
        coverUrl: 'https://img.wmdb.tv/p2.jpg',
        summary: 'sequel summary text with enough characters to count as detailed',
        sourceName: '豆瓣影视',
        tags: ['动作', '科幻'],
      },
      {
        externalId: 'douban-subj-1306809',
        category: 'film',
        title: '生化危机',
        year: '2002',
        subtitle: '电影 · 豆瓣 8.1 · 导演 保罗·安德森',
        coverUrl: 'https://img.wmdb.tv/p3.jpg',
        summary: '为军方研究生化武器的安布雷拉公司在浣熊市地下建立了一个巨大的生物学实验室。',
        sourceName: '豆瓣影视',
        tags: ['动作', '科幻', '恐怖'],
      },
    ],
    '生化危机'
  );

  assert.equal(ranked[0].externalId, 'douban-subj-1306809');
  assert.equal(ranked[1].externalId, 'douban-subj-37068446');
  assert.equal(ranked[2].externalId, 'douban-subj-34806914');
});
