import type { ArchiveItem } from '../types/archive';

export const CLEARABLE_OPTIONAL_STRING_FIELDS = [
  'quote',
  'coverUrl',
  'relatedWorkTitle',
  'portrayedBy',
  'originalTitle',
  'subtitle',
  'year',
  'region',
  'sourceUrl',
] as const;

export type ClearableOptionalField =
  (typeof CLEARABLE_OPTIONAL_STRING_FIELDS)[number];

/**
 * Converts a Partial<ArchiveItem> into a JSON-safe wire payload where explicit
 * `undefined` values on clearable optional string fields become `null` so
 * `JSON.stringify` preserves the user's intent to clear those fields.
 */
export function serializeClearablePatch(
  patch: Partial<ArchiveItem>
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...patch };
  for (const field of CLEARABLE_OPTIONAL_STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      const value = patch[field];
      if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
        payload[field] = null;
      } else if (typeof value === 'string') {
        payload[field] = value.trim();
      }
    }
  }
  return payload;
}

/**
 * Applies a partial update (including explicit `null` or empty-string clears
 * for optional string fields) onto an existing ArchiveItem without mutating it.
 */
export function applyItemPatch(
  existing: ArchiveItem,
  patch: Partial<ArchiveItem> | Record<string, unknown>,
  nowIso?: string
): ArchiveItem {
  const next: ArchiveItem = {
    ...existing,
    ...(patch as Partial<ArchiveItem>),
    id: existing.id,
    updatedAt: nowIso ?? new Date().toISOString(),
  };

  for (const field of CLEARABLE_OPTIONAL_STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      const raw = (patch as Record<string, unknown>)[field];
      if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
        delete next[field];
      } else if (typeof raw === 'string') {
        next[field] = raw.trim();
      }
    }
  }

  return next;
}

/**
 * Monotonic sequence guard: only accept an async server response if no newer
 * optimistic mutation has been issued since this request started.
 */
export function shouldAcceptMutationResponse(
  requestSeq: number,
  latestSeq: number
): boolean {
  return requestSeq === latestSeq;
}

/**
 * Builds an O(1)-lookup relation map for all items in the collection, matching
 * `getRelatedItems` semantics (explicit bidirectional `relatedIds` + inferred
 * work/actor name links) while avoiding repeated O(N) scans per card render.
 */
export function buildRelationLookupMap(
  items: ArchiveItem[]
): Map<string, ArchiveItem[]> {
  const count = items.length;
  const result = new Map<string, ArchiveItem[]>();
  if (count === 0) return result;

  const meta = items.map((item) => ({
    item,
    id: item.id,
    titleLower: item.title.trim().toLowerCase(),
    workLower: (item.relatedWorkTitle || '').trim().toLowerCase(),
    actorLower: (item.portrayedBy || '').trim().toLowerCase(),
    explicitSet: new Set(item.relatedIds || []),
  }));

  const adjacency: Array<Map<string, ArchiveItem>> = Array.from(
    { length: count },
    () => new Map<string, ArchiveItem>()
  );

  for (let i = 0; i < count; i += 1) {
    const a = meta[i];
    for (let j = i + 1; j < count; j += 1) {
      const b = meta[j];
      const explicitLink = a.explicitSet.has(b.id) || b.explicitSet.has(a.id);

      let inferredLink = false;
      if (!explicitLink) {
        inferredLink =
          (a.workLower.length >= 2 &&
            b.titleLower.length >= 2 &&
            a.workLower.includes(b.titleLower)) ||
          (a.actorLower.length >= 2 &&
            b.titleLower.length >= 2 &&
            a.actorLower.includes(b.titleLower)) ||
          (b.workLower.length >= 2 &&
            a.titleLower.length >= 2 &&
            b.workLower.includes(a.titleLower)) ||
          (b.actorLower.length >= 2 &&
            a.titleLower.length >= 2 &&
            b.actorLower.includes(a.titleLower));
      }

      if (explicitLink || inferredLink) {
        adjacency[i].set(b.id, b.item);
        adjacency[j].set(a.id, a.item);
      }
    }
  }

  for (let i = 0; i < count; i += 1) {
    result.set(meta[i].id, Array.from(adjacency[i].values()));
  }

  return result;
}

export interface GraphHistoryState {
  entries: string[];
  index: number;
}

/**
 * Pure immutable history push for GlobalRelationMapModal navigation.
 * Truncates forward entries when branching from an earlier history index,
 * and avoids duplicate consecutive entries.
 */
export function pushGraphHistory(
  state: GraphHistoryState,
  nodeId: string
): GraphHistoryState {
  const clampedIdx = Math.max(
    -1,
    Math.min(state.index, state.entries.length - 1)
  );
  if (clampedIdx >= 0 && state.entries[clampedIdx] === nodeId) {
    return state;
  }
  const truncated = state.entries.slice(0, clampedIdx + 1);
  truncated.push(nodeId);
  return {
    entries: truncated,
    index: truncated.length - 1,
  };
}

/**
 * Computes the next zoom and pan so the graph coordinate under `(anchorX, anchorY)`
 * in SVG viewBox space stays pinned during smooth wheel zoom.
 */
export function computeZoomPanAroundPoint(params: {
  currentZoom: number;
  currentPan: { x: number; y: number };
  targetZoom: number;
  anchorX: number;
  anchorY: number;
  centerX: number;
  centerY: number;
  minZoom?: number;
  maxZoom?: number;
}): { zoom: number; pan: { x: number; y: number } } {
  const minZoom = params.minZoom ?? 0.55;
  const maxZoom = params.maxZoom ?? 2.2;
  const nextZoom = Math.min(maxZoom, Math.max(minZoom, Number(params.targetZoom.toFixed(3))));
  if (nextZoom === params.currentZoom) {
    return { zoom: params.currentZoom, pan: params.currentPan };
  }

  // Transform model: screenPos = center + pan + (worldPos - center) * zoom
  // Solving for worldPos under anchor, then keeping anchor mapped to same worldPos:
  const worldX =
    params.centerX +
    (params.anchorX - params.centerX - params.currentPan.x) / params.currentZoom;
  const worldY =
    params.centerY +
    (params.anchorY - params.centerY - params.currentPan.y) / params.currentZoom;

  const nextPanX =
    params.anchorX - params.centerX - (worldX - params.centerX) * nextZoom;
  const nextPanY =
    params.anchorY - params.centerY - (worldY - params.centerY) * nextZoom;

  return {
    zoom: nextZoom,
    pan: {
      x: Math.round(nextPanX * 100) / 100,
      y: Math.round(nextPanY * 100) / 100,
    },
  };
}

export interface DeletedItemRefCleanupInput {
  batchSelectedIds: string[];
  locatedItemId: string | null;
  pinnedItemId?: string;
  customLinkItemId?: string;
}

export interface DeletedItemRefCleanupResult {
  batchSelectedIds: string[];
  locatedItemId: string | null;
  clearPinnedItemId: boolean;
  clearCustomLinkItemId: boolean;
}

/**
 * Prunes dangling UI and showcase references after an archive item is deleted.
 */
export function pruneDeletedItemReferences(
  deletedId: string,
  state: DeletedItemRefCleanupInput
): DeletedItemRefCleanupResult {
  return {
    batchSelectedIds: state.batchSelectedIds.filter((id) => id !== deletedId),
    locatedItemId: state.locatedItemId === deletedId ? null : state.locatedItemId,
    clearPinnedItemId: state.pinnedItemId === deletedId,
    clearCustomLinkItemId: state.customLinkItemId === deletedId,
  };
}
