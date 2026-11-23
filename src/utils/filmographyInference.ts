import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import type { OnlineRelationsResponse } from '../services/archiveApi';
import {
  entityNamesMatch,
  extractEntityNames,
  extractQuotedWorks,
  extractSubtitleActors,
  isExplicitlyLinked,
} from './smartLink';
import { normalizeEntityKey } from './wikiCast';

export type FilmographyRoleType =
  | 'directs'
  | 'writes'
  | 'acts'
  | 'portrays'
  | 'appears_in'
  | 'co_stars'
  | 'same_creator'
  | 'co_work'
  | 'credit_link';

export interface InferredFilmographyEdge {
  sourceId: string;
  targetId: string;
  roleType: FilmographyRoleType;
  /** Short directional-neutral or source->target hint */
  shortLabel?: string;
  /** Concise human-readable evidence for why these two entries are connected */
  evidence: string;
  /** Optional character title if an actor plays a specific role in a film */
  roleCharacterName?: string;
  /** Optional shared work/person title for co-star / same-creator / co-work edges */
  bridgeTitle?: string;
  /** Optional bridge archive item id inside the collection */
  viaItemId?: string;
  confidence: 'high' | 'medium';
  source: 'metadata' | 'credits' | 'transitive' | 'category-bridge';
}

interface ItemEntityProfile {
  item: ArchiveItem;
  ownNames: string[];
  referencedWorks: string[];
  referencedPeople: string[];
  subtitleTokens: string[];
  canonicalUrls: Set<string>;
}

const ROLE_NOISE_RE =
  /^(?:剧情|爱情|动作|科幻|悬疑|惊悚|犯罪|喜剧|动画|奇幻|冒险|战争|历史|传记|纪录片|家庭|歌舞|音乐|西部|灾难|武侠|古装|恐怖|电影|剧集|电视剧|短片|演员|主演|导演|编剧|制片人|监制|配音|声优|角色|男主角|女主角|主角|反派|中国大陆|中国香港|中国台湾|美国|日本|韩国|英国|法国|德国|意大利|加拿大|澳大利亚)$/i;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function extractCanonicalIds(url?: string): Set<string> {
  const out = new Set<string>();
  if (!url) return out;
  const imdbTitle = /imdb\.com\/title\/(tt\d{5,10})/i.exec(url);
  if (imdbTitle) out.add(`imdb:${imdbTitle[1].toLowerCase()}`);
  const imdbName = /imdb\.com\/name\/(nm\d{5,10})/i.exec(url);
  if (imdbName) out.add(`imdb:${imdbName[1].toLowerCase()}`);
  const wd = /wikidata\.org\/wiki\/(Q\d+)/i.exec(url);
  if (wd) out.add(`wd:${wd[1].toUpperCase()}`);
  const douban = /douban\.com\/(?:movie\/|tv\/)?(subject|celebrity|personage)\/(\d{5,12})/i.exec(url);
  if (douban) out.add(`douban:${douban[1].toLowerCase()}:${douban[2]}`);
  const bgm = /bgm\.tv\/(subject|person|character)\/(\d+)/i.exec(url);
  if (bgm) out.add(`bgm:${bgm[1].toLowerCase()}:${bgm[2]}`);
  return out;
}

function extractSubtitleNameTokens(subtitle?: string): string[] {
  if (!subtitle) return [];
  const rawParts = subtitle
    .split(/[·•|/／、,，;；]+/)
    .map((s) =>
      s
        .replace(/^(?:导演|编剧|主演|饰演|演员|配音|饰|CV|监制)[：:\s]*/i, '')
        .replace(/[（(][^）)]*[）)]/g, '')
        .trim()
    )
    .filter(Boolean);

  const tokens: string[] = [];
  for (const part of rawParts) {
    if (ROLE_NOISE_RE.test(part)) continue;
    if (/^\d{4}/.test(part)) continue;
    for (const name of extractEntityNames(part)) {
      if (!ROLE_NOISE_RE.test(name)) {
        tokens.push(name);
      }
    }
  }
  return Array.from(new Set(tokens));
}

