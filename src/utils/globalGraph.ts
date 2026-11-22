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

export interface DirectRelationDetail {
  edgeId: string;
  node: GlobalGraphNode;
  kind: 'explicit' | 'tag';
  shortLabel: string;
  description: string;
  sharedTags: string[];
}

export interface FocusedNodeRelationContext {
  focusedNode: GlobalGraphNode;
  directRelations: DirectRelationDetail[];
  tagRelations: DirectRelationDetail[];
  directNeighborIds: Set<string>;
  tagNeighborIds: Set<string>;
  edgeDetailById: Map<string, DirectRelationDetail>;
}

const CANVAS_W = 720;
const CANVAS_H = 560;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function getSharedThematicTags(a: ArchiveItem, b: ArchiveItem): string[] {
  const setB = new Set(
    b.tags
      .filter((t) => isThematicTag(t))
      .map((t) => t.trim().toLowerCase())
  );
  const shared: string[] = [];
  const seen = new Set<string>();
  for (const tag of a.tags) {
    if (!isThematicTag(tag)) continue;
    const key = tag.trim().toLowerCase();
    if (setB.has(key) && !seen.has(key)) {
      seen.add(key);
      shared.push(tag.trim());
    }
  }
  return shared;
}

function getSharedTag(a: ArchiveItem, b: ArchiveItem): string | null {
  return getSharedThematicTags(a, b)[0] ?? null;
}

function normalizedIncludes(haystack?: string, needle?: string): boolean {
  const h = (haystack || '').trim().toLowerCase();
  const n = (needle || '').trim().toLowerCase();
  return h.length >= 2 && n.length >= 2 && h.includes(n);
}

function extractFirstWorkTitle(raw?: string): string {
  if (!raw) return '';
  const first = raw.split(/[\/／、,，]/)[0]?.trim() || '';
  return first.replace(/^《|》$/g, '');
}

