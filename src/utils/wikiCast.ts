export interface ParsedCastEntry {
  actorName: string;
  actorWikiTitle?: string;
  characterName: string;
  characterWikiTitle?: string;
  characterOriginalName?: string;
  summary: string;
}

const NON_PHOTO_EXT_RE = /\.(svg|gif|tif|tiff|pdf|ogg|ogv|webm|ico|bmp)(\?|$)/i;
const BAD_PHOTO_KEYWORD_RE =
  /(clipart|logo|icon|symbol|drawing|sketch|cartoon|silhouette|placeholder|flag_of|coat_of_arms|signature|autograph|text_only|wordmark|emblem|crest|diagram|map_of)/i;
const TOY_OR_COSTUME_RE =
  /(cosplay|costume|statue|figure|toy|lego|doll|wax|mannequin|d23[_\s-]expo|display|prop|armor|helmet|merch|bust|figurine|action[_\s-]figure)/i;
const FILM_POSTER_RE =
  /(theatrical[_\s-]poster|film[_\s-]poster|movie[_\s-]poster|tv[_\s-]poster|drama[_\s-]poster|dvd[_\s-]cover|blu-?ray)/i;

/**
 * Accepts real photographic image filenames/URLs from Wikimedia Commons / Wikipedia
 * and rejects SVGs, logos, cliparts, signatures, and cartoons (e.g., "Marvel Thor.svg").
 * Intentionally allows real actor photos taken at Comic-Con / premieres.
 */
export function isAcceptablePhoto(filenameOrUrl?: string): boolean {
  if (!filenameOrUrl || typeof filenameOrUrl !== 'string') return false;
  const decoded = (() => {
    try {
      return decodeURIComponent(filenameOrUrl);
    } catch {
      return filenameOrUrl;
    }
  })();
  const clean = decoded.trim();
  if (!clean) return false;
  if (NON_PHOTO_EXT_RE.test(clean)) return false;
  if (BAD_PHOTO_KEYWORD_RE.test(clean)) return false;
  return true;
}

/**
 * Extra guard applied ONLY to fictional character P18 fallbacks
 * to avoid cosplay, D23 expo mannequins, statues, or action figures.
 */
export function isAcceptableCharacterFallbackPhoto(
  filenameOrUrl?: string
): boolean {
  if (!isAcceptablePhoto(filenameOrUrl)) return false;
  const decoded = (() => {
    try {
      return decodeURIComponent(filenameOrUrl || '');
    } catch {
      return filenameOrUrl || '';
    }
  })();
  return !TOY_OR_COSTUME_RE.test(decoded);
}

/**
 * Rejects whole-movie theatrical posters accidentally returned when a character page
 * redirects to the film's main Wikipedia article (e.g. Dom Cobb -> Inception).
 */
export function isFilmPosterImage(filenameOrUrl?: string): boolean {
  if (!filenameOrUrl) return false;
  const decoded = (() => {
    try {
      return decodeURIComponent(filenameOrUrl);
    } catch {
      return filenameOrUrl;
    }
  })();
  return FILM_POSTER_RE.test(decoded);
}

/**
 * Ranks in-character images so live-action movie stills (e.g. "Chris_Hemsworth_as_Thor.jpg")
 * and official Bangumi character art beat generic comic-book covers during multi-source merges.
 */
