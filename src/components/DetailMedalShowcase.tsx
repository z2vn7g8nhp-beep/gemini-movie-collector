import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import {
  computeItemDisplayMedals,
  type CinemaMedal,
} from '../utils/medals';
import { CinemaMedalSvg } from './CinemaMedalSvg';
import { MedalInspectModal } from './MedalInspectModal';

interface DetailMedalShowcaseProps {
  item: ArchiveItem;
  allItems: ArchiveItem[];
  onFilterByTag: (tag: string) => void;
  onJumpToMedalHall?: () => void;
}

export function DetailMedalShowcase({
  item,
  allItems,
  onFilterByTag,
  onJumpToMedalHall,
}: DetailMedalShowcaseProps) {
  const [inspectingMedal, setInspectingMedal] = useState<CinemaMedal | null>(
    null
  );

  const showcase = useMemo(
    () => computeItemDisplayMedals(item, allItems),
    [item, allItems]
  );

  if (showcase.earnedMedals.length === 0 && !showcase.nextMedal) {
    return null;
  }

  return (
    <>
      <section
        aria-label="本条目影藏勋章"
        data-testid="detail-medal-showcase"
        className="gallery-card-dark mt-4 border border-[#C9A45C]/40 p-3.5 text-[#F5F1E8]"
      >
        {/* Velvet Showcase Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="font-editorial text-[16px] font-medium text-[#FAF7F0] whitespace-nowrap md:text-sm">
              影藏勋章
            </h3>
            <span className="font-mono text-[12px] tabular-nums text-[#E4C37A] whitespace-nowrap md:text-[11px]">
              已授 {showcase.earnedMedals.length} 枚
            </span>
          </div>

          {onJumpToMedalHall && (
            <button
              type="button"
              onClick={onJumpToMedalHall}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-0.5 rounded-lg px-2 text-[13px] text-[#C9C1B4] whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white md:min-h-[36px] md:text-xs"
            >
              <span>勋章殿</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Horizontal Graphic Medal Tray */}
        {showcase.earnedMedals.length > 0 && (
          <div className="h-scroll-rail no-scrollbar mt-3 flex gap-2.5 pb-1">
            {showcase.earnedMedals.map((medal) => (
              <button
                key={medal.id}
                type="button"
                data-testid={`detail-medal-${medal.id}`}
                onClick={() => setInspectingMedal(medal)}
                aria-label={`赏析勋章「${medal.title}」（${medal.tierLabel}）`}
                className="group flex w-[90px] shrink-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2.5 text-center transition-colors hover:border-[#C9A45C]/60 hover:bg-white/[0.08] active:scale-[0.97] cursor-pointer min-[420px]:w-[94px] md:w-[84px]"
              >
                <CinemaMedalSvg
                  category={medal.category}
                  motif={medal.motif}
                  tier={medal.tier}
                  monogram={medal.monogram}
                  size={54}
                  className="transition-transform duration-200 group-hover:scale-105"
                />
                <span className="mt-1.5 w-full truncate text-[12px] font-medium text-[#FAF7F0] md:text-[11px]">
                  {medal.shortTitle}
                </span>
                <span
                  className={`mt-0.5 text-[11px] whitespace-nowrap md:text-[10px] ${
                    medal.tier === 'crimson'
                      ? 'text-[#F29B8E]'
                      : medal.tier === 'gold'
                        ? 'text-[#E4C37A]'
                        : medal.tier === 'silver'
                          ? 'text-[#D0D6DE]'
                          : 'text-[#D6A679]'
                  }`}
                >
                  {medal.tierLabel}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Next Unlock Guidance Strip */}
        {showcase.nextMedal && (
          <button
            type="button"
            onClick={() => setInspectingMedal(showcase.nextMedal!.medal)}
            className="mt-2.5 flex min-h-[40px] w-full items-center justify-between gap-2 border-t border-white/10 pt-2.5 text-left cursor-pointer hover:opacity-90 md:min-h-[38px]"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#BFB6A7] md:text-[11px]">
              下一枚：{showcase.nextMedal.hint}
            </span>
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#E4C37A] md:text-[11px]">
              {showcase.nextMedal.medal.current}/{showcase.nextMedal.medal.target}
            </span>
          </button>
        )}
      </section>

      <MedalInspectModal
        medal={inspectingMedal}
        onClose={() => setInspectingMedal(null)}
        onFilterByTag={onFilterByTag}
      />
    </>
  );
}
