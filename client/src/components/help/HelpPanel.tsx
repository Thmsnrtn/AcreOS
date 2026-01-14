import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Search, BookOpen, MessageCircle, Send, ChevronLeft, Sparkles, Loader2, CheckCircle, AlertTriangle, Bell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SystemAlert {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
}

interface SupportTicket {
  id: number;
  subject: string;
  description: string;
  status: string;
  category: string;
  priority: string;
  createdAt: string;
  aiHandled: boolean;
}

interface TicketMessage {
  id: number;
  role: string;
  content: string;
  agentName?: string;
  toolsUsed?: string[];
  actionsPerformed?: any[];
  createdAt: string;
}

interface KnowledgeBaseArticle {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  category: string;
  content: string;
}

const helpTopics = [
  {
    category: "Getting Started",
    items: [
      { title: "Creating your first lead", description: "Learn how to add and manage leads in AcreOS" },
      { title: "Adding properties", description: "Track properties you're evaluating or own" },
      { title: "Managing deals", description: "Use the deal pipeline to track acquisitions and dispositions" },
    ]
  },
  {
    category: "AI Assistant",
    items: [
      { title: "Talking to Atlas", description: "Your AI assistant can help with research, analysis, and tasks" },
      { title: "Generating offers", description: "Let AI create offer letters based on property data" },
    ]
  },
  {
    category: "Keyboard Shortcuts",
    items: [
      { title: "Command Palette", description: "Press Cmd+K to quickly search and navigate" },
      { title: "Navigation shortcuts", description: "Use g+d, g+l, g+p to jump to pages" },
      { title: "Help", description: "Press Cmd+? to open this help panel anytime" },
    ]
  },
  {
    category: "Features",
    items: [
      { title: "Lead Management", description: "Import, track, and manage your land seller leads" },
      { title: "Property Tracking", description: "Track properties from research to sale with full details" },
      { title: "Campaign Management", description: "Run email, SMS, and direct mail campaigns" },
      { title: "Deal Pipeline", description: "Visualize and manage deals with Kanban-style workflow" },
      { title: "Finance & Notes", description: "Manage seller financing and track note performance" },
    ]
  },
];

