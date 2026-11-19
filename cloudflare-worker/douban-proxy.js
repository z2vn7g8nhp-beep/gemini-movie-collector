/**
 * CinéArchive Douban CORS & Image Relay (Cloudflare Worker)
 * Deploy free on https://dash.cloudflare.com -> Workers & Pages
 * Then paste your Worker URL into CinéArchive -> 我的 -> 豆瓣直连桥接
 */
const ALLOWED_API_HOSTS = new Set([
  'm.douban.com',
  'movie.douban.com',
  'www.douban.com',
]);

const WX_REFERER =
  'https://servicewechat.com/wx2f9b06c1de1ccfba/91/page-frame.html';
const WX_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40';
const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({ ok: true, service: 'cinearchive-douban-relay' }),
        { headers: corsHeaders({ 'Content-Type': 'application/json' }) }
      );
    }

    const targetRaw = url.searchParams.get('url') || '';
    let target;
    try {
      target = new URL(targetRaw);
    } catch {
      return new Response('Invalid url', { status: 400, headers: corsHeaders() });
    }

    if (url.pathname === '/img' || url.pathname === '/api/img-proxy') {
      if (!target.hostname.endsWith('doubanio.com')) {
        return new Response('Host not allowed', { status: 403, headers: corsHeaders() });
      }
      const upstream = await fetch(target.toString(), {
        headers: {
          'User-Agent': WEB_UA,
          Referer: 'https://movie.douban.com/',
        },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: corsHeaders({
          'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        }),
      });
    }

    if (url.pathname === '/douban') {
      if (!ALLOWED_API_HOSTS.has(target.hostname)) {
        return new Response('Host not allowed', { status: 403, headers: corsHeaders() });
      }
      const isRexxar = target.hostname === 'm.douban.com';
      const upstream = await fetch(target.toString(), {
        headers: {
          'User-Agent': isRexxar ? WX_UA : WEB_UA,
          Referer: isRexxar ? WX_REFERER : 'https://movie.douban.com/',
          Accept: 'application/json, text/plain, */*',
        },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: corsHeaders({
          'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=600',
        }),
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};
