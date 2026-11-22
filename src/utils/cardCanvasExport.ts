import type { ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS, getStatusLabel } from './archive';
import { computeItemCompleteness } from './collector';

export type PosterWallLayout = '2x2' | '3x3';
export type ExportTheme = 'ivory' | 'darkroom';

function loadCanvasImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), 4500);
    img.onload = () => {
      window.clearTimeout(timer);
      finish(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 16
) {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.clip();
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / Math.max(1, h);
  let drawW = w;
  let drawH = h;
  let dx = x;
  let dy = y;
  if (imgRatio > boxRatio) {
    drawH = h;
    drawW = h * imgRatio;
    dx = x - (drawW - w) / 2;
  } else {
    drawW = w;
    drawH = w / imgRatio;
    dy = y - (drawH - h) / 2;
  }
  ctx.drawImage(img, dx, dy, drawW, drawH);
  ctx.restore();
}

function drawFallbackPoster(
  ctx: CanvasRenderingContext2D,
  item: ArchiveItem,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 16
) {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.clip();
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (item.category === 'film') {
    grad.addColorStop(0, '#2B2520');
    grad.addColorStop(1, '#171412');
  } else if (item.category === 'person') {
    grad.addColorStop(0, '#272A2E');
    grad.addColorStop(1, '#141619');
  } else {
    grad.addColorStop(0, '#302220');
    grad.addColorStop(1, '#1A1312');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = 'rgba(212, 175, 106, 0.35)';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x + 16, y + 16, w - 32, h - 32, Math.max(8, r - 6));
  ctx.stroke();

  ctx.fillStyle = '#E4C37A';
  ctx.font = `600 ${Math.round(w * 0.16)}px "Noto Serif SC", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.title.slice(0, 2), x + w / 2, y + h * 0.45);

  ctx.fillStyle = 'rgba(245, 241, 232, 0.72)';
  ctx.font = `500 ${Math.max(18, Math.round(w * 0.055))}px "Noto Serif SC", Georgia, serif`;
  ctx.fillText(CATEGORY_LABELS[item.category], x + w / 2, y + h * 0.64);
  ctx.restore();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const lines: string[] = [];
  let current = '';

  for (const ch of clean) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = ch;
      if (lines.length === maxLines) {
        lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
        return lines;
      }
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function drawVermilionSeal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  text = '光影志'
) {
  ctx.save();
  drawRoundedRect(ctx, x, y, size, size, 10);
  ctx.fillStyle = '#B43B2B';
  ctx.fill();
  ctx.strokeStyle = '#DF7B6D';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x + 5, y + 5, size - 10, size - 10, 6);
  ctx.stroke();

  ctx.fillStyle = '#FFFDF9';
  ctx.font = `600 ${Math.round(size * 0.3)}px "Noto Serif SC", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 2), x + size / 2, y + size * 0.34);
  ctx.fillText(text.slice(2, 4) || '藏印', x + size / 2, y + size * 0.69);
  ctx.restore();
}

/**
 * Renders a museum-grade 1080×1560 archival collectible card PNG data URL.
 */
