import { useState, useRef, useEffect } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";

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
};

function getAgentIcon(iconName: string) {
  return agentIcons[iconName] || Bot;
}

export default function CommandCenterPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<string>("chat");
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
      <main className="flex-1 md:ml-[17rem] h-screen flex flex-col overflow-hidden pb-24 md:pb-0">
        {isMobile ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-4 pt-2 border-b border-border bg-background/50 backdrop-blur-sm">
              <Tabs value={mobileTab} onValueChange={setMobileTab} className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="conversations" className="flex-1">History</TabsTrigger>
                  <TabsTrigger value="agents" className="flex-1">Agents</TabsTrigger>
                  <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
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
                    <div className="flex gap-2 items-end max-w-3xl mx-auto">
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
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-72 border-r border-border vibrancy-sidebar flex flex-col">
              <div className="p-4 border-b border-border">
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
              </div>

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
            </div>

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
                <div className="max-w-3xl mx-auto flex gap-3">
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
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
