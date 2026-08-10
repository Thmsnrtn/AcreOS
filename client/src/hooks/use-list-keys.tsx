/**
 * useListKeys — the door-list keyboard grammar (Wave 1.3, handoff P1 §2.4).
 *
 * Generalizes hooks/use-keyboard-layer.ts (the Today queue's original
 * J/K/Enter layer) into the grammar every door list shares, composing the
 * SAME pure, unit-tested primitives from lib/keyboard-layer.ts — never a
 * fork of them:
 *
 *   J        — move focus down (first press lands on item 0)
 *   K        — move focus up (first press lands on the last item)
 *   Enter    — open the focused item (native button/link activation wins)
 *   Escape   — clear the list focus
 *   <action> — caller-declared single keys on the focused row
 *              (Today: "s" snooze · Inbox: "e" archive)
 *   ?        — toggle the door's key-grammar overlay (ListKeyGrammarOverlay)
 *
 * Desktop-only (gated on `(hover: hover) and (pointer: fine)`); suppressed
 * while typing, while any dialog is open, and when a modifier other than
 * Shift is held (Shift is how "?" is typed).
 *
 * TWO listeners, and the split matters: "?" alone registers in the CAPTURE
 * phase, because "?" is also registered globally (KeyboardShortcutsProvider
 * opens the app-wide shortcuts dialog) and on a door that documents its own
 * grammar the door overlay must win. Every OTHER key listens in the bubble
 * phase — exactly where use-keyboard-layer listened — so a nested component
 * that owns j/k/Enter/Escape can still suppress this layer with
 * preventDefault/stopPropagation. (Registering everything on capture, as the
 * first draft did, silently outranked every inner owner and made the
 * defaultPrevented guard unreachable.)
 *
 * "?" is the ONLY key we stopPropagation on — global chords ("g d" …) keep
 * working. Because the overlay replaces the global dialog on these doors, it
 * renders the app-wide shortcuts too (see GLOBAL_KEY_GRAMMAR), so nothing
 * becomes undiscoverable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasFinePointer,
  isEditableTarget,
  isInteractiveTarget,
  nextQueueIndex,
} from "@/lib/keyboard-layer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Keyboard } from "lucide-react";
import { DOOR_CHORDS } from "@/lib/keyboard-layer";

export interface UseListKeysOptions {
  /** Number of traversable items currently rendered. */
  itemCount: number;
  /** Open the item at the focused index (Enter). */
  onOpen: (index: number) => void;
  /**
   * Extra single-key actions on the FOCUSED row, keyed by lowercase key
   * (e.g. `{ s: snooze, e: archive }`). Only fire while a row is focused.
   * Reserved keys (j/k/enter/escape/?) are ignored if passed.
   */
  actionKeys?: Record<string, (index: number) => void>;
  /** "?" — toggle the door's key-grammar overlay. Omit to leave "?" global. */
  onHelp?: () => void;
  /** Extra gate — e.g. false while the list is loading. Default true. */
  enabled?: boolean;
}

/** Keys the traversal grammar owns — action keys may not shadow them. */
const RESERVED_KEYS = new Set(["j", "k", "enter", "escape", "?"]);

function isDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector('[role="dialog"][data-state="open"]');
}

/**
 * Pure single-keydown resolution — exported for unit tests so the grammar
 * is testable without a DOM listener. Mirrors exactly what the hook's
 * listener does with a real KeyboardEvent.
 */
export type ListKeyResolution =
  | { kind: "none" }
  | { kind: "move"; nextIndex: number }
  | { kind: "open"; index: number }
  | { kind: "action"; key: string; index: number }
  | { kind: "clear" }
  | { kind: "help" };

export function resolveListKey(input: {
  key: string;
  activeIndex: number | null;
  itemCount: number;
  hasHelp: boolean;
  actionKeySet: ReadonlySet<string>;
  /** Enter only opens when it did NOT land on an interactive control. */
  targetIsInteractive: boolean;
}): ListKeyResolution {
  const key = input.key.toLowerCase();
  if (key === "?" && input.hasHelp) return { kind: "help" };
  if (key === "j" || key === "k") {
    const next = nextQueueIndex(input.activeIndex, input.itemCount, key === "j" ? 1 : -1);
    return next === null ? { kind: "none" } : { kind: "move", nextIndex: next };
  }
  if (key === "enter") {
    if (input.targetIsInteractive) return { kind: "none" };
    const idx = input.activeIndex;
    if (idx !== null && idx >= 0 && idx < input.itemCount) return { kind: "open", index: idx };
    return { kind: "none" };
  }
  if (key === "escape") {
    return input.activeIndex !== null ? { kind: "clear" } : { kind: "none" };
  }
  if (!RESERVED_KEYS.has(key) && input.actionKeySet.has(key)) {
    const idx = input.activeIndex;
    if (idx !== null && idx >= 0 && idx < input.itemCount) {
      return { kind: "action", key, index: idx };
    }
  }
  return { kind: "none" };
}

