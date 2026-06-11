/**
 * useScrollRestoration — per-route scroll memory for the big list surfaces
 * (W2-6, t3-uiux-census-2026-06-10).
 *
 * Behavior contract:
 *
 * - **Keying** — position is stored under the route path captured at MOUNT
 *   time (wouter `useLocation`), in sessionStorage. It survives route
 *   remounts and same-tab reloads, and dies with the tab. The key is frozen
 *   at mount because AnimatePresence (`mode="wait"`) keeps the old page
 *   mounted through its exit animation AFTER the location has already moved
 *   to the next route — saving under the live location would poison the
 *   next page's entry.
 *
 * - **Restore** — exactly once per mount, and only after the page reports
 *   `ready` (its list query resolved). The list pages render rows through
 *   `ContentReveal`, which holds the skeleton ≥200ms past `ready` and then
 *   crossfades — so at the moment `ready` flips, the rows do not exist yet
 *   and a naive restore clamps to ~0. The hook therefore polls one rAF at a
 *   time until the scroll range can accommodate the saved offset, with a
 *   {@link RESTORE_DEADLINE_MS} deadline (after which it clamps — the list
 *   may genuinely have shrunk). Data refetches after mount NEVER move the
 *   user: restoration is mount-scoped, so pull-to-refresh / background
 *   invalidation can't yank mid-scroll.
 *
 * - **User wins** — if the user scrolls meaningfully (>40px, beyond browser
 *   clamp noise which lands at ~0) while a restore is still pending, the
 *   pending restore is cancelled rather than yanking them.
 *
 * - **Save** — passive, rAF-throttled scroll listener plus a final write on
 *   unmount. Writes are suppressed until the restore settles so a stray
 *   post-navigation clamp event can't overwrite a good saved offset with 0.
 *   If the page unmounts before data ever arrived, the prior offset is
 *   preserved untouched.
 *
 * - **Container** — window/document scrolls by default (PageShell pages).
 *   Pass `containerRef` when an inner element scrolls instead (e.g. the
 *   Inbox's Radix ScrollArea). The ref may point at the scrolling element
 *   itself OR a stable ancestor of it: the hook resolves
 *   `[data-radix-scroll-area-viewport]` beneath the ref at read time and
 *   listens for scroll in the capture phase, so a viewport that remounts
 *   (empty → filtered → list again) keeps being tracked without rewiring.
 *
 * - **Off switch** — `enabled: false` disables the hook entirely. Use it for
 *   embedded mounts (leads/properties/deals inside the /pipeline door) where
 *   several list pages share one route and window-scroll ownership is
 *   ambiguous.
 *
 * - **Fresh deep-links** (new tab / new session) have no stored entry and
 *   start at the top, untouched.
 *
 * @param ready Pass the page's "rows are renderable" condition — typically
 *   `!isLoading` from the query that feeds the list. Restoration waits for it.
 * @param options.containerRef Scroll container (or stable ancestor of a
 *   Radix ScrollArea). Omit for window-scrolled pages.
 * @param options.enabled Default true. False = hook is a no-op.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "wouter";

const KEY_PREFIX = "acreos:scroll:";

/**
 * How long after `ready` we keep waiting for the list to grow tall enough
 * for the saved offset (skeleton min-hold + crossfade + stagger reveal)
 * before applying a clamped restore.
 */
const RESTORE_DEADLINE_MS = 1500;

/**
 * Pre-restore scroll positions beyond this are treated as intentional user
 * scrolling (browser clamp corrections land at/near 0) and cancel the
 * pending restore instead of yanking the user.
 */
const USER_SCROLL_THRESHOLD_PX = 40;

interface UseScrollRestorationOptions {
  /** Inner scroll container, or a stable ancestor of a Radix ScrollArea. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Default true. False disables saving AND restoring entirely. */
  enabled?: boolean;
}

function readStored(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw == null) return null;
    const y = Number.parseInt(raw, 10);
    return Number.isFinite(y) && y > 0 ? y : null;
  } catch {
    return null; // Safari private mode / storage disabled — feature off.
  }
}

function writeStored(key: string, y: number): void {
  try {
    window.sessionStorage.setItem(key, String(Math.max(0, Math.round(y))));
  } catch {
    // Quota / private mode — restoration silently degrades to no-op.
  }
}

/**
 * Resolve the element that actually scrolls under a container ref. Radix
 * ScrollArea scrolls its Viewport (not its Root), and our ui/scroll-area
 * doesn't expose a viewport ref — so we accept the root or any stable
 * ancestor and find the viewport at read time.
 */
