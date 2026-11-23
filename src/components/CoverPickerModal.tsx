import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  ImagePlus,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import { getRuntimeModeSync, searchCovers } from '../services/archiveApi';
import {
  computeCoverResizeDimensions,
  validateCustomCoverUrl,
  type CoverCandidate,
} from '../utils/coverPicker';
import { formatCoverUrlForMode } from '../utils/runtimeEnv';
import { ArchivalImage } from './ArchivalImage';

interface CoverPickerModalProps {
  open: boolean;
  item: ArchiveItem;
  onClose: () => void;
  onApplyCover: (coverUrl: string | undefined) => Promise<void>;
}

type PickerTab = 'search' | 'upload' | 'url';

async function compressImageFileToDataUrl(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  sizeKb: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('无法读取该图片文件'));
      el.src = objectUrl;
    });

    const target = computeCoverResizeDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      720,
      1080
    );

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('浏览器画布不可用');
    }
    ctx.fillStyle = '#181614';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img, 0, 0, target.width, target.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    const sizeKb = Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024));
    return {
      dataUrl,
      width: target.width,
      height: target.height,
      sizeKb,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CoverPickerModal({
  open,
  item,
  onClose,
  onApplyCover,
}: CoverPickerModalProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<PickerTab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [candidates, setCandidates] = useState<CoverCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedUrl, setSelectedUrl] = useState<string>('');

  // Upload state
  const [uploadPreview, setUploadPreview] = useState<string>('');
  const [uploadMeta, setUploadMeta] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  const [uploading, setUploading] = useState(false);

  // URL state
  const [customUrlInput, setCustomUrlInput] = useState<string>('');
  const [urlError, setUrlError] = useState<string>('');

  const [applying, setApplying] = useState(false);

  const fetchCandidates = async (query: string, originalTitle?: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setSearchError('');
    try {
      const list = await searchCovers(trimmed, item.category, originalTitle);
      setCandidates(list);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : '封面搜索暂不可用，可切换本地上传或粘贴链接'
      );
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setTab('search');
    const cleanInitialQuery = item.title.split(/[／/]/)[0].trim() || item.title;
    setSearchQuery(cleanInitialQuery);
    setSelectedUrl(item.coverUrl || '');
    setUploadPreview('');
    setUploadMeta('');
    setUploadError('');
    setCustomUrlInput(
      item.coverUrl && !item.coverUrl.startsWith('data:image/')
        ? item.coverUrl
        : ''
    );
    setUrlError('');
    void fetchCandidates(cleanInitialQuery, item.originalTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, applying, onClose]);

  if (!open) return null;

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('请选择常见图片格式（JPG、PNG、WebP 等）');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const result = await compressImageFileToDataUrl(file);
      setUploadPreview(result.dataUrl);
      setUploadMeta(`${result.width}×${result.height} · 约 ${result.sizeKb} KB`);
      setSelectedUrl(result.dataUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '图片处理失败');
    } finally {
      setUploading(false);
    }
  };

  const activeCandidateUrl = (() => {
    if (tab === 'upload') return uploadPreview;
    if (tab === 'url') {
      const check = validateCustomCoverUrl(customUrlInput);
      return check.ok
        ? formatCoverUrlForMode(check.url, getRuntimeModeSync()) || check.url
        : '';
    }
    return selectedUrl;
  })();

  const handleConfirm = async () => {
    if (tab === 'url') {
      const check = validateCustomCoverUrl(customUrlInput);
      if (!check.ok) {
        setUrlError(check.error);
        return;
      }
      setApplying(true);
      try {
        const finalUrl =
          formatCoverUrlForMode(check.url, getRuntimeModeSync()) || check.url;
        await onApplyCover(finalUrl);
        onClose();
      } finally {
        setApplying(false);
      }
      return;
    }

    if (!activeCandidateUrl) return;
    setApplying(true);
    try {
      await onApplyCover(activeCandidateUrl);
      onClose();
    } finally {
      setApplying(false);
    }
  };

  const handleClearCover = async () => {
    setApplying(true);
    try {
      await onApplyCover('');
      onClose();
    } finally {
      setApplying(false);
    }
  };

  const urlCheck = customUrlInput.trim()
    ? validateCustomCoverUrl(customUrlInput)
    : null;
  const liveUrlPreview =
    urlCheck && urlCheck.ok
      ? formatCoverUrlForMode(urlCheck.url, getRuntimeModeSync()) || urlCheck.url
      : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cover-picker-title"
      data-testid="cover-picker-modal"
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden bg-[#12100E]/70 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-black/78"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border border-[#DDD6C8] bg-[#F7F5F0] shadow-2xl sm:rounded-3xl dark:border-[#322D27] dark:bg-[#141210]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#E4DFD5] bg-[#FAF9F6] px-5 py-3.5 dark:border-[#2E2924] dark:bg-[#191613]">
          <div className="min-w-0">
            <h2
              id="cover-picker-title"
              className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base dark:text-[#F5F1E8]"
            >
              更换藏品封面
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
              {item.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            aria-label="关闭换封面弹窗"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] hover:text-[#1A1816] cursor-pointer dark:text-[#A59D90] dark:hover:bg-[#2A2520] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="shrink-0 border-b border-[#E8E2D7] bg-[#F7F5F0] px-5 py-2.5 dark:border-[#2E2924] dark:bg-[#141210]">
          <div
            role="tablist"
            aria-label="换封面方式"
            className="grid grid-cols-3 gap-1 rounded-xl bg-[#EAE4D9] p-1 dark:bg-[#231F1B]"
          >
            {(
              [
                { id: 'search', label: '全网选图', icon: Search },
                { id: 'upload', label: '本地上传', icon: Upload },
                { id: 'url', label: '图片链接', icon: Link2 },
              ] as const
            ).map((mode) => {
              const Icon = mode.icon;
              const active = tab === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`cover-tab-${mode.id}`}
                  onClick={() => setTab(mode.id)}
                  className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium whitespace-nowrap transition-colors cursor-pointer md:min-h-[38px] md:text-xs ${
                    active
                      ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                      : 'text-[#625C54] hover:text-[#1A1816] dark:text-[#A89F92] dark:hover:text-[#F3EFE6]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4">
          {tab === 'search' && (
            <div className="space-y-3.5">
              {/* Search Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void fetchCandidates(searchQuery);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="输入剧名、英文名或演员名搜海报..."
                  data-testid="cover-search-input"
                  className="min-h-[46px] min-w-0 flex-1 rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] placeholder:text-[#9C9488] focus:border-[#1A1816] focus:outline-none md:min-h-[42px] md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                />
                <button
                  type="submit"
                  disabled={loading || !searchQuery.trim()}
                  data-testid="cover-search-submit"
                  className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-1 rounded-xl bg-[#1A1816] px-4 text-[14px] font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer disabled:opacity-50 md:min-h-[42px] md:text-xs dark:bg-[#F3EFE6] dark:text-[#141210] dark:hover:bg-[#E4C37A]"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin md:h-3.5 md:w-3.5" />
                  ) : (
                    <Search className="h-4 w-4 md:h-3.5 md:w-3.5" />
                  )}
                  <span>搜图</span>
                </button>
              </form>

              {searchError && (
                <p className="rounded-xl border border-[#E5BFB9] bg-[#FDF7F5] px-3 py-2 text-[13px] text-[#B43B2B] md:text-xs dark:border-[#6B3229] dark:bg-[#351B17] dark:text-[#F28C7B]">
                  {searchError}
                </p>
              )}

              {loading ? (
                <div className="grid grid-cols-3 gap-2.5">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="aspect-[3/4] animate-pulse rounded-xl bg-[#E8E2D7] dark:bg-[#26221D]"
                    />
                  ))}
                </div>
              ) : candidates.length > 0 ? (
                <div
                  data-testid="cover-candidates-grid"
                  className="grid grid-cols-3 gap-2.5"
                >
                  {candidates.map((cand, idx) => {
                    const isSelected = selectedUrl === cand.url;
                    return (
                      <button
                        key={`${cand.id}-${idx}`}
                        type="button"
                        data-testid="cover-candidate-card"
                        onClick={() => setSelectedUrl(cand.url)}
                        className={`group relative overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#B43B2B] ring-2 ring-[#B43B2B]'
                            : 'border-[#E4DFD5] hover:border-[#1A1816] dark:border-[#322D27] dark:hover:border-[#D4AF6A]'
                        }`}
                      >
                        <ArchivalImage
                          src={cand.url}
                          alt={cand.caption || item.title}
                          title={cand.caption || item.title}
                          category={item.category}
                          compact
                          className="aspect-[3/4] w-full"
                        />
                        <div className="bg-white px-1.5 py-1 dark:bg-[#1D1A17]">
                          <p className="truncate text-[11px] font-medium text-[#4B453E] md:text-[10px] dark:text-[#C4BCB0]">
                            {cand.source}
                          </p>
                        </div>
                        {isSelected && (
                          <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#B43B2B] text-white shadow-sm">
                            <Check className="h-3 w-3 stroke-[2.5]" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#D6CEC0] bg-white/70 px-4 py-8 text-center dark:border-[#3E3830] dark:bg-[#1D1A17]/70">
                  <p className="text-[15px] font-medium text-[#4B453E] md:text-sm dark:text-[#E5DED2]">
                    未找到直接匹配的候选图
                  </p>
                  <p className="mt-1 text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                    可尝试搜索英文原名，或直接切换到「本地上传」选取相册剧照
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void handleFileChange(file);
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="cover-upload-trigger"
                className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#CFC7B9] bg-white px-4 py-6 text-center transition-colors hover:border-[#1A1816] hover:bg-[#FAF9F6] cursor-pointer dark:border-[#433C34] dark:bg-[#1D1A17] dark:hover:border-[#D4AF6A] dark:hover:bg-[#24201C]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F2EDE3] text-[#1A1816] dark:bg-[#2A2520] dark:text-[#E4C37A]">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-5 w-5" />
                  )}
                </span>
                <span className="text-[15px] font-medium text-[#1A1816] md:text-sm dark:text-[#F3EFE6]">
                  {uploading ? '正在优化图片清晰度...' : '点击从相册或本地选取海报'}
                </span>
                <span className="text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                  自动裁压至高清馆藏比例，永久保存在本地档案库
                </span>
              </button>

              {uploadError && (
                <p className="rounded-xl border border-[#E5BFB9] bg-[#FDF7F5] px-3 py-2 text-[13px] text-[#B43B2B] md:text-xs dark:border-[#6B3229] dark:bg-[#351B17] dark:text-[#F28C7B]">
                  {uploadError}
                </p>
              )}

              {uploadPreview && (
                <div className="flex items-center gap-4 rounded-2xl border border-[#E4DFD5] bg-white p-3.5 dark:border-[#322D27] dark:bg-[#1D1A17]">
                  <ArchivalImage
                    src={uploadPreview}
                    alt="新封面预览"
                    title={item.title}
                    category={item.category}
                    className="aspect-[3/4] w-20 shrink-0 rounded-xl border border-[#E4DFD5] dark:border-[#3A342D]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#1A1816] md:text-xs dark:text-[#F3EFE6]">
                      新封面已就绪
                    </p>
                    <p className="mt-1 font-mono text-[12px] tabular-nums text-[#7A7268] md:text-[11px] dark:text-[#A59D90]">
                      {uploadMeta}
                    </p>
                    <p className="mt-1.5 text-[12px] text-[#625C54] md:text-[11px] dark:text-[#B8AFA2]">
                      点击下方「应用此封面」即可立即生效
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'url' && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="cover-custom-url"
                  className="block text-[13px] font-medium text-[#4B453E] md:text-xs dark:text-[#C4BCB0]"
                >
                  粘贴高清海报或人物剧照链接
                </label>
                <input
                  id="cover-custom-url"
                  type="url"
                  value={customUrlInput}
                  onChange={(e) => {
                    setCustomUrlInput(e.target.value);
                    setUrlError('');
                  }}
                  placeholder="https://..."
                  data-testid="cover-url-input"
                  className="mt-1.5 min-h-[46px] w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] placeholder:text-[#9C9488] focus:border-[#1A1816] focus:outline-none md:min-h-[44px] md:text-sm dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
                />
                {urlError && (
                  <p className="mt-1.5 text-[13px] text-[#B43B2B] md:text-xs dark:text-[#F28C7B]">{urlError}</p>
                )}
              </div>

              {liveUrlPreview && (
                <div className="flex items-center gap-4 rounded-2xl border border-[#E4DFD5] bg-white p-3.5 dark:border-[#322D27] dark:bg-[#1D1A17]">
                  <ArchivalImage
                    src={liveUrlPreview}
                    alt="链接封面预览"
                    title={item.title}
                    category={item.category}
                    className="aspect-[3/4] w-24 shrink-0 rounded-xl border border-[#E4DFD5] dark:border-[#3A342D]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#1A1816] md:text-xs dark:text-[#F3EFE6]">
                      实时预览
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#7A7268] md:text-[11px] dark:text-[#A59D90]">
                      已自动通过馆内图床代理加载，防止防盗链失效
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2.5 border-t border-[#E4DFD5] bg-[#FAF9F6] px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:pb-3.5 dark:border-[#2E2924] dark:bg-[#191613]">
          {item.coverUrl ? (
            <button
              type="button"
              onClick={handleClearCover}
              disabled={applying}
              className="inline-flex min-h-[46px] shrink-0 items-center gap-1 rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[13px] font-medium text-[#625C54] hover:text-[#1A1816] whitespace-nowrap cursor-pointer disabled:opacity-50 md:min-h-[44px] md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#C4BCB0] dark:hover:text-[#F3EFE6]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>用典藏版式</span>
            </button>
          ) : (
            <span className="text-[13px] text-[#8C857B] md:text-xs dark:text-[#9A9184]">支持随时替换</span>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={applying || !activeCandidateUrl}
            data-testid="cover-apply-btn"
            className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-5 text-[15px] font-medium text-white whitespace-nowrap cursor-pointer hover:bg-[#932D20] disabled:opacity-45 md:min-h-[44px] md:text-sm"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            <span>{applying ? '正在更新...' : '应用此封面'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
