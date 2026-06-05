/**
 * ConversationSidebar — left rail listing recent chats + "New conversation".
 *
 * Each row shows title (or "Untitled") + relative last-message time. Hover
 * reveals an archive button. Click selects the conversation.
 */
import React, { useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Archive, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { clientLogger } from "@/lib/clientLogger";

interface ConversationRow {
  id: number;
  title: string | null;
  archived: boolean;
  startedAt: string;
  lastMessageAt: string;
  startedSurface: string;
}

interface ConversationSidebarProps {
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => Promise<void>;
  /**
   * Visibility class applied to the root <aside>. The desktop call site
   * passes `"hidden md:flex"` so the component disappears on mobile (where
   * the Sheet drawer renders its own copy). The Sheet call site passes
   * `"flex"` so the content renders inside the drawer — without this
   * override the component's old hard-coded `hidden md:flex` made the
   * Sheet drawer appear blank on mobile.
   */
  visibilityClassName?: string;
}

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export function ConversationSidebar({
  activeId,
  onSelect,
  onNew,
  visibilityClassName = "hidden md:flex",
}: ConversationSidebarProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = React.useState(false);

  const { data, isLoading, isError } = useQuery<{
    conversations: ConversationRow[];
  }>({
    queryKey: ["/api/founder/solene-chat/conversations", "active"],
    queryFn: async () => {
      const res = await fetch(
        "/api/founder/solene-chat/conversations?archived=false&limit=50",
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load conversations: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(
        `/api/founder/solene-chat/conversations/${id}/archive`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/founder/solene-chat/conversations"],
      });
    },
    onError: (err) => {
      clientLogger.error("[ConversationSidebar] archive failed", err as Error);
    },
  });

  const handleNew = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await onNew();
    } finally {
      setCreating(false);
    }
  }, [creating, onNew]);

  const conversations = data?.conversations ?? [];

  return (
    <aside
      className={cn(
        visibilityClassName,
        "flex-col w-64 lg:w-72 border-r border-border bg-muted/20 shrink-0",
      )}
      aria-label="Conversations"
    >
      <div className="p-3 border-b border-border">
        <Button
          type="button"
          onClick={() => void handleNew()}
          disabled={creating}
          className="w-full justify-start gap-2 min-h-[44px]"
          variant="default"
          aria-label="New conversation"
          data-testid="button-new-conversation"
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          New conversation
        </Button>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2 space-y-1"
        aria-live="polite"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <p className="text-xs text-muted-foreground px-2 py-3">
            Couldn't load conversations.
          </p>
        ) : conversations.length === 0 ? (
          <div className="text-center px-3 py-6">
            <MessageSquare
              className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2"
              aria-hidden="true"
            />
            <p className="text-xs text-muted-foreground">
              No conversations yet. Start one above.
            </p>
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-muted/60 transition-colors",
                activeId === c.id && "bg-muted",
              )}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-current={activeId === c.id ? "true" : undefined}
              data-testid={`conversation-row-${c.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {c.title ?? "Untitled"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {relativeTime(c.lastMessageAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  archiveMutation.mutate(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-muted-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Archive conversation ${c.title ?? "Untitled"}`}
                data-testid={`button-archive-${c.id}`}
              >
                <Archive
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
