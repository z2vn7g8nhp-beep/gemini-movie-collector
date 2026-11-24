import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Dices, Film, Play, Star, X } from 'lucide-react';
import type { ArchiveItem, DecadeFilterOption } from '../types/archive';
import {
  CATEGORY_LABELS,
  getRelatedItems,
  getStatusLabel,
} from '../utils/archive';
import { computeItemCompleteness } from '../utils/collector';
import {
  DECADE_FILTER_OPTIONS,
  filterWatchlistPool,
  pickWatchlistBlindBoxItem,
} from '../utils/curation';
import { computeItemDisplayMedals } from '../utils/medals';
import { ArchivalImage } from './ArchivalImage';
import { CinemaMedalSvg } from './CinemaMedalSvg';

export type EncounterMode = 'all' | 'watchlist';

interface RandomEncounterModalProps {
  open: boolean;
  initialMode?: EncounterMode;
  item: ArchiveItem | null;
  allItems: ArchiveItem[];
  drawCount: number;
  onClose: () => void;
  onDrawAnother: () => void;
  onOpenFullDetail: (item: ArchiveItem) => void;
  onMarkWatching?: (item: ArchiveItem) => Promise<void>;
  onJumpToSearch?: () => void;
}

export function RandomEncounterModal({
  open,
  initialMode = 'all',
  item,
  allItems,
  drawCount,
  onClose,
  onDrawAnother,
  onOpenFullDetail,
  onMarkWatching,
  onJumpToSearch,
}: RandomEncounterModalProps) {
  const [mode, setMode] = useState<EncounterMode>(initialMode);
  const [watchlistDecade, setWatchlistDecade] = useState<DecadeFilterOption>('all');
  const [watchlistTag, setWatchlistTag] = useState('');
  const [watchlistPickedId, setWatchlistPickedId] = useState<string | null>(null);
  const [watchlistDrawCount, setWatchlistDrawCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setWatchlistDecade('all');
    setWatchlistTag('');
  }, [open, initialMode]);

  const watchlistAllFilms = useMemo(
    () => filterWatchlistPool(allItems),
    [allItems]
  );

  const watchlistTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of watchlistAllFilms) {
      for (const t of f.tags) {
        const clean = t.trim();
        if (!clean) continue;
        counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);
  }, [watchlistAllFilms]);

  const watchlistPool = useMemo(
    () =>
      filterWatchlistPool(allItems, {
        decade: watchlistDecade,
        tag: watchlistTag,
      }),
    [allItems, watchlistDecade, watchlistTag]
  );

  useEffect(() => {
    if (!open || mode !== 'watchlist') return;
    if (watchlistPool.length === 0) {
      setWatchlistPickedId(null);
      return;
    }
    if (!watchlistPickedId || !watchlistPool.some((f) => f.id === watchlistPickedId)) {
      const { picked } = pickWatchlistBlindBoxItem(allItems, {
        decade: watchlistDecade,
        tag: watchlistTag,
      });
      setWatchlistPickedId(picked?.id ?? null);
      setWatchlistDrawCount((n) => n + 1);
    }
  }, [open, mode, watchlistPool, watchlistPickedId, allItems, watchlistDecade, watchlistTag]);

  const activeItem = useMemo(() => {
    if (mode === 'watchlist') {
      return allItems.find((i) => i.id === watchlistPickedId) ?? null;
    }
    return item;
  }, [mode, allItems, watchlistPickedId, item]);

  const handleDrawWatchlist = useCallback(() => {
    const { picked } = pickWatchlistBlindBoxItem(
      allItems,
      { decade: watchlistDecade, tag: watchlistTag },
      watchlistPickedId ?? undefined
    );
    setWatchlistPickedId(picked?.id ?? null);
    setWatchlistDrawCount((n) => n + 1);
  }, [allItems, watchlistDecade, watchlistTag, watchlistPickedId]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'SELECT')) return;
      if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (mode === 'watchlist') {
          handleDrawWatchlist();
        } else if (allItems.length > 1) {
          onDrawAnother();
        }
      } else if (e.key === 'Enter' && activeItem) {
        e.preventDefault();
        onOpenFullDetail(activeItem);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    open,
    mode,
    activeItem,
    allItems.length,
    onClose,
    onDrawAnother,
    onOpenFullDetail,
    handleDrawWatchlist,
  ]);

  const relatedItems = useMemo(
    () => (activeItem ? getRelatedItems(activeItem, allItems) : []),
    [activeItem, allItems]
  );

  const completeness = useMemo(
    () => (activeItem ? computeItemCompleteness(activeItem) : null),
    [activeItem]
  );

  const medalShowcase = useMemo(
    () => (activeItem ? computeItemDisplayMedals(activeItem, allItems) : null),
    [activeItem, allItems]
  );

  if (!open) return null;

  const currentDrawCount = mode === 'watchlist' ? watchlistDrawCount : drawCount;
  const canDrawAgain =
    mode === 'watchlist' ? watchlistPool.length > 1 : allItems.length > 1;
  const isMasterpiece = completeness?.tier === 'masterpiece';

  const storyExcerpt = activeItem
    ? activeItem.quote ||
      activeItem.notes ||
      activeItem.characterProfile?.bio ||
      activeItem.summary ||
      '暂未填写简介或手记，点击下方展开完整档案即可随时补充。'
    : '';

  const metadataParts =
    activeItem && completeness
      ? [
          getStatusLabel(activeItem.status, activeItem.category),
          activeItem.year,
          activeItem.region,
          `${completeness.tierLabel} ${completeness.score}/${completeness.maxScore}`,
        ].filter(Boolean)
      : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="random-encounter-title"
      data-testid="random-encounter-modal"
      data-item-id={activeItem?.id ?? ''}
      data-mode={mode}
      className="encounter-backdrop-in fixed inset-0 z-[65] flex items-center justify-center overflow-hidden bg-[#12100E]/75 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-xs dark:bg-black/82"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        key={`${activeItem?.id ?? 'empty'}-${mode}-${currentDrawCount}`}
        className={`${
          currentDrawCount > 1 ? 'encounter-card-swap' : 'encounter-card-reveal'
        } relative flex max-h-[88dvh] w-full max-w-[396px] flex-col overflow-hidden rounded-3xl border md:max-w-[384px] ${
          isMasterpiece ? 'border-[#C9A45C]' : 'border-[#3B352D]'
        } bg-[#F7F5F0] shadow-2xl dark:bg-[#141210]`}
      >
        {/* Top Ceremonial Bar + Mode Switcher */}
        <div className="bg-[#1C1A17] px-3.5 py-2.5 text-[#F5F1E8]">
          <div className="flex items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="抽签模式"
              className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-white/10 p-0.5"
            >
              <button
                type="button"
                role="tab"
                data-testid="encounter-mode-all"
                aria-selected={mode === 'all'}
                onClick={() => setMode('all')}
                className={`min-h-[34px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  mode === 'all'
                    ? 'bg-[#FAF7F0] text-[#1A1816]'
                    : 'text-[#CFC7B9]'
                }`}
              >
                全馆邂逅
              </button>
              <button
                type="button"
                role="tab"
                data-testid="encounter-mode-watchlist"
                aria-selected={mode === 'watchlist'}
                onClick={() => setMode('watchlist')}
                className={`min-h-[34px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  mode === 'watchlist'
                    ? 'bg-[#B43B2B] text-white'
                    : 'text-[#CFC7B9]'
                }`}
              >
                今晚看什么 ({watchlistAllFilms.length})
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭随机邂逅"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#A59D90] hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Watchlist Blind-Box Filters */}
          {mode === 'watchlist' && watchlistAllFilms.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <select
                aria-label="限定待看年代"
                value={watchlistDecade}
                onChange={(e) => {
                  setWatchlistDecade(e.target.value as DecadeFilterOption);
                  setWatchlistPickedId(null);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#141210] px-2 text-xs text-[#FAF7F0] focus:border-[#D4AF6A] focus:outline-none"
              >
                {DECADE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {watchlistTags.length > 0 && (
                <select
                  aria-label="限定待看标签"
                  value={watchlistTag}
                  onChange={(e) => {
                    setWatchlistTag(e.target.value);
                    setWatchlistPickedId(null);
                  }}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#141210] px-2 text-xs text-[#FAF7F0] focus:border-[#D4AF6A] focus:outline-none"
                >
                  <option value="">全部题材标签</option>
                  {watchlistTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Empty Watchlist State */}
        {!activeItem || !completeness ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <Film className="h-8 w-8 text-[#A59D90] dark:text-[#7E766B]" aria-hidden="true" />
            <h2
              id="random-encounter-title"
              className="mt-3 font-editorial text-lg font-medium text-[#1A1816] dark:text-[#F3EFE6]"
            >
              {mode === 'watchlist'
                ? watchlistAllFilms.length === 0
                  ? '「想看」待看清单暂时为空'
                  : '当前年代/标签下暂无待看影片'
                : '藏馆暂无条目'}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#6E665C] dark:text-[#9E9588]">
              {mode === 'watchlist'
                ? '将感兴趣的影片设为「想看」，就能在这里用盲盒一键决定今晚看哪一部。'
                : '先联网搜索收录几部影视、影人或角色吧。'}
            </p>
            <div className="mt-5 flex w-full flex-col gap-2">
              {mode === 'watchlist' && watchlistAllFilms.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setWatchlistDecade('all');
                    setWatchlistTag('');
                  }}
                  className="h-11 w-full rounded-xl bg-[#1A1816] text-xs font-medium text-white cursor-pointer dark:bg-[#F3EFE6] dark:text-[#141210] dark:hover:bg-[#E4C37A]"
                >
                  清除限定条件重抽
                </button>
              )}
              {mode === 'watchlist' && allItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMode('all')}
                  className="h-11 w-full rounded-xl border border-[#DCD6CB] bg-white text-xs font-medium text-[#1A1816] cursor-pointer dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6]"
                >
                  切换为全馆随机邂逅
                </button>
              )}
              {onJumpToSearch && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onJumpToSearch();
                  }}
                  className="h-11 w-full rounded-xl bg-[#B43B2B] text-xs font-medium text-white cursor-pointer"
                >
                  去搜片加入待看清单
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Scrollable Card Body */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
              {/* Framed Poster Hero with Contrast Scrim */}
              <div className="relative bg-[#151310] px-4 pt-3 pb-4">
                <div className="gallery-cover-frame relative mx-auto aspect-[4/3] w-full rounded-2xl border border-white/10 bg-[#1C1A17]">
                  <ArchivalImage
                    src={activeItem.coverUrl}
                    alt={`${activeItem.title}封面`}
                    title={activeItem.title}
                    category={activeItem.category}
                    className="h-full w-full rounded-2xl"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#12100E]/95 via-[#12100E]/60 to-transparent"
                  />
                  <div className="absolute inset-x-0 bottom-0 p-3.5 text-[#FAF7F0]">
                    <p className="flex items-center gap-1.5 font-mono text-[12px] text-[#E4C37A] tabular-nums md:text-[11px]">
                      <span>
                        {mode === 'watchlist'
                          ? `待看盲盒 · 候选 ${watchlistPool.length} 部`
                          : CATEGORY_LABELS[activeItem.category]}
                      </span>
                      {activeItem.year && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{activeItem.year}</span>
                        </>
                      )}
                      {activeItem.rating > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-0.5 text-[#F6D58E]">
                            <Star
                              className="h-3 w-3 fill-[#F6D58E] text-[#F6D58E]"
                              aria-hidden="true"
                            />
                            {activeItem.rating}.0
                          </span>
                        </>
                      )}
                    </p>
                    <h2
                      id="random-encounter-title"
                      className="mt-0.5 line-clamp-2 font-editorial text-[22px] font-medium leading-snug text-white md:text-xl"
                    >
                      {activeItem.title}
                    </h2>
                    {(activeItem.originalTitle || activeItem.subtitle) && (
                      <p className="mt-0.5 truncate text-[13px] text-[#CFC7B9] md:text-xs">
                        {activeItem.originalTitle || activeItem.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Editorial Details Section */}
              <div className="space-y-3.5 px-5 py-4">
                <p className="text-[13px] text-[#625C54] tabular-nums md:text-xs dark:text-[#A59D90]">
                  {metadataParts.join(' · ')}
                </p>

                <p
                  className={`line-clamp-3 text-[15px] leading-relaxed md:text-sm ${
                    activeItem.quote
                      ? 'font-editorial italic text-[#1A1816] dark:text-[#F3EFE6]'
                      : 'text-[#2E2A26] dark:text-[#D5CEC2]'
                  }`}
                >
                  {activeItem.quote ? `“${activeItem.quote}”` : storyExcerpt}
                </p>

                {medalShowcase && medalShowcase.earnedMedals.length > 0 && (
                  <div className="flex items-center justify-between gap-2 border-t border-[#E4DFD5] pt-3 dark:border-[#2E2924]">
                    <span className="shrink-0 text-[12px] font-medium text-[#7A7268] md:text-[11px] dark:text-[#9E9588]">
                      已授勋章
                    </span>
                    <div className="flex items-center gap-2 overflow-hidden">
                      {medalShowcase.earnedMedals.slice(0, 3).map((medal) => (
                        <div
                          key={medal.id}
                          className="flex min-w-0 items-center gap-1"
                        >
                          <CinemaMedalSvg
                            category={medal.category}
                            motif={medal.motif}
                            tier={medal.tier}
                            monogram={medal.monogram}
                            size={26}
                            className="shrink-0"
                          />
                          <span className="truncate text-[12px] font-medium text-[#3D3832] md:text-[11px] dark:text-[#D5CEC2]">
                            {medal.shortTitle}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(relatedItems.length > 0 || activeItem.tags.length > 0) && (
                  <div className="space-y-1 border-t border-[#E4DFD5] pt-3 text-[13px] text-[#625C54] md:text-xs dark:border-[#2E2924] dark:text-[#B8AFA2]">
                    {relatedItems.length > 0 && (
                      <p className="truncate">
                        <span className="text-[#8C857B] dark:text-[#8E8578]">关联：</span>
                        {relatedItems
                          .slice(0, 3)
                          .map((r) => r.title)
                          .join(' · ')}
                      </p>
                    )}
                    {activeItem.tags.length > 0 && (
                      <p className="truncate">
                        <span className="text-[#8C857B] dark:text-[#8E8578]">标签：</span>
                        {activeItem.tags.slice(0, 5).join(' · ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Ergonomic Action Bar */}
            <div className="flex items-center gap-2 border-t border-[#E4DFD5] bg-[#FAF9F6] px-4 py-3 dark:border-[#2E2924] dark:bg-[#191613]">
              {canDrawAgain && (
                <button
                  type="button"
                  onClick={() =>
                    mode === 'watchlist' ? handleDrawWatchlist() : onDrawAnother()
                  }
                  data-testid="encounter-draw-another-btn"
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-3 text-[14px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform md:min-h-[44px] md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#564E44]"
                >
                  <Dices className="h-4 w-4 text-[#A67C37] dark:text-[#E4C37A]" aria-hidden="true" />
                  <span>{mode === 'watchlist' ? '换一部' : '再邂逅一次'}</span>
                </button>
              )}

              {mode === 'watchlist' && onMarkWatching ? (
                <button
                  type="button"
                  data-testid="encounter-start-watching-btn"
                  onClick={async () => {
                    await onMarkWatching(activeItem);
                    onOpenFullDetail(activeItem);
                  }}
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-[14px] font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform md:min-h-[44px] md:text-xs"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  <span>就看这部</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenFullDetail(activeItem)}
                  data-testid="encounter-open-detail-btn"
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-[14px] font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform md:min-h-[44px] md:text-xs"
                >
                  <span>展开完整档案</span>
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
