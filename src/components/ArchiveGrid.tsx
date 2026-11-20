import { Star } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import {
  CATEGORY_LABELS,
  formatRelatedSummary,
  getRelatedItems,
  getStatusLabel,
} from '../utils/archive';
import { computeItemCompleteness } from '../utils/collector';
import { ArchivalImage } from './ArchivalImage';

interface ArchiveGridProps {
  items: ArchiveItem[];
  allItems: ArchiveItem[];
  searchQuery: string;
  activeTag?: string;
  activeAlbumName?: string;
  onSelectItem: (item: ArchiveItem) => void;
  onJumpToSearch: (query?: string) => void;
  onJumpToCreate: () => void;
  onResetFilters: () => void;
  onLoadSampleCollection?: () => void;
}

export function ArchiveGrid({
  items,
  allItems,
  searchQuery,
  activeTag = '',
  activeAlbumName = '',
  onSelectItem,
  onJumpToSearch,
  onJumpToCreate,
  onResetFilters,
  onLoadSampleCollection,
}: ArchiveGridProps) {
  if (allItems.length === 0) {
    return (
      <section className="mx-auto max-w-[1160px] px-4 py-8 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-[#E4DFD5] bg-white px-6 py-10 text-center">
          <p className="text-xs tracking-[0.14em] text-[#8C857B]">
            个人藏馆待建档
          </p>
          <h2 className="mt-2 font-editorial text-xl font-medium text-[#1A1816]">
            还没有收藏任何条目
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-[#625C54]">
            在上方搜索栏直接搜片名、影人或角色即可直连联网收录，也可以手动建档。
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => onJumpToSearch()}
              className="min-h-[46px] rounded-xl bg-[#B43B2B] px-5 text-sm font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#932D20]"
            >
              联网搜索收录
            </button>
            <button
              type="button"
              onClick={onJumpToCreate}
              className="min-h-[46px] rounded-xl border border-[#DCD6CB] bg-white px-5 text-sm font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.98] transition-transform"
            >
              手动建档
            </button>
          </div>
          {onLoadSampleCollection && (
            <button
              type="button"
              onClick={onLoadSampleCollection}
              className="mt-3 inline-flex min-h-[36px] items-center justify-center rounded-lg px-3 text-xs font-medium text-[#625C54] underline decoration-[#D4CDC0] underline-offset-4 cursor-pointer hover:text-[#1A1816] hover:decoration-[#1A1816]"
            >
              载入 6 件精选示例馆藏
            </button>
          )}
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-[1160px] px-4 py-10 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-[#E4DFD5] bg-white px-6 py-10 text-center">
          <p className="text-xs tracking-[0.14em] text-[#8C857B]">
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
                className="min-h-[44px] rounded-xl bg-[#B43B2B] px-5 text-sm font-medium text-white cursor-pointer active:scale-[0.98]"
              >
                去全网搜「{searchQuery}」
              </button>
            )}
            <button
              type="button"
              onClick={onResetFilters}
              className="min-h-[44px] rounded-xl border border-[#DCD6CB] bg-white px-5 text-sm font-medium text-[#1A1816] cursor-pointer active:scale-[0.98]"
            >
              查看全部藏品
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="藏品陈列网格"
      data-testid="archive-grid"
      className="mx-auto max-w-[1160px] px-4 pt-2.5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pb-16"
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

          return (
            <article key={item.id} className="group flex min-w-0 flex-col">
              <button
                type="button"
                onClick={() => onSelectItem(item)}
                aria-label={`查看${CATEGORY_LABELS[item.category]}「${item.title}」详情`}
                className={`gallery-card flex flex-1 flex-col overflow-hidden border text-left cursor-pointer active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B43B2B] ${
                  isMasterpiece
                    ? 'gallery-card-masterpiece border-[#C9A45C]/80'
                    : 'border-[#E6E0D4] hover:border-[#D4CBB8]'
                }`}
              >
                {/* Art-Gallery Passe-Partout Cover Frame (Zero Sharp Corners + Granular Print Shadow) */}
                <div className="p-2 pb-0">
                  <div className="gallery-cover-frame relative w-full">
                    <ArchivalImage
                      src={item.coverUrl}
                      alt={`${item.title}封面`}
                      title={item.title}
                      category={item.category}
                      className="aspect-[3/4] w-full rounded-[14px]"
                      imgClassName="group-hover:scale-[1.035]"
                    />
                    {isMasterpiece && (
                      <span
                        aria-label="典藏级档案"
                        className="pointer-events-none absolute right-2 top-2 rounded-lg border border-[#E6C57A]/75 bg-[#1B1814]/85 px-2 py-0.5 font-editorial text-[11px] tracking-[0.14em] text-[#F2D68A] backdrop-blur-[2px]"
                      >
                        典藏
                      </span>
                    )}
                  </div>
                </div>

                {/* Readable iPhone 16 Pro Max Optimized Card Metadata */}
                <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3.5 min-[420px]:px-3.5">
                  <p className="truncate font-mono text-[11px] min-[420px]:text-[12px] text-[#7A7268] tabular-nums md:text-[10px]">
                    {metaLine}
                  </p>
                  <h2 className="mt-1 line-clamp-1 font-editorial text-[16px] min-[420px]:text-[17px] font-medium leading-snug text-[#1A1816] md:text-[15px]">
                    {item.title}
                  </h2>
                  {item.subtitle && (
                    <p className="mt-0.5 line-clamp-1 text-[13px] text-[#625C54] md:text-xs">
                      {item.subtitle}
                    </p>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-1.5 pt-2.5 text-[12px] min-[420px]:text-[13px] text-[#7A7268] md:text-[11px]">
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
                      <span className="font-mono text-[11px] min-[420px]:text-[12px] tabular-nums text-[#8C857B] md:text-[10px]">
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