export function HelpPanel() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("topics");
  const [supportView, setSupportView] = useState<"list" | "chat" | "new">("list");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [location] = useLocation();
  const queryClient = useQueryClient();

  const [newTicket, setNewTicket] = useState({
    subject: "",
    description: "",
    category: "general",
    priority: "normal"
  });

  const { data: tickets = [] } = useQuery<SupportTicket[]>({
    queryKey: ["/api/support/tickets"],
    enabled: activeTab === "support"
  });

  const { data: ticketData, refetch: refetchTicket } = useQuery<{ ticket: SupportTicket; messages: TicketMessage[] }>({
    queryKey: ["/api/support/tickets", selectedTicketId],
    enabled: supportView === "chat" && selectedTicketId !== null
  });

  const { data: articles = [] } = useQuery<KnowledgeBaseArticle[]>({
    queryKey: ["/api/support/knowledge-base"],
    enabled: activeTab === "topics"
  });

  // Query for proactive system alerts
  const { data: alertsData } = useQuery<{ alerts: SystemAlert[] }>({
    queryKey: ["/api/support/alerts"],
    enabled: activeTab === "support",
    refetchInterval: 60000 // Refresh every minute
  });
  const activeAlerts = alertsData?.alerts || [];

  const createTicketMutation = useMutation({
    mutationFn: async (data: typeof newTicket) => {
      const res = await apiRequest("POST", "/api/support/tickets", { ...data, pageContext: location });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      setSelectedTicketId(data.ticket?.id || data.id);
      setSupportView("chat");
      setNewTicket({ subject: "", description: "", category: "general", priority: "normal" });
    }
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", `/api/support/tickets/${selectedTicketId}/messages`, { message });
      return res.json();
    },
    onSuccess: () => {
      refetchTicket();
      setNewMessage("");
    }
  });

  const closeTicketMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/support/tickets/${selectedTicketId}/close`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      setSupportView("list");
      setSelectedTicketId(null);
    }
  });
  
  const filteredTopics = helpTopics.map(category => ({
    ...category,
    items: category.items.filter(item => 
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase())
    )
  })).filter(category => category.items.length > 0);

  const openTickets = tickets.filter(t => t.status === "open" || t.status === "in_progress");

  const handleSubmitTicket = () => {
    if (newTicket.subject && newTicket.description) {
      createTicketMutation.mutate(newTicket);
    }
  };

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      sendMessageMutation.mutate(newMessage);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="topics" data-testid="tab-help-topics">
            <BookOpen className="w-4 h-4 mr-2" />
            Help Topics
          </TabsTrigger>
          <TabsTrigger value="support" data-testid="tab-support">
            <MessageCircle className="w-4 h-4 mr-2" />
            Support
            {openTickets.length > 0 && (
              <Badge variant="secondary" className="ml-2">{openTickets.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="topics" className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search help topics..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-help-search"
            />
          </div>
          
          {filteredTopics.length > 0 ? (
            filteredTopics.map(category => (
              <div key={category.category} data-testid={`help-category-${category.category.toLowerCase().replace(/\s+/g, '-')}`}>
                <h3 className="font-semibold text-sm text-muted-foreground mb-2 flex items-center gap-1">
                  <BookOpen className="w-4 h-4" />
                  {category.category}
                </h3>
                <div className="space-y-2">
                  {category.items.map(item => (
                    <Card key={item.title} className="hover-elevate cursor-pointer transition-all" data-testid={`help-item-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <CardContent className="p-3">
                        <h4 className="font-medium text-sm">{item.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No help topics found for "{search}"</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="support" className="mt-4">
          {supportView === "list" && (
            <div className="space-y-4">
              {/* Proactive Alerts Section */}
              {activeAlerts.length > 0 && (
                <div className="space-y-2" data-testid="proactive-alerts-section">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                    <Bell className="h-4 w-4" />
                    Sophie noticed some issues
                  </div>
                  {activeAlerts.slice(0, 3).map((alert) => (
                    <Card 
                      key={alert.id} 
                      className={`border-l-4 ${
                        alert.severity === "critical" || alert.severity === "error" 
                          ? "border-l-destructive" 
                          : "border-l-amber-500"
                      }`}
                      data-testid={`alert-card-${alert.id}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                            alert.severity === "critical" || alert.severity === "error"
                              ? "text-destructive"
                              : "text-amber-500"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{alert.title}</p>
                            {alert.message && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{alert.message}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 w-full text-xs"
                          onClick={() => {
                            setNewTicket({
                              ...newTicket,
                              subject: `Help with: ${alert.title}`,
                              description: `I noticed an alert about: ${alert.title}\n\n${alert.message || ""}\n\nCan you help me fix this?`,
                              category: alert.type === "quota_warning" ? "billing" : "technical"
                            });
                            setSupportView("new");
                          }}
                          data-testid={`button-ask-about-alert-${alert.id}`}
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          Ask Sophie to help fix this
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {activeAlerts.length > 3 && (
                    <p className="text-xs text-muted-foreground text-center">
                      +{activeAlerts.length - 3} more alerts
                    </p>
                  )}
                </div>
              )}

              <Button
                className="w-full justify-start gap-2"
                onClick={() => setSupportView("new")}
                data-testid="button-new-support-ticket"
              >
                <Sparkles className="h-4 w-4" />
                Chat with Sophie (AI Support)
              </Button>

              {tickets.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Your Conversations</h4>
                  {tickets.map((ticket) => (
                    <Card
                      key={ticket.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => {
                        setSelectedTicketId(ticket.id);
                        setSupportView("chat");
                      }}
                      data-testid={`card-ticket-${ticket.id}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{ticket.subject}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(ticket.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge 
                            variant={
                              ticket.status === "closed" ? "outline" :
                              ticket.status === "resolved" ? "default" :
                              "secondary"
                            }
                          >
                            {ticket.status}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {tickets.length === 0 && (
                <div className="text-center py-6 text-muted-foreground">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No support conversations yet</p>
                  <p className="text-xs">Sophie can help with technical issues, account questions, and more</p>
                </div>
              )}
            </div>
          )}

          {supportView === "new" && (
            <div className="space-y-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSupportView("list")}
                className="mb-2"
                data-testid="button-back-to-tickets"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>

              <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg mb-4">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium text-sm">Chat with Sophie</p>
                  <p className="text-xs text-muted-foreground">AI-powered support assistant</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">What do you need help with?</label>
                <Input
                  placeholder="Brief summary of your issue"
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                  data-testid="input-ticket-subject"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-1 block">Describe the issue</label>
                <Textarea
                  placeholder="Please provide as much detail as possible..."
                  value={newTicket.description}
                  onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                  rows={3}
                  data-testid="input-ticket-description"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <Select
                    value={newTicket.category}
                    onValueChange={(v) => setNewTicket({ ...newTicket, category: v })}
                  >
                    <SelectTrigger data-testid="select-ticket-category" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="feature_request">Feature Request</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                  <Select
                    value={newTicket.priority}
                    onValueChange={(v) => setNewTicket({ ...newTicket, priority: v })}
                  >
                    <SelectTrigger data-testid="select-ticket-priority" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleSubmitTicket}
                disabled={!newTicket.subject || !newTicket.description || createTicketMutation.isPending}
                data-testid="button-submit-ticket"
              >
                {createTicketMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting conversation...
                  </>
                ) : (
                  <>
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Start Conversation
                  </>
                )}
              </Button>
            </div>
          )}

          {supportView === "chat" && ticketData && (
            <div className="flex flex-col h-80">
              <div className="flex items-center justify-between mb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSupportView("list");
                    setSelectedTicketId(null);
                  }}
                  data-testid="button-back-to-tickets"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
                {ticketData.ticket.status !== "closed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => closeTicketMutation.mutate()}
                    data-testid="button-close-ticket"
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Resolved
                  </Button>
                )}
              </div>

              <div className="p-2 bg-muted/50 rounded text-xs mb-2">
                <span className="font-medium">{ticketData.ticket.subject}</span>
              </div>
              
              <ScrollArea className="flex-1 pr-2">
                <div className="space-y-3">
                  {ticketData.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : msg.role === "system"
                            ? "bg-muted text-muted-foreground italic text-xs"
                            : "bg-card border"
                        }`}
                      >
                        {msg.role === "agent" && msg.agentName && (
                          <div className="text-xs font-medium text-primary mb-1 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            {msg.agentName}
                          </div>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                            Actions taken: {msg.toolsUsed.length}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {sendMessageMutation.isPending && (
                    <div className="flex justify-start">
                      <div className="bg-card border rounded-lg px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sophie is thinking...
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {ticketData.ticket.status !== "closed" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex gap-2 mt-3"
                >
                  <Input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1"
                    disabled={sendMessageMutation.isPending}
                    data-testid="input-support-message"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!newMessage.trim() || sendMessageMutation.isPending}
                    data-testid="button-send-support-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
