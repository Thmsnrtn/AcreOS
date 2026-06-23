import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Hash, Send, Share, Link, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useToast } from "@/hooks/use-toast";

interface TeamMessage {
  id: number;
  conversationId: number;
  senderId: string;
  body: string;
  createdAt: string;
  readBy?: { userId: string; readAt: string }[];
}

interface TeamConversation {
  id: number;
  name: string | null;
  isDirect: boolean;
  participantIds: string[] | null;
  lastMessageAt: string | null;
  status: string;
}

interface TeamGeneralChannelProps {
  open: boolean;
  onClose: () => void;
}

export function TeamGeneralChannel({ open, onClose }: TeamGeneralChannelProps) {
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Get or create general channel
  const { data: conversations } = useQuery<TeamConversation[]>({
    queryKey: ["/api/team-messaging/conversations"],
    enabled: open,
  });

  const generalChannel = conversations?.find(c => c.name === "General" && !c.isDirect);

  const { data: messages, isLoading } = useQuery<TeamMessage[]>({
    queryKey: [`/api/team-messaging/conversations/${generalChannel?.id}/messages`],
    enabled: !!generalChannel?.id && open,
    refetchInterval: 10_000,
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!generalChannel) throw new Error("No general channel");
      const res = await fetch(`/api/team-messaging/conversations/${generalChannel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({
        queryKey: [`/api/team-messaging/conversations/${generalChannel?.id}/messages`],
      });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    sendMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-[400px] sm:w-[450px] sm:max-w-[450px] flex flex-col p-0">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              General
            </SheetTitle>
          </div>
        </SheetHeader>

        {!generalChannel ? (
          <div className="flex-1 flex items-center justify-center text-center p-6 text-muted-foreground text-sm">
            <div>
              <Hash className="h-8 w-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
              <p>Team chat is available for organizations with 2+ members.</p>
            </div>
          </div>
        ) : isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading team chat"
            className="flex-1 p-4 space-y-3"
          >
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-10 w-1/2 ml-auto" />
            <Skeleton className="h-10 w-2/3" />
            <span className="sr-only">Loading…</span>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-label="Team chat"
              className="flex-1 overflow-y-auto p-4 space-y-3"
            >
              {(!messages || messages.length === 0) ? (
                <div className="text-center text-muted-foreground text-sm py-8">
                  No messages yet. Start the conversation.
                </div>
              ) : (
                <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
                  {messages.map((msg) => (
                    <motion.div key={msg.id} variants={staggerItem}>
                      <div className="text-xs text-muted-foreground mb-0.5">
                        {msg.senderId} &middot; {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-sm bg-muted rounded-card px-3 py-2 whitespace-pre-wrap">
                        {msg.body}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>

            <div className="p-3 border-t">
              <div className="flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message #General…"
                  disabled={sendMutation.isPending}
                  autoCapitalize="sentences"
                  aria-label="Team message input"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!message.trim() || sendMutation.isPending}
                  aria-label="Send team message"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Quick Share to Team ────────────────────────────────────────────
interface ShareToTeamProps {
  entityType: "lead" | "deal" | "property" | "note";
  entityId: number;
  entityLabel: string;
}

export function ShareToTeamButton({ entityType, entityId, entityLabel }: ShareToTeamProps) {
  const { toast } = useToast();

  const { data: conversations } = useQuery<TeamConversation[]>({
    queryKey: ["/api/team-messaging/conversations"],
  });

  const generalChannel = conversations?.find(c => c.name === "General" && !c.isDirect);

  const shareMutation = useMutation({
    mutationFn: async () => {
      if (!generalChannel) throw new Error("No general channel");
      const body = `Check out this ${entityType}: ${entityLabel} — [${entityType.charAt(0).toUpperCase() + entityType.slice(1)} #${entityId} →]`;
      const res = await fetch(`/api/team-messaging/conversations/${generalChannel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to share");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Shared to team", description: `Shared ${entityLabel} to #General` });
    },
  });

  if (!generalChannel) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => shareMutation.mutate()}
      disabled={shareMutation.isPending}
      aria-label={`Share ${entityLabel} to team`}
    >
      <Share className="h-3 w-3 mr-1" />
      Share to Team
    </Button>
  );
}
