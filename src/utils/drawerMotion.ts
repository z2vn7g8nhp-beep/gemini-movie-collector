export type DrawerSwitchDirection = 'prev' | 'next' | 'neutral';

export type DrawerPhase = 'closed' | 'open' | 'closing';

export interface DrawerPresenceState {
  phase: DrawerPhase;
  renderedItemId: string | null;
}

export const DRAWER_TIMINGS = {
  backdropEnterMs: 180,
  backdropExitMs: 145,
  panelEnterMs: 220,
  panelExitMs: 155,
  contentSwitchMs: 150,
  secondaryHydrateDelayMs: 185,
  desktopOffsetPx: 24,
  mobileOffsetPx: 24,
  exitOffsetPx: 16,
  contentDriftPx: 10,
} as const;

export function getDrawerExitDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : DRAWER_TIMINGS.panelExitMs;
}

export function getSecondaryHydrateDelayMs(
  reducedMotion: boolean,
  alreadyEntered: boolean
): number {
  if (reducedMotion || alreadyEntered) return 0;
  return DRAWER_TIMINGS.secondaryHydrateDelayMs;
}

/**
 * Pure state machine governing mount/unmount presence of the archive drawer.
 * Handles rapid close -> re-open interruptions cleanly without stuck overlays.
 */
export function resolveNextDrawerPresence(
  current: DrawerPresenceState,
  incomingItemId: string | null,
  reducedMotion: boolean
): DrawerPresenceState {
  if (incomingItemId) {
    if (
      current.phase === 'open' &&
      current.renderedItemId === incomingItemId
    ) {
      return current;
    }
    return {
      phase: 'open',
      renderedItemId: incomingItemId,
    };
  }

  if (current.phase === 'closed' || !current.renderedItemId) {
    return {
      phase: 'closed',
      renderedItemId: null,
    };
  }

  if (reducedMotion) {
    return {
      phase: 'closed',
      renderedItemId: null,
    };
  }

  if (current.phase === 'closing') {
    return current;
  }

  return {
    phase: 'closing',
    renderedItemId: current.renderedItemId,
  };
}

export function completeDrawerExit(
  current: DrawerPresenceState
): DrawerPresenceState {
  if (current.phase !== 'closing') return current;
  return {
    phase: 'closed',
    renderedItemId: null,
  };
}

export interface DrawerMotionClasses {
  backdrop: string;
  panel: string;
}

export function getDrawerMotionClasses(
  phase: DrawerPhase,
  reducedMotion: boolean
): DrawerMotionClasses {
  if (reducedMotion || phase === 'closed') {
    return { backdrop: '', panel: '' };
  }
  if (phase === 'closing') {
    return {
      backdrop: 'detail-drawer-backdrop-out',
      panel: 'detail-drawer-panel-out',
    };
  }
  return {
    backdrop: 'detail-drawer-backdrop-in',
    panel: 'detail-drawer-panel-in',
  };
}

export function getSwitchOffsetX(
  direction: DrawerSwitchDirection,
  reducedMotion: boolean
): number {
  if (reducedMotion || direction === 'neutral') return 0;
  return direction === 'next'
    ? DRAWER_TIMINGS.contentDriftPx
    : -DRAWER_TIMINGS.contentDriftPx;
}

export function getContentSwitchClass(
  direction: DrawerSwitchDirection,
  reducedMotion: boolean,
  isInitialMount: boolean
): string {
  if (reducedMotion || isInitialMount) return '';
  if (direction === 'next') return 'detail-content-switch-next';
  if (direction === 'prev') return 'detail-content-switch-prev';
  return 'detail-content-switch-neutral';
}
