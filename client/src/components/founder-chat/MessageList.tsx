/**
 * MessageList — scrolling list of chat messages.
 *
 * Windowing strategy: react-window isn't in the repo's deps, so we
 * use a lightweight DIY windowing approach — render only the last
 * `WINDOW_SIZE` messages from the bottom, plus an "older history"
 * affordance to expand. For Tom's daily check-in thread (rarely
 * thousands of messages) this is plenty; if message counts ever blow
 * past 500 we can swap in react-window without changing the public
 * contract.
 *
 * - Auto-scrolls to bottom on new messages UNLESS the user has
 *   scrolled up — then we show a "↓ new messages" pill.
 * - `role="log" aria-live="polite"` on the container so screen readers
 *   announce incoming assistant text.
 * - "Atlas is thinking…" indicator with the live tool-call list.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MessageBubble } from "@/components/founder-chat/MessageBubble";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { REVEAL_FROM_BELOW } from "@/lib/motion";
import type { ChatMessage } from "@shared/founder-chat/artifacts";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  isLoading?: boolean;
  activeToolCalls?: Array<{ name: string; status: "running" | "complete" | "failed" }>;
  /** Optional element to render above messages — e.g. an empty-state. */
  emptyState?: React.ReactNode;
}

const WINDOW_SIZE = 100;
const NEAR_BOTTOM_THRESHOLD = 80; // px

export function MessageList({
  messages,
  isStreaming,
  isLoading,
  activeToolCalls,
  emptyState,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJumpPill, setShowJumpPill] = useState(false);
  const [windowStart, setWindowStart] = useState(() =>
    Math.max(0, messages.length - WINDOW_SIZE),
  );

  // Visible slice — last WINDOW_SIZE messages by default; user can
  // "load earlier" to expand.
  const visible = useMemo(
    () => messages.slice(windowStart),
    [messages, windowStart],
  );

  // Stick to bottom on new messages if we were already near bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom) {
      el.scrollTop = el.scrollHeight;
      setShowJumpPill(false);
    } else {
      setShowJumpPill(true);
    }
    // Expand window if new messages slid into view.
    if (messages.length - windowStart > WINDOW_SIZE * 1.5) {
      setWindowStart(messages.length - WINDOW_SIZE);
    }
  }, [messages.length, stickToBottom, windowStart]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < NEAR_BOTTOM_THRESHOLD;
    setStickToBottom(atBottom);
    if (atBottom) setShowJumpPill(false);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
    setShowJumpPill(false);
  };

  // Auto-focus the jump-pill so keyboard users can grab it after
  // returning to the thread.
  useEffect(() => {
    if (!showJumpPill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "End") {
        e.preventDefault();
        jumpToBottom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showJumpPill]);

  const hasOlder = windowStart > 0;
  const showThinking = isStreaming && activeToolCalls && activeToolCalls.length > 0;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Atlas conversation"
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4"
        data-testid="message-list"
      >
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-3/4 rounded-card" />
            <Skeleton className="h-20 w-2/3 rounded-card ml-auto" />
            <Skeleton className="h-16 w-3/4 rounded-card" />
          </div>
        ) : visible.length === 0 ? (
          emptyState ?? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-10">
              <Sparkles
                className="w-8 h-8 text-acr-brand mb-3"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Atlas is ready.</p>
              <p className="text-xs mt-1 max-w-xs">
                Ask anything about the platform — costs, decisions, orgs, agents.
                Or type <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-micro">/</kbd>{" "}
                for commands.
              </p>
            </div>
          )
        ) : (
          <>
            {hasOlder && (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWindowStart(0)}
                  data-testid="message-list-load-earlier"
                >
                  Show {windowStart} earlier message{windowStart === 1 ? "" : "s"}
                </Button>
              </div>
            )}
            {visible.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            <AnimatePresence>
              {showThinking && (
                <motion.div
                  key="atlas-thinking"
                  initial={REVEAL_FROM_BELOW.initial}
                  animate={REVEAL_FROM_BELOW.animate}
                  exit={REVEAL_FROM_BELOW.exit}
                  className="inline-flex flex-col gap-2 max-w-md"
                  role="status"
                  aria-live="polite"
                  data-testid="atlas-thinking"
                >
                  {/* Ambient pulse — no text, no spinner. iMessage-style. */}
                  <div
                    className="inline-flex items-center justify-center px-4 py-3 rounded-card bg-muted/40 text-muted-foreground w-fit"
                    aria-label="Atlas is thinking"
                  >
                    <ThinkingDots />
                  </div>
                  {activeToolCalls && activeToolCalls.length > 0 && (
                    <ul
                      className="flex flex-wrap gap-1.5"
                      aria-label="In-flight tool calls"
                    >
                      {activeToolCalls.map((tc, i) => (
                        <li
                          key={i}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-micro font-mono tabular-nums",
                            tc.status === "running" && "bg-muted/60 text-muted-foreground",
                            tc.status === "complete" && "bg-acr-pos-soft text-acr-pos",
                            tc.status === "failed" && "bg-acr-neg-soft text-acr-neg",
                          )}
                        >
                          {tc.status === "running" && <ThinkingDots size="sm" />}
                          {tc.status === "complete" && (
                            <span aria-hidden="true" className="text-acr-pos">✓</span>
                          )}
                          {tc.status === "failed" && (
                            <span aria-hidden="true" className="text-acr-neg">×</span>
                          )}
                          {tc.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {showJumpPill && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center z-10">
          <Button
            size="sm"
            variant="default"
            onClick={jumpToBottom}
            className="pointer-events-auto shadow-lg gap-1.5"
            aria-label="Jump to newest message"
            data-testid="jump-to-bottom"
          >
            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
            New messages
          </Button>
        </div>
      )}
    </div>
  );
}

export default MessageList;
