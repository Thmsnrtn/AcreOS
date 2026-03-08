import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

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
    online: "bg-green-500",
    away:   "bg-yellow-400",
    offline: "bg-gray-300 dark:bg-gray-600",
  };
  return (
    <span className={`w-2 h-2 rounded-full shrink-0 ${c[status ?? "offline"] ?? c.offline}`} />
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
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {isChannel
        ? <Hash className="w-3.5 h-3.5 shrink-0" />
        : presenceDot(presenceStatus)
      }
      <span className="flex-1 truncate">{label}</span>
      {unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
    </button>
  );
}

function NewChannelDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1 mt-1 w-full">
          <Plus className="w-3 h-3" /> New channel
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="channel-name">Channel name</Label>
            <Input
              id="channel-name"
              placeholder="#team-name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && name.trim() && create.mutate()}
              autoFocus
            />
          </div>
          <Button
            className="w-full"
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function TeamInboxPage() {
  const { isCollapsed } = useSidebarCollapsed();
  const { user: authUser } = useAuth();
  const myUserId = (authUser as any)?.id ?? (authUser as any)?.claims?.sub ?? "";

  const { toast } = useToast();
  const qc = useQueryClient();
  const { on, subscribe } = useRealtime();

  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch data
  const { data: channels = [], isLoading: channelsLoading, refetch: refetchChannels } =
    useQuery<Channel[]>({
      queryKey: ["/api/team-messaging/channels"],
      queryFn: () => fetch("/api/team-messaging/channels").then(r => r.json()),
    });

  const { data: dms = [] } = useQuery<Channel[]>({
    queryKey: ["/api/team-messaging/conversations"],
    queryFn: () => fetch("/api/team-messaging/conversations").then(r => r.json()),
    select: convs => convs.filter((c: Channel) => c.isDirect),
  });

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/organization/members"],
    queryFn: () => fetch("/api/organization/members").then(r => r.json()),
  });

  const { data: presence = [] } = useQuery<Presence[]>({
    queryKey: ["/api/team-messaging/presence"],
    queryFn: () => fetch("/api/team-messaging/presence").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: messagesData, isLoading: msgsLoading } = useQuery<MessagesResponse>({
    queryKey: ["/api/team-messaging/messages", activeConvId],
    queryFn: () =>
      fetch(`/api/team-messaging/conversations/${activeConvId}/messages?limit=80`).then(r => r.json()),
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
        toast({ title: "Failed to send", variant: "destructive" });
      }
    },
  });

  function handleSend() {
    if (!draft.trim() || !activeConvId || sendMessage.isPending) return;
    sendMessage.mutate();
  }

  // Helpers
  const presenceByUserId = new Map(presence.map(p => [p.userId, p.status]));
  const memberByUserId = new Map(members.map(m => [m.userId, m]));

  function displayName(userId: string): string {
    const m = memberByUserId.get(userId);
    return m?.displayName ?? m?.email ?? userId.slice(0, 8);
  }

  const activeConv = [...channels, ...dms].find(c => c.id === activeConvId);

  const tierError =
    channels.length === 0 &&
    !channelsLoading &&
    (channels as any)?.tier_gating;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <ErrorBoundary>
      <div
        className={`flex flex-1 overflow-hidden h-screen content-spring ${
          isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"
        }`}
      >
        {/* ── Sidebar ── */}
        <aside className="w-56 shrink-0 border-r flex flex-col py-4 overflow-y-auto bg-muted/30">
          {/* Channels */}
          <div className="px-3 mb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">
              Channels
            </p>
          </div>
          {channelsLoading ? (
            <div className="px-3 py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
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
              Direct Messages
            </p>
          </div>
          {dms.map(dm => {
            const otherId = dm.participantIds?.find(id => id !== myUserId);
            const other = otherId ? memberByUserId.get(otherId) : undefined;
            const label = other?.displayName ?? other?.email ?? "Direct Message";
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
              ? <Hash className="w-4 h-4 text-muted-foreground" />
              : <MessageSquare className="w-4 h-4 text-muted-foreground" />
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
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
              </div>
            )}
            {!msgsLoading && messages.length === 0 && activeConvId && (
              <p className="text-muted-foreground text-sm mt-8 text-center">
                No messages yet. Start the conversation!
              </p>
            )}
            <div className="space-y-3">
              {messages.map((msg, i) => {
                const isMe = msg.senderId === myUserId;
                const prevSame = i > 0 && messages[i - 1].senderId === msg.senderId;
                return (
                  <div key={msg.id} className={cn("flex gap-3", isMe && "flex-row-reverse")}>
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
                    {prevSame && <div className="w-7 shrink-0" />}
                    <div className={cn("max-w-[70%]", isMe && "items-end flex flex-col")}>
                      {!prevSame && (
                        <p className={cn("text-xs text-muted-foreground mb-0.5", isMe && "text-right")}>
                          {isMe ? "You" : displayName(msg.senderId)}
                          {" · "}
                          {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
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
                  </div>
                );
              })}
            </div>
            <div ref={bottomRef} />
          </ScrollArea>

          {/* Input */}
          {activeConvId && (
            <div className="border-t px-4 py-3 shrink-0">
              <div className="flex gap-2 items-end">
                <Input
                  className="flex-1 resize-none"
                  placeholder={`Message ${activeConv?.name ?? "…"} — @mention teammates`}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={sendMessage.isPending}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMessage.isPending}
                >
                  {sendMessage.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />
                  }
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Press Enter to send · Shift+Enter for new line (not supported in input) · @mention to notify teammates
              </p>
            </div>
          )}

          {/* Tier gating */}
          {!channelsLoading && (channels as any)?.message && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8 text-center">
              <Lock className="w-8 h-8 text-muted-foreground" />
              <p className="font-medium">Team Messaging</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Team messaging requires a plan with 2 or more seats.
              </p>
              <Button asChild variant="outline">
                <a href="/settings/billing">Upgrade Plan</a>
              </Button>
            </div>
          )}
        </main>
      </div>
      </ErrorBoundary>
    </div>
  );
}
