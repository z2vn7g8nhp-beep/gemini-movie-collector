import type {
  ArchiveItem,
  CollectorAlbum,
  CollectorState,
} from '../types/archive';
import { hasDossierDetails } from './characterProfile';
import { collectTagRegistry, itemHasTag } from './tags';

export type ArchivalTier = 'standard' | 'curated' | 'masterpiece';

export interface ItemCompleteness {
  score: number;
  maxScore: number;
  percent: number;
  tier: ArchivalTier;
  tierLabel: string;
  criteria: {
    cover: boolean;
    rating: boolean;
    story: boolean;
    tags: boolean;
    depth: boolean;
  };
  missingLabels: string[];
  nextHint: string;
}

export interface CheckInStats {
  currentStreak: number;
  longestStreak: number;
  checkedInToday: boolean;
  totalDays: number;
}

export interface CalendarDayCell {
  dateKey: string;
  dayNum: number;
  isToday: boolean;
  checked: boolean;
}

export interface CollectorRankInfo {
  level: number;
  title: string;
  points: number;
  nextLevelPoints: number | null;
  progressPercent: number;
  masterpieceCount: number;
  linkPairCount: number;
}

export interface CollectorStamp {
  id: string;
  title: string;
  desc: string;
  unlocked: boolean;
  current: number;
  target: number;
  tone: 'vermilion' | 'gold';
}

export function formatLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return formatLocalDateKey(dt);
}

export function recordCheckIn(
  existingDates: string[],
  todayKey: string
): { dates: string[]; added: boolean } {
  const set = new Set(
    existingDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  );
  if (set.has(todayKey)) {
    return { dates: Array.from(set).sort(), added: false };
  }
  set.add(todayKey);
  return { dates: Array.from(set).sort(), added: true };
}

export function computeCheckInStreak(
  existingDates: string[],
  todayKey: string
): CheckInStats {
  const unique = Array.from(
    new Set(existingDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
  ).sort();
  const dateSet = new Set(unique);
  const checkedInToday = dateSet.has(todayKey);

  // Current streak counts back from today (if checked in today) or yesterday (if streak still alive)
  let currentStreak = 0;
  let cursor = checkedInToday ? todayKey : shiftDateKey(todayKey, -1);
  while (dateSet.has(cursor)) {
    currentStreak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  // Longest streak across all recorded dates
  let longestStreak = 0;
  let running = 0;
  let prev = '';
  for (const d of unique) {
    if (prev && shiftDateKey(prev, 1) === d) {
      running += 1;
    } else {
      running = 1;
    }
    if (running > longestStreak) longestStreak = running;
    prev = d;
  }

  return {
    currentStreak,
    longestStreak,
    checkedInToday,
    totalDays: unique.length,
  };
}

export function getRecentCalendarDays(
  existingDates: string[],
  todayKey: string,
  days = 14
): CalendarDayCell[] {
  const dateSet = new Set(existingDates);
  const cells: CalendarDayCell[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = shiftDateKey(todayKey, -i);
    const dayNum = Number.parseInt(key.slice(8, 10), 10) || 1;
    cells.push({
      dateKey: key,
      dayNum,
      isToday: i === 0,
      checked: dateSet.has(key),
    });
  }
  return cells;
}

export function computeItemCompleteness(item: ArchiveItem): ItemCompleteness {
  const hasCover = Boolean(item.coverUrl && item.coverUrl.trim().length > 0);
  const hasRating = item.rating > 0;
  const hasStory = Boolean(
    (item.quote && item.quote.trim().length > 0) ||
      (item.notes && item.notes.trim().length > 0)
  );
  const hasTags = item.tags.length >= 2;
  const hasDepth =
    item.relatedIds.length > 0 ||
    (item.category === 'character' && hasDossierDetails(item.characterProfile));

  const score =
    (hasCover ? 1 : 0) +
    (hasRating ? 1 : 0) +
    (hasStory ? 1 : 0) +
    (hasTags ? 1 : 0) +
    (hasDepth ? 1 : 0);

  const missingLabels: string[] = [];
  if (!hasRating) missingLabels.push('星级评分');
  if (!hasStory) missingLabels.push('台词或手记');
  if (!hasTags) missingLabels.push('至少 2 个标签');
  if (!hasDepth) {
    missingLabels.push(
      item.category === 'character' ? '角色设定或关联' : '关联影人/角色'
    );
  }
  if (!hasCover) missingLabels.push('封面剧照');

  let tier: ArchivalTier = 'standard';
  let tierLabel = '初录';
  if (
    score === 5 ||
    (item.status === 'favorite' && item.rating === 5 && score >= 4)
  ) {
    tier = 'masterpiece';
    tierLabel = '典藏';
  } else if (score >= 3) {
    tier = 'curated';
    tierLabel = '精编';
  }

  let nextHint = '已达满格「典藏级」档案';
  if (tier !== 'masterpiece' && missingLabels.length > 0) {
    nextHint = `补齐「${missingLabels[0]}」可提升藏品成色`;
  }

  return {
    score,
    maxScore: 5,
    percent: Math.round((score / 5) * 100),
    tier,
    tierLabel,
    criteria: {
      cover: hasCover,
      rating: hasRating,
      story: hasStory,
      tags: hasTags,
      depth: hasDepth,
    },
    missingLabels,
    nextHint,
  };
}

export function pickDailySpotlightItem(
  items: ArchiveItem[],
  todayKey: string,
  offset = 0
): ArchiveItem | null {
  if (items.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < todayKey.length; i += 1) {
    hash = (hash * 31 + todayKey.charCodeAt(i)) >>> 0;
  }
  const safeOffset = ((offset % items.length) + items.length) % items.length;
  const idx = (hash + safeOffset) % items.length;
  return items[idx] ?? items[0];
}

export function pickRandomEncounterItem(
  items: ArchiveItem[],
  excludeId?: string,
  rng: () => number = Math.random
): ArchiveItem | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];

  const pool = excludeId
    ? items.filter((item) => item.id !== excludeId)
    : items;
  const candidates = pool.length > 0 ? pool : items;
  const raw = rng();
  const clamped = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  const idx = Math.floor(clamped * candidates.length);
  return candidates[idx] ?? candidates[0];
}

