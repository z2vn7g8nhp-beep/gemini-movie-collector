import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LONG_PRESS_MOVE_THRESHOLD_PX,
  buildQuickStatusNotice,
  computeQuickMenuPosition,
  getQuickStatusOptions,
  isPointerDragExceeded,
} from './quickStatusMenu';

test('getQuickStatusOptions returns category-aware labels for film vs person/character', () => {
  const filmOpts = getQuickStatusOptions('film');
  assert.deepEqual(
    filmOpts.map((o) => [o.id, o.label]),
    [
      ['favorite', '挚爱'],
      ['watched', '已看'],
      ['watching', '在追'],
      ['watchlist', '想看'],
    ]
  );

  const personOpts = getQuickStatusOptions('person');
  assert.deepEqual(
    personOpts.map((o) => [o.id, o.label]),
    [
      ['favorite', '挚爱'],
      ['watched', '已收录'],
      ['watching', '关注中'],
      ['watchlist', '待补档'],
    ]
  );

  const charOpts = getQuickStatusOptions('character');
  assert.equal(charOpts.length, 4);
  assert.equal(charOpts[3].label, '待补档');
});

test('isPointerDragExceeded detects pointer movement beyond threshold', () => {
  assert.equal(
    isPointerDragExceeded({ x: 100, y: 100 }, { x: 105, y: 105 }),
    false
  );
  assert.equal(
    isPointerDragExceeded(
      { x: 100, y: 100 },
      { x: 100 + LONG_PRESS_MOVE_THRESHOLD_PX, y: 100 }
    ),
    false
  );
  assert.equal(
    isPointerDragExceeded(
      { x: 100, y: 100 },
      { x: 100 + LONG_PRESS_MOVE_THRESHOLD_PX + 1, y: 100 }
    ),
    true
  );
  assert.equal(
    isPointerDragExceeded({ x: 50, y: 50 }, { x: 58, y: 58 }),
    true
  );
});

test('computeQuickMenuPosition keeps popover clamped within viewport bounds', () => {
  const menuSize = { width: 256, height: 280 };
  const viewport = { width: 1440, height: 900 };

  // Center anchor places horizontally centered and slightly below press point
  const centerPos = computeQuickMenuPosition({ x: 700, y: 300 }, menuSize, viewport);
  assert.equal(centerPos.left, 700 - 128);
  assert.equal(centerPos.top, 312);

  // Near left edge clamps to safe margin
  const leftEdge = computeQuickMenuPosition({ x: 20, y: 200 }, menuSize, viewport);
  assert.equal(leftEdge.left, 12);
  assert.equal(leftEdge.top, 212);

  // Near right & bottom edge flips above and clamps inside viewport
  const bottomRight = computeQuickMenuPosition({ x: 1420, y: 860 }, menuSize, viewport);
  assert.equal(bottomRight.left, 1440 - 256 - 12);
  assert.equal(bottomRight.top, 860 - 280 - 12);

  // Near top/bottom in tight viewport clamps cleanly inside safe margins
  const tightViewport = { width: 320, height: 340 };
  const cramped = computeQuickMenuPosition({ x: 160, y: 260 }, menuSize, tightViewport);
  assert.ok(cramped.left >= 12);
  assert.ok(cramped.top >= 12);
  assert.ok(cramped.left + menuSize.width <= tightViewport.width - 12);
  assert.ok(cramped.top + menuSize.height <= tightViewport.height - 12);

  // Even if viewport is shorter than menu + 2*margin, top stays pinned at safeMargin
  const ultraShort = computeQuickMenuPosition({ x: 160, y: 200 }, menuSize, {
    width: 320,
    height: 290,
  });
  assert.equal(ultraShort.top, 12);
});

test('buildQuickStatusNotice formats changed and unchanged feedback messages', () => {
  assert.equal(
    buildQuickStatusNotice('花样年华', 'favorite', 'film', true),
    '已将「花样年华」标记为「挚爱」'
  );
  assert.equal(
    buildQuickStatusNotice('花样年华', 'watched', 'film', false),
    '「花样年华」当前已是「已看」'
  );
  assert.equal(
    buildQuickStatusNotice('王家卫', 'watching', 'person', true),
    '已将「王家卫」标记为「关注中」'
  );
});
