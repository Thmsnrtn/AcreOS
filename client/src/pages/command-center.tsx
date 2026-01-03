import { useState, useRef, useEffect } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Bot,
  Target,
  Calculator,
  Megaphone,
  Search,
  FileText,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
  ChevronRight,
  Wrench,
  Users,
  Settings2,
  Zap,
  Clock,
  CheckCircle,
  AlertCircle,
  DollarSign,
  Mail,
  Phone,
  TrendingUp,
  Brain,
  Briefcase,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface Agent {
  name: string;
  role: string;
  displayName: string;
  description: string;
  icon: string;
}

interface Message {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: any;
    result: any;
  }>;
  createdAt: string;
}

interface Conversation {
  id: number;
  organizationId: number;
  userId: string;
  title: string;
  agentRole: string;
  createdAt: string;
  updatedAt: string;
}

const agentIcons: Record<string, typeof Bot> = {
  Bot,
  Target,
  Calculator,
  Megaphone,
  Search,
  FileText,
  Briefcase,
  DollarSign,
};

function getAgentIcon(iconName: string) {
  return agentIcons[iconName] || Bot;
}

// Detailed AI Agent documentation for the AI Team panel
const agentDocumentation: Record<string, {
  fullName: string;
  icon: typeof Bot;
  category: string;
  overview: string;
  capabilities: string[];
  howItWorks: string;
  customization: string[];
  triggers: string[];
  outputs: string[];
  bestPractices: string[];
}> = {
  executive: {
    fullName: "Executive Assistant",
    icon: Briefcase,
    category: "Strategic",
    overview: "Your high-level business strategist that oversees all operations, provides strategic insights, and helps with decision-making across your entire land investing business.",
    capabilities: [
      "Generate daily and weekly business briefings",
      "Analyze overall portfolio performance",
      "Identify trends and opportunities across deals",
      "Provide strategic recommendations",
      "Coordinate between other AI agents",
    ],
    howItWorks: "The Executive agent analyzes data from all areas of your business - leads, properties, notes, campaigns, and deals - to provide holistic insights and recommendations. It monitors KPIs and alerts you to important changes.",
    customization: [
      "Set preferred briefing schedule (daily, weekly)",
      "Choose which metrics to prioritize",
      "Adjust risk tolerance for recommendations",
      "Configure notification preferences",
    ],
    triggers: [
      "Scheduled briefings (configurable)",
      "Significant changes in portfolio metrics",
      "When you ask for strategic analysis",
      "Deal milestones reached",
    ],
    outputs: [
      "Business performance summaries",
      "Strategic recommendations",
      "Risk assessments",
      "Opportunity identification",
    ],
    bestPractices: [
      "Review daily briefings each morning",
      "Use for high-level decision making",
      "Ask specific questions about business direction",
    ],
  },
  sales: {
    fullName: "Sales & Buyer Relations",
    icon: MessageSquare,
    category: "Revenue",
    overview: "Manages all buyer communications, follow-ups, and relationship nurturing to maximize your disposition sales and repeat buyers.",
    capabilities: [
      "Generate personalized follow-up messages",
      "Track buyer engagement and interest levels",
      "Create buyer profiles and preferences",
      "Recommend properties to specific buyers",
      "Draft and optimize sales communications",
    ],
    howItWorks: "The Sales agent monitors your buyer leads and their interactions. It identifies when follow-up is needed, drafts personalized communications, and helps match buyers to available properties based on their stated preferences and behavior.",
    customization: [
      "Set follow-up timing rules",
      "Adjust communication tone (formal, casual)",
      "Configure price negotiation parameters",
      "Define buyer qualification criteria",
    ],
    triggers: [
      "New buyer inquiry received",
      "Time-based follow-up reminders",
      "Property becomes available matching buyer criteria",
      "Buyer engagement drops off",
    ],
    outputs: [
      "Follow-up emails and messages",
      "Property recommendations",
      "Buyer interest reports",
      "Negotiation suggestions",
    ],
    bestPractices: [
      "Review proposed follow-ups before sending",
      "Keep buyer preferences updated",
      "Use for personalized outreach at scale",
    ],
  },
  acquisitions: {
    fullName: "Acquisitions & Seller Outreach",
    icon: Target,
    category: "Deal Flow",
    overview: "Handles seller communications, offer generation, and deal negotiation to help you acquire more properties at better prices.",
    capabilities: [
      "Generate offers based on comps and market data",
      "Draft offer letters and purchase agreements",
      "Track seller responses and negotiations",
      "Score and prioritize seller leads",
      "Recommend counter-offer strategies",
    ],
    howItWorks: "The Acquisitions agent analyzes incoming seller leads, scores them based on motivation and property characteristics, and helps craft appropriate offers. It tracks negotiation history and suggests optimal counter-offer strategies.",
    customization: [
      "Set offer calculation formulas",
      "Adjust negotiation aggressiveness",
      "Configure due diligence requirements",
      "Define deal criteria and limits",
    ],
    triggers: [
      "New seller lead from campaigns",
      "Seller responds to initial offer",
      "Counter-offer received",
      "Due diligence deadline approaching",
    ],
    outputs: [
      "Offer letters and purchase agreements",
      "Counter-offer recommendations",
      "Lead scoring reports",
      "Deal analysis summaries",
    ],
    bestPractices: [
      "Always verify AI-generated offer amounts",
      "Review due diligence findings",
      "Use for consistent offer presentation",
    ],
  },
  marketing: {
    fullName: "Marketing & Campaigns",
    icon: Megaphone,
    category: "Lead Generation",
    overview: "Creates and optimizes your marketing campaigns across direct mail, email, and SMS to generate quality seller leads.",
    capabilities: [
      "Generate campaign content and messaging",
      "Optimize campaign timing and targeting",
      "Analyze campaign performance metrics",
      "A/B test recommendations",
      "Create follow-up sequences",
    ],
    howItWorks: "The Marketing agent monitors your campaign performance, identifies what's working, and suggests improvements. It can generate new campaign content, recommend targeting adjustments, and help you get better response rates.",
    customization: [
      "Set campaign budget constraints",
      "Define target demographics",
      "Adjust messaging style and tone",
      "Configure response tracking",
    ],
    triggers: [
      "New campaign creation",
      "Campaign performance drops",
      "A/B test results available",
      "Budget milestone reached",
    ],
    outputs: [
      "Campaign content drafts",
      "Performance analysis reports",
      "Optimization recommendations",
      "Audience segmentation suggestions",
    ],
    bestPractices: [
      "Test AI content variations",
      "Review targeting suggestions weekly",
      "Use for creative ideation",
    ],
  },
  collections: {
    fullName: "Collections & Payment Management",
    icon: DollarSign,
    category: "Finance",
    overview: "Manages payment reminders, delinquency escalation, and borrower communications for your seller-financed notes.",
    capabilities: [
      "Send automated payment reminders",
      "Escalate delinquent accounts progressively",
      "Track payment history and patterns",
      "Generate late notices and demand letters",
      "Recommend collection strategies",
    ],
    howItWorks: "The Collections agent monitors all your notes for payment activity. It follows a 4-tier escalation process: friendly reminders, formal notices, demand letters, and escalation alerts. It helps maintain cash flow while preserving borrower relationships.",
    customization: [
      "Set grace period duration",
      "Adjust escalation timeline",
      "Configure communication frequency",
      "Define hardship case handling",
    ],
    triggers: [
      "Payment due date approaching",
      "Payment becomes past due",
      "Escalation tier threshold reached",
      "Borrower communication received",
    ],
    outputs: [
      "Payment reminder emails/SMS",
      "Late payment notices",
      "Demand letters",
      "Delinquency reports",
    ],
    bestPractices: [
      "Review escalated cases personally",
      "Keep communication templates updated",
      "Balance firmness with relationships",
    ],
  },
  research: {
    fullName: "Research & Due Diligence",
    icon: Search,
    category: "Analysis",
    overview: "Performs property research, due diligence verification, and market analysis to help you make informed acquisition decisions.",
    capabilities: [
      "Research property details and history",
      "Verify title and lien status",
      "Analyze comparable sales",
      "Assess market conditions",
      "Generate due diligence reports",
    ],
    howItWorks: "The Research agent gathers and analyzes property information from available sources. It checks for potential issues, researches market values, and compiles findings into actionable reports to support your acquisition decisions.",
    customization: [
      "Set research depth level",
      "Define required due diligence items",
      "Configure alert thresholds",
      "Adjust valuation methodology",
    ],
    triggers: [
      "New property added for review",
      "Due diligence requested",
      "Comparable sales analysis needed",
      "Market report requested",
    ],
    outputs: [
      "Property research summaries",
      "Due diligence checklists",
      "Comparable sales reports",
      "Market analysis",
    ],
    bestPractices: [
      "Verify critical findings independently",
      "Use as starting point, not final word",
      "Request specific research focus areas",
    ],
  },
};

