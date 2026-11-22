import { useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  Grid3x3,
  Tag,
  X,
} from 'lucide-react';
import type { CollectionStatus, CollectorAlbum } from '../types/archive';

interface BatchActionBarProps {
  selectedCount: number;
  totalVisibleCount: number;
  albums: CollectorAlbum[];
  tagSuggestions: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExitBatchMode: () => void;
  onBatchStatus: (status: CollectionStatus) => Promise<void>;
  onBatchAddTag: (tag: string) => Promise<void>;
  onBatchAddToAlbum: (albumId: string) => Promise<void>;
  onOpenPosterWallWithSelection: () => void;
}

type ActivePanel = 'none' | 'status' | 'tag' | 'album';

const STATUS_ITEMS: Array<{ id: CollectionStatus; label: string }> = [
  { id: 'favorite', label: '挚爱' },
  { id: 'watched', label: '已看 / 已收录' },
  { id: 'watching', label: '在追 / 关注中' },
  { id: 'watchlist', label: '想看 / 待补档' },
];

export function BatchActionBar({
  selectedCount,
  totalVisibleCount,
  albums,
  tagSuggestions,
  onSelectAll,
  onClearSelection,
  onExitBatchMode,
  onBatchStatus,
  onBatchAddTag,
  onBatchAddToAlbum,
  onOpenPosterWallWithSelection,
}: BatchActionBarProps) {
  const [panel, setPanel] = useState<ActivePanel>('none');
  const [tagInput, setTagInput] = useState('');

  const disabled = selectedCount === 0;
  const allSelected = totalVisibleCount > 0 && selectedCount >= totalVisibleCount;

  const handleTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagInput.trim()) return;
    await onBatchAddTag(tagInput.trim());
    setTagInput('');
    setPanel('none');
  };

  return (
    <div
      data-testid="batch-action-bar"
      className="fixed inset-x-0 bottom-[calc(62px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[680px] px-3 md:bottom-5"
    >
      <div className="overflow-hidden rounded-2xl border border-[#342F28] bg-[#1C1A17] text-[#FAF7F0] shadow-2xl">
        {/* Sub-drawer panel for status / tag / album */}
        {panel === 'status' && !disabled && (
          <div className="border-b border-white/10 bg-[#23201B] px-3.5 py-3">
            <p className="mb-2 text-xs text-[#A59D90]">
              将已选 {selectedCount} 件统一设为：
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATUS_ITEMS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={async () => {
                    await onBatchStatus(st.id);
                    setPanel('none');
                  }}
                  className="min-h-[40px] rounded-xl border border-white/15 bg-white/8 px-2 text-xs font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer active:scale-[0.97]"
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {panel === 'tag' && !disabled && (
          <form
            onSubmit={handleTagSubmit}
            className="space-y-2.5 border-b border-white/10 bg-[#23201B] px-3.5 py-3"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="输入新标签，如：年度十佳、深夜重温"
                aria-label="批量添加标签"
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-[#161411] px-3 text-[16px] text-white placeholder:text-[#8C857B] focus:border-[#D4AF6A] focus:outline-none md:text-xs"
              />
              <button
                type="submit"
                disabled={!tagInput.trim()}
                className="h-10 shrink-0 rounded-xl bg-[#B43B2B] px-4 text-xs font-medium text-white whitespace-nowrap cursor-pointer disabled:opacity-40"
              >
                添加
              </button>
            </div>
            {tagSuggestions.length > 0 && (
              <div className="h-scroll-rail no-scrollbar flex items-center gap-1.5">
                {tagSuggestions.slice(0, 8).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={async () => {
                      await onBatchAddTag(t);
                      setPanel('none');
                    }}
                    className="min-h-[32px] shrink-0 rounded-lg border border-white/15 bg-white/8 px-2.5 text-xs text-[#E8E2D7] whitespace-nowrap cursor-pointer"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        {panel === 'album' && !disabled && (
          <div className="border-b border-white/10 bg-[#23201B] px-3.5 py-3">
            {albums.length === 0 ? (
              <p className="text-xs text-[#A59D90]">
                当前还没有专题图鉴册，请先在首页「专题图鉴册」点击「新建图鉴」。
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-[#A59D90]">
                  把已选 {selectedCount} 件加入图鉴册：
                </p>
                <div className="h-scroll-rail no-scrollbar flex items-center gap-2">
                  {albums.map((alb) => (
                    <button
                      key={alb.id}
                      type="button"
                      onClick={async () => {
                        await onBatchAddToAlbum(alb.id);
                        setPanel('none');
                      }}
                      className="min-h-[40px] shrink-0 rounded-xl border border-[#C9A45C]/50 bg-[#C9A45C]/15 px-3.5 text-xs font-medium text-[#F5DC9B] whitespace-nowrap cursor-pointer"
                    >
                      {alb.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Top Count & Select All Row */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-medium text-[#E4C37A] tabular-nums">
              已选 {selectedCount} 件
            </span>
            <button
              type="button"
              onClick={allSelected ? onClearSelection : onSelectAll}
              className="min-h-[32px] rounded-lg px-2 text-xs text-[#CFC7B9] underline underline-offset-4 cursor-pointer"
            >
              {allSelected ? '取消全选' : '全选当前'}
            </button>
          </div>
          <button
            type="button"
            onClick={onExitBatchMode}
            aria-label="退出批量整理"
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2 text-xs text-[#BDB5A8] hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>完成</span>
          </button>
        </div>

        {/* 4 Thumb-Zone Batch Actions */}
        <div className="grid grid-cols-4 gap-1.5 p-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPanel((p) => (p === 'status' ? 'none' : 'status'))}
            className={`inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              panel === 'status'
                ? 'bg-[#FAF7F0] text-[#1A1816]'
                : 'bg-white/8 text-[#FAF7F0]'
            }`}
          >
            <CheckSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>改状态</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => setPanel((p) => (p === 'tag' ? 'none' : 'tag'))}
            className={`inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              panel === 'tag'
                ? 'bg-[#FAF7F0] text-[#1A1816]'
                : 'bg-white/8 text-[#FAF7F0]'
            }`}
          >
            <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>加标签</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => setPanel((p) => (p === 'album' ? 'none' : 'album'))}
            className={`inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              panel === 'album'
                ? 'bg-[#FAF7F0] text-[#1A1816]'
                : 'bg-white/8 text-[#FAF7F0]'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>入图鉴</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onOpenPosterWallWithSelection}
            className="inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl bg-[#B43B2B] text-xs font-medium text-white whitespace-nowrap cursor-pointer disabled:opacity-40"
          >
            <Grid3x3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>海报墙</span>
          </button>
        </div>
      </div>
    </div>
  );
}
