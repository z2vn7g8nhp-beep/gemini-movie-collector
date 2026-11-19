import { useId, useMemo } from 'react';
import { splitSealCharacters } from '../utils/coverPicker';
import { buildTicketStampPath } from '../utils/visualAssets';

interface ArchivalSealStampProps {
  title: string;
  tone: 'vermilion' | 'gold';
  unlocked: boolean;
  /** 'zhuwen' = carved vermilion strokes on cotton paper, 'baiwen' = cream strokes on cinnabar ground */
  variant?: 'zhuwen' | 'baiwen';
  size?: number;
  className?: string;
}

/**
 * Paper-Film Ticket & Hot-Foil Carved Archival Seal SVG System (纸质胶片票签 + 烫金/朱砂印).
 * Combines softly rounded archival cinema-ticket silhouettes, 35mm sprocket micro-perforations,
 * organic stone-carved ink grain, hot-stamped gold foil gradients, and blind-debossed locked proofs.
 */
export function ArchivalSealStamp({
  title,
  tone,
  unlocked,
  variant = 'zhuwen',
  size = 62,
  className = '',
}: ArchivalSealStampProps) {
  const uid = useId().replace(/:/g, '');
  const carveFilterId = `seal-carve-${uid}`;
  const goldFoilId = `seal-foil-${uid}`;
  const paperStockId = `seal-stock-${uid}`;
  const darkStockId = `seal-dark-${uid}`;

  const { rightCol, leftCol } = splitSealCharacters(title);
  const ticketPath = useMemo(() => buildTicketStampPath(5, 5, 90, 90, 14, 5.4), []);
  const isGold = tone === 'gold';
  const isBaiwen = unlocked && !isGold && variant === 'baiwen';

  const inkFill = !unlocked
    ? '#B2A899'
    : isGold
      ? `url(#${goldFoilId})`
      : '#B43223';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 select-none ${className}`}
      style={{
        filter: unlocked
          ? isGold
            ? 'drop-shadow(0 3px 6px rgba(128, 90, 22, 0.22))'
            : 'drop-shadow(0 2px 5px rgba(122, 34, 24, 0.16))'
          : 'drop-shadow(0 1px 2px rgba(45, 36, 24, 0.06))',
      }}
    >
      <defs>
        {/* Subtle stone-carved paper-ink displacement */}
        <filter id={carveFilterId} x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.12"
            numOctaves="2"
            seed={title.charCodeAt(0) % 43}
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={unlocked ? '1.15' : '0.45'}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Multi-Stop Hot-Stamped 24K Gold Foil Gradient */}
        <linearGradient id={goldFoilId} x1="12" y1="8" x2="88" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF0BA" />
          <stop offset="30%" stopColor="#E1B75C" />
          <stop offset="56%" stopColor="#A57723" />
          <stop offset="80%" stopColor="#F2D182" />
          <stop offset="100%" stopColor="#845B15" />
        </linearGradient>

        {/* Warm Cotton Archival Ticket Paper */}
        <linearGradient id={paperStockId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDFBF6" />
          <stop offset="100%" stopColor="#F2EBDE" />
        </linearGradient>

        {/* Deep Obsidian Velvet Paper Stock for Hot-Foil Gold Seals */}
        <linearGradient id={darkStockId} x1="8" y1="6" x2="92" y2="94" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2A241C" />
          <stop offset="100%" stopColor="#181410" />
        </linearGradient>
      </defs>

      {/* 1. Archival Cinema-Ticket Paper Silhouette */}
      <path
        d={ticketPath}
        fill={
          !unlocked
            ? `url(#${paperStockId})`
            : isGold
              ? `url(#${darkStockId})`
              : `url(#${paperStockId})`
        }
        stroke={
          !unlocked
            ? '#DCD4C6'
            : isGold
              ? `url(#${goldFoilId})`
              : '#E2C8C2'
        }
        strokeWidth={unlocked && isGold ? '1.5' : '1.1'}
      />

      {/* 2. Tiny 35mm Cinema Film Sprocket Marks along Top & Bottom Margins */}
      <g
        fill={
          !unlocked
            ? '#DCD4C6'
            : isGold
              ? `url(#${goldFoilId})`
              : '#D6B7B0'
        }
        opacity={unlocked ? 0.72 : 0.65}
      >
        {[24, 38, 62, 76].map((cx) => (
          <g key={cx}>
            <rect x={cx - 2.4} y="8.8" width="4.8" height="2" rx="0.8" />
            <rect x={cx - 2.4} y="89.2" width="4.8" height="2" rx="0.8" />
          </g>
        ))}
      </g>

      {/* 3. Inner Carved Seal Impression */}
      {unlocked ? (
        isBaiwen ? (
          <g filter={`url(#${carveFilterId})`}>
            {/* Baiwen: solid carved cinnabar-vermilion impression */}
            <rect
              x="16"
              y="15.5"
              width="68"
              height="69"
              rx="10"
              fill="#B43223"
            />
            <rect
              x="20.5"
              y="20"
              width="59"
              height="60"
              rx="6.5"
              stroke="#FAF3E8"
              strokeWidth="1.05"
              strokeOpacity="0.68"
            />
            <line
              x1="50"
              y1="26"
              x2="50"
              y2="74"
              stroke="#FAF3E8"
              strokeWidth="0.85"
              strokeOpacity="0.35"
            />
          </g>
        ) : (
          <g filter={`url(#${carveFilterId})`}>
            {/* Zhuwen / Hot-Foil Gold Seal Double Frame */}
            <rect
              x="16"
              y="15.5"
              width="68"
              height="69"
              rx="10"
              fill={isGold ? '#1F1A14' : '#FCF7F0'}
              stroke={inkFill}
              strokeWidth={isGold ? '2.4' : '3'}
            />
            <rect
              x="21.2"
              y="20.7"
              width="57.6"
              height="58.6"
              rx="6"
              stroke={inkFill}
              strokeWidth="1"
              strokeOpacity="0.72"
            />
            {/* Delicate Corner Filigree Marks */}
            <path
              d="M21.2 28.5h4.2v-4.2M78.8 28.5h-4.2v-4.2M21.2 71.5h4.2v4.2M78.8 71.5h-4.2v4.2"
              stroke={inkFill}
              strokeWidth="1.05"
              strokeOpacity="0.82"
            />
            <line
              x1="50"
              y1="26"
              x2="50"
              y2="74"
              stroke={inkFill}
              strokeWidth="0.85"
              strokeOpacity="0.38"
            />
          </g>
        )
      ) : (
        /* Locked State: Blind-Debossed Uninked Cotton-Paper Film Ticket */
        <g>
          <rect
            x="16.5"
            y="16"
            width="67"
            height="68"
            rx="10"
            fill="#F4EFE6"
            stroke="#D6CEC0"
            strokeWidth="1.4"
          />
          <rect
            x="21.5"
            y="21"
            width="57"
            height="58"
            rx="6"
            stroke="#DFD8CA"
            strokeWidth="0.95"
            strokeDasharray="2.8 2.4"
          />
          <line
            x1="50"
            y1="27"
            x2="50"
            y2="73"
            stroke="#E1DACD"
            strokeWidth="0.8"
          />
        </g>
      )}

      {/* 4. Traditional 2x2 Right-to-Left Vertical Seal Calligraphy */}
      {!unlocked && (
        <g
          transform="translate(0, 0.9)"
          fill="#FFFFFF"
          opacity="0.75"
          fontFamily="'Songti SC', 'STSong', 'Noto Serif SC', 'SimSun', Georgia, serif"
          fontWeight="700"
          fontSize="20.5"
          textAnchor="middle"
          dominantBaseline="central"
        >
          <text x="64" y="38.5">{rightCol[0]}</text>
          <text x="64" y="62">{rightCol[1]}</text>
          <text x="36" y="38.5">{leftCol[0]}</text>
          <text x="36" y="62">{leftCol[1]}</text>
        </g>
      )}
      <g
        filter={unlocked ? `url(#${carveFilterId})` : undefined}
        fill={isBaiwen ? '#FCF7EE' : inkFill}
        opacity={unlocked ? 0.98 : 0.65}
        fontFamily="'Songti SC', 'STSong', 'Noto Serif SC', 'SimSun', Georgia, serif"
        fontWeight="700"
        fontSize="20.5"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {/* Right Column (Read First) */}
        <text x="64" y="38.5">{rightCol[0]}</text>
        <text x="64" y="62">{rightCol[1]}</text>
        {/* Left Column (Read Second) */}
        <text x="36" y="38.5">{leftCol[0]}</text>
        <text x="36" y="62">{leftCol[1]}</text>
      </g>
    </svg>
  );
}
