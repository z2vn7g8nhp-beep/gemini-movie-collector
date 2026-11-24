import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAWER_TIMINGS,
  completeDrawerExit,
  getContentSwitchClass,
  getDrawerExitDurationMs,
  getDrawerMotionClasses,
  getSecondaryHydrateDelayMs,
  getSwitchOffsetX,
  resolveNextDrawerPresence,
} from './drawerMotion';

test('resolveNextDrawerPresence opens immediately from closed state', () => {
  const next = resolveNextDrawerPresence(
    { phase: 'closed', renderedItemId: null },
    'film-1',
    false
  );
  assert.deepEqual(next, { phase: 'open', renderedItemId: 'film-1' });
});

test('resolveNextDrawerPresence enters closing phase while retaining item id on close', () => {
  const closing = resolveNextDrawerPresence(
    { phase: 'open', renderedItemId: 'film-1' },
    null,
    false
  );
  assert.deepEqual(closing, { phase: 'closing', renderedItemId: 'film-1' });

  const closed = completeDrawerExit(closing);
  assert.deepEqual(closed, { phase: 'closed', renderedItemId: null });
});

test('resolveNextDrawerPresence cancels closing immediately if user selects another archive mid-exit', () => {
  const closing = resolveNextDrawerPresence(
    { phase: 'open', renderedItemId: 'film-1' },
    null,
    false
  );
  const reopened = resolveNextDrawerPresence(closing, 'film-2', false);
  assert.deepEqual(reopened, { phase: 'open', renderedItemId: 'film-2' });

  // Stale exit timer completion must not close an active open drawer
  assert.deepEqual(completeDrawerExit(reopened), {
    phase: 'open',
    renderedItemId: 'film-2',
  });
});

test('resolveNextDrawerPresence closes immediately when reduced motion is enabled', () => {
  const closed = resolveNextDrawerPresence(
    { phase: 'open', renderedItemId: 'film-1' },
    null,
    true
  );
  assert.deepEqual(closed, { phase: 'closed', renderedItemId: null });
  assert.equal(getDrawerExitDurationMs(true), 0);
  assert.equal(getDrawerExitDurationMs(false), DRAWER_TIMINGS.panelExitMs);
});

test('getDrawerMotionClasses maps open and closing phases to compositor CSS animation classes', () => {
  assert.deepEqual(getDrawerMotionClasses('open', false), {
    backdrop: 'detail-drawer-backdrop-in',
    panel: 'detail-drawer-panel-in',
  });
  assert.deepEqual(getDrawerMotionClasses('closing', false), {
    backdrop: 'detail-drawer-backdrop-out',
    panel: 'detail-drawer-panel-out',
  });
  assert.deepEqual(getDrawerMotionClasses('open', true), {
    backdrop: '',
    panel: '',
  });
  assert.deepEqual(getDrawerMotionClasses('closed', false), {
    backdrop: '',
    panel: '',
  });
});

test('getSecondaryHydrateDelayMs defers heavy below-the-fold hydration only on initial animated open', () => {
  assert.equal(
    getSecondaryHydrateDelayMs(false, false),
    DRAWER_TIMINGS.secondaryHydrateDelayMs
  );
  assert.equal(getSecondaryHydrateDelayMs(false, true), 0);
  assert.equal(getSecondaryHydrateDelayMs(true, false), 0);
});

test('getContentSwitchClass and getSwitchOffsetX produce directional classes only when switching items', () => {
  assert.equal(getContentSwitchClass('next', false, true), '');
  assert.equal(
    getContentSwitchClass('next', false, false),
    'detail-content-switch-next'
  );
  assert.equal(
    getContentSwitchClass('prev', false, false),
    'detail-content-switch-prev'
  );
  assert.equal(
    getContentSwitchClass('neutral', false, false),
    'detail-content-switch-neutral'
  );
  assert.equal(getContentSwitchClass('next', true, false), '');

  assert.equal(getSwitchOffsetX('next', false), DRAWER_TIMINGS.contentDriftPx);
  assert.equal(getSwitchOffsetX('prev', false), -DRAWER_TIMINGS.contentDriftPx);
  assert.equal(getSwitchOffsetX('neutral', false), 0);
  assert.equal(getSwitchOffsetX('next', true), 0);
});
