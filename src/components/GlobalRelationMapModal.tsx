import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Eye,
  EyeOff,
  Link2,
  RotateCcw,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { OnlineRelationsResponse } from '../services/archiveApi';
import { loadFilmCredits } from '../services/filmCredits';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  matchFilmographyFromCredits,
  type InferredFilmographyEdge,
} from '../utils/filmographyInference';
import {
  ALL_CATEGORIES_VISIBLE,
  CATEGORY_DOT_COLOR,
  GLOBAL_GRAPH_CATEGORY_LEGEND,
  buildGlobalRelationGraph,
  computeCurvedEdgeGeometry,
  computeEdgeCurveOffsets,
  computeFocusCamera,
  computeNodeLabelLayout,
  computeSmartEdgeLabelPoint,
  countNodesByCategory,
  createCategoryVisibilityForFilter,
  filterGraphByVisibleCategories,
  findShortestGraphPath,
  getEdgeVisualStyle,
  getFocusedNodeConnections,
  getNodeVisualStyle,
  searchGraphNodes,
  toggleCategoryVisibilityState,
  type CategoryVisibilityMap,
  type GlobalGraphEdge,
  type GlobalGraphNode,
  type GraphNodeFocusState,
  type NodeIntensityTier,
} from '../utils/globalGraph';
import { readCachedRelations } from '../utils/relationsCache';
import { GlobalGraphInspector } from './GlobalGraphInspector';

interface GlobalRelationMapModalProps {
  open: boolean;
  allItems: ArchiveItem[];
  initialFocusedId?: string | null;
  onClose: () => void;
  onSelectItem: (item: ArchiveItem) => void;
  onLinkExisting?: (sourceId: string, targetId: string) => Promise<void> | void;
  onLinkPairs?: (pairs: Array<[string, string]>) => Promise<void> | void;
}

const CAT_FILTERS: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
  { id: 'all', label: '全馆' },
  { id: 'film', label: '影视' },
  { id: 'person', label: '影人' },
  { id: 'character', label: '角色' },
];

const CANVAS_CATEGORY_TOGGLES = GLOBAL_GRAPH_CATEGORY_LEGEND.map((entry) => ({
  id: entry.category,
  label: entry.label,
  dotColor: entry.nodeFill,
}));