function buildEntityProfile(item: ArchiveItem): ItemEntityProfile {
  const ownNames = Array.from(
    new Set([
      ...extractEntityNames(item.title),
      ...extractEntityNames(item.originalTitle),
      ...(item.category === 'character'
        ? extractEntityNames(item.characterProfile?.alias)
        : []),
    ])
  );

  const referencedWorks = Array.from(
    new Set([
      ...extractEntityNames(item.relatedWorkTitle),
      ...extractQuotedWorks(item.subtitle),
      ...extractQuotedWorks(item.characterProfile?.firstAppearance),
    ])
  );

  const referencedPeople = Array.from(
    new Set([
      ...extractEntityNames(item.portrayedBy),
      ...extractSubtitleActors(item.subtitle),
      ...(item.category === 'character'
        ? extractEntityNames(item.characterProfile?.creator)
        : []),
    ])
  );

  const subtitleTokens = extractSubtitleNameTokens(item.subtitle);

  return {
    item,
    ownNames,
    referencedWorks,
    referencedPeople,
    subtitleTokens,
    canonicalUrls: extractCanonicalIds(item.sourceUrl),
  };
}

function findEntityMatch(listA: string[], listB: string[]): string | null {
  for (const a of listA) {
    for (const b of listB) {
      if (entityNamesMatch(a, b)) {
        return a.length >= b.length ? a : b;
      }
    }
  }
  return null;
}

function isDirectorPerson(person: ArchiveItem, film?: ArchiveItem): boolean {
  const sub = person.subtitle || '';
  if (!/导演|编导|监督/.test(sub)) return false;
  if (!/演员|主演/.test(sub)) return true;
  if (film && film.subtitle) {
    const filmSub = film.subtitle.toLowerCase();
    if (
      filmSub.includes(person.title.trim().toLowerCase()) &&
      !/主演[：:]\s*[^·]*$/.test(film.subtitle)
    ) {
      return true;
    }
  }
  return false;
}

function isWriterPerson(person: ArchiveItem): boolean {
  const sub = person.subtitle || '';
  return /编剧|原著|脚本/.test(sub) && !/导演|演员|主演/.test(sub);
}

const CONFIDENCE_RANK: Record<InferredFilmographyEdge['confidence'], number> = {
  high: 2,
  medium: 1,
};

const SOURCE_RANK: Record<InferredFilmographyEdge['source'], number> = {
  credits: 4,
  metadata: 3,
  transitive: 2,
  'category-bridge': 1,
};

function upsertInferredEdge(
  map: Map<string, InferredFilmographyEdge>,
  edge: InferredFilmographyEdge
): void {
  if (edge.sourceId === edge.targetId) return;
  const key = pairKey(edge.sourceId, edge.targetId);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, edge);
    return;
  }
  const nextScore =
    CONFIDENCE_RANK[edge.confidence] * 10 +
    SOURCE_RANK[edge.source] +
    (edge.roleCharacterName ? 3 : 0);
  const prevScore =
    CONFIDENCE_RANK[existing.confidence] * 10 +
    SOURCE_RANK[existing.source] +
    (existing.roleCharacterName ? 3 : 0);

  if (nextScore > prevScore) {
    map.set(key, {
      ...edge,
      roleCharacterName: edge.roleCharacterName || existing.roleCharacterName,
    });
  } else if (!existing.roleCharacterName && edge.roleCharacterName) {
    map.set(key, {
      ...existing,
      roleCharacterName: edge.roleCharacterName,
    });
  }
}

/**
 * Synchronously discovers rich filmography relationships across the entire collection
 * from structured item fields (bilingual titles, relatedWorkTitle, portrayedBy,
 * subtitle credits, character dossiers, and transitive film-actor-character triads).
 */
