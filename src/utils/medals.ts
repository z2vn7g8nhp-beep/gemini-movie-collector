import type { ArchiveItem } from '../types/archive';
import { getRelatedItems } from './archive';
import { computeItemCompleteness } from './collector';
import { collectTagRegistry, itemHasTag, normalizeTagName } from './tags';

export type MedalCategory = 'type' | 'tag' | 'relation';
export type MedalTier = 'locked' | 'bronze' | 'silver' | 'gold' | 'crimson';
export type MedalMotif =
  | 'reel'
  | 'laurel'
  | 'mask'
  | 'trinity'
  | 'compass'
  | 'crest'
  | 'shield'
  | 'seal'
  | 'link'
  | 'nexus'
  | 'triangle'
  | 'crown';

export interface MedalTierStop {
  tier: Exclude<MedalTier, 'locked'>;
  label: string;
  threshold: number;
}

export interface CinemaMedal {
  id: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  description: string;
  category: MedalCategory;
  motif: MedalMotif;
  tier: MedalTier;
  tierLabel: string;
  unlocked: boolean;
  current: number;
  target: number;
  nextTarget: number | null;
  tiers: MedalTierStop[];
  isDynamicTag?: boolean;
  tagName?: string;
  monogram?: string;
}

export interface ItemMedalShowcaseData {
  earnedMedals: CinemaMedal[];
  nextMedal: {
    medal: CinemaMedal;
    hint: string;
  } | null;
}

export const MEDAL_TIER_LABELS: Record<MedalTier, string> = {
  locked: '未点亮',
  bronze: '青铜',
  silver: '曜银',
  gold: '鎏金',
  crimson: '朱漆御章',
};

export const MEDAL_TIER_RANK: Record<MedalTier, number> = {
  locked: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
  crimson: 4,
};

export const MEDAL_CATEGORY_LABELS: Record<MedalCategory, string> = {
  type: '类型',
  tag: '标签',
  relation: '关联',
};

const GENERIC_NON_THEMATIC_TAGS = new Set([
  '电影',
  '电视剧',
  '剧集',
  '影视',
  '动画',
  '动漫',
  '纪录片',
  '演员',
  '导演',
  '编剧',
  '影人',
  '配音',
  '角色',
  '人物',
]);

export function isThematicTag(tag: string): boolean {
  const clean = normalizeTagName(tag);
  if (!clean) return false;
  if (/^\d{4}$/.test(clean)) return false;
  if (GENERIC_NON_THEMATIC_TAGS.has(clean)) return false;
  return true;
}

