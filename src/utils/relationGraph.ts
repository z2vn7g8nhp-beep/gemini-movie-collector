import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { getRelatedItems } from './archive';
import { isThematicTag } from './medals';

export type RelationEdgeKind = 'direct' | 'bridge' | 'tag';

export interface GraphNode {
  item: ArchiveItem;
  hop: 0 | 1 | 2;
  strength: 1 | 2 | 3;
  strengthLabel: string;
  reason: string;
  x: number;
  y: number;
  degree: number;
  mutualCount: number;
  sharedTagCount: number;
  bridgeCount: number;
  intensityTier: 1 | 2 | 3;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationEdgeKind;
  strength: 1 | 2 | 3;
  strengthWeight: number;
}

export interface DetailEdgeVisualStyle {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  dashArray?: string;
  haloWidth: number;
  haloOpacity: number;
}

export interface DetailNodeVisualStyle {
  ringColor: string;
  ringWidth: number;
  baseFill: string;
  imageOpacity: number;
  labelColor: string;
  auraColor: string;
  auraOpacity: number;
}

export interface RelationGraphModel {
  width: number;
  height: number;
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  directCount: number;
  deepCount: number;
  tagLinkCount: number;
}

const VIEWBOX_W = 360;
const VIEWBOX_H = 212;
const CX = VIEWBOX_W / 2;
const CY = VIEWBOX_H / 2 + 4;

function getThematicTagSet(item: ArchiveItem): Set<string> {
  const set = new Set<string>();
  for (const tag of item.tags) {
    if (isThematicTag(tag)) {
      set.add(tag.trim().toLowerCase());
    }
  }
  return set;
}