export function discoverMetadataFilmographyLinks(
  items: ArchiveItem[]
): InferredFilmographyEdge[] {
  if (items.length < 2) return [];

  const profiles = items.map(buildEntityProfile);
  const profileById = new Map(profiles.map((p) => [p.item.id, p]));
  const discovered = new Map<string, InferredFilmographyEdge>();

  // Track filmography graph for transitive inference (explicit + newly discovered)
  const filmToPeople = new Map<string, Set<string>>();
  const filmToChars = new Map<string, Set<string>>();
  const charToFilms = new Map<string, Set<string>>();
  const charToPeople = new Map<string, Set<string>>();

  const addRel = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };

  // Seed with explicit links first so transitive completion works across mixed manual + metadata links
  for (const item of items) {
    for (const rid of item.relatedIds) {
      const other = profileById.get(rid)?.item;
      if (!other || other.id === item.id) continue;
      if (item.category === 'film' && other.category === 'person') {
        addRel(filmToPeople, item.id, other.id);
      } else if (item.category === 'person' && other.category === 'film') {
        addRel(filmToPeople, other.id, item.id);
      } else if (item.category === 'film' && other.category === 'character') {
        addRel(filmToChars, item.id, other.id);
        addRel(charToFilms, other.id, item.id);
      } else if (item.category === 'character' && other.category === 'film') {
        addRel(filmToChars, other.id, item.id);
        addRel(charToFilms, item.id, other.id);
      } else if (item.category === 'character' && other.category === 'person') {
        addRel(charToPeople, item.id, other.id);
      } else if (item.category === 'person' && other.category === 'character') {
        addRel(charToPeople, other.id, item.id);
      }
    }
  }

  // Pass 1: Direct pairwise entity matching (Film <-> Person, Film <-> Character, Character <-> Person)
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const pA = profiles[i];
      const pB = profiles[j];
      const a = pA.item;
      const b = pB.item;

      // Skip same-category duplicate records of the same entity
      if (a.category === b.category && findEntityMatch(pA.ownNames, pB.ownNames)) {
        continue;
      }

      // 1A. Film <-> Character
      if (
        (a.category === 'film' && b.category === 'character') ||
        (a.category === 'character' && b.category === 'film')
      ) {
        const filmP = a.category === 'film' ? pA : pB;
        const charP = a.category === 'character' ? pA : pB;
        const workHit = findEntityMatch(filmP.ownNames, charP.referencedWorks);
        if (workHit) {
          addRel(filmToChars, filmP.item.id, charP.item.id);
          addRel(charToFilms, charP.item.id, filmP.item.id);
          if (!isExplicitlyLinked(filmP.item, charP.item)) {
            upsertInferredEdge(discovered, {
              sourceId: charP.item.id,
              targetId: filmP.item.id,
              roleType: 'appears_in',
              evidence: `作品出处匹配《${workHit}》`,
              bridgeTitle: filmP.item.title,
              confidence: 'high',
              source: 'metadata',
            });
          }
        }
        continue;
      }

      // 1B. Character <-> Person
      if (
        (a.category === 'character' && b.category === 'person') ||
        (a.category === 'person' && b.category === 'character')
      ) {
        const charP = a.category === 'character' ? pA : pB;
        const personP = a.category === 'person' ? pA : pB;
        const actorHit =
          findEntityMatch(charP.referencedPeople, personP.ownNames) ||
          findEntityMatch(charP.subtitleTokens, personP.ownNames);
        if (actorHit) {
          addRel(charToPeople, charP.item.id, personP.item.id);
          if (!isExplicitlyLinked(charP.item, personP.item)) {
            upsertInferredEdge(discovered, {
              sourceId: personP.item.id,
              targetId: charP.item.id,
              roleType: 'portrays',
              evidence: `饰演 / 主创信息匹配「${actorHit}」`,
              roleCharacterName: charP.item.title,
              confidence: 'high',
              source: 'metadata',
            });
          }
        }
        continue;
      }

      // 1C. Film <-> Person
      if (
        (a.category === 'film' && b.category === 'person') ||
        (a.category === 'person' && b.category === 'film')
      ) {
        const filmP = a.category === 'film' ? pA : pB;
        const personP = a.category === 'person' ? pA : pB;

        const workHit = findEntityMatch(filmP.ownNames, personP.referencedWorks);
        const creditHit =
          findEntityMatch(filmP.referencedPeople, personP.ownNames) ||
          findEntityMatch(filmP.subtitleTokens, personP.ownNames);

        if (workHit || creditHit) {
          addRel(filmToPeople, filmP.item.id, personP.item.id);
          if (!isExplicitlyLinked(filmP.item, personP.item)) {
            const roleType: FilmographyRoleType = isDirectorPerson(
              personP.item,
              filmP.item
            )
              ? 'directs'
              : isWriterPerson(personP.item)
                ? 'writes'
                : 'acts';
            upsertInferredEdge(discovered, {
              sourceId: personP.item.id,
              targetId: filmP.item.id,
              roleType,
              evidence: workHit
                ? `影人代表作匹配《${workHit}》`
                : `影片主创信息提及「${creditHit}」`,
              bridgeTitle: filmP.item.title,
              confidence: 'high',
              source: 'metadata',
            });
          }
        }
        continue;
      }

      // 1D. Same-category metadata overlaps (works even when the bridging film/person isn't collected yet)
      if (a.category === 'person' && b.category === 'person') {
        const sharedWork = findEntityMatch(pA.referencedWorks, pB.referencedWorks);
        if (sharedWork && !isExplicitlyLinked(a, b)) {
          upsertInferredEdge(discovered, {
            sourceId: a.id,
            targetId: b.id,
            roleType: 'co_stars',
            evidence: `同关联作品《${sharedWork}》`,
            bridgeTitle: sharedWork,
            confidence: 'medium',
            source: 'metadata',
          });
        }
        continue;
      }

      if (a.category === 'character' && b.category === 'character') {
        const sharedWork = findEntityMatch(pA.referencedWorks, pB.referencedWorks);
        if (sharedWork && !isExplicitlyLinked(a, b)) {
          upsertInferredEdge(discovered, {
            sourceId: a.id,
            targetId: b.id,
            roleType: 'co_work',
            evidence: `同出自作品《${sharedWork}》`,
            bridgeTitle: sharedWork,
            confidence: 'high',
            source: 'metadata',
          });
        }
        continue;
      }

      if (a.category === 'film' && b.category === 'film') {
        const sharedPerson =
          findEntityMatch(pA.referencedPeople, pB.referencedPeople) ||
          findEntityMatch(pA.subtitleTokens, pB.subtitleTokens);
        if (sharedPerson && !isExplicitlyLinked(a, b)) {
          upsertInferredEdge(discovered, {
            sourceId: a.id,
            targetId: b.id,
            roleType: 'same_creator',
            evidence: `同属主创「${sharedPerson}」作品脉络`,
            bridgeTitle: sharedPerson,
            confidence: 'medium',
            source: 'metadata',
          });
        }
      }
    }
  }

  // Pass 2: Transitive Film-Person-Character Triad Completion
  // If Character C appears in Film F and is portrayed by Person P, infer Person P <-> Film F!
  for (const [charId, filmIds] of charToFilms.entries()) {
    const personIds = charToPeople.get(charId);
    if (!personIds || personIds.size === 0) continue;
    const charItem = profileById.get(charId)?.item;
    if (!charItem) continue;

    for (const filmId of filmIds) {
      const filmItem = profileById.get(filmId)?.item;
      if (!filmItem) continue;
      for (const personId of personIds) {
        const personItem = profileById.get(personId)?.item;
        if (!personItem) continue;
        addRel(filmToPeople, filmId, personId);
        if (!isExplicitlyLinked(filmItem, personItem)) {
          upsertInferredEdge(discovered, {
            sourceId: personId,
            targetId: filmId,
            roleType: 'acts',
            roleCharacterName: charItem.title,
            viaItemId: charId,
            evidence: `经由角色「${charItem.title}」推导出参演关系`,
            bridgeTitle: filmItem.title,
            confidence: 'high',
            source: 'transitive',
          });
        }
      }
    }
  }

  // If Character C is in Film F, and Film F has multiple collected characters, connect co-characters if unlinked?
  // Keep Film as the hub when Film IS in the collection so the star topology stays clean (avoid quadratic cliques),
  // EXCEPT for direct co-collaborators where a person directed/acted with another person in 2+ collected films!
  const collabFilmsByPair = new Map<string, ArchiveItem[]>();
  for (const [filmId, peopleIds] of filmToPeople.entries()) {
    const filmItem = profileById.get(filmId)?.item;
    if (!filmItem || peopleIds.size < 2) continue;
    const list = Array.from(peopleIds);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const pk = pairKey(list[i], list[j]);
        if (!collabFilmsByPair.has(pk)) collabFilmsByPair.set(pk, []);
        collabFilmsByPair.get(pk)!.push(filmItem);
      }
    }
  }

  for (const [pk, films] of collabFilmsByPair.entries()) {
    const [idA, idB] = pk.split('::');
    const a = profileById.get(idA)?.item;
    const b = profileById.get(idB)?.item;
    if (!a || !b || isExplicitlyLinked(a, b)) continue;
    // Connect unlinked people who share at least 2 collected films (true recurring collaborators)
    // or 1 collected film when the film has <= 4 collected people
    const filmCount = films.length;
    if (filmCount >= 2 || (filmCount === 1 && (filmToPeople.get(films[0].id)?.size ?? 0) <= 4)) {
      const titles = films
        .slice(0, 2)
        .map((f) => `《${f.title}》`)
        .join('、');
      upsertInferredEdge(discovered, {
        sourceId: a.id,
        targetId: b.id,
        roleType: 'co_stars',
        evidence:
          filmCount >= 2
            ? `多次合作（${titles}等 ${filmCount} 部）`
            : `共同参与作品${titles}`,
        bridgeTitle: films[0].title,
        viaItemId: films[0].id,
        confidence: filmCount >= 2 ? 'high' : 'medium',
        source: 'transitive',
      });
    }
  }

  return Array.from(discovered.values());
}

