import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWA() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);

  // Check how many requests are queued in IndexedDB
  const refreshPendingCount = useCallback(async () => {
    try {
      const db = await openOfflineDb();
      const count = await countOfflineRequests(db);
      setPendingSyncCount(count);
    } catch {
      // IndexedDB not available (SSR or private browsing)
    }
  }, []);

  useEffect(() => {
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    const handleOnline = () => {
      setIsOnline(true);
      refreshPendingCount();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for SW sync-complete messages
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "OFFLINE_SYNC_COMPLETE") {
        setSyncedCount((c) => c + 1);
        refreshPendingCount();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          console.log("[PWA] Service worker registered:", reg.scope);
        })
        .catch((err) => console.error("[PWA] SW registration failed:", err));
    }

    refreshPendingCount();

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
    };
  }, [refreshPendingCount]);

  const promptInstall = async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
      return true;
    }
    return false;
  };

  return {
    canInstall: !!installPrompt,
    isInstalled,
    isIOS,
    isOnline,
    pendingSyncCount,
    syncedCount,
    promptInstall,
    refreshPendingCount,
  };
}

// ---------------------------------------------------------------------------
// IndexedDB helpers (mirror of sw.js, runs in main thread for count checks)
// ---------------------------------------------------------------------------

const OFFLINE_DB_NAME = "acreos-offline";
const OFFLINE_STORE = "pending-requests";

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function countOfflineRequests(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readonly");
    const req = tx.objectStore(OFFLINE_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
