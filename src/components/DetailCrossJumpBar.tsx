import { useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, FolderPlus, Tag } from 'lucide-react';
import type { ArchiveItem, CollectorAlbum } from '../types/archive';
import {
  getAvailableAlbumsForItem,
  getItemAlbums,
} from '../utils/drawerNavigation';
import { collectTagRegistry, tagKey } from '../utils/tags';

interface DetailCrossJumpBarProps {
  item: ArchiveItem;
  allItems: ArchiveItem[];
  albums: CollectorAlbum[];
  onJumpToAlbum: (albumId: string, focusItemId: string) => void;
  onJumpToTag: (tag: string, focusItemId: string) => void;
  onAddToAlbum?: (albumId: string, itemId: string) => Promise<void>;
}

export function DetailCrossJumpBar({
  item,
  allItems,
  albums,
  onJumpToAlbum,
  onJumpToTag,
  onAddToAlbum,
}: DetailCrossJumpBarProps) {
  const [addingAlbum, setAddingAlbum] = useState(false);

  const itemAlbums = useMemo(
    () => getItemAlbums(item, albums, allItems),
    [item, albums, allItems]
  );

  const availableAlbums = useMemo(
    () => getAvailableAlbumsForItem(item, albums),
    [item, albums]
  );

  const tagCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of collectTagRegistry(allItems)) {
      map.set(tagKey(entry.name), entry.count);
    }
    return map;
  }, [allItems]);

  const hasAlbumsBlock =
    itemAlbums.length > 0 || (availableAlbums.length > 0 && Boolean(onAddToAlbum));
  const hasTagsBlock = item.tags.length > 0;

  if (!hasAlbumsBlock && !hasTagsBlock) {
    return null;
  }

  const handleQuickAddAlbum = async (albumId: string) => {
    if (!albumId || !onAddToAlbum || addingAlbum) return;
    setAddingAlbum(true);
    try {
      await onAddToAlbum(albumId, item.id);
    } finally {
      setAddingAlbum(false);
    }
  };

  return (
    <section
      aria-label="所属收藏夹与标签快捷跳转"
      data-testid="detail-cross-jump-bar"
      className="mt-4 rounded-2xl border border-[#E4DFD5] bg-white p-3.5 dark:border-[#322D27] dark:bg-[#1D1A17]"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium tracking-[0.04em] text-[#1A1816] md:text-xs dark:text-[#F3EFE6]">
          所属收藏夹与标签
        </h3>
        <span className="text-[11px] text-[#8C857B] dark:text-[#9A9184]">
          点击直达图鉴列表并选中本条目
        </span>
      </div>

      {/* Belonging Albums (收藏夹 / 专题图鉴) */}
      {hasAlbumsBlock && (
        <div
          data-testid="drawer-albums-row"
          className="mt-2.5 flex flex-wrap items-center gap-1.5"
        >
          {itemAlbums.map(({ album, matchedCount }) => (
            <button
              key={album.id}
              type="button"
              data-testid={`drawer-jump-album-${album.id}`}
              onClick={() => onJumpToAlbum(album.id, item.id)}
              aria-label={`跳转到收藏夹「${album.name}」图鉴列表并选中「${item.title}」`}
              className="group inline-flex min-h-[36px] max-w-full items-center gap-1.5 rounded-xl border border-[#D8C194] bg-[#FDF9F0] px-2.5 py-1 text-[13px] font-medium text-[#1A1816] transition-colors hover:border-[#A67C37] hover:bg-[#F7EEDB] active:scale-[0.98] cursor-pointer md:min-h-[32px] md:text-xs dark:border-[#6B5733] dark:bg-[#272117] dark:text-[#F5EFE2] dark:hover:border-[#E4C37A] dark:hover:bg-[#31291C]"
            >
              <BookOpen
                className="h-3.5 w-3.5 shrink-0 text-[#A67C37] dark:text-[#E4C37A]"
                aria-hidden="true"
              />
              <span className="truncate">{album.name}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#8E6523] dark:text-[#D4AF6A]">
                {matchedCount}
              </span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-[#8E6523] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-[#E4C37A]"
                aria-hidden="true"
              />
            </button>
          ))}

          {availableAlbums.length > 0 && onAddToAlbum && (
            <div className="relative inline-flex items-center">
              <label htmlFor="drawer-add-to-album" className="sr-only">
                收入收藏夹
              </label>
              <FolderPlus
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#8C857B] dark:text-[#9A9184]"
                aria-hidden="true"
              />
              <select
                id="drawer-add-to-album"
                data-testid="drawer-add-to-album-select"
                disabled={addingAlbum}
                value=""
                onChange={(e) => void handleQuickAddAlbum(e.target.value)}
                className="h-9 rounded-xl border border-dashed border-[#D3CCC0] bg-[#FAF9F6] pl-7 pr-2.5 text-[12px] font-medium text-[#5A534B] transition-colors hover:border-[#A67C37] hover:text-[#1A1816] focus:border-[#1A1816] focus:outline-none disabled:opacity-50 cursor-pointer md:h-8 md:text-xs dark:border-[#463F36] dark:bg-[#24201C] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]"
              >
                <option value="">
                  {addingAlbum ? '加入中…' : '+ 加入收藏夹'}
                </option>
                {availableAlbums.map((alb) => (
                  <option key={alb.id} value={alb.id}>
                    {alb.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Attached Tags (标签直达) */}
      {hasTagsBlock && (
        <div
          data-testid="drawer-tags-jump-row"
          className={`${
            hasAlbumsBlock
              ? 'mt-2.5 border-t border-[#F0EBE2] pt-2.5 dark:border-[#2E2924]'
              : 'mt-2.5'
          } flex flex-wrap items-center gap-1.5`}
        >
          {item.tags.map((tag) => {
            const count = tagCountMap.get(tagKey(tag)) ?? 1;
            return (
              <button
                key={tag}
                type="button"
                data-testid={`drawer-jump-tag-${tag}`}
                onClick={() => onJumpToTag(tag, item.id)}
                aria-label={`跳转到标签「${tag}」图鉴列表并选中「${item.title}」`}
                className="group inline-flex min-h-[36px] max-w-full items-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-[#FAF8F4] px-2.5 py-1 text-[13px] font-medium text-[#2A2622] transition-colors hover:border-[#B43B2B] hover:bg-[#FDF5F3] hover:text-[#B43B2B] active:scale-[0.98] cursor-pointer md:min-h-[32px] md:text-xs dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#EFE9DE] dark:hover:border-[#EB7865] dark:hover:bg-[#31211E] dark:hover:text-[#F28C7B]"
              >
                <Tag
                  className="h-3 w-3 shrink-0 text-[#8C857B] transition-colors group-hover:text-[#B43B2B] dark:text-[#9A9184] dark:group-hover:text-[#F28C7B]"
                  aria-hidden="true"
                />
                <span className="truncate">{tag}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#8C857B] group-hover:text-[#B43B2B]/80 dark:text-[#9A9184] dark:group-hover:text-[#F28C7B]/85">
                  {count}
                </span>
                <ArrowUpRight
                  className="h-3 w-3 shrink-0 text-[#8C857B] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#B43B2B] dark:text-[#9A9184] dark:group-hover:text-[#F28C7B]"
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
