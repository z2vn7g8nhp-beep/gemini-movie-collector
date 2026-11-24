import { useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, FolderPlus } from 'lucide-react';
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
      className="mt-4 space-y-2.5 border-t border-[#E6E0D5] pt-3.5 dark:border-[#2C2721]"
    >
      {/* Belonging Albums (收藏夹 / 专题图鉴) */}
      {hasAlbumsBlock && (
        <div
          data-testid="drawer-albums-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
        >
          <span className="shrink-0 text-[11px] font-medium tracking-[0.06em] text-[#8C857B] dark:text-[#9A9184]">
            所属图鉴
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            {itemAlbums.map(({ album, matchedCount }) => (
              <button
                key={album.id}
                type="button"
                data-testid={`drawer-jump-album-${album.id}`}
                onClick={() => onJumpToAlbum(album.id, item.id)}
                aria-label={`跳转到收藏夹「${album.name}」图鉴列表并选中「${item.title}」`}
                className="group inline-flex min-h-[30px] max-w-full items-center gap-1 text-[13px] font-medium text-[#7D571B] transition-colors hover:text-[#B43B2B] cursor-pointer md:text-xs dark:text-[#E4C37A] dark:hover:text-[#F5DC9B]"
              >
                <BookOpen
                  className="h-3.5 w-3.5 shrink-0 opacity-80"
                  aria-hidden="true"
                />
                <span className="truncate underline decoration-[#D8C194] underline-offset-4 group-hover:decoration-[#B43B2B] dark:decoration-[#6B5733] dark:group-hover:decoration-[#F5DC9B]">
                  {album.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-75">
                  {matchedCount}
                </span>
                <ArrowUpRight
                  className="h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
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
                  className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[#8C857B] dark:text-[#9A9184]"
                  aria-hidden="true"
                />
                <select
                  id="drawer-add-to-album"
                  data-testid="drawer-add-to-album-select"
                  disabled={addingAlbum}
                  value=""
                  onChange={(e) => void handleQuickAddAlbum(e.target.value)}
                  className="h-7 rounded-md border border-dashed border-[#D3CCC0] bg-transparent pl-6 pr-2 text-[12px] font-medium text-[#5A534B] transition-colors hover:border-[#A67C37] hover:text-[#1A1816] focus:border-[#1A1816] focus:outline-none disabled:opacity-50 cursor-pointer md:text-[11px] dark:border-[#463F36] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:text-[#F3EFE6]"
                >
                  <option value="">
                    {addingAlbum ? '加入中…' : '加入图鉴'}
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
        </div>
      )}

      {/* Attached Tags (标签直达 — Clean Editorial Index Links) */}
      {hasTagsBlock && (
        <div
          data-testid="drawer-tags-jump-row"
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5"
        >
          <span className="shrink-0 text-[11px] font-medium tracking-[0.06em] text-[#8C857B] dark:text-[#9A9184]">
            档案标签
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
            {item.tags.map((tag, idx) => {
              const count = tagCountMap.get(tagKey(tag)) ?? 1;
              return (
                <span key={tag} className="inline-flex items-center">
                  {idx > 0 && (
                    <span
                      aria-hidden="true"
                      className="mx-1.5 text-[#CFC7B9] dark:text-[#4A4239]"
                    >
                      /
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid={`drawer-jump-tag-${tag}`}
                    onClick={() => onJumpToTag(tag, item.id)}
                    aria-label={`跳转到标签「${tag}」图鉴列表并选中「${item.title}」`}
                    className="group inline-flex min-h-[28px] max-w-full items-center gap-1 rounded px-1 py-0.5 text-[13px] font-medium text-[#3A3530] transition-colors hover:bg-[#EFEAE0] hover:text-[#B43B2B] cursor-pointer md:text-xs dark:text-[#DDD6C9] dark:hover:bg-[#26221D] dark:hover:text-[#F28C7B]"
                  >
                    <span className="truncate">{tag}</span>
                    <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[#8C857B] group-hover:text-[#B43B2B]/80 dark:text-[#8E8578] dark:group-hover:text-[#F28C7B]/85">
                      {count}
                    </span>
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
