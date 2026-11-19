import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { computeItemCompleteness } from './collector';
import { isThematicTag } from './medals';

export type TimelineOrder = 'desc' | 'asc';

export interface TimelineDateParts {
  timestamp: number;
  year: number;
  month: number;
  day: number;
  monthKey: string;
  dateKey: string;
  monthLabel: string;
  shortMonthLabel: string;
  dayLabel: string;
  weekdayLabel: string;
  timeLabel: string;
  dotDateLabel: string;
}

export interface TimelineDayGroup {
  dateKey: string;
  dayLabel: string;
  weekdayLabel: string;
  items: ArchiveItem[];
}

export interface TimelineMonthGroup {
  monthKey: string;
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  totalCount: number;
  filmCount: number;
  personCount: number;
  characterCount: number;
  masterpieceCount: number;
  topTags: string[];
  days: TimelineDayGroup[];
  items: ArchiveItem[];
}

export interface TimelineJourneySummary {
  totalItems: number;
  totalMonths: number;
  firstCollectedDate: string | null;
  latestCollectedDate: string | null;
  journeySpanDays: number;
}

export interface TimelineResult {
  summary: TimelineJourneySummary;
  allMonths: TimelineMonthGroup[];
  visibleMonths: TimelineMonthGroup[];
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function extractTimelineDateParts(isoString?: string): TimelineDateParts {
  const parsed = isoString ? new Date(isoString) : new Date(0);
  const valid = !Number.isNaN(parsed.getTime());
  const d = valid ? parsed : new Date(0);

  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();

  const monthKey = `${year}-${pad2(month)}`;
  const dateKey = `${monthKey}-${pad2(day)}`;

  return {
    timestamp: d.getTime(),
    year,
    month,
    day,
    monthKey,
    dateKey,
    monthLabel: `${year}年${month}月`,
    shortMonthLabel: `${year}.${pad2(month)}`,
    dayLabel: `${month}月${day}日`,
    weekdayLabel: WEEKDAY_ZH[d.getDay()] ?? '',
    timeLabel: `${pad2(hours)}:${pad2(minutes)}`,
    dotDateLabel: `${year}.${pad2(month)}.${pad2(day)}`,
  };
}

function buildMonthGroup(
  monthKey: string,
  itemsInMonth: ArchiveItem[],
  order: TimelineOrder
): TimelineMonthGroup {
  const sorted = [...itemsInMonth].sort((a, b) => {
    const ta = extractTimelineDateParts(a.createdAt).timestamp;
    const tb = extractTimelineDateParts(b.createdAt).timestamp;
    if (ta !== tb) return order === 'desc' ? tb - ta : ta - tb;
    return order === 'desc'
      ? b.accessionNo.localeCompare(a.accessionNo)
      : a.accessionNo.localeCompare(b.accessionNo);
  });

  const sampleParts = extractTimelineDateParts(sorted[0]?.createdAt);

  let filmCount = 0;
  let personCount = 0;
  let characterCount = 0;
  let masterpieceCount = 0;
  const tagCounts = new Map<string, number>();

  const dayMap = new Map<string, TimelineDayGroup>();

  for (const item of sorted) {
    if (item.category === 'film') filmCount += 1;
    else if (item.category === 'person') personCount += 1;
    else if (item.category === 'character') characterCount += 1;

    if (computeItemCompleteness(item).tier === 'masterpiece') {
      masterpieceCount += 1;
    }

    for (const tag of item.tags) {
      if (!isThematicTag(tag)) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    const parts = extractTimelineDateParts(item.createdAt);
    let dayGroup = dayMap.get(parts.dateKey);
    if (!dayGroup) {
      dayGroup = {
        dateKey: parts.dateKey,
        dayLabel: parts.dayLabel,
        weekdayLabel: parts.weekdayLabel,
        items: [],
      };
      dayMap.set(parts.dateKey, dayGroup);
    }
    dayGroup.items.push(item);
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 3)
    .map(([tag]) => tag);

  return {
    monthKey,
    year: sampleParts.year,
    month: sampleParts.month,
    label: sampleParts.monthLabel,
    shortLabel: sampleParts.shortMonthLabel,
    totalCount: sorted.length,
    filmCount,
    personCount,
    characterCount,
    masterpieceCount,
    topTags,
    days: Array.from(dayMap.values()),
    items: sorted,
  };
}

export function buildTimelineGroups(
  items: ArchiveItem[],
  options: {
    order?: TimelineOrder;
    monthKey?: string;
    category?: 'all' | ArchiveCategory;
  } = {}
): TimelineResult {
  const order: TimelineOrder = options.order ?? 'desc';
  const selectedMonthKey = options.monthKey ?? '';
  const selectedCategory = options.category ?? 'all';

  if (items.length === 0) {
    return {
      summary: {
        totalItems: 0,
        totalMonths: 0,
        firstCollectedDate: null,
        latestCollectedDate: null,
        journeySpanDays: 0,
      },
      allMonths: [],
      visibleMonths: [],
    };
  }

  // Group ALL items by month first so the monthly review selector always lists all months
  const allByMonth = new Map<string, ArchiveItem[]>();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let firstDate: string | null = null;
  let latestDate: string | null = null;

  for (const item of items) {
    const parts = extractTimelineDateParts(item.createdAt);
    if (parts.timestamp < minTs) {
      minTs = parts.timestamp;
      firstDate = parts.dotDateLabel;
    }
    if (parts.timestamp > maxTs) {
      maxTs = parts.timestamp;
      latestDate = parts.dotDateLabel;
    }
    const bucket = allByMonth.get(parts.monthKey) ?? [];
    bucket.push(item);
    allByMonth.set(parts.monthKey, bucket);
  }

  const sortedAllMonthKeys = Array.from(allByMonth.keys()).sort((a, b) =>
    order === 'desc' ? b.localeCompare(a) : a.localeCompare(b)
  );
  const allMonths = sortedAllMonthKeys.map((mk) =>
    buildMonthGroup(mk, allByMonth.get(mk) ?? [], order)
  );

  // Filter items for visible timeline display
  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'all' && item.category !== selectedCategory) {
      return false;
    }
    if (selectedMonthKey) {
      const mk = extractTimelineDateParts(item.createdAt).monthKey;
      if (mk !== selectedMonthKey) return false;
    }
    return true;
  });

  const visibleByMonth = new Map<string, ArchiveItem[]>();
  for (const item of filteredItems) {
    const mk = extractTimelineDateParts(item.createdAt).monthKey;
    const bucket = visibleByMonth.get(mk) ?? [];
    bucket.push(item);
    visibleByMonth.set(mk, bucket);
  }

  const sortedVisibleMonthKeys = Array.from(visibleByMonth.keys()).sort(
    (a, b) => (order === 'desc' ? b.localeCompare(a) : a.localeCompare(b))
  );
  const visibleMonths = sortedVisibleMonthKeys.map((mk) =>
    buildMonthGroup(mk, visibleByMonth.get(mk) ?? [], order)
  );

  const daySpanMs = Math.max(0, maxTs - minTs);
  const journeySpanDays = Math.floor(daySpanMs / (1000 * 60 * 60 * 24)) + 1;

  return {
    summary: {
      totalItems: items.length,
      totalMonths: allMonths.length,
      firstCollectedDate: firstDate,
      latestCollectedDate: latestDate,
      journeySpanDays,
    },
    allMonths,
    visibleMonths,
  };
}
