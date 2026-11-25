/**
 * Client-side 2-Primary + 2-Backup HA Cluster Failover & Circuit Breaker Utilities
 * Routes requests across Primary Server 1 & Primary Server 2 (active-active) and
 * automatically fails over to Backup Server 3 & Backup Server 4 on outage/5xx/429.
 */

export interface RuntimeServerNode {
  id: string;
  label: string;
  url: string;
  role: 'primary' | 'secondary' | 'edge-worker';
  tier?: 'primary' | 'backup';
  enabled: boolean;
  priority: number;
}

const configuredServers = (
  (import.meta.env.VITE_API_SERVERS as string | undefined) || ''
)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const DEFAULT_CLUSTER_NODES: RuntimeServerNode[] = [
  {
    id: 'primary-server-1',
    label: 'Primary Server 1 (Active Origin)',
    url: '',
    role: 'primary',
    tier: 'primary',
    enabled: true,
    priority: 1
  },
  {
    id: 'primary-server-2',
    label: 'Primary Server 2 (Active Load-Balanced)',
    url: configuredServers[0] || '',
    role: 'primary',
    tier: 'primary',
    enabled: true,
    priority: 2
  },
  {
    id: 'backup-server-3',
    label: 'Backup Server 3 (Edge / Hot Failover)',
    url: configuredServers[1] || '',
    role: configuredServers[1]?.includes('workers.dev') ? 'edge-worker' : 'secondary',
    tier: 'backup',
    enabled: true,
    priority: 3
  },
  {
    id: 'backup-server-4',
    label: 'Backup Server 4 (Cold Standby / Offline Shield)',
    url: configuredServers[2] || '',
    role: configuredServers[2]?.includes('workers.dev') ? 'edge-worker' : 'secondary',
    tier: 'backup',
    enabled: true,
    priority: 4
  }
];

const RUNTIME_CLUSTER_KEY = 'freshveggie_ha_cluster_v2';
const CIRCUIT_BREAKER_COOLDOWN_MS = 15_000;