/**
 * Matches loaded local film-credit shards and cached online filmography responses
 * against collected items to automatically discover verified director, writer, actor,
 * and actor-character filmography relationships.
 */
export function matchFilmographyFromCredits(
  items: ArchiveItem[],
  creditsByItemId: Map<string, OnlineRelationsResponse>
): InferredFilmographyEdge[] {
  if (items.length < 2 || creditsByItemId.size === 0) return [];

  const profiles = items.map(buildEntityProfile);
  const films = profiles.filter((p) => p.item.category === 'film');
  const people = profiles.filter((p) => p.item.category === 'person');
  const characters = profiles.filter((p) => p.item.category === 'character');
  const itemById = new Map(items.map((it) => [it.id, it]));

  const discovered = new Map<string, InferredFilmographyEdge>();

  const matchesProfile = (
    cand: { title: string; originalTitle?: string; sourceUrl?: string },
    profile: ItemEntityProfile
  ): boolean => {
    const candUrls = extractCanonicalIds(cand.sourceUrl);
    for (const u of candUrls) {
      if (profile.canonicalUrls.has(u)) return true;
    }
    const candNames = Array.from(
      new Set([
        ...extractEntityNames(cand.title),
        ...extractEntityNames(cand.originalTitle),
      ])
    );
    if (findEntityMatch(candNames, profile.ownNames)) return true;
    const candKey = normalizeEntityKey(cand.title);
    if (candKey.length >= 2) {
      for (const own of profile.ownNames) {
        if (normalizeEntityKey(own) === candKey) return true;
      }
    }
    return false;
  };

  for (const [ownerId, response] of creditsByItemId.entries()) {
    const owner = itemById.get(ownerId);
    if (!owner) continue;

    if (owner.category === 'film') {
      // Match credited people -> collected People
      const matchedPersonByCreditName = new Map<string, ArchiveItem>();
      for (const creditPerson of response.people || []) {
        const matchedProfile = people.find((p) => matchesProfile(creditPerson, p));
        if (!matchedProfile) continue;
        const personItem = matchedProfile.item;
        matchedPersonByCreditName.set(
          normalizeEntityKey(creditPerson.title),
          personItem
        );
        if (creditPerson.originalTitle) {
          matchedPersonByCreditName.set(
            normalizeEntityKey(creditPerson.originalTitle),
            personItem
          );
        }

        const roleMatch = /饰\s*([^/·]+)/.exec(creditPerson.subtitle || '');
        const rawRoleCharName = roleMatch?.[1]?.trim();
        const matchedCollectedChar = rawRoleCharName
          ? characters.find((c) => findEntityMatch([rawRoleCharName], c.ownNames))?.item
          : undefined;
        const roleCharName = matchedCollectedChar?.title || rawRoleCharName;
        const isDir = creditPerson.tags.includes('导演') || creditPerson.subtitle?.includes('导演');
        const isWri = creditPerson.tags.includes('编剧') || creditPerson.subtitle?.includes('编剧');
        const roleType: FilmographyRoleType = isDir
          ? 'directs'
          : isWri && !roleCharName
            ? 'writes'
            : 'acts';

        if (!isExplicitlyLinked(owner, personItem)) {
          upsertInferredEdge(discovered, {
            sourceId: personItem.id,
            targetId: owner.id,
            roleType,
            roleCharacterName: roleCharName,
            bridgeTitle: owner.title,
            evidence: roleCharName
              ? `演职员表：在《${owner.title}》中饰演「${roleCharName}」`
              : `演职员表：《${owner.title}》${isDir ? '导演' : isWri ? '编剧' : '演员'}`,
            confidence: 'high',
            source: 'credits',
          });
        }
      }

      // Match credited characters -> collected Characters (and connect to matched actor!)
      for (const creditChar of response.characters || []) {
        const matchedCharProfile = characters.find((c) =>
          matchesProfile(creditChar, c)
        );
        if (!matchedCharProfile) continue;
        const charItem = matchedCharProfile.item;

        if (!isExplicitlyLinked(owner, charItem)) {
          upsertInferredEdge(discovered, {
            sourceId: charItem.id,
            targetId: owner.id,
            roleType: 'appears_in',
            bridgeTitle: owner.title,
            evidence: `演职员表：《${owner.title}》登场角色`,
            confidence: 'high',
            source: 'credits',
          });
        }

        if (creditChar.portrayedBy) {
          const actorTokens = extractEntityNames(creditChar.portrayedBy);
          for (const token of actorTokens) {
            const matchedActor =
              matchedPersonByCreditName.get(normalizeEntityKey(token)) ||
              people.find((p) => findEntityMatch([token], p.ownNames))?.item;
            if (matchedActor && !isExplicitlyLinked(charItem, matchedActor)) {
              upsertInferredEdge(discovered, {
                sourceId: matchedActor.id,
                targetId: charItem.id,
                roleType: 'portrays',
                roleCharacterName: charItem.title,
                bridgeTitle: owner.title,
                evidence: `演职员表：《${owner.title}》由${matchedActor.title}饰演`,
                confidence: 'high',
                source: 'credits',
              });
            }
          }
        }
      }
    } else if (owner.category === 'person') {
      // Match person's filmography -> collected Films
      for (const creditFilm of response.films || []) {
        const matchedFilmProfile = films.find((f) => matchesProfile(creditFilm, f));
        if (!matchedFilmProfile) continue;
        const filmItem = matchedFilmProfile.item;
        if (!isExplicitlyLinked(owner, filmItem)) {
          const roleType: FilmographyRoleType = isDirectorPerson(owner, filmItem)
            ? 'directs'
            : isWriterPerson(owner)
              ? 'writes'
              : 'acts';
          upsertInferredEdge(discovered, {
            sourceId: owner.id,
            targetId: filmItem.id,
            roleType,
            bridgeTitle: filmItem.title,
            evidence: `影人作品表收录《${filmItem.title}》`,
            confidence: 'high',
            source: 'credits',
          });
        }
      }
    }
  }

  return Array.from(discovered.values());
}

