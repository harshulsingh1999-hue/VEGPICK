import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import Database from 'better-sqlite3';

export interface FirebaseAppletMeta {
  projectId?: string;
  firestoreDatabaseId?: string;
  authDomain?: string;
  apiKey?: string;
}

export interface CatalogBootstrapPayload {
  products: Array<Record<string, unknown>>;
  coupons: Array<Record<string, unknown>>;
  serviceAreas: Array<Record<string, unknown>>;
  settings: Record<string, unknown> | null;
  source: 'memory-l1' | 'upstash-l2' | 'firestore-rest' | 'sqlite-replica';
  generatedAt: string;
}

export interface ArchiveOrderPayload {
  id: string;
  userId: string;
  city: string;
  total: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  assignedToUid: string;
  itemCount: number;
  date: string;
}

export interface ArchiveLedgerPayload {
  id: string;
  partnerUid: string;
  orderId: string;
  type: string;
  amount: number;
}

export interface SqlAnalyticsSummary {
  archivedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  grossRevenue: number;
  codRevenue: number;
  upiRevenue: number;
  totalRiderPayouts: number;
  topCities: Array<{ city: string; orderCount: number; revenue: number }>;
  databaseEngine: string;
  supabaseSynced: boolean;
}

export interface DbFailoverEvent {
  from: string;
  to: string;
  reason: string;
  at: string;
}

export interface DbControlConfig {
  primaryReadDb: 'auto' | 'firestore' | 'sqlite' | 'upstash';
  autoFailoverEnabled: boolean;
  archivalSyncEnabled: boolean;
  l1CacheEnabled: boolean;
  l2CacheEnabled: boolean;
  storageTarget: 'auto' | 'r2' | 'local';
  firestoreTimeoutMs: number;
  lastFailoverEvent: DbFailoverEvent | null;
  updatedAt: string;
}

export interface ServerNodeConfig {
  id: string;
  label: string;
  url: string;
  region: string;
  role: 'primary' | 'secondary' | 'edge-worker';
  enabled: boolean;
  priority: number;
}

export interface ServerDailyQuotas {
  serverDailyQuota: number;
  quoteDailyQuota: number;
  verifyStockDailyQuota: number;
  uploadDailyQuota: number;
  bootstrapDailyQuota: number;
  firestoreReadsDailyQuota: number;
  upstashDailyQuota: number;
  authDailyQuota: number;
}

export interface ServerControlConfig {
  serverNodes: ServerNodeConfig[];
  catalogTtlSeconds: number;
  slotsTtlSeconds: number;
  quoteTtlSeconds: number;
  rateLimits: {
    uploadPerMin: number;
    verifyStockPerMin: number;
    quotePerMin: number;
    archivePerMin: number;
    invalidatePerMin: number;
  };
  dailyQuotas: ServerDailyQuotas;
  autoServerFailover: boolean;
  updatedAt: string;
}

export interface DatabaseStorageEntry {
  id: string;
  name: string;
  role: string;
  provider: string;
  status: 'connected' | 'degraded' | 'standby';
  latencyMs: number | null;
  usedBytes: number | null;
  freeTierLimitBytes: number | null;
  balanceBytes: number | null;
  recordCount: number | null;
  usageLabel: string;
  balanceLabel: string;
  details: Record<string, string | number | boolean | null>;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const BOOTSTRAPPED_ADMIN_EMAIL = 'harshulsingh1999@gmail.com';
const FIRESTORE_SPARK_BYTES = 1024 * 1024 * 1024; // 1 GiB
const SUPABASE_FREE_BYTES = 500 * 1024 * 1024; // 500 MB
const UPSTASH_FREE_BYTES = 256 * 1024 * 1024; // 256 MB
const R2_FREE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

function decodeFirestoreValue(val: unknown): unknown {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  if ('stringValue' in v) return String(v.stringValue ?? '');
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return String(v.timestampValue ?? '');
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    const arrObj = v.arrayValue as { values?: unknown[] } | undefined;
    return Array.isArray(arrObj?.values) ? arrObj.values.map(decodeFirestoreValue) : [];
  }
  if ('mapValue' in v) {
    const mapObj = v.mapValue as { fields?: Record<string, unknown> } | undefined;
    const out: Record<string, unknown> = {};
    if (mapObj?.fields) {
      for (const [k, fv] of Object.entries(mapObj.fields)) {
        out[k] = decodeFirestoreValue(fv);
      }
    }
    return out;
  }
  return null;
}