export function GlobalRelationMapModal({
  open,
  allItems,
  initialFocusedId,
  onClose,
  onSelectItem,
  onLinkExisting,
  onLinkPairs,
}: GlobalRelationMapModalProps) {
  const uid = useId().replace(/:/g, '');

  const [category, setCategory] = useState<'all' | ArchiveCategory>('all');
  const [visibleCategories, setVisibleCategories] =
    useState<CategoryVisibilityMap>(() => ({ ...ALL_CATEGORIES_VISIBLE }));
  const [includeInferredEdges, setIncludeInferredEdges] = useState(true);
  const [includeTagEdges, setIncludeTagEdges] = useState(true);
  const [isolatedOnly, setIsolatedOnly] = useState(false);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [pathPicking, setPathPicking] = useState(false);
  const [pathTargetId, setPathTargetId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const [creditInferredEdges, setCreditInferredEdges] = useState<
    InferredFilmographyEdge[]
  >([]);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [batchSyncing, setBatchSyncing] = useState(false);

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // Automatically enrich filmography connections from local bundled credit shards + cached relations
  useEffect(() => {
    if (!open || !includeInferredEdges || allItems.length < 2) {
      if (!includeInferredEdges) setCreditInferredEdges([]);
      return;
    }

    let cancelled = false;
    async function loadLocalFilmographyCredits() {
      const creditsMap = new Map<string, OnlineRelationsResponse>();

      // 1. Read any already-cached filmography relations synchronously
      for (const item of allItems) {
        if (item.category !== 'film' && item.category !== 'person') continue;
        const cached = readCachedRelations(
          {
            category: item.category,
            title: item.title,
            originalTitle: item.originalTitle,
            sourceUrl: item.sourceUrl,
            year: item.year,
          },
          true
        );
        if (cached) {
          creditsMap.set(item.id, cached);
        }
      }

      // 2. Load local bundled Wikidata / Wikipedia credit shards for films (zero external API calls)
      const filmItems = allItems.filter((it) => it.category === 'film').slice(0, 40);
      const shardResults = await Promise.allSettled(
        filmItems.map(async (film) => {
          const shard = await loadFilmCredits(
            film.sourceUrl,
            film.title,
            film.originalTitle,
            film.year
          );
          return { id: film.id, shard };
        })
      );

      if (cancelled) return;

      for (const res of shardResults) {
        if (res.status === 'fulfilled' && res.value.shard) {
          const existing = creditsMap.get(res.value.id);
          if (!existing) {
            creditsMap.set(res.value.id, res.value.shard);
          } else {
            creditsMap.set(res.value.id, {
              films: [...existing.films, ...res.value.shard.films],
              people: [...existing.people, ...res.value.shard.people],
              characters: [...existing.characters, ...res.value.shard.characters],
              sources: Array.from(
                new Set([...existing.sources, ...res.value.shard.sources])
              ),
            });
          }
        }
      }

      const inferred = matchFilmographyFromCredits(allItems, creditsMap);
      if (!cancelled) {
        setCreditInferredEdges(inferred);
      }
    }

    void loadLocalFilmographyCredits();
    return () => {
      cancelled = true;
    };
  }, [open, includeInferredEdges, allItems]);

  const baseGraph = useMemo(
    () =>
      buildGlobalRelationGraph(allItems, {
        category,
        includeInferredEdges,
        externalInferredEdges: creditInferredEdges,
        includeTagEdges,
        isolatedOnly,
      }),
    [allItems, category, includeInferredEdges, creditInferredEdges, includeTagEdges, isolatedOnly]
  );

  const graph = useMemo(
    () => filterGraphByVisibleCategories(baseGraph, visibleCategories),
    [baseGraph, visibleCategories]
  );

  const availableCategoryCounts = useMemo(() => {
    if (category === 'all') {
      return countNodesByCategory(baseGraph.nodes);
    }
    const counts: Record<ArchiveCategory, number> = {
      film: 0,
      person: 0,
      character: 0,
    };
    for (const item of allItems) {
      counts[item.category] += 1;
    }
    counts[category] = baseGraph.nodes.length;
    return counts;
  }, [category, baseGraph.nodes, allItems]);

  const hiddenNodeCount = Math.max(0, baseGraph.nodes.length - graph.nodes.length);
  const hasHiddenCategory =
    !visibleCategories.film ||
    !visibleCategories.person ||
    !visibleCategories.character;
  const allCategoriesHidden =
    !visibleCategories.film &&
    !visibleCategories.person &&
    !visibleCategories.character;

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes]
  );

  const edgeCurves = useMemo(
    () => computeEdgeCurveOffsets(graph.nodes, graph.edges),
    [graph.nodes, graph.edges]
  );

  const centerOnNode = useCallback(
    (nodeId: string, nextScale?: number) => {
      const target = nodeById.get(nodeId);
      if (!target) return;
      const effectiveScale = nextScale ?? scale;
      setPan(computeFocusCamera(target, graph, effectiveScale));
    },
    [nodeById, graph, scale]
  );

  const navigateToNode = useCallback(
    (
      nodeId: string,
      opts: { recenter?: boolean; recordHistory?: boolean; keepPath?: boolean } = {}
    ) => {
      const { recenter = false, recordHistory = true, keepPath = false } = opts;
      setFocusedId(nodeId);
      if (!keepPath) {
        setPathPicking(false);
        setPathTargetId(null);
      }
      if (recordHistory) {
        setHistory((prev) => {
          const base = prev.slice(0, historyIndex + 1);
          if (base[base.length - 1] === nodeId) {
            return base;
          }
          const next = [...base, nodeId].slice(-12);
          setHistoryIndex(next.length - 1);
          return next;
        });
      }
      if (recenter) {
        const target = nodeById.get(nodeId);
        if (target) {
          setPan(computeFocusCamera(target, graph, scale));
        }
      }
    },
    [historyIndex, nodeById, graph, scale]
  );

  // Reset canvas category visibility when modal opens fresh
  useEffect(() => {
    if (open) {
      setVisibleCategories(createCategoryVisibilityForFilter(category));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Initialize focus & viewport when modal opens or major filters change
  useEffect(() => {
    if (!open) return;
    const preferredId =
      initialFocusedId && nodeById.has(initialFocusedId)
        ? initialFocusedId
        : graph.hubs[0]?.id ?? graph.nodes[0]?.id ?? null;

    setFocusedId(preferredId);
    setHistory(preferredId ? [preferredId] : []);
    setHistoryIndex(preferredId ? 0 : -1);
    setPathPicking(false);
    setPathTargetId(null);
    setSearchQuery('');
    setSearchOpen(false);
    setScale(1);

    if (preferredId && initialFocusedId && preferredId === initialFocusedId) {
      const target = nodeById.get(preferredId);
      setPan(target ? computeFocusCamera(target, graph, 1) : { x: 0, y: 0 });
    } else {
      setPan({ x: 0, y: 0 });
    }
  }, [open, category, isolatedOnly, initialFocusedId]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (pathPicking || pathTargetId) {
          setPathPicking(false);
          setPathTargetId(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, searchOpen, pathPicking, pathTargetId]);

  const effectiveFocusedId =
    focusedId && nodeById.has(focusedId) ? focusedId : null;
  const effectivePathTargetId =
    effectiveFocusedId && pathTargetId && nodeById.has(pathTargetId)
      ? pathTargetId
      : null;

  const focusContext = useMemo(
    () => getFocusedNodeConnections(graph, effectiveFocusedId, allItems),
    [graph, effectiveFocusedId, allItems]
  );

  const focusedNode = focusContext?.focusedNode ?? null;
  const pathTargetNode = effectivePathTargetId
    ? (nodeById.get(effectivePathTargetId) ?? null)
    : null;

  const activePath = useMemo(() => {
    if (!effectiveFocusedId || !effectivePathTargetId) return null;
    return findShortestGraphPath(
      graph,
      effectiveFocusedId,
      effectivePathTargetId,
      allItems,
      {
        allowTagFallback: includeTagEdges,
      }
    );
  }, [graph, effectiveFocusedId, effectivePathTargetId, allItems, includeTagEdges]);

  const pathNodeIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    if (activePath) {
      activePath.nodeIds.forEach((id, idx) => map.set(id, idx + 1));
    }
    return map;
  }, [activePath]);

  const pathEdgeIdSet = useMemo(
    () => new Set(activePath?.edgeIds ?? []),
    [activePath]
  );

  const searchResults = useMemo(
    () => (searchQuery.trim() ? searchGraphNodes(graph, searchQuery, 7) : []),
    [graph, searchQuery]
  );

  // Partition edges by visual priority so path & strong direct edges render crisply on top
  const { dimmedEdges, secondHopEdges, highlightedEdges, pathEdges } = useMemo(() => {
    const dimmed: GlobalGraphEdge[] = [];
    const secondHop: GlobalGraphEdge[] = [];
    const highlighted: GlobalGraphEdge[] = [];
    const pathOnly: GlobalGraphEdge[] = [];

    for (const edge of graph.edges) {
      if (effectivePathTargetId) {
        if (pathEdgeIdSet.has(edge.id)) {
          pathOnly.push(edge);
        } else {
          dimmed.push(edge);
        }
        continue;
      }

      const isIncident =
        Boolean(effectiveFocusedId) &&
        (edge.sourceId === effectiveFocusedId || edge.targetId === effectiveFocusedId);
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
      pathEdges: pathOnly,
    };
  }, [graph.edges, effectiveFocusedId, focusContext, effectivePathTargetId, pathEdgeIdSet]);

  // Sort nodes so hubs, focused, direct neighbors, and active path nodes always render cleanly on top
  const orderedNodes = useMemo(() => {
    if (effectivePathTargetId) {
      return [...graph.nodes].sort((a, b) => {
        const pA = pathNodeIndexMap.has(a.id)
          ? 10
          : a.id === effectiveFocusedId || a.id === effectivePathTargetId
            ? 8
            : 0;
        const pB = pathNodeIndexMap.has(b.id)
          ? 10
          : b.id === effectiveFocusedId || b.id === effectivePathTargetId
            ? 8
            : 0;
        return pA - pB || a.intensityTier - b.intensityTier;
      });
    }
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
  }, [
    graph.nodes,
    focusContext,
    effectivePathTargetId,
    pathNodeIndexMap,
    effectiveFocusedId,
  ]);

  // Limit on-canvas direct edge labels to keep dense hubs crisp and collision-free
  const visibleDirectEdgeLabels = useMemo(() => {
    if (effectivePathTargetId || !focusContext) return [];
    return focusContext.directRelations.slice(0, 8);
  }, [focusContext, effectivePathTargetId]);

  if (!open) return null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('g[data-node-id]')) return;
    setIsDragging(true);
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
    const maxPanX = Math.max(320, Math.round(graph.width * 0.55 * scale));
    const maxPanY = Math.max(260, Math.round(graph.height * 0.55 * scale));
    setPan({
      x: Math.max(-maxPanX, Math.min(maxPanX, dragRef.current.origX + dx)),
      y: Math.max(-maxPanY, Math.min(maxPanY, dragRef.current.origY + dy)),
    });
  };

  const handleSelectTopCategory = (catId: 'all' | ArchiveCategory) => {
    setCategory(catId);
    setVisibleCategories(createCategoryVisibilityForFilter(catId));
  };

  const handleToggleCanvasCategory = (target: ArchiveCategory) => {
    const { nextFilter, nextVisibility } = toggleCategoryVisibilityState(
      category,
      visibleCategories,
      target
    );
    setVisibleCategories(nextVisibility);
    if (nextFilter !== category) {
      setCategory(nextFilter);
    }
  };

  const handleShowAllCategories = () => {
    setCategory('all');
    setVisibleCategories({ ...ALL_CATEGORIES_VISIBLE });
  };

  const handlePointerUp = () => {
    if (dragRef.current.active && !dragRef.current.moved) {
      if (pathPicking) {
        setPathPicking(false);
      } else if (effectivePathTargetId) {
        setPathTargetId(null);
      } else if (effectiveFocusedId) {
        setFocusedId(null);
      }
    }
    dragRef.current.active = false;
    dragRef.current.moved = false;
    setIsDragging(false);
  };

  const handleWheelZoom = (e: React.WheelEvent<SVGSVGElement>) => {
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((s) => Math.max(0.6, Math.min(2.4, +(s + delta).toFixed(2))));
  };

  const handleResetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const handleNodeClick = (node: GlobalGraphNode) => {
    if (pathPicking && effectiveFocusedId && node.id !== effectiveFocusedId) {
      setPathTargetId(node.id);
      setPathPicking(false);
      return;
    }
    navigateToNode(node.id, { recenter: false, recordHistory: true });
  };

  const handleStepHistory = (delta: -1 | 1) => {
    const nextIdx = historyIndex + delta;
    if (nextIdx < 0 || nextIdx >= history.length) return;
    const targetId = history[nextIdx];
    if (!nodeById.has(targetId)) return;
    setHistoryIndex(nextIdx);
    setFocusedId(targetId);
    setPathPicking(false);
    setPathTargetId(null);
    centerOnNode(targetId);
  };

  const handlePersistSingleLink = async (sourceId: string, targetId: string) => {
    if (!onLinkExisting) return;
    const key = sourceId < targetId ? `${sourceId}::${targetId}` : `${targetId}::${sourceId}`;
    setLinkingKey(key);
    try {
      await onLinkExisting(sourceId, targetId);
    } finally {
      setLinkingKey(null);
    }
  };

  const handleBatchPersistDiscovered = async () => {
    if (!onLinkPairs || graph.unlinkedAutoPairs.length === 0 || batchSyncing) return;
    setBatchSyncing(true);
    try {
      await onLinkPairs(graph.unlinkedAutoPairs);
    } finally {
      setBatchSyncing(false);
    }
  };

  const visibleHistoryNodes = history
    .slice(Math.max(0, historyIndex - 4), historyIndex + 1)
    .map((id, offset) => ({
      id,
      index: Math.max(0, historyIndex - 4) + offset,
      node: nodeById.get(id),
    }))
    .filter((entry): entry is { id: string; index: number; node: GlobalGraphNode } =>
      Boolean(entry.node)
    );

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-graph-title"
      data-testid="global-relation-map-modal"
      className="encounter-backdrop-in fixed inset-0 z-[70] flex items-end justify-center bg-[#12100E]/82 backdrop-blur-xs md:items-center md:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel-in flex h-[94dvh] w-full max-w-[960px] flex-col overflow-hidden rounded-t-3xl border border-[#342F28] bg-[#161411] text-[#FAF7F0] shadow-2xl md:h-[90dvh] md:rounded-3xl">
        {/* Header with Inline Quick Search */}
        <div className="flex items-center justify-between gap-2.5 border-b border-white/10 px-4 py-3 min-[420px]:px-5">
          <div className="min-w-0">
            <h2
              id="global-graph-title"
              className="flex items-center gap-2 font-editorial text-[19px] font-medium text-[#FAF7F0]"
            >
              <Compass className="h-4 w-4 shrink-0 text-[#D4AF6A]" aria-hidden="true" />
              <span className="truncate">全局光影关系星图</span>
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-[#A59D90] tabular-nums">
              <span>{graph.nodes.length} 节点</span>
              {hiddenNodeCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#D4AF6A]">已隐藏 {hiddenNodeCount}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{graph.explicitEdgeCount} 直连</span>
              {graph.inferredEdgeCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#86D1B8]">
                    {graph.inferredEdgeCount} 自动发现
                  </span>
                </>
              )}
              {graph.clusters.length > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{graph.clusters.length} 关系簇</span>
                </>
              )}
              {graph.isolatedNodes.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{graph.isolatedNodes.length} 待连线</span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Desktop Quick Search */}
            {graph.nodes.length > 0 && (
              <div className="relative hidden sm:block">
                <label className="sr-only" htmlFor="global-graph-search-desktop">
                  检索星图节点
                </label>
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8C857B]"
                  aria-hidden="true"
                />
                <input
                  id="global-graph-search-desktop"
                  type="search"
                  value={searchQuery}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 160)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchResults[0]) {
                      e.preventDefault();
                      navigateToNode(searchResults[0].id, { recenter: true });
                      setSearchQuery('');
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="检索影视 / 影人 / 角色…"
                  data-testid="global-graph-search-input"
                  className="h-9 w-[210px] rounded-xl border border-white/12 bg-white/[0.05] pl-8 pr-3 text-xs text-[#FAF7F0] placeholder:text-[#8C857B] focus:border-[#D4AF6A]/70 focus:outline-none"
                />
                {searchOpen && searchQuery.trim() && (
                  <div
                    role="listbox"
                    aria-label="星图节点检索结果"
                    data-testid="global-graph-search-results"
                    className="absolute right-0 top-10 z-30 w-[260px] overflow-hidden rounded-xl border border-[#3B352D] bg-[#1C1A17] py-1 shadow-xl"
                  >
                    {searchResults.length > 0 ? (
                      searchResults.map((node) => (
                        <button
                          key={`sr-${node.id}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            navigateToNode(node.id, { recenter: true });
                            setSearchQuery('');
                            setSearchOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-[#FAF7F0] hover:bg-white/10 cursor-pointer"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  CATEGORY_DOT_COLOR[node.item.category],
                              }}
                            />
                            <span className="truncate font-medium">
                              {node.item.title}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-[#A59D90] tabular-nums">
                            {CATEGORY_LABELS[node.item.category]} · {node.degree}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-[#8C857B]">
                        未在当前星图中找到匹配节点
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭全局关系星图"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#A59D90] hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Filter, Layer Toggles, Cluster / Hub Switcher & History Trail */}
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
                  onClick={() => handleSelectTopCategory(cat.id)}
                  className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                    category === cat.id
                      ? 'bg-[#FAF7F0] text-[#1A1816]'
                      : 'text-[#BDB5A8] hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="global-graph-inferred-toggle"
                aria-pressed={includeInferredEdges}
                onClick={() => setIncludeInferredEdges((v) => !v)}
                className={`inline-flex min-h-[34px] items-center gap-1 rounded-xl border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                  includeInferredEdges
                    ? 'border-[#6EBFA5]/70 bg-[#6EBFA5]/16 text-[#B7ECD9]'
                    : 'border-white/15 bg-white/5 text-[#A59D90]'
                }`}
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                <span>自动发现</span>
              </button>

              <button
                type="button"
                aria-pressed={includeTagEdges}
                onClick={() => setIncludeTagEdges((v) => !v)}
                className={`min-h-[34px] rounded-xl border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
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
                className={`min-h-[34px] rounded-xl border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                  isolatedOnly
                    ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                    : 'border-white/15 bg-white/5 text-[#A59D90]'
                }`}
              >
                孤立 ({graph.isolatedNodes.length})
              </button>

              {includeInferredEdges &&
                graph.unlinkedAutoPairs.length > 0 &&
                onLinkPairs && (
                  <button
                    type="button"
                    disabled={batchSyncing}
                    data-testid="global-graph-persist-all-btn"
                    onClick={() => void handleBatchPersistDiscovered()}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-xl border border-[#86D1B8]/55 bg-[#86D1B8]/15 px-2.5 text-xs font-medium text-[#D5F7EB] whitespace-nowrap hover:bg-[#86D1B8]/25 disabled:opacity-50 cursor-pointer"
                  >
                    {batchSyncing ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <Link2 className="h-3 w-3" aria-hidden="true" />
                    )}
                    <span>写入发现 ({graph.unlinkedAutoPairs.length})</span>
                  </button>
                )}
            </div>
          </div>

          {/* Mobile Quick Search Input */}
          {graph.nodes.length > 0 && (
            <div className="relative sm:hidden">
              <label className="sr-only" htmlFor="global-graph-search-mobile">
                检索星图节点
              </label>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8C857B]"
                aria-hidden="true"
              />
              <input
                id="global-graph-search-mobile"
                type="search"
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 160)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                placeholder="检索定位影视、影人或角色…"
                className="h-9 w-full rounded-xl border border-white/12 bg-white/[0.05] pl-8 pr-3 text-xs text-[#FAF7F0] placeholder:text-[#8C857B] focus:border-[#D4AF6A]/70 focus:outline-none"
              />
              {searchOpen && searchQuery.trim() && (
                <div
                  role="listbox"
                  aria-label="星图节点检索结果"
                  className="absolute left-0 right-0 top-10 z-30 overflow-hidden rounded-xl border border-[#3B352D] bg-[#1C1A17] py-1 shadow-xl"
                >
                  {searchResults.length > 0 ? (
                    searchResults.map((node) => (
                      <button
                        key={`m-sr-${node.id}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          navigateToNode(node.id, { recenter: true });
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-[#FAF7F0] hover:bg-white/10 cursor-pointer"
                      >
                        <span className="truncate font-medium">{node.item.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[#A59D90]">
                          {CATEGORY_LABELS[node.item.category]}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-[#8C857B]">未找到匹配节点</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Clusters / Hubs Rail */}
          {!isolatedOnly && (graph.clusters.length > 1 || graph.hubs.length > 0) && (
            <div className="h-scroll-rail no-scrollbar flex items-center gap-1.5">
              {graph.clusters.length > 1 && (
                <>
                  <span className="shrink-0 font-mono text-[11px] text-[#8C857B]">
                    关系簇：
                  </span>
                  {graph.clusters.slice(0, 4).map((cluster) => {
                    const isActiveCluster =
                      focusedNode && focusedNode.clusterIndex === cluster.index;
                    return (
                      <button
                        key={`cluster-${cluster.index}`}
                        type="button"
                        data-testid={`global-cluster-chip-${cluster.index}`}
                        onClick={() =>
                          navigateToNode(cluster.hubId, { recenter: true })
                        }
                        className={`inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-lg border px-2 text-xs whitespace-nowrap cursor-pointer ${
                          isActiveCluster
                            ? 'border-[#6EBFA5]/75 bg-[#6EBFA5]/18 text-[#E4FAF2]'
                            : 'border-white/10 bg-white/[0.04] text-[#CFC7B9] hover:border-white/25'
                        }`}
                      >
                        <span className="max-w-[92px] truncate">
                          {cluster.title}簇
                        </span>
                        <span className="font-mono text-[10px] text-[#86D1B8] tabular-nums">
                          {cluster.nodeIds.length}
                        </span>
                      </button>
                    );
                  })}
                  <span
                    aria-hidden="true"
                    className="mx-0.5 h-3.5 w-px shrink-0 bg-white/12"
                  />
                </>
              )}

              <span className="shrink-0 font-mono text-[11px] text-[#8C857B]">
                核心枢纽：
              </span>
              {graph.hubs.map((hub) => (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => navigateToNode(hub.id, { recenter: true })}
                  className={`inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs whitespace-nowrap cursor-pointer ${
                    effectiveFocusedId === hub.id
                      ? 'border-[#D4AF6A] bg-[#D4AF6A]/20 text-[#FAF7F0]'
                      : 'border-white/10 bg-white/5 text-[#CFC7B9] hover:border-white/25'
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

          {/* Traversal History Breadcrumb Bar (visible once user navigates across 2+ nodes) */}
          {visibleHistoryNodes.length >= 2 && (
            <div
              data-testid="global-graph-breadcrumbs"
              className="flex items-center gap-1.5 border-t border-white/8 pt-1.5 text-[11px]"
            >
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={!canGoBack}
                  onClick={() => handleStepHistory(-1)}
                  aria-label="返回上一个聚焦节点"
                  data-testid="global-graph-history-back"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-[#E5DEC9] hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!canGoForward}
                  onClick={() => handleStepHistory(1)}
                  aria-label="前进到下一个聚焦节点"
                  data-testid="global-graph-history-forward"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-[#E5DEC9] hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[#8C857B]">
                足迹
              </span>
              <div className="h-scroll-rail no-scrollbar flex items-center gap-1">
                {visibleHistoryNodes.map((entry, idx) => {
                  const isCurrent = entry.index === historyIndex;
                  return (
                    <span
                      key={`bc-${entry.id}-${entry.index}`}
                      className="inline-flex shrink-0 items-center gap-1"
                    >
                      {idx > 0 && (
                        <ChevronRight
                          className="h-3 w-3 text-[#6E675E]"
                          aria-hidden="true"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryIndex(entry.index);
                          setFocusedId(entry.id);
                          setPathPicking(false);
                          setPathTargetId(null);
                          centerOnNode(entry.id);
                        }}
                        className={`rounded-md px-1.5 py-0.5 whitespace-nowrap cursor-pointer ${
                          isCurrent
                            ? 'bg-white/12 font-medium text-[#FAF7F0]'
                            : 'text-[#A59D90] hover:text-white'
                        }`}
                      >
                        {entry.node.item.title}
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Interactive Pan / Zoom Constellation Canvas */}
        <div className="relative min-h-[260px] flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,#221F1B_0%,#141210_100%)]">
          {graph.nodes.length === 0 ? (
            <div
              data-testid="global-graph-empty-state"
              className="flex h-full flex-col items-center justify-center px-6 pt-12 text-center"
            >
              {allCategoriesHidden || baseGraph.nodes.length > 0 ? (
                <>
                  <EyeOff className="h-8 w-8 text-[#A59D90]" aria-hidden="true" />
                  <p className="mt-3 font-editorial text-base text-[#FAF7F0]">
                    已隐藏当前画布中的分类节点
                  </p>
                  <p className="mt-1 text-xs text-[#9E9587]">
                    可点击左上角分类开关逐项恢复，或一键显示全部节点
                  </p>
                  <button
                    type="button"
                    data-testid="canvas-show-all-categories-btn"
                    onClick={handleShowAllCategories}
                    className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#FAF7F0] px-4 text-xs font-medium text-[#1A1816] whitespace-nowrap hover:bg-white cursor-pointer"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>显示全部分类</span>
                  </button>
                </>
              ) : (
                <>
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
                </>
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
              onWheel={handleWheelZoom}
              className="h-full w-full touch-none select-none cursor-grab active:cursor-grabbing"
              aria-label="全局光影关系星图画布"
            >
              <defs>
                {graph.nodes.map((node) => (
                  <clipPath
                    key={`clip-${node.id}`}
                    id={`gnode-clip-${uid}-${node.id}`}
                  >
                    <circle cx={node.x} cy={node.y} r={Math.max(10, node.radius - 1.5)} />
                  </clipPath>
                ))}
              </defs>

              <g
                transform={`translate(${graph.width / 2 + pan.x}, ${
                  graph.height / 2 + pan.y
                }) scale(${scale}) translate(${-graph.width / 2}, ${
                  -graph.height / 2
                })`}
                style={{
                  transition: isDragging
                    ? 'none'
                    : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* Decorative Subtle Orbit Rings */}
                <circle
                  cx={graph.width / 2}
                  cy={graph.height / 2}
                  r={Math.round(Math.min(graph.width, graph.height) * 0.28)}
                  fill="none"
                  stroke="rgba(255,255,255,0.045)"
                  strokeDasharray="4 6"
                />
                <circle
                  cx={graph.width / 2}
                  cy={graph.height / 2}
                  r={Math.round(Math.min(graph.width, graph.height) * 0.45)}
                  fill="none"
                  stroke="rgba(255,255,255,0.035)"
                  strokeDasharray="3 8"
                />

                {/* Subtle Filmography Cluster Enclosures when multiple universes exist */}
                {!isolatedOnly &&
                  graph.clusters.length > 1 &&
                  graph.clusters.map((cluster) => (
                    <g
                      key={`hull-${cluster.index}`}
                      className="pointer-events-none select-none"
                    >
                      <circle
                        cx={cluster.centerX}
                        cy={cluster.centerY}
                        r={cluster.radius}
                        fill="rgba(212, 175, 106, 0.035)"
                        stroke="rgba(212, 175, 106, 0.14)"
                        strokeWidth={1}
                        strokeDasharray="4 5"
                      />
                      <text
                        x={cluster.centerX}
                        y={Math.min(graph.height - 10, cluster.centerY + cluster.radius + 15)}
                        textAnchor="middle"
                        fill="rgba(207, 199, 185, 0.58)"
                        fontSize={10.5}
                        fontWeight={500}
                      >
                        {cluster.title} 关系簇 ({cluster.nodeIds.length})
                      </text>
                    </g>
                  ))}

                {/* Background / Panoramic Curved Edges */}
                {dimmedEdges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const visualState =
                    effectiveFocusedId || effectivePathTargetId ? 'dimmed' : 'idle';
                  const style = getEdgeVisualStyle(edge, visualState);
                  const geom = computeCurvedEdgeGeometry(
                    s,
                    t,
                    edgeCurves.get(edge.id) ?? 0
                  );
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
                        <path
                          d={geom.pathD}
                          fill="none"
                          stroke={style.haloColor}
                          strokeWidth={style.haloWidth}
                          strokeOpacity={style.haloOpacity}
                          strokeLinecap="round"
                        />
                      )}
                      <path
                        d={geom.pathD}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={style.strokeWidth}
                        strokeOpacity={style.strokeOpacity}
                        strokeDasharray={style.strokeDasharray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}

                {/* Second-Hop Depth Bridge Edges */}
                {secondHopEdges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const style = getEdgeVisualStyle(edge, 'second-hop');
                  const geom = computeCurvedEdgeGeometry(
                    s,
                    t,
                    edgeCurves.get(edge.id) ?? 0
                  );
                  return (
                    <path
                      key={edge.id}
                      data-edge-id={edge.id}
                      data-edge-highlighted="second-hop"
                      data-edge-kind={edge.kind}
                      data-edge-strength={edge.strength}
                      data-edge-width={style.strokeWidth}
                      d={geom.pathD}
                      fill="none"
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
                  const geom = computeCurvedEdgeGeometry(
                    s,
                    t,
                    edgeCurves.get(edge.id) ?? 0
                  );
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
                        <path
                          d={geom.pathD}
                          fill="none"
                          stroke={style.haloColor}
                          strokeWidth={style.haloWidth}
                          strokeOpacity={style.haloOpacity}
                          strokeLinecap="round"
                        />
                      )}
                      <path
                        d={geom.pathD}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={style.strokeWidth}
                        strokeOpacity={style.strokeOpacity}
                        strokeDasharray={style.strokeDasharray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}

                {/* Active Shortest Path Edges */}
                {pathEdges.map((edge) => {
                  const s = nodeById.get(edge.sourceId);
                  const t = nodeById.get(edge.targetId);
                  if (!s || !t) return null;
                  const style = getEdgeVisualStyle(edge, 'path');
                  const geom = computeCurvedEdgeGeometry(
                    s,
                    t,
                    edgeCurves.get(edge.id) ?? 0
                  );
                  return (
                    <g
                      key={`path-${edge.id}`}
                      data-edge-id={edge.id}
                      data-edge-highlighted="path"
                      data-edge-kind={edge.kind}
                    >
                      <path
                        d={geom.pathD}
                        fill="none"
                        stroke={style.haloColor}
                        strokeWidth={style.haloWidth}
                        strokeOpacity={style.haloOpacity}
                        strokeLinecap="round"
                      />
                      <path
                        d={geom.pathD}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={style.strokeWidth}
                        strokeOpacity={style.strokeOpacity}
                        strokeDasharray={style.strokeDasharray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}

                {/* Shortest-Path Step Labels on Canvas */}
                {activePath &&
                  activePath.steps.map((step) => {
                    const offset = edgeCurves.get(step.edge.id) ?? 0;
                    const pt = computeSmartEdgeLabelPoint(
                      step.fromNode,
                      step.toNode,
                      offset,
                      graph.nodes
                    );
                    const labelChars = Array.from(step.shortLabel).length;
                    const pillW = Math.max(36, labelChars * 11 + 14);
                    return (
                      <g
                        key={`path-lbl-${step.edge.id}`}
                        className="pointer-events-none select-none"
                      >
                        <rect
                          x={pt.x - pillW / 2}
                          y={pt.y - 9.5}
                          width={pillW}
                          height={19}
                          rx={9.5}
                          fill="#251815"
                          fillOpacity={0.96}
                          stroke="#F4896B"
                          strokeWidth={1.3}
                        />
                        <text
                          x={pt.x}
                          y={pt.y + 3.5}
                          textAnchor="middle"
                          fill="#FFD7CA"
                          fontSize={10}
                          fontWeight={600}
                        >
                          {step.shortLabel}
                        </text>
                      </g>
                    );
                  })}

                {/* Concise Edge Relation Labels for Focused Node's Direct Connections */}
                {focusedNode &&
                  visibleDirectEdgeLabels.map((rel) => {
                    const offset = edgeCurves.get(rel.edgeId) ?? 0;
                    const pt = computeSmartEdgeLabelPoint(
                      focusedNode,
                      rel.node,
                      offset,
                      graph.nodes
                    );
                    const labelChars = Array.from(rel.shortLabel).length;
                    const pillW = Math.max(32, labelChars * 11 + 14);
                    const isStrong = rel.strength === 3;
                    const isInferred = rel.kind === 'inferred';
                    return (
                      <g
                        key={`pill-${rel.edgeId}`}
                        data-testid={`edge-label-${rel.node.id}`}
                        className="pointer-events-none select-none"
                      >
                        <rect
                          x={pt.x - pillW / 2}
                          y={pt.y - 9.5}
                          width={pillW}
                          height={19}
                          rx={9.5}
                          fill={isInferred ? '#13201C' : isStrong ? '#211B13' : '#181511'}
                          fillOpacity={0.95}
                          stroke={
                            isInferred
                              ? '#86D1B8'
                              : isStrong
                                ? '#F2CF7E'
                                : '#D4AF6A'
                          }
                          strokeOpacity={
                            isStrong ? 0.92 : rel.strength === 2 ? 0.72 : 0.5
                          }
                          strokeWidth={isStrong ? 1.3 : 1}
                        />
                        <text
                          x={pt.x}
                          y={pt.y + 3.5}
                          textAnchor="middle"
                          fill={
                            isInferred
                              ? '#C4F2E2'
                              : isStrong
                                ? '#FCE8B2'
                                : '#E8D29D'
                          }
                          fontSize={10}
                          fontWeight={isStrong ? 600 : 500}
                        >
                          {rel.shortLabel}
                        </text>
                      </g>
                    );
                  })}

                {/* Constellation Nodes with Archival Thumbnails, Strength Grading & Path Step Numbers */}
                {orderedNodes.map((node) => {
                  const isFocused = effectiveFocusedId === node.id;
                  const pathStepNum = pathNodeIndexMap.get(node.id);
                  const isPathNode = Boolean(pathStepNum);
                  const isPathEndpoint =
                    Boolean(effectivePathTargetId) &&
                    (node.id === effectiveFocusedId ||
                      node.id === effectivePathTargetId);
                  const isDirectNeighbor =
                    !effectivePathTargetId &&
                    (focusContext?.directNeighborIds.has(node.id) ?? false);
                  const isSecondHopNeighbor =
                    !effectivePathTargetId &&
                    (focusContext?.secondHopNeighborIds.has(node.id) ?? false);
                  const isTagNeighbor =
                    !effectivePathTargetId &&
                    (focusContext?.tagNeighborIds.has(node.id) ?? false);

                  const dimmed = effectivePathTargetId
                    ? !isPathNode && !isPathEndpoint
                    : Boolean(
                        effectiveFocusedId &&
                          !isFocused &&
                          !isDirectNeighbor &&
                          !isSecondHopNeighbor &&
                          !isTagNeighbor
                      );

                  const nodeState: GraphNodeFocusState = effectivePathTargetId
                    ? isPathNode || isPathEndpoint
                      ? 'path-node'
                      : 'dimmed'
                    : !effectiveFocusedId
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
                      : nodeState === 'focused' || nodeState === 'path-node'
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
                      ? 0.72
                      : isTagNeighbor
                        ? 0.62
                        : 1;

                  const labelFill =
                    isFocused || isDirectNeighbor || isPathNode || isPathEndpoint
                      ? '#FAF7F0'
                      : isSecondHopNeighbor
                        ? '#CFC7B9'
                        : visualTier >= 2
                          ? '#EAE3D6'
                          : visualTier === 1
                            ? '#C9C0B1'
                            : '#9B9285';

                  const showCoverThumb =
                    Boolean(node.item.coverUrl) && node.radius >= 16;

                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      data-node-category={node.item.category}
                      data-node-state={nodeState}
                      data-node-tier={visualTier}
                      data-node-intensity={node.intensity}
                      data-node-fill={nodeStyle.fill}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isFocused}
                      aria-label={`${CATEGORY_LABELS[node.item.category]} ${node.item.title}，关联 ${node.degree} 项`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNodeClick(node);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onSelectItem(node.item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleNodeClick(node);
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

                      {/* Subtle Intensity Aura Ring */}
                      {nodeStyle.auraOpacity > 0 && !isFocused && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + nodeStyle.auraRadiusOffset}
                          fill="none"
                          stroke={nodeStyle.auraStroke}
                          strokeWidth={1.35}
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
                          stroke={effectivePathTargetId ? '#F4896B' : '#F5DC9B'}
                          strokeWidth={2}
                          strokeOpacity={0.92}
                        />
                      )}

                      {/* Direct Neighbor Highlight Ring */}
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
                          stroke={directStrength === 3 ? '#F5D688' : '#D4AF6A'}
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

                      {/* Node Circle Base */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius}
                        fill={nodeStyle.fill}
                        stroke={nodeStyle.stroke}
                        strokeWidth={nodeStyle.strokeWidth}
                      />

                      {/* Circular Poster / Portrait Thumbnail or Editorial Monogram */}
                      {showCoverThumb ? (
                        <>
                          <image
                            href={node.item.coverUrl}
                            x={node.x - (node.radius - 1.5)}
                            y={node.y - (node.radius - 1.5)}
                            width={(node.radius - 1.5) * 2}
                            height={(node.radius - 1.5) * 2}
                            preserveAspectRatio="xMidYMid slice"
                            clipPath={`url(#gnode-clip-${uid}-${node.id})`}
                            opacity={dimmed ? 0.5 : 0.92}
                          />
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={node.radius}
                            fill="none"
                            stroke={nodeStyle.stroke}
                            strokeWidth={nodeStyle.strokeWidth}
                          />
                        </>
                      ) : (
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
                      )}

                      {/* Shortest-Path Step Badge */}
                      {pathStepNum && (
                        <g className="pointer-events-none select-none">
                          <circle
                            cx={node.x + node.radius * 0.72}
                            cy={node.y - node.radius * 0.72}
                            r={8.5}
                            fill="#B43B2B"
                            stroke="#FAF7F0"
                            strokeWidth={1.3}
                          />
                          <text
                            x={node.x + node.radius * 0.72}
                            y={node.y - node.radius * 0.72 + 3.2}
                            textAnchor="middle"
                            fill="#FFFFFF"
                            fontSize={9.5}
                            fontWeight={700}
                          >
                            {pathStepNum}
                          </text>
                        </g>
                      )}

                      {/* Crisp Node Title Label with Colored Category Indicator Dot */}
                      {(() => {
                        const labelFontSize =
                          isFocused || isPathNode
                            ? 12.5
                            : visualTier === 3
                              ? 12
                              : 11.2;
                        const dotRadius = isFocused || isPathNode ? 3.2 : 2.8;
                        const labelLayout = computeNodeLabelLayout(
                          node.x,
                          node.y,
                          node.radius,
                          shortTitle,
                          labelFontSize,
                          dotRadius
                        );
                        return (
                          <g className="pointer-events-none select-none">
                            <circle
                              cx={labelLayout.dotCx}
                              cy={labelLayout.dotCy}
                              r={labelLayout.dotRadius}
                              fill={CATEGORY_DOT_COLOR[node.item.category]}
                              stroke="#141210"
                              strokeWidth={2.2}
                              paintOrder="stroke"
                              data-testid={`node-category-dot-${node.id}`}
                              data-node-category-dot={node.item.category}
                              aria-hidden="true"
                            />
                            <text
                              x={labelLayout.textX}
                              y={labelLayout.textY}
                              textAnchor="start"
                              fill={labelFill}
                              fontSize={labelFontSize}
                              fontWeight={
                                isFocused || isPathNode || visualTier === 3
                                  ? 600
                                  : isDirectNeighbor || visualTier === 2
                                    ? 500
                                    : 400
                              }
                              stroke="#141210"
                              strokeWidth={3.2}
                              paintOrder="stroke"
                            >
                              {shortTitle}
                            </text>
                          </g>
                        );
                      })()}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Top-Left Interactive On-Canvas Category Visibility Toggles */}
          {allItems.length > 0 && (
            <div
              data-testid="global-graph-visibility-bar"
              className="pointer-events-auto absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-1 rounded-xl border border-white/12 bg-[#161411]/92 px-2 py-1.5 text-[11px] text-[#CFC7B9] shadow-lg backdrop-blur-xs sm:px-2.5"
            >
              <div
                role="group"
                aria-label="画布分类显隐开关"
                data-testid="canvas-category-visibility"
                className="flex flex-wrap items-center gap-1"
              >
                {CANVAS_CATEGORY_TOGGLES.map((cat) => {
                  const isVisible = visibleCategories[cat.id];
                  const count = availableCategoryCounts[cat.id];
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      data-testid={`canvas-toggle-${cat.id}`}
                      aria-pressed={isVisible}
                      aria-label={
                        isVisible
                          ? `隐藏${cat.label}节点（当前 ${count} 项）`
                          : `显示${cat.label}节点（共 ${count} 项）`
                      }
                      onClick={() => handleToggleCanvasCategory(cat.id)}
                      className={`inline-flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF6A] cursor-pointer sm:min-h-[28px] ${
                        isVisible
                          ? 'border-white/18 bg-white/[0.1] text-[#FAF7F0] hover:bg-white/[0.16]'
                          : 'border-white/8 bg-transparent text-[#8C857B] hover:border-white/18 hover:text-[#CFC7B9]'
                      }`}
                    >
                      {isVisible ? (
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cat.dotColor }}
                        />
                      ) : (
                        <EyeOff
                          className="h-3 w-3 shrink-0 text-[#8C857B]"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={
                          isVisible
                            ? ''
                            : 'line-through decoration-[#8C857B]/70'
                        }
                      >
                        {cat.label}
                      </span>
                      <span
                        className={`font-mono text-[10px] tabular-nums ${
                          isVisible ? 'text-[#BDB5A8]' : 'text-[#736C62]'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}

                {hasHiddenCategory && (
                  <button
                    type="button"
                    data-testid="canvas-visibility-reset"
                    onClick={handleShowAllCategories}
                    aria-label="显示全部分类节点"
                    className="inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-lg border border-[#D4AF6A]/40 bg-[#D4AF6A]/14 px-2 text-[11px] font-medium text-[#F5DC9B] whitespace-nowrap transition-colors hover:bg-[#D4AF6A]/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF6A] cursor-pointer sm:min-h-[28px]"
                  >
                    <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>全显</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Touch & Mouse Zoom Controls Top-Right */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.4, +(s + 0.25).toFixed(2)))}
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

        {/* Dedicated Node Category Color Legend & Edge Key Bar */}
        <section
          aria-label="节点分类颜色图例"
          data-testid="global-graph-legend"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-white/10 bg-[#151310] px-4 py-2 text-[11px] text-[#CFC7B9] min-[420px]:px-5"
        >
          <div
            data-testid="global-graph-category-legend"
            className="flex flex-wrap items-center gap-x-3.5 gap-y-1"
          >
            <span className="shrink-0 font-mono text-[10px] tracking-wider text-[#9E9587]">
              节点图例
            </span>
            {GLOBAL_GRAPH_CATEGORY_LEGEND.map((entry) => {
              const isHidden = !visibleCategories[entry.category];
              return (
                <span
                  key={`legend-${entry.category}`}
                  data-testid={`legend-item-${entry.category}`}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-opacity ${
                    isHidden ? 'opacity-55' : 'opacity-100'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 shrink-0 rounded-full border-[1.5px]"
                    style={{
                      backgroundColor: entry.nodeFill,
                      borderColor: entry.nodeStroke,
                    }}
                  />
                  <span className="font-medium text-[#FAF7F0]">{entry.label}</span>
                  <span className="text-[#BDB5A8]">{entry.colorName}</span>
                  <span className="hidden text-[#8C857B] md:inline">
                    · {entry.description}
                  </span>
                </span>
              );
            })}
          </div>

          <div
            aria-label="连线类型图例"
            className="hidden items-center gap-2.5 border-l border-white/12 pl-3 text-[#BDB5A8] sm:inline-flex"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span
                aria-hidden="true"
                className="inline-block h-[2.5px] w-3.5 rounded-full bg-[#E4C37A]"
              />
              直连
            </span>
            <span className="inline-flex items-center gap-1 text-[#9EE0C9] whitespace-nowrap">
              <span
                aria-hidden="true"
                className="inline-block h-0 w-3.5 border-t-2 border-dashed border-[#7CC6AE]"
              />
              自动发现
            </span>
            <span className="hidden items-center gap-1 whitespace-nowrap lg:inline-flex">
              <span
                aria-hidden="true"
                className="inline-block h-0 w-3.5 border-t border-dotted border-[#CFC7B9]"
              />
              共签
            </span>
          </div>
        </section>

        {/* Bottom Inspector / Shortest-Path / 2-Hop Explorer */}
        <GlobalGraphInspector
          graph={graph}
          focusContext={focusContext}
          pathPicking={pathPicking}
          pathTargetNode={pathTargetNode}
          activePath={activePath}
          linkingKey={linkingKey}
          onFocusNode={(id, recenter = true) =>
            navigateToNode(id, { recenter, recordHistory: true })
          }
          onClearFocus={() => {
            setFocusedId(null);
            setPathPicking(false);
            setPathTargetId(null);
          }}
          onOpenDetail={(item) => {
            onClose();
            onSelectItem(item);
          }}
          onStartPathPicking={() => {
            setPathTargetId(null);
            setPathPicking(true);
          }}
          onSelectPathTarget={(targetId) => {
            setPathTargetId(targetId);
            setPathPicking(false);
          }}
          onSwapPathEnds={() => {
            if (!effectiveFocusedId || !effectivePathTargetId) return;
            const prevStart = effectiveFocusedId;
            setFocusedId(effectivePathTargetId);
            setPathTargetId(prevStart);
          }}
          onClearPath={() => {
            setPathPicking(false);
            setPathTargetId(null);
          }}
          onPersistSingleLink={
            onLinkExisting ? (a, b) => void handlePersistSingleLink(a, b) : undefined
          }
        />
      </div>
    </div>
  );
}
