import { Bell, BellOff, Stamp, X } from 'lucide-react';
import type {
  BrowserNotificationPermissionState,
  DailyCheckInReminderState,
} from '../utils/checkInReminder';

interface DailyCheckInBannerProps {
  reminder: DailyCheckInReminderState;
  browserNotifyEnabled: boolean;
  notificationPermission: BrowserNotificationPermissionState;
  onCheckInToday: () => Promise<void>;
  onToggleBrowserNotify: () => Promise<void>;
  onDismissToday: () => void;
}

export function DailyCheckInBanner({
  reminder,
  browserNotifyEnabled,
  notificationPermission,
  onCheckInToday,
  onToggleBrowserNotify,
  onDismissToday,
}: DailyCheckInBannerProps) {
  if (!reminder.shouldShowBanner) return null;

  const notifyActive =
    browserNotifyEnabled && notificationPermission === 'granted';

  return (
    <aside
      aria-label="今日巡馆盖章提醒"
      data-testid="daily-checkin-banner"
      className="mx-auto max-w-[1180px] px-4 pt-3 min-[420px]:px-5 md:px-8 md:pt-4"
    >
      <div className="flex flex-col gap-2.5 rounded-2xl border border-[#E6DACA] bg-[#FFFDF8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-2.5 dark:border-[#3A3228] dark:bg-[#1E1A16]">
        {/* Top / Left: Seal Mark + Readable Editorial Copy + Mobile Dismiss */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#EACDC6] bg-[#FDF2EF] text-[#B43B2B] dark:border-[#6B3229] dark:bg-[#351B17] dark:text-[#F28C7B]"
          >
            <Stamp className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-snug text-[#1A1816] md:text-[13px] dark:text-[#F3EFE6]">
              {reminder.headline}
              <span className="hidden text-[#8C857B] font-normal lg:inline dark:text-[#A59D90]">
                {' · '}
                {reminder.encouragement}
              </span>
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-[#6E665C] lg:hidden dark:text-[#A59D90]">
              {reminder.encouragement}
            </p>
          </div>

          <button
            type="button"
            data-testid="reminder-dismiss-btn-mobile"
            onClick={onDismissToday}
            aria-label="今日暂不提醒"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#8C857B] transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer sm:hidden dark:text-[#9A9184] dark:hover:bg-[#2B2620] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Bottom / Right Actions: Primary Stamp CTA + Browser Notify Toggle + Desktop Dismiss */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EFE8DC] pt-2.5 sm:border-t-0 sm:pt-0 dark:border-[#2E2924]">
          {notificationPermission !== 'unsupported' && (
            <button
              type="button"
              data-testid="reminder-notify-btn"
              onClick={() => void onToggleBrowserNotify()}
              aria-pressed={notifyActive}
              aria-label={
                notifyActive
                  ? '关闭浏览器每日巡馆通知'
                  : '开启浏览器每日巡馆通知'
              }
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                notifyActive
                  ? 'border-[#C9A45C] bg-[#FAF4E6] text-[#9A7228] dark:border-[#C9A45C]/70 dark:bg-[#2E2518] dark:text-[#E4C37A]'
                  : 'border-[#E4DFD5] bg-white text-[#625C54] hover:border-[#C9A45C] hover:text-[#1A1816] dark:border-[#3A342D] dark:bg-[#25211D] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]'
              }`}
            >
              {notifyActive ? (
                <>
                  <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>已开通知</span>
                </>
              ) : (
                <>
                  <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>每日通知</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            data-testid="reminder-stamp-btn"
            onClick={() => void onCheckInToday()}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-4 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.97]"
          >
            <span>{reminder.ctaLabel}</span>
          </button>

          <button
            type="button"
            data-testid="reminder-dismiss-btn"
            onClick={onDismissToday}
            aria-label="今日暂不提醒"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#8C857B] transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer sm:flex dark:text-[#9A9184] dark:hover:bg-[#2B2620] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
