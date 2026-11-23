import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  Clock,
  EyeOff,
  Heart,
  ImagePlus,
  Pin,
  Quote,
  RotateCcw,
  Search,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';
import type {
  ArchiveItem,
  ShowcaseConfig,
  ShowcasePrimaryMode,
  ShowcaseSecondaryMode,
} from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  DEFAULT_SHOWCASE_CONFIG,
  getFavoriteShowcasePool,
  getSecondaryQuotes,
  getWatchingShowcasePool,
  isShowcaseCustomized,
  normalizeShowcaseConfig,
  PRIMARY_MODE_META,
  SECONDARY_MODE_META,
} from '../utils/showcase';
import { ArchivalImage } from './ArchivalImage';

interface ShowcaseCustomizerModalProps {
  open: boolean;
  initialTab?: 'primary' | 'secondary';
  config: ShowcaseConfig;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSave: (nextConfig: ShowcaseConfig) => Promise<void>;
}

const PRIMARY_MODES: Array<{
  id: ShowcasePrimaryMode;
  icon: typeof CalendarDays;
}> = [
  { id: 'daily', icon: CalendarDays },
  { id: 'pinned', icon: Pin },
  { id: 'favorites', icon: Heart },
  { id: 'watching', icon: Tv },
  { id: 'custom', icon: Sparkles },
];

const SECONDARY_MODES: Array<{
  id: ShowcaseSecondaryMode;
  icon: typeof BookOpen;
}> = [
  { id: 'albums', icon: BookOpen },
  { id: 'favorites', icon: Heart },
  { id: 'quotes', icon: Quote },
  { id: 'recent', icon: Clock },
  { id: 'hidden', icon: EyeOff },
];

