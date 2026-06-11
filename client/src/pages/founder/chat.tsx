/**
 * /founder — Atlas chat shell.
 *
 * Phase C deliverable. Replaces the legacy tile-driven Now-surface as
 * the default founder landing. Layout:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ FounderChatHeader     ☰   Atlas — Daily check-in   [Dashboard] │
 *   ├──────────┬─────────────────────────────────────────────────────┤
 *   │ Threads  │                                                     │
 *   │  • Daily │   <MessageList — virtualized, role=log>              │
 *   │  • Q3    │                                                     │
 *   │  + new   │                                                     │
 *   │          ├─────────────────────────────────────────────────────┤
 *   │          │   <Composer — textarea, /-popover, send>            │
 *   └──────────┴─────────────────────────────────────────────────────┘
 *                                              [FounderMobileBottomNav]
 *
 * The morning brief (Phase E) renders as the FIRST message in the
 * default thread each day — it composes the same bucket / net-negative
 * / scale-up data that Now-surface tiles show today, but inline in the
 * chat instead of as a separate dashboard surface.
 *
 * "View dashboard" in the header opens /founder/dashboard which still
 * shows the legacy tile layout (LegacyNowSurface) — handy during the
 * transition, deprecated in Phase F.
 *
 * W3-3 loading/error treatment (page-owned):
 *   - thread + history load → chat-shaped skeleton (alternating bubbles)
 *   - empty thread → warm first-hello with a purposeful starter CTA
 *     (creates the first thread if none exists yet, then sends)
 *   - status === "submitting" → ThinkingDots indicator above the composer
 *   - stream / thread-create errors → inline compact QueryErrorState with
 *     retry; the optimistic user bubble is preserved by the hook
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Menu, ExternalLink, ChevronDown, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useIsFetching } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useFounderChat } from "@/hooks/use-founder-chat";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import { Composer } from "@/components/founder-chat/Composer";
import { MessageList } from "@/components/founder-chat/MessageList";
import { ThreadSidebar } from "@/components/founder-chat/ThreadSidebar";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { PersonaSheet } from "@/components/persona-sheet";
import { usePersonaMode } from "@/hooks/use-persona-mode";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { TOUCH_TARGET_PT } from "@/lib/spacing";

/**
 * Chat-shaped history skeleton — alternating assistant/user bubbles that
 * mirror the real MessageBubble layout. One announcing container; inner
 * Skeletons are decorative (announce={false}) to avoid duplicate SR output.
 */
function ChatHistorySkeleton() {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4"
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="atlas-history-skeleton"
    >
      <span className="sr-only">Loading conversation</span>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-4"
        aria-hidden="true"
      >
        <motion.div variants={staggerItem} className="flex justify-start">
          <Skeleton announce={false} className="h-16 w-3/4 md:w-3/5 rounded-card" />
        </motion.div>
        <motion.div variants={staggerItem} className="flex justify-end">
          <Skeleton announce={false} className="h-10 w-1/2 md:w-2/5 rounded-card" />
        </motion.div>
        <motion.div variants={staggerItem} className="flex justify-start">
          <Skeleton announce={false} className="h-20 w-3/4 md:w-3/5 rounded-card" />
        </motion.div>
        <motion.div variants={staggerItem} className="flex justify-end">
          <Skeleton announce={false} className="h-12 w-2/5 md:w-1/3 rounded-card" />
        </motion.div>
      </motion.div>
    </div>
  );
}

