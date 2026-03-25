/**
 * Offline Cache Hook — caches critical data in localStorage for field work.
 * Automatically syncs when connection is restored.
 */

import { useState, useEffect, useCallback } from "react";

const CACHE_PREFIX = "acreos_offline_";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  version: number;
}

interface UseOfflineCacheOptions {
  key: string;
  ttlMs?: number;
}

export function useOfflineCache<T>({ key, ttlMs = CACHE_TTL_MS }: UseOfflineCacheOptions) {
  const cacheKey = CACHE_PREFIX + key;
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [cachedData, setCachedData] = useState<T | null>(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.cachedAt > ttlMs) {
        localStorage.removeItem(cacheKey);
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const updateCache = useCallback((data: T) => {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now(), version: 1 };
    try {
      localStorage.setItem(cacheKey, JSON.stringify(entry));
      setCachedData(data);
    } catch (e) {
      // Storage full — evict oldest entries
      evictOldestEntries();
      try {
        localStorage.setItem(cacheKey, JSON.stringify(entry));
        setCachedData(data);
      } catch { /* storage truly full */ }
    }
  }, [cacheKey]);

  const clearCache = useCallback(() => {
    localStorage.removeItem(cacheKey);
    setCachedData(null);
  }, [cacheKey]);

  return { cachedData, updateCache, clearCache, isOnline };
}

function evictOldestEntries(): void {
  const entries: { key: string; cachedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const entry = JSON.parse(raw);
      entries.push({ key, cachedAt: entry.cachedAt || 0 });
    } catch { /* skip */ }
  }
  entries.sort((a, b) => a.cachedAt - b.cachedAt);
  // Remove oldest 25%
  const toRemove = Math.max(1, Math.floor(entries.length * 0.25));
  for (let i = 0; i < toRemove; i++) {
    localStorage.removeItem(entries[i].key);
  }
}

// Pending actions queue for offline mutations
const PENDING_ACTIONS_KEY = CACHE_PREFIX + "pending_actions";

interface PendingAction {
  id: string;
  url: string;
  method: string;
  body?: any;
  createdAt: number;
}

export function usePendingActions() {
  const [actions, setActions] = useState<PendingAction[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_ACTIONS_KEY) || "[]");
    } catch { return []; }
  });

  const addAction = useCallback((url: string, method: string, body?: any) => {
    const action: PendingAction = {
      id: `pa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      url, method, body,
      createdAt: Date.now(),
    };
    const updated = [...actions, action];
    localStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(updated));
    setActions(updated);
    return action.id;
  }, [actions]);

  const syncPendingActions = useCallback(async () => {
    const remaining: PendingAction[] = [];
    for (const action of actions) {
      try {
        await fetch(action.url, {
          method: action.method,
          headers: { "Content-Type": "application/json" },
          body: action.body ? JSON.stringify(action.body) : undefined,
        });
      } catch {
        remaining.push(action);
      }
    }
    localStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(remaining));
    setActions(remaining);
    return { synced: actions.length - remaining.length, remaining: remaining.length };
  }, [actions]);

  return { pendingActions: actions, addAction, syncPendingActions };
}
