import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Compass,
  Link2,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  buildGlobalRelationGraph,
  getEdgeVisualStyle,
  getFocusedNodeConnections,
  getNodeVisualStyle,
  type GlobalGraphEdge,
  type GlobalGraphNode,
  type GraphNodeFocusState,
  type NodeIntensityTier,
} from '../utils/globalGraph';
import { ArchivalImage } from './ArchivalImage';

interface GlobalRelationMapModalProps {
  open: boolean;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSelectItem: (item: ArchiveItem) => void;
}

const CATEGORY_DOT_COLOR: Record<ArchiveCategory, string> = {
  film: '#D85745',
  person: '#E4C37A',
  character: '#7AB59E',
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
    moved: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });

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

  const focusContext = useMemo(
    () => getFocusedNodeConnections(graph, focusedId, allItems),
    [graph, focusedId, allItems]
  );

  const focusedNode = focusContext?.focusedNode ?? null;

  // Partition edges by depth & sort by strength ascending so stronger/thicker lines render on top
  const { dimmedEdges, secondHopEdges, highlightedEdges } = useMemo(() => {
    const dimmed: GlobalGraphEdge[] = [];
    const secondHop: GlobalGraphEdge[] = [];
    const highlighted: GlobalGraphEdge[] = [];
    for (const edge of graph.edges) {
      const isIncident =
        Boolean(focusedId) &&
        (edge.sourceId === focusedId || edge.targetId === focusedId);
      if (isIncident) {
        highlighted.push(edge);
      } else if (focusContext?.secondHopEdgeIds.has(edge.id)) {
        secondHop.push(edge);
      } else {
        dimmed.push(edge);
      }
    }
    const byStrengthAsc = (a: GlobalGraphEdge, b: GlobalGraphEdge) =>
      a.strength - b.strength || a.strengthScore - b.strengthScore;
    dimmed.sort(byStrengthAsc);
    secondHop.sort(byStrengthAsc);
    highlighted.sort(byStrengthAsc);
    return {
      dimmedEdges: dimmed,
      secondHopEdges: secondHop,
      highlightedEdges: highlighted,
    };
  }, [graph.edges, focusedId, focusContext]);

  // Sort nodes so lower-intensity/dimmed render first and hubs/focused nodes always sit cleanly on top
  const orderedNodes = useMemo(() => {
    if (!focusContext) {
      return [...graph.nodes].sort(
        (a, b) =>
          a.intensityTier - b.intensityTier ||
          a.weightedDegree - b.weightedDegree
      );
    }
    const rank = (node: GlobalGraphNode): number => {
      if (node.id === focusContext.focusedNode.id) return 5;
      if (focusContext.directNeighborIds.has(node.id)) {
        return 3 + (focusContext.directStrengthByNodeId.get(node.id) ?? 1) * 0.2;
      }
      if (focusContext.secondHopNeighborIds.has(node.id)) return 2;
      if (focusContext.tagNeighborIds.has(node.id)) return 1;
      return 0;
    };
    return [...graph.nodes].sort((a, b) => rank(a) - rank(b));
  }, [graph.nodes, focusContext]);

  // Limit on-canvas direct edge pills so dense hubs remain crisp and legible
  const visibleDirectEdgeLabels = useMemo(() => {
    if (!focusContext) return [];
    return focusContext.directRelations.slice(0, 8);
  }, [focusContext]);

  if (!open) return null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('g[data-node-id]')) return;
    dragRef.current = {
      active: true,
      moved: false,
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
    if (Math.hypot(dx, dy) > 5) {
      dragRef.current.moved = true;
    }
    setPan({
      x: Math.max(-280, Math.min(280, dragRef.current.origX + dx)),
      y: Math.max(-240, Math.min(240, dragRef.current.origY + dy)),
    });
  };

  const handlePointerUp = () => {
    if (dragRef.current.active && !dragRef.current.moved && focusedId) {
      setFocusedId(null);
    }
    dragRef.current.active = false;
    dragRef.current.moved = false;
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
      <div className="drawer-panel-in flex h-[92dvh] w-full max-w-[880px] flex-col overflow-hidden rounded-t-3xl border border-[#342F28] bg-[#161411] text-[#FAF7F0] shadow-2xl md:h-[88dvh] md:rounded-3xl">
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
        <div className="relative min-h-[250px] flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,#221F1B_0%,#141210_100%)]">
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

                {/* Background / Panoramic Edges (thickness & luminance scaled by strength) */}
                {dimmedEdges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const visualState = focusedId ? 'dimmed' : 'idle';
                  const style = getEdgeVisualStyle(edge, visualState);
                  return (
                    <g
                      key={edge.id}
                      data-edge-id={edge.id}
                      data-edge-highlighted="false"
                      data-edge-kind={edge.kind}
                      data-edge-strength={edge.strength}
                      data-edge-width={style.strokeWidth}
                    >
                      {style.haloWidth > 0 && style.haloOpacity > 0 && (
                        <line
                          x1={s.x}
                          y1={s.y}
                          x2={t.x}
                          y2={t.y}
                          stroke={style.haloColor}
                          strokeWidth={style.haloWidth}
                          strokeOpacity={style.haloOpacity}
                          strokeLinecap="round"
                        />
                      )}
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={style.stroke}
                        strokeWidth={style.strokeWidth}
                        strokeOpacity={style.strokeOpacity}
                        strokeDasharray={style.strokeDasharray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}

                {/* Second-Hop Depth Bridge Edges (softly illuminated depth=2 layer) */}
                {secondHopEdges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const style = getEdgeVisualStyle(edge, 'second-hop');
                  return (
                    <line
                      key={edge.id}
                      data-edge-id={edge.id}
                      data-edge-highlighted="second-hop"
                      data-edge-kind={edge.kind}
                      data-edge-strength={edge.strength}
                      data-edge-width={style.strokeWidth}
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke={style.stroke}
                      strokeWidth={style.strokeWidth}
                      strokeOpacity={style.strokeOpacity}
                      strokeDasharray={style.strokeDasharray}
                      strokeLinecap="round"
                    />
                  );
                })}

                {/* Highlighted Edges Incident to Focused Node */}
                {highlightedEdges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const style = getEdgeVisualStyle(edge, 'highlighted');
                  return (
                    <g
                      key={edge.id}
                      data-edge-id={edge.id}
                      data-edge-highlighted="true"
                      data-edge-kind={edge.kind}
                      data-edge-strength={edge.strength}
                      data-edge-width={style.strokeWidth}
                    >
                      {style.haloWidth > 0 && style.haloOpacity > 0 && (
                        <line
                          x1={s.x}
                          y1={s.y}
                          x2={t.x}
                          y2={t.y}
                          stroke={style.haloColor}
                          strokeWidth={style.haloWidth}
                          strokeOpacity={style.haloOpacity}
                          strokeLinecap="round"
                        />
                      )}
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={style.stroke}
                        strokeWidth={style.strokeWidth}
                        strokeOpacity={style.strokeOpacity}
                        strokeDasharray={style.strokeDasharray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}

                {/* Concise Edge Relation Labels for Focused Node's Direct Connections */}
                {focusedNode &&
                  visibleDirectEdgeLabels.map((rel) => {
                    const dx = rel.node.x - focusedNode.x;
                    const dy = rel.node.y - focusedNode.y;
                    const dist = Math.hypot(dx, dy) || 1;
                    // Place label in the open visual segment between the two node circles,
                    // nudged away from whichever node sits higher so it never touches its bottom label
                    const startPad =
                      focusedNode.radius + (dy > 24 ? 22 : 10);
                    const endPad =
                      rel.node.radius + (dy < -24 ? 24 : 10);
                    const span = Math.max(0, dist - startPad - endPad);
                    const offsetAlong = startPad + span * 0.5;
                    const tRatio = Math.max(
                      0.35,
                      Math.min(0.68, offsetAlong / dist)
                    );
                    const mx = focusedNode.x + dx * tRatio;
                    const my = focusedNode.y + dy * tRatio;
                    const labelChars = Array.from(rel.shortLabel).length;
                    const pillW = Math.max(32, labelChars * 11 + 14);
                    const isStrong = rel.strength === 3;
                    return (
                      <g
                        key={`pill-${rel.edgeId}`}
                        data-testid={`edge-label-${rel.node.id}`}
                        className="pointer-events-none select-none"
                      >
                        <rect
                          x={mx - pillW / 2}
                          y={my - 9.5}
                          width={pillW}
                          height={19}
                          rx={9.5}
                          fill={isStrong ? '#211B13' : '#181511'}
                          fillOpacity={0.95}
                          stroke={isStrong ? '#F2CF7E' : '#D4AF6A'}
                          strokeOpacity={
                            isStrong ? 0.92 : rel.strength === 2 ? 0.68 : 0.45
                          }
                          strokeWidth={isStrong ? 1.3 : 1}
                        />
                        <text
                          x={mx}
                          y={my + 3.5}
                          textAnchor="middle"
                          fill={isStrong ? '#FCE8B2' : '#E8D29D'}
                          fontSize={10}
                          fontWeight={isStrong ? 600 : 500}
                        >
                          {rel.shortLabel}
                        </text>
                      </g>
                    );
                  })}

                {/* Nodes (Z-ordered & color-depth graded by frequency and relation depth) */}
                {orderedNodes.map((node) => {
                  const isFocused = focusedId === node.id;
                  const isDirectNeighbor =
                    focusContext?.directNeighborIds.has(node.id) ?? false;
                  const isSecondHopNeighbor =
                    focusContext?.secondHopNeighborIds.has(node.id) ?? false;
                  const isTagNeighbor =
                    focusContext?.tagNeighborIds.has(node.id) ?? false;
                  const dimmed = Boolean(
                    focusedId &&
                      !isFocused &&
                      !isDirectNeighbor &&
                      !isSecondHopNeighbor &&
                      !isTagNeighbor
                  );
                  const nodeState: GraphNodeFocusState = !focusedId
                    ? 'idle'
                    : isFocused
                      ? 'focused'
                      : isDirectNeighbor
                        ? 'direct-neighbor'
                        : isSecondHopNeighbor
                          ? 'second-hop'
                          : isTagNeighbor
                            ? 'tag-neighbor'
                            : 'dimmed';

                  const directStrength =
                    focusContext?.directStrengthByNodeId.get(node.id);
                  const tagStrength =
                    focusContext?.tagStrengthByNodeId.get(node.id);

                  const visualTier: NodeIntensityTier =
                    nodeState === 'idle' || nodeState === 'dimmed'
                      ? node.intensityTier
                      : nodeState === 'focused'
                        ? node.isIsolated
                          ? 2
                          : 3
                        : nodeState === 'direct-neighbor'
                          ? (directStrength ?? 2)
                          : nodeState === 'second-hop'
                            ? 1
                            : (tagStrength ?? 1);

                  const nodeStyle = getNodeVisualStyle(
                    node.item.category,
                    visualTier,
                    nodeState
                  );

                  const shortTitle =
                    node.item.title.length > 7
                      ? `${node.item.title.slice(0, 6)}…`
                      : node.item.title;

                  const groupOpacity = dimmed
                    ? 0.16
                    : isSecondHopNeighbor
                      ? 0.68
                      : isTagNeighbor
                        ? 0.6
                        : 1;

                  const labelFill =
                    isFocused || isDirectNeighbor
                      ? '#FAF7F0'
                      : isSecondHopNeighbor
                        ? '#CFC7B9'
                        : visualTier >= 2
                          ? '#EAE3D6'
                          : visualTier === 1
                            ? '#C9C0B1'
                            : '#9B9285';

                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      data-node-state={nodeState}
                      data-node-tier={visualTier}
                      data-node-intensity={node.intensity}
                      data-node-fill={nodeStyle.fill}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isFocused}
                      aria-label={`${CATEGORY_LABELS[node.item.category]} ${node.item.title}，直接关联 ${node.degree} 项`}
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
                      className="outline-none focus:outline-none"
                      style={{
                        opacity: groupOpacity,
                        cursor: 'pointer',
                      }}
                    >
                      {/* Generous invisible hit circle for touch accuracy */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={Math.max(node.radius + 9, 25)}
                        fill="transparent"
                      />

                      {/* Subtle Intensity Aura Ring for High-Frequency Hubs / Strong Ties */}
                      {nodeStyle.auraOpacity > 0 && !isFocused && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + nodeStyle.auraRadiusOffset}
                          fill="none"
                          stroke={nodeStyle.auraStroke}
                          strokeWidth={1.3}
                          strokeOpacity={nodeStyle.auraOpacity}
                        />
                      )}

                      {/* Focused Node Halo */}
                      {isFocused && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + 8.5}
                          fill="rgba(245, 220, 155, 0.1)"
                          stroke="#F5DC9B"
                          strokeWidth={2}
                          strokeOpacity={0.92}
                        />
                      )}

                      {/* Direct Neighbor Highlight Ring (solid for strong ties, dashed for lighter ties) */}
                      {isDirectNeighbor && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + (directStrength === 3 ? 6 : 5)}
                          fill={
                            directStrength === 3
                              ? 'rgba(240, 204, 122, 0.14)'
                              : 'rgba(212, 175, 106, 0.08)'
                          }
                          stroke={
                            directStrength === 3 ? '#F5D688' : '#D4AF6A'
                          }
                          strokeWidth={
                            directStrength === 3
                              ? 1.9
                              : directStrength === 2
                                ? 1.5
                                : 1.15
                          }
                          strokeDasharray={
                            directStrength === 3 ? undefined : '3.5 2.5'
                          }
                          strokeOpacity={
                            directStrength === 3
                              ? 0.94
                              : directStrength === 2
                                ? 0.78
                                : 0.58
                          }
                        />
                      )}

                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius}
                        fill={nodeStyle.fill}
                        stroke={nodeStyle.stroke}
                        strokeWidth={nodeStyle.strokeWidth}
                      />
                      <text
                        x={node.x}
                        y={node.y + 4}
                        textAnchor="middle"
                        fill={nodeStyle.textColor}
                        fontSize={visualTier >= 3 ? 12 : 11}
                        fontWeight={visualTier >= 2 ? 600 : 500}
                        className="pointer-events-none select-none"
                      >
                        {node.item.title.slice(0, 1)}
                      </text>
                      <text
                        x={node.x}
                        y={node.y + node.radius + 15}
                        textAnchor="middle"
                        fill={labelFill}
                        fontSize={
                          isFocused ? 12.5 : visualTier === 3 ? 12.2 : 11.5
                        }
                        fontWeight={
                          isFocused || visualTier === 3
                            ? 600
                            : isDirectNeighbor || visualTier === 2
                              ? 500
                              : 400
                        }
                        stroke="#141210"
                        strokeWidth={3.2}
                        paintOrder="stroke"
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

          {/* Legend Top-Left: Category + Relation Strength Visual Key */}
          <div
            data-testid="global-graph-legend"
            className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/8 bg-[#161411]/90 px-3 py-1.5 text-[11px] text-[#CFC7B9] backdrop-blur-xs"
          >
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#CA3C28]" />
              影视
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#DBB768]" />
              影人
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#66AD95]" />
              角色
            </span>
            <span
              className="inline-flex items-center gap-1.5 border-l border-white/15 pl-2.5 text-[#BDB5A8]"
              aria-label="线宽与色深表示关联强度，由浅弱至深强"
            >
              <span>强度</span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                <span className="inline-block h-[1.2px] w-2.5 rounded-full bg-[#AE9568]/70" />
                <span className="inline-block h-[2.2px] w-3 rounded-full bg-[#D4AF6A]" />
                <span className="inline-block h-[3.5px] w-3.5 rounded-full bg-[#F5D688]" />
              </span>
              <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                <span className="h-2 w-2 rounded-full bg-[#473D28]" />
                <span className="h-2 w-2 rounded-full bg-[#A88642]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#DBB768]" />
              </span>
            </span>
          </div>

          {/* Mobile Touch Zoom Controls Top-Right */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.2, +(s + 0.25).toFixed(2)))}
              aria-label="放大星图"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#1C1A17]/90 text-[#FAF7F0] hover:bg-[#2A2621] cursor-pointer"
            >
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, +(s - 0.25).toFixed(2)))}
              aria-label="缩小星图"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#1C1A17]/90 text-[#FAF7F0] hover:bg-[#2A2621] cursor-pointer"
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              aria-label="重置星图视角"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#1C1A17]/90 text-[#FAF7F0] hover:bg-[#2A2621] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Focused Node Inspector & Direct Relations Explanation Panel */}
        {focusContext && focusedNode ? (
          <div
            data-testid="global-graph-inspector"
            className="border-t border-white/10 bg-[#1C1A17] px-4 pt-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
          >
            {/* Focused Item Header Row */}
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <ArchivalImage
                  src={focusedNode.item.coverUrl}
                  alt={focusedNode.item.title}
                  title={focusedNode.item.title}
                  category={focusedNode.item.category}
                  compact
                  className="h-12 w-9 shrink-0 rounded-lg"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#D4AF6A] tabular-nums">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          CATEGORY_DOT_COLOR[focusedNode.item.category],
                      }}
                    />
                    <span>{CATEGORY_LABELS[focusedNode.item.category]}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {focusContext.directRelations.length > 0
                        ? `直接关联 ${focusContext.directRelations.length} 项`
                        : '尚未建立直连'}
                    </span>
                    {focusContext.secondHopNeighborIds.size > 0 && (
                      <span className="whitespace-nowrap text-[#BDB5A8]">
                        <span aria-hidden="true" className="mr-1.5 text-[#D4AF6A]">
                          ·
                        </span>
                        二度延伸 {focusContext.secondHopNeighborIds.size} 项
                      </span>
                    )}
                  </div>
                  <p className="truncate font-editorial text-[15px] font-medium text-[#FAF7F0]">
                    {focusedNode.item.title}
                    {focusedNode.item.year ? (
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-[#A59D90]">
                        {focusedNode.item.year}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFocusedId(null)}
                  aria-label="取消聚焦，返回全馆星图全景"
                  className="min-h-[38px] rounded-xl border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-[#CFC7B9] whitespace-nowrap hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  全景
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectItem(focusedNode.item);
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-[#B43B2B] px-3.5 text-xs font-medium text-white whitespace-nowrap hover:bg-[#C64635] cursor-pointer active:scale-[0.97]"
                >
                  <span>{focusedNode.isIsolated ? '去关联' : '查看档案'}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Direct Relations Brief Explanations */}
            <div
              data-testid="global-graph-relations"
              className="mt-2.5 border-t border-white/8 pt-2.5"
            >
              {focusContext.directRelations.length > 0 ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[#A59D90]">
                    <span className="inline-flex items-center gap-1 font-medium text-[#E5DEC9]">
                      <Sparkles
                        className="h-3 w-3 text-[#D4AF6A]"
                        aria-hidden="true"
                      />
                      <span>直接关联说明（按关联强度排序）</span>
                    </span>
                    <span className="text-[10px] text-[#8C857B]">
                      点击条目可切换聚焦
                    </span>
                  </div>

                  <div className="h-scroll-rail no-scrollbar flex gap-2 pb-0.5 sm:grid sm:max-h-[136px] sm:grid-cols-2 sm:overflow-y-auto sm:pr-0.5 md:grid-cols-3">
                    {focusContext.directRelations.map((rel) => (
                      <button
                        key={rel.edgeId}
                        type="button"
                        data-testid={`global-relation-card-${rel.node.id}`}
                        data-relation-strength={rel.strength}
                        onClick={() => setFocusedId(rel.node.id)}
                        className={`flex w-[224px] shrink-0 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer sm:w-auto ${
                          rel.strength === 3
                            ? 'border-[#E8C472]/55 bg-[#D4AF6A]/[0.09] hover:border-[#F5D688]/80 hover:bg-[#D4AF6A]/[0.15]'
                            : rel.strength === 2
                              ? 'border-[#D4AF6A]/28 bg-white/[0.04] hover:border-[#D4AF6A]/60 hover:bg-white/[0.09]'
                              : 'border-white/12 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                backgroundColor: getNodeVisualStyle(
                                  rel.node.item.category,
                                  rel.strength,
                                  'direct-neighbor'
                                ).dot,
                              }}
                            />
                            <span className="truncate text-xs font-medium text-[#FAF7F0]">
                              {rel.node.item.title}
                            </span>
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-[#F5DC9B] whitespace-nowrap">
                            <span
                              className="inline-flex items-end gap-[2px]"
                              title={`关联强度：${rel.strengthLabel}`}
                              aria-label={`关联强度：${rel.strengthLabel}`}
                            >
                              {[1, 2, 3].map((bar) => (
                                <span
                                  key={bar}
                                  className={`w-[2.5px] rounded-full ${
                                    bar === 1
                                      ? 'h-[4px]'
                                      : bar === 2
                                        ? 'h-[7px]'
                                        : 'h-[10px]'
                                  } ${
                                    bar <= rel.strength
                                      ? rel.strength === 3
                                        ? 'bg-[#F5D688]'
                                        : 'bg-[#D4AF6A]'
                                      : 'bg-white/18'
                                  }`}
                                />
                              ))}
                            </span>
                            <span>{rel.shortLabel}</span>
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-[#BDB5A8]">
                          {rel.description}
                          {rel.mutualCount > 0 ? ` · ${rel.mutualCount}项共联` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-[#A59D90]">
                  该条目尚未建立直接关联，点击「去关联」即可在档案中将其与馆内影视、影人或角色连线。
                </p>
              )}

              {/* Secondary Shared-Tag Relations (clearly distinguished from direct relations) */}
              {focusContext.tagRelations.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 text-[11px] text-[#9E9587]">
                  <span className="shrink-0 font-mono text-[10px] text-[#8C857B]">
                    共签延伸：
                  </span>
                  {focusContext.tagRelations.map((rel) => (
                    <button
                      key={rel.edgeId}
                      type="button"
                      onClick={() => setFocusedId(rel.node.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-[#CFC7B9] hover:border-white/25 hover:text-white cursor-pointer"
                    >
                      <span>{rel.node.item.title}</span>
                      <span className="text-[10px] text-[#9E9587]">
                        · {rel.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            data-testid="global-graph-idle-hint"
            className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#1C1A17] px-4 py-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
          >
            <p className="text-xs text-[#BDB5A8]">
              点击星图中的任意节点，自动高亮所有直接关联条目并查看关联说明
            </p>
            {graph.hubs[0] && (
              <button
                type="button"
                onClick={() => setFocusedId(graph.hubs[0].id)}
                className="shrink-0 rounded-xl border border-[#D4AF6A]/40 bg-[#D4AF6A]/15 px-3 py-1.5 text-xs font-medium text-[#F5DC9B] whitespace-nowrap hover:bg-[#D4AF6A]/25 cursor-pointer"
              >
                聚焦核心枢纽
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
