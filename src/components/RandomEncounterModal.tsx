import { useEffect, useMemo } from 'react';
import { ArrowUpRight, Dices, Star, X } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import {
  CATEGORY_LABELS,
  getRelatedItems,
  getStatusLabel,
} from '../utils/archive';
import { computeItemCompleteness } from '../utils/collector';
import { computeItemDisplayMedals } from '../utils/medals';
import { ArchivalImage } from './ArchivalImage';
import { CinemaMedalSvg } from './CinemaMedalSvg';

interface RandomEncounterModalProps {
  item: ArchiveItem | null;
  allItems: ArchiveItem[];
  drawCount: number;
  onClose: () => void;
  onDrawAnother: () => void;
  onOpenFullDetail: (item: ArchiveItem) => void;
}

export function RandomEncounterModal({
  item,
  allItems,
  drawCount,
  onClose,
  onDrawAnother,
  onOpenFullDetail,
}: RandomEncounterModalProps) {
  useEffect(() => {
    if (!item) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, onClose]);

  const relatedItems = useMemo(
    () => (item ? getRelatedItems(item, allItems) : []),
    [item, allItems]
  );

  const completeness = useMemo(
    () => (item ? computeItemCompleteness(item) : null),
    [item]
  );

  const medalShowcase = useMemo(
    () => (item ? computeItemDisplayMedals(item, allItems) : null),
    [item, allItems]
  );

  if (!item || !completeness) return null;

  const isMasterpiece = completeness.tier === 'masterpiece';
  const storyExcerpt =
    item.quote ||
    item.notes ||
    item.characterProfile?.bio ||
    item.summary ||
    '暂未填写简介或手记，点击下方展开完整档案即可随时补充。';

  const metadataParts = [
    getStatusLabel(item.status, item.category),
    item.year,
    item.region,
    `${completeness.tierLabel} ${completeness.score}/${completeness.maxScore}`,
  ].filter(Boolean);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="random-encounter-title"
      data-testid="random-encounter-modal"
      data-item-id={item.id}
      className="encounter-backdrop-in fixed inset-0 z-[65] flex items-center justify-center bg-[#12100E]/75 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        key={`${item.id}-${drawCount}`}
        className={`${
          drawCount > 1 ? 'encounter-card-swap' : 'encounter-card-reveal'
        } relative flex max-h-[88vh] w-full max-w-[368px] flex-col overflow-hidden rounded-3xl border ${
          isMasterpiece ? 'border-[#C9A45C]' : 'border-[#3B352D]'
        } bg-[#F7F5F0] shadow-2xl`}
      >
        {/* Top Ceremonial Bar */}
        <div className="flex items-center justify-between bg-[#1C1A17] px-4 py-2.5 text-[#F5F1E8]">
          <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-[#D4AF6A] tabular-nums">
            <Dices className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              随机邂逅 · {item.accessionNo}
            </span>
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

        {/* Scrollable Card Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Framed Poster Hero with Contrast Scrim */}
          <div className="relative bg-[#151310] px-4 pt-3 pb-4">
            <div className="gallery-cover-frame relative mx-auto aspect-[4/3] w-full rounded-2xl border border-white/10 bg-[#1C1A17]">
              <ArchivalImage
                src={item.coverUrl}
                alt={`${item.title}封面`}
                title={item.title}
                category={item.category}
                className="h-full w-full rounded-2xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#12100E]/95 via-[#12100E]/60 to-transparent"
              />
              <div className="absolute inset-x-0 bottom-0 p-3.5 text-[#FAF7F0]">
                <p className="flex items-center gap-1.5 font-mono text-[11px] text-[#E4C37A] tabular-nums">
                  <span>{CATEGORY_LABELS[item.category]}</span>
                  {item.year && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{item.year}</span>
                    </>
                  )}
                  {item.rating > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-0.5 text-[#F6D58E]">
                        <Star
                          className="h-3 w-3 fill-[#F6D58E] text-[#F6D58E]"
                          aria-hidden="true"
                        />
                        {item.rating}.0
                      </span>
                    </>
                  )}
                </p>
                <h2
                  id="random-encounter-title"
                  className="mt-0.5 line-clamp-2 font-editorial text-xl font-medium leading-snug text-white"
                >
                  {item.title}
                </h2>
                {(item.originalTitle || item.subtitle) && (
                  <p className="mt-0.5 truncate text-xs text-[#CFC7B9]">
                    {item.originalTitle || item.subtitle}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Editorial Details Section */}
          <div className="space-y-3.5 px-5 py-4">
            {/* Unboxed Metadata Line */}
            <p className="text-xs text-[#625C54] tabular-nums">
              {metadataParts.join(' · ')}
            </p>

            {/* Quote or Story Excerpt */}
            <p
              className={`line-clamp-3 text-sm leading-relaxed ${
                item.quote
                  ? 'font-editorial italic text-[#1A1816]'
                  : 'text-[#2E2A26]'
              }`}
            >
              {item.quote ? `“${item.quote}”` : storyExcerpt}
            </p>

            {/* Earned Medals Mini Crest Row */}
            {medalShowcase && medalShowcase.earnedMedals.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-t border-[#E4DFD5] pt-3">
                <span className="text-[11px] font-medium text-[#7A7268] shrink-0">
                  已授勋章
                </span>
                <div className="flex items-center gap-2 overflow-hidden">
                  {medalShowcase.earnedMedals.slice(0, 3).map((medal) => (
                    <div
                      key={medal.id}
                      className="flex items-center gap-1 min-w-0"
                    >
                      <CinemaMedalSvg
                        category={medal.category}
                        motif={medal.motif}
                        tier={medal.tier}
                        monogram={medal.monogram}
                        size={26}
                        className="shrink-0"
                      />
                      <span className="truncate text-[11px] font-medium text-[#3D3832]">
                        {medal.shortTitle}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clean Unboxed Relations & Tags Footer */}
            {(relatedItems.length > 0 || item.tags.length > 0) && (
              <div className="space-y-1 border-t border-[#E4DFD5] pt-3 text-xs text-[#625C54]">
                {relatedItems.length > 0 && (
                  <p className="truncate">
                    <span className="text-[#8C857B]">关联：</span>
                    {relatedItems
                      .slice(0, 3)
                      .map((r) => r.title)
                      .join(' · ')}
                  </p>
                )}
                {item.tags.length > 0 && (
                  <p className="truncate">
                    <span className="text-[#8C857B]">标签：</span>
                    {item.tags.slice(0, 5).join(' · ')}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Ergonomic Action Bar */}
        <div className="flex items-center gap-2 border-t border-[#E4DFD5] bg-[#FAF9F6] px-4 py-3">
          {allItems.length > 1 && (
            <button
              type="button"
              onClick={onDrawAnother}
              data-testid="encounter-draw-another-btn"
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:border-[#1A1816]"
            >
              <Dices className="h-4 w-4 text-[#A67C37]" aria-hidden="true" />
              <span>再邂逅一次</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenFullDetail(item)}
            data-testid="encounter-open-detail-btn"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:bg-[#932D20]"
          >
            <span>展开完整档案</span>
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
