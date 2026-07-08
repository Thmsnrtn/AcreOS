import { useEffect, useCallback, useRef, createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { DOOR_CHORDS, shortcutTransition, isEditableTarget, type PendingChord } from "@/lib/keyboard-layer";

type ShortcutCallback = () => void;

interface Shortcut {
  key: string;
  description: string;
  callback: ShortcutCallback;
  global?: boolean;
  meta?: boolean;
}

interface KeyboardShortcutsContextType {
  shortcuts: Map<string, Shortcut>;
  registerShortcut: (id: string, shortcut: Shortcut) => void;
  unregisterShortcut: (id: string) => void;
  isDialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  isNewMenuOpen: boolean;
  setNewMenuOpen: (open: boolean) => void;
  triggerSidebarToggle: () => void;
  onSidebarToggle: (callback: () => void) => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextType | null>(null);

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Map<string, Shortcut>>(new Map());
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isNewMenuOpen, setNewMenuOpen] = useState(false);
  const [, setLocation] = useLocation();
  // Pending chord prefix ("g" awaiting its second key). Expiry is
  // timestamp-based inside shortcutTransition — no timer to manage.
  const pendingChordRef = useRef<PendingChord | null>(null);
  const initializedRef = useRef(false);
  const sidebarToggleCallbackRef = useRef<(() => void) | null>(null);

  const registerShortcut = useCallback((id: string, shortcut: Shortcut) => {
    setShortcuts(prev => {
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, shortcut);
      return next;
    });
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    setShortcuts(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const triggerSidebarToggle = useCallback(() => {
    if (sidebarToggleCallbackRef.current) {
      sidebarToggleCallbackRef.current();
    }
  }, []);

  const onSidebarToggle = useCallback((callback: () => void) => {
    sidebarToggleCallbackRef.current = callback;
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // The five doors come from the SAME tested mapping the keyboard-layer
    // unit tests lock down (lib/keyboard-layer.ts DOOR_CHORDS): g t/m/d/f/p →
    // Today/Map/Deals/Finance/Pax. Runtime and tests can't drift.
    const doorShortcuts: Array<[string, Shortcut]> = Object.entries(DOOR_CHORDS).map(
      ([secondKey, door]) => [
        `nav-door-${secondKey}`,
        { key: `g ${secondKey}`, description: door.label, callback: () => setLocation(door.route), global: true },
      ],
    );
    const defaultShortcuts: Array<[string, Shortcut]> = [
      ...doorShortcuts,
      // Non-door legacy chords kept for muscle memory; they deep-link to
      // surfaces that live BEHIND doors (leads under Deals, etc.).
      ["nav-leads", { key: "g l", description: "Go to Leads", callback: () => setLocation("/leads"), global: true }],
      ["nav-inbox", { key: "g i", description: "Go to Inbox", callback: () => setLocation("/inbox"), global: true }],
      ["nav-dashboard", { key: "g h", description: "Go to Today", callback: () => setLocation("/today"), global: true }],
      ["nav-settings", { key: "g s", description: "Go to Settings", callback: () => setLocation("/settings"), global: true }],
      ["show-shortcuts", { key: "?", description: "Show keyboard shortcuts", callback: () => setDialogOpen(true), global: true }],
      ["search-focus", { key: "/", description: "Focus search", callback: () => {
        const searchInput = document.querySelector('[data-testid="input-global-search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }, global: true }],
    ];

    setShortcuts(new Map(defaultShortcuts));
  }, [setLocation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDialogOpen(false);
        setNewMenuOpen(false);
        pendingChordRef.current = null;
        return;
      }

      // Allow meta/ctrl combos even when in input fields
      if ((e.metaKey || e.ctrlKey)) {
        if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          setNewMenuOpen(prev => !prev);
          return;
        }
        if (e.key === "o" || e.key === "O") {
          // ⌘O — Quick Offer (per HANDOFF demo script step 3)
          e.preventDefault();
          import("@/stores/modal-store").then(({ useModals }) => {
            useModals.getState().openQuickOffer();
          });
          return;
        }
        if (e.key === "/") {
          e.preventDefault();
          triggerSidebarToggle();
          return;
        }
        if (e.key === "j" || e.key === "J") {
          e.preventDefault();
          setLocation("/ai");
          return;
        }
        // Other meta/ctrl combos belong to the browser (⌘G find-again,
        // ⌘S save dialog…) — never arm a chord or fire a single-key
        // shortcut from them.
        return;
      }
      
      // Only skip vim-style shortcuts (no meta key) while the user is typing.
      // isEditableTarget is the same tested predicate the Today queue layer
      // uses (input/textarea/select/contenteditable/textbox roles).
      if (!e.metaKey && !e.ctrlKey && isEditableTarget(e.target)) {
        pendingChordRef.current = null;
        return;
      }

      if (e.altKey) {
        return;
      }

      // Resolve through the pure, unit-tested chord machine
      // (lib/keyboard-layer.ts): single keys ("?", "/"), G-chords
      // ("g t" … "g s"), CHORD_TIMEOUT_MS expiry, modifier passthrough.
      const { pending, match } = shortcutTransition(
        pendingChordRef.current,
        e.key,
        Date.now(),
        Array.from(shortcuts.values(), (s) => s.key),
      );
      pendingChordRef.current = pending;
      if (match) {
        for (const shortcut of shortcuts.values()) {
          if (shortcut.key === match) {
            e.preventDefault();
            shortcut.callback();
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, triggerSidebarToggle, setLocation]);

  return (
    <KeyboardShortcutsContext.Provider value={{ 
      shortcuts, 
      registerShortcut, 
      unregisterShortcut, 
      isDialogOpen, 
      setDialogOpen,
      isNewMenuOpen,
      setNewMenuOpen,
      triggerSidebarToggle,
      onSidebarToggle,
    }}>
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
