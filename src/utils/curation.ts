import type {
  ArchiveCategory,
  ArchiveItem,
  CollectionStatus,
  CollectorAlbum,
  DecadeFilterOption,
  WatchLogEntry,
  WatchMedium,
} from '../types/archive';
import { pickRandomEncounterItem } from './collector';

export const WATCH_MEDIUM_LABELS: Record<WatchMedium, string> = {
  cinema: '影院',
  imax: 'IMAX / 巨幕',
  streaming: '流媒体',
  bluray: '蓝光 / 碟片',
  tv: '电视 / 投影',
  other: '其他方式',
};

export const DECADE_FILTER_OPTIONS: Array<{
  id: DecadeFilterOption;
  label: string;
}> = [
  { id: 'all', label: '全部年代' },
  { id: '2020s', label: '2020年代' },
  { id: '2010s', label: '2010年代' },
  { id: '2000s', label: '2000年代' },
  { id: '1990s', label: '1990年代' },
  { id: 'classic', label: '经典老片 (<1990)' },
];

export function matchYearToDecade(
  yearStr: string | undefined,
  decade: DecadeFilterOption
): boolean {
  if (decade === 'all') return true;
  const year = Number.parseInt(yearStr || '', 10);
  if (!Number.isFinite(year) || year <= 0) return false;
  if (decade === '2020s') return year >= 2020 && year <= 2029;
  if (decade === '2010s') return year >= 2010 && year <= 2019;
  if (decade === '2000s') return year >= 2000 && year <= 2009;
  if (decade === '1990s') return year >= 1990 && year <= 1999;
  if (decade === 'classic') return year < 1990;
  return true;
}

export function extractRegionRegistry(
  items: ArchiveItem[]
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.region) continue;
    const parts = item.region
      .split(/[、/，,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

export function itemMatchesRegion(item: ArchiveItem, region: string): boolean {
  const clean = region.trim().toLowerCase();
  if (!clean) return true;
  if (!item.region) return false;
  return item.region
    .split(/[、/，,]+/)
    .map((s) => s.trim().toLowerCase())
    .some((part) => part === clean || part.includes(clean));
}

export interface QuoteCardEntry {
  item: ArchiveItem;
  quoteText: string;
  isNoteFallback: boolean;
}

export function extractQuoteEntries(
  items: ArchiveItem[],
  options: { category?: 'all' | ArchiveCategory; query?: string } = {}
): QuoteCardEntry[] {
  const category = options.category ?? 'all';
  const q = (options.query || '').trim().toLowerCase();

  return items
    .filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      const quote = (item.quote || '').trim();
      if (!quote) return false;
      if (!q) return true;
      return [quote, item.title, item.originalTitle, item.relatedWorkTitle, ...item.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .map((item) => ({
      item,
      quoteText: item.quote!.trim(),
      isNoteFallback: false,
    }));
}

export function sortWatchLogsDesc(logs?: WatchLogEntry[]): WatchLogEntry[] {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  return [...logs].sort((a, b) => {
    const cmp = b.watchedAt.localeCompare(a.watchedAt);
    if (cmp !== 0) return cmp;
    return b.id.localeCompare(a.id);
  });
}

export function addWatchLogToItem(
  item: ArchiveItem,
  entry: Omit<WatchLogEntry, 'id'> & { id?: string }
): WatchLogEntry[] {
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.watchedAt.trim())
    ? entry.watchedAt.trim()
    : new Date().toISOString().slice(0, 10);
  const nextEntry: WatchLogEntry = {
    id: entry.id || `wl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    watchedAt: cleanDate,
    medium: entry.medium || 'streaming',
    note: entry.note?.trim() || undefined,
  };
  return sortWatchLogsDesc([nextEntry, ...(item.watchLogs || [])]);
}

export function removeWatchLogFromItem(
  item: ArchiveItem,
  logId: string
): WatchLogEntry[] {
  return (item.watchLogs || []).filter((l) => l.id !== logId);
}

/**
 * Computes watchlist blind-box pool ("今晚看什么") with optional decade/tag/region filters.
 */
export function filterWatchlistPool(
  items: ArchiveItem[],
  filters: {
    decade?: DecadeFilterOption;
    tag?: string;
    region?: string;
  } = {}
): ArchiveItem[] {
  const decade = filters.decade ?? 'all';
  const tag = (filters.tag || '').trim().toLowerCase();
  const region = (filters.region || '').trim();

  return items.filter((item) => {
    if (item.status !== 'watchlist') return false;
    if (item.category !== 'film') return false;
    if (!matchYearToDecade(item.year, decade)) return false;
    if (tag && !item.tags.some((t) => t.trim().toLowerCase() === tag)) return false;
    if (region && !itemMatchesRegion(item, region)) return false;
    return true;
  });
}

export function pickWatchlistBlindBoxItem(
  items: ArchiveItem[],
  filters: {
    decade?: DecadeFilterOption;
    tag?: string;
    region?: string;
  } = {},
  excludeId?: string,
  rng: () => number = Math.random
): { picked: ArchiveItem | null; poolCount: number } {
  const pool = filterWatchlistPool(items, filters);
  if (pool.length === 0) return { picked: null, poolCount: 0 };
  const picked = pickRandomEncounterItem(pool, excludeId, rng);
  return { picked, poolCount: pool.length };
}

/**
 * Pure batch curation helpers for Library multi-select mode.
 */
export function applyBatchStatusUpdate(
  items: ArchiveItem[],
  selectedIds: string[],
  nextStatus: CollectionStatus,
  nowIso = new Date().toISOString()
): { items: ArchiveItem[]; updatedCount: number } {
  const idSet = new Set(selectedIds);
  let updatedCount = 0;
  const nextItems = items.map((item) => {
    if (!idSet.has(item.id)) return item;
    if (item.status === nextStatus) return item;
    updatedCount += 1;
    return { ...item, status: nextStatus, updatedAt: nowIso };
  });
  return { items: nextItems, updatedCount };
}

export function applyBatchTagAdd(
  items: ArchiveItem[],
  selectedIds: string[],
  rawTag: string,
  nowIso = new Date().toISOString()
): { items: ArchiveItem[]; updatedCount: number } {
  const cleanTag = rawTag.trim();
  if (!cleanTag) return { items, updatedCount: 0 };
  const tagLower = cleanTag.toLowerCase();
  const idSet = new Set(selectedIds);
  let updatedCount = 0;

  const nextItems = items.map((item) => {
    if (!idSet.has(item.id)) return item;
    if (item.tags.some((t) => t.trim().toLowerCase() === tagLower)) return item;
    updatedCount += 1;
    return {
      ...item,
      tags: [...item.tags, cleanTag].slice(0, 12),
      updatedAt: nowIso,
    };
  });
  return { items: nextItems, updatedCount };
}

export function applyBatchAddToAlbum(
  albums: CollectorAlbum[],
  albumId: string,
  selectedIds: string[]
): { albums: CollectorAlbum[]; addedCount: number } {
  let addedCount = 0;
  const nextAlbums = albums.map((album) => {
    if (album.id !== albumId) return album;
    const existing = new Set(album.itemIds || []);
    const nextIds = [...(album.itemIds || [])];
    for (const sid of selectedIds) {
      if (!existing.has(sid)) {
        existing.add(sid);
        nextIds.push(sid);
        addedCount += 1;
      }
    }
    return {
      ...album,
      itemIds: nextIds,
      targetCount: Math.max(album.targetCount, nextIds.length),
    };
  });
  return { albums: nextAlbums, addedCount };
}
