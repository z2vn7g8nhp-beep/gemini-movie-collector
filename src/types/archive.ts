export type ArchiveCategory = 'film' | 'person' | 'character';

export type CollectionStatus = 'favorite' | 'watched' | 'watching' | 'watchlist';

export type SortOption = 'recent' | 'rating' | 'year' | 'title';

export type SearchSourceOption = 'imdb';

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
  quote?: string;
  notes: string;
  rating: number;
  status: CollectionStatus;
  tags: string[];
  relatedIds: string[];
  relatedWorkTitle?: string;
  portrayedBy?: string;
  characterProfile?: CharacterProfile;
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

export interface CollectorState {
  checkInDates: string[];
  albums: CollectorAlbum[];
}
