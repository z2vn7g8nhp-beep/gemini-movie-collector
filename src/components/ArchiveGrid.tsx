import { ArrowUpRight, Check, Film, Layers, Sparkles, Star, User } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import {
  CATEGORY_LABELS,
  formatRelatedSummary,
  getRelatedItems,
  getStatusLabel,
} from '../utils/archive';
import { computeItemCompleteness } from '../utils/collector';
import { ArchivalImage } from './ArchivalImage';

export type ArchiveViewMode = 'grid' | 'list';

interface ArchiveGridProps {
  items: ArchiveItem[];
  allItems: ArchiveItem[];
  searchQuery: string;
  activeTag?: string;
  activeAlbumName?: string;
  viewMode?: ArchiveViewMode;
  batchMode?: boolean;
  selectedIds?: string[];
  onToggleBatchSelect?: (id: string) => void;
  onSelectItem: (item: ArchiveItem) => void;
  onOpenCardModal?: (item: ArchiveItem) => void;
  onJumpToSearch: (query?: string) => void;
  onJumpToCreate: () => void;
  onResetFilters: () => void;
}

export function ArchiveGrid({
  items,
  allItems,
  searchQuery,
  activeTag = '',
  activeAlbumName = '',
  viewMode = 'grid',
  batchMode = false,
  selectedIds = [],
  onToggleBatchSelect,
  onSelectItem,
  onOpenCardModal,
  onJumpToSearch,
  onJumpToCreate,
  onResetFilters,
}: ArchiveGridProps) {
  const selectedIdSet = new Set(selectedIds);
  if (allItems.length === 0) {
    return (
      <section className="mx-auto max-w-[1180px] px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-6 md:pb-16">
        <div className="gallery-card overflow-hidden border border-[#E4DFD5] p-6 sm:p-8 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10 lg:p-10">
          {/* Left Editorial Welcome */}
          <div className="lg:col-span-7">
            <p className="font-mono text-xs tracking-[0.14em] text-[#8C857B]">
              私人光影档案馆 · ARCHIVE READY
            </p>
            <h1 className="mt-2.5 font-editorial text-[26px] font-medium leading-tight text-[#1A1816] sm:text-[32px]">
              为打动过你的光影、影人与角色立一座藏馆
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#625C54]">
              直连检索影片、导演、演员与经典角色，建立双向关联图谱，写下台词摘录与观影手记，并点亮专属实体藏卡与影藏勋章。
            </p>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => onJumpToSearch()}
                className="min-h-[46px] rounded-xl bg-[#B43B2B] px-6 text-sm font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.98] transition-colors hover:bg-[#932D20]"
              >
                联网搜索收录
              </button>
              <button
                type="button"
                onClick={onJumpToCreate}
                className="min-h-[46px] rounded-xl border border-[#DCD6CB] bg-white px-5 text-sm font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.98] transition-colors hover:border-[#1A1816]"
              >
                手动建档
              </button>
            </div>
          </div>

          {/* Right Archival Pillars Guide */}
          <div className="mt-7 grid grid-cols-1 gap-3 border-t border-[#ECE6DA] pt-6 sm:grid-cols-3 lg:col-span-5 lg:mt-0 lg:grid-cols-1 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <div className="flex items-start gap-3 rounded-2xl bg-[#FAF8F4] p-3.5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1C1A17] text-[#E4C37A]"
              >
                <Film className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-editorial text-sm font-medium text-[#1A1816]">
                  01. 影视典藏
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6E665C]">
                  直连获取中英文片名、海报与演职员，记录评分、状态与台词。
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl bg-[#FAF8F4] p-3.5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1C1A17] text-[#DFC191]"
              >
                <User className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-editorial text-sm font-medium text-[#1A1816]">
                  02. 影人脉络
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6E665C]">
                  串联导演、演员与代表作，构建专属私人电影关系图谱。
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl bg-[#FAF8F4] p-3.5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1C1A17] text-[#E7A898]"
              >
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-editorial text-sm font-medium text-[#1A1816]">
                  03. 角色小传
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6E665C]">
                  收存难忘荧幕角色与高光时刻，翻转实体藏卡与影藏勋章。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-[1180px] px-4 py-10 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-[#E4DFD5] bg-[#FFFDF9] px-6 py-10 text-center">
          <p className="font-mono text-xs tracking-[0.14em] text-[#8C857B]">
            筛查结果为空
          </p>
          <h2 className="mt-2 font-editorial text-xl font-medium text-[#1A1816]">
            {searchQuery
              ? `馆内暂无「${searchQuery}」`
              : activeAlbumName
                ? `图鉴「${activeAlbumName}」下暂无已入册藏品`
                : activeTag
                  ? `标签「${activeTag}」下暂无符合条件的藏品`
                  : '当前分类或状态下暂无藏品'}
          </h2>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            {searchQuery && (
              <button
                type="button"
                onClick={() => onJumpToSearch(searchQuery)}
                className="min-h-[44px] rounded-xl bg-[#B43B2B] px-5 text-sm font-medium text-white cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.98]"
              >
                去全网搜「{searchQuery}」
              </button>
            )}
            <button
              type="button"
              onClick={onResetFilters}
              className="min-h-[44px] rounded-xl border border-[#DCD6CB] bg-white px-5 text-sm font-medium text-[#1A1816] cursor-pointer transition-colors hover:border-[#1A1816] active:scale-[0.98]"
            >
              查看全部藏品
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (viewMode === 'list') {
    return (
      <section
        aria-label="藏品目录列表"
        data-testid="archive-grid"
        data-view-mode="list"
        className="mx-auto max-w-[1180px] px-4 pt-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pb-16"
      >
        <div className="divide-y divide-[#E8E2D7] overflow-hidden rounded-2xl border border-[#E4DFD5] bg-[#FFFDF9]">
          {items.map((item) => {
            const relatedItems = getRelatedItems(item, allItems);
            const relatedSummary = formatRelatedSummary(relatedItems);
            const completeness = computeItemCompleteness(item);
            const isMasterpiece = completeness.tier === 'masterpiece';
            const excerpt = item.quote || item.notes || item.summary;

            const isSelected = batchMode && selectedIdSet.has(item.id);
            return (
              <article
                key={item.id}
                className={`group relative flex items-center gap-3.5 px-3.5 py-3 transition-colors sm:px-5 sm:py-3.5 ${
                  isSelected ? 'bg-[#FDF6F4]' : 'hover:bg-[#FAF7F0]'
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    batchMode && onToggleBatchSelect
                      ? onToggleBatchSelect(item.id)
                      : onSelectItem(item)
                  }
                  aria-pressed={batchMode ? isSelected : undefined}
                  aria-label={
                    batchMode
                      ? `${isSelected ? '取消选择' : '选择'}「${item.title}」`
                      : `查看${CATEGORY_LABELS[item.category]}「${item.title}」详情`
                  }
                  className="flex min-w-0 flex-1 items-center gap-3.5 text-left cursor-pointer"
                >
                  {batchMode && (
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                        isSelected
                          ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                          : 'border-[#CFC7B9] bg-white text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div className="gallery-cover-frame w-[52px] shrink-0 sm:w-[58px]">
                    <ArchivalImage
                      src={item.coverUrl}
                      alt={`${item.title}封面`}
                      title={item.title}
                      category={item.category}
                      compact
                      className="aspect-[3/4] w-full rounded-[10px]"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-[#7A7268]">
                      <span>{item.accessionNo}</span>
                      <span aria-hidden="true">·</span>
                      <span>{CATEGORY_LABELS[item.category]}</span>
                      {item.year && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{item.year}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{getStatusLabel(item.status, item.category)}</span>
                      {isMasterpiece && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#8E6523]">典藏</span>
                        </>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-baseline gap-2">
                      <h2 className="truncate font-editorial text-[16px] font-medium text-[#1A1816] group-hover:text-[#B43B2B] transition-colors">
                        {item.title}
                      </h2>
                      {item.originalTitle && (
                        <span className="hidden truncate text-xs text-[#8C857B] sm:inline">
                          {item.originalTitle}
                        </span>
                      )}
                    </div>

                    {excerpt && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-[#625C54]">
                        {item.quote ? `“${item.quote}”` : excerpt}
                      </p>
                    )}
                  </div>

                  <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                    <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
                      {item.rating > 0 ? (
                        <>
                          <Star
                            className="h-3.5 w-3.5 fill-[#B43B2B] text-[#B43B2B]"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-[#1A1816]">
                            {item.rating}.0
                          </span>
                        </>
                      ) : (
                        <span className="text-[#8C857B]">未评</span>
                      )}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[#7A7268]">
                      {relatedSummary || `${completeness.tierLabel} ${completeness.score}/5`}
                    </span>
                  </div>
                </button>

                {onOpenCardModal && (
                  <button
                    type="button"
                    onClick={() => onOpenCardModal(item)}
                    aria-label={`以实体藏卡赏析「${item.title}」`}
                    title="实体藏卡赏析"
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E4DFD5] bg-white text-[#625C54] transition-colors hover:border-[#1A1816] hover:text-[#1A1816] cursor-pointer md:inline-flex"
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="藏品陈列网格"
      data-testid="archive-grid"
      data-view-mode="grid"
      className="mx-auto max-w-[1180px] px-4 pt-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pb-16"
    >
      <div className="grid grid-cols-2 gap-3.5 min-[420px]:gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {items.map((item) => {
          const relatedItems = getRelatedItems(item, allItems);
          const relatedSummary = formatRelatedSummary(relatedItems);
          const completeness = computeItemCompleteness(item);
          const isMasterpiece = completeness.tier === 'masterpiece';
          const metaLine = [
            item.accessionNo,
            CATEGORY_LABELS[item.category],
            item.year,
            getStatusLabel(item.status, item.category),
          ]
            .filter(Boolean)
            .join(' · ');

          const isSelected = batchMode && selectedIdSet.has(item.id);

          return (
            <article key={item.id} className="group relative flex min-w-0 flex-col">
              <div
                className={`gallery-card gallery-card-interactive relative flex flex-1 flex-col overflow-hidden border ${
                  isSelected
                    ? 'border-[#B43B2B] ring-2 ring-[#B43B2B]/80'
                    : isMasterpiece
                      ? 'gallery-card-masterpiece border-[#C9A45C]/80'
                      : 'border-[#E6E0D4] hover:border-[#CFC5B4]'
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    batchMode && onToggleBatchSelect
                      ? onToggleBatchSelect(item.id)
                      : onSelectItem(item)
                  }
                  aria-pressed={batchMode ? isSelected : undefined}
                  aria-label={
                    batchMode
                      ? `${isSelected ? '取消选择' : '选择'}「${item.title}」`
                      : `查看${CATEGORY_LABELS[item.category]}「${item.title}」详情`
                  }
                  className="flex flex-1 flex-col text-left cursor-pointer active:scale-[0.99]"
                >
                  {/* Art-Gallery Passe-Partout Cover Frame */}
                  <div className="p-2 pb-0">
                    <div className="gallery-cover-frame relative w-full">
                      <ArchivalImage
                        src={item.coverUrl}
                        alt={`${item.title}封面`}
                        title={item.title}
                        category={item.category}
                        className="aspect-[3/4] w-full rounded-[14px]"
                        imgClassName="group-hover:scale-[1.04]"
                      />
                      {batchMode ? (
                        <span
                          aria-hidden="true"
                          className={`absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-sm ${
                            isSelected
                              ? 'border-white bg-[#B43B2B] text-white'
                              : 'border-white/90 bg-[#1A1816]/65 text-transparent'
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </span>
                      ) : (
                        isMasterpiece && (
                          <span
                            aria-label="典藏级档案"
                            className="pointer-events-none absolute right-2 top-2 rounded-lg border border-[#E6C57A]/75 bg-[#1B1814]/85 px-2 py-0.5 font-editorial text-[11px] tracking-[0.14em] text-[#F2D68A] backdrop-blur-[2px]"
                          >
                            典藏
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  {/* Readable Archival Metadata */}
                  <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3.5 min-[420px]:px-3.5">
                    <p className="truncate font-mono text-[11px] text-[#7A7268] tabular-nums md:text-[10px]">
                      {metaLine}
                    </p>
                    <h2 className="mt-1 line-clamp-1 font-editorial text-[16px] min-[420px]:text-[17px] font-medium leading-snug text-[#1A1816] transition-colors group-hover:text-[#B43B2B] md:text-[16px]">
                      {item.title}
                    </h2>
                    {item.subtitle && (
                      <p className="mt-0.5 line-clamp-1 text-[13px] text-[#625C54] md:text-xs">
                        {item.subtitle}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-1.5 pt-2.5 text-[12px] text-[#7A7268] md:text-[11px]">
                      <span
                        className="inline-flex shrink-0 items-center gap-1 tabular-nums"
                        aria-label={
                          item.rating > 0 ? `个人评分 ${item.rating} 星` : '未评分'
                        }
                      >
                        {item.rating > 0 ? (
                          <>
                            <Star
                              className="h-3.5 w-3.5 fill-[#B43B2B] text-[#B43B2B] md:h-3 md:w-3"
                              aria-hidden="true"
                            />
                            <span className="font-mono font-medium text-[#1A1816]">
                              {item.rating}.0
                            </span>
                          </>
                        ) : (
                          <span>未评</span>
                        )}
                      </span>
                      {relatedSummary ? (
                        <span
                          data-testid={`card-relations-${item.id}`}
                          className="truncate font-medium text-[#5A534B] tabular-nums"
                        >
                          {relatedSummary}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] tabular-nums text-[#8C857B] md:text-[10px]">
                          {completeness.tierLabel} {completeness.score}/5
                        </span>
                      )}
                    </div>

                    {/* 5-Tick Archival Completeness Micro-Bar */}
                    <div
                      aria-hidden="true"
                      className="mt-2 grid grid-cols-5 gap-1"
                    >
                      {[0, 1, 2, 3, 4].map((idx) => (
                        <span
                          key={idx}
                          className={`h-[3px] rounded-full ${
                            idx < completeness.score
                              ? isMasterpiece
                                ? 'bg-[#A67C37]'
                                : 'bg-[#B43B2B]/80'
                              : 'bg-[#ECE7DD]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </button>

                {/* Desktop Hover Quick Card Preview Trigger (Sibling Button, Valid DOM) */}
                {onOpenCardModal && (
                  <button
                    type="button"
                    onClick={() => onOpenCardModal(item)}
                    aria-label={`以实体藏卡赏析「${item.title}」`}
                    title="实体藏卡赏析"
                    className="absolute left-3.5 top-3.5 hidden h-8 w-8 items-center justify-center rounded-xl border border-white/25 bg-[#1C1A17]/80 text-[#F5DC9B] opacity-0 backdrop-blur-xs transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[#1C1A17] cursor-pointer md:flex"
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
