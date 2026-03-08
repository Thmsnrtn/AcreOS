import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import type { InboxMessage, Lead, Conversation, Message } from "@shared/schema";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/list-skeleton";
import { 
  Search, 
  Mail, 
  Star, 
  Archive, 
  ArrowLeft,
  Send,
  MailOpen,
  Loader2,
  User,
  ExternalLink,
  MessageSquare,
  Phone
} from "lucide-react";
import { Link } from "wouter";

type ChannelFilter = "all" | "email" | "sms";
type StatusFilter = "all" | "unread" | "starred" | "archived";

type UnifiedItem = {
  type: "email";
  data: InboxMessage;
  timestamp: Date;
} | {
  type: "sms";
  data: Conversation;
  timestamp: Date;
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "??";
}

function formatMessageDate(date: Date | string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return format(d, "h:mm a");
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return format(d, "EEEE");
  } else {
    return format(d, "MMM d");
  }
}

function ChannelBadge({ channel }: { channel: "email" | "sms" }) {
  if (channel === "sms") {
    return (
      <Badge variant="outline" className="text-xs flex items-center gap-1" data-testid="badge-channel-sms">
        <Phone className="h-3 w-3" />
        SMS
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs flex items-center gap-1" data-testid="badge-channel-email">
      <Mail className="h-3 w-3" />
      Email
    </Badge>
  );
}

function EmailMessageRow({ 
  message, 
  isSelected, 
  onSelect,
  leadName
}: { 
  message: InboxMessage; 
  isSelected: boolean; 
  onSelect: () => void;
  leadName?: string;
}) {
  const starMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/star`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  return (
    <div
      data-testid={`inbox-message-row-${message.id}`}
      onClick={onSelect}
      className={`flex items-start gap-3 p-3 cursor-pointer border-b transition-colors ${
        isSelected 
          ? "bg-accent" 
          : message.isRead 
            ? "hover-elevate" 
            : "bg-accent/30 hover-elevate"
      }`}
    >
      <Avatar className="h-9 w-9 flex-shrink-0">
        <AvatarFallback className="text-xs">
          {getInitials(message.senderName, message.senderEmail)}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm truncate ${!message.isRead ? "font-semibold" : ""}`}>
            {message.senderName || message.senderEmail}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatMessageDate(message.receivedAt)}
          </span>
        </div>
        
        <div className={`text-sm truncate ${!message.isRead ? "font-medium" : "text-muted-foreground"}`}>
          {message.subject || "(No subject)"}
        </div>
        
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <ChannelBadge channel="email" />
          {leadName && (
            <Badge variant="secondary" className="text-xs">
              {leadName}
            </Badge>
          )}
          {!message.isRead && (
            <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
          )}
        </div>
      </div>
      
      <Button
        size="icon"
        variant="ghost"
        data-testid={`button-star-email-${message.id}`}
        onClick={(e) => {
          e.stopPropagation();
          starMutation.mutate();
        }}
        className={message.isStarred ? "text-yellow-500" : "text-muted-foreground"}
      >
        <Star className={`h-4 w-4 ${message.isStarred ? "fill-current" : ""}`} />
      </Button>
    </div>
  );
}

