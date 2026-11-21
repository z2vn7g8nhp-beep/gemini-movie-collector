import type { OnlineSearchResult } from '../types/archive';
import { extractImdbIdFromUrl } from '../utils/imdbParsers';
import { normalizeEntityKey } from '../utils/wikiCast';
import type { OnlineRelationsResponse } from './archiveApi';

type CreditShard = Record<string, string[][]>;
const SOURCE = '维基数据 Wikidata';

function joinCredits(previous?: string, next?: string): string {
  const values = [previous, next].flatMap(text => text ? text.split(' / ') : []);
  return [...new Set(values)].join(' / ');
}

export function decodeFilmCredits(rows: string[][], id: string, title: string): OnlineRelationsResponse {
  const people = new Map<string, OnlineSearchResult>();
  const characters = new Map<string, OnlineSearchResult>();
  const add = (list: Map<string, OnlineSearchResult>, row: OnlineSearchResult) => {
    const previous = list.get(row.externalId);
    if (!previous) {
      list.set(row.externalId, row);
      return;
    }
    previous.tags = Array.from(new Set([...previous.tags, ...row.tags]));
    previous.subtitle = joinCredits(previous.subtitle, row.subtitle);
    if (row.portrayedBy) previous.portrayedBy = joinCredits(previous.portrayedBy, row.portrayedBy);
  };
  for (const [job, person, name, original, role, character, characterEn] of rows) {
    const tag = job === 'director' ? '导演' : job === 'writer' ? '编剧' : '演员';
    const base = { relatedWorkTitle: title, sourceName: SOURCE };
    add(people, {
      ...base, externalId: 'wd-person-' + person, category: 'person', title: name,
      originalTitle: original || undefined, sourceUrl: 'https://www.wikidata.org/wiki/' + person,
      subtitle: character ? '饰 ' + character : tag, tags: [tag],
      summary: character ? `在《${title}》中饰演${character}。` : `《${title}》${tag}。`,
    });
    if (character) add(characters, {
      ...base, externalId: role ? 'wd-char-' + role : `wd-char-${id}-${character}`,
      category: 'character', title: character, originalTitle: characterEn || undefined,
      subtitle: '饰演者 ' + name, portrayedBy: name, summary: `《${title}》中的角色，由${name}饰演。`,
      sourceUrl: role ? 'https://www.wikidata.org/wiki/' + role : undefined, tags: ['角色'],
    });
  }
  return { films: [], people: [...people.values()], characters: [...characters.values()], sources: [SOURCE] };
}

export async function loadFilmCredits(url: string | undefined, title: string): Promise<OnlineRelationsResponse | null> {
  const id = extractImdbIdFromUrl(url);
  if (!id?.startsWith('tt')) return null;
  try {
    const shard: { default: CreditShard } = await import(`../data/credits/film-credits-${id.slice(-2)}.json`, { with: { type: 'json' } });
    const rows = shard.default[id];
    return rows?.length ? decodeFilmCredits(rows, id, title) : null;
  } catch {
    return null;
  }
}

// Keep distinct Wikidata entities, even when they have the same display name.
// Borrow portraits and links only from uniquely matching live entries.
function combine(base: OnlineSearchResult[], live: OnlineSearchResult[]): OnlineSearchResult[] {
  const out = base.map(item => ({ ...item }));
  const index = new Map<string, Set<number>>();
  const keys = (item: OnlineSearchResult) => [item.title, item.originalTitle].filter(Boolean).map(s => normalizeEntityKey(s!));
  out.forEach((item, i) => {
    for (const key of keys(item)) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(i);
    }
  });
  for (const item of live) {
    const matches = new Set(keys(item).flatMap(key => [...(index.get(key) || [])]));
    const exact = base.findIndex(row => row.externalId === item.externalId || (row.sourceUrl && row.sourceUrl === item.sourceUrl));
    const i = exact >= 0 ? exact : matches.size === 1 ? [...matches][0] : -1;
    if (i < 0 || (exact < 0 && item.sourceUrl?.includes('wikidata.org/wiki/'))) {
      out.push(item);
      continue;
    }
    const row = out[i];
    row.coverUrl ||= item.coverUrl;
    row.tags = [...new Set([...row.tags, ...item.tags])];
    if (item.category === 'person' && item.subtitle && !['演员', '主演'].includes(item.subtitle)) {
      row.subtitle = joinCredits(row.subtitle, item.subtitle);
    }
    if (!row.portrayedBy && item.portrayedBy) row.portrayedBy = item.portrayedBy;
    row.originalTitle ||= item.originalTitle;
    if (item.sourceUrl?.includes('imdb.com/name/')) row.sourceUrl = item.sourceUrl;
  }
  return out;
}

export function mergeFilmCredits(base: OnlineRelationsResponse, live: OnlineRelationsResponse): OnlineRelationsResponse {
  return {
    films: live.films,
    people: combine(base.people, live.people),
    characters: combine(base.characters, live.characters),
    sources: [...new Set([...base.sources, ...live.sources])],
  };
}

export async function withFilmCredits(
  params: { sourceUrl?: string; title: string },
  liveRequest: Promise<OnlineRelationsResponse>,
  signal?: AbortSignal,
  onPreview?: (result: OnlineRelationsResponse) => void,
): Promise<OnlineRelationsResponse> {
  const snapshot = loadFilmCredits(params.sourceUrl, params.title).then(data => {
    if (data && !signal?.aborted) onPreview?.(data);
    return data;
  });
  const [base, live] = await Promise.allSettled([snapshot, liveRequest]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (base.status === 'fulfilled' && base.value) {
    return live.status === 'fulfilled' ? mergeFilmCredits(base.value, live.value) : base.value;
  }
  if (live.status === 'rejected') throw live.reason;
  return live.value;
}
