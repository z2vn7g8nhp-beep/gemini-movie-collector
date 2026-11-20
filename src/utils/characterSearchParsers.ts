import type { OnlineSearchResult } from '../types/archive';
import {
  stripBaikeHtml,
  upgradeToHttpsUrl,
  type ParsedBaikeBundle,
} from './chinaSearchParsers';
import { hasCjkChars, splitCandidateAliases } from './bilingualMerge';
import { normalizeEntityKey } from './wikiCast';

const KANA_RE = /[\u3040-\u30ff]/;

/**
 * Strips Bangumi universe/edition parenthetical suffixes such as `(Earth-199999)`
 * or `(MCU)` so character display names stay clean and matchable.
 */
export function cleanBangumiCharacterName(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(
      /\s*[（(]\s*(?:Earth-?\d+|地球-?\d+|MCU|DCEU|漫威电影宇宙|动画版|电影版|剧版|原作版)\s*[）)]\s*/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * On live-action (`type: 6`) subjects, Bangumi often lists Japanese dub voice actors
 * before the original live-action actor (e.g. `['藤原啓治', 'Robert Downey Jr.']`).
 * Prefer the original non-kana actor on Western live-action titles.
 */
export function pickPreferredCharacterActor(
  actors: Array<{ name?: string }> | undefined,
  isLiveAction: boolean
): string | undefined {
  if (!Array.isArray(actors) || actors.length === 0) return undefined;
  const names = actors
    .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
    .filter(Boolean);
  if (names.length === 0) return undefined;

  if (isLiveAction) {
    // Prefer Latin/English actor name (for Hollywood/Western live-action films)
    const latin = names.find((n) => !hasCjkChars(n) && !KANA_RE.test(n));
    if (latin) return latin;
    // Otherwise prefer non-kana name (Chinese/Korean actor)
    const nonKana = names.find((n) => !KANA_RE.test(n));
    if (nonKana) return nonKana;
  }
  return names[0];
}

function extractBangumiInfoboxStrings(
  infobox: Array<{ key?: string; value?: unknown }> | undefined,
  keys: string[]
): string[] {
  if (!Array.isArray(infobox)) return [];
  const out: string[] = [];
  for (const row of infobox) {
    const k = typeof row?.key === 'string' ? row.key.trim() : '';
    if (!keys.includes(k)) continue;
    const val = row.value;
    if (typeof val === 'string' && val.trim()) {
      out.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const entry of val) {
        if (typeof entry === 'string' && entry.trim()) {
          out.push(entry.trim());
        } else if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { v?: unknown }).v === 'string'
        ) {
          const v = String((entry as { v: string }).v).trim();
          if (v) out.push(v);
        }
      }
    }
  }
  return Array.from(new Set(out));
}

function isStrictCharacterQueryMatch(
  candidates: string[],
  query: string
): boolean {
  const nq = normalizeEntityKey(query);
  if (!nq) return false;
  const queryParts = splitCandidateAliases(query)
    .map((p) => normalizeEntityKey(p))
    .filter((p) => p.length >= 2);

  for (const raw of candidates) {
    const parts = [raw, ...splitCandidateAliases(raw)];
    for (const part of parts) {
      const nc = normalizeEntityKey(part);
      if (!nc) continue;
      if (nc === nq) return true;
      // Full query appears inside candidate (e.g. "千寻" in "荻野千寻", "钢铁侠" in "钢铁侠 / 托尼·斯塔克")
      if (nq.length >= 2 && nc.includes(nq)) {
        // Guard against unrelated long names containing a tiny 2-char Latin syllable
        if (!hasCjkChars(query) && nq.length < 4) continue;
        return true;
      }
      // Candidate is a substantial part of query (e.g. candidate "灭霸" for query "漫威灭霸")
      if (nc.length >= 2 && nq.includes(nc) && nc.length >= Math.ceil(nq.length * 0.6)) {
        return true;
      }
      for (const qp of queryParts) {
        if (qp.length >= 3 && nc === qp) return true;
      }
    }
  }
  return false;
}

/**
 * Parses Bangumi `/v0/search/characters` response with strict relevance filtering
 * so unrelated partial-substring matches (e.g. Chopper for Tony Stark) are dropped.
 */
