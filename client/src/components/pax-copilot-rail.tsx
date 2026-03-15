import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sparkles, Send, Loader2, X, ChevronRight, ChevronLeft,
  Users, MapPin, Building, Megaphone, LayoutDashboard,
  Zap, Bell, CheckCircle2, AlertCircle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { ToolCallStream, type ToolEvent, parseToolResultSummary } from "@/components/tool-call-stream";

// ─── Page context awareness ─────────────────────────────────────────────────

interface PageMeta {
  label: string;
  icon: typeof LayoutDashboard;
  quickActions: { label: string; prompt: string }[];
}

const PAGE_META: Record<string, PageMeta> = {
  "/today":      { label: "Today", icon: LayoutDashboard, quickActions: [
    { label: "Daily briefing", prompt: "Give me a quick briefing on my day — hot leads, deals needing attention, and upcoming tasks." },
    { label: "What needs attention?", prompt: "What are the top 3 things that need my attention right now?" },
  ]},
  "/leads":      { label: "Leads", icon: Users, quickActions: [
    { label: "Find stale leads", prompt: "Which leads haven't been contacted in 14+ days? Give me a list and suggest a follow-up action for each." },
    { label: "Score my pipeline", prompt: "Look at my current leads and tell me which ones have the highest potential based on their signals." },
    { label: "Draft follow-up campaign", prompt: "Draft a short follow-up email sequence for leads that haven't responded to my initial outreach." },
  ]},
  "/properties": { label: "Properties", icon: MapPin, quickActions: [
    { label: "Analyze portfolio", prompt: "Give me a quick summary of my property portfolio — values, statuses, and any properties I should prioritize." },
    { label: "Comp check", prompt: "Are there any properties in my portfolio where the market value looks significantly off? Flag them." },
  ]},
  "/deals":      { label: "Pipeline", icon: Building, quickActions: [
    { label: "Pipeline velocity", prompt: "How is my deal pipeline moving? Are there any deals stuck at the same stage too long?" },
    { label: "Next best action", prompt: "For each active deal, what is the single most important next action I should take?" },
  ]},
  "/campaigns":  { label: "Campaigns", icon: Megaphone, quickActions: [
    { label: "Performance summary", prompt: "How are my active campaigns performing? Which ones should I optimize or pause?" },
    { label: "Suggest A/B test", prompt: "Suggest an A/B test for my best-performing campaign to improve response rates." },
  ]},
  "/finance":    { label: "Finance", icon: Zap, quickActions: [
    { label: "Cash flow snapshot", prompt: "Give me a quick cash flow snapshot — incoming payments, late notes, and next 30-day outlook." },
    { label: "Flag late payments", prompt: "Which notes have late or missed payments? What should I do about each one?" },
  ]},
  "/pipeline":   { label: "Pipeline", icon: Building, quickActions: [
    { label: "Deal analysis", prompt: "Analyze my current deal pipeline and suggest which deals to prioritize this week." },
    { label: "Draft offer", prompt: "Help me draft a competitive offer for the deal I'm working on." },
  ]},
};

function getPageMeta(path: string): PageMeta {
  const exact = PAGE_META[path];
  if (exact) return exact;
  const prefix = Object.keys(PAGE_META).find((k) => path.startsWith(k) && k !== "/");
  if (prefix) return PAGE_META[prefix];
  return { label: "AcreOS", icon: Sparkles, quickActions: [
    { label: "What can you do?", prompt: "What can you help me with in AcreOS?" },
    { label: "Quick briefing", prompt: "Give me a quick briefing on the state of my business." },
  ]};
}

// ─── Message types ──────────────────────────────────────────────────────────

interface RailMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  isStreaming?: boolean;
  toolEvents?: ToolEvent[];
}

// ─── Observation (Pax initiative feed) ───────────────────────────────────

