import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  Compass,
  Dices,
  Grid3x3,
  LayoutGrid,
  List,
  Quote,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from 'lucide-react';
import { AlbumCuratorModal } from './components/AlbumCuratorModal';
import { ArchiveGrid, type ArchiveViewMode } from './components/ArchiveGrid';
import { BatchActionBar } from './components/BatchActionBar';
import { CollectibleCardModal } from './components/CollectibleCardModal';
import { CollectorSpotlightRail } from './components/CollectorSpotlightRail';
import { DailyCheckInBanner } from './components/DailyCheckInBanner';
import { DetailDrawer } from './components/DetailDrawer';
import { GlobalRelationMapModal } from './components/GlobalRelationMapModal';
import { ManualCreateView } from './components/ManualCreateView';
import { MobileNavBar, AppTopBar, type AppTab } from './components/MobileNavBar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PostCollectLinkSheet } from './components/PostCollectLinkSheet';
import { PosterWallExportModal } from './components/PosterWallExportModal';
import { ProfileBackupView } from './components/ProfileBackupView';
import { QuotesWallModal } from './components/QuotesWallModal';
import {
  RandomEncounterModal,
  type EncounterMode,
} from './components/RandomEncounterModal';
import { SearchTabView } from './components/SearchTabView';
import { ShowcaseCustomizerModal } from './components/ShowcaseCustomizerModal';
import { TimelineMemoriesView } from './components/TimelineMemoriesView';
import { detectRuntimeMode, getRuntimeModeSync } from './services/archiveApi';
import type {
  ArchiveCategory,
  ArchiveDraftInput,
  ArchiveItem,
  CollectionStatus,
  CollectorAlbum,
  CollectorState,
  CompletenessFilterOption,
  DecadeFilterOption,
  OnlineSearchResult,
  RatingBucketFilterOption,
  ShowcaseConfig,
  SortOption,
} from './types/archive';
import {
  computeArchiveStats,
  filterAndSortItems,
  findExistingItemByTitle,
  nextAccessionNo,
} from './utils/archive';
import { formatCoverUrlForMode, type RuntimeMode } from './utils/runtimeEnv';
import {
  findRecommendedUnlinkedItems,
  type LinkRecommendation,
} from './utils/smartLink';
import { computeBatchLinkItems } from './utils/filmographyInference';
import {
  computeCheckInStreak,
  computeCollectorStamps,
  formatLocalDateKey,
  pickRandomEncounterItem,
  recordCheckIn,
  resolveAlbumItems,
} from './utils/collector';
import {
  applyBatchAddToAlbum,
  applyBatchStatusUpdate,
  applyBatchTagAdd,
  DECADE_FILTER_OPTIONS,
  extractRegionRegistry,
} from './utils/curation';
import {
  evaluateDailyCheckInReminder,
  getBrowserNotificationPermission,
  loadCheckInReminderPrefs,
  msUntilNextLocalMidnight,
  saveCheckInReminderPrefs,
  sendBrowserCheckInNotification,
  type BrowserNotificationPermissionState,
  type CheckInReminderPrefs,
} from './utils/checkInReminder';
import {
  computeCinemaMedals,
  detectNewOrUpgradedMedals,
  type MedalTier,
} from './utils/medals';
import { localizeArchivedFilm } from './utils/filmIndex';
import { collectTagRegistry } from './utils/tags';
import {
  loadPersistedUiState,
  savePersistedUiState,
} from './utils/relationsCache';
import {
  countActiveLibraryFilters,
  getAdjacentArchiveItem,
} from './utils/uiHelpers';
import {
  buildCrossJumpLibraryState,
  type CrossJumpLibraryState,
} from './utils/drawerNavigation';
import { buildQuickStatusNotice } from './utils/quickStatusMenu';
import {
  DEFAULT_SHOWCASE_CONFIG,
  normalizeShowcaseConfig,
} from './utils/showcase';
import {
  applyThemeToDocument,
  loadSavedTheme,
  saveThemePreference,
  toggleThemeMode,
  type ThemeMode,
} from './utils/theme';

const LOCAL_STORAGE_KEY = 'cinearchive.collection.v2';
const COLLECTOR_STORAGE_KEY = 'cinearchive.collector.v1';
const VIEW_MODE_STORAGE_KEY = 'cinearchive.viewMode.v1';

function loadViewMode(): ArchiveViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list'
      ? 'list'
      : 'grid';
  } catch {
    return 'grid';
  }
}

const EMPTY_COLLECTOR: CollectorState = {
  checkInDates: [],
  albums: [],
};

function loadLocalFallback(): ArchiveItem[] | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return (parsed as ArchiveItem[]).filter(
      (item) => typeof item?.id === 'string' && !item.id.startsWith('seed-')
    );
  } catch {
    return null;
  }
}

function saveLocalFallback(items: ArchiveItem[]): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function loadLocalCollector(): CollectorState {
  try {
    const raw = window.localStorage.getItem(COLLECTOR_STORAGE_KEY);
    if (!raw) return EMPTY_COLLECTOR;
    const parsed = JSON.parse(raw) as Partial<CollectorState>;
    return {
      checkInDates: Array.isArray(parsed?.checkInDates)
        ? parsed.checkInDates
        : [],
      albums: Array.isArray(parsed?.albums) ? parsed.albums : [],
      ...(parsed?.showcase
        ? { showcase: normalizeShowcaseConfig(parsed.showcase) }
        : {}),
    };
  } catch {
    return EMPTY_COLLECTOR;
  }
}

