const CACHE_NAME = 'acreos-v4';
const STATIC_CACHE = `${CACHE_NAME}-static`;
const API_CACHE = `${CACHE_NAME}-api`;

// IndexedDB key for the offline queue
const OFFLINE_DB_NAME = 'acreos-offline';
const OFFLINE_STORE = 'pending-requests';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png'
];

const CACHEABLE_API_ROUTES = [
  '/api/user',
  '/api/leads',
  '/api/properties',
  '/api/deals',
  '/api/team-members',
];

// Routes where offline POST/PUT will be queued for background sync
const OFFLINE_QUEUEABLE_ROUTES = [
  '/api/leads',
  '/api/activity-feed',
];

// ---------------------------------------------------------------------------
// IndexedDB helpers for offline queue
// ---------------------------------------------------------------------------

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueOfflineRequest(entry) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllOfflineRequests() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_STORE).getAll();
    req.onsuccess = () => resolve({ items: req.result, keys: [] });
    req.onerror = () => reject(req.error);
  });
}

async function getAllOfflineRequestsWithKeys() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_STORE);
    const items = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        items.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

async function deleteOfflineRequest(key) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Replay queued requests when back online
// ---------------------------------------------------------------------------

async function replayOfflineQueue() {
  const items = await getAllOfflineRequestsWithKeys();
  if (items.length === 0) return;

  console.log(`[SW] Replaying ${items.length} offline request(s)`);

  for (const { key, value } of items) {
    try {
      const response = await fetch(value.url, {
        method: value.method,
        headers: value.headers,
        body: value.body,
      });
      if (response.ok) {
        await deleteOfflineRequest(key);
        console.log(`[SW] Replayed offline request to ${value.url}`);

        // Notify all open clients
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) => {
          client.postMessage({
            type: 'OFFLINE_SYNC_COMPLETE',
            url: value.url,
            data: value.data,
          });
        });
      }
    } catch (err) {
      console.error(`[SW] Replay failed for ${value.url}:`, err);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('acreos-') && name !== STATIC_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('online', () => {
  replayOfflineQueue().catch(console.error);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Intercept offline-queueable mutations (POST/PUT/PATCH)
  if (
    ['POST', 'PUT', 'PATCH'].includes(request.method) &&
    OFFLINE_QUEUEABLE_ROUTES.some((r) => url.pathname.startsWith(r))
  ) {
    event.respondWith(
      request.clone().text().then(async (body) => {
        try {
          return await fetch(request);
        } catch {
          // Network failure — queue for later
          await queueOfflineRequest({
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            body,
            queuedAt: Date.now(),
            data: { pathname: url.pathname },
          });
          return new Response(
            JSON.stringify({ offline: true, queued: true, message: 'Saved offline — will sync when online' }),
            { status: 202, headers: { 'Content-Type': 'application/json' } }
          );
        }
      })
    );
    return;
  }

  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) {
    const shouldCache = CACHEABLE_API_ROUTES.some(route => url.pathname.startsWith(route));

    if (shouldCache) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clonedResponse = response.clone();
              caches.open(API_CACHE).then((cache) => {
                cache.put(request, clonedResponse);
              });
            }
            return response;
          })
          .catch(() => caches.match(request))
      );
    }
    return;
  }

  if (request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        if (response.ok) {
          const clonedResponse = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, clonedResponse);
          });
        }
        return response;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'AcreOS', body: event.data.text() };
  }

  const options = {
    body: data.body || 'New notification from AcreOS',
    icon: '/pwa-192x192.png',
    badge: '/favicon.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      ...data.data,
    },
    actions: data.actions || [],
    tag: data.tag || 'acreos-notification',
    renotify: !!data.renotify,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'AcreOS', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if (url !== '/') client.navigate(url);
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});
