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
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Push-Device-Token'
      );
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
      else if (p === '/archive/order' || p === '/archive/ledger' || p.startsWith('/admin/orders')) {
        endpointId = 'api-archive-order';
      }
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

  interface AuthenticatedRequest extends express.Request {
    authUid?: string;
    authEmail?: string;
    authIsAdmin?: boolean;
    verifiedDeviceId?: string;
  }

  const resolvePushCaller: express.RequestHandler = async (req, _res, next) => {
    const authReq = req as AuthenticatedRequest;
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (bearerToken) {
      const check = await cloud.verifyFirebaseUserToken(bearerToken);
      if (check.authenticated && check.uid) {
        authReq.authUid = check.uid;
        authReq.authEmail = check.email;
        authReq.authIsAdmin = Boolean(check.isAdmin);
      }
    }

    const rawDeviceToken =
      typeof req.headers['x-push-device-token'] === 'string'
        ? req.headers['x-push-device-token'].trim()
        : '';
    if (rawDeviceToken) {
      const devCheck = cloud.verifyDevicePushToken(rawDeviceToken);
      if (devCheck.valid && devCheck.deviceId) {
        authReq.verifiedDeviceId = devCheck.deviceId;
      }
    }
    next();
  };

  const applyPushRateLimit =
    (bucket: 'push-sub' | 'push-notify', maxPerMin: number): express.RequestHandler =>
    async (req, res, next) => {
      const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
      const result = await cloud.checkRateLimit(bucket, clientIp, maxPerMin, 60);
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.resetSeconds));
        res.status(429).json({ error: 'Too many push requests. Please retry shortly.' });
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

  let catalogResponseCache: {
    generatedAt: string;
    source: string;
    etag: string;
    json: string;
  } | null = null;

  // Edge-Cached Storefront Bootstrap API (eliminates millions of direct Firestore reads at 1M DAU)
  app.get('/api/catalog/bootstrap', async (req, res) => {
    const payload = await cloud.getCatalogBootstrap();
    const ttlSec = cloud.getServerControlConfig().catalogTtlSeconds || 120;

    if (
      !catalogResponseCache ||
      catalogResponseCache.generatedAt !== payload.generatedAt ||
      catalogResponseCache.source !== payload.source
    ) {
      const etag = `"${crypto
        .createHash('sha1')
        .update(
          JSON.stringify({
            p: payload.products,
            c: payload.coupons,
            a: payload.serviceAreas,
            d: payload.deliverySlots,
            s: payload.settings
          })
        )
        .digest('hex')}"`;
      catalogResponseCache = {
        generatedAt: payload.generatedAt,
        source: payload.source,
        etag,
        json: JSON.stringify(payload)
      };
    }

    res.setHeader(
      'Cache-Control',
      `public, max-age=30, s-maxage=${ttlSec}, stale-while-revalidate=600`
    );
    res.setHeader('ETag', catalogResponseCache.etag);
    res.setHeader('X-Catalog-Source', payload.source);

    if (req.headers['if-none-match'] === catalogResponseCache.etag) {
      res.status(304).end();
      return;
    }

    res.type('application/json').send(catalogResponseCache.json);
  });

  app.post('/api/catalog/invalidate', applyRateLimit('invalidate', 60), async (_req, res) => {
    catalogResponseCache = null;
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

    const isPng =
      ext === 'png' &&
      buffer.byteLength >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    const isJpg =
      ext === 'jpg' &&
      buffer.byteLength >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    const isWebp =
      ext === 'webp' &&
      buffer.byteLength >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isPng && !isJpg && !isWebp) {
      res.status(400).json({ error: 'Uploaded binary does not match the declared image format.' });
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

  // Real-time Delivery Slot Availability API (Dynamic Admin Schedule + L1/L2 + Edge Cache)
  app.get('/api/slots', async (_req, res) => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinutes = currentHour * 60 + now.getMinutes();
    const todayIso = now.toISOString().split('T')[0];
    const slotsVersion = cloud.getSlotsCacheVersion();
    const cacheKey = `slots_v${slotsVersion}_${todayIso}_${currentHour}`;

    interface ApiSlotOption {
      id: string;
      label: string;
      startTime: string;
      endTime: string;
      cutoffMinutes: number;
      maxOrders: number;
      notes: string;
      scheduleType: 'date' | 'daily' | 'default';
    }
    interface ApiSlotDayResponse {
      dayOffset: number;
      isoDate: string;
      slots: string[];
      slotDetails: ApiSlotOption[];
      hasDateOverride?: boolean;
      closedByAdmin?: boolean;
    }

    const cached = await cloud.getCached<{ days: ApiSlotDayResponse[]; customConfigured: boolean }>(cacheKey);

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');

    if (cached) {
      res.setHeader('X-Cache', `HIT-${cached.tier.toUpperCase()}`);
      res.json(cached.value);
      return;
    }

    const bootstrap = await cloud.getCatalogBootstrap();
    const configuredRaw = Array.isArray(bootstrap.deliverySlots) ? bootstrap.deliverySlots : [];

    const parseTimeMinutes = (hhmm: string): number => {
      const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
      if (!m) return 0;
      return Number(m[1]) * 60 + Number(m[2]);
    };

    const normalizeSlotRecord = (raw: Record<string, unknown>, idx: number) => {
      const scheduleType: 'date' | 'daily' = raw.scheduleType === 'date' ? 'date' : 'daily';
      const slotDate = typeof raw.slotDate === 'string' ? raw.slotDate.trim().slice(0, 10) : '';
      const startTime =
        typeof raw.startTime === 'string' && /^\d{2}:\d{2}$/.test(raw.startTime)
          ? raw.startTime
          : '08:00';
      const endTime =
        typeof raw.endTime === 'string' && /^\d{2}:\d{2}$/.test(raw.endTime)
          ? raw.endTime
          : '10:00';
      const label =
        typeof raw.label === 'string' && raw.label.trim()
          ? raw.label.trim().slice(0, 80)
          : `${startTime} - ${endTime}`;
      const isActive = raw.isActive !== false;
      const maxOrders = Math.max(0, Number(raw.maxOrders) || 0);
      const cutoffMinutes = Math.max(0, Math.min(1440, Number(raw.cutoffMinutes) || 0));
      const sortOrder = Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : idx;
      const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 240) : '';
      return {
        id: String(raw.id || `slot_${idx}`),
        scheduleType,
        slotDate,
        startTime,
        endTime,
        label,
        isActive,
        maxOrders,
        cutoffMinutes,
        sortOrder,
        notes
      };
    };

    const parsedSlots = configuredRaw.map(normalizeSlotRecord);
    const customConfigured = parsedSlots.length > 0;

    const defaultDailySlots: Array<ApiSlotOption & { sortOrder: number }> = [
      { id: 'morning_1', label: '6:00 AM - 8:00 AM', startTime: '06:00', endTime: '08:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 1 },
      { id: 'morning_2', label: '8:00 AM - 10:00 AM', startTime: '08:00', endTime: '10:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 2 },
      { id: 'morning_3', label: '10:00 AM - 12:00 PM', startTime: '10:00', endTime: '12:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 3 },
      { id: 'evening_1', label: '4:00 PM - 5:00 PM', startTime: '16:00', endTime: '17:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 4 },
      { id: 'evening_2', label: '5:00 PM - 6:00 PM', startTime: '17:00', endTime: '18:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 5 },
      { id: 'evening_3', label: '6:00 PM - 7:00 PM', startTime: '18:00', endTime: '19:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 6 },
      { id: 'evening_4', label: '7:00 PM - 8:00 PM', startTime: '19:00', endTime: '20:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 7 },
      { id: 'evening_5', label: '8:00 PM - 9:00 PM', startTime: '20:00', endTime: '21:00', cutoffMinutes: 0, maxOrders: 0, notes: '', scheduleType: 'default', sortOrder: 8 }
    ];

    const dateOverrides = new Map<string, ReturnType<typeof normalizeSlotRecord>[]>();
    const dailyConfigured: ReturnType<typeof normalizeSlotRecord>[] = [];

    for (const s of parsedSlots) {
      if (s.scheduleType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s.slotDate)) {
        const list = dateOverrides.get(s.slotDate) || [];
        list.push(s);
        dateOverrides.set(s.slotDate, list);
      } else if (s.scheduleType === 'daily') {
        dailyConfigured.push(s);
      }
    }

    const offsetSet = new Set<number>([-1, 0, 1, 2, 3, 4, 5, 6]);
    const todayMidnightUtc = Date.parse(`${todayIso}T00:00:00Z`);
    for (const dStr of dateOverrides.keys()) {
      const diffDays = Math.round((Date.parse(`${dStr}T00:00:00Z`) - todayMidnightUtc) / 86_400_000);
      if (diffDays >= -1 && diffDays <= 30) {
        offsetSet.add(diffDays);
      }
    }
    const sortedOffsets = Array.from(offsetSet).sort((a, b) => a - b);

    const days: ApiSlotDayResponse[] = sortedOffsets.map((offset) => {
      const targetDate = new Date(todayMidnightUtc + offset * 86_400_000);
      const isoDate = targetDate.toISOString().split('T')[0];

      if (!customConfigured) {
        const activeDefaults = offset >= -1 && offset <= 2 ? defaultDailySlots : [];
        const visibleSlots = activeDefaults.filter((slot) =>
          offset === 0 ? parseTimeMinutes(slot.startTime) > currentMinutes : offset > 0
        );
        return {
          dayOffset: offset,
          isoDate,
          slots: visibleSlots.map((s) => s.label),
          slotDetails: activeDefaults.map(({ sortOrder: _so, ...rest }) => rest),
          hasDateOverride: false,
          closedByAdmin: false
        };
      }

      const hasOverride = dateOverrides.has(isoDate);
      const rawDayList = hasOverride ? dateOverrides.get(isoDate)! : dailyConfigured;
      const activeDaySlots = rawDayList
        .filter((s) => s.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));

      const slotDetails: ApiSlotOption[] = activeDaySlots.map((s) => ({
        id: s.id,
        label: s.label,
        startTime: s.startTime,
        endTime: s.endTime,
        cutoffMinutes: s.cutoffMinutes,
        maxOrders: s.maxOrders,
        notes: s.notes,
        scheduleType: s.scheduleType
      }));

      const openNowSlots = slotDetails.filter((slot) => {
        if (offset < 0) return false;
        if (offset > 0) return true;
        return currentMinutes < parseTimeMinutes(slot.startTime) - slot.cutoffMinutes;
      });

      return {
        dayOffset: offset,
        isoDate,
        slots: openNowSlots.map((s) => s.label),
        slotDetails,
        hasDateOverride: hasOverride,
        closedByAdmin: hasOverride && slotDetails.length === 0
      };
    });

    const slotsTtlSec = cloud.getServerControlConfig().slotsTtlSeconds || 60;
    const payload = { days, customConfigured };
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

  interface QuoteValue {
    subtotal: number;
    taxAmount: number;
    deliveryFee: number;
    discount: number;
    total: number;
  }
  const quoteLocalCache = new Map<string, { value: QuoteValue; expiresAt: number }>();

  // Server-side Pricing & Order Quote Verification API (Dedicated L1 bounded cache; avoids Upstash/catalog eviction at 1M DAU)
  app.post('/api/orders/quote', applyRateLimit('quote', 60), (req, res) => {
    const body = (req.body || {}) as QuoteRequestBody;
    const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    const taxRate = Math.max(0, Math.min(50, Number(body.taxRate) || 0));
    const baseDeliveryFee = Math.max(0, Number(body.baseDeliveryFee) || 0);
    const freeDeliveryThreshold = Math.max(0, Number(body.freeDeliveryThreshold) || 0);
    const discountType = body.discountType === 'percent' ? 'percent' : 'flat';
    const discountValue = Math.max(0, Number(body.discountValue) || 0);
    const minOrder = Math.max(0, Number(body.minOrder) || 0);

    const cacheKey = JSON.stringify({
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
    const now = Date.now();
    const cached = quoteLocalCache.get(cacheKey);
    if (cached && now <= cached.expiresAt) {
      res.setHeader('X-Cache', 'HIT-L1');
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
    const quote: QuoteValue = {
      subtotal: Math.round(subtotal),
      taxAmount,
      deliveryFee,
      discount,
      total
    };
    const quoteTtlSec = cloud.getServerControlConfig().quoteTtlSeconds || 30;
    if (quoteLocalCache.size >= 500) {
      const oldest = quoteLocalCache.keys().next().value;
      if (oldest) quoteLocalCache.delete(oldest);
    }
    quoteLocalCache.set(cacheKey, { value: quote, expiresAt: now + quoteTtlSec * 1000 });
    res.setHeader('X-Cache', 'MISS');
    res.json(quote);
  });

  // Multi-Database Relational Archive & SQL Analytics Endpoints (SQLite WAL + Supabase Postgres)
  let analyticsMemo: { json: string; expiresAt: number } | null = null;

  app.post('/api/archive/order', applyRateLimit('archive', 60), async (req, res) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id.trim().slice(0, 128) : '';
    const userId = typeof b.userId === 'string' ? b.userId.trim().slice(0, 128) : '';
    if (!id || !userId) {
      res.status(400).json({ error: 'Order id and userId are required.' });
      return;
    }

    analyticsMemo = null;
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

    analyticsMemo = null;
    await cloud.archiveLedgerEntry({
      id,
      partnerUid,
      orderId: typeof b.orderId === 'string' ? b.orderId.slice(0, 128) : '',
      type: typeof b.type === 'string' ? b.type.slice(0, 32) : 'trip_credit',
      amount: Math.max(0, Number(b.amount) || 0)
    });
    res.status(202).json({ ok: true });
  });

  app.post('/api/admin/orders/delete-history', requireAdmin, async (req, res) => {
    const b = (req.body || {}) as {
      orderIds?: unknown[];
      deleteLedgerEntries?: boolean;
      proofImageUrls?: unknown[];
    };
    const rawIds = Array.isArray(b.orderIds) ? b.orderIds : [];
    const orderIds = rawIds.filter((id): id is string => typeof id === 'string');
    if (orderIds.length === 0) {
      res.status(400).json({ error: 'At least one orderId is required for manual history deletion.' });
      return;
    }

    const proofImageUrls = Array.isArray(b.proofImageUrls)
      ? b.proofImageUrls.filter((u): u is string => typeof u === 'string')
      : [];

    analyticsMemo = null;
    try {
      const result = await cloud.deleteOrderHistoryRecords({
        orderIds,
        deleteLedgerEntries: Boolean(b.deleteLedgerEntries),
        proofImageUrls
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to remove order history from archive databases.'
      });
    }
  });

  // Cross-Platform Web Push Notification APIs (Android + iOS 16.4+ Home Screen PWA + Web)
  // Supports both Firebase-signed-in sessions AND tokenless background device push sessions (X-Push-Device-Token)
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      publicKey: cloud.getVapidPublicKey(),
      supported: true
    });
  });

  app.get('/api/push/status', resolvePushCaller, (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authUid || '';
    const deviceId = authReq.verifiedDeviceId || '';
    if (!uid && !deviceId) {
      res.status(401).json({ error: 'Device push token or session required.' });
      return;
    }
    res.json({
      pushEnabled: true,
      subscribedDevices: cloud.getUserPushSubscriptionCount(uid || undefined, deviceId || undefined),
      hasDeviceToken: Boolean(deviceId)
    });
  });

  app.post(
    '/api/push/subscribe',
    applyPushRateLimit('push-sub', 40),
    resolvePushCaller,
    async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authUid || '';
      const body = (req.body || {}) as {
        subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        deviceId?: string;
        role?: string;
        platform?: string;
        sendTest?: boolean;
      };

      const role: 'customer' | 'delivery' | 'admin' =
        body.role === 'admin' && authReq.authIsAdmin
          ? 'admin'
          : body.role === 'delivery'
          ? 'delivery'
          : 'customer';
      const platform: 'android' | 'ios' | 'web' =
        body.platform === 'android' || body.platform === 'ios' ? body.platform : 'web';

      const result = cloud.upsertPushSubscription({
        uid: uid || undefined,
        deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
        verifiedDeviceId: authReq.verifiedDeviceId,
        role,
        platform,
        subscription: {
          endpoint: String(body.subscription?.endpoint || ''),
          keys: {
            p256dh: String(body.subscription?.keys?.p256dh || ''),
            auth: String(body.subscription?.keys?.auth || '')
          }
        },
        userAgent: req.headers['user-agent'] || ''
      });

      if (!result.ok) {
        res.status(400).json({ error: 'Valid HTTPS Web Push subscription payload is required.' });
        return;
      }

      const issuedDeviceToken = cloud.issueDevicePushToken(result.deviceId);

      if (body.sendTest) {
        await cloud.sendWebPush({
          targetDeviceIds: [result.deviceId],
          targetUids: uid ? [uid] : [],
          title: 'FreshVeggie Background Push Active',
          body:
            role === 'delivery'
              ? 'Background dispatch, order updates, and GPS sync alerts are active on this device.'
              : 'Background order tracking and store alerts are active on this device.',
          url:
            role === 'delivery'
              ? '/delivery/dashboard'
              : role === 'admin'
              ? '/admin/dashboard'
              : '/orders',
          tag: `push-welcome-${result.deviceId}`
        });
      }

      res.json({
        ok: true,
        deviceId: result.deviceId,
        deviceToken: issuedDeviceToken,
        subscribedDevices: cloud.getUserPushSubscriptionCount(uid || undefined, result.deviceId)
      });
    }
  );

  app.post('/api/push/unsubscribe', resolvePushCaller, (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey : '';
    if (!authReq.authUid && !authReq.verifiedDeviceId && !authKey) {
      res.status(401).json({ error: 'Device push token or session required.' });
      return;
    }
    const removed = cloud.removePushSubscription({
      uid: authReq.authUid,
      deviceId: authReq.verifiedDeviceId,
      endpoint,
      authKey: authKey || undefined
    });
    res.json({ ok: true, removed });
  });

  app.get('/api/push/pending', resolvePushCaller, (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authUid || '';
    const deviceId = authReq.verifiedDeviceId || '';
    if (!uid && !deviceId) {
      res.status(401).json({ error: 'Device push token or session required.' });
      return;
    }
    const sinceMs = Number(req.query.since) || 0;
    const events = cloud.getPendingPushEvents({
      uid: uid || undefined,
      deviceId: deviceId || undefined,
      sinceMs
    });
    res.json({ ok: true, events, serverTime: Date.now() });
  });

  app.post(
    '/api/push/notify',
    applyPushRateLimit('push-notify', 60),
    resolvePushCaller,
    async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const callerUid = authReq.authUid || '';
      const callerDeviceId = authReq.verifiedDeviceId || '';

      if (!callerUid && !callerDeviceId) {
        res.status(401).json({
          error: 'Enable push notifications on this device (device token) or sign in first.'
        });
        return;
      }

      let isCallerAdmin = Boolean(authReq.authIsAdmin);
      if (!isCallerAdmin && callerUid) {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const adminCheck = await cloud.verifyFirebaseAdminToken(token);
        isCallerAdmin = Boolean(adminCheck.authorized);
      }

      const b = (req.body || {}) as {
        title?: unknown;
        body?: unknown;
        url?: unknown;
        tag?: unknown;
        action?: unknown;
        orderId?: unknown;
        requireInteraction?: unknown;
        delaySeconds?: unknown;
        targetUids?: unknown[];
        targetRoles?: unknown[];
        targetDeviceIds?: unknown[];
        eventType?: unknown;
        actions?: Array<{ action?: string; title?: string }>;
      };

      const title =
        typeof b.title === 'string' && b.title.trim()
          ? b.title.trim().slice(0, 120)
          : 'FreshVeggie Delivery';
      const msgBody = typeof b.body === 'string' ? b.body.trim().slice(0, 300) : '';
      if (!msgBody) {
        res.status(400).json({ error: 'Notification message body is required.' });
        return;
      }

      const requestedUids = Array.isArray(b.targetUids)
        ? b.targetUids.filter((u): u is string => typeof u === 'string').slice(0, 50)
        : [];
      const requestedRoles = Array.isArray(b.targetRoles)
        ? b.targetRoles.filter(
            (r): r is 'customer' | 'delivery' | 'admin' =>
              r === 'customer' || r === 'delivery' || r === 'admin'
          )
        : [];
      const requestedDeviceIds = Array.isArray(b.targetDeviceIds)
        ? b.targetDeviceIds.filter((d): d is string => typeof d === 'string').slice(0, 50)
        : [];

      let allowedUids: string[] = [];
      let allowedRoles: Array<'customer' | 'delivery' | 'admin'> = [];
      let allowedDeviceIds: string[] = [];

      if (isCallerAdmin) {
        allowedUids = requestedUids;
        allowedRoles = requestedRoles;
        allowedDeviceIds = requestedDeviceIds;
      } else if (callerUid) {
        const eventType = typeof b.eventType === 'string' ? b.eventType : 'self';
        if (eventType === 'order_placed') {
          allowedRoles = requestedRoles.filter((r) => r === 'admin' || r === 'delivery');
          allowedUids = [callerUid];
          if (callerDeviceId) allowedDeviceIds = [callerDeviceId];
        } else if (eventType === 'order_update' || eventType === 'support_ticket') {
          allowedRoles = requestedRoles.filter((r) => r === 'admin');
          allowedUids = requestedUids.slice(0, 3);
        } else {
          allowedUids = [callerUid];
          if (callerDeviceId) allowedDeviceIds = [callerDeviceId];
        }
      } else {
        // Tokenless background/device-scoped caller: strictly scoped to the verified caller device itself
        allowedDeviceIds = callerDeviceId ? [callerDeviceId] : [];
      }

      const safeActions = Array.isArray(b.actions)
        ? b.actions
            .filter(
              (a): a is { action: string; title: string } =>
                typeof a?.action === 'string' && typeof a?.title === 'string'
            )
            .map((a) => ({ action: a.action.slice(0, 40), title: a.title.slice(0, 40) }))
            .slice(0, 2)
        : undefined;

      const safeUrl =
        typeof b.url === 'string' && b.url.startsWith('/') && !b.url.startsWith('//')
          ? b.url
          : '/';
      const delaySeconds = Math.max(0, Math.min(30, Math.round(Number(b.delaySeconds) || 0)));

      const dispatchPayload = {
        targetUids: allowedUids,
        targetRoles: allowedRoles,
        targetDeviceIds: allowedDeviceIds,
        excludeUid:
          !isCallerAdmin &&
          callerUid &&
          allowedRoles.length > 0 &&
          !allowedUids.includes(callerUid)
            ? callerUid
            : undefined,
        title,
        body: msgBody,
        url: safeUrl,
        tag: typeof b.tag === 'string' ? b.tag : undefined,
        action: typeof b.action === 'string' ? b.action : undefined,
        orderId: typeof b.orderId === 'string' ? b.orderId : undefined,
        requireInteraction: Boolean(b.requireInteraction),
        actions: safeActions
      };

      if (delaySeconds > 0) {
        const timer = setTimeout(() => {
          void cloud.sendWebPush(dispatchPayload);
        }, delaySeconds * 1000);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
        res.status(202).json({ ok: true, scheduled: true, delaySeconds });
        return;
      }

      const result = await cloud.sendWebPush(dispatchPayload);
      res.json({ ok: true, ...result });
    }
  );

  app.get('/api/analytics/summary', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    const now = Date.now();
    if (analyticsMemo && now <= analyticsMemo.expiresAt) {
      res.setHeader('X-Cache', 'HIT-L1');
      res.type('application/json').send(analyticsMemo.json);
      return;
    }
    const json = JSON.stringify(cloud.getSqlAnalyticsSummary());
    analyticsMemo = { json, expiresAt: now + 5000 };
    res.setHeader('X-Cache', 'MISS');
    res.type('application/json').send(json);
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
    // Serve a clean lightweight SW in dev preview that imports our cross-platform push handler
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(
        "importScripts('/push-sw.js');\nself.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));\n"
      );
    });
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

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `FreshVeggie server listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`
    );
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cloud.close();
    httpServer.close(() => {
      process.exit(0);
    });
    const forceTimer = setTimeout(() => {
      process.exit(0);
    }, 2000);
    if (typeof forceTimer.unref === 'function') {
      forceTimer.unref();
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start FreshVeggie server:', err);
  process.exit(1);
});
