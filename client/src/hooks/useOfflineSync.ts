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

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface QueuedMutation {
  id: string;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timestamp: number;
  retries: number;
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
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME = 'acreos-offline';
const DB_VERSION = 1;

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
  const [cachedData, setCachedData] = useState<CachedData>({
    leads: [],
    properties: [],
    deals: [],
    lastSyncedAt: null,
  });

  const dbRef = useRef<IDBDatabase | null>(null);

  // ── Open DB on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    openDB()
      .then((db) => {
        dbRef.current = db;
        // Load cached data immediately
        loadCachedData(db);
      })
      .catch((err) => console.error('[OfflineSync] Failed to open IndexedDB:', err));
  }, []);

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
      console.warn('[OfflineSync] Could not load cached data:', err);
    }
  }

  // ── Fetch fresh data from server and cache it ─────────────────────────────
  const fetchAndCache = useCallback(async (db: IDBDatabase) => {
    const endpoints: Array<{ key: keyof CachedData; url: string }> = [
      { key: 'leads', url: '/api/leads?limit=500' },
      { key: 'properties', url: '/api/properties?limit=500' },
      { key: 'deals', url: '/api/deals?limit=200' },
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
          const res = await fetch(mutation.url, {
            method: mutation.method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: mutation.body ? JSON.stringify(mutation.body) : undefined,
          });
          if (res.ok) {
            await idbDelete(db, 'mutations', mutation.id);
          } else if (mutation.retries >= 3) {
            // Give up after 3 retries
            await idbDelete(db, 'mutations', mutation.id);
            console.warn('[OfflineSync] Dropped mutation after 3 retries:', mutation.url);
          } else {
            // Increment retry count
            await idbAddMutation(db, { ...mutation, retries: mutation.retries + 1 });
          }
        } catch {
          // Network still down; leave in queue
          break;
        }
      }

      // Refresh cached data after draining
      await fetchAndCache(db);
      setSyncStatus('idle');
    } catch (err) {
      console.error('[OfflineSync] Drain error:', err);
      setSyncStatus('error');
    }
  }, [fetchAndCache]);

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
      };

      await idbAddMutation(db, full);

      // If online, flush immediately
      if (navigator.onLine) {
        await drainMutationQueue(db);
      }
    },
    [drainMutationQueue]
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

  return { isOnline, cachedData, syncStatus, forceSync, queueMutation };
}
