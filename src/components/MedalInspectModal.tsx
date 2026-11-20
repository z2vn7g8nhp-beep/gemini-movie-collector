import { useEffect } from 'react';
import { Check, Tag, X } from 'lucide-react';
import {
  MEDAL_CATEGORY_LABELS,
  MEDAL_TIER_RANK,
  type CinemaMedal,
} from '../utils/medals';
import { CinemaMedalSvg } from './CinemaMedalSvg';

interface MedalInspectModalProps {
  medal: CinemaMedal | null;
  onClose: () => void;
  onFilterByTag?: (tag: string) => void;
}

export function MedalInspectModal({
  medal,
  onClose,
  onFilterByTag,
}: MedalInspectModalProps) {
  useEffect(() => {
    if (!medal) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [medal, onClose]);

  if (!medal) return null;

  const progressPct = Math.min(
    100,
    Math.round((medal.current / Math.max(1, medal.target)) * 100)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="medal-inspect-title"
      data-testid="medal-inspect-modal"
      className="fixed inset-0 z-[70] flex items-end justify-center overflow-hidden bg-[#12100E]/75 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border border-[#3A342C] bg-[#F7F5F0] shadow-2xl sm:max-w-[400px] sm:rounded-3xl">
        {/* Ceremonial Velvet Stage */}
        <div className="relative shrink-0 bg-[#1C1A17] px-6 pt-5 pb-6 text-center text-[#F5F1E8]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[12px] tracking-[0.1em] text-[#B8AE9E] md:text-[11px]">
              影藏勋章 · {MEDAL_CATEGORY_LABELS[medal.category]}系列
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭勋章赏析"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[#A59D90] hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-2 flex flex-col items-center">
            <div className="relative flex h-32 w-32 items-center justify-center">
              <CinemaMedalSvg
                category={medal.category}
                motif={medal.motif}
                tier={medal.tier}
                monogram={medal.monogram}
                size={120}
              />
            </div>

            <p className="mt-2 font-mono text-[12px] tracking-[0.1em] text-[#E4C37A] md:text-[11px]">
              {medal.unlocked ? `已点亮 · ${medal.tierLabel}` : '待解锁'}
            </p>
            <h2
              id="medal-inspect-title"
              className="mt-1 font-editorial text-[22px] font-medium text-[#FAF7F0] md:text-xl"
            >
              {medal.title}
            </h2>
            <p className="mt-1 text-[13px] text-[#BFB6A7] md:text-xs">{medal.subtitle}</p>
          </div>
        </div>

        {/* Archival Lore & Tier Ladder */}
        <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
          <p className="text-[14px] leading-relaxed text-[#4B453E] md:text-xs">
            {medal.description}
          </p>

          {/* Progress Bar toward current/next tier */}
          <div>
            <div className="flex items-center justify-between text-[13px] tabular-nums md:text-xs">
              <span className="text-[#625C54]">
                {medal.nextTarget !== null
                  ? medal.unlocked
                    ? '距下一阶晋升'
                    : '解锁进度'
                  : '已达最高殿堂阶位'}
              </span>
              <span className="font-mono font-medium text-[#1A1816]">
                {medal.current} / {medal.target}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#E8E2D7]">
              <div
                className={`h-full rounded-full transition-all ${
                  medal.tier === 'crimson'
                    ? 'bg-[#B43B2B]'
                    : medal.tier === 'gold'
                      ? 'bg-[#A67C37]'
                      : 'bg-[#1A1816]'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Tier Progression Ladder */}
          <div className="border-t border-[#E4DFD5] pt-3.5">
            <p className="text-[12px] font-medium tracking-[0.06em] text-[#7A7268] md:text-[11px]">
              晋升阶位
            </p>
            <div
              className="mt-2 grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${medal.tiers.length}, minmax(0, 1fr))`,
              }}
            >
              {medal.tiers.map((stop) => {
                const reached =
                  MEDAL_TIER_RANK[medal.tier] >= MEDAL_TIER_RANK[stop.tier];
                return (
                  <div
                    key={stop.tier}
                    className={`rounded-xl border px-2 py-2 text-center ${
                      reached
                        ? 'border-[#C9A45C] bg-[#FDFBF5]'
                        : 'border-[#ECE7DD] bg-white/70'
                    }`}
                  >
                    <p
                      className={`flex items-center justify-center gap-0.5 text-[12px] font-medium whitespace-nowrap md:text-[11px] ${
                        reached ? 'text-[#8E6523]' : 'text-[#8C857B]'
                      }`}
                    >
                      {reached && (
                        <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                      )}
                      <span>{stop.label}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#7A7268] md:text-[10px]">
                      ≥{stop.threshold}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-2.5 pt-1">
            {medal.tagName && onFilterByTag && (
              <button
                type="button"
                onClick={() => {
                  const tag = medal.tagName!;
                  onClose();
                  onFilterByTag(tag);
                }}
                className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-4 text-[14px] font-medium text-white whitespace-nowrap cursor-pointer hover:bg-[#932D20] md:min-h-[44px] md:text-xs"
              >
                <Tag className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
                <span>查看「{medal.tagName}」馆藏</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`min-h-[46px] rounded-xl border border-[#DCD6CB] bg-white px-4 text-[14px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer md:min-h-[44px] md:text-xs ${
                medal.tagName && onFilterByTag ? 'shrink-0' : 'w-full'
              }`}
            >
              收起
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
