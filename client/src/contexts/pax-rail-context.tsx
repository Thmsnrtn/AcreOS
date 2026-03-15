import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const STORAGE_KEY = "pax-rail-open";
const CONV_STORAGE_KEY = "pax-conversation-id";

export interface RailEntityContext {
  entityType: string;   // "lead" | "deal" | "property" | "campaign"
  entityId: number;
  entityName: string;
  starterPrompt?: string;
}

interface PaxRailContextType {
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  pendingContext: RailEntityContext | null;
  clearPendingContext: () => void;
  openWithContext: (ctx: RailEntityContext) => void;
  activeConversationId: number | null;
  setActiveConversationId: (id: number | null) => void;
}

const PaxRailContext = createContext<PaxRailContextType | null>(null);

export function PaxRailProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpenRaw] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [pendingContext, setPendingContext] = useState<RailEntityContext | null>(null);
  const [activeConversationId, setActiveConversationIdRaw] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(CONV_STORAGE_KEY);
      return stored ? parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  });

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

  const setActiveConversationId = useCallback((id: number | null) => {
    setActiveConversationIdRaw(id);
    try {
      if (id !== null) {
        localStorage.setItem(CONV_STORAGE_KEY, String(id));
      } else {
        localStorage.removeItem(CONV_STORAGE_KEY);
      }
    } catch {}
  }, []);

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
    <PaxRailContext.Provider value={{
      isOpen, setOpen, toggle,
      pendingContext, clearPendingContext, openWithContext,
      activeConversationId, setActiveConversationId,
    }}>
      {children}
    </PaxRailContext.Provider>
  );
}

export function usePaxRail(): PaxRailContextType {
  const ctx = useContext(PaxRailContext);
  if (!ctx) throw new Error("usePaxRail must be used within PaxRailProvider");
  return ctx;
}
