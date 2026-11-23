import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import {
  buildCategoryDistribution,
  type CategorySliceDatum,
} from '../utils/collectionStats';

interface CollectionStatsCapsuleProps {
  items: ArchiveItem[];
  activeCategory?: 'all' | ArchiveCategory;
  onSelectCategory?: (category: ArchiveCategory) => void;
  onJumpToSearch?: () => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CategorySliceDatum }>;
}

function ArchivalPieTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;

  return (
    <div className="rounded-xl border border-[#DFD6C7] bg-[#1C1916]/95 px-2.5 py-1.5 text-[12px] text-[#FAF7F0] shadow-md">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: datum.color }}
        />
        <span className="font-medium">{datum.label}</span>
        <span className="font-mono tabular-nums text-[#E4C37A]">
          {datum.count} 件 ({datum.percent}%)
        </span>
      </div>
    </div>
  );
}

const EMPTY_RING_DATA = [
  {
    key: 'empty',
    label: '待收录',
    count: 1,
    percent: 0,
    color: 'var(--pie-empty-fill, #EAE4D9)',
  },
];

const CATEGORY_DISPLAY_NAMES: Record<ArchiveCategory, string> = {
  film: '影视作品',
  person: '影人档案',
  character: '角色图鉴',
};

export function CollectionStatsCapsule({
  items,
  activeCategory = 'all',
  onSelectCategory,
  onJumpToSearch,
}: CollectionStatsCapsuleProps) {
  const distribution = useMemo(() => buildCategoryDistribution(items), [items]);
  const hasItems = distribution.total > 0;
  const pieData = hasItems ? distribution.activeSegments : EMPTY_RING_DATA;

  if (!hasItems) {
    return (
      <div
        aria-label="藏馆数据构成"
        data-testid="collection-stats-capsule"
        className="gallery-card border border-[#E4DFD5] p-4 min-[420px]:p-5 dark:border-[#322D27]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base dark:text-[#F3EFE6]">
              藏馆数据构成
            </h2>
            <p className="mt-0.5 text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
              {distribution.achievementHint}
            </p>
          </div>
          {onJumpToSearch && (
            <button
              type="button"
              onClick={onJumpToSearch}
              className="inline-flex min-h-[40px] shrink-0 items-center rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] md:min-h-[36px] md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
            >
              去收录
            </button>
          )}
        </div>

        <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-[#ECE7DD] pt-3.5 text-center dark:border-[#2E2924]">
          {distribution.segments.map((seg) => (
            <div key={seg.key}>
              <p
                data-testid={`stats-category-count-${seg.key}`}
                className="font-mono text-[20px] font-medium tabular-nums text-[#1A1816] md:text-lg dark:text-[#F5F1E8]"
              >
                0
              </p>
              <p className="mt-0.5 text-[12px] text-[#625C54] md:text-[11px] dark:text-[#A59D90]">
                {CATEGORY_DISPLAY_NAMES[seg.key]}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="藏馆数据构成"
      data-testid="collection-stats-capsule"
      className="gallery-card border border-[#E4DFD5] p-4 min-[420px]:p-5 dark:border-[#322D27]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base dark:text-[#F3EFE6]">
            藏馆数据构成
          </h2>
          <p className="mt-0.5 text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
            {distribution.achievementHint}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap font-mono text-[13px] font-medium tabular-nums text-[#7A7268] md:text-xs dark:text-[#A59D90]">
          共 {distribution.total} 件
        </span>
      </div>

      <div className="mt-3.5 flex flex-col items-center gap-4 border-t border-[#EFEAE0] pt-3.5 min-[420px]:flex-row min-[420px]:items-center dark:border-[#2E2924]">
        {/* Recharts Archival Donut */}
        <div
          role="img"
          aria-label={`馆藏分类占比饼图：${distribution.segments.map((s) => `${s.label}${s.count}件占${s.percent}%`).join('，')}`}
          data-testid="collection-stats-pie-chart"
          className="relative flex h-[122px] w-[122px] shrink-0 items-center justify-center"
        >
          <PieChart width={122} height={122}>
            <Pie
              data={pieData}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={54}
              paddingAngle={pieData.length > 1 ? 3 : 0}
              cornerRadius={4}
              stroke="var(--pie-slice-stroke, #FFFDF9)"
              strokeWidth={1.5}
              isAnimationActive={false}
              onClick={(_, index) => {
                const target = pieData[index];
                if (
                  onSelectCategory &&
                  target &&
                  (target.key === 'film' ||
                    target.key === 'person' ||
                    target.key === 'character')
                ) {
                  onSelectCategory(target.key);
                }
              }}
            >
              {pieData.map((entry) => {
                const isDimmed =
                  activeCategory !== 'all' && activeCategory !== entry.key;
                return (
                  <Cell
                    key={entry.key}
                    fill={entry.color}
                    fillOpacity={isDimmed ? 0.35 : 1}
                    className={
                      onSelectCategory
                        ? 'cursor-pointer transition-opacity duration-200 outline-none'
                        : 'outline-none'
                    }
                  />
                );
              })}
            </Pie>
            <Tooltip content={<ArchivalPieTooltip />} />
          </PieChart>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span
              data-testid="collection-stats-total"
              className="font-mono text-[20px] font-semibold leading-none tabular-nums text-[#1A1816] dark:text-[#FAF7F0]"
            >
              {distribution.total}
            </span>
            <span className="mt-1 text-[10px] tracking-[0.06em] text-[#7A7268] dark:text-[#9A9184]">
              件馆藏
            </span>
          </div>
        </div>

        {/* Interactive Category Breakdown Rows */}
        <div className="w-full min-w-0 flex-1 space-y-2">
          {distribution.segments.map((seg) => {
            const isClickable = Boolean(onSelectCategory);
            const displayLabel = CATEGORY_DISPLAY_NAMES[seg.key];
            return (
              <button
                key={seg.key}
                type="button"
                disabled={!isClickable}
                data-testid={`stats-category-btn-${seg.key}`}
                aria-label={`查看${displayLabel}（${seg.count} 件，占 ${seg.percent}%）`}
                onClick={() => onSelectCategory?.(seg.key)}
                className="group block w-full rounded-xl border border-[#ECE6DA] bg-[#FAF9F6]/80 px-3 py-2 text-left transition-colors hover:border-[#CFC5B4] hover:bg-[#FAF7F0] disabled:cursor-default dark:border-[#2E2924] dark:bg-[#231F1B] dark:hover:border-[#524A40] dark:hover:bg-[#29241F] cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-[#2F2B26] md:text-xs dark:text-[#E8E2D7]">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="truncate">{displayLabel}</span>
                  </span>

                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] tabular-nums">
                    <span
                      data-testid={`stats-category-count-${seg.key}`}
                      className="font-semibold text-[#1A1816] dark:text-[#FAF7F0]"
                    >
                      {seg.count}
                    </span>
                    <span
                      data-testid={`stats-category-percent-${seg.key}`}
                      className="text-[11px] text-[#7A7268] dark:text-[#9A9184]"
                    >
                      ({seg.percent}%)
                    </span>
                    {isClickable && (
                      <ChevronRight
                        className="h-3.5 w-3.5 text-[#9A9184] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1A1816] dark:group-hover:text-[#E4C37A]"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </div>

                <div
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EAE4D9] dark:bg-[#322D27]"
                >
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${seg.percent}%`,
                      backgroundColor: seg.color,
                      minWidth: seg.count > 0 ? '6px' : '0px',
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
