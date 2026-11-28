import { auth } from './firebase';
import { apiFetch } from './apiClient';

export type AppPushRole = 'customer' | 'delivery' | 'admin';

export interface AppPlatformCapabilities {
  platform: 'android' | 'ios' | 'web';
  isAndroid: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  notificationSupported: boolean;
  pushManagerSupported: boolean;
  iosNeedsHomeScreen: boolean;
}

export interface DispatchPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  action?: string;
  orderId?: string;
  requireInteraction?: boolean;
  delaySeconds?: number;
  actions?: Array<{ action: string; title: string }>;
  eventType?: 'self' | 'order_placed' | 'order_update' | 'support_ticket' | 'admin_broadcast';
  targetUids?: string[];
  targetRoles?: AppPushRole[];
  targetDeviceIds?: string[];
  showLocally?: boolean;
}

const PUSH_DB_NAME = 'freshveggie_push_sw_db';
const PUSH_DB_STORE = 'meta';

let memDeviceId = '';
let memDeviceToken = '';
let memVapidKey = '';

const sanitizeRelativeUrl = (rawUrl?: string): string => {
  if (typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
    return rawUrl.slice(0, 200);
  }
  return '/';
};

const openPushMetaDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(PUSH_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PUSH_DB_STORE)) {
        db.createObjectStore(PUSH_DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });

const readPushMeta = async (key: string): Promise<string> => {
  try {
    const db = await openPushMetaDb();
    return await new Promise<string>((resolve) => {
      const tx = db.transaction(PUSH_DB_STORE, 'readonly');
      const req = tx.objectStore(PUSH_DB_STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '');
      req.onerror = () => resolve('');
      tx.oncomplete = () => db.close();
    });
  } catch {
    return '';
  }
};

const writePushMetaMap = async (entries: Record<string, string>): Promise<void> => {
  try {
    const db = await openPushMetaDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(PUSH_DB_STORE, 'readwrite');
      const store = tx.objectStore(PUSH_DB_STORE);
      for (const [k, v] of Object.entries(entries)) {
        if (v) store.put(v, k);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore restricted private browsing storage contexts
  }
};

const generateCryptoDeviceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return (
      'dev_' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export async function getOrCreatePushDeviceId(): Promise<string> {
  if (memDeviceId) return memDeviceId;
  const fromDb = await readPushMeta('deviceId');
  if (fromDb && /^[a-zA-Z0-9_-]{12,80}$/.test(fromDb)) {
    memDeviceId = fromDb;
    return memDeviceId;
  }
  memDeviceId = generateCryptoDeviceId();
  await writePushMetaMap({ deviceId: memDeviceId });
  return memDeviceId;
}

export async function getStoredDevicePushToken(): Promise<string> {
  if (memDeviceToken) return memDeviceToken;
  const fromDb = await readPushMeta('deviceToken');
  if (fromDb) {
    memDeviceToken = fromDb;
  }
  return memDeviceToken;
}

async function getOptionalFirebaseIdToken(): Promise<string> {
  try {
    if (!auth.currentUser) return '';
    return await auth.currentUser.getIdToken();
  } catch {
    return '';
  }
}

async function buildPushRequestHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const [idToken, deviceToken] = await Promise.all([
    getOptionalFirebaseIdToken(),
    getStoredDevicePushToken()
  ]);
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  if (deviceToken) {
    headers['X-Push-Device-Token'] = deviceToken;
  }
  return headers;
}

export function detectAppPlatformCapabilities(): AppPlatformCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      platform: 'web',
      isAndroid: false,
      isIOS: false,
      isStandalone: false,
      notificationSupported: false,
      pushManagerSupported: false,
      iosNeedsHomeScreen: false
    };
  }

  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = /android/.test(ua);
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  const notificationSupported = 'Notification' in window;
  const pushManagerSupported = 'serviceWorker' in navigator && 'PushManager' in window;
  const iosNeedsHomeScreen = isIOS && !isStandalone && !notificationSupported;

  return {
    platform: isAndroid ? 'android' : isIOS ? 'ios' : 'web',
    isAndroid,
    isIOS,
    isStandalone,
    notificationSupported,
    pushManagerSupported,
    iosNeedsHomeScreen
  };
}