function evaluateTier(
  current: number,
  tiers: MedalTierStop[]
): {
  tier: MedalTier;
  unlocked: boolean;
  target: number;
  nextTarget: number | null;
} {
  let achieved: MedalTier = 'locked';
  let nextTarget: number | null = null;

  for (const stop of tiers) {
    if (current >= stop.threshold) {
      achieved = stop.tier;
    } else if (nextTarget === null) {
      nextTarget = stop.threshold;
    }
  }

  const firstTarget = tiers[0]?.threshold ?? 1;
  return {
    tier: achieved,
    unlocked: achieved !== 'locked',
    target: nextTarget ?? tiers[tiers.length - 1]?.threshold ?? firstTarget,
    nextTarget,
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

function getItemDegree(item: ArchiveItem, allItems: ArchiveItem[]): number {
  return getRelatedItems(item, allItems).length;
}

/**
 * Counts how many films in the collection are linked to BOTH at least 1 person AND at least 1 character
 * (forming a complete Film ↔ Person × Character archival triangle).
 */
export function findTriangleFilmIds(items: ArchiveItem[]): Set<string> {
  const triangleIds = new Set<string>();
  for (const item of items) {
    if (item.category !== 'film') continue;
    const rels = getRelatedItems(item, items);
    const hasPerson = rels.some((r) => r.category === 'person');
    const hasCharacter = rels.some((r) => r.category === 'character');
    if (hasPerson && hasCharacter) {
      triangleIds.add(item.id);
    }
  }
  return triangleIds;
}

function itemBelongsToTriangle(
  item: ArchiveItem,
  allItems: ArchiveItem[],
  triangleFilmIds: Set<string>
): boolean {
  if (triangleFilmIds.size === 0) return false;
  if (item.category === 'film') {
    return triangleFilmIds.has(item.id);
  }
  const rels = getRelatedItems(item, allItems);
  return rels.some(
    (r) => r.category === 'film' && triangleFilmIds.has(r.id)
  );
}

function makeMedal(
  base: Omit<
    CinemaMedal,
    'tier' | 'tierLabel' | 'unlocked' | 'target' | 'nextTarget'
  >
): CinemaMedal {
  const res = evaluateTier(base.current, base.tiers);
  return {
    ...base,
    tier: res.tier,
    tierLabel: MEDAL_TIER_LABELS[res.tier],
    unlocked: res.unlocked,
    target: res.target,
    nextTarget: res.nextTarget,
  };
}

/**
 * Dynamically mints signature tag medals for the user's top thematic tags
 * once a thematic tag gathers >= 2 items in the collection.
 */
export function computeDynamicTagMedals(items: ArchiveItem[]): CinemaMedal[] {
  const registry = collectTagRegistry(items).filter((entry) =>
    isThematicTag(entry.name)
  );

  const qualifying = registry.filter((entry) => entry.count >= 2).slice(0, 6);

  return qualifying.map((entry) => {
    const monogram = Array.from(entry.name).slice(0, 2).join('');
    const shortTitle =
      entry.name.length > 4 ? `${entry.name.slice(0, 4)}章` : `${entry.name}专题`;

    return makeMedal({
      id: `dynamic-tag-${entry.name}`,
      title: `「${entry.name}」专题徽章`,
      shortTitle,
      subtitle: `同一主题集齐 ${entry.count} 件藏品`,
      description: `在「${entry.name}」标签下持续收集影视、影人与角色，打造专属系列殿堂。`,
      category: 'tag',
      motif: 'shield',
      current: entry.count,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 2 },
        { tier: 'silver', label: '曜银', threshold: 4 },
        { tier: 'gold', label: '鎏金', threshold: 6 },
        { tier: 'crimson', label: '朱漆御章', threshold: 10 },
      ],
      isDynamicTag: true,
      tagName: entry.name,
      monogram,
    });
  });
}

