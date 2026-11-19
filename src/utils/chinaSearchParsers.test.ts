import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBaiduBaikeCard,
  parseBangumiLegacySubjects,
  parseIqiyiSuggestData,
  parseMoegirlPages,
  settleSourcesWithFastWindow,
  stripBaikeHtml,
  upgradeToHttpsUrl,
} from './chinaSearchParsers';

test('upgradeToHttpsUrl upgrades http and protocol-relative URLs to HTTPS', () => {
  assert.equal(
    upgradeToHttpsUrl('http://pic4.iqiyipic.com/a.jpg'),
    'https://pic4.iqiyipic.com/a.jpg'
  );
  assert.equal(
    upgradeToHttpsUrl('//lain.bgm.tv/pic/cover/l/test.jpg'),
    'https://lain.bgm.tv/pic/cover/l/test.jpg'
  );
  assert.equal(
    upgradeToHttpsUrl('https://bkimg.cdn.bcebos.com/pic/1.jpg'),
    'https://bkimg.cdn.bcebos.com/pic/1.jpg'
  );
  assert.equal(upgradeToHttpsUrl('javascript:alert(1)'), undefined);
});

test('stripBaikeHtml removes Baike reference superscripts and HTML tags cleanly', () => {
  assert.equal(
    stripBaikeHtml('漫长的季节<sup>74</sup><a name="ref_74"></a>'),
    '漫长的季节'
  );
  assert.equal(
    stripBaikeHtml('The Long Season<sup>74</sup>[1]'),
    'The Long Season'
  );
});

test('parseBaiduBaikeCard extracts film metadata and director/cast relations', () => {
  const bundle = parseBaiduBaikeCard(
    {
      newLemmaId: 58414704,
      title: '漫长的季节',
      desc: '2023年辛爽执导的悬疑剧',
      image: 'http://bkimg.cdn.bcebos.com/pic/test.jpg',
      url: 'http://baike.baidu.com/item/test',
      abstract: '《漫长的季节》是由辛爽执导的生活悬疑剧。',
      card: [
        { name: '外文名', value: ['The Long Season<sup>74</sup>'] },
        { name: '作品类型', value: ['剧情、家庭、犯罪<sup>74</sup>'] },
        { name: '制片地区', value: ['中国大陆<sup>74</sup>'] },
        { name: '导演', value: ['辛爽'] },
        { name: '主演', value: ['范伟、秦昊、陈明昊'] },
      ],
    },
    'film'
  );

  assert.ok(bundle.searchResult);
  assert.equal(bundle.searchResult.title, '漫长的季节');
  assert.equal(bundle.searchResult.originalTitle, 'The Long Season');
  assert.equal(bundle.searchResult.year, '2023');
  assert.equal(bundle.searchResult.region, '中国大陆');
  assert.equal(
    bundle.searchResult.coverUrl,
    'https://bkimg.cdn.bcebos.com/pic/test.jpg'
  );
  assert.deepEqual(bundle.searchResult.tags, ['剧情', '家庭', '犯罪']);
  assert.equal(bundle.relatedPeople.length, 4);
  assert.equal(bundle.relatedPeople[0].title, '辛爽');
  assert.equal(bundle.relatedPeople[0].subtitle, '导演');
});

test('parseBaiduBaikeCard extracts structured character dossier fields', () => {
  const bundle = parseBaiduBaikeCard(
    {
      id: 1001,
      title: '周慕云',
      desc: '王家卫电影系列虚构男主角',
      image: 'https://bkimg.cdn.bcebos.com/pic/zmy.jpg',
      abstract: '周慕云首次亮相于2000年电影《花样年华》。',
      card: [
        { name: '饰演者', value: ['梁朝伟'] },
        { name: '首次登场', value: ['《花样年华》（2000）'] },
        { name: '职业设定', value: ['报馆编辑/小说家'] },
        { name: '关联作品', value: ['《花样年华》《2046》'] },
      ],
    },
    'character'
  );

  assert.ok(bundle.searchResult);
  assert.equal(bundle.searchResult.portrayedBy, '梁朝伟');
  assert.equal(bundle.searchResult.relatedWorkTitle, '花样年华');
  assert.equal(bundle.characterProfile.identity, '报馆编辑/小说家');
  assert.equal(bundle.characterProfile.firstAppearance, '《花样年华》（2000）');
  assert.equal(bundle.relatedFilms.length, 2);
  assert.equal(bundle.relatedPeople[0].title, '梁朝伟');
});

