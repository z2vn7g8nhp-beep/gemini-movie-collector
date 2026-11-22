import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  Grid2x2,
  Grid3x3,
  Loader2,
  Share2,
  X,
} from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  renderPosterWallPng,
  saveOrShareDataUrl,
  type ExportTheme,
  type PosterWallLayout,
} from '../utils/cardCanvasExport';
import { ArchivalImage } from './ArchivalImage';

interface PosterWallExportModalProps {
  open: boolean;
  allItems: ArchiveItem[];
  initialSelectedIds?: string[];
  initialTitle?: string;
  onClose: () => void;
  onNotice?: (message: string) => void;
}

export function PosterWallExportModal({
  open,
  allItems,
  initialSelectedIds,
  initialTitle,
  onClose,
  onNotice,
}: PosterWallExportModalProps) {
  const [layout, setLayout] = useState<PosterWallLayout>('3x3');
  const [theme, setTheme] = useState<ExportTheme>('ivory');
  const [title, setTitle] = useState('我的私人光影志');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const slotLimit = layout === '3x3' ? 9 : 4;

  useEffect(() => {
    if (!open) return;
    const defaultLayout: PosterWallLayout =
      (initialSelectedIds?.length || allItems.length) <= 4 ? '2x2' : '3x3';
    setLayout(defaultLayout);
    setTitle(initialTitle?.trim() || '我的私人光影志');
    const seedIds =
      initialSelectedIds && initialSelectedIds.length > 0
        ? initialSelectedIds
        : allItems.map((it) => it.id);
    setSelectedIds(seedIds.slice(0, defaultLayout === '3x3' ? 9 : 4));
    setPreviewUrl(null);
    setErrorMsg('');
  }, [open, initialSelectedIds, initialTitle, allItems]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const selectedItems = useMemo(() => {
    const byId = new Map(allItems.map((it) => [it.id, it]));
    return selectedIds
      .map((id) => byId.get(id))
      .filter((it): it is ArchiveItem => Boolean(it))
      .slice(0, slotLimit);
  }, [allItems, selectedIds, slotLimit]);

  if (!open) return null;

  const toggleItem = (id: string) => {
    setPreviewUrl(null);
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= slotLimit) {
        return [...prev.slice(0, slotLimit - 1), id];
      }
      return [...prev, id];
    });
  };

  const handleLayoutChange = (next: PosterWallLayout) => {
    setLayout(next);
    setPreviewUrl(null);
    const limit = next === '3x3' ? 9 : 4;
    setSelectedIds((prev) => {
      if (prev.length > limit) return prev.slice(0, limit);
      if (prev.length < limit) {
        const set = new Set(prev);
        const extras = allItems
          .filter((it) => !set.has(it.id))
          .slice(0, limit - prev.length)
          .map((it) => it.id);
        return [...prev, ...extras];
      }
      return prev;
    });
  };

  const handleGenerate = async () => {
    if (selectedItems.length === 0) {
      setErrorMsg('请至少勾选 1 件藏品再生成海报墙');
      return;
    }
    setRendering(true);
    setErrorMsg('');
    try {
      const dataUrl = await renderPosterWallPng({
        items: selectedItems,
        layout,
        title,
        subtitle: `精选 ${selectedItems.length} 件藏品 · 光影志档案馆`,
        theme,
      });
      setPreviewUrl(dataUrl);
    } catch {
      setErrorMsg('生成海报图失败，请重试');
    } finally {
      setRendering(false);
    }
  };

  const handleSave = async () => {
    if (!previewUrl) return;
    const outcome = await saveOrShareDataUrl(
      previewUrl,
      `cinearchive-wall-${layout}-${Date.now()}.png`,
      title || '光影志海报墙'
    );
    onNotice?.(
      outcome === 'shared'
        ? '已唤起系统分享海报墙'
        : '已保存高清海报墙图片，手机端也可长按预览图存至相册'
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="poster-wall-modal-title"
      data-testid="poster-wall-modal"
      className="encounter-backdrop-in fixed inset-0 z-[70] flex items-end justify-center bg-[#141210]/70 backdrop-blur-xs md:items-center md:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel-in flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl bg-[#F7F5F0] shadow-2xl md:rounded-3xl">
        {/* Mobile Handle */}
        <div className="flex justify-center pt-2.5 pb-1 md:hidden" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-[#D3CCC0]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[#E4DFD5] px-4 py-3 min-[420px]:px-5">
          <div className="min-w-0">
            <h2
              id="poster-wall-modal-title"
              className="font-editorial text-[19px] font-medium text-[#1A1816]"
            >
              海报墙长图工坊
            </h2>
            <p className="mt-0.5 text-xs text-[#7A7268] tabular-nums">
              已选 {selectedItems.length} / {slotLimit} 件 · 导出高清 PNG 分享
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭海报墙工坊"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] hover:text-[#1A1816] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 min-[420px]:px-5">
          {previewUrl ? (
            <div className="space-y-3" data-testid="poster-wall-preview-wrap">
              <div className="overflow-hidden rounded-2xl border border-[#DFD9CD] bg-[#1C1A17] p-2 shadow-sm">
                <img
                  src={previewUrl}
                  alt={`${title}海报墙预览`}
                  className="mx-auto max-h-[54dvh] w-auto rounded-xl object-contain"
                />
              </div>
              <p className="text-center text-xs text-[#6E665C]">
                手机端可直接长按上方图片「存储到照片」，或点击下方按钮一键保存 / 分享
              </p>
              <button
                type="button"
                onClick={() => setPreviewUrl(null)}
                className="min-h-[44px] w-full rounded-xl border border-[#DCD6CB] bg-white text-sm font-medium text-[#1A1816] cursor-pointer"
              >
                返回调整选片与版式
              </button>
            </div>
          ) : (
            <>
              {/* Title Input */}
              <div>
                <label
                  htmlFor="poster-wall-title-input"
                  className="block text-xs font-medium text-[#4B453E]"
                >
                  海报墙标题
                </label>
                <input
                  id="poster-wall-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：我的年度十佳、王家卫私人影单"
                  className="mt-1.5 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
                />
              </div>

              {/* Layout & Theme Switchers */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs font-medium text-[#4B453E]">
                    宫格版式
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-[#ECE8DF] p-1">
                    <button
                      type="button"
                      aria-pressed={layout === '2x2'}
                      onClick={() => handleLayoutChange('2x2')}
                      className={`inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                        layout === '2x2'
                          ? 'bg-white text-[#1A1816] shadow-xs'
                          : 'text-[#625C54]'
                      }`}
                    >
                      <Grid2x2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>2×2 四格</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={layout === '3x3'}
                      onClick={() => handleLayoutChange('3x3')}
                      className={`inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                        layout === '3x3'
                          ? 'bg-white text-[#1A1816] shadow-xs'
                          : 'text-[#625C54]'
                      }`}
                    >
                      <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>3×3 九宫格</span>
                    </button>
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-medium text-[#4B453E]">
                    纸面底色
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-[#ECE8DF] p-1">
                    <button
                      type="button"
                      aria-pressed={theme === 'ivory'}
                      onClick={() => setTheme('ivory')}
                      className={`min-h-[40px] rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                        theme === 'ivory'
                          ? 'bg-white text-[#1A1816] shadow-xs'
                          : 'text-[#625C54]'
                      }`}
                    >
                      象牙纸白
                    </button>
                    <button
                      type="button"
                      aria-pressed={theme === 'darkroom'}
                      onClick={() => setTheme('darkroom')}
                      className={`min-h-[40px] rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                        theme === 'darkroom'
                          ? 'bg-[#1C1A17] text-[#F5DC9B] shadow-xs'
                          : 'text-[#625C54]'
                      }`}
                    >
                      暗房黑金
                    </button>
                  </div>
                </div>
              </div>

              {/* Selectable Thumbnail Grid */}
              <div>
                <div className="flex items-center justify-between text-xs text-[#625C54]">
                  <span>点选入画藏品（按点选顺序排布）</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="min-h-[32px] px-1.5 text-xs text-[#B43B2B] cursor-pointer"
                  >
                    清空重选
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {allItems.map((it) => {
                    const orderIdx = selectedIds.indexOf(it.id);
                    const picked = orderIdx >= 0;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => toggleItem(it.id)}
                        className={`relative overflow-hidden rounded-xl border p-1.5 text-left transition-all cursor-pointer active:scale-[0.97] ${
                          picked
                            ? 'border-[#B43B2B] bg-[#FDF6F4] ring-1 ring-[#B43B2B]'
                            : 'border-[#E4DFD5] bg-white'
                        }`}
                      >
                        <div className="relative">
                          <ArchivalImage
                            src={it.coverUrl}
                            alt={it.title}
                            title={it.title}
                            category={it.category}
                            compact
                            className="aspect-[3/4] w-full rounded-lg"
                          />
                          {picked && (
                            <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#B43B2B] font-mono text-xs font-semibold text-white shadow-sm">
                              {orderIdx + 1}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate text-[12px] font-medium text-[#1A1816]">
                          {it.title}
                        </p>
                        <p className="truncate text-[10px] text-[#8C857B]">
                          {CATEGORY_LABELS[it.category]}
                          {it.year ? ` · ${it.year}` : ''}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {errorMsg && (
                <p role="alert" className="text-xs font-medium text-[#B43B2B]">
                  {errorMsg}
                </p>
              )}
            </>
          )}
        </div>

        {/* Sticky Bottom CTA */}
        <div className="border-t border-[#E4DFD5] bg-white px-4 py-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5">
          {previewUrl ? (
            <button
              type="button"
              data-testid="poster-wall-save-btn"
              onClick={() => void handleSave()}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#B43B2B] text-[15px] font-medium text-white cursor-pointer active:scale-[0.98]"
            >
              {typeof navigator !== 'undefined' && 'share' in navigator ? (
                <Share2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              <span>保存 / 分享高清海报墙</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="poster-wall-generate-btn"
              disabled={rendering || selectedItems.length === 0}
              onClick={() => void handleGenerate()}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1A1816] text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] disabled:opacity-45"
            >
              {rendering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>正在绘制高清海报墙…</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>生成高清海报墙（{selectedItems.length} 件）</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
