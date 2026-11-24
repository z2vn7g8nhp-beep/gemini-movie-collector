import { useId } from 'react';

interface BrandLogoProps {
  /** Rendered square size in CSS pixels (default 28 for desktop top bar) */
  size?: number;
  className?: string;
}

/**
 * 「光影志」 (CinéArchive) Signature Emblem — 「放映光扉 · 朱砂印」
 * Architectural chiaroscuro cinema-frame mark:
 *  - Matte warm obsidian darkroom lacquer tile with refined gilded bevel
 *  - Precision champagne-gold widescreen cinema gate & micro 35mm leader marks (影)
 *  - Sculpted diagonal shaft of warm silver-ivory projector light (光)
 *  - Matte cinnabar-vermilion archival square seal stamped in the shadow corner (志)
 */
export function BrandLogo({ size = 28, className = '' }: BrandLogoProps) {
  const uid = useId().replace(/:/g, '');
  const tileBgId = `brand-tile-${uid}`;
  const rimGradId = `brand-rim-${uid}`;
  const frameGoldId = `brand-frame-${uid}`;
  const beamGradId = `brand-beam-${uid}`;
  const sealGradId = `brand-seal-${uid}`;
  const screenClipId = `brand-clip-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="brand-logo-svg"
      className={`shrink-0 select-none ${className}`}
    >
      <defs>
        {/* Matte Warm Darkroom Obsidian Lacquer */}
        <linearGradient id={tileBgId} x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#241F1A" />
          <stop offset="55%" stopColor="#171411" />
          <stop offset="100%" stopColor="#100E0C" />
        </linearGradient>

        {/* Subtle Gilded Bevel Rim */}
        <linearGradient id={rimGradId} x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F0D79A" stopOpacity="0.52" />
          <stop offset="50%" stopColor="#C8A054" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#8E6C32" stopOpacity="0.38" />
        </linearGradient>

        {/* Champagne-Gold Widescreen Gate */}
        <linearGradient id={frameGoldId} x1="10" y1="15" x2="54" y2="49" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F4DEAA" />
          <stop offset="55%" stopColor="#D4AE66" />
          <stop offset="100%" stopColor="#B0863D" />
        </linearGradient>

        {/* Diagonal Silver-Ivory Projector Beam (光) */}
        <linearGradient id={beamGradId} x1="14" y1="18" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFDF8" />
          <stop offset="52%" stopColor="#F5E7C6" />
          <stop offset="100%" stopColor="#D7B570" stopOpacity="0.88" />
        </linearGradient>

        {/* Matte Cinnabar-Vermilion Archival Seal (志) */}
        <linearGradient id={sealGradId} x1="38" y1="21" x2="48" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#D94B38" />
          <stop offset="100%" stopColor="#AD3021" />
        </linearGradient>

        {/* Inner Cinema Screen Mat Clip */}
        <clipPath id={screenClipId}>
          <rect x="13" y="18" width="38" height="28" rx="1.6" />
        </clipPath>
      </defs>

      {/* Outer Darkroom Obsidian Squircle */}
      <rect x="1" y="1" width="62" height="62" rx="14.5" fill={`url(#${tileBgId})`} />
      <rect
        x="1.6"
        y="1.6"
        width="60.8"
        height="60.8"
        rx="13.9"
        stroke={`url(#${rimGradId})`}
        strokeWidth="1.2"
      />

      {/* Delicate 35mm Cinema Leader Ticks (Top & Bottom) */}
      <g fill={`url(#${frameGoldId})`} opacity="0.48">
        <rect x="16" y="10.2" width="5.2" height="1.7" rx="0.85" />
        <rect x="29.4" y="10.2" width="5.2" height="1.7" rx="0.85" />
        <rect x="42.8" y="10.2" width="5.2" height="1.7" rx="0.85" />
        <rect x="16" y="52.1" width="5.2" height="1.7" rx="0.85" />
        <rect x="29.4" y="52.1" width="5.2" height="1.7" rx="0.85" />
        <rect x="42.8" y="52.1" width="5.2" height="1.7" rx="0.85" />
      </g>

      {/* Widescreen Cinema Gate Frame (影) */}
      <rect
        x="10.2"
        y="15.2"
        width="43.6"
        height="33.6"
        rx="3.6"
        fill="#12100E"
        stroke={`url(#${frameGoldId})`}
        strokeWidth="1.9"
      />

      {/* Clipped Chiaroscuro Projection Stage */}
      <g clipPath={`url(#${screenClipId})`}>
        {/* Soft Ambient Light Falloff */}
        <polygon points="13,18 33.5,18 51,46 21,46" fill="#E8C984" fillOpacity="0.1" />
        {/* Primary Diagonal Shaft of Projector Light (光) */}
        <polygon points="13,18 26.8,18 44.5,46 23.2,46" fill={`url(#${beamGradId})`} />
        {/* Crisp Architectural Shadow Split Accent Line */}
        <line
          x1="26.8"
          y1="18"
          x2="44.5"
          y2="46"
          stroke="#FFFDF8"
          strokeWidth="0.6"
          strokeOpacity="0.45"
        />
      </g>

      {/* Matte Cinnabar-Vermilion Archival Square Seal (志) */}
      <rect x="38.2" y="20.6" width="9.8" height="9.8" rx="2" fill={`url(#${sealGradId})`} />
      <rect
        x="40"
        y="22.4"
        width="6.2"
        height="6.2"
        rx="0.9"
        stroke="#FAF4E8"
        strokeWidth="0.75"
        strokeOpacity="0.45"
      />
    </svg>
  );
}
