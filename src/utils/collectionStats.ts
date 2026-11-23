import type { ArchiveCategory, ArchiveItem } from '../types/archive';

export interface CategorySliceDatum {
  key: ArchiveCategory;
  label: string;
  count: number;
  percent: number;
  color: string;
}

export interface CategoryDistributionSummary {
  total: number;
  segments: CategorySliceDatum[];
  activeSegments: CategorySliceDatum[];
  dominantCategory: ArchiveCategory | null;
  coveredCategoryCount: number;
  achievementHint: string;
}

export const CATEGORY_CHART_META: ReadonlyArray<{
  key: ArchiveCategory;
  label: string;
  color: string;
}> = [
  { key: 'film', label: '影视', color: '#B43B2B' },
  { key: 'person', label: '影人', color: '#C9A45C' },
  { key: 'character', label: '角色', color: '#4E7A6A' },
];

/**
 * Computes largest-remainder integer percentages so non-empty category shares
 * always sum cleanly to 100%.
 */
function computeBalancedPercentages(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);

  const exact = counts.map((count) => (count / total) * 100);
  const floored = exact.map((val) => Math.floor(val));
  let remainder = 100 - floored.reduce((sum, n) => sum + n, 0);

  const rankedIndices = exact
    .map((val, idx) => ({ idx, frac: val - floored[idx], count: counts[idx] }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return b.count - a.count;
    });

  for (const entry of rankedIndices) {
    if (remainder <= 0) break;
    if (entry.count > 0) {
      floored[entry.idx] += 1;
      remainder -= 1;
    }
  }

  return floored;
}

export function buildCategoryDistribution(
  items: ArchiveItem[]
): CategoryDistributionSummary {
  const countsMap: Record<ArchiveCategory, number> = {
    film: 0,
    person: 0,
    character: 0,
  };

  for (const item of items) {
    if (item.category === 'film' || item.category === 'person' || item.category === 'character') {
      countsMap[item.category] += 1;
    }
  }

  const orderedCounts = CATEGORY_CHART_META.map((meta) => countsMap[meta.key]);
  const total = orderedCounts.reduce((sum, n) => sum + n, 0);
  const percentages = computeBalancedPercentages(orderedCounts, total);

  const segments: CategorySliceDatum[] = CATEGORY_CHART_META.map((meta, idx) => ({
    key: meta.key,
    label: meta.label,
    count: orderedCounts[idx],
    percent: percentages[idx],
    color: meta.color,
  }));

  const activeSegments = segments.filter((seg) => seg.count > 0);
  const coveredCategoryCount = activeSegments.length;

  let dominantCategory: ArchiveCategory | null = null;
  let maxCount = 0;
  for (const seg of segments) {
    if (seg.count > maxCount) {
      maxCount = seg.count;
      dominantCategory = seg.key;
    }
  }

  let achievementHint = '收录首件藏品后自动点亮馆藏比例';
  if (total > 0) {
    if (coveredCategoryCount === 3) {
      achievementHint =
        total >= 10
          ? '三类齐备 · 典藏脉络丰盈'
          : '三类齐备 · 立体光影档案';
    } else if (coveredCategoryCount === 2) {
      const missing = segments.find((seg) => seg.count === 0);
      achievementHint = missing
        ? `再收录 1 件${missing.label}即可点亮三类全图谱`
        : '馆藏维度持续拓展中';
    } else if (dominantCategory === 'film') {
      achievementHint = '影视主轴已立 · 可关联影人与角色';
    } else if (dominantCategory === 'person') {
      achievementHint = '影人档案已立 · 可补充代表作品';
    } else {
      achievementHint = '角色小传已立 · 可关联出处影片';
    }
  }

  return {
    total,
    segments,
    activeSegments,
    dominantCategory,
    coveredCategoryCount,
    achievementHint,
  };
}