const loadRuntimeNodes = (): RuntimeServerNode[] => {
  try {
    const raw = localStorage.getItem(RUNTIME_CLUSTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RuntimeServerNode[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_CLUSTER_NODES;
};

let activeClusterNodes: RuntimeServerNode[] = loadRuntimeNodes();
let autoFailoverEnabled = true;
let primaryRoundRobinCursor = 0;
let lastServedNodeId = 'primary-server-1';
const circuitCooldownUntil = new Map<string, number>();

export function syncRuntimeServerNodes(
  nodes: Array<{
    id?: string;
    label?: string;
    url: string;
    role?: 'primary' | 'secondary' | 'edge-worker';
    tier?: 'primary' | 'backup';
    enabled: boolean;
    priority?: number;
  }>,
  autoFailover = true
): void {
  autoFailoverEnabled = autoFailover;
  const enabledNodes = nodes
    .filter((n) => n.enabled)
    .map((n, idx): RuntimeServerNode => {
      const role = n.role || (idx < 2 ? 'primary' : 'secondary');
      return {
        id: n.id || `server-${idx + 1}`,
        label: n.label || `Server ${idx + 1}`,
        url: (n.url || '').trim().replace(/\/+$/, ''),
        role,
        tier: n.tier || (role === 'primary' ? 'primary' : 'backup'),
        enabled: true,
        priority: n.priority || idx + 1
      };
    })
    .sort((a, b) => a.priority - b.priority);

  activeClusterNodes = enabledNodes.length > 0 ? enabledNodes : DEFAULT_CLUSTER_NODES;
  try {
    localStorage.setItem(RUNTIME_CLUSTER_KEY, JSON.stringify(activeClusterNodes));
  } catch {
    // ignore
  }
}

export async function refreshRuntimeServerNodes(): Promise<void> {
  const candidates = Array.from(
    new Set(['', ...activeClusterNodes.map((n) => n.url), ...configuredServers])
  );
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/public/runtime-config`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        autoServerFailover?: boolean;
        serverNodes?: RuntimeServerNode[];
      };
      if (Array.isArray(data.serverNodes) && data.serverNodes.length > 0) {
        syncRuntimeServerNodes(data.serverNodes, data.autoServerFailover !== false);
        return;
      }
    } catch {
      // try next server origin
    }
  }
}

export function getClusterRuntimeStatus(): {
  lastServedNodeId: string;
  nodeCount: number;
  autoFailoverEnabled: boolean;
} {
  return {
    lastServedNodeId,
    nodeCount: activeClusterNodes.length,
    autoFailoverEnabled
  };
}

function buildOrderedCandidateTargets(): Array<{ id: string; url: string }> {
  const now = Date.now();
  const isHealthy = (id: string) => (circuitCooldownUntil.get(id) || 0) <= now;

  const primaries = activeClusterNodes.filter(
    (n) => n.enabled && (n.role === 'primary' || n.tier === 'primary')
  );
  const backups = activeClusterNodes.filter(
    (n) => n.enabled && n.role !== 'primary' && n.tier !== 'primary'
  );

  // Rotate primary nodes only when distinct external URLs exist
  const orderedPrimaries = [...primaries];
  if (orderedPrimaries.length > 1) {
    const distinctPrimaryUrls = new Set(orderedPrimaries.map((n) => n.url));
    if (distinctPrimaryUrls.size > 1) {
      primaryRoundRobinCursor = (primaryRoundRobinCursor + 1) % orderedPrimaries.length;
      const rotated = [
        ...orderedPrimaries.slice(primaryRoundRobinCursor),
        ...orderedPrimaries.slice(0, primaryRoundRobinCursor)
      ];
      orderedPrimaries.splice(0, orderedPrimaries.length, ...rotated);
    }
  }

  const allOrdered = [...orderedPrimaries, ...backups];
  if (!autoFailoverEnabled && allOrdered.length > 0) {
    return [{ id: allOrdered[0].id, url: allOrdered[0].url }];
  }

  // Deduplicate identical URLs after picking healthy first, keeping up to 1 fast same-origin retry
  const healthyFirst = [
    ...allOrdered.filter((n) => isHealthy(n.id)),
    ...allOrdered.filter((n) => !isHealthy(n.id))
  ];

  const seenUrls = new Set<string>();
  const targets: Array<{ id: string; url: string }> = [];
  for (const node of healthyFirst) {
    if (!seenUrls.has(node.url)) {
      seenUrls.add(node.url);
      targets.push({ id: node.id, url: node.url });
    }
  }

  // Guarantee at least 2 resilient attempts even when all 4 nodes share same-origin during a brief blip
  if (targets.length === 1 && autoFailoverEnabled) {
    targets.push({ id: 'backup-retry', url: targets[0].url });
  }
  return targets.length > 0 ? targets : [{ id: 'primary-server-1', url: '' }];
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 5500
): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const targets = buildOrderedCandidateTargets();
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const isLastAttempt = i === targets.length - 1;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${target.url}${normalizedPath}`, {
        ...init,
        signal: init.signal || controller.signal
      });
      window.clearTimeout(timer);

      if ((response.status >= 500 || response.status === 429) && !isLastAttempt) {
        circuitCooldownUntil.set(target.id, Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS);
        lastResponse = response;
        if (target.id === 'backup-retry' || targets[i + 1]?.url === target.url) {
          await new Promise((r) => window.setTimeout(r, 180));
        }
        continue;
      }

      circuitCooldownUntil.delete(target.id);
      lastServedNodeId = target.id;
      return response;
    } catch (err) {
      window.clearTimeout(timer);
      circuitCooldownUntil.set(target.id, Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS);
      lastError = err;
      if (!isLastAttempt && (target.id === 'backup-retry' || targets[i + 1]?.url === target.url)) {
        await new Promise((r) => window.setTimeout(r, 180));
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error
    ? lastError
    : new Error('All 4 Primary and Backup servers are temporarily unreachable.');
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
