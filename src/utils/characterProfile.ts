import type { ArchiveItem, CharacterProfile } from '../types/archive';
import { normalizeEntityKey } from './wikiCast';

export interface DossierSpecRow {
  key: string;
  label: string;
  value: string;
  wide?: boolean;
}

export function splitCharacterTitle(title: string): {
  primaryName: string;
  secondaryAlias?: string;
} {
  const trimmed = title.trim();
  if (!trimmed) return { primaryName: '' };
  const parts = trimmed
    .split(/[／/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return { primaryName: trimmed };
  }
  return {
    primaryName: parts[0],
    secondaryAlias: parts.slice(1).join(' / '),
  };
}

export function isSameEntityTitle(
  candidateTitle?: string,
  otherTitle?: string
): boolean {
  if (!candidateTitle || !otherTitle) return false;
  const a = normalizeEntityKey(
    candidateTitle.replace(/\s*[（(][^）)]*[）)]\s*$/g, '')
  );
  const b = normalizeEntityKey(
    otherTitle.replace(/\s*[（(][^）)]*[）)]\s*$/g, '')
  );
  if (!a || !b) return false;
  return a === b;
}

export function cleanWikiExtract(raw?: string | null, maxLen = 420): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw
    .replace(/\[[0-9a-zA-Z注来源请求\s]+\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\r?\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (!text) return '';
  if (text.length <= maxLen) return text;

  const sliced = text.slice(0, maxLen);
  const lastPeriod = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('. ')
  );
  if (lastPeriod >= Math.floor(maxLen * 0.55)) {
    return sliced.slice(0, lastPeriod + 1).trim();
  }
  return `${sliced.trim()}…`;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function cleanInfoboxCellHtml(html: string): string {
  const withBreaks = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n');

  const stripped = decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
    .replace(/\[[0-9a-zA-Z注来源请求\s]+\]/g, '')
    .replace(/[ \t]+/g, ' ');

  const parts = Array.from(
    new Set(
      stripped
        .split(/\r?\n+/)
        .map((s) => s.replace(/^[·•、,，;\s]+|[·•、,，;\s]+$/g, '').trim())
        .filter(Boolean)
    )
  ).slice(0, 6);

  return parts.join(' · ').slice(0, 120);
}

/**
 * Parses Chinese Wikipedia section-0 infobox HTML for fictional characters
 * (covers MCU/DC comics, movies, Chinese dramas, and anime/novels).
 */
export function parseZhWikiCharacterInfobox(
  html: string
): Partial<CharacterProfile> {
  if (!html || typeof html !== 'string') return {};
  const tableMatch =
    /<table\b[^>]*class="[^"]*infobox[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(
      html
    );
  if (!tableMatch) return {};

  const out: Partial<CharacterProfile> = {};
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
    const rowHtml = rowMatch[1];
    const thMatch = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(rowHtml);
    const tdMatch = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(rowHtml);
    if (!thMatch || !tdMatch) continue;

    const label = cleanInfoboxCellHtml(thMatch[1]).replace(/[：:\s]+/g, '');
    const value = cleanInfoboxCellHtml(tdMatch[1]);
    if (!label || !value) continue;

    if (!out.alias && /^(别名|称号|代号|外号|绰号|化名|全名|本名)$/.test(label)) {
      out.alias = value;
    } else if (
      !out.identity &&
      /^(身份|职业|职务|种族|物种|定位|头衔|阶级|类别)$/.test(label)
    ) {
      out.identity = value;
    } else if (
      !out.affiliation &&
      /^(隶属|所属|组织|阵营|团队|门派|势力|所属组织|所属团队|团体)$/.test(label)
    ) {
      out.affiliation = value;
    } else if (
      !out.origin &&
      /^(国籍|出生地|出身|家乡|籍贯|居住地|来自|星球|母星)$/.test(label)
    ) {
      out.origin = value;
    } else if (
      !out.abilities &&
      /^(能力|超能力|技能|武器|装备|专长|特技|武功|持有物)$/.test(label)
    ) {
      out.abilities = value;
    } else if (
      !out.firstAppearance &&
      /^(首次登场|初登场|首次出场|初次登场|登场作品)$/.test(label)
    ) {
      out.firstAppearance = value;
    } else if (!out.creator && /^(创作者|作者|原作|创造者|设计)$/.test(label)) {
      out.creator = value;
    }
  }

  return out;
}

