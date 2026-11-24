import { useEffect, useRef, useState } from 'react';
import { Film, Sparkles, User } from 'lucide-react';
import type { ArchiveCategory } from '../types/archive';
import { getRuntimeModeSync } from '../services/archiveApi';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  getDirectImageFallbackUrl,
  resolveDisplayImageUrl,
} from '../utils/runtimeEnv';
import { getConfiguredDoubanRelayUrl } from '../utils/doubanRelay';

interface ArchivalImageProps {
  src?: string;
  alt: string;
  title: string;
  category: ArchiveCategory;
  compact?: boolean;
  className?: string;
  imgClassName?: string;
}

const FALLBACK_THEMES: Record<
  ArchiveCategory,
  { bg: string; frame: string; ink: string; sub: string; accent: string }
> = {
  film: {
    bg: 'bg-gradient-to-b from-[#23201C] via-[#1A1815] to-[#12100E]',
    frame: 'border-[#C9A45C]/35',
    ink: 'text-[#F5EFE4]',
    sub: 'text-[#B5AA9A]',
    accent: 'text-[#D8B467]',
  },
  person: {
    bg: 'bg-gradient-to-b from-[#2C241E] via-[#201A16] to-[#16120F]',
    frame: 'border-[#D4B483]/35',
    ink: 'text-[#F6F0E6]',
    sub: 'text-[#BFB2A2]',
    accent: 'text-[#DFC191]',
  },
  character: {
    bg: 'bg-gradient-to-b from-[#331C19] via-[#241311] to-[#170C0B]',
    frame: 'border-[#D99B8E]/35',
    ink: 'text-[#FAF2EB]',
    sub: 'text-[#C9B3AB]',
    accent: 'text-[#E7A898]',
  },
};

export function ArchivalImage({
  src,
  alt,
  title,
  category,
  compact = false,
  className = '',
  imgClassName = '',
}: ArchivalImageProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fallbackStep, setFallbackStep] = useState<0 | 1 | 2>(0);

  const baseUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : './';
  const primarySrc = resolveDisplayImageUrl(
    src,
    getRuntimeModeSync(),
    baseUrl,
    getConfiguredDoubanRelayUrl() || undefined
  );
  const rawDirectFallback = getDirectImageFallbackUrl(src);
  const directFallback =
    rawDirectFallback && /doubanio\.com|douban\.com/i.test(rawDirectFallback)
      ? ''
      : rawDirectFallback;

  const cdnFallbackTarget = directFallback || primarySrc;
  const cdnMirrorFallback =
    cdnFallbackTarget &&
    /^https?:\/\/([^/]*\.)?(bgm\.tv|wikimedia\.org|media-amazon\.com|metahub\.space)\//i.test(
      cdnFallbackTarget
    )
      ? `https://wsrv.nl/?url=${encodeURIComponent(cdnFallbackTarget)}&w=480&output=webp`
      : '';

  const effectiveSrc =
    fallbackStep === 0
      ? primarySrc
      : fallbackStep === 1 && directFallback && directFallback !== primarySrc
        ? directFallback
        : cdnMirrorFallback || primarySrc;

  useEffect(() => {
    setFailed(false);
    setFallbackStep(0);
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setLoaded(true);
    } else {
      setLoaded(false);
    }
  }, [primarySrc]);

  const showFallback = !effectiveSrc || failed;
  const monogram = (title.trim().charAt(0) || '影').toUpperCase();
  const theme = FALLBACK_THEMES[category];

  return (
    <div
      className={`relative overflow-hidden bg-[#EAE4D8] dark:bg-[#231F1B] ${className}`}
    >
      {!showFallback ? (
        <>
          {!loaded && (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[#EAE4D8] dark:bg-[#231F1B]"
            />
          )}
          <img
            ref={imgRef}
            src={effectiveSrc}
            alt={alt}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => {
              if (
                fallbackStep === 0 &&
                directFallback &&
                directFallback !== effectiveSrc
              ) {
                setFallbackStep(1);
                setLoaded(false);
              } else if (
                fallbackStep < 2 &&
                cdnMirrorFallback &&
                cdnMirrorFallback !== effectiveSrc
              ) {
                setFallbackStep(2);
                setLoaded(false);
              } else {
                setFailed(true);
              }
            }}
            className={`h-full w-full object-cover ${
              category === 'film' ? 'object-center' : 'object-top'
            } transition-[transform,opacity] duration-200 ease-out ${
              loaded ? 'opacity-100' : 'opacity-0'
            } ${imgClassName}`}
          />
        </>
      ) : compact ? (
        <div
          aria-label={alt}
          className={`relative flex h-full w-full flex-col items-center justify-center p-2 text-center ${theme.bg}`}
        >
          <div
            className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-[inherit] border ${theme.frame} px-1.5`}
          >
            <span className={`font-editorial text-xl font-medium ${theme.ink}`}>
              {monogram}
            </span>
            <span className={`text-[9px] tracking-[0.14em] ${theme.sub} whitespace-nowrap`}>
              {CATEGORY_LABELS[category]}
            </span>
          </div>
        </div>
      ) : (
        <div
          aria-label={alt}
          className={`relative flex h-full w-full p-2.5 text-center ${theme.bg}`}
        >
          {/* Museum Edition Letterpress Inner Plate (Softly Rounded Corners) */}
          <div
            className={`relative flex h-full w-full flex-col items-center justify-between rounded-[10px] border ${theme.frame} px-3 py-3.5`}
          >
            {/* Fine Rounded Corner Registration Accents */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-1.5 h-2 w-2 rounded-tl-[3px] border-t border-l border-[#C9A45C]/60"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 right-1.5 h-2 w-2 rounded-tr-[3px] border-t border-r border-[#C9A45C]/60"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 rounded-bl-[3px] border-b border-l border-[#C9A45C]/60"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 rounded-br-[3px] border-b border-r border-[#C9A45C]/60"
            />

            <span className={`font-mono text-[9px] tracking-[0.22em] uppercase ${theme.accent} whitespace-nowrap`}>
              {CATEGORY_LABELS[category]}典藏
            </span>

            <div className="flex flex-col items-center gap-1.5 px-1">
              <span className={`font-editorial text-4xl font-normal leading-none ${theme.ink}`}>
                {monogram}
              </span>
              <span className={`line-clamp-2 text-[11px] leading-snug font-medium ${theme.sub}`}>
                {title}
              </span>
            </div>

            <span className={`${theme.accent} opacity-80`} aria-hidden="true">
              {category === 'film' ? (
                <Film className="h-3.5 w-3.5 stroke-[1.5]" />
              ) : category === 'person' ? (
                <User className="h-3.5 w-3.5 stroke-[1.5]" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 stroke-[1.5]" />
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