function decodeFirestoreDoc(docObj: { name?: string; fields?: Record<string, unknown> }): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (docObj.name) {
    const segments = docObj.name.split('/');
    result.__docId = segments[segments.length - 1] || '';
  }
  if (docObj.fields) {
    for (const [k, v] of Object.entries(docObj.fields)) {
      result[k] = decodeFirestoreValue(v);
    }
  }
  return result;
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function createCloudStack(rootDir: string, firebaseMeta: FirebaseAppletMeta) {
  const uploadsDir = path.join(rootDir, 'uploads');
  const dataDir = path.join(rootDir, 'data');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // SQLite Embedded WAL Edge Replica (zero-cost per-node relational DB & analytics)
  const sqlitePath = path.join(dataDir, 'edge_replica.db');
  const sqlite = new Database(sqlitePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS catalog_snapshot (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_archive (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'placed',
      payment_method TEXT NOT NULL DEFAULT 'cod',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      assigned_to_uid TEXT NOT NULL DEFAULT '',
      item_count INTEGER NOT NULL DEFAULT 0,
      order_date TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_archive_status ON order_archive(status);
    CREATE INDEX IF NOT EXISTS idx_order_archive_city ON order_archive(city);
    CREATE TABLE IF NOT EXISTS wallet_ledger_archive (
      id TEXT PRIMARY KEY,
      partner_uid TEXT NOT NULL,
      order_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_partner ON wallet_ledger_archive(partner_uid);
    CREATE TABLE IF NOT EXISTS cloud_control_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_quota_usage (
      endpoint_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      calls_total INTEGER NOT NULL DEFAULT 0,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      latency_sum_ms INTEGER NOT NULL DEFAULT 0,
      last_called_at TEXT,
      PRIMARY KEY (endpoint_id, day_key)
    );
  `);

  const upstashUrl = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  const hasUpstash = Boolean(upstashUrl && upstashToken);

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const hasSupabase = Boolean(supabaseUrl && supabaseKey);

  const r2Endpoint = (process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
  const r2Bucket = process.env.R2_BUCKET || '';
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const r2PublicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  const hasR2 = Boolean(r2Endpoint && r2Bucket && r2AccessKey && r2SecretKey && r2PublicUrl);

  const DEFAULT_DB_CONTROL: DbControlConfig = {
    primaryReadDb: 'auto',
    autoFailoverEnabled: true,
    archivalSyncEnabled: true,
    l1CacheEnabled: true,
    l2CacheEnabled: true,
    storageTarget: 'auto',
    firestoreTimeoutMs: 3500,
    lastFailoverEvent: null,
    updatedAt: new Date().toISOString()
  };

  const envExtraServers = (process.env.VITE_API_SERVERS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const initialNodes: ServerNodeConfig[] = [
    {
      id: 'origin-primary',
      label: 'Primary Express Origin (Node.js)',
      url: '',
      region: process.env.SERVER_REGION || 'asia-southeast1',
      role: 'primary',
      enabled: true,
      priority: 1
    },
    ...envExtraServers.map((url, idx) => ({
      id: `replica-${idx + 1}`,
      label: url.includes('workers.dev') ? `Cloudflare Edge Proxy #${idx + 1}` : `Replica Server #${idx + 1}`,
      url,
      region: 'global-edge',
      role: (url.includes('workers.dev') ? 'edge-worker' : 'secondary') as 'edge-worker' | 'secondary',
      enabled: true,
      priority: idx + 2
    }))
  ];

  const DEFAULT_DAILY_QUOTAS: ServerDailyQuotas = {
    serverDailyQuota: 100000,
    quoteDailyQuota: 50000,
    verifyStockDailyQuota: 50000,
    uploadDailyQuota: 10000,
    bootstrapDailyQuota: 100000,
    firestoreReadsDailyQuota: 50000,
    upstashDailyQuota: 10000,
    authDailyQuota: 50000
  };

  const DEFAULT_SERVER_CONTROL: ServerControlConfig = {
    serverNodes: initialNodes,
    catalogTtlSeconds: 120,
    slotsTtlSeconds: 60,
    quoteTtlSeconds: 30,
    rateLimits: {
      uploadPerMin: 25,
      verifyStockPerMin: 60,
      quotePerMin: 90,
      archivePerMin: 120,
      invalidatePerMin: 30
    },
    dailyQuotas: DEFAULT_DAILY_QUOTAS,
    autoServerFailover: true,
    updatedAt: new Date().toISOString()
  };

  const readControlJson = <T>(key: string, fallback: T): T => {
    try {
      const row = sqlite
        .prepare('SELECT value FROM cloud_control_config WHERE key = ?')
        .get(key) as { value?: string } | undefined;
      if (row?.value) {
        return { ...fallback, ...(JSON.parse(row.value) as Partial<T>) };
      }
    } catch {
      // ignore parse errors
    }
    return fallback;
  };

  const writeControlJson = <T>(key: string, value: T): T => {
    sqlite
      .prepare(
        `INSERT INTO cloud_control_config (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), Date.now());
    return value;
  };

  let dbControlConfig: DbControlConfig = readControlJson('db_control', DEFAULT_DB_CONTROL);
  const rawServerCfg = readControlJson('server_control', DEFAULT_SERVER_CONTROL);
  let serverControlConfig: ServerControlConfig = {
    ...DEFAULT_SERVER_CONTROL,
    ...rawServerCfg,
    rateLimits: {
      ...DEFAULT_SERVER_CONTROL.rateLimits,
      ...(rawServerCfg.rateLimits || {})
    },
    dailyQuotas: {
      ...DEFAULT_DAILY_QUOTAS,
      ...(rawServerCfg.dailyQuotas || {})
    }
  };

  const getDbControlConfig = (): DbControlConfig => dbControlConfig;
  const updateDbControlConfig = (patch: Partial<DbControlConfig>): DbControlConfig => {
    const allowedPrimary = ['auto', 'firestore', 'sqlite', 'upstash'];
    const allowedStorage = ['auto', 'r2', 'local'];
    dbControlConfig = writeControlJson('db_control', {
      primaryReadDb: allowedPrimary.includes(String(patch.primaryReadDb))
        ? (patch.primaryReadDb as DbControlConfig['primaryReadDb'])
        : dbControlConfig.primaryReadDb,
      autoFailoverEnabled:
        typeof patch.autoFailoverEnabled === 'boolean'
          ? patch.autoFailoverEnabled
          : dbControlConfig.autoFailoverEnabled,
      archivalSyncEnabled:
        typeof patch.archivalSyncEnabled === 'boolean'
          ? patch.archivalSyncEnabled
          : dbControlConfig.archivalSyncEnabled,
      l1CacheEnabled:
        typeof patch.l1CacheEnabled === 'boolean'
          ? patch.l1CacheEnabled
          : dbControlConfig.l1CacheEnabled,
      l2CacheEnabled:
        typeof patch.l2CacheEnabled === 'boolean'
          ? patch.l2CacheEnabled
          : dbControlConfig.l2CacheEnabled,
      storageTarget: allowedStorage.includes(String(patch.storageTarget))
        ? (patch.storageTarget as DbControlConfig['storageTarget'])
        : dbControlConfig.storageTarget,
      firestoreTimeoutMs:
        typeof patch.firestoreTimeoutMs === 'number'
          ? Math.max(1000, Math.min(15000, Math.round(patch.firestoreTimeoutMs)))
          : dbControlConfig.firestoreTimeoutMs,
      lastFailoverEvent:
        patch.lastFailoverEvent !== undefined
          ? patch.lastFailoverEvent
          : dbControlConfig.lastFailoverEvent,
      updatedAt: new Date().toISOString()
    });
    return dbControlConfig;
  };

  const recordFailoverEvent = (from: string, to: string, reason: string) => {
    dbControlConfig = writeControlJson('db_control', {
      ...dbControlConfig,
      lastFailoverEvent: {
        from,
        to,
        reason,
        at: new Date().toISOString()
      }
    });
  };

  const getServerControlConfig = (): ServerControlConfig => serverControlConfig;
  const updateServerControlConfig = (patch: Partial<ServerControlConfig>): ServerControlConfig => {
    let nextNodes = serverControlConfig.serverNodes;
    if (Array.isArray(patch.serverNodes)) {
      const cleaned = patch.serverNodes
        .slice(0, 12)
        .map((node, index): ServerNodeConfig | null => {
          const id = String(node.id || `node_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
          const label = String(node.label || 'Server Node').trim().slice(0, 80);
          const rawUrl = String(node.url || '').trim().replace(/\/+$/, '');
          if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
            return null;
          }
          const role =
            node.role === 'primary' || node.role === 'secondary' || node.role === 'edge-worker'
              ? node.role
              : 'secondary';
          return {
            id: id || `node_${index + 1}`,
            label: label || `Node ${index + 1}`,
            url: rawUrl,
            region: String(node.region || 'auto').trim().slice(0, 40),
            role,
            enabled: Boolean(node.enabled),
            priority: Math.max(1, Math.min(99, Number(node.priority) || index + 1))
          };
        })
        .filter((n): n is ServerNodeConfig => Boolean(n));
      if (cleaned.length > 0) {
        cleaned.sort((a, b) => a.priority - b.priority);
        nextNodes = cleaned;
      }
    }

    const nextLimits = {
      uploadPerMin: Math.max(5, Math.min(1000, Number(patch.rateLimits?.uploadPerMin ?? serverControlConfig.rateLimits.uploadPerMin))),
      verifyStockPerMin: Math.max(10, Math.min(5000, Number(patch.rateLimits?.verifyStockPerMin ?? serverControlConfig.rateLimits.verifyStockPerMin))),
      quotePerMin: Math.max(10, Math.min(5000, Number(patch.rateLimits?.quotePerMin ?? serverControlConfig.rateLimits.quotePerMin))),
      archivePerMin: Math.max(10, Math.min(5000, Number(patch.rateLimits?.archivePerMin ?? serverControlConfig.rateLimits.archivePerMin))),
      invalidatePerMin: Math.max(5, Math.min(1000, Number(patch.rateLimits?.invalidatePerMin ?? serverControlConfig.rateLimits.invalidatePerMin)))
    };

    const nextDailyQuotas: ServerDailyQuotas = {
      serverDailyQuota: Math.max(1000, Math.min(50000000, Number(patch.dailyQuotas?.serverDailyQuota ?? serverControlConfig.dailyQuotas.serverDailyQuota))),
      quoteDailyQuota: Math.max(500, Math.min(10000000, Number(patch.dailyQuotas?.quoteDailyQuota ?? serverControlConfig.dailyQuotas.quoteDailyQuota))),
      verifyStockDailyQuota: Math.max(500, Math.min(10000000, Number(patch.dailyQuotas?.verifyStockDailyQuota ?? serverControlConfig.dailyQuotas.verifyStockDailyQuota))),
      uploadDailyQuota: Math.max(100, Math.min(5000000, Number(patch.dailyQuotas?.uploadDailyQuota ?? serverControlConfig.dailyQuotas.uploadDailyQuota))),
      bootstrapDailyQuota: Math.max(1000, Math.min(50000000, Number(patch.dailyQuotas?.bootstrapDailyQuota ?? serverControlConfig.dailyQuotas.bootstrapDailyQuota))),
      firestoreReadsDailyQuota: Math.max(1000, Math.min(10000000, Number(patch.dailyQuotas?.firestoreReadsDailyQuota ?? serverControlConfig.dailyQuotas.firestoreReadsDailyQuota))),
      upstashDailyQuota: Math.max(1000, Math.min(10000000, Number(patch.dailyQuotas?.upstashDailyQuota ?? serverControlConfig.dailyQuotas.upstashDailyQuota))),
      authDailyQuota: Math.max(1000, Math.min(10000000, Number(patch.dailyQuotas?.authDailyQuota ?? serverControlConfig.dailyQuotas.authDailyQuota)))
    };

    serverControlConfig = writeControlJson('server_control', {
      serverNodes: nextNodes,
      catalogTtlSeconds: Math.max(5, Math.min(3600, Number(patch.catalogTtlSeconds ?? serverControlConfig.catalogTtlSeconds))),
      slotsTtlSeconds: Math.max(5, Math.min(3600, Number(patch.slotsTtlSeconds ?? serverControlConfig.slotsTtlSeconds))),
      quoteTtlSeconds: Math.max(5, Math.min(3600, Number(patch.quoteTtlSeconds ?? serverControlConfig.quoteTtlSeconds))),
      rateLimits: nextLimits,
      dailyQuotas: nextDailyQuotas,
      autoServerFailover:
        typeof patch.autoServerFailover === 'boolean'
          ? patch.autoServerFailover
          : serverControlConfig.autoServerFailover,
      updatedAt: new Date().toISOString()
    });
    return serverControlConfig;
  };

  // L1 Memory LRU + TTL Cache & API Quota Telemetry
  const l1Cache = new Map<string, CacheEntry<unknown>>();
  const rateBuckets = new Map<string, RateBucket>();
  const minuteUsageMap = new Map<string, { slot: number; count: number; throttled: number }>();
  const cacheStats = { l1Hits: 0, l2Hits: 0, misses: 0 };

  const upsertApiQuotaStmt = sqlite.prepare(`
    INSERT INTO api_quota_usage
      (endpoint_id, day_key, calls_total, rate_limited, cache_hits, error_count, latency_sum_ms, last_called_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint_id, day_key) DO UPDATE SET
      calls_total = calls_total + 1,
      rate_limited = rate_limited + excluded.rate_limited,
      cache_hits = cache_hits + excluded.cache_hits,
      error_count = error_count + excluded.error_count,
      latency_sum_ms = latency_sum_ms + excluded.latency_sum_ms,
      last_called_at = excluded.last_called_at
  `);

  const recordApiUsage = (
    endpointId: string,
    meta: { latencyMs?: number; statusCode?: number; cacheHit?: boolean; rateLimited?: boolean } = {}
  ): void => {
    try {
      const cleanId = endpointId.slice(0, 64);
      const dayKey = new Date().toISOString().split('T')[0];
      const nowIso = new Date().toISOString();
      const slot = Math.floor(Date.now() / 60000);
      const existingMin = minuteUsageMap.get(cleanId);
      if (!existingMin || existingMin.slot !== slot) {
        minuteUsageMap.set(cleanId, {
          slot,
          count: 1,
          throttled: meta.rateLimited ? 1 : 0
        });
      } else {
        existingMin.count += 1;
        if (meta.rateLimited) existingMin.throttled += 1;
      }

      const latency = Math.max(0, Math.round(Number(meta.latencyMs) || 0));
      const isLimited = meta.rateLimited || meta.statusCode === 429 ? 1 : 0;
      const isCacheHit = meta.cacheHit ? 1 : 0;
      const isErr = typeof meta.statusCode === 'number' && meta.statusCode >= 500 ? 1 : 0;
      upsertApiQuotaStmt.run(cleanId, dayKey, isLimited, isCacheHit, isErr, latency, nowIso);
    } catch {
      // Non-blocking telemetry
    }
  };

  const resetApiQuotaUsage = (): { ok: boolean; dayKey: string } => {
    const dayKey = new Date().toISOString().split('T')[0];
    sqlite.prepare('DELETE FROM api_quota_usage WHERE day_key = ?').run(dayKey);
    minuteUsageMap.clear();
    cacheStats.l1Hits = 0;
    cacheStats.l2Hits = 0;
    cacheStats.misses = 0;
    return { ok: true, dayKey };
  };

  const getL1 = <T>(key: string): T | null => {
    const entry = l1Cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      l1Cache.delete(key);
      return null;
    }
    return entry.value as T;
  };

  const setL1 = <T>(key: string, value: T, ttlMs: number): void => {
    if (l1Cache.size >= 500) {
      const oldest = l1Cache.keys().next().value;
      if (oldest) l1Cache.delete(oldest);
    }
    l1Cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  };

  const upstashCommand = async (args: Array<string | number>): Promise<unknown> => {
    if (!hasUpstash) return null;
    try {
      const res = await fetch(upstashUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(1500)
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { result?: unknown };
      return json.result ?? null;
    } catch {
      return null;
    }
  };

  const getCached = async <T>(key: string): Promise<{ value: T; tier: 'l1' | 'l2' } | null> => {
    if (dbControlConfig.l1CacheEnabled) {
      const l1 = getL1<T>(key);
      if (l1 !== null) {
        cacheStats.l1Hits += 1;
        return { value: l1, tier: 'l1' };
      }
    }

    if (hasUpstash && dbControlConfig.l2CacheEnabled) {
      const raw = await upstashCommand(['GET', key]);
      if (typeof raw === 'string' && raw) {
        try {
          const parsed = JSON.parse(raw) as T;
          if (dbControlConfig.l1CacheEnabled) {
            setL1(key, parsed, 30_000);
          }
          cacheStats.l2Hits += 1;
          return { value: parsed, tier: 'l2' };
        } catch {
          // ignore corrupt L2 entry
        }
      }
    }

    cacheStats.misses += 1;
    return null;
  };

  const setCached = async <T>(key: string, value: T, ttlMs: number): Promise<void> => {
    if (dbControlConfig.l1CacheEnabled) {
      setL1(key, value, ttlMs);
    }
    if (hasUpstash && dbControlConfig.l2CacheEnabled) {
      const ttlSec = Math.max(5, Math.round(ttlMs / 1000));
      void upstashCommand(['SET', key, JSON.stringify(value), 'EX', ttlSec]);
    }
  };

  const invalidateKey = async (key: string): Promise<void> => {
    l1Cache.delete(key);
    if (hasUpstash) {
      await upstashCommand(['DEL', key]);
    }
  };

  const checkRateLimit = async (
    bucket: string,
    ip: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> => {
    const windowSlot = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rl:${bucket}:${ip}:${windowSlot}`;

    if (hasUpstash && dbControlConfig.l2CacheEnabled) {
      try {
        const res = await fetch(`${upstashUrl}/pipeline`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${upstashToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([
            ['INCR', key],
            ['EXPIRE', key, windowSeconds]
          ]),
          signal: AbortSignal.timeout(1200)
        });
        if (res.ok) {
          const data = (await res.json()) as Array<{ result?: number }>;
          const count = Number(data[0]?.result || 1);
          return {
            allowed: count <= maxRequests,
            remaining: Math.max(0, maxRequests - count),
            resetSeconds: windowSeconds
          };
        }
      } catch {
        // Fallback to L1 sliding counter
      }
    }

    const now = Date.now();
    if (rateBuckets.size > 2000) {
      rateBuckets.clear();
    }
    const existing = rateBuckets.get(key);
    if (!existing || now > existing.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: maxRequests - 1, resetSeconds: windowSeconds };
    }
    existing.count += 1;
    return {
      allowed: existing.count <= maxRequests,
      remaining: Math.max(0, maxRequests - existing.count),
      resetSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  };

  const verifyFirebaseAdminToken = async (
    idToken: string
  ): Promise<{ authorized: boolean; uid?: string; email?: string; reason?: string }> => {
    if (!idToken || !firebaseMeta.apiKey) {
      return { authorized: false, reason: 'Missing authentication token or Firebase API key.' };
    }

    const cacheKey = `admin_verify:${sha256Hex(idToken).slice(0, 24)}`;
    const cached = getL1<{ authorized: boolean; uid?: string; email?: string; reason?: string }>(cacheKey);
    if (cached && cached.authorized) {
      return cached;
    }

    try {
      const authStart = performance.now();
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseMeta.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
          signal: AbortSignal.timeout(3500)
        }
      );
      recordApiUsage('cloud-firebase-auth', {
        latencyMs: performance.now() - authStart,
        statusCode: lookupRes.status
      });

      if (!lookupRes.ok) {
        return { authorized: false, reason: 'Invalid or expired Firebase session token.' };
      }

      const lookupData = (await lookupRes.json()) as {
        users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
      };
      const account = lookupData.users?.[0];
      const uid = account?.localId || '';
      const email = account?.email || '';
      const emailVerified = Boolean(account?.emailVerified);

      if (!uid) {
        return { authorized: false, reason: 'Firebase user account not found.' };
      }

      if (emailVerified && email === BOOTSTRAPPED_ADMIN_EMAIL) {
        const result = { authorized: true, uid, email };
        setL1(cacheKey, result, 60_000);
        return result;
      }

      // Check Firestore /admins/{uid} using the user's own Bearer token
      const projectId = firebaseMeta.projectId;
      const databaseId = firebaseMeta.firestoreDatabaseId || '(default)';
      if (projectId) {
        const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          projectId
        )}/databases/${encodeURIComponent(databaseId)}/documents/admins/${encodeURIComponent(uid)}?key=${encodeURIComponent(firebaseMeta.apiKey)}`;
        const fsStart = performance.now();
        const adminDocRes = await fetch(docUrl, {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: AbortSignal.timeout(3000)
        });
        recordApiUsage('cloud-firestore-rest', {
          latencyMs: performance.now() - fsStart,
          statusCode: adminDocRes.status
        });
        if (adminDocRes.ok) {
          const adminDoc = (await adminDocRes.json()) as { fields?: Record<string, unknown> };
          const decoded = decodeFirestoreDoc(adminDoc);
          if (decoded.role === 'admin') {
            const result = { authorized: true, uid, email };
            setL1(cacheKey, result, 60_000);
            return result;
          }
        }
      }

      return { authorized: false, reason: 'Super Admin or delegated Admin access required.' };
    } catch {
      return { authorized: false, reason: 'Unable to verify Firebase Auth token.' };
    }
  };

  // Read-Through Public Storefront Catalog from Cloud Firestore v1 REST API
  const fetchPublicCatalogFromFirestore = async (): Promise<CatalogBootstrapPayload | null> => {
    const projectId = firebaseMeta.projectId;
    const databaseId = firebaseMeta.firestoreDatabaseId || '(default)';
    if (!projectId) return null;

    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents`;
    const apiKeyParam = firebaseMeta.apiKey ? `?key=${encodeURIComponent(firebaseMeta.apiKey)}` : '';
    const timeoutMs = dbControlConfig.firestoreTimeoutMs || 3500;

    const fsQueryStart = performance.now();
    try {
      const [prodRes, couponRes, areaRes, settingsRes] = await Promise.all([
        fetch(`${base}:runQuery${apiKeyParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'products' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'pricePerKg' },
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { integerValue: '0' }
                }
              },
              limit: 200
            }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        }),
        fetch(`${base}:runQuery${apiKeyParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'coupons' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'isActive' },
                  op: 'EQUAL',
                  value: { booleanValue: true }
                }
              },
              limit: 50
            }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        }),
        fetch(`${base}:runQuery${apiKeyParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'serviceAreas' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'isActive' },
                  op: 'EQUAL',
                  value: { booleanValue: true }
                }
              },
              limit: 200
            }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        }),
        fetch(`${base}/settings/store${apiKeyParam}`, {
          signal: AbortSignal.timeout(timeoutMs)
        })
      ]);

      recordApiUsage('cloud-firestore-rest', {
        latencyMs: performance.now() - fsQueryStart,
        statusCode: prodRes.status
      });

      if (!prodRes.ok) return null;
      const prodRows = (await prodRes.json()) as Array<{
        document?: { name?: string; fields?: Record<string, unknown> };
      }>;
      const products = prodRows
        .filter((r) => Boolean(r.document))
        .map((r) => {
          const decoded = decodeFirestoreDoc(r.document!);
          return {
            ...decoded,
            id: String(decoded.id || decoded.__docId || '')
          };
        });

      let coupons: Array<Record<string, unknown>> = [];
      if (couponRes.ok) {
        const couponRows = (await couponRes.json()) as Array<{
          document?: { name?: string; fields?: Record<string, unknown> };
        }>;
        coupons = couponRows
          .filter((r) => Boolean(r.document))
          .map((r) => {
            const decoded = decodeFirestoreDoc(r.document!);
            return {
              ...decoded,
              code: String(decoded.code || decoded.__docId || '')
            };
          });
      }

      let serviceAreas: Array<Record<string, unknown>> = [];
      if (areaRes.ok) {
        const areaRows = (await areaRes.json()) as Array<{
          document?: { name?: string; fields?: Record<string, unknown> };
        }>;
        serviceAreas = areaRows
          .filter((r) => Boolean(r.document))
          .map((r) => {
            const decoded = decodeFirestoreDoc(r.document!);
            return {
              ...decoded,
              id: String(decoded.id || decoded.__docId || '')
            };
          });
      }

      let settings: Record<string, unknown> | null = null;
      if (settingsRes.ok) {
        const settingsDoc = (await settingsRes.json()) as {
          name?: string;
          fields?: Record<string, unknown>;
        };
        if (settingsDoc.fields) {
          settings = decodeFirestoreDoc(settingsDoc);
        }
      }

      const payload: CatalogBootstrapPayload = {
        products,
        coupons,
        serviceAreas,
        settings,
        source: 'firestore-rest',
        generatedAt: new Date().toISOString()
      };

      // Persist latest clean snapshot inside SQLite WAL edge replica
      try {
        sqlite
          .prepare(
            `INSERT INTO catalog_snapshot (id, payload, updated_at)
             VALUES ('storefront', ?, ?)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
          )
          .run(JSON.stringify(payload), Date.now());
      } catch {
        // non-fatal
      }

      return payload;
    } catch {
      return null;
    }
  };

  const readSqliteSnapshot = (): CatalogBootstrapPayload | null => {
    try {
      const row = sqlite
        .prepare('SELECT payload FROM catalog_snapshot WHERE id = ?')
        .get('storefront') as { payload?: string } | undefined;
      if (row?.payload) {
        const parsed = JSON.parse(row.payload) as Partial<CatalogBootstrapPayload>;
        return {
          products: Array.isArray(parsed.products) ? parsed.products : [],
          coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
          serviceAreas: Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
          settings: parsed.settings ?? null,
          source: 'sqlite-replica',
          generatedAt: parsed.generatedAt || new Date().toISOString()
        };
      }
    } catch {
      // ignore
    }
    return null;
  };

  const getCatalogBootstrap = async (): Promise<CatalogBootstrapPayload> => {
    const cacheKey = 'catalog:bootstrap:v1';
    const ttlMs = (serverControlConfig.catalogTtlSeconds || 120) * 1000;
    const mode = dbControlConfig.primaryReadDb;

    // Explicit SQLite-Primary Mode (with optional auto-failover to Firestore)
    if (mode === 'sqlite') {
      const snap = readSqliteSnapshot();
      if (snap) return snap;
      if (dbControlConfig.autoFailoverEnabled) {
        const fresh = await fetchPublicCatalogFromFirestore();
        if (fresh) {
          recordFailoverEvent('sqlite-replica', 'firestore-rest', 'SQLite snapshot empty');
          await setCached(cacheKey, fresh, ttlMs);
          return fresh;
        }
      }
      return {
        products: [],
        coupons: [],
        serviceAreas: [],
        settings: null,
        source: 'sqlite-replica',
        generatedAt: new Date().toISOString()
      };
    }

    // Explicit Direct Firestore Mode (bypasses L1/L2 cache reads; refreshes SQLite WAL & fails over if Firestore fails)
    if (mode === 'firestore') {
      const fresh = await fetchPublicCatalogFromFirestore();
      if (fresh) {
        await setCached(cacheKey, fresh, ttlMs);
        return fresh;
      }
      if (dbControlConfig.autoFailoverEnabled) {
        const snap = readSqliteSnapshot();
        if (snap) {
          recordFailoverEvent('firestore-rest', 'sqlite-replica', 'Firestore REST unreachable or timed out');
          return snap;
        }
      }
      return {
        products: [],
        coupons: [],
        serviceAreas: [],
        settings: null,
        source: 'sqlite-replica',
        generatedAt: new Date().toISOString()
      };
    }

    // Upstash-First or Auto Multi-Cloud Mode
    if (mode === 'upstash' && hasUpstash && dbControlConfig.l2CacheEnabled) {
      const raw = await upstashCommand(['GET', cacheKey]);
      if (typeof raw === 'string' && raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<CatalogBootstrapPayload>;
          cacheStats.l2Hits += 1;
          return {
            products: Array.isArray(parsed.products) ? parsed.products : [],
            coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
            serviceAreas: Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
            settings: parsed.settings ?? null,
            source: 'upstash-l2',
            generatedAt: parsed.generatedAt || new Date().toISOString()
          };
        } catch {
          // fall through
        }
      }
      if (!dbControlConfig.autoFailoverEnabled) {
        return {
          products: [],
          coupons: [],
          serviceAreas: [],
          settings: null,
          source: 'upstash-l2',
          generatedAt: new Date().toISOString()
        };
      }
    }

    const cached = await getCached<CatalogBootstrapPayload>(cacheKey);
    if (cached) {
      return {
        ...cached.value,
        serviceAreas: Array.isArray(cached.value.serviceAreas) ? cached.value.serviceAreas : [],
        source: cached.tier === 'l2' ? 'upstash-l2' : 'memory-l1'
      };
    }

    const fresh = await fetchPublicCatalogFromFirestore();
    if (fresh) {
      await setCached(cacheKey, fresh, ttlMs);
      return fresh;
    }

    if (dbControlConfig.autoFailoverEnabled) {
      const snap = readSqliteSnapshot();
      if (snap) {
        recordFailoverEvent('firestore-rest', 'sqlite-replica', 'Automatic failover on Firestore timeout');
        return snap;
      }
    }

    return {
      products: [],
      coupons: [],
      serviceAreas: [],
      settings: null,
      source: 'sqlite-replica',
      generatedAt: new Date().toISOString()
    };
  };

  const invalidateCatalogCache = async (): Promise<void> => {
    await invalidateKey('catalog:bootstrap:v1');
  };

  const archiveOrder = async (order: ArchiveOrderPayload): Promise<void> => {
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO order_archive
          (id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          city = excluded.city,
          order_date = excluded.order_date,
          status = excluded.status,
          payment_status = excluded.payment_status,
          assigned_to_uid = excluded.assigned_to_uid,
          updated_at = excluded.updated_at`
      )
      .run(
        order.id,
        order.userId,
        order.city,
        Math.round(order.total),
        order.status,
        order.paymentMethod,
        order.paymentStatus,
        order.assignedToUid,
        Math.max(0, Math.round(order.itemCount)),
        order.date,
        now
      );

    if (hasSupabase && dbControlConfig.archivalSyncEnabled) {
      void fetch(`${supabaseUrl}/rest/v1/order_archive`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          id: order.id,
          user_id: order.userId,
          city: order.city,
          total: Math.round(order.total),
          status: order.status,
          payment_method: order.paymentMethod,
          payment_status: order.paymentStatus,
          assigned_to_uid: order.assignedToUid,
          item_count: Math.max(0, Math.round(order.itemCount)),
          order_date: order.date,
          updated_at: now
        }),
        signal: AbortSignal.timeout(2500)
      }).catch(() => undefined);
    }
  };

  const archiveLedgerEntry = async (entry: ArchiveLedgerPayload): Promise<void> => {
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO wallet_ledger_archive (id, partner_uid, order_id, type, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.partnerUid, entry.orderId, entry.type, Math.round(entry.amount), now);

    if (hasSupabase && dbControlConfig.archivalSyncEnabled) {
      void fetch(`${supabaseUrl}/rest/v1/wallet_ledger_archive`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates'
        },
        body: JSON.stringify({
          id: entry.id,
          partner_uid: entry.partnerUid,
          order_id: entry.orderId,
          type: entry.type,
          amount: Math.round(entry.amount),
          created_at: now
        }),
        signal: AbortSignal.timeout(2500)
      }).catch(() => undefined);
    }
  };

  const getSqlAnalyticsSummary = (): SqlAnalyticsSummary => {
    const totals = sqlite
      .prepare(
        `SELECT
           COUNT(*) AS totalOrders,
           SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS deliveredOrders,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledOrders,
           SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS grossRevenue,
           SUM(CASE WHEN status != 'cancelled' AND payment_method = 'cod' THEN total ELSE 0 END) AS codRevenue,
           SUM(CASE WHEN status != 'cancelled' AND payment_method = 'upi' THEN total ELSE 0 END) AS upiRevenue
         FROM order_archive`
      )
      .get() as {
      totalOrders?: number;
      deliveredOrders?: number;
      cancelledOrders?: number;
      grossRevenue?: number;
      codRevenue?: number;
      upiRevenue?: number;
    };

    const ledgerSum = sqlite
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type = 'trip_credit' THEN amount ELSE 0 END), 0) AS totalPayouts
         FROM wallet_ledger_archive`
      )
      .get() as { totalPayouts?: number };

    const topCities = sqlite
      .prepare(
        `SELECT
           CASE WHEN TRIM(city) = '' THEN 'Unspecified' ELSE city END AS city,
           COUNT(*) AS orderCount,
           SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS revenue
         FROM order_archive
         GROUP BY CASE WHEN TRIM(city) = '' THEN 'Unspecified' ELSE city END
         ORDER BY orderCount DESC
         LIMIT 5`
      )
      .all() as Array<{ city: string; orderCount: number; revenue: number }>;

    return {
      archivedOrders: Number(totals?.totalOrders || 0),
      deliveredOrders: Number(totals?.deliveredOrders || 0),
      cancelledOrders: Number(totals?.cancelledOrders || 0),
      grossRevenue: Number(totals?.grossRevenue || 0),
      codRevenue: Number(totals?.codRevenue || 0),
      upiRevenue: Number(totals?.upiRevenue || 0),
      totalRiderPayouts: Number(ledgerSum?.totalPayouts || 0),
      topCities,
      databaseEngine: hasSupabase && dbControlConfig.archivalSyncEnabled
        ? 'SQLite WAL + Supabase PostgreSQL'
        : 'SQLite WAL Edge Replica',
      supabaseSynced: hasSupabase && dbControlConfig.archivalSyncEnabled
    };
  };

  const signR2Request = (method: string, targetUrl: string, payloadHash: string) => {
    const parsed = new URL(targetUrl);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const region = 'auto';
    const service = 's3';

    const canonicalHeaders =
      `host:${parsed.host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      parsed.pathname,
      parsed.search ? parsed.search.slice(1) : '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');

    const kDate = hmacSha256(`AWS4${r2SecretKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, service);
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return {
      amzDate,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${r2AccessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
  };

  // Upload media to Cloudflare R2 (SigV4 S3 PUT) if configured & selected, else persistent local /uploads store
  const uploadMediaObject = async (
    buffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<{ url: string; storageBackend: string }> => {
    const wantR2 =
      dbControlConfig.storageTarget === 'r2' ||
      (dbControlConfig.storageTarget === 'auto' && hasR2);

    if (wantR2 && hasR2) {
      try {
        const target = `${r2Endpoint}/${r2Bucket}/${fileName}`;
        const payloadHash = sha256Hex(buffer);
        const signed = signR2Request('PUT', target, payloadHash);

        const putRes = await fetch(target, {
          method: 'PUT',
          headers: {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': signed.amzDate,
            Authorization: signed.authorization
          },
          body: new Uint8Array(buffer),
          signal: AbortSignal.timeout(5000)
        });

        if (putRes.ok) {
          return {
            url: `${r2PublicUrl}/${fileName}`,
            storageBackend: 'Cloudflare R2 (Zero-Egress CDN)'
          };
        }
      } catch (err) {
        if (!dbControlConfig.autoFailoverEnabled && dbControlConfig.storageTarget === 'r2') {
          throw err;
        }
        recordFailoverEvent('cloudflare-r2', 'express-local-uploads', 'R2 upload failed; saved to local store');
      }
    } else if (dbControlConfig.storageTarget === 'r2' && !hasR2 && !dbControlConfig.autoFailoverEnabled) {
      throw new Error('Cloudflare R2 credentials not configured and auto-failover is disabled.');
    }

    const targetPath = path.join(uploadsDir, fileName);
    await fs.promises.writeFile(targetPath, buffer);
    return {
      url: `/uploads/${fileName}`,
      storageBackend: 'Express Static Media Store'
    };
  };

  // Real measured storage & quota balances across all databases & cloud storage providers
  const getDatabasesReport = async () => {
    const entries: DatabaseStorageEntry[] = [];

    // 1. Google Cloud Firestore Enterprise
    const fsStart = performance.now();
    let fsStatus: 'connected' | 'degraded' | 'standby' = firebaseMeta.projectId ? 'degraded' : 'standby';
    let fsLatency: number | null = null;
    let fsSnapshotBytes = 0;
    let fsPublicDocCount = 0;

    if (firebaseMeta.projectId) {
      const liveCatalog = await fetchPublicCatalogFromFirestore();
      fsLatency = Math.round(performance.now() - fsStart);
      if (liveCatalog) {
        fsStatus = 'connected';
        fsPublicDocCount =
          liveCatalog.products.length +
          liveCatalog.coupons.length +
          liveCatalog.serviceAreas.length +
          (liveCatalog.settings ? 1 : 0);
        fsSnapshotBytes = Buffer.byteLength(JSON.stringify(liveCatalog), 'utf8');
      } else {
        const cachedSnap = readSqliteSnapshot();
        if (cachedSnap) {
          fsSnapshotBytes = Buffer.byteLength(JSON.stringify(cachedSnap), 'utf8');
          fsPublicDocCount =
            cachedSnap.products.length +
            cachedSnap.coupons.length +
            cachedSnap.serviceAreas.length;
        }
      }
    }

    entries.push({
      id: 'firestore',
      name: 'Google Cloud Firestore (Enterprise)',
      role: 'Primary Real-Time Operational DB & Ephemeral Rider GPS',
      provider: 'Google Cloud / Firebase Spark Tier',
      status: fsStatus,
      latencyMs: fsLatency,
      usedBytes: fsSnapshotBytes,
      freeTierLimitBytes: FIRESTORE_SPARK_BYTES,
      balanceBytes: Math.max(0, FIRESTORE_SPARK_BYTES - fsSnapshotBytes),
      recordCount: fsPublicDocCount,
      usageLabel: `${formatBytesHuman(fsSnapshotBytes)} (public snapshot payload)`,
      balanceLabel: `${formatBytesHuman(Math.max(0, FIRESTORE_SPARK_BYTES - fsSnapshotBytes))} of 1.00 GB Spark Quota`,
      details: {
        projectId: firebaseMeta.projectId || 'Not configured',
        databaseId: firebaseMeta.firestoreDatabaseId || '(default)',
        dailyFreeReads: '50,000 / day',
        dailyFreeWrites: '20,000 / day',
        publicCatalogDocs: fsPublicDocCount
      }
    });

    // 2. SQLite WAL Edge Replica (measured from OS filesystem + SQLite pragmas)
    const sqliteStart = performance.now();
    const statSize = (p: string) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
    const dbFileBytes = statSize(sqlitePath);
    const walFileBytes = statSize(`${sqlitePath}-wal`);
    const shmFileBytes = statSize(`${sqlitePath}-shm`);
    const totalSqliteBytes = dbFileBytes + walFileBytes + shmFileBytes;

    const catalogRows = Number(
      (sqlite.prepare('SELECT COUNT(*) AS c FROM catalog_snapshot').get() as { c?: number })?.c || 0
    );
    const orderRows = Number(
      (sqlite.prepare('SELECT COUNT(*) AS c FROM order_archive').get() as { c?: number })?.c || 0
    );
    const ledgerRows = Number(
      (sqlite.prepare('SELECT COUNT(*) AS c FROM wallet_ledger_archive').get() as { c?: number })?.c || 0
    );
    const cfgRows = Number(
      (sqlite.prepare('SELECT COUNT(*) AS c FROM cloud_control_config').get() as { c?: number })?.c || 0
    );
    const totalSqliteRows = catalogRows + orderRows + ledgerRows + cfgRows;
    const sqliteLatency = Math.max(1, Math.round(performance.now() - sqliteStart));

    let diskAvailBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    try {
      const statFs = fs.statfsSync(dataDir);
      diskAvailBytes = Number(statFs.bavail) * Number(statFs.bsize);
      diskTotalBytes = Number(statFs.blocks) * Number(statFs.bsize);
    } catch {
      diskAvailBytes = null;
    }

    entries.push({
      id: 'sqlite',
      name: 'SQLite WAL Edge Replica',
      role: 'Zero-Latency Local Snapshot Failover, Analytics & Control Config',
      provider: 'Embedded better-sqlite3 (WAL Mode)',
      status: 'connected',
      latencyMs: sqliteLatency,
      usedBytes: totalSqliteBytes,
      freeTierLimitBytes: diskTotalBytes,
      balanceBytes: diskAvailBytes,
      recordCount: totalSqliteRows,
      usageLabel: `${formatBytesHuman(totalSqliteBytes)} (${totalSqliteRows} rows)`,
      balanceLabel: diskAvailBytes !== null ? `${formatBytesHuman(diskAvailBytes)} OS Disk Free` : 'Local Volume Active',
      details: {
        dbFileBytes,
        walFileBytes,
        shmFileBytes,
        catalogSnapshots: catalogRows,
        archivedOrders: orderRows,
        walletLedgerRows: ledgerRows,
        configKeys: cfgRows
      }
    });

    // 3. Supabase PostgreSQL
    let supaStatus: 'connected' | 'degraded' | 'standby' = hasSupabase ? 'degraded' : 'standby';
    let supaLatency: number | null = null;
    let supaRows: number | null = null;
    if (hasSupabase) {
      const sStart = performance.now();
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/order_archive?select=id&limit=1`, {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: 'count=exact'
          },
          signal: AbortSignal.timeout(3000)
        });
        supaLatency = Math.round(performance.now() - sStart);
        if (res.ok) {
          supaStatus = 'connected';
          const range = res.headers.get('content-range');
          if (range && range.includes('/')) {
            const countVal = Number(range.split('/')[1]);
            if (Number.isFinite(countVal)) supaRows = countVal;
          }
        }
      } catch {
        supaLatency = Math.round(performance.now() - sStart);
        supaStatus = 'degraded';
      }
    }

    entries.push({
      id: 'supabase',
      name: 'Supabase PostgreSQL',
      role: 'Long-Term Relational Order & Payout Ledger Warehouse',
      provider: 'Supabase Free Tier (500 MB Postgres)',
      status: supaStatus,
      latencyMs: supaLatency,
      usedBytes: null,
      freeTierLimitBytes: SUPABASE_FREE_BYTES,
      balanceBytes: SUPABASE_FREE_BYTES,
      recordCount: supaRows,
      usageLabel: hasSupabase
        ? supaRows !== null
          ? `${supaRows} archived SQL rows (DB bytes metered in Supabase dashboard)`
          : 'Connected via PostgREST'
        : 'Standby (Set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY in .env)',
      balanceLabel: '500.00 MB Postgres Free Tier',
      details: {
        configured: hasSupabase,
        archivalSyncEnabled: dbControlConfig.archivalSyncEnabled,
        endpoint: hasSupabase ? supabaseUrl : 'Not configured'
      }
    });

    // 4. Upstash Redis L2 Cache
    let upStatus: 'connected' | 'degraded' | 'standby' = hasUpstash ? 'degraded' : 'standby';
    let upLatency: number | null = null;
    let upKeyCount: number | null = null;
    if (hasUpstash) {
      const uStart = performance.now();
      try {
        const dbSize = await upstashCommand(['DBSIZE']);
        upLatency = Math.round(performance.now() - uStart);
        if (dbSize !== null && Number.isFinite(Number(dbSize))) {
          upStatus = 'connected';
          upKeyCount = Number(dbSize);
        }
      } catch {
        upLatency = Math.round(performance.now() - uStart);
      }
    }

    entries.push({
      id: 'upstash',
      name: 'Upstash Redis L2 Cache',
      role: 'Distributed Catalog Cache & Edge Sliding Rate Limiter',
      provider: 'Upstash Serverless Redis Free Tier (256 MB)',
      status: upStatus,
      latencyMs: upLatency,
      usedBytes: null,
      freeTierLimitBytes: UPSTASH_FREE_BYTES,
      balanceBytes: UPSTASH_FREE_BYTES,
      recordCount: upKeyCount,
      usageLabel: hasUpstash
        ? upKeyCount !== null
          ? `${upKeyCount} active keys (L1 RAM: ${l1Cache.size} entries)`
          : 'Connected'
        : `Standby — L1 Memory Cache active (${l1Cache.size} entries)`,
      balanceLabel: '256.00 MB / 500K Monthly Commands Free Tier',
      details: {
        configured: hasUpstash,
        l1Entries: l1Cache.size,
        l1Hits: cacheStats.l1Hits,
        l2Hits: cacheStats.l2Hits,
        misses: cacheStats.misses
      }
    });

    // 5. Cloudflare R2 Object Storage
    let r2Status: 'connected' | 'degraded' | 'standby' = hasR2 ? 'degraded' : 'standby';
    let r2Latency: number | null = null;
    let r2ObjectCount: number | null = null;
    let r2UsedBytes: number | null = null;
    if (hasR2) {
      const rStart = performance.now();
      try {
        const listUrl = `${r2Endpoint}/${r2Bucket}?list-type=2&max-keys=100`;
        const payloadHash = sha256Hex('');
        const signed = signR2Request('GET', listUrl, payloadHash);
        const listRes = await fetch(listUrl, {
          headers: {
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': signed.amzDate,
            Authorization: signed.authorization
          },
          signal: AbortSignal.timeout(3500)
        });
        r2Latency = Math.round(performance.now() - rStart);
        if (listRes.ok) {
          r2Status = 'connected';
          const xml = await listRes.text();
          const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => Number(m[1]));
          r2ObjectCount = sizes.length;
          r2UsedBytes = sizes.reduce((sum, s) => sum + s, 0);
        }
      } catch {
        r2Latency = Math.round(performance.now() - rStart);
      }
    }

    entries.push({
      id: 'r2',
      name: 'Cloudflare R2 Object Storage',
      role: 'Zero-Egress Product Images & Rider Proof CDN',
      provider: 'Cloudflare R2 S3-Compatible (10 GB Free)',
      status: r2Status,
      latencyMs: r2Latency,
      usedBytes: r2UsedBytes,
      freeTierLimitBytes: R2_FREE_BYTES,
      balanceBytes: r2UsedBytes !== null ? Math.max(0, R2_FREE_BYTES - r2UsedBytes) : R2_FREE_BYTES,
      recordCount: r2ObjectCount,
      usageLabel: hasR2
        ? r2UsedBytes !== null
          ? `${formatBytesHuman(r2UsedBytes)} (${r2ObjectCount} objects)`
          : 'Configured'
        : 'Standby (Set R2_* env vars in .env)',
      balanceLabel: r2UsedBytes !== null
        ? `${formatBytesHuman(Math.max(0, R2_FREE_BYTES - r2UsedBytes))} of 10.00 GB Free Tier`
        : '10.00 GB / Month Free + Zero Egress',
      details: {
        configured: hasR2,
        bucket: r2Bucket || 'Not configured',
        publicCdn: r2PublicUrl || 'Not configured'
      }
    });

    // 6. Express Static Local Media Store (/uploads)
    let uploadFiles: Array<{ name: string; bytes: number }> = [];
    let uploadTotalBytes = 0;
    try {
      const names = await fs.promises.readdir(uploadsDir);
      const stats = await Promise.all(
        names.map(async (name) => {
          const st = await fs.promises.stat(path.join(uploadsDir, name));
          return st.isFile() ? { name, bytes: st.size } : null;
        })
      );
      uploadFiles = stats.filter((s): s is { name: string; bytes: number } => Boolean(s));
      uploadTotalBytes = uploadFiles.reduce((acc, f) => acc + f.bytes, 0);
    } catch {
      uploadFiles = [];
    }

    entries.push({
      id: 'local-uploads',
      name: 'Express Static Media Store (/uploads)',
      role: 'Persistent On-Node WebP/JPEG Store & R2 Automatic Failover Target',
      provider: 'Express 4 Static Volume',
      status: 'connected',
      latencyMs: 1,
      usedBytes: uploadTotalBytes,
      freeTierLimitBytes: diskTotalBytes,
      balanceBytes: diskAvailBytes,
      recordCount: uploadFiles.length,
      usageLabel: `${formatBytesHuman(uploadTotalBytes)} (${uploadFiles.length} media files)`,
      balanceLabel: diskAvailBytes !== null ? `${formatBytesHuman(diskAvailBytes)} OS Volume Available` : 'Volume Ready',
      details: {
        directory: '/uploads',
        fileCount: uploadFiles.length,
        recentFiles: uploadFiles.slice(-5).map((f) => `${f.name} (${formatBytesHuman(f.bytes)})`).join(', ') || 'Empty'
      }
    });

    return {
      databases: entries,
      controlConfig: dbControlConfig,
      analyticsSummary: getSqlAnalyticsSummary(),
      checkedAt: new Date().toISOString()
    };
  };

  const runDatabaseAction = async (action: string) => {
    if (action === 'sync-snapshot') {
      const fresh = await fetchPublicCatalogFromFirestore();
      if (!fresh) {
        return {
          ok: false,
          error: 'Could not reach Cloud Firestore REST API to refresh snapshot.'
        };
      }
      await setCached('catalog:bootstrap:v1', fresh, (serverControlConfig.catalogTtlSeconds || 120) * 1000);
      return {
        ok: true,
        action,
        message: `Synced ${fresh.products.length} products, ${fresh.coupons.length} coupons, and ${fresh.serviceAreas.length} service areas into SQLite WAL + Cache.`,
        productsCount: fresh.products.length,
        couponsCount: fresh.coupons.length,
        serviceAreasCount: fresh.serviceAreas.length,
        payloadBytes: Buffer.byteLength(JSON.stringify(fresh), 'utf8')
      };
    }

    if (action === 'purge-cache') {
      const clearedL1 = l1Cache.size;
      l1Cache.clear();
      if (hasUpstash) {
        await upstashCommand(['DEL', 'catalog:bootstrap:v1']);
      }
      return {
        ok: true,
        action,
        message: `Purged ${clearedL1} L1 memory cache entries${hasUpstash ? ' and Upstash catalog key' : ''}.`
      };
    }

    if (action === 'checkpoint-sqlite') {
      const walPath = `${sqlitePath}-wal`;
      const beforeWalBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      const afterWalBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      return {
        ok: true,
        action,
        message: `SQLite WAL checkpoint complete (${formatBytesHuman(beforeWalBytes)} -> ${formatBytesHuman(afterWalBytes)}).`,
        beforeWalBytes,
        afterWalBytes
      };
    }

    return { ok: false, error: `Unknown database action: ${action}` };
  };

  const getServersAndApisReport = (port: number) => {
    const mem = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const heapLimitBytes = heapStats.heap_size_limit || mem.heapTotal;
    const heapRemainingBytes = Math.max(0, heapLimitBytes - mem.heapUsed);
    const limits = serverControlConfig.rateLimits;
    const ttls = serverControlConfig;
    const quotas = {
      ...DEFAULT_DAILY_QUOTAS,
      ...(serverControlConfig.dailyQuotas || {})
    };

    const now = new Date();
    const dayKey = now.toISOString().split('T')[0];
    const currentSlot = Math.floor(now.getTime() / 60000);
    const nextUtcMidnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    );
    const quotaResetInSeconds = Math.max(1, Math.ceil((nextUtcMidnight - now.getTime()) / 1000));

    interface QuotaUsageRow {
      endpoint_id: string;
      calls_total: number;
      rate_limited: number;
      cache_hits: number;
      error_count: number;
      latency_sum_ms: number;
      last_called_at: string | null;
    }

    const usageMap = new Map<string, QuotaUsageRow>();
    try {
      const rows = sqlite
        .prepare(
          `SELECT endpoint_id, calls_total, rate_limited, cache_hits, error_count, latency_sum_ms, last_called_at
           FROM api_quota_usage
           WHERE day_key = ?`
        )
        .all(dayKey) as QuotaUsageRow[];
      for (const row of rows) {
        usageMap.set(row.endpoint_id, row);
      }
    } catch {
      // non-fatal
    }

    const baseRegistry = [
      {
        id: 'api-health',
        group: 'Core Express APIs',
        method: 'GET',
        path: '/api/health',
        targetUrl: `http://127.0.0.1:${port}/api/health`,
        auth: 'Public',
        rateLimit: 'Unlimited',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: 'No Cache',
        description: 'Live multi-cloud diagnostics & runtime node health.'
      },
      {
        id: 'api-runtime-config',
        group: 'Core Express APIs',
        method: 'GET',
        path: '/api/public/runtime-config',
        targetUrl: `http://127.0.0.1:${port}/api/public/runtime-config`,
        auth: 'Public',
        rateLimit: '30s Cache',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: '30s',
        description: 'Broadcasts active origin/edge failover URLs to web & mobile clients.'
      },
      {
        id: 'api-bootstrap',
        group: 'Core Express APIs',
        method: 'GET',
        path: '/api/catalog/bootstrap',
        targetUrl: `http://127.0.0.1:${port}/api/catalog/bootstrap`,
        auth: 'Public (CDN Cached)',
        rateLimit: 'Edge Cached',
        perMinLimit: null as number | null,
        dailyQuota: quotas.bootstrapDailyQuota as number | null,
        cacheTtl: `${ttls.catalogTtlSeconds}s (L1/L2 + s-maxage)`,
        description: 'Hydrates products, coupons, serviceAreas, and settings with near-zero Firestore reads.'
      },
      {
        id: 'api-invalidate',
        group: 'Core Express APIs',
        method: 'POST',
        path: '/api/catalog/invalidate',
        targetUrl: '',
        auth: 'Rate-Limited',
        rateLimit: `${limits.invalidatePerMin}/min`,
        perMinLimit: limits.invalidatePerMin as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: 'Immediate Purge',
        description: 'Clears L1/L2 catalog cache after admin product/coupon/area mutations.'
      },
      {
        id: 'api-verify-stock',
        group: 'Core Express APIs',
        method: 'POST',
        path: '/api/orders/verify-stock',
        targetUrl: '',
        auth: 'Rate-Limited',
        rateLimit: `${limits.verifyStockPerMin}/min`,
        perMinLimit: limits.verifyStockPerMin as number | null,
        dailyQuota: quotas.verifyStockDailyQuota as number | null,
        cacheTtl: 'Authoritative Snapshot',
        description: 'Verifies live inventory, store open status, and approved pincode area restrictions.'
      },
      {
        id: 'api-quote',
        group: 'Core Express APIs',
        method: 'POST',
        path: '/api/orders/quote',
        targetUrl: '',
        auth: 'Rate-Limited',
        rateLimit: `${limits.quotePerMin}/min`,
        perMinLimit: limits.quotePerMin as number | null,
        dailyQuota: quotas.quoteDailyQuota as number | null,
        cacheTtl: `${ttls.quoteTtlSeconds}s`,
        description: 'Server-side pricing, GST tax, delivery fee override & discount coupon quote calculation.'
      },
      {
        id: 'api-slots',
        group: 'Core Express APIs',
        method: 'GET',
        path: '/api/slots',
        targetUrl: `http://127.0.0.1:${port}/api/slots`,
        auth: 'Public',
        rateLimit: 'Edge Cached',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: `${ttls.slotsTtlSeconds}s`,
        description: 'Real-time rolling delivery slot availability.'
      },
      {
        id: 'api-media-upload',
        group: 'Core Express APIs',
        method: 'POST',
        path: '/api/media/upload',
        targetUrl: '',
        auth: 'Rate-Limited (<300KB)',
        rateLimit: `${limits.uploadPerMin}/min`,
        perMinLimit: limits.uploadPerMin as number | null,
        dailyQuota: quotas.uploadDailyQuota as number | null,
        cacheTtl: '1-Year Immutable CDN',
        description: 'Stores compressed WebP/JPEG uploads in Cloudflare R2 or /uploads fallback.'
      },
      {
        id: 'api-archive-order',
        group: 'Multi-DB Warehouse APIs',
        method: 'POST',
        path: '/api/archive/order',
        targetUrl: '',
        auth: 'Rate-Limited',
        rateLimit: `${limits.archivePerMin}/min`,
        perMinLimit: limits.archivePerMin as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: 'Write-Through SQL',
        description: 'Dual-writes completed/updated orders into SQLite WAL and Supabase PostgreSQL.'
      },
      {
        id: 'api-analytics-summary',
        group: 'Multi-DB Warehouse APIs',
        method: 'GET',
        path: '/api/analytics/summary',
        targetUrl: `http://127.0.0.1:${port}/api/analytics/summary`,
        auth: 'Public Read',
        rateLimit: '15s Cache',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: '15s',
        description: 'Aggregated SQL revenue, COD/UPI breakdown, and top cities from SQLite WAL.'
      },
      {
        id: 'api-admin-databases',
        group: 'Admin Control Center APIs',
        method: 'GET',
        path: '/api/admin/databases',
        targetUrl: '',
        auth: 'Firebase Bearer Token (Admin)',
        rateLimit: 'Admin Verified',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: 'Live Telemetry',
        description: 'Full database & cloud storage inspection plus auto-failover config.'
      },
      {
        id: 'api-admin-servers',
        group: 'Admin Control Center APIs',
        method: 'GET',
        path: '/api/admin/servers',
        targetUrl: '',
        auth: 'Firebase Bearer Token (Admin)',
        rateLimit: 'Admin Verified',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: 'Live Telemetry',
        description: 'Server node registry, quotas & balance, Cloudflare Edge config, and API rate-limit controls.'
      },
      {
        id: 'cloud-firestore-rest',
        group: 'Connected Cloud APIs',
        method: 'POST',
        path: `Firestore v1 REST (${firebaseMeta.projectId || 'unconfigured'})`,
        targetUrl: firebaseMeta.projectId
          ? `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseMeta.projectId)}/databases/${encodeURIComponent(firebaseMeta.firestoreDatabaseId || '(default)')}/documents/settings/store${firebaseMeta.apiKey ? `?key=${encodeURIComponent(firebaseMeta.apiKey)}` : ''}`
          : '',
        auth: 'Firebase API Key + Security Rules',
        rateLimit: '50K reads / 20K writes per day (Spark)',
        perMinLimit: null as number | null,
        dailyQuota: quotas.firestoreReadsDailyQuota as number | null,
        cacheTtl: `${dbControlConfig.firestoreTimeoutMs}ms timeout`,
        description: 'Direct Google Cloud Firestore Enterprise document & query API.'
      },
      {
        id: 'cloud-firebase-auth',
        group: 'Connected Cloud APIs',
        method: 'POST',
        path: 'Firebase IdentityToolkit (Phone OTP & Google Auth)',
        targetUrl: firebaseMeta.apiKey
          ? `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(firebaseMeta.apiKey)}`
          : '',
        auth: 'Firebase Project Key',
        rateLimit: 'Firebase Auth Quotas',
        perMinLimit: null as number | null,
        dailyQuota: quotas.authDailyQuota as number | null,
        cacheTtl: '60s Admin Token Cache',
        description: 'Handles SMS OTP verification, Google OAuth, and backend Admin token verification.'
      }
    ];

    const apiRegistry = baseRegistry.map((item) => {
      const dbUsage = usageMap.get(item.id);
      const minBucket = minuteUsageMap.get(item.id);
      const usedThisMin = minBucket && minBucket.slot === currentSlot ? minBucket.count : 0;
      const usedToday = dbUsage?.calls_total || 0;
      const throttledToday = dbUsage?.rate_limited || 0;
      const cacheHitsToday = dbUsage?.cache_hits || 0;
      const errorCountToday = dbUsage?.error_count || 0;
      const avgLatencyMs =
        usedToday > 0 ? Math.round((dbUsage?.latency_sum_ms || 0) / usedToday) : 0;

      return {
        ...item,
        usedThisMin,
        remainingThisMin:
          item.perMinLimit !== null ? Math.max(0, item.perMinLimit - usedThisMin) : null,
        usedToday,
        remainingToday:
          item.dailyQuota !== null ? Math.max(0, item.dailyQuota - usedToday) : null,
        cacheHitsToday,
        throttledToday,
        errorCountToday,
        avgLatencyMs,
        lastCalledAt: dbUsage?.last_called_at || null
      };
    });

    const expressApis = apiRegistry.filter((a) => a.id.startsWith('api-'));
    const serverRequestsUsedToday = expressApis.reduce((sum, a) => sum + a.usedToday, 0);
    const serverRequestsRemainingToday = Math.max(
      0,
      quotas.serverDailyQuota - serverRequestsUsedToday
    );
    const serverRequestsLastMin = expressApis.reduce((sum, a) => sum + a.usedThisMin, 0);
    const serverPerMinCapacity =
      limits.uploadPerMin +
      limits.verifyStockPerMin +
      limits.quotePerMin +
      limits.archivePerMin +
      limits.invalidatePerMin;
    const protectedUsedThisMin = expressApis
      .filter((a) => a.perMinLimit !== null)
      .reduce((sum, a) => sum + a.usedThisMin, 0);
    const protectedRemainingThisMin = Math.max(0, serverPerMinCapacity - protectedUsedThisMin);
    const serverThrottledToday = expressApis.reduce((sum, a) => sum + a.throttledToday, 0);
    const serverErrorsToday = expressApis.reduce((sum, a) => sum + a.errorCountToday, 0);
    const totalCacheHits = cacheStats.l1Hits + cacheStats.l2Hits;
    const totalCacheLookups = totalCacheHits + cacheStats.misses;
    const cacheOffloadPercent =
      totalCacheLookups > 0 ? Math.round((totalCacheHits / totalCacheLookups) * 100) : 0;

    const quoteApi = apiRegistry.find((a) => a.id === 'api-quote');

    const nodeQuotas = serverControlConfig.serverNodes.map((node) => {
      if (node.role === 'edge-worker') {
        const edgeDailyQuota = 100000;
        return {
          nodeId: node.id,
          label: node.label,
          role: node.role,
          enabled: node.enabled,
          quotaTier: 'Cloudflare Workers Free Tier',
          dailyQuota: edgeDailyQuota,
          usedToday: 0,
          remainingToday: edgeDailyQuota
        };
      }
      const usedToday = node.id === 'origin-primary' ? serverRequestsUsedToday : 0;
      return {
        nodeId: node.id,
        label: node.label,
        role: node.role,
        enabled: node.enabled,
        quotaTier:
          node.id === 'origin-primary' ? 'Primary Express Daily Budget' : 'Replica Origin Budget',
        dailyQuota: quotas.serverDailyQuota,
        usedToday,
        remainingToday: Math.max(0, quotas.serverDailyQuota - usedToday)
      };
    });

    return {
      controlConfig: {
        ...serverControlConfig,
        dailyQuotas: quotas
      },
      runtime: {
        nodeVersion: process.version,
        platform: `${process.platform} (${process.arch})`,
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapLimitBytes,
        heapRemainingBytes,
        replicaId: process.env.REPLICA_ID || 'node-primary',
        region: process.env.SERVER_REGION || 'asia-southeast1',
        cloudflareWorkerTemplate: 'cloudflare/worker.js',
        dayKey,
        quotaResetInSeconds
      },
      serverQuotaSummary: {
        serverRequestsDailyQuota: quotas.serverDailyQuota,
        serverRequestsUsedToday,
        serverRequestsRemainingToday,
        serverRequestsLastMin,
        serverPerMinCapacity,
        protectedUsedThisMin,
        protectedRemainingThisMin,
        serverThrottledToday,
        serverErrorsToday,
        cacheHitsToday: Math.max(
          totalCacheHits,
          expressApis.reduce((sum, a) => sum + a.cacheHitsToday, 0)
        ),
        l1Hits: cacheStats.l1Hits,
        l2Hits: cacheStats.l2Hits,
        cacheMisses: cacheStats.misses,
        cacheOffloadPercent,
        nodeQuotas
      },
      quoteApiQuota: {
        rateLimitPerMin: limits.quotePerMin,
        usedThisMin: quoteApi?.usedThisMin ?? 0,
        remainingThisMin: quoteApi?.remainingThisMin ?? limits.quotePerMin,
        dailyQuota: quotas.quoteDailyQuota,
        usedToday: quoteApi?.usedToday ?? 0,
        remainingToday: quoteApi?.remainingToday ?? quotas.quoteDailyQuota,
        cacheHitsToday: quoteApi?.cacheHitsToday ?? 0,
        throttledToday: quoteApi?.throttledToday ?? 0,
        errorCountToday: quoteApi?.errorCountToday ?? 0,
        avgLatencyMs: quoteApi?.avgLatencyMs ?? 0,
        lastCalledAt: quoteApi?.lastCalledAt ?? null,
        cacheTtlSeconds: ttls.quoteTtlSeconds
      },
      apiRegistry
    };
  };

  const probeServerOrApi = async (target: string, port: number) => {
    const allowedMap = new Map<string, string>();
    allowedMap.set('local:/api/health', `http://127.0.0.1:${port}/api/health`);
    allowedMap.set('local:/api/catalog/bootstrap', `http://127.0.0.1:${port}/api/catalog/bootstrap`);
    allowedMap.set('local:/api/slots', `http://127.0.0.1:${port}/api/slots`);
    allowedMap.set('local:/api/analytics/summary', `http://127.0.0.1:${port}/api/analytics/summary`);
    allowedMap.set('api-health', `http://127.0.0.1:${port}/api/health`);
    allowedMap.set('api-runtime-config', `http://127.0.0.1:${port}/api/public/runtime-config`);
    allowedMap.set('api-bootstrap', `http://127.0.0.1:${port}/api/catalog/bootstrap`);
    allowedMap.set('api-slots', `http://127.0.0.1:${port}/api/slots`);
    allowedMap.set('api-analytics-summary', `http://127.0.0.1:${port}/api/analytics/summary`);

    if (firebaseMeta.projectId) {
      allowedMap.set(
        'cloud-firestore-rest',
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseMeta.projectId)}/databases/${encodeURIComponent(firebaseMeta.firestoreDatabaseId || '(default)')}/documents/settings/store${firebaseMeta.apiKey ? `?key=${encodeURIComponent(firebaseMeta.apiKey)}` : ''}`
      );
    }
    if (firebaseMeta.apiKey) {
      allowedMap.set(
        'cloud-firebase-auth',
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(firebaseMeta.apiKey)}`
      );
    }

    for (const node of serverControlConfig.serverNodes) {
      const nodeHealth = node.url ? `${node.url.replace(/\/+$/, '')}/api/health` : `http://127.0.0.1:${port}/api/health`;
      allowedMap.set(node.id, nodeHealth);
    }

    const resolvedUrl = allowedMap.get(target);
    if (!resolvedUrl) {
      return {
        ok: false,
        status: 400,
        latencyMs: 0,
        error: 'Target is not a registered server node or public GET endpoint.'
      };
    }

    const start = performance.now();
    try {
      const res = await fetch(resolvedUrl, { signal: AbortSignal.timeout(4500) });
      const latencyMs = Math.round(performance.now() - start);
      if (target === 'cloud-firestore-rest' || target === 'cloud-firebase-auth') {
        recordApiUsage(target, { latencyMs, statusCode: res.status });
      }
      return {
        ok: res.ok,
        status: res.status,
        latencyMs,
        cacheHeader: res.headers.get('x-cache') || res.headers.get('x-catalog-source') || null,
        edgeHeader: res.headers.get('x-edge-cloud') || null
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      if (target === 'cloud-firestore-rest' || target === 'cloud-firebase-auth') {
        recordApiUsage(target, { latencyMs, statusCode: 503 });
      }
      return {
        ok: false,
        status: 503,
        latencyMs,
        error: err instanceof Error ? err.message : 'Probe request failed'
      };
    }
  };

  return {
    uploadsDir,
    getCached,
    setCached,
    invalidateCatalogCache,
    checkRateLimit,
    getCatalogBootstrap,
    archiveOrder,
    archiveLedgerEntry,
    getSqlAnalyticsSummary,
    uploadMediaObject,
    verifyFirebaseAdminToken,
    getDbControlConfig,
    updateDbControlConfig,
    getServerControlConfig,
    updateServerControlConfig,
    getDatabasesReport,
    runDatabaseAction,
    getServersAndApisReport,
    probeServerOrApi,
    recordApiUsage,
    resetApiQuotaUsage,
    getDiagnostics: () => ({
      replicaId: process.env.REPLICA_ID || 'node-primary',
      region: process.env.SERVER_REGION || 'asia-southeast1',
      caches: {
        l1Entries: l1Cache.size,
        l2Provider: hasUpstash && dbControlConfig.l2CacheEnabled ? 'Upstash Redis REST' : 'Disabled (L1 Active)',
        l1Hits: cacheStats.l1Hits,
        l2Hits: cacheStats.l2Hits,
        misses: cacheStats.misses
      },
      databases: {
        realtimePrimary: 'Google Cloud Firestore (Enterprise Edition)',
        edgeReplica: 'SQLite WAL (better-sqlite3)',
        relationalArchive: hasSupabase && dbControlConfig.archivalSyncEnabled
          ? 'Supabase PostgreSQL (PostgREST)'
          : 'Local SQLite WAL Mirror',
        activeReadPolicy: dbControlConfig.primaryReadDb,
        autoFailoverEnabled: dbControlConfig.autoFailoverEnabled
      },
      objectStorage:
        dbControlConfig.storageTarget === 'local'
          ? 'Express Static Media Store (Forced)'
          : hasR2
          ? 'Cloudflare R2 + Local Static Fallback'
          : 'Express Static Media Store'
    })
  };
}
