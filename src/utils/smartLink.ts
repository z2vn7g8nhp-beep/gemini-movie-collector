import type { ArchiveItem } from '../types/archive';

export type LinkMatchKind =
  | 'work_title'
  | 'actor_name'
  | 'shared_work'
  | 'shared_actor';

export interface LinkRecommendation {
  item: ArchiveItem;
  kind: LinkMatchKind;
  matchedTerm: string;
  reason: string;
  score: number;
}

const SPLIT_RE = /[,，、/／;；\n|]+/;
const BOOK_TITLE_RE = /《([^《》]{2,40})》/g;
const ACTOR_PREFIX_RE = /(?:主演|饰演|演员|配音|CV|导演)[：:]\s*([^·\n]+)/gi;

function normalizeCompare(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[《》「」『』""''()（）【】[\]]/g, '')
    .replace(/[·・•.\s]+/g, '')
    .replace(/[：:]/g, ':');
}

function isCJK(str: string): boolean {
  return /[\u4e00-\u9fff]/.test(str);
}

/**
 * Extracts normalized candidate entity names from a raw title or multi-value field.
 * Preserves full titles as well as pre-colon franchise stems (e.g. "复仇者联盟5：毁灭之日" -> "复仇者联盟5")
 * and slash aliases (e.g. "维克多·冯·杜姆／末日博士" -> ["维克多·冯·杜姆", "末日博士"]).
 */
