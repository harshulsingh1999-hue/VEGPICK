import { apiFetch } from './apiClient';

export type AppClientPlatform = 'android' | 'ios' | 'web';

export interface ClientDiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface ClientDeviceAuditResult {
  platform: AppClientPlatform;
  userAgent: string;
  online: boolean;
  standaloneMode: boolean;
  serviceWorkerState: string;
  cacheStorageCount: number;
  cacheNames: string[];
  localStorageKeys: number;
  localStorageBytes: number;
  viewport: string;
  apiHealthLatencyMs: number | null;
  manifestReachable: boolean;
  checkedAt: string;
  checks: ClientDiagnosticCheck[];
}

export interface ClientCleanupResult {
  ok: boolean;
  cachesCleared: number;
  storageKeysCleared: number;
  bytesFreedEstimate: number;
  summary: string;
}

export function detectClientPlatform(): AppClientPlatform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '').toLowerCase();
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (platform === 'macintel' && maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'web';
}

const recentReportTimestamps = new Map<string, number>();

export async function reportClientDiagnostic(input: {
  severity?: 'info' | 'warning' | 'error';
  category: string;
  message: string;
  route?: string;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  const cleanMsg = (input.message || '').trim().slice(0, 480);
  if (!cleanMsg) return;

  const dedupeKey = `${input.category}:${cleanMsg.slice(0, 120)}`;
  const now = Date.now();
  const prev = recentReportTimestamps.get(dedupeKey) || 0;
  if (now - prev < 60_000) return; // Throttle duplicate reports to once/minute
  recentReportTimestamps.set(dedupeKey, now);
  if (recentReportTimestamps.size > 100) {
    const oldestKey = recentReportTimestamps.keys().next().value;
    if (oldestKey) recentReportTimestamps.delete(oldestKey);
  }

  try {
    const platform = detectClientPlatform();
    const route = input.route || window.location.pathname || '/';
    await apiFetch(
      '/api/diagnostics/report',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          severity: input.severity || 'error',
          category: (input.category || 'runtime').slice(0, 48),
          message: cleanMsg,
          route: route.slice(0, 120)
        })
      },
      3000
    );
  } catch {
    // Telemetry must never crash or throw inside caller
  }
}

let guardInstalled = false;