export function getNotificationPermissionState():
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

async function registerBackgroundPeriodicSync(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    const periodicSync = (
      reg as ServiceWorkerRegistration & {
        periodicSync?: { register: (tag: string, opts: { minInterval: number }) => Promise<void> };
      }
    ).periodicSync;
    if (!periodicSync || typeof periodicSync.register !== 'function') return;
    const perm = await navigator.permissions?.query?.({
      name: 'periodic-background-sync' as PermissionName
    });
    if (!perm || perm.state === 'granted') {
      await periodicSync.register('freshveggie-bg-push-sync', {
        minInterval: 15 * 60 * 1000
      });
    }
  } catch {
    // Supported only on installed Chromium Android/Desktop PWAs
  }
}

export async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (swRegistrationPromise) {
    return swRegistrationPromise;
  }

  swRegistrationPromise = (async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing) {
        void registerBackgroundPeriodicSync(existing);
        return existing;
      }

      // Register /sw.js (served cleanly in both dev preview and production build)
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready.catch(() => undefined);
        void registerBackgroundPeriodicSync(reg);
        return reg;
      } catch {
        const fallbackReg = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready.catch(() => undefined);
        void registerBackgroundPeriodicSync(fallbackReg);
        return fallbackReg;
      }
    } catch {
      swRegistrationPromise = null;
      return null;
    }
  })();

  return swRegistrationPromise;
}

export async function showLocalPushNotification(
  payload: Omit<
    DispatchPushPayload,
    'eventType' | 'targetUids' | 'targetRoles' | 'targetDeviceIds' | 'showLocally' | 'delaySeconds'
  >
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (window.Notification.permission !== 'granted') {
    return false;
  }

  const safeUrl = sanitizeRelativeUrl(payload.url);

  const swOptions: NotificationOptions & {
    renotify?: boolean;
    vibrate?: number[];
    actions?: Array<{ action: string; title: string }>;
  } = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || 'freshveggie-alert',
    renotify: true,
    requireInteraction: Boolean(payload.requireInteraction),
    vibrate: [180, 90, 180],
    data: {
      url: safeUrl,
      action: payload.action || 'open',
      orderId: payload.orderId || ''
    }
  };

  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    swOptions.actions = payload.actions.slice(0, 2);
  }

  try {
    const reg = await ensurePushServiceWorker();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(payload.title, swOptions);
      return true;
    }
  } catch {
    // Fallback to Notification constructor below
  }

  try {
    const note = new window.Notification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: payload.tag || 'freshveggie-alert'
    });
    note.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent('fv-push-notification-click', {
          detail: {
            action: payload.action || 'open',
            url: safeUrl,
            orderId: payload.orderId || ''
          }
        })
      );
      note.close();
    };
    return true;
  } catch {
    return false;
  }
}

async function fetchVapidKeyCached(): Promise<string> {
  if (memVapidKey) return memVapidKey;
  const vapidRes = await apiFetch('/api/push/vapid-public-key', {}, 4000);
  if (!vapidRes.ok) return '';
  const vapidData = (await vapidRes.json()) as { publicKey?: string };
  if (vapidData.publicKey) {
    memVapidKey = vapidData.publicKey;
  }
  return memVapidKey;
}