test('parseIqiyiSuggestData parses movies and celebrities while filtering plain text suggestions', () => {
  const filmBundle = parseIqiyiSuggestData(
    {
      data: [
        {
          aid: 730522200,
          name: '花样年华',
          cid: 1,
          cname: '电影',
          year: 2000,
          region: '香港地区',
          director: ['王家卫'],
          main_actor: ['张曼玉', '梁朝伟'],
          picture_url: 'http://pic4.iqiyipic.com/a.jpg',
          presentation_element: {
            show_reason: '2000/豆瓣Top250',
            tags: [{ name: '电影' }, { name: '第53届戛纳电影节获奖' }],
          },
        },
        {
          aid: 730522201,
          name: '花样年华（粤语）',
          cid: 1,
          cname: '电影',
          year: 2000,
          picture_url: 'http://pic4.iqiyipic.com/b.jpg',
        },
        {
          aid: 0,
          name: '花样年华电视剧',
          cid: 0,
          cname: '',
        },
      ],
    },
    'film'
  );

  assert.equal(filmBundle.searchResults.length, 1);
  assert.equal(filmBundle.searchResults[0].title, '花样年华');
  assert.equal(
    filmBundle.searchResults[0].coverUrl,
    'https://pic4.iqiyipic.com/a.jpg'
  );
  assert.equal(filmBundle.relatedPeople.length, 3);

  const personBundle = parseIqiyiSuggestData(
    {
      data: [
        {
          name: '梁朝伟',
          cid: 0,
          celebrity_id: 214340305,
          presentation_element: {
            picture_url: 'http://pic7.iqiyipic.com/p.jpg',
            tags: [{ name: '人物' }],
            show_reason: '演员、歌手 / 主演作品《金手指》',
          },
        },
      ],
    },
    'person'
  );

  assert.equal(personBundle.searchResults.length, 1);
  assert.equal(personBundle.searchResults[0].title, '梁朝伟');
  assert.equal(personBundle.relatedFilms[0].title, '金手指');
});

test('parseMoegirlPages filters meme/unrelated pages while keeping on-target results', () => {
  const moe = parseMoegirlPages(
    {
      query: {
        pages: {
          '10': {
            pageid: 10,
            index: 1,
            title: '钢铁侠',
            thumbnail: { source: 'https://storage.moegirl.org.cn/a.jpg' },
            extract: '托尼·斯塔克是漫威经典超级英雄。',
          },
          '11': {
            pageid: 11,
            index: 2,
            title: 'Category:漫威角色',
          },
          '12': {
            pageid: 12,
            index: 3,
            title: '逃出青龙山/恶搞与捏他',
            extract: '恶搞片段',
          },
          '13': {
            pageid: 13,
            index: 4,
            title: '漫威争锋:钢铁侠',
            extract: '游戏角色',
          },
          '14': {
            pageid: 14,
            index: 5,
            title: '季节',
            extract: '季节词条',
          },
        },
      },
    },
    'character',
    '钢铁侠'
  );
  assert.equal(moe.length, 1);
  assert.equal(moe[0].title, '钢铁侠');
  assert.equal(moe[0].sourceName, '萌娘百科');

  const chihiro = parseMoegirlPages(
    {
      query: {
        pages: {
          '20': {
            pageid: 20,
            index: 1,
            title: '千与千寻',
            extract: '宫崎骏执导的动画电影。',
          },
        },
      },
    },
    'film',
    '千寻'
  );
  assert.equal(chihiro.length, 1);
  assert.equal(chihiro[0].title, '千与千寻');

  const bgm = parseBangumiLegacySubjects({
    list: [
      {
        id: 431299,
        type: 6,
        name: '漫长的季节',
        name_cn: '',
        air_date: '2023-04-22',
        images: { large: 'http://lain.bgm.tv/pic/cover/l/a.jpg' },
        rating: { score: 8.8 },
      },
      { id: 999, type: 1, name: 'Some Book' },
    ],
  });
  assert.equal(bgm.length, 1);
  assert.equal(bgm[0].coverUrl, 'https://lain.bgm.tv/pic/cover/l/a.jpg');
  assert.equal(bgm[0].year, '2023');
});

test('settleSourcesWithFastWindow returns quickly when fast source succeeds while slow source hangs', async () => {
  const start = Date.now();
  const res = await settleSourcesWithFastWindow(
    [
      {
        name: '百度百科',
        promise: Promise.resolve(['item-1']),
      },
      {
        name: 'Slow Blocked Source',
        promise: new Promise<string[]>((resolve) =>
          setTimeout(() => resolve(['late-item']), 2000)
        ),
      },
    ],
    60
  );
  const elapsed = Date.now() - start;
  assert.deepEqual(res.items, ['item-1']);
  assert.deepEqual(res.activeSources, ['百度百科']);
  assert.ok(elapsed < 500, `Expected fast settlement, took ${elapsed}ms`);
});
