/**
 * BridgeAtlasPane — the Atlas chat surface embedded in /founder/bridge.
 *
 * Same primitives the /founder shell uses (Composer + MessageList +
 * useFounderChat) but stripped of the full ThreadSidebar — at 40%
 * width the sidebar doesn't fit. Threads collapse to a single pill in
 * the pane header that expands inline.
 *
 * Page context is forwarded to the SSE endpoint so Atlas resolves
 * "this MRR / this lead / this dial" to the Bridge surface state.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFounderChat, type ChatPageContext } from "@/hooks/use-founder-chat";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import { Composer } from "@/components/founder-chat/Composer";
import { MessageList } from "@/components/founder-chat/MessageList";
import { SPRING_SOFT } from "@/lib/motion";
import { LiveDot } from "./LiveDot";

export interface BridgeAtlasPaneProps {
  /** Optional prefill from a tile handoff. Sticky for one open cycle. */
  prefillMessage?: string;
  /** Cleared by the parent after the user sends or dismisses. */
  onPrefillConsumed?: () => void;
  /** Surface-level page context forwarded to the SSE stream. */
  pageContext?: ChatPageContext;
  /** Optional className for the outer pane. */
  className?: string;
  /**
   * Fires when the streaming state flips. The Bridge surface lifts this
   * to drive the header's LiveDot. Without this the indicator would
   * never light up because streaming state lives inside the chat hook.
   */
  onStreamingChange?: (streaming: boolean) => void;
}

export function BridgeAtlasPane({
  prefillMessage,
  onPrefillConsumed,
  pageContext,
  className,
  onStreamingChange,
}: BridgeAtlasPaneProps) {
  const { threads } = useFounderChatThreads();
  const defaultThreadId = useMemo(
    () => threads.find((t) => t.isDefault)?.id ?? threads[0]?.id ?? "default",
    [threads],
  );
  const [activeThreadId, setActiveThreadId] = useState<string>(defaultThreadId);
  const [threadsOpen, setThreadsOpen] = useState(false);

  const { messages, sendMessage, isStreaming, activeToolCalls, status } =
    useFounderChat(activeThreadId);

  // Notify parent whenever streaming flips — drives the BridgeHeader
  // LiveDot. Stable callback identity not required; the effect only
  // fires on isStreaming change.
  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const headerTitle = activeThread?.isDefault
    ? "Atlas — Daily check-in"
    : activeThread?.title ?? "Atlas";

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      data-testid="bridge-atlas-pane-inner"
    >
      {/* Pane header — compact, single row */}
      <header className="flex flex-col border-b border-white/[0.06]">
        <div className="flex h-12 items-center justify-between gap-2 px-4 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground/95">{headerTitle}</span>
            {isStreaming && <LiveDot label="Atlas is streaming" />}
          </div>
          <button
            type="button"
            onClick={() => setThreadsOpen((v) => !v)}
            aria-expanded={threadsOpen}
            aria-label="Toggle thread list"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border border-white/[0.06] px-2 text-[11px] text-muted-foreground",
              "transition-colors [@media(pointer:fine)]:hover:bg-white/[0.04] [@media(pointer:fine)]:hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB547]/60",
            )}
          >
            <MessagesSquare className="h-3 w-3" aria-hidden />
            {threads.length}
            <ChevronDown
              className={cn("h-3 w-3 transition-transform duration-200", threadsOpen && "rotate-180")}
              aria-hidden
            />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {threadsOpen && (
            <motion.ul
              key="threads-strip"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1, transition: SPRING_SOFT }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
              className="overflow-hidden border-t border-white/[0.04]"
            >
              <div className="flex flex-col px-2 py-1.5">
                {threads.map((t) => {
                  const active = t.id === activeThreadId;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(t.id);
                          setThreadsOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                          "transition-colors",
                          active
                            ? "bg-white/[0.06] text-foreground"
                            : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            active ? "bg-[#FFB547]" : "bg-muted-foreground/40",
                          )}
                        />
                        <span className="flex-1 truncate">{t.isDefault ? "Daily check-in" : t.title}</span>
                      </button>
                    </li>
                  );
                })}
              </div>
            </motion.ul>
          )}
        </AnimatePresence>
      </header>

      {/* Messages — fills available height */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          activeToolCalls={activeToolCalls}
        />
      </div>

      {/* Composer — pinned bottom */}
      <Composer
        onSubmit={async (text) => {
          await sendMessage(text, pageContext ? { pageContext } : undefined);
          if (prefillMessage) onPrefillConsumed?.();
        }}
        disabled={status === "submitting"}
        initialText={prefillMessage}
      />
    </div>
  );
}
