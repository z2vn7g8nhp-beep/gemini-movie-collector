import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { getRelatedItems } from './archive';
import { isThematicTag } from './medals';

export type RelationStrengthTier = 1 | 2 | 3;
export type NodeIntensityTier = 0 | 1 | 2 | 3;

export type GraphEdgeVisualState = 'idle' | 'highlighted' | 'second-hop' | 'dimmed';
export type GraphNodeFocusState =
  | 'idle'
  | 'focused'
  | 'direct-neighbor'
  | 'second-hop'
  | 'tag-neighbor'
  | 'dimmed';

export interface EdgeVisualStyle {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDasharray?: string;
  haloWidth: number;
  haloOpacity: number;
  haloColor: string;
}

export interface NodeVisualStyle {
  fill: string;
  stroke: string;
  textColor: string;
  dot: string;
  strokeWidth: number;
  auraRadiusOffset: number;
  auraStroke: string;
  auraOpacity: number;
}

export interface GlobalGraphNode {
  id: string;
  item: ArchiveItem;
  x: number;
  y: number;
  degree: number;
  tagDegree: number;
  weightedDegree: number;
  intensity: number;
  intensityTier: NodeIntensityTier;
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
  strength: RelationStrengthTier;
  strengthScore: number;
  strengthWeight: number;
  strengthLabel: string;
  mutualCount: number;
  sharedTagCount: number;
  sharedTags: string[];
  isBidirectional: boolean;
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
  maxStrengthScore: number;
  maxWeightedDegree: number;
}

export interface DirectRelationDetail {
  edgeId: string;
  node: GlobalGraphNode;
  kind: 'explicit' | 'tag';
  shortLabel: string;
  description: string;
  sharedTags: string[];
  strength: RelationStrengthTier;
  strengthScore: number;
  strengthWeight: number;
  strengthLabel: string;
  mutualCount: number;
}

