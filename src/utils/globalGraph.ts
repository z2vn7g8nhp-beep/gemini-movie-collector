import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { getRelatedItems } from './archive';
import { isThematicTag } from './medals';

export interface GlobalGraphNode {
  id: string;
  item: ArchiveItem;
  x: number;
  y: number;
  degree: number;
  radius: number;
  isHub: boolean;
  isIsolated: boolean;
  clusterIndex: number;
}

export interface GlobalGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'explicit' | 'tag';
  label?: string;
}

export interface GlobalGraphModel {
  width: number;
  height: number;
  nodes: GlobalGraphNode[];
  edges: GlobalGraphEdge[];
  hubs: GlobalGraphNode[];
  isolatedNodes: GlobalGraphNode[];
  explicitEdgeCount: number;
  tagEdgeCount: number;
}

const CANVAS_W = 720;
const CANVAS_H = 560;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function getSharedTag(a: ArchiveItem, b: ArchiveItem): string | null {
  const setB = new Set(
    b.tags
      .filter((t) => isThematicTag(t))
      .map((t) => t.trim().toLowerCase())
  );
  for (const tag of a.tags) {
    if (!isThematicTag(tag)) continue;
    if (setB.has(tag.trim().toLowerCase())) return tag.trim();
  }
  return null;
}

/**
 * Builds a deterministic, collision-free constellation layout of the entire archive
 * (or a category-filtered slice) optimized for mobile pan/zoom inspection.
 */
