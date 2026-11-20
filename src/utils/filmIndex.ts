import labels from '../data/film-labels.json';
import type { OnlineSearchResult } from '../types/archive';
import { parseImdbUrlOrId, rankImdbResults } from './imdbParsers';
import { normalizeEntityKey } from './wikiCast';

// Mainland theatrical titles for entries whose Wikidata label uses the Taiwan release name.
const mainlandTitles: Record<string, string> = {
  tt13623126: '钢铁之心',
  tt1951265: '饥饿游戏3：嘲笑鸟（上）',
  tt1951266: '饥饿游戏3：嘲笑鸟（下）',
  tt10545296: '饥饿游戏：鸣鸟与蛇之歌',
};

const records = labels.map(([id, label, originalTitle, year]) => {
  const title = mainlandTitles[id] || label;
  return {
    id, title, originalTitle, year,
    keys: [label, title, originalTitle].map(normalizeEntityKey),
  };
});
const byId = new Map(records.map(record => [record.id, record]));

export function localizeFilm(item: OnlineSearchResult): OnlineSearchResult {
  const record = byId.get(item.externalId.replace(/^imdb-/, ''));
  if (!record || item.category !== 'film') return item;
  return {
    ...item,
    title: record.title,
    originalTitle: item.originalTitle || record.originalTitle || (item.title !== record.title ? item.title : undefined),
    year: item.year || record.year || undefined,
  };
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
    sourceName: 'IMDb · 中文片名索引',
    sourceUrl: 'https://www.imdb.com/title/' + record.id + '/',
    summary: '',
    tags: [],
  })), query).slice(0, 12);
}