export interface FocusedNodeRelationContext {
  focusedNode: GlobalGraphNode;
  directRelations: DirectRelationDetail[];
  tagRelations: DirectRelationDetail[];
  directNeighborIds: Set<string>;
  secondHopNeighborIds: Set<string>;
  secondHopEdgeIds: Set<string>;
  tagNeighborIds: Set<string>;
  depthByNodeId: Map<string, 0 | 1 | 2>;
  edgeDetailById: Map<string, DirectRelationDetail>;
  directStrengthByNodeId: Map<string, RelationStrengthTier>;
  tagStrengthByNodeId: Map<string, RelationStrengthTier>;
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

const NODE_TIER_PALETTE: Record<
  ArchiveCategory,
  Record<
    NodeIntensityTier,
    { fill: string; stroke: string; textColor: string; dot: string; auraStroke: string }
  >
> = {
  film: {
    0: {
      fill: '#431F1B',
      stroke: '#7A4D46',
      textColor: '#D4BDB9',
      dot: '#8E4940',
      auraStroke: '#9E483C',
    },
    1: {
      fill: '#6C251D',
      stroke: '#BA6E63',
      textColor: '#F5E8E6',
      dot: '#B4473A',
      auraStroke: '#C55547',
    },
    2: {
      fill: '#982E21',
      stroke: '#EA9F94',
      textColor: '#FFFFFF',
      dot: '#D14B3A',
      auraStroke: '#DF5A47',
    },
    3: {
      fill: '#CA3C28',
      stroke: '#FFE0DA',
      textColor: '#FFFFFF',
      dot: '#E85A45',
      auraStroke: '#F06A54',
    },
  },
  person: {
    0: {
      fill: '#473D28',
      stroke: '#7D6F51',
      textColor: '#D6CCB6',
      dot: '#8A7850',
      auraStroke: '#968259',
    },
    1: {
      fill: '#745F35',
      stroke: '#B59B65',
      textColor: '#FAF4E6',
      dot: '#AD8F51',
      auraStroke: '#C2A362',
    },
    2: {
      fill: '#A88642',
      stroke: '#E5CA8E',
      textColor: '#19150E',
      dot: '#CBA65B',
      auraStroke: '#D9B66B',
    },
    3: {
      fill: '#DBB768',
      stroke: '#FFF2CC',
      textColor: '#19150E',
      dot: '#E8C87A',
      auraStroke: '#F2D48A',
    },
  },
  character: {
    0: {
      fill: '#243832',
      stroke: '#4F6E64',
      textColor: '#BFD3CC',
      dot: '#4E7065',
      auraStroke: '#587F72',
    },
    1: {
      fill: '#33594D',
      stroke: '#75A394',
      textColor: '#ECF6F2',
      dot: '#5A8C7B',
      auraStroke: '#699F8D',
    },
    2: {
      fill: '#467D6B',
      stroke: '#A3D2C2',
      textColor: '#FFFFFF',
      dot: '#6BA894',
      auraStroke: '#7ABCA6',
    },
    3: {
      fill: '#66AD95',
      stroke: '#DDF7EE',
      textColor: '#101D18',
      dot: '#7CC4AB',
      auraStroke: '#8AD4BB',
    },
  },
};

/**
 * Maps an edge's relation strength and current interaction state to stroke thickness,
 * color richness, opacity, and subtle glow halo parameters.
 */
export function getEdgeVisualStyle(
  edge: Pick<GlobalGraphEdge, 'kind' | 'strength' | 'strengthWeight'>,
  state: GraphEdgeVisualState
): EdgeVisualStyle {
  const isExplicit = edge.kind === 'explicit';
  const weightBonus = Math.max(0, Math.min(1, edge.strengthWeight)) * 0.45;

  if (state === 'highlighted') {
    if (isExplicit) {
      if (edge.strength === 3) {
        return {
          stroke: '#F5D688',
          strokeWidth: +(3.9 + weightBonus).toFixed(2),
          strokeOpacity: 0.98,
          haloWidth: 9.5,
          haloOpacity: 0.24,
          haloColor: '#E8C472',
        };
      }
      if (edge.strength === 2) {
        return {
          stroke: '#E4C37A',
          strokeWidth: +(2.45 + weightBonus * 0.6).toFixed(2),
          strokeOpacity: 0.9,
          haloWidth: 6.2,
          haloOpacity: 0.15,
          haloColor: '#D4AF6A',
        };
      }
      return {
        stroke: '#C4AA75',
        strokeWidth: 1.5,
        strokeOpacity: 0.74,
        haloWidth: 4.0,
        haloOpacity: 0.09,
        haloColor: '#B89D68',
      };
    }
    // Tag edge highlighted
    if (edge.strength >= 2) {
      return {
        stroke: '#E2D6BE',
        strokeWidth: 1.85,
        strokeOpacity: 0.74,
        strokeDasharray: '5 3',
        haloWidth: 0,
        haloOpacity: 0,
        haloColor: 'transparent',
      };
    }
    return {
      stroke: '#CFC7B9',
      strokeWidth: 1.15,
      strokeOpacity: 0.48,
      strokeDasharray: '3 4',
      haloWidth: 0,
      haloOpacity: 0,
      haloColor: 'transparent',
    };
  }

  if (state === 'second-hop') {
    const baseW = isExplicit
      ? edge.strength === 3
        ? 1.9
        : edge.strength === 2
          ? 1.45
          : 1.1
      : 1.0;
    return {
      stroke: isExplicit ? '#D4AF6A' : '#CFC7B9',
      strokeWidth: baseW,
      strokeOpacity: isExplicit ? (edge.strength === 3 ? 0.44 : 0.32) : 0.2,
      strokeDasharray: isExplicit ? '5 3' : '2 4',
      haloWidth: 0,
      haloOpacity: 0,
      haloColor: 'transparent',
    };
  }

  if (state === 'dimmed') {
    const baseW = isExplicit
      ? edge.strength === 3
        ? 1.55
        : edge.strength === 2
          ? 1.1
          : 0.85
      : 0.85;
    return {
      stroke: isExplicit ? '#D4AF6A' : '#CFC7B9',
      strokeWidth: baseW,
      strokeOpacity: isExplicit ? (edge.strength === 3 ? 0.2 : 0.12) : 0.07,
      strokeDasharray: isExplicit ? undefined : '3 4',
      haloWidth: 0,
      haloOpacity: 0,
      haloColor: 'transparent',
    };
  }

  // Idle / panoramic state — full strength hierarchy across the entire constellation
  if (isExplicit) {
    if (edge.strength === 3) {
      return {
        stroke: '#F0CC7A',
        strokeWidth: +(3.35 + weightBonus).toFixed(2),
        strokeOpacity: 0.94,
        haloWidth: 7.5,
        haloOpacity: 0.14,
        haloColor: '#D4AF6A',
      };
    }
    if (edge.strength === 2) {
      return {
        stroke: '#D4AF6A',
        strokeWidth: +(2.05 + weightBonus * 0.5).toFixed(2),
        strokeOpacity: 0.72,
        haloWidth: 0,
        haloOpacity: 0,
        haloColor: 'transparent',
      };
    }
    return {
      stroke: '#AE9568',
      strokeWidth: 1.25,
      strokeOpacity: 0.48,
      haloWidth: 0,
      haloOpacity: 0,
      haloColor: 'transparent',
    };
  }

  if (edge.strength >= 2) {
    return {
      stroke: '#DDD2BC',
      strokeWidth: 1.55,
      strokeOpacity: 0.46,
      strokeDasharray: '5 3',
      haloWidth: 0,
      haloOpacity: 0,
      haloColor: 'transparent',
    };
  }

  return {
    stroke: '#CFC7B9',
    strokeWidth: 0.95,
    strokeOpacity: 0.26,
    strokeDasharray: '3 4',
    haloWidth: 0,
    haloOpacity: 0,
    haloColor: 'transparent',
  };
}

/**
 * Returns the color depth, border weight, text contrast color, and subtle aura ring
 * for a constellation node based on its category, intensity tier, and focus state.
 */
export function getNodeVisualStyle(
  category: ArchiveCategory,
  tier: NodeIntensityTier,
  focusState: GraphNodeFocusState = 'idle'
): NodeVisualStyle {
  const palette = NODE_TIER_PALETTE[category][tier];
  const isFocused = focusState === 'focused';
  const isDirect = focusState === 'direct-neighbor';
  const showAura =
    (focusState === 'idle' && tier === 3) ||
    (isDirect && tier === 3);

  return {
    fill: palette.fill,
    stroke: isFocused
      ? '#FFFFFF'
      : isDirect
        ? tier === 3
          ? '#FFF4D4'
          : '#FAF7F0'
        : palette.stroke,
    textColor: palette.textColor,
    dot: palette.dot,
    strokeWidth: isFocused
      ? 2.7
      : isDirect
        ? tier === 3
          ? 2.3
          : tier === 2
            ? 1.9
            : 1.5
        : tier === 3
          ? 2.0
          : tier === 2
            ? 1.6
            : tier === 1
              ? 1.3
              : 1.0,
    auraRadiusOffset: showAura ? 5 : 0,
    auraStroke: palette.auraStroke,
    auraOpacity: showAura ? (isDirect ? 0.45 : 0.34) : 0,
  };
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
  const secondHopNeighborIds = new Set<string>();
  const secondHopEdgeIds = new Set<string>();
  const tagNeighborIds = new Set<string>();
  const depthByNodeId = new Map<string, 0 | 1 | 2>([[focusedId, 0]]);
  const edgeDetailById = new Map<string, DirectRelationDetail>();
  const directStrengthByNodeId = new Map<string, RelationStrengthTier>();
  const tagStrengthByNodeId = new Map<string, RelationStrengthTier>();

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
      strength: edge.strength,
      strengthScore: edge.strengthScore,
      strengthWeight: edge.strengthWeight,
      strengthLabel: edge.strengthLabel,
      mutualCount: edge.mutualCount,
    };

