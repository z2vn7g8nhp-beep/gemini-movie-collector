import labels from '../data/film-labels.json';
import profilesJson from '../data/release-profiles.json';
import type { ArchiveItem, OnlineSearchResult } from '../types/archive';
import { extractImdbIdFromUrl, hasCjkCharacters, parseImdbUrlOrId, rankImdbResults } from './imdbParsers';
import { normalizeEntityKey } from './wikiCast';

// Mainland theatrical titles for entries whose Wikidata label uses the Taiwan release name.
const mainlandTitles: Record<string, string> = {
  tt13623126: '钢铁之心',
  tt1951265: '饥饿游戏3：嘲笑鸟（上）',
  tt1951266: '饥饿游戏3：嘲笑鸟（下）',
  tt10545296: '饥饿游戏：鸣鸟与蛇之歌',
};

interface ReleaseProfile {
  title: string; alias: string; original: string; year: string; kind: string; summary: string; revision: number;
}
const profiles: Record<string, ReleaseProfile> = profilesJson;
const titles = new Map(labels.map(row => [row[0], row]));
for (const [id, p] of Object.entries(profiles)) {
  if (!titles.has(id)) titles.set(id, [id, p.title, p.original, p.year, p.kind]);
}
const records = [...titles.values()].map(([id, label, original, year, kind]) => {
  const profile = profiles[id];
  const title = mainlandTitles[id] || profile?.title || label;
  const originalTitle = original || profile?.original || '';
  return {
    id, title, originalTitle, year: year || profile?.year, kind: kind || profile?.kind,
    keys: [label, title, originalTitle, profile?.alias || '', profile?.original || ''].filter(Boolean).map(normalizeEntityKey),
  };
});
const byId = new Map(records.map(record => [record.id, record]));

function localizedSummary(id: string, summary: string) {
  const profile = profiles[id];
  return profile?.summary && !hasCjkCharacters(summary)
    ? { summary: profile.summary, summaryRevision: profile.revision } : {};
}

export function localizeFilm(item: OnlineSearchResult): OnlineSearchResult {
  const record = byId.get(item.externalId.replace(/^imdb-/, ''));
  if (!record || item.category !== 'film') return item;
  return {
    ...item,
    ...localizedSummary(record.id, item.summary),
    title: record.title,
    originalTitle: item.originalTitle || record.originalTitle || (item.title !== record.title ? item.title : undefined),
    year: item.year || record.year || undefined,
  };
}

// Derive a library view from the exact source ID. Keep the user's stored snapshot intact.
export function localizeArchivedFilm(item: ArchiveItem): ArchiveItem {
  if (item.category !== 'film' || !item.sourceName?.includes('IMDb')) return item;
  const id = extractImdbIdFromUrl(item.sourceUrl);
  const record = id && byId.get(id);
  if (!record) return item;
  const rename = !hasCjkCharacters(item.title) && [record.originalTitle, item.originalTitle]
    .some(original => original && normalizeEntityKey(original) === normalizeEntityKey(item.title));
  return {
    ...item, ...localizedSummary(record.id, item.summary || ''),
    title: rename ? record.title : item.title,
    originalTitle: rename ? item.originalTitle || item.title : item.originalTitle,
  };
}

// Imported archives may have no provider link. Only resolve a unique exact name/year pair.
export function findIndexedFilmId(title: string, originalTitle?: string, year?: string): string | undefined {
  if (!year || !/^\d{4}$/.test(year)) return undefined;
  const names = [title, originalTitle].filter((s): s is string => Boolean(s?.trim()))
    .map(s => s.normalize('NFKC').trim().toLowerCase());
  const matches = records.filter(row => row.year === year && names.every(name =>
    [row.title, row.originalTitle].some(s => s?.normalize('NFKC').trim().toLowerCase() === name)
  ));
  return names.length && matches.length === 1 ? matches[0].id : undefined;
}

export function searchFilmIndex(query: string): OnlineSearchResult[] {
  const direct = parseImdbUrlOrId(query);
  const key = normalizeEntityKey(query);
  if (!key) return [];
  const matches = records.filter(record => direct
    ? direct.id === record.id
    : record.keys.some(k => k === key || (key.length >= 2 && k.includes(key))));
  return rankImdbResults(matches.map(record => ({
    externalId: 'imdb-' + record.id,
    category: 'film',
    title: record.title,
    originalTitle: record.originalTitle || undefined,
    year: record.year || undefined,
    subtitle: record.kind === 'series' ? '剧集' : record.kind === 'movie' ? '电影' : undefined,
    sourceName: 'IMDb · 中文片名索引',
    sourceUrl: 'https://www.imdb.com/title/' + record.id + '/',
    summary: '',
    ...localizedSummary(record.id, ''),
    tags: [],
  })), query).slice(0, 12);
}