async function compressImageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('图片内容为空'));
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(result);
      img.onload = () => {
        const maxWidth = 720;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        } catch {
          resolve(result);
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

export function ShowcaseCustomizerModal({
  open,
  initialTab = 'primary',
  config,
  allItems,
  onClose,
  onSave,
}: ShowcaseCustomizerModalProps) {
  const [sectionTab, setSectionTab] = useState<'primary' | 'secondary'>('primary');
  const [primaryMode, setPrimaryMode] = useState<ShowcasePrimaryMode>('daily');
  const [pinnedItemId, setPinnedItemId] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customSubtitle, setCustomSubtitle] = useState('');
  const [customQuote, setCustomQuote] = useState('');
  const [customCoverUrl, setCustomCoverUrl] = useState('');
  const [customLinkItemId, setCustomLinkItemId] = useState('');
  const [secondaryMode, setSecondaryMode] =
    useState<ShowcaseSecondaryMode>('albums');
  const [itemSearch, setItemSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;
    const normalized = normalizeShowcaseConfig(config);
    setSectionTab(initialTab);
    setPrimaryMode(normalized.primaryMode);
    setPinnedItemId(normalized.pinnedItemId ?? '');
    setCustomLabel(normalized.customLabel ?? '');
    setCustomTitle(normalized.customTitle ?? '');
    setCustomSubtitle(normalized.customSubtitle ?? '');
    setCustomQuote(normalized.customQuote ?? '');
    setCustomCoverUrl(normalized.customCoverUrl ?? '');
    setCustomLinkItemId(normalized.customLinkItemId ?? '');
    setSecondaryMode(normalized.secondaryMode);
    setItemSearch('');
    setErrorMsg('');
  }, [open, initialTab, config]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const favoritePoolCount = useMemo(
    () => getFavoriteShowcasePool(allItems).length,
    [allItems]
  );
  const watchingPoolCount = useMemo(
    () => getWatchingShowcasePool(allItems).length,
    [allItems]
  );
  const quoteCount = useMemo(
    () => getSecondaryQuotes(allItems).length,
    [allItems]
  );

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((it) =>
      [it.title, it.originalTitle, it.year, ...it.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [allItems, itemSearch]);

  const itemsWithCovers = useMemo(
    () => allItems.filter((it) => Boolean(it.coverUrl)).slice(0, 12),
    [allItems]
  );

  const draftConfig = useMemo(
    () =>
      normalizeShowcaseConfig({
        primaryMode,
        pinnedItemId: primaryMode === 'pinned' ? pinnedItemId : undefined,
        customLabel,
        customTitle: primaryMode === 'custom' ? customTitle : undefined,
        customSubtitle: primaryMode === 'custom' ? customSubtitle : undefined,
        customQuote,
        customCoverUrl: primaryMode === 'custom' ? customCoverUrl : undefined,
        customLinkItemId:
          primaryMode === 'custom' ? customLinkItemId : undefined,
        secondaryMode,
      }),
    [
      primaryMode,
      pinnedItemId,
      customLabel,
      customTitle,
      customSubtitle,
      customQuote,
      customCoverUrl,
      customLinkItemId,
      secondaryMode,
    ]
  );

  if (!open) return null;

  const handleSelectPrimaryMode = (mode: ShowcasePrimaryMode) => {
    setPrimaryMode(mode);
    setErrorMsg('');
    if (mode === 'pinned' && !pinnedItemId && allItems.length > 0) {
      setPinnedItemId(allItems[0].id);
    }
  };

  const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    setErrorMsg('');
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setCustomCoverUrl(dataUrl);
    } catch {
      setErrorMsg('本地图片处理失败，请换一张图片或粘贴图片链接');
    } finally {
      setUploadingCover(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResetToDefault = () => {
    setPrimaryMode(DEFAULT_SHOWCASE_CONFIG.primaryMode);
    setPinnedItemId('');
    setCustomLabel('');
    setCustomTitle('');
    setCustomSubtitle('');
    setCustomQuote('');
    setCustomCoverUrl('');
    setCustomLinkItemId('');
    setSecondaryMode(DEFAULT_SHOWCASE_CONFIG.secondaryMode);
    setErrorMsg('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (primaryMode === 'pinned' && allItems.length > 0 && !pinnedItemId) {
      setSectionTab('primary');
      setErrorMsg('请先从馆藏中挑选一件作为主展位');
      return;
    }
    if (primaryMode === 'custom' && !customTitle.trim()) {
      setSectionTab('primary');
      setErrorMsg('请填写自定义展签的主标题');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
      await onSave(draftConfig);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const isDraftDefault = !isShowcaseCustomized(draftConfig);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="showcase-customizer-title"
      data-testid="showcase-customizer-modal"
      className="encounter-backdrop-in fixed inset-0 z-[70] flex items-end justify-center bg-[#141210]/70 backdrop-blur-xs md:items-center md:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="drawer-panel-in flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-3xl bg-[#F7F5F0] shadow-2xl md:rounded-3xl"
      >
        <div
          className="flex justify-center pt-2.5 pb-1 md:hidden"
          aria-hidden="true"
        >
          <div className="h-1.5 w-10 rounded-full bg-[#D3CCC0]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[#E4DFD5] px-4 py-3 min-[420px]:px-5">
          <div className="min-w-0">
            <h2
              id="showcase-customizer-title"
              className="font-editorial text-[19px] font-medium text-[#1A1816]"
            >
              自定义顶栏展示区
            </h2>
            <p className="mt-0.5 text-xs text-[#7A7268]">
              自由更换藏馆顶部主展位内容与右侧策展模块
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭顶栏展示区设置"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section Switcher */}
        <div className="border-b border-[#E4DFD5] bg-[#FAF8F3] px-4 py-2.5 min-[420px]:px-5">
          <div
            role="tablist"
            aria-label="展示区设置分区"
            className="grid grid-cols-2 gap-1 rounded-xl bg-[#ECE8DF] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sectionTab === 'primary'}
              data-testid="showcase-tab-primary"
              onClick={() => setSectionTab('primary')}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                sectionTab === 'primary'
                  ? 'bg-white text-[#1A1816] shadow-xs'
                  : 'text-[#625C54] hover:text-[#1A1816]'
              }`}
            >
              左侧主展位 · {PRIMARY_MODE_META[primaryMode].label}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sectionTab === 'secondary'}
              data-testid="showcase-tab-secondary"
              onClick={() => setSectionTab('secondary')}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                sectionTab === 'secondary'
                  ? 'bg-white text-[#1A1816] shadow-xs'
                  : 'text-[#625C54] hover:text-[#1A1816]'
              }`}
            >
              右侧展位 · {SECONDARY_MODE_META[secondaryMode].label}
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 min-[420px]:px-5">
          {errorMsg && (
            <div
              role="alert"
              data-testid="showcase-validation-error"
              className="rounded-xl border border-[#E5BFB9] bg-[#FDF4F2] px-3.5 py-2.5 text-xs font-medium text-[#B43B2B]"
            >
              {errorMsg}
            </div>
          )}

          {sectionTab === 'primary' ? (
            <>
              {/* Primary Mode Grid */}
              <div>
                <p className="text-xs font-medium text-[#4B453E]">
                  选择主展位内容来源
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PRIMARY_MODES.map(({ id, icon: Icon }) => {
                    const active = primaryMode === id;
                    const meta = PRIMARY_MODE_META[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        data-testid={`showcase-primary-mode-${id}`}
                        onClick={() => handleSelectPrimaryMode(id)}
                        className={`flex flex-col items-start rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-[#1A1816] bg-[#1A1816] text-[#FAF7F0]'
                            : 'border-[#E4DFD5] bg-white text-[#1A1816] hover:border-[#B4A99A]'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-1">
                          <Icon
                            className={`h-4 w-4 ${
                              active ? 'text-[#D4AF6A]' : 'text-[#8E6523]'
                            }`}
                            aria-hidden="true"
                          />
                          {active && (
                            <Check
                              className="h-3.5 w-3.5 text-[#D4AF6A]"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <span className="mt-2 text-[13px] font-medium whitespace-nowrap">
                          {meta.label}
                        </span>
                        <span
                          className={`mt-0.5 text-[11px] leading-snug ${
                            active ? 'text-[#CFC7B9]' : 'text-[#7A7268]'
                          }`}
                        >
                          {meta.shortDesc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pool status note for automatic modes */}
              {(primaryMode === 'favorites' || primaryMode === 'watching') && (
                <div className="rounded-xl border border-[#E4DFD5] bg-white px-3.5 py-2.5 text-xs text-[#625C54]">
                  {primaryMode === 'favorites'
                    ? favoritePoolCount > 0
                      ? `当前馆内共有 ${favoritePoolCount} 件挚爱 / 高分藏品参与展示，卡片内可随时点击「换一件」切换。`
                      : '当前暂无挚爱或 4 星以上藏品，将暂从全馆自动挑选，标记挚爱后立即生效。'
                    : watchingPoolCount > 0
                      ? `当前馆内共有 ${watchingPoolCount} 件在追 / 想看条目参与轮播，随时提醒近期观影计划。`
                      : '当前暂无在追或想看条目，将暂从全馆自动挑选。'}
                </div>
              )}

              {/* Pinned Item Picker */}
              {primaryMode === 'pinned' && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="showcase-pin-search"
                      className="text-xs font-medium text-[#4B453E]"
                    >
                      挑选要固定展示的藏品
                    </label>
                    <span className="font-mono text-[11px] tabular-nums text-[#8C857B]">
                      共 {allItems.length} 件可选
                    </span>
                  </div>

                  {allItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#D8D0C2] bg-white p-4 text-center text-xs text-[#7A7268]">
                      藏馆暂时为空，可以先收录条目或切换为「自定义展签」。
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
                          aria-hidden="true"
                        />
                        <input
                          id="showcase-pin-search"
                          type="search"
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          placeholder="搜索片名、影人、角色或标签…"
                          className="h-10 w-full rounded-xl border border-[#DCD6CB] bg-white pl-9 pr-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
                        />
                      </div>

                      <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-0.5">
                        {filteredItems.map((it) => {
                          const selected = pinnedItemId === it.id;
                          return (
                            <button
                              key={it.id}
                              type="button"
                              aria-pressed={selected}
                              data-testid={`showcase-pick-item-${it.id}`}
                              onClick={() => {
                                setPinnedItemId(it.id);
                                setErrorMsg('');
                              }}
                              className={`flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition-colors cursor-pointer ${
                                selected
                                  ? 'border-[#1A1816] bg-[#FFFDF9]'
                                  : 'border-[#E4DFD5] bg-white hover:border-[#B4A99A]'
                              }`}
                            >
                              <ArchivalImage
                                src={it.coverUrl}
                                alt={it.title}
                                title={it.title}
                                category={it.category}
                                compact
                                className="h-12 w-9 shrink-0 rounded-lg"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-editorial text-[14px] font-medium text-[#1A1816]">
                                  {it.title}
                                </p>
                                <p className="truncate font-mono text-[11px] tabular-nums text-[#7A7268]">
                                  {CATEGORY_LABELS[it.category]}
                                  {it.year ? ` · ${it.year}` : ''}
                                  {it.rating > 0 ? ` · ${it.rating}★` : ''}
                                </p>
                              </div>
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                                  selected
                                    ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                                    : 'border-[#D3CCC0] bg-[#FAF9F6] text-transparent'
                                }`}
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              </span>
                            </button>
                          );
                        })}
                        {filteredItems.length === 0 && (
                          <p className="py-4 text-center text-xs text-[#8C857B]">
                            未找到匹配的馆藏条目
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Custom Exhibition Fields */}
              {primaryMode === 'custom' && (
                <div className="space-y-3 rounded-2xl border border-[#E4DFD5] bg-white p-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="showcase-custom-title"
                        className="block text-xs font-medium text-[#4B453E]"
                      >
                        展位主标题 <span className="text-[#B43B2B]">*</span>
                      </label>
                      <input
                        id="showcase-custom-title"
                        data-testid="showcase-custom-title-input"
                        type="text"
                        value={customTitle}
                        onChange={(e) => {
                          setCustomTitle(e.target.value);
                          if (errorMsg) setErrorMsg('');
                        }}
                        placeholder="例如：我的 2026 秋季私藏影展"
                        maxLength={80}
                        className="mt-1 h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="showcase-custom-subtitle"
                        className="block text-xs font-medium text-[#4B453E]"
                      >
                        副标题 / 英文题注（可选）
                      </label>
                      <input
                        id="showcase-custom-subtitle"
                        type="text"
                        value={customSubtitle}
                        onChange={(e) => setCustomSubtitle(e.target.value)}
                        placeholder="例如：Autumn Retrospective · 1990s"
                        maxLength={100}
                        className="mt-1 h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
                      />
                    </div>
                  </div>

                  {/* Custom Cover Upload / URL / Pick from Library */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="showcase-custom-cover"
                        className="text-xs font-medium text-[#4B453E]"
                      >
                        展位封面图（上传、链接或从馆藏挑选）
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleUploadCover}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingCover}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-[11px] font-medium text-[#1A1816] hover:border-[#1A1816] cursor-pointer"
                        >
                          <ImagePlus className="h-3.5 w-3.5 text-[#8E6523]" aria-hidden="true" />
                          <span>{uploadingCover ? '处理中…' : '上传图片'}</span>
                        </button>
                        {customCoverUrl && (
                          <button
                            type="button"
                            onClick={() => setCustomCoverUrl('')}
                            className="inline-flex min-h-[32px] items-center rounded-lg px-2 text-[11px] text-[#7A7268] hover:text-[#B43B2B] cursor-pointer"
                          >
                            清除
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2.5">
                      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-[#E4DFD5] bg-[#1A1816]">
                        <ArchivalImage
                          src={customCoverUrl || undefined}
                          alt={customTitle || '展位封面预览'}
                          title={customTitle || '展签'}
                          category="film"
                          compact
                          className="h-full w-full"
                        />
                      </div>
                      <input
                        id="showcase-custom-cover"
                        type="url"
                        value={
                          customCoverUrl.startsWith('data:image/')
                            ? ''
                            : customCoverUrl
                        }
                        onChange={(e) => setCustomCoverUrl(e.target.value)}
                        placeholder={
                          customCoverUrl.startsWith('data:image/')
                            ? '已使用本地上传图片（输入链接可替换）'
                            : '粘贴封面图片 URL（https://…）'
                        }
                        className="h-10 min-w-0 flex-1 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
                      />
                    </div>

                    {itemsWithCovers.length > 0 && (
                      <div className="mt-2">
                        <span className="text-[11px] text-[#8C857B]">
                          从馆藏快速借用封面：
                        </span>
                        <div className="h-scroll-rail no-scrollbar mt-1.5 flex gap-2 pb-1">
                          {itemsWithCovers.map((it) => {
                            const picked = customCoverUrl === it.coverUrl;
                            return (
                              <button
                                key={it.id}
                                type="button"
                                aria-label={`使用「${it.title}」的封面`}
                                onClick={() => setCustomCoverUrl(it.coverUrl || '')}
                                className={`h-14 w-10 shrink-0 overflow-hidden rounded-lg border-2 transition-transform cursor-pointer ${
                                  picked
                                    ? 'border-[#B43B2B] scale-[1.03]'
                                    : 'border-transparent opacity-85 hover:opacity-100'
                                }`}
                              >
                                <ArchivalImage
                                  src={it.coverUrl}
                                  alt={it.title}
                                  title={it.title}
                                  category={it.category}
                                  compact
                                  className="h-full w-full"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Optional Link to Archive Item */}
                  {allItems.length > 0 && (
                    <div>
                      <label
                        htmlFor="showcase-custom-link-item"
                        className="block text-xs font-medium text-[#4B453E]"
                      >
                        关联跳转藏品（可选）
                      </label>
                      <select
                        id="showcase-custom-link-item"
                        value={customLinkItemId}
                        onChange={(e) => setCustomLinkItemId(e.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
                      >
                        <option value="">不关联具体藏品（纯主题展签）</option>
                        {allItems.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.title} ({CATEGORY_LABELS[it.category]})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Shared Optional Custom Label & Quote Override */}
              <div className="space-y-3 rounded-2xl border border-[#E4DFD5] bg-white p-3.5">
                <div>
                  <label
                    htmlFor="showcase-custom-label"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    展签角标文字（可选，留空使用默认）
                  </label>
                  <input
                    id="showcase-custom-label"
                    data-testid="showcase-custom-label-input"
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder={`默认：${PRIMARY_MODE_META[primaryMode].defaultBadge}`}
                    maxLength={24}
                    className="mt-1 h-10 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="showcase-custom-quote"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    {primaryMode === 'custom'
                      ? '展位寄语 / 导语'
                      : '自定义展位寄语 / 台词（可选，留空沿用藏品原句）'}
                  </label>
                  <textarea
                    id="showcase-custom-quote"
                    data-testid="showcase-custom-quote-input"
                    rows={2}
                    value={customQuote}
                    onChange={(e) => setCustomQuote(e.target.value)}
                    placeholder="写一句想在藏馆首页抬头看见的话、台词或策展导语…"
                    maxLength={240}
                    className="mt-1 w-full resize-none rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 py-2 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
                  />
                </div>
              </div>
            </>
          ) : (
            /* Right Secondary Panel Selector */
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-[#4B453E]">
                选择顶栏右侧展示模块
              </p>
              {SECONDARY_MODES.map(({ id, icon: Icon }) => {
                const active = secondaryMode === id;
                const meta = SECONDARY_MODE_META[id];
                const extraHint =
                  id === 'favorites'
                    ? `当前 ${favoritePoolCount} 件可选`
                    : id === 'quotes'
                      ? `当前 ${quoteCount} 条语录/手记`
                      : id === 'recent'
                        ? `共 ${allItems.length} 件馆藏`
                        : null;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    data-testid={`showcase-secondary-mode-${id}`}
                    onClick={() => setSecondaryMode(id)}
                    className={`flex w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[#1A1816] bg-[#FFFDF9]'
                        : 'border-[#E4DFD5] bg-white hover:border-[#B4A99A]'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        active
                          ? 'bg-[#1A1816] text-[#D4AF6A]'
                          : 'bg-[#F3EFE8] text-[#625C54]'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-editorial text-[15px] font-medium text-[#1A1816]">
                          {meta.label}
                        </span>
                        {extraHint && (
                          <span className="font-mono text-[11px] tabular-nums text-[#8C857B]">
                            · {extraHint}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[#6E665C]">
                        {meta.shortDesc}
                      </p>
                    </div>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                        active
                          ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                          : 'border-[#D3CCC0] bg-[#FAF9F6] text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="flex items-center gap-2.5 border-t border-[#E4DFD5] bg-white px-4 py-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5">
          <button
            type="button"
            data-testid="showcase-reset-btn"
            disabled={isDraftDefault}
            onClick={handleResetToDefault}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-xs font-medium text-[#4B453E] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] hover:text-[#1A1816] disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>恢复默认</span>
          </button>

          <button
            type="submit"
            disabled={saving}
            data-testid="showcase-save-btn"
            className="h-12 flex-1 rounded-xl bg-[#B43B2B] text-[15px] font-medium text-white cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.98] disabled:opacity-45"
          >
            {saving ? '保存中…' : '保存展示配置'}
          </button>
        </div>
      </form>
    </div>
  );
}
