import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

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

  // L1 Memory LRU + TTL Cache
  const l1Cache = new Map<string, CacheEntry<unknown>>();
  const rateBuckets = new Map<string, RateBucket>();
  const cacheStats = { l1Hits: 0, l2Hits: 0, misses: 0 };

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
    const l1 = getL1<T>(key);
    if (l1 !== null) {
      cacheStats.l1Hits += 1;
      return { value: l1, tier: 'l1' };
    }

    if (hasUpstash) {
      const raw = await upstashCommand(['GET', key]);
      if (typeof raw === 'string' && raw) {
        try {
          const parsed = JSON.parse(raw) as T;
          setL1(key, parsed, 30_000);
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
    setL1(key, value, ttlMs);
    if (hasUpstash) {
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

    if (hasUpstash) {
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

  // Read-Through Public Storefront Catalog from Cloud Firestore v1 REST API
  const fetchPublicCatalogFromFirestore = async (): Promise<CatalogBootstrapPayload | null> => {
    const projectId = firebaseMeta.projectId;
    const databaseId = firebaseMeta.firestoreDatabaseId || '(default)';
    if (!projectId) return null;

    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents`;
    const apiKeyParam = firebaseMeta.apiKey ? `?key=${encodeURIComponent(firebaseMeta.apiKey)}` : '';

    try {
      const [prodRes, couponRes, settingsRes] = await Promise.all([
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
          signal: AbortSignal.timeout(3500)
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
          signal: AbortSignal.timeout(3500)
        }),
        fetch(`${base}/settings/store${apiKeyParam}`, {
          signal: AbortSignal.timeout(3500)
        })
      ]);

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

  const getCatalogBootstrap = async (): Promise<CatalogBootstrapPayload> => {
    const cacheKey = 'catalog:bootstrap:v1';
    const cached = await getCached<CatalogBootstrapPayload>(cacheKey);
    if (cached) {
      return {
        ...cached.value,
        source: cached.tier === 'l2' ? 'upstash-l2' : 'memory-l1'
      };
    }

    const fresh = await fetchPublicCatalogFromFirestore();
    if (fresh) {
      await setCached(cacheKey, fresh, 120_000);
      return fresh;
    }

    // Fallback to SQLite WAL replica if Firestore REST is temporarily unreachable
    try {
      const row = sqlite
        .prepare('SELECT payload FROM catalog_snapshot WHERE id = ?')
        .get('storefront') as { payload?: string } | undefined;
      if (row?.payload) {
        const parsed = JSON.parse(row.payload) as CatalogBootstrapPayload;
        return { ...parsed, source: 'sqlite-replica' };
      }
    } catch {
      // ignore
    }

    return {
      products: [],
      coupons: [],
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

    if (hasSupabase) {
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

    if (hasSupabase) {
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
      databaseEngine: hasSupabase ? 'SQLite WAL + Supabase PostgreSQL' : 'SQLite WAL Edge Replica',
      supabaseSynced: hasSupabase
    };
  };

  // Upload media to Cloudflare R2 (SigV4 S3 PUT) if configured, else persistent local /uploads store
  const uploadMediaObject = async (
    buffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<{ url: string; storageBackend: string }> => {
    if (hasR2) {
      try {
        const parsed = new URL(`${r2Endpoint}/${r2Bucket}/${fileName}`);
        const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const dateStamp = amzDate.slice(0, 8);
        const region = 'auto';
        const service = 's3';
        const payloadHash = sha256Hex(buffer);

        const canonicalHeaders =
          `host:${parsed.host}\n` +
          `x-amz-content-sha256:${payloadHash}\n` +
          `x-amz-date:${amzDate}\n`;
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
        const canonicalRequest = [
          'PUT',
          parsed.pathname,
          '',
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
        const signature = crypto
          .createHmac('sha256', kSigning)
          .update(stringToSign)
          .digest('hex');

        const authorization =
          `AWS4-HMAC-SHA256 Credential=${r2AccessKey}/${credentialScope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const putRes = await fetch(parsed.toString(), {
          method: 'PUT',
          headers: {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            Authorization: authorization
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
        console.warn('Cloudflare R2 upload fallback to Express static store:', err);
      }
    }

    const targetPath = path.join(uploadsDir, fileName);
    await fs.promises.writeFile(targetPath, buffer);
    return {
      url: `/uploads/${fileName}`,
      storageBackend: 'Express Static Media Store'
    };
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
    getDiagnostics: () => ({
      replicaId: process.env.REPLICA_ID || 'node-primary',
      region: process.env.SERVER_REGION || 'asia-southeast1',
      caches: {
        l1Entries: l1Cache.size,
        l2Provider: hasUpstash ? 'Upstash Redis REST' : 'Disabled (L1 Active)',
        l1Hits: cacheStats.l1Hits,
        l2Hits: cacheStats.l2Hits,
        misses: cacheStats.misses
      },
      databases: {
        realtimePrimary: 'Google Cloud Firestore (Enterprise Edition)',
        edgeReplica: 'SQLite WAL (better-sqlite3)',
        relationalArchive: hasSupabase ? 'Supabase PostgreSQL (PostgREST)' : 'Local SQLite WAL Mirror'
      },
      objectStorage: hasR2 ? 'Cloudflare R2 + Local Static Fallback' : 'Express Static Media Store'
    })
  };
}
