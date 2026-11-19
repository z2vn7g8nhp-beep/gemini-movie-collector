import type { ArchiveItem } from '../types/archive';
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
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationEdgeKind;
  strength: 1 | 2 | 3;
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
    edgeKind: RelationEdgeKind;
    degree: number;
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
      sharedTags.length > 0
        ? `直连 · 共签「${sharedTags[0]}」`
        : relNeighbors.length >= 2
          ? `核心直连（关联 ${relNeighbors.length} 项）`
          : '直接关联';

    neighborMap.set(rel.id, {
      item: rel,
      hop: 1,
      strength,
      strengthLabel: strength === 3 ? '强关联' : '直连',
      reason,
      edgeKind: 'direct',
      degree: relNeighbors.length,
    });
  }

  // 2. Deep (2-hop) neighbors connected via a 1-hop bridge
  for (const rel of directNeighbors) {
    const secondHopItems = getRelatedItems(rel, allItems);
    for (const deepItem of secondHopItems) {
      if (deepItem.id === centerItem.id || directIdSet.has(deepItem.id)) {
        continue;
      }
      if (neighborMap.has(deepItem.id)) continue;

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
        edgeKind: 'bridge',
        degree: deepDegree,
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

      neighborMap.set(candidate.id, {
        item: candidate,
        hop: 2,
        strength: 1,
        strengthLabel: '共签关联',
        reason: `共同标签「${shared[0]}」`,
        edgeKind: 'tag',
        degree: getRelatedItems(candidate, allItems).length,
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
  };

  const placedNodes: GraphNode[] = [centerNode];
  const angleById = new Map<string, number>();

  // Place 1-hop nodes cleanly around an inner ellipse
  const rx1 = hop2Entries.length > 0 ? 86 : 102;
  const ry1 = hop2Entries.length > 0 ? 52 : 58;
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
    strength: 1 | 2 | 3
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
    edges.push({
      id: `edge-${key}`,
      sourceId,
      targetId,
      kind,
      strength,
    });
  };

  // Center <-> 1-hop direct edges
  for (const entry of hop1Entries) {
    addEdge(centerItem.id, entry.item.id, 'direct', entry.strength);
  }

  // 2-hop edges (bridge edge from parent -> 2-hop, or tag edge from center -> 2-hop)
  for (const entry of hop2Entries) {
    if (entry.edgeKind === 'bridge' && entry.bridgeParentId) {
      addEdge(entry.bridgeParentId, entry.item.id, 'bridge', entry.strength);
      // If center and 2-hop also share a thematic tag, add subtle tag chord
      if (findSharedThematicTags(centerItem, entry.item).length > 0) {
        addEdge(centerItem.id, entry.item.id, 'tag', 1);
      }
    } else if (entry.edgeKind === 'tag') {
      addEdge(centerItem.id, entry.item.id, 'tag', 1);
    }
  }

  // Inter-neighbor explicit links (shows real triangles / clusters!)
  for (const node of placedNodes) {
    if (node.hop === 0) continue;
    const rels = getRelatedItems(node.item, allItems);
    for (const rel of rels) {
      if (rel.id === centerItem.id) continue;
      if (placedIdSet.has(rel.id)) {
        addEdge(node.item.id, rel.id, 'bridge', 2);
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
