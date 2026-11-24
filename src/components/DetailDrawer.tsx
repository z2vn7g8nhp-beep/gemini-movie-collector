import { SummarySource } from './SummarySource';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  PencilLine,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveItem,
  CharacterProfile,
  CollectionStatus,
  CollectorAlbum,
  OnlineSearchResult,
} from '../types/archive';
import {
  type OnlineRelationsResponse,
  fetchCharacterDossier,
  fetchOnlineRelations,
  getRuntimeModeSync,
  searchOnline,
} from '../services/archiveApi';
import {
  CATEGORY_LABELS,
  findExistingItemByTitle,
  getStatusLabel,
} from '../utils/archive';
import { extractImdbIdFromUrl, hasCjkCharacters } from '../utils/imdbParsers';
import { formatCoverUrlForMode } from '../utils/runtimeEnv';
import {
  mergeCharacterProfile,
  splitCharacterTitle,
} from '../utils/characterProfile';
import { computeItemCompleteness } from '../utils/collector';
import {
  findRecommendedUnlinkedItems,
  isExplicitlyLinked,
} from '../utils/smartLink';
import {
  readCachedRelations,
  writeCachedRelations,
} from '../utils/relationsCache';
import { ArchivalImage } from './ArchivalImage';
import { CharacterDossierSection } from './CharacterDossierSection';
import { CoverPickerModal } from './CoverPickerModal';
import { DetailCrossJumpBar } from './DetailCrossJumpBar';
import { DetailMedalShowcase } from './DetailMedalShowcase';
import { DetailRelationGraph } from './DetailRelationGraph';
import { DetailTagManager } from './DetailTagManager';
import { WatchLogSection } from './WatchLogSection';
import {
  type DrawerSwitchDirection,
  getDrawerBackdropVariants,
  getDrawerContentVariants,
  getDrawerMetaFadeVariants,
  getDrawerPanelVariants,
} from '../utils/drawerMotion';
import {
  type DossierSectionId,
  buildAccessionMetadataRows,
  buildDossierSectionTabs,
  computeActiveDossierSection,
  computeReadingProgress,
} from '../utils/dossierLayout';

function retainKnownLists(next: OnlineRelationsResponse, previous: OnlineRelationsResponse | null) {
  if (!previous) return next;
  const missingPeople = !next.people.length && previous.people.length > 0;
  const missingRoles = !next.characters.length && previous.characters.length > 0;
  if (!missingPeople && !missingRoles) return next;
  return {
    ...next,
    people: missingPeople ? previous.people : next.people,
    characters: missingRoles ? previous.characters : next.characters,
    sources: [...new Set([...next.sources, ...previous.sources])],
    castArticleRevision: next.castArticleRevision || previous.castArticleRevision,
  };
}

interface DetailDrawerProps {
  item: ArchiveItem | null;
  allItems: ArchiveItem[];
  albums?: CollectorAlbum[];
  positionLabel?: string;
  onPrevItem?: () => void;
  onNextItem?: () => void;
  onClose: () => void;
  onSelectRelated: (item: ArchiveItem) => void;
  onFilterByTag: (tag: string, focusItemId?: string) => void;
  onJumpToAlbum?: (albumId: string, focusItemId: string) => void;
  onAddToAlbum?: (albumId: string, itemId: string) => Promise<void>;
  onOpenCardModal?: (item: ArchiveItem) => void;
  isPinnedToShowcase?: boolean;
  onTogglePinShowcase?: (item: ArchiveItem) => void;
  onJumpToMedalHall?: () => void;
  onOpenGlobalMap?: () => void;
  onUpdateItem: (id: string, patch: Partial<ArchiveItem>) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onCollectAndLink: (
    sourceItem: ArchiveItem,
    candidate: OnlineSearchResult
  ) => Promise<void>;
  onLinkExisting: (sourceId: string, targetId: string) => Promise<void>;
  onUnlinkItems: (sourceId: string, targetId: string) => Promise<void>;
  onQuickCreateRelated: (
    sourceItem: ArchiveItem,
    targetCategory: ArchiveCategory
  ) => void;
}

const EMPTY_RELATIONS: OnlineRelationsResponse = {
  films: [],
  people: [],
  characters: [],
  sources: [],
};

const STATUS_CHOICES: CollectionStatus[] = [
  'favorite',
  'watched',
  'watching',
  'watchlist',
];

interface DetailDrawerShellProps extends Omit<DetailDrawerProps, 'item'> {
  item: ArchiveItem;
}

export function DetailDrawer(props: DetailDrawerProps) {
  return (
    <AnimatePresence>
      {props.item ? (
        <DetailDrawerShell
          key="detail-drawer-shell"
          {...props}
          item={props.item}
        />
      ) : null}
    </AnimatePresence>
  );
}

