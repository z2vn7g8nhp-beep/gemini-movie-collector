import { useMemo, useState } from 'react';
import { ArrowDownUp, CalendarDays, Clock, Star } from 'lucide-react';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS, getRelatedItems } from '../utils/archive';
import { computeItemCompleteness } from '../utils/collector';
import {
  buildTimelineGroups,
  extractTimelineDateParts,
  type TimelineOrder,
} from '../utils/timeline';
import { ArchivalImage } from './ArchivalImage';

interface TimelineMemoriesViewProps {
  items: ArchiveItem[];
  onSelectItem: (item: ArchiveItem) => void;
  onJumpToSearch: () => void;
  onJumpToCreate: () => void;
}

const CAT_FILTERS: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'film', label: '影视' },
  { id: 'person', label: '影人' },
  { id: 'character', label: '角色' },
];

export function TimelineMemoriesView({
  items,
  onSelectItem,
  onJumpToSearch,
  onJumpToCreate,
}: TimelineMemoriesViewProps) {
  const [order, setOrder] = useState<TimelineOrder>('desc');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<
    'all' | ArchiveCategory
  >('all');

  const timeline = useMemo(
    () =>
      buildTimelineGroups(items, {
        order,
        monthKey: selectedMonth,
        category: selectedCategory,
      }),
    [items, order, selectedMonth, selectedCategory]
  );

  const activeMonthMeta = useMemo(
    () =>
      selectedMonth
        ? timeline.allMonths.find((m) => m.monthKey === selectedMonth) ?? null
        : null,
    [timeline.allMonths, selectedMonth]
  );

  if (items.length === 0) {
    return (
      <section
        data-testid="timeline-memories-view"
        className="mx-auto max-w-[780px] px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-10 md:pb-16"
      >
        <div className="rounded-2xl border border-[#E4DFD5] bg-white px-6 py-12 text-center">
          <p className="font-mono text-[13px] tracking-[0.14em] text-[#8C857B] md:text-xs">
            时间轴回忆
          </p>
          <h2 className="mt-2 font-editorial text-[22px] font-medium text-[#1A1816] md:text-xl">
            尚未开启你的光影编年
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#625C54] md:text-sm">
            每收录一部影视、一位影人或一个角色，都会在这里按收录时间留下一枚光影记忆刻度。
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={onJumpToSearch}
              className="min-h-[48px] rounded-xl bg-[#B43B2B] px-5 text-[15px] font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.98] md:min-h-[46px] md:text-sm"
            >
              联网搜索收录
            </button>
            <button
              type="button"
              onClick={onJumpToCreate}
              className="min-h-[48px] rounded-xl border border-[#DCD6CB] bg-white px-5 text-[15px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.98] md:min-h-[46px] md:text-sm"
            >
              手动建档
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="时间轴回忆"
      data-testid="timeline-memories-view"
      className="mx-auto max-w-[780px] space-y-4 px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-8 md:pb-16"
    >
      {/* 1. Archival Chronicle Header Card */}
      <div className="gallery-card-dark border border-[#342F28] p-5 text-[#F5F1E8]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[12px] tracking-[0.12em] text-[#B8AE9E] md:text-[11px]">
              光影编年 · 时间轴回忆
            </p>
            <h2 className="mt-1 font-editorial text-[24px] font-medium leading-tight text-[#FAF7F0] min-[420px]:text-[25px] md:text-2xl">
              {activeMonthMeta
                ? `${activeMonthMeta.label}回顾`
                : `共珍藏 ${timeline.summary.totalItems} 段光影记忆`}
            </h2>
            <p className="mt-1.5 text-[13px] text-[#BFB6A7] tabular-nums md:text-xs">
              {activeMonthMeta
                ? `本月收录 ${activeMonthMeta.totalCount} 件 · 影视 ${activeMonthMeta.filmCount} · 影人 ${activeMonthMeta.personCount} · 角色 ${activeMonthMeta.characterCount}`
                : timeline.summary.firstCollectedDate
                  ? `始于 ${timeline.summary.firstCollectedDate} · 跨越 ${timeline.summary.totalMonths} 个月份`
                  : '按收录顺序重温每一次心动'}
            </p>
          </div>

          <button
            type="button"
            data-testid="timeline-order-toggle"
            onClick={() => setOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            aria-label={
              order === 'desc' ? '切换为最初起步正序' : '切换为最新收录倒序'
            }
            className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-[13px] font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer active:scale-[0.97] hover:bg-white/15 md:min-h-[40px] md:text-xs"
          >
            <ArrowDownUp className="h-3.5 w-3.5 text-[#D4AF6A]" aria-hidden="true" />
            <span>{order === 'desc' ? '最新在前' : '最初起步'}</span>
          </button>
        </div>

        {/* 3-Metric Journey Figures */}
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3.5 text-center">
          <div>
            <p className="font-mono text-[20px] font-medium tabular-nums text-[#FAF7F0] md:text-lg">
              {timeline.summary.totalItems}
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">累计收录</p>
          </div>
          <div>
            <p className="font-mono text-[20px] font-medium tabular-nums text-[#E4C37A] md:text-lg">
              {timeline.summary.totalMonths}
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">记录月份</p>
          </div>
          <div>
            <p className="font-mono text-[20px] font-medium tabular-nums text-[#FAF7F0] md:text-lg">
              {timeline.summary.journeySpanDays} 天
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">收集历程</p>
          </div>
        </div>
      </div>

      {/* 2. Monthly Review Selector & Category Filter */}
      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="按月份回顾"
          data-testid="timeline-month-selector"
          className="h-scroll-rail no-scrollbar flex items-center gap-2 pb-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedMonth === ''}
            onClick={() => setSelectedMonth('')}
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[42px] md:text-xs ${
              selectedMonth === ''
                ? 'border-[#1A1816] bg-[#1A1816] text-white'
                : 'border-[#DCD6CB] bg-white text-[#4B453E] hover:border-[#1A1816]'
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span>全部月份</span>
            <span className="font-mono text-[12px] tabular-nums opacity-80 md:text-[11px]">
              {timeline.summary.totalItems}
            </span>
          </button>

          {timeline.allMonths.map((month) => {
            const active = selectedMonth === month.monthKey;
            return (
              <button
                key={month.monthKey}
                type="button"
                role="tab"
                data-testid={`timeline-month-btn-${month.monthKey}`}
                aria-selected={active}
                onClick={() => setSelectedMonth(active ? '' : month.monthKey)}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[42px] md:text-xs ${
                  active
                    ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                    : 'border-[#DCD6CB] bg-white text-[#1A1816] hover:border-[#1A1816]'
                }`}
              >
                <span>{month.label}</span>
                <span className="font-mono text-[12px] tabular-nums opacity-80 md:text-[11px]">
                  {month.totalCount}件
                </span>
              </button>
            );
          })}
        </div>

        {/* Category Segmented Toggle */}
        <div
          role="group"
          aria-label="按类型筛选时间轴"
          className="grid grid-cols-4 gap-1 rounded-xl bg-[#ECE8DF] p-1 sm:max-w-sm"
        >
          {CAT_FILTERS.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedCategory(cat.id)}
                className={`min-h-[42px] rounded-lg px-2 text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[38px] md:text-xs ${
                  active
                    ? 'bg-white text-[#1A1816] shadow-xs'
                    : 'text-[#625C54]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Chronological Month Chapters & Vertical Timeline Rail */}
      {timeline.visibleMonths.length === 0 ? (
        <div className="rounded-2xl border border-[#E4DFD5] bg-white px-6 py-10 text-center">
          <p className="text-sm font-medium text-[#1A1816]">
            当前月份与分类下暂无收录记录
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedMonth('');
              setSelectedCategory('all');
            }}
            className="mt-4 min-h-[42px] rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-4 text-xs font-medium text-[#1A1816] cursor-pointer"
          >
            查看全部时间轴回忆
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {timeline.visibleMonths.map((month) => (
            <section
              key={month.monthKey}
              data-testid={`timeline-month-group-${month.monthKey}`}
              aria-label={`${month.label}收录回忆`}
              className="space-y-3.5"
            >
              {/* Monthly Review Chapter Card */}
              <div className="gallery-card border border-[#E6E0D4] p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-editorial text-[19px] font-medium text-[#1A1816] md:text-lg">
                      {month.label}
                    </h3>
                    <p className="mt-0.5 text-[13px] text-[#625C54] tabular-nums md:text-xs">
                      {[
                        month.filmCount > 0 ? `影视 ${month.filmCount}` : '',
                        month.personCount > 0 ? `影人 ${month.personCount}` : '',
                        month.characterCount > 0
                          ? `角色 ${month.characterCount}`
                          : '',
                        month.topTags.length > 0
                          ? `关键词：${month.topTags.join(' · ')}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap font-mono text-[13px] font-medium tabular-nums text-[#B43B2B] md:text-xs">
                    共 {month.totalCount} 件
                  </span>
                </div>

                {/* Mini Monthly Collage Strip (for 2+ entries in that month) */}
                {month.items.length >= 2 && (
                  <div className="h-scroll-rail no-scrollbar mt-3 flex gap-2 border-t border-[#F0ECE3] pt-3">
                    {month.items.slice(0, 8).map((mini) => (
                      <button
                        key={`strip-${mini.id}`}
                        type="button"
                        onClick={() => onSelectItem(mini)}
                        aria-label={`快速查看「${mini.title}」`}
                        className="h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-[#E4DFD5] bg-[#FAF9F6] cursor-pointer active:scale-[0.96] transition-transform"
                      >
                        <ArchivalImage
                          src={mini.coverUrl}
                          alt={mini.title}
                          title={mini.title}
                          category={mini.category}
                          compact
                          className="h-full w-full"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Vertical Timeline Rail & Day Groups */}
              <div className="relative pl-5">
                <div
                  aria-hidden="true"
                  className="absolute left-[7px] top-2 bottom-2 w-px bg-[#D8D0C2]"
                />

                <div className="space-y-4">
                  {month.days.map((day) => (
                    <div key={day.dateKey} className="space-y-2.5">
                      {/* Day Milestone Marker */}
                      <div className="relative flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="absolute -left-5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#F7F5F0] bg-[#B43B2B]"
                        />
                        <span className="font-mono text-[13px] font-medium tabular-nums text-[#1A1816] md:text-xs">
                          {day.dayLabel}
                        </span>
                        <span className="text-[13px] text-[#8C857B] md:text-xs">
                          {day.weekdayLabel}
                        </span>
                      </div>

                      {/* Entries Collected on This Day */}
                      <div className="space-y-2.5">
                        {day.items.map((item) => {
                          const parts = extractTimelineDateParts(item.createdAt);
                          const completeness = computeItemCompleteness(item);
                          const isMasterpiece =
                            completeness.tier === 'masterpiece';
                          const relatedCount = getRelatedItems(
                            item,
                            items
                          ).length;
                          const excerpt =
                            item.quote ||
                            item.notes ||
                            item.characterProfile?.bio ||
                            item.summary;

                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-testid={`timeline-entry-${item.id}`}
                              onClick={() => onSelectItem(item)}
                              aria-label={`查看时间轴条目「${item.title}」详情`}
                              className={`gallery-card flex w-full items-start gap-3.5 border p-3.5 text-left cursor-pointer active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B43B2B] md:gap-3 md:p-3 ${
                                isMasterpiece
                                  ? 'gallery-card-masterpiece border-[#C9A45C]/80'
                                  : 'border-[#E6E0D4] hover:border-[#CFC7B9]'
                              }`}
                            >
                              <div className="gallery-cover-frame w-[66px] shrink-0 bg-[#FAF9F6] min-[420px]:w-[70px] md:w-[60px]">
                                <ArchivalImage
                                  src={item.coverUrl}
                                  alt={item.title}
                                  title={item.title}
                                  category={item.category}
                                  compact
                                  className="aspect-[3/4] w-full rounded-[14px]"
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2 text-[12px] text-[#7A7268] md:text-[11px]">
                                  <span className="flex min-w-0 items-center gap-1 font-mono tabular-nums truncate">
                                    <Clock
                                      className="h-3 w-3 shrink-0 text-[#9C9488]"
                                      aria-hidden="true"
                                    />
                                    <span>{parts.timeLabel}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{item.accessionNo}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{CATEGORY_LABELS[item.category]}</span>
                                  </span>
                                  <span
                                    className={`shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums md:text-[10px] ${
                                      isMasterpiece
                                        ? 'font-medium text-[#8E6523]'
                                        : 'text-[#8C857B]'
                                    }`}
                                  >
                                    {completeness.tierLabel}{' '}
                                    {completeness.score}/5
                                  </span>
                                </div>

                                <h4 className="mt-1 truncate font-editorial text-[17px] font-medium leading-snug text-[#1A1816] md:text-base">
                                  {item.title}
                                </h4>

                                {excerpt && (
                                  <p
                                    className={`mt-1 line-clamp-2 text-[14px] leading-relaxed md:text-xs ${
                                      item.quote
                                        ? 'font-editorial italic text-[#3D3832]'
                                        : 'text-[#625C54]'
                                    }`}
                                  >
                                    {item.quote ? `“${item.quote}”` : excerpt}
                                  </p>
                                )}

                                <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[12px] text-[#7A7268] tabular-nums md:text-[11px]">
                                  {item.rating > 0 && (
                                    <span className="inline-flex items-center gap-0.5 font-mono text-[#B43B2B]">
                                      <Star
                                        className="h-3.5 w-3.5 fill-[#B43B2B] text-[#B43B2B] md:h-3 md:w-3"
                                        aria-hidden="true"
                                      />
                                      {item.rating}.0
                                    </span>
                                  )}
                                  {relatedCount > 0 && (
                                    <span>关联 {relatedCount} 项</span>
                                  )}
                                  {item.tags.length > 0 && (
                                    <span className="truncate">
                                      {item.tags.slice(0, 3).join(' · ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
