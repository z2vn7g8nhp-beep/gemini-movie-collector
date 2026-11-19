import { useId, useMemo } from 'react';
import { ArrowUpRight, Network } from 'lucide-react';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import { buildRelationGraph, type GraphNode } from '../utils/relationGraph';

interface DetailRelationGraphProps {
  item: ArchiveItem;
  allItems: ArchiveItem[];
  onSelectItem: (item: ArchiveItem) => void;
}

const CATEGORY_RING_COLOR: Record<ArchiveCategory, string> = {
  film: '#D85745',
  person: '#E4C37A',
  character: '#88B89C',
};

function shortNodeLabel(title: string, maxLen = 7): string {
  const clean = title.replace(/／.*$/, '').trim();
  const chars = Array.from(clean);
  if (chars.length <= maxLen) return clean;
  return `${chars.slice(0, maxLen - 1).join('')}…`;
}

function nodeMonogram(title: string): string {
  const clean = title.trim();
  return Array.from(clean)[0] || '影';
}

export function DetailRelationGraph({
  item,
  allItems,
  onSelectItem,
}: DetailRelationGraphProps) {
  const uid = useId().replace(/:/g, '');
  const graph = useMemo(
    () => buildRelationGraph(item, allItems, 8),
    [item, allItems]
  );

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.item.id, n])),
    [graph.nodes]
  );

  const neighborNodes = useMemo(
    () => graph.nodes.filter((n) => n.hop > 0),
    [graph.nodes]
  );

  const handleNodeActivate = (node: GraphNode) => {
    if (node.hop === 0) return;
    onSelectItem(node.item);
  };

  return (
    <section
      aria-label="深度关联图谱"
      data-testid="detail-relation-graph"
      className="mt-7 overflow-hidden rounded-2xl border border-[#3B352D] bg-[#1C1A17] text-[#F5F1E8]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-editorial text-base font-medium text-[#FAF7F0]">
            <Network
              className="h-4 w-4 shrink-0 text-[#D4AF6A]"
              aria-hidden="true"
            />
            <span>深度关联图谱</span>
          </h3>
          <p className="mt-0.5 text-[11px] text-[#B8AE9E] tabular-nums">
            {neighborNodes.length > 0
              ? `直连 ${graph.directCount} 项 · 延伸 ${
                  graph.deepCount + graph.tagLinkCount
                } 项 · 点击节点直接跳转`
              : '可视化展示当前档案与馆内其他条目的深层脉络'}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-[#E4C37A]">
          {graph.nodes.length} 节点
        </span>
      </div>

      {/* Compact Interactive SVG Network */}
      <div className="relative bg-[#161411] px-2 py-2">
        <svg
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          role="img"
          aria-label={`${item.title}的深度关联网络图，共 ${neighborNodes.length} 个关联条目`}
          className="h-auto w-full select-none"
        >
          <defs>
            <radialGradient
              id={`graph-glow-${uid}`}
              cx="50%"
              cy="50%"
              r="55%"
            >
              <stop offset="0%" stopColor="#C9A45C" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#161411" stopOpacity="0" />
            </radialGradient>

            {graph.nodes.map((node) => {
              const r = node.hop === 0 ? 23 : node.hop === 1 ? 18 : 15;
              return (
                <clipPath
                  key={`clip-${node.item.id}`}
                  id={`node-clip-${uid}-${node.item.id}`}
                >
                  <circle cx={node.x} cy={node.y} r={r} />
                </clipPath>
              );
            })}
          </defs>

          {/* Subtle Atmospheric Field + Architectural Orbital Guides */}
          <rect
            x="0"
            y="0"
            width={graph.width}
            height={graph.height}
            fill={`url(#graph-glow-${uid})`}
          />
          <ellipse
            cx={graph.center.x}
            cy={graph.center.y}
            rx={88}
            ry={54}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          {neighborNodes.some((n) => n.hop === 2) && (
            <ellipse
              cx={graph.center.x}
              cy={graph.center.y}
              rx={130}
              ry={68}
              fill="none"
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
              strokeDasharray="2 5"
            />
          )}

          {/* Network Edges Encoded by Relation Strength */}
          <g>
            {graph.edges.map((edge) => {
              const src = nodeById.get(edge.sourceId);
              const dst = nodeById.get(edge.targetId);
              if (!src || !dst) return null;

              const strokeColor =
                edge.kind === 'direct'
                  ? edge.strength === 3
                    ? '#D85745'
                    : '#D4AF6A'
                  : edge.kind === 'bridge'
                    ? '#C9A45C'
                    : '#9E9587';

              const strokeWidth =
                edge.kind === 'direct'
                  ? edge.strength === 3
                    ? 2.4
                    : 1.8
                  : edge.kind === 'bridge'
                    ? 1.5
                    : 1.25;

              const dashArray =
                edge.kind === 'direct'
                  ? undefined
                  : edge.kind === 'bridge'
                    ? '4 3'
                    : '2 3';

              // Route bridge arcs cleanly away from the center node to prevent visual overlap
              const mx = (src.x + dst.x) / 2;
              const my = (src.y + dst.y) / 2;
              const isBridgeArc = edge.kind === 'bridge';
              const curveUp = my <= graph.center.y;
              const arcLift = Math.abs(mx - graph.center.x) < 60 ? 38 : 24;
              const ctrlY = isBridgeArc
                ? Math.max(
                    16,
                    Math.min(
                      graph.height - 16,
                      curveUp ? my - arcLift : my + arcLift
                    )
                  )
                : my;

              return (
                <path
                  key={edge.id}
                  d={
                    isBridgeArc
                      ? `M ${src.x} ${src.y} Q ${mx} ${ctrlY} ${dst.x} ${dst.y}`
                      : `M ${src.x} ${src.y} L ${dst.x} ${dst.y}`
                  }
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dashArray}
                  strokeOpacity={edge.kind === 'direct' ? 0.92 : 0.74}
                  strokeLinecap="round"
                />
              );
            })}
          </g>

          {/* Network Nodes */}
          <g>
            {graph.nodes.map((node) => {
              const isCenter = node.hop === 0;
              const r = isCenter ? 23 : node.hop === 1 ? 18 : 15;
              const ringColor = CATEGORY_RING_COLOR[node.item.category];
              const label = shortNodeLabel(
                node.item.title,
                isCenter ? 9 : 8
              );

              return (
                <g
                  key={node.item.id}
                  data-testid={`graph-node-${node.item.id}`}
                  role={isCenter ? undefined : 'button'}
                  tabIndex={isCenter ? undefined : 0}
                  aria-label={
                    isCenter
                      ? undefined
                      : `跳转查看${CATEGORY_LABELS[node.item.category]}「${node.item.title}」（${node.reason}）`
                  }
                  onClick={() => handleNodeActivate(node)}
                  onKeyDown={(e) => {
                    if (isCenter) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNodeActivate(node);
                    }
                  }}
                  className={isCenter ? '' : 'cursor-pointer group'}
                >
                  {/* Invisible 44px-equivalent hit circle for mobile thumb accuracy */}
                  {!isCenter && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={25}
                      fill="transparent"
                    />
                  )}

                  {/* Center Focal Halo */}
                  {isCenter && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={r + 5.5}
                      fill="none"
                      stroke="#E4C37A"
                      strokeOpacity="0.4"
                      strokeWidth="1.2"
                      strokeDasharray="2.5 2.5"
                    />
                  )}

                  {/* Node Base Circle */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    fill="#26221D"
                    stroke={ringColor}
                    strokeWidth={isCenter ? 2.4 : node.hop === 1 ? 2 : 1.5}
                  />

                  {/* Clipped Cover Image or Editorial Monogram */}
                  {node.item.coverUrl ? (
                    <image
                      href={node.item.coverUrl}
                      x={node.x - r}
                      y={node.y - r}
                      width={r * 2}
                      height={r * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#node-clip-${uid}-${node.item.id})`}
                    />
                  ) : (
                    <text
                      x={node.x}
                      y={node.y + 4.5}
                      textAnchor="middle"
                      fill="#FAF7F0"
                      fontSize={isCenter ? 13 : 11}
                      fontFamily="Songti SC, Noto Serif SC, Georgia, serif"
                    >
                      {nodeMonogram(node.item.title)}
                    </text>
                  )}

                  {/* Ring Outline Over Image */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={isCenter ? 2.4 : node.hop === 1 ? 2 : 1.6}
                  />

                  {/* Crisp Label Under Node */}
                  <text
                    x={node.x}
                    y={node.y + r + 14}
                    textAnchor="middle"
                    fill={isCenter ? '#FAF7F0' : '#E5DEC9'}
                    fontSize={isCenter ? 10.5 : 9.8}
                    fontWeight={isCenter ? 600 : 500}
                    stroke="#161411"
                    strokeWidth="3.2"
                    paintOrder="stroke"
                    fontFamily="PingFang SC, Noto Sans SC, sans-serif"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Quiet Inline Legend */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 pb-1 text-[10px] text-[#A59D90]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3.5 bg-[#D85745]" aria-hidden="true" />
            <span>直接关联</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-3.5 border-t border-dashed border-[#C9A45C]"
              aria-hidden="true"
            />
            <span>二度延伸</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-3.5 border-t border-dotted border-[#9E9587]"
              aria-hidden="true"
            />
            <span>共同标签</span>
          </span>
        </div>
      </div>

      {/* Thumb-Friendly Quick Jump Strip for Graphed Neighbors */}
      {neighborNodes.length > 0 ? (
        <div className="border-t border-white/10 px-3.5 py-3">
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5">
            {neighborNodes.map((node) => (
              <button
                key={`jump-${node.item.id}`}
                type="button"
                data-testid={`graph-jump-${node.item.id}`}
                onClick={() => onSelectItem(node.item)}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-left transition-colors hover:border-[#C9A45C]/60 hover:bg-white/[0.1] active:scale-[0.98] cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="max-w-[138px] truncate text-xs font-medium text-[#FAF7F0]">
                    {node.item.title}
                  </p>
                  <p className="text-[10px] text-[#A59D90] whitespace-nowrap">
                    <span
                      style={{
                        color: CATEGORY_RING_COLOR[node.item.category],
                      }}
                    >
                      {CATEGORY_LABELS[node.item.category]}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>{node.strengthLabel}</span>
                  </p>
                </div>
                <ArrowUpRight
                  className="h-3.5 w-3.5 shrink-0 text-[#D4AF6A]"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-white/10 px-4 py-3 text-center text-xs text-[#A59D90]">
          暂无馆内关联节点，在上方关联其他条目或添加共同主题标签后，将自动连线成网。
        </div>
      )}
    </section>
  );
}
