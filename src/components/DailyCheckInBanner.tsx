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
      className="mx-auto max-w-[1160px] px-4 pt-3.5 min-[420px]:px-5 md:px-8 md:pt-4"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-[#E5D5BE] bg-[#FFFDF8] px-4 py-3.5 shadow-[0_1px_2px_rgba(26,24,22,0.04)] sm:flex-row sm:items-center sm:justify-between sm:py-2.5">
        {/* Top / Left: Seal Mark + Readable Editorial Copy + Mobile Dismiss */}
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#EACDC6] bg-[#FDF2EF] text-[#B43B2B]"
          >
            <Stamp className="h-[19px] w-[19px]" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-snug text-[#1A1816] md:text-[13px]">
              {reminder.headline}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[#6E665C] md:text-[11px]">
              {reminder.encouragement}
            </p>
          </div>

          <button
            type="button"
            data-testid="reminder-dismiss-btn-mobile"
            onClick={onDismissToday}
            aria-label="今日暂不提醒"
            className="-mr-1 -mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#8C857B] transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer sm:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Bottom / Right Actions: Primary Stamp CTA + Browser Notify Toggle + Desktop Dismiss */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EFE8DC] pt-2.5 sm:border-t-0 sm:pt-0">
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
              className={`inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium whitespace-nowrap transition-colors cursor-pointer sm:min-h-[36px] sm:text-[11px] ${
                notifyActive
                  ? 'border-[#C9A45C] bg-[#FAF4E6] text-[#9A7228]'
                  : 'border-[#E4DFD5] bg-white text-[#625C54] hover:border-[#C9A45C] hover:text-[#1A1816]'
              }`}
            >
              {notifyActive ? (
                <>
                  <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>已开每日通知</span>
                </>
              ) : (
                <>
                  <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>开启每日通知</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            data-testid="reminder-stamp-btn"
            onClick={() => void onCheckInToday()}
            className="inline-flex min-h-[42px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-4 text-[14px] font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.97] sm:min-h-[36px] sm:text-xs"
          >
            <span>{reminder.ctaLabel}</span>
          </button>

          <button
            type="button"
            data-testid="reminder-dismiss-btn"
            onClick={onDismissToday}
            aria-label="今日暂不提醒"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#8C857B] transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer sm:flex"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
