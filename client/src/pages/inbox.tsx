import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import type { InboxMessage, Lead } from "@shared/schema";
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
  ExternalLink
} from "lucide-react";
import { Link } from "wouter";

type FilterTab = "all" | "unread" | "starred" | "archived";

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

function MessageRow({ 
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
        
        <div className="flex items-center gap-2 mt-1">
          {leadName && (
            <Badge variant="outline" className="text-xs">
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
        data-testid={`button-star-${message.id}`}
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

function MessageDetail({ 
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

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (activeTab === "unread") {
      params.isRead = "false";
      params.isArchived = "false";
    } else if (activeTab === "starred") {
      params.isStarred = "true";
      params.isArchived = "false";
    } else if (activeTab === "archived") {
      params.isArchived = "true";
    } else {
      params.isArchived = "false";
    }
    return params;
  }, [activeTab]);

  const { data: messages = [], isLoading } = useQuery<InboxMessage[]>({
    queryKey: ["/api/inbox", queryParams],
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
  });

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const unreadCount = unreadCountData?.count ?? 0;

  const leadsMap = useMemo(() => {
    const map = new Map<number, Lead>();
    leads.forEach(lead => map.set(lead.id, lead));
    return map;
  }, [leads]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const query = searchQuery.toLowerCase();
    return messages.filter(m => 
      m.senderName?.toLowerCase().includes(query) ||
      m.senderEmail?.toLowerCase().includes(query) ||
      m.subject?.toLowerCase().includes(query) ||
      m.bodyText?.toLowerCase().includes(query)
    );
  }, [messages, searchQuery]);

  const selectedMessage = useMemo(() => {
    if (!selectedMessageId) return null;
    return messages.find(m => m.id === selectedMessageId) || null;
  }, [messages, selectedMessageId]);

  const selectedLead = useMemo(() => {
    if (!selectedMessage?.leadId) return undefined;
    return leadsMap.get(selectedMessage.leadId);
  }, [selectedMessage, leadsMap]);

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

  const handleSelectMessage = (message: InboxMessage) => {
    setSelectedMessageId(message.id);
    if (!message.isRead) {
      markReadMutation.mutate(message.id);
    }
  };

  const getEmptyMessage = () => {
    switch (activeTab) {
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
      
      <main className="flex-1 md:ml-64 flex flex-col h-screen">
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

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)} className="border-b">
          <TabsList className="w-full justify-start rounded-none border-none h-12 p-0 bg-transparent">
            <TabsTrigger 
              value="all" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-all"
            >
              All
            </TabsTrigger>
            <TabsTrigger 
              value="unread"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-unread"
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
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-starred"
            >
              Starred
            </TabsTrigger>
            <TabsTrigger 
              value="archived"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-archived"
            >
              Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 flex overflow-hidden">
          <div className={`${selectedMessage ? "hidden md:block" : ""} w-full md:w-96 border-r overflow-hidden flex flex-col`}>
            {isLoading ? (
              <ListSkeleton count={5} />
            ) : filteredMessages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-4">
                <EmptyState 
                  icon={Mail}
                  {...getEmptyMessage()}
                />
              </div>
            ) : (
              <ScrollArea className="flex-1">
                {filteredMessages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    isSelected={selectedMessageId === message.id}
                    onSelect={() => handleSelectMessage(message)}
                    leadName={message.leadId ? 
                      (() => {
                        const lead = leadsMap.get(message.leadId!);
                        return lead ? `${lead.firstName} ${lead.lastName}` : undefined;
                      })() : undefined
                    }
                  />
                ))}
              </ScrollArea>
            )}
          </div>

          <div className={`${selectedMessage ? "" : "hidden md:flex"} flex-1 flex flex-col`}>
            {selectedMessage ? (
              <MessageDetail
                message={selectedMessage}
                lead={selectedLead}
                onBack={() => setSelectedMessageId(null)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select a message to read</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
