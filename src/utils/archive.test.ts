import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_COLLECTION } from '../data/seedCollection';
import {
  buildProxyImageUrl,
  computeArchiveStats,
  filterAndSortItems,
  findAutoLinkIds,
  findExistingItemByTitle,
  formatRelatedSummary,
  getRelatedItems,
  hasValidationErrors,
  isAlreadyCollected,
  mergeImportedItems,
  nextAccessionNo,
  parseImportPayload,
  parseTagsInput,
  validateArchiveInput,
} from './archive';

test('filterAndSortItems filters by category, status, and query text', () => {
  const characters = filterAndSortItems(SEED_COLLECTION, {
    category: 'character',
    status: 'all',
    query: '',
    sortBy: 'recent',
  });
  assert.equal(characters.length, 2);
  assert.ok(characters.some((c) => c.title === '周慕云'));
  assert.ok(characters.some((c) => c.title === '无脸男'));

  const queryHit = filterAndSortItems(SEED_COLLECTION, {
    category: 'all',
    status: 'all',
    query: '船票',
    sortBy: 'recent',
  });
  assert.equal(queryHit.length, 1);
  assert.equal(queryHit[0].title, '周慕云');

  const favorites = filterAndSortItems(SEED_COLLECTION, {
    category: 'all',
    status: 'favorite',
    query: '',
    sortBy: 'year',
  });
  assert.equal(favorites.length, 4);
  assert.equal(favorites[0].year, '2000');

  const tagged = filterAndSortItems(SEED_COLLECTION, {
    category: 'all',
    status: 'all',
    tag: '吉卜力',
    query: '',
    sortBy: 'recent',
  });
  assert.ok(tagged.length >= 1);
  assert.ok(tagged.every((i) => i.tags.includes('吉卜力')));
});

test('getRelatedItems resolves bidirectional explicit and inferred cross-entity links', () => {
  const chow = SEED_COLLECTION.find((i) => i.id === 'seed-char-chow-mowan');
  assert.ok(chow);
  const relatedToChow = getRelatedItems(chow, SEED_COLLECTION);
  const titles = relatedToChow.map((i) => i.title);
  assert.ok(titles.includes('花样年华'));
  assert.ok(titles.includes('梁朝伟'));

  const film = SEED_COLLECTION.find((i) => i.id === 'seed-film-spirited-away');
  assert.ok(film);
  const relatedToFilm = getRelatedItems(film, SEED_COLLECTION);
  assert.equal(relatedToFilm.length, 1);
  assert.equal(relatedToFilm[0].title, '无脸男');
});

test('computeArchiveStats computes accurate category counts and average rating', () => {
  const stats = computeArchiveStats(SEED_COLLECTION);
  assert.equal(stats.total, 6);
  assert.equal(stats.film, 2);
  assert.equal(stats.person, 2);
  assert.equal(stats.character, 2);
  assert.equal(stats.favorites, 4);
  assert.equal(stats.averageRating, 5);
});

test('validateArchiveInput rejects blank title, invalid year, and invalid cover URL', () => {
  const blankErr = validateArchiveInput({
    category: 'film',
    title: '   ',
    rating: 4,
    status: 'watched',
    tags: [],
  });
  assert.equal(hasValidationErrors(blankErr), true);
  assert.ok(blankErr.title);

  const badYearErr = validateArchiveInput({
    category: 'film',
    title: '重庆森林',
    year: '99',
    rating: 5,
    status: 'favorite',
    tags: [],
    coverUrl: 'ftp://invalid.example.com/a.jpg',
  });
  assert.ok(badYearErr.year);
  assert.ok(badYearErr.coverUrl);

  const okErr = validateArchiveInput({
    category: 'character',
    title: '甄嬛',
    year: '2011',
    rating: 5,
    status: 'favorite',
    tags: ['古装'],
    coverUrl: 'https://example.com/poster.jpg',
  });
  assert.equal(hasValidationErrors(okErr), false);
});

test('buildProxyImageUrl proxies external HTTP(S) URLs and keeps local assets intact', () => {
  assert.equal(
    buildProxyImageUrl('/src/assets/images/test.jpg'),
    '/src/assets/images/test.jpg'
  );
  assert.equal(
    buildProxyImageUrl('https://lain.bgm.tv/pic/cover/l/test.jpg'),
    '/api/img-proxy?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fl%2Ftest.jpg'
  );
  assert.equal(
    buildProxyImageUrl('/api/img-proxy?url=abc'),
    '/api/img-proxy?url=abc'
  );
});