interface PaxObservation {
  id: number;
  type: string;
  severity: string;
  title: string;
  description: string;
  createdAt: string;
  acknowledged?: boolean;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function PaxCopilotRail() {
  const { isOpen, setOpen, toggle, pendingContext, clearPendingContext } = usePaxRail();
  const [location] = useLocation();
  const pageMeta = useMemo(() => getPageMeta(location), [location]);
  const PageIcon = pageMeta.icon;

  // Chat state
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Running tool events indexed by message id
  const [activeToolEvents, setActiveToolEvents] = useState<Record<string, ToolEvent[]>>({});

  // Pax observations (initiative feed)
  const { data: observationsData, refetch: refetchObs } = useQuery<PaxObservation[]>({
    queryKey: ["/api/pax/observations", { unread: true }],
    queryFn: async () => {
      const res = await fetch("/api/pax/observations?unread=true&limit=5", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/pax/observations/${id}/acknowledge`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => refetchObs(),
  });

  const observations = observationsData ?? [];

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  // Focus input when rail opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Consume pending entity context
  useEffect(() => {
    if (!isOpen || !pendingContext) return;
    const prompt = pendingContext.starterPrompt
      ?? `I'm looking at the ${pendingContext.entityType} "${pendingContext.entityName}" (#${pendingContext.entityId}). What should I know and what's the best next action?`;
    clearPendingContext();
    // Small delay so the rail has rendered
    setTimeout(() => sendMessage(prompt), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingContext]);

  // ── Create conversation ─────────────────────────────────────────────────
  const createConversation = useCallback(async (): Promise<number | null> => {
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentRole: "executive" }),
      });
      if (res.ok) return (await res.json()).id;
    } catch {}
    return null;
  }, []);

  // ── Send message ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: RailMessage = { id: `u-${Date.now()}`, role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");

    let activeConvId = conversationId;
    if (!activeConvId) {
      activeConvId = await createConversation();
      if (activeConvId) setConversationId(activeConvId);
    }

    const asstId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, { id: asstId, role: "assistant", content: "", isStreaming: true }]);
    setActiveToolEvents((prev) => ({ ...prev, [asstId]: [] }));
    setIsStreaming(true);

    try {
      abortRef.current = new AbortController();
      const res = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMsg.content,
          conversationId: activeConvId,
          agentRole: "executive",
          context: { page: pageMeta.label },
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = res.status === 429 ? "Rate limit reached. Please try again shortly."
          : res.status === 402 ? "Insufficient credits."
          : "Something went wrong. Please try again.";
        setMessages((prev) => prev.map((m) =>
          m.id === asstId ? { ...m, role: "error" as const, content: err, isStreaming: false } : m
        ));
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      // Track in-progress tool event IDs
      const pendingToolIds: Record<string, string> = {}; // toolName→eventId

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, { stream: true }).split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "content" && data.content) {
                accumulated += data.content;
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, content: accumulated } : m
                ));
              } else if (data.type === "tool_start" && data.toolCall) {
                const toolName = data.toolCall.name as string;
                const evtId = `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                let args: Record<string, any> | undefined;
                try { args = JSON.parse(data.toolCall.arguments ?? "{}"); } catch {}
                pendingToolIds[toolName] = evtId;
                const newEvt: ToolEvent = { id: evtId, name: toolName, args, status: "running" };
                setActiveToolEvents((prev) => ({
                  ...prev,
                  [asstId]: [...(prev[asstId] ?? []), newEvt],
                }));
              } else if (data.type === "tool_result" && data.toolCall) {
                const toolName = data.toolCall.name as string;
                const evtId = pendingToolIds[toolName];
                if (evtId) {
                  const summary = parseToolResultSummary(toolName, data.toolCall.result);
                  setActiveToolEvents((prev) => ({
                    ...prev,
                    [asstId]: (prev[asstId] ?? []).map((e) =>
                      e.id === evtId ? { ...e, status: "done" as const, resultSummary: summary } : e
                    ),
                  }));
                  delete pendingToolIds[toolName];
                }
              } else if (data.type === "done") {
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, isStreaming: false } : m
                ));
              } else if (data.type === "error") {
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, role: "error" as const, content: data.error ?? "An error occurred", isStreaming: false } : m
                ));
              }
            } catch {}
          }
        }
      }

      if (!accumulated) {
        setMessages((prev) => prev.map((m) =>
          m.id === asstId ? { ...m, content: "How can I help?", isStreaming: false } : m
        ));
      } else {
        setMessages((prev) => prev.map((m) =>
          m.id === asstId ? { ...m, isStreaming: false } : m
        ));
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setMessages((prev) => prev.map((m) =>
          m.id === asstId ? { ...m, role: "error" as const, content: "Connection failed. Please try again.", isStreaming: false } : m
        ));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming, conversationId, createConversation, pageMeta.label]);

  const handleSubmit = () => { if (inputValue.trim()) sendMessage(inputValue); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setActiveToolEvents({});
    setConversationId(null);
    setIsStreaming(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "fixed right-0 top-0 h-screen z-40 flex flex-col",
        "border-l bg-background/95 backdrop-blur-sm",
        "transition-[width] duration-200 ease-in-out",
        isOpen ? "w-[360px] shadow-2xl" : "w-12"
      )}
    >
      {/* ── Collapsed strip ─────────────────────────────────────── */}
      {!isOpen && (
        <div className="flex flex-col items-center gap-3 pt-4 pb-4 h-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-primary/10 transition-colors relative"
                data-testid="pax-rail-expand"
              >
                <Sparkles className="w-4 h-4 text-primary" />
                {observations.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Open Pax Co-Pilot (⌘J)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mt-auto mb-4 text-xs text-muted-foreground [writing-mode:vertical-rl] [text-orientation:mixed] rotate-180 select-none opacity-40">
                Pax
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">Pax Co-Pilot</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* ── Expanded panel ──────────────────────────────────────── */}
      {isOpen && (
        <>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">Pax</span>
                {isStreaming && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <PageIcon className="w-3 h-3" />
                <span>{pageMeta.label}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New chat</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse (⌘J)</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Initiative Feed */}
          {observations.length > 0 && messages.length === 0 && (
            <div className="flex-shrink-0 border-b px-3 py-2 space-y-1.5 max-h-[180px] overflow-y-auto">
              <div className="flex items-center gap-1.5 mb-1">
                <Bell className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Pax noticed</span>
              </div>
              {observations.slice(0, 4).map((obs) => (
                <div key={obs.id} className="rounded-md border bg-muted/30 p-2 text-xs group">
                  <div className="flex items-start gap-1.5">
                    {obs.severity === "high"
                      ? <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                      : <CheckCircle2 className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground leading-tight">{obs.title}</p>
                      <p className="text-muted-foreground leading-tight mt-0.5 line-clamp-2">{obs.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <button
                      className="text-primary hover:underline text-[10px]"
                      onClick={() => sendMessage(`Tell me more about this: "${obs.title}" — ${obs.description}`)}
                    >
                      Handle it →
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground text-[10px] ml-auto"
                      onClick={() => dismissMutation.mutate(obs.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Actions (show when no messages) */}
          {messages.length === 0 && (
            <div className="flex-shrink-0 px-3 py-2 border-b">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Quick actions</p>
              <div className="flex flex-col gap-1">
                {pageMeta.quickActions.map((qa) => (
                  <button
                    key={qa.label}
                    onClick={() => sendMessage(qa.prompt)}
                    className="text-left text-xs px-2.5 py-1.5 rounded-md border border-border/60 hover:bg-muted/50 hover:border-primary/30 transition-colors text-foreground"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-3 py-3 space-y-3">
              {messages.length === 0 && observations.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="w-8 h-8 text-primary/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Pax is your AI co-pilot. Ask anything about your business or use the quick actions above.
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-2">⌘J to toggle · Enter to send</p>
                </div>
              )}

              {messages.map((msg) => {
                const toolEvts = activeToolEvents[msg.id] ?? [];
                return (
                  <div key={msg.id} className={cn("space-y-1", msg.role === "user" ? "flex justify-end" : "")}>
                    {msg.role === "user" ? (
                      <div className="max-w-[85%] bg-primary text-primary-foreground rounded-xl rounded-tr-sm px-3 py-2 text-sm">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {/* Tool call stream */}
                        {toolEvts.length > 0 && (
                          <ToolCallStream events={toolEvts} />
                        )}
                        {/* Text response */}
                        {(msg.content || msg.isStreaming) && (
                          <div
                            className={cn(
                              "text-sm leading-relaxed text-foreground",
                              msg.role === "error" && "text-destructive"
                            )}
                          >
                            {msg.content}
                            {msg.isStreaming && !msg.content && toolEvts.length === 0 && (
                              <span className="inline-flex gap-0.5 ml-1">
                                <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                                <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                                <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                              </span>
                            )}
                            {msg.isStreaming && msg.content && (
                              <span className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 animate-pulse align-text-bottom" />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className="flex-shrink-0 border-t p-2.5 space-y-1.5">
            <div className="flex gap-1.5 items-end">
              <Textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Pax anything…"
                className="resize-none text-sm min-h-[60px] max-h-[120px]"
                disabled={isStreaming}
                rows={2}
              />
              <div className="flex flex-col gap-1">
                {isStreaming ? (
                  <Button size="icon" variant="destructive" className="h-8 w-8 flex-shrink-0" onClick={handleStop}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={handleSubmit}
                    disabled={!inputValue.trim()}
                    data-testid="pax-rail-send"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/50 text-center">
              Pax can take real actions · Always review before sharing sensitive info
            </p>
          </div>
        </>
      )}
    </div>
  );
}