export function useListKeys({
  itemCount,
  onOpen,
  actionKeys,
  onHelp,
  enabled = true,
}: UseListKeysOptions) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Refs so the single listener never needs re-binding per keystroke.
  const itemCountRef = useRef(itemCount);
  const activeRef = useRef<number | null>(null);
  const onOpenRef = useRef(onOpen);
  const actionKeysRef = useRef(actionKeys);
  const onHelpRef = useRef(onHelp);
  itemCountRef.current = itemCount;
  activeRef.current = activeIndex;
  onOpenRef.current = onOpen;
  actionKeysRef.current = actionKeys;
  onHelpRef.current = onHelp;

  // Keep the focus index in range as the list shrinks (items resolved).
  useEffect(() => {
    if (activeIndex !== null && activeIndex > itemCount - 1) {
      setActiveIndex(itemCount > 0 ? itemCount - 1 : null);
    }
  }, [itemCount, activeIndex]);

  useEffect(() => {
    if (!enabled) return;
    if (!hasFinePointer()) return; // touch-first devices never mount the layer

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // Shift allowed — "?" needs it
      if (isEditableTarget(e.target)) return;
      // A handler nearer the event's target already dealt with this key.
      // Only reachable on the BUBBLE listener below — which is exactly why
      // the list keys must not ride the capture listener (fleet-8 verifier
      // catch: capture-phase registration silently took precedence over
      // every inner owner and made this guard unreachable).
      if (e.defaultPrevented) return;

      if (isDialogOpen()) return;

      const resolution = resolveListKey({
        key: e.key,
        activeIndex: activeRef.current,
        itemCount: itemCountRef.current,
        hasHelp: false, // "?" already handled above
        actionKeySet: new Set(Object.keys(actionKeysRef.current ?? {})),
        targetIsInteractive: isInteractiveTarget(e.target),
      });

      switch (resolution.kind) {
        case "move":
          e.preventDefault();
          setActiveIndex(resolution.nextIndex);
          return;
        case "open":
          e.preventDefault();
          onOpenRef.current(resolution.index);
          return;
        case "action":
          e.preventDefault();
          actionKeysRef.current?.[resolution.key]?.(resolution.index);
          return;
        case "clear":
          setActiveIndex(null);
          return;
        default:
          return;
      }
    };

    // TWO listeners, deliberately (fleet-8 verifier catch). Only "?" needs
    // to win against the global shortcuts provider, so only "?" rides the
    // CAPTURE phase. Everything else stays on the BUBBLE phase, exactly
    // where the pre-wave hook listened, so any inner component that owns
    // j/k/Enter/Escape can still suppress the layer with preventDefault /
    // stopPropagation. A capture listener for all keys would have quietly
    // stripped that ability from every nested owner.
    const handleHelpKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "?" || !onHelpRef.current) return;
      if (isEditableTarget(e.target)) return;
      // Toggle-to-close: resolved before the dialog gate on purpose.
      e.preventDefault();
      e.stopPropagation();
      onHelpRef.current();
    };

    window.addEventListener("keydown", handleHelpKey, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleHelpKey, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);

  const clear = useCallback(() => setActiveIndex(null), []);

  return { activeIndex, setActiveIndex, clear };
}

// ─── "?" grammar overlay ─────────────────────────────────────────────────

export interface KeyGrammarEntry {
  /** Space-separated key parts, e.g. "j", "enter", "g d". */
  keys: string;
  label: string;
}

/**
 * The app-wide chords that are NOT door chords. Because a door's "?" opens
 * this overlay instead of KeyboardShortcutsProvider's dialog, these would
 * otherwise be undiscoverable on that door — so they render here too. The
 * list mirrors the non-door `global: true` registrations in
 * use-keyboard-shortcuts.tsx and is pinned against them by the exit test.
 */
export const GLOBAL_KEY_GRAMMAR: KeyGrammarEntry[] = [
  { keys: "g l", label: "Leads" },
  { keys: "g i", label: "Inbox" },
  { keys: "g h", label: "Today" },
  { keys: "g s", label: "Settings" },
  { keys: "/", label: "Focus search" },
];

/**
 * The door's "?" overlay: documents this list's key grammar, the
 * always-available door chords, AND the app-wide chords this overlay
 * displaces, in one quiet dialog. Purely presentational — the page owns the
 * open state (toggled by useListKeys' onHelp).
 */
export function ListKeyGrammarOverlay({
  open,
  onOpenChange,
  title,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  entries: KeyGrammarEntry[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="dialog-list-key-grammar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <ul className="space-y-2 list-none p-0 m-0">
          {entries.map((entry) => (
            <li key={entry.keys} className="flex items-center justify-between gap-3">
              <span className="text-sm">{entry.label}</span>
              <span className="flex items-center gap-1">
                {entry.keys.split(" ").map((part, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-muted-foreground text-xs">then</span>
                    )}
                    <Kbd>{part === "enter" ? "↵" : part === "escape" ? "esc" : part.toUpperCase()}</Kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground border-t pt-3">
          Doors:{" "}
          {Object.entries(DOOR_CHORDS).map(([key, door], i) => (
            <span key={key}>
              {i > 0 && " · "}
              <Kbd size="sm">g</Kbd> <Kbd size="sm">{key.toUpperCase()}</Kbd>{" "}
              {door.label.replace("Go to ", "")}
            </span>
          ))}
        </p>
        {/* This overlay REPLACES the global shortcuts dialog on doors that
            own "?", so it must carry the app-wide chords too — otherwise
            they become undiscoverable exactly here (fleet-8 verifier
            catch). Kept in sync by doorInteractions.test.tsx, which reads
            the real registrations out of use-keyboard-shortcuts. */}
        <p className="text-xs text-muted-foreground">
          Everywhere:{" "}
          {GLOBAL_KEY_GRAMMAR.map((entry, i) => (
            <span key={entry.keys}>
              {i > 0 && " · "}
              {entry.keys.split(" ").map((part, j) => (
                <span key={j}>
                  {j > 0 && " "}
                  <Kbd size="sm">{part}</Kbd>
                </span>
              ))}{" "}
              {entry.label}
            </span>
          ))}
        </p>
      </DialogContent>
    </Dialog>
  );
}
