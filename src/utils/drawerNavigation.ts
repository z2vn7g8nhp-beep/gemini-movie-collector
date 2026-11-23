import type {
  ArchiveCategory,
  ArchiveItem,
  CollectionStatus,
  CollectorAlbum,
  CompletenessFilterOption,
  DecadeFilterOption,
  RatingBucketFilterOption,
} from '../types/archive';
import { resolveAlbumItems } from './collector';
import { itemHasTag } from './tags';

export type AlbumMatchReason = 'manual' | 'tag' | 'both';

export interface ItemAlbumMembership {
  album: CollectorAlbum;
  matchedCount: number;
  matchReason: AlbumMatchReason;
}

export type CrossJumpTarget =
  | {
      kind: 'album';
      albumId: string;
      albumName: string;
      itemId: string;
      itemTitle: string;
    }
  | {
      kind: 'tag';
      tag: string;
      itemId: string;
      itemTitle: string;
    };

export interface CrossJumpLibraryState {
  activeTab: 'library';
  activeCategory: 'all' | ArchiveCategory;
  statusFilter: 'all' | CollectionStatus;
  activeAlbumId: string;
  activeTag: string;
  libraryQuery: string;
  decadeFilter: DecadeFilterOption;
  regionFilter: string;
  ratingBucketFilter: RatingBucketFilterOption;
  completenessFilter: CompletenessFilterOption;
  locatedItemId: string;
  notice: string;
}

/**
 * Finds all collector albums ("专题图鉴 / 收藏夹") that contain the given item,
 * either via explicit itemIds inclusion or automatic tag matching.
 */
export function getItemAlbums(
  item: ArchiveItem,
  albums: CollectorAlbum[],
  allItems: ArchiveItem[]
): ItemAlbumMembership[] {
  const result: ItemAlbumMembership[] = [];
  for (const album of albums) {
    const isManual = Array.isArray(album.itemIds) && album.itemIds.includes(item.id);
    const isTagMatched = Boolean(album.tag && itemHasTag(item, album.tag));
    if (!isManual && !isTagMatched) continue;

    const matchedCount = resolveAlbumItems(album, allItems).length;
    const matchReason: AlbumMatchReason =
      isManual && isTagMatched ? 'both' : isManual ? 'manual' : 'tag';

    result.push({
      album,
      matchedCount,
      matchReason,
    });
  }
  return result;
}

/**
 * Returns collector albums that do not yet contain the given item.
 */
export function getAvailableAlbumsForItem(
  item: ArchiveItem,
  albums: CollectorAlbum[]
): CollectorAlbum[] {
  return albums.filter((album) => {
    const isManual = Array.isArray(album.itemIds) && album.itemIds.includes(item.id);
    const isTagMatched = Boolean(album.tag && itemHasTag(item, album.tag));
    return !isManual && !isTagMatched;
  });
}

/**
 * Builds the normalized Library view state when jumping from DetailDrawer
 * via an album name or tag so the target list is guaranteed to contain and
 * auto-select the originating item.
 */
export function buildCrossJumpLibraryState(
  target: CrossJumpTarget
): CrossJumpLibraryState {
  if (target.kind === 'album') {
    return {
      activeTab: 'library',
      activeCategory: 'all',
      statusFilter: 'all',
      activeAlbumId: target.albumId,
      activeTag: '',
      libraryQuery: '',
      decadeFilter: 'all',
      regionFilter: '',
      ratingBucketFilter: 'all',
      completenessFilter: 'all',
      locatedItemId: target.itemId,
      notice: `已跳转至收藏夹「${target.albumName}」并选中「${target.itemTitle}」`,
    };
  }

  return {
    activeTab: 'library',
    activeCategory: 'all',
    statusFilter: 'all',
    activeAlbumId: '',
    activeTag: target.tag,
    libraryQuery: '',
    decadeFilter: 'all',
    regionFilter: '',
    ratingBucketFilter: 'all',
    completenessFilter: 'all',
    locatedItemId: target.itemId,
    notice: `已跳转至标签「${target.tag}」图鉴并选中「${target.itemTitle}」`,
  };
}
