/**
 * Atlas Dock — Phase D.
 *
 * A collapsible chat surface that follows Tom across every founder
 * page so he never has to leave context to ask Atlas a question. The
 * same useFounderChat + Composer + MessageList primitives the /founder
 * landing uses, just rendered in a side rail (desktop ≥md) or a
 * bottom-sheet (mobile <md).
 *
 *   ┌── desktop ────────────────────────────────┐  ┌── mobile ─────┐
 *   │           page content              dock  │  │  page content │
 *   │                                   ┌─────┐ │  │               │
 *   │                                   │     │ │  │ ─drag handle─ │
 *   │                                   │ chat│ │  │     chat      │
 *   │                                   │     │ │  │   composer    │
 *   │                                   └─────┘ │  └───────────────┘
 *   │                                  [bubble] │
 *   └───────────────────────────────────────────┘
 *
 * Persists open/closed state in localStorage so a refresh on the same
 * page keeps the dock where Tom left it. Default is closed on first
 * paint so we don't ambush him.
 *
 * The trigger bubble lives in the bottom-right (desktop) / bottom-left
 * (mobile, above the bottom nav). A tiny badge appears when Atlas has
 * posted while the dock was closed — computed from a "lastSeen" cursor
 * vs. the default thread's lastActivityAt.
 *
 * Design language is the elite-Apple-developer bar set in
 * lib/motion.ts: SPRING_SOFT for the panel slide, REVEAL_FROM_BELOW
 * for the bubble, TAP_PRESS for the press-down, 44pt touch targets.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  REVEAL_FROM_BELOW,
  SPRING_INTERACTIVE,
  SPRING_SOFT,
  TAP_PRESS,
} from "@/lib/motion";
import {
  useRespectfulTransition,
  useRespectfulVariants,
} from "@/lib/motion-tokens";
import { TOUCH_TARGET_PT } from "@/lib/spacing";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFounderChat, type ChatPageContext } from "@/hooks/use-founder-chat";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import { Composer } from "@/components/founder-chat/Composer";
import { MessageList } from "@/components/founder-chat/MessageList";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import {
  readStoredOpen,
  writeStoredOpen,
  readLastSeen,
  writeLastSeen,
  MOBILE_DRAG_DISMISS_PX,
} from "@/components/founder-chat/dock-storage";

// Re-export the storage helpers so existing consumers/tests that import
// from Dock keep working without juggling two paths.
export {
  readStoredOpen,
  writeStoredOpen,
} from "@/components/founder-chat/dock-storage";

export interface DockProps {
  pageContext?: ChatPageContext;
  /**
   * Pre-fill the composer when the dock opens — used by the
   * "Discuss with Atlas" affordances on artifact cards.
   * Sticky for one open cycle; clears once Tom sends or dismisses.
   */
  prefillMessage?: string;
}

