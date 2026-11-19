import { useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Edit3,
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
import { computeItemCompleteness } from '../utils/collector';
import { ArchivalImage } from './ArchivalImage';

interface CollectibleCardModalProps {
  item: ArchiveItem | null;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSelectItem: (item: ArchiveItem) => void;
  onOpenDetailEdit: (item: ArchiveItem) => void;
}

export function CollectibleCardModal({
  item,
  allItems,
  onClose,
  onSelectItem,
  onOpenDetailEdit,
}: CollectibleCardModalProps) {
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setFlipped(false);
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`实体藏卡赏析：${item.title}`}
      data-testid="collectible-card-modal"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#141210]/85 px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top Bar */}
      <div className="mb-3 flex w-full max-w-[348px] items-center justify-between text-[#E8E2D7]">
        <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
          <span>{item.accessionNo}</span>
          <span className="opacity-40">/</span>
          <span>
            {hasSiblings ? `${currentIndex + 1} of ${allItems.length}` : '1 of 1'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭藏卡赏析"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[#E8E2D7] hover:bg-white/10 cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 3D Flip Card Stage */}
      <div className="card-perspective w-full max-w-[348px]">
        <div
          className={`card-preserve-3d relative h-[504px] w-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
            <div className="flex items-center justify-between gap-2 pb-2.5 text-[11px]">
              <span className="font-mono tracking-[0.12em] text-[#B8AFA2] tabular-nums">
                {item.accessionNo} · {CATEGORY_LABELS[item.category]}
              </span>
              <span
                className={`rounded-lg border px-2 py-0.5 font-editorial text-[11px] tracking-[0.12em] ${
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
                  <h2 className="truncate font-editorial text-xl font-medium leading-tight text-[#FAF7F0]">
                    {item.title}
                  </h2>
                  {(item.originalTitle || item.year) && (
                    <p className="mt-0.5 truncate text-xs text-[#A59D90]">
                      {[item.originalTitle, item.year, item.region]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                {item.rating > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 font-mono text-sm font-medium tabular-nums text-[#E4C37A]">
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
                <span className="font-mono text-[11px] tabular-nums text-[#9C9488]">
                  完备 {completeness.score}/5 · 点击翻面
                </span>
              </div>
            </div>
          </div>

          {/* BACK FACE: Archival Dossier & Completeness Checklist */}
          <div
            data-testid="collectible-card-back"
            onClick={() => setFlipped(false)}
            className={`card-backface-hidden card-rotate-y-180 absolute inset-0 flex flex-col overflow-hidden rounded-3xl border-2 bg-[#FAF8F3] p-5 text-[#1A1816] shadow-2xl cursor-pointer ${
              isMasterpiece ? 'border-[#C9A45C]' : 'border-[#DCD6CB]'
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#E4DFD5] pb-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] tracking-[0.1em] text-[#7A7268] tabular-nums">
                  {item.accessionNo} · 馆藏鉴定卡
                </p>
                <h3 className="mt-0.5 truncate font-editorial text-lg font-medium text-[#1A1816]">
                  {item.title}
                </h3>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-0.5 font-editorial text-xs ${
                  isMasterpiece
                    ? 'border-[#A67C37] text-[#8E6523]'
                    : 'border-[#CFC7B9] text-[#625C54]'
                }`}
              >
                {completeness.tierLabel} {completeness.score}/5
              </span>
            </div>

            {/* Quote / Story Excerpt */}
            <div className="mt-3.5 border-b border-[#EFECE5] pb-3.5">
              <p className="font-editorial text-sm italic leading-relaxed text-[#2E2A26] line-clamp-4">
                {item.quote ? `“${item.quote}”` : backStory}
              </p>
            </div>

            {/* 5-Point Completeness Checklist */}
            <div className="mt-3.5">
              <p className="text-[11px] font-medium tracking-[0.06em] text-[#7A7268]">
                典藏级打磨清单
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {checklist.map((row) => (
                  <li
                    key={row.key}
                    className={`flex items-center gap-1.5 ${
                      row.done ? 'text-[#1A1816]' : 'text-[#8C857B]'
                    }`}
                  >
                    {row.done ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-[#2A6B46]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="h-3.5 w-3.5 shrink-0 text-[#CBC3B6]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{row.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Metadata Footer */}
            <div className="mt-auto space-y-1.5 border-t border-[#E4DFD5] pt-3 text-xs text-[#625C54]">
              <p className="truncate">
                <span className="text-[#8C857B]">状态：</span>
                {getStatusLabel(item.status, item.category)}
                {item.rating > 0 ? ` · ${item.rating}.0 星` : ''}
              </p>
              {item.tags.length > 0 && (
                <p className="truncate">
                  <span className="text-[#8C857B]">标签：</span>
                  {item.tags.join(' · ')}
                </p>
              )}
              {related.length > 0 && (
                <p className="truncate">
                  <span className="text-[#8C857B]">关联：</span>
                  {related
                    .slice(0, 3)
                    .map((r) => r.title)
                    .join(' · ')}
                </p>
              )}
              <p className="pt-1 font-mono text-[10px] tabular-nums text-[#8C857B]">
                入藏日期：{item.createdAt.slice(0, 10)} · 点击翻回正面
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="mt-4 flex w-full max-w-[348px] items-center justify-between gap-2">
        <button
          type="button"
          disabled={!hasSiblings}
          onClick={goPrev}
          aria-label="上一张藏卡"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#F5F1E8] cursor-pointer disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? '翻回正面封面' : '翻面查看档案'}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-medium text-[#F5F1E8] whitespace-nowrap cursor-pointer active:scale-[0.98]"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{flipped ? '翻回正面' : '翻面查看'}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenDetailEdit(item)}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.98]"
        >
          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isMasterpiece ? '打开档案' : '去打磨'}</span>
        </button>

        <button
          type="button"
          disabled={!hasSiblings}
          onClick={goNext}
          aria-label="下一张藏卡"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#F5F1E8] cursor-pointer disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
