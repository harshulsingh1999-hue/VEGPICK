import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createCloudStack, type FirebaseAppletMeta } from './server/cloudStack.ts';

dotenv.config();
if (fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local'))) {
  dotenv.config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local'),
    override: false
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface QuoteItemInput {
  pricePerKg: number;
  selectedWeight: number;
  quantity: number;
}

interface QuoteRequestBody {
  items?: QuoteItemInput[];
  taxRate?: number;
  baseDeliveryFee?: number;
  freeDeliveryThreshold?: number;
  discountType?: 'percent' | 'flat';
  discountValue?: number;
  minOrder?: number;
}

interface VerifyStockItemInput {
  id?: string;
  name?: string;
  available?: boolean;
  selectedWeight?: number;
  quantity?: number;
  pricePerKg?: number;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  // Cross-origin headers for multi-server failover & Cloudflare Workers edge proxies
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // Load provisioned Firebase project metadata (public client config only, no secrets)
  let firebaseMeta: FirebaseAppletMeta = {};
  const firebaseConfigPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    try {
      firebaseMeta = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8')) as FirebaseAppletMeta;
    } catch {
      firebaseMeta = {};
    }
  }

  const cloud = createCloudStack(__dirname, firebaseMeta);
  app.use('/uploads', express.static(cloud.uploadsDir, { maxAge: '365d', immutable: true }));

  // Live per-endpoint Server & API Quota Usage Telemetry
  app.use('/api', (req, res, next) => {
    const startMs = performance.now();
    const p = req.path || '';
    res.on('finish', () => {
      let endpointId = '';
      if (p === '/health') endpointId = 'api-health';
      else if (p === '/public/runtime-config') endpointId = 'api-runtime-config';
      else if (p === '/catalog/bootstrap') endpointId = 'api-bootstrap';
      else if (p === '/catalog/invalidate') endpointId = 'api-invalidate';
      else if (p === '/orders/verify-stock') endpointId = 'api-verify-stock';
      else if (p === '/orders/quote') endpointId = 'api-quote';
      else if (p === '/slots') endpointId = 'api-slots';
      else if (p === '/media/upload') endpointId = 'api-media-upload';
      else if (p === '/archive/order' || p === '/archive/ledger') endpointId = 'api-archive-order';
      else if (p === '/analytics/summary') endpointId = 'api-analytics-summary';
      else if (p.startsWith('/admin/databases')) endpointId = 'api-admin-databases';
      else if (p.startsWith('/admin/servers')) endpointId = 'api-admin-servers';
      else if (
        p.startsWith('/admin/maintenance') ||
        p.startsWith('/admin/cleanup') ||
        p.startsWith('/admin/diagnostics')
      ) {
        endpointId = 'api-admin-servers';
      }
      if (!endpointId) return;

      const xCache = String(res.getHeader('X-Cache') || '');
      const xCatalog = String(res.getHeader('X-Catalog-Source') || '');
      const cacheHit =
        xCache.startsWith('HIT') ||
        xCatalog === 'memory-l1' ||
        xCatalog === 'upstash-l2';
      cloud.recordApiUsage(endpointId, {
        latencyMs: performance.now() - startMs,
        statusCode: res.statusCode,
        cacheHit,
        rateLimited: res.statusCode === 429
      });
    });
    next();
  });

  const applyRateLimit =
    (bucket: 'upload' | 'verify-stock' | 'quote' | 'archive' | 'invalidate', windowSeconds: number): express.RequestHandler =>
    async (req, res, next) => {
      const serverCfg = cloud.getServerControlConfig();
      res.setHeader(
        'X-Server-Cluster',
        `2-Primary+2-Backup (${process.env.REPLICA_ID || 'node-1'})`
      );
      if (serverCfg.unlimitedFreeMode !== false) {
        res.setHeader('X-Server-Plan', 'Free-Unlimited');
        res.setHeader('X-RateLimit-Remaining', 'Unlimited');
        next();
        return;
      }

      const limits = serverCfg.rateLimits;
      const maxRequests =
        bucket === 'upload'
          ? limits.uploadPerMin
          : bucket === 'verify-stock'
          ? limits.verifyStockPerMin
          : bucket === 'quote'
          ? limits.quotePerMin
          : bucket === 'archive'
          ? limits.archivePerMin
          : limits.invalidatePerMin;
      const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
      const result = await cloud.checkRateLimit(bucket, clientIp, maxRequests, windowSeconds);
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.resetSeconds));
        res.status(429).json({
          error: 'Too many requests from this device. Please retry shortly.'
        });
        return;
      }
      next();
    };

  const requireAdmin: express.RequestHandler = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const check = await cloud.verifyFirebaseAdminToken(token);
    if (!check.authorized) {
      res.status(401).json({ error: check.reason || 'Admin authorization required.' });
      return;
    }
    next();
  };

  // Health & Multi-Cloud Diagnostics API
  app.get('/api/health', (_req, res) => {
    const diag = cloud.getDiagnostics();
    res.json({
      status: 'healthy',
      service: 'FreshVeggie Delivery API',
      runtime: `Node.js ${process.version}`,
      backend: 'Express 4 + TypeScript',
      database: diag.databases.realtimePrimary,
      multiDatabase: diag.databases,
      auth: 'Firebase Authentication (Mobile Phone OTP + Google OAuth 2.0)',
      mediaStorage: diag.objectStorage,
      cache: {
        engine: `L1 Memory + ${diag.caches.l2Provider}`,
        entries: diag.caches.l1Entries,
        l1Hits: diag.caches.l1Hits,
        l2Hits: diag.caches.l2Hits,
        misses: diag.caches.misses
      },
      serverNode: {
        replicaId: diag.replicaId,
        region: diag.region
      },
      serverCluster: diag.cluster,
      cloudProjectId: firebaseMeta.projectId || null,
      firestoreDatabaseId: firebaseMeta.firestoreDatabaseId || null,
      platforms: ['Web', 'Android PWA/TWA', 'iOS Safari PWA'],
      timestamp: new Date().toISOString()
    });
  });

  // Public Dynamic Failover Origin Config (consumed by apiClient.ts)
  app.get('/api/public/runtime-config', (_req, res) => {
    const cfg = cloud.getServerControlConfig();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json({
      autoServerFailover: cfg.autoServerFailover,
      unlimitedFreeMode: cfg.unlimitedFreeMode !== false,
      serverNodes: cfg.serverNodes
        .filter((n) => n.enabled)
        .sort((a, b) => a.priority - b.priority)
    });
  });

  // Edge-Cached Storefront Bootstrap API (eliminates millions of direct Firestore reads at 1M DAU)
  app.get('/api/catalog/bootstrap', async (req, res) => {
    const payload = await cloud.getCatalogBootstrap();
    const ttlSec = cloud.getServerControlConfig().catalogTtlSeconds || 120;
    const etag = `"${crypto
      .createHash('sha1')
      .update(
        JSON.stringify({
          p: payload.products,
          c: payload.coupons,
          a: payload.serviceAreas,
          s: payload.settings
        })
      )
      .digest('hex')}"`;

    res.setHeader(
      'Cache-Control',
      `public, max-age=30, s-maxage=${ttlSec}, stale-while-revalidate=600`
    );
    res.setHeader('ETag', etag);
    res.setHeader('X-Catalog-Source', payload.source);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.json(payload);
  });

  app.post('/api/catalog/invalidate', applyRateLimit('invalidate', 60), async (_req, res) => {
    await cloud.invalidateCatalogCache();
    res.json({ ok: true });
  });

  // Compressed Media Upload Endpoint (< 300 KB -> Cloudflare R2 or Express Static Fallback)
  app.post('/api/media/upload', applyRateLimit('upload', 60), async (req, res) => {
    const body = (req.body || {}) as {
      base64?: string;
      mimeType?: string;
      prefix?: string;
    };

    const allowedMimes: Record<string, string> = {
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'image/png': 'png'
    };

    const ext = body.mimeType ? allowedMimes[body.mimeType] : undefined;
    if (!ext || typeof body.base64 !== 'string' || !body.base64) {
      res.status(400).json({ error: 'Valid base64 image payload (webp/jpeg/png) is required.' });
      return;
    }

    const cleanBase64 = body.base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.byteLength === 0 || buffer.byteLength > 300 * 1024) {
      res.status(413).json({ error: 'Compressed image must be between 1 byte and 300 KB.' });
      return;
    }

    const safePrefix = body.prefix === 'proof' ? 'proof' : 'product';
    const fileName = `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    try {
      const stored = await cloud.uploadMediaObject(buffer, body.mimeType!, fileName);
      res.status(201).json({
        url: stored.url,
        sizeBytes: buffer.byteLength,
        mimeType: body.mimeType,
        storageBackend: stored.storageBackend
      });
    } catch (err) {
      console.error('Failed to persist uploaded media:', err);
      res.status(500).json({ error: 'Unable to store uploaded media file.' });
    }
  });

  // Real-time Delivery Slot Availability API (L1/L2 60s TTL + Edge Cache)
  app.get('/api/slots', async (_req, res) => {
    const now = new Date();
    const currentHour = now.getHours();
    const cacheKey = `slots_${now.toISOString().split('T')[0]}_${currentHour}`;
    const cached = await cloud.getCached<{
      days: Array<{ dayOffset: number; isoDate: string; slots: string[] }>;
    }>(cacheKey);

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');

    if (cached) {
      res.setHeader('X-Cache', `HIT-${cached.tier.toUpperCase()}`);
      res.json(cached.value);
      return;
    }

    const allDailySlots = [
      { id: 'morning_1', label: '6:00 AM - 8:00 AM', startHour: 6 },
      { id: 'morning_2', label: '8:00 AM - 10:00 AM', startHour: 8 },
      { id: 'morning_3', label: '10:00 AM - 12:00 PM', startHour: 10 },
      { id: 'evening_1', label: '4:00 PM - 5:00 PM', startHour: 16 },
      { id: 'evening_2', label: '5:00 PM - 6:00 PM', startHour: 17 },
      { id: 'evening_3', label: '6:00 PM - 7:00 PM', startHour: 18 },
      { id: 'evening_4', label: '7:00 PM - 8:00 PM', startHour: 19 },
      { id: 'evening_5', label: '8:00 PM - 9:00 PM', startHour: 20 }
    ];

    const days = [0, 1, 2].map((offset) => {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + offset);
      const slots = allDailySlots.filter((slot) =>
        offset === 0 ? slot.startHour > currentHour : true
      );
      return {
        dayOffset: offset,
        isoDate: targetDate.toISOString().split('T')[0],
        slots: slots.map((s) => s.label)
      };
    });

    const slotsTtlSec = cloud.getServerControlConfig().slotsTtlSeconds || 60;
    const payload = { days };
    await cloud.setCached(cacheKey, payload, slotsTtlSec * 1000);
    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  });

  // Pre-Checkout Authoritative Stock, Store Status, Area/Pincode Fence & Pack-Weight Verification API
  app.post('/api/orders/verify-stock', applyRateLimit('verify-stock', 60), async (req, res) => {
    const items = Array.isArray(req.body?.items) ? (req.body.items as VerifyStockItemInput[]) : [];
    const requestedPincode =
      typeof req.body?.pincode === 'string' ? req.body.pincode.replace(/\D/g, '').trim() : '';
    if (items.length === 0) {
      res.status(400).json({ ok: false, error: 'Cart is empty.' });
      return;
    }

    const bootstrap = await cloud.getCatalogBootstrap();
    if (bootstrap.settings && bootstrap.settings.storeOpen === false) {
      res.status(409).json({
        ok: false,
        storeClosed: true,
        error: 'Store is currently paused by administration and not accepting new orders.'
      });
      return;
    }

    const activeAreas = (bootstrap.serviceAreas || []).filter((a) => a.isActive !== false);
    const matchedArea = requestedPincode
      ? activeAreas.find((a) => String(a.pincode || '').replace(/\D/g, '') === requestedPincode) || null
      : null;

    if (bootstrap.settings?.restrictToServiceAreas === true) {
      if (!requestedPincode || !matchedArea) {
        res.status(409).json({
          ok: false,
          areaRestricted: true,
          error: requestedPincode
            ? `Pincode ${requestedPincode} is outside our currently enabled local delivery zones.`
            : 'Please select a delivery address with an approved local pincode.'
        });
        return;
      }
    }

    const liveCatalogMap = new Map<string, { available?: boolean; name?: string }>();
    for (const prod of bootstrap.products) {
      if (typeof prod.id === 'string' && prod.id) {
        liveCatalogMap.set(prod.id, {
          available: prod.available !== false,
          name: typeof prod.name === 'string' ? prod.name : undefined
        });
      }
    }

    const unavailableItems: string[] = [];
    let staleCatalog = false;

    for (const item of items) {
      const liveProd = item.id ? liveCatalogMap.get(item.id) : undefined;
      if (liveProd) {
        if (liveProd.available === false) {
          unavailableItems.push(liveProd.name || item.name || item.id || 'Item');
          if (item.available !== false) {
            staleCatalog = true;
          }
        }
      } else if (item.available === false) {
        unavailableItems.push(item.name || item.id || 'Item');
      }
    }

    const invalidItems = items
      .filter(
        (item) =>
          !Number.isFinite(Number(item.quantity)) ||
          Number(item.quantity) <= 0 ||
          !Number.isFinite(Number(item.selectedWeight)) ||
          Number(item.selectedWeight) <= 0 ||
          !Number.isFinite(Number(item.pricePerKg)) ||
          Number(item.pricePerKg) < 0
      )
      .map((item) => item.name || item.id || 'Item');

    if (unavailableItems.length > 0 || invalidItems.length > 0) {
      if (staleCatalog) {
        await cloud.invalidateCatalogCache();
      }
      res.status(409).json({
        ok: false,
        staleCatalog,
        unavailableItems,
        invalidItems,
        error:
          unavailableItems.length > 0
            ? `Currently out of stock: ${unavailableItems.join(', ')}`
            : `Invalid weight or quantity for: ${invalidItems.join(', ')}`
      });
      return;
    }

    res.json({ ok: true, verifiedCount: items.length, catalogSource: bootstrap.source, matchedArea });
  });

  // Server-side Pricing & Order Quote Verification API (L1/L2 TTL cached)
  app.post('/api/orders/quote', applyRateLimit('quote', 60), async (req, res) => {
    const body = (req.body || {}) as QuoteRequestBody;
    const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    const taxRate = Math.max(0, Math.min(50, Number(body.taxRate) || 0));
    const baseDeliveryFee = Math.max(0, Number(body.baseDeliveryFee) || 0);
    const freeDeliveryThreshold = Math.max(0, Number(body.freeDeliveryThreshold) || 0);
    const discountType = body.discountType === 'percent' ? 'percent' : 'flat';
    const discountValue = Math.max(0, Number(body.discountValue) || 0);
    const minOrder = Math.max(0, Number(body.minOrder) || 0);

    const normalizedKey = JSON.stringify({
      items: items.map((i) => ({
        p: Math.max(0, Number(i.pricePerKg) || 0),
        w: Math.max(0, Number(i.selectedWeight) || 0),
        q: Math.max(0, Number(i.quantity) || 0)
      })),
      taxRate,
      baseDeliveryFee,
      freeDeliveryThreshold,
      discountType,
      discountValue,
      minOrder
    });
    const cacheKey = `quote_${normalizedKey}`;
    const cached = await cloud.getCached<{
      subtotal: number;
      taxAmount: number;
      deliveryFee: number;
      discount: number;
      total: number;
    }>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', `HIT-${cached.tier.toUpperCase()}`);
      res.json(cached.value);
      return;
    }

    const subtotal = items.reduce((sum, item) => {
      const pricePerKg = Math.max(0, Number(item.pricePerKg) || 0);
      const weight = Math.max(0, Number(item.selectedWeight) || 0);
      const qty = Math.max(0, Number(item.quantity) || 0);
      return sum + (pricePerKg / 1000) * weight * qty;
    }, 0);

    const taxAmount = Math.round((subtotal * taxRate) / 100);
    const deliveryFee = subtotal >= freeDeliveryThreshold ? 0 : baseDeliveryFee;

    let discount = 0;
    if (subtotal >= minOrder && discountValue > 0) {
      discount =
        discountType === 'percent'
          ? Math.round((subtotal * discountValue) / 100)
          : Math.round(discountValue);
    }

    const total = Math.max(0, Math.round(subtotal) + taxAmount + deliveryFee - discount);
    const quote = {
      subtotal: Math.round(subtotal),
      taxAmount,
      deliveryFee,
      discount,
      total
    };
    const quoteTtlSec = cloud.getServerControlConfig().quoteTtlSeconds || 30;
    await cloud.setCached(cacheKey, quote, quoteTtlSec * 1000);
    res.setHeader('X-Cache', 'MISS');
    res.json(quote);
  });

  // Multi-Database Relational Archive & SQL Analytics Endpoints (SQLite WAL + Supabase Postgres)
  app.post('/api/archive/order', applyRateLimit('archive', 60), async (req, res) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id.trim().slice(0, 128) : '';
    const userId = typeof b.userId === 'string' ? b.userId.trim().slice(0, 128) : '';
    if (!id || !userId) {
      res.status(400).json({ error: 'Order id and userId are required.' });
      return;
    }

    await cloud.archiveOrder({
      id,
      userId,
      city: typeof b.city === 'string' ? b.city.trim().slice(0, 80) : '',
      total: Math.max(0, Number(b.total) || 0),
      status: typeof b.status === 'string' ? b.status.slice(0, 32) : 'placed',
      paymentMethod: typeof b.paymentMethod === 'string' ? b.paymentMethod.slice(0, 24) : 'cod',
      paymentStatus: typeof b.paymentStatus === 'string' ? b.paymentStatus.slice(0, 20) : 'pending',
      assignedToUid: typeof b.assignedToUid === 'string' ? b.assignedToUid.slice(0, 128) : '',
      itemCount: Math.max(0, Number(b.itemCount) || 0),
      date: typeof b.date === 'string' ? b.date.slice(0, 64) : new Date().toISOString()
    });
    res.status(202).json({ ok: true });
  });

  app.post('/api/archive/ledger', applyRateLimit('archive', 60), async (req, res) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id.trim().slice(0, 128) : '';
    const partnerUid = typeof b.partnerUid === 'string' ? b.partnerUid.trim().slice(0, 128) : '';
    if (!id || !partnerUid) {
      res.status(400).json({ error: 'Ledger id and partnerUid are required.' });
      return;
    }

    await cloud.archiveLedgerEntry({
      id,
      partnerUid,
      orderId: typeof b.orderId === 'string' ? b.orderId.slice(0, 128) : '',
      type: typeof b.type === 'string' ? b.type.slice(0, 32) : 'trip_credit',
      amount: Math.max(0, Number(b.amount) || 0)
    });
    res.status(202).json({ ok: true });
  });

  app.get('/api/analytics/summary', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    res.json(cloud.getSqlAnalyticsSummary());
  });

  // Super Admin Database Control Center APIs
  app.get('/api/admin/databases', requireAdmin, async (_req, res) => {
    try {
      const report = await cloud.getDatabasesReport();
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to inspect database telemetry.'
      });
    }
  });

  app.post('/api/admin/databases/config', requireAdmin, async (req, res) => {
    const updated = cloud.updateDbControlConfig((req.body || {}) as Record<string, unknown>);
    await cloud.invalidateCatalogCache();
    res.json({ ok: true, controlConfig: updated });
  });

  app.post('/api/admin/databases/action', requireAdmin, async (req, res) => {
    const action = typeof req.body?.action === 'string' ? req.body.action : '';
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const result = await cloud.runDatabaseAction(action, token);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Super Admin Server & API Control Center APIs
  app.get('/api/admin/servers', requireAdmin, (_req, res) => {
    res.json(cloud.getServersAndApisReport(PORT));
  });

  app.post('/api/admin/servers/config', requireAdmin, (req, res) => {
    const updated = cloud.updateServerControlConfig((req.body || {}) as Record<string, unknown>);
    res.json({ ok: true, controlConfig: updated });
  });

  app.post('/api/admin/servers/probe', requireAdmin, async (req, res) => {
    const target = typeof req.body?.target === 'string' ? req.body.target : '';
    const result = await cloud.probeServerOrApi(target, PORT);
    res.json(result);
  });

  app.post('/api/admin/servers/reset-usage', requireAdmin, (_req, res) => {
    res.json(cloud.resetApiQuotaUsage());
  });

  // Public Client Error Telemetry Guard (Android PWA/TWA, iOS Safari/WebClip, Desktop Web)
  app.post('/api/diagnostics/report', async (req, res) => {
    const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
    const rateCheck = await cloud.checkRateLimit('diagnostics-report', clientIp, 30, 60);
    if (!rateCheck.allowed) {
      res.status(429).json({ ok: false, error: 'Diagnostic rate limit exceeded.' });
      return;
    }

    const body = (req.body || {}) as {
      platform?: 'android' | 'ios' | 'web' | 'server';
      severity?: 'info' | 'warning' | 'error';
      category?: string;
      message?: string;
      route?: string;
    };
    const msg = typeof body.message === 'string' ? body.message.trim() : '';
    if (!msg) {
      res.status(400).json({ ok: false, error: 'Diagnostic message is required.' });
      return;
    }

    const saved = cloud.maintenance.recordDiagnosticEvent({
      platform: body.platform || 'web',
      severity: body.severity || 'error',
      category: body.category || 'runtime',
      message: msg,
      route: body.route || '',
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : ''
    });
    res.status(202).json({ ok: true, id: saved.id });
  });

  // Super Admin CleanUp & Cross-Platform App Diagnosis (Android + iOS + Web)
  app.get('/api/admin/maintenance', requireAdmin, async (_req, res) => {
    try {
      const overview = await cloud.maintenance.getMaintenanceOverview(PORT);
      res.json(overview);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to load maintenance & diagnostics overview.'
      });
    }
  });

  app.post('/api/admin/cleanup/config', requireAdmin, (req, res) => {
    const updated = cloud.maintenance.updateCleanupControlConfig(
      (req.body || {}) as Record<string, unknown>
    );
    res.json({ ok: true, controlConfig: updated });
  });

  app.post('/api/admin/cleanup/run', requireAdmin, async (req, res) => {
    const body = (req.body || {}) as {
      mode?: 'auto' | 'manual';
      purgeAllL1?: boolean;
      purgeL2Catalog?: boolean;
      pruneProofDaysOverride?: number;
    };
    const mode = body.mode === 'auto' ? 'auto' : 'manual';
    const result = await cloud.maintenance.runSystemCleanup(mode, {
      purgeAllL1: Boolean(body.purgeAllL1),
      purgeL2Catalog: Boolean(body.purgeL2Catalog),
      pruneProofDaysOverride:
        typeof body.pruneProofDaysOverride === 'number' ? body.pruneProofDaysOverride : undefined
    });
    res.json(result);
  });

  app.post('/api/admin/diagnostics/config', requireAdmin, (req, res) => {
    const updated = cloud.maintenance.updateDiagnosticsControlConfig(
      (req.body || {}) as Record<string, unknown>
    );
    res.json({ ok: true, controlConfig: updated });
  });

  app.post('/api/admin/diagnostics/run', requireAdmin, async (req, res) => {
    const body = (req.body || {}) as {
      mode?: 'auto' | 'manual';
      runSelfHeal?: boolean;
    };
    const mode = body.mode === 'auto' ? 'auto' : 'manual';
    const report = await cloud.maintenance.runCrossPlatformDiagnostics(mode, PORT, {
      runSelfHeal: typeof body.runSelfHeal === 'boolean' ? body.runSelfHeal : undefined
    });
    res.json(report);
  });

  app.post('/api/admin/diagnostics/resolve', requireAdmin, (req, res) => {
    const target = typeof req.body?.target === 'string' ? req.body.target : 'all';
    const result = cloud.maintenance.resolveDiagnosticEvents(target);
    res.json(result);
  });

  // Explicit 404 for unknown API or missing uploaded media paths so SPA fallback never intercepts them
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });
  app.use('/uploads', (_req, res) => {
    res.status(404).json({ error: 'Media file not found.' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false
      },
      appType: 'spa'
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) {
          next();
          return;
        }
        const safeCode = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* Vite HMR WebSocket disabled in preview */'
          )
          .replace(
            'throw new Error("send was called before connect");',
            'return;'
          )
          .replace(
            'throw new Error("invoke was called before connect");',
            'return null;'
          );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(safeCode);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `FreshVeggie server listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start FreshVeggie server:', err);
  process.exit(1);
});
