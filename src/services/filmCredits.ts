import queryLines from '../data/film-credits-query.json';
import type { OnlineSearchResult } from '../types/archive';
import { extractImdbIdFromUrl } from '../utils/imdbParsers';
import { findIndexedFilmId } from '../utils/filmIndex';
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

type RolePairs = [number, Array<[string, string]>];

function articleCredits([revision, pairs]: RolePairs, id: string, title: string, base?: OnlineRelationsResponse): OnlineRelationsResponse {
  const people = new Map<string, OnlineSearchResult>();
  const characters = new Map<string, OnlineSearchResult>();
  const localNames = (rows: OnlineSearchResult[] = []) =>
    new Map(rows.map(row => [row.originalTitle || row.title, row.title]));
  const actors = localNames(base?.people);
  const roles = localNames(base?.characters);
  for (const [actor, role] of pairs) {
    const person = people.get(actor) || {
      externalId: `enwiki-person-${id}-${actor}`, category: 'person', title: actor,
      tags: ['演员'], relatedWorkTitle: title, sourceName: '英文维基百科', summary: '',
    } satisfies OnlineSearchResult;
    const ch = characters.get(role) || {
      externalId: `enwiki-role-${id}-${role}`, category: 'character', title: role,
      tags: ['角色'], relatedWorkTitle: title, sourceName: '英文维基百科', summary: '',
    } satisfies OnlineSearchResult;
    const actorName = actors.get(actor) || actor;
    people.set(actor, { ...person, subtitle: joinCredits(people.get(actor)?.subtitle, '饰 ' + (roles.get(role) || role)) });
    const portrayedBy = joinCredits(characters.get(role)?.portrayedBy, actorName);
    characters.set(role, { ...ch, portrayedBy, subtitle: '饰演者 ' + portrayedBy });
  }
  return {
    films: [], people: [...people.values()], characters: [...characters.values()],
    sources: ['英文维基百科'], castArticleRevision: revision,
  };
}

export async function loadFilmCredits(url: string | undefined, title: string, originalTitle?: string, year?: string): Promise<OnlineRelationsResponse | null> {
  const id = url ? extractImdbIdFromUrl(url) : findIndexedFilmId(title, originalTitle, year);
  if (!id?.startsWith('tt')) return null;
  const suffix = id.slice(-2);
  const [credits, articles] = await Promise.allSettled([
    import(`../data/credits/film-credits-${suffix}.json`, { with: { type: 'json' } }),
    import(`../data/role-pairs/role-pairs-${suffix}.json`, { with: { type: 'json' } }),
  ]);
  const rows = credits.status === 'fulfilled' ? (credits.value.default as CreditShard)[id] : undefined;
  const article = articles.status === 'fulfilled' ? (articles.value.default as Record<string, RolePairs>)[id] : undefined;
  const base = rows?.length ? decodeFilmCredits(rows, id, title) : undefined;
  if (!article) return base || null;
  const extra = articleCredits(article, id, title, base);
  return base ? mergeFilmCredits(base, extra) : extra;
}

// Use the same exact-ID query as the snapshot builder for titles outside the catalog.
async function lookupFilmCredits(id: string, title: string, signal?: AbortSignal): Promise<OnlineRelationsResponse | null> {
  if (!/^tt\d{5,10}$/.test(id) || signal?.aborted) return null;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 3500);
  try {
    const query = queryLines.join('\n').replace('%s', JSON.stringify(id));
    const res = await fetch('https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }), { signal: controller.signal });
    if (!res.ok) return null;
    type Binding = Record<string, { value: string }>;
    const { results } = await res.json() as { results: { bindings: Binding[] } };
    const rows: string[][] = [];
    for (const row of results.bindings) {
      if (row.id?.value !== id) continue;
      const person = row.person?.value.split('/').pop();
      if (!person || !/^Q\d+$/.test(person)) continue;
      const roleId = row.role?.value.split('/').pop() || '';
      const label = (key: string) => {
        const text = row[key]?.value || '';
        return /^Q\d+$/.test(text) ? '' : text;
      };
      const name = label('personLabel') || label('personEn');
      if (!name) continue;
      const role = (roleId && label('roleLabel')) || label('name') || (roleId && label('roleEn'));
      const en = label('personEn');
      const roleEn = roleId && label('roleEn');
      rows.push([row.job.value, person, name, en !== name ? en : '', roleId, role, roleEn !== role ? roleEn : '']);
    }
    return rows.length ? decodeFilmCredits(rows, id, title) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
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
    if (item.portrayedBy && item.externalId.startsWith('enwiki-role-')) {
      row.portrayedBy = joinCredits(row.portrayedBy, item.portrayedBy);
      row.subtitle = '饰演者 ' + row.portrayedBy;
    } else if (!row.portrayedBy) {
      row.portrayedBy = item.portrayedBy;
    }
    row.originalTitle ||= item.originalTitle;
    if (item.sourceUrl?.includes('imdb.com/name/')) row.sourceUrl = item.sourceUrl;
  }
  return out;
}

export function mergeFilmCredits(base: OnlineRelationsResponse, live: OnlineRelationsResponse): OnlineRelationsResponse {
  return {
    castArticleRevision: base.castArticleRevision || live.castArticleRevision,
    films: live.films,
    people: combine(base.people, live.people),
    characters: combine(base.characters, live.characters),
    sources: [...new Set([...base.sources, ...live.sources])],
  };
}

export async function withFilmCredits(
  params: { sourceUrl?: string; title: string; originalTitle?: string; year?: string },
  liveRequest: Promise<OnlineRelationsResponse>,
  signal?: AbortSignal,
  onPreview?: (result: OnlineRelationsResponse) => void,
  allowLookup = true,
): Promise<OnlineRelationsResponse> {
  const snapshot = loadFilmCredits(params.sourceUrl, params.title, params.originalTitle, params.year).then(async data => {
    if (data && !signal?.aborted) onPreview?.(data);
    const id = extractImdbIdFromUrl(params.sourceUrl);
    if (!allowLookup || !id || data?.characters.length || signal?.aborted) return data;
    const remote = await lookupFilmCredits(id, params.title, signal);
    if (!remote) return data;
    const combined = data ? mergeFilmCredits(data, remote) : remote;
    if (!signal?.aborted) onPreview?.(combined);
    return combined;
  });
  const [base, live] = await Promise.allSettled([snapshot, liveRequest]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (base.status === 'fulfilled' && base.value) {
    return live.status === 'fulfilled' ? mergeFilmCredits(base.value, live.value) : base.value;
  }
  if (live.status === 'rejected') throw live.reason;
  return live.value;
}
