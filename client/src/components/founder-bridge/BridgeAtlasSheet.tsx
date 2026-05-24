/**
 * BridgeAtlasSheet — mobile peeking-sheet for Atlas.
 *
 *   ┌────────────── 100dvh ─────────────┐
 *   │ telemetry tiles (scrollable)      │
 *   │                                   │
 *   │ ┌─── sheet (peek / half / full) ─┤
 *   │ │ ────                            │
 *   │ │ Atlas — latest message preview  │
 *   │ ├ drag up ─────────────────────── │
 *   │ │ MessageList                     │
 *   │ │ Composer                        │
 *   │ │                                 │
 *   │ ▼ ▼ ▼ FounderMobileBottomNav ▼ ▼ ▼│
 *   └───────────────────────────────────┘
 *
 * Three snap points: peek (88pt visible above bottom nav), half
 * (50dvh), full (100dvh minus the top header). Drag-up from peek
 * → half, drag-up from half → full, drag-down reverses. Tap the
 * peek strip jumps to half.
 *
 * Uses framer-motion's drag controls for the gesture. Snap thresholds
 * are velocity-aware so a fast flick snaps further than a slow drag.
 *
 * Shares no state with BridgeAtlasPane — only one of the two mounts
 * per breakpoint (md split) so there's no double-stream risk.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useAnimation, type PanInfo } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFounderChat, type ChatPageContext } from "@/hooks/use-founder-chat";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import { Composer } from "@/components/founder-chat/Composer";
import { MessageList } from "@/components/founder-chat/MessageList";
import { SPRING_SOFT } from "@/lib/motion";
import { LiveDot } from "./LiveDot";

type Snap = "peek" | "half" | "full";

const PEEK_PX = 96; // ~88pt visible above the bottom nav

export interface BridgeAtlasSheetProps {
  prefillMessage?: string;
  onPrefillConsumed?: () => void;
  pageContext?: ChatPageContext;
  /** Mirror of the pane's onStreamingChange — drives the header LiveDot. */
  onStreamingChange?: (streaming: boolean) => void;
}

export function BridgeAtlasSheet({
  prefillMessage,
  onPrefillConsumed,
  pageContext,
  onStreamingChange,
}: BridgeAtlasSheetProps) {
  const { threads } = useFounderChatThreads();
  const defaultThreadId = useMemo(
    () => threads.find((t) => t.isDefault)?.id ?? threads[0]?.id ?? "default",
    [threads],
  );
  const [activeThreadId] = useState<string>(defaultThreadId);

  const { messages, sendMessage, isStreaming, activeToolCalls, status } =
    useFounderChat(activeThreadId);

  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  const controls = useAnimation();
  const [snap, setSnap] = useState<Snap>("peek");
  const [vh, setVh] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );

  // Track viewport height (visualViewport when available — iOS keyboard).
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Sheet height per snap (translateY from full = sheet height − offset).
  // We render the sheet at full height and translate it down for smaller snaps.
  const fullPx = vh - 56; // leave room for the BridgeHeader (56pt)
  const halfPx = Math.round(vh * 0.5);
  const offsetForSnap = (s: Snap): number => {
    if (s === "full") return 0;
    if (s === "half") return fullPx - halfPx;
    return fullPx - PEEK_PX;
  };

  // Animate to the current snap whenever it changes.
  useEffect(() => {
    void controls.start({ y: offsetForSnap(snap), transition: SPRING_SOFT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, fullPx]);

  // If a prefill arrives while peeked, jump to full so the user can
  // immediately edit-and-send.
  useEffect(() => {
    if (prefillMessage && snap === "peek") setSnap("full");
  }, [prefillMessage, snap]);

  const latestAtlas = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return null;
  }, [messages]);

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    // Velocity-aware: a fast flick snaps further than a slow drag.
    const v = info.velocity.y;
    const cur = offsetForSnap(snap);
    const projected = cur + info.offset.y + v * 0.2;
    let next: Snap;
    const fullY = offsetForSnap("full");
    const halfY = offsetForSnap("half");
    const peekY = offsetForSnap("peek");
    const midFullHalf = (fullY + halfY) / 2;
    const midHalfPeek = (halfY + peekY) / 2;
    if (projected < midFullHalf) next = "full";
    else if (projected < midHalfPeek) next = "half";
    else next = "peek";
    setSnap(next);
  };

  return (
    <motion.aside
      aria-label="Atlas"
      className={cn(
        "fixed inset-x-0 z-30 flex flex-col rounded-t-2xl border-t border-white/[0.08] bg-background",
        // Bottom anchor: nav is h-16 so we sit on top of it.
        "bottom-16",
      )}
      style={{ height: fullPx }}
      drag="y"
      dragConstraints={{ top: 0, bottom: fullPx - PEEK_PX }}
      dragElastic={{ top: 0.05, bottom: 0.1 }}
      onDragEnd={onDragEnd}
      animate={controls}
      initial={{ y: offsetForSnap("peek") }}
      data-testid="bridge-atlas-sheet"
      data-snap={snap}
    >
      {/* Drag handle + tap-to-expand strip. The whole strip is the
          gesture surface; the visible "pill" inside is decorative. */}
      <button
        type="button"
        aria-label={snap === "peek" ? "Expand Atlas" : "Collapse Atlas"}
        onClick={() => setSnap(snap === "peek" ? "half" : "peek")}
        className="flex h-6 w-full shrink-0 items-center justify-center"
      >
        <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/40" />
      </button>

      {/* Peek summary — only visible at peek snap */}
      {snap === "peek" ? (
        <div
          className="flex h-[72px] cursor-pointer items-center gap-3 px-4 pb-3"
          onClick={() => setSnap("half")}
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <div className="mt-0.5 shrink-0">
              {isStreaming ? <LiveDot label="Atlas streaming" /> : null}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Atlas
              </p>
              <p className="line-clamp-2 text-sm text-foreground/90">
                {latestAtlas
                  ? extractPreview(latestAtlas)
                  : "Morning, Tom. Tap to start a thread."}
              </p>
            </div>
          </div>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <>
          {/* Expanded: full chat */}
          <div className="flex flex-1 min-h-0 flex-col">
            <div className="flex-1 min-h-0 overflow-hidden">
              <MessageList
                messages={messages}
                isStreaming={isStreaming}
                activeToolCalls={activeToolCalls}
              />
            </div>
            <Composer
              onSubmit={async (text) => {
                await sendMessage(text, pageContext ? { pageContext } : undefined);
                if (prefillMessage) onPrefillConsumed?.();
              }}
              disabled={status === "submitting"}
              initialText={prefillMessage}
            />
          </div>
        </>
      )}
    </motion.aside>
  );
}

/**
 * Extract a short plaintext preview from an assistant message. Strips
 * code fences so the peek shows the human-readable thought, not tool
 * chatter.
 */
function extractPreview(message: { text?: string }): string {
  const raw = message.text ?? "";
  if (!raw) return "Atlas posted an artifact — tap to view.";
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}
