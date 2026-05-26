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
// v2: QueuedMutation now carries an idempotencyKey so drain replays
// collapse to one server-side effect. No store shape changed — the
// version bump simply forces onupgradeneeded to fire so any future
// migration hook has a place to land. Rows persisted by v1 (no
// idempotencyKey) are handled at drain time, see drainMutationQueue.
const DB_VERSION = 2;

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result?.value as T);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAddMutation(db: IDBDatabase, mutation: QueuedMutation): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').put(mutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "k-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
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
      const all = await idbGetAll<QueuedMutation>(db, 'mutations');
      setQueuedCount(all.length);
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
      .catch((err) => clientLogger.error('[OfflineSync] Failed to open IndexedDB:', err));
  }, [refreshQueuedCount]);

  // ── Online/offline listeners ────────────────────────────────────────────────
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      // Trigger sync when we come back online
      if (dbRef.current) drainMutationQueue(dbRef.current);
    };
    const onOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ── Load cached data from IndexedDB ─────────────────────────────────────────
  async function loadCachedData(db: IDBDatabase) {
    try {
      const [leads, properties, deals, lastSyncedAt] = await Promise.all([
        idbGet<unknown[]>(db, 'cache', 'leads'),
        idbGet<unknown[]>(db, 'cache', 'properties'),
        idbGet<unknown[]>(db, 'cache', 'deals'),
        idbGet<string>(db, 'cache', 'lastSyncedAt'),
      ]);
      setCachedData({
        leads: leads ?? [],
        properties: properties ?? [],
        deals: deals ?? [],
        lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
      });
    } catch (err) {
      clientLogger.warn('[OfflineSync] Could not load cached data:', err);
    }
  }

  // ── Fetch fresh data from server and cache it ─────────────────────────────
  const fetchAndCache = useCallback(async (db: IDBDatabase) => {
    const endpoints: Array<{ key: keyof CachedData; url: string }> = [
      // Caps lowered from 500/500/200 to 200/200/100 — the offline
      // primer was pulling ~1MB of JSON on every mount and stalling
      // cold loads on slow cellular. The cached page-1 slice is the
      // useful "see your recent stuff while offline" data anyway.
      { key: 'leads', url: '/api/leads?limit=200' },
      { key: 'properties', url: '/api/properties?limit=200' },
      { key: 'deals', url: '/api/deals?limit=100' },
    ];

    const results: Partial<CachedData> = {};

    await Promise.allSettled(
      endpoints.map(async ({ key, url }) => {
        try {
          const data = await fetchJSON(url);
          const arr =
            (data as any)?.leads ??
            (data as any)?.properties ??
            (data as any)?.deals ??
            (data as any)?.data ??
            [];
          results[key] = arr;
          await idbSet(db, 'cache', key, arr);
        } catch {
          // Keep stale cache for this key
        }
      })
    );

    const now = new Date().toISOString();
    await idbSet(db, 'cache', 'lastSyncedAt', now);

    setCachedData((prev) => ({
      leads: results.leads ?? prev.leads,
      properties: results.properties ?? prev.properties,
      deals: results.deals ?? prev.deals,
      lastSyncedAt: new Date(now),
    }));
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
          // err.message ("404: …", "500: …").
          let succeeded = false;
          let isHttpError = false;
          try {
            await apiRequest(
              mutation.method,
              mutation.url,
              mutation.body,
              { idempotencyKey },
            );
            succeeded = true;
          } catch (err) {
            // apiRequest throws `${status}: ${message}` for HTTP errors.
            // Anything else (network / abort) means the request never
            // landed → leave the mutation in the queue and bail.
            const msg = (err as Error)?.message ?? "";
            isHttpError = /^\d{3}:/.test(msg);
            if (!isHttpError) {
              throw err; // caught below — break the drain loop
            }
          }

          if (succeeded) {
            await idbDelete(db, 'mutations', mutation.id);
          } else if (mutation.retries >= 3) {
            // Give up after 3 retries on persistent HTTP errors
            await idbDelete(db, 'mutations', mutation.id);
            clientLogger.warn('[OfflineSync] Dropped mutation after 3 retries:', mutation.url);
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
      clientLogger.error('[OfflineSync] Drain error:', err);
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
    setSyncStatus('syncing');
    try {
      await drainMutationQueue(db);
      await fetchAndCache(db);
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  }, [drainMutationQueue, fetchAndCache]);

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

  // ── Periodic background sync (every 5 min when online) ───────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine && dbRef.current) {
        drainMutationQueue(dbRef.current);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [drainMutationQueue]);

  return { isOnline, cachedData, syncStatus, forceSync, queueMutation, queuedCount };
}
