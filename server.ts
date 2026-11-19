import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchCharacterProfile,
  fetchOnlineRelations,
  searchCoverCandidates,
  searchOnlineMedia,
} from './src/services/mediaSearchEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(__dirname, 'data');
const COLLECTION_FILE = path.join(DATA_DIR, 'collection.json');
const COLLECTOR_FILE = path.join(DATA_DIR, 'collector.json');

interface ServerArchiveItem {
  id: string;
  accessionNo: string;
  category: 'film' | 'person' | 'character';
  title: string;
  originalTitle?: string;
  subtitle?: string;
  year?: string;
  region?: string;
  coverUrl?: string;
  summary: string;
  quote?: string;
  notes: string;
  rating: number;
  status: 'favorite' | 'watched' | 'watching' | 'watchlist';
  tags: string[];
  relatedIds: string[];
  relatedWorkTitle?: string;
  portrayedBy?: string;
  characterProfile?: Record<string, any>;
  sourceName?: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStoredCollection(): ServerArchiveItem[] | null {
  try {
    if (!fs.existsSync(COLLECTION_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(COLLECTION_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as ServerArchiveItem[];
    }
    if (Array.isArray(parsed?.items)) {
      return parsed.items as ServerArchiveItem[];
    }
    return null;
  } catch (err) {
    console.error('[collection] Failed to read collection file:', err);
    return null;
  }
}

function writeStoredCollection(items: ServerArchiveItem[]): void {
  ensureDataDir();
  fs.writeFileSync(
    COLLECTION_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2),
    'utf-8'
  );
}

interface ServerCollectorState {
  checkInDates: string[];
  albums: Array<{
    id: string;
    name: string;
    description?: string;
    tag?: string;
    itemIds?: string[];
    targetCount: number;
    createdAt: string;
  }>;
}

function readStoredCollectorState(): ServerCollectorState {
  try {
    if (!fs.existsSync(COLLECTOR_FILE)) {
      return { checkInDates: [], albums: [] };
    }
    const raw = fs.readFileSync(COLLECTOR_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      checkInDates: Array.isArray(parsed?.checkInDates)
        ? parsed.checkInDates.filter((d: unknown): d is string => typeof d === 'string')
        : [],
      albums: Array.isArray(parsed?.albums) ? parsed.albums : [],
    };
  } catch {
    return { checkInDates: [], albums: [] };
  }
}

function writeStoredCollectorState(state: ServerCollectorState): void {
  ensureDataDir();
  fs.writeFileSync(
    COLLECTOR_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2),
    'utf-8'
  );
}

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (/^10\./.test(lower) || /^192\.168\./.test(lower) || /^169\.254\./.test(lower)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) {
    return true;
  }
  return false;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 6500
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function createServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '6mb' }));

  // 1. Health & direct-link info
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, mode: 'direct-proxy' });
  });

  // 2. Collection REST API (Server-side JSON persistence)
  app.get('/api/collection', (_req: Request, res: Response) => {
    const stored = readStoredCollection();
    res.json({
      initialized: stored !== null,
      items: stored ?? [],
    });
  });

  app.post('/api/collection/init', (req: Request, res: Response) => {
    const existing = readStoredCollection();
    if (existing !== null) {
      res.json({ items: existing });
      return;
    }
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as ServerArchiveItem[])
      : [];
    writeStoredCollection(items);
    res.json({ items });
  });

  app.post('/api/collection', (req: Request, res: Response) => {
    const item = req.body as ServerArchiveItem;
    if (!item || !item.id || !item.title || !item.category) {
      res.status(400).json({ error: '缺少必填字段（id / title / category）' });
      return;
    }
    const items = readStoredCollection() ?? [];
    const next = [item, ...items.filter((i) => i.id !== item.id)];
    writeStoredCollection(next);
    res.status(201).json({ item, items: next });
  });

  app.put('/api/collection/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const patch = req.body as Partial<ServerArchiveItem>;
    const items = readStoredCollection() ?? [];
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) {
      res.status(404).json({ error: '未找到对应的馆藏条目' });
      return;
    }
    const updated: ServerArchiveItem = {
      ...items[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    if (patch.coverUrl === '' || patch.coverUrl === null) {
      delete updated.coverUrl;
    }
    const next = [...items];
    next[index] = updated;
    writeStoredCollection(next);
    res.json({ item: updated, items: next });
  });

  app.delete('/api/collection/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const items = readStoredCollection() ?? [];
    const next = items
      .filter((i) => i.id !== id)
      .map((i) => ({
        ...i,
        relatedIds: Array.isArray(i.relatedIds)
          ? i.relatedIds.filter((rid) => rid !== id)
          : [],
      }));
    writeStoredCollection(next);
    res.json({ items: next });
  });

  app.post('/api/collection/replace', (req: Request, res: Response) => {
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as ServerArchiveItem[])
      : null;
    if (!items) {
      res.status(400).json({ error: '无效的馆藏数据' });
      return;
    }
    writeStoredCollection(items);
    res.json({ items });
  });

  // 2b. Collector Rituals & Custom Albums API (check-in streak + themed collector sets)
  app.get('/api/collector', (_req: Request, res: Response) => {
    res.json(readStoredCollectorState());
  });

  app.put('/api/collector', (req: Request, res: Response) => {
    const checkInDates = Array.isArray(req.body?.checkInDates)
      ? (req.body.checkInDates as unknown[]).filter(
          (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
        )
      : [];
    const albums = Array.isArray(req.body?.albums)
      ? req.body.albums.filter(
          (a: unknown): a is ServerCollectorState['albums'][number] =>
            Boolean(
              a &&
                typeof a === 'object' &&
                typeof (a as { id?: unknown }).id === 'string' &&
                typeof (a as { name?: unknown }).name === 'string'
            )
        )
      : [];
    const next: ServerCollectorState = {
      checkInDates: Array.from(new Set(checkInDates)).sort(),
      albums,
    };
    writeStoredCollectorState(next);
    res.json(next);
  });

  // 3. Direct Online Search (IMDb Primary + Douban Assist)
  app.get('/api/search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    const category = String(req.query.category || 'film');

    if (!query) {
      res.status(400).json({ error: '请输入搜索关键词', results: [] });
      return;
    }

    const payload = await searchOnlineMedia({
      query,
      category,
      source: 'imdb',
      mode: 'server',
    });
    res.json(payload);
  });

  // 3.2. Multi-Source Cover Image Candidate Search
  app.get('/api/cover-search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    const originalTitle = String(req.query.originalTitle || '').trim();
    const category = String(req.query.category || 'film');

    if (!query) {
      res.status(400).json({ error: '请输入封面搜索关键词', candidates: [] });
      return;
    }

    const payload = await searchCoverCandidates({
      query,
      originalTitle,
      category,
      mode: 'server',
    });
    res.json(payload);
  });

  // 3.5. Cross-Entity Relations Discovery (Film <-> People <-> Characters)
  app.get('/api/relations', async (req: Request, res: Response) => {
    const category = String(req.query.category || 'film');
    const title = String(req.query.title || '').trim();
    const originalTitle = String(req.query.originalTitle || '').trim() || undefined;
    const sourceUrl = String(req.query.sourceUrl || '').trim() || undefined;

    if (!title) {
      res
        .status(400)
        .json({ error: '缺少 title 参数', films: [], people: [], characters: [] });
      return;
    }

    const payload = await fetchOnlineRelations({
      category,
      title,
      originalTitle,
      sourceUrl,
      mode: 'server',
    });
    res.json(payload);
  });

  // 3.6. Dedicated Character Dossier Enrichment
  app.get('/api/character-profile', async (req: Request, res: Response) => {
    const title = String(req.query.title || '').trim();
    const originalTitle = String(req.query.originalTitle || '').trim() || undefined;
    const relatedWorkTitle =
      String(req.query.relatedWorkTitle || '').trim() || undefined;
    const sourceUrl = String(req.query.sourceUrl || '').trim() || undefined;

    if (!title) {
      res.status(400).json({ error: '缺少 title 参数', profile: {}, sources: [] });
      return;
    }

    const payload = await fetchCharacterProfile({
      title,
      originalTitle,
      relatedWorkTitle,
      sourceUrl,
      mode: 'server',
    });
    res.json(payload);
  });

  // 4. Server-Side Image Proxy (Supports Douban CDN anti-hotlink Referer + mirror retries + Bangumi/Wikipedia/TVMaze/iTunes)
  const imageProxyCache = new Map<
    string,
    { contentType: string; buffer: Buffer; expiresAt: number }
  >();

  const buildDoubanRetryUrls = (originalUrl: URL): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([originalUrl.toString()]);
    const add = (u: string) => {
      if (!seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    };
    const host = originalUrl.hostname.toLowerCase();
    const path = originalUrl.pathname;
    if (/^img\d\.doubanio\.com$/.test(host)) {
      const altHosts = ['img9.doubanio.com', 'img1.doubanio.com', 'img2.doubanio.com'].filter(
        (h) => h !== host
      );
      for (const altHost of altHosts.slice(0, 2)) {
        add(`https://${altHost}${path}`);
      }
      if (path.includes('/view/photo/m_ratio_poster/public/')) {
        add(
          `https://img9.doubanio.com${path.replace('/m_ratio_poster/', '/s_ratio_poster/')}`
        );
      }
    }
    return out;
  };

  const handleImageProxy = async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      res.status(400).send('Missing url');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).send('Invalid url');
      return;
    }

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      isBlockedHost(parsed.hostname)
    ) {
      res.status(403).send('Forbidden url');
      return;
    }

    const cacheKey = parsed.toString();
    const cached = imageProxyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buffer);
      return;
    }

    const host = parsed.hostname.toLowerCase();
    const isDoubanImg =
      host.endsWith('doubanio.com') || host.endsWith('douban.com');

    const fetchImgBuffer = async (
      targetUrl: string,
      headers: Record<string, string>
    ) => {
      try {
        const upstream = await fetchWithTimeout(
          targetUrl,
          { headers, redirect: 'follow' },
          8000
        );
        if (!upstream.ok) return null;
        const contentType = upstream.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return null;
        const buffer = Buffer.from(await upstream.arrayBuffer());
        if (isDoubanImg && buffer.byteLength < 256) return null;
        return { contentType, buffer };
      } catch {
        return null;
      }
    };

    try {
      const doubanDesktopHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };
      const doubanWechatHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40',
        Referer:
          'https://servicewechat.com/wx2f9b06c1de1ccfba/91/page-frame.html',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };
      const genericHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (compatible; CineArchive/1.0; +https://cinearchive.local)',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };

      let result = await fetchImgBuffer(
        cacheKey,
        isDoubanImg ? doubanDesktopHeaders : genericHeaders
      );

      // Retry with WeChat MiniProgram Referer & mirror CDN shards if Douban throttles a burst connection
      if (isDoubanImg && !result) {
        result = await fetchImgBuffer(cacheKey, doubanWechatHeaders);
      }
      if (isDoubanImg && !result) {
        for (const altUrl of buildDoubanRetryUrls(parsed)) {
          result = await fetchImgBuffer(altUrl, doubanDesktopHeaders);
          if (result) break;
        }
      }

      if (!result) {
        res.status(404).send('Image unavailable');
        return;
      }

      if (result.buffer.byteLength > 8 * 1024 * 1024) {
        res.status(413).send('Image too large');
        return;
      }

      if (imageProxyCache.size >= 150) {
        const oldestKey = imageProxyCache.keys().next().value;
        if (oldestKey) imageProxyCache.delete(oldestKey);
      }
      imageProxyCache.set(cacheKey, {
        contentType: result.contentType,
        buffer: result.buffer,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(result.buffer);
    } catch {
      res.status(404).send('Image fetch failed');
    }
  };

  app.get('/api/img-proxy', handleImageProxy);
  app.get('/img', handleImageProxy);

  // 4.5. CORS-Enabled Douban Relay (Allows static GitHub Pages builds to use this server as a bridge)
  app.get('/douban', async (req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const rawUrl = String(req.query.url || '').trim();
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid url' });
      return;
    }
    const allowedHosts = new Set([
      'm.douban.com',
      'movie.douban.com',
      'www.douban.com',
    ]);
    if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
      res.status(403).json({ error: 'Host not allowed' });
      return;
    }
    const isRexxar = parsed.hostname.toLowerCase() === 'm.douban.com';
    try {
      const upstream = await fetchWithTimeout(
        parsed.toString(),
        {
          headers: isRexxar
            ? {
                'User-Agent':
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40',
                Referer:
                  'https://servicewechat.com/wx2f9b06c1de1ccfba/91/page-frame.html',
                Accept: 'application/json, text/plain, */*',
              }
            : {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Referer: 'https://movie.douban.com/',
                Accept: 'application/json, text/plain, */*',
              },
        },
        6500
      );
      const body = await upstream.text();
      res
        .status(upstream.status)
        .setHeader(
          'Content-Type',
          upstream.headers.get('content-type') ||
            'application/json; charset=utf-8'
        )
        .send(body);
    } catch {
      res.status(502).json({ error: 'Douban upstream failed' });
    }
  });

  // 5. Vite Middleware (Dev) or Static Assets (Prod)
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[CineArchive] Server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('[CineArchive] Failed to start server:', err);
  process.exit(1);
});
