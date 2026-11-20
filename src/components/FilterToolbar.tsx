import { Search, X } from 'lucide-react';
import type {
  ArchiveCategory,
  CollectionStatus,
  SortOption,
} from '../types/archive';

interface FilterToolbarProps {
  query: string;
  onQueryChange: (val: string) => void;
  status: 'all' | CollectionStatus;
  onStatusChange: (status: 'all' | CollectionStatus) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  activeCategory: 'all' | ArchiveCategory;
  resultCount: number;
}

export function FilterToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  sortBy,
  onSortChange,
  activeCategory,
  resultCount,
}: FilterToolbarProps) {
  const statusOptions: Array<{ id: 'all' | CollectionStatus; label: string }> = [
    { id: 'all', label: '全部状态' },
    { id: 'favorite', label: '挚爱' },
    { id: 'watched', label: activeCategory === 'film' ? '已看' : '已收录' },
    { id: 'watching', label: activeCategory === 'film' ? '在追' : '关注中' },
    { id: 'watchlist', label: activeCategory === 'film' ? '想看' : '待补档' },
  ];

  return (
    <section
      aria-label="馆藏筛选工具栏"
      className="mx-auto max-w-[1280px] px-5 pt-7 pb-4 sm:px-8"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Local collection search */}
        <div className="relative w-full lg:max-w-sm">
          <label htmlFor="archive-local-search" className="sr-only">
            筛选馆藏条目
          </label>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
            aria-hidden="true"
          />
          <input
            id="archive-local-search"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="筛查片名、影人、角色、台词或笔记…"
            className="h-11 w-full rounded-md border border-[#DCD6CB] bg-white pl-10 pr-9 text-sm text-[#1A1816] placeholder:text-[#8C857B] transition-colors focus:border-[#1A1816] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="清空筛查关键词"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-[#625C54] hover:text-[#1A1816] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Interactive Status Segmented Control + Sort Select */}
        <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
          <div
            role="group"
            aria-label="按收藏状态筛选"
            className="h-scroll-rail no-scrollbar flex items-center gap-1 rounded-md bg-[#ECE8DF] p-1"
          >
            {statusOptions.map((opt) => {
              const active = status === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onStatusChange(opt.id)}
                  className={`min-h-[34px] rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 ${
                    active
                      ? 'bg-white text-[#1A1816] shadow-xs'
                      : 'text-[#625C54] hover:text-[#1A1816]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="archive-sort" className="text-xs text-[#625C54] whitespace-nowrap">
              排序
            </label>
            <select
              id="archive-sort"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              className="h-10 rounded-md border border-[#DCD6CB] bg-white px-3 text-xs font-medium text-[#1A1816] cursor-pointer focus:border-[#1A1816] focus:outline-none"
            >
              <option value="recent">最近收录</option>
              <option value="rating">评分最高</option>
              <option value="year">年代从新到旧</option>
              <option value="title">按名称排序</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-b border-[#E4DFD5] pb-3 text-xs text-[#625C54]">
        <span className="tabular-nums">共显示 {resultCount} 件藏品</span>
        <span>点击任意藏品卡片查看完整档案、编辑影评或跳转关联作品</span>
      </div>
    </section>
  );
}