async function registerSubscriptionWithServer(options: {
  subscription: PushSubscription;
  role: AppPushRole;
  sendTest?: boolean;
}): Promise<boolean> {
  const subJson = options.subscription.toJSON();
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    return false;
  }

  const deviceId = await getOrCreatePushDeviceId();
  const { platform } = detectAppPlatformCapabilities();
  const headers = await buildPushRequestHeaders();

  const res = await apiFetch(
    '/api/push/subscribe',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId,
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth
          }
        },
        role: options.role,
        platform,
        sendTest: Boolean(options.sendTest)
      })
    },
    5000
  );

  if (!res.ok) return false;

  const data = (await res.json()) as {
    deviceId?: string;
    deviceToken?: string;
  };
  if (data.deviceId) memDeviceId = data.deviceId;
  if (data.deviceToken) memDeviceToken = data.deviceToken;

  await writePushMetaMap({
    deviceId: memDeviceId,
    deviceToken: memDeviceToken,
    vapidPublicKey: memVapidKey,
    role: options.role,
    platform
  });

  const swTarget =
    navigator.serviceWorker?.controller ||
    (await navigator.serviceWorker?.getRegistration().catch(() => undefined))?.active;
  if (swTarget) {
    swTarget.postMessage({
      type: 'SYNC_PUSH_META',
      meta: {
        deviceId: memDeviceId,
        deviceToken: memDeviceToken,
        vapidPublicKey: memVapidKey,
        role: options.role,
        platform
      }
    });
  }
  return true;
}

// Works seamlessly in foreground or background even WITHOUT a Firebase ID token
export async function syncExistingPushSubscription(role: AppPushRole): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (window.Notification.permission !== 'granted') return false;

  try {
    const reg = await ensurePushServiceWorker();
    if (!reg || !('pushManager' in reg)) return false;

    const vapidKey = await fetchVapidKeyCached();
    let sub = await reg.pushManager.getSubscription();
    if (!sub && vapidKey) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
    }
    if (!sub) return false;

    return await registerSubscriptionWithServer({
      subscription: sub,
      role,
      sendTest: false
    });
  } catch {
    return false;
  }
}

export async function enableAndSubscribePush(options: {
  role: AppPushRole;
  sendTest?: boolean;
}): Promise<{
  ok: boolean;
  permission: 'granted' | 'denied' | 'default' | 'unsupported';
  subscribedRemote: boolean;
  message: string;
}> {
  const caps = detectAppPlatformCapabilities();
  if (caps.iosNeedsHomeScreen) {
    return {
      ok: false,
      permission: 'unsupported',
      subscribedRemote: false,
      message:
        'On iPhone/iPad, tap Share (□↑) -> Add to Home Screen first, then open FreshVeggie from your Home Screen to enable iOS Push Notifications.'
    };
  }

  if (!caps.notificationSupported) {
    return {
      ok: false,
      permission: 'unsupported',
      subscribedRemote: false,
      message: 'This browser context does not support system Push Notifications.'
    };
  }

  try {
    let permission = window.Notification.permission;
    if (permission === 'default') {
      permission = await window.Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return {
        ok: false,
        permission,
        subscribedRemote: false,
        message:
          'Notifications are blocked in browser/device settings. Allow Notifications for this site in device settings to receive alerts.'
      };
    }

    const reg = await ensurePushServiceWorker();
    let subscribedRemote = false;

    if (reg && 'pushManager' in reg) {
      try {
        const vapidKey = await fetchVapidKeyCached();
        let sub = await reg.pushManager.getSubscription();
        if (!sub && vapidKey) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey)
          });
        }
        if (sub) {
          subscribedRemote = await registerSubscriptionWithServer({
            subscription: sub,
            role: options.role,
            sendTest: Boolean(options.sendTest)
          });
        }
      } catch {
        // PushManager subscription may be restricted in iframe preview; local SW notifications still succeed
      }
    }

    if (options.sendTest && !subscribedRemote) {
      await showLocalPushNotification({
        title: 'FreshVeggie Push Notifications Active',
        body:
          options.role === 'delivery'
            ? 'Live dispatch, delivery updates, and GPS location reminders are now enabled.'
            : 'Real-time order updates and store alerts are now enabled.',
        url:
          options.role === 'delivery'
            ? '/delivery/dashboard'
            : options.role === 'admin'
            ? '/admin/dashboard'
            : '/orders',
        tag: 'push-welcome'
      });
    }

    return {
      ok: true,
      permission: 'granted',
      subscribedRemote,
      message: subscribedRemote
        ? 'Background Push Notifications active (Android, iOS & Web).'
        : 'Device Push Notifications enabled!'
    };
  } catch (err) {
    return {
      ok: false,
      permission: getNotificationPermissionState(),
      subscribedRemote: false,
      message:
        err instanceof Error ? err.message : 'Unable to enable Push Notifications on this device.'
    };
  }
}