/**
 * Merges metadata-discovered and credit-discovered filmography edges, preferring
 * higher-confidence credit edges when both cover the same pair of items.
 */
export function mergeInferredFilmographyEdges(
  ...edgeLists: InferredFilmographyEdge[][]
): InferredFilmographyEdge[] {
  const merged = new Map<string, InferredFilmographyEdge>();
  for (const list of edgeLists) {
    for (const edge of list) {
      upsertInferredEdge(merged, edge);
    }
  }
  return Array.from(merged.values());
}

/**
 * Projects 2-hop cross-category filmography connections when viewing a single-category
 * slice (e.g. connecting two People who share a collected Film, or two Films who share
 * a collected Person, or two Characters from the same collected Film).
 */
export function buildCategoryBridgeEdges(
  allItems: ArchiveItem[],
  visibleCategory: ArchiveCategory,
  allFilmographyEdges: Array<{ sourceId: string; targetId: string }>
): InferredFilmographyEdge[] {
  const itemById = new Map(allItems.map((it) => [it.id, it]));
  const adj = new Map<string, Set<string>>();
  for (const it of allItems) adj.set(it.id, new Set());
  for (const e of allFilmographyEdges) {
    if (!itemById.has(e.sourceId) || !itemById.has(e.targetId)) continue;
    adj.get(e.sourceId)?.add(e.targetId);
    adj.get(e.targetId)?.add(e.sourceId);
  }

  const visibleItems = allItems.filter((it) => it.category === visibleCategory);
  const discovered = new Map<string, InferredFilmographyEdge>();

  for (let i = 0; i < visibleItems.length; i += 1) {
    for (let j = i + 1; j < visibleItems.length; j += 1) {
      const a = visibleItems[i];
      const b = visibleItems[j];
      if (adj.get(a.id)?.has(b.id)) continue;

      const bridges: ArchiveItem[] = [];
      for (const midId of adj.get(a.id) ?? []) {
        if (adj.get(b.id)?.has(midId)) {
          const midItem = itemById.get(midId);
          if (midItem && midItem.category !== visibleCategory) {
            bridges.push(midItem);
          }
        }
      }
      if (bridges.length === 0) continue;

      // Prefer film bridges for people/characters, and person bridges for films
      bridges.sort((x, y) => {
        const pref = (it: ArchiveItem) =>
          visibleCategory === 'film'
            ? it.category === 'person'
              ? 0
              : 1
            : it.category === 'film'
              ? 0
              : 1;
        return pref(x) - pref(y);
      });

      const primary = bridges[0];
      const roleType: FilmographyRoleType =
        visibleCategory === 'person'
          ? 'co_stars'
          : visibleCategory === 'film'
            ? 'same_creator'
            : 'co_work';

      const bridgeDesc =
        primary.category === 'film'
          ? `经由《${primary.title}》${bridges.length > 1 ? `等 ${bridges.length} 项` : ''}关联`
          : `经由「${primary.title}」${bridges.length > 1 ? `等 ${bridges.length} 项` : ''}关联`;

      upsertInferredEdge(discovered, {
        sourceId: a.id,
        targetId: b.id,
        roleType,
        bridgeTitle: primary.title,
        viaItemId: primary.id,
        evidence: bridgeDesc,
        confidence: bridges.length >= 2 ? 'high' : 'medium',
        source: 'category-bridge',
      });
    }
  }

  return Array.from(discovered.values());
}

