import type {
  ArchiveCategory,
  ArchiveItem,
  ShowcaseConfig,
  ShowcasePrimaryMode,
  ShowcaseSecondaryMode,
} from '../types/archive';
import { computeItemCompleteness, pickDailySpotlightItem } from './collector';

export const VALID_PRIMARY_MODES: ReadonlySet<ShowcasePrimaryMode> = new Set([
  'daily',
  'pinned',
  'favorites',
  'watching',
  'custom',
]);

export const VALID_SECONDARY_MODES: ReadonlySet<ShowcaseSecondaryMode> = new Set([
  'albums',
  'favorites',
  'quotes',
  'recent',
  'hidden',
]);

export const DEFAULT_SHOWCASE_CONFIG: ShowcaseConfig = {
  primaryMode: 'daily',
  secondaryMode: 'albums',
};

export const PRIMARY_MODE_META: Record<
  ShowcasePrimaryMode,
  { label: string; shortDesc: string; defaultBadge: string }
> = {
  daily: {
    label: '每日藏签',
    shortDesc: '按日期自动轮换一件馆藏',
    defaultBadge: '今日藏签',
  },
  pinned: {
    label: '指定藏品',
    shortDesc: '固定展示你挑选的一件镇馆之作',
    defaultBadge: '镇馆置顶',
  },
  favorites: {
    label: '挚爱精选',
    shortDesc: '从挚爱或五星藏品中精选展示',
    defaultBadge: '挚爱精选',
  },
  watching: {
    label: '在追 / 待看',
    shortDesc: '提醒近期在追或待补档的片单',
    defaultBadge: '近期在追',
  },
  custom: {
    label: '自定义展签',
    shortDesc: '自由定制标题、寄语与封面图片',
    defaultBadge: '主题展签',
  },
};

export const SECONDARY_MODE_META: Record<
  ShowcaseSecondaryMode,
  { label: string; shortDesc: string }
> = {
  albums: {
    label: '专题图鉴册',
    shortDesc: '展示自定义专题图鉴与收集进度槽位',
  },
  favorites: {
    label: '挚爱精选墙',
    shortDesc: '直观陈列最多 6 件挚爱 / 五星藏品封面',
  },
  quotes: {
    label: '光影金句笺',
    shortDesc: '翻阅馆内摘录的经典台词与观影手记',
  },
  recent: {
    label: '近期入藏',
    shortDesc: '速览最新收录条目与馆藏成色概览',
  },
  hidden: {
    label: '仅显主展位',
    shortDesc: '隐藏右侧模块，主展区宽幅居中呈现',
  },
};

function cleanOptionalText(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function cleanCoverUrl(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed;
  }
  return undefined;
}

export function normalizeShowcaseConfig(
  raw?: Partial<ShowcaseConfig> | null
): ShowcaseConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SHOWCASE_CONFIG };
  }

  const primaryMode: ShowcasePrimaryMode = VALID_PRIMARY_MODES.has(
    raw.primaryMode as ShowcasePrimaryMode
  )
    ? (raw.primaryMode as ShowcasePrimaryMode)
    : 'daily';

  const secondaryMode: ShowcaseSecondaryMode = VALID_SECONDARY_MODES.has(
    raw.secondaryMode as ShowcaseSecondaryMode
  )
    ? (raw.secondaryMode as ShowcaseSecondaryMode)
    : 'albums';

  const normalized: ShowcaseConfig = {
    primaryMode,
    secondaryMode,
  };

  const pinnedItemId = cleanOptionalText(raw.pinnedItemId, 120);
  if (pinnedItemId) normalized.pinnedItemId = pinnedItemId;

  const customLabel = cleanOptionalText(raw.customLabel, 24);
  if (customLabel) normalized.customLabel = customLabel;

  const customTitle = cleanOptionalText(raw.customTitle, 80);
  if (customTitle) normalized.customTitle = customTitle;

  const customSubtitle = cleanOptionalText(raw.customSubtitle, 100);
  if (customSubtitle) normalized.customSubtitle = customSubtitle;

  const customQuote = cleanOptionalText(raw.customQuote, 240);
  if (customQuote) normalized.customQuote = customQuote;

  const customCoverUrl = cleanCoverUrl(raw.customCoverUrl);
  if (customCoverUrl) normalized.customCoverUrl = customCoverUrl;

  const customLinkItemId = cleanOptionalText(raw.customLinkItemId, 120);
  if (customLinkItemId) normalized.customLinkItemId = customLinkItemId;

  return normalized;
}

export function isShowcaseCustomized(config?: ShowcaseConfig | null): boolean {
  const c = normalizeShowcaseConfig(config);
  return (
    c.primaryMode !== 'daily' ||
    c.secondaryMode !== 'albums' ||
    Boolean(c.customLabel) ||
    Boolean(c.customQuote) ||
    Boolean(c.customTitle) ||
    Boolean(c.customCoverUrl)
  );
}

export interface ResolvedPrimaryShowcase {
  mode: ShowcasePrimaryMode;
  badgeText: string;
  item: ArchiveItem | null;
  title: string;
  subtitle?: string;
  quote: string;
  coverUrl?: string;
  category: ArchiveCategory;
  canShuffle: boolean;
  poolCount: number;
  isCustomOnly: boolean;
  fallbackHint?: string;
}

export function getFavoriteShowcasePool(items: ArchiveItem[]): ArchiveItem[] {
  const favorites = items.filter((it) => it.status === 'favorite');
  if (favorites.length > 0) return favorites;
  const fiveStar = items.filter((it) => it.rating >= 5);
  if (fiveStar.length > 0) return fiveStar;
  return [...items]
    .filter((it) => it.rating >= 4)
    .sort((a, b) => b.rating - a.rating);
}

