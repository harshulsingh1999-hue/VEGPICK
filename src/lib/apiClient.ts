/**
 * Client-side Multi-Server Failover & Non-Blocking Cloud Sync Utilities
 * Supports optional VITE_API_SERVERS comma-separated origins (e.g. Cloudflare Worker + Backup Server)
 * while defaulting cleanly to same-origin ('') first.
 */

const configuredServers = (
  (import.meta.env.VITE_API_SERVERS as string | undefined) || ''
)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const API_BASES = ['', ...configuredServers.filter((s) => s !== '')];

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 5500
): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (const base of API_BASES) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${base}${normalizedPath}`, {
        ...init,
        signal: init.signal || controller.signal
      });
      window.clearTimeout(timer);

      // Fail over to backup server if gateway/origin returns 502/503/504
      if (response.status >= 502 && response.status <= 504 && base !== API_BASES[API_BASES.length - 1]) {
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