export function parseBangumiCharacterSearch(
  payload: { data?: Array<Record<string, any>> } | null | undefined,
  query: string
): OnlineSearchResult[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length === 0) return [];

  const out: OnlineSearchResult[] = [];
  for (const row of rows) {
    if (!row || !row.id) continue;
    const rawName = cleanBangumiCharacterName(String(row.name || ''));
    const zhNames = extractBangumiInfoboxStrings(row.infobox, ['简体中文名', '中文名']);
    const aliases = extractBangumiInfoboxStrings(row.infobox, ['别名', '英文名', '罗马字']);

    const allCandidates = [rawName, ...zhNames, ...aliases].filter(Boolean);
    if (!isStrictCharacterQueryMatch(allCandidates, query)) {
      continue;
    }

    const title = cleanBangumiCharacterName(zhNames[0] || rawName);
    if (!title) continue;

    const latinAlias = aliases.find((a) => !hasCjkChars(a) && !KANA_RE.test(a));
    const originalTitle =
      rawName && normalizeEntityKey(rawName) !== normalizeEntityKey(title)
        ? rawName
        : latinAlias && normalizeEntityKey(latinAlias) !== normalizeEntityKey(title)
          ? latinAlias
          : undefined;

    const coverUrl = upgradeToHttpsUrl(
      row.images?.large || row.images?.medium || row.images?.grid || row.images?.small
    );
    const summary = stripBaikeHtml(row.summary || '', 220);

    out.push({
      externalId: `bgm-char-${row.id}`,
      category: 'character',
      title,
      originalTitle,
      subtitle: originalTitle ? `角色 · ${originalTitle}` : '动漫 / 影视角色',
      coverUrl,
      summary: summary || `${title}（Bangumi 角色档案）`,
      sourceName: '番组计划 Bangumi',
      sourceUrl: `https://bgm.tv/character/${row.id}`,
      tags: ['角色'],
    });
  }

  return out;
}

/**
 * Parses Bangumi `/v0/subjects/{id}/characters` response into clean character cards.
 */
export function parseBangumiSubjectCharacters(
  rows: Array<Record<string, any>> | null | undefined,
  workTitle: string,
  options: {
    workYear?: string;
    isLiveAction?: boolean;
    limit?: number;
  } = {}
): OnlineSearchResult[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const { workYear, isLiveAction = false, limit = 24 } = options;

  const out: OnlineSearchResult[] = [];
  for (const c of rows.slice(0, limit)) {
    const cleanedName = cleanBangumiCharacterName(String(c?.name || ''));
    if (!cleanedName) continue;

    const actorName = pickPreferredCharacterActor(c.actors, isLiveAction);
    const rel = String(c.relation || '角色').trim() || '角色';
    const coverUrl = upgradeToHttpsUrl(
      c.images?.large || c.images?.medium || c.images?.grid || c.images?.small
    );

    out.push({
      externalId: `bgm-char-${c.id}`,
      category: 'character',
      title: cleanedName,
      year: workYear,
      subtitle: actorName
        ? `${rel} · ${actorName} · 出自《${workTitle}》`
        : `${rel} · 出自《${workTitle}》`,
      coverUrl,
      summary: `《${workTitle}》中的${rel}${
        actorName ? `，由 ${actorName} 饰演/配音` : ''
      }。`,
      relatedWorkTitle: workTitle,
      portrayedBy: actorName,
      sourceName: '番组计划 Bangumi',
      sourceUrl: c.id ? `https://bgm.tv/character/${c.id}` : undefined,
      tags: ['角色', rel].filter((v, i, arr) => arr.indexOf(v) === i),
    });
  }

  return out;
}

/**
 * Parses TVMaze `/shows/{id}/cast` response into character search/relation cards.
 */
