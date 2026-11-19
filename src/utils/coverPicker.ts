export interface CoverCandidate {
  id: string;
  url: string;
  source: string;
  caption?: string;
}

function normalizeMatchText(raw?: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[《》「」『』【】()（）·•.,:'"`/／\-_!?！？\s]+/g, '');
}

function tokenizeLatin(raw?: string): string[] {
  return (raw || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3 && !['the', 'and', 'for', 'with', 'from'].includes(tok));
}

/**
 * Scores how closely a cover candidate's caption matches the target entity's
 * title or original title, filtering out unrelated fuzzy search hits.
 */
export function scoreCoverCandidateRelevance(
  caption: string | undefined,
  query: string,
  originalTitle?: string
): number {
  const capNorm = normalizeMatchText(caption);
  if (!capNorm) return 1;

  const qNorm = normalizeMatchText(query);
  const origNorm = normalizeMatchText(originalTitle);

  if (qNorm && (capNorm === qNorm || capNorm.includes(qNorm) || qNorm.includes(capNorm))) {
    return 10;
  }
  if (origNorm && (capNorm === origNorm || capNorm.includes(origNorm) || origNorm.includes(capNorm))) {
    return 10;
  }

  // Check multi-token Latin match (e.g., "Robert Downey" in "Robert Downey Jr. 2014 Comic Con")
  const origTokens = tokenizeLatin(originalTitle || query);
  if (origTokens.length >= 2) {
    const matched = origTokens.filter((t) => capNorm.includes(t)).length;
    if (matched >= 2) return 8;
    if (matched === 1) return 2;
  } else if (origTokens.length === 1 && capNorm.includes(origTokens[0])) {
    return 6;
  }

  // Check CJK substring overlap (at least 2 consecutive characters for Chinese names/titles)
  const cjkTarget = (query.match(/[\u4e00-\u9fff]{2,}/g) || []).join('');
  if (cjkTarget.length >= 2) {
    const head = cjkTarget.slice(0, 2);
    const tail = cjkTarget.slice(-2);
    if (capNorm.includes(head) && capNorm.includes(tail)) return 7;
    if (capNorm.includes(head) || capNorm.includes(tail)) return 3;
  }

  return 0;
}

/**
 * Unwraps `/api/img-proxy?url=...` to obtain the canonical underlying image URL
 * for deduplication purposes.
 */
export function unwrapProxyImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/api/img-proxy?')) {
    try {
      const parsed = new URL(trimmed, 'http://local.invalid');
      const inner = parsed.searchParams.get('url');
      if (inner) return inner.trim();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Normalizes and deduplicates cover image candidates by canonical URL while
 * preserving priority ordering.
 */
export function deduplicateCoverCandidates(
  candidates: CoverCandidate[],
  limit = 18
): CoverCandidate[] {
  const seen = new Set<string>();
  const result: CoverCandidate[] = [];

  for (const cand of candidates) {
    const rawUrl = (cand.url || '').trim();
    if (!rawUrl) continue;

    const canonical = unwrapProxyImageUrl(rawUrl)
      .replace(/^http:\/\//i, 'https://')
      .replace(/\/+$/, '')
      .toLowerCase();

    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push({
      ...cand,
      url: rawUrl,
      source: cand.source.trim() || '网络图库',
      caption: cand.caption?.trim() || undefined,
    });

    if (result.length >= limit) break;
  }

  return result;
}

/**
 * Deduplicates, drops clearly off-topic fuzzy candidates (score === 0 when
 * strong matches exist), and ranks exact/on-target candidates first.
 */
export function rankAndFilterCoverCandidates(
  candidates: CoverCandidate[],
  query: string,
  originalTitle?: string,
  limit = 18
): CoverCandidate[] {
  const deduped = deduplicateCoverCandidates(candidates, limit * 2);
  const scored = deduped.map((cand, index) => {
    const isDouban = cand.source.startsWith('豆瓣');
    const baseScore = scoreCoverCandidateRelevance(
      cand.caption,
      query,
      originalTitle
    );
    const boost =
      cand.source === '豆瓣海报' || cand.source === '豆瓣影人'
        ? 4
        : isDouban
          ? 2
          : 0;
    return {
      cand,
      index,
      score: Math.max(baseScore, isDouban ? 8 : 0) + boost,
    };
  });

  const relevant = scored.filter((entry) => entry.score >= 3);
  const pool = relevant.length >= 2 ? relevant : scored.filter((e) => e.score > 0);
  const finalPool = pool.length > 0 ? pool : scored;

  finalPool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return finalPool.slice(0, limit).map((e) => e.cand);
}

/**
 * Computes crisp target dimensions for client-side uploaded cover compression,
 * maintaining aspect ratio within maxWidth x maxHeight without upscaling.
 */
export function computeCoverResizeDimensions(
  width: number,
  height: number,
  maxWidth = 720,
  maxHeight = 1080
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));

  if (safeW <= maxWidth && safeH <= maxHeight) {
    return { width: safeW, height: safeH };
  }

  const ratio = Math.min(maxWidth / safeW, maxHeight / safeH);
  return {
    width: Math.max(1, Math.round(safeW * ratio)),
    height: Math.max(1, Math.round(safeH * ratio)),
  };
}

/**
 * Validates a user-provided custom cover image URL or Data URL.
 */
export function validateCustomCoverUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: '请输入图片链接' };
  }
  if (trimmed.startsWith('data:image/')) {
    return { ok: true, url: trimmed };
  }
  if (trimmed.startsWith('/api/img-proxy?url=') || trimmed.startsWith('/src/assets/')) {
    return { ok: true, url: trimmed };
  }

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: '仅支持 http 或 https 图片链接' };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: '图片链接格式不正确，请以 https:// 开头' };
  }
}

export interface SealGridCharacters {
  /** Traditional right column (read first, top to bottom) */
  rightCol: [string, string];
  /** Traditional left column (read second, top to bottom) */
  leftCol: [string, string];
}

/**
 * Maps a Chinese archival stamp title into a traditional 2x2 vertical
 * right-to-left seal impression grid (e.g. "首件入藏" -> right: 首/件, left: 入/藏).
 */
export function splitSealCharacters(title: string): SealGridCharacters {
  const chars = Array.from(title.replace(/\s+/g, '').trim());
  if (chars.length >= 4) {
    return {
      rightCol: [chars[0], chars[1]],
      leftCol: [chars[2], chars[3]],
    };
  }
  if (chars.length === 3) {
    return {
      rightCol: [chars[0], chars[1]],
      leftCol: [chars[2], '印'],
    };
  }
  if (chars.length === 2) {
    return {
      rightCol: [chars[0], chars[1]],
      leftCol: ['之', '印'],
    };
  }
  const ch = chars[0] || '藏';
  return {
    rightCol: [ch, '影'],
    leftCol: ['之', '印'],
  };
}
