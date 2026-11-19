import { useId, useMemo } from 'react';
import type { MedalCategory, MedalMotif, MedalTier } from '../utils/medals';
import {
  buildScallopedSealPath,
  generateFilmSprocketNotches,
  HOT_FOIL_PALETTES,
} from '../utils/visualAssets';

interface CinemaMedalSvgProps {
  category: MedalCategory;
  motif: MedalMotif;
  tier: MedalTier;
  monogram?: string;
  size?: number;
  className?: string;
}

function renderHotFoilMotif(
  motif: MedalMotif,
  foilRef: string,
  accent: string,
  monogram?: string
) {
  switch (motif) {
    case 'reel':
      return (
        <g stroke={foilRef} strokeWidth="2.1" fill="none" strokeLinecap="round">
          <circle cx="50" cy="50" r="14" />
          <circle cx="50" cy="50" r="3.4" fill={foilRef} stroke="none" />
          <circle cx="50" cy="41.8" r="2.2" fill={foilRef} stroke="none" />
          <circle cx="50" cy="58.2" r="2.2" fill={foilRef} stroke="none" />
          <circle cx="41.8" cy="50" r="2.2" fill={foilRef} stroke="none" />
          <circle cx="58.2" cy="50" r="2.2" fill={foilRef} stroke="none" />
          <path d="M50 64h11" stroke={accent} strokeWidth="1.6" />
        </g>
      );

    case 'laurel':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <polygon
            points="50,35 53.5,43.5 62.6,44.2 55.6,50.2 57.8,59.2 50,54.3 42.2,59.2 44.4,50.2 37.4,44.2 46.5,43.5"
            fill={foilRef}
          />
          <path
            d="M36 58.5c3.5 4.2 8.5 6.5 14 6.5s10.5-2.3 14-6.5"
            stroke={accent}
            strokeWidth="1.5"
          />
        </g>
      );

    case 'mask':
      return (
        <g fill="none" stroke={foilRef} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M37.5 39.5c3.6-2.2 8.2-3.1 12.5-3.1s8.9.9 12.5 3.1v10c0 8.1-5.4 13.4-12.5 15.3-7.1-1.9-12.5-7.2-12.5-15.3v-10z" />
          <path d="M42.8 47c1.2-1.2 3.1-1.2 4.3 0" />
          <path d="M52.9 47c1.2-1.2 3.1-1.2 4.3 0" />
          <path d="M44.6 55.4c2 2 8.8 2 10.8 0" stroke={accent} />
        </g>
      );

    case 'trinity':
      return (
        <g fill="none" stroke={foilRef} strokeWidth="1.95" strokeLinecap="round">
          <circle cx="50" cy="43.2" r="7.4" />
          <circle cx="43.3" cy="54.2" r="7.4" />
          <circle cx="56.7" cy="54.2" r="7.4" />
          <circle cx="50" cy="50.4" r="2.3" fill={accent} stroke="none" />
        </g>
      );

    case 'compass':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="50" cy="50" r="14.5" stroke={accent} strokeWidth="1.2" strokeDasharray="1.8 2.8" />
          <polygon points="50,34 53.6,46.4 66,50 53.6,53.6 50,66 46.4,53.6 34,50 46.4,46.4" fill={foilRef} />
          <circle cx="50" cy="50" r="2.6" fill={accent} />
        </g>
      );

    case 'crest':
      return (
        <g fill="none" stroke={foilRef} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M50 35.5 L61.5 42.2 V55.6 L50 63.2 L38.5 55.6 V42.2 Z" />
          <path d="M50 41.2 L56.4 45 V52.8 L50 57 L43.6 52.8 V45 Z" stroke={accent} strokeWidth="1.15" />
          <circle cx="50" cy="49.2" r="2.4" fill={foilRef} stroke="none" />
        </g>
      );

    case 'shield':
      return (
        <g>
          <path
            d="M38 40.5 Q50 35.5 62 40.5 V50.5 C62 57.6 57 62.6 50 65 C43 62.6 38 57.6 38 50.5 Z"
            fill="none"
            stroke={accent}
            strokeWidth="1.35"
          />
          {monogram ? (
            <text
              x="50"
              y="52"
              textAnchor="middle"
              dominantBaseline="central"
              fill={foilRef}
              fontSize={monogram.length > 1 ? '13.5' : '16.5'}
              fontWeight="600"
              fontFamily="'Songti SC', 'Noto Serif SC', Georgia, serif"
              letterSpacing="0.8"
            >
              {monogram}
            </text>
          ) : (
            <polygon points="50,41.5 54.4,50 50,58.5 45.6,50" fill={foilRef} />
          )}
        </g>
      );

    case 'seal':
      return (
        <g fill="none" stroke={foilRef} strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
          <rect x="38.5" y="38.5" width="23" height="23" rx="4.5" />
          <rect x="42.5" y="42.5" width="15" height="15" rx="2.5" stroke={accent} strokeWidth="1.1" />
          <path d="M46 47.5h8M46 52h8M50 44.5v11" strokeWidth="1.7" />
        </g>
      );

    case 'link':
      return (
        <g fill="none" stroke={foilRef} strokeWidth="2.2" strokeLinecap="round">
          <rect x="36" y="44.5" width="15" height="10.5" rx="5.2" transform="rotate(-32 43.5 49.8)" />
          <rect x="49" y="44.5" width="15" height="10.5" rx="5.2" transform="rotate(-32 56.5 49.8)" stroke={accent} />
        </g>
      );

    case 'nexus':
      return (
        <g fill="none" strokeLinecap="round">
          <line x1="50" y1="50" x2="38.5" y2="41.5" stroke={accent} strokeWidth="1.4" />
          <line x1="50" y1="50" x2="61.5" y2="41.5" stroke={accent} strokeWidth="1.4" />
          <line x1="50" y1="50" x2="38.5" y2="59" stroke={accent} strokeWidth="1.4" />
          <line x1="50" y1="50" x2="61.5" y2="59" stroke={accent} strokeWidth="1.4" />
          <line x1="50" y1="50" x2="50" y2="36" stroke={accent} strokeWidth="1.4" />
          <circle cx="50" cy="50" r="4.4" fill={foilRef} />
          <circle cx="38.5" cy="41.5" r="2.5" fill={accent} />
          <circle cx="61.5" cy="41.5" r="2.5" fill={accent} />
          <circle cx="38.5" cy="59" r="2.5" fill={accent} />
          <circle cx="61.5" cy="59" r="2.5" fill={accent} />
          <circle cx="50" cy="36" r="2.5" fill={accent} />
        </g>
      );

    case 'triangle':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M50 36.5 L62.5 59 L37.5 59 Z" stroke={foilRef} strokeWidth="1.9" />
          <circle cx="50" cy="36.5" r="2.9" fill={foilRef} />
          <circle cx="62.5" cy="59" r="2.9" fill={foilRef} />
          <circle cx="37.5" cy="59" r="2.9" fill={foilRef} />
        </g>
      );

    case 'crown':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M36.5 57l2.7-13.5 6.8 6 4-10.5 4 10.5 6.8-6L63.5 57H36.5z"
            fill={foilRef}
            stroke={accent}
            strokeWidth="1.15"
          />
          <rect x="37.5" y="60" width="25" height="2.6" rx="1.3" fill={accent} />
        </g>
      );
  }
}