function compactSubtitle(raw?: string, maxLen = 14): string {
  if (!raw) return '';
  const cleaned = raw
    .split(/[·•|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');
  if (!cleaned) return '';
  const chars = Array.from(cleaned);
  return chars.length <= maxLen
    ? cleaned
    : `${chars.slice(0, maxLen - 1).join('')}…`;
}

function findSharedConnectedItems(
  a: ArchiveItem,
  b: ArchiveItem,
  allItems: ArchiveItem[],
  category: ArchiveCategory
): ArchiveItem[] {
  const relA = new Set(
    getRelatedItems(a, allItems)
      .filter((it) => it.category === category)
      .map((it) => it.id)
  );
  return getRelatedItems(b, allItems).filter(
    (it) => it.category === category && relA.has(it.id)
  );
}

function findPortrayedCharacterInFilm(
  film: ArchiveItem,
  person: ArchiveItem,
  allItems: ArchiveItem[]
): ArchiveItem | undefined {
  return allItems.find((cand) => {
    if (cand.category !== 'character') return false;
    const matchesPerson =
      normalizedIncludes(cand.portrayedBy, person.title) ||
      (Boolean(person.originalTitle) &&
        normalizedIncludes(cand.portrayedBy, person.originalTitle));
    if (!matchesPerson) return false;
    const matchesFilm =
      cand.relatedIds.includes(film.id) ||
      film.relatedIds.includes(cand.id) ||
      normalizedIncludes(cand.relatedWorkTitle, film.title);
    return matchesFilm;
  });
}

function formatPortrayedPhrase(portrayedBy: string): string {
  const clean = portrayedBy.trim();
  if (/配音|声优|献声/.test(clean)) {
    return `由${clean}`;
  }
  return `${clean}饰演`;
}

/**
 * Generates a concise, direction-aware label and brief explanation describing
 * why `from` is related to `to` inside the collection knowledge graph.
 */
export function describeRelationBetween(
  from: ArchiveItem,
  to: ArchiveItem,
  allItems: ArchiveItem[],
  kind: 'explicit' | 'tag' = 'explicit',
  tagLabel?: string
): { shortLabel: string; description: string; sharedTags: string[] } {
  const sharedTags = getSharedThematicTags(from, to);

  if (kind === 'tag') {
    const tag = tagLabel || sharedTags[0] || '';
    return {
      shortLabel: tag ? `#${Array.from(tag).slice(0, 4).join('')}` : '共签',
      description: tag ? `共享主题标签「${tag}」` : '共享主题标签',
      sharedTags: tag && !sharedTags.includes(tag) ? [tag, ...sharedTags] : sharedTags,
    };
  }

  // 1. Film -> Person
  if (from.category === 'film' && to.category === 'person') {
    const sub = to.subtitle || '';
    const isDirector =
      /导演|编导|监督/.test(sub) &&
      (normalizedIncludes(from.subtitle, to.title) || !/演员|主演/.test(sub));
    if (isDirector) {
      return {
        shortLabel: '导演',
        description: normalizedIncludes(from.subtitle, to.title)
          ? `执导本片${from.year ? `（${from.year}）` : ''}`
          : `本片关联导演${compactSubtitle(sub, 10) ? ` · ${compactSubtitle(sub, 10)}` : ''}`,
        sharedTags,
      };
    }

    const portrayedChar = findPortrayedCharacterInFilm(from, to, allItems);
    if (portrayedChar) {
      return {
        shortLabel: '主演',
        description: `参演本片 · 饰演角色「${portrayedChar.title}」`,
        sharedTags,
      };
    }

    if (/演员|主演|配音|声优/.test(sub)) {
      return {
        shortLabel: '参演',
        description: compactSubtitle(sub, 14)
          ? `本片参演影人 · ${compactSubtitle(sub, 14)}`
          : '本片直接关联演员',
        sharedTags,
      };
    }

    return {
      shortLabel: '主创',
      description: compactSubtitle(sub, 14)
        ? `关联影人 · ${compactSubtitle(sub, 14)}`
        : '本片直接关联影人',
      sharedTags,
    };
  }

  // 2. Person -> Film
  if (from.category === 'person' && to.category === 'film') {
    const sub = from.subtitle || '';
    const isDirector =
      /导演|编导|监督/.test(sub) &&
      (normalizedIncludes(to.subtitle, from.title) || !/演员|主演/.test(sub));
    if (isDirector) {
      return {
        shortLabel: '执导',
        description: `执导作品${to.year ? `（${to.year}）` : ''}${to.region ? ` · ${to.region}` : ''}`,
        sharedTags,
      };
    }

    const portrayedChar = findPortrayedCharacterInFilm(to, from, allItems);
    if (portrayedChar) {
      return {
        shortLabel: '主演',
        description: `参演作品 · 饰演「${portrayedChar.title}」${to.year ? `（${to.year}）` : ''}`,
        sharedTags,
      };
    }

    if (/演员|主演|配音|声优/.test(sub)) {
      return {
        shortLabel: '参演',
        description: `参演作品${to.year ? `（${to.year}）` : ''}${to.region ? ` · ${to.region}` : ''}`,
        sharedTags,
      };
    }

    if (normalizedIncludes(from.relatedWorkTitle, to.title)) {
      return {
        shortLabel: '代表作',
        description: `关联代表作品${to.year ? `（${to.year}）` : ''}`,
        sharedTags,
      };
    }

    return {
      shortLabel: '关联作品',
      description: `直接关联影视${to.year ? `（${to.year}）` : ''}`,
      sharedTags,
    };
  }

  // 3. Character -> Film
  if (from.category === 'character' && to.category === 'film') {
    return {
      shortLabel: '出处',
      description: `登场于《${to.title}》${to.year ? `（${to.year}）` : ''}`,
      sharedTags,
    };
  }

  // 4. Film -> Character
  if (from.category === 'film' && to.category === 'character') {
    if (to.portrayedBy?.trim()) {
      return {
        shortLabel: '角色',
        description: `片中角色 · ${formatPortrayedPhrase(to.portrayedBy)}`,
        sharedTags,
      };
    }
    const roleHint =
      to.characterProfile?.identity || compactSubtitle(to.subtitle, 12);
    return {
      shortLabel: '角色',
      description: roleHint ? `片中角色 · ${roleHint}` : '本片直接关联角色',
      sharedTags,
    };
  }

  // 5. Character -> Person
  if (from.category === 'character' && to.category === 'person') {
    const isPortrayer =
      normalizedIncludes(from.portrayedBy, to.title) ||
      (Boolean(to.originalTitle) &&
        normalizedIncludes(from.portrayedBy, to.originalTitle));
    if (isPortrayer) {
      const work = extractFirstWorkTitle(from.relatedWorkTitle);
      return {
        shortLabel: '饰演者',
        description: `由${to.title}饰演${work ? ` · 《${work}》` : ''}`,
        sharedTags,
      };
    }

    if (/导演|编剧|原著|作者|监制/.test(to.subtitle || '')) {
      return {
        shortLabel: '主创',
        description: `角色关联主创 · ${compactSubtitle(to.subtitle, 12)}`,
        sharedTags,
      };
    }

    return {
      shortLabel: '关联影人',
      description: `与影人${to.title}直接关联`,
      sharedTags,
    };
  }

  // 6. Person -> Character
  if (from.category === 'person' && to.category === 'character') {
    const isPortrayer =
      normalizedIncludes(to.portrayedBy, from.title) ||
      (Boolean(from.originalTitle) &&
        normalizedIncludes(to.portrayedBy, from.originalTitle));
    if (isPortrayer) {
      const work = extractFirstWorkTitle(to.relatedWorkTitle);
      return {
        shortLabel: '饰演',
        description: work ? `在《${work}》中饰演该角色` : '饰演该经典角色',
        sharedTags,
      };
    }

    if (/导演|编剧|原著|作者/.test(from.subtitle || '')) {
      const work = extractFirstWorkTitle(to.relatedWorkTitle);
      return {
        shortLabel: '塑造',
        description: work ? `参与塑造《${work}》角色` : '参与塑造该角色',
        sharedTags,
      };
    }

    return {
      shortLabel: '关联角色',
      description: `直接关联角色「${to.title}」`,
      sharedTags,
    };
  }

  // 7. Person -> Person
  if (from.category === 'person' && to.category === 'person') {
    const sharedFilms = findSharedConnectedItems(from, to, allItems, 'film');
    if (sharedFilms.length > 0) {
      const titles = sharedFilms
        .slice(0, 2)
        .map((f) => `《${f.title}》`)
        .join('、');
      return {
        shortLabel: '合作',
        description: `合作作品：${titles}`,
        sharedTags,
      };
    }
    return {
      shortLabel: '影人直连',
      description:
        sharedTags.length > 0
          ? `直接关联影人 · 共签「${sharedTags[0]}」`
          : '馆藏直接关联影人',
      sharedTags,
    };
  }

  // 8. Film -> Film
  if (from.category === 'film' && to.category === 'film') {
    const sharedPeople = findSharedConnectedItems(from, to, allItems, 'person');
    if (sharedPeople.length > 0) {
      return {
        shortLabel: '同主创',
        description: `共联影人「${sharedPeople[0].title}」${to.year ? ` · ${to.year}` : ''}`,
        sharedTags,
      };
    }
    return {
      shortLabel: '关联影片',
      description:
        sharedTags.length > 0
          ? `影片直连 · 共签「${sharedTags[0]}」`
          : `馆藏直连影视${to.year ? `（${to.year}）` : ''}`,
      sharedTags,
    };
  }

  // 9. Character -> Character
  const sharedFilms = findSharedConnectedItems(from, to, allItems, 'film');
  if (sharedFilms.length > 0) {
    return {
      shortLabel: '同部作品',
      description: `同出自《${sharedFilms[0].title}》`,
      sharedTags,
    };
  }
  const fromWork = extractFirstWorkTitle(from.relatedWorkTitle);
  const toWork = extractFirstWorkTitle(to.relatedWorkTitle);
  if (fromWork && toWork && fromWork.toLowerCase() === toWork.toLowerCase()) {
    return {
      shortLabel: '同部作品',
      description: `同出自《${fromWork}》`,
      sharedTags,
    };
  }

  return {
    shortLabel: '直连',
    description:
      sharedTags.length > 0
        ? `直接关联 · 共签「${sharedTags[0]}」`
        : '馆藏直接关联条目',
    sharedTags,
  };
}

const CATEGORY_ORDER: Record<ArchiveCategory, number> = {
  film: 0,
  person: 1,
  character: 2,
};

/**
 * Computes the highlighted neighborhood and human-readable relation explanations
 * for a clicked/focused node in the global relation constellation.
 */
export function getFocusedNodeConnections(
  graph: GlobalGraphModel,
  focusedId: string | null,
  allItems?: ArchiveItem[]
): FocusedNodeRelationContext | null {
  if (!focusedId) return null;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const focusedNode = nodeById.get(focusedId);
  if (!focusedNode) return null;

  const contextItems =
    allItems && allItems.length > 0 ? allItems : graph.nodes.map((n) => n.item);

  const directRelations: DirectRelationDetail[] = [];
  const tagRelations: DirectRelationDetail[] = [];
  const directNeighborIds = new Set<string>();
  const tagNeighborIds = new Set<string>();
  const edgeDetailById = new Map<string, DirectRelationDetail>();

  for (const edge of graph.edges) {
    if (edge.sourceId !== focusedId && edge.targetId !== focusedId) continue;
    const neighborId = edge.sourceId === focusedId ? edge.targetId : edge.sourceId;
    const neighborNode = nodeById.get(neighborId);
    if (!neighborNode) continue;

    const info = describeRelationBetween(
      focusedNode.item,
      neighborNode.item,
      contextItems,
      edge.kind,
      edge.label
    );

    const detail: DirectRelationDetail = {
      edgeId: edge.id,
      node: neighborNode,
      kind: edge.kind,
      shortLabel: info.shortLabel,
      description: info.description,
      sharedTags: info.sharedTags,
    };

    edgeDetailById.set(edge.id, detail);

    if (edge.kind === 'explicit') {
      directNeighborIds.add(neighborId);
      directRelations.push(detail);
    } else {
      tagNeighborIds.add(neighborId);
      tagRelations.push(detail);
    }
  }

  const sortRelations = (a: DirectRelationDetail, b: DirectRelationDetail) => {
    const catDiff =
      CATEGORY_ORDER[a.node.item.category] - CATEGORY_ORDER[b.node.item.category];
    if (catDiff !== 0) return catDiff;
    if (b.node.degree !== a.node.degree) return b.node.degree - a.node.degree;
    return a.node.item.accessionNo.localeCompare(b.node.item.accessionNo);
  };

  directRelations.sort(sortRelations);
  tagRelations.sort(sortRelations);

  return {
    focusedNode,
    directRelations,
    tagRelations,
    directNeighborIds,
    tagNeighborIds,
    edgeDetailById,
  };
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
