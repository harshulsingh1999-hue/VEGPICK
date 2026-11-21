/**
 * Client-side Multi-Server Failover & Non-Blocking Cloud Sync Utilities
 * Supports both build-time VITE_API_SERVERS and live Admin Server Control Center failover nodes.
 */

const configuredServers = (
  (import.meta.env.VITE_API_SERVERS as string | undefined) || ''
)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const RUNTIME_ORIGINS_KEY = 'freshveggie_runtime_origins_v1';

const loadRuntimeOrigins = (): string[] => {
  try {
    const raw = localStorage.getItem(RUNTIME_ORIGINS_KEY);
    if (!raw) return ['', ...configuredServers.filter((s) => s !== '')];
    const parsed = JSON.parse(raw) as string[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore storage errors
  }
  return ['', ...configuredServers.filter((s) => s !== '')];
};

let activeApiBases: string[] = loadRuntimeOrigins();
let autoFailoverEnabled = true;

export function syncRuntimeServerNodes(
  nodes: Array<{ url: string; enabled: boolean }>,
  autoFailover = true
): void {
  autoFailoverEnabled = autoFailover;
  const normalized = nodes
    .filter((n) => n.enabled)
    .map((n) => (n.url || '').trim().replace(/\/+$/, ''));
  const merged = Array.from(new Set([...normalized, ...configuredServers]));
  activeApiBases = merged.length > 0 ? merged : [''];
  try {
    localStorage.setItem(RUNTIME_ORIGINS_KEY, JSON.stringify(activeApiBases));
  } catch {
    // ignore
  }
}

export async function refreshRuntimeServerNodes(): Promise<void> {
  try {
    const res = await fetch('/api/public/runtime-config', {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      autoServerFailover?: boolean;
      serverNodes?: Array<{ url: string; enabled: boolean }>;
    };
    if (Array.isArray(data.serverNodes)) {
      syncRuntimeServerNodes(data.serverNodes, data.autoServerFailover !== false);
    }
  } catch {
    // non-fatal
  }
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 5500
): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const basesToTry = autoFailoverEnabled ? activeApiBases : [activeApiBases[0] ?? ''];
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (const base of basesToTry) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${base}${normalizedPath}`, {
        ...init,
        signal: init.signal || controller.signal
      });
      window.clearTimeout(timer);

      if (response.status >= 502 && response.status <= 504 && base !== basesToTry[basesToTry.length - 1]) {
        lastResponse = response;
        continue;
      }
      return response;
    } catch (err) {
      window.clearTimeout(timer);
      lastError = err;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error('All configured API servers are unreachable.');
}

export async function adminApiFetch(
  path: string,
  idToken: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return apiFetch(path, { ...init, headers }, timeoutMs);
}

export function invalidateCatalogCache(): void {
  void apiFetch('/api/catalog/invalidate', { method: 'POST' }, 2500).catch(() => undefined);
}

export function archiveOrderAsync(order: {
  id: string;
  userId: string;
  address?: { city?: string };
  total: number;
  status: string;
  paymentMethod: string;
  paymentStatus?: string;
  assignedToUid?: string;
  items?: unknown[];
  date: string;
}): void {
  void apiFetch(
    '/api/archive/order',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: order.id,
        userId: order.userId,
        city: order.address?.city || '',
        total: order.total,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus || 'pending',
        assignedToUid: order.assignedToUid || '',
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
        date: order.date
      })
    },
    3000
  ).catch(() => undefined);
}

export function archiveLedgerAsync(entry: {
  id: string;
  partnerUid: string;
  orderId: string;
  type: string;
  amount: number;
}): void {
  void apiFetch(
    '/api/archive/ledger',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    },
    3000
  ).catch(() => undefined);
}
