/**
 * Keyboard layer primitives (Tier 3C, elevation blueprint).
 *
 * client/src/lib/keyboard-layer.ts is the PURE core of the desktop keyboard
 * layer — the same functions run at runtime (KeyboardShortcutsProvider
 * resolves every keydown through shortcutTransition; the Today queue's J/K
 * traversal uses nextQueueIndex; both layers suppress via isEditableTarget /
 * isInteractiveTarget). These tests lock in:
 *
 *   - DOOR_CHORDS: exactly the five doors (CLAUDE.md doctrine), g+first-letter
 *   - shortcutTransition: chord arming, completion, CHORD_TIMEOUT_MS expiry,
 *     re-arming, modifier passthrough, single-key matches
 *   - nextQueueIndex: J/K traversal with end clamping, empty-list safety
 *   - suppression predicates: typing targets and interactive controls
 */

import { describe, it, expect } from "vitest";
import {
  DOOR_CHORDS,
  CHORD_TIMEOUT_MS,
  shortcutTransition,
  nextQueueIndex,
  isEditableTarget,
  isInteractiveTarget,
  type PendingChord,
} from "../../client/src/lib/keyboard-layer";

describe("DOOR_CHORDS — the five doors, nothing else", () => {
  it("maps g+first-letter to exactly the five door routes", () => {
    expect(DOOR_CHORDS).toEqual({
      t: { route: "/today", label: "Go to Today" },
      m: { route: "/maps", label: "Go to Map" },
      d: { route: "/deals", label: "Go to Deals" },
      f: { route: "/money", label: "Go to Finance" },
      p: { route: "/ai", label: "Go to Pax" },
    });
  });
});

// The registered-shortcut universe used by the runtime provider: door
// chords, legacy chords, and the two single-key shortcuts.
const KEYS = [
  ...Object.keys(DOOR_CHORDS).map((k) => `g ${k}`),
  "g l",
  "g i",
  "g h",
  "g s",
  "?",
  "/",
];

describe("shortcutTransition — chord state machine", () => {
  it("arms a pending chord on the prefix key without matching", () => {
    const res = shortcutTransition(null, "g", 1000, KEYS);
    expect(res.match).toBeNull();
    expect(res.pending).toEqual({ key: "g", at: 1000 });
  });

  it("completes a door chord within the timeout", () => {
    const pending: PendingChord = { key: "g", at: 1000 };
    const res = shortcutTransition(pending, "t", 1000 + CHORD_TIMEOUT_MS, KEYS);
    expect(res.match).toBe("g t");
    expect(res.pending).toBeNull();
  });

  it("expires the chord after CHORD_TIMEOUT_MS — the second key is just a key", () => {
    const pending: PendingChord = { key: "g", at: 1000 };
    const res = shortcutTransition(pending, "t", 1000 + CHORD_TIMEOUT_MS + 1, KEYS);
    expect(res.match).toBeNull(); // "t" alone is not registered
    expect(res.pending).toBeNull();
  });

  it("is case-insensitive (Shift-G still arms, T still completes)", () => {
    const armed = shortcutTransition(null, "G", 0, KEYS);
    expect(armed.pending).toEqual({ key: "g", at: 0 });
    const res = shortcutTransition(armed.pending, "T", 100, KEYS);
    expect(res.match).toBe("g t");
  });

  it("a fresh prefix key re-arms instead of wedging", () => {
    const pending: PendingChord = { key: "g", at: 1000 };
    const res = shortcutTransition(pending, "g", 1500, KEYS);
    expect(res.match).toBeNull();
    expect(res.pending).toEqual({ key: "g", at: 1500 });
  });

  it("a non-combo second key resets to idle (no swallow loop)", () => {
    const pending: PendingChord = { key: "g", at: 1000 };
    const res = shortcutTransition(pending, "x", 1100, KEYS);
    expect(res.match).toBeNull();
    expect(res.pending).toBeNull();
  });

  it("matches single-key shortcuts directly", () => {
    expect(shortcutTransition(null, "?", 0, KEYS).match).toBe("?");
    expect(shortcutTransition(null, "/", 0, KEYS).match).toBe("/");
  });

  it("modifier-only keydowns pass through without disturbing a pending chord", () => {
    // "g" then Shift (to produce "?") must keep the chord alive.
    const pending: PendingChord = { key: "g", at: 1000 };
    for (const mod of ["Shift", "Control", "Alt", "Meta"]) {
      const res = shortcutTransition(pending, mod, 1100, KEYS);
      expect(res.match).toBeNull();
      expect(res.pending).toBe(pending);
    }
  });

  it("unregistered keys leave the machine idle", () => {
    const res = shortcutTransition(null, "q", 0, KEYS);
    expect(res).toEqual({ pending: null, match: null });
  });
});

describe("nextQueueIndex — J/K traversal", () => {
  it("returns null for an empty queue", () => {
    expect(nextQueueIndex(null, 0, 1)).toBeNull();
    expect(nextQueueIndex(null, 0, -1)).toBeNull();
    expect(nextQueueIndex(2, 0, 1)).toBeNull();
  });

  it("first J lands on the first item, first K on the last", () => {
    expect(nextQueueIndex(null, 5, 1)).toBe(0);
    expect(nextQueueIndex(null, 5, -1)).toBe(4);
  });

  it("steps and clamps at the ends — no wrap", () => {
    expect(nextQueueIndex(0, 5, 1)).toBe(1);
    expect(nextQueueIndex(4, 5, 1)).toBe(4);
    expect(nextQueueIndex(1, 5, -1)).toBe(0);
    expect(nextQueueIndex(0, 5, -1)).toBe(0);
  });
});

describe("isEditableTarget — typing suppression", () => {
  it("suppresses inputs, textareas, selects, contenteditable, textbox roles", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", getAttribute: () => "textbox" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", getAttribute: () => "combobox" })).toBe(true);
  });

  it("lets ordinary targets through", () => {
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON", getAttribute: () => null })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

describe("isInteractiveTarget — Enter keeps native activation", () => {
  it("is true when the target sits inside an interactive control", () => {
    expect(isInteractiveTarget({ closest: () => ({}) })).toBe(true);
  });

  it("is false for non-interactive targets and non-elements", () => {
    expect(isInteractiveTarget({ closest: () => null })).toBe(false);
    expect(isInteractiveTarget({})).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});
