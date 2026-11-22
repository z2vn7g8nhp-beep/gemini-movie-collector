import { useEffect, useMemo, useState } from 'react';
import { Check, Grid3x3, Search, X } from 'lucide-react';
import type { ArchiveItem, CollectorAlbum } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import { resolveAlbumItems } from '../utils/collector';
import { ArchivalImage } from './ArchivalImage';

interface AlbumCuratorModalProps {
  album: CollectorAlbum | null;
  allItems: ArchiveItem[];
  onClose: () => void;
  onSaveAlbum: (updated: CollectorAlbum) => Promise<void>;
  onExportAlbumPoster?: (album: CollectorAlbum, matchedItems: ArchiveItem[]) => void;
}

const TARGET_PRESETS = [3, 5, 8, 10, 12, 16];

export function AlbumCuratorModal({
  album,
  allItems,
  onClose,
  onSaveAlbum,
  onExportAlbumPoster,
}: AlbumCuratorModalProps) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [targetCount, setTargetCount] = useState(5);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!album) return;
    setName(album.name);
    setTag(album.tag || '');
    setTargetCount(album.targetCount);
    setManualIds(Array.isArray(album.itemIds) ? album.itemIds : []);
    setSearch('');
  }, [album]);

  useEffect(() => {
    if (!album) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [album, onClose]);

  const previewAlbum: CollectorAlbum | null = useMemo(() => {
    if (!album) return null;
    return {
      ...album,
      name: name.trim() || album.name,
      tag: tag.trim() || undefined,
      targetCount: Math.max(1, targetCount),
      itemIds: manualIds,
    };
  }, [album, name, tag, targetCount, manualIds]);

  const resolvedMatched = useMemo(
    () => (previewAlbum ? resolveAlbumItems(previewAlbum, allItems) : []),
    [previewAlbum, allItems]
  );

  const visibleCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((it) =>
      [it.title, it.originalTitle, it.year, ...it.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [allItems, search]);

  if (!album || !previewAlbum) return null;

  const toggleManualId = (id: string) => {
    setManualIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSaveAlbum(previewAlbum);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="album-curator-title"
      data-testid="album-curator-modal"
      className="encounter-backdrop-in fixed inset-0 z-[70] flex items-end justify-center bg-[#141210]/70 backdrop-blur-xs md:items-center md:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="drawer-panel-in flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl bg-[#F7F5F0] shadow-2xl md:rounded-3xl"
      >
        <div className="flex justify-center pt-2.5 pb-1 md:hidden" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-[#D3CCC0]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[#E4DFD5] px-4 py-3 min-[420px]:px-5">
          <div className="min-w-0">
            <h2
              id="album-curator-title"
              className="font-editorial text-[19px] font-medium text-[#1A1816]"
            >
              专题图鉴自由选片
            </h2>
            <p className="mt-0.5 text-xs text-[#7A7268] tabular-nums">
              已入册 {resolvedMatched.length} 件（手工勾选 {manualIds.length} 件）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭图鉴选片"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 min-[420px]:px-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="curator-album-name"
                className="block text-xs font-medium text-[#4B453E]"
              >
                图鉴名称
              </label>
              <input
                id="curator-album-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="curator-album-tag"
                className="block text-xs font-medium text-[#4B453E]"
              >
                自动归集标签（可选）
              </label>
              <input
                id="curator-album-tag"
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="留空则完全按手工勾选"
                className="mt-1 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-[#4B453E]">
              集齐目标件数
            </span>
            <div className="mt-1.5 grid grid-cols-6 gap-1.5">
              {TARGET_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={targetCount === n}
                  onClick={() => setTargetCount(n)}
                  className={`min-h-[38px] rounded-xl font-mono text-xs font-medium tabular-nums cursor-pointer ${
                    targetCount === n
                      ? 'bg-[#1A1816] text-white'
                      : 'border border-[#DCD6CB] bg-white text-[#4B453E]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Search & Pick Items */}
          <div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索馆藏自由勾选入册…"
                aria-label="搜索馆藏勾选入册"
                className="h-11 w-full rounded-xl border border-[#DCD6CB] bg-white pl-9 pr-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
              />
            </div>

            <div className="mt-2.5 space-y-2">
              {visibleCandidates.map((it) => {
                const isManual = manualIds.includes(it.id);
                const isTagMatched = Boolean(
                  tag.trim() &&
                    it.tags.some(
                      (t) => t.trim().toLowerCase() === tag.trim().toLowerCase()
                    )
                );
                const checked = isManual || isTagMatched;
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleManualId(it.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors cursor-pointer ${
                      checked
                        ? 'border-[#1A1816] bg-[#FFFDF9]'
                        : 'border-[#E4DFD5] bg-white'
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
                      <p className="truncate font-editorial text-[15px] font-medium text-[#1A1816]">
                        {it.title}
                      </p>
                      <p className="truncate font-mono text-[11px] text-[#7A7268] tabular-nums">
                        {CATEGORY_LABELS[it.category]}
                        {it.year ? ` · ${it.year}` : ''}
                        {isTagMatched && !isManual ? ' · 由标签自动收录' : ''}
                      </p>
                    </div>
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                        checked
                          ? 'border-[#B43B2B] bg-[#B43B2B] text-white'
                          : 'border-[#D3CCC0] bg-[#FAF9F6] text-transparent'
                      }`}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex items-center gap-2 border-t border-[#E4DFD5] bg-white px-4 py-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5">
          {onExportAlbumPoster && resolvedMatched.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onExportAlbumPoster(previewAlbum, resolvedMatched);
              }}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer"
            >
              <Grid3x3 className="h-4 w-4 text-[#A67C37]" aria-hidden="true" />
              <span>导出海报墙</span>
            </button>
          )}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            data-testid="album-curator-save-btn"
            className="h-12 flex-1 rounded-xl bg-[#B43B2B] text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] disabled:opacity-45"
          >
            {saving ? '保存中…' : `保存图鉴册（${resolvedMatched.length} 件）`}
          </button>
        </div>
      </form>
    </div>
  );
}