test('nextAccessionNo, parseTagsInput, isAlreadyCollected, and backup import/merge', () => {
  assert.equal(nextAccessionNo(SEED_COLLECTION), 'CA-007');
  assert.deepEqual(parseTagsInput('港片美学，慢镜头, 港片美学 / 王家卫'), [
    '港片美学',
    '慢镜头',
    '王家卫',
  ]);
  assert.equal(isAlreadyCollected(SEED_COLLECTION, 'film', '花样年华'), true);
  assert.equal(isAlreadyCollected(SEED_COLLECTION, 'film', '重庆森林'), false);

  const payload = JSON.stringify({
    version: 1,
    items: [
      {
        id: 'seed-film-mood-for-love',
        category: 'film',
        title: '花样年华',
        summary: 'duplicate',
      },
      {
        id: 'new-film-chungking',
        category: 'film',
        title: '重庆森林',
        year: '1994',
        summary: '两位失恋警察的故事',
        rating: 5,
        status: 'favorite',
        tags: ['王家卫'],
      },
    ],
  });

  const parsed = parseImportPayload(payload);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.items.length, 2);

  const { merged, addedCount, skippedCount } = mergeImportedItems(
    SEED_COLLECTION,
    parsed.items
  );
  assert.equal(addedCount, 1);
  assert.equal(skippedCount, 1);
  assert.equal(merged.length, 7);
  assert.equal(merged[0].accessionNo, 'CA-007');
});

test('findExistingItemByTitle, findAutoLinkIds, and formatRelatedSummary handle cross-entity relations', () => {
  const film = findExistingItemByTitle(SEED_COLLECTION, 'film', ' 花样年华 ');
  assert.ok(film);
  assert.equal(film.id, 'seed-film-mood-for-love');
  assert.equal(findExistingItemByTitle(SEED_COLLECTION, 'person', '花样年华'), undefined);

  // New character referencing an existing film and actor auto-links to both
  const autoIds = findAutoLinkIds(
    {
      title: '苏丽珍',
      category: 'character',
      relatedWorkTitle: '花样年华',
      portrayedBy: '梁朝伟',
    },
    SEED_COLLECTION
  );
  assert.ok(autoIds.includes('seed-film-mood-for-love'));
  assert.ok(autoIds.includes('seed-person-tony-leung'));

  // New film matching an existing character's relatedWorkTitle auto-links
  const reverseIds = findAutoLinkIds(
    {
      title: '千与千寻',
      category: 'film',
    },
    SEED_COLLECTION
  );
  assert.ok(reverseIds.includes('seed-char-no-face'));

  // Summary formatting shows explicit category breakdown
  const summary = formatRelatedSummary([
    SEED_COLLECTION[0], // film
    SEED_COLLECTION[2], // person
    SEED_COLLECTION[4], // character
  ]);
  assert.equal(summary, '1 影视 · 1 影人 · 1 角色');
  assert.equal(formatRelatedSummary([]), '');
});

test('findExistingItemByTitle and isAlreadyCollected match cross-language title/originalTitle and respect film years', () => {
  const customLib = [
    {
      ...SEED_COLLECTION[2],
      id: 'person-austin',
      category: 'person' as const,
      title: '奥斯汀·艾布拉姆斯',
      originalTitle: 'Austin Abrams',
      sourceUrl: 'https://www.imdb.com/name/nm3641002/',
    },
    {
      ...SEED_COLLECTION[0],
      id: 'film-re-2026',
      category: 'film' as const,
      title: '生化危机：爆发夜',
      originalTitle: 'Resident Evil',
      year: '2026',
      sourceUrl: 'https://www.imdb.com/title/tt31973693/',
    },
  ];

  // English cast name from IMDb matches existing Chinese person record via originalTitle
  const hitByEnglish = findExistingItemByTitle(customLib, 'person', 'Austin Abrams');
  assert.equal(hitByEnglish?.id, 'person-austin');
  assert.equal(isAlreadyCollected(customLib, 'person', 'Austin Abrams'), true);

  // Chinese search result with English originalTitle matches even with punctuation differences
  const hitByOrig = findExistingItemByTitle(customLib, 'person', '奥斯汀 艾布拉姆斯', {
    originalTitle: 'Austin Abrams',
  });
  assert.equal(hitByOrig?.id, 'person-austin');

  // Same-year Resident Evil matches existing 2026 film, while 2002 remake does NOT collide
  assert.equal(
    findExistingItemByTitle(customLib, 'film', 'Resident Evil', { year: '2026' })?.id,
    'film-re-2026'
  );
  assert.equal(
    findExistingItemByTitle(customLib, 'film', 'Resident Evil', { year: '2002' }),
    undefined
  );
});