export async function renderCollectibleCardPng(
  item: ArchiveItem,
  theme: ExportTheme = 'darkroom'
): Promise<string> {
  const W = 1080;
  const H = 1560;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  const isDark = theme === 'darkroom';
  const completeness = computeItemCompleteness(item);
  const isMasterpiece = completeness.tier === 'masterpiece';

  // Background
  ctx.fillStyle = isDark ? '#171512' : '#F7F5F0';
  ctx.fillRect(0, 0, W, H);

  // Outer museum border
  const pad = 56;
  drawRoundedRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 36);
  ctx.fillStyle = isDark ? '#1F1C18' : '#FFFDF9';
  ctx.fill();
  ctx.strokeStyle = isMasterpiece
    ? '#C9A45C'
    : isDark
      ? '#3B352D'
      : '#DFD9CD';
  ctx.lineWidth = isMasterpiece ? 4 : 2;
  ctx.stroke();

  // Top Header Metadata
  ctx.fillStyle = isDark ? '#B8AFA2' : '#7A7268';
  ctx.font = '500 28px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `${item.accessionNo} · ${CATEGORY_LABELS[item.category]}档案`,
    pad + 44,
    pad + 42
  );

  // Tier label top-right
  ctx.textAlign = 'right';
  ctx.fillStyle = isMasterpiece ? '#D4AF6A' : isDark ? '#CFC7B9' : '#5A534B';
  ctx.font = '600 28px "Noto Serif SC", Georgia, serif';
  ctx.fillText(
    `${completeness.tierLabel} · ${completeness.score}/5`,
    W - pad - 44,
    pad + 40
  );

  // Poster frame
  const posterX = pad + 44;
  const posterY = pad + 102;
  const posterW = W - (pad + 44) * 2;
  const posterH = 820;

  const img = await loadCanvasImage(item.coverUrl);
  if (img) {
    drawImageCover(ctx, img, posterX, posterY, posterW, posterH, 24);
  } else {
    drawFallbackPoster(ctx, item, posterX, posterY, posterW, posterH, 24);
  }

  // Subtle frame outline
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(26,24,22,0.08)';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, posterX, posterY, posterW, posterH, 24);
  ctx.stroke();

  // Title & Rating
  const titleY = posterY + posterH + 46;
  ctx.textAlign = 'left';
  ctx.fillStyle = isDark ? '#FAF7F0' : '#1A1816';
  ctx.font = '600 54px "Noto Serif SC", Georgia, serif';
  const titleLines = wrapTextLines(ctx, item.title, posterW - 150, 2);
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, posterX, titleY + idx * 66);
  });

  if (item.rating > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = isDark ? '#E4C37A' : '#B43B2B';
    ctx.font = '600 44px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`★ ${item.rating}.0`, posterX + posterW, titleY + 6);
  }

  // Sub-meta line
  const metaY = titleY + titleLines.length * 66 + 12;
  ctx.textAlign = 'left';
  ctx.fillStyle = isDark ? '#A59D90' : '#6E665C';
  ctx.font = '400 28px system-ui, -apple-system, sans-serif';
  const metaParts = [
    item.originalTitle,
    item.year,
    item.region,
    getStatusLabel(item.status, item.category),
  ].filter(Boolean);
  const metaLine = wrapTextLines(ctx, metaParts.join(' · '), posterW, 1)[0] || '';
  ctx.fillText(metaLine, posterX, metaY);

  // Divider
  const divY = metaY + 54;
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : '#E4DFD5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(posterX, divY);
  ctx.lineTo(posterX + posterW, divY);
  ctx.stroke();

  // Quote or Excerpt
  const quoteText =
    item.quote?.trim() ||
    item.notes?.trim() ||
    item.summary?.trim() ||
    '收入私人光影档案馆，留存此刻心动。';
  ctx.fillStyle = isDark ? '#E6DFD2' : '#2E2A26';
  ctx.font = item.quote
    ? 'italic 32px "Noto Serif SC", Georgia, serif'
    : '400 29px system-ui, -apple-system, sans-serif';
  const qLines = wrapTextLines(
    ctx,
    item.quote ? `“${quoteText}”` : quoteText,
    posterW,
    3
  );
  qLines.forEach((line, idx) => {
    ctx.fillText(line, posterX, divY + 34 + idx * 46);
  });

  // Footer: Brand + Date + Vermilion Seal
  const footerY = H - pad - 122;
  ctx.fillStyle = isDark ? '#8C857B' : '#7A7268';
  ctx.font = '500 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  const tagsLine = item.tags.length > 0 ? item.tags.slice(0, 4).join(' · ') : '私人光影档案馆';
  ctx.fillText(tagsLine, posterX, footerY + 12);
  ctx.fillText(
    `光影志 CinéArchive · 入藏于 ${item.createdAt.slice(0, 10)}`,
    posterX,
    footerY + 52
  );

  drawVermilionSeal(ctx, posterX + posterW - 88, footerY, 88, '光影志');

  return canvas.toDataURL('image/png');
}

