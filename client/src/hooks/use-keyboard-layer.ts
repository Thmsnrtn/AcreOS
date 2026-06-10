/**
 * useKeyboardLayer — J/K/Enter traversal for a vertical queue (Tier 3C).
 *
 * Desktop-only enhancement (gated on `(hover: hover) and (pointer: fine)`):
 *   J      — move focus down the queue (first press lands on item 0)
 *   K      — move focus up the queue (first press lands on the last item)
 *   Enter  — open the focused item (only when Enter didn't land on an
 *            interactive control — native button/link activation wins)
 *   Escape — clear the queue focus
 *
 * Suppression rules (never interferes with typing or dialogs):
 *   - target is an input / textarea / select / contenteditable / textbox role
 *   - any meta/ctrl/alt modifier is held
 *   - a dialog is open (radix [role="dialog"][data-state="open"])
 *   - the event was already handled (defaultPrevented)
 *
 * The G-chord door navigation is NOT here — it lives in
 * KeyboardShortcutsProvider, built from the same tested DOOR_CHORDS mapping
 * (see lib/keyboard-layer.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasFinePointer,
  isEditableTarget,
  isInteractiveTarget,
  nextQueueIndex,
} from "@/lib/keyboard-layer";

interface UseKeyboardLayerOptions {
  /** Number of traversable items currently rendered. */
  itemCount: number;
  /** Open the item at the focused index (Enter). */
  onOpen: (index: number) => void;
  /** Extra gate — e.g. false while the queue is loading. Default true. */
  enabled?: boolean;
}

function isDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector('[role="dialog"][data-state="open"]');
}

export function useKeyboardLayer({ itemCount, onOpen, enabled = true }: UseKeyboardLayerOptions) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Refs so the single listener never needs re-binding per keystroke.
  const itemCountRef = useRef(itemCount);
  const activeRef = useRef<number | null>(null);
  const onOpenRef = useRef(onOpen);
  itemCountRef.current = itemCount;
  activeRef.current = activeIndex;
  onOpenRef.current = onOpen;

  // Keep the focus index in range as the queue shrinks (items resolved).
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (isDialogOpen()) return;

      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        const next = nextQueueIndex(
          activeRef.current,
          itemCountRef.current,
          key === "j" ? 1 : -1,
        );
        if (next !== null) {
          e.preventDefault();
          setActiveIndex(next);
        }
        return;
      }
      if (e.key === "Enter") {
        // Native activation wins on buttons/links; we only open the focused
        // queue item when Enter lands on a non-interactive target.
        if (isInteractiveTarget(e.target)) return;
        const idx = activeRef.current;
        if (idx !== null && idx >= 0 && idx < itemCountRef.current) {
          e.preventDefault();
          onOpenRef.current(idx);
        }
        return;
      }
      if (e.key === "Escape") {
        if (activeRef.current !== null) setActiveIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);

  const clear = useCallback(() => setActiveIndex(null), []);

  return { activeIndex, setActiveIndex, clear };
}