function DetailDrawerShell({
  item: savedItem,
  allItems,
  albums = [],
  positionLabel,
  onPrevItem,
  onNextItem,
  onClose,
  onSelectRelated: onSelectRelatedProp,
  onFilterByTag,
  onJumpToAlbum,
  onAddToAlbum,
  onOpenCardModal,
  isPinnedToShowcase = false,
  onTogglePinShowcase,
  onJumpToMedalHall,
  onOpenGlobalMap,
  onUpdateItem,
  onDeleteItem,
  onCollectAndLink,
  onLinkExisting,
  onUnlinkItems,
  onQuickCreateRelated,
}: DetailDrawerShellProps) {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [switchDirection, setSwitchDirection] =
    useState<DrawerSwitchDirection>('neutral');

  const backdropVariants = useMemo(
    () => getDrawerBackdropVariants(prefersReducedMotion),
    [prefersReducedMotion]
  );
  const panelVariants = useMemo(
    () => getDrawerPanelVariants(prefersReducedMotion),
    [prefersReducedMotion]
  );
  const contentVariants = useMemo(
    () => getDrawerContentVariants(prefersReducedMotion),
    [prefersReducedMotion]
  );
  const metaFadeVariants = useMemo(
    () => getDrawerMetaFadeVariants(prefersReducedMotion),
    [prefersReducedMotion]
  );

  const handlePrevItem = useCallback(() => {
    if (!onPrevItem) return;
    setSwitchDirection('prev');
    onPrevItem();
  }, [onPrevItem]);

  const handleNextItem = useCallback(() => {
    if (!onNextItem) return;
    setSwitchDirection('next');
    onNextItem();
  }, [onNextItem]);

  const onSelectRelated = useCallback(
    (target: ArchiveItem) => {
      setSwitchDirection('neutral');
      onSelectRelatedProp(target);
    },
    [onSelectRelatedProp]
  );

  const [resolvedFilm, setResolvedFilm] = useState<OnlineSearchResult | null>(null);
  const imdbId = savedItem.category === 'film' && savedItem.sourceName?.includes('IMDb')
    ? extractImdbIdFromUrl(savedItem.sourceUrl) : null;
  const needsProfile = Boolean(imdbId && !hasCjkCharacters(savedItem.summary || ''));
  useEffect(() => {
    if (!imdbId || !needsProfile) return;
    let active = true;
    searchOnline(imdbId, 'film').then(({ results }) => {
      const match = results.find(row => row.externalId === 'imdb-' + imdbId && row.summaryRevision);
      if (active && match) setResolvedFilm(match);
    }).catch(() => {});
    return () => { active = false; };
  }, [imdbId, needsProfile]);

  const item = useMemo(() => {
    if (!imdbId || !needsProfile || resolvedFilm?.externalId !== 'imdb-' + imdbId) return savedItem;
    const rename = !hasCjkCharacters(savedItem.title) && hasCjkCharacters(resolvedFilm.title)
      && (!resolvedFilm.originalTitle || resolvedFilm.originalTitle.toLowerCase() === savedItem.title.toLowerCase());
    return { ...savedItem, title: rename ? resolvedFilm.title : savedItem.title,
      originalTitle: savedItem.originalTitle || (rename ? savedItem.title : undefined),
      summary: resolvedFilm.summary, summaryRevision: resolvedFilm.summaryRevision };
  }, [savedItem, imdbId, needsProfile, resolvedFilm]);
  const [rating, setRating] = useState(0);
  const [status, setStatus] = useState<CollectionStatus>('watched');
  const [quote, setQuote] = useState('');
  const [notes, setNotes] = useState('');
  const [relatedWorkTitle, setRelatedWorkTitle] = useState('');
  const [portrayedBy, setPortrayedBy] = useState('');
  const [coverUrlInput, setCoverUrlInput] = useState('');
  const [selectedLinkId, setSelectedLinkId] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [posterLightboxOpen, setPosterLightboxOpen] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<DossierSectionId>('overview');
  const [readingProgress, setReadingProgress] = useState(0);

  // Structured Character Dossier fields (only used when item.category === 'character')
  const [charAlias, setCharAlias] = useState('');
  const [charIdentity, setCharIdentity] = useState('');
  const [charAffiliation, setCharAffiliation] = useState('');
  const [charOrigin, setCharOrigin] = useState('');
  const [charAbilities, setCharAbilities] = useState('');
  const [charFirstAppearance, setCharFirstAppearance] = useState('');
  const [charCreator, setCharCreator] = useState('');
  const [charHighlights, setCharHighlights] = useState('');
  const [charBio, setCharBio] = useState('');
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState('');
  const [dossierReloadTick, setDossierReloadTick] = useState(0);
  const [editTab, setEditTab] = useState<'notes' | 'dossier'>('notes');
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const relationsSectionRef = useRef<HTMLDivElement | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);
  const graphSectionRef = useRef<HTMLDivElement | null>(null);

  // Live online relation discovery state (for films & people only)
  const [onlineRelations, setOnlineRelations] =
    useState<OnlineRelationsResponse>(EMPTY_RELATIONS);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [relationsError, setRelationsError] = useState('');
  const [relationsTab, setRelationsTab] = useState<'primary' | 'secondary'>(
    'primary'
  );
  const [relationsReloadTick, setRelationsReloadTick] = useState(0);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [relationsFilter, setRelationsFilter] = useState('');
  const [relationsExpanded, setRelationsExpanded] = useState(false);

  const syncCharacterFormFromProfile = (
    p?: CharacterProfile,
    fallbackSummary = ''
  ) => {
    setCharAlias(p?.alias || '');
    setCharIdentity(p?.identity || '');
    setCharAffiliation(p?.affiliation || '');
    setCharOrigin(p?.origin || '');
    setCharAbilities(p?.abilities || '');
    setCharFirstAppearance(p?.firstAppearance || '');
    setCharCreator(p?.creator || '');
    setCharHighlights(p?.highlights || '');
    setCharBio(p?.bio || fallbackSummary || '');
  };

  useEffect(() => {
    if (!item) return;
    setRating(item.rating);
    setStatus(item.status);
    setQuote(item.quote || '');
    setNotes(item.notes || '');
    setRelatedWorkTitle(item.relatedWorkTitle || '');
    setPortrayedBy(item.portrayedBy || '');
    setCoverUrlInput(item.coverUrl || '');
    syncCharacterFormFromProfile(item.characterProfile, item.summary);
    setSelectedLinkId('');
    setSavedFeedback('');
    setConfirmDelete(false);
    setRelationsTab('primary');
    setRelationsError('');
    setLinkingKey(null);
    setRelationsFilter('');
    setRelationsExpanded(false);
    setDossierError('');
    setDossierReloadTick(0);
    setEditTab('notes');
    setPosterLightboxOpen(false);
    setHoverRating(null);
    setSummaryExpanded(false);
    setActiveSection('overview');
    setReadingProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Keep hero quick controls synced if item rating/status updates externally
  useEffect(() => {
    setRating(item.rating);
    setStatus(item.status);
  }, [item.rating, item.status]);

  // Auto-clear brief save/quick-action feedback toast
  useEffect(() => {
    if (!savedFeedback) return;
    const timer = window.setTimeout(() => setSavedFeedback(''), 2400);
    return () => window.clearTimeout(timer);
  }, [savedFeedback]);

  // Auto-enrich Character Dossier from Wikipedia / Wikidata / exact Bangumi ID
  useEffect(() => {
    if (!item || item.category !== 'character') {
      setDossierLoading(false);
      return;
    }

    const isManualRefresh = dossierReloadTick > 0;
    if (!isManualRefresh && item.characterProfile?.enrichedAt) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const currentItem = item;

    async function enrichCharacter() {
      setDossierLoading(true);
      setDossierError('');
      try {
        const data = await fetchCharacterDossier(
          {
            title: currentItem.title,
            originalTitle: currentItem.originalTitle,
            relatedWorkTitle: currentItem.relatedWorkTitle,
            sourceUrl: currentItem.sourceUrl,
          },
          controller.signal
        );
        if (cancelled) return;

        const fetched = data.profile || {};
        const hasFetchedValues = Object.entries(fetched).some(
          ([k, v]) => k !== 'dossierSource' && typeof v === 'string' && v.trim().length > 0
        );

        const merged = mergeCharacterProfile(currentItem.characterProfile, {
          ...fetched,
          enrichedAt: new Date().toISOString(),
        });

        if (hasFetchedValues) {
          setCharAlias((prev) => prev || merged.alias || '');
          setCharIdentity((prev) => prev || merged.identity || '');
          setCharAffiliation((prev) => prev || merged.affiliation || '');
          setCharOrigin((prev) => prev || merged.origin || '');
          setCharAbilities((prev) => prev || merged.abilities || '');
          setCharFirstAppearance((prev) => prev || merged.firstAppearance || '');
          setCharCreator((prev) => prev || merged.creator || '');
          setCharBio((prev) => {
            if (prev && prev !== currentItem.summary) return prev;
            return merged.bio || prev;
          });
        } else if (isManualRefresh) {
          setDossierError('公开资料库暂未收录该角色详情，可在下方手动完善设定');
        }

        await onUpdateItem(currentItem.id, { characterProfile: merged });
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
          return;
        }
        if (isManualRefresh) {
          setDossierError('角色资料检索暂时超时，请稍后重试');
        }
      } finally {
        if (!cancelled) {
          setDossierLoading(false);
        }
      }
    }

    void enrichCharacter();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, dossierReloadTick]);

  // Auto-discover online cast / characters / filmography for Films & People (skipped for Characters!)
  // Uses persistent localStorage cache so re-opening the app or detail drawer displays immediately without reloading.
  useEffect(() => {
    if (!item || item.category === 'character') {
      setOnlineRelations(EMPTY_RELATIONS);
      setRelationsLoading(false);
      return;
    }

    const reqParams = {
      category: (item.category === 'film' ? 'film' : 'person') as 'film' | 'person',
      title: item.title,
      originalTitle: item.originalTitle,
      sourceUrl: item.sourceUrl,
      year: item.year,
      tags: item.tags,
      subtitle: item.subtitle,
    };

    const isManualRefresh = relationsReloadTick > 0;
    const cached = !isManualRefresh ? readCachedRelations(reqParams) : null;
    if (cached) {
      setOnlineRelations(cached);
      setRelationsLoading(false);
      setRelationsError('');
      const primaryCount =
        item.category === 'film' ? cached.people.length : cached.films.length;
      const secondaryCount = cached.characters.length;
      if (primaryCount === 0 && secondaryCount > 0) {
        setRelationsTab('secondary');
      } else {
        setRelationsTab('primary');
      }
      return;
    }

    const previous = item.category === 'film' ? readCachedRelations(reqParams, true) : null;
    if (!isManualRefresh) setRelationsTab('primary');
    const controller = new AbortController();
    let cancelled = false;

    async function fetchRelations() {
      setRelationsLoading(true);
      setRelationsError('');
      if (!isManualRefresh) {
        setOnlineRelations(previous || EMPTY_RELATIONS);
      }

      try {
        const next = await fetchOnlineRelations(reqParams, controller.signal, preview => {
          if (!cancelled) setOnlineRelations(retainKnownLists(preview, previous));
        });
        if (cancelled) return;
        const displayed = retainKnownLists(next, previous);
        setOnlineRelations(displayed);
        writeCachedRelations(reqParams, displayed, displayed !== next);

        const primaryCount =
          item!.category === 'film' ? displayed.people.length : displayed.films.length;
        const secondaryCount = displayed.characters.length;
        if (primaryCount === 0 && secondaryCount > 0) {
          setRelationsTab('secondary');
        }
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
          return;
        }
        setRelationsError('联网检索演职员与角色暂时超时，请点击重试');
      } finally {
        if (!cancelled) {
          setRelationsLoading(false);
        }
      }
    }

    void fetchRelations();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, relationsReloadTick]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (coverPickerOpen) return;
      if (posterLightboxOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPosterLightboxOpen(false);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (editFormRef.current) {
          e.preventDefault();
          editFormRef.current.requestSubmit();
        }
        return;
      }
      if (e.key === 'Escape') {
        onClose();
        return;
      }
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
      if (e.key === 'ArrowLeft' && onPrevItem) {
        e.preventDefault();
        handlePrevItem();
      } else if (e.key === 'ArrowRight' && onNextItem) {
        e.preventDefault();
        handleNextItem();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    coverPickerOpen,
    posterLightboxOpen,
    onClose,
    onPrevItem,
    onNextItem,
    handlePrevItem,
    handleNextItem,
  ]);

  const relatedItems = allItems.filter(
    (other) => other.id !== item.id && isExplicitlyLinked(item, other)
  );
  const relatedIdSet = new Set(relatedItems.map((r) => r.id));
  const smartRecommendations = findRecommendedUnlinkedItems(item, allItems, 5);
  const linkableCandidates = allItems.filter(
    (other) => other.id !== item.id && !relatedIdSet.has(other.id)
  );

  // Configure two contextual online relation tabs depending on item category
  const primaryTabLabel =
    item.category === 'film'
      ? '演职员（影人）'
      : item.category === 'person'
        ? '参演 / 执导影视'
        : '出处影视';
  const secondaryTabLabel =
    item.category === 'character' ? '饰演 / 配音' : '登场角色';

  const primaryList =
    item.category === 'film' ? onlineRelations.people : onlineRelations.films;
  const secondaryList =
    item.category === 'character'
      ? onlineRelations.people
      : onlineRelations.characters;

  const visibleOnlineList =
    relationsTab === 'primary' ? primaryList : secondaryList;
  const filmCoverage = (count: number) => count ? `已收录 ${count}` : relationsLoading ? '查询中' : '待补充';
  const totalOnlineCount = primaryList.length + secondaryList.length;

  const filterNorm = relationsFilter.trim().toLowerCase();
  const filteredOnlineList = filterNorm
    ? visibleOnlineList.filter((cand) =>
        [cand.title, cand.originalTitle, cand.subtitle, cand.portrayedBy]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(filterNorm)
      )
    : visibleOnlineList;
  const displayedOnlineList =
    relationsExpanded || filterNorm
      ? filteredOnlineList
      : filteredOnlineList.slice(0, 12);

  const imdbTitleId = item.category === 'film' ? extractImdbIdFromUrl(item.sourceUrl) : null;
  const isCharacter = item.category === 'character';
  const completeness = computeItemCompleteness(item);
  const charTitleParts = isCharacter
    ? splitCharacterTitle(item.title)
    : { primaryName: item.title, secondaryAlias: undefined };

  const linkedWorkItem = isCharacter
    ? relatedItems.find((r) => r.category === 'film')
    : undefined;
  const linkedActorItem = isCharacter
    ? relatedItems.find((r) => r.category === 'person')
    : undefined;

  const quickCreateTargets: ArchiveCategory[] =
    item.category === 'film' ? ['person', 'character'] : ['film', 'character'];

  const handleJumpToTop = () => {
    setActiveSection('overview');
    bodyScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleJumpToRelations = () => {
    setActiveSection('relations');
    relationsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleJumpToEditNotes = () => {
    setActiveSection('notes');
    setEditTab('notes');
    requestAnimationFrame(() => {
      editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleJumpToEditSpecs = () => {
    setActiveSection('notes');
    setEditTab('dossier');
    requestAnimationFrame(() => {
      editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleJumpToGraph = () => {
    setActiveSection('graph');
    graphSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleJumpToSection = (id: DossierSectionId) => {
    if (id === 'overview') handleJumpToTop();
    else if (id === 'relations') handleJumpToRelations();
    else if (id === 'notes') handleJumpToEditNotes();
    else handleJumpToGraph();
  };

  const handleBodyScroll = useCallback(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    const progress = computeReadingProgress(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight
    );
    setReadingProgress(progress);

    const containerTop = el.getBoundingClientRect().top;
    const getOffset = (node: HTMLElement | null) =>
      node ? node.getBoundingClientRect().top - containerTop + el.scrollTop : undefined;

    const nextActive = computeActiveDossierSection(
      el.scrollTop,
      {
        overview: 0,
        relations: getOffset(relationsSectionRef.current),
        notes: getOffset(editFormRef.current),
        graph: getOffset(graphSectionRef.current),
      },
      Math.max(0, el.scrollHeight - el.clientHeight)
    );
    setActiveSection(nextActive);
  }, []);

  const handleQuickRating = async (starVal: number) => {
    if (quickBusy) return;
    const nextRating = item.rating === starVal ? 0 : starVal;
    setRating(nextRating);
    setQuickBusy(true);
    try {
      await onUpdateItem(item.id, { rating: nextRating });
      setSavedFeedback(nextRating > 0 ? `已评 ${nextRating}.0 星` : '已清除评分');
    } finally {
      setQuickBusy(false);
    }
  };

  const handleQuickStatus = async (nextStatus: CollectionStatus) => {
    if (quickBusy || nextStatus === item.status) return;
    setStatus(nextStatus);
    setQuickBusy(true);
    try {
      await onUpdateItem(item.id, { status: nextStatus });
      setSavedFeedback(`状态已更新为「${getStatusLabel(nextStatus, item.category)}」`);
    } finally {
      setQuickBusy(false);
    }
  };

  const accessionMetadataRows = useMemo(
    () => buildAccessionMetadataRows(item, item.watchLogs?.length ?? 0),
    [item]
  );

  const isDirty = (() => {
    if (rating !== item.rating) return true;
    if (status !== item.status) return true;
    if (quote.trim() !== (item.quote || '').trim()) return true;
    if (notes.trim() !== (item.notes || '').trim()) return true;
    if (relatedWorkTitle.trim() !== (item.relatedWorkTitle || '').trim()) return true;
    if (portrayedBy.trim() !== (item.portrayedBy || '').trim()) return true;
    if (coverUrlInput.trim() !== (item.coverUrl || '').trim()) return true;
    if (isCharacter) {
      const p = item.characterProfile;
      if (charAlias.trim() !== (p?.alias || '').trim()) return true;
      if (charIdentity.trim() !== (p?.identity || '').trim()) return true;
      if (charAffiliation.trim() !== (p?.affiliation || '').trim()) return true;
      if (charOrigin.trim() !== (p?.origin || '').trim()) return true;
      if (charAbilities.trim() !== (p?.abilities || '').trim()) return true;
      if (charFirstAppearance.trim() !== (p?.firstAppearance || '').trim()) return true;
      if (charCreator.trim() !== (p?.creator || '').trim()) return true;
      if (charHighlights.trim() !== (p?.highlights || '').trim()) return true;
      if (charBio.trim() !== (p?.bio || item.summary || '').trim()) return true;
    }
    return false;
  })();

  const handleResetDraft = () => {
    setRating(item.rating);
    setStatus(item.status);
    setQuote(item.quote || '');
    setNotes(item.notes || '');
    setRelatedWorkTitle(item.relatedWorkTitle || '');
    setPortrayedBy(item.portrayedBy || '');
    setCoverUrlInput(item.coverUrl || '');
    syncCharacterFormFromProfile(item.characterProfile, item.summary);
    setSavedFeedback('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedFeedback('');
    try {
      const patch: Partial<ArchiveItem> = {
        rating,
        status,
        quote: quote.trim() || undefined,
        notes: notes.trim(),
        relatedWorkTitle: relatedWorkTitle.trim() || undefined,
        portrayedBy: portrayedBy.trim() || undefined,
        coverUrl: coverUrlInput.trim()
          ? formatCoverUrlForMode(coverUrlInput.trim(), getRuntimeModeSync())
          : undefined,
      };

      if (isCharacter) {
        patch.characterProfile = {
          ...(item.characterProfile || {}),
          alias: charAlias.trim() || undefined,
          identity: charIdentity.trim() || undefined,
          affiliation: charAffiliation.trim() || undefined,
          origin: charOrigin.trim() || undefined,
          abilities: charAbilities.trim() || undefined,
          firstAppearance: charFirstAppearance.trim() || undefined,
          creator: charCreator.trim() || undefined,
          highlights: charHighlights.trim() || undefined,
          bio: charBio.trim() || undefined,
          enrichedAt:
            item.characterProfile?.enrichedAt || new Date().toISOString(),
        };
      }

      await onUpdateItem(item.id, patch);
      setSavedFeedback('已保存档案修订');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLink = async () => {
    if (!selectedLinkId) return;
    await onLinkExisting(item.id, selectedLinkId);
    setSelectedLinkId('');
  };

  const handleRemoveLink = async (removeId: string) => {
    await onUnlinkItems(item.id, removeId);
  };

  const handleCollectCandidate = async (candidate: OnlineSearchResult) => {
    setLinkingKey(candidate.externalId);
    try {
      await onCollectAndLink(item, candidate);
    } finally {
      setLinkingKey(null);
    }
  };

  const handleLinkCandidate = async (existingId: string, key: string) => {
    setLinkingKey(key);
    try {
      await onLinkExisting(item.id, existingId);
    } finally {
      setLinkingKey(null);
    }
  };

  const handleConfirmDelete = async () => {
    await onDeleteItem(item.id);
    onClose();
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-drawer-title"
      data-testid="detail-drawer-backdrop"
      variants={backdropVariants}
      initial="closed"
      animate="open"
      exit="closed"
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-[#1A1816]/55 backdrop-blur-[2px] md:items-stretch md:justify-end dark:bg-black/72"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Mobile Bottom Sheet (rounded-t-3xl) -> Side Drawer on Desktop; smoothly slides in from right */}
      <motion.div
        data-testid="detail-drawer-panel"
        variants={panelVariants}
        className="relative flex max-h-[92dvh] w-full max-w-full flex-col overflow-hidden rounded-t-3xl bg-[#F7F5F0] shadow-2xl will-change-transform md:h-full md:max-h-full md:max-w-[600px] md:rounded-none md:border-l md:border-[#DFD9CD] dark:bg-[#141210] dark:md:border-[#322D27]"
      >
        {/* Mobile Drag Handle */}
        <div
          className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden"
          aria-hidden="true"
        >
          <div className="h-1.5 w-10 rounded-full bg-[#D3CCC0] dark:bg-[#423B33]" />
        </div>

        {/* Sticky Sheet Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E4DFD5] bg-[#F7F5F0]/95 px-4 py-2.5 min-[420px]:px-5 dark:border-[#2E2924] dark:bg-[#141210]/95">
          <div className="min-w-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={item.id}
                variants={metaFadeVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] tabular-nums text-[#625C54] sm:gap-2 dark:text-[#A59D90]"
              >
                <span className="shrink-0 font-medium">{item.accessionNo}</span>
                <span aria-hidden="true" className="hidden min-[420px]:inline">/</span>
                <span className="hidden truncate min-[420px]:inline">{CATEGORY_LABELS[item.category]}档案</span>
                {positionLabel && (
                  <>
                    <span aria-hidden="true" className="hidden sm:inline">·</span>
                    <span className="hidden text-[#8C857B] sm:inline dark:text-[#9A9184]">{positionLabel}</span>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {(onPrevItem || onNextItem) && (
              <div className="mr-0.5 flex items-center rounded-xl border border-[#E0D9CD] bg-white p-0.5 dark:border-[#3A342D] dark:bg-[#1D1A17]">
                <button
                  type="button"
                  data-testid="drawer-prev-item-btn"
                  disabled={!onPrevItem}
                  onClick={handlePrevItem}
                  aria-label="上一件藏品"
                  title="上一件藏品 (←)"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[#4B453E] transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] disabled:opacity-35 cursor-pointer dark:text-[#C4BCB0] dark:hover:bg-[#2C2721] dark:hover:text-[#F3EFE6]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="drawer-next-item-btn"
                  disabled={!onNextItem}
                  onClick={handleNextItem}
                  aria-label="下一件藏品"
                  title="下一件藏品 (→)"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[#4B453E] transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] disabled:opacity-35 cursor-pointer dark:text-[#C4BCB0] dark:hover:bg-[#2C2721] dark:hover:text-[#F3EFE6]"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {onTogglePinShowcase && (
              <button
                type="button"
                data-testid="drawer-pin-showcase-btn"
                aria-pressed={isPinnedToShowcase}
                onClick={() => onTogglePinShowcase(item)}
                aria-label={
                  isPinnedToShowcase
                    ? `取消「${item.title}」的顶栏展位置顶`
                    : `将「${item.title}」设为顶栏主展位`
                }
                className={`inline-flex h-9 items-center gap-1 rounded-xl border px-2.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:text-xs ${
                  isPinnedToShowcase
                    ? 'border-[#1A1816] bg-[#1A1816] text-[#F5DC9B] dark:border-[#D4AF6A] dark:bg-[#2A241A] dark:text-[#F5DC9B]'
                    : 'border-[#DCD6CB] bg-white text-[#1A1816] hover:border-[#1A1816] dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]'
                }`}
              >
                <Pin className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{isPinnedToShowcase ? '已置顶' : '置顶展位'}</span>
                <span className="sm:hidden">{isPinnedToShowcase ? '已置顶' : '置顶'}</span>
              </button>
            )}
            {onOpenCardModal && (
              <button
                type="button"
                onClick={() => onOpenCardModal(item)}
                aria-label="以实体藏卡模式赏析"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-2.5 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] sm:px-3 md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
              >
                <Layers className="h-3.5 w-3.5 text-[#A67C37] dark:text-[#E4C37A]" aria-hidden="true" />
                <span>藏卡</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭档案详情"
              title="关闭 (Esc)"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#625C54] transition-colors hover:bg-[#EAE4D9] hover:text-[#1A1816] cursor-pointer sm:h-10 sm:w-10 dark:text-[#A59D90] dark:hover:bg-[#2A2520] dark:hover:text-[#F3EFE6]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scroll-Spy Section Anchor Strip + Hairline Reading Progress */}
        <nav
          aria-label="档案快捷定位"
          data-testid="dossier-section-nav"
          className="no-scrollbar relative flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#EAE4D9] bg-[#FAF8F3] px-4 min-[420px]:px-5 dark:border-[#2E2924] dark:bg-[#191613]"
        >
          {buildDossierSectionTabs({
            relatedCount: relatedItems.length,
            tagCount: item.tags.length,
            hasUnsavedChanges: isDirty,
          }).map((tab) => {
            const isActive = activeSection === tab.id;
            const isUnsavedNotes = tab.id === 'notes' && isDirty;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`dossier-nav-${tab.id}`}
                aria-current={isActive ? 'location' : undefined}
                onClick={() => handleJumpToSection(tab.id)}
                className={`relative min-h-[38px] shrink-0 px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#1A1816] dark:text-[#F5F1E8]'
                    : isUnsavedNotes
                      ? 'text-[#B43B2B] dark:text-[#F28C7B]'
                      : 'text-[#6E675E] hover:text-[#1A1816] dark:text-[#A59D90] dark:hover:text-[#F3EFE6]'
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <span className="ml-1 font-mono text-[11px] tabular-nums text-[#8C857B] dark:text-[#8E8578]">
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#B43B2B] dark:bg-[#E4C37A]"
                  />
                )}
              </button>
            );
          })}
          {/* Razor-Thin Reading Progress Hairline */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[1.5px] bg-[#B43B2B]/55 transition-[width] duration-150 ease-out dark:bg-[#E4C37A]/60"
            style={{ width: `${readingProgress}%` }}
          />
        </nav>

        {/* Scrollable Sheet Body */}
        <div
          ref={bodyScrollRef}
          onScroll={handleBodyScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 pb-12 min-[420px]:px-5 sm:px-6"
        >
          <AnimatePresence
            mode="wait"
            initial={false}
            custom={switchDirection}
            onExitComplete={() => {
              bodyScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
              setReadingProgress(0);
              setActiveSection('overview');
            }}
          >
            <motion.div
              key={item.id}
              data-testid="detail-drawer-content"
              data-item-id={item.id}
              data-transition-dir={switchDirection}
              custom={switchDirection}
              variants={contentVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {/* Atmospheric Cinematic Hero */}
              <div className="relative -mx-4 -mt-5 overflow-hidden px-4 pt-5 pb-5 min-[420px]:-mx-5 min-[420px]:px-5 sm:-mx-6 sm:px-6">
                {item.coverUrl && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden"
                  >
                    <img
                      src={item.coverUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full scale-110 transform-gpu object-cover opacity-[0.13] blur-xl saturate-125 dark:opacity-[0.20]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-[#F7F5F0]/35 via-[#F7F5F0]/78 to-[#F7F5F0] dark:from-[#141210]/40 dark:via-[#141210]/78 dark:to-[#141210]" />
                  </div>
                )}

                <div className="relative flex gap-4 sm:gap-5">
                  {/* Framed Poster Plate (Click to Lightbox + Quiet Inline Cover Action) */}
                  <div className="w-[114px] shrink-0 self-start min-[420px]:w-[126px] sm:w-[140px]">
                    <button
                      type="button"
                      data-testid="poster-lightbox-trigger"
                      onClick={() => {
                        if (item.coverUrl) {
                          setPosterLightboxOpen(true);
                        } else {
                          setCoverPickerOpen(true);
                        }
                      }}
                      aria-label={
                        item.coverUrl
                          ? `放大赏析「${item.title}」海报`
                          : `为「${item.title}」选择封面`
                      }
                      className="gallery-cover-frame group relative block w-full overflow-hidden rounded-[12px] border border-[#DFD8CA] shadow-[0_12px_28px_-14px_rgba(24,18,12,0.38)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B43B2B] dark:border-[#3A342C] dark:shadow-[0_14px_30px_-14px_rgba(0,0,0,0.75)]"
                    >
                      <ArchivalImage
                        src={item.coverUrl}
                        alt={`${item.title}封面`}
                        title={item.title}
                        category={item.category}
                        className="aspect-[3/4] w-full rounded-[11px]"
                        imgClassName="transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                      />
                      {item.coverUrl && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-2 bottom-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-[#191613]/72 text-[#F5F1E8] opacity-0 backdrop-blur-xs transition-opacity duration-150 group-hover:opacity-100"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      data-testid="change-cover-btn"
                      onClick={() => setCoverPickerOpen(true)}
                      className="mt-2 inline-flex min-h-[34px] w-full items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-medium text-[#625C54] transition-colors hover:bg-[#ECE6DB]/80 hover:text-[#1A1816] whitespace-nowrap cursor-pointer md:text-[11px] dark:text-[#A89F92] dark:hover:bg-[#27221D] dark:hover:text-[#F3EFE6]"
                    >
                      <ImagePlus className="h-3.5 w-3.5 shrink-0 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
                      <span>更换封面</span>
                    </button>
                  </div>

                  {/* Editorial Identity + Instant Inline Controls */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    {/* Unboxed Completeness Kicker */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                      <span
                        className={`font-medium tracking-[0.04em] ${
                          completeness.tier === 'masterpiece'
                            ? 'text-[#8E6523] dark:text-[#E4C37A]'
                            : 'text-[#6E675E] dark:text-[#B8AFA2]'
                        }`}
                      >
                        {completeness.tierLabel}级
                      </span>
                      <span className="font-mono tabular-nums text-[#8C857B] dark:text-[#8E8578]">
                        {completeness.score}/{completeness.maxScore}
                      </span>
                      <span
                        aria-hidden="true"
                        className="inline-grid w-14 grid-cols-5 gap-0.5"
                      >
                        {[0, 1, 2, 3, 4].map((idx) => (
                          <span
                            key={idx}
                            className={`h-[2px] rounded-full ${
                              idx < completeness.score
                                ? completeness.tier === 'masterpiece'
                                  ? 'bg-[#A67C37] dark:bg-[#D4AF6A]'
                                  : 'bg-[#B43B2B] dark:bg-[#E06856]'
                                : 'bg-[#DDD6C9] dark:bg-[#353029]'
                            }`}
                          />
                        ))}
                      </span>
                      {completeness.tier !== 'masterpiece' && completeness.missingLabels[0] && (
                        <button
                          type="button"
                          onClick={handleJumpToEditNotes}
                          className="text-[#8E6523] underline decoration-[#CBB896] underline-offset-4 transition-colors hover:text-[#B43B2B] cursor-pointer dark:text-[#E4C37A] dark:decoration-[#6B593B] dark:hover:text-[#F5DC9B]"
                        >
                          补齐「{completeness.missingLabels[0]}」
                        </button>
                      )}
                    </div>

                    {/* Title & Subtitle */}
                    <h2
                      id="detail-drawer-title"
                      className="mt-2 font-editorial text-[24px] font-medium leading-[1.22] tracking-[0.01em] text-[#1A1816] min-[420px]:text-[26px] sm:text-[28px] dark:text-[#F5F1E8]"
                    >
                      {charTitleParts.primaryName}
                    </h2>
                    {isCharacter && charTitleParts.secondaryAlias && (
                      <p className="mt-0.5 text-[14px] font-medium text-[#524C44] dark:text-[#C4BCB0]">
                        {charTitleParts.secondaryAlias}
                      </p>
                    )}
                    {item.originalTitle && (
                      <p className="mt-1 break-words text-[13px] tracking-[0.01em] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                        {item.originalTitle}
                      </p>
                    )}

                    {isCharacter ? (
                      <div className="mt-2 space-y-1 text-[13px] text-[#4B453E] md:text-xs dark:text-[#C4BCB0]">
                        {(item.relatedWorkTitle || linkedWorkItem) && (
                          <p className="truncate">
                            <span className="text-[#8C857B] dark:text-[#9A9184]">出处：</span>
                            {linkedWorkItem ? (
                              <button
                                type="button"
                                onClick={() => onSelectRelated(linkedWorkItem)}
                                className="font-medium text-[#1A1816] underline decoration-[#CFC7B9] underline-offset-4 hover:text-[#B43B2B] cursor-pointer dark:text-[#F3EFE6] dark:decoration-[#5A5247] dark:hover:text-[#F28C7B]"
                              >
                                《{linkedWorkItem.title}》
                              </button>
                            ) : (
                              <span className="font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                                《{item.relatedWorkTitle}》
                              </span>
                            )}
                          </p>
                        )}
                        {(item.portrayedBy || linkedActorItem) && (
                          <p className="truncate">
                            <span className="text-[#8C857B] dark:text-[#9A9184]">饰演：</span>
                            {linkedActorItem ? (
                              <button
                                type="button"
                                onClick={() => onSelectRelated(linkedActorItem)}
                                className="font-medium text-[#1A1816] underline decoration-[#CFC7B9] underline-offset-4 hover:text-[#B43B2B] cursor-pointer dark:text-[#F3EFE6] dark:decoration-[#5A5247] dark:hover:text-[#F28C7B]"
                              >
                                {linkedActorItem.title}
                              </button>
                            ) : (
                              <span className="font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                                {item.portrayedBy}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    ) : (
                      item.subtitle && (
                        <p className="mt-1.5 text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C8C0B4]">
                          {item.subtitle}
                        </p>
                      )
                    )}

                    {/* Instant 1-Click 5-Star Rating */}
                    <div
                      data-testid="hero-quick-rating"
                      className="mt-3.5 flex items-center gap-0.5 sm:gap-1"
                      onMouseLeave={() => setHoverRating(null)}
                    >
                      {[1, 2, 3, 4, 5].map((starVal) => {
                        const displayVal = hoverRating ?? item.rating;
                        const filled = starVal <= displayVal;
                        return (
                          <button
                            key={starVal}
                            type="button"
                            disabled={quickBusy}
                            data-testid={`hero-star-${starVal}`}
                            onMouseEnter={() => setHoverRating(starVal)}
                            onClick={() => void handleQuickRating(starVal)}
                            aria-label={
                              item.rating === starVal
                                ? `取消 ${starVal} 星评分`
                                : `评为 ${starVal} 星`
                            }
                            aria-pressed={item.rating >= starVal}
                            className="flex h-7 w-7 items-center justify-center rounded-lg transition-transform duration-150 hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-50 sm:h-8 sm:w-8"
                          >
                            <Star
                              className={`h-[17px] w-[17px] transition-colors sm:h-[18px] sm:w-[18px] ${
                                filled
                                  ? 'fill-[#B43B2B] text-[#B43B2B] dark:fill-[#EB7865] dark:text-[#EB7865]'
                                  : 'text-[#CFC7B9] hover:text-[#B43B2B]/60 dark:text-[#4D453C] dark:hover:text-[#EB7865]/70'
                              }`}
                            />
                          </button>
                        );
                      })}
                      <span className="ml-1.5 shrink-0 whitespace-nowrap font-mono text-[12px] tabular-nums text-[#625C54] dark:text-[#B8AFA2]">
                        {item.rating > 0 ? (
                          <>
                            <span>{item.rating}.0</span>
                            <span className="hidden sm:inline"> / 5</span>
                          </>
                        ) : (
                          '点击评分'
                        )}
                      </span>
                    </div>

                    {/* Instant 1-Click 4-State Status Switcher */}
                    <div
                      data-testid="hero-quick-status"
                      role="group"
                      aria-label="快捷切换收藏状态"
                      className="mt-2.5 grid grid-cols-4 gap-1 rounded-xl border border-[#E2DBD0] bg-[#FAF8F3]/90 p-1 dark:border-[#322D27] dark:bg-[#1B1815]/90"
                    >
                      {STATUS_CHOICES.map((st) => {
                        const active = item.status === st;
                        const isFav = st === 'favorite';
                        return (
                          <button
                            key={st}
                            type="button"
                            disabled={quickBusy}
                            data-testid={`hero-status-${st}`}
                            aria-pressed={active}
                            onClick={() => void handleQuickStatus(st)}
                            className={`min-h-[34px] rounded-lg px-1.5 text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-60 ${
                              active
                                ? isFav
                                  ? 'bg-[#221D17] text-[#F2D68A] shadow-xs dark:bg-[#E4C37A] dark:text-[#141210]'
                                  : 'bg-[#1A1816] text-[#F7F5F0] shadow-xs dark:bg-[#F3EFE6] dark:text-[#141210]'
                                : 'text-[#625C54] hover:bg-[#EFEAE0] hover:text-[#1A1816] dark:text-[#A59D90] dark:hover:bg-[#2A2520] dark:hover:text-[#F3EFE6]'
                            }`}
                          >
                            {getStatusLabel(st, item.category)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Museum Accession Metadata Ledger */}
              <dl
                data-testid="dossier-accession-ledger"
                className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#E6E0D5] pt-4 sm:grid-cols-3 dark:border-[#2C2721]"
              >
                {accessionMetadataRows.map((row) => (
                  <div key={row.key} className="min-w-0">
                    <dt className="text-[11px] tracking-[0.06em] text-[#8C857B] dark:text-[#8E8578]">
                      {row.label}
                    </dt>
                    <dd
                      className={`mt-0.5 truncate text-[13px] font-medium text-[#1A1816] md:text-xs dark:text-[#EFEAE0] ${
                        row.mono ? 'font-mono tabular-nums' : ''
                      }`}
                    >
                      {row.href ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 text-[#1A1816] underline decoration-[#C9C0B1] underline-offset-4 transition-colors hover:text-[#B43B2B] dark:text-[#EFEAE0] dark:decoration-[#5A5247] dark:hover:text-[#E4C37A]"
                        >
                          <span className="truncate">{row.value}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                      ) : (
                        row.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Quick Cross-Jump Strip: Album & Tag Index */}
              <DetailCrossJumpBar
                item={item}
                allItems={allItems}
                albums={albums}
                onJumpToAlbum={(albumId, focusItemId) =>
                  onJumpToAlbum?.(albumId, focusItemId)
                }
                onJumpToTag={(tag, focusItemId) => onFilterByTag(tag, focusItemId)}
                onAddToAlbum={onAddToAlbum}
              />

              {/* Editorial Pull Quote */}
              {item.quote && (
                <blockquote className="mt-6 border-y border-[#E2DCD0] py-4.5 text-center dark:border-[#2C2721]">
                  <p className="font-editorial text-[17px] italic leading-[1.7] text-[#292521] md:text-[16.5px] dark:text-[#EFE9DE]">
                    “{item.quote}”
                  </p>
                </blockquote>
              )}

              {/* Curator's Personal Notes Reading Block (Previously Hidden Inside Bottom Textarea!) */}
              {!isCharacter && item.notes?.trim() && (
                <section
                  aria-label="策展手记"
                  data-testid="dossier-curator-notes"
                  className="mt-6 rounded-xl border border-[#E6E0D5] bg-[#FAF8F3] px-4 py-3.5 dark:border-[#2E2924] dark:bg-[#1B1815]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-medium tracking-[0.12em] text-[#8E6523] dark:text-[#E4C37A]">
                      策展手记
                    </h3>
                    <button
                      type="button"
                      onClick={handleJumpToEditNotes}
                      className="inline-flex items-center gap-1 text-[11px] text-[#7A7268] transition-colors hover:text-[#1A1816] cursor-pointer dark:text-[#9A9184] dark:hover:text-[#F3EFE6]"
                    >
                      <PencilLine className="h-3 w-3" aria-hidden="true" />
                      <span>编辑</span>
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-[14.5px] leading-[1.8] text-[#2B2723] md:text-[14px] dark:text-[#E2DBD0]">
                    {item.notes}
                  </p>
                </section>
              )}

              {/* Character: Dedicated Structured Dossier Card | Film/Person: Prose Summary */}
              {isCharacter ? (
                <CharacterDossierSection
                  item={item}
                  loading={dossierLoading}
                  error={dossierError}
                  onRefresh={() => setDossierReloadTick((t) => t + 1)}
                  onJumpToEditSpecs={handleJumpToEditSpecs}
                />
              ) : (
                item.summary && (
                  <section aria-label="档案梗概" className="mt-6">
                    <h3 className="text-[11px] font-medium tracking-[0.12em] text-[#8C857B] dark:text-[#8E8578]">
                      {item.category === 'person' ? '人物简介' : '作品梗概'}
                    </h3>
                    <p
                      className={`mt-2 text-[15px] leading-[1.82] text-[#2E2A26] md:text-[14.5px] dark:text-[#DED7CB] ${
                        !summaryExpanded && item.summary.length > 220
                          ? 'line-clamp-4'
                          : ''
                      }`}
                    >
                      {item.summary}
                      <SummarySource revision={item.summaryRevision} />
                    </p>
                    {item.summary.length > 220 && (
                      <button
                        type="button"
                        onClick={() => setSummaryExpanded((v) => !v)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-[#7A7268] transition-colors hover:text-[#1A1816] cursor-pointer dark:text-[#A59D90] dark:hover:text-[#F3EFE6]"
                      >
                        <span>{summaryExpanded ? '收起简介' : '展开全文'}</span>
                        {summaryExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </section>
                )
              )}

              {/* Watch & Rewatch Log Module for Films */}
              {item.category === 'film' && (
                <WatchLogSection item={item} onUpdateItem={onUpdateItem} />
              )}

              {/* Cinema Medal Showcase (Positioned Below Core Story & Watch Log) */}
              <DetailMedalShowcase
                item={item}
                allItems={allItems}
                onFilterByTag={(tag) => onFilterByTag(tag, item.id)}
                onJumpToMedalHall={onJumpToMedalHall}
              />

              {/* Dedicated Tag Management: Autocomplete + Instant Same-Tag Filtering */}
              <div ref={relationsSectionRef} className="scroll-mt-3">
                <DetailTagManager
                  item={item}
                  allItems={allItems}
                  onUpdateTags={(nextTags) => onUpdateItem(item.id, { tags: nextTags })}
                  onFilterByTag={onFilterByTag}
                  onSelectRelated={onSelectRelated}
                />
              </div>

              {/* Cross-Entity Links: Existing Collected Relations (Compact 2-Col Archival Grid) */}
              <section
                className="mt-7 border-t border-[#E6E0D5] pt-5 dark:border-[#2C2721]"
                aria-label="已关联馆藏"
                data-testid="linked-relations-section"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-medium tracking-[0.08em] text-[#6E675E] dark:text-[#A59D90]">
                    已关联馆藏
                    <span className="ml-1.5 font-mono text-[11px] tabular-nums text-[#8C857B] dark:text-[#8E8578]">
                      {relatedItems.length}
                    </span>
                  </h3>
                </div>

                {relatedItems.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {relatedItems.map((rel) => {
                      const canUnlink =
                        item.relatedIds.includes(rel.id) ||
                        rel.relatedIds.includes(item.id);
                      return (
                        <div
                          key={rel.id}
                          data-testid={`linked-item-${rel.id}`}
                          className="group/rel flex items-center justify-between gap-2 rounded-xl border border-[#E4DFD5] bg-[#FFFDF9] p-2.5 transition-colors hover:border-[#C8BFB0] dark:border-[#302B25] dark:bg-[#1B1815] dark:hover:border-[#4D453B]"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectRelated(rel)}
                            aria-label={`跳转查看关联${CATEGORY_LABELS[rel.category]}「${rel.title}」`}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
                          >
                            <ArchivalImage
                              src={rel.coverUrl}
                              alt={rel.title}
                              title={rel.title}
                              category={rel.category}
                              compact
                              className="h-12 w-9 shrink-0 rounded-lg"
                            />
                            <div className="min-w-0">
                              <p className="text-[11px] text-[#8C857B] dark:text-[#9A9184]">
                                {CATEGORY_LABELS[rel.category]}
                                {rel.year ? ` · ${rel.year}` : ''}
                              </p>
                              <p className="truncate font-editorial text-[14px] font-medium text-[#1A1816] transition-colors group-hover/rel:text-[#B43B2B] dark:text-[#F3EFE6] dark:group-hover/rel:text-[#F28C7B]">
                                {rel.title}
                              </p>
                              {rel.subtitle && (
                                <p className="truncate text-[11px] text-[#6E675E] dark:text-[#A59D90]">
                                  {rel.subtitle}
                                </p>
                              )}
                            </div>
                          </button>
                          {canUnlink && (
                            <button
                              type="button"
                              onClick={() => void handleRemoveLink(rel.id)}
                              aria-label={`取消与「${rel.title}」的关联`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#9A9287] transition-colors hover:bg-[#F3EFE8] hover:text-[#B43B2B] cursor-pointer dark:text-[#8E8578] dark:hover:bg-[#2C2721] dark:hover:text-[#F28C7B]"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2.5 text-[13px] leading-relaxed text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                    {item.category === 'film'
                      ? '尚未关联影人或角色。可直接从下方联网名单一键收录关联，或手动建档。'
                      : item.category === 'person'
                        ? '尚未关联影视或其他藏品，可在下方联网名单一键收录关联。'
                        : '尚未关联馆内影视或影人。收录出处作品或演员后，可在此直接跳转。'}
                  </p>
                )}

                {/* Smart Unlinked Library Recommendations Based on Work / Actor Names */}
                {smartRecommendations.length > 0 && (
                  <div
                    data-testid="detail-smart-link-suggestions"
                    className="mt-3.5 rounded-xl border border-[#E5D5BE] bg-[#FFFDF8] p-3.5 dark:border-[#5A4930] dark:bg-[#241E16]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#8E6523] md:text-xs dark:text-[#E4C37A]">
                        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          发现 {smartRecommendations.length} 项相关未关联藏品
                        </span>
                      </p>
                      <span className="shrink-0 text-[12px] text-[#8C857B] md:text-[11px] dark:text-[#A59D90]">
                        一键建立链接
                      </span>
                    </div>

                    <ul className="mt-2.5 space-y-2">
                      {smartRecommendations.map(({ item: recItem, reason }) => (
                        <li
                          key={`rec-${recItem.id}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-[#ECE4D6] bg-white p-2.5 dark:border-[#3B3328] dark:bg-[#1A1714]"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectRelated(recItem)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
                          >
                            <ArchivalImage
                              src={recItem.coverUrl}
                              alt={recItem.title}
                              title={recItem.title}
                              category={recItem.category}
                              compact
                              className="h-12 w-9 shrink-0 rounded-lg"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-editorial text-[14px] font-medium text-[#1A1816] md:text-xs dark:text-[#F3EFE6]">
                                {recItem.title}
                              </p>
                              <p className="mt-0.5 truncate text-[12px] text-[#6E665C] md:text-[11px] dark:text-[#A59D90]">
                                <span className="text-[#A67C37] dark:text-[#E4C37A]">
                                  {CATEGORY_LABELS[recItem.category]}
                                </span>
                                <span aria-hidden="true"> · </span>
                                <span>{reason}</span>
                              </p>
                            </div>
                          </button>

                          <button
                            type="button"
                            data-testid={`detail-smart-link-btn-${recItem.id}`}
                            onClick={() => void onLinkExisting(item.id, recItem.id)}
                            className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-3 text-[13px] font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.97] md:min-h-[36px] md:text-xs"
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>一键关联</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Manual Link From Existing Collection */}
                {linkableCandidates.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <label htmlFor="add-related-select" className="sr-only">
                      选择要关联的藏品
                    </label>
                    <div className="relative min-w-0 flex-1">
                      <Link2
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B] md:h-3.5 md:w-3.5 dark:text-[#9A9184]"
                        aria-hidden="true"
                      />
                      <select
                        id="add-related-select"
                        value={selectedLinkId}
                        onChange={(e) => setSelectedLinkId(e.target.value)}
                        className="h-11 w-full rounded-xl border border-[#DCD6CB] bg-white pl-9 pr-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:pl-8 md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                      >
                        <option value="">关联馆内其他条目…</option>
                        {linkableCandidates.map((cand) => (
                          <option key={cand.id} value={cand.id}>
                            [{CATEGORY_LABELS[cand.category]}] {cand.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      disabled={!selectedLinkId}
                      onClick={() => void handleAddLink()}
                      className="inline-flex h-11 shrink-0 items-center gap-1 rounded-xl border border-[#DCD6CB] bg-white px-4 text-[14px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer disabled:opacity-40 md:px-3.5 md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      关联
                    </button>
                  </div>
                )}
              </section>

              {/* Live Online Discovery: Films & People ONLY (Hairline-Separated Section) */}
              {!isCharacter && (
              <section
                className="mt-7 border-t border-[#E6E0D5] pt-5 dark:border-[#2C2721]"
                aria-label="联网演职员与角色发现"
                data-testid="online-relations-section"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[12px] font-medium tracking-[0.08em] text-[#6E675E] dark:text-[#A59D90]">
                  {item.category === 'film'
                    ? '联网演职员与登场角色'
                    : '联网参演作品与角色'}
                </h3>
                {imdbTitleId?.startsWith('tt') && (
                  <a href={`https://www.imdb.com/title/${imdbTitleId}/fullcredits/`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#625C54] underline dark:text-[#B8AFA2]">
                    IMDb 完整演职员表 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
                {onlineRelations.castArticleRevision && (
                  <p className="mt-1 text-xs text-[#625C54] dark:text-[#B8AFA2]">
                    角色署名参考
                    <a className="ml-1 underline" href={`https://en.wikipedia.org/w/index.php?oldid=${onlineRelations.castArticleRevision}`}
                      target="_blank" rel="noopener noreferrer">维基百科原文</a>
                  </p>
                )}
                {onlineRelations.sources.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-[#7A7268] md:text-[11px] dark:text-[#A59D90]">
                    资料来源：{onlineRelations.sources.join(' · ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={relationsLoading}
                onClick={() => setRelationsReloadTick((t) => t + 1)}
                aria-label="重新检索联网关联"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer disabled:opacity-40 dark:text-[#A59D90] dark:hover:bg-[#2C2721] dark:hover:text-[#F3EFE6]"
              >
                <RefreshCw
                  className={`h-4 w-4 ${relationsLoading ? 'animate-spin' : ''}`}
                />
              </button>
            </div>

            {/* Segmented Tab Toggle */}
            <div
              role="tablist"
              aria-label="关联类型切换"
              className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#EFECE5] p-1 dark:bg-[#24201C]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={relationsTab === 'primary'}
                onClick={() => {
                  setRelationsTab('primary');
                  setRelationsFilter('');
                  setRelationsExpanded(false);
                }}
                className={`min-h-[42px] rounded-lg px-2 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-xs ${
                  relationsTab === 'primary'
                    ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                    : 'text-[#625C54] dark:text-[#A89F92]'
                }`}
              >
                {primaryTabLabel}
                <span className="ml-1 font-mono text-[12px] tabular-nums opacity-75 md:text-[11px]">
                  {item.category === 'film' ? filmCoverage(primaryList.length) : primaryList.length}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={relationsTab === 'secondary'}
                onClick={() => {
                  setRelationsTab('secondary');
                  setRelationsFilter('');
                  setRelationsExpanded(false);
                }}
                className={`min-h-[42px] rounded-lg px-2 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-xs ${
                  relationsTab === 'secondary'
                    ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                    : 'text-[#625C54] dark:text-[#A89F92]'
                }`}
              >
                {secondaryTabLabel}
                <span className="ml-1 font-mono text-[12px] tabular-nums opacity-75 md:text-[11px]">
                  {item.category === 'film' ? filmCoverage(secondaryList.length) : secondaryList.length}
                </span>
              </button>
            </div>

            {/* Quick Inline Filter for Large Casts (>8 entries) */}
            {visibleOnlineList.length > 8 && (
              <div className="relative mt-2.5">
                <label htmlFor="online-relations-filter" className="sr-only">
                  在联网名单中快速筛查
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B] md:h-3.5 md:w-3.5 dark:text-[#9A9184]"
                  aria-hidden="true"
                />
                <input
                  id="online-relations-filter"
                  type="search"
                  value={relationsFilter}
                  onChange={(e) => setRelationsFilter(e.target.value)}
                  placeholder={`在全部 ${visibleOnlineList.length} 位名单中快速查找…`}
                  className="h-11 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] pl-9 pr-9 text-[16px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:bg-white focus:outline-none md:h-10 md:pl-8 md:pr-8 md:text-xs dark:border-[#3A342D] dark:bg-[#181512] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A] dark:focus:bg-[#1D1A17]"
                />
                {relationsFilter && (
                  <button
                    type="button"
                    onClick={() => setRelationsFilter('')}
                    aria-label="清空筛查"
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#625C54] cursor-pointer dark:text-[#A59D90]"
                  >
                    <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Content Area */}
            <div className="mt-3">
              {relationsLoading && visibleOnlineList.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#7A7268] dark:text-[#A59D90]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#B43B2B] dark:text-[#EB7865]" />
                  <span>正在查找演职员与角色…</span>
                </div>
              ) : relationsError && !visibleOnlineList.length ? (
                <div className="py-4 text-center">
                  <p className="text-xs text-[#B43B2B] dark:text-[#F28C7B]">{relationsError}</p>
                  <button
                    type="button"
                    onClick={() => setRelationsReloadTick((t) => t + 1)}
                    className="mt-2.5 min-h-[40px] rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-4 text-xs font-medium text-[#1A1816] cursor-pointer dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6]"
                  >
                    重试检索
                  </button>
                </div>
              ) : displayedOnlineList.length > 0 ? (
                <>
                  <ul className="space-y-2">
                    {displayedOnlineList.map((cand) => {
                      const existing = findExistingItemByTitle(
                        allItems,
                        cand.category,
                        cand.title,
                        {
                          originalTitle: cand.originalTitle,
                          sourceUrl: cand.sourceUrl,
                          year: cand.year,
                        }
                      );
                      const isLinked = existing
                        ? relatedIdSet.has(existing.id)
                        : false;
                      const isBusy = linkingKey === cand.externalId;
                      const matchedAliasLabel =
                        existing && existing.title !== cand.title
                          ? `馆内：${existing.title}`
                          : undefined;

                      return (
                        <li
                          key={cand.externalId}
                          className="flex items-center justify-between gap-2.5 rounded-xl border border-[#ECE7DD] bg-[#FAF9F6] p-2 dark:border-[#322D27] dark:bg-[#24201C]"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <ArchivalImage
                              src={existing?.coverUrl || cand.coverUrl}
                              alt={existing?.title || cand.title}
                              title={existing?.title || cand.title}
                              category={cand.category}
                              compact
                              className="h-14 w-11 shrink-0 rounded-lg"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-editorial text-[15px] font-medium text-[#1A1816] md:text-sm dark:text-[#F3EFE6]">
                                {cand.title}
                              </p>
                              {(cand.subtitle || matchedAliasLabel) && (
                                <p className="mt-0.5 line-clamp-1 text-[12px] text-[#625C54] md:text-[11px] dark:text-[#A59D90]">
                                  {[cand.subtitle, matchedAliasLabel]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              )}
                            </div>
                          </div>

                          {isLinked && existing ? (
                            <button
                              type="button"
                              onClick={() => onSelectRelated(existing)}
                              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[#D8D1C4] bg-white px-3 text-[13px] font-medium text-[#4B453E] whitespace-nowrap cursor-pointer md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#C4BCB0]"
                            >
                              <Check
                                className="h-3.5 w-3.5 text-[#2A6B46] dark:text-[#6CC492]"
                                aria-hidden="true"
                              />
                              已关联
                            </button>
                          ) : existing ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleLinkCandidate(
                                  existing.id,
                                  cand.externalId
                                )
                              }
                              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[#1A1816] bg-white px-3 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer disabled:opacity-50 md:text-xs dark:border-[#D4AF6A] dark:bg-[#1D1A17] dark:text-[#F3EFE6]"
                            >
                              <Link2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              立即关联
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleCollectCandidate(cand)}
                              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-3 text-[13px] font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:bg-[#932D20] disabled:opacity-50 md:text-xs"
                            >
                              <Plus
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {isBusy ? '收录中' : '收录关联'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {!filterNorm && filteredOnlineList.length > 12 && (
                    <button
                      type="button"
                      onClick={() => setRelationsExpanded((v) => !v)}
                      className="mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] text-[13px] font-medium text-[#3D3832] cursor-pointer active:scale-[0.99] md:min-h-[42px] md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#E5DED2]"
                    >
                      {relationsExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          收起名单
                        </>
                      ) : (
                        <>
                          <ChevronDown
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          展开全部 {filteredOnlineList.length} 位（还有{' '}
                          {filteredOnlineList.length - 12} 位）
                        </>
                      )}
                    </button>
                  )}
                </>
              ) : (
                <p className="py-4 text-center text-[13px] leading-relaxed text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                  {filterNorm
                    ? `名单中未匹配到「${relationsFilter}」`
                    : totalOnlineCount > 0
                      ? '当前标签下暂无联网记录，可切换另一个标签查看。'
                      : '未从公共资料库检索到该条目的演职员或角色名单，可直接手动建档并自动关联。'}
                </p>
              )}
            </div>

            {/* Quick Manual Create & Pre-Link Shortcuts */}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-[#EFECE5] pt-3 dark:border-[#2E2924]">
              {quickCreateTargets.map((targetCat) => (
                <button
                  key={targetCat}
                  type="button"
                  onClick={() => onQuickCreateRelated(item, targetCat)}
                  className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.98] md:min-h-[40px] md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
                >
                  <UserPlus className="h-3.5 w-3.5 text-[#7A7268] dark:text-[#A59D90]" aria-hidden="true" />
                  手动建档{CATEGORY_LABELS[targetCat]}并关联
                </button>
              ))}
            </div>
          </section>
          )}

          {/* Edit Form */}
          <form
            ref={editFormRef}
            id="detail-edit-form"
            onSubmit={handleSave}
            className="mt-7 space-y-4 border-t border-[#E4DFD5] pt-6 dark:border-[#2E2924]"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-medium tracking-[0.06em] text-[#7A7268] md:text-xs md:tracking-[0.08em] dark:text-[#A59D90]">
                {isCharacter ? '完善角色档案与评注' : '个人评注与编辑'}
              </h3>
            </div>

            {isCharacter && (
              <div
                role="tablist"
                aria-label="角色编辑分区"
                className="grid grid-cols-2 gap-1 rounded-xl bg-[#EFECE5] p-1 dark:bg-[#24201C]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={editTab === 'notes'}
                  onClick={() => setEditTab('notes')}
                  className={`min-h-[42px] rounded-lg px-2 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-xs ${
                    editTab === 'notes'
                      ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                      : 'text-[#625C54] dark:text-[#A89F92]'
                  }`}
                >
                  收藏与评注
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editTab === 'dossier'}
                  onClick={() => setEditTab('dossier')}
                  className={`min-h-[42px] rounded-lg px-2 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-xs ${
                    editTab === 'dossier'
                      ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                      : 'text-[#625C54] dark:text-[#A89F92]'
                  }`}
                >
                  角色设定档案
                </button>
              </div>
            )}

            {(!isCharacter || editTab === 'notes') && (
              <>
                {/* Status Grid */}
                <div>
                  <span className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]">
                    收藏状态
                  </span>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {STATUS_CHOICES.map((st) => {
                      const active = status === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setStatus(st)}
                          className={`min-h-[44px] rounded-xl text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[42px] md:text-xs ${
                            active
                              ? 'bg-[#1A1816] text-white dark:bg-[#F3EFE6] dark:text-[#141210]'
                              : 'border border-[#DCD6CB] bg-white text-[#4B453E] dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#C4BCB0]'
                          }`}
                        >
                          {getStatusLabel(st, item.category)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 44px Touch Star Rating */}
                <div>
                  <span className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]">
                    个人评分
                  </span>
                  <div className="mt-1.5 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((starVal) => (
                      <button
                        key={starVal}
                        type="button"
                        onClick={() => setRating(rating === starVal ? 0 : starVal)}
                        aria-label={`评为 ${starVal} 星`}
                        aria-pressed={rating >= starVal}
                        className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[#ECE7DD] cursor-pointer dark:hover:bg-[#2A2520]"
                      >
                        <Star
                          className={`h-6 w-6 ${
                            starVal <= rating
                              ? 'fill-[#B43B2B] text-[#B43B2B] dark:fill-[#EB7865] dark:text-[#EB7865]'
                              : 'text-[#CBC3B6] dark:text-[#4E463D]'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 font-mono text-[13px] tabular-nums text-[#625C54] md:text-xs dark:text-[#A59D90]">
                      {rating > 0 ? `${rating}.0 / 5` : '未评'}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-quote"
                    className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                  >
                    经典台词 / 语录
                  </label>
                  <input
                    id="detail-quote"
                    type="text"
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    placeholder="摘录最打动你的一句话…"
                    className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                  />
                </div>

                {isCharacter && (
                  <div>
                    <label
                      htmlFor="detail-char-highlights"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      名场面 / 高光时刻
                    </label>
                    <textarea
                      id="detail-char-highlights"
                      rows={2}
                      value={charHighlights}
                      onChange={(e) => setCharHighlights(e.target.value)}
                      placeholder="记下最难忘的出场镜头、反转或高光片段…"
                      className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2.5 text-[16px] leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="detail-notes"
                    className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                  >
                    {isCharacter ? '喜欢理由 / 收藏手记' : '观影手记 / 收藏理由'}
                  </label>
                  <textarea
                    id="detail-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="写下你的感受或备忘…"
                    className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2.5 text-[16px] leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                  />
                </div>

                {!isCharacter && (
                  <div>
                    <label
                      htmlFor="detail-work"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      {item.category === 'person' ? '代表作品' : '导演 / 主创'}
                    </label>
                    <input
                      id="detail-work"
                      type="text"
                      value={relatedWorkTitle}
                      onChange={(e) => setRelatedWorkTitle(e.target.value)}
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                )}

                {!isCharacter && (
                  <div>
                    <label
                      htmlFor="detail-cover"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      自定义封面链接（自动服务端直连代理）
                    </label>
                    <input
                      id="detail-cover"
                      type="text"
                      value={coverUrlInput}
                      onChange={(e) => setCoverUrlInput(e.target.value)}
                      placeholder="https://..."
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 font-mono text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                )}
              </>
            )}

            {isCharacter && editTab === 'dossier' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-char-alias"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      别名 / 称号
                    </label>
                    <input
                      id="detail-char-alias"
                      type="text"
                      value={charAlias}
                      onChange={(e) => setCharAlias(e.target.value)}
                      placeholder="如 毁灭博士 / 雷神"
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-char-identity"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      身份定位
                    </label>
                    <input
                      id="detail-char-identity"
                      type="text"
                      value={charIdentity}
                      onChange={(e) => setCharIdentity(e.target.value)}
                      placeholder="如 拉托维尼亚君主 · 科学家"
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-char-affiliation"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      所属阵营 / 组织
                    </label>
                    <input
                      id="detail-char-affiliation"
                      type="text"
                      value={charAffiliation}
                      onChange={(e) => setCharAffiliation(e.target.value)}
                      placeholder="如 复仇者联盟 / 拉托维尼亚"
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-char-origin"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      出身 / 籍贯
                    </label>
                    <input
                      id="detail-char-origin"
                      type="text"
                      value={charOrigin}
                      onChange={(e) => setCharOrigin(e.target.value)}
                      placeholder="如 阿斯加德 / 布鲁克林"
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-char-abilities"
                    className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                  >
                    能力 / 武器 / 性格特质
                  </label>
                  <input
                    id="detail-char-abilities"
                    type="text"
                    value={charAbilities}
                    onChange={(e) => setCharAbilities(e.target.value)}
                    placeholder="如 天才智力 · 魔法 · 动力装甲"
                    className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-char-first"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      首次登场
                    </label>
                    <input
                      id="detail-char-first"
                      type="text"
                      value={charFirstAppearance}
                      onChange={(e) => setCharFirstAppearance(e.target.value)}
                      placeholder="如 《神奇四侠》#5（1962）"
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-char-creator"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      原案创作者
                    </label>
                    <input
                      id="detail-char-creator"
                      type="text"
                      value={charCreator}
                      onChange={(e) => setCharCreator(e.target.value)}
                      placeholder="如 斯坦·李 · 杰克·科比"
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-work"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      出处作品
                    </label>
                    <input
                      id="detail-work"
                      type="text"
                      value={relatedWorkTitle}
                      onChange={(e) => setRelatedWorkTitle(e.target.value)}
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-actor"
                      className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                    >
                      饰演演员 / 配音
                    </label>
                    <input
                      id="detail-actor"
                      type="text"
                      value={portrayedBy}
                      onChange={(e) => setPortrayedBy(e.target.value)}
                      className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-char-bio"
                    className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                  >
                    人物小传（角色背景与生平）
                  </label>
                  <textarea
                    id="detail-char-bio"
                    rows={4}
                    value={charBio}
                    onChange={(e) => setCharBio(e.target.value)}
                    placeholder="填写角色背景故事、性格演变或人物脉络…"
                    className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2.5 text-[16px] leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="detail-cover"
                    className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                  >
                    自定义角色剧照链接（自动服务端直连代理）
                  </label>
                  <input
                    id="detail-cover"
                    type="text"
                    value={coverUrlInput}
                    onChange={(e) => setCoverUrlInput(e.target.value)}
                    placeholder="https://..."
                    className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 font-mono text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:h-11 md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                  />
                </div>
              </div>
            )}

            {savedFeedback && (
              <p
                role="status"
                className="rounded-xl border border-[#C8DFD0] bg-[#F2F7F4] px-3.5 py-2.5 text-[13px] font-medium text-[#2A6B46] md:text-xs dark:border-[#2B523B] dark:bg-[#172B20] dark:text-[#6CC492]"
              >
                {savedFeedback}
              </p>
            )}

          </form>

          {/* Bottom Deep Relation SVG Network Graph Preview */}
          <div ref={graphSectionRef} className="scroll-mt-3">
            <DetailRelationGraph
              item={item}
              allItems={allItems}
              onSelectItem={onSelectRelated}
              onOpenGlobalMap={onOpenGlobalMap}
            />
          </div>

          {/* Quiet Destructive Action Row */}
          <div className="mt-5 flex items-center justify-between border-t border-[#E4DFD5] pt-3 dark:border-[#2E2924]">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-medium text-[#7A7268] hover:text-[#B43B2B] cursor-pointer md:min-h-[42px] md:text-xs dark:text-[#A59D90] dark:hover:text-[#F28C7B]"
              >
                <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
                移除此藏品
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  className="min-h-[42px] rounded-xl bg-[#B43B2B] px-4 text-[13px] font-medium text-white cursor-pointer md:min-h-[40px] md:text-xs"
                >
                  确认移除
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[42px] rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[13px] text-[#4B453E] cursor-pointer md:min-h-[40px] md:text-xs dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#C4BCB0]"
                >
                  取消
                </button>
              </div>
            )}
            </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Transient Floating Toast Feedback (for Instant Hero Controls & Save) */}
        <AnimatePresence>
          {savedFeedback && !isDirty && (
            <motion.div
              key="drawer-saved-toast"
              data-testid="drawer-saved-toast"
              role="status"
              aria-live="polite"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-none absolute right-5 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 inline-flex items-center gap-1.5 rounded-xl border border-[#C8DFD0] bg-[#191613]/92 px-3.5 py-2 text-xs font-medium text-[#F5F1E8] shadow-lg backdrop-blur-xs dark:border-[#2B523B] dark:bg-[#172B20] dark:text-[#9FE2BC]"
            >
              <Check className="h-3.5 w-3.5 text-[#6CC492]" aria-hidden="true" />
              <span>{savedFeedback}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Contextual Dirty-Only Sticky Save Bar (Frees 68px Reading Canvas When Clean) */}
        <AnimatePresence>
          {(isDirty || saving) && (
            <motion.div
              key="drawer-dirty-save-bar"
              data-testid="drawer-dirty-save-bar"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="border-t border-[#E4DFD5] bg-[#FAF8F3]/96 px-4 py-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] backdrop-blur-xs min-[420px]:px-5 dark:border-[#2E2924] dark:bg-[#191613]/96"
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleResetDraft}
                  disabled={saving}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[14px] font-medium text-[#4B453E] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] hover:text-[#1A1816] disabled:opacity-50 md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>还原</span>
                </button>
                <button
                  type="submit"
                  form="detail-edit-form"
                  disabled={saving}
                  className="h-11 flex-1 rounded-xl bg-[#B43B2B] text-[15px] font-medium text-white shadow-xs transition-colors hover:bg-[#932D20] active:scale-[0.98] cursor-pointer disabled:opacity-60 md:text-sm"
                >
                  {saving ? '保存中…' : '保存档案修订'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* High-Resolution Poster Lightbox */}
      <AnimatePresence>
        {posterLightboxOpen && item.coverUrl && (
          <motion.div
            key="poster-lightbox"
            data-testid="poster-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`${item.title}高清海报赏析`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.08 : 0.2 }}
            onClick={() => setPosterLightboxOpen(false)}
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#0C0A09]/92 p-5 backdrop-blur-md"
          >
            <motion.div
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-full max-w-full flex-col items-center"
            >
              <img
                src={item.coverUrl}
                alt={`${item.title}高清海报`}
                referrerPolicy="no-referrer"
                className="max-h-[76dvh] w-auto max-w-[90vw] rounded-xl border border-white/15 object-contain shadow-2xl"
              />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-center">
                <p className="font-editorial text-[15px] text-[#F5F1E8]">
                  <span className="mr-2 font-mono text-xs text-[#A59D90]">
                    {item.accessionNo}
                  </span>
                  <span>{item.title}</span>
                  {item.year && (
                    <span className="ml-2 font-mono text-xs text-[#A59D90]">
                      {item.year}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPosterLightboxOpen(false);
                      setCoverPickerOpen(true);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-medium text-[#F5F1E8] transition-colors hover:bg-white/20 cursor-pointer"
                  >
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>更换封面</span>
                  </button>
                  <button
                    type="button"
                    data-testid="poster-lightbox-close"
                    onClick={() => setPosterLightboxOpen(false)}
                    aria-label="关闭海报大图"
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-medium text-[#F5F1E8] transition-colors hover:bg-white/20 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>关闭</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CoverPickerModal
        open={coverPickerOpen}
        item={item}
        onClose={() => setCoverPickerOpen(false)}
        onApplyCover={async (nextCoverUrl) => {
          await onUpdateItem(item.id, { coverUrl: nextCoverUrl });
          setCoverUrlInput(nextCoverUrl || '');
          setSavedFeedback('封面已更新');
        }}
      />
    </motion.div>
  );
}
