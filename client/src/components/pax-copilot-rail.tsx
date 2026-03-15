import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sparkles, Send, Loader2, X, ChevronRight,
  Users, MapPin, Building, Megaphone, LayoutDashboard,
  Zap, Bell, CheckCircle2, AlertCircle, RefreshCw,
  Paperclip, Clock, MessageSquare, BookOpen, FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { ToolCallStream, type ToolEvent, parseToolResultSummary } from "@/components/tool-call-stream";
import { PaxArtifact, type PaxArtifactData } from "@/components/pax-artifact";
import { PaxCommandPalette, PaxSlashPicker, type SlashCommand } from "@/components/pax-command-palette";
import { PaxEntityPicker, type MentionedEntity } from "@/components/pax-entity-picker";
import { PaxThinkingBlock } from "@/components/pax-thinking-block";
import { PaxKnowledgePanel } from "@/components/pax-knowledge-panel";
import { PaxProjectPanel } from "@/components/pax-project-panel";
import { PaxScheduleButton } from "@/components/pax-schedule-button";

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
  artifacts?: PaxArtifactData[];
  attachments?: { name: string }[];
  mentionChips?: { type: string; id: number; name: string }[];
  thinkingContent?: string;
  isThinking?: boolean;
}

// ─── Observation ─────────────────────────────────────────────────────────────

interface PaxObservation {
  id: number;
  type: string;
  severity: string;
  title: string;
  description: string;
  createdAt: string;
  acknowledged?: boolean;
}

// ─── Scheduled task result ───────────────────────────────────────────────────

interface PendingTaskResult {
  id: number;
  name: string;
  lastRunAt: string;
  lastRunConversationId: number | null;
}

// ─── File helpers ────────────────────────────────────────────────────────────

const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv", "text/plain", "application/json",
  "image/png", "image/jpeg", "image/webp",
];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function readAsDataURL(file: File): Promise<{ name: string; content: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, content: reader.result as string, size: file.size });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Recent conversation shape ───────────────────────────────────────────────

interface RecentConversation {
  id: number;
  title: string;
  updatedAt: string;
}

// ─── Slash command detection helpers ─────────────────────────────────────────

function detectSlashQuery(value: string): string | null {
  const match = value.match(/(^|\s)\/(\w*)$/);
  return match ? match[2] : null;
}

