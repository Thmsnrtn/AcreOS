/**
 * Borrower messages — the lender inbox on the note detail page (S-05, P1-4b).
 *
 * Why this exists: the borrower portal has always let a borrower write to
 * their lender (`POST /api/borrower/messages`), and the lender read/reply
 * routes have existed just as long — but no client ever called them and no
 * notification fired, so borrower messages were a dead letter and the
 * borrower was silently ignored. This panel is the lender surface for the
 * existing routes:
 *
 *   GET  /api/notes/:noteId/borrower-messages            — the thread
 *        (the server marks borrower messages read when the lender views)
 *   GET  /api/notes/:noteId/borrower-messages/unread-count — the header badge
 *   POST /api/notes/:noteId/borrower-messages/reply      — the lender's reply
 *        (the borrower sees it in their portal thread)
 *
 * The lender is also notified when a borrower writes (push + in-app, both
 * preference-gated server-side), so this panel is not the only door — it is
 * the place the notification lands.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MailOpen, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { BorrowerMessage } from "@shared/schema";

interface BorrowerMessagesPanelProps {
  noteId: number | string;
}

export function BorrowerMessagesPanel({ noteId }: BorrowerMessagesPanelProps) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const id = String(noteId);

  const threadKey = ["/api/notes", id, "borrower-messages"];
  const unreadKey = ["/api/notes", id, "borrower-messages", "unread-count"];

  const {
    data: messages,
    isLoading,
    isError,
    refetch,
  } = useQuery<BorrowerMessage[]>({
    queryKey: threadKey,
    queryFn: async () => {
      const res = await fetch(`/api/notes/${id}/borrower-messages`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load borrower messages (${res.status})`);
      const data = (await res.json()) as BorrowerMessage[];
      // Viewing the thread marks borrower messages read server-side; the
      // badge count is now stale, so re-read it (it will come back 0).
      void queryClient.invalidateQueries({ queryKey: unreadKey });
      return data;
    },
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: unreadKey,
    queryFn: async () => {
      const res = await fetch(`/api/notes/${id}/borrower-messages/unread-count`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load unread count (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const unread = unreadData?.count ?? 0;

  const replyMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/notes/${id}/borrower-messages/reply`, { content });
      return res.json();
    },
    onSuccess: () => {
      setReply("");
      void queryClient.invalidateQueries({ queryKey: threadKey });
      toast({
        title: "Reply sent",
        description: "The borrower will see it in their portal messages.",
      });
    },
    onError: () => {
      toast({
        title: "Reply didn't send",
        description: "Your reply is still in the box — check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const sendReply = () => {
    const content = reply.trim();
    if (!content || replyMutation.isPending) return;
    replyMutation.mutate(content);
  };

  return (
    <Card className="p-5 mb-6" data-testid="borrower-messages-panel">
      <div className="flex items-center gap-2 mb-1">
        <MailOpen className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold">Borrower messages</h2>
        {unread > 0 && (
          <Badge variant="destructive" data-testid="borrower-messages-unread-badge">
            {unread} unread
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Messages the borrower sends from their portal land here. You're notified when a new one
        arrives; replies you send appear in the borrower's portal.
      </p>

      {isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading borrower messages">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}

      {isError && (
        <div className="text-sm text-muted-foreground">
          We couldn't load the borrower's messages.{" "}
          <Button variant="ghost" className="p-0 h-auto" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !isError && messages && messages.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="borrower-messages-empty">
          No messages yet. When the borrower writes from their portal, it will appear here —
          and you'll get a notification.
        </p>
      )}

      {!isLoading && !isError && messages && messages.length > 0 && (
        <div className="space-y-3 mb-4">
          {messages.map((m) => {
            const fromBorrower = m.senderType === "borrower";
            return (
              <div
                key={m.id}
                className={`flex ${fromBorrower ? "justify-start" : "justify-end"}`}
                data-testid={`borrower-message-${m.id}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    fromBorrower
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  <div className="text-[11px] opacity-70 mb-1">
                    {fromBorrower ? "Borrower" : "You"} ·{" "}
                    {m.createdAt ? formatDateTime(m.createdAt) : ""}
                    {fromBorrower && !m.readAt ? " · unread" : ""}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply to the borrower…"
          rows={2}
          maxLength={10000}
          className="flex-1"
          data-testid="borrower-message-reply-input"
          aria-label="Reply to the borrower"
        />
        <Button
          onClick={sendReply}
          disabled={!reply.trim() || replyMutation.isPending}
          data-testid="borrower-message-reply-send"
        >
          <Send className="w-4 h-4 mr-1" aria-hidden="true" />
          {replyMutation.isPending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </Card>
  );
}
