import { useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarCheck2,
  Check,
  Dices,
  Layers,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ArchiveItem,
  CollectorAlbum,
  CollectorState,
} from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  buildCollectorRank,
  computeCheckInStreak,
  computeCollectorStamps,
  computeItemCompleteness,
  formatLocalDateKey,
  pickDailySpotlightItem,
  resolveAlbumItems,
} from '../utils/collector';
import { collectTagRegistry } from '../utils/tags';
import { ArchivalImage } from './ArchivalImage';

interface CollectorSpotlightRailProps {
  items: ArchiveItem[];
  collector: CollectorState;
  activeAlbumId: string;
  onCheckInToday: () => Promise<void>;
  onOpenDetail: (item: ArchiveItem) => void;
  onOpenCardModal: (item: ArchiveItem) => void;
  onTriggerRandomEncounter: () => void;
  onSelectAlbum: (albumId: string) => void;
  onCreateAlbum: (draft: {
    name: string;
    tag?: string;
    targetCount: number;
  }) => Promise<void>;
  onDeleteAlbum: (albumId: string) => Promise<void>;
  onJumpToSearch: (prefillQuery?: string) => void;
  onJumpToProfile: () => void;
}

const TARGET_PRESETS = [3, 5, 8, 10, 12];

export function CollectorSpotlightRail({
  items,
  collector,
  activeAlbumId,
  onCheckInToday,
  onOpenDetail,
  onOpenCardModal,
  onTriggerRandomEncounter,
  onSelectAlbum,
  onCreateAlbum,
  onDeleteAlbum,
  onJumpToSearch,
  onJumpToProfile,
}: CollectorSpotlightRailProps) {
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [albumTag, setAlbumTag] = useState('');
  const [albumTarget, setAlbumTarget] = useState(5);
  const [albumError, setAlbumError] = useState('');

  const todayKey = useMemo(() => formatLocalDateKey(), []);
  const streak = useMemo(
    () => computeCheckInStreak(collector.checkInDates, todayKey),
    [collector.checkInDates, todayKey]
  );
  const rank = useMemo(
    () => buildCollectorRank(items, collector),
    [items, collector]
  );
  const stamps = useMemo(
    () => computeCollectorStamps(items, collector, todayKey),
    [items, collector, todayKey]
  );
  const unlockedStampCount = stamps.filter((s) => s.unlocked).length;

  const spotlightItem = useMemo(
    () => pickDailySpotlightItem(items, todayKey, 0),
    [items, todayKey]
  );

  const tagRegistry = useMemo(() => collectTagRegistry(items), [items]);

  const handleSubmitAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = albumName.trim();
    if (!cleanName) {
      setAlbumError('请填写图鉴册名称');
      return;
    }
    setAlbumError('');
    await onCreateAlbum({
      name: cleanName,
      tag: albumTag.trim() || undefined,
      targetCount: albumTarget,
    });
    setAlbumName('');
    setAlbumTag('');
    setAlbumTarget(5);
    setShowCreateAlbum(false);
  };

  const GENERIC_ALBUM_TAGS = new Set(['电影', '影视', '演员', '影人', '角色', '剧集']);
  const availableAlbumTags = tagRegistry.filter(
    (entry) =>
      !collector.albums.some(
        (a) => a.tag?.toLowerCase() === entry.name.toLowerCase()
      )
  );
  const quickSuggestTag =
    availableAlbumTags.find(
      (entry) =>
        !/^\d{4}$/.test(entry.name) && !GENERIC_ALBUM_TAGS.has(entry.name)
    ) ?? availableAlbumTags[0];

  if (items.length === 0) return null;

  const spotlightComp = spotlightItem
    ? computeItemCompleteness(spotlightItem)
    : null;

  return (
    <section
      aria-label="今日馆藏与专题图鉴"
      data-testid="collector-spotlight-section"
      className="mx-auto max-w-[1180px] px-4 pt-3.5 pb-1 min-[420px]:px-5 md:px-8 md:pt-5"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch lg:gap-5">
        {/* 1. Daily Archival Spotlight & Check-in Ritual Card */}
        {spotlightItem && spotlightComp && (
          <div
            data-testid="daily-spotlight-card"
            className="gallery-card-dark flex flex-col justify-between overflow-hidden border border-[#342F28] p-4 min-[420px]:p-5 text-[#F5F1E8] lg:col-span-7"
          >
            <div>
              {/* Top Ritual Strip: Curator Rank + Daily Check-In Stamp */}
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                <button
                  type="button"
                  onClick={onJumpToProfile}
                  aria-label={`查看馆主印记：Lv.${rank.level} ${rank.title}`}
                  className="flex min-w-0 items-center gap-2 text-left cursor-pointer group"
                >
                  <Award
                    className="h-4 w-4 shrink-0 text-[#D4AF6A]"
                    aria-hidden="true"
                  />
                  <span className="truncate text-[14px] font-medium text-[#FAF7F0] group-hover:underline md:text-xs">
                    Lv.{rank.level} {rank.title}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-[#A59D90] shrink-0 md:text-[11px]">
                    · 印记 {unlockedStampCount}/{stamps.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void onCheckInToday()}
                  aria-label={
                    streak.checkedInToday
                      ? `今日已巡馆打卡，已连续 ${streak.currentStreak} 天`
                      : '今日巡馆打卡'
                  }
                  data-testid="daily-checkin-btn"
                  className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:text-xs ${
                    streak.checkedInToday
                      ? 'border border-[#C9A45C]/50 bg-[#C9A45C]/15 text-[#E4C37A]'
                      : 'bg-[#B43B2B] text-white active:scale-[0.97] hover:bg-[#932D20]'
                  }`}
                >
                  {streak.checkedInToday ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="tabular-nums">
                        已巡馆 · {streak.currentStreak}天
                      </span>
                    </>
                  ) : (
                    <>
                      <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>今日打卡</span>
                    </>
                  )}
                </button>
              </div>

              {/* Spotlight Body */}
              <div className="mt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => onOpenCardModal(spotlightItem)}
                  aria-label={`以实体藏卡赏析「${spotlightItem.title}」`}
                  className="gallery-cover-frame group w-[86px] min-[420px]:w-[96px] sm:w-[108px] shrink-0 border border-white/15 bg-[#12110F] cursor-pointer active:scale-[0.97] transition-transform"
                >
                  <ArchivalImage
                    src={spotlightItem.coverUrl}
                    alt={spotlightItem.title}
                    title={spotlightItem.title}
                    category={spotlightItem.category}
                    compact
                    className="aspect-[3/4] w-full rounded-[14px]"
                    imgClassName="group-hover:scale-[1.04]"
                  />
                </button>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-2 text-[12px] text-[#A59D90] md:text-[11px]">
                    <span className="truncate font-mono tabular-nums">
                      今日藏签 · {spotlightItem.accessionNo} ·{' '}
                      {CATEGORY_LABELS[spotlightItem.category]}
                    </span>
                    <span
                      className={`shrink-0 whitespace-nowrap font-mono tabular-nums ${
                        spotlightComp.tier === 'masterpiece'
                          ? 'font-medium text-[#E4C37A]'
                          : 'text-[#CFC7B9]'
                      }`}
                    >
                      {spotlightComp.tierLabel} {spotlightComp.score}/5
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenDetail(spotlightItem)}
                    className="mt-1.5 text-left cursor-pointer group"
                  >
                    <h2 className="truncate font-editorial text-[21px] font-medium leading-snug text-[#FAF7F0] transition-colors group-hover:text-[#F2D68A] md:text-[22px]">
                      {spotlightItem.title}
                    </h2>
                  </button>

                  {spotlightItem.originalTitle && (
                    <p className="mt-0.5 truncate text-xs text-[#9E9588]">
                      {spotlightItem.originalTitle}
                    </p>
                  )}

                  <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-[#CFC7B9] md:text-[13px]">
                    {spotlightItem.quote
                      ? `“${spotlightItem.quote}”`
                      : spotlightItem.notes || spotlightComp.nextHint}
                  </p>

                  {/* 5-Tick Completeness Bar */}
                  <div className="mt-auto pt-3">
                    <div className="grid max-w-[220px] grid-cols-5 gap-1">
                      {[0, 1, 2, 3, 4].map((idx) => (
                        <span
                          key={idx}
                          className={`h-1 rounded-full ${
                            idx < spotlightComp.score
                              ? spotlightComp.tier === 'masterpiece'
                                ? 'bg-[#D4AF6A]'
                                : 'bg-[#B43B2B]'
                              : 'bg-white/15'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Row */}
            <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-white/10 pt-3.5">
              <button
                type="button"
                onClick={() => onOpenCardModal(spotlightItem)}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-2.5 text-[13px] font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer transition-colors hover:bg-white/14 active:scale-[0.98] md:text-xs"
              >
                <Layers className="h-3.5 w-3.5 shrink-0 text-[#D4AF6A]" aria-hidden="true" />
                <span>实体藏卡</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenDetail(spotlightItem)}
                className="inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl bg-[#FAF7F0] px-2.5 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:bg-[#EFE9DC] active:scale-[0.98] md:text-xs"
              >
                <span>
                  {spotlightComp.tier === 'masterpiece' ? '查看档案' : '点亮典藏'}
                </span>
              </button>

              <button
                type="button"
                onClick={onTriggerRandomEncounter}
                data-testid="random-encounter-btn"
                aria-label="随机邂逅一件馆藏"
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[#C9A45C]/60 bg-[#C9A45C]/15 px-2.5 text-[13px] font-medium text-[#F5DC9B] whitespace-nowrap cursor-pointer active:scale-[0.97] transition-colors hover:bg-[#C9A45C]/25 md:text-xs"
              >
                <Dices className="h-3.5 w-3.5 shrink-0 text-[#E4C37A]" aria-hidden="true" />
                <span>随机邂逅</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. Themed Collector Albums Shelf (图鉴册：可视化空槽收集感) */}
        <div
          className="flex flex-col justify-between rounded-[22px] border border-[#E6E0D4] bg-[#FFFDF9] p-4 min-[420px]:p-5 lg:col-span-5"
          data-testid="collector-albums-section"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <BookOpen
                  className="h-4 w-4 text-[#8E6523]"
                  aria-hidden="true"
                />
                <h3 className="font-editorial text-[16px] font-medium text-[#1A1816] md:text-[15px]">
                  专题图鉴册
                </h3>
                {collector.albums.length > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-[#8C857B]">
                    {collector.albums.length}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowCreateAlbum((v) => !v)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] hover:bg-white active:scale-[0.97]"
              >
                {showCreateAlbum ? (
                  <>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>取消</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 text-[#B43B2B]" aria-hidden="true" />
                    <span>新建图鉴</span>
                  </>
                )}
              </button>
            </div>

            {/* Inline Create Album Form */}
            {showCreateAlbum && (
              <form
                onSubmit={handleSubmitAlbum}
                data-testid="create-album-form"
                className="mt-3 space-y-3 rounded-2xl border border-[#E4DFD5] bg-[#FAF9F6] p-3.5"
              >
                <div>
                  <label
                    htmlFor="album-name-input"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    图鉴册名称
                  </label>
                  <input
                    id="album-name-input"
                    type="text"
                    value={albumName}
                    onChange={(e) => {
                      setAlbumName(e.target.value);
                      if (albumError) setAlbumError('');
                    }}
                    placeholder="例如：港片黄金年代、宫崎骏全集"
                    className="mt-1 h-10 w-full rounded-xl border border-[#DCD6CB] bg-white px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
                  />
                  {albumError && (
                    <p role="alert" className="mt-1 text-xs text-[#B43B2B]">
                      {albumError}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="album-tag-input"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    关联标签（自动收纳入册）
                  </label>
                  <input
                    id="album-tag-input"
                    type="text"
                    value={albumTag}
                    onChange={(e) => setAlbumTag(e.target.value)}
                    placeholder="例如：港片美学"
                    className="mt-1 h-10 w-full rounded-xl border border-[#DCD6CB] bg-white px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
                  />
                  {tagRegistry.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tagRegistry.slice(0, 5).map((t) => (
                        <button
                          key={t.name}
                          type="button"
                          onClick={() => {
                            setAlbumTag(t.name);
                            if (!albumName.trim()) {
                              setAlbumName(`${t.name}专题图鉴`);
                            }
                          }}
                          className={`min-h-[32px] rounded-lg border px-2.5 text-xs cursor-pointer transition-colors ${
                            albumTag === t.name
                              ? 'border-[#1A1816] bg-[#1A1816] text-white'
                              : 'border-[#DCD6CB] bg-white text-[#4B453E] hover:border-[#1A1816]'
                          }`}
                        >
                          {t.name} ({t.count})
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <span className="block text-xs font-medium text-[#4B453E]">
                    集齐目标件数
                  </span>
                  <div className="mt-1 grid grid-cols-5 gap-1.5">
                    {TARGET_PRESETS.map((num) => (
                      <button
                        key={num}
                        type="button"
                        aria-pressed={albumTarget === num}
                        onClick={() => setAlbumTarget(num)}
                        className={`min-h-[36px] rounded-xl font-mono text-xs font-medium tabular-nums cursor-pointer transition-colors ${
                          albumTarget === num
                            ? 'bg-[#1A1816] text-white'
                            : 'border border-[#DCD6CB] bg-white text-[#4B453E] hover:border-[#1A1816]'
                        }`}
                      >
                        {num}件
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="h-10 w-full rounded-xl bg-[#B43B2B] text-xs font-medium text-white cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.98]"
                >
                  创建图鉴册
                </button>
              </form>
            )}

            {/* Album Rail / Cards */}
            {collector.albums.length > 0 ? (
              <div className="h-scroll-rail no-scrollbar mt-3 flex gap-3 pb-1">
                {collector.albums.map((album: CollectorAlbum) => {
                  const matched = resolveAlbumItems(album, items);
                  const filledCount = matched.length;
                  const isComplete = filledCount >= album.targetCount;
                  const pct = Math.min(
                    100,
                    Math.round((filledCount / Math.max(1, album.targetCount)) * 100)
                  );
                  const isActive = activeAlbumId === album.id;
                  const slotTotal = Math.min(5, Math.max(album.targetCount, 3));
                  const emptySlots = Math.max(0, slotTotal - matched.length);

                  return (
                    <div
                      key={album.id}
                      data-testid={`album-card-${album.id}`}
                      className={`${
                        collector.albums.length === 1 ? 'w-full' : 'w-[272px] lg:w-full'
                      } shrink-0 rounded-2xl border p-3.5 transition-colors ${
                        isActive
                          ? 'border-[#1A1816] bg-[#FAF8F3]'
                          : isComplete
                            ? 'border-[#C9A45C]/80 bg-[#FDFBF5]'
                            : 'border-[#ECE6DA] bg-[#FAF9F6]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectAlbum(isActive ? '' : album.id)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <p className="truncate font-editorial text-[15px] font-medium text-[#1A1816]">
                            {album.name}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#7A7268]">
                            {filledCount} / {album.targetCount} 件
                            {isComplete
                              ? ' · 已集齐'
                              : ` · 还差 ${album.targetCount - filledCount} 件`}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteAlbum(album.id)}
                          aria-label={`删除图鉴册「${album.name}」`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8C857B] hover:bg-[#EFECE5] hover:text-[#B43B2B] cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Progress Hairline */}
                      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-[#E8E2D7]">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isComplete ? 'bg-[#A67C37]' : 'bg-[#B43B2B]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      {/* Visual Collector Slots */}
                      <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                        {matched.slice(0, slotTotal).map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            onClick={() => onOpenDetail(it)}
                            aria-label={`查看图鉴藏品「${it.title}」`}
                            className="overflow-hidden rounded-[10px] border border-[#E4DFD5] bg-white shadow-[0_2px_6px_-2px_rgba(24,18,12,0.16)] cursor-pointer transition-transform hover:scale-[1.03]"
                          >
                            <ArchivalImage
                              src={it.coverUrl}
                              alt={it.title}
                              title={it.title}
                              category={it.category}
                              compact
                              className="aspect-[3/4] w-full rounded-[10px]"
                            />
                          </button>
                        ))}
                        {Array.from({ length: emptySlots }).map((_, idx) => (
                          <button
                            key={`empty-${idx}`}
                            type="button"
                            onClick={() => onJumpToSearch(album.tag || album.name)}
                            aria-label={`搜片补齐「${album.name}」空缺槽位`}
                            className="flex aspect-[3/4] w-full items-center justify-center rounded-[10px] border border-dashed border-[#CFC7B9] bg-white/80 text-[#9C9488] hover:border-[#B43B2B] hover:text-[#B43B2B] cursor-pointer transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              !showCreateAlbum && (
                <div className="mt-3.5 flex flex-col justify-between gap-4 rounded-2xl border border-dashed border-[#D8D0C2] bg-[#FAF8F4] p-4">
                  <div>
                    <p className="font-editorial text-[15px] font-medium text-[#1A1816]">
                      开启你的第一本专题图鉴册
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[#6E665C]">
                      按导演、题材或标签自动归集藏品，点亮空缺槽位让每一次补片更有仪式感。
                    </p>
                  </div>

                  {/* Preview Empty Slots */}
                  <div className="grid grid-cols-5 gap-1.5" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((slot) => (
                      <div
                        key={slot}
                        className="flex aspect-[3/4] items-center justify-center rounded-[10px] border border-dashed border-[#D8D0C2] bg-white/70 text-[#B8AFA2]"
                      >
                        <Plus className="h-3 w-3" />
                      </div>
                    ))}
                  </div>

                  {quickSuggestTag ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onCreateAlbum({
                          name: `${quickSuggestTag.name}专题图鉴`,
                          tag: quickSuggestTag.name,
                          targetCount: 5,
                        })
                      }
                      className="min-h-[40px] w-full rounded-xl bg-[#1A1816] px-4 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#B43B2B] active:scale-[0.98]"
                    >
                      一键创建「{quickSuggestTag.name}」图鉴
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCreateAlbum(true)}
                      className="min-h-[40px] w-full rounded-xl bg-[#1A1816] px-4 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#B43B2B] active:scale-[0.98]"
                    >
                      新建第一本图鉴
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
