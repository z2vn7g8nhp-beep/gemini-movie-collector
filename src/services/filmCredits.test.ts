import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFilmCredits, loadFilmCredits, mergeFilmCredits, withFilmCredits } from './filmCredits';

test('Mortal Kombat (2021) resolves by IMDb ID with actor-role pairs and literal character names', async () => {
  const data = await loadFilmCredits('https://www.imdb.com/title/tt0293429/', '真人快打');
  assert.ok(data);
  assert.ok(data.castArticleRevision);
  assert.ok(data.characters.some(c => c.title === 'Emily Young' && c.portrayedBy === 'Matilda Kimber'));
  assert.ok((await loadFilmCredits(undefined, '真人快打', 'Mortal Kombat', '2021'))?.castArticleRevision);
  assert.equal(await loadFilmCredits(undefined, '真人快打', 'Mortal Kombat', '1901'), null);
  const lewis = data.people.find(p => p.originalTitle === 'Lewis Tan');
  assert.ok(lewis);
  assert.ok(data.characters.some(c => c.title === 'Cole Young' && c.portrayedBy === lewis.title));
  assert.ok(data.characters.some(c => c.originalTitle === 'Scorpion'));
  assert.ok(data.people.some(p => p.originalTitle === 'Simon McQuoid'));
  assert.equal(await loadFilmCredits('https://www.imdb.com/name/nm1234567/', '真人快打'), null);
  const merged = mergeFilmCredits(data, {
    films: [], characters: [], sources: ['IMDb'],
    people: [{ ...lewis, externalId: 'imdb-actor', sourceUrl: undefined, title: 'Lewis Tan', originalTitle: undefined, coverUrl: 'https://example.org/lewis.jpg' }],
  });
  assert.equal(merged.people.length, data.people.length);
  assert.equal(merged.people.find(p => p.originalTitle === 'Lewis Tan')?.coverUrl, 'https://example.org/lewis.jpg');
  assert.equal(merged.characters.length, data.characters.length);
});

test('shared characters keep multiple performers and one performer keeps multiple roles', () => {
  const data = decodeFilmCredits([
    ['cast', 'Q1', '甲', '', 'Q3', '主角', ''],
    ['cast', 'Q2', '乙', '', 'Q3', '主角', ''],
    ['cast', 'Q1', '甲', '', '', '旁白', ''],
  ], 'tt1234567', '作品');
  assert.equal(data.people.length, 2);
  assert.equal(data.characters.length, 2);
  assert.equal(data.characters[0].portrayedBy, '甲 / 乙');
  assert.match(data.people[0].subtitle!, /旁白/);
});

test('unindexed title accepts only cast statements for the requested IMDb ID', async () => {
  const fetch = globalThis.fetch;
  const id = 'tt999999999';
  const binding = (imdb: string, name: string) => ({
    id: { value: imdb }, person: { value: 'http://www.wikidata.org/entity/Q123' },
    personLabel: { value: name }, name: { value: '角色甲' }, job: { value: 'cast' },
  });
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get('query');
    assert.ok(query?.includes(id));
    return Response.json({ results: { bindings: [binding(id, '演员甲'), binding('tt1111111', '同名片演员')] } });
  };
  try {
    const data = await withFilmCredits({ title: '索引外的作品', sourceUrl: 'https://www.imdb.com/title/' + id + '/' },
      Promise.resolve({ sources: [], films: [], people: [], characters: [] }));
    assert.deepEqual(data.people.map(row => row.title), ['演员甲']);
    assert.equal(data.characters[0].portrayedBy, '演员甲');
  } finally {
    globalThis.fetch = fetch;
  }
});
