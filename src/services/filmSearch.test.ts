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
    assert.equal(searchFilmIndex('Inception')[0].title, '盗梦空间');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
