import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAWER_TIMINGS,
  getDrawerBackdropVariants,
  getDrawerContentVariants,
  getDrawerMetaFadeVariants,
  getDrawerPanelVariants,
  getSwitchOffsetX,
} from './drawerMotion';

test('getDrawerPanelVariants slides smoothly from right edge when motion is enabled', () => {
  const variants = getDrawerPanelVariants(false);
  assert.equal(variants.closed.x, '100%');
  assert.equal(variants.open.x, 0);
  assert.equal(variants.open.opacity, 1);
  assert.equal(variants.open.transition.duration, DRAWER_TIMINGS.panelEnterSec);
  assert.equal(variants.closed.transition.duration, DRAWER_TIMINGS.panelExitSec);
});

test('getDrawerPanelVariants disables horizontal slide when reduced motion is preferred', () => {
  const variants = getDrawerPanelVariants(true);
  assert.equal(variants.closed.x, 0);
  assert.equal(variants.open.x, 0);
  assert.ok(variants.open.transition.duration <= 0.02);
  assert.ok(variants.closed.transition.duration <= 0.02);
});

test('getDrawerBackdropVariants fades backdrop in and out smoothly', () => {
  const normal = getDrawerBackdropVariants(false);
  assert.equal(normal.closed.opacity, 0);
  assert.equal(normal.open.opacity, 1);
  assert.ok(normal.open.transition.duration > 0.15);

  const reduced = getDrawerBackdropVariants(true);
  assert.ok(reduced.open.transition.duration <= 0.02);
});

test('getSwitchOffsetX computes directional subtle offsets for prev/next/neutral transitions', () => {
  assert.equal(getSwitchOffsetX('next', 'enter', false), DRAWER_TIMINGS.contentDriftPx);
  assert.equal(getSwitchOffsetX('next', 'exit', false), -DRAWER_TIMINGS.contentDriftPx);
  assert.equal(getSwitchOffsetX('prev', 'enter', false), -DRAWER_TIMINGS.contentDriftPx);
  assert.equal(getSwitchOffsetX('prev', 'exit', false), DRAWER_TIMINGS.contentDriftPx);
  assert.equal(getSwitchOffsetX('neutral', 'enter', false), 0);
  assert.equal(getSwitchOffsetX('neutral', 'exit', false), 0);
  assert.equal(getSwitchOffsetX('next', 'enter', true), 0);
  assert.equal(getSwitchOffsetX('prev', 'exit', true), 0);
});

test('getDrawerContentVariants produces subtle fade-out and fade-in transitions for prev/next switching', () => {
  const variants = getDrawerContentVariants(false);
  const nextEnter = variants.enter('next');
  const nextExit = variants.exit('next');
  assert.equal(nextEnter.opacity, 0);
  assert.ok(nextEnter.x > 0);
  assert.equal(nextExit.opacity, 0);
  assert.ok(nextExit.x < 0);
  assert.equal(variants.center.opacity, 1);
  assert.equal(variants.center.x, 0);

  const prevEnter = variants.enter('prev');
  const prevExit = variants.exit('prev');
  assert.ok(prevEnter.x < 0);
  assert.ok(prevExit.x > 0);

  const reduced = getDrawerContentVariants(true);
  assert.equal(reduced.enter('next').opacity, 1);
  assert.equal(reduced.enter('next').x, 0);
  assert.equal(reduced.exit('prev').opacity, 1);
  assert.equal(reduced.exit('prev').x, 0);
});

test('getDrawerMetaFadeVariants fades header metadata cleanly', () => {
  const normal = getDrawerMetaFadeVariants(false);
  assert.equal(normal.enter.opacity, 0);
  assert.equal(normal.center.opacity, 1);
  assert.equal(normal.exit.opacity, 0);

  const reduced = getDrawerMetaFadeVariants(true);
  assert.equal(reduced.enter.opacity, 1);
  assert.equal(reduced.exit.opacity, 1);
});
