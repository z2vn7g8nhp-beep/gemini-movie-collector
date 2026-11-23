import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, PieChart as PieChartIcon } from 'lucide-react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import {
  buildCategoryDistribution,
  type CategorySliceDatum,
} from '../utils/collectionStats';

interface CollectionStatsCapsuleProps {
  items: ArchiveItem[];
  activeCategory: 'all' | ArchiveCategory;
  onSelectCategory: (category: 'all' | ArchiveCategory) => void;
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
          className="h-2 w-2 rounded-full shrink-0"
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
  { key: 'empty', label: '待收录', count: 1, percent: 0, color: 'var(--pie-empty-fill, #EAE4D9)' },
];

export function CollectionStatsCapsule({
  items,
  activeCategory,
  onSelectCategory,
  onJumpToSearch,
}: CollectionStatsCapsuleProps) {
  const [expanded, setExpanded] = useState(true);
  const distribution = useMemo(() => buildCategoryDistribution(items), [items]);
  const hasItems = distribution.total > 0;

  const pieData = hasItems ? distribution.activeSegments : EMPTY_RING_DATA;

  const handleSliceToggle = (category: ArchiveCategory) => {
    onSelectCategory(activeCategory === category ? 'all' : category);
  };

  if (!hasItems) {
    return (
      <section
        aria-label="藏馆数据胶囊"
        data-testid="collection-stats-capsule"
        data-expanded="false"
        className="mx-auto max-w-[1180px] px-4 pt-3.5 min-[420px]:px-5 md:px-8 md:pt-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-[#E4DFD5] bg-[#FFFDF9] px-4 py-2 shadow-[0_2px_8px_-4px_rgba(28,22,15,0.08)] dark:border-[#322D27] dark:bg-[#1D1A17] dark:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.45)]">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F5F1E8] text-[#8E6523] dark:bg-[#2A251E] dark:text-[#E4C37A]"
            >
              <PieChartIcon className="h-3.5 w-3.5" />
            </span>
            <span className="font-editorial text-[14px] font-medium text-[#1A1816] whitespace-nowrap dark:text-[#F3EFE6]">
              藏馆数据
            </span>
            <span className="text-[#CFC7B9] dark:text-[#4E473E]" aria-hidden="true">
              ·
            </span>
            <span className="truncate text-xs text-[#6E665C] dark:text-[#A59D90]">
              {distribution.achievementHint}
            </span>
          </div>

          {onJumpToSearch && (
            <button
              type="button"
              onClick={onJumpToSearch}
              className="inline-flex min-h-[34px] shrink-0 items-center rounded-full border border-[#DCD6CB] bg-[#FAF8F3] px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#B43B2B] hover:text-[#B43B2B] dark:border-[#3E3830] dark:bg-[#25211D] dark:text-[#F3EFE6] dark:hover:border-[#E4C37A] dark:hover:text-[#E4C37A]"
            >
              去收录
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="藏馆数据胶囊"
      data-testid="collection-stats-capsule"
      data-expanded={expanded ? 'true' : 'false'}
      className="mx-auto max-w-[1180px] px-4 pt-3.5 min-[420px]:px-5 md:px-8 md:pt-4"
    >
      <div
        className={`border border-[#E4DFD5] bg-[#FFFDF9] shadow-[0_1px_0_rgba(255,255,255,0.92)_inset,0_4px_14px_-8px_rgba(28,22,15,0.1)] transition-all duration-200 dark:border-[#322D27] dark:bg-[#1D1A17] dark:shadow-[0_1px_0_rgba(255,246,224,0.05)_inset,0_10px_24px_-12px_rgba(0,0,0,0.5)] ${
          expanded ? 'rounded-[24px] px-4 py-3.5 sm:px-5' : 'rounded-full px-3.5 py-2 sm:px-4'
        }`}
      >
        {/* Top Capsule Header Bar */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Compact Mini Live Donut when Collapsed */}
            {!expanded ? (
              <div
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center"
              >
                <PieChart width={28} height={28}>
                  <Pie
                    data={pieData}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={7}
                    outerRadius={13}
                    paddingAngle={pieData.length > 1 ? 3 : 0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </div>
            ) : (
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F6F1E6] text-[#8E6523] dark:bg-[#2A251E] dark:text-[#E4C37A]"
              >
                <PieChartIcon className="h-3.5 w-3.5" />
              </span>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="font-editorial text-[15px] font-medium text-[#1A1816] whitespace-nowrap dark:text-[#F3EFE6]">
                藏馆数据
              </h2>
              <span className="font-mono text-xs tabular-nums text-[#7A7268] whitespace-nowrap dark:text-[#A59D90]">
                共 {distribution.total} 件
              </span>

              {!expanded ? (
                <div className="hidden items-center gap-2 text-xs text-[#625C54] sm:flex dark:text-[#B8AFA2]">
                  <span className="text-[#D4CCC0] dark:text-[#4E473E]" aria-hidden="true">
                    ·
                  </span>
                  {distribution.segments.map((seg, idx) => (
                    <span
                      key={seg.key}
                      className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums whitespace-nowrap"
                    >
                      {idx > 0 && (
                        <span className="mr-1 text-[#D4CCC0] dark:text-[#4E473E]" aria-hidden="true">
                          /
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span className="font-sans text-[#4B453E] dark:text-[#C4BCB0]">{seg.label}</span>
                      <span className="font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                        {seg.count}
                      </span>
                      <span className="text-[#8C857B] dark:text-[#9A9184]">({seg.percent}%)</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="hidden text-xs text-[#7A7268] sm:inline dark:text-[#A59D90]">
                  · {distribution.achievementHint}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="collection-stats-toggle-btn"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-full border border-[#E2DACB] bg-[#FAF8F3] px-3 text-xs font-medium text-[#4B453E] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] hover:text-[#1A1816] dark:border-[#3A342D] dark:bg-[#25211D] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]"
          >
            <span>{expanded ? '收起' : '展开饼图'}</span>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Expanded Real-Time Recharts Pie Visualization */}
        {expanded && (
          <div className="mt-3 flex flex-col items-center gap-4 border-t border-[#EFEAE0] pt-3.5 sm:flex-row sm:items-center sm:gap-6 dark:border-[#2D2823]">
            {/* Recharts Donut Chart */}
            <div
              role="img"
              aria-label={`馆藏分类占比饼图：${distribution.segments.map((s) => `${s.label}${s.count}件占${s.percent}%`).join('，')}`}
              data-testid="collection-stats-pie-chart"
              className="relative flex h-[126px] w-[126px] shrink-0 items-center justify-center"
            >
              <PieChart width={126} height={126}>
                <Pie
                  data={pieData}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={36}
                  outerRadius={56}
                  paddingAngle={pieData.length > 1 ? 3 : 0}
                  cornerRadius={4}
                  stroke="var(--pie-slice-stroke, #FFFDF9)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  onClick={(_, index) => {
                    const target = pieData[index];
                    if (
                      target &&
                      (target.key === 'film' ||
                        target.key === 'person' ||
                        target.key === 'character')
                    ) {
                      handleSliceToggle(target.key);
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
                        fillOpacity={isDimmed ? 0.32 : 1}
                        className="cursor-pointer transition-opacity duration-200 outline-none"
                      />
                    );
                  })}
                </Pie>
                <Tooltip content={<ArchivalPieTooltip />} />
              </PieChart>

              {/* Center Archival Counter */}
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

            {/* Interactive Category Breakdown Legend */}
            <div className="grid w-full flex-1 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {distribution.segments.map((seg) => {
                const isActive = activeCategory === seg.key;
                return (
                  <button
                    key={seg.key}
                    type="button"
                    data-testid={`stats-category-btn-${seg.key}`}
                    aria-pressed={isActive}
                    onClick={() => handleSliceToggle(seg.key)}
                    className={`group flex flex-col rounded-2xl border px-3.5 py-2.5 text-left cursor-pointer transition-all ${
                      isActive
                        ? 'border-[#1A1816] bg-[#FAF6EC] shadow-[0_2px_10px_-4px_rgba(26,24,22,0.14)] dark:border-[#D4AF6A] dark:bg-[#2A241C]'
                        : 'border-[#ECE6DA] bg-[#FAF9F6]/75 hover:border-[#CFC5B4] hover:bg-[#FAF7F0] dark:border-[#322D27] dark:bg-[#231F1B] dark:hover:border-[#524A40] dark:hover:bg-[#29241F]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#3A352F] dark:text-[#E5DED2]">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span>{seg.label}</span>
                      </span>
                      <span
                        data-testid={`stats-category-percent-${seg.key}`}
                        className="font-mono text-xs font-medium tabular-nums text-[#625C54] dark:text-[#A59D90]"
                      >
                        {seg.percent}%
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-baseline justify-between gap-2">
                      <span
                        data-testid={`stats-category-count-${seg.key}`}
                        className="font-mono text-[18px] font-semibold leading-none tabular-nums text-[#1A1816] dark:text-[#FAF7F0]"
                      >
                        {seg.count}
                      </span>
                      <span className="text-[11px] text-[#8C857B] whitespace-nowrap dark:text-[#9A9184]">
                        {isActive ? '已筛选 · 点击取消' : '点击筛选'}
                      </span>
                    </div>

                    {/* Proportional Hairline Track */}
                    <div
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#ECE6DA] dark:bg-[#322D27]"
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
        )}
      </div>
    </section>
  );
}
