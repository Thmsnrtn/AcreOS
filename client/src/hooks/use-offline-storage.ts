/**
 * useOfflineStorage — Capacitor Preferences + IndexedDB offline persistence
 *
 * Uses Capacitor Preferences for small key-value data (settings, tokens) and
 * IndexedDB for larger blobs (photos, visit records). Gracefully handles
 * storage quota limits.
 */

import { useCallback, useRef, useEffect } from "react";
import { isNative } from "@/lib/platform";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseOfflineStorageReturn {
  /** Save a value. Small values use Preferences; large values use IndexedDB. */
  save: (key: string, value: unknown) => Promise<void>;
  /** Load a value by key. Checks Preferences first, then IndexedDB. */
  load: <T = unknown>(key: string) => Promise<T | null>;
  /** Remove a value from both stores. */
  remove: (key: string) => Promise<void>;
  /** Get all stored keys across both stores. */
  getAllKeys: () => Promise<string[]>;
  /** Clear all stored data from both stores. */
  clear: () => Promise<void>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Values larger than this (in bytes of JSON) go to IndexedDB instead of Preferences. */
const LARGE_VALUE_THRESHOLD = 4096;

const IDB_NAME = "acreos-storage";
const IDB_VERSION = 1;
const IDB_STORE = "kv";

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAllKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Capacitor Preferences helpers (lazy-loaded) ─────────────────────────────

async function getPreferences() {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    return Preferences;
  } catch {
    return null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOfflineStorage(): UseOfflineStorageReturn {
  const dbRef = useRef<IDBDatabase | null>(null);

  useEffect(() => {
    openIDB()
      .then((db) => {
        dbRef.current = db;
      })
      .catch((err) => {
        console.warn("[OfflineStorage] Could not open IndexedDB:", err);
      });
  }, []);

  const getDB = useCallback(async (): Promise<IDBDatabase> => {
    if (dbRef.current) return dbRef.current;
    const db = await openIDB();
    dbRef.current = db;
    return db;
  }, []);

  const isLargeValue = useCallback((value: unknown): boolean => {
    try {
      const json = JSON.stringify(value);
      return json.length > LARGE_VALUE_THRESHOLD;
    } catch {
      return true; // If it can't be stringified, treat as large
    }
  }, []);

  // ── save ─────────────────────────────────────────────────────────────────

  const save = useCallback(
    async (key: string, value: unknown): Promise<void> => {
      const large = isLargeValue(value);

      if (large) {
        // Always use IndexedDB for large values
        try {
          const db = await getDB();
          await idbSet(db, key, value);
        } catch (err: any) {
          // Handle quota exceeded
          if (
            err?.name === "QuotaExceededError" ||
            err?.code === 22 ||
            err?.message?.includes("quota")
          ) {
            console.error(
              "[OfflineStorage] Storage quota exceeded. Consider clearing old data.",
            );
          }
          throw err;
        }
        return;
      }

      // Small values: prefer Preferences on native, IndexedDB on web
      if (isNative) {
        const Preferences = await getPreferences();
        if (Preferences) {
          await Preferences.set({ key, value: JSON.stringify(value) });
          return;
        }
      }

      // Web fallback: IndexedDB
      const db = await getDB();
      await idbSet(db, key, value);
    },
    [getDB, isLargeValue],
  );

  // ── load ─────────────────────────────────────────────────────────────────

  const load = useCallback(
    async <T = unknown>(key: string): Promise<T | null> => {
      // Try Preferences first on native (for small values)
      if (isNative) {
        const Preferences = await getPreferences();
        if (Preferences) {
          const { value } = await Preferences.get({ key });
          if (value !== null) {
            try {
              return JSON.parse(value) as T;
            } catch {
              return value as unknown as T;
            }
          }
        }
      }

      // Fall back to IndexedDB
      try {
        const db = await getDB();
        return await idbGet<T>(db, key);
      } catch {
        return null;
      }
    },
    [getDB],
  );

  // ── remove ───────────────────────────────────────────────────────────────

  const remove = useCallback(
    async (key: string): Promise<void> => {
      // Remove from both stores to be thorough
      if (isNative) {
        const Preferences = await getPreferences();
        if (Preferences) {
          await Preferences.remove({ key }).catch(() => {});
        }
      }

      try {
        const db = await getDB();
        await idbDelete(db, key);
      } catch {
        // IndexedDB not available
      }
    },
    [getDB],
  );

  // ── getAllKeys ────────────────────────────────────────────────────────────

  const getAllKeys = useCallback(async (): Promise<string[]> => {
    const keys = new Set<string>();

    // Preferences keys (native only)
    if (isNative) {
      const Preferences = await getPreferences();
      if (Preferences) {
        const { keys: prefKeys } = await Preferences.keys();
        prefKeys.forEach((k: string) => keys.add(k));
      }
    }

    // IndexedDB keys
    try {
      const db = await getDB();
      const idbKeys = await idbGetAllKeys(db);
      idbKeys.forEach((k) => keys.add(k));
    } catch {
      // IndexedDB not available
    }

    return Array.from(keys).sort();
  }, [getDB]);

  // ── clear ────────────────────────────────────────────────────────────────

  const clear = useCallback(async (): Promise<void> => {
    if (isNative) {
      const Preferences = await getPreferences();
      if (Preferences) {
        await Preferences.clear().catch(() => {});
      }
    }

    try {
      const db = await getDB();
      await idbClear(db);
    } catch {
      // IndexedDB not available
    }
  }, [getDB]);

  return { save, load, remove, getAllKeys, clear };
}
