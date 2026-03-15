import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const STORAGE_KEY = "sophie-rail-open";

export interface RailEntityContext {
  entityType: string;   // "lead" | "deal" | "property" | "campaign"
  entityId: number;
  entityName: string;
  starterPrompt?: string;
}

interface SophieRailContextType {
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  pendingContext: RailEntityContext | null;
  clearPendingContext: () => void;
  openWithContext: (ctx: RailEntityContext) => void;
}

const SophieRailContext = createContext<SophieRailContextType | null>(null);

export function SophieRailProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpenRaw] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [pendingContext, setPendingContext] = useState<RailEntityContext | null>(null);

  const setOpen = useCallback((v: boolean) => {
    setIsOpenRaw(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(v));
    } catch {}
  }, []);

  const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);

  const openWithContext = useCallback((ctx: RailEntityContext) => {
    setPendingContext(ctx);
    setOpen(true);
  }, [setOpen]);

  const clearPendingContext = useCallback(() => setPendingContext(null), []);

  // Global keyboard shortcut: ⌘J / Ctrl+J
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setOpen(!isOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, setOpen]);

  return (
    <SophieRailContext.Provider value={{ isOpen, setOpen, toggle, pendingContext, clearPendingContext, openWithContext }}>
      {children}
    </SophieRailContext.Provider>
  );
}

export function useSophieRail(): SophieRailContextType {
  const ctx = useContext(SophieRailContext);
  if (!ctx) throw new Error("useSophieRail must be used within SophieRailProvider");
  return ctx;
}
