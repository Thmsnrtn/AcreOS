import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useTeamMembers } from "@/hooks/use-organization";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { 
  MessageCircle, 
  Send, 
  ArrowLeft, 
  Plus, 
  X, 
  Loader2,
  Lock,
  ArrowUpRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamConversation, TeamMessage } from "@shared/schema";

interface ConversationWithDetails extends TeamConversation {
  participantNames?: string[];
}

interface MessagesResponse {
  messages: TeamMessage[];
  nextCursor: number | null;
  hasMore: boolean;
}

interface SeatInfo {
  tier: string;
  includedSeats: number;
  additionalSeats: number;
  totalSeats: number;
  maxSeats: number | null;
  usedSeats: number;
  availableSeats: number;
  canAddSeats: boolean;
  seatPriceCents: number | null;
  hasTeamMessaging: boolean;
}

function TierGatingPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Lock className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Team Messaging</h3>
      <p 
        className="text-muted-foreground mb-4 max-w-[280px]"
        data-testid="text-tier-upgrade-prompt"
      >
        Team messaging is available on plans with 2 or more seats. Upgrade to Starter or higher to collaborate with your team in real-time.
      </p>
      <Button asChild>
        <a href="/settings">
          Upgrade Plan
          <ArrowUpRight className="w-4 h-4 ml-1" />
        </a>
      </Button>
    </div>
  );
}

