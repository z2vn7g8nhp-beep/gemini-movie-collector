export type DrawerSwitchDirection = 'prev' | 'next' | 'neutral';

export const DRAWER_ENTER_EASE: [number, number, number, number] = [
  0.22, 1, 0.36, 1,
];

export const DRAWER_EXIT_EASE: [number, number, number, number] = [
  0.32, 0.72, 0, 1,
];

export const DRAWER_TIMINGS = {
  backdropEnterSec: 0.24,
  backdropExitSec: 0.2,
  panelEnterSec: 0.32,
  panelExitSec: 0.24,
  contentFadeOutSec: 0.1,
  contentFadeInSec: 0.18,
  contentDriftPx: 6,
} as const;

export function getDrawerBackdropVariants(reducedMotion: boolean) {
  return {
    closed: {
      opacity: 0,
      transition: {
        duration: reducedMotion ? 0.01 : DRAWER_TIMINGS.backdropExitSec,
        ease: DRAWER_EXIT_EASE,
      },
    },
    open: {
      opacity: 1,
      transition: {
        duration: reducedMotion ? 0.01 : DRAWER_TIMINGS.backdropEnterSec,
        ease: DRAWER_ENTER_EASE,
      },
    },
  };
}

export function getDrawerPanelVariants(reducedMotion: boolean) {
  if (reducedMotion) {
    return {
      closed: {
        x: 0,
        opacity: 0,
        transition: { duration: 0.01 },
      },
      open: {
        x: 0,
        opacity: 1,
        transition: { duration: 0.01 },
      },
    };
  }

  return {
    closed: {
      x: '100%',
      opacity: 0.92,
      transition: {
        duration: DRAWER_TIMINGS.panelExitSec,
        ease: DRAWER_EXIT_EASE,
      },
    },
    open: {
      x: 0,
      opacity: 1,
      transition: {
        duration: DRAWER_TIMINGS.panelEnterSec,
        ease: DRAWER_ENTER_EASE,
      },
    },
  };
}

export function getSwitchOffsetX(
  direction: DrawerSwitchDirection,
  phase: 'enter' | 'exit',
  reducedMotion: boolean
): number {
  if (reducedMotion || direction === 'neutral') return 0;
  const distance = DRAWER_TIMINGS.contentDriftPx;
  if (direction === 'next') {
    return phase === 'enter' ? distance : -distance;
  }
  return phase === 'enter' ? -distance : distance;
}

export function getDrawerContentVariants(reducedMotion: boolean) {
  return {
    enter: (direction: DrawerSwitchDirection = 'neutral') => ({
      opacity: reducedMotion ? 1 : 0,
      x: getSwitchOffsetX(direction, 'enter', reducedMotion),
    }),
    center: {
      opacity: 1,
      x: 0,
      transition: {
        duration: reducedMotion ? 0.01 : DRAWER_TIMINGS.contentFadeInSec,
        ease: DRAWER_ENTER_EASE,
      },
    },
    exit: (direction: DrawerSwitchDirection = 'neutral') => ({
      opacity: reducedMotion ? 1 : 0,
      x: getSwitchOffsetX(direction, 'exit', reducedMotion),
      transition: {
        duration: reducedMotion ? 0.01 : DRAWER_TIMINGS.contentFadeOutSec,
        ease: DRAWER_EXIT_EASE,
      },
    }),
  };
}

export function getDrawerMetaFadeVariants(reducedMotion: boolean) {
  return {
    enter: {
      opacity: reducedMotion ? 1 : 0,
    },
    center: {
      opacity: 1,
      transition: {
        duration: reducedMotion ? 0.01 : DRAWER_TIMINGS.contentFadeInSec,
        ease: DRAWER_ENTER_EASE,
      },
    },
    exit: {
      opacity: reducedMotion ? 1 : 0,
      transition: {
        duration: reducedMotion ? 0.01 : DRAWER_TIMINGS.contentFadeOutSec,
        ease: DRAWER_EXIT_EASE,
      },
    },
  };
}
