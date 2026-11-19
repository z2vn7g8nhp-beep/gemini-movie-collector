import { normalizeRelayBaseUrl } from './doubanParsers';

const RELAY_STORAGE_KEY = 'cinearchive_douban_relay_url_v1';

/**
 * Resolves the optional Douban Relay / Proxy URL used in pure-static (GitHub Pages) mode.
 * Priority: `?doubanProxy=` / `?api=` query param -> localStorage -> VITE_DOUBAN_PROXY_URL.
 */
export function getConfiguredDoubanRelayUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery =
        params.get('doubanProxy') || params.get('api') || '';
      const normQuery = normalizeRelayBaseUrl(fromQuery);
      if (normQuery) {
        try {
          window.localStorage.setItem(RELAY_STORAGE_KEY, normQuery);
        } catch {
          // ignore storage error
        }
        return normQuery;
      }
    } catch {
      // ignore URL error
    }

    try {
      const saved = window.localStorage.getItem(RELAY_STORAGE_KEY);
      const normSaved = normalizeRelayBaseUrl(saved);
      if (normSaved) return normSaved;
    } catch {
      // ignore storage error
    }
  }

  const fromEnv =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_DOUBAN_PROXY_URL as string | undefined)
      : undefined;
  return normalizeRelayBaseUrl(fromEnv);
}

export function saveDoubanRelayUrl(rawUrl: string): string {
  const normalized = normalizeRelayBaseUrl(rawUrl);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(RELAY_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(RELAY_STORAGE_KEY);
      }
    } catch {
      // ignore storage error
    }
  }
  return normalized;
}

export const CLOUDFLARE_WORKER_SNIPPET = `const ALLOWED = new Set(['m.douban.com', 'movie.douban.com', 'www.douban.com']);
const WX_REF = 'https://servicewechat.com/wx2f9b06c1de1ccfba/91/page-frame.html';
const WX_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.40';
const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const cors = (h = {}) => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', ...h });

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    const u = new URL(req.url);
    if (u.pathname === '/health' || u.pathname === '/') {
      return new Response(JSON.stringify({ ok: true }), { headers: cors({ 'Content-Type': 'application/json' }) });
    }
    let t;
    try { t = new URL(u.searchParams.get('url') || ''); } catch { return new Response('Bad url', { status: 400, headers: cors() }); }
    if (u.pathname === '/img' || u.pathname === '/api/img-proxy') {
      if (!t.hostname.endsWith('doubanio.com')) return new Response('Forbidden', { status: 403, headers: cors() });
      const r = await fetch(t, { headers: { 'User-Agent': WEB_UA, Referer: 'https://movie.douban.com/' } });
      return new Response(r.body, { status: r.status, headers: cors({ 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }) });
    }
    if (u.pathname === '/douban') {
      if (!ALLOWED.has(t.hostname)) return new Response('Forbidden', { status: 403, headers: cors() });
      const isRex = t.hostname === 'm.douban.com';
      const r = await fetch(t, { headers: { 'User-Agent': isRex ? WX_UA : WEB_UA, Referer: isRex ? WX_REF : 'https://movie.douban.com/' } });
      return new Response(r.body, { status: r.status, headers: cors({ 'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8' }) });
    }
    return new Response('Not found', { status: 404, headers: cors() });
  },
};`;
