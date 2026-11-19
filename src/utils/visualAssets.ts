import type { MedalTier } from './medals';

export interface SprocketNotch {
  x: number;
  y: number;
  angleDeg: number;
}

export interface HotFoilPalette {
  /** Base archival paper stock top gradient stop */
  paperTop: string;
  /** Base archival paper stock bottom gradient stop */
  paperBottom: string;
  /** Recessed inner well color */
  wellTop: string;
  wellBottom: string;
  /** Multi-stop hot-stamped metallic foil stops */
  foilStops: [string, string, string, string, string];
  /** Primary foil stroke/fill for fine details */
  foilBright: string;
  foilDeep: string;
  /** Letterpress deboss shadow beneath foil */
  debossShadow: string;
  /** Subtle outer paper rim */
  paperRim: string;
}

export const HOT_FOIL_PALETTES: Record<MedalTier, HotFoilPalette> = {
  locked: {
    paperTop: '#F4EFE6',
    paperBottom: '#E7E0D3',
    wellTop: '#EFEAE0',
    wellBottom: '#E3DBCD',
    foilStops: ['#CEC6B8', '#B8AFA0', '#A49B8C', '#C4BCB0', '#968D7E'],
    foilBright: '#B8AFA0',
    foilDeep: '#8E8577',
    debossShadow: '#FFFFFF',
    paperRim: '#D8D0C2',
  },
  bronze: {
    paperTop: '#2E231C',
    paperBottom: '#1C1410',
    wellTop: '#241B15',
    wellBottom: '#16100C',
    foilStops: ['#F7DAB6', '#D99E67', '#9A6234', '#EAB987', '#754621'],
    foilBright: '#F2CFA8',
    foilDeep: '#8A552A',
    debossShadow: '#0C0806',
    paperRim: '#6A472C',
  },
  silver: {
    paperTop: '#252930',
    paperBottom: '#16191E',
    wellTop: '#1D2128',
    wellBottom: '#111419',
    foilStops: ['#FFFFFF', '#DCE3EC', '#8F9AA8', '#EEF3F8', '#6B7584'],
    foilBright: '#F3F7FB',
    foilDeep: '#7C8796',
    debossShadow: '#090B0E',
    paperRim: '#5A6370',
  },
  gold: {
    paperTop: '#272119',
    paperBottom: '#16120D',
    wellTop: '#1F1A13',
    wellBottom: '#120E0A',
    foilStops: ['#FFF5CE', '#E8C26A', '#AE7F29', '#F8DF95', '#875D16'],
    foilBright: '#FCEAB0',
    foilDeep: '#9B7020',
    debossShadow: '#0B0805',
    paperRim: '#8C6C30',
  },
  crimson: {
    paperTop: '#9F2B1E',
    paperBottom: '#65160E',
    wellTop: '#872116',
    wellBottom: '#52110A',
    foilStops: ['#FFF6D4', '#F0CA72', '#B9872C', '#FCE29B', '#8E6218'],
    foilBright: '#FFF0BE',
    foilDeep: '#A67824',
    debossShadow: '#3A0A05',
    paperRim: '#C99E4C',
  },
};

/**
 * Generates radial 35mm cinema film sprocket perforation coordinates
 * evenly spaced around a circular medallion perimeter.
 */
export function generateFilmSprocketNotches(
  count: number,
  radius: number,
  cx = 50,
  cy = 50
): SprocketNotch[] {
  const safeCount = Math.max(4, Math.round(count));
  const notches: SprocketNotch[] = [];
  for (let i = 0; i < safeCount; i++) {
    const angleDeg = (360 / safeCount) * i - 90;
    const rad = (angleDeg * Math.PI) / 180;
    notches.push({
      x: Number((cx + radius * Math.cos(rad)).toFixed(2)),
      y: Number((cy + radius * Math.sin(rad)).toFixed(2)),
      angleDeg: Number((angleDeg + 90).toFixed(2)),
    });
  }
  return notches;
}

/**
 * Generates a softly scalloped organic paper-wax seal SVG path with smooth
 * cubic curves (no sharp corners).
 */
export function buildScallopedSealPath(
  cx = 50,
  cy = 50,
  outerR = 45,
  innerR = 41.2,
  lobes = 16
): string {
  const safeLobes = Math.max(6, Math.round(lobes));
  const totalSteps = safeLobes * 2;
  const pts: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < totalSteps; i++) {
    const angle = (Math.PI * 2 * i) / totalSteps - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  const parts: string[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % totalSteps];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    if (i === 0) {
      const prev = pts[totalSteps - 1];
      const startX = (prev.x + curr.x) / 2;
      const startY = (prev.y + curr.y) / 2;
      parts.push(`M ${startX.toFixed(2)} ${startY.toFixed(2)}`);
    }
    parts.push(
      `Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
    );
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Generates an archival paper cinema-ticket silhouette with softly rounded
 * corners and delicate semicircular side punch notches.
 */
export function buildTicketStampPath(
  x = 6,
  y = 6,
  w = 88,
  h = 88,
  cornerR = 12,
  notchR = 5.2
): string {
  const right = x + w;
  const bottom = y + h;
  const midY = y + h / 2;
  const r = Math.min(cornerR, w / 4, h / 4);
  const n = Math.min(notchR, h / 6);

  return [
    `M ${(x + r).toFixed(2)} ${y.toFixed(2)}`,
    `L ${(right - r).toFixed(2)} ${y.toFixed(2)}`,
    `Q ${right.toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + r).toFixed(2)}`,
    `L ${right.toFixed(2)} ${(midY - n).toFixed(2)}`,
    `A ${n.toFixed(2)} ${n.toFixed(2)} 0 0 0 ${right.toFixed(2)} ${(midY + n).toFixed(2)}`,
    `L ${right.toFixed(2)} ${(bottom - r).toFixed(2)}`,
    `Q ${right.toFixed(2)} ${bottom.toFixed(2)} ${(right - r).toFixed(2)} ${bottom.toFixed(2)}`,
    `L ${(x + r).toFixed(2)} ${bottom.toFixed(2)}`,
    `Q ${x.toFixed(2)} ${bottom.toFixed(2)} ${x.toFixed(2)} ${(bottom - r).toFixed(2)}`,
    `L ${x.toFixed(2)} ${(midY + n).toFixed(2)}`,
    `A ${n.toFixed(2)} ${n.toFixed(2)} 0 0 0 ${x.toFixed(2)} ${(midY - n).toFixed(2)}`,
    `L ${x.toFixed(2)} ${(y + r).toFixed(2)}`,
    `Q ${x.toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)}`,
    'Z',
  ].join(' ');
}
