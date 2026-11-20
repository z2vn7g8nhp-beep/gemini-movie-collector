import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search, Tag, X } from 'lucide-react';
import { ArchiveGrid } from './components/ArchiveGrid';
import { CollectibleCardModal } from './components/CollectibleCardModal';
import { CollectorSpotlightRail } from './components/CollectorSpotlightRail';
import { DailyCheckInBanner } from './components/DailyCheckInBanner';
import { DetailDrawer } from './components/DetailDrawer';
import { ManualCreateView } from './components/ManualCreateView';
import { MobileNavBar, AppTopBar, type AppTab } from './components/MobileNavBar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PostCollectLinkSheet } from './components/PostCollectLinkSheet';
import { ProfileBackupView } from './components/ProfileBackupView';
import { RandomEncounterModal } from './components/RandomEncounterModal';
import { SearchTabView } from './components/SearchTabView';
import { TimelineMemoriesView } from './components/TimelineMemoriesView';
import { detectRuntimeMode, getRuntimeModeSync } from './services/archiveApi';
import type {
  ArchiveCategory,
  ArchiveDraftInput,
  ArchiveItem,
  CollectionStatus,
  CollectorAlbum,
  CollectorState,
  OnlineSearchResult,
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
import {
  computeCheckInStreak,
  computeCollectorStamps,
  formatLocalDateKey,
  pickRandomEncounterItem,
  recordCheckIn,
  resolveAlbumItems,
} from './utils/collector';
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
import { collectTagRegistry } from './utils/tags';

const LOCAL_STORAGE_KEY = 'cinearchive.collection.v2';
const COLLECTOR_STORAGE_KEY = 'cinearchive.collector.v1';

const EMPTY_COLLECTOR: CollectorState = {
  checkInDates: [],
  albums: [],
};

function loadLocalFallback(): ArchiveItem[] | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArchiveItem[]) : null;
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
  const [items, setItems] = useState<ArchiveItem[]>(() => {
    return loadLocalFallback() ?? [];
  });
  const [collector, setCollector] = useState<CollectorState>(() =>
    loadLocalCollector()
  );
  const [activeTab, setActiveTab] = useState<AppTab>('library');

  // Library filters
  const [activeCategory, setActiveCategory] = useState<'all' | ArchiveCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CollectionStatus>('all');
  const [activeTag, setActiveTag] = useState('');
  const [activeAlbumId, setActiveAlbumId] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  // Handoff state to Search / Create tabs
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  const [pendingSearchCategory, setPendingSearchCategory] = useState<ArchiveCategory>('film');
  const [pendingCreateTitle, setPendingCreateTitle] = useState('');
  const [pendingCreateCategory, setPendingCreateCategory] = useState<ArchiveCategory>('film');
  const [pendingCreateRelatedIds, setPendingCreateRelatedIds] = useState<string[]>([]);
  const [pendingCreateWorkTitle, setPendingCreateWorkTitle] = useState('');

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [cardModalItemId, setCardModalItemId] = useState<string | null>(null);
  const [encounterItemId, setEncounterItemId] = useState<string | null>(null);
  const [encounterDrawCount, setEncounterDrawCount] = useState(0);
  const [pendingLinkSuggestion, setPendingLinkSuggestion] = useState<{
    sourceItemId: string;
    recommendations: LinkRecommendation[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(() =>
    getRuntimeModeSync()
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
  const hydratedRef = useRef(false);
  const unlockedStampsRef = useRef<Set<string>>(new Set());
  const medalTiersRef = useRef<Map<string, MedalTier>>(new Map());

  // Sync collection & collector rituals with Express backend when available,
  // or operate purely on browser localStorage when deployed statically (GitHub Pages).
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const mode = await detectRuntimeMode();
        if (cancelled) return;
        runtimeModeRef.current = mode;
        setRuntimeMode(mode);

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
              loadedItems = data.items;
              setItems(data.items);
              saveLocalFallback(data.items);
            } else {
              setItems(loadedItems);
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
            if (serverDates.length > 0 || serverAlbums.length > 0) {
              loadedCollector = {
                checkInDates: serverDates,
                albums: serverAlbums,
              };
            }
            setCollector(loadedCollector);
            saveLocalCollector(loadedCollector);
          }
        } else {
          setItems(loadedItems);
          setCollector(loadedCollector);
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
  const activeAlbum = useMemo(
    () => collector.albums.find((a) => a.id === activeAlbumId) ?? null,
    [collector.albums, activeAlbumId]
  );

  const filteredItems = useMemo(() => {
    const baseItems = activeAlbum ? resolveAlbumItems(activeAlbum, items) : items;
    return filterAndSortItems(baseItems, {
      category: activeCategory,
      status: statusFilter,
      tag: activeTag,
      query: libraryQuery,
      sortBy,
    });
  }, [items, activeAlbum, activeCategory, statusFilter, activeTag, libraryQuery, sortBy]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  const cardModalItem = useMemo(
    () => items.find((i) => i.id === cardModalItemId) ?? null,
    [items, cardModalItemId]
  );

  const encounterItem = useMemo(
    () => items.find((i) => i.id === encounterItemId) ?? null,
    [items, encounterItemId]
  );

  const handleTriggerRandomEncounter = () => {
    const picked = pickRandomEncounterItem(items, encounterItemId ?? undefined);
    if (!picked) {
      setNotice('藏馆暂无条目，先联网收录几件吧');
      return;
    }
    setEncounterItemId(picked.id);
    setEncounterDrawCount((n) => n + 1);
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

  const jumpToSearch = (prefillQuery?: string) => {
    setPendingSearchCategory(activeCategory === 'all' ? 'film' : activeCategory);
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
  };

  const handleFilterByTag = (tag: string) => {
    setSelectedItemId(null);
    setActiveTab('library');
    setActiveCategory('all');
    setStatusFilter('all');
    setActiveAlbumId('');
    setLibraryQuery('');
    setActiveTag(tag);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F5F0] text-[#1A1816]">
      <AppTopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        totalCount={stats.total}
        needsDailyCheckIn={hydrated && dailyReminder.shouldShowTopIcon}
        onQuickCheckIn={() => void handleCheckInToday()}
      />

      <main className="flex-1">
        {hydrated && (
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
              items={items}
              collector={collector}
              activeAlbumId={activeAlbumId}
              onCheckInToday={handleCheckInToday}
              onOpenDetail={(it) => setSelectedItemId(it.id)}
              onOpenCardModal={(it) => setCardModalItemId(it.id)}
              onTriggerRandomEncounter={handleTriggerRandomEncounter}
              onSelectAlbum={(albumId) => {
                setActiveAlbumId(albumId);
                if (albumId) setActiveTag('');
              }}
              onCreateAlbum={handleCreateAlbum}
              onDeleteAlbum={handleDeleteAlbum}
              onJumpToSearch={jumpToSearch}
              onJumpToProfile={() => setActiveTab('profile')}
            />

            {/* Top Mobile-First Search + Category Control Zone */}
            <section className="mx-auto max-w-[1160px] px-4 pt-3.5 pb-2 md:px-8 md:pt-6">
              {/* Prominent Dual-Purpose Search Bar (Filter Library OR Submit to Online Search!) */}
              <form
                onSubmit={handleQuickBarSubmit}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <label htmlFor="library-quick-search" className="sr-only">
                    搜片名、影人、角色或筛查馆藏
                  </label>
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
                    aria-hidden="true"
                  />
                  <input
                    id="library-quick-search"
                    type="search"
                    enterKeyHint="search"
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder={
                      items.length === 0
                        ? '搜片名、影人或角色，回车直接联网收录…'
                        : '筛查馆藏，或回车直连全网搜片…'
                    }
                    className="h-12 w-full rounded-2xl border border-[#DCD6CB] bg-white pl-10 pr-10 text-[15px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:outline-none"
                  />
                  {libraryQuery && (
                    <button
                      type="button"
                      onClick={() => setLibraryQuery('')}
                      aria-label="清空输入"
                      className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-[#625C54] cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="h-12 shrink-0 rounded-2xl bg-[#1A1816] px-4 text-sm font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:bg-[#B43B2B]"
                >
                  联网搜
                </button>
              </form>

              {/* Category Segmented Tabs + Live Count */}
              <div className="mt-3.5 flex items-center justify-between gap-2">
                <div
                  role="group"
                  aria-label="藏品分类"
                  className="grid flex-1 grid-cols-4 gap-1 rounded-xl bg-[#ECE8DF] p-1 sm:max-w-md"
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
                        className={`min-h-[38px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                          active
                            ? 'bg-white text-[#1A1816] shadow-xs'
                            : 'text-[#625C54]'
                        }`}
                      >
                        {cat.label}
                        <span className="ml-1 font-mono text-[11px] tabular-nums opacity-75">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Compact Status, Tag & Sort Bar (shown once user has collected items) */}
              {items.length > 0 && (
                <div className="mt-3 border-b border-[#E4DFD5] pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
                        className="h-9 min-w-0 flex-1 rounded-xl border border-[#DCD6CB] bg-white px-2 text-xs font-medium text-[#1A1816] focus:border-[#1A1816] focus:outline-none sm:flex-none sm:px-2.5"
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
                            className={`h-9 min-w-0 flex-1 rounded-xl border px-2 text-xs font-medium focus:outline-none sm:flex-none sm:max-w-[160px] sm:px-2.5 ${
                              activeTag
                                ? 'border-[#1A1816] bg-[#1A1816] text-white'
                                : 'border-[#DCD6CB] bg-white text-[#1A1816] focus:border-[#1A1816]'
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
                        className="h-9 min-w-0 flex-1 rounded-xl border border-[#DCD6CB] bg-white px-2 text-xs font-medium text-[#1A1816] focus:border-[#1A1816] focus:outline-none sm:flex-none sm:px-2.5"
                      >
                        <option value="recent">最近收录</option>
                        <option value="rating">评分最高</option>
                        <option value="year">年代最新</option>
                        <option value="title">名称排序</option>
                      </select>
                    </div>

                    <span
                      data-testid="stat-total"
                      className="font-mono text-xs tabular-nums text-[#7A7268] shrink-0"
                    >
                      共 {filteredItems.length} 件
                    </span>
                  </div>

                  {activeAlbum && (
                    <div
                      data-testid="active-album-banner"
                      className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-[#C9A45C] bg-[#FFFDF9] px-3 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-[#1A1816]">
                        <BookOpen
                          className="h-3.5 w-3.5 shrink-0 text-[#A67C37]"
                          aria-hidden="true"
                        />
                        <span className="text-[#7A7268] shrink-0">图鉴筛选</span>
                        <span className="truncate font-medium">
                          「{activeAlbum.name}」
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveAlbumId('')}
                        aria-label="清除图鉴筛选"
                        className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>清除</span>
                      </button>
                    </div>
                  )}

                  {activeTag && (
                    <div
                      data-testid="active-tag-banner"
                      className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-[#DCD6CB] bg-white px-3 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-[#1A1816]">
                        <Tag
                          className="h-3.5 w-3.5 shrink-0 text-[#B43B2B]"
                          aria-hidden="true"
                        />
                        <span className="text-[#7A7268] shrink-0">标签筛选</span>
                        <span className="truncate font-medium">
                          「{activeTag}」
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTag('')}
                        aria-label="清除标签筛选"
                        className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>清除</span>
                      </button>
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
              onSelectItem={(item) => setSelectedItemId(item.id)}
              onJumpToSearch={jumpToSearch}
              onJumpToCreate={() => jumpToCreate()}
              onResetFilters={handleResetFilters}
            />
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
            onCheckInToday={handleCheckInToday}
            onReplaceAll={handleReplaceAll}
            onFilterByTag={handleFilterByTag}
          />
        )}
      </main>

      <OfflineIndicator />

      {/* Action Notice Toast (Shifts to top while PostCollectLinkSheet is open so it never covers sheet buttons) */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1A1816] px-4 py-2.5 text-xs font-medium text-white shadow-lg whitespace-nowrap ${
            pendingLinkSuggestion
              ? 'top-[62px] md:top-[76px]'
              : 'bottom-[76px] md:bottom-6'
          }`}
        >
          {notice}
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
        onClose={() => setSelectedItemId(null)}
        onSelectRelated={(rel) => setSelectedItemId(rel.id)}
        onFilterByTag={handleFilterByTag}
        onOpenCardModal={(it) => {
          setSelectedItemId(null);
          setCardModalItemId(it.id);
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
      />

      <RandomEncounterModal
        item={encounterItem}
        allItems={items}
        drawCount={encounterDrawCount}
        onClose={() => {
          setEncounterItemId(null);
          setEncounterDrawCount(0);
        }}
        onDrawAnother={handleTriggerRandomEncounter}
        onOpenFullDetail={(it) => {
          setEncounterItemId(null);
          setEncounterDrawCount(0);
          setSelectedItemId(it.id);
        }}
      />
    </div>
  );
}
