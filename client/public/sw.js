// Bumped to v14 for the day-365 reliability pass (2026-05-29): adds
// /api/field-scout/quick-add to the offline-queueable allowlist (a
// DriveMode save in a cellular dead zone was silently dropped), and
// bumps the IndexedDB version to 2 so we have an exercised migration
// path before the store fills up in customer-installed SWs.
const CACHE_NAME = 'acreos-v14';
const STATIC_CACHE = `${CACHE_NAME}-static`;
const API_CACHE = `${CACHE_NAME}-api`;

// IndexedDB key for the offline queue
const OFFLINE_DB_NAME = 'acreos-offline';
const OFFLINE_STORE = 'pending-requests';
// IndexedDB schema version. v1 had no onupgradeneeded migration logic
// beyond initial store creation — a future schema change would have
// landed on an opaque VersionError in every customer SW. v2 introduces
// an explicit `upgrade(oldVersion, db)` migration ladder so the next
// shape change has a real path, and so we exercise the upgrade path
// once while the store is empty enough to recover if anything goes
// wrong.
const OFFLINE_DB_VERSION = 2;

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

// Routes where offline POST/PUT will be queued for background sync.
// Added 2026-05-26: /api/auction-listings powers the CourthouseMode bid
// log. Tax-Delinquent auctions happen in courthouses with no WiFi, so
// log-bid POSTs MUST be queueable — without this the indicator's
// "we'll sync when online" promise was theatre.
// Added 2026-05-29 (Workstream C): /api/field-scout/quick-add is the
// DriveMode "save current location as a lead" endpoint. Field scouts
// drive rural cellular dead zones — without queueing, every
// dead-zone save was a silent ghost: the toast said "saved", the
// row was gone the moment the truck rolled out of signal.
const OFFLINE_QUEUEABLE_ROUTES = [
  '/api/leads',
  '/api/activity-feed',
  '/api/auction-listings',
  '/api/conversations', // Inbox triage swipes — same use case
  '/api/field-scout/quick-add', // DriveMode quick-save (rural/dead-zone)
];

// ---------------------------------------------------------------------------
// IndexedDB helpers for offline queue
// ---------------------------------------------------------------------------

// Schema migration ladder, run inside onupgradeneeded. Each step is
// idempotent and only applies between its source and current version,
// so a fresh install at v2 runs the same path as a v1 → v2 upgrade.
// When we bump OFFLINE_DB_VERSION to 3, add a `if (oldVersion < 3)`
// block here — DO NOT mutate the v1/v2 blocks (clients have already
// applied them).
function migrateOfflineDb(oldVersion, db, transaction) {
  if (oldVersion < 1) {
    // Initial schema. Auto-increment keys for FIFO replay order — the
    // replay loop opens a cursor and walks forward.
    if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
      db.createObjectStore(OFFLINE_STORE, { autoIncrement: true });
    }
  }
  if (oldVersion < 2) {
    // v2 is the scaffolded-migration commit. The store shape did not
    // change — every queued entry from v1 (CourthouseMode bids made
    // since 2026-05-26) keeps replaying without rewrite. We do exercise
    // the ladder so the first real schema change has a tested path.
    // No-op intentional: do not touch existing entries.
    void transaction; // no-op marker; reserved for future migrations
  }
}

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      // event.target.transaction is the version-change transaction —
      // the only transaction inside which we can create/modify stores.
      const transaction = event.target.transaction;
      try {
        migrateOfflineDb(event.oldVersion || 0, db, transaction);
      } catch (err) {
        console.error('[SW] IndexedDB migration failed:', err);
        // Abort the version-change transaction so the DB stays at the
        // pre-upgrade version rather than half-migrating.
        if (transaction && typeof transaction.abort === 'function') {
          transaction.abort();
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // A blocked upgrade means another tab still holds the v1 connection
    // open. Log so we can see this in the wild rather than silently
    // hanging the SW.
    req.onblocked = () => {
      console.warn('[SW] IndexedDB upgrade blocked — another tab is holding the previous version open');
    };
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
