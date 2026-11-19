import { normalizeEntityKey } from './wikiCast';

export interface ParsedFilmographyEntry {
  year?: string;
  filmTitle: string;
  filmOriginalTitle?: string;
  filmWikiTitle?: string;
  characterName?: string;
  characterOriginalName?: string;
  characterWikiTitle?: string;
  mediaType: 'film' | 'tv';
  notes?: string;
}

export interface AggregatedActorCharacter {
  characterName: string;
  characterOriginalName?: string;
  characterWikiTitle?: string;
  filmTitles: string[];
  primaryFilmTitle: string;
  latestYear?: string;
  appearances: number;
}

const NON_CHARACTER_ROLE_RE =
  /^(他自己|她自己|自己|本人|未知|待公布|待宣布|待定|不详|不适用|无|暂无|未挂名|未署名|未列名|客串|特别出演|友情出演|主持|主持人|嘉宾|旁白|解说|配音|导演|监制|制片人|编剧|出品人|龙套|路人|群众演员|临时演员|himself|herself|self|unknown|uncredited|tba|tbd|n\/a|none|various|cameo|narrator|host|—|-|–|\?)$/i;

const IGNORED_TABLE_HEADER_RE =
  /(奖项|颁奖|典礼|提名|结果|专辑|唱片|单曲|曲目|销量|榜单|剧场|舞台剧|电台|广播|电子游戏|游戏平台)/;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function stripInterwikiComments(html: string): string {
  // Replace Wikipedia ilh-all blocks with ONLY their Chinese ilh-page text (avoids nested <span> inside ilh-comment)
  const simplifiedIlh = html.replace(
    /<span\b[^>]*class="[^"]*\bilh-all\b[^"]*"[^>]*>\s*<span\b[^>]*class="[^"]*\bilh-page\b[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/span>\s*<\/span>/gi,
    '$1'
  );
  return simplifiedIlh
    .replace(/<span\b[^>]*class="[^"]*\bilh-comment\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

function extractForeignTitleFromIlh(html: string): string | undefined {
  const m = /data-foreign-title="([^"]+)"/i.exec(html);
  if (!m) return undefined;
  return decodeHtmlEntities(m[1])
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

function extractWikiTitle(html: string): string | undefined {
  const cleaned = html.replace(
    /<span\b[^>]*class="[^"]*\bilh-comment\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
    ''
  );
  const m = /<a\b[^>]*href="\/wiki\/([^"#?]+)"/i.exec(cleaned);
  if (!m) return undefined;
  let raw = '';
  try {
    raw = decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
  } catch {
    return undefined;
  }
  if (
    !raw ||
    /^(File|Image|Category|Special|Help|Wikipedia|Template|文件|分类|Portal):/i.test(
      raw
    )
  ) {
    return undefined;
  }
  return raw;
}