export function computeCinemaMedals(items: ArchiveItem[]): CinemaMedal[] {
  const filmCount = items.filter((i) => i.category === 'film').length;
  const personCount = items.filter((i) => i.category === 'person').length;
  const characterCount = items.filter((i) => i.category === 'character').length;
  const minCategoryCount = Math.min(filmCount, personCount, characterCount);

  const allTagEntries = collectTagRegistry(items);
  const uniqueTagCount = allTagEntries.length;
  const thematicEntries = allTagEntries.filter((e) => isThematicTag(e.name));
  const topThematic = thematicEntries[0] ?? null;
  const topThematicCount = topThematic?.count ?? 0;

  const richTagItemCount = items.filter((i) => i.tags.length >= 3).length;

  const linkPairs = countUniqueLinkPairs(items);
  let maxSingleLinks = 0;
  for (const item of items) {
    const deg = getItemDegree(item, items);
    if (deg > maxSingleLinks) maxSingleLinks = deg;
  }

  const triangleFilmIds = findTriangleFilmIds(items);
  const triangleCount = triangleFilmIds.size;

  const masterpieceCount = items.filter(
    (i) => computeItemCompleteness(i).tier === 'masterpiece'
  ).length;

  const coreMedals: CinemaMedal[] = [
    // === TYPE MEDALS ===
    makeMedal({
      id: 'type-film',
      title: '银幕映记',
      shortTitle: '银幕映记',
      subtitle: `已收录 ${filmCount} 部影视作品`,
      description: '收录电影、剧集或动画佳作，随藏片增多晋升青铜、曜银、鎏金与朱漆御章。',
      category: 'type',
      motif: 'reel',
      current: filmCount,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 1 },
        { tier: 'silver', label: '曜银', threshold: 5 },
        { tier: 'gold', label: '鎏金', threshold: 12 },
        { tier: 'crimson', label: '朱漆御章', threshold: 25 },
      ],
    }),
    makeMedal({
      id: 'type-person',
      title: '星光名录',
      shortTitle: '星光名录',
      subtitle: `已收录 ${personCount} 位影人档案`,
      description: '典藏喜爱的导演、演员与幕后创作者，镌刻专属影人星光名录。',
      category: 'type',
      motif: 'laurel',
      current: personCount,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 1 },
        { tier: 'silver', label: '曜银', threshold: 5 },
        { tier: 'gold', label: '鎏金', threshold: 12 },
        { tier: 'crimson', label: '朱漆御章', threshold: 25 },
      ],
    }),
    makeMedal({
      id: 'type-character',
      title: '众生相谱',
      shortTitle: '众生相谱',
      subtitle: `已收录 ${characterCount} 位角色图鉴`,
      description: '为难忘的银幕角色立传建档，积累属于自己的角色众生相谱。',
      category: 'type',
      motif: 'mask',
      current: characterCount,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 1 },
        { tier: 'silver', label: '曜银', threshold: 5 },
        { tier: 'gold', label: '鎏金', threshold: 12 },
        { tier: 'crimson', label: '朱漆御章', threshold: 25 },
      ],
    }),
    makeMedal({
      id: 'type-trinity',
      title: '三界同辉',
      shortTitle: '三界同辉',
      subtitle:
        minCategoryCount >= 1
          ? `影视·影人·角色各达 ${minCategoryCount} 件以上`
          : `三类集齐度 ${
              (filmCount > 0 ? 1 : 0) +
              (personCount > 0 ? 1 : 0) +
              (characterCount > 0 ? 1 : 0)
            }/3`,
      description: '同时收藏影视、影人与角色三大门类，每类均达到门槛即可点亮并晋阶。',
      category: 'type',
      motif: 'trinity',
      current: minCategoryCount,
      tiers: [
        { tier: 'gold', label: '鎏金', threshold: 1 },
        { tier: 'crimson', label: '朱漆御章', threshold: 3 },
      ],
    }),

    // === TAG MEDALS ===
    makeMedal({
      id: 'tag-constellation',
      title: '百签星图',
      shortTitle: '百签星图',
      subtitle: `已沉淀 ${uniqueTagCount} 个独立标签`,
      description: '用精准的题材、系列与风格标签编织个人藏馆检索星图。',
      category: 'tag',
      motif: 'compass',
      current: uniqueTagCount,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 3 },
        { tier: 'silver', label: '曜银', threshold: 8 },
        { tier: 'gold', label: '鎏金', threshold: 16 },
        { tier: 'crimson', label: '朱漆御章', threshold: 30 },
      ],
    }),
    makeMedal({
      id: 'tag-universe',
      title: '专题宇宙',
      shortTitle: '专题宇宙',
      subtitle: topThematic
        ? `最高专题「${topThematic.name}」${topThematic.count} 件`
        : '同一主题标签集齐 2 件即可点亮',
      description: '围绕同一系列或风格主题标签（如漫威、赛博朋克、吉卜力）持续收集，构筑专题宇宙。',
      category: 'tag',
      motif: 'crest',
      current: topThematicCount,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 2 },
        { tier: 'silver', label: '曜银', threshold: 4 },
        { tier: 'gold', label: '鎏金', threshold: 8 },
        { tier: 'crimson', label: '朱漆御章', threshold: 15 },
      ],
      tagName: topThematic?.name,
    }),
    makeMedal({
      id: 'tag-curator',
      title: '策展金印',
      shortTitle: '策展金印',
      subtitle: `${richTagItemCount} 件藏品拥有 ≥3 个标签`,
      description: '为藏品细致归类 3 个以上标签，彰显专业策展人的归档眼光。',
      category: 'tag',
      motif: 'seal',
      current: richTagItemCount,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 1 },
        { tier: 'silver', label: '曜银', threshold: 3 },
        { tier: 'gold', label: '鎏金', threshold: 8 },
        { tier: 'crimson', label: '朱漆御章', threshold: 15 },
      ],
    }),

    // === RELATION MEDALS ===
    makeMedal({
      id: 'rel-bond',
      title: '初结羁绊',
      shortTitle: '初结羁绊',
      subtitle: `馆内已建立 ${linkPairs} 组跨实体关联`,
      description: '将影视、影人与角色彼此相连，让孤立条目汇成脉络清晰的光影图谱。',
      category: 'relation',
      motif: 'link',
      current: linkPairs,
      tiers: [
        { tier: 'bronze', label: '青铜', threshold: 1 },
        { tier: 'silver', label: '曜银', threshold: 3 },
        { tier: 'gold', label: '鎏金', threshold: 8 },
        { tier: 'crimson', label: '朱漆御章', threshold: 15 },
      ],
    }),
    makeMedal({
      id: 'rel-nexus',
      title: '核心枢纽',
      shortTitle: '核心枢纽',
      subtitle: `单件藏品最高关联 ${maxSingleLinks} 项`,
      description: '单件影视、影人或角色同时关联 2 件以上馆藏，成为馆内核心引力节点。',
      category: 'relation',
      motif: 'nexus',
      current: maxSingleLinks,
      tiers: [
        { tier: 'silver', label: '曜银', threshold: 2 },
        { tier: 'gold', label: '鎏金', threshold: 4 },
        { tier: 'crimson', label: '朱漆御章', threshold: 8 },
      ],
    }),
    makeMedal({
      id: 'rel-triangle',
      title: '铁三角档案',
      shortTitle: '铁三角档案',
      subtitle: `已串联 ${triangleCount} 组影视×影人×角色`,
      description: '同一部影视作品同时关联起对应影人与登场角色，达成黄金三角闭环收藏。',
      category: 'relation',
      motif: 'triangle',
      current: triangleCount,
      tiers: [
        { tier: 'gold', label: '鎏金', threshold: 1 },
        { tier: 'crimson', label: '朱漆御章', threshold: 3 },
      ],
    }),
    makeMedal({
      id: 'rel-masterpiece',
      title: '传世典藏',
      shortTitle: '传世典藏',
      subtitle: `${masterpieceCount} 件藏品达成满格典藏`,
      description: '补齐封面、评分、手记、标签与关联设定，将心爱条目打磨至典藏级。',
      category: 'relation',
      motif: 'crown',
      current: masterpieceCount,
      tiers: [
        { tier: 'gold', label: '鎏金', threshold: 1 },
        { tier: 'crimson', label: '朱漆御章', threshold: 3 },
      ],
    }),
  ];

  const dynamicTagMedals = computeDynamicTagMedals(items);
  return [...coreMedals, ...dynamicTagMedals];
}

