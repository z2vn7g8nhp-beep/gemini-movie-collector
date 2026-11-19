import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REMINDER_PREFS,
  evaluateDailyCheckInReminder,
  msUntilNextLocalMidnight,
} from './checkInReminder';

test('evaluateDailyCheckInReminder shows banner and top icon on first visit without today check-in', () => {
  const result = evaluateDailyCheckInReminder(
    [],
    '2026-11-18',
    DEFAULT_REMINDER_PREFS
  );

  assert.equal(result.needsCheckIn, true);
  assert.equal(result.shouldShowBanner, true);
  assert.equal(result.shouldShowTopIcon, true);
  assert.equal(result.shouldFireBrowserNotification, false);
  assert.equal(result.ctaLabel, '立即盖章');
  assert.match(result.headline, /巡馆盖章/);
});

test('evaluateDailyCheckInReminder encourages streak continuation when checked in yesterday', () => {
  const result = evaluateDailyCheckInReminder(
    ['2026-11-16', '2026-11-17'],
    '2026-11-18',
    {
      dismissedDate: null,
      browserNotifyEnabled: true,
      lastNotifiedDate: '2026-11-17',
    }
  );

  assert.equal(result.needsCheckIn, true);
  assert.equal(result.streakDays, 2);
  assert.equal(result.shouldFireBrowserNotification, true);
  assert.match(result.headline, /连续巡馆 2 天/);
  assert.match(result.encouragement, /连续 3 天/);
});

test('evaluateDailyCheckInReminder hides banner and icon once today check-in is complete', () => {
  const result = evaluateDailyCheckInReminder(
    ['2026-11-17', '2026-11-18'],
    '2026-11-18',
    {
      dismissedDate: null,
      browserNotifyEnabled: true,
      lastNotifiedDate: null,
    }
  );

  assert.equal(result.needsCheckIn, false);
  assert.equal(result.shouldShowBanner, false);
  assert.equal(result.shouldShowTopIcon, false);
  assert.equal(result.shouldFireBrowserNotification, false);
});

test('evaluateDailyCheckInReminder respects same-day dismissal and notification dedup, resetting next day', () => {
  const prefs = {
    dismissedDate: '2026-11-18',
    browserNotifyEnabled: true,
    lastNotifiedDate: '2026-11-18',
  };

  const todayResult = evaluateDailyCheckInReminder([], '2026-11-18', prefs);
  assert.equal(todayResult.needsCheckIn, true);
  assert.equal(todayResult.shouldShowBanner, false);
  assert.equal(todayResult.shouldShowTopIcon, true);
  assert.equal(todayResult.shouldFireBrowserNotification, false);

  const nextDayResult = evaluateDailyCheckInReminder([], '2026-11-19', prefs);
  assert.equal(nextDayResult.needsCheckIn, true);
  assert.equal(nextDayResult.shouldShowBanner, true);
  assert.equal(nextDayResult.shouldShowTopIcon, true);
  assert.equal(nextDayResult.shouldFireBrowserNotification, true);
});

test('msUntilNextLocalMidnight returns positive duration bounded within 24h + 5s', () => {
  const nearMidnight = new Date(2026, 10, 18, 23, 59, 0, 0);
  const msNear = msUntilNextLocalMidnight(nearMidnight);
  assert.equal(msNear, 65_000);

  const morning = new Date(2026, 10, 18, 9, 0, 0, 0);
  const msMorning = msUntilNextLocalMidnight(morning);
  assert.ok(msMorning > 0 && msMorning <= 24 * 60 * 60 * 1000 + 5000);
});