export function scoreCharacterImage(url?: string): number {
  if (!url) return 0;
  const decoded = (() => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  })();
  // Bangumi official character portrait
  if (/lain\.bgm\.tv\/pic\/crt\//i.test(decoded)) return 4;
  // Live-action movie/TV still (e.g. "Chris_Evans_as_Steve_Rogers_Captain_America.jpg")
  if (/[_\s]as[_\s]/i.test(decoded) || /in[_\s].*poster/i.test(decoded)) {
    return 4;
  }
  // TVMaze character still
  if (/tvmaze\.com/i.test(decoded)) return 3;
  // Fair-use Wikipedia character artwork / still
  if (/upload\.wikimedia\.org\/wikipedia\/(en|zh)\//i.test(decoded)) return 2;
  return 1;
}

export function normalizeEntityKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s·・•‧\-_'’"“”《》【】()（）/／]+/g, '');
}

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

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[[0-9a-zA-Z注\s]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function extractFirstWikiTitle(htmlSnippet: string): string | undefined {
  const m =
    /<a\b[^>]*href="\/wiki\/([^"#?]+)"/i.exec(htmlSnippet);
  if (!m) return undefined;
  const raw = decodeURIComponent(m[1]).replace(/_/g, ' ');
  if (
    !raw ||
    /^(File|Image|Category|Special|Help|Wikipedia|Template|文件|分类):/i.test(raw)
  ) {
    return undefined;
  }
  return raw.trim();
}

function splitOriginalName(rawChar: string): {
  characterName: string;
  characterOriginalName?: string;
} {
  let clean = rawChar.trim();

  let original: string | undefined;
  const parenMatch = /[（(]([A-Za-z][A-Za-z0-9\s'’.\-/／&]+)[）)]/.exec(clean);
  if (parenMatch) {
    original = parenMatch[1].trim();
    clean = clean.replace(parenMatch[0], '').trim();
  }

  // Strip leading descriptive role quotes like “盗梦者”－唐姆·柯布 -> 唐姆·柯布
  const dashRole = /^[“"「『][^”"」』]{1,12}[”"」』]\s*[\-－—·]\s*(.+)$/.exec(
    clean
  );
  if (dashRole && dashRole[1].trim().length >= 2) {
    clean = dashRole[1].trim();
  }

  clean = clean
    .replace(/^["“「『]+/, '')
    .replace(/["”」』]+$/, '')
    .replace(/[：:，,。；;]+$/, '')
    .trim();
  return {
    characterName: clean,
    characterOriginalName: original,
  };
}

function cleanActorName(rawActor: string): string {
  return rawActor
    .replace(/[（(][^）)]{1,30}[）)]/g, '')
    .replace(/[：:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses Chinese Wikipedia cast section HTML (supports both <li> bullet lists and <table> rows).
 */
export function parseZhWikiCastHtml(html: string): ParsedCastEntry[] {
  if (!html || typeof html !== 'string') return [];

  const entries: ParsedCastEntry[] = [];
  const seenActors = new Set<string>();

  const pushEntry = (entry: ParsedCastEntry) => {
    const actor = entry.actorName.trim();
    const charName = entry.characterName.trim();
    if (!actor || actor.length > 36) return;
    if (!charName || charName.length > 48) return;
    // Ignore table header words or boilerplate
    if (/^(演员|角色|人物|简介|备注|配音|演出|集数|登场)$/.test(actor)) return;
    if (/^(演员|角色|人物|简介|备注|配音|演出|集数|登场)$/.test(charName)) return;

    const key = `${normalizeEntityKey(actor)}::${normalizeEntityKey(charName)}`;
    if (seenActors.has(key)) return;
    seenActors.add(key);
    entries.push({
      ...entry,
      actorName: actor,
      characterName: charName,
    });
  };

  // 1. Parse <li> items: "演员 饰演/饰/配音 角色（English）：简介"
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liRegex.exec(html)) !== null) {
    // Strip nested sublists or <dl> sub-paragraphs so we only parse the top line
    const topHtml = liMatch[1]
      .replace(/<ul[\s\S]*?<\/ul>/gi, '')
      .replace(/<dl[\s\S]*?<\/dl>/gi, '');
    const text = stripTags(topHtml);
    if (!text || text.length < 4) continue;

    // Match separator: 饰演 / 演出 / 声演 / 配音 / 饰 / 演
    const sepRe =
      /^(.{1,40}?)(?:\s*[：:]\s*)?(?:饰演|声演|饰|演|配音|出演)\s*(.+)$/;
    const m = sepRe.exec(text);
    if (!m) continue;

    const rawActor = cleanActorName(m[1]);
    const rest = m[2].trim();
    if (!rawActor || !rest) continue;

    // Split character name from bio description by Chinese/ASCII colon or period
    const bioSplit = /^([^：:。\n]{1,70})(?:[：:。]\s*([\s\S]*))?$/.exec(rest);
    if (!bioSplit) continue;

    const { characterName, characterOriginalName } = splitOriginalName(
      bioSplit[1]
    );
    const bio = (bioSplit[2] || '').trim().slice(0, 140);

    // Extract wiki article titles for BOTH actor (before separator) AND character (after separator, before bio colon)
    const sepMatchInHtml = /(?:饰演|声演|饰|演|配音|出演)/.exec(topHtml);
    const actorHtmlPart = sepMatchInHtml
      ? topHtml.slice(0, sepMatchInHtml.index)
      : topHtml;
    const afterSepHtml = sepMatchInHtml
      ? topHtml.slice(sepMatchInHtml.index + sepMatchInHtml[0].length)
      : '';
    const charHtmlBeforeBio = afterSepHtml.split(/[：:。]/)[0] || afterSepHtml;

    const actorWikiTitle = extractFirstWikiTitle(actorHtmlPart);
    const characterWikiTitle = extractFirstWikiTitle(charHtmlBeforeBio);

    pushEntry({
      actorName: rawActor,
      actorWikiTitle,
      characterName,
      characterWikiTitle,
      characterOriginalName,
      summary: bio,
    });
  }

  // 2. Parse <table> rows (common in Chinese TV dramas / older movies)
  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    let actorCol = 0;
    let charCol = 1;
    let descCol = 2;
    let headerParsed = false;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells = [
        ...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
      ].map((c) => ({
        html: c[1],
        text: stripTags(c[1]),
        isHeader: /^<th/i.test(c[0]),
      }));
      if (cells.length < 2) continue;

      if (!headerParsed && cells.some((c) => c.isHeader)) {
        const aIdx = cells.findIndex((c) => /演员|配音|声优|主演/.test(c.text));
        const cIdx = cells.findIndex((c) => /角色|人物|饰演|剧中/.test(c.text));
        const dIdx = cells.findIndex((c) => /简介|介绍|说明|备注/.test(c.text));
        if (aIdx >= 0 && cIdx >= 0) {
          actorCol = aIdx;
          charCol = cIdx;
          descCol = dIdx >= 0 ? dIdx : -1;
          headerParsed = true;
          continue;
        }
        if (cells.every((c) => c.isHeader)) {
          headerParsed = true;
          continue;
        }
      }

      if (cells.every((c) => c.isHeader)) continue;
      const actorCell = cells[actorCol];
      const charCell = cells[charCol];
      if (!actorCell || !charCell) continue;

      const actorName = cleanActorName(actorCell.text);
      const { characterName, characterOriginalName } = splitOriginalName(
        charCell.text
      );
      const descText =
        descCol >= 0 && cells[descCol] ? cells[descCol].text.slice(0, 140) : '';

      pushEntry({
        actorName,
        actorWikiTitle: extractFirstWikiTitle(actorCell.html),
        characterName,
        characterWikiTitle: extractFirstWikiTitle(charCell.html),
        characterOriginalName,
        summary: descText,
      });
    }
  }

  return entries;
}

