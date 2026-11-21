import assert from 'node:assert/strict';
import test from 'node:test';
import { searchImdbMedia } from './imdbClient';
import { searchFilmIndex } from '../utils/filmIndex';

test('offline film search preserves IMDb identities and ranks the exact Chinese title first', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  try {
    const { results } = await searchImdbMedia('饥饿游戏', 'film', { mode: 'server' });
    assert.equal(results[0].title, '饥饿游戏');
    assert.equal(results[0].originalTitle, 'The Hunger Games');
    assert.equal(results[0].sourceUrl, 'https://www.imdb.com/title/tt1392170/');
    assert.ok(results.some(r => r.externalId === 'imdb-tt1951264' && r.title.includes('星火燎原')));
    assert.ok(results.some(r => r.title.includes('嘲笑鸟')));
    assert.equal(new Set(results.map(r => r.externalId)).size, results.length);
    const direct = await searchImdbMedia('https://www.imdb.com/title/tt1951264/', 'film', { mode: 'server' });
    assert.deepEqual(direct.results.map(r => r.externalId), ['imdb-tt1951264']);
    const ironheart = await searchImdbMedia('Ironheart', 'film', { mode: 'server' });
    assert.equal(ironheart.results[0].title, '钢铁之心');
    assert.equal(ironheart.results[0].externalId, 'imdb-tt13623126');
    assert.equal(searchFilmIndex('Inception')[0].title, '盗梦空间');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('title spelling outranks enrichment and same-name works retain distinct IMDb IDs', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = [
    { id: 'tt37025793', type: 'movie', name: 'Vision Quest', releaseInfo: '2025', imdbRating: '8.4' },
    { id: 'tt0090270', type: 'movie', name: 'Vision Quest', releaseInfo: '1985' },
    { id: 'tt23112594', type: 'series', name: 'VisionQuest', releaseInfo: '2026', imdbRating: '7.8' },
  ];
  globalThis.fetch = async input => {
    const url = String(input);
    for (const kind of ['movie', 'series']) {
      if (url.includes('/catalog/' + kind + '/')) {
        return Response.json({ metas: fixture.filter(row => row.type === kind) });
      }
    }
    return new Response(null, { status: 503 });
  };
  try {
    const joined = await searchImdbMedia('Visionquest', 'film', { mode: 'browser' });
    assert.equal(joined.results[0].title, '幻视任务');
    assert.equal(joined.results[0].originalTitle, 'VisionQuest');
    assert.equal(joined.results[0].year, '2026');
    assert.match(joined.results[0].subtitle || '', /剧集/);
    assert.ok(joined.results.some(item => item.externalId === 'imdb-tt37025793'));
    assert.ok(joined.results.some(item => item.externalId === 'imdb-tt0090270'));
    const spaced = await searchImdbMedia('Vision Quest', 'film', { mode: 'browser' });
    assert.equal(spaced.results[0].title, 'Vision Quest');
    assert.equal(searchFilmIndex('幻视任务')[0].sourceUrl, 'https://www.imdb.com/title/tt23112594/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a new release can be searched, collected and reopened with its Chinese profile without external data', async () => {
  const { localizeArchivedFilm } = await import('../utils/filmIndex');
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('external host blocked'); };
  const id = 'tt32558705';
  const title = '饥饿游戏：收获日出';
  const english = 'The Hunger Games: Sunrise on the Reaping';
  try {
    for (const query of [english, title, id]) {
      const { results } = await searchImdbMedia(query, 'film', { mode: 'browser' });
      assert.equal(results[0]?.externalId, 'imdb-' + id);
      assert.equal(results[0].title, title);
      assert.equal(results[0].originalTitle, english);
      assert.match(results[0].summary, /饥饿游戏/);
      assert.ok(results[0].summaryRevision);
    }
    const old = {
      id: 'archive-film', accessionNo: 'CA-002', category: 'film' as const, title: english,
      sourceUrl: 'https://www.imdb.com/title/' + id + '/', sourceName: 'IMDb', summary: 'Explores Panem…',
      rating: 3, status: 'watched' as const, relatedIds: ['saved-role'], tags: ['动作'], notes: '个人笔记',
      createdAt: '', updatedAt: '',
    };
    const current = localizeArchivedFilm(old);
    assert.equal(current.title, title);
    assert.equal(current.originalTitle, english);
    assert.equal(current.notes, old.notes);
    assert.equal(current.rating, 3);
    assert.deepEqual(current.relatedIds, old.relatedIds);
    assert.ok(current.summaryRevision);
    assert.equal(old.title, english);
    const manual = { ...old, sourceName: '手动建档', title: 'My title', summary: 'My own text' };
    assert.deepEqual(localizeArchivedFilm(manual), manual);
  } finally {
    globalThis.fetch = fetch;
  }
});

test('a direct IMDb ID outside the snapshot resolves Chinese metadata through its own sitelink', async () => {
  const fetch = globalThis.fetch;
  const id = 'tt99999111';
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'query.wikidata.org') return Response.json({ results: { bindings: [
      { id: { value: id }, page: { value: 'https://zh.wikipedia.org/wiki/测试电影' } },
      { id: { value: 'tt99999992' }, page: { value: 'https://zh.wikipedia.org/wiki/同名图书' } },
    ] } });
    if (url.hostname === 'zh.wikipedia.org' && url.searchParams.has('titles')) {
      assert.equal(url.searchParams.get('titles'), '测试电影');
      return Response.json({ query: { pages: [
        { title: '测试电影', extract: '《测试影片》讲述一家人的故事。', lastrevid: 1234 },
        { title: '同名图书', extract: '《另一本书》', lastrevid: 5678 },
      ] } });
    }
    return new Response(null, { status: 503 });
  };
  try {
    const { results } = await searchImdbMedia(id, 'film', { mode: 'server' });
    assert.deepEqual(results.map(r => [r.title, r.externalId, r.summaryRevision]), [['测试影片', 'imdb-' + id, 1234]]);
  } finally {
    globalThis.fetch = fetch;
  }
});
