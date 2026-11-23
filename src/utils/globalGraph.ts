import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { getRelatedItems } from './archive';
import {
  buildCategoryBridgeEdges,
  discoverMetadataFilmographyLinks,
  mergeInferredFilmographyEdges,
  type FilmographyRoleType,
  type InferredFilmographyEdge,
} from './filmographyInference';
import { isThematicTag } from './medals';

export type RelationStrengthTier = 1 | 2 | 3;
export type NodeIntensityTier = 0 | 1 | 2 | 3;

export type GraphEdgeKind = 'explicit' | 'inferred' | 'tag';
export type GraphEdgeVisualState =
  | 'idle'
  | 'highlighted'
  | 'second-hop'
  | 'path'
  | 'dimmed';
export type GraphNodeFocusState =
  | 'idle'
  | 'focused'
  | 'direct-neighbor'
  | 'second-hop'
  | 'tag-neighbor'
  | 'path-node'
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
  explicitDegree: number;
  inferredDegree: number;
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
  kind: GraphEdgeKind;
  label?: string;
  roleType?: FilmographyRoleType;
  roleCharacterName?: string;
  bridgeTitle?: string;
  evidence?: string;
  inferenceSource?: InferredFilmographyEdge['source'];
  isPersistable?: boolean;
  strength: RelationStrengthTier;
  strengthScore: number;
  strengthWeight: number;
  strengthLabel: string;
  mutualCount: number;
  sharedTagCount: number;
  sharedTags: string[];
  isBidirectional: boolean;
}

