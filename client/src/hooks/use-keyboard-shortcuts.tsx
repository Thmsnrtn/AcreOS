import { useEffect, useCallback, useRef, createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

type ShortcutCallback = () => void;

interface Shortcut {
  key: string;
  description: string;
  callback: ShortcutCallback;
  global?: boolean;
}

interface KeyboardShortcutsContextType {
  shortcuts: Map<string, Shortcut>;
  registerShortcut: (id: string, shortcut: Shortcut) => void;
  unregisterShortcut: (id: string) => void;
  isDialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextType | null>(null);

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Map<string, Shortcut>>(new Map());
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [, setLocation] = useLocation();
  const pendingKeyRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerShortcut = useCallback((id: string, shortcut: Shortcut) => {
    setShortcuts(prev => {
      const next = new Map(prev);
      next.set(id, shortcut);
      return next;
    });
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    setShortcuts(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    registerShortcut("nav-leads", {
      key: "g l",
      description: "Go to Leads",
      callback: () => setLocation("/leads"),
      global: true,
    });
    registerShortcut("nav-properties", {
      key: "g p",
      description: "Go to Properties",
      callback: () => setLocation("/properties"),
      global: true,
    });
    registerShortcut("nav-deals", {
      key: "g d",
      description: "Go to Deals",
      callback: () => setLocation("/deals"),
      global: true,
    });
    registerShortcut("nav-finance", {
      key: "g f",
      description: "Go to Finance",
      callback: () => setLocation("/finance"),
      global: true,
    });
    registerShortcut("nav-dashboard", {
      key: "g h",
      description: "Go to Home/Dashboard",
      callback: () => setLocation("/"),
      global: true,
    });
    registerShortcut("nav-ai", {
      key: "g a",
      description: "Go to AI Command Center",
      callback: () => setLocation("/command-center"),
      global: true,
    });
    registerShortcut("nav-settings", {
      key: "g s",
      description: "Go to Settings",
      callback: () => setLocation("/settings"),
      global: true,
    });
    registerShortcut("show-shortcuts", {
      key: "?",
      description: "Show keyboard shortcuts",
      callback: () => setDialogOpen(true),
      global: true,
    });
    registerShortcut("search-focus", {
      key: "/",
      description: "Focus search",
      callback: () => {
        const searchInput = document.querySelector('[data-testid="input-global-search"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      },
      global: true,
    });

    return () => {
      ["nav-leads", "nav-properties", "nav-deals", "nav-finance", "nav-dashboard", "nav-ai", "nav-settings", "show-shortcuts", "search-focus"].forEach(id => {
        unregisterShortcut(id);
      });
    };
  }, [registerShortcut, unregisterShortcut, setLocation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      
      if (isInput && e.key !== "Escape") {
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        return;
      }

      if (e.key === "Escape") {
        setDialogOpen(false);
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const key = e.key.toLowerCase();
      
      const shortcutList = Array.from(shortcuts.values());
      for (const shortcut of shortcutList) {
        if (shortcut.key === key) {
          e.preventDefault();
          shortcut.callback();
          return;
        }
      }

      if (pendingKeyRef.current) {
        const combo = `${pendingKeyRef.current} ${key}`;
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }

        for (const shortcut of shortcutList) {
          if (shortcut.key === combo) {
            e.preventDefault();
            shortcut.callback();
            return;
          }
        }
      } else {
        const hasComboStartingWith = Array.from(shortcuts.values()).some(s => s.key.startsWith(`${key} `));
        if (hasComboStartingWith) {
          pendingKeyRef.current = key;
          pendingTimerRef.current = setTimeout(() => {
            pendingKeyRef.current = null;
          }, 500);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);

  return (
    <KeyboardShortcutsContext.Provider value={{ shortcuts, registerShortcut, unregisterShortcut, isDialogOpen, setDialogOpen }}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error("useKeyboardShortcuts must be used within KeyboardShortcutsProvider");
  }
  return context;
}

export function useRegisterShortcut(id: string, shortcut: Shortcut) {
  const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts();

  useEffect(() => {
    registerShortcut(id, shortcut);
    return () => unregisterShortcut(id);
  }, [id, shortcut, registerShortcut, unregisterShortcut]);
}
