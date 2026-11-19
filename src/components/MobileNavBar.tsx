import {
  Compass,
  FolderHeart,
  History,
  PlusSquare,
  Stamp,
  UserRound,
} from 'lucide-react';

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
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E4DFD5] bg-white/95 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid h-[60px] grid-cols-5 items-center">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(id)}
              className={`relative flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors duration-150 active:scale-[0.96] ${
                active ? 'text-[#B43B2B]' : 'text-[#7A7268]'
              }`}
            >
              <Icon
                className={`h-[21px] w-[21px] ${
                  active ? 'stroke-[2.2]' : 'stroke-[1.65]'
                }`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium leading-none tracking-tight whitespace-nowrap">
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
    <header className="sticky top-0 z-30 border-b border-[#E4DFD5] bg-[#F7F5F0]/95">
      {/* Mobile Compact App Bar (52px) */}
      <div className="flex h-[52px] items-center justify-between gap-2 px-4 md:hidden">
        <button
          type="button"
          onClick={() => onSelectTab('library')}
          className="font-editorial text-lg font-medium tracking-[0.05em] text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer"
        >
          {TAB_TITLES[activeTab]}
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {needsDailyCheckIn && onQuickCheckIn && (
            <button
              type="button"
              data-testid="topbar-checkin-icon"
              onClick={onQuickCheckIn}
              aria-label="今日尚未巡馆盖章，点击立即盖章"
              title="今日尚未巡馆盖章，点击立即盖章"
              className="inline-flex h-[38px] items-center gap-1 rounded-xl border border-[#EACDC6] bg-[#FDF2EF] px-2.5 text-xs font-medium text-[#B43B2B] whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.97] transition-colors hover:bg-[#FBE6E1]"
            >
              <Stamp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>待盖章</span>
            </button>
          )}

          {activeTab !== 'search' ? (
            <button
              type="button"
              onClick={() => onSelectTab('search')}
              className="min-h-[38px] rounded-xl bg-[#B43B2B] px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.97] transition-transform"
            >
              联网搜
            </button>
          ) : (
            <span className="font-mono text-xs tabular-nums text-[#7A7268]">
              已藏 {totalCount} 件
            </span>
          )}
        </div>
      </div>

      {/* Desktop 3-Zone Top Bar (md+) */}
      <div className="mx-auto hidden h-16 max-w-[1160px] items-center justify-between gap-8 px-8 md:flex">
        <button
          type="button"
          onClick={() => onSelectTab('library')}
          className="font-editorial text-xl font-medium tracking-[0.06em] text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer"
        >
          光影志
        </button>

        <nav aria-label="主导航" className="flex items-center gap-7">
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
                {label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-[#B43B2B]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          {needsDailyCheckIn && onQuickCheckIn && (
            <button
              type="button"
              data-testid="topbar-checkin-icon-desktop"
              onClick={onQuickCheckIn}
              aria-label="今日尚未巡馆盖章，点击立即盖章"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#EACDC6] bg-[#FDF2EF] px-3 py-2 text-xs font-medium text-[#B43B2B] whitespace-nowrap shrink-0 cursor-pointer transition-colors hover:bg-[#FBE6E1]"
            >
              <Stamp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>今日待盖章</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onSelectTab('search')}
            className="min-h-[40px] rounded-xl bg-[#B43B2B] px-4 py-2 text-sm font-medium text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors hover:bg-[#932D20]"
          >
            联网收录
          </button>
        </div>
      </div>
    </header>
  );
}
