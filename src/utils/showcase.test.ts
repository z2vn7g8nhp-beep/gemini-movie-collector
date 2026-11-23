import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_COLLECTION } from '../data/seedCollection';
import {
  computeWarmGlowAnchor,
  DEFAULT_SHOWCASE_CONFIG,
  DEFAULT_WARM_GLOW_ANCHOR,
  getSecondaryFavorites,
  getSecondaryQuotes,
  getSecondaryRecent,
  isShowcaseCustomized,
  normalizeShowcaseConfig,
  resolvePrimaryShowcase,
} from './showcase';

test('normalizeShowcaseConfig falls back safely on invalid or empty inputs', () => {
  assert.deepEqual(normalizeShowcaseConfig(undefined), DEFAULT_SHOWCASE_CONFIG);
  assert.deepEqual(
    normalizeShowcaseConfig({
      primaryMode: 'invalid-mode' as never,
      secondaryMode: 'unknown' as never,
      customCoverUrl: 'javascript:alert(1)',
      customLabel: '   ',
    }),
    DEFAULT_SHOWCASE_CONFIG
  );

  const valid = normalizeShowcaseConfig({
    primaryMode: 'pinned',
    pinnedItemId: '  seed-1 ',
    customLabel: ' 镇馆之宝 ',
    customQuote: ' 念念不忘，必有回响 ',
    customCoverUrl: 'https://example.com/poster.jpg',
    secondaryMode: 'quotes',
  });
  assert.equal(valid.primaryMode, 'pinned');
  assert.equal(valid.pinnedItemId, 'seed-1');
  assert.equal(valid.customLabel, '镇馆之宝');
  assert.equal(valid.customQuote, '念念不忘，必有回响');
  assert.equal(valid.customCoverUrl, 'https://example.com/poster.jpg');
  assert.equal(valid.secondaryMode, 'quotes');
  assert.equal(isShowcaseCustomized(valid), true);
  assert.equal(isShowcaseCustomized(DEFAULT_SHOWCASE_CONFIG), false);
});

test('resolvePrimaryShowcase supports pinned mode and falls back cleanly if item is deleted', () => {
  const target = SEED_COLLECTION[2];
  const resolved = resolvePrimaryShowcase(
    SEED_COLLECTION,
    {
      primaryMode: 'pinned',
      pinnedItemId: target.id,
      customLabel: '私藏首推',
      customTitle: '遗留的自定义展签标题',
      customCoverUrl: '/assets/stale.jpg',
      customQuote: '今年最难忘的一帧',
      secondaryMode: 'albums',
    },
    '2026-11-22'
  );
  assert.ok(resolved);
  assert.equal(resolved.item?.id, target.id);
  assert.equal(resolved.title, target.title);
  assert.equal(resolved.coverUrl, target.coverUrl);
  assert.equal(resolved.badgeText, '私藏首推');
  assert.equal(resolved.quote, '今年最难忘的一帧');
  assert.equal(resolved.canShuffle, false);
  assert.equal(resolved.fallbackHint, undefined);

  // Deleted pinned item should fall back without crashing
  const fallback = resolvePrimaryShowcase(
    SEED_COLLECTION,
    {
      primaryMode: 'pinned',
      pinnedItemId: 'deleted-nonexistent-id',
      secondaryMode: 'albums',
    },
    '2026-11-22'
  );
  assert.ok(fallback);
  assert.ok(fallback.item);
  assert.ok(fallback.fallbackHint);
  assert.equal(fallback.canShuffle, true);
});

test('resolvePrimaryShowcase filters favorites and watching pools accurately', () => {
  const favResolved = resolvePrimaryShowcase(
    SEED_COLLECTION,
    { primaryMode: 'favorites', secondaryMode: 'albums' },
    '2026-11-22',
    0
  );
  assert.ok(favResolved?.item);
  assert.equal(favResolved.item.status, 'favorite');
  assert.equal(favResolved.badgeText, '挚爱精选');

  const itemsWithWatchlist = SEED_COLLECTION.map((it, idx) =>
    idx === 1 ? { ...it, status: 'watching' as const } : { ...it, status: 'watched' as const }
  );
  const watchingResolved = resolvePrimaryShowcase(
    itemsWithWatchlist,
    { primaryMode: 'watching', secondaryMode: 'albums' },
    '2026-11-22',
    0
  );
  assert.ok(watchingResolved?.item);
  assert.equal(watchingResolved.item.id, itemsWithWatchlist[1].id);
  assert.equal(watchingResolved.badgeText, '近期在追');
  assert.equal(watchingResolved.canShuffle, false);
});

test('resolvePrimaryShowcase supports custom exhibition card even when collection is empty', () => {
  const customOnly = resolvePrimaryShowcase(
    [],
    {
      primaryMode: 'custom',
      customLabel: '秋季特展',
      customTitle: '香港新浪潮光影回顾',
      customSubtitle: '1980s — 2000s',
      customQuote: '留住胶片里的霓虹与旧梦',
      customCoverUrl: '/assets/custom.jpg',
      secondaryMode: 'hidden',
    },
    '2026-11-22'
  );
  assert.ok(customOnly);
  assert.equal(customOnly.isCustomOnly, true);
  assert.equal(customOnly.item, null);
  assert.equal(customOnly.badgeText, '秋季特展');
  assert.equal(customOnly.title, '香港新浪潮光影回顾');
  assert.equal(customOnly.subtitle, '1980s — 2000s');
  assert.equal(customOnly.coverUrl, '/assets/custom.jpg');
});

test('secondary widget selectors return ranked favorites, prioritized quotes, and latest items', () => {
  const favs = getSecondaryFavorites(SEED_COLLECTION, 4);
  assert.equal(favs.length, 4);
  assert.equal(favs[0].status, 'favorite');

  const quotes = getSecondaryQuotes(SEED_COLLECTION);
  assert.ok(quotes.length > 0);
  assert.equal(quotes[0].isQuote, true);

  const recent = getSecondaryRecent(SEED_COLLECTION, 3);
  assert.equal(recent.length, 3);
  assert.ok(recent[0].createdAt >= recent[1].createdAt);
});

test('computeWarmGlowAnchor normalizes and clamps pointer positions safely', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  assert.deepEqual(computeWarmGlowAnchor(300, 150, rect), {
    xPercent: '50%',
    yPercent: '50%',
  });

  // Edge and out-of-bounds values clamp within [8%, 92%]
  assert.deepEqual(computeWarmGlowAnchor(80, 40, rect), {
    xPercent: '8%',
    yPercent: '8%',
  });
  assert.deepEqual(computeWarmGlowAnchor(600, 300, rect), {
    xPercent: '92%',
    yPercent: '92%',
  });

  // Zero or invalid geometry falls back cleanly
  assert.deepEqual(
    computeWarmGlowAnchor(200, 100, { left: 0, top: 0, width: 0, height: 200 }),
    DEFAULT_WARM_GLOW_ANCHOR
  );
  assert.deepEqual(
    computeWarmGlowAnchor(Number.NaN, 100, rect),
    DEFAULT_WARM_GLOW_ANCHOR
  );
});
