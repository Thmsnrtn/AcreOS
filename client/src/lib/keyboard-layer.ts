/**
 * Keyboard layer — pure, unit-tested primitives (Tier 3C, elevation blueprint).
 *
 * Three consumers:
 *   1. KeyboardShortcutsProvider (hooks/use-keyboard-shortcuts.tsx) builds its
 *      default G-chord navigation from DOOR_CHORDS AND resolves every keydown
 *      through shortcutTransition, so the tested machine IS the runtime
 *      machine — mapping and behavior can never drift from the tests.
 *   2. useKeyboardLayer (hooks/use-keyboard-layer.ts) drives J/K/Enter
 *      traversal of the Today queue from nextQueueIndex + the suppression
 *      predicates here.
 *   3. useRouteHeadingFocus (hooks/use-route-heading-focus.ts) reuses
 *      isEditableTarget so it never steals focus from a form field.
 *
 * Everything in this file is pure (no DOM globals required at module scope)
 * so the chord state machine and the input-focus suppression rules are
 * directly unit-testable under the node environment.
 */

// ── The five doors (CLAUDE.md doctrine: Today · Map · Deals · Finance · Pax) ─
// G-chord second keys → door routes. "Finance" is the /money door and "Pax"
// is the /ai door (see MOBILE_DOORS in lib/nav-items.ts).
export const DOOR_CHORDS: Record<string, { route: string; label: string }> = {
  t: { route: "/today", label: "Go to Today" },
  m: { route: "/maps", label: "Go to Map" },
  d: { route: "/deals", label: "Go to Deals" },
  f: { route: "/money", label: "Go to Finance" },
  p: { route: "/ai", label: "Go to Pax" },
};

// How long a pending chord prefix waits for its second key before resetting.
export const CHORD_TIMEOUT_MS = 800;

// Pure modifier keydowns (the Shift in "g → Shift → ?") must not disturb a
// pending chord — they're part of producing the next real key, not input.
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "capslock"]);

export interface PendingChord {
  /** The pending prefix key (e.g. "g"). */
  key: string;
  /** Epoch ms when the prefix was pressed (for timeout expiry). */
  at: number;
}

export interface ShortcutResolution {
  pending: PendingChord | null;
  /** The registered shortcut key that fired (e.g. "g t", "?"), or null. */
  match: string | null;
}

/**
 * The chord state machine — THE runtime resolver for every registered
 * shortcut (KeyboardShortcutsProvider feeds it each keydown). Feed it the
 * pending state, the pressed key, a timestamp, and the set of registered
 * shortcut keys ("g t", "?", "/" …):
 *
 *   idle    --prefix key (some "x …" registered)--> pending
 *   pending --second key (within timeoutMs, "x y" registered)--> match "x y"
 *   pending --expired / non-combo key--> falls through to idle handling
 *   any     --single registered key--> match (when no combo completed)
 *   any     --modifier-only key (Shift…)--> state unchanged
 *
 * Deliberately total: any unexpected input resets to idle rather than
 * wedging the machine. A combo completion wins over a single-key match
 * (pending implies the user is mid-chord).
 */
export function shortcutTransition(
  pending: PendingChord | null,
  key: string,
  now: number,
  registeredKeys: Iterable<string>,
  timeoutMs: number = CHORD_TIMEOUT_MS,
): ShortcutResolution {
  const k = key.toLowerCase();
  if (MODIFIER_KEYS.has(k)) return { pending, match: null };
  const keys = registeredKeys instanceof Set ? (registeredKeys as Set<string>) : new Set(registeredKeys);
  if (pending && now - pending.at <= timeoutMs) {
    const combo = `${pending.key} ${k}`;
    if (keys.has(combo)) return { pending: null, match: combo };
  }
  // Idle handling (also the expiry / non-combo fall-through).
  if (keys.has(k)) return { pending: null, match: k };
  for (const registered of keys) {
    if (registered.startsWith(`${k} `)) return { pending: { key: k, at: now }, match: null };
  }
  return { pending: null, match: null };
}

// ── J/K queue traversal ──────────────────────────────────────────────────────
/**
 * Next focused index for a J/K press over a list of `length` items.
 *   - First J lands on 0; first K lands on the last item.
 *   - Clamped at the ends (no wrap — wrapping disorients more than it helps).
 *   - Empty list → null (nothing to focus).
 */
export function nextQueueIndex(
  current: number | null,
  length: number,
  dir: 1 | -1,
): number | null {
  if (length <= 0) return null;
  if (current === null) return dir === 1 ? 0 : length - 1;
  const next = current + dir;
  if (next < 0) return 0;
  if (next > length - 1) return length - 1;
  return next;
}

// ── Suppression predicates ───────────────────────────────────────────────────
// Duck-typed (tagName / isContentEditable / closest) so they're testable
// without constructing real DOM nodes.
interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when the event target is a place the user types — single keys must pass through. */
export function isEditableTarget(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (EDITABLE_TAGS.has(tag)) return true;
  const role = el.getAttribute?.("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  return false;
}

/**
 * True when the event target is an interactive control (button/link/etc.).
 * Enter must keep its native activation on those — the queue layer only
 * opens the focused item when Enter lands on a non-interactive target.
 */
export function isInteractiveTarget(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el !== "object" || typeof el.closest !== "function") return false;
  return !!el.closest(
    'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="menuitem"]',
  );
}

/**
 * Desktop-only gate for the keyboard layer: a fine pointer that can hover.
 * iOS/Android (coarse pointer, no hover) never see the layer, so it can't
 * interfere with on-screen keyboards or double-tap behavior.
 */
export function hasFinePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}
