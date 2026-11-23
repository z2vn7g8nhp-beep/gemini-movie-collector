import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Download,
  Image as ImageIcon,
  Loader2,
  Quote,
  Shuffle,
  X,
} from 'lucide-react';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  renderQuoteCardPng,
  saveOrShareDataUrl,
  type ExportTheme,
} from '../utils/cardCanvasExport';
import { extractQuoteEntries } from '../utils/curation';
import { ArchivalImage } from './ArchivalImage';

interface QuotesWallModalProps {
  open: boolean;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSelectItem: (item: ArchiveItem) => void;
  onNotice?: (message: string) => void;
}

const CAT_OPTIONS: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'film', label: '影视' },
  { id: 'person', label: '影人' },
  { id: 'character', label: '角色' },
];

export function QuotesWallModal({
  open,
  allItems,
  onClose,
  onSelectItem,
  onNotice,
}: QuotesWallModalProps) {
  const [category, setCategory] = useState<'all' | ArchiveCategory>('all');
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [exportingItem, setExportingItem] = useState<ArchiveItem | null>(null);
  const [exportTheme, setExportTheme] = useState<ExportTheme>('ivory');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (exportingItem) {
          setExportingItem(null);
          setPreviewUrl(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, exportingItem, onClose]);

  const entries = useMemo(
    () => extractQuoteEntries(allItems, { category }),
    [allItems, category]
  );

  const featuredEntry = useMemo(() => {
    if (entries.length === 0) return null;
    return entries[shuffleSeed % entries.length];
  }, [entries, shuffleSeed]);

  if (!open) return null;

  const handleOpenQuoteCard = async (item: ArchiveItem, theme: ExportTheme = exportTheme) => {
    setExportingItem(item);
    setRendering(true);
    setPreviewUrl(null);
    try {
      const url = await renderQuoteCardPng(item, theme);
      setPreviewUrl(url);
    } finally {
      setRendering(false);
    }
  };

  const handleSwitchTheme = async (nextTheme: ExportTheme) => {
    setExportTheme(nextTheme);
    if (exportingItem) {
      await handleOpenQuoteCard(exportingItem, nextTheme);
    }
  };

  const handleDownloadQuoteCard = async () => {
    if (!previewUrl || !exportingItem) return;
    const res = await saveOrShareDataUrl(
      previewUrl,
      `cinearchive-quote-${exportingItem.accessionNo}.png`,
      `${exportingItem.title} · 光影金句`
    );
    onNotice?.(
      res === 'shared'
        ? '已唤起系统分享金句卡片'
        : '已保存高清金句卡片，手机端也可长按预览图存至相册'
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quotes-wall-title"
      data-testid="quotes-wall-modal"
      className="encounter-backdrop-in fixed inset-0 z-[70] flex items-end justify-center bg-[#141210]/70 backdrop-blur-xs md:items-center md:p-6 dark:bg-black/80"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel-in flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-3xl bg-[#F7F5F0] shadow-2xl md:rounded-3xl dark:border dark:border-[#322D27] dark:bg-[#141210]">
        <div className="flex justify-center pt-2.5 pb-1 md:hidden" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-[#D3CCC0] dark:bg-[#3A342D]" />
        </div>

        {/* Sticky Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[#E4DFD5] px-4 py-3 min-[420px]:px-5 dark:border-[#2E2924] dark:bg-[#191613]">
          <div className="min-w-0">
            <h2
              id="quotes-wall-title"
              className="font-editorial text-[19px] font-medium text-[#1A1816] dark:text-[#F3EFE6]"
            >
              光影金句本
            </h2>
            <p className="mt-0.5 text-xs text-[#7A7268] tabular-nums dark:text-[#9E9588]">
              已摘录 {entries.length} 句经典台词与语录
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {entries.length > 1 && !exportingItem && (
              <button
                type="button"
                data-testid="quotes-shuffle-btn"
                onClick={() => setShuffleSeed((s) => s + 1)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.97] dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#564E44]"
              >
                <Shuffle className="h-3.5 w-3.5 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
                <span>翻一句</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭光影金句本"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] hover:text-[#1A1816] cursor-pointer dark:text-[#A59D90] dark:hover:bg-[#28241F] dark:hover:text-[#F3EFE6]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] min-[420px]:px-5">
          {exportingItem ? (
            <div className="space-y-4" data-testid="quote-card-export-preview">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExportingItem(null);
                    setPreviewUrl(null);
                  }}
                  className="min-h-[40px] rounded-xl border border-[#DCD6CB] bg-white px-3.5 text-xs font-medium text-[#1A1816] cursor-pointer dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#564E44]"
                >
                  返回金句墙
                </button>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#ECE8DF] p-1 dark:bg-[#231F1B]">
                  <button
                    type="button"
                    aria-pressed={exportTheme === 'ivory'}
                    onClick={() => void handleSwitchTheme('ivory')}
                    className={`min-h-[34px] rounded-lg px-3 text-xs font-medium cursor-pointer ${
                      exportTheme === 'ivory'
                        ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                        : 'text-[#625C54] dark:text-[#9E9588]'
                    }`}
                  >
                    象牙纸白
                  </button>
                  <button
                    type="button"
                    aria-pressed={exportTheme === 'darkroom'}
                    onClick={() => void handleSwitchTheme('darkroom')}
                    className={`min-h-[34px] rounded-lg px-3 text-xs font-medium cursor-pointer ${
                      exportTheme === 'darkroom'
                        ? 'bg-[#1C1A17] text-[#F5DC9B] shadow-xs dark:bg-[#353029] dark:text-[#F5DC9B]'
                        : 'text-[#625C54] dark:text-[#9E9588]'
                    }`}
                  >
                    暗房黑金
                  </button>
                </div>
              </div>

              <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-2xl border border-[#DFD9CD] bg-[#1C1A17] p-2 dark:border-[#322D27]">
                {rendering || !previewUrl ? (
                  <div className="flex items-center gap-2 text-xs text-[#CFC7B9]">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>正在排版高清金句卡片…</span>
                  </div>
                ) : (
                  <img
                    src={previewUrl}
                    alt={`${exportingItem.title}金句卡片`}
                    className="max-h-[54dvh] w-auto rounded-xl object-contain"
                  />
                )}
              </div>

              <p className="text-center text-xs text-[#6E665C] dark:text-[#9E9588]">
                手机端可长按图片存至相册，或点击下方一键导出
              </p>

              <button
                type="button"
                disabled={!previewUrl}
                onClick={() => void handleDownloadQuoteCard()}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#B43B2B] text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] disabled:opacity-45"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>保存 / 分享金句卡片</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Category Toggle */}
              <div
                role="group"
                aria-label="金句分类筛选"
                className="grid grid-cols-4 gap-1 rounded-xl bg-[#ECE8DF] p-1 dark:bg-[#231F1B]"
              >
                {CAT_OPTIONS.map((opt) => {
                  const active = category === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setCategory(opt.id);
                        setShuffleSeed(0);
                      }}
                      className={`min-h-[40px] rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                          : 'text-[#625C54] dark:text-[#9E9588]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {entries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#D8D0C2] bg-white px-5 py-10 text-center dark:border-[#3A342D] dark:bg-[#1D1A17]">
                  <Quote className="mx-auto h-7 w-7 text-[#BFB6A7] dark:text-[#6E655A]" aria-hidden="true" />
                  <p className="mt-3 font-editorial text-lg font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                    尚未摘录台词或金句
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#6E665C] dark:text-[#9E9588]">
                    打开任意影视、影人或角色档案，在「经典台词 / 语录」栏写下一句打动你的话，就会自动汇聚到这里。
                  </p>
                </div>
              ) : (
                <>
                  {/* Spotlight Featured Quote Card */}
                  {featuredEntry && (
                    <div className="gallery-card-dark rounded-2xl border border-[#342F28] p-5 text-[#FAF7F0]">
                      <p className="font-mono text-[11px] tracking-[0.1em] text-[#D4AF6A]">
                        此刻一句 · {featuredEntry.item.accessionNo}
                      </p>
                      <blockquote className="mt-3 font-editorial text-[20px] italic leading-relaxed text-[#FAF7F0]">
                        “{featuredEntry.quoteText}”
                      </blockquote>
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onSelectItem(featuredEntry.item);
                          }}
                          className="min-w-0 truncate text-left text-xs text-[#CFC7B9] hover:text-white cursor-pointer"
                        >
                          —— {featuredEntry.item.category === 'film' ? `《${featuredEntry.item.title}》` : featuredEntry.item.title}
                          {featuredEntry.item.year ? ` · ${featuredEntry.item.year}` : ''}
                        </button>
                        <button
                          type="button"
                          data-testid="featured-quote-export-btn"
                          onClick={() => void handleOpenQuoteCard(featuredEntry.item)}
                          className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97]"
                        >
                          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>生成金句卡</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Editorial Quote List */}
                  <div className="space-y-3">
                    {entries.map(({ item, quoteText }) => (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-[#E4DFD5] bg-white p-4 dark:border-[#322D27] dark:bg-[#1D1A17]"
                      >
                        <p className="font-editorial text-[16px] italic leading-relaxed text-[#1A1816] dark:text-[#F3EFE6]">
                          “{quoteText}”
                        </p>

                        <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-[#F0ECE3] pt-3 dark:border-[#2E2924]">
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onSelectItem(item);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
                          >
                            <ArchivalImage
                              src={item.coverUrl}
                              alt={item.title}
                              title={item.title}
                              category={item.category}
                              compact
                              className="h-11 w-9 shrink-0 rounded-lg"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-editorial text-sm font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                                {item.title}
                              </p>
                              <p className="truncate font-mono text-[11px] text-[#7A7268] tabular-nums dark:text-[#9E9588]">
                                {CATEGORY_LABELS[item.category]}
                                {item.year ? ` · ${item.year}` : ''}
                                {item.relatedWorkTitle ? ` · 《${item.relatedWorkTitle}》` : ''}
                              </p>
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleOpenQuoteCard(item)}
                              aria-label={`为「${item.title}」生成金句卡片`}
                              className="inline-flex h-10 items-center gap-1 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#564E44]"
                            >
                              <ImageIcon className="h-3.5 w-3.5 text-[#A67C37] dark:text-[#E4C37A]" aria-hidden="true" />
                              <span>制卡</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onSelectItem(item);
                              }}
                              aria-label={`打开「${item.title}」档案`}
                              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E4DFD5] bg-white text-[#625C54] cursor-pointer dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#A59D90] dark:hover:text-[#F3EFE6]"
                            >
                              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