export function getWatchingShowcasePool(items: ArchiveItem[]): ArchiveItem[] {
  const watching = items.filter((it) => it.status === 'watching');
  if (watching.length > 0) return watching;
  return items.filter((it) => it.status === 'watchlist');
}

export function resolvePrimaryShowcase(
  items: ArchiveItem[],
  rawConfig: ShowcaseConfig | undefined,
  todayKey: string,
  shuffleOffset = 0
): ResolvedPrimaryShowcase | null {
  const config = normalizeShowcaseConfig(rawConfig);

  if (config.primaryMode === 'custom') {
    const linkedItem = config.customLinkItemId
      ? items.find((it) => it.id === config.customLinkItemId) ?? null
      : null;
    const title = config.customTitle || linkedItem?.title || '我的私人光影展厅';
    const subtitle = config.customSubtitle || linkedItem?.originalTitle;
    const quote =
      config.customQuote ||
      linkedItem?.quote ||
      linkedItem?.notes ||
      '在这里定制你的当期主题展签、观影寄语或精选海报封面。';
    const coverUrl = config.customCoverUrl || linkedItem?.coverUrl;

    return {
      mode: 'custom',
      badgeText: config.customLabel || PRIMARY_MODE_META.custom.defaultBadge,
      item: linkedItem,
      title,
      subtitle,
      quote,
      coverUrl,
      category: linkedItem?.category ?? 'film',
      canShuffle: false,
      poolCount: 1,
      isCustomOnly: true,
    };
  }

  if (items.length === 0) return null;

  let chosen: ArchiveItem | null = null;
  let poolCount = items.length;
  let canShuffle = false;
  let fallbackHint: string | undefined;

  if (config.primaryMode === 'pinned') {
    const pinned = config.pinnedItemId
      ? items.find((it) => it.id === config.pinnedItemId) ?? null
      : null;
    if (pinned) {
      chosen = pinned;
      poolCount = 1;
      canShuffle = false;
    } else {
      chosen = pickDailySpotlightItem(items, todayKey, shuffleOffset);
      poolCount = items.length;
      canShuffle = items.length > 1;
      fallbackHint = '原置顶藏品已移除，已暂按每日藏签展示';
    }
  } else if (config.primaryMode === 'favorites') {
    const favPool = getFavoriteShowcasePool(items);
    if (favPool.length > 0) {
      chosen = pickDailySpotlightItem(favPool, todayKey, shuffleOffset);
      poolCount = favPool.length;
      canShuffle = favPool.length > 1;
    } else {
      chosen = pickDailySpotlightItem(items, todayKey, shuffleOffset);
      poolCount = items.length;
      canShuffle = items.length > 1;
      fallbackHint = '暂无挚爱或高分藏品，已自动从全馆挑选';
    }
  } else if (config.primaryMode === 'watching') {
    const watchPool = getWatchingShowcasePool(items);
    if (watchPool.length > 0) {
      chosen = pickDailySpotlightItem(watchPool, todayKey, shuffleOffset);
      poolCount = watchPool.length;
      canShuffle = watchPool.length > 1;
    } else {
      chosen = pickDailySpotlightItem(items, todayKey, shuffleOffset);
      poolCount = items.length;
      canShuffle = items.length > 1;
      fallbackHint = '暂无在追或想看条目，已自动从全馆挑选';
    }
  } else {
    chosen = pickDailySpotlightItem(items, todayKey, shuffleOffset);
    poolCount = items.length;
    canShuffle = items.length > 1;
  }

  if (!chosen) return null;

  const comp = computeItemCompleteness(chosen);
  const defaultBadge =
    config.primaryMode === 'watching' && chosen.status === 'watchlist'
      ? '待看片单'
      : PRIMARY_MODE_META[config.primaryMode].defaultBadge;

  const defaultQuote = chosen.quote
    ? `“${chosen.quote}”`
    : chosen.notes || comp.nextHint;

  return {
    mode: config.primaryMode,
    badgeText: config.customLabel || defaultBadge,
    item: chosen,
    title: chosen.title,
    subtitle: chosen.originalTitle,
    quote: config.customQuote || defaultQuote,
    coverUrl: chosen.coverUrl,
    category: chosen.category,
    canShuffle,
    poolCount,
    isCustomOnly: false,
    fallbackHint,
  };
}

export function getSecondaryFavorites(
  items: ArchiveItem[],
  limit = 6
): ArchiveItem[] {
  const ranked = [...items].sort((a, b) => {
    const aFav = a.status === 'favorite' ? 1 : 0;
    const bFav = b.status === 'favorite' ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    if (a.rating !== b.rating) return b.rating - a.rating;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const qualified = ranked.filter(
    (it) => it.status === 'favorite' || it.rating >= 4
  );
  return (qualified.length > 0 ? qualified : ranked).slice(0, limit);
}

export interface SecondaryQuoteEntry {
  item: ArchiveItem;
  text: string;
  isQuote: boolean;
}

export function getSecondaryQuotes(items: ArchiveItem[]): SecondaryQuoteEntry[] {
  const quoteEntries: SecondaryQuoteEntry[] = [];
  const noteEntries: SecondaryQuoteEntry[] = [];

  for (const item of items) {
    if (item.quote && item.quote.trim()) {
      quoteEntries.push({ item, text: item.quote.trim(), isQuote: true });
    } else if (item.notes && item.notes.trim()) {
      noteEntries.push({ item, text: item.notes.trim(), isQuote: false });
    }
  }

  return [...quoteEntries, ...noteEntries];
}

export function getSecondaryRecent(
  items: ArchiveItem[],
  limit = 4
): ArchiveItem[] {
  return [...items]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