/**
 * Tactile Paper-Film & Hot-Foil Stamped SVG Medallion System (纸质胶片 + 烫金工艺).
 * Features cotton paper fiber micro-grain, 35mm film sprocket motifs,
 * letterpress blind-debossed locked state, and multi-stop hot-foil metallic embossing.
 */
export function CinemaMedalSvg({
  category,
  motif,
  tier,
  monogram,
  size = 62,
  className = '',
}: CinemaMedalSvgProps) {
  const uid = useId().replace(/:/g, '');
  const isLocked = tier === 'locked';
  const palette = HOT_FOIL_PALETTES[tier];

  const paperGradId = `mpaper-${uid}`;
  const wellGradId = `mwell-${uid}`;
  const foilGradId = `mfoil-${uid}`;
  const sheenGradId = `msheen-${uid}`;
  const grainFilterId = `mgrain-${uid}`;
  const clipId = `mclip-${uid}`;

  const sprockets = useMemo(() => generateFilmSprocketNotches(16, 40.2, 50, 50), []);
  const degreeTicks = useMemo(() => generateFilmSprocketNotches(24, 38.2, 50, 50), []);
  const scallopedPath = useMemo(() => buildScallopedSealPath(50, 50, 46.5, 43.2, 16), []);
  const foilRef = `url(#${foilGradId})`;

  const exLibrisPath =
    'M 50 7 C 66 7 79 12.5 85.5 17.5 C 88.5 19.8 89.5 23 89.5 27 V 54 C 89.5 72.5 74.5 86 53.5 92.2 C 51.2 92.9 48.8 92.9 46.5 92.2 C 25.5 86 10.5 72.5 10.5 54 V 27 C 10.5 23 11.5 19.8 14.5 17.5 C 21 12.5 34 7 50 7 Z';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      data-medal-tier={tier}
      data-medal-category={category}
      className={`shrink-0 select-none ${className}`}
      style={{
        filter: isLocked
          ? 'drop-shadow(0 1px 2px rgba(45, 36, 24, 0.08))'
          : tier === 'crimson'
            ? 'drop-shadow(0 4px 9px rgba(132, 32, 20, 0.28))'
            : tier === 'gold'
              ? 'drop-shadow(0 4px 9px rgba(128, 90, 22, 0.28))'
              : 'drop-shadow(0 3px 8px rgba(24, 20, 15, 0.24))',
      }}
    >
      <defs>
        {/* Archival Heavy Cotton Paper Stock Gradient */}
        <linearGradient id={paperGradId} x1="12" y1="6" x2="88" y2="94" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.paperTop} />
          <stop offset="100%" stopColor={palette.paperBottom} />
        </linearGradient>

        {/* Letterpress Recessed Center Well */}
        <radialGradient id={wellGradId} cx="46%" cy="34%" r="68%">
          <stop offset="0%" stopColor={palette.wellTop} />
          <stop offset="100%" stopColor={palette.wellBottom} />
        </radialGradient>

        {/* Multi-Stop Hot-Stamped Metallic Foil Gradient */}
        <linearGradient id={foilGradId} x1="14" y1="10" x2="86" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.foilStops[0]} />
          <stop offset="28%" stopColor={palette.foilStops[1]} />
          <stop offset="52%" stopColor={palette.foilStops[2]} />
          <stop offset="76%" stopColor={palette.foilStops[3]} />
          <stop offset="100%" stopColor={palette.foilStops[4]} />
        </linearGradient>

        {/* Subtle Paper Foil Specular Sheen */}
        <linearGradient id={sheenGradId} x1="10" y1="8" x2="78" y2="76" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.08" />
        </linearGradient>

        {/* Tactile Cotton Paper Fiber Micro-Grain */}
        <filter id={grainFilterId} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed={motif.charCodeAt(0) % 31}
            result="paperNoise"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 0.96  0 0 0 0 0.88  0 0 0 0.08 0"
            in="paperNoise"
            result="softGrain"
          />
          <feComposite in="softGrain" in2="SourceAlpha" operator="in" result="clippedGrain" />
          <feBlend in="SourceGraphic" in2="clippedGrain" mode="soft-light" />
        </filter>

        <clipPath id={clipId}>
          {category === 'type' && <circle cx="50" cy="50" r="45.5" />}
          {category === 'tag' && <path d={exLibrisPath} />}
          {category === 'relation' && <path d={scallopedPath} />}
        </clipPath>
      </defs>

      {/* 1. CATEGORY SILHOUETTE: Paper Stock + 35mm Film Perforation / Foil Collar */}
      <g filter={`url(#${grainFilterId})`}>
        {category === 'type' && (
          <g>
            {/* Circular Heavy Cotton Cinema Disc */}
            <circle
              cx="50"
              cy="50"
              r="45.5"
              fill={`url(#${paperGradId})`}
              stroke={isLocked ? palette.paperRim : foilRef}
              strokeWidth={isLocked ? '1.4' : '2.2'}
            />
            {/* Fine Outer Hot-Foil Collar Line */}
            <circle
              cx="50"
              cy="50"
              r="43"
              stroke={isLocked ? '#FFFFFF' : foilRef}
              strokeWidth="0.7"
              strokeOpacity={isLocked ? '0.65' : '0.75'}
            />
            {/* 16 Precision 35mm Film Sprocket Perforations */}
            {sprockets.map((slot, i) => (
              <rect
                key={i}
                x={slot.x - 1.5}
                y={slot.y - 2.2}
                width="3"
                height="4.4"
                rx="0.9"
                transform={`rotate(${slot.angleDeg} ${slot.x} ${slot.y})`}
                fill={isLocked ? '#DCD4C6' : palette.debossShadow}
                stroke={isLocked ? '#C7BEB0' : foilRef}
                strokeWidth="0.55"
                strokeOpacity={isLocked ? '0.75' : '0.82'}
              />
            ))}
            {/* Recessed Letterpress Center Well */}
            <circle
              cx="50"
              cy="50"
              r="33.2"
              fill={`url(#${wellGradId})`}
              stroke={foilRef}
              strokeWidth={isLocked ? '1.1' : '1.75'}
              strokeDasharray={isLocked ? '2.5 2.5' : undefined}
            />
            <circle
              cx="50"
              cy="50"
              r="29.4"
              stroke={palette.foilBright}
              strokeWidth="0.65"
              strokeDasharray="1.4 2.4"
              strokeOpacity={isLocked ? '0.45' : '0.65'}
            />
          </g>
        )}

        {category === 'tag' && (
          <g>
            {/* Softly Curved Museum Ex-Libris (藏书票) Paper Crest */}
            <path
              d={exLibrisPath}
              fill={`url(#${paperGradId})`}
              stroke={isLocked ? palette.paperRim : foilRef}
              strokeWidth={isLocked ? '1.4' : '2.2'}
            />
            {/* Inner Hot-Foil Frame */}
            <path
              d="M 50 13.5 C 63 13.5 74 18 79.5 22 C 81.8 23.7 82.8 26 82.8 29.2 V 53.5 C 82.8 68.8 70.5 80.2 52.5 85.4 C 50.9 85.9 49.1 85.9 47.5 85.4 C 29.5 80.2 17.2 68.8 17.2 53.5 V 29.2 C 17.2 26 18.2 23.7 20.5 22 C 26 18 37 13.5 50 13.5 Z"
              fill={`url(#${wellGradId})`}
              stroke={foilRef}
              strokeWidth={isLocked ? '1.1' : '1.45'}
              strokeDasharray={isLocked ? '2.5 2.5' : undefined}
            />
            {/* Top Film-Ticket Registration Sprockets */}
            <rect x="37" y="18.2" width="4" height="2.2" rx="0.8" fill={foilRef} opacity={isLocked ? 0.5 : 0.78} />
            <rect x="48" y="17.2" width="4" height="2.2" rx="0.8" fill={foilRef} opacity={isLocked ? 0.5 : 0.78} />
            <rect x="59" y="18.2" width="4" height="2.2" rx="0.8" fill={foilRef} opacity={isLocked ? 0.5 : 0.78} />
            {/* Bottom Delicate Foil Diamond */}
            <polygon
              points="50,74 52.8,77.5 50,81 47.2,77.5"
              fill={foilRef}
              opacity={isLocked ? 0.45 : 0.85}
            />
          </g>
        )}

        {category === 'relation' && (
          <g>
            {/* Soft Scalloped Wax-Foil Paper Rosette */}
            <path
              d={scallopedPath}
              fill={`url(#${paperGradId})`}
              stroke={isLocked ? palette.paperRim : foilRef}
              strokeWidth={isLocked ? '1.35' : '2.05'}
            />
            {/* Watchmaker Degree Ticks in Hot Foil */}
            {degreeTicks.map((tick, idx) => (
              <line
                key={idx}
                x1={tick.x}
                y1={tick.y}
                x2={Number((50 + (tick.x - 50) * 0.9).toFixed(2))}
                y2={Number((50 + (tick.y - 50) * 0.9).toFixed(2))}
                stroke={foilRef}
                strokeWidth={idx % 6 === 0 ? '1.5' : '0.75'}
                strokeLinecap="round"
                strokeOpacity={isLocked ? '0.5' : '0.82'}
              />
            ))}
            {/* Recessed Compass Foil Well */}
            <circle
              cx="50"
              cy="50"
              r="31.5"
              fill={`url(#${wellGradId})`}
              stroke={foilRef}
              strokeWidth={isLocked ? '1.1' : '1.65'}
              strokeDasharray={isLocked ? '2.5 2.5' : undefined}
            />
            {/* 4 Cardinal Foil Micro-Diamonds */}
            {!isLocked && (
              <g fill={palette.foilBright}>
                <polygon points="50,15.5 52,18 50,20.5 48,18" />
                <polygon points="50,79.5 52,82 50,84.5 48,82" />
                <polygon points="15.5,50 18,52 20.5,50 18,48" />
                <polygon points="79.5,50 82,52 84.5,50 82,48" />
              </g>
            )}
          </g>
        )}
      </g>

      {/* 2. LETTERPRESS DEBOSS SHADOW + HOT-FOIL EMBOSSED CENTER MOTIF */}
      <g
        transform="translate(0, 1.15)"
        opacity={isLocked ? 0.85 : 0.72}
      >
        {renderHotFoilMotif(
          motif,
          palette.debossShadow,
          palette.debossShadow,
          monogram
        )}
      </g>
      <g opacity={isLocked ? 0.78 : 1}>
        {renderHotFoilMotif(motif, foilRef, palette.foilBright, monogram)}
      </g>

      {/* 3. SUBTLE DIAGONAL FOIL SPECULAR LIGHT SWEEP */}
      {!isLocked && (
        <g clipPath={`url(#${clipId})`} opacity="0.72">
          <path
            d="M 10 24 Q 44 6 88 22 L 88 46 Q 48 34 12 52 Z"
            fill={`url(#${sheenGradId})`}
          />
        </g>
      )}
    </svg>
  );
}
