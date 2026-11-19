import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
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

  // 3. Direct Online Multi-Source Search (delegated to shared isomorphic engine)
  app.get('/api/search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    const category = String(req.query.category || 'film');
    const source = String(req.query.source || 'all');

    if (!query) {
      res.status(400).json({ error: '请输入搜索关键词', results: [] });
      return;
    }

    const payload = await searchOnlineMedia({
      query,
      category,
      source,
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

  // 4. Server-Side Image Proxy (So images from Bangumi/Wikipedia/TVMaze/iTunes load with zero VPN!)
  app.get('/api/img-proxy', async (req: Request, res: Response) => {
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

    try {
      const upstream = await fetchWithTimeout(
        parsed.toString(),
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; CineArchive/1.0; +https://cinearchive.local)',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          redirect: 'follow',
        },
        7000
      );

      if (!upstream.ok) {
        res.status(404).send('Image unavailable');
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        res.status(415).send('Not an image');
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.byteLength > 8 * 1024 * 1024) {
        res.status(413).send('Image too large');
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch {
      res.status(404).send('Image fetch failed');
    }
  });

  // 5. Vite Middleware (Dev) or Static Assets (Prod)
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CineArchive] Server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('[CineArchive] Failed to start server:', err);
  process.exit(1);
});
