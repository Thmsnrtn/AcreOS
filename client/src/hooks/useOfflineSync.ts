/**
 * useOfflineSync — IndexedDB Offline Cache + Sync Queue (Task 348)
 *
 * Provides:
 * - IndexedDB cache for CRM data (leads, properties, deals)
 * - Sync queue for offline mutations (create/update/delete)
 * - Background sync when connection is restored
 * - Exported hook: { isOnline, cachedData, syncStatus, forceSync }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { clientLogger } from "@/lib/clientLogger";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface QueuedMutation {
  id: string;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timestamp: number;
  retries: number;
  /**
   * Stable per-mutation Idempotency-Key, generated at queue time and
   * reused on every drain attempt. Critical for money-side paths:
   * without this a queued POST /api/notes/:id/payments would mint a
   * fresh UUID on every replay, defeating the server-side dedupe and
   * potentially producing duplicate ledger entries if the original
   * optimistic attempt also reached the server before going offline.
   *
   * Optional in the type for backwards-compat with rows persisted by
   * the v1 schema (drainMutationQueue backfills a key for those).
   */
  idempotencyKey?: string;
}

export interface CachedData {
  leads: unknown[];
  properties: unknown[];
  deals: unknown[];
  lastSyncedAt: Date | null;
}

export interface UseOfflineSyncResult {
  isOnline: boolean;
  cachedData: CachedData;
  syncStatus: SyncStatus;
  forceSync: () => Promise<void>;
  /** Queue a mutation for later execution when back online */
  queueMutation: (mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'retries'>) => Promise<void>;
  /** How many mutations are currently queued awaiting sync. */
  queuedCount: number;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME = 'acreos-offline';
const LOG_PREFIX = '[OfflineSync] ';
// v2: QueuedMutation now carries an idempotencyKey so drain replays
// collapse to one server-side effect. No store shape changed — the
// version bump simply forces onupgradeneeded to fire so any future
// migration hook has a place to land. Rows persisted by v1 (no
// idempotencyKey) are handled at drain time, see drainMutationQueue.
// v3 (A11-01): this DB is SHARED with the service worker
// (client/public/sw.js), which needs the 'pending-requests' store while
// this hook needs 'cache' + 'mutations'. At v2 both sides opened the
// same name at the same version with disjoint stores, so whichever
// opener ran first created only its own stores and the other side's
// transactions failed forever. v3 unifies the schema: BOTH openers'
// upgrade paths create ALL THREE stores (shapes identical), and v2
// databases gain the missing stores on upgrade.
const DB_VERSION = 3;

/** BackgroundSync tag the service worker listens for (A11-02). */
export const OFFLINE_SYNC_TAG = 'acreos-offline-replay';

/**
 * True when a response is the service worker's offline-queue receipt
 * (HTTP 202 `{ offline: true, queued: true }`) rather than a real
 * server save. Callers must surface this as "queued", never as
 * "saved" — the queued body carries no server-assigned ids (A11-03).
 */
export function isOfflineQueuedResponse(
  status: number,
  body: unknown,
): boolean {
  if (status !== 202 || !body || typeof body !== 'object') return false;
  const b = body as { offline?: unknown; queued?: unknown };
  return b.offline === true && b.queued === true;
}

/**
 * Ask the service worker to replay ITS queue (the 'pending-requests'
 * store drained by sw.js). Service workers receive no 'online' event,
 * so the window side has to trigger replay explicitly: a postMessage
 * (works everywhere) plus a BackgroundSync registration where the
 * browser supports it (fires even if this tab closes). Best-effort —
 * failures are swallowed because the next 'online'/mount retries.
 */
type RegistrationWithSync = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

export function requestServiceWorkerReplay(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const sw = navigator.serviceWorker;
    sw.controller?.postMessage({ type: 'REPLAY_OFFLINE_QUEUE' });
    // BackgroundSync unsupported → this rejects / sync is undefined and
    // the postMessage above remains the trigger. Best effort throughout:
    // the next 'online'/mount retries.
    void sw.ready
      .then((registration) => (registration as RegistrationWithSync).sync?.register(OFFLINE_SYNC_TAG))
      .catch(() => undefined);
  } catch {
    /* best effort */
  }
}

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('mutations')) {
        const store = db.createObjectStore('mutations', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
      // A11-01: the service worker's queue store — created here too so
      // the shared DB is complete whichever opener creates it first.
      // Shape must stay identical to sw.js's upgrade path.
      if (!db.objectStoreNames.contains('pending-requests')) {
        db.createObjectStore('pending-requests', { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One transaction wrapper for every store op below (bundle trim,
 * EL-P1 fix round): when `run` returns a request, the promise settles
 * on that request; otherwise it settles on transaction completion —
 * the exact semantics the five hand-rolled wrappers had before.
 */
function idbOp<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    // A synchronous throw from `run` (e.g. a missing store) rejects the
    // promise via the executor, matching the old wrappers.
    const req = run(tx.objectStore(store));
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  const row = await idbOp<{ value: T }>(db, store, 'readonly', (s) => s.get(key));
  return row?.value;
}

async function idbSet(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  await idbOp(db, store, 'readwrite', (s) => {
    s.put({ key, value });
  });
}

async function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return (await idbOp<T[]>(db, store, 'readonly', (s) => s.getAll())) ?? [];
}

async function idbCount(db: IDBDatabase, store: string): Promise<number> {
  return (await idbOp<number>(db, store, 'readonly', (s) => s.count())) ?? 0;
}

async function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  await idbOp(db, store, 'readwrite', (s) => {
    s.delete(key);
  });
}

async function idbAddMutation(db: IDBDatabase, mutation: QueuedMutation): Promise<void> {
  await idbOp(db, 'mutations', 'readwrite', (s) => {
    s.put(mutation);
  });
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "k-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineSync(): UseOfflineSyncResult {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [queuedCount, setQueuedCount] = useState(0);
  const [cachedData, setCachedData] = useState<CachedData>({
    leads: [],
    properties: [],
    deals: [],
    lastSyncedAt: null,
  });

  const dbRef = useRef<IDBDatabase | null>(null);

  const refreshQueuedCount = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    try {
      // Count via the store's count() instead of materialising every
      // queued row just to badge their number.
      setQueuedCount(await idbCount(db, 'mutations'));
    } catch {
      /* best effort */
    }
  }, []);

  // ── Open DB on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    openDB()
      .then((db) => {
        dbRef.current = db;
        // Load cached data immediately
        loadCachedData(db);
        // Seed the queued-count badge so the UI doesn't show "0" on cold mount.
        refreshQueuedCount();
      })
      .catch((err) => clientLogger.error(LOG_PREFIX + 'Failed to open IndexedDB:', err));
  }, [refreshQueuedCount]);

  // ── Online/offline listeners ────────────────────────────────────────────────
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      // Trigger sync when we come back online
      if (dbRef.current) drainMutationQueue(dbRef.current);
      // A11-02: also trigger the SERVICE WORKER's queue replay — the
      // SW gets no 'online' event of its own, so without this its
      // 'pending-requests' queue never drained.
      requestServiceWorkerReplay();
    };
    const onOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Mounted while already online with a stale SW queue (e.g. the app
    // was closed when connectivity returned): drain it now.
    if (navigator.onLine) requestServiceWorkerReplay();
    // Periodic background sync (every 5 min when online).
    const interval = setInterval(() => {
      if (navigator.onLine && dbRef.current) {
        drainMutationQueue(dbRef.current);
      }
    }, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  // ── Load cached data from IndexedDB ─────────────────────────────────────────
  async function loadCachedData(db: IDBDatabase) {
    try {
      const out: CachedData = { leads: [], properties: [], deals: [], lastSyncedAt: null };
      await Promise.all(
        (['leads', 'properties', 'deals'] as const).map(async (key) => {
          out[key] = (await idbGet<unknown[]>(db, 'cache', key)) ?? [];
        }),
      );
      const lastSyncedAt = await idbGet<string>(db, 'cache', 'lastSyncedAt');
      out.lastSyncedAt = lastSyncedAt ? new Date(lastSyncedAt) : null;
      setCachedData(out);
    } catch (err) {
      clientLogger.warn(LOG_PREFIX + 'Could not load cached data:', err);
    }
  }

  // ── Fetch fresh data from server and cache it ─────────────────────────────
  const fetchAndCache = useCallback(async (db: IDBDatabase) => {
    // The cached page-1 slice is the useful "see your recent stuff
    // while offline" data. `limit` is not a param these routes read
    // (DEFECT-0168): they page with `pageSize`, capped at 100 by the
    // server. Each route answers with its own collection field, so the
    // URL and the response field both derive from the cache key.
    const keys: Array<'leads' | 'properties' | 'deals'> = ['leads', 'properties', 'deals'];

    const results: Partial<CachedData> = {};

    await Promise.allSettled(
      keys.map(async (key) => {
        try {
          const res = await fetch(`/api/${key}?page=1&pageSize=100`, { credentials: 'include' });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const data = await res.json();
          const arr = (data as any)?.[key] ?? (data as any)?.data ?? [];
          results[key] = arr;
          await idbSet(db, 'cache', key, arr);
        } catch {
          // Keep stale cache for this key
        }
      })
    );

    const now = new Date().toISOString();
    await idbSet(db, 'cache', 'lastSyncedAt', now);

    // `results` only carries keys whose fetch succeeded, so spreading
    // it over the previous cache keeps stale data for failed routes.
    setCachedData((prev) => ({ ...prev, ...results, lastSyncedAt: new Date(now) }));
  }, []);

  // ── Drain the mutation queue ─────────────────────────────────────────────────
  const drainMutationQueue = useCallback(async (db: IDBDatabase) => {
    if (!navigator.onLine) return;
    setSyncStatus('syncing');

    try {
      const mutations = await idbGetAll<QueuedMutation>(db, 'mutations');
      mutations.sort((a, b) => a.timestamp - b.timestamp);

      for (const mutation of mutations) {
        try {
          // Backfill an idempotency key for legacy v1 rows that pre-date
          // the schema change. Persist the backfilled key so subsequent
          // retries (e.g. after a 5xx) reuse the same value.
          let idempotencyKey = mutation.idempotencyKey;
          if (!idempotencyKey) {
            idempotencyKey = generateIdempotencyKey();
            await idbAddMutation(db, { ...mutation, idempotencyKey });
          }

          // Replay via apiRequest so we inherit the central CSRF +
          // Idempotency-Key + 401-retry plumbing. Pass the stored key
          // explicitly (NOT `idempotent: true`) — the whole point of
          // persisting the key is that every drain attempt for this
          // queued mutation hits the server with the same value, and
          // the server collapses duplicates into one effect.
          //
          // We swallow errors from apiRequest (which throws on !ok) and
          // mirror the original status-code branching by inspecting
          // err.message ("404: …", "500: …"). apiRequest throws
          // `${status}: ${message}` for HTTP errors; anything else
          // (network / abort) means the request never landed → rethrow
          // so the outer catch leaves the mutation queued and bails.
          const isHttpError = await apiRequest(
            mutation.method,
            mutation.url,
            mutation.body,
            { idempotencyKey },
          ).then(
            () => false,
            (err) => {
              if (!/^\d{3}:/.test((err as Error)?.message ?? "")) throw err;
              return true;
            },
          );

          if (!isHttpError) {
            await idbDelete(db, 'mutations', mutation.id);
          } else if (mutation.retries >= 3) {
            // Give up after 3 retries on persistent HTTP errors
            await idbDelete(db, 'mutations', mutation.id);
            clientLogger.warn(LOG_PREFIX + 'Dropped mutation after 3 retries:', mutation.url);
          } else {
            // Increment retry count; preserve the idempotencyKey so
            // the next attempt collapses with prior ones server-side.
            await idbAddMutation(db, {
              ...mutation,
              idempotencyKey,
              retries: mutation.retries + 1,
            });
          }
        } catch {
          // Network still down; leave in queue
          break;
        }
      }

      // Refresh cached data after draining
      await fetchAndCache(db);
      await refreshQueuedCount();
      setSyncStatus('idle');
    } catch (err) {
      clientLogger.error(LOG_PREFIX + 'Drain error:', err);
      setSyncStatus('error');
    }
  }, [fetchAndCache, refreshQueuedCount]);

  // ── forceSync ───────────────────────────────────────────────────────────────
  const forceSync = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }
    // drainMutationQueue already sets syncing/idle/error and finishes
    // with fetchAndCache + refreshQueuedCount; the extra pass this
    // wrapper used to make was a duplicate fetch of all three routes.
    await drainMutationQueue(db);
  }, [drainMutationQueue]);

  // ── queueMutation ────────────────────────────────────────────────────────────
  const queueMutation = useCallback(
    async (mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'retries'>) => {
      const db = dbRef.current;
      if (!db) return;

      const full: QueuedMutation = {
        ...mutation,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
        retries: 0,
        // Mint the key ONCE here. If the caller already attempted the
        // mutation optimistically before going offline, ideally they
        // pass that same key in — but most callers won't, so we still
        // get same-key dedupe across drain retries (the more common
        // double-submit vector).
        idempotencyKey: mutation.idempotencyKey ?? generateIdempotencyKey(),
      };

      await idbAddMutation(db, full);
      await refreshQueuedCount();

      // If online, flush immediately
      if (navigator.onLine) {
        await drainMutationQueue(db);
      }
    },
    [drainMutationQueue, refreshQueuedCount]
  );

  return { isOnline, cachedData, syncStatus, forceSync, queueMutation, queuedCount };
}