function findSharedThematicTags(a: ArchiveItem, b: ArchiveItem): string[] {
  const bSet = getThematicTagSet(b);
  const shared: string[] = [];
  const seen = new Set<string>();
  for (const tag of a.tags) {
    if (!isThematicTag(tag)) continue;
    const key = tag.trim().toLowerCase();
    if (bSet.has(key) && !seen.has(key)) {
      seen.add(key);
      shared.push(tag.trim());
    }
  }
  return shared;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

const DETAIL_CATEGORY_DEPTH_COLORS: Record<
  ArchiveCategory,
  Record<1 | 2 | 3, { ring: string; baseFill: string; aura: string }>
> = {
  film: {
    1: { ring: '#9C4D43', baseFill: '#241B19', aura: '#B4473A' },
    2: { ring: '#C75343', baseFill: '#2E1E1B', aura: '#D14B3A' },
    3: { ring: '#EC6A55', baseFill: '#3B221D', aura: '#F06A54' },
  },
  person: {
    1: { ring: '#9E8552', baseFill: '#242018', aura: '#B09255' },
    2: { ring: '#CFA95E', baseFill: '#2E271A', aura: '#D9B66B' },
    3: { ring: '#F2CF7E', baseFill: '#3B311C', aura: '#F5D688' },
  },
  character: {
    1: { ring: '#5A7F72', baseFill: '#1B2421', aura: '#659081' },
    2: { ring: '#75A896', baseFill: '#1E2D28', aura: '#7ABCA6' },
    3: { ring: '#95D1BC', baseFill: '#213830', aura: '#95D1BC' },
  },
};

export function getDetailEdgeVisualStyle(
  edge: Pick<GraphEdge, 'kind' | 'strength' | 'strengthWeight'>
): DetailEdgeVisualStyle {
  const bonus = Math.max(0, Math.min(1, edge.strengthWeight)) * 0.4;
  if (edge.kind === 'direct') {
    if (edge.strength === 3) {
      return {
        stroke: '#E8634E',
        strokeWidth: +(3.0 + bonus).toFixed(2),
        strokeOpacity: 0.96,
        haloWidth: 7.2,
        haloOpacity: 0.2,
      };
    }
    return {
      stroke: '#D4AF6A',
      strokeWidth: +(1.95 + bonus * 0.4).toFixed(2),
      strokeOpacity: 0.84,
      haloWidth: 4.5,
      haloOpacity: 0.1,
    };
  }
  if (edge.kind === 'bridge') {
    if (edge.strength >= 2) {
      return {
        stroke: '#CFA95E',
        strokeWidth: 1.85,
        strokeOpacity: 0.78,
        dashArray: '5 3',
        haloWidth: 0,
        haloOpacity: 0,
      };
    }
    return {
      stroke: '#A68D5B',
      strokeWidth: 1.25,
      strokeOpacity: 0.56,
      dashArray: '4 3.5',
      haloWidth: 0,
      haloOpacity: 0,
    };
  }
  // Tag edge
  return {
    stroke: edge.strength >= 2 ? '#BEB5A6' : '#8C8478',
    strokeWidth: edge.strength >= 2 ? 1.55 : 1.05,
    strokeOpacity: edge.strength >= 2 ? 0.68 : 0.45,
    dashArray: '2 3',
    haloWidth: 0,
    haloOpacity: 0,
  };
}

export function getDetailNodeVisualStyle(
  node: Pick<GraphNode, 'item' | 'hop' | 'strength' | 'intensityTier'>
): DetailNodeVisualStyle {
  const tier: 1 | 2 | 3 = node.hop === 0 ? 3 : node.intensityTier;
  const palette = DETAIL_CATEGORY_DEPTH_COLORS[node.item.category][tier];
  return {
    ringColor: palette.ring,
    ringWidth: node.hop === 0 ? 2.6 : tier === 3 ? 2.4 : tier === 2 ? 1.9 : 1.35,
    baseFill: palette.baseFill,
    imageOpacity: node.hop === 0 ? 1 : tier === 3 ? 1 : tier === 2 ? 0.92 : 0.78,
    labelColor:
      node.hop === 0
        ? '#FAF7F0'
        : tier === 3
          ? '#F7F1E3'
          : tier === 2
            ? '#DFD7C8'
            : '#ACA395',
    auraColor: palette.aura,
    auraOpacity: node.hop === 0 ? 0.44 : tier === 3 ? 0.28 : 0,
  };
}

export function buildRelationGraph(
  centerItem: ArchiveItem,
  allItems: ArchiveItem[],
  maxNeighbors = 8
): RelationGraphModel {
  const directNeighbors = getRelatedItems(centerItem, allItems);
  const directIdSet = new Set(directNeighbors.map((i) => i.id));

  // Track candidate metadata
  interface NeighborEntry {
    item: ArchiveItem;
    hop: 1 | 2;
    strength: 1 | 2 | 3;
    strengthLabel: string;
    reason: string;
    bridgeParentId?: string;
    bridgeParentIds: string[];
    edgeKind: RelationEdgeKind;
    degree: number;
    mutualCount: number;
    sharedTagCount: number;
    intensityTier: 1 | 2 | 3;
  }

  const neighborMap = new Map<string, NeighborEntry>();

  // 1. Direct (1-hop) neighbors
  for (const rel of directNeighbors) {
    const sharedTags = findSharedThematicTags(centerItem, rel);
    const relNeighbors = getRelatedItems(rel, allItems);
    const mutualCount = relNeighbors.filter(
      (n) => n.id !== centerItem.id && directIdSet.has(n.id)
    ).length;

    const isStrong =
      sharedTags.length > 0 || mutualCount > 0 || relNeighbors.length >= 2;
    const strength: 2 | 3 = isStrong ? 3 : 2;
    const reason =
      sharedTags.length > 0 && mutualCount > 0
        ? `强直连 · ${mutualCount}项共联 · 共签「${sharedTags[0]}」`
        : sharedTags.length > 0
          ? `直连 · 共签「${sharedTags[0]}」`
          : mutualCount > 0
            ? `核心直连 · 共同关联 ${mutualCount} 项`
            : relNeighbors.length >= 2
              ? `核心直连（关联 ${relNeighbors.length} 项）`
              : '直接关联';

    neighborMap.set(rel.id, {
      item: rel,
      hop: 1,
      strength,
      strengthLabel: strength === 3 ? '强关联' : '直连',
      reason,
      bridgeParentIds: [],
      edgeKind: 'direct',
      degree: relNeighbors.length,
      mutualCount,
      sharedTagCount: sharedTags.length,
      intensityTier: strength === 3 ? 3 : 2,
    });
  }

  // 2. Deep (2-hop) neighbors connected via 1-hop bridges (track multiple bridges!)
  for (const rel of directNeighbors) {
    const secondHopItems = getRelatedItems(rel, allItems);
    for (const deepItem of secondHopItems) {
      if (deepItem.id === centerItem.id || directIdSet.has(deepItem.id)) {
        continue;
      }
      const existing = neighborMap.get(deepItem.id);
      if (existing && existing.edgeKind === 'bridge') {
        if (!existing.bridgeParentIds.includes(rel.id)) {
          existing.bridgeParentIds.push(rel.id);
          existing.strength = 2;
          existing.intensityTier = 2;
          existing.strengthLabel = '多重二度';
          existing.reason = `经由 ${existing.bridgeParentIds.length} 项桥接延伸`;
        }
        continue;
      }
      if (existing) continue;

      const sharedTags = findSharedThematicTags(centerItem, deepItem);
      const deepDegree = getRelatedItems(deepItem, allItems).length;
      const strength: 1 | 2 = sharedTags.length > 0 ? 2 : 1;

      neighborMap.set(deepItem.id, {
        item: deepItem,
        hop: 2,
        strength,
        strengthLabel: sharedTags.length > 0 ? '二度+共签' : '二度延伸',
        reason: `经由「${rel.title}」延伸`,
        bridgeParentId: rel.id,
        bridgeParentIds: [rel.id],
        edgeKind: 'bridge',
        degree: deepDegree,
        mutualCount: 0,
        sharedTagCount: sharedTags.length,
        intensityTier: strength === 2 ? 2 : 1,
      });
    }
  }

  // 3. Thematic tag neighbors (items sharing real thematic tags with center, not yet included)
  const centerThematic = getThematicTagSet(centerItem);
  if (centerThematic.size > 0) {
    for (const candidate of allItems) {
      if (candidate.id === centerItem.id || neighborMap.has(candidate.id)) {
        continue;
      }
      const shared = findSharedThematicTags(centerItem, candidate);
      if (shared.length === 0) continue;

      const strength: 1 | 2 = shared.length >= 2 ? 2 : 1;

      neighborMap.set(candidate.id, {
        item: candidate,
        hop: 2,
        strength,
        strengthLabel: shared.length >= 2 ? '多重共签' : '共签关联',
        reason:
          shared.length >= 2
            ? `共享 ${shared.length} 个标签（${shared[0]}等）`
            : `共同标签「${shared[0]}」`,
        bridgeParentIds: [],
        edgeKind: 'tag',
        degree: getRelatedItems(candidate, allItems).length,
        mutualCount: 0,
        sharedTagCount: shared.length,
        intensityTier: strength === 2 ? 2 : 1,
      });
    }
  }

  // Prioritize: 1-hop strong -> 1-hop direct -> 2-hop bridge -> tag link, then by degree
  const prioritized = Array.from(neighborMap.values())
    .sort((a, b) => {
      if (a.hop !== b.hop) return a.hop - b.hop;
      if (a.strength !== b.strength) return b.strength - a.strength;
      if (a.edgeKind !== b.edgeKind) {
        if (a.edgeKind === 'bridge') return -1;
        if (b.edgeKind === 'bridge') return 1;
      }
      if (b.bridgeParentIds.length !== a.bridgeParentIds.length) {
        return b.bridgeParentIds.length - a.bridgeParentIds.length;
      }
      return b.degree - a.degree;
    })
    .slice(0, maxNeighbors);

  const hop1Entries = prioritized.filter((n) => n.hop === 1);
  const hop2Entries = prioritized.filter((n) => n.hop === 2);

  const centerNode: GraphNode = {
    item: centerItem,
    hop: 0,
    strength: 3,
    strengthLabel: '当前档案',
    reason: '图谱核心',
    x: CX,
    y: CY,
    degree: directNeighbors.length,
    mutualCount: 0,
    sharedTagCount: 0,
    bridgeCount: 0,
    intensityTier: 3,
  };

  const placedNodes: GraphNode[] = [centerNode];
  const angleById = new Map<string, number>();

  // Place 1-hop nodes cleanly around an inner ellipse
  const rx1 = hop2Entries.length > 0 ? 90 : 104;
  const ry1 = hop2Entries.length > 0 ? 58 : 62;
  const hop1StartAngle = hop1Entries.length === 1 ? Math.PI : -Math.PI * 0.72;

  hop1Entries.forEach((entry, idx) => {
    const angle =
      hop1Entries.length === 1
        ? Math.PI * 0.96
        : hop1StartAngle + (idx * Math.PI * 2) / hop1Entries.length;
    angleById.set(entry.item.id, angle);

    const x = Math.round(CX + Math.cos(angle) * rx1);
    const y = Math.round(CY + Math.sin(angle) * ry1);

    placedNodes.push({
      item: entry.item,
      hop: 1,
      strength: entry.strength,
      strengthLabel: entry.strengthLabel,
      reason: entry.reason,
      x,
      y,
      degree: entry.degree,
      mutualCount: entry.mutualCount,
      sharedTagCount: entry.sharedTagCount,
      bridgeCount: entry.bridgeParentIds.length,
      intensityTier: entry.intensityTier,
    });
  });

  // Place 2-hop nodes around an outer ellipse, gently opposite / spread from 1-hop to avoid label collisions
  const rx2 = 128;
  const ry2 = 66;

  if (hop1Entries.length === 1 && hop2Entries.length === 1) {
    // Classic 3-node chain (Center <-> Bridge <-> Deep): arrange as a crisp triangular constellation
    // so the bridge arc sweeps cleanly above the center node without visual occlusion.
    centerNode.y = Math.round(CY + 14);

    const bridgeNode = placedNodes[1];
    bridgeNode.x = Math.round(CX - 94);
    bridgeNode.y = Math.round(CY - 30);

    const deepEntry = hop2Entries[0];
    placedNodes.push({
      item: deepEntry.item,
      hop: 2,
      strength: deepEntry.strength,
      strengthLabel: deepEntry.strengthLabel,
      reason: deepEntry.reason,
      x: Math.round(CX + 98),
      y: Math.round(CY - 16),
      degree: deepEntry.degree,
      mutualCount: deepEntry.mutualCount,
      sharedTagCount: deepEntry.sharedTagCount,
      bridgeCount: deepEntry.bridgeParentIds.length,
      intensityTier: deepEntry.intensityTier,
    });
  } else {
    const offsetAngle =
      hop1Entries.length > 0 ? Math.PI / Math.max(2, hop1Entries.length) : 0;
    hop2Entries.forEach((entry, idx) => {
      const baseAngle =
        hop2Entries.length === 1
          ? 0.08
          : -Math.PI * 0.35 +
            offsetAngle +
            (idx * Math.PI * 2) / hop2Entries.length;

      const x = Math.max(
        42,
        Math.min(VIEWBOX_W - 42, Math.round(CX + Math.cos(baseAngle) * rx2))
      );
      const y = Math.max(
        34,
        Math.min(VIEWBOX_H - 46, Math.round(CY + Math.sin(baseAngle) * ry2))
      );

      placedNodes.push({
        item: entry.item,
        hop: 2,
        strength: entry.strength,
        strengthLabel: entry.strengthLabel,
        reason: entry.reason,
        x,
        y,
        degree: entry.degree,
        mutualCount: entry.mutualCount,
        sharedTagCount: entry.sharedTagCount,
        bridgeCount: entry.bridgeParentIds.length,
        intensityTier: entry.intensityTier,
      });
    });
  }

  // Build deduplicated edges
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const placedIdSet = new Set(placedNodes.map((n) => n.item.id));

  const addEdge = (
    sourceId: string,
    targetId: string,
    kind: RelationEdgeKind,
    strength: 1 | 2 | 3,
    strengthWeight?: number
  ) => {
    if (
      sourceId === targetId ||
      !placedIdSet.has(sourceId) ||
      !placedIdSet.has(targetId)
    ) {
      return;
    }
    const key = edgeKey(sourceId, targetId);
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    const weight =
      strengthWeight ??
      (kind === 'direct'
        ? strength === 3
          ? 0.9
          : 0.62
        : kind === 'bridge'
          ? strength >= 2
            ? 0.52
            : 0.32
          : strength >= 2
            ? 0.42
            : 0.22);
    edges.push({
      id: `edge-${key}`,
      sourceId,
      targetId,
      kind,
      strength,
      strengthWeight: Number(Math.min(1, Math.max(0.15, weight)).toFixed(2)),
    });
  };

  // Center <-> 1-hop direct edges
  for (const entry of hop1Entries) {
    const weight = Math.min(
      1,
      0.5 +
        (entry.strength === 3 ? 0.25 : 0.05) +
        entry.mutualCount * 0.12 +
        entry.sharedTagCount * 0.08
    );
    addEdge(centerItem.id, entry.item.id, 'direct', entry.strength, weight);
  }

  // 2-hop edges (bridge edge from parent -> 2-hop, or tag edge from center -> 2-hop)
  for (const entry of hop2Entries) {
    if (entry.edgeKind === 'bridge' && entry.bridgeParentIds.length > 0) {
      for (const parentId of entry.bridgeParentIds) {
        addEdge(parentId, entry.item.id, 'bridge', entry.strength);
      }
      // If center and 2-hop also share a thematic tag, add subtle tag chord
      if (entry.sharedTagCount > 0) {
        addEdge(
          centerItem.id,
          entry.item.id,
          'tag',
          entry.sharedTagCount >= 2 ? 2 : 1
        );
      }
    } else if (entry.edgeKind === 'tag') {
      addEdge(centerItem.id, entry.item.id, 'tag', entry.strength);
    }
  }

  // Inter-neighbor explicit links (shows real triangles / clusters!)
  for (const node of placedNodes) {
    if (node.hop === 0) continue;
    const rels = getRelatedItems(node.item, allItems);
    for (const rel of rels) {
      if (rel.id === centerItem.id) continue;
      if (placedIdSet.has(rel.id)) {
        addEdge(node.item.id, rel.id, 'bridge', 2, 0.56);
      }
    }
  }

  const directCount = hop1Entries.length;
  const deepCount = hop2Entries.filter((e) => e.edgeKind === 'bridge').length;
  const tagLinkCount = hop2Entries.filter((e) => e.edgeKind === 'tag').length;

  return {
    width: VIEWBOX_W,
    height: VIEWBOX_H,
    center: centerNode,
    nodes: placedNodes,
    edges,
    directCount,
    deepCount,
    tagLinkCount,
  };
}
