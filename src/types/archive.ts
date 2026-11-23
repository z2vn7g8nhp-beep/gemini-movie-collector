export type ArchiveCategory = 'film' | 'person' | 'character';

export type CollectionStatus = 'favorite' | 'watched' | 'watching' | 'watchlist';

export type SortOption = 'recent' | 'rating' | 'year' | 'title';

export type SearchSourceOption = 'imdb';

export type WatchMedium = 'cinema' | 'imax' | 'streaming' | 'bluray' | 'tv' | 'other';

export interface WatchLogEntry {
  id: string;
  watchedAt: string; // YYYY-MM-DD
  medium?: WatchMedium;
  note?: string;
}

export type DecadeFilterOption = 'all' | '2020s' | '2010s' | '2000s' | '1990s' | 'classic';

export type RatingBucketFilterOption = 'all' | '5' | '4plus' | 'unrated';

export type CompletenessFilterOption = 'all' | 'masterpiece' | 'needs-polish';

export interface CharacterProfile {
  alias?: string;
  identity?: string;
  affiliation?: string;
  origin?: string;
  abilities?: string;
  firstAppearance?: string;
  creator?: string;
  highlights?: string;
  bio?: string;
  dossierSource?: string;
  enrichedAt?: string;
}

export interface ArchiveItem {
  id: string;
  accessionNo: string;
  category: ArchiveCategory;
  title: string;
  originalTitle?: string;
  subtitle?: string;
  year?: string;
  region?: string;
  coverUrl?: string;
  summary: string;
  summaryRevision?: number;
  quote?: string;
  notes: string;
  rating: number;
  status: CollectionStatus;
  tags: string[];
  relatedIds: string[];
  relatedWorkTitle?: string;
  portrayedBy?: string;
  characterProfile?: CharacterProfile;
  watchLogs?: WatchLogEntry[];
  sourceName?: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineSearchResult {
  externalId: string;
  category: ArchiveCategory;
  title: string;
  originalTitle?: string;
  subtitle?: string;
  year?: string;
  region?: string;
  coverUrl?: string;
  summary: string;
  summaryRevision?: number;
  relatedWorkTitle?: string;
  portrayedBy?: string;
  sourceName: string;
  sourceUrl?: string;
  tags: string[];
}

export interface ArchiveFilterState {
  category: 'all' | ArchiveCategory;
  status: 'all' | CollectionStatus;
  tag?: string;
  decade?: DecadeFilterOption;
  region?: string;
  ratingBucket?: RatingBucketFilterOption;
  completeness?: CompletenessFilterOption;
  query: string;
  sortBy: SortOption;
}

export interface ArchiveDraftInput {
  category: ArchiveCategory;
  title: string;
  originalTitle?: string;
  subtitle?: string;
  year?: string;
  region?: string;
  coverUrl?: string;
  summary?: string;
  quote?: string;
  notes?: string;
  rating: number;
  status: CollectionStatus;
  tags: string[];
  relatedIds?: string[];
  relatedWorkTitle?: string;
  portrayedBy?: string;
  characterProfile?: CharacterProfile;
  watchLogs?: WatchLogEntry[];
  sourceName?: string;
  sourceUrl?: string;
}

export interface ValidationErrors {
  title?: string;
  year?: string;
  rating?: string;
  coverUrl?: string;
}

export interface ArchiveStats {
  total: number;
  film: number;
  person: number;
  character: number;
  favorites: number;
  averageRating: number;
}

export interface CollectorAlbum {
  id: string;
  name: string;
  description?: string;
  tag?: string;
  itemIds?: string[];
  targetCount: number;
  createdAt: string;
}

export type ShowcasePrimaryMode =
  | 'daily'
  | 'pinned'
  | 'favorites'
  | 'watching'
  | 'custom';

export type ShowcaseSecondaryMode =
  | 'albums'
  | 'favorites'
  | 'quotes'
  | 'recent'
  | 'hidden';

export interface ShowcaseConfig {
  primaryMode: ShowcasePrimaryMode;
  pinnedItemId?: string;
  customLabel?: string;
  customTitle?: string;
  customSubtitle?: string;
  customQuote?: string;
  customCoverUrl?: string;
  customLinkItemId?: string;
  secondaryMode: ShowcaseSecondaryMode;
}

export interface CollectorState {
  checkInDates: string[];
  albums: CollectorAlbum[];
  showcase?: ShowcaseConfig;
}
