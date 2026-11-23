import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Layers, Star } from 'lucide-react';
import type { ArchiveCategory, ArchiveItem, CollectionStatus } from '../types/archive';
import {
  CATEGORY_LABELS,
  formatRelatedSummary,
  getRelatedItems,
  getStatusLabel,
} from '../utils/archive';
import { computeItemCompleteness } from '../utils/collector';
import {
  LONG_PRESS_DURATION_MS,
  isPointerDragExceeded,
  type Point2D,
} from '../utils/quickStatusMenu';
import { getArchiveCardVisualClasses } from '../utils/uiHelpers';
import { ArchivalImage } from './ArchivalImage';
import { QuickStatusPopover } from './QuickStatusPopover';
import exhibitionFilmPlate from '../assets/images/film_mood_for_love_1795056021110.jpg';
import exhibitionDirectorPlate from '../assets/images/person_director_portrait_1795056021998.jpg';
import exhibitionCharacterPlate from '../assets/images/char_chow_mowan_1795056022176.jpg';

export type ArchiveViewMode = 'grid' | 'list';

const EXHIBITION_PLATES: Array<{
  num: string;
  category: ArchiveCategory;
  title: string;
  caption: string;
  image: string;
  offsetClass: string;
}> = [
  {
    num: '01',
    category: 'film',
    title: '影视典藏',
    caption: '影片与剧集',
    image: exhibitionFilmPlate,
    offsetClass: '',
  },
  {
    num: '02',
    category: 'person',
    title: '影人脉络',
    caption: '导演与演员',
    image: exhibitionDirectorPlate,
    offsetClass: 'sm:mt-7',
  },
  {
    num: '03',
    category: 'character',
    title: '角色小传',
    caption: '难忘荧幕身影',
    image: exhibitionCharacterPlate,
    offsetClass: '',
  },
];

interface ArchiveGridProps {
  items: ArchiveItem[];
  allItems: ArchiveItem[];
  searchQuery: string;
  activeTag?: string;
  activeAlbumName?: string;
  viewMode?: ArchiveViewMode;
  batchMode?: boolean;
  selectedIds?: string[];
  locatedItemId?: string | null;
  locatedJumpTick?: number;
  onToggleBatchSelect?: (id: string) => void;
  onSelectItem: (item: ArchiveItem) => void;
  onQuickUpdateStatus?: (item: ArchiveItem, status: CollectionStatus) => void;
  onOpenCardModal?: (item: ArchiveItem) => void;
  onJumpToSearch: (query?: string, category?: ArchiveCategory) => void;
  onJumpToCreate: () => void;
  onResetFilters: () => void;
}

