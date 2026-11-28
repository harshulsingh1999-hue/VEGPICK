import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import Database from 'better-sqlite3';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as webPush from 'web-push';
import { createMaintenanceDiagnostics } from './maintenanceDiagnostics.ts';

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
  deliverySlots: Array<Record<string, unknown>>;
  settings: Record<string, unknown> | null;
  source: 'memory-l1' | 'upstash-l2' | 'firestore-rest' | 'sqlite-replica';
  generatedAt: string;
}

export interface DeleteOrderHistoryInput {
  orderIds: string[];
  deleteLedgerEntries?: boolean;
  proofImageUrls?: string[];
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
  tier?: 'primary' | 'backup';
  freeUnlimited?: boolean;
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
  unlimitedFreeMode: boolean;
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
  statusNote?: string | null;
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
  // Includes automatic corruption detection (PRAGMA integrity_check) & clean B-tree salvage rebuild
  const sqlitePath = path.join(dataDir, 'edge_replica.db');
  const VALID_CONTROL_KEYS = new Set([
    'db_control',
    'server_control',
    'cleanup_control',
    'app_diagnostics_control'
  ]);

  const initSqliteSchema = (db: Database.Database): void => {
    db.exec(`
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
      CREATE TABLE IF NOT EXISTS app_diagnostic_events (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        route TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        resolved INTEGER NOT NULL DEFAULT 0,
        auto_healed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_diag_platform_created ON app_diagnostic_events(platform, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_diag_resolved ON app_diagnostic_events(resolved, created_at DESC);
      CREATE TABLE IF NOT EXISTS push_config (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        device_id TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'customer',
        platform TEXT NOT NULL DEFAULT 'web',
        subscription_json TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_events (
        id TEXT PRIMARY KEY,
        target_uid TEXT NOT NULL DEFAULT '',
        target_role TEXT NOT NULL DEFAULT '',
        target_device_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '/',
        tag TEXT NOT NULL DEFAULT 'freshveggie-alert',
        action TEXT NOT NULL DEFAULT 'open',
        order_id TEXT NOT NULL DEFAULT '',
        require_interaction INTEGER NOT NULL DEFAULT 0,
        actions_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
    `);

    const subCols = db.prepare('PRAGMA table_info(push_subscriptions)').all() as Array<{ name: string }>;
    if (!subCols.some((c) => c.name === 'device_id')) {
      db.exec("ALTER TABLE push_subscriptions ADD COLUMN device_id TEXT NOT NULL DEFAULT ''");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_push_uid ON push_subscriptions(uid);
      CREATE INDEX IF NOT EXISTS idx_push_role ON push_subscriptions(role);
      CREATE INDEX IF NOT EXISTS idx_push_device ON push_subscriptions(device_id);
      CREATE INDEX IF NOT EXISTS idx_push_events_created ON push_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_push_events_device ON push_events(target_device_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_push_events_uid ON push_events(target_uid, created_at DESC);
    `);
  };

  let sqliteRecoveredReason: string | null = null;

  const openHealthySqlite = (): Database.Database => {
    const db = new Database(sqlitePath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    initSqliteSchema(db);

    let healthy = false;
    try {
      const integrity = db.pragma('integrity_check', { simple: true });
      healthy = integrity === 'ok';
      if (!healthy) {
        try {
          db.exec('REINDEX;');
          const rechecked = db.pragma('integrity_check', { simple: true });
          if (rechecked === 'ok') {
            return db;
          }
          sqliteRecoveredReason = `integrity_check returned ${String(rechecked)}`;
        } catch {
          sqliteRecoveredReason = `integrity_check returned ${String(integrity)}`;
        }
      }
    } catch (err) {
      sqliteRecoveredReason = err instanceof Error ? err.message : 'integrity_check failed';
      healthy = false;
    }

    if (healthy) {
      return db;
    }

    // Salvage intact rows per table before rebuilding clean SQLite file
    let salvagedCatalog: Array<{ id: string; payload: string; updated_at: number }> = [];
    let salvagedOrders: Array<Record<string, unknown>> = [];
    let salvagedLedger: Array<Record<string, unknown>> = [];
    let salvagedConfigs: Array<{ key: string; value: string; updated_at: number }> = [];
    let salvagedDiags: Array<Record<string, unknown>> = [];

    try {
      salvagedCatalog = (
        db.prepare("SELECT id, payload, updated_at FROM catalog_snapshot WHERE id = 'storefront'").all() as Array<{
          id: string;
          payload: string;
          updated_at: number;
        }>
      ).filter((r) => {
        try {
          return typeof r.payload === 'string' && Boolean(JSON.parse(r.payload));
        } catch {
          return false;
        }
      });
    } catch {
      salvagedCatalog = [];
    }

    try {
      salvagedOrders = (
        db
          .prepare(
            'SELECT id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at FROM order_archive'
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => typeof r.id === 'string' && r.id.length > 0 && typeof r.user_id === 'string' && r.user_id.length > 0);
    } catch {
      salvagedOrders = [];
    }

    try {
      salvagedLedger = (
        db
          .prepare('SELECT id, partner_uid, order_id, type, amount, created_at FROM wallet_ledger_archive')
          .all() as Array<Record<string, unknown>>
      ).filter((r) => typeof r.id === 'string' && r.id.length > 0 && typeof r.partner_uid === 'string' && r.partner_uid.length > 0);
    } catch {
      salvagedLedger = [];
    }

    try {
      salvagedConfigs = (
        db.prepare('SELECT key, value, updated_at FROM cloud_control_config').all() as Array<{
          key: string;
          value: string;
          updated_at: number;
        }>
      ).filter((r) => {
        if (!VALID_CONTROL_KEYS.has(String(r.key))) return false;
        try {
          const parsed = JSON.parse(String(r.value));
          return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
        } catch {
          return false;
        }
      });
    } catch {
      salvagedConfigs = [];
    }

    try {
      salvagedDiags = (
        db
          .prepare(
            'SELECT id, platform, severity, category, message, route, user_agent, resolved, auto_healed, created_at FROM app_diagnostic_events ORDER BY created_at DESC LIMIT 200'
          )
          .all() as Array<Record<string, unknown>>
      ).filter((r) => typeof r.id === 'string' && r.id.length > 0 && typeof r.message === 'string' && r.message.length > 0);
    } catch {
      salvagedDiags = [];
    }

    try {
      db.close();
    } catch {
      // ignore close errors on corrupt db
    }

    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${sqlitePath}${suffix}`;
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      } catch {
        // ignore unlink errors
      }
    }

    const cleanDb = new Database(sqlitePath);
    cleanDb.pragma('journal_mode = WAL');
    cleanDb.pragma('synchronous = NORMAL');
    cleanDb.pragma('busy_timeout = 5000');
    initSqliteSchema(cleanDb);

    const restoreTx = cleanDb.transaction(() => {
      const insCatalog = cleanDb.prepare(
        'INSERT OR REPLACE INTO catalog_snapshot (id, payload, updated_at) VALUES (?, ?, ?)'
      );
      for (const r of salvagedCatalog) {
        insCatalog.run(r.id, r.payload, Number(r.updated_at) || Date.now());
      }

      const insOrder = cleanDb.prepare(
        `INSERT OR REPLACE INTO order_archive
          (id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const o of salvagedOrders) {
        insOrder.run(
          String(o.id),
          String(o.user_id),
          String(o.city || ''),
          Number(o.total) || 0,
          String(o.status || 'placed'),
          String(o.payment_method || 'cod'),
          String(o.payment_status || 'pending'),
          String(o.assigned_to_uid || ''),
          Number(o.item_count) || 0,
          String(o.order_date || ''),
          Number(o.updated_at) || Date.now()
        );
      }

      const insLedger = cleanDb.prepare(
        `INSERT OR IGNORE INTO wallet_ledger_archive
          (id, partner_uid, order_id, type, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const l of salvagedLedger) {
        insLedger.run(
          String(l.id),
          String(l.partner_uid),
          String(l.order_id || ''),
          String(l.type || 'trip_credit'),
          Number(l.amount) || 0,
          Number(l.created_at) || Date.now()
        );
      }

      const insCfg = cleanDb.prepare(
        'INSERT OR REPLACE INTO cloud_control_config (key, value, updated_at) VALUES (?, ?, ?)'
      );
      for (const c of salvagedConfigs) {
        insCfg.run(c.key, c.value, Number(c.updated_at) || Date.now());
      }

      const insDiag = cleanDb.prepare(
        `INSERT OR IGNORE INTO app_diagnostic_events
          (id, platform, severity, category, message, route, user_agent, resolved, auto_healed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const d of salvagedDiags) {
        insDiag.run(
          String(d.id),
          String(d.platform || 'web'),
          String(d.severity || 'info'),
          String(d.category || 'runtime'),
          String(d.message),
          String(d.route || ''),
          String(d.user_agent || ''),
          Number(d.resolved) ? 1 : 0,
          Number(d.auto_healed) ? 1 : 0,
          Number(d.created_at) || Date.now()
        );
      }
    });
    restoreTx();
    console.warn(
      `[cloudStack] Rebuilt SQLite WAL edge replica cleanly (${sqliteRecoveredReason || 'corrupt page'}); salvaged ${salvagedOrders.length} orders, ${salvagedLedger.length} ledger rows, ${salvagedCatalog.length} catalog snapshot.`
    );
    return cleanDb;
  };

  const sqlite = openHealthySqlite();

  const parseHttpsUrl = (raw: string): URL | null => {
    if (!raw || !raw.startsWith('https://')) return null;
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  };

  const upstashUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const upstashToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  const upstashParsed = parseHttpsUrl(upstashUrl);
  const upstashConfigWarning = upstashUrl && !upstashParsed
    ? 'UPSTASH_REDIS_REST_URL must be a valid https://...upstash.io REST API URL (not rediss:// TCP URL).'
    : '';
  const hasUpstash = Boolean(upstashParsed && upstashToken);
  const upstashRedis: Redis | null = hasUpstash
    ? new Redis({ url: upstashUrl, token: upstashToken })
    : null;
  const ratelimiters = new Map<string, Ratelimit>();
  let upstashLastError: string | null = upstashConfigWarning || null;

  const inspectSupabaseKeyRole = (key: string): string | null => {
    if (!key) return null;
    if (key.startsWith('sb_publishable_')) {
      return 'You pasted a public sb_publishable_ key into SUPABASE_SERVICE_ROLE_KEY. Copy the server-only service_role or sb_secret_ key from Supabase Console → Project Settings → API Keys.';
    }
    const parts = key.split('.');
    if (parts.length === 3 && key.startsWith('eyJ')) {
      try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { role?: string };
        if (json.role && json.role !== 'service_role') {
          return `You pasted a "${json.role}" JWT key into SUPABASE_SERVICE_ROLE_KEY. Use the server-only "service_role" secret key (with RLS bypass) from Supabase Console → Project Settings → API.`;
        }
      } catch {
        // non-JWT or custom key format; let PostgREST validate it
      }
    }
    return null;
  };

  const formatSupabaseError = (message: string, code?: string, status?: number): string => {
    const rawErr = message || '';
    const errCode = code || '';
    const lower = rawErr.toLowerCase();
    if (
      errCode === 'PGRST205' ||
      errCode === '42P01' ||
      lower.includes('does not exist') ||
      lower.includes('schema cache')
    ) {
      return 'Connected to Supabase project, but tables (order_archive / wallet_ledger_archive / catalog_snapshot) are missing. Paste supabase/schema.sql in Supabase Console → SQL Editor and click Run.';
    }
    if (errCode === '42501' || lower.includes('row-level security')) {
      return 'Supabase RLS blocked the write (42501). Ensure SUPABASE_SERVICE_ROLE_KEY is set to the server-only service_role / sb_secret_ key (not anon / sb_publishable_), or re-run supabase/schema.sql.';
    }
    if (status === 401 || status === 403 || lower.includes('jwt') || lower.includes('invalid api key')) {
      return 'Supabase rejected credentials. Verify SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (service_role / sb_secret_).';
    }
    return rawErr || 'Unknown Supabase PostgREST error.';
  };

  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  ).trim();
  const supabaseParsed = parseHttpsUrl(supabaseUrl);
  const supabaseKeyWarning = inspectSupabaseKeyRole(supabaseKey);
  const supabaseUrlWarning = !supabaseUrl
    ? ''
    : !supabaseParsed
    ? 'SUPABASE_URL must be a valid https://<project-ref>.supabase.co Project URL (not a postgresql:// URI).'
    : supabaseParsed.hostname === 'supabase.com' || supabaseParsed.pathname.length > 1
    ? 'SUPABASE_URL should be your API Project URL (https://<project-ref>.supabase.co), not the dashboard URL.'
    : '';
  const supabaseConfigWarning = supabaseUrlWarning || supabaseKeyWarning || '';
  const hasSupabase = Boolean(supabaseParsed && supabaseKey && !supabaseConfigWarning);
  const supabase: SupabaseClient | null = hasSupabase
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;
  let supabaseLastError: string | null = supabaseConfigWarning || null;
  let supabaseLastSyncAt: string | null = null;

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

  const cleanUrl = (raw?: string) => (raw || '').trim().replace(/\/+$/, '');
  const envExtraServers = (process.env.VITE_API_SERVERS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const primary1EnvUrl = cleanUrl(process.env.PRIMARY_SERVER_1_URL);
  const primary2EnvUrl = cleanUrl(process.env.PRIMARY_SERVER_2_URL) || envExtraServers[0] || '';
  const backup3EnvUrl = cleanUrl(process.env.BACKUP_SERVER_3_URL) || envExtraServers[1] || '';
  const backup4EnvUrl = cleanUrl(process.env.BACKUP_SERVER_4_URL) || envExtraServers[2] || '';

  const initialNodes: ServerNodeConfig[] = [
    {
      id: 'primary-server-1',
      label: 'Primary Server 1 (Active Origin)',
      url: primary1EnvUrl,
      region: process.env.SERVER_REGION || 'asia-southeast1',
      role: 'primary',
      tier: 'primary',
      freeUnlimited: true,
      enabled: true,
      priority: 1
    },
    {
      id: 'primary-server-2',
      label: 'Primary Server 2 (Active Load-Balanced)',
      url: primary2EnvUrl,
      region: 'asia-southeast1',
      role: 'primary',
      tier: 'primary',
      freeUnlimited: true,
      enabled: true,
      priority: 2
    },
    {
      id: 'backup-server-3',
      label: 'Backup Server 3 (Edge / Hot Failover)',
      url: backup3EnvUrl,
      region: 'global-edge',
      role: backup3EnvUrl.includes('workers.dev') ? 'edge-worker' : 'secondary',
      tier: 'backup',
      freeUnlimited: true,
      enabled: true,
      priority: 3
    },
    {
      id: 'backup-server-4',
      label: 'Backup Server 4 (Cold Standby / Offline Shield)',
      url: backup4EnvUrl,
      region: 'multi-region',
      role: backup4EnvUrl.includes('workers.dev') ? 'edge-worker' : 'secondary',
      tier: 'backup',
      freeUnlimited: true,
      enabled: true,
      priority: 4
    },
    ...envExtraServers.slice(3).map((url, idx) => ({
      id: `replica-${idx + 5}`,
      label: url.includes('workers.dev') ? `Cloudflare Edge Proxy #${idx + 5}` : `Replica Server #${idx + 5}`,
      url,
      region: 'global-edge',
      role: (url.includes('workers.dev') ? 'edge-worker' : 'secondary') as 'edge-worker' | 'secondary',
      tier: 'backup' as const,
      freeUnlimited: true,
      enabled: true,
      priority: idx + 5
    }))
  ];

  const DEFAULT_DAILY_QUOTAS: ServerDailyQuotas = {
    serverDailyQuota: 10000000,
    quoteDailyQuota: 5000000,
    verifyStockDailyQuota: 5000000,
    uploadDailyQuota: 1000000,
    bootstrapDailyQuota: 10000000,
    firestoreReadsDailyQuota: 5000000,
    upstashDailyQuota: 1000000,
    authDailyQuota: 5000000
  };

  const DEFAULT_SERVER_CONTROL: ServerControlConfig = {
    serverNodes: initialNodes,
    catalogTtlSeconds: 120,
    slotsTtlSeconds: 60,
    quoteTtlSeconds: 30,
    rateLimits: {
      uploadPerMin: 500,
      verifyStockPerMin: 2000,
      quotePerMin: 2000,
      archivePerMin: 2000,
      invalidatePerMin: 500
    },
    dailyQuotas: DEFAULT_DAILY_QUOTAS,
    autoServerFailover: true,
    unlimitedFreeMode: true,
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

  // Ensure the 4-server cluster (Primary 1, Primary 2, Backup 3, Backup 4) is always present
  const existingNodes = Array.isArray(rawServerCfg.serverNodes) ? rawServerCfg.serverNodes : [];
  const hasFourClusterIds = ['primary-server-1', 'primary-server-2', 'backup-server-3', 'backup-server-4'].every(
    (reqId) => existingNodes.some((n) => n.id === reqId)
  );
  let migratedNodes: ServerNodeConfig[];
  if (hasFourClusterIds) {
    migratedNodes = existingNodes.map((n, idx) => ({
      ...n,
      tier: n.tier || (n.role === 'primary' ? 'primary' : 'backup'),
      freeUnlimited: n.freeUnlimited ?? true,
      priority: n.priority || idx + 1
    }));
  } else {
    const customExtras = existingNodes.filter(
      (n) =>
        n.id !== 'origin-primary' &&
        n.id !== 'primary-server-1' &&
        n.id !== 'primary-server-2' &&
        n.id !== 'backup-server-3' &&
        n.id !== 'backup-server-4' &&
        Boolean(n.url)
    );
    migratedNodes = [
      ...initialNodes,
      ...customExtras.map((n, idx) => ({
        ...n,
        tier: (n.role === 'primary' ? 'primary' : 'backup') as 'primary' | 'backup',
        freeUnlimited: true,
        priority: 5 + idx
      }))
    ];
  }

  let serverControlConfig: ServerControlConfig = {
    ...DEFAULT_SERVER_CONTROL,
    ...rawServerCfg,
    serverNodes: migratedNodes,
    unlimitedFreeMode:
      typeof rawServerCfg.unlimitedFreeMode === 'boolean' ? rawServerCfg.unlimitedFreeMode : true,
    rateLimits: {
      ...DEFAULT_SERVER_CONTROL.rateLimits,
      ...(rawServerCfg.rateLimits || {})
    },
    dailyQuotas: {
      ...DEFAULT_DAILY_QUOTAS,
      ...(rawServerCfg.dailyQuotas || {})
    }
  };
  if (!hasFourClusterIds) {
    writeControlJson('server_control', serverControlConfig);
  }

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
            tier: node.tier || (role === 'primary' ? 'primary' : 'backup'),
            freeUnlimited: typeof node.freeUnlimited === 'boolean' ? node.freeUnlimited : true,
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
      uploadPerMin: Math.max(5, Math.min(50000, Number(patch.rateLimits?.uploadPerMin ?? serverControlConfig.rateLimits.uploadPerMin))),
      verifyStockPerMin: Math.max(10, Math.min(50000, Number(patch.rateLimits?.verifyStockPerMin ?? serverControlConfig.rateLimits.verifyStockPerMin))),
      quotePerMin: Math.max(10, Math.min(50000, Number(patch.rateLimits?.quotePerMin ?? serverControlConfig.rateLimits.quotePerMin))),
      archivePerMin: Math.max(10, Math.min(50000, Number(patch.rateLimits?.archivePerMin ?? serverControlConfig.rateLimits.archivePerMin))),
      invalidatePerMin: Math.max(5, Math.min(50000, Number(patch.rateLimits?.invalidatePerMin ?? serverControlConfig.rateLimits.invalidatePerMin)))
    };

    const nextDailyQuotas: ServerDailyQuotas = {
      serverDailyQuota: Math.max(1000, Math.min(100000000, Number(patch.dailyQuotas?.serverDailyQuota ?? serverControlConfig.dailyQuotas.serverDailyQuota))),
      quoteDailyQuota: Math.max(500, Math.min(100000000, Number(patch.dailyQuotas?.quoteDailyQuota ?? serverControlConfig.dailyQuotas.quoteDailyQuota))),
      verifyStockDailyQuota: Math.max(500, Math.min(100000000, Number(patch.dailyQuotas?.verifyStockDailyQuota ?? serverControlConfig.dailyQuotas.verifyStockDailyQuota))),
      uploadDailyQuota: Math.max(100, Math.min(100000000, Number(patch.dailyQuotas?.uploadDailyQuota ?? serverControlConfig.dailyQuotas.uploadDailyQuota))),
      bootstrapDailyQuota: Math.max(1000, Math.min(100000000, Number(patch.dailyQuotas?.bootstrapDailyQuota ?? serverControlConfig.dailyQuotas.bootstrapDailyQuota))),
      firestoreReadsDailyQuota: Math.max(1000, Math.min(100000000, Number(patch.dailyQuotas?.firestoreReadsDailyQuota ?? serverControlConfig.dailyQuotas.firestoreReadsDailyQuota))),
      upstashDailyQuota: Math.max(1000, Math.min(100000000, Number(patch.dailyQuotas?.upstashDailyQuota ?? serverControlConfig.dailyQuotas.upstashDailyQuota))),
      authDailyQuota: Math.max(1000, Math.min(100000000, Number(patch.dailyQuotas?.authDailyQuota ?? serverControlConfig.dailyQuotas.authDailyQuota)))
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
      unlimitedFreeMode:
        typeof patch.unlimitedFreeMode === 'boolean'
          ? patch.unlimitedFreeMode
          : serverControlConfig.unlimitedFreeMode,
      updatedAt: new Date().toISOString()
    });
    return serverControlConfig;
  };

  // L1 Memory LRU + TTL Cache & API Quota Telemetry
  const l1Cache = new Map<string, CacheEntry<unknown>>();
  const rateBuckets = new Map<string, RateBucket>();
  const minuteUsageMap = new Map<string, { slot: number; count: number; throttled: number }>();
  const cacheStats = { l1Hits: 0, l2Hits: 0, misses: 0 };

  interface PendingUsageDelta {
    endpointId: string;
    dayKey: string;
    callsTotal: number;
    rateLimited: number;
    cacheHits: number;
    errorCount: number;
    latencySumMs: number;
    lastCalledAt: string;
  }

  const upsertApiQuotaStmt = sqlite.prepare(`
    INSERT INTO api_quota_usage
      (endpoint_id, day_key, calls_total, rate_limited, cache_hits, error_count, latency_sum_ms, last_called_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint_id, day_key) DO UPDATE SET
      calls_total = calls_total + excluded.calls_total,
      rate_limited = rate_limited + excluded.rate_limited,
      cache_hits = cache_hits + excluded.cache_hits,
      error_count = error_count + excluded.error_count,
      latency_sum_ms = latency_sum_ms + excluded.latency_sum_ms,
      last_called_at = excluded.last_called_at
  `);

  const pendingUsageDeltas = new Map<string, PendingUsageDelta>();
  const flushApiQuotaTx = sqlite.transaction((entries: PendingUsageDelta[]) => {
    for (const d of entries) {
      upsertApiQuotaStmt.run(
        d.endpointId,
        d.dayKey,
        d.callsTotal,
        d.rateLimited,
        d.cacheHits,
        d.errorCount,
        d.latencySumMs,
        d.lastCalledAt
      );
    }
  });

  const flushPendingApiUsage = (): void => {
    if (pendingUsageDeltas.size === 0) return;
    const snapshot = Array.from(pendingUsageDeltas.values());
    pendingUsageDeltas.clear();
    try {
      flushApiQuotaTx(snapshot);
    } catch {
      // Non-blocking telemetry
    }
  };

  const telemetryFlushTimer = setInterval(flushPendingApiUsage, 2000);
  if (typeof telemetryFlushTimer.unref === 'function') {
    telemetryFlushTimer.unref();
  }

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

      const deltaKey = `${cleanId}::${dayKey}`;
      const existingDelta = pendingUsageDeltas.get(deltaKey);
      if (existingDelta) {
        existingDelta.callsTotal += 1;
        existingDelta.rateLimited += isLimited;
        existingDelta.cacheHits += isCacheHit;
        existingDelta.errorCount += isErr;
        existingDelta.latencySumMs += latency;
        existingDelta.lastCalledAt = nowIso;
      } else {
        pendingUsageDeltas.set(deltaKey, {
          endpointId: cleanId,
          dayKey,
          callsTotal: 1,
          rateLimited: isLimited,
          cacheHits: isCacheHit,
          errorCount: isErr,
          latencySumMs: latency,
          lastCalledAt: nowIso
        });
      }
      if (pendingUsageDeltas.size >= 100) {
        flushPendingApiUsage();
      }
    } catch {
      // Non-blocking telemetry
    }
  };

  const resetApiQuotaUsage = (): { ok: boolean; dayKey: string } => {
    const dayKey = new Date().toISOString().split('T')[0];
    pendingUsageDeltas.clear();
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

  const getCached = async <T>(key: string): Promise<{ value: T; tier: 'l1' | 'l2' } | null> => {
    if (dbControlConfig.l1CacheEnabled) {
      const l1 = getL1<T>(key);
      if (l1 !== null) {
        cacheStats.l1Hits += 1;
        return { value: l1, tier: 'l1' };
      }
    }

    if (upstashRedis && dbControlConfig.l2CacheEnabled) {
      const start = performance.now();
      try {
        const raw = await upstashRedis.get<T | string>(key);
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - start,
          statusCode: 200,
          cacheHit: raw !== null && raw !== undefined
        });
        upstashLastError = null;
        if (raw !== null && raw !== undefined) {
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
          if (dbControlConfig.l1CacheEnabled) {
            setL1(key, parsed, 30_000);
          }
          cacheStats.l2Hits += 1;
          return { value: parsed, tier: 'l2' };
        }
      } catch (err) {
        upstashLastError = err instanceof Error ? err.message : 'Upstash Redis GET failed';
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - start,
          statusCode: 503
        });
      }
    }

    cacheStats.misses += 1;
    return null;
  };

  const setCached = async <T>(key: string, value: T, ttlMs: number): Promise<void> => {
    if (dbControlConfig.l1CacheEnabled) {
      setL1(key, value, ttlMs);
    }
    if (upstashRedis && dbControlConfig.l2CacheEnabled) {
      const ttlSec = Math.max(5, Math.round(ttlMs / 1000));
      const start = performance.now();
      void upstashRedis
        .set(key, value, { ex: ttlSec })
        .then(() => {
          upstashLastError = null;
          recordApiUsage('cloud-upstash-redis', {
            latencyMs: performance.now() - start,
            statusCode: 200
          });
        })
        .catch((err) => {
          upstashLastError = err instanceof Error ? err.message : 'Upstash Redis SET failed';
          recordApiUsage('cloud-upstash-redis', {
            latencyMs: performance.now() - start,
            statusCode: 503
          });
        });
    }
  };

  const invalidateKey = async (key: string): Promise<void> => {
    l1Cache.delete(key);
    if (upstashRedis) {
      const start = performance.now();
      try {
        await upstashRedis.del(key);
        upstashLastError = null;
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - start,
          statusCode: 200
        });
      } catch (err) {
        upstashLastError = err instanceof Error ? err.message : 'Upstash Redis DEL failed';
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - start,
          statusCode: 503
        });
      }
    }
  };

  const getOrCreateRatelimiter = (bucket: string, maxRequests: number, windowSeconds: number): Ratelimit | null => {
    if (!upstashRedis) return null;
    const rlKey = `${bucket}:${maxRequests}:${windowSeconds}`;
    let limiter = ratelimiters.get(rlKey);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: upstashRedis,
        limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
        prefix: `fv:rl:${bucket}`,
        analytics: false
      });
      ratelimiters.set(rlKey, limiter);
    }
    return limiter;
  };

  const checkRateLimit = async (
    bucket: string,
    ip: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> => {
    const windowSlot = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rl:${bucket}:${ip}:${windowSlot}`;

    if (upstashRedis && dbControlConfig.l2CacheEnabled) {
      const start = performance.now();
      try {
        const limiter = getOrCreateRatelimiter(bucket, maxRequests, windowSeconds);
        if (limiter) {
          const res = await limiter.limit(ip);
          upstashLastError = null;
          recordApiUsage('cloud-upstash-redis', {
            latencyMs: performance.now() - start,
            statusCode: res.success ? 200 : 429,
            rateLimited: !res.success
          });
          return {
            allowed: res.success,
            remaining: Math.max(0, res.remaining),
            resetSeconds: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000))
          };
        }
      } catch (err) {
        upstashLastError = err instanceof Error ? err.message : 'Upstash Ratelimit check failed';
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - start,
          statusCode: 503
        });
        // Graceful fallback to L1 sliding counter below
      }
    }

    const now = Date.now();
    if (rateBuckets.size > 5000) {
      for (const [k, b] of rateBuckets.entries()) {
        if (now > b.resetAt) rateBuckets.delete(k);
      }
      while (rateBuckets.size > 5000) {
        const oldestKey = rateBuckets.keys().next().value;
        if (!oldestKey) break;
        rateBuckets.delete(oldestKey);
      }
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

  const verifyFirebaseUserToken = async (
    idToken: string
  ): Promise<{
    authenticated: boolean;
    uid?: string;
    email?: string;
    phoneNumber?: string;
    isAdmin?: boolean;
    reason?: string;
  }> => {
    if (!idToken || !firebaseMeta.apiKey) {
      return { authenticated: false, reason: 'Missing authentication token.' };
    }

    const cacheKey = `user_verify:${sha256Hex(idToken).slice(0, 24)}`;
    const cached = getL1<{
      authenticated: boolean;
      uid?: string;
      email?: string;
      phoneNumber?: string;
      isAdmin?: boolean;
    }>(cacheKey);
    if (cached && cached.authenticated) {
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
        return { authenticated: false, reason: 'Invalid or expired Firebase session token.' };
      }
      const lookupData = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          phoneNumber?: string;
        }>;
      };
      const account = lookupData.users?.[0];
      const uid = account?.localId || '';
      if (!uid) {
        return { authenticated: false, reason: 'Firebase user account not found.' };
      }
      const isAdmin =
        Boolean(account?.emailVerified) && account?.email === BOOTSTRAPPED_ADMIN_EMAIL;
      const result = {
        authenticated: true,
        uid,
        email: account?.email || '',
        phoneNumber: account?.phoneNumber || '',
        isAdmin
      };
      setL1(cacheKey, result, 60_000);
      return result;
    } catch {
      return { authenticated: false, reason: 'Unable to verify Firebase session token.' };
    }
  };

  // Cross-Platform Web Push Engine (Android Chrome/PWA + iOS 16.4+ Safari PWA + Web)
  let cachedVapid: { publicKey: string; privateKey: string; subject: string } | null = null;
  const getOrCreateVapidKeys = () => {
    const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const envSub =
      (process.env.VAPID_SUBJECT || '').trim() || 'mailto:support@freshveggie.local';

    if (envPub && envPriv) {
      webPush.setVapidDetails(envSub, envPub, envPriv);
      return { publicKey: envPub, privateKey: envPriv, subject: envSub };
    }

    if (cachedVapid) {
      return cachedVapid;
    }

    try {
      const existing = sqlite
        .prepare("SELECT public_key, private_key, subject FROM push_config WHERE id = 'default'")
        .get() as { public_key: string; private_key: string; subject: string } | undefined;
      if (existing?.public_key && existing?.private_key) {
        cachedVapid = {
          publicKey: existing.public_key,
          privateKey: existing.private_key,
          subject: existing.subject || envSub
        };
        webPush.setVapidDetails(cachedVapid.subject, cachedVapid.publicKey, cachedVapid.privateKey);
        return cachedVapid;
      }
    } catch {
      // generate fresh VAPID keys below
    }

    const generated = webPush.generateVAPIDKeys();
    cachedVapid = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject: envSub
    };
    try {
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO push_config (id, public_key, private_key, subject, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          'default',
          cachedVapid.publicKey,
          cachedVapid.privateKey,
          cachedVapid.subject,
          new Date().toISOString()
        );
    } catch {
      // memory cache still holds keys
    }
    webPush.setVapidDetails(cachedVapid.subject, cachedVapid.publicKey, cachedVapid.privateKey);
    return cachedVapid;
  };

  let cachedDeviceHmacSecret: string | null = null;
  const getPushDeviceSecret = (): string => {
    const envSecret = (process.env.PUSH_DEVICE_SECRET || '').trim();
    if (envSecret.length >= 16) {
      return envSecret;
    }
    if (cachedDeviceHmacSecret) {
      return cachedDeviceHmacSecret;
    }
    try {
      const existing = sqlite
        .prepare("SELECT private_key FROM push_config WHERE id = 'device_hmac'")
        .get() as { private_key: string } | undefined;
      if (existing?.private_key && existing.private_key.length >= 32) {
        cachedDeviceHmacSecret = existing.private_key;
        return cachedDeviceHmacSecret;
      }
    } catch {
      // fall through to generate secret
    }
    const generatedSecret = crypto.randomBytes(32).toString('hex');
    cachedDeviceHmacSecret = generatedSecret;
    try {
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO push_config (id, public_key, private_key, subject, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('device_hmac', 'hmac-sha256', generatedSecret, 'device-token', new Date().toISOString());
    } catch {
      // keep in memory if disk write unavailable
    }
    return cachedDeviceHmacSecret;
  };

  const isValidDeviceId = (raw: string): boolean => /^[a-zA-Z0-9_-]{12,80}$/.test(raw);

  const normalizeDeviceId = (raw?: string): string => {
    const cleaned = typeof raw === 'string' ? raw.trim() : '';
    if (isValidDeviceId(cleaned)) return cleaned;
    return `dev_${crypto.randomBytes(12).toString('hex')}`;
  };

  const issueDevicePushToken = (deviceId: string): string => {
    const cleanId = normalizeDeviceId(deviceId);
    const sig = crypto
      .createHmac('sha256', getPushDeviceSecret())
      .update(cleanId)
      .digest('hex');
    return `${cleanId}.${sig}`;
  };

  const verifyDevicePushToken = (
    rawToken: string
  ): { valid: boolean; deviceId?: string } => {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false };
    }
    const dotIdx = rawToken.indexOf('.');
    if (dotIdx <= 0) {
      return { valid: false };
    }
    const deviceId = rawToken.slice(0, dotIdx);
    const providedHex = rawToken.slice(dotIdx + 1);
    if (!isValidDeviceId(deviceId) || !/^[a-f0-9]{64}$/i.test(providedHex)) {
      return { valid: false };
    }
    const expectedHex = crypto
      .createHmac('sha256', getPushDeviceSecret())
      .update(deviceId)
      .digest('hex');
    try {
      const a = Buffer.from(providedHex, 'hex');
      const b = Buffer.from(expectedHex, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { valid: false };
      }
      return { valid: true, deviceId };
    } catch {
      return { valid: false };
    }
  };

  const isValidPushEndpoint = (rawUrl: string): boolean => {
    if (!rawUrl || rawUrl.length > 1024) return false;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        !host ||
        host === 'localhost' ||
        host === '0.0.0.0' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('169.254.') ||
        /^fe80:/i.test(host) ||
        /^f[cd][0-9a-f]{2}:/i.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const sanitizeRelativeAppUrl = (rawUrl?: string): string => {
    if (typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
      return rawUrl.slice(0, 200);
    }
    return '/';
  };

  const getVapidPublicKey = (): string => getOrCreateVapidKeys().publicKey;

  const upsertPushSubscription = (input: {
    uid?: string;
    deviceId?: string;
    verifiedDeviceId?: string;
    role: 'customer' | 'delivery' | 'admin';
    platform: 'android' | 'ios' | 'web';
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    userAgent?: string;
  }): { ok: boolean; deviceId: string } => {
    let cleanDeviceId = normalizeDeviceId(input.verifiedDeviceId || input.deviceId);
    if (
      !isValidPushEndpoint(input.subscription?.endpoint) ||
      !input.subscription?.keys?.p256dh ||
      !input.subscription?.keys?.auth
    ) {
      return { ok: false, deviceId: cleanDeviceId };
    }

    // Prevent unverified callers from claiming an already-registered deviceId belonging to another device
    if (!input.verifiedDeviceId && input.deviceId && isValidDeviceId(input.deviceId.trim())) {
      const candidateId = input.deviceId.trim();
      const occupied = sqlite
        .prepare('SELECT uid FROM push_subscriptions WHERE device_id = ? LIMIT 1')
        .get(candidateId) as { uid: string } | undefined;
      if (occupied && (!input.uid || occupied.uid !== input.uid)) {
        cleanDeviceId = `dev_${crypto.randomBytes(12).toString('hex')}`;
      }
    }

    const existingRow = sqlite
      .prepare('SELECT uid, role, device_id FROM push_subscriptions WHERE endpoint = ?')
      .get(input.subscription.endpoint) as
      | { uid: string; role: string; device_id: string }
      | undefined;

    let linkedUid = input.uid && !input.uid.startsWith('device:') ? input.uid.slice(0, 128) : '';
    let resolvedRole: 'customer' | 'delivery' | 'admin' =
      input.role === 'admin' || input.role === 'delivery' ? input.role : 'customer';

    if (!linkedUid) {
      // Preserve prior authenticated uid/role when background Service Worker refreshes via verified deviceId
      if (existingRow?.uid && !existingRow.uid.startsWith('device:')) {
        if (input.verifiedDeviceId && existingRow.device_id === input.verifiedDeviceId) {
          linkedUid = existingRow.uid;
          if (existingRow.role === 'admin') {
            resolvedRole = 'admin';
          }
        }
      } else if (input.verifiedDeviceId) {
        const deviceLinkedRow = sqlite
          .prepare(
            "SELECT uid, role FROM push_subscriptions WHERE device_id = ? AND uid NOT LIKE 'device:%' ORDER BY updated_at DESC LIMIT 1"
          )
          .get(input.verifiedDeviceId) as { uid: string; role: string } | undefined;
        if (deviceLinkedRow?.uid) {
          linkedUid = deviceLinkedRow.uid;
          if (deviceLinkedRow.role === 'admin') {
            resolvedRole = 'admin';
          }
        }
      }
    }

    const effectiveUid = linkedUid || `device:${cleanDeviceId}`;
    const cleanPlatform =
      input.platform === 'android' || input.platform === 'ios' ? input.platform : 'web';

    sqlite
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, uid, device_id, role, platform, subscription_json, user_agent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           uid = CASE
             WHEN excluded.uid NOT LIKE 'device:%' THEN excluded.uid
             WHEN push_subscriptions.uid NOT LIKE 'device:%' THEN push_subscriptions.uid
             ELSE excluded.uid
           END,
           device_id = CASE
             WHEN excluded.device_id != '' THEN excluded.device_id
             ELSE push_subscriptions.device_id
           END,
           role = CASE
             WHEN push_subscriptions.role = 'admin' AND excluded.uid LIKE 'device:%' THEN 'admin'
             ELSE excluded.role
           END,
           platform = excluded.platform,
           subscription_json = excluded.subscription_json,
           user_agent = excluded.user_agent,
           updated_at = excluded.updated_at`
      )
      .run(
        input.subscription.endpoint,
        effectiveUid,
        cleanDeviceId,
        resolvedRole,
        cleanPlatform,
        JSON.stringify({
          endpoint: input.subscription.endpoint,
          keys: {
            p256dh: String(input.subscription.keys.p256dh).slice(0, 512),
            auth: String(input.subscription.keys.auth).slice(0, 256)
          }
        }),
        String(input.userAgent || '').slice(0, 240),
        Date.now()
      );
    return { ok: true, deviceId: cleanDeviceId };
  };

  const removePushSubscription = (input: {
    uid?: string;
    deviceId?: string;
    endpoint: string;
    authKey?: string;
  }): number => {
    if (!input.endpoint) return 0;
    if (input.uid) {
      const res = sqlite
        .prepare('DELETE FROM push_subscriptions WHERE uid = ? AND endpoint = ?')
        .run(input.uid, input.endpoint);
      if (res.changes > 0) return res.changes;
    }
    if (input.deviceId) {
      const res = sqlite
        .prepare('DELETE FROM push_subscriptions WHERE device_id = ? AND endpoint = ?')
        .run(input.deviceId, input.endpoint);
      if (res.changes > 0) return res.changes;
    }
    if (input.authKey) {
      const row = sqlite
        .prepare('SELECT subscription_json FROM push_subscriptions WHERE endpoint = ?')
        .get(input.endpoint) as { subscription_json: string } | undefined;
      if (row) {
        try {
          const parsed = JSON.parse(row.subscription_json) as { keys?: { auth?: string } };
          if (parsed?.keys?.auth && parsed.keys.auth === input.authKey) {
            const res = sqlite
              .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
              .run(input.endpoint);
            return res.changes || 0;
          }
        } catch {
          return 0;
        }
      }
    }
    return 0;
  };

  const getUserPushSubscriptionCount = (uid?: string, deviceId?: string): number => {
    if (!uid && !deviceId) return 0;
    if (uid && deviceId) {
      const row = sqlite
        .prepare('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE uid = ? OR device_id = ?')
        .get(uid, deviceId) as { cnt: number } | undefined;
      return Number(row?.cnt || 0);
    }
    if (uid) {
      const row = sqlite
        .prepare('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE uid = ?')
        .get(uid) as { cnt: number } | undefined;
      return Number(row?.cnt || 0);
    }
    const row = sqlite
      .prepare('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE device_id = ?')
      .get(deviceId) as { cnt: number } | undefined;
    return Number(row?.cnt || 0);
  };

  const getPendingPushEvents = (input: {
    uid?: string;
    deviceId?: string;
    sinceMs?: number;
  }): Array<{
    id: string;
    title: string;
    body: string;
    url: string;
    tag: string;
    action: string;
    orderId: string;
    requireInteraction: boolean;
    actions?: Array<{ action: string; title: string }>;
    createdAt: number;
  }> => {
    const uid = input.uid ? input.uid.trim().slice(0, 128) : '';
    const deviceId = input.deviceId && isValidDeviceId(input.deviceId) ? input.deviceId : '';
    if (!uid && !deviceId) return [];

    const cutoff = Math.max(Date.now() - 12 * 60 * 60 * 1000, Number(input.sinceMs) || 0);
    let deviceRoles: string[] = [];
    if (uid || deviceId) {
      const roleRows = sqlite
        .prepare(
          uid && deviceId
            ? 'SELECT DISTINCT role FROM push_subscriptions WHERE uid = ? OR device_id = ?'
            : uid
            ? 'SELECT DISTINCT role FROM push_subscriptions WHERE uid = ?'
            : 'SELECT DISTINCT role FROM push_subscriptions WHERE device_id = ?'
        )
        .all(...(uid && deviceId ? [uid, deviceId] : [uid || deviceId])) as Array<{ role: string }>;
      deviceRoles = roleRows.map((r) => r.role).filter(Boolean);
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (deviceId) {
      clauses.push('target_device_id = ?');
      params.push(deviceId);
    }
    if (uid) {
      clauses.push('target_uid = ?');
      params.push(uid);
    }
    if (deviceRoles.length > 0) {
      clauses.push(`target_role IN (${deviceRoles.map(() => '?').join(', ')})`);
      params.push(...deviceRoles);
    }
    if (clauses.length === 0) return [];

    const rows = sqlite
      .prepare(
        `SELECT id, title, body, url, tag, action, order_id, require_interaction, actions_json, created_at
         FROM push_events
         WHERE created_at > ? AND (${clauses.join(' OR ')})
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all(cutoff, ...params) as Array<{
      id: string;
      title: string;
      body: string;
      url: string;
      tag: string;
      action: string;
      order_id: string;
      require_interaction: number;
      actions_json: string;
      created_at: number;
    }>;

    const seenKeys = new Set<string>();
    const deduped: typeof rows = [];
    for (const r of rows) {
      const dedupeKey = `${r.tag}|${r.title}|${r.body}|${r.created_at}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      deduped.push(r);
      if (deduped.length >= 10) break;
    }

    return deduped.map((row) => {
      let parsedActions: Array<{ action: string; title: string }> | undefined;
      try {
        const arr = JSON.parse(row.actions_json) as unknown[];
        if (Array.isArray(arr) && arr.length > 0) {
          parsedActions = arr as Array<{ action: string; title: string }>;
        }
      } catch {
        parsedActions = undefined;
      }
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        url: sanitizeRelativeAppUrl(row.url),
        tag: row.tag,
        action: row.action,
        orderId: row.order_id,
        requireInteraction: row.require_interaction === 1,
        actions: parsedActions,
        createdAt: row.created_at
      };
    });
  };

  const sendWebPush = async (input: {
    targetUids?: string[];
    targetRoles?: Array<'customer' | 'delivery' | 'admin'>;
    targetDeviceIds?: string[];
    excludeUid?: string;
    title: string;
    body: string;
    url?: string;
    tag?: string;
    action?: string;
    orderId?: string;
    requireInteraction?: boolean;
    actions?: Array<{ action: string; title: string }>;
  }): Promise<{ sent: number; failed: number; removedExpired: number }> => {
    getOrCreateVapidKeys();
    const uids = Array.from(
      new Set((input.targetUids || []).map((u) => u.trim()).filter(Boolean))
    ).slice(0, 100);
    const roles = Array.from(
      new Set(
        (input.targetRoles || []).filter(
          (r): r is 'customer' | 'delivery' | 'admin' =>
            r === 'customer' || r === 'delivery' || r === 'admin'
        )
      )
    );
    const deviceIds = Array.from(
      new Set((input.targetDeviceIds || []).map((d) => d.trim()).filter(isValidDeviceId))
    ).slice(0, 100);

    if (uids.length === 0 && roles.length === 0 && deviceIds.length === 0) {
      return { sent: 0, failed: 0, removedExpired: 0 };
    }

    const safeTitle = String(input.title || 'FreshVeggie Delivery').slice(0, 120);
    const safeBody = String(input.body || 'New notification').slice(0, 300);
    const safeUrl = sanitizeRelativeAppUrl(input.url);
    const safeTag = String(input.tag || 'freshveggie-alert').slice(0, 80);
    const safeAction = String(input.action || 'open').slice(0, 40);
    const safeOrderId = String(input.orderId || '').slice(0, 128);
    const safeActions = Array.isArray(input.actions) ? input.actions.slice(0, 2) : undefined;
    const now = Date.now();

    // Persist lightweight background event queue so SW background periodic sync can surface alerts without Firebase tokens
    try {
      sqlite.prepare('DELETE FROM push_events WHERE created_at < ?').run(now - 24 * 60 * 60 * 1000);
      const insertStmt = sqlite.prepare(
        `INSERT INTO push_events
          (id, target_uid, target_role, target_device_id, title, body, url, tag, action, order_id, require_interaction, actions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const actionsJson = JSON.stringify(safeActions || []);
      for (const devId of deviceIds.slice(0, 10)) {
        insertStmt.run(
          `pev_${now}_${crypto.randomBytes(4).toString('hex')}`,
          '',
          '',
          devId,
          safeTitle,
          safeBody,
          safeUrl,
          safeTag,
          safeAction,
          safeOrderId,
          input.requireInteraction ? 1 : 0,
          actionsJson,
          now
        );
      }
      for (const targetUid of uids.slice(0, 10)) {
        insertStmt.run(
          `pev_${now}_${crypto.randomBytes(4).toString('hex')}`,
          targetUid,
          '',
          '',
          safeTitle,
          safeBody,
          safeUrl,
          safeTag,
          safeAction,
          safeOrderId,
          input.requireInteraction ? 1 : 0,
          actionsJson,
          now
        );
      }
      for (const targetRole of roles) {
        insertStmt.run(
          `pev_${now}_${crypto.randomBytes(4).toString('hex')}`,
          '',
          targetRole,
          '',
          safeTitle,
          safeBody,
          safeUrl,
          safeTag,
          safeAction,
          safeOrderId,
          input.requireInteraction ? 1 : 0,
          actionsJson,
          now
        );
      }
    } catch {
      // non-fatal queue persistence
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (uids.length > 0) {
      clauses.push(`uid IN (${uids.map(() => '?').join(', ')})`);
      params.push(...uids);
    }
    if (roles.length > 0) {
      clauses.push(`role IN (${roles.map(() => '?').join(', ')})`);
      params.push(...roles);
    }
    if (deviceIds.length > 0) {
      clauses.push(`device_id IN (${deviceIds.map(() => '?').join(', ')})`);
      params.push(...deviceIds);
    }

    const rows = sqlite
      .prepare(
        `SELECT endpoint, uid, subscription_json FROM push_subscriptions WHERE ${clauses.join(' OR ')} LIMIT 300`
      )
      .all(...params) as Array<{ endpoint: string; uid: string; subscription_json: string }>;

    const filteredRows = input.excludeUid
      ? rows.filter((r) => r.uid !== input.excludeUid)
      : rows;

    const payloadJson = JSON.stringify({
      title: safeTitle,
      body: safeBody,
      url: safeUrl,
      tag: safeTag,
      action: safeAction,
      orderId: safeOrderId,
      requireInteraction: Boolean(input.requireInteraction),
      actions: safeActions
    });

    let sent = 0;
    let failed = 0;
    let removedExpired = 0;

    await Promise.all(
      filteredRows.map(async (row) => {
        if (!isValidPushEndpoint(row.endpoint)) return;
        try {
          const sub = JSON.parse(row.subscription_json) as webPush.PushSubscription;
          await webPush.sendNotification(sub, payloadJson, { TTL: 3600 });
          sent += 1;
        } catch (err) {
          failed += 1;
          const statusCode =
            err && typeof err === 'object' && 'statusCode' in err
              ? Number((err as { statusCode?: unknown }).statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            try {
              sqlite
                .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
                .run(row.endpoint);
              removedExpired += 1;
            } catch {
              // ignore cleanup failure
            }
          }
        }
      })
    );

    return { sent, failed, removedExpired };
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
      const [prodRes, couponRes, areaRes, slotRes, settingsRes] = await Promise.all([
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
        fetch(`${base}:runQuery${apiKeyParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'deliverySlots' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'sortOrder' },
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { integerValue: '0' }
                }
              },
              limit: 500
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

      let deliverySlots: Array<Record<string, unknown>> = [];
      if (slotRes.ok) {
        const slotRows = (await slotRes.json()) as Array<{
          document?: { name?: string; fields?: Record<string, unknown> };
        }>;
        deliverySlots = slotRows
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
        deliverySlots,
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
          deliverySlots: Array.isArray(parsed.deliverySlots) ? parsed.deliverySlots : [],
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

  let inFlightCatalogPromise: Promise<CatalogBootstrapPayload> | null = null;
  let slotsCacheVersion = 1;

  const getSlotsCacheVersion = (): number => slotsCacheVersion;

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
        deliverySlots: [],
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
        deliverySlots: [],
        settings: null,
        source: 'sqlite-replica',
        generatedAt: new Date().toISOString()
      };
    }

    // Upstash-First or Auto Multi-Cloud Mode
    if (mode === 'upstash' && upstashRedis && dbControlConfig.l2CacheEnabled) {
      const uStart = performance.now();
      try {
        const raw = await upstashRedis.get<CatalogBootstrapPayload | string>(cacheKey);
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - uStart,
          statusCode: 200,
          cacheHit: raw !== null && raw !== undefined
        });
        upstashLastError = null;
        if (raw !== null && raw !== undefined) {
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<CatalogBootstrapPayload>;
          cacheStats.l2Hits += 1;
          return {
            products: Array.isArray(parsed.products) ? parsed.products : [],
            coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
            serviceAreas: Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
            deliverySlots: Array.isArray(parsed.deliverySlots) ? parsed.deliverySlots : [],
            settings: parsed.settings ?? null,
            source: 'upstash-l2',
            generatedAt: parsed.generatedAt || new Date().toISOString()
          };
        }
      } catch (err) {
        upstashLastError = err instanceof Error ? err.message : 'Upstash GET failed';
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: performance.now() - uStart,
          statusCode: 503
        });
      }
      if (!dbControlConfig.autoFailoverEnabled) {
        return {
          products: [],
          coupons: [],
          serviceAreas: [],
          deliverySlots: [],
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
        deliverySlots: Array.isArray(cached.value.deliverySlots) ? cached.value.deliverySlots : [],
        source: cached.tier === 'l2' ? 'upstash-l2' : 'memory-l1'
      };
    }

    // Single-flight coalescing prevents cache stampede / thundering herd at 1M active users
    if (inFlightCatalogPromise) {
      return inFlightCatalogPromise;
    }

    inFlightCatalogPromise = (async () => {
      try {
        const fresh = await fetchPublicCatalogFromFirestore();
        if (fresh) {
          await setCached(cacheKey, fresh, ttlMs);
          return fresh;
        }

        if (dbControlConfig.autoFailoverEnabled) {
          const snap = readSqliteSnapshot();
          if (snap) {
            recordFailoverEvent('firestore-rest', 'sqlite-replica', 'Automatic failover on Firestore timeout');
            await setCached(cacheKey, snap, Math.min(ttlMs, 30_000));
            return snap;
          }
        }

        return {
          products: [],
          coupons: [],
          serviceAreas: [],
          deliverySlots: [],
          settings: null,
          source: 'sqlite-replica',
          generatedAt: new Date().toISOString()
        };
      } finally {
        inFlightCatalogPromise = null;
      }
    })();

    return inFlightCatalogPromise;
  };

  const invalidateCatalogCache = async (): Promise<void> => {
    inFlightCatalogPromise = null;
    slotsCacheVersion += 1;
    for (const k of l1Cache.keys()) {
      if (k.startsWith('slots_')) {
        l1Cache.delete(k);
      }
    }
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
          total = excluded.total,
          item_count = excluded.item_count,
          payment_method = excluded.payment_method,
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

    if (supabase && dbControlConfig.archivalSyncEnabled) {
      const sStart = performance.now();
      void (async () => {
        try {
          const { error, status } = await supabase.from('order_archive').upsert(
            {
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
            },
            { onConflict: 'id' }
          );
          recordApiUsage('cloud-supabase-postgres', {
            latencyMs: performance.now() - sStart,
            statusCode: error ? 500 : 200
          });
          if (error) {
            supabaseLastError = formatSupabaseError(error.message, error.code, status);
          } else {
            supabaseLastError = null;
            supabaseLastSyncAt = new Date().toISOString();
          }
        } catch (err) {
          supabaseLastError = err instanceof Error ? err.message : 'Supabase upsert failed';
          recordApiUsage('cloud-supabase-postgres', {
            latencyMs: performance.now() - sStart,
            statusCode: 503
          });
        }
      })();
    }
  };

  const deleteOrderHistoryRecords = async (input: DeleteOrderHistoryInput): Promise<{
    ok: boolean;
    deletedOrderArchiveRows: number;
    deletedLedgerArchiveRows: number;
    deletedProofFiles: number;
    supabaseDeletedRows: number;
    supabaseError: string | null;
  }> => {
    const cleanIds = Array.from(
      new Set(
        (Array.isArray(input.orderIds) ? input.orderIds : [])
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id))
      )
    ).slice(0, 2000);

    const deleteLedger = Boolean(input.deleteLedgerEntries);
    let deletedOrderArchiveRows = 0;
    let deletedLedgerArchiveRows = 0;

    if (cleanIds.length > 0) {
      const tx = sqlite.transaction((ids: string[]) => {
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const placeholders = chunk.map(() => '?').join(',');
          const orderRes = sqlite
            .prepare(`DELETE FROM order_archive WHERE id IN (${placeholders})`)
            .run(...chunk);
          deletedOrderArchiveRows += orderRes.changes;
          if (deleteLedger) {
            const ledgerRes = sqlite
              .prepare(`DELETE FROM wallet_ledger_archive WHERE order_id IN (${placeholders})`)
              .run(...chunk);
            deletedLedgerArchiveRows += ledgerRes.changes;
          }
        }
      });
      tx(cleanIds);
    }

    let supabaseDeletedRows = 0;
    let supabaseError: string | null = null;
    if (cleanIds.length > 0 && supabase && dbControlConfig.archivalSyncEnabled) {
      const sStart = performance.now();
      try {
        for (let i = 0; i < cleanIds.length; i += 200) {
          const chunk = cleanIds.slice(i, i + 200);
          const { error, count } = await supabase
            .from('order_archive')
            .delete({ count: 'exact' })
            .in('id', chunk);
          if (error) {
            supabaseError = formatSupabaseError(error.message, error.code);
          } else {
            supabaseDeletedRows += count || 0;
          }
          if (deleteLedger) {
            const { error: ledErr } = await supabase
              .from('wallet_ledger_archive')
              .delete()
              .in('order_id', chunk);
            if (ledErr && !supabaseError) {
              supabaseError = formatSupabaseError(ledErr.message, ledErr.code);
            }
          }
        }
        recordApiUsage('cloud-supabase-postgres', {
          latencyMs: performance.now() - sStart,
          statusCode: supabaseError ? 500 : 200
        });
      } catch (err) {
        supabaseError = err instanceof Error ? err.message : 'Supabase delete failed';
        recordApiUsage('cloud-supabase-postgres', {
          latencyMs: performance.now() - sStart,
          statusCode: 503
        });
      }
    }

    let deletedProofFiles = 0;
    const rawProofUrls = Array.isArray(input.proofImageUrls) ? input.proofImageUrls.slice(0, 500) : [];
    const baseUploadsDir = path.resolve(uploadsDir) + path.sep;
    for (const rawUrl of rawProofUrls) {
      if (typeof rawUrl !== 'string' || !rawUrl.includes('/uploads/proof_')) continue;
      const cleanedPath = rawUrl.split('?')[0];
      const fileName = path.posix.basename(cleanedPath);
      if (!/^proof_[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(fileName)) continue;
      const resolvedFile = path.resolve(uploadsDir, fileName);
      if (!resolvedFile.startsWith(baseUploadsDir)) continue;
      try {
        if (fs.existsSync(resolvedFile)) {
          await fs.promises.unlink(resolvedFile);
          deletedProofFiles += 1;
        }
      } catch {
        // non-fatal file unlink error
      }
    }

    return {
      ok: true,
      deletedOrderArchiveRows,
      deletedLedgerArchiveRows,
      deletedProofFiles,
      supabaseDeletedRows,
      supabaseError
    };
  };

  const archiveLedgerEntry = async (entry: ArchiveLedgerPayload): Promise<void> => {
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO wallet_ledger_archive (id, partner_uid, order_id, type, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.partnerUid, entry.orderId, entry.type, Math.round(entry.amount), now);

    if (supabase && dbControlConfig.archivalSyncEnabled) {
      const sStart = performance.now();
      void (async () => {
        try {
          const { error, status } = await supabase.from('wallet_ledger_archive').upsert(
            {
              id: entry.id,
              partner_uid: entry.partnerUid,
              order_id: entry.orderId,
              type: entry.type,
              amount: Math.round(entry.amount),
              created_at: now
            },
            { onConflict: 'id', ignoreDuplicates: true }
          );
          recordApiUsage('cloud-supabase-postgres', {
            latencyMs: performance.now() - sStart,
            statusCode: error ? 500 : 200
          });
          if (error) {
            supabaseLastError = formatSupabaseError(error.message, error.code, status);
          } else {
            supabaseLastError = null;
            supabaseLastSyncAt = new Date().toISOString();
          }
        } catch (err) {
          supabaseLastError = err instanceof Error ? err.message : 'Supabase ledger upsert failed';
          recordApiUsage('cloud-supabase-postgres', {
            latencyMs: performance.now() - sStart,
            statusCode: 503
          });
        }
      })();
    }
  };

  // Backfill historical Firestore orders & wallet ledger into SQLite WAL when an admin triggers sync
  const backfillFirestoreToSqlite = async (adminIdToken: string): Promise<void> => {
    const projectId = firebaseMeta.projectId;
    const databaseId = firebaseMeta.firestoreDatabaseId || '(default)';
    if (!projectId || !adminIdToken) return;

    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents`;
    const apiKeyParam = firebaseMeta.apiKey ? `?key=${encodeURIComponent(firebaseMeta.apiKey)}` : '';

    try {
      const [ordersRes, ledgerRes] = await Promise.all([
        fetch(`${base}/orders${apiKeyParam}${apiKeyParam ? '&' : '?'}pageSize=500`, {
          headers: { Authorization: `Bearer ${adminIdToken}` },
          signal: AbortSignal.timeout(6000)
        }),
        fetch(`${base}/walletLedger${apiKeyParam}${apiKeyParam ? '&' : '?'}pageSize=500`, {
          headers: { Authorization: `Bearer ${adminIdToken}` },
          signal: AbortSignal.timeout(6000)
        })
      ]);

      const upsertOrderStmt = sqlite.prepare(`
        INSERT INTO order_archive
          (id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          city = excluded.city,
          total = excluded.total,
          item_count = excluded.item_count,
          payment_method = excluded.payment_method,
          order_date = excluded.order_date,
          status = excluded.status,
          payment_status = excluded.payment_status,
          assigned_to_uid = excluded.assigned_to_uid,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= order_archive.updated_at
      `);

      const upsertLedgerStmt = sqlite.prepare(`
        INSERT OR IGNORE INTO wallet_ledger_archive
          (id, partner_uid, order_id, type, amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const orderDocs: Array<Record<string, unknown>> = [];
      if (ordersRes.ok) {
        const data = (await ordersRes.json()) as {
          documents?: Array<{ name?: string; fields?: Record<string, unknown> }>;
        };
        if (Array.isArray(data.documents)) {
          for (const doc of data.documents) {
            orderDocs.push(decodeFirestoreDoc(doc));
          }
        }
      }

      const ledgerDocs: Array<Record<string, unknown>> = [];
      if (ledgerRes.ok) {
        const data = (await ledgerRes.json()) as {
          documents?: Array<{ name?: string; fields?: Record<string, unknown> }>;
        };
        if (Array.isArray(data.documents)) {
          for (const doc of data.documents) {
            ledgerDocs.push(decodeFirestoreDoc(doc));
          }
        }
      }

      if (orderDocs.length > 0 || ledgerDocs.length > 0) {
        const now = Date.now();
        const tx = sqlite.transaction(() => {
          for (const o of orderDocs) {
            const oid = String(o.id || o.__docId || '').trim();
            const uid = String(o.userId || '').trim();
            if (!oid || !uid) continue;
            const addr = (o.address && typeof o.address === 'object' ? o.address : {}) as Record<string, unknown>;
            const items = Array.isArray(o.items) ? o.items : [];
            const dateStr = String(o.date || o.createdAt || new Date().toISOString());
            const ts = Date.parse(dateStr);
            upsertOrderStmt.run(
              oid,
              uid,
              String(addr.city || o.city || ''),
              Math.round(Number(o.total || 0)),
              String(o.status || 'placed'),
              String(o.paymentMethod || 'cod'),
              String(o.paymentStatus || 'pending'),
              String(o.assignedToUid || ''),
              items.length,
              dateStr,
              Number.isFinite(ts) ? ts : now
            );
          }
          for (const l of ledgerDocs) {
            const lid = String(l.id || l.__docId || '').trim();
            const puid = String(l.partnerUid || '').trim();
            if (!lid || !puid) continue;
            const ts = typeof l.createdAt === 'string' ? Date.parse(l.createdAt) : Number(l.createdAt || now);
            upsertLedgerStmt.run(
              lid,
              puid,
              String(l.orderId || ''),
              String(l.type || 'trip_credit'),
              Math.round(Number(l.amount || 0)),
              Number.isFinite(ts) ? ts : now
            );
          }
        });
        tx();
      }
    } catch {
      // non-blocking backfill
    }
  };

  // Bidirectional sync between local SQLite WAL and Supabase PostgreSQL
  const syncBidirectionalWithSupabase = async (adminIdToken?: string): Promise<{
    ok: boolean;
    pushedOrders: number;
    pushedLedger: number;
    pulledOrders: number;
    pulledLedger: number;
    error?: string;
  }> => {
    if (!supabase) {
      return {
        ok: false,
        pushedOrders: 0,
        pushedLedger: 0,
        pulledOrders: 0,
        pulledLedger: 0,
        error:
          supabaseConfigWarning ||
          'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      };
    }

    const sStart = performance.now();
    try {
      if (adminIdToken) {
        await backfillFirestoreToSqlite(adminIdToken);
      }

      const localOrders = sqlite
        .prepare(
          `SELECT id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at
           FROM order_archive
           LIMIT 1000`
        )
        .all() as Array<Record<string, unknown>>;

      const localLedger = sqlite
        .prepare(
          `SELECT id, partner_uid, order_id, type, amount, created_at
           FROM wallet_ledger_archive
           LIMIT 1000`
        )
        .all() as Array<Record<string, unknown>>;

      const localSnapRow = sqlite
        .prepare('SELECT id, payload, updated_at FROM catalog_snapshot WHERE id = ?')
        .get('storefront') as { id?: string; payload?: string; updated_at?: number } | undefined;

      if (localOrders.length > 0) {
        const { error, status } = await supabase
          .from('order_archive')
          .upsert(localOrders, { onConflict: 'id' });
        if (error) throw new Error(formatSupabaseError(error.message, error.code, status));
      }

      if (localLedger.length > 0) {
        const { error, status } = await supabase
          .from('wallet_ledger_archive')
          .upsert(localLedger, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw new Error(formatSupabaseError(error.message, error.code, status));
      }

      if (localSnapRow?.payload) {
        let parsedSnap: unknown = null;
        try {
          parsedSnap = JSON.parse(localSnapRow.payload);
        } catch {
          parsedSnap = null;
        }
        if (parsedSnap) {
          const { error, status } = await supabase.from('catalog_snapshot').upsert(
            {
              id: 'storefront',
              payload: parsedSnap,
              updated_at: Number(localSnapRow.updated_at || Date.now())
            },
            { onConflict: 'id' }
          );
          if (error) throw new Error(formatSupabaseError(error.message, error.code, status));
        }
      }

      const [remoteOrdersRes, remoteLedgerRes] = await Promise.all([
        supabase
          .from('order_archive')
          .select('id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at')
          .order('updated_at', { ascending: false })
          .limit(1000),
        supabase
          .from('wallet_ledger_archive')
          .select('id, partner_uid, order_id, type, amount, created_at')
          .order('created_at', { ascending: false })
          .limit(1000)
      ]);

      if (remoteOrdersRes.error) {
        throw new Error(
          formatSupabaseError(
            remoteOrdersRes.error.message,
            remoteOrdersRes.error.code,
            remoteOrdersRes.status
          )
        );
      }
      if (remoteLedgerRes.error) {
        throw new Error(
          formatSupabaseError(
            remoteLedgerRes.error.message,
            remoteLedgerRes.error.code,
            remoteLedgerRes.status
          )
        );
      }

      const remoteOrders = remoteOrdersRes.data || [];
      const remoteLedger = remoteLedgerRes.data || [];

      const upsertOrderStmt = sqlite.prepare(`
        INSERT INTO order_archive
          (id, user_id, city, total, status, payment_method, payment_status, assigned_to_uid, item_count, order_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          city = excluded.city,
          total = excluded.total,
          item_count = excluded.item_count,
          payment_method = excluded.payment_method,
          order_date = excluded.order_date,
          status = excluded.status,
          payment_status = excluded.payment_status,
          assigned_to_uid = excluded.assigned_to_uid,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= order_archive.updated_at
      `);

      const upsertLedgerStmt = sqlite.prepare(`
        INSERT OR IGNORE INTO wallet_ledger_archive
          (id, partner_uid, order_id, type, amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const tx = sqlite.transaction(() => {
        for (const o of remoteOrders) {
          upsertOrderStmt.run(
            String(o.id),
            String(o.user_id || ''),
            String(o.city || ''),
            Number(o.total || 0),
            String(o.status || 'placed'),
            String(o.payment_method || 'cod'),
            String(o.payment_status || 'pending'),
            String(o.assigned_to_uid || ''),
            Number(o.item_count || 0),
            String(o.order_date || ''),
            Number(o.updated_at || Date.now())
          );
        }
        for (const l of remoteLedger) {
          upsertLedgerStmt.run(
            String(l.id),
            String(l.partner_uid || ''),
            String(l.order_id || ''),
            String(l.type || 'trip_credit'),
            Number(l.amount || 0),
            Number(l.created_at || Date.now())
          );
        }
      });
      tx();

      recordApiUsage('cloud-supabase-postgres', {
        latencyMs: performance.now() - sStart,
        statusCode: 200
      });
      supabaseLastError = null;
      supabaseLastSyncAt = new Date().toISOString();

      return {
        ok: true,
        pushedOrders: localOrders.length,
        pushedLedger: localLedger.length,
        pulledOrders: remoteOrders.length,
        pulledLedger: remoteLedger.length
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Supabase sync failed';
      supabaseLastError = msg;
      recordApiUsage('cloud-supabase-postgres', {
        latencyMs: performance.now() - sStart,
        statusCode: 500
      });
      return {
        ok: false,
        pushedOrders: 0,
        pushedLedger: 0,
        pulledOrders: 0,
        pulledLedger: 0,
        error: msg
      };
    }
  };

  // Auto-hydrate cold container SQLite WAL from Supabase Postgres archive on boot
  if (supabase) {
    try {
      const localCount = Number(
        (sqlite.prepare('SELECT COUNT(*) AS c FROM order_archive').get() as { c?: number })?.c || 0
      );
      if (localCount === 0) {
        void syncBidirectionalWithSupabase();
      }
    } catch {
      // non-fatal
    }
  }

  const getSqlAnalyticsSummary = (): SqlAnalyticsSummary => {
    let totals: {
      totalOrders?: number;
      deliveredOrders?: number;
      cancelledOrders?: number;
      grossRevenue?: number;
      codRevenue?: number;
      upiRevenue?: number;
    } = {};
    let ledgerSum: { totalPayouts?: number } = {};
    let topCities: Array<{ city: string; orderCount: number; revenue: number }> = [];

    try {
      totals =
        (sqlite
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
          .get() as typeof totals) || {};

      ledgerSum =
        (sqlite
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN type = 'trip_credit' THEN amount ELSE 0 END), 0) AS totalPayouts
             FROM wallet_ledger_archive`
          )
          .get() as typeof ledgerSum) || {};

      topCities = sqlite
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
    } catch {
      // Fall back to empty summary instead of throwing HTTP 500
    }

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

    const safeCount = (tableName: string): number => {
      try {
        return Number(
          (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get() as { c?: number })?.c || 0
        );
      } catch {
        return 0;
      }
    };

    const catalogRows = safeCount('catalog_snapshot');
    const orderRows = safeCount('order_archive');
    const ledgerRows = safeCount('wallet_ledger_archive');
    const cfgRows = safeCount('cloud_control_config');
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
      statusNote: sqliteRecoveredReason ? `Auto-rebuilt clean WAL replica (${sqliteRecoveredReason})` : null,
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
    let supaStatus: 'connected' | 'degraded' | 'standby' = supabase
      ? 'degraded'
      : supabaseConfigWarning
      ? 'degraded'
      : 'standby';
    let supaLatency: number | null = null;
    let supaOrderRows: number | null = null;
    let supaLedgerRows: number | null = null;
    let supaNote: string | null = supabaseConfigWarning || supabaseLastError;

    if (supabase) {
      const sStart = performance.now();
      try {
        const [ordersProbe, ledgerProbe, catalogProbe] = await Promise.all([
          supabase.from('order_archive').select('id', { count: 'exact', head: true }),
          supabase.from('wallet_ledger_archive').select('id', { count: 'exact', head: true }),
          supabase.from('catalog_snapshot').select('id', { count: 'exact', head: true })
        ]);
        supaLatency = Math.round(performance.now() - sStart);
        const firstProbeErr = ordersProbe.error || ledgerProbe.error || catalogProbe.error;
        const firstProbeStatus = ordersProbe.error
          ? ordersProbe.status
          : ledgerProbe.error
          ? ledgerProbe.status
          : catalogProbe.status;
        recordApiUsage('cloud-supabase-postgres', {
          latencyMs: supaLatency,
          statusCode: firstProbeErr ? 500 : 200
        });
        if (!firstProbeErr) {
          supaOrderRows = typeof ordersProbe.count === 'number' ? ordersProbe.count : 0;
          supaLedgerRows = typeof ledgerProbe.count === 'number' ? ledgerProbe.count : 0;
          if (supabaseLastError && !supabaseLastError.includes('tables')) {
            // Preserve recent write/RLS error until resolved by a successful sync
            supaStatus = 'degraded';
            supaNote = supabaseLastError;
          } else {
            supaStatus = 'connected';
            supaNote = null;
            supabaseLastError = null;
          }
        } else {
          supaNote = formatSupabaseError(
            firstProbeErr.message || '',
            firstProbeErr.code,
            firstProbeStatus
          );
          supabaseLastError = supaNote;
        }
      } catch (err) {
        supaLatency = Math.round(performance.now() - sStart);
        supaStatus = 'degraded';
        supaNote = err instanceof Error ? err.message : 'Unable to reach Supabase PostgREST API.';
        supabaseLastError = supaNote;
      }
    }

    const supaTotalRows =
      supaOrderRows !== null ? supaOrderRows + (supaLedgerRows || 0) : null;

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
      recordCount: supaTotalRows,
      usageLabel: hasSupabase
        ? supaTotalRows !== null
          ? `${supaOrderRows} orders + ${supaLedgerRows} ledger rows`
          : 'Probe failed — check note below'
        : 'Standby (Set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY in .env)',
      balanceLabel: '500.00 MB Postgres Free Tier',
      statusNote: supaNote,
      details: {
        configured: hasSupabase,
        archivalSyncEnabled: dbControlConfig.archivalSyncEnabled,
        endpoint: hasSupabase ? supabaseUrl : 'Not configured',
        lastSyncAt: supabaseLastSyncAt || 'Not synced yet'
      }
    });

    // 4. Upstash Redis L2 Cache
    let upStatus: 'connected' | 'degraded' | 'standby' = upstashRedis
      ? 'degraded'
      : upstashConfigWarning
      ? 'degraded'
      : 'standby';
    let upLatency: number | null = null;
    let upKeyCount: number | null = null;
    let upNote: string | null = upstashConfigWarning || upstashLastError;

    if (upstashRedis) {
      const uStart = performance.now();
      try {
        const [, dbSize] = await Promise.all([upstashRedis.ping(), upstashRedis.dbsize()]);
        upLatency = Math.round(performance.now() - uStart);
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: upLatency,
          statusCode: 200
        });
        if (Number.isFinite(Number(dbSize))) {
          upStatus = 'connected';
          upKeyCount = Number(dbSize);
          upNote = null;
          upstashLastError = null;
        }
      } catch (err) {
        upLatency = Math.round(performance.now() - uStart);
        const msg = err instanceof Error ? err.message : 'Upstash probe failed';
        upNote =
          msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('wrongpass')
            ? 'Upstash rejected token. Copy UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN from Upstash Console → REST API.'
            : msg;
        upstashLastError = upNote;
        recordApiUsage('cloud-upstash-redis', {
          latencyMs: upLatency,
          statusCode: 503
        });
      }
    }

    entries.push({
      id: 'upstash',
      name: 'Upstash Redis L2 Cache',
      role: 'Distributed Catalog Cache & Sliding-Window Rate Limiter',
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
          : 'Probe failed — check note below'
        : `Standby — L1 Memory Cache active (${l1Cache.size} entries)`,
      balanceLabel: '256.00 MB / 500K Monthly Commands Free Tier',
      statusNote: upNote,
      details: {
        configured: hasUpstash,
        endpoint: hasUpstash ? upstashUrl : 'Not configured',
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

  const runDatabaseAction = async (action: string, adminIdToken?: string) => {
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
      if (upstashRedis) {
        try {
          await upstashRedis.del('catalog:bootstrap:v1');
          upstashLastError = null;
        } catch (err) {
          upstashLastError = err instanceof Error ? err.message : 'Upstash DEL failed';
        }
      }
      return {
        ok: true,
        action,
        message: `Purged ${clearedL1} L1 memory cache entries${upstashRedis ? ' and Upstash catalog key' : ''}.`
      };
    }

    if (action === 'sync-supabase') {
      const result = await syncBidirectionalWithSupabase(adminIdToken);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error || 'Supabase bidirectional sync failed.'
        };
      }
      return {
        ok: true,
        action,
        message: `Synced with Supabase Postgres: pushed ${result.pushedOrders} orders / ${result.pushedLedger} ledger rows, pulled ${result.pulledOrders} orders / ${result.pulledLedger} ledger rows.`,
        ...result
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
    flushPendingApiUsage();
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
      },
      {
        id: 'cloud-upstash-redis',
        group: 'Connected Cloud APIs',
        method: 'POST',
        path: upstashParsed ? `Upstash Redis REST (${upstashParsed.hostname})` : 'Upstash Redis REST (Standby)',
        targetUrl: upstashUrl || '',
        auth: 'UPSTASH_REDIS_REST_TOKEN',
        rateLimit: '500K commands / month (Free Tier)',
        perMinLimit: null as number | null,
        dailyQuota: quotas.upstashDailyQuota as number | null,
        cacheTtl: `${ttls.catalogTtlSeconds}s L2 TTL`,
        description: 'Distributed L2 catalog cache and sliding-window API rate limiter.'
      },
      {
        id: 'cloud-supabase-postgres',
        group: 'Connected Cloud APIs',
        method: 'POST',
        path: supabaseParsed ? `Supabase PostgREST (${supabaseParsed.hostname})` : 'Supabase PostgreSQL (Standby)',
        targetUrl: supabaseUrl || '',
        auth: 'SUPABASE_SERVICE_ROLE_KEY',
        rateLimit: '500 MB DB / Unlimited API Requests',
        perMinLimit: null as number | null,
        dailyQuota: quotas.serverDailyQuota as number | null,
        cacheTtl: 'Persistent Relational SQL',
        description: 'Long-term PostgreSQL archival warehouse for order_archive and wallet_ledger_archive.'
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

    const isUnlimited = serverControlConfig.unlimitedFreeMode !== false;

    const nodeQuotas = serverControlConfig.serverNodes.map((node) => {
      const tierLabel = node.tier === 'primary' || node.role === 'primary' ? 'Primary' : 'Backup';
      const isPrimarySlot1 = node.id === 'primary-server-1' || node.id === 'origin-primary';
      const usedToday = isPrimarySlot1 ? serverRequestsUsedToday : 0;

      if (isUnlimited || node.freeUnlimited) {
        return {
          nodeId: node.id,
          label: node.label,
          role: node.role,
          tier: tierLabel.toLowerCase(),
          enabled: node.enabled,
          isUnlimited: true,
          quotaTier: `${tierLabel} Server • Free & Unlimited`,
          dailyQuota: quotas.serverDailyQuota,
          usedToday,
          remainingToday: Math.max(0, quotas.serverDailyQuota - usedToday)
        };
      }

      if (node.role === 'edge-worker') {
        const edgeDailyQuota = 100000;
        return {
          nodeId: node.id,
          label: node.label,
          role: node.role,
          tier: 'backup',
          enabled: node.enabled,
          isUnlimited: false,
          quotaTier: 'Cloudflare Workers Free Tier',
          dailyQuota: edgeDailyQuota,
          usedToday: 0,
          remainingToday: edgeDailyQuota
        };
      }
      return {
        nodeId: node.id,
        label: node.label,
        role: node.role,
        tier: tierLabel.toLowerCase(),
        enabled: node.enabled,
        isUnlimited: false,
        quotaTier:
          isPrimarySlot1 ? 'Primary Express Daily Budget' : 'Replica Origin Budget',
        dailyQuota: quotas.serverDailyQuota,
        usedToday,
        remainingToday: Math.max(0, quotas.serverDailyQuota - usedToday)
      };
    });

    const primaryCount = serverControlConfig.serverNodes.filter(
      (n) => n.enabled && (n.role === 'primary' || n.tier === 'primary')
    ).length;
    const backupCount = serverControlConfig.serverNodes.filter(
      (n) => n.enabled && n.role !== 'primary' && n.tier !== 'primary'
    ).length;

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
        replicaId: process.env.REPLICA_ID || 'node-1',
        region: process.env.SERVER_REGION || 'asia-southeast1',
        cloudflareWorkerTemplate: 'cloudflare/worker.js',
        dayKey,
        quotaResetInSeconds,
        clusterSummary: {
          architecture: `${primaryCount} Primary + ${backupCount} Backup HA Cluster`,
          primaryServers: primaryCount,
          backupServers: backupCount,
          freeAndUnlimited: isUnlimited,
          autoServerFailover: serverControlConfig.autoServerFailover
        }
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
        unlimitedFreeMode: isUnlimited,
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

    if (target === 'cloud-upstash-redis') {
      if (!upstashRedis) {
        return {
          ok: false,
          status: 400,
          latencyMs: 0,
          error: upstashConfigWarning || 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set.'
        };
      }
      const start = performance.now();
      try {
        const pong = await upstashRedis.ping();
        const latencyMs = Math.round(performance.now() - start);
        recordApiUsage('cloud-upstash-redis', { latencyMs, statusCode: 200 });
        upstashLastError = null;
        return {
          ok: true,
          status: 200,
          latencyMs,
          cacheHeader: `PING=${String(pong)}`
        };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        const msg = err instanceof Error ? err.message : 'Upstash ping failed';
        upstashLastError = msg;
        recordApiUsage('cloud-upstash-redis', { latencyMs, statusCode: 503 });
        return {
          ok: false,
          status: 503,
          latencyMs,
          error: msg
        };
      }
    }

    if (target === 'cloud-supabase-postgres') {
      if (!supabase) {
        return {
          ok: false,
          status: 400,
          latencyMs: 0,
          error: supabaseConfigWarning || 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.'
        };
      }
      const start = performance.now();
      try {
        const { error, count } = await supabase
          .from('order_archive')
          .select('id', { count: 'exact', head: true });
        const latencyMs = Math.round(performance.now() - start);
        recordApiUsage('cloud-supabase-postgres', {
          latencyMs,
          statusCode: error ? 500 : 200
        });
        if (error) {
          supabaseLastError = error.message;
          return {
            ok: false,
            status: 500,
            latencyMs,
            error: error.message
          };
        }
        supabaseLastError = null;
        return {
          ok: true,
          status: 200,
          latencyMs,
          cacheHeader: `order_archive=${count ?? 0}`
        };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        const msg = err instanceof Error ? err.message : 'Supabase probe failed';
        supabaseLastError = msg;
        recordApiUsage('cloud-supabase-postgres', { latencyMs, statusCode: 503 });
        return {
          ok: false,
          status: 503,
          latencyMs,
          error: msg
        };
      }
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

  const maintenance = createMaintenanceDiagnostics({
    rootDir,
    uploadsDir,
    sqlite,
    sqlitePath,
    l1Cache,
    rateBuckets,
    upstashRedis,
    upstashConfigWarning,
    supabase,
    supabaseConfigWarning,
    firebaseMeta,
    getDbControlConfig,
    getServerControlConfig,
    updateServerControlConfig,
    invalidateCatalogCache,
    fetchPublicCatalogFromFirestore,
    getDatabasesReport,
    readControlJson,
    writeControlJson
  });

  if (sqliteRecoveredReason) {
    try {
      maintenance.recordDiagnosticEvent({
        platform: 'server',
        severity: 'warning',
        category: 'sqlite_auto_heal',
        message: `Auto-recovered corrupted SQLite WAL replica cleanly on boot (${sqliteRecoveredReason})`,
        resolved: true,
        autoHealed: true
      });
    } catch {
      // non-fatal
    }
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(telemetryFlushTimer);
    maintenance.stopScheduler();
    flushPendingApiUsage();
    try {
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore checkpoint failure during shutdown
    }
    try {
      sqlite.close();
    } catch {
      // ignore close failure
    }
  };

  return {
    uploadsDir,
    maintenance,
    close,
    getCached,
    setCached,
    invalidateCatalogCache,
    getSlotsCacheVersion,
    checkRateLimit,
    getCatalogBootstrap,
    archiveOrder,
    archiveLedgerEntry,
    deleteOrderHistoryRecords,
    getSqlAnalyticsSummary,
    uploadMediaObject,
    verifyFirebaseAdminToken,
    verifyFirebaseUserToken,
    getVapidPublicKey,
    issueDevicePushToken,
    verifyDevicePushToken,
    upsertPushSubscription,
    removePushSubscription,
    getUserPushSubscriptionCount,
    getPendingPushEvents,
    sendWebPush,
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
    getDiagnostics: () => {
      const enabledNodes = serverControlConfig.serverNodes.filter((n) => n.enabled);
      const primaryCount = enabledNodes.filter((n) => n.role === 'primary' || n.tier === 'primary').length;
      const backupCount = enabledNodes.filter((n) => n.role !== 'primary' && n.tier !== 'primary').length;
      return {
        replicaId: process.env.REPLICA_ID || 'node-1',
        region: process.env.SERVER_REGION || 'asia-southeast1',
        cluster: {
          architecture: `${primaryCount} Primary + ${backupCount} Backup HA Failover`,
          primaryServers: primaryCount,
          backupServers: backupCount,
          freeAndUnlimited: serverControlConfig.unlimitedFreeMode !== false,
          autoServerFailover: serverControlConfig.autoServerFailover,
          nodes: enabledNodes.map((n) => ({
            id: n.id,
            label: n.label,
            role: n.tier || (n.role === 'primary' ? 'primary' : 'backup'),
            priority: n.priority
          }))
        },
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
      };
    }
  };
}