export function resolveAlbumItems(
  album: CollectorAlbum,
  items: ArchiveItem[]
): ArchiveItem[] {
  const idSet = new Set(album.itemIds || []);
  return items.filter((item) => {
    if (idSet.has(item.id)) return true;
    if (album.tag && itemHasTag(item, album.tag)) return true;
    return false;
  });
}

export interface AlbumProgress {
  matchedItems: ArchiveItem[];
  filledCount: number;
  targetCount: number;
  remainingCount: number;
  percent: number;
  isComplete: boolean;
}

export function computeAlbumProgress(
  album: CollectorAlbum,
  items: ArchiveItem[]
): AlbumProgress {
  const matchedItems = resolveAlbumItems(album, items);
  const filledCount = matchedItems.length;
  const targetCount = Math.max(1, Math.round(Number(album.targetCount) || 0));
  const percent = Math.min(
    100,
    Math.max(0, Math.round((filledCount / targetCount) * 100))
  );
  const isComplete = filledCount >= targetCount;
  const remainingCount = Math.max(0, targetCount - filledCount);

  return {
    matchedItems,
    filledCount,
    targetCount,
    remainingCount,
    percent,
    isComplete,
  };
}

function countUniqueLinkPairs(items: ArchiveItem[]): number {
  const pairs = new Set<string>();
  const existingIds = new Set(items.map((i) => i.id));
  for (const item of items) {
    for (const rid of item.relatedIds) {
      if (!existingIds.has(rid) || rid === item.id) continue;
      const key = item.id < rid ? `${item.id}::${rid}` : `${rid}::${item.id}`;
      pairs.add(key);
    }
  }
  return pairs.size;
}

const RANK_TIERS = [
  { level: 1, title: '见习影迷', minPoints: 0 },
  { level: 2, title: '胶片拾荒者', minPoints: 120 },
  { level: 3, title: '角色收藏家', minPoints: 300 },
  { level: 4, title: '光影策展人', minPoints: 600 },
  { level: 5, title: '典藏馆主', minPoints: 1100 },
  { level: 6, title: '传世档案官', minPoints: 2000 },
];

export function buildCollectorRank(
  items: ArchiveItem[],
  collector: CollectorState
): CollectorRankInfo {
  let completenessSum = 0;
  let masterpieceCount = 0;

  for (const item of items) {
    const comp = computeItemCompleteness(item);
    completenessSum += comp.score;
    if (comp.tier === 'masterpiece') {
      masterpieceCount += 1;
    }
  }

  const linkPairCount = countUniqueLinkPairs(items);
  const points =
    items.length * 20 +
    completenessSum * 6 +
    linkPairCount * 10 +
    collector.checkInDates.length * 10 +
    collector.albums.length * 15;

  let tierIndex = 0;
  for (let i = 0; i < RANK_TIERS.length; i += 1) {
    if (points >= RANK_TIERS[i].minPoints) {
      tierIndex = i;
    }
  }

  const currentTier = RANK_TIERS[tierIndex];
  const nextTier = RANK_TIERS[tierIndex + 1] ?? null;

  const progressPercent = nextTier
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((points - currentTier.minPoints) /
              (nextTier.minPoints - currentTier.minPoints)) *
              100
          )
        )
      )
    : 100;

  return {
    level: currentTier.level,
    title: currentTier.title,
    points,
    nextLevelPoints: nextTier ? nextTier.minPoints : null,
    progressPercent,
    masterpieceCount,
    linkPairCount,
  };
}

