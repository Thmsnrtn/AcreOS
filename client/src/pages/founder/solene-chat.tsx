/**
 * /founder/solene-chat — iOS-Claude-UX chat surface for Solene.
 *
 * Phase 3 of the AcreOS-Solene migration. Consumes the Phase 2 backend
 * at /api/founder/solene-chat/*. SSE streaming of turn events; full
 * tool_use / tool_result / approval_pending rendering; conversation
 * sidebar; per-conversation cost footer.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Sidebar (recent convos) │  Header — title + new                │
 *   │                          ├──────────────────────────────────────┤
 *   │                          │  MessageList                         │
 *   │                          │   ...streaming...                    │
 *   │                          ├──────────────────────────────────────┤
 *   │                          │  ApprovalPrompt (when pending)       │
 *   │                          │  MessageInput                        │
 *   │                          │  CostFooter                          │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Mobile collapses the sidebar to a top-bar drawer.
 *
 * Krieger A11y bar:
 *   - role="log" + aria-live="polite" on the message list
 *   - aria-busy on streaming bubbles
 *   - ≥ 44×44 touch targets
 *   - keyboard nav (Tab + Cmd+Enter + Escape)
 *   - light + dark theme; design tokens only
 *
 * W3-3 loading/error treatment (page-owned — MessageList stays dumb):
 *   - history load → chat-shaped skeleton (alternating bubbles), not a spinner
 *   - history / conversation-list errors → QueryErrorState with retry
 *   - empty conversation → warm first-hello with a purposeful starter CTA
 *   - failed sends never vanish — inline error row + retry
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Plus, MessageSquare, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSoleneChat } from "@/hooks/useSoleneChat";
import { useToast } from "@/hooks/use-toast";
import { clientLogger } from "@/lib/clientLogger";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { ConversationSidebar } from "@/components/solene/ConversationSidebar";
import { MessageList } from "@/components/solene/MessageList";
import { MessageInput } from "@/components/solene/MessageInput";
import { ApprovalPrompt } from "@/components/solene/ApprovalPrompt";
import { CostFooter } from "@/components/solene/CostFooter";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentBlock } from "@shared/schema/solene-conversations";
import type { ChatTier } from "@shared/schema/solene-chat-config";
import { Verbs } from "@/lib/labels";

/**
 * Create a new Solene conversation. Returns the new id.
 */