function saveLocalCollector(state: CollectorState): void {
  try {
    window.localStorage.setItem(COLLECTOR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

const LIBRARY_CATS: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'film', label: '影视' },
  { id: 'person', label: '影人' },
  { id: 'character', label: '角色' },
];

export default function App() {
  const initialLocalItemsRef = useRef<ArchiveItem[] | null>(null);
  if (initialLocalItemsRef.current === null) {
    initialLocalItemsRef.current = loadLocalFallback() ?? [];
  }
  const initialLocalCollectorRef = useRef<CollectorState | null>(null);
  if (initialLocalCollectorRef.current === null) {
    initialLocalCollectorRef.current = loadLocalCollector();
  }
  const initialUiStateRef = useRef(loadPersistedUiState());

  const [items, setItems] = useState<ArchiveItem[]>(
    () => initialLocalItemsRef.current ?? []
  );
  const [collector, setCollector] = useState<CollectorState>(
    () => initialLocalCollectorRef.current ?? EMPTY_COLLECTOR
  );
  const [activeTab, setActiveTab] = useState<AppTab>(
    () => initialUiStateRef.current.activeTab ?? 'library'
  );

  // Library filters
  const [activeCategory, setActiveCategory] = useState<'all' | ArchiveCategory>(
    () => initialUiStateRef.current.activeCategory ?? 'all'
  );
  const [statusFilter, setStatusFilter] = useState<'all' | CollectionStatus>(
    () => initialUiStateRef.current.statusFilter ?? 'all'
  );
  const [activeTag, setActiveTag] = useState(
    () => initialUiStateRef.current.activeTag ?? ''
  );
  const [activeAlbumId, setActiveAlbumId] = useState(
    () => initialUiStateRef.current.activeAlbumId ?? ''
  );
  const [libraryQuery, setLibraryQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>(
    () => initialUiStateRef.current.sortBy ?? 'recent'
  );
  const [decadeFilter, setDecadeFilter] = useState<DecadeFilterOption>('all');
  const [regionFilter, setRegionFilter] = useState('');
  const [ratingBucketFilter, setRatingBucketFilter] =
    useState<RatingBucketFilterOption>('all');
  const [completenessFilter, setCompletenessFilter] =
    useState<CompletenessFilterOption>('all');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const [viewMode, setViewMode] = useState<ArchiveViewMode>(() => loadViewMode());
  const [theme, setTheme] = useState<ThemeMode>(() => loadSavedTheme());
  const quickSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    applyThemeToDocument(theme);
    saveThemePreference(theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => toggleThemeMode(prev));
  };

  // Batch curation state
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [locatedItemId, setLocatedItemId] = useState<string | null>(null);
  const [locatedJumpTick, setLocatedJumpTick] = useState(0);
  const skipNextTabScrollTopRef = useRef(false);

  // Handoff state to Search / Create tabs
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  const [pendingSearchCategory, setPendingSearchCategory] = useState<ArchiveCategory>('film');
  const [pendingCreateTitle, setPendingCreateTitle] = useState('');
  const [pendingCreateCategory, setPendingCreateCategory] = useState<ArchiveCategory>('film');
  const [pendingCreateRelatedIds, setPendingCreateRelatedIds] = useState<string[]>([]);
  const [pendingCreateWorkTitle, setPendingCreateWorkTitle] = useState('');

  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => {
    const savedId = initialUiStateRef.current.selectedItemId;
    if (!savedId) return null;
    const localItems = initialLocalItemsRef.current ?? [];
    return localItems.some((it) => it.id === savedId) ? savedId : null;
  });
  const [cardModalItemId, setCardModalItemId] = useState<string | null>(null);
  const [encounterOpen, setEncounterOpen] = useState(false);
  const [encounterInitialMode, setEncounterInitialMode] =
    useState<EncounterMode>('all');
  const [encounterItemId, setEncounterItemId] = useState<string | null>(null);
  const [encounterDrawCount, setEncounterDrawCount] = useState(0);
  const [posterWallConfig, setPosterWallConfig] = useState<{
    open: boolean;
    itemIds?: string[];
    title?: string;
  }>({ open: false });
  const [quotesWallOpen, setQuotesWallOpen] = useState(false);
  const [globalMapOpen, setGlobalMapOpen] = useState(false);
  const [globalMapInitialId, setGlobalMapInitialId] = useState<string | null>(null);
  const [showcaseCustomizerOpen, setShowcaseCustomizerOpen] = useState(false);
  const [showcaseCustomizerTab, setShowcaseCustomizerTab] = useState<
    'primary' | 'secondary'
  >('primary');
  const [editingAlbum, setEditingAlbum] = useState<CollectorAlbum | null>(null);
  const [pendingLinkSuggestion, setPendingLinkSuggestion] = useState<{
    sourceItemId: string;
    recommendations: LinkRecommendation[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(() =>
    getRuntimeModeSync()
  );
  const [hydrated, setHydrated] = useState(
    () =>
      getRuntimeModeSync() === 'static' ||
      (initialLocalItemsRef.current?.length ?? 0) > 0
  );
  const runtimeModeRef = useRef<RuntimeMode>(runtimeMode);
  const [todayKey, setTodayKey] = useState(() => formatLocalDateKey());
  const [reminderPrefs, setReminderPrefs] = useState<CheckInReminderPrefs>(() =>
    loadCheckInReminderPrefs()
  );
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermissionState>(() =>
      getBrowserNotificationPermission()
    );
  const hydratedRef = useRef(
    getRuntimeModeSync() === 'static' ||
      (initialLocalItemsRef.current?.length ?? 0) > 0
  );
  const unlockedStampsRef = useRef<Set<string>>(
    new Set(
      computeCollectorStamps(
        initialLocalItemsRef.current ?? [],
        initialLocalCollectorRef.current ?? EMPTY_COLLECTOR,
        formatLocalDateKey()
      )
        .filter((s) => s.unlocked)
        .map((s) => s.id)
    )
  );
  const medalTiersRef = useRef<Map<string, MedalTier>>(
    new Map(
      computeCinemaMedals(initialLocalItemsRef.current ?? []).map((m) => [
        m.id,
        m.tier,
      ])
    )
  );

  useEffect(() => {
    if (skipNextTabScrollTopRef.current) {
      skipNextTabScrollTopRef.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  // Persist lightweight UI session state so returning to the iOS PWA restores
  // the exact tab, filters, and open detail drawer without feeling like a reload.
  useEffect(() => {
    savePersistedUiState({
      activeTab,
      activeCategory,
      statusFilter,
      activeTag,
      activeAlbumId,
      sortBy,
      selectedItemId,
    });
  }, [
    activeTab,
    activeCategory,
    statusFilter,
    activeTag,
    activeAlbumId,
    sortBy,
    selectedItemId,
  ]);

  // Sync collection & collector rituals with Express backend when available,
  // or operate instantaneously on browser localStorage when deployed statically (GitHub Pages / PWA).
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const mode = await detectRuntimeMode();
        if (cancelled) return;
        runtimeModeRef.current = mode;
        setRuntimeMode((prev) => (prev === mode ? prev : mode));

        let loadedItems = loadLocalFallback() ?? [];
        let loadedCollector = loadLocalCollector();

        if (mode === 'server') {
          const [colRes, collectorRes] = await Promise.all([
            fetch('/api/collection'),
            fetch('/api/collector'),
          ]);
          if (cancelled) return;

          if (colRes.ok) {
            const data = (await colRes.json()) as {
              initialized: boolean;
              items: ArchiveItem[];
            };
            if (data.initialized) {
              const prevJson = JSON.stringify(loadedItems);
              const nextJson = JSON.stringify(data.items);
              loadedItems = data.items;
              if (prevJson !== nextJson) {
                setItems(data.items);
                saveLocalFallback(data.items);
              }
            } else {
              saveLocalFallback(loadedItems);
              await fetch('/api/collection/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: loadedItems }),
              });
            }
          }

          if (collectorRes.ok) {
            const cData = (await collectorRes.json()) as Partial<CollectorState>;
            const serverDates = Array.isArray(cData.checkInDates)
              ? cData.checkInDates
              : [];
            const serverAlbums = Array.isArray(cData.albums)
              ? cData.albums
              : [];
            const serverShowcase = cData.showcase
              ? normalizeShowcaseConfig(cData.showcase)
              : undefined;
            if (
              serverDates.length > 0 ||
              serverAlbums.length > 0 ||
              serverShowcase
            ) {
              const nextCollector: CollectorState = {
                checkInDates: serverDates,
                albums: serverAlbums,
                ...(serverShowcase ? { showcase: serverShowcase } : {}),
              };
              if (
                JSON.stringify(loadedCollector) !== JSON.stringify(nextCollector)
              ) {
                loadedCollector = nextCollector;
                setCollector(loadedCollector);
                saveLocalCollector(loadedCollector);
              }
            }
          }
        }

        const initialStamps = computeCollectorStamps(
          loadedItems,
          loadedCollector,
          formatLocalDateKey()
        );
        unlockedStampsRef.current = new Set(
          initialStamps.filter((s) => s.unlocked).map((s) => s.id)
        );
        const initialMedals = computeCinemaMedals(loadedItems);
        medalTiersRef.current = new Map(
          initialMedals.map((m) => [m.id, m.tier])
        );
        hydratedRef.current = true;
        setHydrated(true);
      } catch {
        hydratedRef.current = true;
        setHydrated(true);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lightweight daily midnight timer + tab-focus refresh so check-in status automatically rolls over
  useEffect(() => {
    let timerId: number | undefined;

    const scheduleMidnightRefresh = () => {
      const waitMs = msUntilNextLocalMidnight(new Date());
      timerId = window.setTimeout(() => {
        setTodayKey(formatLocalDateKey());
        scheduleMidnightRefresh();
      }, waitMs);
    };

    scheduleMidnightRefresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const currentKey = formatLocalDateKey();
        setTodayKey((prev) => (prev === currentKey ? prev : currentKey));
        setNotificationPermission(getBrowserNotificationPermission());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Celebrate newly unlocked / upgraded cinema medals & archival stamps cleanly
  useEffect(() => {
    if (!hydratedRef.current) return;

    const currentMedals = computeCinemaMedals(items);
    const medalEvents = detectNewOrUpgradedMedals(
      medalTiersRef.current,
      currentMedals
    );
    medalTiersRef.current = new Map(
      currentMedals.map((m) => [m.id, m.tier])
    );

    const stamps = computeCollectorStamps(items, collector, formatLocalDateKey());
    const newlyUnlocked = stamps.filter(
      (s) => s.unlocked && !unlockedStampsRef.current.has(s.id)
    );
    for (const s of stamps) {
      if (s.unlocked) unlockedStampsRef.current.add(s.id);
    }

    if (medalEvents.length > 0) {
      const topEvent = medalEvents[0];
      setNotice(
        topEvent.kind === 'upgraded'
          ? `影藏勋章「${topEvent.medal.shortTitle}」晋升至${topEvent.medal.tierLabel}`
          : `已解锁影藏勋章「${topEvent.medal.title}」`
      );
    } else if (newlyUnlocked.length > 0) {
      setNotice(`已点亮馆藏印记「${newlyUnlocked[0].title}」`);
    }
  }, [items, collector]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  // Prevent background page scroll / horizontal drift on iOS Safari while full-screen sheet or modal is open
  const hasBlockingOverlay = Boolean(
    selectedItemId ||
      cardModalItemId ||
      encounterOpen ||
      posterWallConfig.open ||
      quotesWallOpen ||
      globalMapOpen ||
      showcaseCustomizerOpen ||
      editingAlbum
  );
  useEffect(() => {
    if (!hasBlockingOverlay) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [hasBlockingOverlay]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Ignore storage errors
    }
  }, [viewMode]);

  // Global "/" shortcut to jump directly to library search on desktop
  useEffect(() => {
    if (activeTab !== 'library' || hasBlockingOverlay) return;
    const handleSlashFocus = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      quickSearchInputRef.current?.focus();
      quickSearchInputRef.current?.select();
    };
    window.addEventListener('keydown', handleSlashFocus);
    return () => window.removeEventListener('keydown', handleSlashFocus);
  }, [activeTab, hasBlockingOverlay]);

  const dailyReminder = useMemo(
    () =>
      evaluateDailyCheckInReminder(
        collector.checkInDates,
        todayKey,
        reminderPrefs
      ),
    [collector.checkInDates, todayKey, reminderPrefs]
  );

  // Fire optional Browser Notification API reminder once per day on initial entry / rollover
  useEffect(() => {
    if (!hydrated) return;
    if (!dailyReminder.shouldFireBrowserNotification) return;
    if (notificationPermission !== 'granted') return;

    const sent = sendBrowserCheckInNotification(
      todayKey,
      '光影志 · 今日巡馆盖章提醒',
      dailyReminder.encouragement
    );
    if (sent) {
      const updated: CheckInReminderPrefs = {
        ...reminderPrefs,
        lastNotifiedDate: todayKey,
      };
      setReminderPrefs(updated);
      saveCheckInReminderPrefs(updated);
    }
  }, [hydrated, dailyReminder, notificationPermission, todayKey, reminderPrefs]);

  const handleDismissReminderToday = () => {
    const updated: CheckInReminderPrefs = {
      ...reminderPrefs,
      dismissedDate: todayKey,
    };
    setReminderPrefs(updated);
    saveCheckInReminderPrefs(updated);
  };

  const handleToggleBrowserNotify = async () => {
    const perm = getBrowserNotificationPermission();
    setNotificationPermission(perm);

    if (perm === 'unsupported') {
      setNotice('当前浏览器暂不支持系统通知，已使用站内横幅提醒');
      return;
    }

    if (reminderPrefs.browserNotifyEnabled && perm === 'granted') {
      const updated: CheckInReminderPrefs = {
        ...reminderPrefs,
        browserNotifyEnabled: false,
      };
      setReminderPrefs(updated);
      saveCheckInReminderPrefs(updated);
      setNotice('已关闭浏览器每日巡馆通知');
      return;
    }

    if (perm === 'denied') {
      setNotice('浏览器通知权限已被禁用，可在站点设置中重新允许');
      return;
    }

    try {
      const nextPerm =
        perm === 'granted'
          ? 'granted'
          : await window.Notification.requestPermission();
      setNotificationPermission(nextPerm);

      if (nextPerm === 'granted') {
        const updated: CheckInReminderPrefs = {
          ...reminderPrefs,
          browserNotifyEnabled: true,
          lastNotifiedDate: todayKey,
        };
        setReminderPrefs(updated);
        saveCheckInReminderPrefs(updated);
        sendBrowserCheckInNotification(
          todayKey,
          '光影志 · 每日巡馆提醒已开启',
          '每日首次打开藏馆未打卡时，将为你送出轻提醒。'
        );
        setNotice('已开启浏览器每日巡馆通知');
      } else {
        setNotice('未授予通知权限，将继续通过站内轻横幅提醒');
      }
    } catch {
      setNotice('当前环境受限，将继续通过站内轻横幅提醒');
    }
  };

  const stats = useMemo(() => computeArchiveStats(items), [items]);
  const tagRegistry = useMemo(() => collectTagRegistry(items), [items]);
  const regionRegistry = useMemo(() => extractRegionRegistry(items), [items]);
  const activeAlbum = useMemo(
    () => collector.albums.find((a) => a.id === activeAlbumId) ?? null,
    [collector.albums, activeAlbumId]
  );

  const displayItems = useMemo(() => items.map(localizeArchivedFilm), [items]);

  const filteredItems = useMemo(() => {
    const baseItems = activeAlbum ? resolveAlbumItems(activeAlbum, displayItems) : displayItems;
    return filterAndSortItems(baseItems, {
      category: activeCategory,
      status: statusFilter,
      tag: activeTag,
      query: libraryQuery,
      sortBy,
      decade: decadeFilter,
      region: regionFilter,
      ratingBucket: ratingBucketFilter,
      completeness: completenessFilter,
    });
  }, [
    displayItems,
    activeAlbum,
    activeCategory,
    statusFilter,
    activeTag,
    libraryQuery,
    sortBy,
    decadeFilter,
    regionFilter,
    ratingBucketFilter,
    completenessFilter,
  ]);

  const selectedItem = useMemo(
    () => displayItems.find((i) => i.id === selectedItemId) ?? null,
    [displayItems, selectedItemId]
  );

  const locatedItem = useMemo(
    () =>
      locatedItemId
        ? filteredItems.find((i) => i.id === locatedItemId) ?? null
        : null,
    [filteredItems, locatedItemId]
  );

  const cardModalItem = useMemo(
    () => displayItems.find((i) => i.id === cardModalItemId) ?? null,
    [displayItems, cardModalItemId]
  );

  const encounterItem = useMemo(
    () => displayItems.find((i) => i.id === encounterItemId) ?? null,
    [displayItems, encounterItemId]
  );

  const handleTriggerRandomEncounter = () => {
    const picked = pickRandomEncounterItem(items, encounterItemId ?? undefined);
    if (!picked) {
      setNotice('藏馆暂无条目，先联网收录几件吧');
      return;
    }
    setEncounterInitialMode('all');
    setEncounterItemId(picked.id);
    setEncounterDrawCount((n) => n + 1);
    setEncounterOpen(true);
  };

  const handleOpenWatchlistBlindBox = () => {
    if (items.length === 0) {
      setNotice('藏馆暂无条目，先联网收录几件吧');
      return;
    }
    const picked = pickRandomEncounterItem(items, encounterItemId ?? undefined);
    if (picked && !encounterItemId) {
      setEncounterItemId(picked.id);
    }
    setEncounterInitialMode('watchlist');
    setEncounterOpen(true);
  };

  const persistCollector = async (nextState: CollectorState) => {
    setCollector(nextState);
    saveLocalCollector(nextState);
    if (runtimeModeRef.current !== 'server') return;
    try {
      const res = await fetch('/api/collector', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextState),
      });
      if (res.ok) {
        const data = (await res.json()) as CollectorState;
        setCollector(data);
        saveLocalCollector(data);
      }
    } catch {
      // Saved locally
    }
  };

  const handleCheckInToday = async () => {
    const todayKey = formatLocalDateKey();
    const { dates, added } = recordCheckIn(collector.checkInDates, todayKey);
    if (!added) {
      const streak = computeCheckInStreak(dates, todayKey);
      setNotice(`今日已巡馆盖章 · 已连续 ${streak.currentStreak} 天`);
      return;
    }
    const nextState: CollectorState = { ...collector, checkInDates: dates };
    await persistCollector(nextState);
    const streak = computeCheckInStreak(dates, todayKey);
    setNotice(`今日巡馆已盖章 · 连续 ${streak.currentStreak} 天`);
  };

  const handleCreateAlbum = async (draft: {
    name: string;
    tag?: string;
    targetCount: number;
  }) => {
    const newAlbum: CollectorAlbum = {
      id: `alb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: draft.name.trim(),
      tag: draft.tag?.trim() || undefined,
      targetCount: Math.max(1, draft.targetCount),
      createdAt: new Date().toISOString(),
    };
    const nextState: CollectorState = {
      ...collector,
      albums: [newAlbum, ...collector.albums],
    };
    await persistCollector(nextState);
    setNotice(`已创建专题图鉴「${newAlbum.name}」`);
  };

  const handleDeleteAlbum = async (albumId: string) => {
    const target = collector.albums.find((a) => a.id === albumId);
    const nextState: CollectorState = {
      ...collector,
      albums: collector.albums.filter((a) => a.id !== albumId),
    };
    if (activeAlbumId === albumId) setActiveAlbumId('');
    await persistCollector(nextState);
    if (target) setNotice(`已移除图鉴「${target.name}」`);
  };

  const handleSaveEditedAlbum = async (updated: CollectorAlbum) => {
    const nextState: CollectorState = {
      ...collector,
      albums: collector.albums.map((a) => (a.id === updated.id ? updated : a)),
    };
    await persistCollector(nextState);
    setNotice(`已更新专题图鉴「${updated.name}」`);
  };

  const handleSaveShowcase = async (nextConfig: ShowcaseConfig) => {
    const normalized = normalizeShowcaseConfig(nextConfig);
    const nextState: CollectorState = {
      ...collector,
      showcase: normalized,
    };
    await persistCollector(nextState);
    setNotice('已更新藏馆顶部展示区内容');
  };

  const handleTogglePinShowcase = async (target: ArchiveItem) => {
    const current = normalizeShowcaseConfig(collector.showcase);
    const alreadyPinned =
      current.primaryMode === 'pinned' && current.pinnedItemId === target.id;
    const nextShowcase: ShowcaseConfig = alreadyPinned
      ? {
          ...current,
          primaryMode: 'daily',
          pinnedItemId: undefined,
        }
      : {
          ...current,
          primaryMode: 'pinned',
          pinnedItemId: target.id,
          customTitle: undefined,
          customSubtitle: undefined,
          customCoverUrl: undefined,
          customLinkItemId: undefined,
        };
    await persistCollector({
      ...collector,
      showcase: normalizeShowcaseConfig(nextShowcase),
    });
    setNotice(
      alreadyPinned
        ? `已取消「${target.title}」顶栏置顶，恢复每日藏签`
        : `已将「${target.title}」设为藏馆顶部主展位`
    );
  };

  const handleToggleBatchSelect = (id: string) => {
    setBatchSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleBatchStatus = async (status: CollectionStatus) => {
    if (batchSelectedIds.length === 0) return;
    const { items: nextItems, updatedCount } = applyBatchStatusUpdate(
      items,
      batchSelectedIds,
      status
    );
    await persistSnapshot(nextItems);
    setNotice(
      updatedCount > 0
        ? `已批量更新 ${updatedCount} 件档案状态`
        : '所选档案已是该状态'
    );
    setBatchSelectedIds([]);
  };

  const handleBatchAddTag = async (tag: string) => {
    if (batchSelectedIds.length === 0 || !tag.trim()) return;
    const { items: nextItems, updatedCount } = applyBatchTagAdd(
      items,
      batchSelectedIds,
      tag
    );
    await persistSnapshot(nextItems);
    setNotice(
      updatedCount > 0
        ? `已为 ${updatedCount} 件档案添加标签「${tag.trim()}」`
        : `所选档案均已包含标签「${tag.trim()}」`
    );
    setBatchSelectedIds([]);
  };

  const handleBatchAddToAlbum = async (albumId: string) => {
    if (batchSelectedIds.length === 0) return;
    const targetAlbum = collector.albums.find((a) => a.id === albumId);
    if (!targetAlbum) return;
    const { albums: nextAlbums, addedCount } = applyBatchAddToAlbum(
      collector.albums,
      albumId,
      batchSelectedIds
    );
    await persistCollector({ ...collector, albums: nextAlbums });
    setNotice(
      addedCount > 0
        ? `已将 ${addedCount} 件档案收入图鉴「${targetAlbum.name}」`
        : `所选档案已在图鉴「${targetAlbum.name}」中`
    );
    setBatchSelectedIds([]);
  };

  const persistSnapshot = async (nextItems: ArchiveItem[]) => {
    setItems(nextItems);
    saveLocalFallback(nextItems);
    if (runtimeModeRef.current !== 'server') return;
    try {
      const res = await fetch('/api/collection/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: nextItems }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items)) {
          setItems(data.items);
          saveLocalFallback(data.items);
        }
      }
    } catch {
      // Saved locally
    }
  };

  const buildItemsWithNewAndBidirectionalLinks = (
    newItem: ArchiveItem,
    currentItems: ArchiveItem[]
  ): ArchiveItem[] => {
    const linkedSet = new Set(newItem.relatedIds);
    const updatedExisting = currentItems.map((existing) => {
      if (!linkedSet.has(existing.id)) return existing;
      if (existing.relatedIds.includes(newItem.id)) return existing;
      return {
        ...existing,
        relatedIds: [...existing.relatedIds, newItem.id],
        updatedAt: newItem.updatedAt,
      };
    });
    return [newItem, ...updatedExisting];
  };

  const triggerPostCollectRecommendations = (
    newItem: ArchiveItem,
    nextItems: ArchiveItem[]
  ) => {
    const recs = findRecommendedUnlinkedItems(newItem, nextItems, 6);
    if (recs.length > 0) {
      setPendingLinkSuggestion({
        sourceItemId: newItem.id,
        recommendations: recs,
      });
    }
  };

  const handleCollectOnlineResult = async (result: OnlineSearchResult) => {
    const existing = findExistingItemByTitle(
      items,
      result.category,
      result.title,
      {
        originalTitle: result.originalTitle,
        sourceUrl: result.sourceUrl,
        year: result.year,
      }
    );
    if (existing) {
      setNotice(`「${existing.title}」已在藏馆中`);
      return;
    }

    const now = new Date().toISOString();
    const newItem: ArchiveItem = {
      id: `arc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accessionNo: nextAccessionNo(items),
      category: result.category,
      title: result.title,
      originalTitle: result.originalTitle,
      subtitle: result.subtitle,
      year: result.year,
      region: result.region,
      coverUrl: formatCoverUrlForMode(result.coverUrl, runtimeModeRef.current),
      summary: result.summary,
      summaryRevision: result.summaryRevision,
      notes: '',
      rating: 0,
      status: result.category === 'film' ? 'watchlist' : 'watched',
      tags: result.tags,
      relatedIds: [],
      relatedWorkTitle: result.relatedWorkTitle,
      portrayedBy: result.portrayedBy,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl,
      createdAt: now,
      updatedAt: now,
    };
    const nextItems = buildItemsWithNewAndBidirectionalLinks(newItem, items);
    await persistSnapshot(nextItems);
    const recs = findRecommendedUnlinkedItems(newItem, nextItems, 6);
    if (recs.length > 0) {
      setPendingLinkSuggestion({
        sourceItemId: newItem.id,
        recommendations: recs,
      });
    } else {
      setNotice(`已收录「${newItem.title}」`);
    }
  };

  const handleCreateManualItem = async (draft: ArchiveDraftInput) => {
    const now = new Date().toISOString();
    const explicitRelatedIds = Array.from(new Set(draft.relatedIds ?? []));
    const newItem: ArchiveItem = {
      id: `arc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accessionNo: nextAccessionNo(items),
      category: draft.category,
      title: draft.title.trim(),
      originalTitle: draft.originalTitle?.trim() || undefined,
      subtitle: draft.subtitle?.trim() || undefined,
      year: draft.year?.trim() || undefined,
      region: draft.region?.trim() || undefined,
      coverUrl: draft.coverUrl?.trim()
        ? formatCoverUrlForMode(draft.coverUrl.trim(), runtimeModeRef.current)
        : undefined,
      summary: draft.summary?.trim() || '',
      quote: draft.quote?.trim() || undefined,
      notes: draft.notes?.trim() || '',
      rating: draft.rating,
      status: draft.status,
      tags: draft.tags,
      relatedIds: explicitRelatedIds,
      relatedWorkTitle: draft.relatedWorkTitle?.trim() || undefined,
      portrayedBy: draft.portrayedBy?.trim() || undefined,
      sourceName: draft.sourceName || '手动建档',
      createdAt: now,
      updatedAt: now,
    };
    const nextItems = buildItemsWithNewAndBidirectionalLinks(newItem, items);
    await persistSnapshot(nextItems);
    const recs = findRecommendedUnlinkedItems(newItem, nextItems, 6);
    if (recs.length > 0) {
      setPendingLinkSuggestion({
        sourceItemId: newItem.id,
        recommendations: recs,
      });
    } else {
      setNotice(
        explicitRelatedIds.length > 0
          ? `已建档「${newItem.title}」并关联 ${explicitRelatedIds.length} 项`
          : `已建档「${newItem.title}」`
      );
    }
    setActiveTab('library');
  };

  const handleLinkMultiple = async (sourceId: string, targetIds: string[]) => {
    const uniqueTargets = Array.from(
      new Set(targetIds.filter((tid) => tid && tid !== sourceId))
    );
    if (uniqueTargets.length === 0) return;

    const targetSet = new Set(uniqueTargets);
    const now = new Date().toISOString();
    const nextItems = items.map((it) => {
      if (it.id === sourceId) {
        return {
          ...it,
          relatedIds: Array.from(new Set([...it.relatedIds, ...uniqueTargets])),
          updatedAt: now,
        };
      }
      if (targetSet.has(it.id)) {
        return {
          ...it,
          relatedIds: Array.from(new Set([...it.relatedIds, sourceId])),
          updatedAt: now,
        };
      }
      return it;
    });
    await persistSnapshot(nextItems);
    if (uniqueTargets.length === 1) {
      const target = items.find((i) => i.id === uniqueTargets[0]);
      setNotice(target ? `已建立关联「${target.title}」` : '已建立关联');
    } else {
      setNotice(`已一键建立 ${uniqueTargets.length} 项双向关联`);
    }
  };

  const handleLinkExisting = async (sourceId: string, targetId: string) => {
    await handleLinkMultiple(sourceId, [targetId]);
  };

  const handleLinkPairs = async (pairs: Array<[string, string]>) => {
    const { nextItems, linkedPairCount } = computeBatchLinkItems(items, pairs);
    if (linkedPairCount === 0) return;
    await persistSnapshot(nextItems);
    setNotice(`已写入 ${linkedPairCount} 条影史关联到馆藏`);
  };

  const handleUnlinkItems = async (sourceId: string, targetId: string) => {
    const now = new Date().toISOString();
    const nextItems = items.map((it) => {
      if (it.id === sourceId) {
        return {
          ...it,
          relatedIds: it.relatedIds.filter((rid) => rid !== targetId),
          updatedAt: now,
        };
      }
      if (it.id === targetId) {
        return {
          ...it,
          relatedIds: it.relatedIds.filter((rid) => rid !== sourceId),
          updatedAt: now,
        };
      }
      return it;
    });
    await persistSnapshot(nextItems);
    setNotice('已取消关联');
  };

  const handleCollectAndLink = async (
    sourceItem: ArchiveItem,
    candidate: OnlineSearchResult
  ) => {
    const existing = findExistingItemByTitle(
      items,
      candidate.category,
      candidate.title,
      {
        originalTitle: candidate.originalTitle,
        sourceUrl: candidate.sourceUrl,
        year: candidate.year,
      }
    );
    if (existing) {
      await handleLinkExisting(sourceItem.id, existing.id);
      return;
    }

    const now = new Date().toISOString();
    const newItem: ArchiveItem = {
      id: `arc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accessionNo: nextAccessionNo(items),
      category: candidate.category,
      title: candidate.title,
      originalTitle: candidate.originalTitle,
      subtitle: candidate.subtitle,
      year: candidate.year,
      region: candidate.region,
      coverUrl: formatCoverUrlForMode(
        candidate.coverUrl,
        runtimeModeRef.current
      ),
      summary: candidate.summary,
      summaryRevision: candidate.summaryRevision,
      notes: '',
      rating: 0,
      status: candidate.category === 'film' ? 'watchlist' : 'watched',
      tags: candidate.tags,
      relatedIds: [sourceItem.id],
      relatedWorkTitle:
        candidate.relatedWorkTitle ||
        (sourceItem.category === 'film' ? sourceItem.title : undefined),
      portrayedBy:
        candidate.portrayedBy ||
        (sourceItem.category === 'person' ? sourceItem.title : undefined),
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      createdAt: now,
      updatedAt: now,
    };

    const nextItems = buildItemsWithNewAndBidirectionalLinks(newItem, items);
    await persistSnapshot(nextItems);
    triggerPostCollectRecommendations(newItem, nextItems);
    setNotice(`已收录并关联「${newItem.title}」`);
  };

  const handleUpdateItem = async (id: string, patch: Partial<ArchiveItem>) => {
    const updatedAt = new Date().toISOString();
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== id) return it;
        const merged = { ...it, ...patch, updatedAt };
        if (patch.coverUrl === '') delete merged.coverUrl;
        return merged;
      });
      saveLocalFallback(next);
      return next;
    });
    if (runtimeModeRef.current !== 'server') return;
    try {
      const res = await fetch(`/api/collection/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items)) {
          setItems(data.items);
          saveLocalFallback(data.items);
        }
      }
    } catch {
      // Local state updated
    }
  };

  const handleQuickUpdateStatus = async (
    item: ArchiveItem,
    nextStatus: CollectionStatus
  ) => {
    const changed = item.status !== nextStatus;
    if (changed) {
      await handleUpdateItem(item.id, { status: nextStatus });
    }
    setNotice(
      buildQuickStatusNotice(item.title, nextStatus, item.category, changed)
    );
  };

  const handleDeleteItem = async (id: string) => {
    const target = items.find((i) => i.id === id);
    setItems((prev) => {
      const next = prev
        .filter((i) => i.id !== id)
        .map((i) => ({
          ...i,
          relatedIds: i.relatedIds.filter((rid) => rid !== id),
        }));
      saveLocalFallback(next);
      return next;
    });
    if (runtimeModeRef.current === 'server') {
      try {
        const res = await fetch(`/api/collection/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items)) {
            setItems(data.items);
            saveLocalFallback(data.items);
          }
        }
      } catch {
        // Local state updated
      }
    }
    if (target) {
      setNotice(`已移除「${target.title}」`);
    }
  };

  const handleReplaceAll = async (nextItems: ArchiveItem[]) => {
    setItems(nextItems);
    saveLocalFallback(nextItems);
    if (runtimeModeRef.current !== 'server') return;
    try {
      await fetch('/api/collection/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: nextItems }),
      });
    } catch {
      // Saved locally
    }
  };

  const jumpToSearch = (prefillQuery?: string, cat?: ArchiveCategory) => {
    setPendingSearchCategory(
      cat ?? (activeCategory === 'all' ? 'film' : activeCategory)
    );
    if (prefillQuery && prefillQuery.trim()) {
      setPendingSearchQuery(prefillQuery.trim());
    }
    setActiveTab('search');
  };

  const jumpToCreate = (
    prefillTitle = '',
    cat?: ArchiveCategory,
    relatedIds: string[] = [],
    relatedWorkTitle = ''
  ) => {
    setPendingCreateTitle(prefillTitle);
    setPendingCreateCategory(
      cat ?? (activeCategory === 'all' ? 'film' : activeCategory)
    );
    setPendingCreateRelatedIds(relatedIds);
    setPendingCreateWorkTitle(relatedWorkTitle);
    setActiveTab('create');
  };

  const handleQuickCreateRelated = (
    sourceItem: ArchiveItem,
    targetCategory: ArchiveCategory
  ) => {
    setSelectedItemId(null);
    jumpToCreate(
      '',
      targetCategory,
      [sourceItem.id],
      sourceItem.category === 'film' ? sourceItem.title : ''
    );
  };

  const handleQuickBarSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (libraryQuery.trim()) {
      jumpToSearch(libraryQuery.trim());
    } else {
      jumpToSearch();
    }
  };

  const handleResetFilters = () => {
    setActiveCategory('all');
    setStatusFilter('all');
    setActiveTag('');
    setActiveAlbumId('');
    setLibraryQuery('');
    setSortBy('recent');
    setDecadeFilter('all');
    setRegionFilter('');
    setRatingBucketFilter('all');
    setCompletenessFilter('all');
    setLocatedItemId(null);
  };

  const applyCrossJumpState = (next: CrossJumpLibraryState) => {
    setSelectedItemId(null);
    if (activeTab !== 'library') {
      skipNextTabScrollTopRef.current = true;
    }
    setBatchMode(false);
    setBatchSelectedIds([]);
    setActiveTab(next.activeTab);
    setActiveCategory(next.activeCategory);
    setStatusFilter(next.statusFilter);
    setActiveAlbumId(next.activeAlbumId);
    setActiveTag(next.activeTag);
    setLibraryQuery(next.libraryQuery);
    setDecadeFilter(next.decadeFilter);
    setRegionFilter(next.regionFilter);
    setRatingBucketFilter(next.ratingBucketFilter);
    setCompletenessFilter(next.completenessFilter);
    setLocatedItemId(next.locatedItemId);
    setLocatedJumpTick((n) => n + 1);
    setNotice(next.notice);
  };

  const handleFilterByTag = (tag: string, focusItemId?: string) => {
    if (focusItemId) {
      const targetItem = displayItems.find((it) => it.id === focusItemId);
      const next = buildCrossJumpLibraryState({
        kind: 'tag',
        tag,
        itemId: focusItemId,
        itemTitle: targetItem?.title || '当前条目',
      });
      applyCrossJumpState(next);
      return;
    }

    setSelectedItemId(null);
    setActiveTab('library');
    setActiveCategory('all');
    setStatusFilter('all');
    setActiveAlbumId('');
    setLibraryQuery('');
    setDecadeFilter('all');
    setRegionFilter('');
    setRatingBucketFilter('all');
    setCompletenessFilter('all');
    setActiveTag(tag);
    setLocatedItemId(null);
  };

  const handleFilterByCategory = (category: ArchiveCategory) => {
    setSelectedItemId(null);
    setActiveTab('library');
    setActiveCategory(category);
    setStatusFilter('all');
    setActiveAlbumId('');
    setActiveTag('');
    setLibraryQuery('');
    setDecadeFilter('all');
    setRegionFilter('');
    setRatingBucketFilter('all');
    setCompletenessFilter('all');
    setLocatedItemId(null);
  };

  const handleJumpToAlbumFromDrawer = (
    albumId: string,
    focusItemId: string
  ) => {
    const targetAlbum = collector.albums.find((a) => a.id === albumId);
    if (!targetAlbum) return;
    const targetItem = displayItems.find((it) => it.id === focusItemId);
    const next = buildCrossJumpLibraryState({
      kind: 'album',
      albumId,
      albumName: targetAlbum.name,
      itemId: focusItemId,
      itemTitle: targetItem?.title || '当前条目',
    });
    applyCrossJumpState(next);
  };

  const handleAddItemToAlbumFromDrawer = async (
    albumId: string,
    itemId: string
  ) => {
    const targetAlbum = collector.albums.find((a) => a.id === albumId);
    if (!targetAlbum) return;
    const { albums: nextAlbums, addedCount } = applyBatchAddToAlbum(
      collector.albums,
      albumId,
      [itemId]
    );
    await persistCollector({ ...collector, albums: nextAlbums });
    setNotice(
      addedCount > 0
        ? `已收入收藏夹「${targetAlbum.name}」`
        : `已在收藏夹「${targetAlbum.name}」中`
    );
  };

  const activeAdvancedFilterCount = useMemo(() => {
    let n = 0;
    if (decadeFilter !== 'all') n += 1;
    if (regionFilter.trim()) n += 1;
    if (ratingBucketFilter !== 'all') n += 1;
    if (completenessFilter !== 'all') n += 1;
    return n;
  }, [decadeFilter, regionFilter, ratingBucketFilter, completenessFilter]);

  const activeFilterCount = useMemo(
    () =>
      countActiveLibraryFilters({
        category: activeCategory,
        status: statusFilter,
        tag: activeTag,
        albumId: activeAlbumId,
        query: libraryQuery,
        sortBy,
        decade: decadeFilter,
        region: regionFilter,
        ratingBucket: ratingBucketFilter,
        completeness: completenessFilter,
      }),
    [
      activeCategory,
      statusFilter,
      activeTag,
      activeAlbumId,
      libraryQuery,
      sortBy,
      decadeFilter,
      regionFilter,
      ratingBucketFilter,
      completenessFilter,
    ]
  );

  // Ensure strictly at most one daily check-in CTA is shown per screen:
  // When CollectorSpotlightRail (library with items) or Profile passport card is visible,
  // it already hosts the primary check-in action.
  const hasInPageCheckInCta =
    (activeTab === 'library' &&
      (items.length > 0 || collector.showcase?.primaryMode === 'custom')) ||
    activeTab === 'profile';
  const showDailyBanner =
    hydrated && dailyReminder.shouldShowBanner && !hasInPageCheckInCta;
  const showTopCheckInIcon =
    hydrated &&
    dailyReminder.shouldShowTopIcon &&
    !showDailyBanner &&
    !hasInPageCheckInCta;

  const drawerNavList = useMemo(() => {
    if (!selectedItemId) return displayItems;
    return filteredItems.some((it) => it.id === selectedItemId)
      ? filteredItems
      : displayItems;
  }, [filteredItems, displayItems, selectedItemId]);

  const prevDrawerItem = useMemo(
    () =>
      selectedItem
        ? getAdjacentArchiveItem(drawerNavList, selectedItem.id, 'prev')
        : null,
    [drawerNavList, selectedItem]
  );
  const nextDrawerItem = useMemo(
    () =>
      selectedItem
        ? getAdjacentArchiveItem(drawerNavList, selectedItem.id, 'next')
        : null,
    [drawerNavList, selectedItem]
  );
  const drawerPositionLabel = useMemo(() => {
    if (!selectedItem || drawerNavList.length <= 1) return undefined;
    const idx = drawerNavList.findIndex((it) => it.id === selectedItem.id);
    return idx >= 0 ? `${idx + 1} / ${drawerNavList.length}` : undefined;
  }, [drawerNavList, selectedItem]);

  return (
    <div className="flex min-h-[100dvh] w-full max-w-full flex-col overflow-x-clip bg-[#F7F5F0] text-[#1A1816] transition-colors duration-200 dark:bg-[#141210] dark:text-[#F3EFE6]">
      <AppTopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        totalCount={stats.total}
        needsDailyCheckIn={showTopCheckInIcon}
        onQuickCheckIn={() => void handleCheckInToday()}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      <main className="w-full min-w-0 flex-1">
        {showDailyBanner && (
          <DailyCheckInBanner
            reminder={dailyReminder}
            browserNotifyEnabled={reminderPrefs.browserNotifyEnabled}
            notificationPermission={notificationPermission}
            onCheckInToday={handleCheckInToday}
            onToggleBrowserNotify={handleToggleBrowserNotify}
            onDismissToday={handleDismissReminderToday}
          />
        )}

        {activeTab === 'library' && (
          <>
            {/* Collector Daily Ritual & Themed Albums Shelf */}
            <CollectorSpotlightRail
              items={displayItems}
              collector={collector}
              activeAlbumId={activeAlbumId}
              onCheckInToday={handleCheckInToday}
              onOpenDetail={(it) => setSelectedItemId(it.id)}
              onOpenCardModal={(it) => setCardModalItemId(it.id)}
              onTriggerRandomEncounter={handleTriggerRandomEncounter}
              onSelectAlbum={(albumId) => {
                setActiveAlbumId(albumId);
                if (albumId) setActiveTag('');
                setLocatedItemId(null);
              }}
              onCreateAlbum={handleCreateAlbum}
              onDeleteAlbum={handleDeleteAlbum}
              onEditAlbum={(alb) => setEditingAlbum(alb)}
              onExportAlbumPoster={(alb, matched) =>
                setPosterWallConfig({
                  open: true,
                  itemIds: matched.map((m) => m.id),
                  title: alb.name,
                })
              }
              onJumpToSearch={jumpToSearch}
              onJumpToProfile={() => setActiveTab('profile')}
              onOpenShowcaseCustomizer={(tab = 'primary') => {
                setShowcaseCustomizerTab(tab);
                setShowcaseCustomizerOpen(true);
              }}
              onFilterFavorites={() => {
                setStatusFilter('favorite');
                setActiveAlbumId('');
              }}
              onOpenQuotesWall={() => setQuotesWallOpen(true)}
            />

            {/* Unified Curatorial Atelier Ribbon (Single Architectural Surface, Zero Floating Pill Soup) */}
            {items.length > 0 && (
              <section
                aria-label="策展与视觉工坊"
                data-testid="gallery-studio-bar"
                className="mx-auto max-w-[1180px] px-4 pt-3.5 min-[420px]:px-5 md:px-8 md:pt-4"
              >
                <div className="grid grid-cols-4 divide-x divide-[#EAE4D8] overflow-hidden rounded-xl border border-[#E5DFD3] bg-[#FFFDF9]/92 shadow-[0_1px_2px_rgba(26,24,22,0.025)] dark:divide-[#2C2721] dark:border-[#2F2A24] dark:bg-[#1B1815]/92">
                  <button
                    type="button"
                    data-testid="studio-watchlist-blindbox-btn"
                    onClick={handleOpenWatchlistBlindBox}
                    className="group flex min-h-[54px] flex-col items-center justify-center gap-1 px-2 py-2 text-[#1A1816] cursor-pointer transition-colors hover:bg-[#F7F3EA] active:bg-[#EFEAE0] sm:min-h-[46px] sm:flex-row sm:gap-2.5 sm:px-3 dark:text-[#F3EFE6] dark:hover:bg-[#231F1A]"
                  >
                    <Dices className="h-4 w-4 shrink-0 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
                    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-[12px] font-medium sm:text-[13px]">今晚看啥</span>
                      <span className="hidden text-[11px] text-[#8C857B] lg:inline dark:text-[#9A9184]">
                        盲盒选片
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="studio-quotes-wall-btn"
                    onClick={() => setQuotesWallOpen(true)}
                    className="group flex min-h-[54px] flex-col items-center justify-center gap-1 px-2 py-2 text-[#1A1816] cursor-pointer transition-colors hover:bg-[#F7F3EA] active:bg-[#EFEAE0] sm:min-h-[46px] sm:flex-row sm:gap-2.5 sm:px-3 dark:text-[#F3EFE6] dark:hover:bg-[#231F1A]"
                  >
                    <Quote className="h-4 w-4 shrink-0 text-[#9B7228] dark:text-[#E4C37A]" aria-hidden="true" />
                    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-[12px] font-medium sm:text-[13px]">金句本</span>
                      <span className="hidden text-[11px] text-[#8C857B] lg:inline dark:text-[#9A9184]">
                        台词摘录
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="studio-global-map-btn"
                    onClick={() => {
                      setGlobalMapInitialId(null);
                      setGlobalMapOpen(true);
                    }}
                    className="group flex min-h-[54px] flex-col items-center justify-center gap-1 px-2 py-2 text-[#1A1816] cursor-pointer transition-colors hover:bg-[#F7F3EA] active:bg-[#EFEAE0] sm:min-h-[46px] sm:flex-row sm:gap-2.5 sm:px-3 dark:text-[#F3EFE6] dark:hover:bg-[#231F1A]"
                  >
                    <Compass className="h-4 w-4 shrink-0 text-[#467362] dark:text-[#7AB59E]" aria-hidden="true" />
                    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-[12px] font-medium sm:text-[13px]">关系星图</span>
                      <span className="hidden text-[11px] text-[#8C857B] lg:inline dark:text-[#9A9184]">
                        影史脉络
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="studio-poster-wall-btn"
                    onClick={() =>
                      setPosterWallConfig({
                        open: true,
                        itemIds: filteredItems.slice(0, 9).map((i) => i.id),
                        title: activeAlbum ? activeAlbum.name : '我的私人光影志',
                      })
                    }
                    className="group flex min-h-[54px] flex-col items-center justify-center gap-1 px-2 py-2 text-[#1A1816] cursor-pointer transition-colors hover:bg-[#F7F3EA] active:bg-[#EFEAE0] sm:min-h-[46px] sm:flex-row sm:gap-2.5 sm:px-3 dark:text-[#F3EFE6] dark:hover:bg-[#231F1A]"
                  >
                    <Grid3x3 className="h-4 w-4 shrink-0 text-[#3F3A34] dark:text-[#DDD6C9]" aria-hidden="true" />
                    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-[12px] font-medium sm:text-[13px]">海报墙</span>
                      <span className="hidden text-[11px] text-[#8C857B] lg:inline dark:text-[#9A9184]">
                        拼图导出
                      </span>
                    </span>
                  </button>
                </div>
              </section>
            )}

            {/* Archival Catalog Search + Editorial Category & Filter Bar */}
            <section className="mx-auto max-w-[1180px] px-4 pt-4 pb-2 min-[420px]:px-5 md:px-8 md:pt-5">
              {/* Integrated Search Bar (Filter Library OR Submit to Online Search) */}
              <form
                onSubmit={handleQuickBarSubmit}
                className="flex min-w-0 items-center gap-2"
              >
                <div className="relative min-w-0 flex-1">
                  <label htmlFor="library-quick-search" className="sr-only">
                    搜片名、影人、角色或筛查馆藏
                  </label>
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B] dark:text-[#9A9184]"
                    aria-hidden="true"
                  />
                  <input
                    ref={quickSearchInputRef}
                    id="library-quick-search"
                    type="search"
                    enterKeyHint="search"
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder={
                      items.length === 0
                        ? '输入片名、导演、演员或角色，按回车即刻全网收录…'
                        : '筛查馆藏，或回车全网搜片…'
                    }
                    className="h-11 w-full rounded-xl border border-[#DFD9CE] bg-[#FFFDF9] pl-10 pr-10 text-[16px] text-[#1A1816] placeholder:text-[#8E867B] transition-colors focus:border-[#1A1816] focus:bg-white focus:outline-none md:h-10 md:pr-12 md:text-[13px] dark:border-[#342F28] dark:bg-[#1B1815] dark:text-[#F3EFE6] dark:placeholder:text-[#857D71] dark:focus:border-[#D4AF6A] [&::-webkit-search-cancel-button]:hidden"
                  />
                  {libraryQuery ? (
                    <button
                      type="button"
                      onClick={() => setLibraryQuery('')}
                      aria-label="清空输入"
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#625C54] hover:text-[#1A1816] dark:text-[#A59D90] dark:hover:text-[#F3EFE6] cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <kbd
                      aria-hidden="true"
                      className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-[#E4DDD1] bg-[#FAF8F3] px-1.5 py-0.5 font-mono text-[10px] text-[#8C857B] md:inline-block dark:border-[#3A342C] dark:bg-[#24201B] dark:text-[#9A9184]"
                    >
                      /
                    </kbd>
                  )}
                </div>

                <button
                  type="submit"
                  className={`h-11 shrink-0 rounded-xl px-4 text-[14px] font-medium whitespace-nowrap cursor-pointer active:scale-[0.97] transition-colors md:h-10 md:px-4 md:text-[13px] ${
                    libraryQuery.trim().length > 0
                      ? 'bg-[#1A1816] text-white hover:bg-[#B43B2B] dark:bg-[#E4C37A] dark:text-[#161310] dark:hover:bg-[#EED291]'
                      : 'border border-[#D5CEC2] bg-[#FFFDF9] text-[#2A2622] hover:border-[#1A1816] hover:bg-white dark:border-[#3A332C] dark:bg-[#211E1A] dark:text-[#ECE6DC] dark:hover:border-[#E4C37A] dark:hover:text-[#FAF7F0]'
                  }`}
                >
                  联网搜
                </button>
              </form>

              {/* Editorial Underline Category Tabs + Quiet Filter/Sort/View Controls (Only when archive has items) */}
              {items.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 border-b border-[#E4DFD5] pb-3 lg:flex-row lg:items-end lg:justify-between lg:pb-0 dark:border-[#2E2924]">
                  <div
                    role="group"
                    aria-label="藏品分类"
                    className="flex items-center gap-6 overflow-x-auto no-scrollbar border-b border-[#ECE6DA] lg:border-b-0 dark:border-[#2A2520]"
                  >
                    {LIBRARY_CATS.map((cat) => {
                      const active = activeCategory === cat.id;
                      const count =
                        cat.id === 'all'
                          ? stats.total
                          : cat.id === 'film'
                            ? stats.film
                            : cat.id === 'person'
                              ? stats.person
                              : stats.character;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setActiveCategory(cat.id)}
                          className={`relative pb-2.5 pt-1 text-[14px] font-medium tracking-[0.02em] whitespace-nowrap shrink-0 cursor-pointer transition-colors md:pb-3 md:text-[13px] ${
                            active
                              ? 'text-[#1A1816] dark:text-[#FAF7F0]'
                              : 'text-[#746C61] hover:text-[#1A1816] dark:text-[#9E9588] dark:hover:text-[#F3EFE6]'
                          }`}
                        >
                          <span>{cat.label}</span>
                          <span
                            className={`ml-1.5 font-mono text-[11px] tabular-nums ${
                              active
                                ? 'text-[#B43B2B] dark:text-[#E4C37A]'
                                : 'text-[#9A9287] dark:text-[#7D756A]'
                            }`}
                          >
                            {count}
                          </span>
                          <span
                            aria-hidden="true"
                            className={`absolute inset-x-0 -bottom-[1px] h-[2px] bg-[#B43B2B] dark:bg-[#E4C37A] transition-all duration-200 ${
                              active ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end lg:pb-2">
                    <div
                      className={`grid w-full min-w-0 gap-2 sm:flex sm:w-auto sm:items-center ${
                        tagRegistry.length > 0 ? 'grid-cols-3' : 'grid-cols-2'
                      }`}
                    >
                      <label htmlFor="mobile-status-filter" className="sr-only">
                        按状态筛选
                      </label>
                      <select
                        id="mobile-status-filter"
                        value={statusFilter}
                        onChange={(e) =>
                          setStatusFilter(
                            e.target.value as 'all' | CollectionStatus
                          )
                        }
                        className="h-10 min-w-0 w-full rounded-lg border border-[#E2DCD1] bg-[#FFFDF9] px-2.5 text-[16px] font-medium text-[#2A2622] focus:border-[#1A1816] focus:outline-none sm:h-8 sm:w-auto sm:px-2.5 md:text-xs dark:border-[#342F28] dark:bg-[#1B1815] dark:text-[#E8E2D7] dark:focus:border-[#D4AF6A]"
                      >
                        <option value="all">全部状态</option>
                        <option value="favorite">挚爱</option>
                        <option value="watched">已看 / 已收录</option>
                        <option value="watching">在追 / 关注中</option>
                        <option value="watchlist">想看 / 待补档</option>
                      </select>

                      {tagRegistry.length > 0 && (
                        <>
                          <label htmlFor="mobile-tag-filter" className="sr-only">
                            按标签筛选
                          </label>
                          <select
                            id="mobile-tag-filter"
                            value={activeTag}
                            onChange={(e) => setActiveTag(e.target.value)}
                            className={`h-10 min-w-0 w-full rounded-lg border px-2.5 text-[16px] font-medium focus:outline-none sm:h-8 sm:w-auto sm:max-w-[156px] sm:px-2.5 md:text-xs ${
                              activeTag
                                ? 'border-[#1A1816] bg-[#1A1816] text-white dark:border-[#E4C37A] dark:bg-[#F3EFE6] dark:text-[#141210]'
                                : 'border-[#E2DCD1] bg-[#FFFDF9] text-[#2A2622] focus:border-[#1A1816] dark:border-[#342F28] dark:bg-[#1B1815] dark:text-[#E8E2D7] dark:focus:border-[#D4AF6A]'
                            }`}
                          >
                            <option value="">全部标签</option>
                            {tagRegistry.map((entry) => (
                              <option key={entry.name} value={entry.name}>
                                {entry.name} ({entry.count})
                              </option>
                            ))}
                          </select>
                        </>
                      )}

                      <label htmlFor="mobile-sort-select" className="sr-only">
                        排序方式
                      </label>
                      <select
                        id="mobile-sort-select"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="h-10 min-w-0 w-full rounded-lg border border-[#E2DCD1] bg-[#FFFDF9] px-2.5 text-[16px] font-medium text-[#2A2622] focus:border-[#1A1816] focus:outline-none sm:h-8 sm:w-auto sm:px-2.5 md:text-xs dark:border-[#342F28] dark:bg-[#1B1815] dark:text-[#E8E2D7] dark:focus:border-[#D4AF6A]"
                      >
                        <option value="recent">最近收录</option>
                        <option value="rating">评分最高</option>
                        <option value="year">年代最新</option>
                        <option value="title">名称排序</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          data-testid="toggle-advanced-filters-btn"
                          aria-expanded={advancedFiltersOpen}
                          onClick={() => setAdvancedFiltersOpen((v) => !v)}
                          className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                            advancedFiltersOpen || activeAdvancedFilterCount > 0
                              ? 'border-[#1A1816] bg-[#1A1816] text-white dark:border-[#F3EFE6] dark:bg-[#F3EFE6] dark:text-[#141210]'
                              : 'border-[#E2DCD1] bg-[#FFFDF9] text-[#564F47] hover:border-[#1A1816] hover:text-[#1A1816] dark:border-[#342F28] dark:bg-[#1B1815] dark:text-[#BDB5A8] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]'
                          }`}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>筛选</span>
                          {activeAdvancedFilterCount > 0 && (
                            <span className="font-mono text-[11px] tabular-nums">
                              ({activeAdvancedFilterCount})
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          data-testid="toggle-batch-mode-btn"
                          aria-pressed={batchMode}
                          onClick={() => {
                            setBatchMode((prev) => {
                              if (prev) setBatchSelectedIds([]);
                              return !prev;
                            });
                          }}
                          className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                            batchMode
                              ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                              : 'border-[#E2DCD1] bg-[#FFFDF9] text-[#564F47] hover:border-[#1A1816] hover:text-[#1A1816] dark:border-[#342F28] dark:bg-[#1B1815] dark:text-[#BDB5A8] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]'
                          }`}
                        >
                          <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{batchMode ? '退出批量' : '批量'}</span>
                        </button>

                        {activeFilterCount > 0 && (
                          <button
                            type="button"
                            data-testid="reset-filters-inline-btn"
                            onClick={handleResetFilters}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5BFB9] bg-[#FDF4F2] px-2 text-xs font-medium text-[#B43B2B] whitespace-nowrap cursor-pointer transition-colors hover:bg-[#FBE6E1] dark:border-[#6B3229] dark:bg-[#351B17] dark:text-[#F28C7B] dark:hover:bg-[#46231D]"
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>重置</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          data-testid="stat-total"
                          className="font-mono text-[12px] tabular-nums text-[#857D72] shrink-0 dark:text-[#9A9184]"
                        >
                          {filteredItems.length} 件
                        </span>

                        {/* Grid / List View Mode Switcher */}
                        <div
                          role="group"
                          aria-label="视图切换"
                          className="inline-flex rounded-lg border border-[#E2DCD1] bg-[#F2EEE6] p-0.5 dark:border-[#322D27] dark:bg-[#211D19]"
                        >
                          <button
                            type="button"
                            data-testid="view-mode-grid"
                            aria-pressed={viewMode === 'grid'}
                            aria-label="画廊网格视图"
                            onClick={() => setViewMode('grid')}
                            className={`flex h-7 w-8 items-center justify-center rounded-md cursor-pointer transition-colors ${
                              viewMode === 'grid'
                                ? 'bg-white text-[#1A1816] shadow-2xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                                : 'text-[#6E665C] hover:text-[#1A1816] dark:text-[#9A9184] dark:hover:text-[#F3EFE6]'
                            }`}
                          >
                            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            data-testid="view-mode-list"
                            aria-pressed={viewMode === 'list'}
                            aria-label="名录列表视图"
                            onClick={() => setViewMode('list')}
                            className={`flex h-7 w-8 items-center justify-center rounded-md cursor-pointer transition-colors ${
                              viewMode === 'list'
                                ? 'bg-white text-[#1A1816] shadow-2xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                                : 'text-[#6E665C] hover:text-[#1A1816] dark:text-[#9A9184] dark:hover:text-[#F3EFE6]'
                            }`}
                          >
                            <List className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Collapsible Multi-Dimensional Faceted Filters */}
              {items.length > 0 && advancedFiltersOpen && (
                <div
                  data-testid="advanced-filters-panel"
                  className="mt-3 rounded-2xl border border-[#E4DFD5] bg-white p-3.5 dark:border-[#322D27] dark:bg-[#1D1A17]"
                >
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div>
                      <label
                        htmlFor="filter-decade"
                        className="mb-1 block text-[11px] font-medium text-[#7A7268] dark:text-[#A59D90]"
                      >
                        上映年代
                      </label>
                      <select
                        id="filter-decade"
                        data-testid="filter-decade-select"
                        value={decadeFilter}
                        onChange={(e) =>
                          setDecadeFilter(e.target.value as DecadeFilterOption)
                        }
                        className="h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                      >
                        {DECADE_FILTER_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="filter-region"
                        className="mb-1 block text-[11px] font-medium text-[#7A7268] dark:text-[#A59D90]"
                      >
                        国家 / 地区
                      </label>
                      <select
                        id="filter-region"
                        data-testid="filter-region-select"
                        value={regionFilter}
                        onChange={(e) => setRegionFilter(e.target.value)}
                        className="h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                      >
                        <option value="">全部地区</option>
                        {regionRegistry.map((reg) => (
                          <option key={reg.name} value={reg.name}>
                            {reg.name} ({reg.count})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="filter-rating-bucket"
                        className="mb-1 block text-[11px] font-medium text-[#7A7268] dark:text-[#A59D90]"
                      >
                        评分档位
                      </label>
                      <select
                        id="filter-rating-bucket"
                        data-testid="filter-rating-select"
                        value={ratingBucketFilter}
                        onChange={(e) =>
                          setRatingBucketFilter(
                            e.target.value as RatingBucketFilterOption
                          )
                        }
                        className="h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                      >
                        <option value="all">全部评分</option>
                        <option value="5">五星神作</option>
                        <option value="4plus">四星及以上</option>
                        <option value="3minus">三星及以下</option>
                        <option value="unrated">尚未评分</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="filter-completeness"
                        className="mb-1 block text-[11px] font-medium text-[#7A7268] dark:text-[#A59D90]"
                      >
                        成色进度
                      </label>
                      <select
                        id="filter-completeness"
                        data-testid="filter-completeness-select"
                        value={completenessFilter}
                        onChange={(e) =>
                          setCompletenessFilter(
                            e.target.value as CompletenessFilterOption
                          )
                        }
                        className="h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                      >
                        <option value="all">全部成色</option>
                        <option value="masterpiece">典藏级 (5/5)</option>
                        <option value="needs-polish">待打磨 (&lt;5/5)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {items.length > 0 && (activeAlbum || activeTag) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {activeAlbum && (
                    <div
                      data-testid="active-album-banner"
                      className="flex flex-1 min-w-[240px] flex-wrap items-center justify-between gap-2 rounded-xl border border-[#C9A45C] bg-[#FFFDF9] px-3.5 py-2 dark:border-[#C9A45C]/65 dark:bg-[#221E18]"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-[#1A1816] md:text-xs dark:text-[#F3EFE6]">
                        <BookOpen
                          className="h-4 w-4 shrink-0 text-[#A67C37] dark:text-[#E4C37A]"
                          aria-hidden="true"
                        />
                        <span className="text-[#7A7268] shrink-0 dark:text-[#A59D90]">图鉴筛选</span>
                        <span className="truncate font-medium">
                          「{activeAlbum.name}」
                        </span>
                        {locatedItem && (
                          <span
                            data-testid="banner-located-indicator"
                            className="inline-flex items-center rounded-lg bg-[#FDF0ED] px-2 py-0.5 text-[11px] font-medium text-[#B43B2B] dark:bg-[#3A2B18] dark:text-[#F2D68A]"
                          >
                            已选中「{locatedItem.title}」
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {locatedItem && (
                          <button
                            type="button"
                            onClick={() => setSelectedItemId(locatedItem.id)}
                            className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg px-2.5 text-[13px] font-medium text-[#B43B2B] hover:bg-[#F9EAE6] cursor-pointer md:text-xs dark:text-[#E4C37A] dark:hover:bg-[#31291D]"
                          >
                            查看详情
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveAlbumId('');
                            setLocatedItemId(null);
                          }}
                          aria-label="清除图鉴筛选"
                          className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer md:text-xs dark:text-[#B8AFA2] dark:hover:bg-[#312B24] dark:hover:text-[#F3EFE6]"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>清除</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {activeTag && (
                    <div
                      data-testid="active-tag-banner"
                      className="flex flex-1 min-w-[240px] flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2 dark:border-[#3A342D] dark:bg-[#1D1A17]"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-[#1A1816] md:text-xs dark:text-[#F3EFE6]">
                        <Tag
                          className="h-4 w-4 shrink-0 text-[#B43B2B] dark:text-[#EB7865]"
                          aria-hidden="true"
                        />
                        <span className="text-[#7A7268] shrink-0 dark:text-[#A59D90]">标签筛选</span>
                        <span className="truncate font-medium">
                          「{activeTag}」
                        </span>
                        {locatedItem && (
                          <span
                            data-testid="banner-located-indicator"
                            className="inline-flex items-center rounded-lg bg-[#FDF0ED] px-2 py-0.5 text-[11px] font-medium text-[#B43B2B] dark:bg-[#3A2B18] dark:text-[#F2D68A]"
                          >
                            已选中「{locatedItem.title}」
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {locatedItem && (
                          <button
                            type="button"
                            onClick={() => setSelectedItemId(locatedItem.id)}
                            className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg px-2.5 text-[13px] font-medium text-[#B43B2B] hover:bg-[#F9EAE6] cursor-pointer md:text-xs dark:text-[#E4C37A] dark:hover:bg-[#31291D]"
                          >
                            查看详情
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTag('');
                            setLocatedItemId(null);
                          }}
                          aria-label="清除标签筛选"
                          className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer md:text-xs dark:text-[#B8AFA2] dark:hover:bg-[#312B24] dark:hover:text-[#F3EFE6]"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>清除</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <ArchiveGrid
              items={filteredItems}
              allItems={items}
              searchQuery={libraryQuery}
              activeTag={activeTag}
              activeAlbumName={activeAlbum?.name || ''}
              viewMode={viewMode}
              batchMode={batchMode}
              selectedIds={batchSelectedIds}
              locatedItemId={locatedItemId}
              locatedJumpTick={locatedJumpTick}
              onToggleBatchSelect={handleToggleBatchSelect}
              onSelectItem={(item) => {
                if (locatedItemId && item.id !== locatedItemId) {
                  setLocatedItemId(null);
                }
                setSelectedItemId(item.id);
              }}
              onQuickUpdateStatus={handleQuickUpdateStatus}
              onOpenCardModal={(item) => setCardModalItemId(item.id)}
              onJumpToSearch={jumpToSearch}
              onJumpToCreate={() => jumpToCreate()}
              onResetFilters={handleResetFilters}
            />

            {batchMode && (
              <BatchActionBar
                selectedCount={batchSelectedIds.length}
                totalVisibleCount={filteredItems.length}
                albums={collector.albums}
                tagSuggestions={tagRegistry.slice(0, 8).map((t) => t.name)}
                onSelectAll={() =>
                  setBatchSelectedIds(filteredItems.map((it) => it.id))
                }
                onClearSelection={() => setBatchSelectedIds([])}
                onExitBatchMode={() => {
                  setBatchMode(false);
                  setBatchSelectedIds([]);
                }}
                onBatchStatus={handleBatchStatus}
                onBatchAddTag={handleBatchAddTag}
                onBatchAddToAlbum={handleBatchAddToAlbum}
                onOpenPosterWallWithSelection={() => {
                  if (batchSelectedIds.length === 0) return;
                  setPosterWallConfig({
                    open: true,
                    itemIds: batchSelectedIds.slice(0, 9),
                    title: '精选光影海报墙',
                  });
                }}
              />
            )}
          </>
        )}

        {activeTab === 'timeline' && (
          <TimelineMemoriesView
            items={items}
            onSelectItem={(it) => setSelectedItemId(it.id)}
            onJumpToSearch={() => jumpToSearch()}
            onJumpToCreate={() => jumpToCreate()}
          />
        )}

        {activeTab === 'search' && (
          <SearchTabView
            existingItems={items}
            initialQuery={pendingSearchQuery}
            initialCategory={pendingSearchCategory}
            onConsumeInitialQuery={() => setPendingSearchQuery('')}
            onCollectResult={handleCollectOnlineResult}
            onJumpToManual={(title, cat) => jumpToCreate(title, cat)}
          />
        )}

        {activeTab === 'create' && (
          <ManualCreateView
            existingItems={items}
            initialTitle={pendingCreateTitle}
            initialCategory={pendingCreateCategory}
            initialRelatedIds={pendingCreateRelatedIds}
            initialRelatedWorkTitle={pendingCreateWorkTitle}
            onConsumePrefill={() => {
              setPendingCreateTitle('');
              setPendingCreateRelatedIds([]);
              setPendingCreateWorkTitle('');
            }}
            onCreateItem={handleCreateManualItem}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileBackupView
            items={items}
            stats={stats}
            collector={collector}
            runtimeMode={runtimeMode}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            onCheckInToday={handleCheckInToday}
            onReplaceAll={handleReplaceAll}
            onFilterByTag={handleFilterByTag}
            onFilterByCategory={handleFilterByCategory}
            onJumpToSearch={() => jumpToSearch()}
          />
        )}
      </main>

      <OfflineIndicator />

      {/* Action Notice Toast (Shifts to top while PostCollectLinkSheet is open so it never covers sheet buttons) */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`toast-pop-in fixed left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-xl border border-white/10 bg-[#1A1816] px-4 py-2.5 text-[13px] font-medium text-[#FAF7F0] shadow-xl md:text-xs dark:border-[#D4AF6A]/35 dark:bg-[#24201B] ${
            pendingLinkSuggestion
              ? 'top-[calc(64px+env(safe-area-inset-top))] md:top-[76px]'
              : 'bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6'
          }`}
        >
          <span className="truncate">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="关闭提示"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#A59D90] hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Post-Collection Smart Relation Recommendation Sheet */}
      <PostCollectLinkSheet
        sourceItem={
          pendingLinkSuggestion
            ? items.find((i) => i.id === pendingLinkSuggestion.sourceItemId) ??
              null
            : null
        }
        recommendations={pendingLinkSuggestion?.recommendations ?? []}
        allItems={items}
        onLinkOne={handleLinkExisting}
        onLinkAll={handleLinkMultiple}
        onOpenDetail={(it) => setSelectedItemId(it.id)}
        onClose={() => setPendingLinkSuggestion(null)}
      />

      <MobileNavBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        totalCount={stats.total}
      />

      <DetailDrawer
        item={selectedItem}
        allItems={items}
        albums={collector.albums}
        positionLabel={drawerPositionLabel}
        onPrevItem={prevDrawerItem ? () => setSelectedItemId(prevDrawerItem.id) : undefined}
        onNextItem={nextDrawerItem ? () => setSelectedItemId(nextDrawerItem.id) : undefined}
        onClose={() => setSelectedItemId(null)}
        onSelectRelated={(rel) => setSelectedItemId(rel.id)}
        onFilterByTag={handleFilterByTag}
        onJumpToAlbum={handleJumpToAlbumFromDrawer}
        onAddToAlbum={handleAddItemToAlbumFromDrawer}
        onOpenCardModal={(it) => {
          setSelectedItemId(null);
          setCardModalItemId(it.id);
        }}
        isPinnedToShowcase={Boolean(
          selectedItem &&
            collector.showcase?.primaryMode === 'pinned' &&
            collector.showcase?.pinnedItemId === selectedItem.id
        )}
        onTogglePinShowcase={(it) => void handleTogglePinShowcase(it)}
        onOpenGlobalMap={() => {
          setGlobalMapInitialId(selectedItem?.id ?? null);
          setSelectedItemId(null);
          setGlobalMapOpen(true);
        }}
        onJumpToMedalHall={() => {
          setSelectedItemId(null);
          setActiveTab('profile');
        }}
        onUpdateItem={handleUpdateItem}
        onDeleteItem={handleDeleteItem}
        onCollectAndLink={handleCollectAndLink}
        onLinkExisting={handleLinkExisting}
        onUnlinkItems={handleUnlinkItems}
        onQuickCreateRelated={handleQuickCreateRelated}
      />

      <CollectibleCardModal
        item={cardModalItem}
        allItems={items}
        onClose={() => setCardModalItemId(null)}
        onSelectItem={(it) => setCardModalItemId(it.id)}
        onOpenDetailEdit={(it) => {
          setCardModalItemId(null);
          setSelectedItemId(it.id);
        }}
        onNotice={(msg) => setNotice(msg)}
      />

      <RandomEncounterModal
        open={encounterOpen}
        initialMode={encounterInitialMode}
        item={encounterItem}
        allItems={displayItems}
        drawCount={encounterDrawCount}
        onClose={() => {
          setEncounterOpen(false);
          setEncounterItemId(null);
          setEncounterDrawCount(0);
        }}
        onDrawAnother={handleTriggerRandomEncounter}
        onOpenFullDetail={(it) => {
          setEncounterOpen(false);
          setEncounterItemId(null);
          setEncounterDrawCount(0);
          setSelectedItemId(it.id);
        }}
        onMarkWatching={async (it) => {
          await handleUpdateItem(it.id, { status: 'watching' });
          setNotice(`已将「${it.title}」标记为在追 / 今晚开看`);
        }}
        onJumpToSearch={() => {
          setEncounterOpen(false);
          jumpToSearch();
        }}
      />

      <PosterWallExportModal
        open={posterWallConfig.open}
        allItems={displayItems}
        initialSelectedIds={posterWallConfig.itemIds}
        initialTitle={posterWallConfig.title}
        onClose={() => setPosterWallConfig({ open: false })}
        onNotice={(msg) => setNotice(msg)}
      />

      <QuotesWallModal
        open={quotesWallOpen}
        allItems={displayItems}
        onClose={() => setQuotesWallOpen(false)}
        onSelectItem={(it) => {
          setQuotesWallOpen(false);
          setSelectedItemId(it.id);
        }}
        onNotice={(msg) => setNotice(msg)}
      />

      <GlobalRelationMapModal
        open={globalMapOpen}
        allItems={displayItems}
        initialFocusedId={globalMapInitialId}
        onClose={() => {
          setGlobalMapOpen(false);
          setGlobalMapInitialId(null);
        }}
        onSelectItem={(it) => {
          setGlobalMapOpen(false);
          setGlobalMapInitialId(null);
          setSelectedItemId(it.id);
        }}
        onLinkExisting={handleLinkExisting}
        onLinkPairs={handleLinkPairs}
      />

      <AlbumCuratorModal
        album={editingAlbum}
        allItems={displayItems}
        onClose={() => setEditingAlbum(null)}
        onSaveAlbum={handleSaveEditedAlbum}
        onExportAlbumPoster={(alb, matched) => {
          setEditingAlbum(null);
          setPosterWallConfig({
            open: true,
            itemIds: matched.map((m) => m.id),
            title: alb.name,
          });
        }}
      />

      <ShowcaseCustomizerModal
        open={showcaseCustomizerOpen}
        initialTab={showcaseCustomizerTab}
        config={collector.showcase ?? DEFAULT_SHOWCASE_CONFIG}
        allItems={displayItems}
        onClose={() => setShowcaseCustomizerOpen(false)}
        onSave={handleSaveShowcase}
      />
    </div>
  );
}