export function buildGlobalRelationGraph(
  allItems: ArchiveItem[],
  options: {
    category?: 'all' | ArchiveCategory;
    includeTagEdges?: boolean;
    isolatedOnly?: boolean;
  } = {}
): GlobalGraphModel {
  const category = options.category ?? 'all';
  const includeTagEdges = options.includeTagEdges ?? false;
  const isolatedOnly = options.isolatedOnly ?? false;

  const baseItems =
    category === 'all'
      ? allItems
      : allItems.filter((it) => it.category === category);

  const visibleIdSet = new Set(baseItems.map((it) => it.id));

  // 1. Collect explicit edges within visible items
  const edges: GlobalGraphEdge[] = [];
  const seenEdges = new Set<string>();
  const degreeMap = new Map<string, number>();

  for (const item of baseItems) {
    degreeMap.set(item.id, 0);
  }

  for (const item of baseItems) {
    const related = getRelatedItems(item, baseItems);
    for (const rel of related) {
      if (!visibleIdSet.has(rel.id) || rel.id === item.id) continue;
      const key = pairKey(item.id, rel.id);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        id: `exp-${key}`,
        sourceId: item.id,
        targetId: rel.id,
        kind: 'explicit',
      });
      degreeMap.set(item.id, (degreeMap.get(item.id) ?? 0) + 1);
      degreeMap.set(rel.id, (degreeMap.get(rel.id) ?? 0) + 1);
    }
  }

  const explicitEdgeCount = edges.length;

  // Optional subtle tag chords (capped to keep constellation legible)
  let tagEdgeCount = 0;
  if (includeTagEdges && baseItems.length <= 45) {
    for (let i = 0; i < baseItems.length; i += 1) {
      for (let j = i + 1; j < baseItems.length; j += 1) {
        if (tagEdgeCount >= 36) break;
        const a = baseItems[i];
        const b = baseItems[j];
        const key = pairKey(a.id, b.id);
        if (seenEdges.has(key)) continue;
        const shared = getSharedTag(a, b);
        if (!shared) continue;
        seenEdges.add(key);
        edges.push({
          id: `tag-${key}`,
          sourceId: a.id,
          targetId: b.id,
          kind: 'tag',
          label: shared,
        });
        tagEdgeCount += 1;
      }
    }
  }

  // 2. Partition into connected vs isolated items (based on explicit archive links)
  const adjacency = new Map<string, Set<string>>();
  for (const item of baseItems) adjacency.set(item.id, new Set());
  for (const edge of edges) {
    if (edge.kind !== 'explicit') continue;
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }

  // Connected components BFS
  const clusterById = new Map<string, number>();
  let clusterCounter = 0;
  for (const item of baseItems) {
    if (clusterById.has(item.id)) continue;
    const deg = degreeMap.get(item.id) ?? 0;
    if (deg === 0) {
      clusterById.set(item.id, -1);
      continue;
    }
    const queue = [item.id];
    clusterById.set(item.id, clusterCounter);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nxt of adjacency.get(curr) ?? []) {
        if (!clusterById.has(nxt)) {
          clusterById.set(nxt, clusterCounter);
          queue.push(nxt);
        }
      }
    }
    clusterCounter += 1;
  }

  const targetItems = isolatedOnly
    ? baseItems.filter((it) => (degreeMap.get(it.id) ?? 0) === 0)
    : baseItems;

  const connectedItems = targetItems
    .filter((it) => (degreeMap.get(it.id) ?? 0) > 0)
    .sort((a, b) => {
      const da = degreeMap.get(a.id) ?? 0;
      const db = degreeMap.get(b.id) ?? 0;
      if (db !== da) return db - da;
      const ca = clusterById.get(a.id) ?? 0;
      const cb = clusterById.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.accessionNo.localeCompare(b.accessionNo);
    });

  const isolatedItems = targetItems
    .filter((it) => (degreeMap.get(it.id) ?? 0) === 0)
    .sort((a, b) => a.accessionNo.localeCompare(b.accessionNo));

  const nodes: GlobalGraphNode[] = [];
  const posById = new Map<string, { x: number; y: number }>();

  const maxDegree = Math.max(
    1,
    ...connectedItems.map((it) => degreeMap.get(it.id) ?? 0)
  );

  // Place connected items in concentric rings (hubs in center, spokes around them)
  if (connectedItems.length === 1) {
    const it = connectedItems[0];
    posById.set(it.id, { x: CX, y: CY });
  } else if (connectedItems.length > 1) {
    const coreCount = Math.min(connectedItems.length, connectedItems.length <= 6 ? 1 : 3);
    const coreItems = connectedItems.slice(0, coreCount);
    const midItems = connectedItems.slice(coreCount);

    coreItems.forEach((it, idx) => {
      if (coreItems.length === 1) {
        posById.set(it.id, { x: CX, y: CY });
      } else {
        const angle = -Math.PI / 2 + (idx * Math.PI * 2) / coreItems.length;
        posById.set(it.id, {
          x: CX + Math.cos(angle) * 78,
          y: CY + Math.sin(angle) * 62,
        });
      }
    });

    const ring1Max = Math.min(midItems.length, 10);
    const ring1 = midItems.slice(0, ring1Max);
    const ring2 = midItems.slice(ring1Max);

    ring1.forEach((it, idx) => {
      const angle = -Math.PI * 0.78 + (idx * Math.PI * 2) / Math.max(1, ring1.length);
      posById.set(it.id, {
        x: CX + Math.cos(angle) * 196,
        y: CY + Math.sin(angle) * 154,
      });
    });

    ring2.forEach((it, idx) => {
      const angle = -Math.PI * 0.45 + (idx * Math.PI * 2) / Math.max(1, ring2.length);
      posById.set(it.id, {
        x: CX + Math.cos(angle) * 260,
        y: CY + Math.sin(angle) * 204,
      });
    });

    // Run deterministic lightweight spring relaxation for connected nodes (18 steps)
    const connectedIds = connectedItems.map((it) => it.id);
    for (let step = 0; step < 18; step += 1) {
      const disp = new Map<string, { dx: number; dy: number }>();
      for (const id of connectedIds) disp.set(id, { dx: 0, dy: 0 });

      // Repulsion between all pairs
      for (let i = 0; i < connectedIds.length; i += 1) {
        for (let j = i + 1; j < connectedIds.length; j += 1) {
          const idA = connectedIds[i];
          const idB = connectedIds[j];
          const pA = posById.get(idA)!;
          const pB = posById.get(idB)!;
          let vx = pA.x - pB.x;
          let vy = pA.y - pB.y;
          const dist = Math.hypot(vx, vy) || 1;
          const minGap = 138;
          if (dist < minGap) {
            const push = ((minGap - dist) / minGap) * 16;
            vx = (vx / dist) * push;
            vy = (vy / dist) * push;
            disp.get(idA)!.dx += vx;
            disp.get(idA)!.dy += vy;
            disp.get(idB)!.dx -= vx;
            disp.get(idB)!.dy -= vy;
          }
        }
      }

      // Attraction along explicit edges
      for (const e of edges) {
        if (e.kind !== 'explicit') continue;
        const pA = posById.get(e.sourceId);
        const pB = posById.get(e.targetId);
        if (!pA || !pB) continue;
        const vx = pB.x - pA.x;
        const vy = pB.y - pA.y;
        const dist = Math.hypot(vx, vy) || 1;
        const ideal = 160;
        if (dist > ideal) {
          const pull = ((dist - ideal) / dist) * 0.12;
          disp.get(e.sourceId)!.dx += vx * pull;
          disp.get(e.sourceId)!.dy += vy * pull;
          disp.get(e.targetId)!.dx -= vx * pull;
          disp.get(e.targetId)!.dy -= vy * pull;
        }
      }

      // Gentle pull toward center & clamp inside safe bounds
      for (const id of connectedIds) {
        const p = posById.get(id)!;
        const d = disp.get(id)!;
        const gravity = 0.015;
        p.x = Math.max(76, Math.min(CANVAS_W - 76, p.x + d.dx + (CX - p.x) * gravity));
        p.y = Math.max(72, Math.min(CANVAS_H - 80, p.y + d.dy + (CY - p.y) * gravity));
      }
    }
  }

  // Place isolated items cleanly on outer perimeter (or neat grid if isolatedOnly)
  isolatedItems.forEach((it, idx) => {
    if (isolatedOnly || connectedItems.length === 0) {
      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(isolatedItems.length))));
      const rows = Math.ceil(isolatedItems.length / cols);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cellW = (CANVAS_W - 140) / Math.max(1, cols);
      const cellH = (CANVAS_H - 140) / Math.max(1, rows);
      posById.set(it.id, {
        x: 70 + cellW * (col + 0.5),
        y: 70 + cellH * (row + 0.5),
      });
    } else {
      const angle = Math.PI * 0.12 + (idx * Math.PI * 2) / Math.max(1, isolatedItems.length);
      posById.set(it.id, {
        x: Math.max(54, Math.min(CANVAS_W - 54, CX + Math.cos(angle) * 296)),
        y: Math.max(54, Math.min(CANVAS_H - 62, CY + Math.sin(angle) * 224)),
      });
    }
  });

  const hubThreshold = Math.max(2, Math.ceil(maxDegree * 0.65));

  for (const item of targetItems) {
    const deg = degreeMap.get(item.id) ?? 0;
    const pos = posById.get(item.id) ?? { x: CX, y: CY };
    const radius = deg === 0 ? 15 : Math.min(26, 16 + deg * 2.5);
    nodes.push({
      id: item.id,
      item,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      degree: deg,
      radius,
      isHub: deg >= hubThreshold && deg > 0,
      isIsolated: deg === 0,
      clusterIndex: clusterById.get(item.id) ?? -1,
    });
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIdSet.has(e.sourceId) && nodeIdSet.has(e.targetId)
  );

  const hubs = [...nodes]
    .filter((n) => n.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.item.accessionNo.localeCompare(b.item.accessionNo))
    .slice(0, 5);

  const isolatedNodes = nodes.filter((n) => n.isIsolated);

  return {
    width: CANVAS_W,
    height: CANVAS_H,
    nodes,
    edges: filteredEdges,
    hubs,
    isolatedNodes,
    explicitEdgeCount: filteredEdges.filter((e) => e.kind === 'explicit').length,
    tagEdgeCount: filteredEdges.filter((e) => e.kind === 'tag').length,
  };
}
