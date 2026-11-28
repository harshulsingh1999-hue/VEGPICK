/* FreshVeggie Cross-Platform Service Worker Background Push & Sync Handler (Android + iOS 16.4+ PWA + Web) */
const PUSH_DB_NAME = 'freshveggie_push_sw_db';
const PUSH_DB_STORE = 'meta';

function sanitizeRelativeUrl(rawUrl) {
  if (typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
    return rawUrl.slice(0, 200);
  }
  return '/';
}

function openPushMetaDb() {
  return new Promise((resolve, reject) => {
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
}

async function readPushMeta(key) {
  try {
    const db = await openPushMetaDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PUSH_DB_STORE, 'readonly');
      const req = tx.objectStore(PUSH_DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function writePushMeta(key, value) {
  try {
    const db = await openPushMetaDb();
    await new Promise((resolve) => {
      const tx = db.transaction(PUSH_DB_STORE, 'readwrite');
      tx.objectStore(PUSH_DB_STORE).put(value, key);
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
    // ignore storage quota errors
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = self.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function displayPushPayload(payload) {
  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim().slice(0, 120)
      : 'FreshVeggie Delivery';
  const body =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body.trim().slice(0, 300)
      : 'You have a new update.';
  const rawUrl = sanitizeRelativeUrl(payload.url);
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim().slice(0, 80)
      : 'freshveggie-alert';
  const action = typeof payload.action === 'string' ? payload.action : 'open';
  const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';

  const options = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    renotify: true,
    requireInteraction: Boolean(payload.requireInteraction),
    vibrate: [200, 100, 200],
    data: {
      url: rawUrl,
      action,
      orderId
    }
  };

  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    options.actions = payload.actions.slice(0, 2);
  }

  await writePushMeta('lastSeenTs', Date.now());
  return self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  event.waitUntil(displayPushPayload(payload));
});

async function refreshBackgroundSubscription() {
  try {
    let vapidPublicKey = await readPushMeta('vapidPublicKey');
    if (!vapidPublicKey) {
      const res = await fetch('/api/push/vapid-public-key');
      if (res.ok) {
        const data = await res.json();
        vapidPublicKey = data && data.publicKey ? String(data.publicKey) : '';
        if (vapidPublicKey) {
          await writePushMeta('vapidPublicKey', vapidPublicKey);
        }
      }
    }
    if (!vapidPublicKey || !self.registration || !self.registration.pushManager) {
      return;
    }

    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
    const subJson = sub.toJSON();
    if (!subJson || !subJson.endpoint || !subJson.keys || !subJson.keys.p256dh || !subJson.keys.auth) {
      return;
    }

    const deviceId = (await readPushMeta('deviceId')) || '';
    const deviceToken = (await readPushMeta('deviceToken')) || '';
    const role = (await readPushMeta('role')) || 'customer';
    const platform = (await readPushMeta('platform')) || 'web';

    const headers = { 'Content-Type': 'application/json' };
    if (deviceToken) {
      headers['X-Push-Device-Token'] = String(deviceToken);
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId,
        role,
        platform,
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth
          }
        }
      })
    });

    if (res.ok) {
      const out = await res.json();
      if (out && out.deviceId) await writePushMeta('deviceId', out.deviceId);
      if (out && out.deviceToken) await writePushMeta('deviceToken', out.deviceToken);
    }
  } catch {
    // Retry on next SW activation or sync
  }
}

async function pollPendingBackgroundPushEvents() {
  try {
    const deviceToken = await readPushMeta('deviceToken');
    if (!deviceToken) return;
    const lastSeenTs = Number(await readPushMeta('lastSeenTs')) || Date.now() - 3600_000;
    const res = await fetch(`/api/push/pending?since=${encodeURIComponent(String(lastSeenTs))}`, {
      headers: {
        'X-Push-Device-Token': String(deviceToken)
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    const events = Array.isArray(data && data.events) ? data.events : [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      await displayPushPayload(events[i]);
    }
    if (data && typeof data.serverTime === 'number' && data.serverTime > 0) {
      await writePushMeta('lastSeenTs', data.serverTime);
    }
  } catch {
    // Non-fatal in background
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(refreshBackgroundSubscription());
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'freshveggie-bg-push-sync') {
    event.waitUntil(pollPendingBackgroundPushEvents());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'freshveggie-bg-sync') {
    event.waitUntil(pollPendingBackgroundPushEvents());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const clickedAction = event.action || data.action || 'open';
  const rawUrl = sanitizeRelativeUrl(data.url);
  const orderId = typeof data.orderId === 'string' ? data.orderId : '';

  let targetUrl = rawUrl;
  if (clickedAction === 'enable_location' && !targetUrl.includes('syncLocation=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}syncLocation=1`;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            await client.focus();
            client.postMessage({
              type: 'PUSH_NOTIFICATION_CLICK',
              action: clickedAction,
              url: targetUrl,
              orderId
            });
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type === 'SYNC_PUSH_META' && event.data.meta) {
    const meta = event.data.meta;
    event.waitUntil(
      Promise.all([
        meta.deviceId ? writePushMeta('deviceId', String(meta.deviceId)) : Promise.resolve(),
        meta.deviceToken ? writePushMeta('deviceToken', String(meta.deviceToken)) : Promise.resolve(),
        meta.vapidPublicKey
          ? writePushMeta('vapidPublicKey', String(meta.vapidPublicKey))
          : Promise.resolve(),
        meta.role ? writePushMeta('role', String(meta.role)) : Promise.resolve(),
        meta.platform ? writePushMeta('platform', String(meta.platform)) : Promise.resolve()
      ])
    );
    return;
  }
  if (event.data.type === 'POLL_PENDING_PUSH') {
    event.waitUntil(pollPendingBackgroundPushEvents());
  }
});
