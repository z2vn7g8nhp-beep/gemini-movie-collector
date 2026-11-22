import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Compass,
  Link2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import { buildGlobalRelationGraph } from '../utils/globalGraph';
import { ArchivalImage } from './ArchivalImage';

interface GlobalRelationMapModalProps {
  open: boolean;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSelectItem: (item: ArchiveItem) => void;
}

const NODE_COLORS: Record<ArchiveCategory, { fill: string; stroke: string }> = {
  film: { fill: '#B43B2B', stroke: '#F5C4BC' },
  person: { fill: '#C9A45C', stroke: '#F7E7C0' },
  character: { fill: '#4E7A6A', stroke: '#C3E0D5' },
};

const CAT_FILTERS: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
  { id: 'all', label: '全馆' },
  { id: 'film', label: '影视' },
  { id: 'person', label: '影人' },
  { id: 'character', label: '角色' },
];

export function GlobalRelationMapModal({
  open,
  allItems,
  onClose,
  onSelectItem,
}: GlobalRelationMapModalProps) {
  const [category, setCategory] = useState<'all' | ArchiveCategory>('all');
  const [includeTagEdges, setIncludeTagEdges] = useState(true);
  const [isolatedOnly, setIsolatedOnly] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const graph = useMemo(
    () =>
      buildGlobalRelationGraph(allItems, {
        category,
        includeTagEdges,
        isolatedOnly,
      }),
    [allItems, category, includeTagEdges, isolatedOnly]
  );

  useEffect(() => {
    if (!open) return;
    setFocusedId(graph.hubs[0]?.id ?? graph.nodes[0]?.id ?? null);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [open, category, isolatedOnly]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes]
  );

  const focusedNode = focusedId ? nodeById.get(focusedId) ?? null : null;

  const focusedNeighborIds = useMemo(() => {
    const set = new Set<string>();
    if (!focusedId) return set;
    set.add(focusedId);
    for (const edge of graph.edges) {
      if (edge.sourceId === focusedId) set.add(edge.targetId);
      if (edge.targetId === focusedId) set.add(edge.sourceId);
    }
    return set;
  }, [focusedId, graph.edges]);

  if (!open) return null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('g[data-node-id]')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({
      x: Math.max(-280, Math.min(280, dragRef.current.origX + dx)),
      y: Math.max(-240, Math.min(240, dragRef.current.origY + dy)),
    });
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const handleResetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-graph-title"
      data-testid="global-relation-map-modal"
      className="encounter-backdrop-in fixed inset-0 z-[70] flex items-end justify-center bg-[#12100E]/80 backdrop-blur-xs md:items-center md:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel-in flex h-[92dvh] w-full max-w-[820px] flex-col overflow-hidden rounded-t-3xl border border-[#342F28] bg-[#161411] text-[#FAF7F0] shadow-2xl md:h-[86dvh] md:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 min-[420px]:px-5">
          <div className="min-w-0">
            <h2
              id="global-graph-title"
              className="flex items-center gap-2 font-editorial text-[19px] font-medium text-[#FAF7F0]"
            >
              <Compass className="h-4 w-4 text-[#D4AF6A]" aria-hidden="true" />
              <span>全局光影关系星图</span>
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-[#A59D90] tabular-nums">
              {graph.nodes.length} 节点 · {graph.explicitEdgeCount} 条直连
              {graph.isolatedNodes.length > 0
                ? ` · ${graph.isolatedNodes.length} 件待连线`
                : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭全局关系星图"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#A59D90] hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filter & Hub Strip */}
        <div className="space-y-2 border-b border-white/10 bg-[#1C1A17] px-4 py-2.5 min-[420px]:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="星图分类筛选"
              className="grid grid-cols-4 gap-1 rounded-xl bg-white/8 p-1"
            >
              {CAT_FILTERS.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={category === cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                    category === cat.id
                      ? 'bg-[#FAF7F0] text-[#1A1816]'
                      : 'text-[#BDB5A8]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={includeTagEdges}
                onClick={() => setIncludeTagEdges((v) => !v)}
                className={`min-h-[36px] rounded-xl border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                  includeTagEdges
                    ? 'border-[#C9A45C]/70 bg-[#C9A45C]/15 text-[#F5DC9B]'
                    : 'border-white/15 bg-white/5 text-[#A59D90]'
                }`}
              >
                共签连线
              </button>
              <button
                type="button"
                data-testid="global-graph-isolated-toggle"
                aria-pressed={isolatedOnly}
                onClick={() => setIsolatedOnly((v) => !v)}
                className={`min-h-[36px] rounded-xl border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                  isolatedOnly
                    ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                    : 'border-white/15 bg-white/5 text-[#A59D90]'
                }`}
              >
                孤立条目 ({graph.isolatedNodes.length})
              </button>
            </div>
          </div>

          {graph.hubs.length > 0 && !isolatedOnly && (
            <div className="h-scroll-rail no-scrollbar flex items-center gap-1.5">
              <span className="shrink-0 font-mono text-[11px] text-[#8C857B]">
                核心枢纽：
              </span>
              {graph.hubs.map((hub) => (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => setFocusedId(hub.id)}
                  className={`inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs whitespace-nowrap cursor-pointer ${
                    focusedId === hub.id
                      ? 'border-[#D4AF6A] bg-[#D4AF6A]/20 text-[#FAF7F0]'
                      : 'border-white/10 bg-white/5 text-[#CFC7B9]'
                  }`}
                >
                  <span className="max-w-[110px] truncate">{hub.item.title}</span>
                  <span className="font-mono text-[10px] text-[#D4AF6A] tabular-nums">
                    {hub.degree}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Interactive Pan / Zoom Constellation Canvas */}
        <div className="relative flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,#221F1B_0%,#141210_100%)]">
          {graph.nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <Link2 className="h-8 w-8 text-[#8C857B]" aria-hidden="true" />
              <p className="mt-3 font-editorial text-base text-[#FAF7F0]">
                {isolatedOnly ? '太棒了，所有藏品都已建立关联' : '暂无可展示的藏品节点'}
              </p>
              {isolatedOnly && (
                <button
                  type="button"
                  onClick={() => setIsolatedOnly(false)}
                  className="mt-4 min-h-[40px] rounded-xl bg-[#FAF7F0] px-4 text-xs font-medium text-[#1A1816] cursor-pointer"
                >
                  查看全馆星图
                </button>
              )}
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              data-testid="global-graph-svg"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="h-full w-full touch-none select-none cursor-grab active:cursor-grabbing"
              aria-label="全局光影关系星图画布"
            >
              <g
                transform={`translate(${graph.width / 2 + pan.x}, ${
                  graph.height / 2 + pan.y
                }) scale(${scale}) translate(${-graph.width / 2}, ${
                  -graph.height / 2
                })`}
              >
                {/* Decorative Subtle Orbit Rings */}
                <circle
                  cx={graph.width / 2}
                  cy={graph.height / 2}
                  r={155}
                  fill="none"
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="4 6"
                />
                <circle
                  cx={graph.width / 2}
                  cy={graph.height / 2}
                  r={255}
                  fill="none"
                  stroke="rgba(255,255,255,0.04)"
                  strokeDasharray="3 8"
                />

                {/* Edges */}
                {graph.edges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const isHighlighted =
                    !focusedId ||
                    edge.sourceId === focusedId ||
                    edge.targetId === focusedId;
                  return (
                    <line
                      key={edge.id}
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke={
                        edge.kind === 'explicit'
                          ? isHighlighted
                            ? '#D4AF6A'
                            : 'rgba(212, 175, 106, 0.2)'
                          : isHighlighted
                            ? 'rgba(207, 199, 185, 0.48)'
                            : 'rgba(207, 199, 185, 0.12)'
                      }
                      strokeWidth={
                        edge.kind === 'explicit' ? (isHighlighted ? 2.2 : 1.1) : 1
                      }
                      strokeDasharray={edge.kind === 'tag' ? '4 4' : undefined}
                    />
                  );
                })}

                {/* Nodes */}
                {graph.nodes.map((node) => {
                  const colors = NODE_COLORS[node.item.category];
                  const isFocused = focusedId === node.id;
                  const isNeighbor = focusedNeighborIds.has(node.id);
                  const dimmed = Boolean(focusedId && !isNeighbor);
                  const shortTitle =
                    node.item.title.length > 7
                      ? `${node.item.title.slice(0, 6)}…`
                      : node.item.title;

                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${CATEGORY_LABELS[node.item.category]} ${node.item.title}，关联 ${node.degree} 项`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusedId(node.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setFocusedId(node.id);
                        }
                      }}
                      style={{
                        opacity: dimmed ? 0.28 : 1,
                        cursor: 'pointer',
                      }}
                    >
                      {isFocused && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + 7}
                          fill="none"
                          stroke="#F5DC9B"
                          strokeWidth={2}
                          strokeOpacity={0.85}
                        />
                      )}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius}
                        fill={colors.fill}
                        stroke={isFocused ? '#FFFFFF' : colors.stroke}
                        strokeWidth={isFocused ? 2.5 : 1.5}
                      />
                      <text
                        x={node.x}
                        y={node.y + 4}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize={11}
                        fontWeight={600}
                        className="pointer-events-none select-none"
                      >
                        {node.item.title.slice(0, 1)}
                      </text>
                      <text
                        x={node.x}
                        y={node.y + node.radius + 14}
                        textAnchor="middle"
                        fill={isFocused ? '#FAF7F0' : '#D2C9BA'}
                        fontSize={12}
                        fontWeight={isFocused ? 600 : 400}
                        className="pointer-events-none select-none"
                      >
                        {shortTitle}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Legend Top-Left */}
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-3 rounded-xl bg-[#161411]/85 px-3 py-1.5 text-[11px] text-[#CFC7B9] backdrop-blur-xs">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#B43B2B]" />
              影视
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#C9A45C]" />
              影人
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#4E7A6A]" />
              角色
            </span>
          </div>

          {/* Mobile Touch Zoom Controls Top-Right */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.2, +(s + 0.25).toFixed(2)))}
              aria-label="放大星图"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#1C1A17]/90 text-[#FAF7F0] cursor-pointer"
            >
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, +(s - 0.25).toFixed(2)))}
              aria-label="缩小星图"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#1C1A17]/90 text-[#FAF7F0] cursor-pointer"
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              aria-label="重置星图视角"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#1C1A17]/90 text-[#FAF7F0] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Focused Node Bottom Inspector Card */}
        {focusedNode && (
          <div
            data-testid="global-graph-inspector"
            className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#1C1A17] px-4 py-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <ArchivalImage
                src={focusedNode.item.coverUrl}
                alt={focusedNode.item.title}
                title={focusedNode.item.title}
                category={focusedNode.item.category}
                compact
                className="h-14 w-11 shrink-0 rounded-xl"
              />
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-[#D4AF6A] tabular-nums">
                  {CATEGORY_LABELS[focusedNode.item.category]} ·{' '}
                  {focusedNode.degree > 0
                    ? `已直连 ${focusedNode.degree} 项`
                    : '尚未建立直连'}
                </p>
                <p className="truncate font-editorial text-base font-medium text-[#FAF7F0]">
                  {focusedNode.item.title}
                </p>
                {focusedNode.item.tags.length > 0 && (
                  <p className="truncate text-xs text-[#A59D90]">
                    {focusedNode.item.tags.slice(0, 4).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onSelectItem(focusedNode.item);
              }}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-4 text-xs font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97]"
            >
              <span>{focusedNode.isIsolated ? '去关联' : '查看档案'}</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
