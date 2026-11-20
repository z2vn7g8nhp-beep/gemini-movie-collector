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
