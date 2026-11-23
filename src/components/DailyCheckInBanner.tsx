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
      <div className="flex flex-col gap-2.5 rounded-xl border border-[#E5DEC9]/90 bg-[#FAF6ED]/80 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-[#302A22] dark:bg-[#1B1814]/90">
        {/* Top / Left: Seal Mark + Readable Editorial Copy + Mobile Dismiss */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Stamp
            className="h-4 w-4 shrink-0 text-[#B43B2B] dark:text-[#EB7865]"
            aria-hidden="true"
          />

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-snug text-[#2A2622] dark:text-[#EFEAE0]">
              {reminder.headline}
              <span className="hidden font-normal text-[#7E766B] lg:inline dark:text-[#9A9184]">
                {' · '}
                {reminder.encouragement}
              </span>
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-[#746C61] lg:hidden dark:text-[#9A9184]">
              {reminder.encouragement}
            </p>
          </div>

          <button
            type="button"
            data-testid="reminder-dismiss-btn-mobile"
            onClick={onDismissToday}
            aria-label="今日暂不提醒"
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8C857B] transition-colors hover:bg-[#EFE9DC] hover:text-[#1A1816] cursor-pointer sm:hidden dark:text-[#9A9184] dark:hover:bg-[#2B2620] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Bottom / Right Actions: Refined Outline Stamp CTA + Browser Notify Toggle + Desktop Dismiss */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EAE2D3] pt-2 sm:border-t-0 sm:pt-0 dark:border-[#2C2721]">
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
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                notifyActive
                  ? 'border-[#C9A45C] bg-[#FAF4E6] text-[#9A7228] dark:border-[#C9A45C]/70 dark:bg-[#2E2518] dark:text-[#E4C37A]'
                  : 'border-transparent text-[#6E665C] hover:border-[#DCD6CB] hover:bg-white hover:text-[#1A1816] dark:text-[#A59D90] dark:hover:border-[#3A342D] dark:hover:bg-[#25211D] dark:hover:text-[#F3EFE6]'
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
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[#B43B2B]/65 bg-[#FFFDF9] px-3 text-xs font-medium text-[#B43B2B] whitespace-nowrap cursor-pointer transition-colors hover:border-[#B43B2B] hover:bg-[#B43B2B] hover:text-white active:scale-[0.97] dark:border-[#EB7865]/60 dark:bg-[#251815] dark:text-[#F28C7B] dark:hover:bg-[#B43B2B] dark:hover:text-white"
          >
            <span>{reminder.ctaLabel}</span>
          </button>

          <button
            type="button"
            data-testid="reminder-dismiss-btn"
            onClick={onDismissToday}
            aria-label="今日暂不提醒"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8C857B] transition-colors hover:bg-[#EFE9DC] hover:text-[#1A1816] cursor-pointer sm:flex dark:text-[#9A9184] dark:hover:bg-[#2B2620] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
