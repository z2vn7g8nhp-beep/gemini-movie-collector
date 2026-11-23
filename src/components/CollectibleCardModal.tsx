import { useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Edit3,
  Loader2,
  RotateCw,
  Star,
  X,
} from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import {
  CATEGORY_LABELS,
  getRelatedItems,
  getStatusLabel,
} from '../utils/archive';
import {
  renderCollectibleCardPng,
  saveOrShareDataUrl,
  type ExportTheme,
} from '../utils/cardCanvasExport';
import { computeItemCompleteness } from '../utils/collector';
import { ArchivalImage } from './ArchivalImage';

interface CollectibleCardModalProps {
  item: ArchiveItem | null;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSelectItem: (item: ArchiveItem) => void;
  onOpenDetailEdit: (item: ArchiveItem) => void;
  onNotice?: (message: string) => void;
}

export function CollectibleCardModal({
  item,
  allItems,
  onClose,
  onSelectItem,
  onOpenDetailEdit,
  onNotice,
}: CollectibleCardModalProps) {
  const [flipped, setFlipped] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTheme, setExportTheme] = useState<ExportTheme>('darkroom');
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setFlipped(false);
    setExportOpen(false);
    setExportUrl(null);
  }, [item?.id]);

  useEffect(() => {
    if (!item) return;
    const currentIndex = allItems.findIndex((i) => i.id === item.id);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ' || e.key === 'Enter') {
        if ((e.target as HTMLElement)?.tagName !== 'BUTTON') {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      } else if (e.key === 'ArrowRight' && allItems.length > 1 && currentIndex >= 0) {
        onSelectItem(allItems[(currentIndex + 1) % allItems.length]);
      } else if (e.key === 'ArrowLeft' && allItems.length > 1 && currentIndex >= 0) {
        onSelectItem(
          allItems[(currentIndex - 1 + allItems.length) % allItems.length]
        );
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, allItems, onClose, onSelectItem]);

  if (!item) return null;

  const completeness = computeItemCompleteness(item);
  const isMasterpiece = completeness.tier === 'masterpiece';
  const related = getRelatedItems(item, allItems);
  const currentIndex = allItems.findIndex((i) => i.id === item.id);
  const hasSiblings = allItems.length > 1 && currentIndex >= 0;

  const goPrev = () => {
    if (!hasSiblings) return;
    onSelectItem(
      allItems[(currentIndex - 1 + allItems.length) % allItems.length]
    );
  };

  const goNext = () => {
    if (!hasSiblings) return;
    onSelectItem(allItems[(currentIndex + 1) % allItems.length]);
  };

  const checklist: Array<{ key: string; label: string; done: boolean }> = [
    { key: 'cover', label: '封面剧照', done: completeness.criteria.cover },
    { key: 'rating', label: '星级评分', done: completeness.criteria.rating },
    { key: 'story', label: '台词或手记', done: completeness.criteria.story },
    { key: 'tags', label: '标签归类（≥2）', done: completeness.criteria.tags },
    {
      key: 'depth',
      label: item.category === 'character' ? '设定档案 / 关联' : '影人角色关联',
      done: completeness.criteria.depth,
    },
  ];

  const backStory =
    item.quote ||
    item.notes ||
    item.characterProfile?.bio ||
    item.summary ||
    '尚未写下收藏手记或台词，点击下方「去打磨」点亮典藏级档案。';

  const handleGenerateExport = async (theme: ExportTheme = exportTheme) => {
    setExportOpen(true);
    setExportTheme(theme);
    setExporting(true);
    setExportUrl(null);
    try {
      const url = await renderCollectibleCardPng(item, theme);
      setExportUrl(url);
    } finally {
      setExporting(false);
    }
  };

  const handleSaveExport = async () => {
    if (!exportUrl) return;
    const res = await saveOrShareDataUrl(
      exportUrl,
      `cinearchive-card-${item.accessionNo}.png`,
      `${item.title} · 光影志藏卡`
    );
    onNotice?.(
      res === 'shared'
        ? '已唤起系统分享实体藏卡'
        : '已保存高清藏卡图片，手机端也可长按预览图存至相册'
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`实体藏卡赏析：${item.title}`}
      data-testid="collectible-card-modal"
      className="encounter-backdrop-in fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#141210]/85 backdrop-blur-xs px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top Bar */}
      <div className="mb-3 flex w-full max-w-[388px] items-center justify-between text-[#E8E2D7] md:max-w-[360px]">
        <div className="flex items-center gap-2 font-mono text-[13px] tabular-nums md:text-xs">
          <span>{item.accessionNo}</span>
          <span className="opacity-40">/</span>
          <span>
            {hasSiblings ? `${currentIndex + 1} of ${allItems.length}` : '1 of 1'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="export-card-png-btn"
            onClick={() =>
              exportOpen ? setExportOpen(false) : void handleGenerateExport(exportTheme)
            }
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#C9A45C]/60 bg-[#C9A45C]/15 px-3 text-xs font-medium text-[#F5DC9B] whitespace-nowrap cursor-pointer active:scale-[0.97]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{exportOpen ? '返回藏卡' : '导出高清图'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭藏卡赏析"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#E8E2D7] hover:bg-white/10 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {exportOpen ? (
        <div
          data-testid="collectible-card-export-panel"
          className="flex w-full max-w-[388px] flex-col gap-3 rounded-3xl border border-[#3A352E] bg-[#1C1A17] p-4 text-[#FAF7F0] shadow-2xl md:max-w-[360px]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-editorial text-sm font-medium text-[#FAF7F0]">
              实体藏卡高清长图
            </span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-0.5">
              <button
                type="button"
                aria-pressed={exportTheme === 'darkroom'}
                onClick={() => void handleGenerateExport('darkroom')}
                className={`min-h-[32px] rounded-lg px-2.5 text-xs font-medium cursor-pointer ${
                  exportTheme === 'darkroom'
                    ? 'bg-[#FAF7F0] text-[#1A1816]'
                    : 'text-[#CFC7B9]'
                }`}
              >
                暗房黑金
              </button>
              <button
                type="button"
                aria-pressed={exportTheme === 'ivory'}
                onClick={() => void handleGenerateExport('ivory')}
                className={`min-h-[32px] rounded-lg px-2.5 text-xs font-medium cursor-pointer ${
                  exportTheme === 'ivory'
                    ? 'bg-[#FAF7F0] text-[#1A1816]'
                    : 'text-[#CFC7B9]'
                }`}
              >
                象牙纸白
              </button>
            </div>
          </div>

          <div className="flex min-h-[340px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#12110F] p-2">
            {exporting || !exportUrl ? (
              <div className="flex items-center gap-2 text-xs text-[#CFC7B9]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>正在绘制高清藏卡…</span>
              </div>
            ) : (
              <img
                src={exportUrl}
                alt={`${item.title}高清藏卡预览`}
                className="max-h-[52dvh] w-auto rounded-xl object-contain"
              />
            )}
          </div>

          <p className="text-center text-[11px] text-[#A59D90]">
            手机端可直接长按图片保存到相册，或点击下方一键保存 / 分享
          </p>

          <button
            type="button"
            disabled={!exportUrl}
            onClick={() => void handleSaveExport()}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#B43B2B] text-sm font-medium text-white cursor-pointer active:scale-[0.98] disabled:opacity-45"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>保存 / 分享藏卡 PNG</span>
          </button>
        </div>
      ) : (
        <>

      {/* 3D Flip Card Stage */}
      <div className="card-perspective w-full max-w-[388px] md:max-w-[360px]">
        <div
          className={`card-preserve-3d relative h-[min(548px,calc(100dvh-180px))] w-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            flipped ? 'card-rotate-y-180' : ''
          }`}
        >
          {/* FRONT FACE: Collector Cinema Folio */}
          <div
            data-testid="collectible-card-front"
            onClick={() => setFlipped(true)}
            className={`card-backface-hidden absolute inset-0 flex flex-col overflow-hidden rounded-3xl border-2 bg-[#1C1A17] p-4 text-[#F5F1E8] shadow-2xl cursor-pointer ${
              isMasterpiece ? 'border-[#C9A45C]' : 'border-[#3A352E]'
            }`}
          >
            {/* Card Serial Header */}
            <div className="flex items-center justify-between gap-2 pb-2.5 text-[12px] md:text-[11px]">
              <span className="min-w-0 truncate font-mono tracking-[0.1em] text-[#B8AFA2] tabular-nums">
                {item.accessionNo} · {CATEGORY_LABELS[item.category]}
              </span>
              <span
                className={`shrink-0 rounded-lg border px-2 py-0.5 font-editorial text-[12px] tracking-[0.12em] md:text-[11px] ${
                  isMasterpiece
                    ? 'border-[#C9A45C] text-[#E4C37A]'
                    : completeness.tier === 'curated'
                      ? 'border-[#8C857B]/50 text-[#D8D0C4]'
                      : 'border-white/15 text-[#9C9488]'
                }`}
              >
                {completeness.tierLabel}
              </span>
            </div>

            {/* Framed 3:4 Cinema Poster */}
            <div className="gallery-cover-frame relative min-h-0 flex-1 rounded-2xl border border-white/10 bg-[#12110F]">
              <ArchivalImage
                src={item.coverUrl}
                alt={`${item.title}藏卡封面`}
                title={item.title}
                category={item.category}
                className="h-full w-full rounded-2xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#1C1A17] via-[#1C1A17]/50 to-transparent"
              />
              {item.status === 'favorite' && (
                <div
                  aria-label="挚爱藏品印记"
                  className="absolute right-3 top-3 rounded-lg border border-[#E25A48]/80 bg-[#B43B2B]/90 px-2 py-1 font-editorial text-[11px] tracking-[0.16em] text-white"
                >
                  挚爱
                </div>
              )}
            </div>

            {/* Title & Archival Footer */}
            <div className="pt-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-editorial text-[22px] font-medium leading-tight text-[#FAF7F0] md:text-xl">
                    {item.title}
                  </h2>
                  {(item.originalTitle || item.year) && (
                    <p className="mt-1 truncate text-[13px] text-[#A59D90] md:mt-0.5 md:text-xs">
                      {[item.originalTitle, item.year, item.region]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                {item.rating > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 font-mono text-[15px] font-medium tabular-nums text-[#E4C37A] md:text-sm">
                    <Star
                      className="h-3.5 w-3.5 fill-[#E4C37A] text-[#E4C37A]"
                      aria-hidden="true"
                    />
                    {item.rating}.0
                  </span>
                )}
              </div>

              {/* 5-Tick Completeness Bar */}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="grid flex-1 grid-cols-5 gap-1">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <span
                      key={idx}
                      className={`h-1 rounded-full ${
                        idx < completeness.score
                          ? isMasterpiece
                            ? 'bg-[#D4AF6A]'
                            : 'bg-[#B43B2B]'
                          : 'bg-white/15'
                      }`}
                    />
                  ))}
                </div>
                <span className="font-mono text-[12px] tabular-nums text-[#9C9488] md:text-[11px]">
                  完备 {completeness.score}/5 · 点击翻面
                </span>
              </div>
            </div>
          </div>

          {/* BACK FACE: Archival Dossier & Completeness Checklist */}
          <div
            data-testid="collectible-card-back"
            onClick={() => setFlipped(false)}
            className={`card-backface-hidden card-rotate-y-180 absolute inset-0 flex flex-col overflow-hidden rounded-3xl border-2 bg-[#FAF8F3] p-5 text-[#1A1816] shadow-2xl cursor-pointer dark:bg-[#1A1714] dark:text-[#F3EFE6] ${
              isMasterpiece
                ? 'border-[#C9A45C]'
                : 'border-[#DCD6CB] dark:border-[#3A352E]'
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#E4DFD5] pb-3 dark:border-[#2E2924]">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[12px] tracking-[0.08em] text-[#7A7268] tabular-nums md:text-[11px] dark:text-[#A59D90]">
                  {item.accessionNo} · 馆藏鉴定卡
                </p>
                <h3 className="mt-0.5 truncate font-editorial text-[19px] font-medium text-[#1A1816] md:text-lg dark:text-[#F5F1E8]">
                  {item.title}
                </h3>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-0.5 font-editorial text-[13px] md:text-xs ${
                  isMasterpiece
                    ? 'border-[#A67C37] text-[#8E6523] dark:border-[#C9A45C] dark:text-[#E4C37A]'
                    : 'border-[#CFC7B9] text-[#625C54] dark:border-[#3E3830] dark:text-[#B8AFA2]'
                }`}
              >
                {completeness.tierLabel} {completeness.score}/5
              </span>
            </div>

            {/* Quote / Story Excerpt */}
            <div className="mt-3.5 border-b border-[#EFECE5] pb-3.5 dark:border-[#2E2924]">
              <p className="font-editorial text-[15px] italic leading-relaxed text-[#2E2A26] line-clamp-4 md:text-sm dark:text-[#E2DBD0]">
                {item.quote ? `“${item.quote}”` : backStory}
              </p>
            </div>

            {/* 5-Point Completeness Checklist */}
            <div className="mt-3.5">
              <p className="text-[12px] font-medium tracking-[0.06em] text-[#7A7268] md:text-[11px] dark:text-[#A59D90]">
                典藏级打磨清单
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] md:text-xs">
                {checklist.map((row) => (
                  <li
                    key={row.key}
                    className={`flex items-center gap-1.5 ${
                      row.done
                        ? 'text-[#1A1816] dark:text-[#F3EFE6]'
                        : 'text-[#8C857B] dark:text-[#8E8578]'
                    }`}
                  >
                    {row.done ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-[#2A6B46] dark:text-[#6CC492]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="h-3.5 w-3.5 shrink-0 text-[#CBC3B6] dark:text-[#524B42]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{row.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Metadata Footer */}
            <div className="mt-auto space-y-1.5 border-t border-[#E4DFD5] pt-3 text-[13px] text-[#625C54] md:text-xs dark:border-[#2E2924] dark:text-[#C4BCB0]">
              <p className="truncate">
                <span className="text-[#8C857B] dark:text-[#8E8578]">状态：</span>
                {getStatusLabel(item.status, item.category)}
                {item.rating > 0 ? ` · ${item.rating}.0 星` : ''}
              </p>
              {item.tags.length > 0 && (
                <p className="truncate">
                  <span className="text-[#8C857B] dark:text-[#8E8578]">标签：</span>
                  {item.tags.join(' · ')}
                </p>
              )}
              {related.length > 0 && (
                <p className="truncate">
                  <span className="text-[#8C857B] dark:text-[#8E8578]">关联：</span>
                  {related
                    .slice(0, 3)
                    .map((r) => r.title)
                    .join(' · ')}
                </p>
              )}
              <p className="pt-1 font-mono text-[11px] tabular-nums text-[#8C857B] md:text-[10px] dark:text-[#8E8578]">
                入藏日期：{item.createdAt.slice(0, 10)} · 点击翻回正面
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="mt-4 flex w-full max-w-[388px] items-center justify-between gap-2 md:max-w-[360px]">
        <button
          type="button"
          disabled={!hasSiblings}
          onClick={goPrev}
          aria-label="上一张藏卡"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#F5F1E8] cursor-pointer disabled:opacity-30 md:h-11 md:w-11"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? '翻回正面封面' : '翻面查看档案'}
          className="inline-flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-[13px] font-medium text-[#F5F1E8] whitespace-nowrap cursor-pointer active:scale-[0.98] md:h-11 md:text-xs"
        >
          <RotateCw className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
          <span>{flipped ? '翻回正面' : '翻面查看'}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenDetailEdit(item)}
          className="inline-flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-[13px] font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.98] md:h-11 md:text-xs"
        >
          <Edit3 className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
          <span>{isMasterpiece ? '打开档案' : '去打磨'}</span>
        </button>

        <button
          type="button"
          disabled={!hasSiblings}
          onClick={goNext}
          aria-label="下一张藏卡"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#F5F1E8] cursor-pointer transition-colors hover:bg-white/20 disabled:opacity-30 md:h-11 md:w-11"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-2.5 hidden font-mono text-[11px] text-[#9C9488] md:block">
        {hasSiblings ? '← → 切换藏卡 · 空格翻面 · Esc 关闭' : '空格翻面 · Esc 关闭'}
      </p>
        </>
      )}
    </div>
  );
}