/**
 * Resolves the specific medals earned by (or directly associated with) a single detail item,
 * plus the closest next medal the user can unlock by curating this item!
 */
export function computeItemDisplayMedals(
  item: ArchiveItem,
  allItems: ArchiveItem[]
): ItemMedalShowcaseData {
  const allMedals = computeCinemaMedals(allItems);
  const byId = new Map(allMedals.map((m) => [m.id, m]));

  const relatedCount = getItemDegree(item, allItems);
  const completeness = computeItemCompleteness(item);
  const triangleFilmIds = findTriangleFilmIds(allItems);
  const inTriangle = itemBelongsToTriangle(item, allItems, triangleFilmIds);

  const earned: CinemaMedal[] = [];
  const pushIfUnlocked = (medal?: CinemaMedal) => {
    if (medal && medal.unlocked && !earned.some((m) => m.id === medal.id)) {
      earned.push(medal);
    }
  };

  // 1. Masterpiece crown if THIS item is masterpiece
  if (completeness.tier === 'masterpiece') {
    pushIfUnlocked(byId.get('rel-masterpiece'));
  }

  // 2. Triangle archive if THIS item participates in a Film <-> Person + Character triangle
  if (inTriangle) {
    pushIfUnlocked(byId.get('rel-triangle'));
  }

  // 3. Nexus hub if THIS item itself has >= 2 links
  if (relatedCount >= 2) {
    const nexusBase = byId.get('rel-nexus');
    if (nexusBase && nexusBase.unlocked) {
      const itemNexus = makeMedal({
        ...nexusBase,
        subtitle: `本条目已关联 ${relatedCount} 件馆藏`,
        current: relatedCount,
      });
      if (itemNexus.unlocked) {
        earned.push(itemNexus);
      }
    }
  }

  // 4. Dynamic signature tag medals matching THIS item's thematic tags
  for (const medal of allMedals) {
    if (medal.isDynamicTag && medal.tagName && itemHasTag(item, medal.tagName)) {
      pushIfUnlocked(medal);
    }
  }

  // 5. Tag curator seal if THIS item itself has >= 3 tags
  if (item.tags.length >= 3) {
    pushIfUnlocked(byId.get('tag-curator'));
  }

  // 6. Trinity crown if full collection covers all 3 types
  pushIfUnlocked(byId.get('type-trinity'));

  // 7. Primary category medal (Film / Person / Character)
  if (item.category === 'film') pushIfUnlocked(byId.get('type-film'));
  if (item.category === 'person') pushIfUnlocked(byId.get('type-person'));
  if (item.category === 'character') pushIfUnlocked(byId.get('type-character'));

  // 8. Bond spark if THIS item has at least 1 link
  if (relatedCount >= 1) {
    pushIfUnlocked(byId.get('rel-bond'));
  }

  // Sort by highest prestige tier first, prioritizing dynamic tag & relation medals
  earned.sort((a, b) => {
    const tierDiff = MEDAL_TIER_RANK[b.tier] - MEDAL_TIER_RANK[a.tier];
    if (tierDiff !== 0) return tierDiff;
    if (a.isDynamicTag && !b.isDynamicTag) return -1;
    if (!a.isDynamicTag && b.isDynamicTag) return 1;
    return 0;
  });

  // Determine the closest, most actionable next unlock right on this item
  let nextMedal: ItemMedalShowcaseData['nextMedal'] = null;

  const itemThematicTags = item.tags.filter((t) => isThematicTag(t));
  const tagUniverse = byId.get('tag-universe');

  if (tagUniverse && !tagUniverse.unlocked && itemThematicTags.length > 0) {
    nextMedal = {
      medal: tagUniverse,
      hint: `再给 1 件加「${itemThematicTags[0]}」解锁「专题宇宙」`,
    };
  } else if (relatedCount < 2) {
    const nexus = byId.get('rel-nexus');
    if (nexus) {
      const need = 2 - relatedCount;
      nextMedal = {
        medal: nexus,
        hint: `再关联 ${need} 件馆藏即可点亮「核心枢纽」`,
      };
    }
  } else if (item.tags.length < 3) {
    const curator = byId.get('tag-curator');
    if (curator) {
      const need = 3 - item.tags.length;
      nextMedal = {
        medal: curator,
        hint: `再添 ${need} 个标签即可点亮「策展金印」`,
      };
    }
  } else if (completeness.tier !== 'masterpiece') {
    const crown = byId.get('rel-masterpiece');
    if (crown) {
      const missing = completeness.missingLabels[0] || '评分与手记';
      nextMedal = {
        medal: crown,
        hint: `补齐「${missing}」打磨满格点亮「传世典藏」`,
      };
    }
  }

  return {
    earnedMedals: earned,
    nextMedal,
  };
}

export interface MedalUnlockEvent {
  medal: CinemaMedal;
  kind: 'unlocked' | 'upgraded';
}

export function detectNewOrUpgradedMedals(
  prevTierMap: Map<string, MedalTier>,
  nextMedals: CinemaMedal[]
): MedalUnlockEvent[] {
  const events: MedalUnlockEvent[] = [];
  for (const medal of nextMedals) {
    if (!medal.unlocked) continue;
    const prevTier = prevTierMap.get(medal.id) ?? 'locked';
    if (MEDAL_TIER_RANK[medal.tier] > MEDAL_TIER_RANK[prevTier]) {
      events.push({
        medal,
        kind: prevTier === 'locked' ? 'unlocked' : 'upgraded',
      });
    }
  }
  return events;
}