function detectAtQuery(value: string): string | null {
  const match = value.match(/@(\w+)$/);
  return match ? match[1] : null;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PaxCopilotRail() {
  const {
    isOpen, setOpen, toggle,
    pendingContext, clearPendingContext,
    activeConversationId, setActiveConversationId,
  } = usePaxRail();
  const [location] = useLocation();
  const pageMeta = useMemo(() => getPageMeta(location), [location]);
  const PageIcon = pageMeta.icon;

  // Chat state
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Running tool events indexed by message id
  const [activeToolEvents, setActiveToolEvents] = useState<Record<string, ToolEvent[]>>({});

  // Session restore state
  const [sessionRestored, setSessionRestored] = useState(false);
  const [restoredFromDate, setRestoredFromDate] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Conversation switcher
  const [showConvSwitcher, setShowConvSwitcher] = useState(false);

  // File attachments
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // @ mentions
  const [mentionedEntities, setMentionedEntities] = useState<MentionedEntity[]>([]);
  const [atQuery, setAtQuery] = useState<string | null>(null);

  // Slash commands
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Knowledge panel
  const [showKnowledge, setShowKnowledge] = useState(false);

  // Project panel
  const [showProjects, setShowProjects] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);

  // Scheduled task results banner
  const [pendingResults, setPendingResults] = useState<PendingTaskResult[]>([]);
  const [showResultsBanner, setShowResultsBanner] = useState(false);

  // Pax observations
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

  // Recent conversations (for switcher)
  const { data: recentConversations } = useQuery<RecentConversation[]>({
    queryKey: ["/api/ai/conversations"],
    queryFn: async () => {
      const r = await fetch("/api/ai/conversations", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isOpen,
    staleTime: 30_000,
  });

  const observations = observationsData ?? [];

  // ── Cmd+K to open command palette ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && isOpen) {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  // ── Session restore ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || sessionRestored || !activeConversationId || isLoadingHistory) return;
    setIsLoadingHistory(true);
    fetch(`/api/ai/conversations/${activeConversationId}/messages?limit=20`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.messages?.length) {
          setSessionRestored(true);
          return;
        }
        const restored: RailMessage[] = data.messages.map((m: any) => ({
          id: `db-${m.id}`,
          role: m.role as "user" | "assistant",
          content: m.content ?? "",
          isStreaming: false,
          thinkingContent: m.thinkingContent ?? undefined,
          toolEvents: Array.isArray(m.toolCalls)
            ? m.toolCalls.map((tc: any) => ({
                id: `tc-${tc.name}-${m.id}`,
                name: tc.name,
                args: typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments,
                status: "done" as const,
                resultSummary: parseToolResultSummary(tc.name, tc.result),
              }))
            : [],
        }));
        setMessages(restored);
        setRestoredFromDate(data.updatedAt ?? null);
        if (data.activeProjectId) setActiveProjectId(data.activeProjectId);
        setSessionRestored(true);
      })
      .catch(() => setSessionRestored(true))
      .finally(() => setIsLoadingHistory(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeConversationId, sessionRestored]);

  // ── Check pending task results when rail opens ───────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const since = localStorage.getItem("pax-last-seen") ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fetch(`/api/ai/scheduled-tasks/pending-results?since=${encodeURIComponent(since)}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((results: PendingTaskResult[]) => {
        if (results.length > 0) {
          setPendingResults(results);
          setShowResultsBanner(true);
        }
      })
      .catch(() => {});
    localStorage.setItem("pax-last-seen", new Date().toISOString());
  }, [isOpen]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  // Focus input when rail opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Consume pending entity context (gate behind history loading)
  useEffect(() => {
    if (!isOpen || !pendingContext || isLoadingHistory) return;
    const prompt = pendingContext.starterPrompt
      ?? `I'm looking at the ${pendingContext.entityType} "${pendingContext.entityName}" (#${pendingContext.entityId}). What should I know and what's the best next action?`;
    clearPendingContext();
    setTimeout(() => sendMessage(prompt), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingContext, isLoadingHistory]);

  // ── Input change handler ─────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);

    // Slash command detection
    const sq = detectSlashQuery(val);
    setSlashQuery(sq);
    if (sq !== null) setAtQuery(null);

    // @ mention detection
    if (sq === null) {
      const aq = detectAtQuery(val);
      setAtQuery(aq);
    } else {
      setAtQuery(null);
    }
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    // Replace the slash + typed prefix with the command name, then send
    const newVal = inputValue.replace(/(^|\s)\/\w*$/, (m, prefix) => prefix + cmd.name);
    setInputValue(newVal);
    setSlashQuery(null);
    // Auto-send
    setTimeout(() => sendMessage(cmd.prompt), 50);
  };

  const handleEntitySelect = (entity: MentionedEntity) => {
    // Remove @query from input, add entity to chips
    const newVal = inputValue.replace(/@\w*$/, "");
    setInputValue(newVal);
    setAtQuery(null);
    if (!mentionedEntities.find((e) => e.type === entity.type && e.id === entity.id)) {
      setMentionedEntities((prev) => [...prev, entity]);
    }
    inputRef.current?.focus();
  };

  // ── Create conversation ──────────────────────────────────────────────────
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

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    // Read attached files
    let filePayload: { name: string; content: string; size: number }[] = [];
    if (attachedFiles.length > 0) {
      try {
        filePayload = await Promise.all(attachedFiles.map(readAsDataURL));
      } catch {}
      setAttachedFiles([]);
    }

    const currentEntities = [...mentionedEntities];
    setMentionedEntities([]);

    const userMsg: RailMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text.trim(),
      attachments: filePayload.length > 0 ? filePayload.map((f) => ({ name: f.name })) : undefined,
      mentionChips: currentEntities.length > 0 ? currentEntities.map((e) => ({ type: e.type, id: e.id, name: e.name })) : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setSlashQuery(null);
    setAtQuery(null);

    let activeConvId = activeConversationId;
    if (!activeConvId) {
      activeConvId = await createConversation();
      if (activeConvId) setActiveConversationId(activeConvId);
    }

    const asstId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, { id: asstId, role: "assistant", content: "", isStreaming: true }]);
    setActiveToolEvents((prev) => ({ ...prev, [asstId]: [] }));
    setIsStreaming(true);

    try {
      abortRef.current = new AbortController();
      const body: Record<string, any> = {
        message: userMsg.content,
        conversationId: activeConvId,
        agentRole: "executive",
        context: { page: pageMeta.label },
      };
      if (filePayload.length > 0) body.files = filePayload;
      if (currentEntities.length > 0) body.mentionedEntities = currentEntities;
      if (activeProjectId) body.activeProjectId = activeProjectId;

      const res = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
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
      const pendingToolIds: Record<string, string> = {};

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, { stream: true }).split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "thinking_start") {
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, thinkingContent: "", isThinking: true } : m
                ));
              } else if (data.type === "thinking") {
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, thinkingContent: (m.thinkingContent ?? "") + (data.content ?? "") } : m
                ));
              } else if (data.type === "thinking_done") {
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, isThinking: false } : m
                ));
              } else if (data.type === "content" && data.content) {
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
                  let diffBefore: Record<string, any> | undefined;
                  let diffAfter: Record<string, any> | undefined;
                  try {
                    const parsed = typeof data.toolCall.result === "string"
                      ? JSON.parse(data.toolCall.result)
                      : data.toolCall.result;
                    if (parsed?.data?.before) diffBefore = parsed.data.before;
                    if (parsed?.data?.after) diffAfter = parsed.data.after;
                  } catch {}
                  setActiveToolEvents((prev) => ({
                    ...prev,
                    [asstId]: (prev[asstId] ?? []).map((e) =>
                      e.id === evtId
                        ? { ...e, status: "done" as const, resultSummary: summary, diffBefore, diffAfter }
                        : e
                    ),
                  }));
                  delete pendingToolIds[toolName];
                }
              } else if (data.type === "artifact") {
                const newArtifact: PaxArtifactData = {
                  artifactType: data.artifactType,
                  title: data.title,
                  data: data.data,
                };
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId
                    ? { ...m, artifacts: [...(m.artifacts ?? []), newArtifact] }
                    : m
                ));
              } else if (data.type === "done") {
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? { ...m, isStreaming: false } : m
                ));
                queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, activeConversationId, createConversation, pageMeta.label, attachedFiles, mentionedEntities, activeProjectId]);

  const handleSubmit = () => { if (inputValue.trim()) sendMessage(inputValue); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Don't send if slash picker or entity picker is open
      if (slashQuery !== null || atQuery !== null) return;
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setActiveToolEvents({});
    setActiveConversationId(null);
    setIsStreaming(false);
    setSessionRestored(false);
    setRestoredFromDate(null);
    setShowConvSwitcher(false);
    setMentionedEntities([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const switchConversation = (convId: number) => {
    if (convId === activeConversationId) {
      setShowConvSwitcher(false);
      return;
    }
    abortRef.current?.abort();
    setMessages([]);
    setActiveToolEvents({});
    setIsStreaming(false);
    setSessionRestored(false);
    setRestoredFromDate(null);
    setShowConvSwitcher(false);
    setActiveConversationId(convId);
    setActiveProjectId(null);
  };

  const removeArtifact = (msgId: string, artifactIdx: number) => {
    setMessages((prev) => prev.map((m) =>
      m.id === msgId
        ? { ...m, artifacts: m.artifacts?.filter((_, i) => i !== artifactIdx) }
        : m
    ));
  };

  const handleSetProject = (projectId: number | null) => {
    setActiveProjectId(projectId);
    // Persist to conversation if we have one
    if (activeConversationId) {
      fetch(`/api/ai/conversations/${activeConversationId}/project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId }),
      }).catch(() => {});
    }
  };

  // File drag handlers
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files)
      .filter((f) => ACCEPTED_MIME.includes(f.type) && f.size <= MAX_FILE_BYTES)
      .slice(0, MAX_FILES - attachedFiles.length);
    setAttachedFiles((prev) => [...prev, ...dropped].slice(0, MAX_FILES));
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className={cn(
          "fixed right-0 top-0 h-screen z-40 flex flex-col",
          "border-l bg-background/95 backdrop-blur-sm",
          "transition-[width] duration-200 ease-in-out",
          isOpen ? "w-[360px] shadow-2xl" : "w-12"
        )}
        onDragOver={isOpen ? handleDragOver : undefined}
        onDragLeave={isOpen ? handleDragLeave : undefined}
        onDrop={isOpen ? handleDrop : undefined}
      >
        {/* Drag-over overlay */}
        {isOpen && isDragOver && (
          <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-primary border-dashed rounded flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Paperclip className="w-8 h-8 text-primary" />
            <p className="text-sm font-medium text-primary">Drop files here</p>
            <p className="text-xs text-muted-foreground">PDF, DOCX, CSV, images · max 10 MB · up to 3 files</p>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.docx,.csv,.txt,.json,.png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
              .filter((f) => f.size <= MAX_FILE_BYTES)
              .slice(0, MAX_FILES - attachedFiles.length);
            setAttachedFiles((prev) => [...prev, ...files].slice(0, MAX_FILES));
            e.target.value = "";
          }}
        />

        {/* ── Collapsed strip ─────────────────────────────────── */}
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

        {/* ── Expanded panel ──────────────────────────────────── */}
        {isOpen && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0 relative">
              <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Pax</span>
                  {isStreaming && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                  {activeProjectId && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                      <FolderOpen className="w-2.5 h-2.5 mr-0.5" />
                      Project
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <PageIcon className="w-3 h-3" />
                  <span>{pageMeta.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Knowledge base button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowKnowledge(true)}>
                      <BookOpen className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Knowledge Base</TooltipContent>
                </Tooltip>
                {/* Projects button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", activeProjectId && "text-primary")}
                      onClick={() => setShowProjects(true)}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Projects</TooltipContent>
                </Tooltip>
                {/* Conversation switcher toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setShowConvSwitcher((v) => !v)}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Switch conversation</TooltipContent>
                </Tooltip>
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

              {/* Conversation switcher dropdown */}
              {showConvSwitcher && (
                <div className="absolute top-full right-0 left-0 z-50 bg-background border border-border rounded-b-lg shadow-lg">
                  <div className="px-3 py-2 border-b">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Recent conversations</p>
                  </div>
                  {(recentConversations ?? []).slice(0, 5).length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-2">No conversations yet</p>
                  ) : (
                    (recentConversations ?? []).slice(0, 5).map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => switchConversation(conv.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-start gap-2",
                          conv.id === activeConversationId && "bg-primary/5"
                        )}
                      >
                        <MessageSquare className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium text-foreground">{conv.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(conv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        </div>
                        {conv.id === activeConversationId && (
                          <span className="text-[9px] text-primary font-medium flex-shrink-0">Active</span>
                        )}
                      </button>
                    ))
                  )}
                  <div className="px-3 py-2 border-t">
                    <button
                      onClick={handleNewChat}
                      className="text-[11px] text-primary hover:underline"
                    >
                      + New conversation
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scheduled task results banner */}
            {showResultsBanner && pendingResults.length > 0 && (
              <div className="flex-shrink-0 px-3 py-2 flex items-center gap-2 bg-primary/5 border-b">
                <Clock className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <p className="text-[11px] text-foreground flex-1 min-w-0">
                  Pax ran <span className="font-semibold">{pendingResults.length} task{pendingResults.length > 1 ? "s" : ""}</span> while you were away.
                  {pendingResults[0].lastRunConversationId && (
                    <button
                      className="text-primary hover:underline ml-1"
                      onClick={() => {
                        if (pendingResults[0].lastRunConversationId) {
                          switchConversation(pendingResults[0].lastRunConversationId);
                        }
                        setShowResultsBanner(false);
                      }}
                    >
                      View results
                    </button>
                  )}
                </p>
                <button onClick={() => setShowResultsBanner(false)}>
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            )}

            {/* Initiative Feed */}
            {observations.length > 0 && messages.length === 0 && !isLoadingHistory && (
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

            {/* Quick Actions (show when no messages and not loading) */}
            {messages.length === 0 && !isLoadingHistory && (
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
                <p className="text-[10px] text-muted-foreground/50 mt-2">
                  Tip: Type <span className="font-mono">/</span> for commands · <span className="font-mono">@</span> to mention an entity · <kbd className="text-[9px] bg-muted px-1 rounded">⌘K</kbd> for palette
                </p>
              </div>
            )}

            {/* Resumed session banner */}
            {restoredFromDate && messages.length > 0 && !isLoadingHistory && (
              <div className="flex-shrink-0 px-3 py-1.5 flex items-center gap-1.5 bg-muted/30 border-b">
                <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-[11px] text-muted-foreground">
                  Resumed from {new Date(restoredFromDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <button
                  className="text-[11px] text-primary hover:underline ml-auto flex-shrink-0"
                  onClick={handleNewChat}
                >
                  Start fresh
                </button>
              </div>
            )}

            {/* Chat messages */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-3 py-3 space-y-3">
                {/* Loading skeleton */}
                {isLoadingHistory && (
                  <div className="space-y-3">
                    <div className="flex justify-end"><Skeleton className="h-8 w-48 rounded-xl" /></div>
                    <div className="space-y-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
                    <div className="flex justify-end"><Skeleton className="h-8 w-36 rounded-xl" /></div>
                    <div className="space-y-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
                  </div>
                )}

                {!isLoadingHistory && messages.length === 0 && observations.length === 0 && (
                  <div className="text-center py-8">
                    <Sparkles className="w-8 h-8 text-primary/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      Pax is your AI co-pilot. Ask anything about your business or use the quick actions above.
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">⌘J to toggle · Enter to send</p>
                  </div>
                )}

                {!isLoadingHistory && messages.map((msg) => {
                  const toolEvts = activeToolEvents[msg.id] ?? msg.toolEvents ?? [];
                  return (
                    <div key={msg.id} className={cn("space-y-1", msg.role === "user" ? "flex flex-col items-end" : "")}>
                      {msg.role === "user" ? (
                        <div className="space-y-1 flex flex-col items-end">
                          <div className="max-w-[85%] bg-primary text-primary-foreground rounded-xl rounded-tr-sm px-3 py-2 text-sm">
                            {msg.content}
                          </div>
                          {/* Entity mention chips */}
                          {msg.mentionChips && msg.mentionChips.length > 0 && (
                            <div className="flex flex-wrap gap-1 justify-end">
                              {msg.mentionChips.map((e) => (
                                <div
                                  key={`${e.type}-${e.id}`}
                                  className="inline-flex items-center gap-1 text-[10px] bg-primary/20 text-primary rounded px-1.5 py-0.5"
                                >
                                  @{e.name}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* File attachment chips */}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1 justify-end">
                              {msg.attachments.map((a) => (
                                <div
                                  key={a.name}
                                  className="inline-flex items-center gap-1 text-[10px] bg-primary/20 text-primary rounded px-1.5 py-0.5"
                                >
                                  <Paperclip className="w-2.5 h-2.5" />
                                  {a.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {/* Thinking block */}
                          {msg.thinkingContent !== undefined && (
                            <PaxThinkingBlock content={msg.thinkingContent} isStreaming={msg.isThinking} />
                          )}
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
                              {msg.isStreaming && !msg.content && toolEvts.length === 0 && !msg.isThinking && (
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
                          {/* Artifact renders */}
                          {(msg.artifacts ?? []).map((art, i) => (
                            <PaxArtifact
                              key={i}
                              artifactType={art.artifactType}
                              title={art.title}
                              data={art.data}
                              onDismiss={() => removeArtifact(msg.id, i)}
                            />
                          ))}
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
              {/* Entity mention chips */}
              {mentionedEntities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {mentionedEntities.map((e) => (
                    <div
                      key={`${e.type}-${e.id}`}
                      className="flex items-center gap-1 text-[11px] bg-primary/10 text-primary rounded px-2 py-0.5 border border-primary/20"
                    >
                      @{e.name}
                      <button
                        onClick={() => setMentionedEntities((prev) => prev.filter((x) => !(x.type === e.type && x.id === e.id)))}
                        className="hover:text-foreground"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Attached file chips */}
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {attachedFiles.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1 text-[11px] bg-muted rounded px-2 py-0.5 border"
                    >
                      <Paperclip className="w-3 h-3 text-muted-foreground" />
                      <span className="truncate max-w-[100px]">{f.name}</span>
                      <button
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Textarea with pickers positioned above */}
              <div className="relative flex gap-1.5 items-end">
                <div className="relative flex-1">
                  {/* Slash picker */}
                  {slashQuery !== null && (
                    <PaxSlashPicker
                      query={slashQuery}
                      onSelect={handleSlashSelect}
                      onClose={() => setSlashQuery(null)}
                    />
                  )}
                  {/* Entity picker */}
                  {atQuery !== null && atQuery.length >= 1 && (
                    <PaxEntityPicker
                      query={atQuery}
                      onSelect={handleEntitySelect}
                      onClose={() => setAtQuery(null)}
                    />
                  )}
                  <Textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Pax anything… / for commands · @ to mention"
                    className="resize-none text-sm min-h-[60px] max-h-[120px]"
                    disabled={isStreaming}
                    rows={2}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  {/* Schedule button */}
                  <PaxScheduleButton currentPrompt={inputValue} disabled={isStreaming} />
                  {/* Paperclip attach button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || attachedFiles.length >= MAX_FILES}
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Attach file (PDF, CSV, image…)</TooltipContent>
                  </Tooltip>
                  {isStreaming ? (
                    <Button size="icon" variant="destructive" className="h-8 w-8 flex-shrink-0" onClick={handleStop}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={handleSubmit}
                      disabled={!inputValue.trim() && attachedFiles.length === 0}
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

      {/* Command Palette (Cmd+K) */}
      <PaxCommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onSelect={(cmd) => {
          setInputValue(cmd.name);
          setShowCommandPalette(false);
          setTimeout(() => sendMessage(cmd.prompt), 50);
        }}
      />

      {/* Knowledge Panel (Sheet) */}
      <PaxKnowledgePanel open={showKnowledge} onClose={() => setShowKnowledge(false)} />

      {/* Project Panel (Sheet) */}
      <PaxProjectPanel
        open={showProjects}
        onClose={() => setShowProjects(false)}
        activeProjectId={activeProjectId}
        onSelectProject={handleSetProject}
      />
    </>
  );
}
