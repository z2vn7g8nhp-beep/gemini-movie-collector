import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
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
  OnlineSearchResult,
} from '../types/archive';
import {
  apiFetchCharacterProfile,
  apiFetchRelations,
} from '../services/apiClient';
import {
  buildProxyImageUrl,
  CATEGORY_LABELS,
  findExistingItemByTitle,
  getStatusLabel,
} from '../utils/archive';
import {
  mergeCharacterProfile,
  splitCharacterTitle,
} from '../utils/characterProfile';
import { computeItemCompleteness } from '../utils/collector';
import {
  findRecommendedUnlinkedItems,
  isExplicitlyLinked,
} from '../utils/smartLink';
import { ArchivalImage } from './ArchivalImage';
import { CharacterDossierSection } from './CharacterDossierSection';
import { CoverPickerModal } from './CoverPickerModal';
import { DetailMedalShowcase } from './DetailMedalShowcase';
import { DetailRelationGraph } from './DetailRelationGraph';
import { DetailTagManager } from './DetailTagManager';

interface DetailDrawerProps {
  item: ArchiveItem | null;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSelectRelated: (item: ArchiveItem) => void;
  onFilterByTag: (tag: string) => void;
  onOpenCardModal?: (item: ArchiveItem) => void;
  onJumpToMedalHall?: () => void;
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

interface OnlineRelationsPayload {
  films: OnlineSearchResult[];
  people: OnlineSearchResult[];
  characters: OnlineSearchResult[];
  sources: string[];
}

const EMPTY_RELATIONS: OnlineRelationsPayload = {
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

export function DetailDrawer({
  item,
  allItems,
  onClose,
  onSelectRelated,
  onFilterByTag,
  onOpenCardModal,
  onJumpToMedalHall,
  onUpdateItem,
  onDeleteItem,
  onCollectAndLink,
  onLinkExisting,
  onUnlinkItems,
  onQuickCreateRelated,
}: DetailDrawerProps) {
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
  const editFormRef = useRef<HTMLFormElement | null>(null);

  // Live online relation discovery state (for films & people only)
  const [onlineRelations, setOnlineRelations] =
    useState<OnlineRelationsPayload>(EMPTY_RELATIONS);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

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
        const data = await apiFetchCharacterProfile({
          title: currentItem.title,
          originalTitle: currentItem.originalTitle,
          relatedWorkTitle: currentItem.relatedWorkTitle,
          sourceUrl: currentItem.sourceUrl,
          signal: controller.signal,
        });
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
  useEffect(() => {
    if (!item || item.category === 'character') {
      setOnlineRelations(EMPTY_RELATIONS);
      setRelationsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function fetchRelations() {
      setRelationsLoading(true);
      setRelationsError('');
      setOnlineRelations(EMPTY_RELATIONS);

      try {
        const data = await apiFetchRelations({
          category: item!.category,
          title: item!.title,
          originalTitle: item!.originalTitle,
          sourceUrl: item!.sourceUrl,
          signal: controller.signal,
        });
        if (cancelled) return;

        const next: OnlineRelationsPayload = {
          films: Array.isArray(data.films) ? data.films : [],
          people: Array.isArray(data.people) ? data.people : [],
          characters: Array.isArray(data.characters) ? data.characters : [],
          sources: Array.isArray(data.sources) ? data.sources : [],
        };
        setOnlineRelations(next);

        const primaryCount =
          item!.category === 'film' ? next.people.length : next.films.length;
        const secondaryCount = next.characters.length;
        if (primaryCount === 0 && secondaryCount > 0) {
          setRelationsTab('secondary');
        } else {
          setRelationsTab('primary');
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
    if (!item) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, onClose]);

  if (!item) return null;

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

  const handleJumpToEditNotes = () => {
    setEditTab('notes');
    requestAnimationFrame(() => {
      editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleJumpToEditSpecs = () => {
    setEditTab('dossier');
    requestAnimationFrame(() => {
      editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
          ? buildProxyImageUrl(coverUrlInput.trim())
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-drawer-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1A1816]/50 md:items-stretch md:justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Mobile Bottom Sheet (rounded-t-3xl) -> Side Drawer on Desktop */}
      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-[#F7F5F0] shadow-2xl md:h-full md:max-h-full md:max-w-xl md:rounded-none">
        {/* Mobile Drag Handle */}
        <div
          className="flex justify-center pt-2.5 pb-1 md:hidden"
          aria-hidden="true"
        >
          <div className="h-1.5 w-10 rounded-full bg-[#D3CCC0]" />
        </div>

        {/* Sticky Sheet Header */}
        <div className="flex items-center justify-between border-b border-[#E4DFD5] px-5 py-3">
          <div className="flex items-center gap-2 font-mono text-xs tabular-nums text-[#625C54]">
            <span>{item.accessionNo}</span>
            <span aria-hidden="true">/</span>
            <span>{CATEGORY_LABELS[item.category]}档案</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onOpenCardModal && (
              <button
                type="button"
                onClick={() => onOpenCardModal(item)}
                aria-label="以实体藏卡模式赏析"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer hover:border-[#1A1816]"
              >
                <Layers className="h-3.5 w-3.5 text-[#A67C37]" aria-hidden="true" />
                <span>藏卡</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭档案详情"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] hover:text-[#1A1816] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Sheet Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 pb-10 sm:px-6">
          {/* Header Block: Cover + Key Metadata */}
          <div className="flex gap-4">
            <div className="gallery-paper-mat w-[120px] shrink-0 self-start overflow-hidden border border-[#E4DFD5] p-2 sm:w-[144px]">
              <button
                type="button"
                onClick={() => setCoverPickerOpen(true)}
                aria-label={`更换「${item.title}」的封面`}
                className="gallery-cover-frame group relative block w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B43B2B]"
              >
                <ArchivalImage
                  src={item.coverUrl}
                  alt={`${item.title}封面`}
                  title={item.title}
                  category={item.category}
                  className="aspect-[3/4] w-full rounded-[14px]"
                />
              </button>
              <button
                type="button"
                data-testid="change-cover-btn"
                onClick={() => setCoverPickerOpen(true)}
                className="mt-2 inline-flex min-h-[34px] w-full items-center justify-center gap-1 rounded-xl bg-[#F2ECE2] px-2 text-[11px] font-medium text-[#3D3832] transition-colors hover:bg-[#E7E0D3] hover:text-[#1A1816] whitespace-nowrap cursor-pointer"
              >
                <ImagePlus className="h-3.5 w-3.5 shrink-0 text-[#B43B2B]" aria-hidden="true" />
                <span>换封面</span>
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <h2
                id="detail-drawer-title"
                className="font-editorial text-2xl font-medium leading-tight text-[#1A1816]"
              >
                {charTitleParts.primaryName}
              </h2>
              {isCharacter && charTitleParts.secondaryAlias && (
                <p className="mt-0.5 text-sm font-medium text-[#524C44]">
                  {charTitleParts.secondaryAlias}
                </p>
              )}
              {item.originalTitle && (
                <p className="mt-1 break-words text-xs text-[#7A7268]">
                  {item.originalTitle}
                </p>
              )}

              {isCharacter ? (
                <div className="mt-2.5 space-y-1 text-xs text-[#4B453E]">
                  {(item.relatedWorkTitle || linkedWorkItem) && (
                    <p className="truncate">
                      <span className="text-[#8C857B]">出处：</span>
                      {linkedWorkItem ? (
                        <button
                          type="button"
                          onClick={() => onSelectRelated(linkedWorkItem)}
                          className="font-medium text-[#1A1816] underline decoration-[#CFC7B9] underline-offset-4 hover:text-[#B43B2B] cursor-pointer"
                        >
                          《{linkedWorkItem.title}》
                        </button>
                      ) : (
                        <span className="font-medium text-[#1A1816]">
                          《{item.relatedWorkTitle}》
                        </span>
                      )}
                    </p>
                  )}
                  {(item.portrayedBy || linkedActorItem) && (
                    <p className="truncate">
                      <span className="text-[#8C857B]">饰演：</span>
                      {linkedActorItem ? (
                        <button
                          type="button"
                          onClick={() => onSelectRelated(linkedActorItem)}
                          className="font-medium text-[#1A1816] underline decoration-[#CFC7B9] underline-offset-4 hover:text-[#B43B2B] cursor-pointer"
                        >
                          {linkedActorItem.title}
                        </button>
                      ) : (
                        <span className="font-medium text-[#1A1816]">
                          {item.portrayedBy}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              ) : (
                item.subtitle && (
                  <p className="mt-1.5 text-xs font-medium text-[#3D3832]">
                    {item.subtitle}
                  </p>
                )
              )}

              <p className="mt-2.5 flex items-center flex-wrap gap-x-1.5 text-xs text-[#625C54] tabular-nums">
                <span>
                  {[
                    getStatusLabel(item.status, item.category),
                    item.year,
                    item.region,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {item.rating > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-0.5 font-mono text-[#B43B2B]">
                      <Star
                        className="h-3 w-3 fill-[#B43B2B] text-[#B43B2B]"
                        aria-hidden="true"
                      />
                      {item.rating}.0
                    </span>
                  </>
                )}
              </p>

              {item.sourceName && (
                <p className="mt-2 text-xs text-[#7A7268]">
                  来源：
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#1A1816] underline decoration-[#BFB6A7] underline-offset-4"
                    >
                      {item.sourceName}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    item.sourceName
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Prominent Dynamic Cinema Medal Showcase */}
          <DetailMedalShowcase
            item={item}
            allItems={allItems}
            onFilterByTag={onFilterByTag}
            onJumpToMedalHall={onJumpToMedalHall}
          />

          {/* Archival Completeness Strip */}
          <div className="mt-3.5 flex items-center justify-between gap-3 rounded-xl border border-[#E4DFD5] bg-white px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`font-medium ${
                    completeness.tier === 'masterpiece'
                      ? 'text-[#8E6523]'
                      : 'text-[#1A1816]'
                  }`}
                >
                  成色：{completeness.tierLabel}级
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#7A7268]">
                  {completeness.score} / {completeness.maxScore}
                </span>
              </div>
              <div className="mt-1.5 grid max-w-[180px] grid-cols-5 gap-1">
                {[0, 1, 2, 3, 4].map((idx) => (
                  <span
                    key={idx}
                    className={`h-1 rounded-full ${
                      idx < completeness.score
                        ? completeness.tier === 'masterpiece'
                          ? 'bg-[#A67C37]'
                          : 'bg-[#B43B2B]'
                        : 'bg-[#ECE7DD]'
                    }`}
                  />
                ))}
              </div>
            </div>
            {completeness.tier !== 'masterpiece' ? (
              <button
                type="button"
                onClick={handleJumpToEditNotes}
                className="min-h-[36px] shrink-0 rounded-lg border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer"
              >
                去补齐{completeness.missingLabels[0] ? `「${completeness.missingLabels[0]}」` : ''}
              </button>
            ) : (
              <span className="shrink-0 font-editorial text-xs text-[#8E6523]">
                已达典藏满格
              </span>
            )}
          </div>

          {/* Editorial Pull Quote */}
          {item.quote && (
            <blockquote className="mt-5 border-y border-[#DFD9CD] py-4 text-center">
              <p className="font-editorial text-base italic leading-relaxed text-[#292521]">
                “{item.quote}”
              </p>
            </blockquote>
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
              <p className="mt-5 text-sm leading-relaxed text-[#2E2A26]">
                {item.summary}
              </p>
            )
          )}

          {/* Dedicated Tag Management: Autocomplete + Instant Same-Tag Filtering */}
          <DetailTagManager
            item={item}
            allItems={allItems}
            onUpdateTags={(nextTags) => onUpdateItem(item.id, { tags: nextTags })}
            onFilterByTag={onFilterByTag}
            onSelectRelated={onSelectRelated}
          />

          {/* Cross-Entity Links: Existing Collected Relations */}
          <section
            className="mt-6"
            aria-label="已关联馆藏"
            data-testid="linked-relations-section"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium tracking-[0.08em] text-[#7A7268]">
                已关联馆藏（{relatedItems.length}）
              </h3>
            </div>

            {relatedItems.length > 0 ? (
              <div className="mt-2.5 space-y-2.5">
                {relatedItems.map((rel) => {
                  const canUnlink =
                    item.relatedIds.includes(rel.id) ||
                    rel.relatedIds.includes(item.id);
                  return (
                    <div
                      key={rel.id}
                      data-testid={`linked-item-${rel.id}`}
                      className="flex items-center justify-between gap-2 rounded-2xl border border-[#E4DFD5] bg-white p-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectRelated(rel)}
                        aria-label={`跳转查看关联${CATEGORY_LABELS[rel.category]}「${rel.title}」`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                      >
                        <ArchivalImage
                          src={rel.coverUrl}
                          alt={rel.title}
                          title={rel.title}
                          category={rel.category}
                          compact
                          className="h-14 w-11 shrink-0 rounded-xl"
                        />
                        <div className="min-w-0">
                          <p className="text-[11px] text-[#7A7268]">
                            {CATEGORY_LABELS[rel.category]}
                            {rel.year ? ` · ${rel.year}` : ''}
                          </p>
                          <p className="truncate font-editorial text-sm font-medium text-[#1A1816]">
                            {rel.title}
                          </p>
                          {rel.subtitle && (
                            <p className="truncate text-[11px] text-[#625C54]">
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
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#8C857B] hover:bg-[#F3EFE8] hover:text-[#B43B2B] cursor-pointer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 rounded-2xl border border-dashed border-[#DCD6CB] bg-white/60 px-3.5 py-3 text-xs leading-relaxed text-[#7A7268]">
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
                className="mt-3 rounded-2xl border border-[#E5D5BE] bg-[#FFFDF8] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-[#8E6523]">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      发现 {smartRecommendations.length} 项相关未关联藏品
                    </span>
                  </p>
                  <span className="text-[11px] text-[#8C857B]">
                    一键建立链接
                  </span>
                </div>

                <ul className="mt-2 space-y-2">
                  {smartRecommendations.map(({ item: recItem, reason }) => (
                    <li
                      key={`rec-${recItem.id}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#ECE4D6] bg-white p-2"
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
                          className="h-11 w-9 shrink-0 rounded-lg"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-editorial text-xs font-medium text-[#1A1816]">
                            {recItem.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-[#6E665C]">
                            <span className="text-[#A67C37]">
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
                        className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-2.5 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.97]"
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
                <div className="relative flex-1">
                  <Link2
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8C857B]"
                    aria-hidden="true"
                  />
                  <select
                    id="add-related-select"
                    value={selectedLinkId}
                    onChange={(e) => setSelectedLinkId(e.target.value)}
                    className="h-11 w-full rounded-xl border border-[#DCD6CB] bg-white pl-8 pr-3 text-xs text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
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
                  className="inline-flex h-11 items-center gap-1 rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  关联
                </button>
              </div>
            )}
          </section>

          {/* Live Online Discovery: Films & People ONLY (Characters focus on the Dossier above) */}
          {!isCharacter && (
          <section
            className="mt-6 rounded-2xl border border-[#E4DFD5] bg-white p-3.5 sm:p-4"
            aria-label="联网演职员与角色发现"
            data-testid="online-relations-section"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-medium tracking-[0.06em] text-[#1A1816]">
                  {item.category === 'film'
                    ? '联网演职员与登场角色'
                    : '联网参演作品与角色'}
                </h3>
                {onlineRelations.sources.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-[#7A7268]">
                    直连数据源：{onlineRelations.sources.join(' · ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={relationsLoading}
                onClick={() => setRelationsReloadTick((t) => t + 1)}
                aria-label="重新检索联网关联"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer disabled:opacity-40"
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
              className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#EFECE5] p-1"
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
                className={`min-h-[40px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  relationsTab === 'primary'
                    ? 'bg-white text-[#1A1816] shadow-xs'
                    : 'text-[#625C54]'
                }`}
              >
                {primaryTabLabel}
                <span className="ml-1 font-mono text-[11px] tabular-nums opacity-75">
                  {primaryList.length}
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
                className={`min-h-[40px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  relationsTab === 'secondary'
                    ? 'bg-white text-[#1A1816] shadow-xs'
                    : 'text-[#625C54]'
                }`}
              >
                {secondaryTabLabel}
                <span className="ml-1 font-mono text-[11px] tabular-nums opacity-75">
                  {secondaryList.length}
                </span>
              </button>
            </div>

            {/* Quick Inline Filter for Large Casts (>8 entries) */}
            {!relationsLoading && visibleOnlineList.length > 8 && (
              <div className="relative mt-2.5">
                <label htmlFor="online-relations-filter" className="sr-only">
                  在联网名单中快速筛查
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8C857B]"
                  aria-hidden="true"
                />
                <input
                  id="online-relations-filter"
                  type="search"
                  value={relationsFilter}
                  onChange={(e) => setRelationsFilter(e.target.value)}
                  placeholder={`在全部 ${visibleOnlineList.length} 位名单中快速查找…`}
                  className="h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] pl-8 pr-8 text-xs text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:bg-white focus:outline-none"
                />
                {relationsFilter && (
                  <button
                    type="button"
                    onClick={() => setRelationsFilter('')}
                    aria-label="清空筛查"
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#625C54] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Content Area */}
            <div className="mt-3">
              {relationsLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#7A7268]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#B43B2B]" />
                  <span>正在免代理检索完整演职员与角色名单…</span>
                </div>
              ) : relationsError ? (
                <div className="py-4 text-center">
                  <p className="text-xs text-[#B43B2B]">{relationsError}</p>
                  <button
                    type="button"
                    onClick={() => setRelationsReloadTick((t) => t + 1)}
                    className="mt-2.5 min-h-[40px] rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-4 text-xs font-medium text-[#1A1816] cursor-pointer"
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
                        cand.title
                      );
                      const isLinked = existing
                        ? relatedIdSet.has(existing.id)
                        : false;
                      const isBusy = linkingKey === cand.externalId;

                      return (
                        <li
                          key={cand.externalId}
                          className="flex items-center justify-between gap-2.5 rounded-xl border border-[#ECE7DD] bg-[#FAF9F6] p-2"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <ArchivalImage
                              src={cand.coverUrl}
                              alt={cand.title}
                              title={cand.title}
                              category={cand.category}
                              compact
                              className="h-14 w-11 shrink-0 rounded-lg"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-editorial text-sm font-medium text-[#1A1816]">
                                {cand.title}
                              </p>
                              {cand.subtitle && (
                                <p className="mt-0.5 line-clamp-1 text-[11px] text-[#625C54]">
                                  {cand.subtitle}
                                </p>
                              )}
                            </div>
                          </div>

                          {isLinked && existing ? (
                            <button
                              type="button"
                              onClick={() => onSelectRelated(existing)}
                              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[#D8D1C4] bg-white px-3 text-xs font-medium text-[#4B453E] whitespace-nowrap cursor-pointer"
                            >
                              <Check
                                className="h-3.5 w-3.5 text-[#2A6B46]"
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
                              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[#1A1816] bg-white px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer disabled:opacity-50"
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
                              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:bg-[#932D20] disabled:opacity-50"
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
                      className="mt-2.5 flex min-h-[42px] w-full items-center justify-center gap-1 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] text-xs font-medium text-[#3D3832] cursor-pointer active:scale-[0.99]"
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
                <p className="py-4 text-center text-xs leading-relaxed text-[#7A7268]">
                  {filterNorm
                    ? `名单中未匹配到「${relationsFilter}」`
                    : totalOnlineCount > 0
                      ? '当前标签下暂无联网记录，可切换另一个标签查看。'
                      : '未从公共资料库检索到该条目的演职员或角色名单，可直接手动建档并自动关联。'}
                </p>
              )}
            </div>

            {/* Quick Manual Create & Pre-Link Shortcuts */}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-[#EFECE5] pt-3">
              {quickCreateTargets.map((targetCat) => (
                <button
                  key={targetCat}
                  type="button"
                  onClick={() => onQuickCreateRelated(item, targetCat)}
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.98]"
                >
                  <UserPlus className="h-3.5 w-3.5 text-[#7A7268]" aria-hidden="true" />
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
            className="mt-7 space-y-4 border-t border-[#E4DFD5] pt-6"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-[0.08em] text-[#7A7268]">
                {isCharacter ? '完善角色档案与评注' : '个人评注与编辑'}
              </h3>
            </div>

            {isCharacter && (
              <div
                role="tablist"
                aria-label="角色编辑分区"
                className="grid grid-cols-2 gap-1 rounded-xl bg-[#EFECE5] p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={editTab === 'notes'}
                  onClick={() => setEditTab('notes')}
                  className={`min-h-[40px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    editTab === 'notes'
                      ? 'bg-white text-[#1A1816] shadow-xs'
                      : 'text-[#625C54]'
                  }`}
                >
                  收藏与评注
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editTab === 'dossier'}
                  onClick={() => setEditTab('dossier')}
                  className={`min-h-[40px] rounded-lg px-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    editTab === 'dossier'
                      ? 'bg-white text-[#1A1816] shadow-xs'
                      : 'text-[#625C54]'
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
                  <span className="block text-xs font-medium text-[#4B453E]">
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
                          className={`min-h-[42px] rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                            active
                              ? 'bg-[#1A1816] text-white'
                              : 'border border-[#DCD6CB] bg-white text-[#4B453E]'
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
                  <span className="block text-xs font-medium text-[#4B453E]">
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
                        className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[#ECE7DD] cursor-pointer"
                      >
                        <Star
                          className={`h-6 w-6 ${
                            starVal <= rating
                              ? 'fill-[#B43B2B] text-[#B43B2B]'
                              : 'text-[#CBC3B6]'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 font-mono text-xs tabular-nums text-[#625C54]">
                      {rating > 0 ? `${rating}.0 / 5` : '未评'}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-quote"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    经典台词 / 语录
                  </label>
                  <input
                    id="detail-quote"
                    type="text"
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    placeholder="摘录最打动你的一句话…"
                    className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>

                {isCharacter && (
                  <div>
                    <label
                      htmlFor="detail-char-highlights"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      名场面 / 高光时刻
                    </label>
                    <textarea
                      id="detail-char-highlights"
                      rows={2}
                      value={charHighlights}
                      onChange={(e) => setCharHighlights(e.target.value)}
                      placeholder="记下最难忘的出场镜头、反转或高光片段…"
                      className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="detail-notes"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    {isCharacter ? '喜欢理由 / 收藏手记' : '观影手记 / 收藏理由'}
                  </label>
                  <textarea
                    id="detail-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="写下你的感受或备忘…"
                    className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>

                {!isCharacter && (
                  <div>
                    <label
                      htmlFor="detail-work"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      {item.category === 'person' ? '代表作品' : '导演 / 主创'}
                    </label>
                    <input
                      id="detail-work"
                      type="text"
                      value={relatedWorkTitle}
                      onChange={(e) => setRelatedWorkTitle(e.target.value)}
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                )}

                {!isCharacter && (
                  <div>
                    <label
                      htmlFor="detail-cover"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      自定义封面链接（自动服务端直连代理）
                    </label>
                    <input
                      id="detail-cover"
                      type="text"
                      value={coverUrlInput}
                      onChange={(e) => setCoverUrlInput(e.target.value)}
                      placeholder="https://..."
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 font-mono text-xs text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
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
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      别名 / 称号
                    </label>
                    <input
                      id="detail-char-alias"
                      type="text"
                      value={charAlias}
                      onChange={(e) => setCharAlias(e.target.value)}
                      placeholder="如 毁灭博士 / 雷神"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-char-identity"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      身份定位
                    </label>
                    <input
                      id="detail-char-identity"
                      type="text"
                      value={charIdentity}
                      onChange={(e) => setCharIdentity(e.target.value)}
                      placeholder="如 拉托维尼亚君主 · 科学家"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-char-affiliation"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      所属阵营 / 组织
                    </label>
                    <input
                      id="detail-char-affiliation"
                      type="text"
                      value={charAffiliation}
                      onChange={(e) => setCharAffiliation(e.target.value)}
                      placeholder="如 复仇者联盟 / 拉托维尼亚"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-char-origin"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      出身 / 籍贯
                    </label>
                    <input
                      id="detail-char-origin"
                      type="text"
                      value={charOrigin}
                      onChange={(e) => setCharOrigin(e.target.value)}
                      placeholder="如 阿斯加德 / 布鲁克林"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-char-abilities"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    能力 / 武器 / 性格特质
                  </label>
                  <input
                    id="detail-char-abilities"
                    type="text"
                    value={charAbilities}
                    onChange={(e) => setCharAbilities(e.target.value)}
                    placeholder="如 天才智力 · 魔法 · 动力装甲"
                    className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-char-first"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      首次登场
                    </label>
                    <input
                      id="detail-char-first"
                      type="text"
                      value={charFirstAppearance}
                      onChange={(e) => setCharFirstAppearance(e.target.value)}
                      placeholder="如 《神奇四侠》#5（1962）"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-char-creator"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      原案创作者
                    </label>
                    <input
                      id="detail-char-creator"
                      type="text"
                      value={charCreator}
                      onChange={(e) => setCharCreator(e.target.value)}
                      placeholder="如 斯坦·李 · 杰克·科比"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="detail-work"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      出处作品
                    </label>
                    <input
                      id="detail-work"
                      type="text"
                      value={relatedWorkTitle}
                      onChange={(e) => setRelatedWorkTitle(e.target.value)}
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="detail-actor"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      饰演演员 / 配音
                    </label>
                    <input
                      id="detail-actor"
                      type="text"
                      value={portrayedBy}
                      onChange={(e) => setPortrayedBy(e.target.value)}
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="detail-char-bio"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    人物小传（角色背景与生平）
                  </label>
                  <textarea
                    id="detail-char-bio"
                    rows={4}
                    value={charBio}
                    onChange={(e) => setCharBio(e.target.value)}
                    placeholder="填写角色背景故事、性格演变或人物脉络…"
                    className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="detail-cover"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    自定义角色剧照链接（自动服务端直连代理）
                  </label>
                  <input
                    id="detail-cover"
                    type="text"
                    value={coverUrlInput}
                    onChange={(e) => setCoverUrlInput(e.target.value)}
                    placeholder="https://..."
                    className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 font-mono text-xs text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>
              </div>
            )}

            {savedFeedback && (
              <p
                role="status"
                className="rounded-xl border border-[#C8DFD0] bg-[#F2F7F4] px-3.5 py-2.5 text-xs font-medium text-[#2A6B46]"
              >
                {savedFeedback}
              </p>
            )}

          </form>

          {/* Bottom Deep Relation SVG Network Graph Preview */}
          <DetailRelationGraph
            item={item}
            allItems={allItems}
            onSelectItem={onSelectRelated}
          />

          {/* Quiet Destructive Action Row */}
          <div className="mt-5 flex items-center justify-between border-t border-[#E4DFD5] pt-3">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-[#7A7268] hover:text-[#B43B2B] cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                移除此藏品
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  className="min-h-[40px] rounded-xl bg-[#B43B2B] px-4 text-xs font-medium text-white cursor-pointer"
                >
                  确认移除
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[40px] rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-xs text-[#4B453E] cursor-pointer"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Bottom Save Bar */}
        <div className="border-t border-[#E4DFD5] bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="submit"
            form="detail-edit-form"
            disabled={saving}
            className="h-12 w-full rounded-xl bg-[#B43B2B] text-sm font-medium text-white cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#932D20] disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </div>

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
    </div>
  );
}
