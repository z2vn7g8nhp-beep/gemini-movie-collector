import type {
  ArchiveCategory,
  CollectionStatus,
  SortOption,
} from '../types/archive';
import type { OnlineRelationsResponse } from '../services/archiveApi';
import type { AppTab } from '../components/MobileNavBar';
import type { RuntimeMode } from './runtimeEnv';
import { normalizeEntityKey } from './wikiCast';

const RELATIONS_CACHE_KEY = 'cinearchive.relationsCache.v3';
const RELATIONS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RELATIONS_CACHE_MAX_ENTRIES = 45;

const UI_STATE_STORAGE_KEY = 'cinearchive.uiState.v1';
const RUNTIME_MODE_STORAGE_KEY = 'cinearchive.runtimeMode.v1';
const RUNTIME_MODE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface CachedRelationsEntry {
  key: string;
  updatedAt: number;
  data: OnlineRelationsResponse;
}

const memoryRelationsCache = new Map<string, CachedRelationsEntry>();

export function buildRelationsCacheKey(params: {
  category: 'film' | 'person';
  title: string;
  originalTitle?: string;
  year?: string;
}): string {
  const mainKey = normalizeEntityKey(params.title || params.originalTitle || '');
  const yearPart = (params.year || '').trim().slice(0, 4);
  return `${params.category}::${mainKey}::${yearPart}`;
}

function loadAllStoredRelations(): CachedRelationsEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RELATIONS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (entry): entry is CachedRelationsEntry =>
        Boolean(entry) &&
        typeof entry.key === 'string' &&
        typeof entry.updatedAt === 'number' &&
        now - entry.updatedAt < RELATIONS_CACHE_TTL_MS &&
        Boolean(entry.data)
    );
  } catch {
    return [];
  }
}

function persistStoredRelations(entries: CachedRelationsEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RELATIONS_CACHE_KEY,
      JSON.stringify(entries.slice(0, RELATIONS_CACHE_MAX_ENTRIES))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function readCachedRelations(params: {
  category: 'film' | 'person';
  title: string;
  originalTitle?: string;
  year?: string;
}): OnlineRelationsResponse | null {
  const key = buildRelationsCacheKey(params);
  const now = Date.now();

  const memHit = memoryRelationsCache.get(key);
  if (memHit && now - memHit.updatedAt < RELATIONS_CACHE_TTL_MS) {
    return memHit.data;
  }

  const stored = loadAllStoredRelations();
  const hit = stored.find((e) => e.key === key);
  if (!hit) return null;

  memoryRelationsCache.set(key, hit);
  return hit.data;
}

export function writeCachedRelations(
  params: {
    category: 'film' | 'person';
    title: string;
    originalTitle?: string;
    year?: string;
  },
  data: OnlineRelationsResponse
): void {
  const totalCount =
    data.films.length + data.people.length + data.characters.length;
  if (totalCount === 0) return;

  const key = buildRelationsCacheKey(params);
  const entry: CachedRelationsEntry = {
    key,
    updatedAt: Date.now(),
    data,
  };
  memoryRelationsCache.set(key, entry);

  const rest = loadAllStoredRelations().filter((e) => e.key !== key);
  persistStoredRelations([entry, ...rest]);
}

export interface PersistedUiState {
  activeTab: AppTab;
  activeCategory: 'all' | ArchiveCategory;
  statusFilter: 'all' | CollectionStatus;
  activeTag: string;
  activeAlbumId: string;
  sortBy: SortOption;
  selectedItemId: string | null;
}

const VALID_TABS = new Set<AppTab>([
  'library',
  'timeline',
  'search',
  'create',
  'profile',
]);
const VALID_CATEGORIES = new Set<'all' | ArchiveCategory>([
  'all',
  'film',
  'person',
  'character',
]);
const VALID_STATUSES = new Set<'all' | CollectionStatus>([
  'all',
  'favorite',
  'watched',
  'watching',
  'watchlist',
]);
const VALID_SORTS = new Set<SortOption>([
  'recent',
  'rating',
  'year',
  'title',
]);

export function loadPersistedUiState(): Partial<PersistedUiState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(UI_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>;
    const out: Partial<PersistedUiState> = {};
    if (parsed.activeTab && VALID_TABS.has(parsed.activeTab)) {
      out.activeTab = parsed.activeTab;
    }
    if (
      parsed.activeCategory &&
      VALID_CATEGORIES.has(parsed.activeCategory)
    ) {
      out.activeCategory = parsed.activeCategory;
    }
    if (parsed.statusFilter && VALID_STATUSES.has(parsed.statusFilter)) {
      out.statusFilter = parsed.statusFilter;
    }
    if (typeof parsed.activeTag === 'string') {
      out.activeTag = parsed.activeTag;
    }
    if (typeof parsed.activeAlbumId === 'string') {
      out.activeAlbumId = parsed.activeAlbumId;
    }
    if (parsed.sortBy && VALID_SORTS.has(parsed.sortBy)) {
      out.sortBy = parsed.sortBy;
    }
    if (
      parsed.selectedItemId === null ||
      typeof parsed.selectedItemId === 'string'
    ) {
      out.selectedItemId = parsed.selectedItemId;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePersistedUiState(state: PersistedUiState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadPersistedRuntimeMode(): RuntimeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RUNTIME_MODE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      origin?: string;
      mode?: RuntimeMode;
      updatedAt?: number;
    };
    if (
      parsed.origin !== window.location.origin ||
      (parsed.mode !== 'server' && parsed.mode !== 'static') ||
      typeof parsed.updatedAt !== 'number' ||
      Date.now() - parsed.updatedAt > RUNTIME_MODE_TTL_MS
    ) {
      return null;
    }
    return parsed.mode;
  } catch {
    return null;
  }
}

export function savePersistedRuntimeMode(mode: RuntimeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RUNTIME_MODE_STORAGE_KEY,
      JSON.stringify({
        origin: window.location.origin,
        mode,
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}
