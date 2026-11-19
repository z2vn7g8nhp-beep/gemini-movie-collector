import type { ArchiveCategory, SearchSourceOption } from '../types/archive';
import { unwrapProxyImageUrl } from '../utils/coverPicker';
import {
  fetchCharacterProfile,
  fetchOnlineRelations,
  searchCoverCandidates,
  searchOnlineMedia,
  type CharacterProfileResponse,
  type CoverSearchResponse,
  type MediaSearchResponse,
  type OnlineRelationsResponse,
} from './mediaSearchEngine';

function getImportMetaEnv(): Record<string, any> | undefined {
  if (typeof import.meta === 'undefined') return undefined;
  return (import.meta as unknown as { env?: Record<string, any> }).env;
}

export function isStaticAppMode(): boolean {
  const env = getImportMetaEnv();
  if (!env) return false;
  return env.MODE === 'pages' || env.VITE_STATIC_MODE === 'true';
}

export function getApiBaseUrl(): string {
  const env = getImportMetaEnv();
  return String(env?.VITE_API_BASE || '')
    .trim()
    .replace(/\/+$/, '');
}

export function shouldUseBackendApi(): boolean {
  return !isStaticAppMode() || Boolean(getApiBaseUrl());
}

function normalizeBaseUrl(raw?: string): string {
  const val = (raw || '/').trim() || '/';
  return val.endsWith('/') ? val : `${val}/`;
}

export function resolveAssetOrImageUrl(
  rawUrl?: string,
  opts?: { staticMode?: boolean; baseUrl?: string; apiBase?: string }
): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  const env = getImportMetaEnv();
  const baseUrl = normalizeBaseUrl(
    opts?.baseUrl ?? (typeof env?.BASE_URL === 'string' ? env.BASE_URL : '/')
  );

  if (trimmed.startsWith('/src/assets/') || trimmed.startsWith('/assets/')) {
    return `${baseUrl}${trimmed.slice(1)}`;
  }

  const useStatic = opts?.staticMode ?? !shouldUseBackendApi();
  const apiBase =
    opts?.apiBase !== undefined
      ? opts.apiBase.trim().replace(/\/+$/, '')
      : getApiBaseUrl();

  if (trimmed.startsWith('/api/img-proxy?')) {
    if (useStatic) {
      const unwrapped = unwrapProxyImageUrl(trimmed);
      return unwrapped || undefined;
    }
    return apiBase ? `${apiBase}${trimmed}` : trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    if (useStatic) {
      return trimmed;
    }
    return `${apiBase}/api/img-proxy?url=${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

async function fetchJsonOrFallbackToBrowser<T>(
  pathWithQuery: string,
  browserFallback: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!shouldUseBackendApi()) {
    return browserFallback();
  }

  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}${pathWithQuery}`, { signal });
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');

  if (res.status === 404 || !isJson) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return browserFallback();
  }

  const data = (await res.json()) as Record<string, any>;
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string' && data.error.trim()
        ? data.error
        : `HTTP ${res.status}`
    );
  }

  return data as T;
}

export async function apiSearchMedia(params: {
  query: string;
  category: ArchiveCategory;
  source: SearchSourceOption;
  signal?: AbortSignal;
}): Promise<MediaSearchResponse> {
  const qs = new URLSearchParams({
    q: params.query.trim(),
    category: params.category,
    source: params.source,
  });
  return fetchJsonOrFallbackToBrowser(
    `/api/search?${qs.toString()}`,
    () =>
      searchOnlineMedia({
        query: params.query,
        category: params.category,
        source: params.source,
        mode: 'browser',
        signal: params.signal,
      }),
    params.signal
  );
}

export async function apiSearchCovers(params: {
  query: string;
  originalTitle?: string;
  category: ArchiveCategory;
  signal?: AbortSignal;
}): Promise<CoverSearchResponse> {
  const qs = new URLSearchParams({
    q: params.query.trim(),
    category: params.category,
  });
  if (params.originalTitle?.trim()) {
    qs.set('originalTitle', params.originalTitle.trim());
  }
  return fetchJsonOrFallbackToBrowser(
    `/api/cover-search?${qs.toString()}`,
    () =>
      searchCoverCandidates({
        query: params.query,
        originalTitle: params.originalTitle,
        category: params.category,
        mode: 'browser',
        signal: params.signal,
      }),
    params.signal
  );
}

export async function apiFetchRelations(params: {
  category: ArchiveCategory;
  title: string;
  originalTitle?: string;
  sourceUrl?: string;
  signal?: AbortSignal;
}): Promise<OnlineRelationsResponse> {
  const qs = new URLSearchParams({
    category: params.category,
    title: params.title.trim(),
  });
  if (params.originalTitle?.trim()) {
    qs.set('originalTitle', params.originalTitle.trim());
  }
  if (params.sourceUrl?.trim()) {
    qs.set('sourceUrl', params.sourceUrl.trim());
  }
  return fetchJsonOrFallbackToBrowser(
    `/api/relations?${qs.toString()}`,
    () =>
      fetchOnlineRelations({
        category: params.category,
        title: params.title,
        originalTitle: params.originalTitle,
        sourceUrl: params.sourceUrl,
        mode: 'browser',
        signal: params.signal,
      }),
    params.signal
  );
}

export async function apiFetchCharacterProfile(params: {
  title: string;
  originalTitle?: string;
  relatedWorkTitle?: string;
  sourceUrl?: string;
  signal?: AbortSignal;
}): Promise<CharacterProfileResponse> {
  const qs = new URLSearchParams({
    title: params.title.trim(),
  });
  if (params.originalTitle?.trim()) {
    qs.set('originalTitle', params.originalTitle.trim());
  }
  if (params.relatedWorkTitle?.trim()) {
    qs.set('relatedWorkTitle', params.relatedWorkTitle.trim());
  }
  if (params.sourceUrl?.trim()) {
    qs.set('sourceUrl', params.sourceUrl.trim());
  }
  return fetchJsonOrFallbackToBrowser(
    `/api/character-profile?${qs.toString()}`,
    () =>
      fetchCharacterProfile({
        title: params.title,
        originalTitle: params.originalTitle,
        relatedWorkTitle: params.relatedWorkTitle,
        sourceUrl: params.sourceUrl,
        mode: 'browser',
        signal: params.signal,
      }),
    params.signal
  );
}