export function Dock({ pageContext, prefillMessage }: DockProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState<boolean>(false);

  // Respect prefers-reduced-motion: the trigger bubble + panel slide
  // both collapse to instant when the OS reports reduce.
  const triggerVariants = useRespectfulVariants(REVEAL_FROM_BELOW);
  const triggerTransition = useRespectfulTransition(SPRING_INTERACTIVE);
  const panelTransition = useRespectfulTransition(SPRING_SOFT);

  // Hydrate persisted open state once on mount. Done in effect (not
  // useState initializer) so SSR + first-paint stay deterministic.
  useEffect(() => {
    setOpen(readStoredOpen());
  }, []);

  const setOpenPersisted = useCallback((next: boolean) => {
    setOpen(next);
    writeStoredOpen(next);
  }, []);

  const { threads } = useFounderChatThreads();
  const defaultThread = useMemo(
    () => threads.find((t) => t.isDefault) ?? threads[0],
    [threads],
  );
  const threadId = defaultThread?.id ?? null;

  const {
    messages,
    sendMessage,
    isStreaming,
    activeToolCalls,
    status,
  } = useFounderChat(threadId);

  // Wrap sendMessage so every dock-originated turn auto-attaches the
  // current pageContext. The page that mounts the dock supplies the
  // context via the prop; we forward it verbatim.
  const sendFromDock = useCallback(
    async (text: string) => {
      await sendMessage(text, pageContext ? { pageContext } : undefined);
    },
    [sendMessage, pageContext],
  );

  // ─── Unread badge ─────────────────────────────────────────────────────────
  // Atlas may post while the dock is closed (e.g. background-task
  // completion in a later phase). We track the last-seen activity
  // timestamp in localStorage and show a small badge when the thread's
  // lastActivityAt has advanced past it.
  const lastActivityMs = defaultThread?.lastActivityAt
    ? new Date(defaultThread.lastActivityAt).getTime()
    : 0;
  const [badgeCount, setBadgeCount] = useState(0);
  useEffect(() => {
    if (!threadId) return;
    if (open) {
      // While open, treat as continuously read.
      writeLastSeen(threadId, Date.now());
      setBadgeCount(0);
      return;
    }
    const seen = readLastSeen(threadId);
    setBadgeCount(lastActivityMs > seen ? 1 : 0);
  }, [threadId, lastActivityMs, open]);

  // ─── Composer prefill ─────────────────────────────────────────────────────
  // When the dock opens with a prefill message (e.g. from a "Discuss
  // with Atlas →" affordance), we surface it via the key prop on the
  // Composer so it remounts with the seeded text. The Composer doesn't
  // accept a controlled value, so the simplest stable surface is to
  // pass the prefill as the placeholder + key — but we want the text
  // actually IN the field. Solution: send immediately on open if a
  // prefill is supplied AND the thread is hydrated, leaving Tom with
  // a normal empty composer and the seeded question already in flight.
  const prefillFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !prefillMessage || !threadId) return;
    if (prefillFiredRef.current === prefillMessage) return;
    prefillFiredRef.current = prefillMessage;
    void sendFromDock(prefillMessage);
  }, [open, prefillMessage, threadId, sendFromDock]);

  // ─── Auto-open when an artifact card publishes "atlas:discuss" ───────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setOpenPersisted(true);
    window.addEventListener("atlas:discuss", handler);
    return () => window.removeEventListener("atlas:discuss", handler);
  }, [setOpenPersisted]);

  // ─── Keyboard: ESC closes (desktop) ───────────────────────────────────────
  useEffect(() => {
    if (!open || isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPersisted(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isMobile, setOpenPersisted]);

  // ─── Mobile drag-to-dismiss ───────────────────────────────────────────────
  const dragStartY = useRef<number | null>(null);
  const dragDeltaY = useRef(0);
  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    dragDeltaY.current = 0;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onHandlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    dragDeltaY.current = Math.max(0, e.clientY - dragStartY.current);
  };
  const onHandlePointerUp = (_e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    if (dragDeltaY.current >= MOBILE_DRAG_DISMISS_PX) {
      setOpenPersisted(false);
    }
    dragStartY.current = null;
    dragDeltaY.current = 0;
  };

  // ─── Trigger bubble ───────────────────────────────────────────────────────
  // Bottom-right on desktop, bottom-left (above the FounderMobileBottomNav
  // which is h-16) on mobile.
  const triggerPositionClass = isMobile
    ? "fixed left-4 bottom-20 z-40"
    : "fixed right-4 bottom-4 z-40";

  return (
    <>
      {/* Trigger bubble — always rendered, hidden when dock is open
          so we don't double up the surface. */}
      {!open && (
        <motion.button
          type="button"
          onClick={() => setOpenPersisted(true)}
          aria-label="Open Atlas"
          data-testid="atlas-dock-trigger"
          className={cn(
            triggerPositionClass,
            "inline-flex items-center justify-center rounded-full",
            "bg-acr-brand text-white shadow-lg shadow-black/20",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acr-brand focus-visible:ring-offset-2",
          )}
          style={{
            minWidth: TOUCH_TARGET_PT + 12,
            minHeight: TOUCH_TARGET_PT + 12,
          }}
          variants={triggerVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          whileTap={TAP_PRESS}
          transition={triggerTransition}
        >
          <Sparkles className="w-5 h-5" aria-hidden="true" />
          {badgeCount > 0 && (
            <span
              aria-label={`${badgeCount} new from Atlas`}
              data-testid="atlas-dock-badge"
              className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-acr-neg text-white text-[10px] font-semibold leading-none"
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <>
            {/* Mobile backdrop. Desktop has no scrim — the rail
                docks alongside the page content. */}
            {isMobile && (
              <motion.div
                key="dock-backdrop"
                className="fixed inset-0 bg-surface-scrim z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpenPersisted(false)}
                aria-hidden="true"
              />
            )}

            <motion.aside
              key="dock-panel"
              role="complementary"
              aria-label="Atlas chat"
              data-testid="atlas-dock-panel"
              className={cn(
                isMobile
                  ? "fixed inset-x-0 bottom-0 z-50 h-[80vh] rounded-t-2xl"
                  : "fixed right-0 top-0 bottom-0 z-50 w-[384px] border-l",
                "bg-background border-border flex flex-col shadow-2xl",
              )}
              initial={
                isMobile
                  ? { y: "100%", opacity: 1 }
                  : { x: 24, opacity: 0 }
              }
              animate={
                isMobile
                  ? { y: 0, opacity: 1 }
                  : { x: 0, opacity: 1 }
              }
              exit={
                isMobile
                  ? { y: "100%", opacity: 1 }
                  : { x: 24, opacity: 0 }
              }
              transition={panelTransition}
            >
              {/* Mobile drag handle */}
              {isMobile && (
                <div
                  className="flex items-center justify-center pt-2 pb-1 touch-none cursor-grab active:cursor-grabbing"
                  onPointerDown={onHandlePointerDown}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  data-testid="atlas-dock-drag-handle"
                  aria-label="Drag down to close"
                  role="button"
                  tabIndex={0}
                >
                  <span className="block w-10 h-1.5 rounded-full bg-muted-foreground/30" />
                </div>
              )}

              <header className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Sparkles className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                <h2 className="text-sm font-semibold flex-1 truncate">
                  Atlas
                </h2>
                {isStreaming && <ThinkingDots size="sm" />}
                <button
                  type="button"
                  onClick={() => setOpenPersisted(false)}
                  aria-label="Close Atlas"
                  data-testid="atlas-dock-close"
                  className={cn(
                    "inline-flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acr-brand",
                  )}
                  style={{ minWidth: TOUCH_TARGET_PT, minHeight: TOUCH_TARGET_PT }}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </header>

              <MessageList
                messages={messages}
                isStreaming={isStreaming}
                activeToolCalls={activeToolCalls}
              />

              <Composer
                onSubmit={sendFromDock}
                disabled={status === "submitting"}
                placeholder="Ask Atlas about what you're looking at…"
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

export default Dock;
