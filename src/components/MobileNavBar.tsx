import {
  Compass,
  FolderHeart,
  History,
  PlusSquare,
  Stamp,
  UserRound,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type AppTab = 'library' | 'timeline' | 'search' | 'create' | 'profile';

interface MobileNavBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  totalCount: number;
}

const TABS: Array<{
  id: AppTab;
  label: string;
  Icon: typeof FolderHeart;
}> = [
  { id: 'library', label: '藏馆', Icon: FolderHeart },
  { id: 'timeline', label: '回忆', Icon: History },
  { id: 'search', label: '搜片', Icon: Compass },
  { id: 'create', label: '建档', Icon: PlusSquare },
  { id: 'profile', label: '我的', Icon: UserRound },
];

export function MobileNavBar({
  activeTab,
  onSelectTab,
  totalCount,
}: MobileNavBarProps) {
  return (
    <nav
      aria-label="底部主导航"
      className="fixed bottom-0 left-0 right-0 z-40 w-full max-w-[100vw] overflow-hidden border-t border-[#E4DFD5] bg-[#FFFDF9]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden"
    >
      <div className="grid h-[60px] grid-cols-5 items-center px-1">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(id)}
              className={`relative flex h-full min-h-[44px] min-w-0 flex-col items-center justify-center gap-1 cursor-pointer transition-colors duration-150 active:scale-[0.95] ${
                active ? 'text-[#B43B2B]' : 'text-[#6E665C] hover:text-[#1A1816]'
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 h-[2px] w-7 -translate-x-1/2 rounded-full bg-[#B43B2B]"
                />
              )}
              <Icon
                className={`h-[21px] w-[21px] shrink-0 transition-transform duration-150 ${
                  active ? 'scale-[1.04] stroke-[2.15]' : 'stroke-[1.65]'
                }`}
                aria-hidden="true"
              />
              <span className="max-w-full truncate text-[11px] font-medium leading-none tracking-tight whitespace-nowrap">
                {label}
                {id === 'library' && totalCount > 0 ? `(${totalCount})` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface AppTopBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  totalCount: number;
  needsDailyCheckIn?: boolean;
  onQuickCheckIn?: () => void;
}

const TAB_TITLES: Record<AppTab, string> = {
  library: '光影志',
  timeline: '时间轴回忆',
  search: '全网直连搜片',
  create: '手动建档',
  profile: '我的馆藏',
};

export function AppTopBar({
  activeTab,
  onSelectTab,
  totalCount,
  needsDailyCheckIn = false,
  onQuickCheckIn,
}: AppTopBarProps) {
  return (
    <header className="sticky top-0 z-30 w-full max-w-full overflow-x-clip border-b border-[#E4DFD5]/90 bg-[#F7F5F0]/92 backdrop-blur-md pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* Mobile Compact App Bar (52px — keeps aggregate sticky chrome well under 15% of mobile viewport) */}
      <div className="flex h-[52px] items-center justify-between gap-3 px-4 min-[420px]:px-5 md:hidden">
        <button
          type="button"
          onClick={() => onSelectTab('library')}
          className="min-w-0 truncate font-editorial text-[20px] font-semibold tracking-[0.06em] text-[#1A1816] whitespace-nowrap cursor-pointer"
        >
          {TAB_TITLES[activeTab]}
        </button>

        <div className="flex shrink-0 items-center gap-2">
          <PWAInstallButton variant="topbar" />
          {needsDailyCheckIn && onQuickCheckIn && (
            <button
              type="button"
              data-testid="topbar-checkin-icon"
              onClick={onQuickCheckIn}
              aria-label="今日尚未巡馆盖章，点击立即盖章"
              title="今日尚未巡馆盖章，点击立即盖章"
              className="inline-flex h-[38px] items-center gap-1 rounded-xl border border-[#EACDC6] bg-[#FDF2EF] px-2.5 text-[12px] font-medium text-[#B43B2B] whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.97] transition-colors hover:bg-[#FBE6E1]"
            >
              <Stamp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>盖章</span>
            </button>
          )}

          {activeTab !== 'search' ? (
            <button
              type="button"
              onClick={() => onSelectTab('search')}
              className="inline-flex h-[38px] items-center justify-center rounded-xl bg-[#B43B2B] px-3.5 text-[13px] font-medium text-white whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.97] transition-colors hover:bg-[#932D20]"
            >
              联网搜
            </button>
          ) : (
            <span className="font-mono text-[12px] tabular-nums text-[#7A7268] whitespace-nowrap shrink-0">
              已藏 {totalCount} 件
            </span>
          )}
        </div>
      </div>

      {/* Desktop 3-Zone Top Bar (md+): Wordmark — 5 Nav Links — 1 Primary Action */}
      <div className="mx-auto hidden h-16 max-w-[1180px] items-center justify-between gap-8 px-8 md:flex">
        <button
          type="button"
          onClick={() => onSelectTab('library')}
          className="font-editorial text-[22px] font-semibold tracking-[0.08em] text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer transition-opacity hover:opacity-80"
        >
          光影志
        </button>

        <nav aria-label="主导航" className="flex items-center gap-8">
          {TABS.map(({ id, label }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectTab(id)}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'text-[#1A1816]'
                    : 'text-[#625C54] hover:text-[#1A1816]'
                }`}
              >
                <span>{label}</span>
                {id === 'library' && totalCount > 0 && (
                  <span className="ml-1 font-mono text-[11px] tabular-nums text-[#8C857B]">
                    {totalCount}
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-0 -bottom-[1px] h-[2px] rounded-full bg-[#B43B2B] transition-all duration-200 ${
                    active ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          <PWAInstallButton variant="topbar" />
          {needsDailyCheckIn && onQuickCheckIn && (
            <button
              type="button"
              data-testid="topbar-checkin-icon-desktop"
              onClick={onQuickCheckIn}
              aria-label="今日尚未巡馆盖章，点击立即盖章"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#EACDC6] bg-[#FDF2EF] px-3 text-xs font-medium text-[#B43B2B] whitespace-nowrap shrink-0 cursor-pointer transition-colors hover:bg-[#FBE6E1]"
            >
              <Stamp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>今日盖章</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onSelectTab('search')}
            className="h-10 rounded-xl bg-[#B43B2B] px-4 text-sm font-medium text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.98]"
          >
            联网收录
          </button>
        </div>
      </div>
    </header>
  );
}