export function parseTvmazeShowCharacters(
  show: Record<string, any> | null | undefined,
  cast: Array<{ person?: Record<string, any>; character?: Record<string, any> }> | null | undefined,
  limit = 16
): OnlineSearchResult[] {
  if (!show?.name || !Array.isArray(cast) || cast.length === 0) return [];
  const showName = String(show.name).trim();
  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(String(show.premiered || ''));
  const year = yearMatch ? yearMatch[1] : undefined;

  const out: OnlineSearchResult[] = [];
  const seen = new Set<string>();
  for (const entry of cast) {
    const ch = entry?.character;
    const actor = entry?.person;
    const name = typeof ch?.name === 'string' ? ch.name.trim() : '';
    if (!name) continue;
    const key = normalizeEntityKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const actorName =
      typeof actor?.name === 'string' && actor.name.trim()
        ? actor.name.trim()
        : undefined;
    const coverUrl = upgradeToHttpsUrl(
      ch?.image?.original || ch?.image?.medium || actor?.image?.medium
    );

    out.push({
      externalId: `tvmaze-char-${ch?.id || key}`,
      category: 'character',
      title: name,
      year,
      subtitle: actorName
        ? `出自《${showName}》 · ${actorName} 饰演`
        : `出自《${showName}》`,
      coverUrl,
      summary: `剧集《${showName}》中的主要角色${
        actorName ? `，由 ${actorName} 饰演` : ''
      }。`,
      relatedWorkTitle: showName,
      portrayedBy: actorName,
      sourceName: 'TVMaze 剧集库',
      sourceUrl: upgradeToHttpsUrl(ch?.url || show.url),
      tags: ['剧集角色', showName],
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Validates whether a Baidu Baike card genuinely describes a fictional / film / TV / anime character
 * (as opposed to an unrelated encyclopedia topic or a pure film entry without character metadata).
 */
export function isPlausibleCharacterBaikeBundle(
  bundle: ParsedBaikeBundle,
  query: string
): boolean {
  const item = bundle.searchResult;
  if (!item || !item.title) return false;

  const text = `${item.subtitle || ''} ${item.summary || ''} ${
    bundle.characterProfile.identity || ''
  } ${bundle.characterProfile.firstAppearance || ''}`;

  const hasCharacterFields = Boolean(
    item.portrayedBy ||
      item.relatedWorkTitle ||
      bundle.characterProfile.abilities ||
      bundle.characterProfile.affiliation ||
      bundle.characterProfile.firstAppearance
  );
  const hasCharacterSignal =
    /(角色|人物|虚拟|虚构|主角|反派|配角|超级英雄|漫画|动画|动漫|小说|饰演|扮演|配音|声优|登场|漫威|DC|哈利|火影|海贼|仙侠|英雄|侠|怪兽|侦探)/.test(
      text
    );
  const looksPurelyLikeFilm =
    /执导.*(?:电影|电视剧|剧集|动作片|科幻片|剧情片)/.test(text) &&
    !hasCharacterFields &&
    !/(角色|虚拟人物|超级英雄|主人公|主角)/.test(item.subtitle || '');

  if (looksPurelyLikeFilm) return false;
  if (!hasCharacterFields && !hasCharacterSignal) return false;

  const candidates = [
    item.title,
    item.originalTitle || '',
    bundle.characterProfile.alias || '',
    query,
  ].filter(Boolean);

  return (
    isStrictCharacterQueryMatch(candidates.slice(0, 3), query) ||
    Boolean(item.portrayedBy || item.relatedWorkTitle)
  );
}

/**
 * Ranks character search results: exact query matches & Chinese-titled cards with portraits
 * and source-work/actor metadata rise to the top.
 */
export function rankCharacterResults(
  list: OnlineSearchResult[],
  query: string
): OnlineSearchResult[] {
  const nq = normalizeEntityKey(query);
  const scored = list.map((item, idx) => {
    const nt = normalizeEntityKey(item.title);
    const no = item.originalTitle ? normalizeEntityKey(item.originalTitle) : '';
    let score = 0;
    if (nt === nq || (no && no === nq)) score += 100;
    else if (nq && (nt.includes(nq) || (no && no.includes(nq)))) score += 60;
    else if (
      nq &&
      item.relatedWorkTitle &&
      normalizeEntityKey(item.relatedWorkTitle).includes(nq)
    ) {
      score += 45;
    }

    if (hasCjkChars(item.title)) score += 20;
    if (item.coverUrl) score += 18;
    if (item.portrayedBy) score += 12;
    if (item.relatedWorkTitle) score += 12;
    if (item.sourceName.includes('豆瓣') || item.sourceName.includes('IMDb')) {
      score += 8;
    }

    return { item, score, idx };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((s) => s.item);
}