function resolveScrollElement(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  if (el.hasAttribute("data-radix-scroll-area-viewport")) return el;
  return (
    el.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? el
  );
}

export function useScrollRestoration(
  ready: boolean,
  options: UseScrollRestorationOptions = {},
): void {
  const { containerRef, enabled = true } = options;
  const [location] = useLocation();

  // Mount-frozen key — see contract note about AnimatePresence exits.
  const keyRef = useRef(KEY_PREFIX + location);
  // Offset snapshotted at mount, before any save could overwrite it.
  const pendingYRef = useRef<number | null>(null);
  if (pendingYRef.current === null && enabled && typeof window !== "undefined") {
    // Lazy one-time read (null doubles as "not yet read"; readStored never
    // returns null-meaningful values other than "nothing to restore", which
    // we normalize to NaN below to keep the sentinel unambiguous).
    const stored = readStored(keyRef.current);
    pendingYRef.current = stored ?? Number.NaN;
  }
  // True once the restore decision is finished (applied, cancelled, or
  // nothing to restore). Saves are suppressed until then.
  const settledRef = useRef(false);
  const restoreFrameRef = useRef(0);

  // ── Restore once, after the page reports ready ────────────────────────────
  useEffect(() => {
    if (!enabled || !ready || settledRef.current) return;

    const y = pendingYRef.current;
    if (y == null || !Number.isFinite(y)) {
      settledRef.current = true; // Nothing stored — saves may begin.
      return;
    }

    const deadline = performance.now() + RESTORE_DEADLINE_MS;

    const applyScroll = (top: number) => {
      settledRef.current = true;
      if (top <= 0) return;
      if (containerRef) {
        const el = resolveScrollElement(containerRef.current);
        if (el) el.scrollTop = top;
      } else {
        window.scrollTo(0, top);
      }
    };

    const attempt = () => {
      restoreFrameRef.current = 0;
      if (settledRef.current) return; // Cancelled by user scroll.

      const el = containerRef
        ? resolveScrollElement(containerRef.current)
        : (document.scrollingElement as HTMLElement | null);
      const maxScroll = el ? el.scrollHeight - el.clientHeight : 0;

      if (el && maxScroll >= y) {
        applyScroll(y);
        return;
      }
      if (performance.now() >= deadline) {
        // List is genuinely shorter now (rows deleted / filters changed) —
        // clamp to whatever range exists rather than restoring nothing.
        applyScroll(Math.min(y, Math.max(0, maxScroll)));
        return;
      }
      restoreFrameRef.current = requestAnimationFrame(attempt);
    };

    restoreFrameRef.current = requestAnimationFrame(attempt);
    return () => {
      if (restoreFrameRef.current) {
        cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = 0;
      }
    };
  }, [enabled, ready, containerRef]);

  // ── Save: passive rAF-throttled listener + final write on unmount ─────────
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    // Listener host: window, or the (stable) container ancestor. Capture
    // phase on the ancestor sees scrolls from descendants — scroll doesn't
    // bubble — which survives inner ScrollArea remounts.
    const host: HTMLElement | Window | null = containerRef
      ? containerRef.current
      : window;
    if (!host) return;

    const readPosition = (): number => {
      if (!containerRef) return window.scrollY;
      const el = resolveScrollElement(containerRef.current);
      return el ? el.scrollTop : 0;
    };

    let saveFrame = 0;
    const onScroll = () => {
      if (!settledRef.current) {
        // A restore is (or may become) pending. Near-zero events are browser
        // clamp noise after route swaps — ignore them so they can't clobber
        // the stored offset. A real user scroll cancels the restore and
        // hands ownership to the user.
        if (readPosition() <= USER_SCROLL_THRESHOLD_PX) return;
        if (restoreFrameRef.current) {
          cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = 0;
        }
        settledRef.current = true;
      }
      if (saveFrame) return;
      saveFrame = requestAnimationFrame(() => {
        saveFrame = 0;
        writeStored(keyRef.current, readPosition());
      });
    };

    const listenerOptions: AddEventListenerOptions = containerRef
      ? { capture: true, passive: true }
      : { passive: true };
    host.addEventListener("scroll", onScroll, listenerOptions);

    return () => {
      if (saveFrame) cancelAnimationFrame(saveFrame);
      host.removeEventListener("scroll", onScroll, listenerOptions);
      // Final save — but only once settled. If the page never got data (or
      // the user bounced mid-restore), keep the previously stored offset.
      if (settledRef.current) {
        writeStored(keyRef.current, readPosition());
      }
    };
  }, [enabled, containerRef]);
}