function SMSConversationRow({ 
  conversation, 
  isSelected, 
  onSelect,
  lead
}: { 
  conversation: Conversation; 
  isSelected: boolean; 
  onSelect: () => void;
  lead?: Lead;
}) {
  const leadName = lead ? `${lead.firstName} ${lead.lastName}` : undefined;
  
  return (
    <div
      data-testid={`sms-conversation-row-${conversation.id}`}
      onClick={onSelect}
      className={`flex items-start gap-3 p-3 cursor-pointer border-b transition-colors ${
        isSelected ? "bg-accent" : "hover-elevate"
      }`}
    >
      <Avatar className="h-9 w-9 flex-shrink-0">
        <AvatarFallback className="text-xs">
          {getInitials(leadName, lead?.phone)}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm truncate font-medium">
            {leadName || lead?.phone || "Unknown"}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatMessageDate(conversation.lastMessageAt)}
          </span>
        </div>
        
        <div className="text-sm truncate text-muted-foreground">
          SMS Conversation
        </div>
        
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <ChannelBadge channel="sms" />
          {lead?.phone && (
            <Badge variant="secondary" className="text-xs">
              {lead.phone}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailMessageDetail({ 
  message,
  lead,
  onBack
}: { 
  message: InboxMessage;
  lead?: Lead;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);

  const markReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/read`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/unread`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
    },
  });

  const starMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/star`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
      toast({
        title: "Message archived",
        description: "The message has been moved to archive.",
      });
      onBack();
    },
  });

  const sendReplyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/send-email", {
        to: message.senderEmail,
        subject: `Re: ${message.subject || "(No subject)"}`,
        text: replyText,
        html: `<p>${replyText.replace(/\n/g, "<br>")}</p>`,
        inReplyToMessageId: message.messageId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Reply sent",
        description: "Your reply has been sent successfully.",
      });
      setReplyText("");
      setShowReply(false);
    },
    onError: () => {
      toast({
        title: "Failed to send",
        description: "Could not send your reply. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b flex-wrap">
        <Button 
          size="icon" 
          variant="ghost" 
          onClick={onBack}
          className="md:hidden"
          data-testid="button-back-to-list"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <ChannelBadge channel="email" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => message.isRead ? markUnreadMutation.mutate() : markReadMutation.mutate()}
            disabled={markReadMutation.isPending || markUnreadMutation.isPending}
            data-testid="button-toggle-read"
          >
            {markReadMutation.isPending || markUnreadMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : message.isRead ? (
              <Mail className="h-4 w-4 mr-1" />
            ) : (
              <MailOpen className="h-4 w-4 mr-1" />
            )}
            {message.isRead ? "Mark Unread" : "Mark Read"}
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            onClick={() => starMutation.mutate()}
            disabled={starMutation.isPending}
            data-testid="button-star-message"
            className={message.isStarred ? "text-yellow-500" : ""}
          >
            <Star className={`h-4 w-4 mr-1 ${message.isStarred ? "fill-current" : ""}`} />
            {message.isStarred ? "Unstar" : "Star"}
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
            data-testid="button-archive-message"
          >
            {archiveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Archive className="h-4 w-4 mr-1" />
            )}
            Archive
          </Button>
          
          <Button
            size="sm"
            onClick={() => setShowReply(!showReply)}
            data-testid="button-reply"
          >
            <Send className="h-4 w-4 mr-1" />
            Reply
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>
                {getInitials(message.senderName, message.senderEmail)}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium">
                    {message.senderName || message.senderEmail}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {message.senderEmail}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {message.receivedAt && format(new Date(message.receivedAt), "PPpp")}
                </div>
              </div>
              
              {lead && (
                <Link 
                  href={`/leads?id=${lead.id}`}
                  className="inline-flex items-center gap-1 mt-2 text-sm text-primary"
                  data-testid="link-to-lead"
                >
                  <User className="h-3 w-3" />
                  {lead.firstName} {lead.lastName}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <h2 className="text-lg font-semibold mb-4">
              {message.subject || "(No subject)"}
            </h2>
            
            {message.bodyHtml ? (
              <div 
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
              />
            ) : (
              <div className="whitespace-pre-wrap text-sm">
                {message.bodyText || "(No content)"}
              </div>
            )}
          </div>

          {showReply && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Reply to {message.senderName || message.senderEmail}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Type your reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={5}
                  data-testid="input-reply-text"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowReply(false)}
                    data-testid="button-cancel-reply"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => sendReplyMutation.mutate()}
                    disabled={!replyText.trim() || sendReplyMutation.isPending}
                    data-testid="button-send-reply"
                  >
                    {sendReplyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1" />
                    )}
                    Send
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SMSConversationDetail({ 
  conversation,
  lead,
  onBack
}: { 
  conversation: Conversation;
  lead?: Lead;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [newMessage, setNewMessage] = useState("");

  const { data: messages = [], isLoading: isLoadingMessages } = useQuery<Message[]>({
    queryKey: ["/api/conversations", conversation.id, "messages"],
  });

  const sendSmsMutation = useMutation({
    mutationFn: async () => {
      if (!lead?.id) throw new Error("No lead associated with this conversation");
      const res = await apiRequest("POST", `/api/leads/${lead.id}/sms`, {
        message: newMessage,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "SMS sent",
        description: "Your message has been sent successfully.",
      });
      setNewMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send SMS",
        description: error.message || "Could not send your message. Please try again.",
        variant: "destructive",
      });
    },
  });

  const leadName = lead ? `${lead.firstName} ${lead.lastName}` : "Unknown";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b flex-wrap">
        <Button 
          size="icon" 
          variant="ghost" 
          onClick={onBack}
          className="md:hidden"
          data-testid="button-back-to-list-sms"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex items-center gap-3 flex-1">
          <Avatar className="h-10 w-10">
            <AvatarFallback>
              {getInitials(leadName, lead?.phone)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium flex items-center gap-2">
              {leadName}
              <ChannelBadge channel="sms" />
            </div>
            <div className="text-sm text-muted-foreground">
              {lead?.phone || "No phone number"}
            </div>
          </div>
        </div>
        
        {lead && (
          <Link 
            href={`/leads?id=${lead.id}`}
            data-testid="link-to-lead-sms"
          >
            <Button size="sm" variant="outline">
              <User className="h-4 w-4 mr-1" />
              View Lead
            </Button>
          </Link>
        )}
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mb-2 opacity-50" />
            <p>No messages yet</p>
            <p className="text-sm">Send a message to start the conversation</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                data-testid={`sms-message-${msg.id}`}
                className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-lg ${
                    msg.direction === "outbound"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-xs mt-1 ${
                    msg.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}>
                    {formatMessageDate(msg.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            placeholder="Type your message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            rows={2}
            className="resize-none"
            data-testid="input-sms-message"
          />
          <Button
            onClick={() => sendSmsMutation.mutate()}
            disabled={!newMessage.trim() || sendSmsMutation.isPending || !lead?.id}
            data-testid="button-send-sms"
          >
            {sendSmsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        {!lead?.id && (
          <p className="text-xs text-muted-foreground mt-2">
            Cannot send SMS - no lead associated with this conversation
          </p>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { isCollapsed } = useSidebarCollapsed();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);

  const emailQueryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (statusFilter === "unread") {
      params.isRead = "false";
      params.isArchived = "false";
    } else if (statusFilter === "starred") {
      params.isStarred = "true";
      params.isArchived = "false";
    } else if (statusFilter === "archived") {
      params.isArchived = "true";
    } else {
      params.isArchived = "false";
    }
    return params;
  }, [statusFilter]);

  const { data: emailMessages = [], isLoading: isLoadingEmail } = useQuery<InboxMessage[]>({
    queryKey: ["/api/inbox", emailQueryParams],
    enabled: channelFilter === "all" || channelFilter === "email",
  });

  const { data: smsConversations = [], isLoading: isLoadingSms } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations", { channel: "sms" }],
    enabled: channelFilter === "all" || channelFilter === "sms",
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
  });

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const unreadCount = unreadCountData?.count ?? 0;
  const isLoading = isLoadingEmail || isLoadingSms;

  const leadsMap = useMemo(() => {
    const map = new Map<number, Lead>();
    leads.forEach(lead => map.set(lead.id, lead));
    return map;
  }, [leads]);

  const unifiedItems = useMemo(() => {
    const items: UnifiedItem[] = [];
    
    if (channelFilter === "all" || channelFilter === "email") {
      emailMessages.forEach(msg => {
        items.push({
          type: "email",
          data: msg,
          timestamp: msg.receivedAt ? new Date(msg.receivedAt) : new Date(0),
        });
      });
    }
    
    if (channelFilter === "all" || channelFilter === "sms") {
      smsConversations.forEach(conv => {
        items.push({
          type: "sms",
          data: conv,
          timestamp: conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(0),
        });
      });
    }
    
    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return items;
  }, [emailMessages, smsConversations, channelFilter]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return unifiedItems;
    const query = searchQuery.toLowerCase();
    return unifiedItems.filter(item => {
      if (item.type === "email") {
        const msg = item.data;
        return (
          msg.senderName?.toLowerCase().includes(query) ||
          msg.senderEmail?.toLowerCase().includes(query) ||
          msg.subject?.toLowerCase().includes(query) ||
          msg.bodyText?.toLowerCase().includes(query)
        );
      } else {
        const conv = item.data;
        const lead = leadsMap.get(conv.leadId);
        const leadName = lead ? `${lead.firstName} ${lead.lastName}`.toLowerCase() : "";
        const phone = lead?.phone?.toLowerCase() || "";
        return leadName.includes(query) || phone.includes(query);
      }
    });
  }, [unifiedItems, searchQuery, leadsMap]);

  const selectedLead = useMemo(() => {
    if (!selectedItem) return undefined;
    if (selectedItem.type === "email" && selectedItem.data.leadId) {
      return leadsMap.get(selectedItem.data.leadId);
    }
    if (selectedItem.type === "sms") {
      return leadsMap.get(selectedItem.data.leadId);
    }
    return undefined;
  }, [selectedItem, leadsMap]);

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/inbox/${id}/read`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
    },
  });

  const handleSelectItem = (item: UnifiedItem) => {
    setSelectedItem(item);
    if (item.type === "email" && !item.data.isRead) {
      markReadMutation.mutate(item.data.id);
    }
  };

  const getEmptyMessage = () => {
    if (channelFilter === "sms") {
      return { title: "No SMS conversations", description: "SMS conversations will appear here." };
    }
    switch (statusFilter) {
      case "unread":
        return { title: "No unread messages", description: "You're all caught up!" };
      case "starred":
        return { title: "No starred messages", description: "Star messages to find them quickly." };
      case "archived":
        return { title: "No archived messages", description: "Archived messages will appear here." };
      default:
        return { title: "No messages", description: "Your inbox is empty." };
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className={`flex-1 pt-16 md:pt-0 flex flex-col h-screen transition-all duration-200 ${isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"}`}>
        <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" data-testid="text-inbox-title">Inbox</h1>
            {unreadCount > 0 && (
              <Badge variant="secondary" data-testid="badge-unread-count">
                {unreadCount}
              </Badge>
            )}
          </div>
          
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-inbox"
            />
          </div>
        </div>

        <Tabs value={channelFilter} onValueChange={(v) => setChannelFilter(v as ChannelFilter)} className="border-b">
          <TabsList className="w-full justify-start rounded-none border-none h-12 p-0 bg-transparent">
            <TabsTrigger 
              value="all" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-channel-all"
            >
              <MessageSquare className="h-4 w-4 mr-1" />
              All Channels
            </TabsTrigger>
            <TabsTrigger 
              value="email"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-channel-email"
            >
              <Mail className="h-4 w-4 mr-1" />
              Email
              {unreadCount > 0 && channelFilter !== "email" && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="sms"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-channel-sms"
            >
              <Phone className="h-4 w-4 mr-1" />
              SMS
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {channelFilter !== "sms" && (
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="border-b">
            <TabsList className="w-full justify-start rounded-none border-none h-10 p-0 bg-transparent">
              <TabsTrigger 
                value="all" 
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-all"
              >
                All
              </TabsTrigger>
              <TabsTrigger 
                value="unread"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-unread"
              >
                Unread
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="starred"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-starred"
              >
                Starred
              </TabsTrigger>
              <TabsTrigger 
                value="archived"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-archived"
              >
                Archived
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className={`${selectedItem ? "hidden md:block" : ""} w-full md:w-96 border-r overflow-hidden flex flex-col`}>
            {isLoading ? (
              <ListSkeleton count={5} />
            ) : filteredItems.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-4">
                <EmptyState 
                  icon={channelFilter === "sms" ? Phone : Mail}
                  {...getEmptyMessage()}
                />
              </div>
            ) : (
              <ScrollArea className="flex-1">
                {filteredItems.map((item) => (
                  item.type === "email" ? (
                    <EmailMessageRow
                      key={`email-${item.data.id}`}
                      message={item.data}
                      isSelected={selectedItem?.type === "email" && selectedItem.data.id === item.data.id}
                      onSelect={() => handleSelectItem(item)}
                      leadName={item.data.leadId ? 
                        (() => {
                          const lead = leadsMap.get(item.data.leadId!);
                          return lead ? `${lead.firstName} ${lead.lastName}` : undefined;
                        })() : undefined
                      }
                    />
                  ) : (
                    <SMSConversationRow
                      key={`sms-${item.data.id}`}
                      conversation={item.data}
                      isSelected={selectedItem?.type === "sms" && selectedItem.data.id === item.data.id}
                      onSelect={() => handleSelectItem(item)}
                      lead={leadsMap.get(item.data.leadId)}
                    />
                  )
                ))}
              </ScrollArea>
            )}
          </div>

          <div className={`${selectedItem ? "" : "hidden md:flex"} flex-1 flex flex-col`}>
            {selectedItem ? (
              selectedItem.type === "email" ? (
                <EmailMessageDetail
                  message={selectedItem.data}
                  lead={selectedLead}
                  onBack={() => setSelectedItem(null)}
                />
              ) : (
                <SMSConversationDetail
                  conversation={selectedItem.data}
                  lead={selectedLead}
                  onBack={() => setSelectedItem(null)}
                />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select a conversation to view</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