/**
 * Renders a 2×2 or 3×3 curated Poster Wall PNG data URL.
 */
export async function renderPosterWallPng(options: {
  items: ArchiveItem[];
  layout: PosterWallLayout;
  title: string;
  subtitle?: string;
  theme: ExportTheme;
}): Promise<string> {
  const { items, layout, title, subtitle, theme } = options;
  const cols = layout === '3x3' ? 3 : 2;
  const slots = cols * cols;
  const selected = items.slice(0, slots);
  const isDark = theme === 'darkroom';

  const W = 1080;
  const headerH = 210;
  const footerH = 148;
  const pad = 54;
  const gap = cols === 3 ? 22 : 28;
  const cellW = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols);
  const cellH = Math.round(cellW * (4 / 3));
  const H = headerH + cols * cellH + (cols - 1) * gap + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  // Canvas paper background
  ctx.fillStyle = isDark ? '#161411' : '#F7F5F0';
  ctx.fillRect(0, 0, W, H);

  // Subtle top editorial rule
  ctx.fillStyle = '#B43B2B';
  ctx.fillRect(pad, 48, 56, 6);

  // Header
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = isDark ? '#A59D90' : '#7A7268';
  ctx.font = '500 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    `光影志 · ${layout === '3x3' ? '九宫格片单' : '四格专题墙'}`,
    pad,
    70
  );

  ctx.fillStyle = isDark ? '#FAF7F0' : '#1A1816';
  ctx.font = '600 50px "Noto Serif SC", Georgia, serif';
  const safeTitle = wrapTextLines(ctx, title.trim() || '我的私人光影志', W - pad * 2, 1)[0];
  ctx.fillText(safeTitle, pad, 110);

  if (subtitle) {
    ctx.fillStyle = isDark ? '#9E9588' : '#6E665C';
    ctx.font = '400 24px system-ui, -apple-system, sans-serif';
    ctx.fillText(subtitle, pad, 172);
  }

  // Load images in parallel
  const loaded = await Promise.all(selected.map((it) => loadCanvasImage(it.coverUrl)));

  // Render Grid Cells
  for (let i = 0; i < slots; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cellW + gap);
    const y = headerH + row * (cellH + gap);
    const item = selected[i];

    if (!item) {
      drawRoundedRect(ctx, x, y, cellW, cellH, 18);
      ctx.fillStyle = isDark ? '#211E1A' : '#EFECE4';
      ctx.fill();
      ctx.strokeStyle = isDark ? '#342F28' : '#DCD6CB';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    const img = loaded[i];
    if (img) {
      drawImageCover(ctx, img, x, y, cellW, cellH, 18);
    } else {
      drawFallbackPoster(ctx, item, x, y, cellW, cellH, 18);
    }

    // Bottom contrast scrim for title legibility
    ctx.save();
    drawRoundedRect(ctx, x, y, cellW, cellH, 18);
    ctx.clip();
    const scrim = ctx.createLinearGradient(x, y + cellH * 0.56, x, y + cellH);
    scrim.addColorStop(0, 'rgba(18, 16, 14, 0)');
    scrim.addColorStop(1, 'rgba(18, 16, 14, 0.9)');
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y + cellH * 0.56, cellW, cellH * 0.44);

    ctx.fillStyle = '#FAF7F0';
    ctx.font = `600 ${cols === 3 ? 25 : 32}px "Noto Serif SC", Georgia, serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = wrapTextLines(ctx, item.title, cellW - 28, 1)[0] || item.title;
    ctx.fillText(label, x + 14, y + cellH - (cols === 3 ? 34 : 44));

    ctx.fillStyle = '#E4C37A';
    ctx.font = `500 ${cols === 3 ? 19 : 22}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const sub = [item.year, item.rating > 0 ? `★${item.rating}.0` : '']
      .filter(Boolean)
      .join(' · ');
    if (sub) {
      ctx.fillText(sub, x + 14, y + cellH - 12);
    }
    ctx.restore();
  }

  // Footer
  const footerTop = H - footerH + 34;
  ctx.fillStyle = isDark ? '#8C857B' : '#7A7268';
  ctx.font = '500 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`共收录 ${selected.length} 件精选藏品`, pad, footerTop + 10);
  ctx.fillText(
    `CINÉARCHIVE · ${new Date().toISOString().slice(0, 10)}`,
    pad,
    footerTop + 48
  );

  drawVermilionSeal(ctx, W - pad - 80, footerTop, 80, '光影志');

  return canvas.toDataURL('image/png');
}

