import { useId, useState, useEffect, useRef, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchJsonArray } from "@/lib/queryClient";
import { okOrThrow } from "@/lib/fetch-honesty";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import {
  Hash, MessageSquare, Plus, Send, Loader2, Lock,
} from "lucide-react";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Verbs } from "@/lib/labels";

// ── Types ──────────────────────────────────────────────────────────────────

interface Channel {
  id: number;
  name: string | null;
  isDirect: boolean;
  participantIds: string[] | null;
  lastMessageAt: string | null;
  status: string;
}

interface TeamMessage {
  id: number;
  conversationId: number;
  senderId: string;
  body: string;
  createdAt: string;
  readBy?: { userId: string; readAt: string }[];
}

interface MessagesResponse {
  messages: TeamMessage[];
  hasMore: boolean;
}

interface TeamMember {
  id: number;
  userId: string;
  displayName?: string;
  email?: string;
  role?: string;
  isActive: boolean;
}

interface Presence {
  userId: string;
  status: "online" | "away" | "offline";
}

// ── Helpers ────────────────────────────────────────────────────────────────

function initials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

function presenceDot(status?: string) {
  const c: Record<string, string> = {
    online: "bg-acr-pos",
    away:   "bg-acr-warn",
    offline: "bg-muted dark:bg-muted",
  };
  const s = status ?? "offline";
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${c[s] ?? c.offline}`}
      role="img"
      aria-label={`Presence: ${s}`}
    />
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SidebarItem({
  label,
  isChannel,
  active,
  unread,
  presenceStatus,
  onClick,
}: {
  label: string;
  isChannel: boolean;
  active: boolean;
  unread?: boolean;
  presenceStatus?: string;
  onClick: () => void;
}) {
  const ariaLabel = isChannel
    ? `Channel: ${label}${unread ? ", unread messages" : ""}`
    : `Direct message: ${label}${presenceStatus ? `, ${presenceStatus}` : ""}${unread ? ", unread messages" : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {isChannel
        ? <Hash className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        : presenceDot(presenceStatus)
      }
      <span className="flex-1 truncate">{label}</span>
      {unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" aria-hidden="true" />}
    </button>
  );
}

function NewChannelDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const channelNameId = useId();

  // allow-no-invalidation: onSuccess calls the parent's onCreated() prop, which refreshes the channel list
  const create = useMutation({
    mutationFn: () =>
      fetch("/api/team-messaging/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(e));
        return r.json();
      }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      onCreated();
      toast({ title: "Channel created" });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't create channel",
        description: `${e.message ?? "Network error"}. Your channel name is still on this device — try again.`,
        variant: "destructive",
      }),
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1 mt-1 w-full">
          <Plus className="w-3 h-3" aria-hidden="true" /> New channel
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor={channelNameId}>Channel name</Label>
            <Input
              id={channelNameId}
              placeholder="#team-name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden="true" /> : null}
            {Verbs.CREATE}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

/**
 * TeamChatPanel — the self-contained team chat surface: channels + DMs sidebar,
 * message thread, composer, and live presence. Fetches its own data and manages
 * its own state. It renders NO page chrome (no Sidebar, no PageShell, no
 * document title) so it can be dropped into any content area — the standalone
 * /team-inbox page or the "Team" tab inside the Inbox door.
 */
export function TeamChatPanel() {
  const { user: authUser } = useAuth();
  const myUserId = (authUser as any)?.id ?? (authUser as any)?.claims?.sub ?? "";

  const { toast } = useToast();
  const qc = useQueryClient();
  const { on } = useRealtime();

  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftId = useId();

  // Fetch data
  const { data: channels = [], isLoading: channelsLoading, refetch: refetchChannels } =
    useQuery<Channel[]>({
      queryKey: ["/api/team-messaging/channels"],
      queryFn: () => fetchJsonArray("/api/team-messaging/channels"),
    });

  const { data: dms = [] } = useQuery<Channel[]>({
    queryKey: ["/api/team-messaging/conversations"],
    queryFn: () => fetchJsonArray<Channel>("/api/team-messaging/conversations"),
    select: convs => (Array.isArray(convs) ? convs.filter((c: Channel) => c.isDirect) : []),
  });

  // /api/organization/members never existed; the real org-members listing
  // is /api/team (routes-organization.ts:1071). The wrong URL produced
  // a 404 on every /team page mount.
  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
    queryFn: () => fetchJsonArray("/api/team"),
  });

  const { data: presence = [] } = useQuery<Presence[]>({
    queryKey: ["/api/team-messaging/presence"],
    queryFn: () => fetchJsonArray("/api/team-messaging/presence"),
    refetchInterval: 30_000,
  });

  // `fetch(...).then(r => r.json())` — with NO res.ok check — is what this was.
  // A 500 whose body is `{"error": "..."}` parses perfectly well, so
  // `messagesData.messages` came back undefined, `messages` defaulted to [],
  // and the panel told the team "No messages yet. Start the conversation!"
  // about a thread they had been using for months. okOrThrow keeps the failure
  // a failure; the error branch below renders it.
  const {
    data: messagesData,
    isLoading: msgsLoading,
    isError: msgsFailed,
    error: msgsError,
    refetch: refetchMsgs,
    isRefetching: msgsRefetching,
  } = useQuery<MessagesResponse>({
    queryKey: ["/api/team-messaging/messages", activeConvId],
    queryFn: async () => {
      const res = await okOrThrow(
        await fetch(`/api/team-messaging/conversations/${activeConvId}/messages?limit=80`, {
          credentials: "include",
        }),
      );
      return (await res.json()) as MessagesResponse;
    },
    enabled: !!activeConvId,
  });

  const messages = messagesData?.messages ?? [];

  // Auto-select first channel
  useEffect(() => {
    if (!activeConvId && channels.length > 0) {
      setActiveConvId(channels[0].id);
    }
  }, [channels, activeConvId]);

  // Real-time: listen for new messages via WebSocket
  useEffect(() => {
    return on("message.new", (payload: any) => {
      const { conversationId, message } = payload;
      qc.setQueryData(
        ["/api/team-messaging/messages", conversationId],
        (old: MessagesResponse | undefined) => {
          if (!old) return old;
          // Avoid dupes
          if (old.messages.some((m: TeamMessage) => m.id === message.id)) return old;
          return { ...old, messages: [...old.messages, message] };
        },
      );
      // Refresh channel list for updated lastMessageAt
      qc.invalidateQueries({ queryKey: ["/api/team-messaging/channels"] });
    });
  }, [on, qc]);

  // Real-time presence: the server broadcasts `presence.update` to the org
  // channel on every presence PATCH. Refetch presence on receipt so the dots
  // update live — the WS is now the primary path and the 30s poll above is
  // the safety net. Scoped to this org (a socket only receives its own org's
  // events).
  useEffect(() => {
    return on("presence.update", () => {
      qc.invalidateQueries({ queryKey: ["/api/team-messaging/presence"] });
    });
  }, [on, qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Join channel on first visit (so the user appears in participantIds)
  useEffect(() => {
    if (activeConvId) {
      const channel = channels.find(c => c.id === activeConvId);
      if (channel && !channel.isDirect && !channel.participantIds?.includes(myUserId)) {
        fetch(`/api/team-messaging/channels/${activeConvId}/join`, { method: "POST" });
      }
    }
  }, [activeConvId, channels, myUserId]);

  const sendMessage = useMutation({
    mutationFn: () =>
      fetch(`/api/team-messaging/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      }).then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(e));
        return r.json();
      }),
    onSuccess: (newMsg: TeamMessage) => {
      setDraft("");
      qc.setQueryData(
        ["/api/team-messaging/messages", activeConvId],
        (old: MessagesResponse | undefined) =>
          old ? { ...old, messages: [...old.messages, newMsg] } : old,
      );
    },
    onError: (e: any) => {
      if (e.tier_gating) {
        toast({ title: "Upgrade required", description: e.message, variant: "destructive" });
      } else {
        toast({
          title: "Couldn't send message",
          description: "Your draft is still in the input — try again.",
          variant: "destructive",
        });
      }
    },
  });

  function handleSend() {
    if (!draft.trim() || !activeConvId || sendMessage.isPending) return;
    sendMessage.mutate();
  }

  function handleSendSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    handleSend();
  }

  // Helpers
  const presenceByUserId = new Map(presence.map(p => [p.userId, p.status]));
  const memberByUserId = new Map(members.map(m => [m.userId, m]));

  function displayName(userId: string): string {
    const m = memberByUserId.get(userId);
    return m?.displayName ?? m?.email ?? userId.slice(0, 8);
  }

  const activeConv = [...channels, ...dms].find(c => c.id === activeConvId);

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 border-r flex flex-col py-4 overflow-y-auto bg-muted/30">
        {/* Channels */}
        <div className="px-3 mb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">
            Channels
          </p>
        </div>
        {channelsLoading ? (
          <div className="px-3 py-2 space-y-2.5" role="status" aria-live="polite">
            <span className="sr-only">Loading channels…</span>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton announce={false} key={i} className="h-4 w-32 max-w-full" />
            ))}
          </div>
        ) : (
          channels.map(ch => (
            <SidebarItem
              key={ch.id}
              label={ch.name ?? "unnamed"}
              isChannel
              active={ch.id === activeConvId}
              onClick={() => setActiveConvId(ch.id)}
            />
          ))
        )}
        <NewChannelDialog onCreated={() => refetchChannels()} />

        {/* Direct Messages */}
        <div className="px-3 mt-4 mb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">
            Direct messages
          </p>
        </div>
        {dms.map(dm => {
          const otherId = dm.participantIds?.find(id => id !== myUserId);
          const other = otherId ? memberByUserId.get(otherId) : undefined;
          const label = other?.displayName ?? other?.email ?? "Direct message";
          return (
            <SidebarItem
              key={dm.id}
              label={label}
              isChannel={false}
              active={dm.id === activeConvId}
              presenceStatus={otherId ? presenceByUserId.get(otherId) : undefined}
              onClick={() => setActiveConvId(dm.id)}
            />
          );
        })}
      </aside>

      {/* ── Thread ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center gap-2 shrink-0">
          {activeConv?.isDirect === false
            ? <Hash className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            : <MessageSquare className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          }
          <h2 className="font-semibold text-sm">{activeConv?.name ?? "Select a channel"}</h2>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-4">
          {!activeConvId && (
            <p className="text-muted-foreground text-sm mt-8 text-center">
              Select a channel or direct message to start.
            </p>
          )}
          {activeConvId && msgsLoading && (
            <div className="space-y-4 py-2" role="status" aria-live="polite">
              <span className="sr-only">Loading messages…</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton announce={false} className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Skeleton announce={false} className="h-3 w-24" />
                    <Skeleton announce={false} className="h-4 w-2/3 max-w-80" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {msgsFailed && activeConvId && (
            <QueryErrorState
              error={msgsError}
              onRetry={() => void refetchMsgs()}
              isRetrying={msgsRefetching}
              compact
              className="mt-8"
              title="Couldn't load this conversation"
              description="We couldn't read the messages just now. This isn't an empty thread — try again."
              testId="team-chat-messages-error"
            />
          )}
          {!msgsLoading && !msgsFailed && messages.length === 0 && activeConvId && (
            <p className="text-muted-foreground text-sm mt-8 text-center">
              No messages yet. Start the conversation!
            </p>
          )}
          <ol
            className="space-y-3 list-none p-0 m-0"
            role="log"
            aria-live="polite"
            aria-label={activeConv?.name ? `Messages in ${activeConv.name}` : "Messages"}
          >
            {messages.map((msg, i) => {
              const isMe = msg.senderId === myUserId;
              const prevSame = i > 0 && messages[i - 1].senderId === msg.senderId;
              return (
                <li key={msg.id} className={cn("flex gap-3", isMe && "flex-row-reverse")}>
                  {!prevSame && (
                    <Avatar className="w-7 h-7 shrink-0 mt-0.5">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {initials(
                          memberByUserId.get(msg.senderId)?.displayName,
                          memberByUserId.get(msg.senderId)?.email,
                        )}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {prevSame && <div className="w-7 shrink-0" aria-hidden="true" />}
                  <div className={cn("max-w-[70%]", isMe && "items-end flex flex-col")}>
                    {!prevSame && (
                      <p className={cn("text-xs text-muted-foreground mb-0.5", isMe && "text-right")}>
                        {isMe ? "You" : displayName(msg.senderId)}
                        {" · "}
                        <time dateTime={msg.createdAt}>{relative(msg.createdAt)}</time>
                      </p>
                    )}
                    <div
                      className={cn(
                        "px-3 py-2 rounded-2xl text-sm leading-relaxed",
                        isMe
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-muted rounded-tl-sm",
                      )}
                    >
                      {msg.body}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div ref={bottomRef} />
        </ScrollArea>

        {/* Input */}
        {activeConvId && (
          <form onSubmit={handleSendSubmit} className="border-t px-4 py-3 shrink-0">
            <Label htmlFor={draftId} className="sr-only">
              Message {activeConv?.name ?? ""}
            </Label>
            <div className="flex gap-2 items-end">
              <Input
                id={draftId}
                className="flex-1 resize-none"
                placeholder={`Message ${activeConv?.name ?? "…"} — @mention teammates`}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                disabled={sendMessage.isPending}
                autoComplete="off"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!draft.trim() || sendMessage.isPending}
                aria-label={`Send message to ${activeConv?.name ?? "channel"}`}
              >
                {sendMessage.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  : <Send className="w-4 h-4" aria-hidden="true" />
                }
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Press Enter to send · @mention a teammate to notify them
            </p>
          </form>
        )}

        {/* Tier gating */}
        {!channelsLoading && (channels as any)?.message && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8 text-center" role="region" aria-label="Team messaging upgrade prompt">
            <Lock className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Team messaging</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Team messaging requires a plan with 2 or more seats.
            </p>
            <Button asChild variant="outline">
              <Link href="/settings?tab=billing">Upgrade plan</Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