export function computeCollectorStamps(
  items: ArchiveItem[],
  collector: CollectorState,
  todayKey: string
): CollectorStamp[] {
  const filmCount = items.filter((i) => i.category === 'film').length;
  const personCount = items.filter((i) => i.category === 'person').length;
  const charItems = items.filter((i) => i.category === 'character');
  const categoriesCovered =
    (filmCount > 0 ? 1 : 0) +
    (personCount > 0 ? 1 : 0) +
    (charItems.length > 0 ? 1 : 0);

  const linkPairs = countUniqueLinkPairs(items);
  const favOrFiveCount = items.filter(
    (i) => i.status === 'favorite' || i.rating === 5
  ).length;
  const storyCount = items.filter(
    (i) =>
      Boolean(i.quote && i.quote.trim()) || Boolean(i.notes && i.notes.trim())
  ).length;
  const uniqueTags = collectTagRegistry(items).length;
  const masterpieceCount = items.filter(
    (i) => computeItemCompleteness(i).tier === 'masterpiece'
  ).length;
  const richCharCount = charItems.filter((i) =>
    hasDossierDetails(i.characterProfile)
  ).length;
  const streak = computeCheckInStreak(collector.checkInDates, todayKey);

  return [
    {
      id: 'first-entry',
      title: '首件入藏',
      desc: '收录第 1 件影视、影人或角色',
      unlocked: items.length >= 1,
      current: Math.min(items.length, 1),
      target: 1,
      tone: 'vermilion',
    },
    {
      id: 'first-link',
      title: '光影羁绊',
      desc: '建立第 1 组影视与影人/角色关联',
      unlocked: linkPairs >= 1,
      current: Math.min(linkPairs, 1),
      target: 1,
      tone: 'vermilion',
    },
    {
      id: 'trinity',
      title: '三界齐聚',
      desc: '同时收藏影视、影人、角色三类',
      unlocked: categoriesCovered >= 3,
      current: categoriesCovered,
      target: 3,
      tone: 'gold',
    },
    {
      id: 'five-star',
      title: '五星挚爱',
      desc: '评出 5 星或标记 1 件挚爱藏品',
      unlocked: favOrFiveCount >= 1,
      current: Math.min(favOrFiveCount, 1),
      target: 1,
      tone: 'gold',
    },
    {
      id: 'quote-keeper',
      title: '金句摘录',
      desc: '写下第 1 条经典台词或手记',
      unlocked: storyCount >= 1,
      current: Math.min(storyCount, 1),
      target: 1,
      tone: 'vermilion',
    },
    {
      id: 'tag-curator',
      title: '标签策展',
      desc: '馆内累计沉淀 5 个以上不同标签',
      unlocked: uniqueTags >= 5,
      current: Math.min(uniqueTags, 5),
      target: 5,
      tone: 'vermilion',
    },
    {
      id: 'masterpiece',
      title: '典藏打磨',
      desc: '将任意 1 件档案完善至 5/5 典藏级',
      unlocked: masterpieceCount >= 1,
      current: Math.min(masterpieceCount, 1),
      target: 1,
      tone: 'gold',
    },
    {
      id: 'album-maker',
      title: '图鉴开卷',
      desc: '创建第 1 本自定义专题图鉴册',
      unlocked: collector.albums.length >= 1,
      current: Math.min(collector.albums.length, 1),
      target: 1,
      tone: 'vermilion',
    },
    {
      id: 'ten-items',
      title: '十全藏馆',
      desc: '个人馆藏总数达到 10 件',
      unlocked: items.length >= 10,
      current: Math.min(items.length, 10),
      target: 10,
      tone: 'gold',
    },
    {
      id: 'character-lore',
      title: '角色博物',
      desc: '完善 3 位角色的深度设定档案',
      unlocked: richCharCount >= 3,
      current: Math.min(richCharCount, 3),
      target: 3,
      tone: 'vermilion',
    },
    {
      id: 'streak-3',
      title: '连日巡馆',
      desc: '连续 3 天打开藏馆打卡巡览',
      unlocked: streak.longestStreak >= 3,
      current: Math.min(streak.longestStreak, 3),
      target: 3,
      tone: 'gold',
    },
    {
      id: 'universe-web',
      title: '宇宙织网',
      desc: '累计建立 5 组跨实体双向关联',
      unlocked: linkPairs >= 5,
      current: Math.min(linkPairs, 5),
      target: 5,
      tone: 'gold',
    },
  ];
}
