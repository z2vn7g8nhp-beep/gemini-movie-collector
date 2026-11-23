import type { ArchiveCategory } from '../types/archive';

interface HeaderProps {
  activeCategory: 'all' | ArchiveCategory;
  onSelectCategory: (cat: 'all' | ArchiveCategory) => void;
  onOpenCollect: () => void;
}

const NAV_ITEMS: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
  { id: 'all', label: '全部藏品' },
  { id: 'film', label: '影视' },
  { id: 'person', label: '影人' },
  { id: 'character', label: '角色' },
];

export function Header({
  activeCategory,
  onSelectCategory,
  onOpenCollect,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#E4DFD5] bg-[#F7F5F0]/95 backdrop-blur-sm dark:border-[#2E2924] dark:bg-[#141210]/95">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-8 md:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectCategory('all')}
          className="font-editorial text-lg sm:text-xl font-medium tracking-[0.06em] text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B43B2B] dark:text-[#F3EFE6]"
        >
          光影志
        </button>

        {/* Zone 2: 4 Clean Single-Line Navigation Links */}
        <nav
          aria-label="藏品分类导航"
          className="flex items-center gap-3.5 sm:gap-7"
        >
          {NAV_ITEMS.map((nav) => {
            const isActive = activeCategory === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectCategory(nav.id)}
                className={`relative py-2 text-[13px] sm:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B43B2B] ${
                  isActive
                    ? 'text-[#1A1816] dark:text-[#FAF7F0]'
                    : 'text-[#625C54] hover:text-[#1A1816] dark:text-[#A59D90] dark:hover:text-[#F3EFE6]'
                }`}
              >
                {nav.id === 'all' ? (
                  <>
                    全部<span className="hidden sm:inline">藏品</span>
                  </>
                ) : (
                  nav.label
                )}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-[#B43B2B] dark:bg-[#EB7865]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenCollect}
            className="min-h-[38px] sm:min-h-[40px] rounded-md bg-[#B43B2B] px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 hover:bg-[#932D20] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B43B2B]"
          >
            联网收录
          </button>
        </div>
      </div>
    </header>
  );
}
