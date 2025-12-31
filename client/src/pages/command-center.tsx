import { useState, useRef, useEffect } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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
  };

  const handleSelectConversation = (id: number) => {
    setCurrentConversationId(id);
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      setSelectedAgent(conv.agentRole);
    }
  };

  const handleDeleteConversation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteConversationMutation.mutate(id);
  };

  const messages = currentConversation?.messages || [];

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 md:ml-64 h-screen flex flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          {/* Conversation Sidebar */}
          <div className="w-72 border-r bg-background flex flex-col">
            <div className="p-4 border-b">
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

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Agent Selection */}
            <div className="p-4 border-b bg-background">
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

            {/* Messages */}
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
                                            <div className="font-semibold text-emerald-600 dark:text-emerald-400 mt-2 mb-1">
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

                    {/* Streaming response */}
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
                                    <ChevronRight className="w-3 h-3 ml-auto text-emerald-500" />
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

            {/* Input Area */}
            <div className="p-4 border-t bg-background">
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
      </main>
    </div>
  );
}
