import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_COLLECTION } from '../data/seedCollection';
import {
  addTagToList,
  collectTagRegistry,
  getItemsByTag,
  getTagAutocompleteSuggestions,
  itemHasTag,
  normalizeTagName,
  removeTagFromList,
} from './tags';

test('normalizeTagName trims whitespace, strips leading hashes, and caps length', () => {
  assert.equal(normalizeTagName('  #漫威  '), '漫威');
  assert.equal(normalizeTagName('＃港片  美学'), '港片 美学');
  assert.equal(normalizeTagName('   '), '');
  assert.equal(normalizeTagName('一二三四五六七八九十一二三四五六七八九十一二三四五六').length, 24);
});

test('collectTagRegistry counts unique tags across collection and sorts by frequency', () => {
  const items = [
    { ...SEED_COLLECTION[0], tags: ['王家卫', '港片美学', '漫威'] },
    { ...SEED_COLLECTION[1], tags: ['漫威', '科幻'] },
    { ...SEED_COLLECTION[2], tags: ['漫威', '港片美学'] },
  ];

  const registry = collectTagRegistry(items);
  assert.equal(registry[0].name, '漫威');
  assert.equal(registry[0].count, 3);
  assert.equal(registry[1].name, '港片美学');
  assert.equal(registry[1].count, 2);
  assert.ok(registry.some((r) => r.name === '科幻' && r.count === 1));
});

test('getTagAutocompleteSuggestions ranks exact > prefix > contains and excludes already-attached tags', () => {
  const registry = [
    { name: '漫威电影宇宙', count: 5, categories: ['film' as const] },
    { name: '漫威', count: 2, categories: ['film' as const] },
    { name: '超级漫威粉', count: 4, categories: ['character' as const] },
    { name: '港片美学', count: 6, categories: ['film' as const] },
  ];

  // Empty query returns popular tags excluding already attached ones
  const popular = getTagAutocompleteSuggestions('', ['港片美学'], registry);
  assert.deepEqual(
    popular.map((s) => s.name),
    ['漫威电影宇宙', '漫威', '超级漫威粉']
  );

  // Typed query ranks exact > prefix > contains
  const matched = getTagAutocompleteSuggestions('漫威', [], registry);
  assert.deepEqual(
    matched.map((s) => s.name),
    ['漫威', '漫威电影宇宙', '超级漫威粉']
  );
  assert.equal(matched[0].matchType, 'exact');
  assert.equal(matched[1].matchType, 'prefix');
  assert.equal(matched[2].matchType, 'contains');

  // Excludes tags already on current item case-insensitively
  const filtered = getTagAutocompleteSuggestions('漫威', ['漫威'], registry);
  assert.deepEqual(
    filtered.map((s) => s.name),
    ['漫威电影宇宙', '超级漫威粉']
  );
});

test('addTagToList and removeTagFromList handle multi-tag input, deduplication, and max limit', () => {
  const res1 = addTagToList(['电影'], '漫威、欧美, 电影');
  assert.deepEqual(res1.tags, ['电影', '漫威', '欧美']);
  assert.deepEqual(res1.added, ['漫威', '欧美']);
  assert.equal(res1.duplicate, undefined);

  const dup = addTagToList(['电影', '漫威'], '#漫威');
  assert.deepEqual(dup.tags, ['电影', '漫威']);
  assert.deepEqual(dup.added, []);
  assert.equal(dup.duplicate, '漫威');

  const capped = addTagToList(['a', 'b'], 'c, d', 3);
  assert.deepEqual(capped.tags, ['a', 'b', 'c']);
  assert.equal(capped.limitReached, true);

  const removed = removeTagFromList(['电影', '漫威', 'MCU'], 'mcu');
  assert.deepEqual(removed, ['电影', '漫威']);
});

test('getItemsByTag and itemHasTag match collection items case-insensitively', () => {
  const items = [
    { ...SEED_COLLECTION[0], id: 'i1', tags: ['MCU', '漫威'] },
    { ...SEED_COLLECTION[1], id: 'i2', tags: ['mcu', '反派'] },
    { ...SEED_COLLECTION[2], id: 'i3', tags: ['港片'] },
  ];

  assert.equal(itemHasTag(items[1], 'MCU'), true);
  assert.equal(itemHasTag(items[2], 'MCU'), false);

  const allMcu = getItemsByTag(items, 'MCU');
  assert.deepEqual(
    allMcu.map((i) => i.id),
    ['i1', 'i2']
  );

  const peersOnly = getItemsByTag(items, 'MCU', 'i1');
  assert.deepEqual(
    peersOnly.map((i) => i.id),
    ['i2']
  );
});
