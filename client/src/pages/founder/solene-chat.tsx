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
 */
import React, { useCallback, useEffect, useState } from "react";
import { Menu, Plus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSoleneChat } from "@/hooks/useSoleneChat";
import { useToast } from "@/hooks/use-toast";
import { clientLogger } from "@/lib/clientLogger";
import { ConversationSidebar } from "@/components/solene/ConversationSidebar";
import { MessageList } from "@/components/solene/MessageList";
import { MessageInput } from "@/components/solene/MessageInput";
import { ApprovalPrompt } from "@/components/solene/ApprovalPrompt";
import { CostFooter } from "@/components/solene/CostFooter";
import { useQueryClient } from "@tanstack/react-query";

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

export default function SoleneChatPage() {
  useDocumentTitle("Chat with Solene");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] =
    useState<number | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const chat = useSoleneChat({
    conversationId: activeConversationId,
    onError: (err) => {
      toast({
        title: "Chat error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

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
      if (activeConversationId == null) {
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
          // The stream fires; we don't consume it here — the hook will
          // pick up history on its next refetch (triggered by conversation
          // change). Best UX: just await server-side completion.
          if (res.body) {
            const reader = res.body.getReader();
            // Drain the stream so the server completes the turn.
            // (We deliberately don't surface streaming for this edge case
            //  because the hook isn't wired to this conversation yet —
            //  history refetch will hydrate the full transcript.)
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          void chat.refetchHistory();
          void queryClient.invalidateQueries({
            queryKey: ["/api/founder/solene-chat/conversations"],
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          clientLogger.error(
            "[SoleneChatPage] bootstrap-send failed",
            error,
          );
          toast({
            title: "Couldn't send message",
            description: error.message,
            variant: "destructive",
          });
        }
        return;
      }
      await chat.sendMessage(content, tierHint);
    },
    [activeConversationId, chat, queryClient, toast],
  );

  // Auto-select most recent conversation on mount (lazy bootstrap).
  useEffect(() => {
    if (activeConversationId != null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          "/api/founder/solene-chat/conversations?archived=false&limit=1",
          { credentials: "include" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          conversations: { id: number }[];
        };
        if (cancelled) return;
        if (json.conversations.length > 0) {
          setActiveConversationId(json.conversations[0].id);
        }
      } catch (err) {
        clientLogger.warn(
          "[SoleneChatPage] failed to auto-select conversation",
          String(err),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

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

        <MessageList messages={chat.messages} loading={chat.loading} />

        {chat.pendingApproval ? (
          <ApprovalPrompt
            approval={chat.pendingApproval}
            onResolve={chat.approveTool}
          />
        ) : null}

        <MessageInput
          onSend={handleSend}
          onAbort={chat.abortCurrentTurn}
          disabled={chat.streaming}
          streaming={chat.streaming}
        />

        <CostFooter conversationId={activeConversationId} />
      </main>
    </div>
  );
}