export async function dispatchAppPushNotification(
  payload: DispatchPushPayload
): Promise<void> {
  if (payload.showLocally) {
    await showLocalPushNotification({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      action: payload.action,
      orderId: payload.orderId,
      requireInteraction: payload.requireInteraction,
      actions: payload.actions
    });
  }

  const deviceToken = await getStoredDevicePushToken();
  const idToken = await getOptionalFirebaseIdToken();
  if (!idToken && !deviceToken) {
    return;
  }

  let targetDeviceIds = payload.targetDeviceIds ? [...payload.targetDeviceIds] : [];
  if ((!payload.eventType || payload.eventType === 'self') && targetDeviceIds.length === 0) {
    const devId = await getOrCreatePushDeviceId();
    if (devId) targetDeviceIds = [devId];
  }

  const hasRemoteTargets =
    (payload.targetUids && payload.targetUids.length > 0) ||
    (payload.targetRoles && payload.targetRoles.length > 0) ||
    targetDeviceIds.length > 0;
  if (!hasRemoteTargets) return;

  try {
    const headers = await buildPushRequestHeaders();
    await apiFetch(
      '/api/push/notify',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: sanitizeRelativeUrl(payload.url),
          tag: payload.tag,
          action: payload.action,
          orderId: payload.orderId,
          requireInteraction: payload.requireInteraction,
          delaySeconds: payload.delaySeconds,
          eventType: payload.eventType || 'self',
          targetUids: payload.targetUids,
          targetRoles: payload.targetRoles,
          targetDeviceIds,
          actions: payload.actions
        })
      },
      4500
    );
  } catch {
    // Non-fatal: local SW alerts remain active
  }
}

export async function sendLocationPermissionPushReminder(options: {
  url: string;
  orderId?: string;
}): Promise<{ shownLocally: boolean; sentRemote: boolean }> {
  const title = 'Allow Location Permission for GPS Sync';
  const body = options.orderId
    ? `Order #${options.orderId}: Enable Location in Device Settings, then tap here to Sync Now.`
    : 'Turn ON Location permission in Device Settings, then tap this notification to Sync GPS Now.';

  const actions = [{ action: 'enable_location', title: 'Allow Location / Sync Now' }];

  const shownLocally = await showLocalPushNotification({
    title,
    body,
    url: options.url,
    tag: 'delivery-location-permission',
    action: 'enable_location',
    orderId: options.orderId,
    requireInteraction: true,
    actions
  });

  let sentRemote = false;
  const headers = await buildPushRequestHeaders();
  if (headers.Authorization || headers['X-Push-Device-Token']) {
    try {
      const deviceId = await getOrCreatePushDeviceId();
      const targetUids = auth.currentUser?.uid ? [auth.currentUser.uid] : [];
      const res = await apiFetch(
        '/api/push/notify',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title,
            body,
            url: sanitizeRelativeUrl(options.url),
            tag: 'delivery-location-permission',
            action: 'enable_location',
            orderId: options.orderId || '',
            requireInteraction: true,
            eventType: 'self',
            targetUids,
            targetDeviceIds: deviceId ? [deviceId] : [],
            actions
          })
        },
        4500
      );
      if (res.ok) {
        const data = (await res.json()) as { sent?: number };
        sentRemote = Number(data.sent || 0) > 0;
      }
    } catch {
      sentRemote = false;
    }
  }

  return { shownLocally, sentRemote };
}
