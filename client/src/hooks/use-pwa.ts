import { useState, useEffect, useCallback } from "react";
import { clientLogger } from "@/lib/clientLogger";
import { toast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWA() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  // iOS + real Safari specifically. "Add to Home Screen" only exists in
  // Safari's share sheet — Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS),
  // and in-app webviews (Instagram/Gmail/etc., which omit the Safari token)
  // can't do it, so showing them the steps would be a dead end.
  const [isIOSSafari, setIsIOSSafari] = useState(false);
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
    const ua = navigator.userAgent;
    // iPadOS 13+ reports a desktop UA but is still a touch iPad — detect via
    // maxTouchPoints so an iPad in "request desktop site" mode still counts.
    const isIOSDevice =
      (/iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
      !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // Real Safari only — exclude other iOS browser engines and in-app
    // webviews, none of which expose "Add to Home Screen".
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV|Line\//.test(ua);
    setIsIOSSafari(isIOSDevice && isSafari);

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

    // Listen for SW sync-complete and sync-failed messages.
    // OFFLINE_SYNC_COMPLETE: one or more queued requests replayed OK.
    //   count = how many succeeded this drain cycle.
    // OFFLINE_SYNC_FAILED: a queued request got a permanent 4xx and was
    //   dropped. Notify the user so they know the item didn't save.
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "OFFLINE_SYNC_COMPLETE") {
        const count = typeof event.data.count === "number" ? event.data.count : 1;
        setSyncedCount((c) => c + count);
        refreshPendingCount();
      }
      if (event.data?.type === "OFFLINE_SYNC_FAILED") {
        clientLogger.warn("[PWA] Offline request permanently failed:", event.data.url);
        toast({
          title: "Couldn't sync a saved change",
          description: "One offline action was rejected by the server and couldn't be retried. Check your data and try again.",
          duration: 8000,
        });
        refreshPendingCount();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          clientLogger.info("[PWA] Service worker registered:", reg.scope);
        })
        .catch((err) => clientLogger.error("[PWA] SW registration failed:", err));
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
    isIOSSafari,
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