export async function createSoleneConversation(): Promise<number> {
  const res = await fetch("/api/founder/solene-chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ startedSurface: "acreos" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create conversation: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { conversationId: number };
  return json.conversationId;
}

/** Join the text blocks of a message for plain display. */
function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

/**
 * Chat-shaped history skeleton — alternating assistant/user bubbles that
 * mirror MessageBubble's real layout. One announcing container; the inner
 * Skeletons are decorative (announce={false}) to avoid duplicate SR output.
 */
function ChatHistorySkeleton() {
  return (
    <div
      className="flex-1 overflow-y-auto py-4 px-2 md:px-4"
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="solene-history-skeleton"
    >
      <span className="sr-only">Loading conversation</span>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-3"
        aria-hidden="true"
      >
        <motion.div variants={staggerItem} className="flex justify-start">
          <Skeleton announce={false} className="h-16 w-3/4 md:w-3/5 rounded-2xl rounded-tl-sm" />
        </motion.div>
        <motion.div variants={staggerItem} className="flex justify-end">
          <Skeleton announce={false} className="h-10 w-1/2 md:w-2/5 rounded-2xl rounded-tr-sm" />
        </motion.div>
        <motion.div variants={staggerItem} className="flex justify-start">
          <Skeleton announce={false} className="h-20 w-3/4 md:w-3/5 rounded-2xl rounded-tl-sm" />
        </motion.div>
        <motion.div variants={staggerItem} className="flex justify-end">
          <Skeleton announce={false} className="h-12 w-2/5 md:w-1/3 rounded-2xl rounded-tr-sm" />
        </motion.div>
      </motion.div>
    </div>
  );
}

interface BootstrapSendState {
  content: ContentBlock[];
  tierHint?: ChatTier;
  failed: boolean;
}

export default function SoleneChatPage() {
  useDocumentTitle("Chat with Solene");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] =
    useState<number | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // ── W3-3 state ──────────────────────────────────────────────────────────
  // History-load failures (diverted from toast → blocking QueryErrorState).
  const [historyError, setHistoryError] = useState<Error | null>(null);
  // Conversation-list auto-select bootstrap (mount fetch) status.
  const [convoListLoading, setConvoListLoading] = useState(true);
  const [convoListError, setConvoListError] = useState<Error | null>(null);
  const [convoListNonce, setConvoListNonce] = useState(0);
  // First-message-before-conversation send: keep the message visible while
  // the turn drains, and inline-retryable if it fails (it used to vanish
  // into a toast).
  const [bootstrapSend, setBootstrapSend] = useState<BootstrapSendState | null>(null);
  const lastTierHintRef = useRef<ChatTier | undefined>(undefined);

  const chat = useSoleneChat({
    conversationId: activeConversationId,
    onError: (err) => {
      // History-load failures get the blocking error treatment with retry
      // instead of a transient toast (the surface is unusable without
      // history — a toast under-communicates that).
      if (err.message.includes("Failed to load conversation")) {
        setHistoryError(err);
        return;
      }
      toast({
        title: "Chat error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // The hook object is re-bound per render; async flows that change the
  // conversation mid-flight (bootstrap send) need the LATEST binding to
  // refetch against the new conversation id, not the stale null one.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Reset history error when switching conversations.
  useEffect(() => {
    setHistoryError(null);
  }, [activeConversationId]);

  const handleNewConversation = useCallback(async () => {
    try {
      const id = await createSoleneConversation();
      setActiveConversationId(id);
      setMobileSidebarOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["/api/founder/solene-chat/conversations"],
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      clientLogger.error("[SoleneChatPage] new conversation failed", error);
      toast({
        title: "Couldn't start conversation",
        description: error.message,
        variant: "destructive",
      });
    }
  }, [queryClient, toast]);

  // Auto-create the first conversation if there's no active one on mount.
  // We do this lazily — only when the user sends their first message — so
  // we don't churn DB rows for visitors who just open the page.
  const handleSend = useCallback(
    async (
      content: Parameters<typeof chat.sendMessage>[0],
      tierHint?: Parameters<typeof chat.sendMessage>[1],
    ) => {
      lastTierHintRef.current = tierHint;
      if (activeConversationId == null) {
        // Keep the message on screen while the bootstrap turn runs — the
        // composer clears its draft on send, so this state is the only
        // place the message lives until history hydrates.
        setBootstrapSend({ content, tierHint, failed: false });
        try {
          const id = await createSoleneConversation();
          setActiveConversationId(id);
          // The hook's conversationId-effect will reset and refetch; we
          // can't send through `chat` until that state lands. Buffer via
          // a fresh fetch using the new id directly.
          const res = await fetch(
            `/api/founder/solene-chat/conversations/${id}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
              },
              credentials: "include",
              body: JSON.stringify({
                userMessage: content,
                ...(tierHint ? { tierHint } : {}),
              }),
            },
          );
          if (!res.ok) {
            throw new Error(`Failed to send message: HTTP ${res.status}`);
          }
          // The stream fires; we don't consume it here — the hook will
          // pick up history on its next refetch (triggered by conversation
          // change). Best UX: just await server-side completion.
          if (res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let streamError: string | null = null;
            // Drain the stream so the server completes the turn, but PARSE the
            // SSE frames for an `error` event. The server flushes HTTP 200
            // before the turn runs, so res.ok can't tell us the turn failed —
            // previously any first-turn error (missing key, cost cap, refusal,
            // timeout) was silently swallowed here and the message just sat
            // there with no reply/typing/error. Frame format: `event: <type>\n
            // data: <json>\n\n`.
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let sep: number;
              while ((sep = buffer.indexOf("\n\n")) !== -1) {
                const frame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                let evName = "";
                let dataStr = "";
                for (const line of frame.split("\n")) {
                  if (line.startsWith("event:")) evName = line.slice(6).trim();
                  else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
                }
                if (evName === "error") {
                  try {
                    streamError = JSON.parse(dataStr)?.message || "The chat backend returned an error.";
                  } catch {
                    streamError = "The chat backend returned an error.";
                  }
                }
              }
            }
            if (streamError) {
              // Routed to the catch below → inline failed state + retry, and the
              // server now persists an assistant error row so history agrees.
              throw new Error(streamError);
            }
          }
          // Refetch via the LATEST hook binding (now wired to the new
          // conversation id) so the transcript hydrates before we drop
          // the local echo of the sent message.
          await chatRef.current.refetchHistory();
          setBootstrapSend(null);
          void queryClient.invalidateQueries({
            queryKey: ["/api/founder/solene-chat/conversations"],
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          clientLogger.error(
            "[SoleneChatPage] bootstrap-send failed",
            error,
          );
          // Inline error treatment — the message stays visible with a
          // retry affordance instead of vanishing into a toast.
          setBootstrapSend({ content, tierHint, failed: true });
        }
        return;
      }
      await chat.sendMessage(content, tierHint);
    },
    [activeConversationId, chat, queryClient],
  );

  // Auto-select most recent conversation on mount (lazy bootstrap).
  useEffect(() => {
    if (activeConversationId != null) {
      setConvoListLoading(false);
      return;
    }
    let cancelled = false;
    setConvoListLoading(true);
    setConvoListError(null);
    (async () => {
      try {
        const res = await fetch(
          "/api/founder/solene-chat/conversations?archived=false&limit=1",
          { credentials: "include" },
        );
        if (!res.ok) {
          throw new Error(`Failed to load conversations: HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          conversations: { id: number }[];
        };
        if (cancelled) return;
        if (json.conversations.length > 0) {
          setActiveConversationId(json.conversations[0].id);
        }
        setConvoListLoading(false);
      } catch (err) {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        clientLogger.warn(
          "[SoleneChatPage] failed to auto-select conversation",
          String(error),
        );
        setConvoListError(error);
        setConvoListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, convoListNonce]);

  // ── Derived render states ─────────────────────────────────────────────
  const lastMessage =
    chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : undefined;
  // Streaming has started but no assistant bubble exists yet (the bubble's
  // own "Thinking…" treatment takes over from turn_start onward).
  const awaitingAssistant =
    chat.streaming &&
    !(lastMessage?.role === "assistant" && lastMessage.isStreaming);
  // The last turn ended in an error — the failed bubble is preserved in the
  // transcript (MessageBubble renders its inline error); offer a retry.
  const lastTurnFailed =
    !chat.streaming && bootstrapSend == null && lastMessage?.errorMessage != null;

  const showConvoListError =
    convoListError != null && activeConversationId == null;
  const showHistoryError =
    historyError != null && chat.messages.length === 0 && !chat.loading;
  const showHistorySkeleton =
    !showConvoListError &&
    !showHistoryError &&
    ((convoListLoading && activeConversationId == null) ||
      (chat.loading && chat.messages.length === 0));

  const retryLastTurn = useCallback(() => {
    const lastUser = [...chat.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;
    void handleSend(lastUser.content, lastTierHintRef.current);
  }, [chat.messages, handleSend]);

  const retryBootstrapSend = useCallback(() => {
    const failed = bootstrapSend;
    if (!failed) return;
    setBootstrapSend(null);
    void handleSend(failed.content, failed.tierHint);
  }, [bootstrapSend, handleSend]);

  return (
    <div
      className="flex h-[100dvh] md:h-screen w-full overflow-hidden bg-background"
      data-testid="solene-chat-page"
    >
      {/* Desktop sidebar */}
      <ConversationSidebar
        activeId={activeConversationId}
        onSelect={(id) => {
          setActiveConversationId(id);
          setMobileSidebarOpen(false);
        }}
        onNew={handleNewConversation}
      />

      {/* Main thread column */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header — title + mobile sidebar toggle */}
        <header className="flex items-center gap-2 border-b border-border px-3 md:px-4 py-2 shrink-0">
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden min-h-[44px] min-w-[44px]"
                aria-label="Open conversations"
                data-testid="button-mobile-sidebar"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-80">
              <ConversationSidebar
                activeId={activeConversationId}
                onSelect={(id) => {
                  setActiveConversationId(id);
                  setMobileSidebarOpen(false);
                }}
                onNew={handleNewConversation}
                visibilityClassName="flex"
              />
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <MessageSquare
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            <h1 className="text-sm font-semibold text-foreground truncate">
              Chat with Solene
            </h1>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleNewConversation()}
            className="shrink-0 hidden md:flex min-h-[44px]"
            aria-label="New conversation"
            data-testid="button-new-conversation-header"
          >
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            New
          </Button>
        </header>

        {showConvoListError ? (
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-4">
            <QueryErrorState
              error={convoListError}
              title="Couldn't load your conversations"
              onRetry={() => setConvoListNonce((n) => n + 1)}
              isRetrying={convoListLoading}
              testId="solene-conversations-error"
            />
          </div>
        ) : showHistoryError ? (
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-4">
            <QueryErrorState
              error={historyError}
              title="Couldn't load this conversation"
              onRetry={() => {
                setHistoryError(null);
                void chat.refetchHistory();
              }}
              isRetrying={chat.loading}
              testId="solene-history-error"
            />
          </div>
        ) : showHistorySkeleton ? (
          <ChatHistorySkeleton />
        ) : chat.messages.length === 0 && bootstrapSend != null ? (
          // The first message is in flight (rendered below as a local
          // echo); keep the log area blank instead of flashing the empty
          // state under it.
          <div className="flex-1 overflow-y-auto" aria-hidden="true" />
        ) : chat.messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-4">
            <EmptyState
              icon={Sparkles}
              headline="Start the conversation"
              subtitle="Ask Solene about dispatches in flight, capital, costs — or hand her something to run with. She has the full company picture."
              actionIcon={null}
              cta={{
                label: "Ask for today's rundown",
                onClick: () =>
                  void handleSend([
                    {
                      type: "text",
                      text: "Give me today's rundown — what's in flight, what's waiting on me, and anything you'd flag.",
                    },
                  ]),
                "data-testid": "solene-chat-empty-cta",
              }}
              testId="solene-chat-empty"
            />
          </div>
        ) : (
          <MessageList messages={chat.messages} loading={chat.loading} />
        )}

        {/* Local echo of a bootstrap send — visible (and retryable on
            failure) until the hydrated transcript takes over. */}
        {bootstrapSend ? (
          <div
            className="px-2 md:px-4 pb-2 flex flex-col gap-1.5"
            data-testid="solene-bootstrap-send"
          >
            <div className="flex justify-end">
              <div className="max-w-[88%] md:max-w-[78%] rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm bg-primary text-primary-foreground">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {blocksToText(bootstrapSend.content)}
                </p>
              </div>
            </div>
            {bootstrapSend.failed ? (
              <div
                className="flex items-center justify-end gap-2"
                role="alert"
              >
                <AlertCircle
                  className="h-3.5 w-3.5 text-destructive"
                  aria-hidden="true"
                />
                <span className="text-xs text-destructive">Didn't send.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryBootstrapSend}
                  className="h-7 gap-1.5 text-xs"
                  data-testid="solene-bootstrap-send-retry"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  {Verbs.RETRY}
                </Button>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-muted/40 px-4 py-2.5 text-muted-foreground">
                  <ThinkingDots aria-label="Solene is thinking" />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Pre-turn-start indicator — the streaming bubble's own
            "Thinking…" treatment takes over once turn_start lands. */}
        {awaitingAssistant && !bootstrapSend ? (
          <div
            className="px-2 md:px-4 pb-2 flex justify-start"
            data-testid="solene-awaiting-reply"
          >
            <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-muted/40 px-4 py-2.5 text-muted-foreground">
              <ThinkingDots aria-label="Solene is thinking" />
            </div>
          </div>
        ) : null}

        {/* Last turn failed — the bubble keeps its inline error (role=alert
            in MessageBubble); this row adds the retry affordance. */}
        {lastTurnFailed ? (
          <div className="px-3 md:px-4 pb-2" data-testid="solene-turn-retry">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  That turn hit an error — your message is preserved above.
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={retryLastTurn}
                disabled={chat.streaming}
                className="h-7 shrink-0 gap-1.5 text-xs"
                data-testid="solene-turn-retry-button"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                {Verbs.RETRY}
              </Button>
            </div>
          </div>
        ) : null}

        {chat.pendingApproval ? (
          <ApprovalPrompt
            approval={chat.pendingApproval}
            onResolve={chat.approveTool}
          />
        ) : null}

        <MessageInput
          onSend={handleSend}
          onAbort={chat.abortCurrentTurn}
          disabled={chat.streaming || bootstrapSend?.failed === false}
          streaming={chat.streaming}
        />

        <CostFooter conversationId={activeConversationId} />
      </main>
    </div>
  );
}
