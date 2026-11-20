import { unwrapProxyImageUrl } from './coverPicker';

export type RuntimeMode = 'server' | 'static';

export interface RuntimeDetectionSignals {
  staticEnvFlag?: string | boolean;
  search?: string;
  hostname?: string;
}

/**
 * Pure heuristic to decide if the app is explicitly running in static GitHub Pages
 * / standalone browser mode before probing `/api/health`.
 */
export function detectInitialStaticHint(signals: RuntimeDetectionSignals): boolean {
  if (signals.staticEnvFlag === true || signals.staticEnvFlag === 'true' || signals.staticEnvFlag === '1') {
    return true;
  }

  if (signals.search) {
    try {
      const params = new URLSearchParams(signals.search);
      const staticParam = params.get('static');
      if (staticParam === '1' || staticParam === 'true') {
        return true;
      }
    } catch {
      // Ignore malformed query string
    }
  }

  const host = (signals.hostname || '').trim().toLowerCase();
  if (host.endsWith('.github.io') || host === 'github.io') {
    return true;
  }

  return false;
}

/**
 * Resolves an internal app asset path (e.g. `/src/assets/images/foo.jpg`)
 * safely for both root (`/`) and GitHub Pages subpath (`/<repo>/` or `./`) deployments.
 */
export function resolveBaseAssetUrl(rawPath: string, baseUrl = './'): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }

  const cleanBase = baseUrl === '' ? './' : baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedRel = trimmed.replace(/^(\.\/|\/)+/, '');
  return `${cleanBase}${normalizedRel}`;
}

/**
 * Resolves any stored cover URL into a renderable URL for the current runtime mode.
 * - In `static` mode (GitHub Pages), `/api/img-proxy?url=...` is unwrapped back to
 *   its direct remote HTTPS URL so backups & search results render without a backend.
 * - Local `/src/assets/...` paths are resolved relative to the Vite `BASE_URL`.
 */
export function resolveDisplayImageUrl(
  rawUrl: string | undefined,
  mode: RuntimeMode,
  baseUrl = './',
  doubanRelayUrl?: string
): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('data:image/') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  if (trimmed.startsWith('/src/assets/') || trimmed.startsWith('./src/assets/') || trimmed.startsWith('src/assets/')) {
    return resolveBaseAssetUrl(trimmed, baseUrl);
  }

  const normalizeRemoteProtocol = (u: string): string => {
    if (u.startsWith('//')) return `https:${u}`;
    if (/^http:\/\//i.test(u)) return `https://${u.slice(7)}`;
    return u;
  };

  if (trimmed.startsWith('/api/img-proxy?')) {
    if (mode === 'static') {
      const unwrapped = normalizeRemoteProtocol(unwrapProxyImageUrl(trimmed));
      if (doubanRelayUrl && /doubanio\.com/i.test(unwrapped)) {
        return `${doubanRelayUrl.replace(/\/+$/, '')}/img?url=${encodeURIComponent(unwrapped)}`;
      }
      return unwrapped;
    }
    return trimmed;
  }

  const normalized = normalizeRemoteProtocol(trimmed);
  if (mode === 'static' && doubanRelayUrl && /doubanio\.com/i.test(normalized)) {
    return `${doubanRelayUrl.replace(/\/+$/, '')}/img?url=${encodeURIComponent(normalized)}`;
  }

  return normalized;
}

/**
 * Extracts a direct remote HTTP(S) fallback URL from a proxied URL if available.
 * Used by ArchivalImage as an automatic fallback when `/api/img-proxy` is unavailable.
 */
export function getDirectImageFallbackUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('/api/img-proxy?')) return null;
  const unwrapped = unwrapProxyImageUrl(trimmed);
  if (unwrapped && /^https?:\/\//i.test(unwrapped)) {
    return unwrapped.replace(/^http:\/\//i, 'https://');
  }
  return null;
}

/**
 * Formats an image URL for storage depending on whether the Node proxy server is active.
 */
export function formatCoverUrlForMode(
  rawUrl: string | undefined,
  mode: RuntimeMode
): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('/src/assets/') ||
    trimmed.startsWith('./src/assets/')
  ) {
    return trimmed;
  }

  if (trimmed.startsWith('/api/img-proxy?')) {
    return mode === 'static' ? unwrapProxyImageUrl(trimmed) : trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return mode === 'server'
      ? `/api/img-proxy?url=${encodeURIComponent(trimmed)}`
      : trimmed;
  }

  return trimmed;
}
