import type { ArchiveCategory, ArchiveItem } from '../types/archive';

export const MAX_TAGS_PER_ITEM = 12;
export const MAX_TAG_LENGTH = 24;

export interface TagRegistryEntry {
  name: string;
  count: number;
  categories: ArchiveCategory[];
}

export interface TagSuggestion {
  name: string;
  count: number;
  matchType: 'exact' | 'prefix' | 'contains' | 'popular';
}

export interface AddTagResult {
  tags: string[];
  added: string[];
  duplicate?: string;
  limitReached?: boolean;
}

export function normalizeTagName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^[#＃]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.slice(0, MAX_TAG_LENGTH).trim();
}

export function splitRawTagInput(raw: string): string[] {
  return raw
    .split(/[，,、/\n]+/)
    .map(normalizeTagName)
    .filter(Boolean);
}

export function tagKey(tag: string): string {
  return normalizeTagName(tag).toLowerCase();
}

export function itemHasTag(item: ArchiveItem, targetTag: string): boolean {
  const target = tagKey(targetTag);
  if (!target) return false;
  return item.tags.some((t) => tagKey(t) === target);
}

export function collectTagRegistry(items: ArchiveItem[]): TagRegistryEntry[] {
  const map = new Map<
    string,
    {
      countsByVariant: Map<string, number>;
      totalCount: number;
      categories: Set<ArchiveCategory>;
    }
  >();

  for (const item of items) {
    const seenOnItem = new Set<string>();
    for (const rawTag of item.tags) {
      const normalized = normalizeTagName(rawTag);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seenOnItem.has(key)) continue;
      seenOnItem.add(key);

      let entry = map.get(key);
      if (!entry) {
        entry = {
          countsByVariant: new Map<string, number>(),
          totalCount: 0,
          categories: new Set<ArchiveCategory>(),
        };
        map.set(key, entry);
      }
      entry.totalCount += 1;
      entry.categories.add(item.category);
      entry.countsByVariant.set(
        normalized,
        (entry.countsByVariant.get(normalized) ?? 0) + 1
      );
    }
  }

  const entries: TagRegistryEntry[] = [];
  for (const [, data] of map.entries()) {
    let canonical = '';
    let bestVariantCount = -1;
    for (const [variant, vCount] of data.countsByVariant.entries()) {
      if (vCount > bestVariantCount) {
        canonical = variant;
        bestVariantCount = vCount;
      }
    }
    entries.push({
      name: canonical,
      count: data.totalCount,
      categories: Array.from(data.categories),
    });
  }

  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return entries;
}

export function getTagAutocompleteSuggestions(
  rawInput: string,
  currentTags: string[],
  registry: TagRegistryEntry[],
  limit = 8
): TagSuggestion[] {
  const existingKeys = new Set(currentTags.map(tagKey).filter(Boolean));
  const query = normalizeTagName(rawInput).toLowerCase();

  const available = registry.filter((entry) => !existingKeys.has(tagKey(entry.name)));
  if (!query) {
    return available.slice(0, limit).map((entry) => ({
      name: entry.name,
      count: entry.count,
      matchType: 'popular',
    }));
  }

  const scored: Array<TagSuggestion & { rank: number }> = [];
  for (const entry of available) {
    const lower = entry.name.toLowerCase();
    let matchType: TagSuggestion['matchType'] | null = null;
    let rank = 0;

    if (lower === query) {
      matchType = 'exact';
      rank = 3;
    } else if (lower.startsWith(query)) {
      matchType = 'prefix';
      rank = 2;
    } else if (lower.includes(query)) {
      matchType = 'contains';
      rank = 1;
    }

    if (matchType) {
      scored.push({
        name: entry.name,
        count: entry.count,
        matchType,
        rank,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return scored.slice(0, limit).map(({ name, count, matchType }) => ({
    name,
    count,
    matchType,
  }));
}

export function addTagToList(
  currentTags: string[],
  rawInput: string,
  maxTags = MAX_TAGS_PER_ITEM
): AddTagResult {
  const incoming = splitRawTagInput(rawInput);
  if (incoming.length === 0) {
    return { tags: currentTags, added: [] };
  }

  const next = [...currentTags];
  const existingKeys = new Set(next.map(tagKey).filter(Boolean));
  const added: string[] = [];
  let duplicate: string | undefined;
  let limitReached = false;

  for (const candidate of incoming) {
    const key = candidate.toLowerCase();
    if (existingKeys.has(key)) {
      if (!duplicate) duplicate = candidate;
      continue;
    }
    if (next.length >= maxTags) {
      limitReached = true;
      break;
    }
    next.push(candidate);
    existingKeys.add(key);
    added.push(candidate);
  }

  return {
    tags: next,
    added,
    duplicate: added.length === 0 ? duplicate : undefined,
    limitReached,
  };
}

export function removeTagFromList(
  currentTags: string[],
  tagToRemove: string
): string[] {
  const target = tagKey(tagToRemove);
  if (!target) return currentTags;
  return currentTags.filter((tag) => tagKey(tag) !== target);
}

export function getItemsByTag(
  items: ArchiveItem[],
  targetTag: string,
  excludeId?: string
): ArchiveItem[] {
  const target = tagKey(targetTag);
  if (!target) return [];
  return items.filter((item) => {
    if (excludeId && item.id === excludeId) return false;
    return item.tags.some((t) => tagKey(t) === target);
  });
}