export function extractEntityNames(raw?: string): string[] {
  if (!raw) return [];
  const cleaned = raw.trim();
  if (!cleaned) return [];

  const results = new Set<string>();
  const addToken = (token: string) => {
    const trimmed = token
      .replace(/^[《「『"'\s]+|[》」』"'\s]+$/g, '')
      .trim();
    if (!trimmed) return;
    const norm = normalizeCompare(trimmed);
    const minLen = isCJK(norm) ? 2 : 3;
    if (norm.length < minLen) return;
    results.add(trimmed);

    // Also include main title before colon/dash subtitle when substantial
    const colonIdx = trimmed.search(/[：:]/);
    if (colonIdx >= 2) {
      const stem = trimmed.slice(0, colonIdx).trim();
      const stemNorm = normalizeCompare(stem);
      if (stemNorm.length >= (isCJK(stemNorm) ? 3 : 4)) {
        results.add(stem);
      }
    }
  };

  for (const part of cleaned.split(SPLIT_RE)) {
    addToken(part);
  }
  return Array.from(results);
}

export function extractQuotedWorks(raw?: string): string[] {
  if (!raw) return [];
  const works: string[] = [];
  for (const match of raw.matchAll(BOOK_TITLE_RE)) {
    const inner = match[1]?.trim();
    if (inner) {
      works.push(...extractEntityNames(inner));
    }
  }
  return Array.from(new Set(works));
}

export function extractSubtitleActors(raw?: string): string[] {
  if (!raw) return [];
  const actors: string[] = [];
  for (const match of raw.matchAll(ACTOR_PREFIX_RE)) {
    const inner = match[1]?.trim();
    if (inner) {
      actors.push(...extractEntityNames(inner));
    }
  }
  return Array.from(new Set(actors));
}

export function entityNamesMatch(a: string, b: string): boolean {
  const na = normalizeCompare(a);
  const nb = normalizeCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;

  // Avoid noisy short substring matches
  const minSubLen = isCJK(shorter) ? 3 : 4;
  if (shorter.length < minSubLen) return false;
  return longer.includes(shorter);
}

function findMatchingPair(listA: string[], listB: string[]): string | null {
  for (const a of listA) {
    for (const b of listB) {
      if (entityNamesMatch(a, b)) {
        // Prefer the fuller readable label
        return a.length >= b.length ? a : b;
      }
    }
  }
  return null;
}

export function isExplicitlyLinked(a: ArchiveItem, b: ArchiveItem): boolean {
  return a.relatedIds.includes(b.id) || b.relatedIds.includes(a.id);
}

interface EntitySignalProfile {
  ownFilmNames: string[];
  referencedWorkNames: string[];
  linkedWorkNames: string[];
  ownPersonNames: string[];
  referencedActorNames: string[];
  linkedActorNames: string[];
}

function buildSignalProfile(
  item: ArchiveItem,
  byId: Map<string, ArchiveItem>,
  allItems: ArchiveItem[]
): EntitySignalProfile {
  const ownFilmNames =
    item.category === 'film'
      ? Array.from(
          new Set([
            ...extractEntityNames(item.title),
            ...extractEntityNames(item.originalTitle),
          ])
        )
      : [];

  const ownPersonNames =
    item.category === 'person'
      ? Array.from(
          new Set([
            ...extractEntityNames(item.title),
            ...extractEntityNames(item.originalTitle),
          ])
        )
      : [];

  const referencedWorkNames = Array.from(
    new Set([
      ...extractEntityNames(item.relatedWorkTitle),
      ...extractQuotedWorks(item.subtitle),
      ...extractQuotedWorks(item.characterProfile?.firstAppearance),
    ])
  );

  const referencedActorNames = Array.from(
    new Set([
      ...extractEntityNames(item.portrayedBy),
      ...extractSubtitleActors(item.subtitle),
    ])
  );

  // Collect films & actors already explicitly linked to this item
  const explicitNeighborIds = new Set<string>(item.relatedIds);
  for (const other of allItems) {
    if (other.id !== item.id && other.relatedIds.includes(item.id)) {
      explicitNeighborIds.add(other.id);
    }
  }

  const linkedWorkNames = new Set<string>();
  const linkedActorNames = new Set<string>();
  for (const nid of explicitNeighborIds) {
    const neighbor = byId.get(nid);
    if (!neighbor) continue;
    if (neighbor.category === 'film') {
      for (const n of extractEntityNames(neighbor.title)) linkedWorkNames.add(n);
      for (const n of extractEntityNames(neighbor.originalTitle))
        linkedWorkNames.add(n);
    } else if (neighbor.category === 'person') {
      for (const n of extractEntityNames(neighbor.title))
        linkedActorNames.add(n);
      for (const n of extractEntityNames(neighbor.originalTitle))
        linkedActorNames.add(n);
    }
  }

  return {
    ownFilmNames,
    referencedWorkNames,
    linkedWorkNames: Array.from(linkedWorkNames),
    ownPersonNames,
    referencedActorNames,
    linkedActorNames: Array.from(linkedActorNames),
  };
}

/**
 * Recommends unlinked items in the library related to `target` based on
 * work titles (`作品名称`) and actor/person names (`演员名称`), including
 * direct matches, reverse matches, and co-work / co-actor ecosystem matches.
 */
export function findRecommendedUnlinkedItems(
  target: ArchiveItem,
  allItems: ArchiveItem[],
  maxResults = 6
): LinkRecommendation[] {
  const byId = new Map<string, ArchiveItem>();
  for (const it of allItems) {
    byId.set(it.id, it);
  }
  byId.set(target.id, target);

  const targetSig = buildSignalProfile(target, byId, allItems);
  const targetAllWorks = Array.from(
    new Set([
      ...targetSig.ownFilmNames,
      ...targetSig.referencedWorkNames,
      ...targetSig.linkedWorkNames,
    ])
  );
  const targetAllActors = Array.from(
    new Set([
      ...targetSig.ownPersonNames,
      ...targetSig.referencedActorNames,
      ...targetSig.linkedActorNames,
    ])
  );

  const recs: LinkRecommendation[] = [];

  for (const cand of allItems) {
    if (cand.id === target.id) continue;
    if (isExplicitlyLinked(target, cand)) continue;

    const candSig = buildSignalProfile(cand, byId, allItems);

    type CandidateScore = Omit<LinkRecommendation, 'item'>;
    let best: CandidateScore | null = null;
    const pickBetter = (
      current: CandidateScore | null,
      next: CandidateScore
    ): CandidateScore => (!current || next.score > current.score ? next : current);

    // 1. Direct work title match: target references a work title that IS this film (or reverse)
    const directFilmHit =
      findMatchingPair(targetSig.referencedWorkNames, candSig.ownFilmNames) ||
      findMatchingPair(targetSig.ownFilmNames, candSig.referencedWorkNames);
    if (directFilmHit) {
      best = pickBetter(best, {
        kind: 'work_title',
        matchedTerm: directFilmHit,
        reason: `作品名称匹配《${directFilmHit}》`,
        score: 100,
      });
    }

    // 2. Direct actor/person name match: target's portrayedBy / subtitle mentions this person (or reverse)
    const directActorHit =
      findMatchingPair(targetSig.referencedActorNames, candSig.ownPersonNames) ||
      findMatchingPair(targetSig.ownPersonNames, candSig.referencedActorNames);
    if (directActorHit) {
      best = pickBetter(best, {
        kind: 'actor_name',
        matchedTerm: directActorHit,
        reason: `演员名称匹配「${directActorHit}」`,
        score: 96,
      });
    }

    // 3. Shared work match: both target & candidate reference or link to the same film/work
    const candAllWorks = Array.from(
      new Set([
        ...candSig.ownFilmNames,
        ...candSig.referencedWorkNames,
        ...candSig.linkedWorkNames,
      ])
    );
    const sharedWorkHit = findMatchingPair(targetAllWorks, candAllWorks);
    if (sharedWorkHit) {
      const label =
        cand.category === 'film'
          ? `作品名称匹配《${sharedWorkHit}》`
          : `同关联作品《${sharedWorkHit}》`;
      best = pickBetter(best, {
        kind: cand.category === 'film' ? 'work_title' : 'shared_work',
        matchedTerm: sharedWorkHit,
        reason: label,
        score: cand.category === 'film' ? 95 : 86,
      });
    }

    // 4. Shared actor match: both target & candidate reference or link to the same actor/person
    const candAllActors = Array.from(
      new Set([
        ...candSig.ownPersonNames,
        ...candSig.referencedActorNames,
        ...candSig.linkedActorNames,
      ])
    );
    const sharedActorHit = findMatchingPair(targetAllActors, candAllActors);
    if (sharedActorHit) {
      const label =
        cand.category === 'person'
          ? `演员名称匹配「${sharedActorHit}」`
          : `同关联影人「${sharedActorHit}」`;
      best = pickBetter(best, {
        kind: cand.category === 'person' ? 'actor_name' : 'shared_actor',
        matchedTerm: sharedActorHit,
        reason: label,
        score: cand.category === 'person' ? 92 : 82,
      });
    }

    if (best) {
      recs.push({ item: cand, ...best });
    }
  }

  return recs
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.item.updatedAt.localeCompare(a.item.updatedAt);
    })
    .slice(0, maxResults);
}

/**
 * Computes live recommendations during manual creation before the draft is persisted.
 */
export function findDraftLinkRecommendations(
  draft: {
    title: string;
    originalTitle?: string;
    subtitle?: string;
    category: ArchiveItem['category'];
    relatedWorkTitle?: string;
    portrayedBy?: string;
    relatedIds?: string[];
  },
  existingItems: ArchiveItem[],
  maxResults = 5
): LinkRecommendation[] {
  const synthetic: ArchiveItem = {
    id: '__draft__',
    accessionNo: '',
    category: draft.category,
    title: draft.title,
    originalTitle: draft.originalTitle,
    subtitle: draft.subtitle,
    summary: '',
    notes: '',
    rating: 0,
    status: 'watched',
    tags: [],
    relatedIds: draft.relatedIds ?? [],
    relatedWorkTitle: draft.relatedWorkTitle,
    portrayedBy: draft.portrayedBy,
    createdAt: '',
    updatedAt: '',
  };
  return findRecommendedUnlinkedItems(synthetic, existingItems, maxResults);
}