export function installGlobalErrorGuard(): void {
  if (typeof window === 'undefined' || guardInstalled) return;
  guardInstalled = true;

  window.addEventListener('error', (event) => {
    const msg = event.message || event.error?.message || '';
    if (!msg) return;
    // Ignore benign ResizeObserver browser noise
    if (msg.includes('ResizeObserver loop')) return;
    void reportClientDiagnostic({
      severity: 'error',
      category: 'window_error',
      message: msg
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : 'Unhandled Promise rejection';
    if (!msg) return;

    // Auto-recover from stale dynamic chunk errors on Android/iOS/Web PWAs
    if (
      (msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed')) &&
      !sessionStorage.getItem('freshveggie_chunk_reloaded')
    ) {
      sessionStorage.setItem('freshveggie_chunk_reloaded', '1');
      void reportClientDiagnostic({
        severity: 'warning',
        category: 'chunk_auto_heal',
        message: `Auto-reloaded after stale module chunk error: ${msg}`
      });
      void runClientDeviceCleanup({ preserveAuth: true, resetClusterCache: false }).finally(() => {
        window.location.reload();
      });
      return;
    }

    void reportClientDiagnostic({
      severity: 'error',
      category: 'unhandled_promise',
      message: msg
    });
  });
}

export async function runClientDeviceAudit(): Promise<ClientDeviceAuditResult> {
  const platform = detectClientPlatform();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const standaloneMode =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches === true ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  let serviceWorkerState = 'Unsupported';
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) serviceWorkerState = `Active (${reg.active.state})`;
      else if (reg?.installing) serviceWorkerState = 'Installing';
      else if (reg?.waiting) serviceWorkerState = 'Update Waiting';
      else serviceWorkerState = 'Not Registered (Dev / Live Mode)';
    } catch {
      serviceWorkerState = 'Restricted / Unavailable';
    }
  }

  let cacheNames: string[] = [];
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      cacheNames = await window.caches.keys();
    } catch {
      cacheNames = [];
    }
  }

  let localStorageKeys = 0;
  let localStorageBytes = 0;
  try {
    localStorageKeys = localStorage.length;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      const v = localStorage.getItem(k) || '';
      localStorageBytes += (k.length + v.length) * 2;
    }
  } catch {
    localStorageKeys = 0;
  }

  let apiHealthLatencyMs: number | null = null;
  let apiHealthy = false;
  const hStart = performance.now();
  try {
    const res = await apiFetch('/api/health', {}, 4000);
    apiHealthLatencyMs = Math.round(performance.now() - hStart);
    apiHealthy = res.ok;
  } catch {
    apiHealthy = false;
  }

  let manifestReachable = false;
  try {
    const mRes = await fetch('/manifest.json', { cache: 'no-store' });
    manifestReachable = mRes.ok;
  } catch {
    manifestReachable = false;
  }

  const safeAreaSupported =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    (CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)') ||
      CSS.supports('padding-top', 'env(safe-area-inset-top)'));

  const checks: ClientDiagnosticCheck[] = [
    {
      id: 'client-network',
      label: 'Network & Multi-Server Failover Reachability',
      status: online && apiHealthy ? 'pass' : online ? 'warn' : 'fail',
      detail: apiHealthy
        ? `Online • /api/health responded in ${apiHealthLatencyMs}ms`
        : online
        ? 'Browser online, but backend probe failed'
        : 'Device appears offline'
    },
    {
      id: 'client-manifest',
      label: 'Android / iOS PWA Manifest & Icons',
      status: manifestReachable ? 'pass' : 'fail',
      detail: manifestReachable
        ? `/manifest.json verified (${standaloneMode ? 'Running as Installed App' : 'Browser Mode'})`
        : '/manifest.json did not respond cleanly'
    },
    {
      id: 'client-safe-area',
      label: 'iOS Notch & Android Navigation Bar Safe Area',
      status: safeAreaSupported ? 'pass' : 'warn',
      detail: safeAreaSupported
        ? 'CSS env(safe-area-inset-*) supported for iOS & Android edge-to-edge'
        : 'Legacy browser without safe-area env() support'
    },
    {
      id: 'client-storage',
      label: 'On-Device Storage & Cache Health',
      status: localStorageBytes < 3 * 1024 * 1024 ? 'pass' : 'warn',
      detail: `${localStorageKeys} localStorage keys (~${Math.round(localStorageBytes / 1024)} KB) • ${cacheNames.length} CacheStorage buckets`
    }
  ];

  return {
    platform,
    userAgent: ua,
    online,
    standaloneMode,
    serviceWorkerState,
    cacheStorageCount: cacheNames.length,
    cacheNames,
    localStorageKeys,
    localStorageBytes,
    viewport:
      typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x` : 'N/A',
    apiHealthLatencyMs,
    manifestReachable,
    checkedAt: new Date().toISOString(),
    checks
  };
}

export async function runClientDeviceCleanup(options?: {
  preserveAuth?: boolean;
  resetClusterCache?: boolean;
}): Promise<ClientCleanupResult> {
  const preserveAuth = options?.preserveAuth !== false;
  let cachesCleared = 0;
  let storageKeysCleared = 0;
  let bytesFreedEstimate = 0;

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await window.caches.keys();
      for (const name of keys) {
        const deleted = await window.caches.delete(name);
        if (deleted) cachesCleared += 1;
      }
    } catch {
      // ignore CacheStorage errors
    }
  }

  try {
    if (sessionStorage.getItem('freshveggie_chunk_reloaded')) {
      sessionStorage.removeItem('freshveggie_chunk_reloaded');
      storageKeysCleared += 1;
    }

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Preserve Firebase auth tokens & cart/preferences unless explicitly resetting cluster cache
      if (preserveAuth && k.startsWith('firebase:')) continue;
      if (options?.resetClusterCache && k === 'freshveggie_ha_cluster_v2') {
        keysToRemove.push(k);
      } else if (k.startsWith('freshveggie_diag_') || k.startsWith('workbox-')) {
        keysToRemove.push(k);
      }
    }

    for (const k of keysToRemove) {
      const val = localStorage.getItem(k) || '';
      bytesFreedEstimate += (k.length + val.length) * 2;
      localStorage.removeItem(k);
      storageKeysCleared += 1;
    }
  } catch {
    // ignore storage errors
  }

  return {
    ok: true,
    cachesCleared,
    storageKeysCleared,
    bytesFreedEstimate,
    summary: `Cleared ${cachesCleared} browser cache bucket(s) and ${storageKeysCleared} stale local key(s) cleanly.`
  };
}