    edgeDetailById.set(edge.id, detail);

    if (edge.kind === 'explicit') {
      directNeighborIds.add(neighborId);
      depthByNodeId.set(neighborId, 1);
      directStrengthByNodeId.set(neighborId, edge.strength);
      directRelations.push(detail);
    } else {
      tagNeighborIds.add(neighborId);
      tagStrengthByNodeId.set(neighborId, edge.strength);
      tagRelations.push(detail);
    }
  }

  // Discover 2-hop extended neighbors via explicit edges from 1-hop direct neighbors
  for (const edge of graph.edges) {
    if (edge.kind !== 'explicit') continue;
    const srcIsDirect = directNeighborIds.has(edge.sourceId);
    const dstIsDirect = directNeighborIds.has(edge.targetId);
    if (srcIsDirect && edge.targetId !== focusedId && !directNeighborIds.has(edge.targetId)) {
      secondHopNeighborIds.add(edge.targetId);
      secondHopEdgeIds.add(edge.id);
      if (!depthByNodeId.has(edge.targetId)) {
        depthByNodeId.set(edge.targetId, 2);
      }
    } else if (
      dstIsDirect &&
      edge.sourceId !== focusedId &&
      !directNeighborIds.has(edge.sourceId)
    ) {
      secondHopNeighborIds.add(edge.sourceId);
      secondHopEdgeIds.add(edge.id);
      if (!depthByNodeId.has(edge.sourceId)) {
        depthByNodeId.set(edge.sourceId, 2);
      }
    }
  }

  const sortRelations = (a: DirectRelationDetail, b: DirectRelationDetail) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    if (b.strengthScore !== a.strengthScore) return b.strengthScore - a.strengthScore;
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
    secondHopNeighborIds,
    secondHopEdgeIds,
    tagNeighborIds,
    depthByNodeId,
    edgeDetailById,
    directStrengthByNodeId,
    tagStrengthByNodeId,
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
  const itemById = new Map(baseItems.map((it) => [it.id, it]));
  const rawExplicitPairs: Array<{ sourceId: string; targetId: string; key: string }> = [];
  const seenEdges = new Set<string>();
  const degreeMap = new Map<string, number>();
  const tagDegreeMap = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const item of baseItems) {
    degreeMap.set(item.id, 0);
    tagDegreeMap.set(item.id, 0);
    adjacency.set(item.id, new Set());
  }

  for (const item of baseItems) {
    const related = getRelatedItems(item, baseItems);
    for (const rel of related) {
      if (!visibleIdSet.has(rel.id) || rel.id === item.id) continue;
      const key = pairKey(item.id, rel.id);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      rawExplicitPairs.push({ sourceId: item.id, targetId: rel.id, key });
      degreeMap.set(item.id, (degreeMap.get(item.id) ?? 0) + 1);
      degreeMap.set(rel.id, (degreeMap.get(rel.id) ?? 0) + 1);
      adjacency.get(item.id)?.add(rel.id);
      adjacency.get(rel.id)?.add(item.id);
    }
  }

  // Score explicit edges based on mutual neighbors (cluster depth/frequency),
  // shared thematic tags, and bidirectionality
  const edges: GlobalGraphEdge[] = [];
  for (const pair of rawExplicitPairs) {
    const itemA = itemById.get(pair.sourceId)!;
    const itemB = itemById.get(pair.targetId)!;
    const adjA = adjacency.get(pair.sourceId) ?? new Set<string>();
    const adjB = adjacency.get(pair.targetId) ?? new Set<string>();
    let mutualCount = 0;
    for (const neighborId of adjA) {
      if (neighborId !== pair.targetId && adjB.has(neighborId)) {
        mutualCount += 1;
      }
    }
    const sharedTags = getSharedThematicTags(itemA, itemB);
    const sharedTagCount = sharedTags.length;
    const isBidirectional =
      itemA.relatedIds.includes(itemB.id) && itemB.relatedIds.includes(itemA.id);

    const strengthScore =
      2 +
      (isBidirectional ? 1 : 0) +
      Math.min(6, mutualCount * 2) +
      Math.min(3, sharedTagCount * 1.25);

    const strength: RelationStrengthTier =
      mutualCount >= 2 ||
      (mutualCount >= 1 && sharedTagCount >= 1) ||
      sharedTagCount >= 2
        ? 3
        : mutualCount >= 1 || sharedTagCount >= 1
          ? 2
          : 1;

    const strengthLabel =
      strength === 3 ? '核心强连' : strength === 2 ? '稳固直连' : '轻度直连';

    edges.push({
      id: `exp-${pair.key}`,
      sourceId: pair.sourceId,
      targetId: pair.targetId,
      kind: 'explicit',
      strength,
      strengthScore,
      strengthWeight: 0, // normalized below
      strengthLabel,
      mutualCount,
      sharedTagCount,
      sharedTags,
      isBidirectional,
    });
  }

  // Optional subtle tag chords (capped to keep constellation legible, prioritizing richer tag overlaps)
  let tagEdgeCount = 0;
  if (includeTagEdges && baseItems.length <= 45) {
    const tagCandidates: Array<{
      a: ArchiveItem;
      b: ArchiveItem;
      key: string;
      sharedTags: string[];
    }> = [];
    for (let i = 0; i < baseItems.length; i += 1) {
      for (let j = i + 1; j < baseItems.length; j += 1) {
        const a = baseItems[i];
        const b = baseItems[j];
        const key = pairKey(a.id, b.id);
        if (seenEdges.has(key)) continue;
        const sharedTags = getSharedThematicTags(a, b);
        if (sharedTags.length === 0) continue;
        tagCandidates.push({ a, b, key, sharedTags });
      }
    }
    tagCandidates.sort((x, y) => y.sharedTags.length - x.sharedTags.length);

    for (const cand of tagCandidates) {
      if (tagEdgeCount >= 36) break;
      if (seenEdges.has(cand.key)) continue;
      seenEdges.add(cand.key);
      const sharedTagCount = cand.sharedTags.length;
      const strength: RelationStrengthTier = sharedTagCount >= 2 ? 2 : 1;
      const strengthScore = 1 + Math.min(3, (sharedTagCount - 1) * 1.2);
      edges.push({
        id: `tag-${cand.key}`,
        sourceId: cand.a.id,
        targetId: cand.b.id,
        kind: 'tag',
        label: cand.sharedTags[0],
        strength,
        strengthScore,
        strengthWeight: 0,
        strengthLabel: sharedTagCount >= 2 ? '多重共签' : '共签延伸',
        mutualCount: 0,
        sharedTagCount,
        sharedTags: cand.sharedTags,
        isBidirectional: false,
      });
      tagDegreeMap.set(cand.a.id, (tagDegreeMap.get(cand.a.id) ?? 0) + 1);
      tagDegreeMap.set(cand.b.id, (tagDegreeMap.get(cand.b.id) ?? 0) + 1);
      tagEdgeCount += 1;
    }
  }

  const maxStrengthScore = Math.max(
    1,
    ...edges.map((e) => e.strengthScore)
  );
  for (const edge of edges) {
    edge.strengthWeight = Number(
      Math.min(1, edge.strengthScore / maxStrengthScore).toFixed(3)
    );
  }

  // Compute weighted degree (connection frequency + tie strength) per node
  const weightedDegreeMap = new Map<string, number>();
  for (const item of baseItems) weightedDegreeMap.set(item.id, 0);
  for (const edge of edges) {
    const contrib = edge.kind === 'explicit' ? edge.strengthScore : edge.strengthScore * 0.3;
    weightedDegreeMap.set(
      edge.sourceId,
      (weightedDegreeMap.get(edge.sourceId) ?? 0) + contrib
    );
    weightedDegreeMap.set(
      edge.targetId,
      (weightedDegreeMap.get(edge.targetId) ?? 0) + contrib
    );
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
  const maxWeightedDegree = Math.max(
    1,
    ...targetItems.map((it) => weightedDegreeMap.get(it.id) ?? 0)
  );

  for (const item of targetItems) {
    const deg = degreeMap.get(item.id) ?? 0;
    const tagDeg = tagDegreeMap.get(item.id) ?? 0;
    const wDeg = Number((weightedDegreeMap.get(item.id) ?? 0).toFixed(2));
    const intensity =
      deg === 0 && tagDeg === 0
        ? 0
        : Number(Math.min(1, wDeg / maxWeightedDegree).toFixed(3));
    const isHub = deg >= hubThreshold && deg > 0;
    const intensityTier: NodeIntensityTier =
      deg === 0
        ? 0
        : isHub && (intensity >= 0.78 || deg >= maxDegree)
          ? 3
          : deg >= 2 || intensity >= 0.45
            ? 2
            : 1;
    const pos = posById.get(item.id) ?? { x: CX, y: CY };
    const radius =
      deg === 0 ? 14.5 : Math.min(26, 15.5 + deg * 2.2 + intensity * 3);
    nodes.push({
      id: item.id,
      item,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      degree: deg,
      tagDegree: tagDeg,
      weightedDegree: wDeg,
      intensity,
      intensityTier,
      radius: Number(radius.toFixed(1)),
      isHub,
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
    .sort(
      (a, b) =>
        b.weightedDegree - a.weightedDegree ||
        b.degree - a.degree ||
        a.item.accessionNo.localeCompare(b.item.accessionNo)
    )
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
    maxStrengthScore,
    maxWeightedDegree: Number(maxWeightedDegree.toFixed(2)),
  };
}