export default function FounderChatPage() {
  useDocumentTitle("Atlas — founder chat");
  const {
    threads,
    isLoading: threadsLoading,
    isError: threadsIsError,
    error: threadsError,
    refetch: refetchThreads,
    createThread,
  } = useFounderChatThreads();
  // Threads are serial integer ids; the server lazily creates the default
  // thread on first POST /stream. Until a real thread resolves we hold
  // `null` (useFounderChat no-ops on null — no bogus "default" request).
  const defaultThreadId =
    threads.find((t) => t.isDefault)?.id ?? threads[0]?.id ?? null;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    defaultThreadId,
  );
  // Adopt the resolved default thread once the list loads, unless the
  // user has already picked one.
  useEffect(() => {
    if (activeThreadId === null && defaultThreadId !== null) {
      setActiveThreadId(defaultThreadId);
    }
  }, [activeThreadId, defaultThreadId]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
  const { mode: personaMode } = usePersonaMode();

  const {
    messages,
    sendMessage,
    isStreaming,
    activeToolCalls,
    status,
    error,
  } = useFounderChat(activeThreadId);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const headerTitle = activeThread?.isDefault
    ? "Atlas — Daily check-in"
    : activeThread?.title ?? "Atlas";

  // ── W3-3 loading/error derivations ──────────────────────────────────────
  // useFounderChat doesn't expose hydration state, but its history query is
  // keyed deterministically — observe it from here so the initial load gets
  // a chat-shaped skeleton instead of a flash of the empty state.
  const numericThreadId = (() => {
    if (!activeThreadId) return null;
    const n = Number(activeThreadId);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const historyFetchCount = useIsFetching({
    queryKey: [`/api/founder/chat/threads/${numericThreadId}/messages`],
  });
  const historyLoading =
    numericThreadId !== null && historyFetchCount > 0 && messages.length === 0;
  const showSkeleton =
    (threadsLoading && messages.length === 0) || historyLoading;

  // First message with no thread yet: create the thread, then send once the
  // hook re-binds to the new id (sendMessage no-ops while threadId is null —
  // without this, a zero-thread founder's first message silently vanishes).
  const [pendingStarter, setPendingStarter] = useState<string | null>(null);
  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (activeThreadId !== null) {
        await sendMessage(trimmed);
        return;
      }
      setPendingStarter(trimmed);
      try {
        const thread = await createThread.mutateAsync({});
        if (thread) {
          setActiveThreadId(thread.id);
          // The effect below fires the send once the hook re-binds.
        }
      } catch {
        // createThread.isError drives the inline error row; keep
        // pendingStarter so Retry can replay the same text.
      }
    },
    [activeThreadId, sendMessage, createThread],
  );
  useEffect(() => {
    if (pendingStarter !== null && activeThreadId !== null && !createThread.isError) {
      const text = pendingStarter;
      setPendingStarter(null);
      void sendMessage(text);
    }
  }, [pendingStarter, activeThreadId, createThread.isError, sendMessage]);

  // Retry for a failed turn — the optimistic user bubble is preserved by
  // the hook, so retry replays the last user message.
  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.text;
  const showSendError = status === "error" && error != null;
  const showThreadCreateError = createThread.isError && pendingStarter !== null;

  return (
    // Container is locked to the viewport minus the founder mobile nav
    // (h-16 on mobile, hidden md+). We use a CSS calc so the chat fills
    // the rest of the screen and only the MessageList scrolls — the
    // Composer stays pinned to the bottom on every breakpoint.
    <div
      className="flex h-[100dvh] md:h-screen w-full overflow-hidden bg-background pb-16 md:pb-0"
      data-testid="founder-chat-shell"
    >
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onSelect={(id) => {
          setActiveThreadId(id);
          setMobileSidebarOpen(false);
          // A manually-picked thread invalidates any queued first-message
          // starter — don't auto-send it into an unrelated thread.
          setPendingStarter(null);
        }}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="flex flex-col gap-1.5 px-3 sm:px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="md:hidden h-8 w-8"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open thread list"
              data-testid="header-open-sidebar"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold truncate" data-testid="header-title">
                {headerTitle}
              </h1>
              {isStreaming && (
                <p className="text-micro text-acr-brand" aria-live="polite">
                  streaming…
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              asChild
              className="text-xs gap-1.5"
              data-testid="header-view-dashboard"
            >
              <Link href="/founder/dashboard" aria-label="View legacy dashboard">
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">View dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            </Button>
          </div>
          {/* Mode chip — mobile-only. Tap opens the persona sheet. The
              desktop header has the full PersonaSwitcher dropdown in the
              PageTopbar, so we don't double up on md+. */}
          <button
            type="button"
            onClick={() => setPersonaSheetOpen(true)}
            aria-label={`Switch mode. Currently ${personaMode === "founder" ? "Founder" : "Customer"} mode.`}
            data-testid="chat-header-persona-chip"
            style={{ minHeight: TOUCH_TARGET_PT }}
            className="md:hidden self-start inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 text-caption font-medium text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-muted-foreground">Mode:</span>
            <span>{personaMode === "founder" ? "Founder" : "Customer"}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
        </header>

        <PersonaSheet open={personaSheetOpen} onOpenChange={setPersonaSheetOpen} />

        {/* Messages */}
        {threadsIsError && messages.length === 0 ? (
          <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-4">
            <QueryErrorState
              error={threadsError}
              title="Couldn't load your threads"
              onRetry={() => void refetchThreads()}
              testId="atlas-threads-error"
            />
          </div>
        ) : showSkeleton ? (
          <ChatHistorySkeleton />
        ) : (
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            activeToolCalls={activeToolCalls}
            emptyState={
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={Sparkles}
                  headline="Atlas is ready"
                  subtitle="Ask anything about the platform — costs, decisions, orgs, agents. Or type / for commands."
                  actionIcon={null}
                  cta={{
                    label: "Ask for the morning brief",
                    onClick: () =>
                      void handleSend(
                        "Give me the morning brief — costs, customers, and anything that needs me today.",
                      ),
                    "data-testid": "atlas-first-hello-cta",
                  }}
                  testId="atlas-first-hello"
                />
              </div>
            }
          />
        )}

        {/* Awaiting-reply indicator — fills the gap between submit and the
            first stream event (MessageList's own ThinkingDots take over once
            tool calls start streaming). */}
        {status === "submitting" && (
          <div
            className="px-3 sm:px-6 pb-2 flex justify-start"
            data-testid="atlas-awaiting-reply"
          >
            <div className="inline-flex items-center justify-center px-4 py-3 rounded-card bg-muted/40 text-muted-foreground w-fit">
              <ThinkingDots aria-label="Atlas is thinking" />
            </div>
          </div>
        )}

        {/* Inline error treatments — the optimistic user bubble stays in the
            transcript; these rows add the retry affordance. */}
        {showSendError ? (
          <div className="px-3 sm:px-6 pb-2">
            <QueryErrorState
              compact
              error={error}
              title="Atlas hit an error"
              description="Your message is preserved above."
              onRetry={
                lastUserText ? () => void sendMessage(lastUserText) : undefined
              }
              testId="atlas-send-error"
            />
          </div>
        ) : showThreadCreateError ? (
          <div className="px-3 sm:px-6 pb-2">
            <QueryErrorState
              compact
              error={createThread.error as Error | null}
              title="Couldn't start the thread"
              description="Your message wasn't lost — retry to send it."
              isRetrying={createThread.isPending}
              onRetry={() => void handleSend(pendingStarter ?? "")}
              testId="atlas-thread-create-error"
            />
          </div>
        ) : null}

        {/* Composer */}
        <Composer
          onSubmit={handleSend}
          disabled={status === "submitting" || createThread.isPending}
        />
      </div>
    </div>
  );
}