/**
 * Renders a literary 1080×1440 single Quote Card PNG data URL.
 */
export async function renderQuoteCardPng(
  item: ArchiveItem,
  theme: ExportTheme = 'ivory'
): Promise<string> {
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  const isDark = theme === 'darkroom';
  ctx.fillStyle = isDark ? '#181613' : '#F7F5F0';
  ctx.fillRect(0, 0, W, H);

  const pad = 64;
  drawRoundedRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32);
  ctx.fillStyle = isDark ? '#201D19' : '#FFFDF9';
  ctx.fill();
  ctx.strokeStyle = isDark ? '#3B352D' : '#E2DBD0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Top cinematic still band (16:9 crop)
  const imgX = pad + 44;
  const imgY = pad + 44;
  const imgW = W - (pad + 44) * 2;
  const imgH = 490;
  const img = await loadCanvasImage(item.coverUrl);
  if (img) {
    drawImageCover(ctx, img, imgX, imgY, imgW, imgH, 20);
  } else {
    drawFallbackPoster(ctx, item, imgX, imgY, imgW, imgH, 20);
  }

  // Opening quotation glyph
  ctx.fillStyle = '#B43B2B';
  ctx.font = '700 96px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('“', imgX, imgY + imgH + 40);

  // Quote body
  const quoteText = (item.quote || item.notes || item.summary || '').trim();
  ctx.fillStyle = isDark ? '#FAF7F0' : '#1A1816';
  ctx.font = '500 44px "Noto Serif SC", Georgia, serif';
  const lines = wrapTextLines(ctx, quoteText, imgW, 5);
  lines.forEach((line, idx) => {
    ctx.fillText(line, imgX, imgY + imgH + 128 + idx * 68);
  });

  // Attribution
  const attrY = H - pad - 180;
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : '#E4DFD5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(imgX, attrY - 28);
  ctx.lineTo(imgX + imgW, attrY - 28);
  ctx.stroke();

  ctx.fillStyle = isDark ? '#E4C37A' : '#1A1816';
  ctx.font = '600 34px "Noto Serif SC", Georgia, serif';
  ctx.fillText(
    item.category === 'film' ? `——《${item.title}》` : `—— ${item.title}`,
    imgX,
    attrY
  );

  ctx.fillStyle = isDark ? '#9E9588' : '#7A7268';
  ctx.font = '400 26px ui-monospace, SFMono-Regular, Menlo, monospace';
  const meta = [
    item.relatedWorkTitle ? `《${item.relatedWorkTitle}》` : '',
    item.year,
    item.accessionNo,
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.fillText(meta || '光影志 · 金句摘录', imgX, attrY + 52);

  drawVermilionSeal(ctx, imgX + imgW - 84, attrY - 2, 84, '光影志');

  return canvas.toDataURL('image/png');
}

/**
 * Mobile-friendly download / Web Share helper.
 */
export async function saveOrShareDataUrl(
  dataUrl: string,
  filename: string,
  shareTitle: string
): Promise<'shared' | 'downloaded'> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function'
    ) {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle });
        return 'shared';
      }
    }
  } catch {
    // Fallback to direct download if user cancels share or browser blocks Web Share
  }

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return 'downloaded';
}