// AI Team Panel Component - Shows detailed agent documentation
function AITeamPanel() {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border glass-panel">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">AI Team Management</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Your dedicated AI workforce. Each agent specializes in a key area of your land investing business.
        </p>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 max-w-4xl mx-auto">
          {Object.entries(agentDocumentation).map(([role, doc]) => {
            const isExpanded = expandedAgent === role;
            const IconComponent = doc.icon;
            
            return (
              <Card
                key={role}
                className={`transition-all ${isExpanded ? "ring-2 ring-primary" : ""}`}
                data-testid={`card-agent-doc-${role}`}
              >
                <div
                  onClick={() => setExpandedAgent(isExpanded ? null : role)}
                  className="cursor-pointer"
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <IconComponent className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{doc.fullName}</CardTitle>
                        <Badge variant="secondary" className="mt-1">{doc.category}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        <Zap className="w-3 h-3 mr-1" />
                        Active
                      </Badge>
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-muted-foreground">{doc.overview}</p>
                  </CardContent>
                </div>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-6">
                    <div className="pt-4 border-t border-border">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="w-4 h-4 text-accent" />
                        <h4 className="font-medium text-sm">Capabilities</h4>
                      </div>
                      <ul className="space-y-2">
                        {doc.capabilities.map((cap, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                            {cap}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Brain className="w-4 h-4 text-accent" />
                        <h4 className="font-medium text-sm">How It Works</h4>
                      </div>
                      <p className="text-sm text-muted-foreground">{doc.howItWorks}</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Zap className="w-4 h-4 text-accent" />
                          <h4 className="font-medium text-sm">Triggers</h4>
                        </div>
                        <ul className="space-y-1.5">
                          {doc.triggers.map((trigger, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                              <Clock className="w-3 h-3 mt-1 shrink-0" />
                              {trigger}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <FileText className="w-4 h-4 text-accent" />
                          <h4 className="font-medium text-sm">Outputs</h4>
                        </div>
                        <ul className="space-y-1.5">
                          {doc.outputs.map((output, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                              <ChevronRight className="w-3 h-3 mt-1 shrink-0" />
                              {output}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Settings2 className="w-4 h-4 text-accent" />
                        <h4 className="font-medium text-sm">Customization Options</h4>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {doc.customization.map((opt, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {opt}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="bg-muted/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertCircle className="w-4 h-4 text-accent" />
                        <h4 className="font-medium text-sm">Best Practices</h4>
                      </div>
                      <ul className="space-y-2">
                        {doc.bestPractices.map((practice, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                            <TrendingUp className="w-3 h-3 mt-1 shrink-0 text-primary" />
                            {practice}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function CommandCenterPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<string>("chat");
  const [desktopView, setDesktopView] = useState<"chat" | "team">("chat");
  const [input, setInput] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("executive");
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ name: string; result?: any }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["/api/ai/agents"],
  });

  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/ai/conversations"],
  });

  const { data: currentConversation, isLoading: messagesLoading } = useQuery<{
    conversation: Conversation;
    messages: Message[];
  }>({
    queryKey: ["/api/ai/conversations", currentConversationId],
    enabled: !!currentConversationId,
  });

  const createConversationMutation = useMutation({
    mutationFn: async (agentRole: string) => {
      const res = await apiRequest("POST", "/api/ai/conversations", { agentRole });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (conversation) => {
      setCurrentConversationId(conversation.id);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/conversations/${id}`, {});
    },
    onSuccess: () => {
      if (currentConversationId) {
        setCurrentConversationId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentConversation?.messages, streamingContent]);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const message = input.trim();
    setInput("");
    setStreamingContent("");
    setPendingToolCalls([]);
    setIsStreaming(true);

    if (isMobile && mobileTab !== "chat") {
      setMobileTab("chat");
    }

    try {
      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: currentConversationId,
          agentRole: selectedAgent,
        }),
        credentials: "include",
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "content" && data.content) {
                accumulatedContent += data.content;
                setStreamingContent(accumulatedContent);
              } else if (data.type === "tool_start") {
                setPendingToolCalls((prev) => [...prev, { name: data.toolCall?.name }]);
              } else if (data.type === "tool_result") {
                setPendingToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.name === data.toolCall?.name ? { ...tc, result: data.toolCall?.result } : tc
                  )
                );
              } else if (data.type === "done") {
                queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
                if (currentConversationId) {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/ai/conversations", currentConversationId],
                  });
                }
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (error) {
      console.error("Streaming error:", error);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setPendingToolCalls([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewConversation = () => {
    createConversationMutation.mutate(selectedAgent);
    if (isMobile) {
      setMobileTab("chat");
    }
  };

  const handleSelectConversation = (id: number) => {
    setCurrentConversationId(id);
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      setSelectedAgent(conv.agentRole);
    }
    if (isMobile) {
      setMobileTab("chat");
    }
  };

  const handleDeleteConversation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteConversationMutation.mutate(id);
  };

  const messages = currentConversation?.messages || [];

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] h-screen flex flex-col overflow-hidden">
        {isMobile ? (
          <div className="flex flex-col flex-1 overflow-hidden pb-24">
            <div className="px-4 pt-14 pb-2 border-b border-border bg-background/50 backdrop-blur-sm">
              <Tabs value={mobileTab} onValueChange={setMobileTab} className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="conversations" className="flex-1">History</TabsTrigger>
                  <TabsTrigger value="agents" className="flex-1">Agents</TabsTrigger>
                  <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
                  <TabsTrigger value="team" className="flex-1">Team</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 overflow-hidden">
              {mobileTab === "conversations" && (
                <div className="h-full flex flex-col">
                  <div className="p-4 border-b border-border">
                    <Button
                      onClick={handleNewConversation}
                      className="w-full"
                      disabled={createConversationMutation.isPending}
                    >
                      {createConversationMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      New Conversation
                    </Button>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1">
                      {conversationsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : conversations.length === 0 ? (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          No conversations yet
                        </div>
                      ) : (
                        conversations.map((conv) => (
                          <div
                            key={conv.id}
                            onClick={() => handleSelectConversation(conv.id)}
                            className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                              currentConversationId === conv.id
                                ? "bg-primary/10 text-primary"
                                : "hover-elevate"
                            }`}
                          >
                            <MessageSquare className="w-4 h-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{conv.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(conv.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={(e) => handleDeleteConversation(e, conv.id)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {mobileTab === "agents" && (
                <div className="h-full flex flex-col p-4">
                  <h2 className="text-lg font-semibold mb-4">Select AI Agent</h2>
                  <ScrollArea className="flex-1">
                    <div className="space-y-3 pb-4">
                      {agentsLoading ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm text-muted-foreground">Loading agents...</span>
                        </div>
                      ) : (
                        agents.map((agent) => {
                          const IconComponent = getAgentIcon(agent.icon);
                          const isSelected = selectedAgent === agent.role;
                          return (
                            <Card
                              key={agent.role}
                              onClick={() => {
                                setSelectedAgent(agent.role);
                                setMobileTab("chat");
                              }}
                              className={`cursor-pointer transition-all ${
                                isSelected ? "ring-2 ring-primary border-primary" : "hover-elevate"
                              }`}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-3 mb-2">
                                  <div className={`p-2 rounded-lg ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                                    <IconComponent className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <p className="font-semibold text-sm">{agent.name}</p>
                                    <Badge variant="outline" className="text-xs">{agent.displayName}</Badge>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground">{agent.description}</p>
                              </CardContent>
                            </Card>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {mobileTab === "chat" && (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const agent = agents.find(a => a.role === selectedAgent);
                        if (!agent) return null;
                        const Icon = getAgentIcon(agent.icon);
                        return (
                          <>
                            <Icon className="w-4 h-4 text-primary" />
                            <span className="text-sm font-medium">{agent.name}</span>
                          </>
                        );
                      })()}
                    </div>
                    {!currentConversationId && (
                      <Button size="sm" variant="outline" onClick={handleNewConversation} className="h-7 text-xs">
                        Start
                      </Button>
                    )}
                  </div>

                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {!currentConversationId ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                          <Bot className="w-12 h-12 text-muted-foreground/30 mb-4" />
                          <h3 className="text-lg font-medium mb-2">AI Command Center</h3>
                          <p className="text-muted-foreground text-sm px-4">
                            Start a conversation to interact with your AI agents.
                          </p>
                        </div>
                      ) : messagesLoading ? (
                        <div className="flex items-center justify-center py-20">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : messages.length === 0 && !streamingContent ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                          <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-4" />
                          <p className="text-muted-foreground text-sm">
                            Send a message to start the conversation
                          </p>
                        </div>
                      ) : (
                        <>
                          {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[90%] rounded-lg p-3 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                                {msg.toolCalls && msg.toolCalls.length > 0 && (
                                  <Accordion type="single" collapsible className="mt-2">
                                    <AccordionItem value="tools" className="border-t border-border/50">
                                      <AccordionTrigger className="py-1 text-[10px]">
                                        <span className="flex items-center gap-1">
                                          <Wrench className="w-2.5 h-2.5" />
                                          Tools used
                                        </span>
                                      </AccordionTrigger>
                                      <AccordionContent>
                                        <div className="space-y-1">
                                          {msg.toolCalls.map((tc, idx) => (
                                            <div key={idx} className="bg-muted/50 rounded p-1.5 text-[10px] font-mono">
                                              <div className="font-semibold text-primary">{tc.name}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </AccordionContent>
                                    </AccordionItem>
                                  </Accordion>
                                )}
                              </div>
                            </div>
                          ))}
                          {isStreaming && (
                            <div className="flex justify-start">
                              <div className="max-w-[90%] rounded-lg p-3 bg-card border text-sm">
                                {streamingContent || (
                                  <div className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span className="text-muted-foreground">Thinking...</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  <div className="p-3 border-t border-border bg-background/80 backdrop-blur-md">
                    <div className="flex flex-col gap-1 max-w-3xl mx-auto">
                      <div className="flex gap-2 items-end">
                        <Textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="Message..."
                          className="flex-1 min-h-[44px] max-h-32 resize-none text-base bg-muted/50 border-0 focus-visible:ring-1"
                          disabled={!currentConversationId || isStreaming}
                        />
                        <Button
                          onClick={sendMessage}
                          disabled={!input.trim() || !currentConversationId || isStreaming}
                          size="icon"
                          className="h-11 w-11 shrink-0 rounded-full shadow-lg active-elevate-2"
                        >
                          {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                      </div>
                      <span className="text-xs text-muted-foreground text-center" data-testid="text-cost-ai-chat">$0.02 per message</span>
                    </div>
                  </div>
                </div>
              )}

              {mobileTab === "team" && (
                <AITeamPanel />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-72 border-r border-border vibrancy-sidebar flex flex-col">
              <div className="p-4 border-b border-border space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={desktopView === "chat" ? "default" : "outline"}
                    onClick={() => setDesktopView("chat")}
                    className="flex-1"
                    data-testid="button-desktop-chat-view"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Chat
                  </Button>
                  <Button
                    variant={desktopView === "team" ? "default" : "outline"}
                    onClick={() => setDesktopView("team")}
                    className="flex-1"
                    data-testid="button-desktop-team-view"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Team
                  </Button>
                </div>
                {desktopView === "chat" && (
                  <Button
                    onClick={handleNewConversation}
                    className="w-full"
                    disabled={createConversationMutation.isPending}
                    data-testid="button-new-conversation"
                  >
                    {createConversationMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-2" />
                    )}
                    New Conversation
                  </Button>
                )}
              </div>

              {desktopView === "chat" ? (
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1" data-testid="list-conversations">
                    {conversationsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : conversations.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        No conversations yet
                      </div>
                    ) : (
                      conversations.map((conv) => (
                        <div
                          key={conv.id}
                          onClick={() => handleSelectConversation(conv.id)}
                          className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer group transition-colors ${
                            currentConversationId === conv.id
                              ? "bg-primary/10 text-primary"
                              : "hover-elevate"
                          }`}
                          data-testid={`conversation-item-${conv.id}`}
                        >
                          <MessageSquare className="w-4 h-4 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{conv.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(conv.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 shrink-0"
                            onClick={(e) => handleDeleteConversation(e, conv.id)}
                            data-testid={`button-delete-conversation-${conv.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                  <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h3 className="font-medium mb-2">AI Team Documentation</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    View detailed documentation for each AI agent on your team.
                  </p>
                </div>
              )}
            </div>

            {desktopView === "chat" ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-border glass-panel">
                  <h2 className="text-sm font-medium text-muted-foreground mb-3">Select Agent</h2>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                  {agentsLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading agents...</span>
                    </div>
                  ) : (
                    agents.map((agent) => {
                      const IconComponent = getAgentIcon(agent.icon);
                      const isSelected = selectedAgent === agent.role;
                      return (
                        <Card
                          key={agent.role}
                          onClick={() => setSelectedAgent(agent.role)}
                          className={`cursor-pointer shrink-0 w-48 transition-all ${
                            isSelected
                              ? "ring-2 ring-primary border-primary"
                              : "hover-elevate"
                          }`}
                          data-testid={`card-agent-${agent.role}`}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center gap-3 mb-2">
                              <div
                                className={`p-2 rounded-lg ${
                                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                                }`}
                              >
                                <IconComponent className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="font-semibold text-sm">{agent.name}</p>
                                <Badge variant="outline" className="text-xs">
                                  {agent.displayName}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {agent.description}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </div>

              <ScrollArea className="flex-1 p-4" data-testid="list-messages">
                <div className="max-w-3xl mx-auto space-y-4">
                  {!currentConversationId ? (
                    <div className="flex flex-col items-center justify-center h-96 text-center">
                      <Bot className="w-16 h-16 text-muted-foreground/30 mb-4" />
                      <h3 className="text-lg font-medium mb-2">AI Command Center</h3>
                      <p className="text-muted-foreground text-sm max-w-md">
                        Start a new conversation to interact with your AI agents. They can help
                        manage leads, properties, notes, and more.
                      </p>
                    </div>
                  ) : messagesLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 && !streamingContent ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center">
                      <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-4" />
                      <p className="text-muted-foreground text-sm">
                        Send a message to start the conversation
                      </p>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          data-testid={`message-${msg.id}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg p-4 ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "bg-card border"
                            }`}
                          >
                            <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <Accordion type="single" collapsible className="mt-3">
                                <AccordionItem value="tools" className="border-t border-border/50">
                                  <AccordionTrigger className="py-2 text-xs">
                                    <span className="flex items-center gap-2">
                                      <Wrench className="w-3 h-3" />
                                      {msg.toolCalls.length} tool
                                      {msg.toolCalls.length > 1 ? "s" : ""} used
                                    </span>
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <div className="space-y-2">
                                      {msg.toolCalls.map((tc, idx) => (
                                        <div
                                          key={idx}
                                          className="bg-muted/50 rounded p-2 text-xs font-mono"
                                        >
                                          <div className="font-semibold text-primary mb-1">
                                            {tc.name}
                                          </div>
                                          <pre className="overflow-x-auto text-muted-foreground">
                                            {JSON.stringify(tc.arguments, null, 2)}
                                          </pre>
                                          {tc.result && (
                                            <>
                                              <div className="font-semibold text-accent mt-2 mb-1">
                                                Result:
                                              </div>
                                              <pre className="overflow-x-auto text-muted-foreground">
                                                {JSON.stringify(tc.result, null, 2)}
                                              </pre>
                                            </>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                          </div>
                        </div>
                      ))}

                      {isStreaming && (
                        <div className="flex justify-start" data-testid="message-streaming">
                          <div className="max-w-[80%] rounded-lg p-4 bg-card border">
                            {pendingToolCalls.length > 0 && (
                              <div className="mb-3 space-y-2">
                                {pendingToolCalls.map((tc, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2"
                                  >
                                    <Wrench className="w-3 h-3" />
                                    <span>{tc.name}</span>
                                    {!tc.result ? (
                                      <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 ml-auto text-accent" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {streamingContent ? (
                              <p className="whitespace-pre-wrap text-sm">{streamingContent}</p>
                            ) : pendingToolCalls.length === 0 ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm text-muted-foreground">Thinking...</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-border glass-panel">
                <div className="max-w-3xl mx-auto flex flex-col gap-1">
                  <div className="flex gap-3">
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        currentConversationId
                          ? "Type your message..."
                          : "Start a new conversation first..."
                      }
                      className="flex-1 min-h-[48px] max-h-32 resize-none"
                      disabled={!currentConversationId || isStreaming}
                      data-testid="input-message"
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!input.trim() || !currentConversationId || isStreaming}
                      data-testid="button-send-message"
                    >
                      {isStreaming ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground text-center" data-testid="text-cost-ai-chat-desktop">$0.02 per message</span>
                </div>
              </div>
            </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <AITeamPanel />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