interface QuickMenuState {
  itemId: string;
  anchor: Point2D;
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
  locatedItemId = null,
  locatedJumpTick = 0,
  onToggleBatchSelect,
  onSelectItem,
  onQuickUpdateStatus,
  onOpenCardModal,
  onJumpToSearch,
  onJumpToCreate,
  onResetFilters,
}: ArchiveGridProps) {
  const selectedIdSet = new Set(selectedIds);
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);
  const [pressingItemId, setPressingItemId] = useState<string | null>(null);

  const cardButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClearTimerRef = useRef<number | null>(null);
  const suppressClickItemIdRef = useRef<string | null>(null);
  const pressStartRef = useRef<{
    itemId: string;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  // Smoothly scroll to and focus the auto-selected item after jumping from DetailDrawer
  useEffect(() => {
    if (!locatedItemId || locatedJumpTick <= 0) return;
    const rafId = window.requestAnimationFrame(() => {
      const targetBtn = cardButtonRefs.current.get(locatedItemId);
      if (!targetBtn) return;
      targetBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try {
        targetBtn.focus({ preventScroll: true });
      } catch {
        // Ignore focus errors in restricted environments
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [locatedItemId, locatedJumpTick, viewMode]);

  const setCardButtonRef = useCallback(
    (itemId: string, node: HTMLButtonElement | null) => {
      if (node) {
        cardButtonRefs.current.set(itemId, node);
      } else {
        cardButtonRefs.current.delete(itemId);
      }
    },
    []
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pressStartRef.current = null;
    setPressingItemId(null);
  }, []);

  useEffect(() => {
    if (batchMode) {
      cancelLongPress();
      setQuickMenu(null);
    }
  }, [batchMode, cancelLongPress]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      if (suppressClearTimerRef.current !== null) {
        window.clearTimeout(suppressClearTimerRef.current);
      }
    };
  }, []);

  const openQuickMenuFor = useCallback((item: ArchiveItem, anchor: Point2D) => {
    setQuickMenu({ itemId: item.id, anchor });
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch {
      // Ignore haptics unsupported errors
    }
  }, []);

  const handleCardPointerDown = useCallback(
    (item: ArchiveItem, e: React.PointerEvent<HTMLButtonElement>) => {
      if (batchMode || !onQuickUpdateStatus) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      cancelLongPress();
      const startX = e.clientX;
      const startY = e.clientY;
      pressStartRef.current = {
        itemId: item.id,
        pointerId: e.pointerId,
        x: startX,
        y: startY,
      };
      setPressingItemId(item.id);

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        pressStartRef.current = null;
        setPressingItemId(null);
        suppressClickItemIdRef.current = item.id;
        if (suppressClearTimerRef.current !== null) {
          window.clearTimeout(suppressClearTimerRef.current);
        }
        suppressClearTimerRef.current = window.setTimeout(() => {
          suppressClickItemIdRef.current = null;
          suppressClearTimerRef.current = null;
        }, 700);
        openQuickMenuFor(item, { x: startX, y: startY });
      }, LONG_PRESS_DURATION_MS);
    },
    [batchMode, onQuickUpdateStatus, cancelLongPress, openQuickMenuFor]
  );

  const handleCardPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const start = pressStartRef.current;
      if (!start || start.pointerId !== e.pointerId) return;
      if (isPointerDragExceeded(start, { x: e.clientX, y: e.clientY })) {
        cancelLongPress();
      }
    },
    [cancelLongPress]
  );

  const handleCardClick = useCallback(
    (item: ArchiveItem, e: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickItemIdRef.current === item.id) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickItemIdRef.current = null;
        if (suppressClearTimerRef.current !== null) {
          window.clearTimeout(suppressClearTimerRef.current);
          suppressClearTimerRef.current = null;
        }
        return;
      }
      if (batchMode && onToggleBatchSelect) {
        onToggleBatchSelect(item.id);
      } else {
        onSelectItem(item);
      }
    },
    [batchMode, onToggleBatchSelect, onSelectItem]
  );

  const handleCardContextMenu = useCallback(
    (item: ArchiveItem, e: React.MouseEvent<HTMLButtonElement>) => {
      if (batchMode || !onQuickUpdateStatus) return;
      if (
        pressStartRef.current?.itemId === item.id ||
        suppressClickItemIdRef.current === item.id ||
        quickMenu?.itemId === item.id
      ) {
        e.preventDefault();
      }
    },
    [batchMode, onQuickUpdateStatus, quickMenu]
  );

  const handleCardKeyDown = useCallback(
    (item: ArchiveItem, e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (batchMode || !onQuickUpdateStatus) return;
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        openQuickMenuFor(item, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
    },
    [batchMode, onQuickUpdateStatus, openQuickMenuFor]
  );

  const quickMenuItem = quickMenu
    ? items.find((i) => i.id === quickMenu.itemId) ??
      allItems.find((i) => i.id === quickMenu.itemId) ??
      null
    : null;

  if (allItems.length === 0) {
    return (
      <section
        aria-label="私人光影档案馆导览"
        className="mx-auto max-w-[1180px] px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-8 md:pb-16"
      >
        <div className="border-t border-[#E4DFD5] pt-7 md:pt-10 dark:border-[#2E2924]">
          <div className="grid grid-cols-1 items-center gap-9 lg:grid-cols-12 lg:gap-12">
            {/* Left Editorial Manifesto (Single Dominant CTA + Unboxed Hairline Pillars) */}
            <div className="lg:col-span-6">
              <p className="text-[12px] tracking-[0.2em] text-[#8C857B] dark:text-[#9A9184]">
                私人光影档案馆
              </p>

              <h1 className="mt-3 font-editorial text-[30px] font-medium leading-[1.24] tracking-[0.02em] text-[#1A1816] sm:text-[38px] lg:text-[42px] dark:text-[#F5F1E8]">
                <span className="block">为打动过你的光影</span>
                <span className="block">立一座私人藏馆</span>
              </h1>

              <p className="mt-4 max-w-[32em] text-[15px] leading-[1.8] text-[#5F584F] dark:text-[#B5ACA0]">
                直连检索影片、影人与经典角色，织就双向关系脉络，收存台词摘录与观影手记，并点亮实体藏卡与影藏勋章。
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onJumpToSearch()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#B43B2B] px-6 text-[14px] font-medium tracking-[0.02em] text-white whitespace-nowrap cursor-pointer active:scale-[0.98] transition-colors hover:bg-[#932D20]"
                >
                  <span>联网搜索收录</span>
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onJumpToCreate}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#D8D0C2] bg-transparent px-5 text-[14px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.98] transition-colors hover:border-[#1A1816] hover:bg-[#FFFDF9] dark:border-[#3E3830] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A] dark:hover:bg-[#1D1A17]"
                >
                  手动建档
                </button>
              </div>

              {/* Quiet Editorial 3-Pillar Index (Zero Nested Boxes) */}
              <div className="mt-9 grid grid-cols-3 gap-4 border-t border-[#E6E0D4] pt-5 sm:gap-6 dark:border-[#2C2721]">
                <div>
                  <p className="font-mono text-[11px] tabular-nums text-[#B43B2B] dark:text-[#E4C37A]">
                    01
                  </p>
                  <p className="mt-1 font-editorial text-[14px] font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                    影视典藏
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#746C61] dark:text-[#9A9184]">
                    海报评分、状态与经典台词
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[11px] tabular-nums text-[#B43B2B] dark:text-[#E4C37A]">
                    02
                  </p>
                  <p className="mt-1 font-editorial text-[14px] font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                    影人脉络
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#746C61] dark:text-[#9A9184]">
                    串联导演演员与双向关系星图
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[11px] tabular-nums text-[#B43B2B] dark:text-[#E4C37A]">
                    03
                  </p>
                  <p className="mt-1 font-editorial text-[14px] font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                    角色小传
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#746C61] dark:text-[#9A9184]">
                    定格荧幕身影与实体藏卡勋章
                  </p>
                </div>
              </div>
            </div>

            {/* Right Museum Exhibition Triptych (Staggered Archival Print Plates) */}
            <div className="lg:col-span-6">
              <div className="grid grid-cols-3 items-start gap-3 sm:gap-4">
                {EXHIBITION_PLATES.map((plate) => (
                  <button
                    key={plate.category}
                    type="button"
                    onClick={() => onJumpToSearch('', plate.category)}
                    aria-label={`按${plate.title}开始联网收录`}
                    className={`group text-left cursor-pointer ${plate.offsetClass}`}
                  >
                    <div className="rounded-[12px] border border-[#E4DDD0] bg-[#FFFDF9] p-1.5 shadow-[0_8px_22px_-16px_rgba(24,18,12,0.22)] transition-all duration-200 group-hover:-translate-y-1 group-hover:border-[#C9A45C] dark:border-[#322D27] dark:bg-[#1B1815] dark:group-hover:border-[#D4AF6A]/70">
                      <div className="gallery-cover-frame aspect-[3/4] w-full">
                        <img
                          src={plate.image}
                          alt={`${plate.title}展陈示例`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover object-top transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                        />
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between gap-1 px-0.5">
                      <span className="font-editorial text-[13px] font-medium text-[#1A1816] transition-colors group-hover:text-[#B43B2B] dark:text-[#EFEAE0] dark:group-hover:text-[#E4C37A]">
                        {plate.title}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-[#8C857B] dark:text-[#9A9184]">
                        {plate.num}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate px-0.5 text-[11px] text-[#7A7268] dark:text-[#9A9184]">
                      {plate.caption}
                    </p>
                  </button>
                ))}
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
        <div className="mx-auto max-w-md rounded-2xl border border-[#E4DFD5] bg-[#FFFDF9] px-6 py-10 text-center dark:border-[#322D27] dark:bg-[#1D1A17]">
          <p className="font-mono text-xs tracking-[0.14em] text-[#8C857B] dark:text-[#9A9184]">
            筛查结果为空
          </p>
          <h2 className="mt-2 font-editorial text-xl font-medium text-[#1A1816] dark:text-[#F3EFE6]">
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
              className="min-h-[44px] rounded-xl border border-[#DCD6CB] bg-white px-5 text-sm font-medium text-[#1A1816] cursor-pointer transition-colors hover:border-[#1A1816] active:scale-[0.98] dark:border-[#3E3830] dark:bg-[#25211D] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
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
        <div className="flex flex-col gap-2.5">
          {items.map((item) => {
            const relatedItems = getRelatedItems(item, allItems);
            const relatedSummary = formatRelatedSummary(relatedItems);
            const completeness = computeItemCompleteness(item);
            const isMasterpiece = completeness.tier === 'masterpiece';
            const isFavorite = item.status === 'favorite';
            const excerpt = item.quote || item.notes || item.summary;

            const isSelected = batchMode && selectedIdSet.has(item.id);
            const isLocated = !batchMode && locatedItemId === item.id;
            const isPressing = pressingItemId === item.id;
            const cardVisual = getArchiveCardVisualClasses({
              status: item.status,
              isMasterpiece,
              isSelected,
              isLocated,
              isPressing,
              viewMode: 'list',
            });

            return (
              <article
                key={item.id}
                data-favorite-glow={cardVisual.hasFavoriteGlow ? 'true' : undefined}
                data-located={isLocated ? 'true' : undefined}
                className={`group relative flex items-center gap-3.5 rounded-xl border px-3.5 py-3 transition-all sm:px-5 sm:py-3.5 ${cardVisual.frameClassName}`}
              >
                <button
                  ref={(node) => setCardButtonRef(item.id, node)}
                  type="button"
                  data-testid={`archive-card-${item.id}`}
                  data-status={item.status}
                  data-located={isLocated ? 'true' : undefined}
                  aria-current={isLocated ? 'true' : undefined}
                  onClick={(e) => handleCardClick(item, e)}
                  onPointerDown={(e) => handleCardPointerDown(item, e)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onContextMenu={(e) => handleCardContextMenu(item, e)}
                  onKeyDown={(e) => handleCardKeyDown(item, e)}
                  aria-pressed={batchMode ? isSelected : undefined}
                  aria-label={
                    batchMode
                      ? `${isSelected ? '取消选择' : '选择'}「${item.title}」`
                      : `${isLocated ? '当前已选中 · ' : ''}查看${CATEGORY_LABELS[item.category]}「${item.title}」详情`
                  }
                  className="flex min-w-0 flex-1 items-center gap-3.5 text-left select-none [-webkit-touch-callout:none] cursor-pointer"
                >
                  {batchMode && (
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                        isSelected
                          ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                          : 'border-[#CFC7B9] bg-white text-transparent dark:border-[#4D453B] dark:bg-[#25211D]'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div className="gallery-cover-frame w-[52px] shrink-0 sm:w-[56px]">
                    <ArchivalImage
                      src={item.coverUrl}
                      alt={`${item.title}封面`}
                      title={item.title}
                      category={item.category}
                      compact
                      className="aspect-[3/4] w-full rounded-[8px]"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-[#7A7268] dark:text-[#9E9588]">
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
                      <span
                        className={
                          isFavorite ? 'font-medium text-[#8E6523] dark:text-[#E4C37A]' : undefined
                        }
                      >
                        {getStatusLabel(item.status, item.category)}
                      </span>
                      {isMasterpiece && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#8E6523] dark:text-[#E4C37A]">典藏</span>
                        </>
                      )}
                      {isLocated && (
                        <span
                          data-testid={`located-badge-${item.id}`}
                          className="ml-0.5 inline-flex items-center rounded-md bg-[#B43B2B] px-1.5 py-0.5 font-sans text-[10px] font-medium text-white dark:bg-[#E4C37A] dark:text-[#141210]"
                        >
                          已选中
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-baseline gap-2">
                      <h2 className="truncate font-editorial text-[16px] font-medium text-[#1A1816] group-hover:text-[#B43B2B] transition-colors dark:text-[#F3EFE6] dark:group-hover:text-[#F28C7B]">
                        {item.title}
                      </h2>
                      {item.originalTitle && (
                        <span className="hidden truncate text-xs text-[#8C857B] sm:inline dark:text-[#9A9184]">
                          {item.originalTitle}
                        </span>
                      )}
                    </div>

                    {excerpt && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-[#625C54] dark:text-[#B8AFA2]">
                        {item.quote ? `“${item.quote}”` : excerpt}
                      </p>
                    )}
                  </div>

                  <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                    <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
                      {item.rating > 0 ? (
                        <>
                          <Star
                            className="h-3.5 w-3.5 fill-[#B43B2B] text-[#B43B2B] dark:fill-[#EB7865] dark:text-[#EB7865]"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                            {item.rating}.0
                          </span>
                        </>
                      ) : (
                        <span className="text-[#8C857B] dark:text-[#9A9184]">未评</span>
                      )}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[#7A7268] dark:text-[#9E9588]">
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
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E4DFD5] bg-white text-[#625C54] transition-colors hover:border-[#1A1816] hover:text-[#1A1816] cursor-pointer md:inline-flex dark:border-[#3A342D] dark:bg-[#25211D] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]"
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {quickMenu && quickMenuItem && onQuickUpdateStatus && (
          <QuickStatusPopover
            item={quickMenuItem}
            anchor={quickMenu.anchor}
            onSelectStatus={onQuickUpdateStatus}
            onClose={() => setQuickMenu(null)}
          />
        )}
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
          const isFavorite = item.status === 'favorite';
          const metaPrefix = [
            item.accessionNo,
            CATEGORY_LABELS[item.category],
            item.year,
          ]
            .filter(Boolean)
            .join(' · ');
          const statusLabel = getStatusLabel(item.status, item.category);

          const isSelected = batchMode && selectedIdSet.has(item.id);
          const isLocated = !batchMode && locatedItemId === item.id;
          const isPressing = pressingItemId === item.id;
          const cardVisual = getArchiveCardVisualClasses({
            status: item.status,
            isMasterpiece,
            isSelected,
            isLocated,
            isPressing,
            viewMode: 'grid',
          });

          return (
            <article key={item.id} className="group relative flex min-w-0 flex-col">
              <div
                data-favorite-glow={cardVisual.hasFavoriteGlow ? 'true' : undefined}
                data-located={isLocated ? 'true' : undefined}
                className={`gallery-card gallery-card-interactive relative flex flex-1 flex-col overflow-hidden border ${cardVisual.frameClassName}`}
              >
                <button
                  ref={(node) => setCardButtonRef(item.id, node)}
                  type="button"
                  data-testid={`archive-card-${item.id}`}
                  data-status={item.status}
                  data-located={isLocated ? 'true' : undefined}
                  aria-current={isLocated ? 'true' : undefined}
                  onClick={(e) => handleCardClick(item, e)}
                  onPointerDown={(e) => handleCardPointerDown(item, e)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onContextMenu={(e) => handleCardContextMenu(item, e)}
                  onKeyDown={(e) => handleCardKeyDown(item, e)}
                  aria-pressed={batchMode ? isSelected : undefined}
                  aria-label={
                    batchMode
                      ? `${isSelected ? '取消选择' : '选择'}「${item.title}」`
                      : `${isLocated ? '当前已选中 · ' : ''}查看${CATEGORY_LABELS[item.category]}「${item.title}」详情`
                  }
                  className="flex flex-1 flex-col text-left select-none [-webkit-touch-callout:none] cursor-pointer active:scale-[0.99]"
                >
                  {/* Art-Gallery Passe-Partout Cover Frame (Mathematical Nested Radius: 14px outer - 6px pad = 8px inner) */}
                  <div className="p-1.5 pb-0">
                    <div className="gallery-cover-frame relative w-full">
                      <ArchivalImage
                        src={item.coverUrl}
                        alt={`${item.title}封面`}
                        title={item.title}
                        category={item.category}
                        className="aspect-[3/4] w-full rounded-[9px]"
                        imgClassName="group-hover:scale-[1.035]"
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
                        <>
                          {isMasterpiece && (
                            <span
                              aria-label="典藏级档案"
                              className="pointer-events-none absolute right-2 top-2 rounded-[5px] border border-[#E6C57A]/65 bg-[#191613]/82 px-1.5 py-0.5 font-editorial text-[10px] tracking-[0.16em] text-[#F2D68A] backdrop-blur-[2px]"
                            >
                              典藏
                            </span>
                          )}
                          {isLocated && (
                            <span
                              data-testid={`located-badge-${item.id}`}
                              className="pointer-events-none absolute bottom-2 left-2 rounded-[5px] bg-[#B43B2B] px-1.5 py-0.5 text-[10px] font-medium tracking-[0.06em] text-white shadow-sm dark:bg-[#E4C37A] dark:text-[#141210]"
                            >
                              已选中
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Museum Catalog Typography */}
                  <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3 min-[420px]:px-3.5">
                    <p className="truncate font-mono text-[10px] tracking-[0.02em] text-[#837B70] tabular-nums dark:text-[#9A9184]">
                      <span>{metaPrefix}</span>
                      <span aria-hidden="true"> · </span>
                      <span
                        className={
                          isFavorite ? 'font-medium text-[#8E6523] dark:text-[#E4C37A]' : undefined
                        }
                      >
                        {statusLabel}
                      </span>
                    </p>
                    <h2 className="mt-1 line-clamp-1 font-editorial text-[16px] font-medium leading-snug tracking-[0.01em] text-[#1A1816] transition-colors group-hover:text-[#B43B2B] min-[420px]:text-[16.5px] dark:text-[#F3EFE6] dark:group-hover:text-[#F28C7B]">
                      {item.title}
                    </h2>
                    {item.subtitle && (
                      <p className="mt-0.5 line-clamp-1 text-[12px] text-[#6E675E] dark:text-[#AEA598]">
                        {item.subtitle}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-1.5 pt-2.5 text-[11px] text-[#7A7268] dark:text-[#9E9588]">
                      <span
                        className="inline-flex shrink-0 items-center gap-1 tabular-nums"
                        aria-label={
                          item.rating > 0 ? `个人评分 ${item.rating} 星` : '未评分'
                        }
                      >
                        {item.rating > 0 ? (
                          <>
                            <Star
                              className="h-3 w-3 fill-[#B43B2B] text-[#B43B2B] dark:fill-[#EB7865] dark:text-[#EB7865]"
                              aria-hidden="true"
                            />
                            <span className="font-mono font-medium text-[#1A1816] dark:text-[#F3EFE6]">
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
                          className="truncate font-medium text-[#5A534B] tabular-nums dark:text-[#C4BCB0]"
                        >
                          {relatedSummary}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] tabular-nums text-[#8C857B] dark:text-[#9A9184]">
                          {completeness.tierLabel} {completeness.score}/5
                        </span>
                      )}
                    </div>

                    {/* Razor-Thin Archival Completeness Hairline */}
                    <div
                      aria-hidden="true"
                      className="mt-2 grid grid-cols-5 gap-1"
                    >
                      {[0, 1, 2, 3, 4].map((idx) => (
                        <span
                          key={idx}
                          className={`h-[2px] rounded-full ${
                            idx < completeness.score
                              ? isMasterpiece
                                ? 'bg-[#A67C37] dark:bg-[#D4AF6A]'
                                : 'bg-[#B43B2B]/75 dark:bg-[#E06856]'
                              : 'bg-[#ECE7DD] dark:bg-[#2F2A24]'
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
                    className="absolute left-3 top-3 hidden h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-[#191613]/78 text-[#F2D68A] opacity-0 backdrop-blur-xs transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[#191613] cursor-pointer md:flex"
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {quickMenu && quickMenuItem && onQuickUpdateStatus && (
        <QuickStatusPopover
          item={quickMenuItem}
          anchor={quickMenu.anchor}
          onSelectStatus={onQuickUpdateStatus}
          onClose={() => setQuickMenu(null)}
        />
      )}
    </section>
  );
}