function ConversationList({
  conversations,
  isLoading,
  onSelectConversation,
  onNewConversation,
  currentUserId,
  teamMembers,
}: {
  conversations: ConversationWithDetails[];
  isLoading: boolean;
  onSelectConversation: (conv: ConversationWithDetails) => void;
  onNewConversation: () => void;
  currentUserId: string;
  teamMembers: { userId: string; displayName: string | null }[];
}) {
  const getConversationDisplayName = (conv: ConversationWithDetails) => {
    if (conv.name) return conv.name;
    
    const otherParticipants = conv.participantIds?.filter(id => id !== currentUserId) || [];
    const names = otherParticipants.map(id => {
      const member = teamMembers.find(m => m.userId === id);
      return member?.displayName || "Unknown";
    });
    
    return names.length > 0 ? names.join(", ") : "Direct Message";
  };

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <h3 className="font-semibold">Messages</h3>
        <Button 
          size="icon" 
          variant="ghost" 
          onClick={onNewConversation}
          data-testid="button-new-conversation"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div 
          className="divide-y"
          data-testid="conversation-list"
        >
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <p className="text-sm">No conversations yet.</p>
              <p className="text-sm">Start a new message to begin chatting.</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const displayName = getConversationDisplayName(conv);
              return (
                <button
                  key={conv.id}
                  className="flex items-center gap-3 w-full p-3 text-left hover-elevate"
                  onClick={() => onSelectConversation(conv)}
                  data-testid={`conversation-item-${conv.id}`}
                >
                  <Avatar className="w-10 h-10">
                    <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{displayName}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {conv.lastMessageAt 
                        ? new Date(conv.lastMessageAt).toLocaleDateString() 
                        : "No messages yet"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function NewConversationView({
  onBack,
  onStartConversation,
  teamMembers,
  currentUserId,
  isCreating,
}: {
  onBack: () => void;
  onStartConversation: (participantId: string) => void;
  teamMembers: { userId: string; displayName: string | null }[];
  currentUserId: string;
  isCreating: boolean;
}) {
  const otherMembers = teamMembers.filter(m => m.userId !== currentUserId);
  
  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b">
        <Button size="icon" variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="font-semibold">New Message</h3>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="divide-y">
          {otherMembers.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <p className="text-sm">No team members available.</p>
            </div>
          ) : (
            otherMembers.map((member) => {
              const displayName = member.displayName || "Team Member";
              return (
                <button
                  key={member.userId}
                  className="flex items-center gap-3 w-full p-3 text-left hover-elevate disabled:opacity-50"
                  onClick={() => onStartConversation(member.userId)}
                  disabled={isCreating}
                  data-testid={`select-member-${member.userId}`}
                >
                  <Avatar className="w-10 h-10">
                    <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{displayName}</p>
                  </div>
                  {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ChatView({
  conversation,
  onBack,
  currentUserId,
  teamMembers,
}: {
  conversation: ConversationWithDetails;
  onBack: () => void;
  currentUserId: string;
  teamMembers: { userId: string; displayName: string | null }[];
}) {
  const [messageInput, setMessageInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: messagesData, isLoading: isLoadingMessages } = useQuery<MessagesResponse>({
    queryKey: ["/api/team-messaging/conversations", conversation.id, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/team-messaging/conversations/${conversation.id}/messages`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest(
        "POST",
        `/api/team-messaging/conversations/${conversation.id}/messages`,
        { body }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/team-messaging/conversations", conversation.id, "messages"] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/team-messaging/conversations"] 
      });
      setMessageInput("");
    },
  });

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;
    sendMessageMutation.mutate(messageInput.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getConversationDisplayName = () => {
    if (conversation.name) return conversation.name;
    
    const otherParticipants = conversation.participantIds?.filter(id => id !== currentUserId) || [];
    const names = otherParticipants.map(id => {
      const member = teamMembers.find(m => m.userId === id);
      return member?.displayName || "Unknown";
    });
    
    return names.length > 0 ? names.join(", ") : "Direct Message";
  };

  const getSenderName = (senderId: string) => {
    if (senderId === currentUserId) return "You";
    const member = teamMembers.find(m => m.userId === senderId);
    return member?.displayName || "Unknown";
  };

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesData?.messages]);

  const messages = messagesData?.messages || [];
  const sortedMessages = [...messages].sort((a, b) => a.id - b.id);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b">
        <Button size="icon" variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="font-semibold truncate">{getConversationDisplayName()}</h3>
      </div>
      
      <ScrollArea className="flex-1 p-3">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : sortedMessages.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-muted-foreground">
            <p className="text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedMessages.map((msg) => {
              const isOwn = msg.senderId === currentUserId;
              const senderName = getSenderName(msg.senderId);
              
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2",
                    isOwn ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {!isOwn && (
                    <Avatar className="w-8 h-8 flex-shrink-0">
                      <AvatarFallback className="text-xs">
                        {getInitials(senderName)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 max-w-[75%]",
                      isOwn
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {!isOwn && (
                      <p className="text-xs font-medium mb-1 opacity-70">
                        {senderName}
                      </p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                    <p className={cn(
                      "text-xs mt-1",
                      isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}>
                      {msg.createdAt && new Date(msg.createdAt).toLocaleTimeString([], { 
                        hour: "2-digit", 
                        minute: "2-digit" 
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>
      
      <Separator />
      <div className="p-3 flex items-center gap-2">
        <Input
          placeholder="Type a message..."
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sendMessageMutation.isPending}
          data-testid="input-message"
        />
        <Button
          size="icon"
          onClick={handleSendMessage}
          disabled={!messageInput.trim() || sendMessageMutation.isPending}
          data-testid="button-send-message"
        >
          {sendMessageMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function ConversationTrayContent({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const { data: teamMembers = [] } = useTeamMembers();
  const queryClient = useQueryClient();
  
  const [view, setView] = useState<"list" | "new" | "chat">("list");
  const [selectedConversation, setSelectedConversation] = useState<ConversationWithDetails | null>(null);
  
  const currentUserId = (user as any)?.claims?.sub || (user as any)?.id || "";
  
  const { data: seatInfo, isLoading: isSeatInfoLoading } = useQuery<SeatInfo>({
    queryKey: ["/api/organization/seats"],
    staleTime: 60000,
  });
  
  const hasMessagingAccess = seatInfo?.hasTeamMessaging ?? false;
  
  const { data: conversations = [], isLoading: isConversationsLoading } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/team-messaging/conversations"],
    queryFn: async () => {
      const res = await fetch("/api/team-messaging/conversations", { credentials: "include" });
      if (res.status === 403) {
        return [];
      }
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    enabled: hasMessagingAccess,
    refetchInterval: 10000,
  });

  const createConversationMutation = useMutation({
    mutationFn: async (participantId: string) => {
      const res = await apiRequest("POST", "/api/team-messaging/conversations", {
        isDirect: true,
        participantIds: [participantId],
      });
      return res.json() as Promise<ConversationWithDetails>;
    },
    onSuccess: (newConversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-messaging/conversations"] });
      setSelectedConversation(newConversation);
      setView("chat");
    },
  });

  const handleSelectConversation = (conv: ConversationWithDetails) => {
    setSelectedConversation(conv);
    setView("chat");
  };

  const handleNewConversation = () => {
    setView("new");
  };

  const handleBack = () => {
    setSelectedConversation(null);
    setView("list");
  };

  const handleStartConversation = (participantId: string) => {
    const existingConversation = conversations.find(conv => 
      conv.isDirect && 
      conv.participantIds?.includes(participantId) && 
      conv.participantIds?.includes(currentUserId)
    );

    if (existingConversation) {
      setSelectedConversation(existingConversation);
      setView("chat");
    } else {
      createConversationMutation.mutate(participantId);
    }
  };

  if (isSeatInfoLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasMessagingAccess) {
    return <TierGatingPrompt />;
  }

  if (view === "new") {
    return (
      <NewConversationView
        onBack={handleBack}
        onStartConversation={handleStartConversation}
        teamMembers={teamMembers}
        currentUserId={currentUserId}
        isCreating={createConversationMutation.isPending}
      />
    );
  }

  if (view === "chat" && selectedConversation) {
    return (
      <ChatView
        conversation={selectedConversation}
        onBack={handleBack}
        currentUserId={currentUserId}
        teamMembers={teamMembers}
      />
    );
  }

  return (
    <ConversationList
      conversations={conversations}
      isLoading={isConversationsLoading}
      onSelectConversation={handleSelectConversation}
      onNewConversation={handleNewConversation}
      currentUserId={currentUserId}
      teamMembers={teamMembers}
    />
  );
}

export function ConversationTray() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            className="fixed bottom-20 right-4 z-40 rounded-full shadow-lg"
            data-testid="button-open-conversations"
          >
            <MessageCircle className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-[85vh] p-0 rounded-t-xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Team Messages</SheetTitle>
          </SheetHeader>
          <ConversationTrayContent onClose={() => setIsOpen(false)} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      {!isOpen && (
        <Button
          size="icon"
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-lg"
          onClick={() => setIsOpen(true)}
          data-testid="button-open-conversations"
        >
          <MessageCircle className="w-5 h-5" />
        </Button>
      )}
      
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-40 w-[360px] h-[500px] bg-background border rounded-lg shadow-xl flex flex-col overflow-hidden">
          <div className="absolute top-2 right-2 z-10">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              data-testid="button-close-conversations"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ConversationTrayContent onClose={() => setIsOpen(false)} />
        </div>
      )}
    </>
  );
}