export interface GraphCluster {
  index: number;
  hubId: string;
  title: string;
  nodeIds: string[];
  edgeCount: number;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface GlobalGraphModel {
  width: number;
  height: number;
  nodes: GlobalGraphNode[];
  edges: GlobalGraphEdge[];
  hubs: GlobalGraphNode[];
  isolatedNodes: GlobalGraphNode[];
  clusters: GraphCluster[];
  explicitEdgeCount: number;
  inferredEdgeCount: number;
  tagEdgeCount: number;
  unlinkedAutoPairs: Array<[string, string]>;
  maxStrengthScore: number;
  maxWeightedDegree: number;
}

export interface DirectRelationDetail {
  edgeId: string;
  node: GlobalGraphNode;
  kind: GraphEdgeKind;
  shortLabel: string;
  description: string;
  evidence?: string;
  isPersistable?: boolean;
  sharedTags: string[];
  strength: RelationStrengthTier;
  strengthScore: number;
  strengthWeight: number;
  strengthLabel: string;
  mutualCount: number;
}

export interface SecondHopRelationDetail {
  node: GlobalGraphNode;
  viaNodes: GlobalGraphNode[];
  viaEdgeIds: string[];
  bridgeSummary: string;
  strength: RelationStrengthTier;
}

export interface FocusedNodeRelationContext {
  focusedNode: GlobalGraphNode;
  directRelations: DirectRelationDetail[];
  secondHopRelations: SecondHopRelationDetail[];
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

export interface GraphPathStep {
  fromNode: GlobalGraphNode;
  toNode: GlobalGraphNode;
  edge: GlobalGraphEdge;
  shortLabel: string;
  description: string;
}

export interface GraphPathResult {
  startId: string;
  endId: string;
  nodeIds: string[];
  edgeIds: string[];
  steps: GraphPathStep[];
  hopCount: number;
  usesTagBridge: boolean;
}

export interface CurvedEdgeGeometry {
  pathD: string;
  ctrlX: number;
  ctrlY: number;
  midX: number;
  midY: number;
}

const DEFAULT_CANVAS_W = 860;
const DEFAULT_CANVAS_H = 520;

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
 * Maps an edge's relation kind, strength, and interaction state to stroke thickness,
 * color richness, dash cadence, opacity, and subtle glow halo parameters.
 */
export function getEdgeVisualStyle(
  edge: Pick<GlobalGraphEdge, 'kind' | 'strength' | 'strengthWeight'>,
  state: GraphEdgeVisualState
): EdgeVisualStyle {
  const isExplicit = edge.kind === 'explicit';
  const isInferred = edge.kind === 'inferred';
  const weightBonus = Math.max(0, Math.min(1, edge.strengthWeight)) * 0.45;

  if (state === 'path') {
    return {
      stroke: '#F4896B',
      strokeWidth: 3.8,
      strokeOpacity: 0.98,
      strokeDasharray: isInferred ? '7 3' : edge.kind === 'tag' ? '3 3' : undefined,
      haloWidth: 10.5,
      haloOpacity: 0.3,
      haloColor: '#E8634E',
    };
  }

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

    if (isInferred) {
      if (edge.strength === 3) {
        return {
          stroke: '#96DBC3',
          strokeWidth: +(3.1 + weightBonus * 0.6).toFixed(2),
          strokeOpacity: 0.95,
          strokeDasharray: '7 3',
          haloWidth: 8.0,
          haloOpacity: 0.2,
          haloColor: '#6EBFA5',
        };
      }
      if (edge.strength === 2) {
        return {
          stroke: '#7CC6AE',
          strokeWidth: +(2.2 + weightBonus * 0.4).toFixed(2),
          strokeOpacity: 0.88,
          strokeDasharray: '6 3',
          haloWidth: 5.2,
          haloOpacity: 0.13,
          haloColor: '#5DA88F',
        };
      }
      return {
        stroke: '#6AA893',
        strokeWidth: 1.65,
        strokeOpacity: 0.76,
        strokeDasharray: '5 3',
        haloWidth: 0,
        haloOpacity: 0,
        haloColor: 'transparent',
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
    const baseW =
      isExplicit || isInferred
        ? edge.strength === 3
          ? 1.9
          : edge.strength === 2
            ? 1.45
            : 1.1
        : 1.0;
    return {
      stroke: isExplicit ? '#D4AF6A' : isInferred ? '#7CC6AE' : '#CFC7B9',
      strokeWidth: baseW,
      strokeOpacity:
        isExplicit || isInferred
          ? edge.strength === 3
            ? 0.44
            : 0.32
          : 0.2,
      strokeDasharray: isExplicit ? '5 3' : isInferred ? '4 3' : '2 4',
      haloWidth: 0,
      haloOpacity: 0,
      haloColor: 'transparent',
    };
  }

  if (state === 'dimmed') {
    const baseW =
      isExplicit || isInferred
        ? edge.strength === 3
          ? 1.55
          : edge.strength === 2
            ? 1.1
            : 0.85
        : 0.85;
    return {
      stroke: isExplicit ? '#D4AF6A' : isInferred ? '#6EBFA5' : '#CFC7B9',
      strokeWidth: baseW,
      strokeOpacity: isExplicit
        ? edge.strength === 3
          ? 0.2
          : 0.12
        : isInferred
          ? 0.14
          : 0.07,
      strokeDasharray: isExplicit ? undefined : isInferred ? '5 3' : '3 4',
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

  if (isInferred) {
    if (edge.strength === 3) {
      return {
        stroke: '#86D1B8',
        strokeWidth: +(2.55 + weightBonus * 0.5).toFixed(2),
        strokeOpacity: 0.84,
        strokeDasharray: '6 3',
        haloWidth: 5.8,
        haloOpacity: 0.12,
        haloColor: '#6EBFA5',
      };
    }
    if (edge.strength === 2) {
      return {
        stroke: '#72BBA3',
        strokeWidth: +(1.85 + weightBonus * 0.35).toFixed(2),
        strokeOpacity: 0.68,
        strokeDasharray: '6 3',
        haloWidth: 0,
        haloOpacity: 0,
        haloColor: 'transparent',
      };
    }
    return {
      stroke: '#5E9E89',
      strokeWidth: 1.35,
      strokeOpacity: 0.52,
      strokeDasharray: '5 3.5',
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
  const isPathNode = focusState === 'path-node';
  const showAura =
    (focusState === 'idle' && tier === 3) ||
    (isDirect && tier === 3) ||
    isPathNode;

  return {
    fill: palette.fill,
    stroke: isFocused
      ? '#FFFFFF'
      : isPathNode
        ? '#F9B49F'
        : isDirect
          ? tier === 3
            ? '#FFF4D4'
            : '#FAF7F0'
          : palette.stroke,
    textColor: palette.textColor,
    dot: palette.dot,
    strokeWidth: isFocused
      ? 2.7
      : isPathNode
        ? 2.5
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
    auraStroke: isPathNode ? '#F4896B' : palette.auraStroke,
    auraOpacity: showAura ? (isPathNode ? 0.52 : isDirect ? 0.45 : 0.34) : 0,
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
      normalizedIncludes(cand.relatedWorkTitle, film.title) ||
      (Boolean(film.originalTitle) &&
        normalizedIncludes(cand.relatedWorkTitle, film.originalTitle));
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

export interface InferredDescribeMeta {
  roleType?: FilmographyRoleType;
  roleCharacterName?: string;
  bridgeTitle?: string;
  evidence?: string;
}

/**
 * Generates a concise, direction-aware label and brief explanation describing
 * why `from` is related to `to` inside the collection knowledge graph.
 */
export function describeRelationBetween(
  from: ArchiveItem,
  to: ArchiveItem,
  allItems: ArchiveItem[],
  kind: GraphEdgeKind = 'explicit',
  tagLabel?: string,
  inferredMeta?: InferredDescribeMeta
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

  // Enrich with specific credit/inferred metadata when available
  if (inferredMeta?.roleType === 'writes') {
    if (from.category === 'film' && to.category === 'person') {
      return {
        shortLabel: '编剧',
        description: `本片编剧${from.year ? `（${from.year}）` : ''}`,
        sharedTags,
      };
    }
    if (from.category === 'person' && to.category === 'film') {
      return {
        shortLabel: '编剧',
        description: `担任《${to.title}》编剧${to.year ? `（${to.year}）` : ''}`,
        sharedTags,
      };
    }
  }

  if (inferredMeta?.roleCharacterName) {
    if (from.category === 'film' && to.category === 'person') {
      return {
        shortLabel: '主演',
        description: `参演本片 · 饰演角色「${inferredMeta.roleCharacterName}」`,
        sharedTags,
      };
    }
    if (from.category === 'person' && to.category === 'film') {
      return {
        shortLabel: '主演',
        description: `参演作品 · 饰演「${inferredMeta.roleCharacterName}」${to.year ? `（${to.year}）` : ''}`,
        sharedTags,
      };
    }
  }

  if (inferredMeta?.roleType === 'co_stars' && from.category === 'person' && to.category === 'person') {
    return {
      shortLabel: '合作',
      description: inferredMeta.bridgeTitle
        ? `合作作品：《${inferredMeta.bridgeTitle}》`
        : inferredMeta.evidence || '共同参演 / 合作影人',
      sharedTags,
    };
  }

  if (inferredMeta?.roleType === 'same_creator' && from.category === 'film' && to.category === 'film') {
    return {
      shortLabel: '同主创',
      description: inferredMeta.bridgeTitle
        ? `共联主创「${inferredMeta.bridgeTitle}」${to.year ? ` · ${to.year}` : ''}`
        : inferredMeta.evidence || '同主创作品脉络',
      sharedTags,
    };
  }

  if (inferredMeta?.roleType === 'co_work' && from.category === 'character' && to.category === 'character') {
    return {
      shortLabel: '同部作品',
      description: inferredMeta.bridgeTitle
        ? `同出自《${inferredMeta.bridgeTitle}》`
        : inferredMeta.evidence || '同部作品角色',
      sharedTags,
    };
  }

  // 1. Film -> Person
  if (from.category === 'film' && to.category === 'person') {
    const sub = to.subtitle || '';
    const isDirector =
      inferredMeta?.roleType === 'directs' ||
      (/导演|编导|监督/.test(sub) &&
        (normalizedIncludes(from.subtitle, to.title) || !/演员|主演/.test(sub)));
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
      inferredMeta?.roleType === 'directs' ||
      (/导演|编导|监督/.test(sub) &&
        (normalizedIncludes(to.subtitle, from.title) || !/演员|主演/.test(sub)));
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
      inferredMeta?.roleType === 'portrays' ||
      normalizedIncludes(from.portrayedBy, to.title) ||
      (Boolean(to.originalTitle) &&
        normalizedIncludes(from.portrayedBy, to.originalTitle));
    if (isPortrayer) {
      const work =
        extractFirstWorkTitle(from.relatedWorkTitle) || inferredMeta?.bridgeTitle || '';
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
      inferredMeta?.roleType === 'portrays' ||
      normalizedIncludes(to.portrayedBy, from.title) ||
      (Boolean(from.originalTitle) &&
        normalizedIncludes(to.portrayedBy, from.originalTitle));
    if (isPortrayer) {
      const work =
        extractFirstWorkTitle(to.relatedWorkTitle) || inferredMeta?.bridgeTitle || '';
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

function isFilmographyEdge(edge: GlobalGraphEdge): boolean {
  return edge.kind === 'explicit' || edge.kind === 'inferred';
}

/**
 * Computes the highlighted neighborhood, 2-hop filmography bridges, and
 * human-readable relation explanations for a focused node.
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
      edge.label,
      edge.kind === 'inferred'
        ? {
            roleType: edge.roleType,
            roleCharacterName: edge.roleCharacterName,
            bridgeTitle: edge.bridgeTitle,
            evidence: edge.evidence,
          }
        : undefined
    );

    const detail: DirectRelationDetail = {
      edgeId: edge.id,
      node: neighborNode,
      kind: edge.kind,
      shortLabel: info.shortLabel,
      description: info.description,
      evidence: edge.evidence,
      isPersistable: edge.isPersistable,
      sharedTags: info.sharedTags,
      strength: edge.strength,
      strengthScore: edge.strengthScore,
      strengthWeight: edge.strengthWeight,
      strengthLabel: edge.strengthLabel,
      mutualCount: edge.mutualCount,
    };

    edgeDetailById.set(edge.id, detail);

    if (isFilmographyEdge(edge)) {
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

  // Discover 2-hop extended neighbors via explicit + inferred edges from 1-hop direct neighbors
  const secondHopBridgeMap = new Map<
    string,
    { viaNodeIds: Set<string>; viaEdgeIds: Set<string>; maxStrength: RelationStrengthTier }
  >();

  for (const edge of graph.edges) {
    if (!isFilmographyEdge(edge)) continue;
    const srcIsDirect = directNeighborIds.has(edge.sourceId);
    const dstIsDirect = directNeighborIds.has(edge.targetId);

    let bridgeId: string | null = null;
    let secondId: string | null = null;

    if (srcIsDirect && edge.targetId !== focusedId && !directNeighborIds.has(edge.targetId)) {
      bridgeId = edge.sourceId;
      secondId = edge.targetId;
    } else if (
      dstIsDirect &&
      edge.sourceId !== focusedId &&
      !directNeighborIds.has(edge.sourceId)
    ) {
      bridgeId = edge.targetId;
      secondId = edge.sourceId;
    }

    if (!bridgeId || !secondId) continue;

    secondHopNeighborIds.add(secondId);
    secondHopEdgeIds.add(edge.id);
    if (!depthByNodeId.has(secondId)) {
      depthByNodeId.set(secondId, 2);
    }

    const bucket = secondHopBridgeMap.get(secondId) ?? {
      viaNodeIds: new Set<string>(),
      viaEdgeIds: new Set<string>(),
      maxStrength: 1 as RelationStrengthTier,
    };
    bucket.viaNodeIds.add(bridgeId);
    bucket.viaEdgeIds.add(edge.id);
    if (edge.strength > bucket.maxStrength) {
      bucket.maxStrength = edge.strength;
    }
    secondHopBridgeMap.set(secondId, bucket);
  }

  const secondHopRelations: SecondHopRelationDetail[] = [];
  for (const [secondId, meta] of secondHopBridgeMap.entries()) {
    const node = nodeById.get(secondId);
    if (!node) continue;
    const viaNodes = Array.from(meta.viaNodeIds)
      .map((id) => nodeById.get(id))
      .filter((n): n is GlobalGraphNode => Boolean(n))
      .sort((a, b) => b.degree - a.degree);

    const firstVia = viaNodes[0];
    const formattedFirst =
      firstVia?.item.category === 'film'
        ? `《${firstVia.item.title}》`
        : `「${firstVia?.item.title || ''}」`;
    const bridgeSummary =
      viaNodes.length > 1
        ? `经由 ${formattedFirst} 等 ${viaNodes.length} 项延伸`
        : `经由 ${formattedFirst} 延伸`;

    secondHopRelations.push({
      node,
      viaNodes,
      viaEdgeIds: Array.from(meta.viaEdgeIds),
      bridgeSummary,
      strength: viaNodes.length >= 2 ? 3 : meta.maxStrength,
    });
  }

  secondHopRelations.sort((a, b) => {
    if (b.viaNodes.length !== a.viaNodes.length) {
      return b.viaNodes.length - a.viaNodes.length;
    }
    if (b.strength !== a.strength) return b.strength - a.strength;
    if (b.node.degree !== a.node.degree) return b.node.degree - a.node.degree;
    return a.node.item.accessionNo.localeCompare(b.node.item.accessionNo);
  });

  const sortRelations = (a: DirectRelationDetail, b: DirectRelationDetail) => {
    if (a.kind !== b.kind) {
      if (a.kind === 'explicit') return -1;
      if (b.kind === 'explicit') return 1;
    }
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
    secondHopRelations,
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
 * Finds the shortest filmography path between two nodes via BFS.
 * Prefers explicit + auto-discovered filmography edges; optionally falls back to tag chords.
 */
export function findShortestGraphPath(
  graph: GlobalGraphModel,
  startId: string,
  endId: string,
  allItems?: ArchiveItem[],
  options: { allowTagFallback?: boolean } = {}
): GraphPathResult | null {
  if (!startId || !endId || startId === endId) return null;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodeById.has(startId) || !nodeById.has(endId)) return null;

  const contextItems =
    allItems && allItems.length > 0 ? allItems : graph.nodes.map((n) => n.item);

  const runBfs = (includeTags: boolean): { nodeIds: string[]; edges: GlobalGraphEdge[] } | null => {
    const adj = new Map<string, Array<{ nextId: string; edge: GlobalGraphEdge }>>();
    for (const node of graph.nodes) adj.set(node.id, []);
    for (const edge of graph.edges) {
      if (!includeTags && edge.kind === 'tag') continue;
      adj.get(edge.sourceId)?.push({ nextId: edge.targetId, edge });
      adj.get(edge.targetId)?.push({ nextId: edge.sourceId, edge });
    }
    // Prefer stronger / explicit edges first at equal hop distance
    for (const list of adj.values()) {
      list.sort((a, b) => {
        const kindRank = (k: GraphEdgeKind) => (k === 'explicit' ? 2 : k === 'inferred' ? 1 : 0);
        if (kindRank(b.edge.kind) !== kindRank(a.edge.kind)) {
          return kindRank(b.edge.kind) - kindRank(a.edge.kind);
        }
        return b.edge.strengthScore - a.edge.strengthScore;
      });
    }

    const visited = new Set<string>([startId]);
    const prev = new Map<string, { parentId: string; edge: GlobalGraphEdge }>();
    const queue: string[] = [startId];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === endId) break;
      for (const { nextId, edge } of adj.get(curr) ?? []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        prev.set(nextId, { parentId: curr, edge });
        queue.push(nextId);
      }
    }

    if (!visited.has(endId)) return null;

    const nodeIds: string[] = [];
    const edges: GlobalGraphEdge[] = [];
    let cursor = endId;
    while (cursor !== startId) {
      nodeIds.push(cursor);
      const link = prev.get(cursor);
      if (!link) return null;
      edges.push(link.edge);
      cursor = link.parentId;
    }
    nodeIds.push(startId);
    nodeIds.reverse();
    edges.reverse();
    return { nodeIds, edges };
  };

  let raw = runBfs(false);
  let usesTagBridge = false;
  if (!raw && (options.allowTagFallback ?? true)) {
    raw = runBfs(true);
    if (raw) {
      usesTagBridge = raw.edges.some((e) => e.kind === 'tag');
    }
  }
  if (!raw) return null;

  const steps: GraphPathStep[] = [];
  for (let i = 0; i < raw.edges.length; i += 1) {
    const fromNode = nodeById.get(raw.nodeIds[i])!;
    const toNode = nodeById.get(raw.nodeIds[i + 1])!;
    const edge = raw.edges[i];
    const desc = describeRelationBetween(
      fromNode.item,
      toNode.item,
      contextItems,
      edge.kind,
      edge.label,
      edge.kind === 'inferred'
        ? {
            roleType: edge.roleType,
            roleCharacterName: edge.roleCharacterName,
            bridgeTitle: edge.bridgeTitle,
            evidence: edge.evidence,
          }
        : undefined
    );
    steps.push({
      fromNode,
      toNode,
      edge,
      shortLabel: desc.shortLabel,
      description: desc.description,
    });
  }

  return {
    startId,
    endId,
    nodeIds: raw.nodeIds,
    edgeIds: raw.edges.map((e) => e.id),
    steps,
    hopCount: steps.length,
    usesTagBridge,
  };
}

/**
 * Computes a gentle quadratic Bezier path between two nodes and returns its
 * exact curve midpoint `B(0.5)` for clean relation pill placement.
 */
export function computeCurvedEdgeGeometry(
  s: { x: number; y: number },
  t: { x: number; y: number },
  curveOffset = 0
): CurvedEdgeGeometry {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const ctrlX = (s.x + t.x) / 2 + nx * curveOffset;
  const ctrlY = (s.y + t.y) / 2 + ny * curveOffset;
  // Exact quadratic Bezier point at t = 0.5
  const midX = 0.25 * s.x + 0.5 * ctrlX + 0.25 * t.x;
  const midY = 0.25 * s.y + 0.5 * ctrlY + 0.25 * t.y;
  const pathD =
    Math.abs(curveOffset) < 1
      ? `M ${s.x} ${s.y} L ${t.x} ${t.y}`
      : `M ${s.x} ${s.y} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${t.x} ${t.y}`;
  return { pathD, ctrlX, ctrlY, midX, midY };
}

/**
 * Evaluates a point along the quadratic Bezier edge and picks the cleanest t in [0.36, 0.64]
 * that stays clear of both endpoints' circles and their bottom title labels.
 */
export function computeSmartEdgeLabelPoint(
  s: Pick<GlobalGraphNode, 'x' | 'y' | 'radius'>,
  t: Pick<GlobalGraphNode, 'x' | 'y' | 'radius'>,
  curveOffset: number,
  obstacles: Array<Pick<GlobalGraphNode, 'x' | 'y' | 'radius'>> = []
): { x: number; y: number } {
  const geom = computeCurvedEdgeGeometry(s, t, curveOffset);
  const candidates = [0.5, 0.58, 0.42, 0.64, 0.36];

  const evalBezier = (u: number) => {
    const inv = 1 - u;
    return {
      x: inv * inv * s.x + 2 * inv * u * geom.ctrlX + u * u * t.x,
      y: inv * inv * s.y + 2 * inv * u * geom.ctrlY + u * u * t.y,
    };
  };

  let bestPt = { x: geom.midX, y: geom.midY };
  let bestPenalty = Infinity;

  const checkList = obstacles.length > 0 ? obstacles : [s, t];

  for (const u of candidates) {
    const pt = evalBezier(u);
    let penalty = Math.abs(u - 0.5) * 14;
    for (const node of checkList) {
      // Penalize proximity to node circle
      const distCircle = Math.hypot(pt.x - node.x, pt.y - node.y);
      const safeCircle = node.radius + 20;
      if (distCircle < safeCircle) {
        penalty += (safeCircle - distCircle) * 4;
      }
      // Penalize proximity to node's bottom text label box (centered at y + radius + 15)
      const labelY = node.y + node.radius + 15;
      const dxLabel = Math.abs(pt.x - node.x);
      const dyLabel = Math.abs(pt.y - labelY);
      if (dxLabel < 44 && dyLabel < 18) {
        penalty += (44 - dxLabel) * 1.5 + (18 - dyLabel) * 5;
      }
    }
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestPt = pt;
    }
  }

  return bestPt;
}

/**
 * Assigns subtle deterministic perpendicular curve offsets to edges that pass
 * close to unrelated intermediate nodes, preventing messy straight-line collisions.
 */
export function computeEdgeCurveOffsets(
  nodes: GlobalGraphNode[],
  edges: GlobalGraphEdge[]
): Map<string, number> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const offsets = new Map<string, number>();

  for (const edge of edges) {
    const s = nodeById.get(edge.sourceId);
    const t = nodeById.get(edge.targetId);
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const lenSq = dx * dx + dy * dy;
    const dist = Math.sqrt(lenSq) || 1;

    let closestPerp = Infinity;
    let pushSign = 1;

    for (const other of nodes) {
      if (other.id === s.id || other.id === t.id) continue;
      const proj = ((other.x - s.x) * dx + (other.y - s.y) * dy) / (lenSq || 1);
      if (proj <= 0.14 || proj >= 0.86) continue;
      const px = s.x + proj * dx;
      const py = s.y + proj * dy;
      const perpDist = Math.hypot(other.x - px, other.y - py);
      if (perpDist < other.radius + 22 && perpDist < closestPerp) {
        closestPerp = perpDist;
        // Cross product determines which side of s->t the obstacle sits on; curve away from it
        const cross = dx * (other.y - s.y) - dy * (other.x - s.x);
        pushSign = cross >= 0 ? -1 : 1;
      }
    }

    if (closestPerp < Infinity) {
      const magnitude = Math.min(54, Math.max(24, dist * 0.16));
      offsets.set(edge.id, pushSign * magnitude);
    } else if (edge.kind === 'tag') {
      offsets.set(edge.id, Math.min(28, dist * 0.08));
    } else if (edge.kind === 'inferred') {
      offsets.set(edge.id, Math.min(18, dist * 0.05));
    } else {
      offsets.set(edge.id, 0);
    }
  }

  return offsets;
}

/**
 * Computes clamped pan coordinates that center a target node smoothly inside
 * the SVG constellation viewport at the given zoom scale.
 */
export function computeFocusCamera(
  node: Pick<GlobalGraphNode, 'x' | 'y'>,
  graph: Pick<GlobalGraphModel, 'width' | 'height'>,
  scale = 1
): { x: number; y: number } {
  const cx = graph.width / 2;
  const cy = graph.height / 2;
  const rawX = (cx - node.x) * scale;
  const rawY = (cy - node.y) * scale;
  const maxPanX = Math.max(280, Math.round(graph.width * 0.55 * scale));
  const maxPanY = Math.max(240, Math.round(graph.height * 0.55 * scale));
  return {
    x: Math.round(Math.max(-maxPanX, Math.min(maxPanX, rawX))),
    y: Math.round(Math.max(-maxPanY, Math.min(maxPanY, rawY))),
  };
}

/**
 * Ranks graph nodes matching a bilingual quick-search query inside the modal.
 */
export function searchGraphNodes(
  graph: GlobalGraphModel,
  query: string,
  limit = 8
): GlobalGraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: Array<{ node: GlobalGraphNode; score: number }> = [];
  for (const node of graph.nodes) {
    const it = node.item;
    const title = it.title.toLowerCase();
    const orig = (it.originalTitle || '').toLowerCase();
    const sub = (it.subtitle || '').toLowerCase();
    const work = (it.relatedWorkTitle || '').toLowerCase();
    const actor = (it.portrayedBy || '').toLowerCase();
    const year = (it.year || '').toLowerCase();
    const tags = it.tags.join(' ').toLowerCase();

    let score = 0;
    if (title === q || orig === q) score = 100;
    else if (title.startsWith(q) || orig.startsWith(q)) score = 85;
    else if (title.includes(q) || orig.includes(q)) score = 70;
    else if (work.includes(q) || actor.includes(q)) score = 50;
    else if (sub.includes(q) || tags.includes(q) || year === q) score = 35;

    if (score > 0) {
      scored.push({ node, score: score + Math.min(12, node.degree * 2) });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || b.node.weightedDegree - a.node.weightedDegree)
    .slice(0, limit)
    .map((s) => s.node);
}

export interface BuildGlobalGraphOptions {
  category?: 'all' | ArchiveCategory;
  includeTagEdges?: boolean;
  includeInferredEdges?: boolean;
  externalInferredEdges?: InferredFilmographyEdge[];
  isolatedOnly?: boolean;
}

/**
 * Builds a deterministic, collision-free, cluster-aware constellation layout of
 * the archive with optional automatic filmography relationship discovery and
 * single-category bridge projection.
 */
export function buildGlobalRelationGraph(
  allItems: ArchiveItem[],
  options: BuildGlobalGraphOptions = {}
): GlobalGraphModel {
  const category = options.category ?? 'all';
  const includeTagEdges = options.includeTagEdges ?? false;
  const includeInferredEdges = options.includeInferredEdges ?? false;
  const isolatedOnly = options.isolatedOnly ?? false;

  const baseItems =
    category === 'all'
      ? allItems
      : allItems.filter((it) => it.category === category);

  const visibleIdSet = new Set(baseItems.map((it) => it.id));

  // Scale canvas room gracefully for larger interconnected collections
  const canvasW =
    baseItems.length > 22 ? 1040 : baseItems.length > 12 ? 940 : DEFAULT_CANVAS_W;
  const canvasH =
    baseItems.length > 22 ? 620 : baseItems.length > 12 ? 560 : DEFAULT_CANVAS_H;
  const CX = canvasW / 2;
  const CY = canvasH / 2;

  const itemById = new Map(baseItems.map((it) => [it.id, it]));
  const rawExplicitPairs: Array<{ sourceId: string; targetId: string; key: string }> = [];
  const rawInferredPairs: Array<{
    sourceId: string;
    targetId: string;
    key: string;
    meta: InferredFilmographyEdge;
  }> = [];

  const seenEdges = new Set<string>();
  const explicitDegreeMap = new Map<string, number>();
  const inferredDegreeMap = new Map<string, number>();
  const degreeMap = new Map<string, number>();
  const tagDegreeMap = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const item of baseItems) {
    explicitDegreeMap.set(item.id, 0);
    inferredDegreeMap.set(item.id, 0);
    degreeMap.set(item.id, 0);
    tagDegreeMap.set(item.id, 0);
    adjacency.set(item.id, new Set());
  }

  // 1. Collect explicit edges within visible items
  for (const item of baseItems) {
    const candidates = includeInferredEdges
      ? // When auto-discovery is enabled, keep true saved relatedIds as explicit so
        // auto-discovered filmography links stand out clearly and can be persisted!
        baseItems.filter(
          (other) =>
            other.id !== item.id &&
            (item.relatedIds.includes(other.id) || other.relatedIds.includes(item.id))
        )
      : getRelatedItems(item, baseItems);

    for (const rel of candidates) {
      if (!visibleIdSet.has(rel.id) || rel.id === item.id) continue;
      const key = pairKey(item.id, rel.id);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      rawExplicitPairs.push({ sourceId: item.id, targetId: rel.id, key });
      explicitDegreeMap.set(item.id, (explicitDegreeMap.get(item.id) ?? 0) + 1);
      explicitDegreeMap.set(rel.id, (explicitDegreeMap.get(rel.id) ?? 0) + 1);
      degreeMap.set(item.id, (degreeMap.get(item.id) ?? 0) + 1);
      degreeMap.set(rel.id, (degreeMap.get(rel.id) ?? 0) + 1);
      adjacency.get(item.id)?.add(rel.id);
      adjacency.get(rel.id)?.add(item.id);
    }
  }

  // 2. Collect auto-discovered filmography edges (metadata + credits + category bridges)
  const unlinkedAutoPairs: Array<[string, string]> = [];
  if (includeInferredEdges) {
    const autoMetadata = discoverMetadataFilmographyLinks(allItems);
    const mergedInferred = mergeInferredFilmographyEdges(
      autoMetadata,
      options.externalInferredEdges ?? []
    );

    // Build full cross-category filmography pair list for single-category bridge projection
    const allFilmographyPairs: Array<{ sourceId: string; targetId: string }> = [];
    const seenFull = new Set<string>();
    for (const it of allItems) {
      for (const rid of it.relatedIds) {
        if (rid === it.id) continue;
        const k = pairKey(it.id, rid);
        if (!seenFull.has(k)) {
          seenFull.add(k);
          allFilmographyPairs.push({ sourceId: it.id, targetId: rid });
        }
      }
    }
    for (const inf of mergedInferred) {
      const k = pairKey(inf.sourceId, inf.targetId);
      if (!seenFull.has(k)) {
        seenFull.add(k);
        allFilmographyPairs.push({ sourceId: inf.sourceId, targetId: inf.targetId });
      }
    }

    const categoryBridges =
      category !== 'all'
        ? buildCategoryBridgeEdges(allItems, category, allFilmographyPairs)
        : [];

    const finalInferred = mergeInferredFilmographyEdges(
      mergedInferred,
      categoryBridges
    );

    for (const inf of finalInferred) {
      if (!visibleIdSet.has(inf.sourceId) || !visibleIdSet.has(inf.targetId)) continue;
      if (inf.sourceId === inf.targetId) continue;
      const key = pairKey(inf.sourceId, inf.targetId);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      rawInferredPairs.push({
        sourceId: inf.sourceId,
        targetId: inf.targetId,
        key,
        meta: inf,
      });
      if (inf.source !== 'category-bridge') {
        unlinkedAutoPairs.push([inf.sourceId, inf.targetId]);
      }
      inferredDegreeMap.set(
        inf.sourceId,
        (inferredDegreeMap.get(inf.sourceId) ?? 0) + 1
      );
      inferredDegreeMap.set(
        inf.targetId,
        (inferredDegreeMap.get(inf.targetId) ?? 0) + 1
      );
      degreeMap.set(inf.sourceId, (degreeMap.get(inf.sourceId) ?? 0) + 1);
      degreeMap.set(inf.targetId, (degreeMap.get(inf.targetId) ?? 0) + 1);
      adjacency.get(inf.sourceId)?.add(inf.targetId);
      adjacency.get(inf.targetId)?.add(inf.sourceId);
    }
  }

  // Score explicit edges based on mutual neighbors, shared thematic tags, and bidirectionality
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
      strengthWeight: 0,
      strengthLabel,
      mutualCount,
      sharedTagCount,
      sharedTags,
      isBidirectional,
    });
  }

  // Score auto-discovered filmography edges
  for (const pair of rawInferredPairs) {
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
    const confBonus = pair.meta.confidence === 'high' ? 1.5 : 0.5;
    const strengthScore =
      1.75 +
      confBonus +
      Math.min(5, mutualCount * 1.6) +
      Math.min(2.5, sharedTagCount * 1.0);

    const strength: RelationStrengthTier =
      pair.meta.confidence === 'high' && (mutualCount >= 1 || pair.meta.source === 'credits')
        ? 3
        : pair.meta.confidence === 'high' || mutualCount >= 1 || sharedTagCount >= 1
          ? 2
          : 1;

    const strengthLabel =
      pair.meta.source === 'category-bridge'
        ? '跨类桥接'
        : pair.meta.source === 'credits'
          ? '片单考据'
          : strength >= 2
            ? '自动发现'
            : '脉络推断';

    edges.push({
      id: `inf-${pair.key}`,
      sourceId: pair.sourceId,
      targetId: pair.targetId,
      kind: 'inferred',
      roleType: pair.meta.roleType,
      roleCharacterName: pair.meta.roleCharacterName,
      bridgeTitle: pair.meta.bridgeTitle,
      evidence: pair.meta.evidence,
      inferenceSource: pair.meta.source,
      isPersistable: pair.meta.source !== 'category-bridge',
      strength,
      strengthScore,
      strengthWeight: 0,
      strengthLabel,
      mutualCount,
      sharedTagCount,
      sharedTags,
      isBidirectional: false,
    });
  }

  // Optional subtle tag chords (capped to keep constellation legible)
  let tagEdgeCount = 0;
  if (includeTagEdges && baseItems.length <= 50) {
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

  const maxStrengthScore = Math.max(1, ...edges.map((e) => e.strengthScore));
  for (const edge of edges) {
    edge.strengthWeight = Number(
      Math.min(1, edge.strengthScore / maxStrengthScore).toFixed(3)
    );
  }

  // Compute weighted degree per node
  const weightedDegreeMap = new Map<string, number>();
  for (const item of baseItems) weightedDegreeMap.set(item.id, 0);
  for (const edge of edges) {
    const contrib =
      edge.kind === 'explicit'
        ? edge.strengthScore
        : edge.kind === 'inferred'
          ? edge.strengthScore * 0.85
          : edge.strengthScore * 0.3;
    weightedDegreeMap.set(
      edge.sourceId,
      (weightedDegreeMap.get(edge.sourceId) ?? 0) + contrib
    );
    weightedDegreeMap.set(
      edge.targetId,
      (weightedDegreeMap.get(edge.targetId) ?? 0) + contrib
    );
  }

  // Connected components BFS across filmography edges (explicit + inferred)
  const clusterById = new Map<string, number>();
  const clusterMembers = new Map<number, string[]>();
  let clusterCounter = 0;
  for (const item of baseItems) {
    if (clusterById.has(item.id)) continue;
    const deg = degreeMap.get(item.id) ?? 0;
    if (deg === 0) {
      clusterById.set(item.id, -1);
      continue;
    }
    const queue = [item.id];
    const members: string[] = [];
    clusterById.set(item.id, clusterCounter);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      members.push(curr);
      for (const nxt of adjacency.get(curr) ?? []) {
        if (!clusterById.has(nxt)) {
          clusterById.set(nxt, clusterCounter);
          queue.push(nxt);
        }
      }
    }
    clusterMembers.set(clusterCounter, members);
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

  // Cluster-aware initial placement + deterministic spring relaxation
  if (connectedItems.length === 1) {
    const it = connectedItems[0];
    posById.set(it.id, { x: CX, y: CY });
  } else if (connectedItems.length > 1) {
    const activeClusterIds = Array.from(
      new Set(connectedItems.map((it) => clusterById.get(it.id) ?? 0))
    ).sort((a, b) => {
      const lenDiff = (clusterMembers.get(b)?.length ?? 0) - (clusterMembers.get(a)?.length ?? 0);
      return lenDiff !== 0 ? lenDiff : a - b;
    });

    if (activeClusterIds.length === 1) {
      // Single unified network: concentric rings with top hubs in center
      const coreCount = Math.min(connectedItems.length, connectedItems.length <= 6 ? 1 : 3);
      const coreItems = connectedItems.slice(0, coreCount);
      const midItems = connectedItems.slice(coreCount);

      coreItems.forEach((it, idx) => {
        if (coreItems.length === 1) {
          posById.set(it.id, { x: CX, y: CY });
        } else {
          const angle = -Math.PI / 2 + (idx * Math.PI * 2) / coreItems.length;
          posById.set(it.id, {
            x: CX + Math.cos(angle) * 84,
            y: CY + Math.sin(angle) * 66,
          });
        }
      });

      const ring1Max = Math.min(midItems.length, 10);
      const ring1 = midItems.slice(0, ring1Max);
      const ring2 = midItems.slice(ring1Max);

      ring1.forEach((it, idx) => {
        const angle = -Math.PI * 0.78 + (idx * Math.PI * 2) / Math.max(1, ring1.length);
        posById.set(it.id, {
          x: CX + Math.cos(angle) * (canvasW * 0.27),
          y: CY + Math.sin(angle) * (canvasH * 0.27),
        });
      });

      ring2.forEach((it, idx) => {
        const angle = -Math.PI * 0.45 + (idx * Math.PI * 2) / Math.max(1, ring2.length);
        posById.set(it.id, {
          x: CX + Math.cos(angle) * (canvasW * 0.37),
          y: CY + Math.sin(angle) * (canvasH * 0.36),
        });
      });
    } else {
      // Multiple distinct filmography clusters: place each cluster around its own well-separated sector centroid
      activeClusterIds.forEach((cIdx, posIdx) => {
        const members = connectedItems
          .filter((it) => clusterById.get(it.id) === cIdx)
          .sort(
            (a, b) =>
              (weightedDegreeMap.get(b.id) ?? 0) - (weightedDegreeMap.get(a.id) ?? 0)
          );
        const sectorAngle =
          activeClusterIds.length === 2
            ? posIdx === 0
              ? Math.PI
              : 0
            : -Math.PI * 0.75 + (posIdx * Math.PI * 2) / activeClusterIds.length;
        const spreadX = activeClusterIds.length === 2 ? canvasW * 0.27 : canvasW * 0.28;
        const spreadY = activeClusterIds.length === 2 ? 0 : canvasH * 0.23;
        const clusterCx = CX + Math.cos(sectorAngle) * spreadX;
        const clusterCy = CY + Math.sin(sectorAngle) * spreadY;

        members.forEach((it, mIdx) => {
          if (mIdx === 0) {
            posById.set(it.id, { x: clusterCx, y: clusterCy });
          } else {
            const subAngle =
              sectorAngle +
              -Math.PI * 0.5 +
              ((mIdx - 1) * Math.PI * 2) / Math.max(1, members.length - 1);
            const r = members.length <= 4 ? 98 : 118;
            posById.set(it.id, {
              x: clusterCx + Math.cos(subAngle) * r,
              y: clusterCy + Math.sin(subAngle) * (r * 0.84),
            });
          }
        });
      });
    }

    // Run deterministic spring relaxation (24 steps)
    const connectedIds = connectedItems.map((it) => it.id);
    const minGap = connectedIds.length > 16 ? 124 : 144;
    const idealEdgeLen = connectedIds.length > 16 ? 148 : 162;

    for (let step = 0; step < 24; step += 1) {
      const disp = new Map<string, { dx: number; dy: number }>();
      for (const id of connectedIds) disp.set(id, { dx: 0, dy: 0 });

      // Repulsion between all connected node pairs (extra separation across different clusters)
      for (let i = 0; i < connectedIds.length; i += 1) {
        for (let j = i + 1; j < connectedIds.length; j += 1) {
          const idA = connectedIds[i];
          const idB = connectedIds[j];
          const pA = posById.get(idA)!;
          const pB = posById.get(idB)!;
          let vx = pA.x - pB.x;
          let vy = pA.y - pB.y;
          const dist = Math.hypot(vx, vy) || 1;
          const sameCluster = clusterById.get(idA) === clusterById.get(idB);
          const pairMinGap = sameCluster ? minGap : minGap + 88;
          if (dist < pairMinGap) {
            const push = ((pairMinGap - dist) / pairMinGap) * (sameCluster ? 15 : 22);
            vx = (vx / dist) * push;
            vy = (vy / dist) * push;
            disp.get(idA)!.dx += vx;
            disp.get(idA)!.dy += vy;
            disp.get(idB)!.dx -= vx;
            disp.get(idB)!.dy -= vy;
          }
        }
      }

      // Attraction along filmography edges (explicit + inferred)
      for (const e of edges) {
        if (!isFilmographyEdge(e)) continue;
        const pA = posById.get(e.sourceId);
        const pB = posById.get(e.targetId);
        if (!pA || !pB) continue;
        const vx = pB.x - pA.x;
        const vy = pB.y - pA.y;
        const dist = Math.hypot(vx, vy) || 1;
        if (dist > idealEdgeLen) {
          const pull = ((dist - idealEdgeLen) / dist) * (e.kind === 'explicit' ? 0.13 : 0.1);
          disp.get(e.sourceId)!.dx += vx * pull;
          disp.get(e.sourceId)!.dy += vy * pull;
          disp.get(e.targetId)!.dx -= vx * pull;
          disp.get(e.targetId)!.dy -= vy * pull;
        }
      }

      // Gentle pull toward center (weaker when multiple clusters exist so they stay well-separated)
      const gravity = activeClusterIds.length > 1 ? 0.005 : 0.014;
      for (const id of connectedIds) {
        const p = posById.get(id)!;
        const d = disp.get(id)!;
        p.x = Math.max(76, Math.min(canvasW - 76, p.x + d.dx + (CX - p.x) * gravity));
        p.y = Math.max(78, Math.min(canvasH - 76, p.y + d.dy + (CY - p.y) * gravity));
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
      const cellW = (canvasW - 140) / Math.max(1, cols);
      const cellH = (canvasH - 140) / Math.max(1, rows);
      posById.set(it.id, {
        x: 70 + cellW * (col + 0.5),
        y: 70 + cellH * (row + 0.5),
      });
    } else {
      const angle =
        Math.PI * 0.14 + (idx * Math.PI * 2) / Math.max(1, isolatedItems.length);
      posById.set(it.id, {
        x: Math.max(54, Math.min(canvasW - 54, CX + Math.cos(angle) * (canvasW * 0.41))),
        y: Math.max(54, Math.min(canvasH - 62, CY + Math.sin(angle) * (canvasH * 0.4))),
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
    const expDeg = explicitDegreeMap.get(item.id) ?? 0;
    const infDeg = inferredDegreeMap.get(item.id) ?? 0;
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
      deg === 0 ? 14.5 : Math.min(26, 15.5 + deg * 2.1 + intensity * 3);
    nodes.push({
      id: item.id,
      item,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      degree: deg,
      explicitDegree: expDeg,
      inferredDegree: infDeg,
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

  // Build cluster summaries for navigation & subtle visual grouping
  const nodesByCluster = new Map<number, GlobalGraphNode[]>();
  for (const node of nodes) {
    if (node.clusterIndex < 0) continue;
    if (!nodesByCluster.has(node.clusterIndex)) {
      nodesByCluster.set(node.clusterIndex, []);
    }
    nodesByCluster.get(node.clusterIndex)!.push(node);
  }

  const clusters: GraphCluster[] = [];
  for (const [cIdx, cNodes] of nodesByCluster.entries()) {
    if (cNodes.length < 2) continue;
    const sorted = [...cNodes].sort(
      (a, b) =>
        b.weightedDegree - a.weightedDegree ||
        b.degree - a.degree ||
        a.item.accessionNo.localeCompare(b.item.accessionNo)
    );
    const hub = sorted[0];
    const memberSet = new Set(cNodes.map((n) => n.id));
    const edgeCount = filteredEdges.filter(
      (e) => isFilmographyEdge(e) && memberSet.has(e.sourceId) && memberSet.has(e.targetId)
    ).length;

    const avgX = cNodes.reduce((sum, n) => sum + n.x, 0) / cNodes.length;
    const avgY = cNodes.reduce((sum, n) => sum + n.y, 0) / cNodes.length;
    const maxDist = Math.max(
      48,
      ...cNodes.map((n) => Math.hypot(n.x - avgX, n.y - avgY) + n.radius + 20)
    );

    clusters.push({
      index: cIdx,
      hubId: hub.id,
      title: hub.item.title,
      nodeIds: sorted.map((n) => n.id),
      edgeCount,
      centerX: Math.round(avgX),
      centerY: Math.round(avgY),
      radius: Math.round(Math.min(240, maxDist)),
    });
  }

  clusters.sort(
    (a, b) => b.nodeIds.length - a.nodeIds.length || b.edgeCount - a.edgeCount
  );

  const hubs = [...nodes]
    .filter((n) => n.degree > 0)
    .sort(
      (a, b) =>
        b.weightedDegree - a.weightedDegree ||
        b.degree - a.degree ||
        a.item.accessionNo.localeCompare(b.item.accessionNo)
    )
    .slice(0, 6);

  const isolatedNodes = nodes.filter((n) => n.isIsolated);

  return {
    width: canvasW,
    height: canvasH,
    nodes,
    edges: filteredEdges,
    hubs,
    isolatedNodes,
    clusters,
    explicitEdgeCount: filteredEdges.filter((e) => e.kind === 'explicit').length,
    inferredEdgeCount: filteredEdges.filter((e) => e.kind === 'inferred').length,
    tagEdgeCount: filteredEdges.filter((e) => e.kind === 'tag').length,
    unlinkedAutoPairs,
    maxStrengthScore,
    maxWeightedDegree: Number(maxWeightedDegree.toFixed(2)),
  };
}