/**
 * Extracts structured CharacterProfile fields from a Bangumi character infobox array.
 */
export function parseBangumiCharacterInfobox(
  infobox?: Array<{ key?: string; value?: unknown }>
): Partial<CharacterProfile> {
  if (!Array.isArray(infobox)) return {};
  const out: Partial<CharacterProfile> = {};

  const flattenVal = (val: unknown): string => {
    if (typeof val === 'string') return val.trim();
    if (Array.isArray(val)) {
      const items = val
        .map((entry: any) => {
          if (typeof entry === 'string') return entry.trim();
          if (entry && typeof entry.v === 'string') return entry.v.trim();
          return '';
        })
        .filter(Boolean);
      return Array.from(new Set(items)).slice(0, 5).join(' · ');
    }
    return '';
  };

  for (const row of infobox) {
    const key = typeof row?.key === 'string' ? row.key.trim() : '';
    const value = flattenVal(row?.value);
    if (!key || !value) continue;

    if (!out.alias && /^(别名|昵称|称号|纯假名|罗马字)$/.test(key)) {
      out.alias = value.slice(0, 100);
    } else if (!out.identity && /^(职业|身份|种族|性别|属性)$/.test(key)) {
      out.identity = value.slice(0, 100);
    } else if (!out.affiliation && /^(所属|组织|阵营|学校|团体|学院)$/.test(key)) {
      out.affiliation = value.slice(0, 100);
    } else if (!out.origin && /^(出身|出生地|国籍|籍贯|家乡)$/.test(key)) {
      out.origin = value.slice(0, 100);
    } else if (!out.abilities && /^(能力|技能|武器|装备|特长)$/.test(key)) {
      out.abilities = value.slice(0, 120);
    }
  }

  return out;
}

const PROFILE_TEXT_KEYS: Array<keyof Omit<CharacterProfile, 'enrichedAt'>> = [
  'alias',
  'identity',
  'affiliation',
  'origin',
  'abilities',
  'firstAppearance',
  'creator',
  'highlights',
  'bio',
  'dossierSource',
];

/**
 * Merges incoming online dossier fields into an existing profile without
 * overwriting any values already filled or edited by the user.
 */
export function mergeCharacterProfile(
  existing?: CharacterProfile,
  incoming?: Partial<CharacterProfile>
): CharacterProfile {
  const merged: CharacterProfile = { ...(existing || {}) };
  if (incoming) {
    for (const key of PROFILE_TEXT_KEYS) {
      const prevVal = merged[key]?.trim();
      const nextVal = incoming[key]?.trim();
      if (!prevVal && nextVal) {
        merged[key] = nextVal;
      }
    }
    if (incoming.enrichedAt) {
      merged.enrichedAt = incoming.enrichedAt;
    }
  }
  return merged;
}

export function hasDossierDetails(profile?: CharacterProfile): boolean {
  if (!profile) return false;
  return Boolean(
    profile.alias ||
      profile.identity ||
      profile.affiliation ||
      profile.origin ||
      profile.abilities ||
      profile.firstAppearance ||
      profile.creator ||
      profile.highlights ||
      profile.bio
  );
}

/**
 * Builds ordered archival specification rows for a character dossier card.
 */
export function buildDossierSpecs(item: ArchiveItem): DossierSpecRow[] {
  const p = item.characterProfile || {};
  const { secondaryAlias } = splitCharacterTitle(item.title);
  const resolvedAlias = p.alias?.trim() || secondaryAlias;

  const rows: DossierSpecRow[] = [];
  const push = (
    key: string,
    label: string,
    value?: string,
    wide = false
  ) => {
    const clean = value?.trim();
    if (!clean) return;
    rows.push({
      key,
      label,
      value: clean,
      wide: wide || clean.length > 22,
    });
  };

  push('alias', '别名 / 称号', resolvedAlias);
  push('identity', '身份定位', p.identity);
  push('affiliation', '所属阵营', p.affiliation);
  push('origin', '出身 / 籍贯', p.origin);
  push('abilities', '能力与特质', p.abilities, true);
  push('firstAppearance', '首次登场', p.firstAppearance);
  push('creator', '原案创作者', p.creator);

  return rows;
}