/**
 * Pure helper to bidirectionally link multiple [sourceId, targetId] pairs
 * in an ArchiveItem array without mutating inputs or duplicating IDs.
 */
export function computeBatchLinkItems(
  items: ArchiveItem[],
  pairs: Array<[string, string]>,
  nowIso = new Date().toISOString()
): { nextItems: ArchiveItem[]; linkedPairCount: number } {
  const existingIds = new Set(items.map((it) => it.id));
  const additions = new Map<string, Set<string>>();
  let linkedPairCount = 0;

  const currentMap = new Map(items.map((it) => [it.id, new Set(it.relatedIds)]));

  for (const [rawA, rawB] of pairs) {
    if (!rawA || !rawB || rawA === rawB) continue;
    if (!existingIds.has(rawA) || !existingIds.has(rawB)) continue;
    const hasAB = currentMap.get(rawA)?.has(rawB) ?? false;
    const hasBA = currentMap.get(rawB)?.has(rawA) ?? false;
    if (hasAB && hasBA) continue;

    if (!additions.has(rawA)) additions.set(rawA, new Set());
    if (!additions.has(rawB)) additions.set(rawB, new Set());
    additions.get(rawA)!.add(rawB);
    additions.get(rawB)!.add(rawA);
    currentMap.get(rawA)!.add(rawB);
    currentMap.get(rawB)!.add(rawA);
    linkedPairCount += 1;
  }

  if (linkedPairCount === 0) {
    return { nextItems: items, linkedPairCount: 0 };
  }

  const nextItems = items.map((it) => {
    const extra = additions.get(it.id);
    if (!extra || extra.size === 0) return it;
    return {
      ...it,
      relatedIds: Array.from(new Set([...it.relatedIds, ...extra])),
      updatedAt: nowIso,
    };
  });

  return { nextItems, linkedPairCount };
}
