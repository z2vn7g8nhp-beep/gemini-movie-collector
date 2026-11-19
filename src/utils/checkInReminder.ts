import { computeCheckInStreak } from './collector';

export interface CheckInReminderPrefs {
  dismissedDate: string | null;
  browserNotifyEnabled: boolean;
  lastNotifiedDate: string | null;
}

export interface DailyCheckInReminderState {
  needsCheckIn: boolean;
  shouldShowBanner: boolean;
  shouldShowTopIcon: boolean;
  shouldFireBrowserNotification: boolean;
  headline: string;
  encouragement: string;
  ctaLabel: string;
  streakDays: number;
  totalDays: number;
}

export type BrowserNotificationPermissionState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied';

export const CHECKIN_REMINDER_STORAGE_KEY = 'cinearchive.checkin-reminder.v1';

export const DEFAULT_REMINDER_PREFS: CheckInReminderPrefs = {
  dismissedDate: null,
  browserNotifyEnabled: false,
  lastNotifiedDate: null,
};

export function loadCheckInReminderPrefs(): CheckInReminderPrefs {
  if (typeof window === 'undefined') return DEFAULT_REMINDER_PREFS;
  try {
    const raw = window.localStorage.getItem(CHECKIN_REMINDER_STORAGE_KEY);
    if (!raw) return DEFAULT_REMINDER_PREFS;
    const parsed = JSON.parse(raw) as Partial<CheckInReminderPrefs>;
    return {
      dismissedDate:
        typeof parsed.dismissedDate === 'string' ? parsed.dismissedDate : null,
      browserNotifyEnabled: Boolean(parsed.browserNotifyEnabled),
      lastNotifiedDate:
        typeof parsed.lastNotifiedDate === 'string'
          ? parsed.lastNotifiedDate
          : null,
    };
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

export function saveCheckInReminderPrefs(prefs: CheckInReminderPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CHECKIN_REMINDER_STORAGE_KEY,
      JSON.stringify(prefs)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function evaluateDailyCheckInReminder(
  checkInDates: string[],
  todayKey: string,
  prefs: CheckInReminderPrefs
): DailyCheckInReminderState {
  const streak = computeCheckInStreak(checkInDates, todayKey);
  const needsCheckIn = !streak.checkedInToday;

  if (!needsCheckIn) {
    return {
      needsCheckIn: false,
      shouldShowBanner: false,
      shouldShowTopIcon: false,
      shouldFireBrowserNotification: false,
      headline: '今日「巡馆盖章」已完成',
      encouragement: `已连续巡馆 ${streak.currentStreak} 天`,
      ctaLabel: '今日已盖章',
      streakDays: streak.currentStreak,
      totalDays: streak.totalDays,
    };
  }

  let headline = '今日「巡馆盖章」尚未落印';
  let encouragement = '每日轻点盖章，记录收藏足迹并点亮「连日巡馆」印记';

  if (streak.currentStreak > 0) {
    const remainingTo3 = Math.max(0, 3 - streak.currentStreak);
    headline = `连续巡馆 ${streak.currentStreak} 天 · 今日待盖章`;
    encouragement =
      remainingTo3 === 1
        ? '今日盖章即可达成连续 3 天，点亮「连日巡馆」馆藏印记'
        : `盖下今日印记，继续保持你的第 ${streak.currentStreak + 1} 天巡馆连胜`;
  } else if (streak.totalDays > 0) {
    headline = '今日「巡馆盖章」待落印';
    encouragement = `累计已巡馆 ${streak.totalDays} 天，今天也来翻看光影藏品并打个卡吧`;
  }

  return {
    needsCheckIn: true,
    shouldShowBanner: prefs.dismissedDate !== todayKey,
    shouldShowTopIcon: true,
    shouldFireBrowserNotification:
      prefs.browserNotifyEnabled && prefs.lastNotifiedDate !== todayKey,
    headline,
    encouragement,
    ctaLabel: '立即盖章',
    streakDays: streak.currentStreak,
    totalDays: streak.totalDays,
  };
}

/**
 * Returns milliseconds remaining until 00:00:05 of the next local calendar day
 * so a lightweight daily timer automatically re-checks at midnight.
 */
export function msUntilNextLocalMidnight(now = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    5,
    0
  );
  const diff = nextMidnight.getTime() - now.getTime();
  return Math.max(1000, diff);
}

export function getBrowserNotificationPermission(): BrowserNotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  const perm = window.Notification.permission;
  if (perm === 'granted' || perm === 'denied' || perm === 'default') {
    return perm;
  }
  return 'unsupported';
}

export function sendBrowserCheckInNotification(
  todayKey: string,
  title: string,
  body: string
): boolean {
  if (getBrowserNotificationPermission() !== 'granted') return false;
  try {
    new window.Notification(title, {
      body,
      tag: `cinearchive-checkin-${todayKey}`,
      silent: false,
    });
    return true;
  } catch {
    return false;
  }
}