function cleanCellText(html: string): string {
  const withoutComments = stripInterwikiComments(html)
    .replace(/<br\s*\/?>/gi, '／')
    .replace(/<\/li>/gi, '／');
  return decodeHtmlEntities(withoutComments.replace(/<[^>]+>/g, ''))
    .replace(/\[[0-9a-zA-Z注来源请求\s]+\]/g, '')
    .replace(/[（(]\s*(?:英语|英文|日语|法语|韩语)\s*[：:][^）)]*[）)]/g, '')
    .replace(/(?:英语|英文|日语|法语|韩语)\s*[：:].*$/g, '')
    .replace(/《|》/g, '')
    .replace(/\s*／\s*/g, '／')
    .replace(/^／+|／+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYearFromText(text: string): string | undefined {
  const matches = text.match(/\b(19\d{2}|20\d{2})\b/g);
  if (!matches || matches.length === 0) return undefined;
  return matches[matches.length - 1];
}

function splitRoleOriginal(rawRole: string): {
  name: string;
  original?: string;
} {
  let clean = rawRole.trim();
  let original: string | undefined;
  const paren = /[（(]([A-Za-z][A-Za-z0-9\s'’.\-/／&]{2,})[）)]/.exec(clean);
  if (paren) {
    original = paren[1].trim();
    clean = clean.replace(paren[0], '').trim();
  }
  clean = clean
    .replace(/[（(](?:配音|声演|客串|未挂名|未署名|青年|少年|童年|老年|饰|演|兼任[^）)]*)[）)]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[：:；;，,]+$/, '')
    .trim();
  return { name: clean, original };
}

/**
 * Checks whether a parsed "角色" cell represents an actual fictional character
 * rather than self-appearances ("他自己", "本人", "主持人") or placeholders ("未知", "—").
 */
export function isFictionalRoleName(role?: string): boolean {
  if (!role) return false;
  const clean = role.trim();
  if (!clean || clean.length < 1 || clean.length > 52) return false;
  if (NON_CHARACTER_ROLE_RE.test(clean)) return false;
  if (/^(他自己|她自己|本人|自己)[（(／/]/.test(clean)) return false;
  if (/^(未知|待定|待公布|待宣布|未挂名|未署名|客串|不适用|不详|无)/.test(clean)) return false;
  if (/^\d{4}$/.test(clean)) return false;
  return true;
}

/**
 * Extracts a dedicated filmography subpage title (e.g. "小勞勃·道尼作品列表")
 * from an actor's main Wikipedia section hatnote ("主条目：...").
 */
export function extractFilmographySubpageTitle(html: string): string | undefined {
  if (!html) return undefined;
  const linkRe = /<a\b[^>]*href="\/wiki\/([^"#?]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    let decoded = '';
    try {
      decoded = decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
    } catch {
      continue;
    }
    if (/(作品列表|影视作品|演出列表|电影作品|filmography)/i.test(decoded)) {
      return decoded;
    }
  }
  return undefined;
}

interface TableCell {
  html: string;
  text: string;
  isHeader: boolean;
  rowspan: number;
  colspan: number;
}

function parseRowCells(rowHtml: string): TableCell[] {
  const cells: TableCell[] = [];
  const cellRe = /<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const attrs = m[2] || '';
    const rowspanMatch = /rowspan\s*=\s*"?(\d+)"?/i.exec(attrs);
    const colspanMatch = /colspan\s*=\s*"?(\d+)"?/i.exec(attrs);
    const rowspan = rowspanMatch ? Math.max(1, Number(rowspanMatch[1])) : 1;
    const colspan = colspanMatch ? Math.max(1, Number(colspanMatch[1])) : 1;
    cells.push({
      html: m[3],
      text: cleanCellText(m[3]),
      isHeader: m[1].toLowerCase() === 'th',
      rowspan,
      colspan,
    });
  }
  return cells;
}

/**
 * Parses Chinese Wikipedia actor filmography tables (handling rowspan, ilh links,
 * and skipping awards/discography/video-game tables).
 */
export function parseZhWikiFilmographyHtml(
  html: string,
  defaultMedia: 'film' | 'tv' = 'film'
): ParsedFilmographyEntry[] {
  if (!html || typeof html !== 'string') return [];

  const entries: ParsedFilmographyEntry[] = [];
  const seen = new Set<string>();

  // Walk headings and tables in document order so we know whether a table is TV vs Film vs Games/Music
  const tokenRe =
    /(<h[234]\b[^>]*>[\s\S]*?<\/h[234]>|<table\b[^>]*>[\s\S]*?<\/table>)/gi;
  let currentSectionMode: 'film' | 'tv' | 'skip' = defaultMedia;
  let tokenMatch: RegExpExecArray | null;

  while ((tokenMatch = tokenRe.exec(html)) !== null) {
    const token = tokenMatch[1];
    if (/^<h[234]/i.test(token)) {
      const heading = cleanCellText(token);
      if (
        /(电子游戏|游戏|音乐|唱片|专辑|MV|音乐录影带|舞台|话剧|电台|广播|奖项|获奖|提名|参考文献|外部链接|制片|监制|导演作品)/i.test(
          heading
        )
      ) {
        currentSectionMode = 'skip';
      } else if (/(电视|剧集|连续剧|网剧|综艺)/i.test(heading)) {
        currentSectionMode = 'tv';
      } else if (/(电影|影视|作品|短片|动画)/i.test(heading)) {
        currentSectionMode = 'film';
      }
      continue;
    }

    if (currentSectionMode === 'skip') continue;

    // Parse table rows with rowspan/colspan expansion
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    let yearCol = -1;
    let titleCol = -1;
    let roleCol = -1;
    let notesCol = -1;
    let headerFound = false;
    let skipTable = false;

    const activeSpans: Array<{ cell: TableCell; remaining: number } | null> = [];

    while ((rowMatch = rowRe.exec(token)) !== null) {
      const rawCells = parseRowCells(rowMatch[1]);
      if (rawCells.length === 0) continue;

      // Expand row taking carried rowspans into account
      const expanded: TableCell[] = [];
      let rawIdx = 0;
      let col = 0;
      while (rawIdx < rawCells.length || col < activeSpans.length) {
        const span = activeSpans[col];
        if (span && span.remaining > 0) {
          expanded.push(span.cell);
          span.remaining -= 1;
          if (span.remaining <= 0) activeSpans[col] = null;
          col += 1;
        } else if (rawIdx < rawCells.length) {
          const cell = rawCells[rawIdx++];
          for (let c = 0; c < cell.colspan; c++) {
            expanded.push(cell);
            if (cell.rowspan > 1) {
              activeSpans[col] = { cell, remaining: cell.rowspan - 1 };
            }
            col += 1;
          }
        } else {
          col += 1;
        }
      }

      if (!headerFound && expanded.some((c) => c.isHeader)) {
        const headerJoined = expanded.map((c) => c.text).join(' ');
        if (IGNORED_TABLE_HEADER_RE.test(headerJoined)) {
          skipTable = true;
          break;
        }

        const yIdx = expanded.findIndex((c) => /年份|年代|首映|首播|日期/.test(c.text));
        const tIdx = expanded.findIndex((c) =>
          /片名|名称|剧名|作品|电影|电视|译名|中文/.test(c.text)
        );
        const rIdx = expanded.findIndex((c) => /角色|饰演|人物|扮演|配音/.test(c.text));
        const nIdx = expanded.findIndex((c) => /说明|备注|附注|注释|性质/.test(c.text));

        if (tIdx >= 0) {
          yearCol = yIdx;
          titleCol = tIdx;
          roleCol = rIdx;
          notesCol = nIdx;
          headerFound = true;
          continue;
        }
      }

      if (skipTable || !headerFound || titleCol < 0) continue;
      if (expanded.every((c) => c.isHeader)) continue;

      const titleCell = expanded[titleCol];
      if (!titleCell || !titleCell.text || titleCell.text.length > 70) continue;

      const filmTitle = titleCell.text.split('／')[0].trim();
      if (!filmTitle || /^(片名|作品|电影|剧名|名称)$/.test(filmTitle)) continue;

      const yearText = yearCol >= 0 && expanded[yearCol] ? expanded[yearCol].text : '';
      const year = extractYearFromText(yearText);

      const filmWikiTitle = extractWikiTitle(titleCell.html);
      const filmOriginalTitle = extractForeignTitleFromIlh(titleCell.html);

      const roleCell = roleCol >= 0 ? expanded[roleCol] : undefined;
      let characterName: string | undefined;
      let characterOriginalName: string | undefined;
      let characterWikiTitle: string | undefined;

      if (roleCell && roleCell.text) {
        const split = splitRoleOriginal(roleCell.text);
        if (isFictionalRoleName(split.name)) {
          characterName = split.name;
          characterOriginalName =
            split.original || extractForeignTitleFromIlh(roleCell.html);
          characterWikiTitle = extractWikiTitle(roleCell.html);
        }
      }

      const notes =
        notesCol >= 0 && expanded[notesCol]
          ? expanded[notesCol].text.slice(0, 80)
          : undefined;

      const dedupeKey = `${normalizeEntityKey(filmTitle)}::${year || ''}::${normalizeEntityKey(
        characterName || ''
      )}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      entries.push({
        year,
        filmTitle,
        filmOriginalTitle,
        filmWikiTitle,
        characterName,
        characterOriginalName,
        characterWikiTitle,
        mediaType: currentSectionMode,
        notes,
      });
    }
  }

  return entries;
}

/**
 * Aggregates all fictional roles played by an actor across their filmography,
 * deduplicating recurring characters (e.g. Tony Stark / Iron Man across 10 MCU films)
 * and ranking iconic / recurring / wiki-linked / recent roles first.
 */
export function aggregatePersonCharacters(
  entries: ParsedFilmographyEntry[]
): AggregatedActorCharacter[] {
  const byKey = new Map<string, AggregatedActorCharacter>();
  const aliasToKey = new Map<string, string>();

  const getAliasKeys = (name: string, orig?: string): string[] => {
    const keys: string[] = [];
    const full = normalizeEntityKey(name);
    if (full.length >= 2) keys.push(full);
    for (const part of name.split(/[／/]/)) {
      const pk = normalizeEntityKey(part);
      if (pk.length >= 2) keys.push(pk);
    }
    if (orig) {
      for (const part of orig.split(/[／/]/)) {
        const ok = normalizeEntityKey(part);
        if (ok.length >= 3) keys.push(`orig:${ok}`);
      }
    }
    return keys;
  };

  for (const entry of entries) {
    if (!entry.characterName || !isFictionalRoleName(entry.characterName)) {
      continue;
    }

    const keys = getAliasKeys(entry.characterName, entry.characterOriginalName);
    if (keys.length === 0) continue;

    let canonicalKey: string | undefined;
    for (const k of keys) {
      const hit = aliasToKey.get(k);
      if (hit) {
        canonicalKey = hit;
        break;
      }
    }

    if (canonicalKey) {
      const prev = byKey.get(canonicalKey)!;
      if (!prev.filmTitles.includes(entry.filmTitle)) {
        prev.filmTitles.push(entry.filmTitle);
        prev.appearances = prev.filmTitles.length;
      }
      // Prefer richer combined name (e.g. "托尼·史塔克／钢铁侠" over "托尼·史塔克")
      if (entry.characterName.length > prev.characterName.length) {
        prev.characterName = entry.characterName;
      }
      if (!prev.characterOriginalName && entry.characterOriginalName) {
        prev.characterOriginalName = entry.characterOriginalName;
      }
      if (!prev.characterWikiTitle && entry.characterWikiTitle) {
        prev.characterWikiTitle = entry.characterWikiTitle;
      }
      if (
        entry.year &&
        (!prev.latestYear || Number(entry.year) > Number(prev.latestYear))
      ) {
        prev.latestYear = entry.year;
      }
      for (const k of keys) aliasToKey.set(k, canonicalKey);
    } else {
      const key = keys[0];
      const rec: AggregatedActorCharacter = {
        characterName: entry.characterName,
        characterOriginalName: entry.characterOriginalName,
        characterWikiTitle: entry.characterWikiTitle,
        filmTitles: [entry.filmTitle],
        primaryFilmTitle: entry.filmTitle,
        latestYear: entry.year,
        appearances: 1,
      };
      byKey.set(key, rec);
      for (const k of keys) aliasToKey.set(k, key);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    // 1. Recurring iconic roles (2+ appearances) first
    if (a.appearances !== b.appearances) {
      return b.appearances - a.appearances;
    }
    // 2. Characters with dedicated Wikipedia articles next
    const aWiki = a.characterWikiTitle ? 1 : 0;
    const bWiki = b.characterWikiTitle ? 1 : 0;
    if (aWiki !== bWiki) return bWiki - aWiki;
    // 3. Newest year first
    const ya = Number(a.latestYear || '0') || 0;
    const yb = Number(b.latestYear || '0') || 0;
    return yb - ya;
  });
}
