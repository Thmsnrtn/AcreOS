import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Send, Loader2, X, ChevronRight,
  Users, MapPin, Building, Megaphone, LayoutDashboard,
  Zap, Bell, CheckCircle2, AlertCircle, RefreshCw,
  Paperclip, Clock, MessageSquare, BookOpen, FolderOpen, Plug,
  ThumbsUp, ThumbsDown, Download, ChevronDown,
  Mic, MicOff, BrainCircuit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrandName } from "@/hooks/use-white-label";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { ToolCallStream, type ToolEvent, parseToolResultSummary } from "@/components/tool-call-stream";
import { PaxArtifact, type PaxArtifactData } from "@/components/pax-artifact";
import { PaxCommandPalette, PaxSlashPicker, type SlashCommand } from "@/components/pax-command-palette";
import { PaxEntityPicker, type MentionedEntity } from "@/components/pax-entity-picker";
import { PaxThinkingBlock } from "@/components/pax-thinking-block";
import { PaxWhyExplainer } from "@/components/pax-why-explainer";
import { Input } from "@/components/ui/input";
import { PaxKnowledgePanel } from "@/components/pax-knowledge-panel";
import { PaxProjectPanel } from "@/components/pax-project-panel";
import { PaxScheduleButton } from "@/components/pax-schedule-button";
import { PaxConnectorPanel } from "@/components/pax-connector-panel";
import { PaxMemoryPanel } from "@/components/pax-memory-panel";
import { ReadAloudButton } from "@/components/ReadAloudButton";
import { useReadAloud } from "@/hooks/useReadAloud";
import { useReadAloudPrefs } from "@/hooks/useReadAloud.prefs";

// ─── Lightweight markdown renderer ──────────────────────────────────────────
function PaxMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  const inlineFormat = (text: string): React.ReactNode => {
    // Handle inline code, bold, italic with simple regex splits
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("`") && part.endsWith("`")) return <code key={idx} className="bg-muted px-1 py-0.5 rounded text-caption font-mono">{part.slice(1, -1)}</code>;
      if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) return <strong key={idx}>{part.slice(2, -2)}</strong>;
      if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={idx}>{part.slice(1, -1)}</em>;
      return part;
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-muted rounded-md p-2.5 my-1.5 overflow-x-auto text-[11px] font-mono leading-relaxed">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/); if (h3) { elements.push(<h3 key={i} className="font-semibold text-sm mt-2 mb-0.5">{inlineFormat(h3[1])}</h3>); i++; continue; }
    const h2 = line.match(/^## (.+)/);  if (h2) { elements.push(<h2 key={i} className="font-semibold text-sm mt-2 mb-0.5">{inlineFormat(h2[1])}</h2>); i++; continue; }
    const h1 = line.match(/^# (.+)/);   if (h1) { elements.push(<h1 key={i} className="font-semibold text-sm mt-2 mb-0.5">{inlineFormat(h1[1])}</h1>); i++; continue; }

    // Unordered list
    if (line.match(/^[-*+] /)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*+] /)) {
        listItems.push(lines[i].replace(/^[-*+] /, ""));
        i++;
      }
      elements.push(<ul key={i} className="list-disc list-inside space-y-0.5 my-1 pl-1">{listItems.map((item, j) => <li key={j} className="text-sm">{inlineFormat(item)}</li>)}</ul>);
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\. /)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        listItems.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(<ol key={i} className="list-decimal list-inside space-y-0.5 my-1 pl-1">{listItems.map((item, j) => <li key={j} className="text-sm">{inlineFormat(item)}</li>)}</ol>);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) { elements.push(<hr key={i} className="border-border my-2" />); i++; continue; }

    // Blank line → spacing
    if (line.trim() === "") { elements.push(<div key={i} className="h-1.5" />); i++; continue; }

    // Normal paragraph
    elements.push(<p key={i} className="text-sm leading-relaxed">{inlineFormat(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

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

function getPageMeta(path: string, brandName: string = "AcreOS"): PageMeta {
  const exact = PAGE_META[path];
  if (exact) return exact;
  const prefix = Object.keys(PAGE_META).find((k) => path.startsWith(k) && k !== "/");
  if (prefix) return PAGE_META[prefix];
  return { label: brandName, icon: Sparkles, quickActions: [
    { label: "What can you do?", prompt: `What can you help me with in ${brandName}?` },
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
  /**
   * Tier 1A approval kernel: an approval-required tool call frozen
   * server-side as a pending_actions row. Approve/Reject hit
   * /api/pax/pending-actions/:id/{approve,reject} — the ONLY path from a
   * frozen row to execution. status tracks the local card lifecycle.
   */
  pendingAction?: {
    pendingActionId: number;
    toolName: string;
    args: any;
    status: "pending" | "deciding" | "executed" | "rejected" | "failed";
    resultNote?: string;
  };
  /** Set when the server's hallucination guard replaced the streamed text with a corrected version. */
  wasCorrected?: boolean;
  /** Tier 1I — recoverable error CTA (e.g. "Add your AI key" → /settings/byok). */
  errorAction?: { label: string; href: string };
}

// ─── Pax stream text reducer ─────────────────────────────────────────────────
// Pure helper for the assistant-text portion of the SSE stream. Extracted so the
// hallucination-guard `correction` handling is unit-testable in isolation.
//
// Behaviour:
//   • `content` events append their delta to the accumulated text.
//   • a `correction` event REPLACES the accumulated text with the corrected
//     version, marks the turn corrected, and locks it — any later `content`
//     deltas from the pre-correction turn are ignored (no flash of stale text).
export interface PaxTextStreamState {
  content: string;
  corrected: boolean;
}

export function reducePaxTextEvent(
  state: PaxTextStreamState,
  event: { type?: string; content?: unknown },
): PaxTextStreamState {
  if (event.type === "content" && typeof event.content === "string" && event.content) {
    if (state.corrected) return state;
    return { ...state, content: state.content + event.content };
  }
  if (event.type === "correction" && typeof event.content === "string") {
    return { content: event.content, corrected: true };
  }
  return state;
}

// ─── Approval args formatter ─────────────────────────────────────────────────

function formatApprovalArgs(toolName: string, args: any): string {
  try {
    if (toolName === "send_email" || toolName === "send_gmail") {
      const to = args?.to ?? args?.recipient ?? "unknown";
      const subject = args?.subject ?? "";
      return `to ${to}${subject ? `: "${subject}"` : ""}`;
    }
    if (toolName === "send_sms") return `SMS to ${args?.to ?? args?.phone ?? "unknown"}`;
    if (toolName === "send_slack_message") return `in #${args?.channel ?? "unknown"}`;
    if (toolName === "create_stripe_payment_link") return `$${args?.amount ?? "?"} — ${args?.description ?? "payment"}`;
    return JSON.stringify(args).slice(0, 80);
  } catch {
    return "";
  }
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
  "image/png", "image/jpeg", "image/webp", "image/gif",
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
  const brandName = useBrandName();
  const pageMeta = useMemo(() => getPageMeta(location, brandName), [location, brandName]);
  const PageIcon = pageMeta.icon;

  // The rail is a desktop ambient surface. On mobile it would cover
  // almost the entire viewport (360px rail on a 390px phone), so we
  // hide it there entirely. Mobile users reach chat via /ai, the
  // conversation tray button, or the command palette.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Chat state
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Read-aloud — auto-speak new Pax responses if user opted in.
  const { speak: readAloudSpeak } = useReadAloud();
  const { autoReadPax } = useReadAloudPrefs();
  const lastAutoReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoReadPax) return;
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.role !== "assistant") return;
    if (last.isStreaming) return;
    if (!last.content?.trim()) return;
    if (lastAutoReadRef.current === last.id) return;
    lastAutoReadRef.current = last.id;
    // Strip markdown — match what ReadAloudButton does so prosody stays
    // natural. (Inlined here to avoid a circular import.)
    const spoken = last.content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (spoken) readAloudSpeak(spoken);
  }, [messages, autoReadPax, readAloudSpeak]);

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

  // Connector panel
  const [showConnectors, setShowConnectors] = useState(false);

  // Project panel
  const [showProjects, setShowProjects] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);

  // Scheduled task results banner
  const [pendingResults, setPendingResults] = useState<PendingTaskResult[]>([]);
  const [showResultsBanner, setShowResultsBanner] = useState(false);

  // Model selector
  const [modelOverride, setModelOverride] = useState<string>(() =>
    localStorage.getItem("pax_model_override") || "auto"
  );

  // Message ratings (local optimistic state: messageId → 1 | -1)
  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({});

  // Memory panel
  const [showMemory, setShowMemory] = useState(false);

  // Conversation search
  const [convSearch, setConvSearch] = useState("");

  // Voice mic
  const [micState, setMicState] = useState<"idle" | "recording" | "transcribing">("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Ambient auto-brief
  const [autoBriefPending, setAutoBriefPending] = useState(false);

  // Pax nudges
  const { data: nudges = [], refetch: refetchNudges } = useQuery<any[]>({
    queryKey: ["/api/ai/nudges"],
    enabled: false, // fetched on demand when rail opens
  });
  const [dismissedNudgeIds, setDismissedNudgeIds] = useState<number[]>([]);

  // Pax observations (initial load; real-time updates come via SSE below).
  // Server has two modes on /api/pax/observations:
  //   ?unread=true             → { count } (badge-count only — sidebar)
  //   (no unread param)        → { observations: [...] } (this one)
  // The rail wants the LIST of recent active observations, not the count.
  // Earlier this query passed unread=true&limit=5, which silently returned
  // {count} — the rail's PaxObservation[] cast then produced an empty list
  // and burned a roundtrip per page-mount (often 429'd by the rate limiter).
  const { data: observationsData, refetch: refetchObs } = useQuery<{ observations: PaxObservation[] }>({
    queryKey: ["/api/pax/observations", { limit: 5 }],
    queryFn: async () => {
      const res = await fetch("/api/pax/observations?limit=5", { credentials: "include" });
      if (!res.ok) return { observations: [] };
      return res.json();
    },
    staleTime: 60 * 1000,
  });
  const [sseObservations, setSseObservations] = useState<PaxObservation[]>([]);

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

  const observations = [
    ...(Array.isArray(sseObservations) ? sseObservations : []),
    ...(observationsData?.observations ?? []),
  ].filter((obs, idx, arr) => arr.findIndex((o) => o.id === obs.id) === idx);

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

  // ── Real-time observations via SSE ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource("/api/pax/observations/stream", { withCredentials: true } as any);
      (es as EventSource).onmessage = (evt) => {
        try {
          const obs = JSON.parse(evt.data) as PaxObservation;
          setSseObservations((prev) => {
            if (prev.find((o) => o.id === obs.id)) return prev;
            return [obs, ...prev];
          });
        } catch {}
      };
      (es as EventSource).onerror = () => {
        es?.close();
        reconnectTimer = setTimeout(connect, 5_000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [isOpen]);

  // ── Pax ambient mode — auto-open and brief if away 12+ hours ─────────────
  useEffect(() => {
    const lastActive = localStorage.getItem("pax-last-active");
    const twelveHours = 12 * 60 * 60 * 1000;
    if (lastActive && Date.now() - new Date(lastActive).getTime() > twelveHours) {
      setTimeout(() => setOpen(true), 1500);
      setAutoBriefPending(true);
    }
    localStorage.setItem("pax-last-active", new Date().toISOString());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send auto-brief once rail is ready ───────────────────────────────────
  useEffect(() => {
    if (!autoBriefPending || !isOpen || isLoadingHistory || messages.length > 0) return;
    if (!sessionRestored && activeConversationId) return;
    setAutoBriefPending(false);
    const timer = setTimeout(() => {
      sendMessage("Daily briefing: What happened in the last 12 hours across leads, deals, payments, and tasks? Be concise.");
    }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBriefPending, isOpen, isLoadingHistory, messages.length, sessionRestored, activeConversationId]);

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
    // Fetch proactive nudges
    refetchNudges();
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
      if (modelOverride && modelOverride !== "auto") body.modelOverride = modelOverride;

      const res = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        // Tier 1I — parse the structured error body so the BYOK-required
        // refusal renders as a recoverable state with a CTA, not a dead end.
        let errBody: any = null;
        try {
          errBody = await res.json();
        } catch {
          errBody = null;
        }
        const details = errBody?.details;
        let err: string;
        let errorAction: { label: string; href: string } | undefined;
        if (res.status === 429 && details?.reason === "byok_required") {
          err = details.message
            ?? "You've used this month's included Pax turns. Add your own AI key to keep chatting without limits — your data and drafts stay fully accessible.";
          errorAction = details.byokAvailable
            ? { label: "Add your AI key", href: details.byokSettingsUrl || "/settings/byok" }
            : { label: "Upgrade plan", href: details.upgradeUrl || "/pricing" };
        } else if (res.status === 429) {
          err = "Rate limit reached. Please try again shortly.";
        } else if (res.status === 402) {
          err = "Insufficient credits.";
        } else {
          err = "Pax couldn't reach us. Try again, or reload the chat.";
        }
        setMessages((prev) => prev.map((m) =>
          m.id === asstId ? { ...m, role: "error" as const, content: err, isStreaming: false, errorAction } : m
        ));
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      // Once the server's hallucination guard sends a `correction` event we lock
      // the message to the corrected text and ignore any further content deltas
      // from the pre-correction turn (avoids a flash of duplicate/stale text).
      let corrected = false;
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
              } else if (data.type === "content" || data.type === "correction") {
                const justCorrected = data.type === "correction" && !corrected;
                const next = reducePaxTextEvent({ content: accumulated, corrected }, data);
                // Only re-render if the reducer actually changed the text — a
                // post-correction content delta is dropped silently.
                if (next.content !== accumulated || next.corrected !== corrected) {
                  accumulated = next.content;
                  corrected = next.corrected;
                  setMessages((prev) => prev.map((m) =>
                    m.id === asstId
                      ? { ...m, content: accumulated, ...(justCorrected ? { wasCorrected: true } : {}) }
                      : m
                  ));
                }
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
              } else if (data.type === "pending_action" && data.pendingAction?.pendingActionId) {
                // Tier 1A approval kernel: the tool call is frozen server-side
                // as a pending_actions row; render the Approve/Reject card.
                setMessages((prev) => prev.map((m) =>
                  m.id === asstId ? {
                    ...m,
                    pendingAction: {
                      pendingActionId: data.pendingAction.pendingActionId,
                      toolName: data.pendingAction.toolName,
                      args: data.pendingAction.args,
                      status: "pending" as const,
                    },
                  } : m
                ));
              }
            } catch {}
          }
        }
      }

      if (!accumulated && !corrected) {
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
      setConvSearch("");
      return;
    }
    abortRef.current?.abort();
    setMessages([]);
    setActiveToolEvents({});
    setIsStreaming(false);
    setSessionRestored(false);
    setRestoredFromDate(null);
    setShowConvSwitcher(false);
    setConvSearch("");
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

  // ── Export conversation ───────────────────────────────────────────────────
  const handleExport = async (format: "markdown" | "pdf") => {
    if (!activeConversationId) return;
    const url = `/api/ai/conversations/${activeConversationId}/export?format=${format}`;
    if (format === "markdown") {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (res.ok) {
          const text = await res.text();
          const blob = new Blob([text], { type: "text/markdown" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `pax-conversation-${activeConversationId}.md`;
          a.click();
          URL.revokeObjectURL(a.href);
        }
      } catch {}
    } else {
      window.open(url, "_blank");
    }
  };

  // ── Message rating ────────────────────────────────────────────────────────
  const handleRating = async (messageId: string, rating: 1 | -1) => {
    setRatings((prev) => ({ ...prev, [messageId]: rating }));
    // Only persist if we have a DB-backed id (format "db-{n}")
    if (!messageId.startsWith("db-")) return;
    const numericId = parseInt(messageId.slice(3), 10);
    if (isNaN(numericId)) return;
    try {
      await fetch(`/api/ai/messages/${numericId}/rating`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rating }),
      });
    } catch {}
  };

  // ── Dismiss nudge ─────────────────────────────────────────────────────────
  const handleDismissNudge = async (nudgeId: number) => {
    setDismissedNudgeIds((prev) => [...prev, nudgeId]);
    try {
      await fetch(`/api/ai/nudges/${nudgeId}/dismiss`, { method: "POST", credentials: "include" });
    } catch {}
  };

  // ── Voice mic ─────────────────────────────────────────────────────────────
  const handleMicToggle = async () => {
    if (micState === "recording") {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setMicState("transcribing");
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "recording.webm");
        try {
          const res = await fetch("/api/ai/voice/transcribe", {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (res.ok) {
            const { transcript } = await res.json();
            if (transcript) setInputValue((prev) => prev + (prev ? " " : "") + transcript);
          }
        } catch {}
        setMicState("idle");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setMicState("recording");
    } catch {
      setMicState("idle");
    }
  };

  // ── Approval kernel (Tier 1A) ─────────────────────────────────────────────
  // Approve/Reject act on the FROZEN pending_actions row server-side. No
  // natural-language "Confirmed, please proceed" round-trip — the human tap
  // is the approval, the kernel re-verifies the content hash, and a
  // double-tap is idempotent (the second tap returns the first result).
  const handlePendingActionDecision = async (
    msgId: string,
    pendingActionId: number,
    decision: "approve" | "reject",
  ) => {
    const setStatus = (status: NonNullable<RailMessage["pendingAction"]>["status"], resultNote?: string) =>
      setMessages((prev) => prev.map((m) =>
        m.id === msgId && m.pendingAction
          ? { ...m, pendingAction: { ...m.pendingAction, status, resultNote } }
          : m
      ));

    setStatus("deciding");
    try {
      const res = await fetch(`/api/pax/pending-actions/${pendingActionId}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const body = await res.json().catch(() => null);
      if (res.ok && decision === "approve") {
        setStatus("executed", body?.alreadyExecuted ? "Already sent — returned the original result." : undefined);
      } else if (res.ok) {
        setStatus("rejected");
      } else {
        setStatus("failed", body?.message ?? "The action could not be completed. Ask Pax to draft it again.");
      }
    } catch {
      setStatus("failed", "Connection failed. The action was not executed — try again.");
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

  // Mobile: rail is hidden. 360px of 390px phone screen isn't a rail,
  // it's a takeover. Mobile users get chat via /ai, the conversation
  // tray button in the dock, and the command palette search.
  if (isMobileViewport) return null;

  return (
    <>
      <aside
        aria-label={isOpen ? "Pax copilot" : "Pax copilot (collapsed)"}
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
                  type="button"
                  onClick={toggle}
                  aria-label={observations.length > 0 ? `Open Pax copilot (${observations.length} unread)` : "Open Pax copilot"}
                  aria-expanded={isOpen}
                  className="w-8 h-8 rounded-card flex items-center justify-center hover:bg-primary/10 transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="pax-rail-expand"
                >
                  <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
                  {observations.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-acr-neg rounded-full" aria-hidden="true" />
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
                <div className="flex items-center gap-1 text-caption text-muted-foreground">
                  <PageIcon className="w-3 h-3" />
                  <span>{pageMeta.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Knowledge base button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowKnowledge(true)} aria-label="Knowledge base">
                      <BookOpen className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Knowledge Base</TooltipContent>
                </Tooltip>
                {/* Connectors button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowConnectors(true)} aria-label="Integrations">
                      <Plug className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Integrations</TooltipContent>
                </Tooltip>
                {/* Projects button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-7 w-7", activeProjectId && "text-primary")}
                      onClick={() => setShowProjects(true)}
                      aria-label="Projects"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Projects</TooltipContent>
                </Tooltip>
                {/* Memory panel button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowMemory(true)} aria-label="Pax memory">
                      <BrainCircuit className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Pax Memory</TooltipContent>
                </Tooltip>
                {/* Model selector */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Select
                        value={modelOverride}
                        onValueChange={(v) => {
                          setModelOverride(v);
                          localStorage.setItem("pax_model_override", v);
                        }}
                      >
                        <SelectTrigger className="h-6 w-auto text-micro border-0 bg-transparent px-1.5 gap-0.5 hover:bg-muted/50 focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end" className="text-xs min-w-[110px]">
                          <SelectItem value="auto" className="text-xs">Auto</SelectItem>
                          <SelectItem value="fast" className="text-xs">Fast</SelectItem>
                          <SelectItem value="balanced" className="text-xs">Balanced</SelectItem>
                          <SelectItem value="powerful" className="text-xs">Powerful</SelectItem>
                          <SelectItem value="reasoning" className="text-xs">Reasoning</SelectItem>
                          <SelectItem value="claude" className="text-xs">Claude</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Model: Auto uses smart routing · Fast = DeepSeek · Powerful = GPT-4o · Claude = Sonnet</TooltipContent>
                </Tooltip>
                {/* Conversation switcher toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setShowConvSwitcher((v) => !v)}
                      aria-label="Switch conversation"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Switch conversation</TooltipContent>
                </Tooltip>
                {messages.length > 0 && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat} aria-label="New chat">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>New chat</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleExport("pdf")}
                          aria-label="Export conversation"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export conversation (PDF / Markdown)</TooltipContent>
                    </Tooltip>
                  </>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Collapse panel">
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Collapse (⌘J)</TooltipContent>
                </Tooltip>
              </div>

              {/* Conversation switcher dropdown */}
              {showConvSwitcher && (
                <div className="absolute top-full right-0 left-0 z-50 bg-background border border-border rounded-b-lg shadow-lg">
                  <div className="px-3 py-2 border-b space-y-1.5">
                    <p className="text-caption font-medium text-muted-foreground uppercase tracking-wide">Recent conversations</p>
                    <Input
                      placeholder="Search…"
                      value={convSearch}
                      onChange={(e) => setConvSearch(e.target.value)}
                      className="h-7 text-xs"
                      autoFocus
                    />
                  </div>
                  {(() => {
                    const filtered = convSearch.trim()
                      ? (recentConversations ?? []).filter((c) =>
                          c.title.toLowerCase().includes(convSearch.toLowerCase())
                        )
                      : (recentConversations ?? []).slice(0, 5);
                    return filtered.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2">
                        {convSearch.trim() ? "No matches" : "No conversations yet"}
                      </p>
                    ) : (
                      filtered.map((conv) => (
                        <button
                          key={conv.id}
                          type="button"
                          onClick={() => switchConversation(conv.id)}
                          aria-current={conv.id === activeConversationId ? "true" : undefined}
                          aria-label={`Switch to conversation: ${conv.title}`}
                          className={cn(
                            "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            conv.id === activeConversationId && "bg-primary/5"
                          )}
                        >
                          <MessageSquare className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium text-foreground">{conv.title}</p>
                            <p className="text-micro text-muted-foreground">
                              {new Date(conv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                          </div>
                          {conv.id === activeConversationId && (
                            <span className="text-[9px] text-primary font-medium flex-shrink-0">Active</span>
                          )}
                        </button>
                      ))
                    );
                  })()}
                  <div className="px-3 py-2 border-t">
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className="text-caption text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
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
                <p className="text-caption text-foreground flex-1 min-w-0">
                  Pax ran <span className="font-semibold">{pendingResults.length} task{pendingResults.length > 1 ? "s" : ""}</span> while you were away.
                  {pendingResults[0].lastRunConversationId && (
                    <button
                      type="button"
                      className="text-primary hover:underline ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
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
                <button type="button" onClick={() => setShowResultsBanner(false)} aria-label="Dismiss results banner" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                  <X className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Initiative Feed */}
            {observations.length > 0 && messages.length === 0 && !isLoadingHistory && (
              <div className="flex-shrink-0 border-b px-3 py-2 space-y-1.5 max-h-[180px] overflow-y-auto">
                <div className="flex items-center gap-1.5 mb-1">
                  <Bell className="w-3 h-3 text-muted-foreground" />
                  <span className="text-caption font-medium text-muted-foreground uppercase tracking-wide">Pax noticed</span>
                </div>
                {observations.slice(0, 4).map((obs) => (
                  <div key={obs.id} className="rounded-md border bg-muted/30 p-2 text-xs group">
                    <div className="flex items-start gap-1.5">
                      {obs.severity === "high"
                        ? <AlertCircle className="w-3 h-3 text-acr-neg flex-shrink-0 mt-0.5" />
                        : <CheckCircle2 className="w-3 h-3 text-acr-accent flex-shrink-0 mt-0.5" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground leading-tight">{obs.title}</p>
                        <p className="text-muted-foreground leading-tight mt-0.5 line-clamp-2">{obs.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        type="button"
                        className="text-primary hover:underline text-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        onClick={() => sendMessage(`Tell me more about this: "${obs.title}" — ${obs.description}`)}
                        aria-label={`Discuss observation: ${obs.title}`}
                      >
                        Handle it →
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground text-micro ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        onClick={() => dismissMutation.mutate(obs.id)}
                        aria-label={`Dismiss observation: ${obs.title}`}
                      >
                        Dismiss
                      </button>
                    </div>
                    {/* Lens 46 — trust-loop legibility: show the reasoning,
                        inputs, and alternatives behind this observation. */}
                    <PaxWhyExplainer observationId={obs.id} />
                  </div>
                ))}
              </div>
            )}

            {/* Quick Actions (show when no messages and not loading) */}
            {messages.length === 0 && !isLoadingHistory && (
              <div className="flex-shrink-0 px-3 py-2 border-b">
                <p className="text-caption font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Quick actions</p>
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
                <p className="text-micro text-muted-foreground/50 mt-2">
                  Tip: Type <Kbd size="sm">/</Kbd> for commands · <Kbd size="sm">@</Kbd> to mention an entity · <Kbd size="sm">⌘K</Kbd> for palette
                </p>
              </div>
            )}

            {/* Resumed session banner */}
            {restoredFromDate && messages.length > 0 && !isLoadingHistory && (
              <div className="flex-shrink-0 px-3 py-1.5 flex items-center gap-1.5 bg-muted/30 border-b">
                <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-caption text-muted-foreground">
                  Resumed from {new Date(restoredFromDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <button
                  className="text-caption text-primary hover:underline ml-auto flex-shrink-0"
                  onClick={handleNewChat}
                >
                  Start fresh
                </button>
              </div>
            )}

            {/* Proactive Pax nudges */}
            {nudges.filter((n: any) => !dismissedNudgeIds.includes(n.id)).length > 0 && messages.length === 0 && !isLoadingHistory && (
              <div className="flex-shrink-0 border-b px-3 py-2 space-y-1.5 max-h-[200px] overflow-y-auto">
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3 h-3 text-primary" />
                  <span className="text-caption font-medium text-muted-foreground uppercase tracking-wide">From Pax</span>
                </div>
                {nudges
                  .filter((n: any) => !dismissedNudgeIds.includes(n.id))
                  .slice(0, 3)
                  .map((nudge: any) => (
                    <div key={nudge.id} className="rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
                      <div className="flex items-start gap-1.5">
                        <Zap className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                        <p className="flex-1 min-w-0 leading-snug text-foreground">{nudge.content}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        {nudge.actionPrompt && (
                          <button
                            className="text-primary hover:underline text-micro font-medium"
                            onClick={() => {
                              handleDismissNudge(nudge.id);
                              sendMessage(nudge.actionPrompt);
                            }}
                          >
                            Explore →
                          </button>
                        )}
                        <button
                          className="text-muted-foreground hover:text-foreground text-micro ml-auto"
                          onClick={() => handleDismissNudge(nudge.id)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Chat messages */}
            <ScrollArea className="flex-1 min-h-0">
              <div role="log" aria-live="polite" aria-label="Pax conversation" className="px-3 py-3 space-y-3">
                {/* Loading skeleton */}
                {isLoadingHistory && (
                  <div role="status" aria-busy="true" aria-label="Loading conversation history" className="space-y-3">
                    <div className="flex justify-end"><Skeleton className="h-8 w-48 rounded-xl" /></div>
                    <div className="space-y-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
                    <div className="flex justify-end"><Skeleton className="h-8 w-36 rounded-xl" /></div>
                    <div className="space-y-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
                    <span className="sr-only">Loading…</span>
                  </div>
                )}

                {!isLoadingHistory && messages.length === 0 && observations.length === 0 && (
                  <div className="text-center py-8">
                    <Sparkles className="w-8 h-8 text-primary/30 mx-auto mb-2" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground">
                      Pax is your AI co-pilot. Ask anything about your business or use the quick actions above.
                    </p>
                    <p className="text-micro text-muted-foreground/60 mt-2">⌘J to toggle · Enter to send</p>
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
                                  className="inline-flex items-center gap-1 text-micro bg-primary/20 text-primary rounded px-1.5 py-0.5"
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
                                  className="inline-flex items-center gap-1 text-micro bg-primary/20 text-primary rounded px-1.5 py-0.5"
                                >
                                  <Paperclip className="w-2.5 h-2.5" />
                                  {a.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1 group">
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
                                "leading-relaxed text-foreground",
                                msg.role === "error" && "text-destructive"
                              )}
                            >
                              {msg.role === "error" ? msg.content : <PaxMarkdown content={msg.content} />}
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
                          {/* Tier 1I — recoverable-error CTA (BYOK required / upgrade) */}
                          {msg.role === "error" && msg.errorAction && (
                            <Button size="sm" variant="outline" className="mt-1.5" asChild>
                              <Link href={msg.errorAction.href}>{msg.errorAction.label}</Link>
                            </Button>
                          )}
                          {/* Hallucination-guard correction affordance — honest, not alarming */}
                          {msg.wasCorrected && msg.role !== "error" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 mt-1 text-caption text-muted-foreground">
                                  <CheckCircle2 className="w-3 h-3 text-acr-pos flex-shrink-0" aria-hidden="true" />
                                  Updated for accuracy
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Pax revised this reply to keep it grounded in your data.
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {/* Approval-kernel card: the frozen pending action awaiting a witnessed tap */}
                          {msg.pendingAction && (
                            <div className="rounded-md border border-acr-warn-soft bg-acr-warn-soft dark:bg-acr-warn-soft/30 dark:border-acr-warn-soft p-3 text-xs space-y-2 mt-1">
                              <div className="flex items-center gap-1.5">
                                {msg.pendingAction.status === "executed" ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-acr-pos flex-shrink-0" aria-hidden="true" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-acr-warn flex-shrink-0" aria-hidden="true" />
                                )}
                                <span className="font-medium text-acr-warn dark:text-acr-warn">
                                  {msg.pendingAction.status === "executed" && "Approved and sent"}
                                  {msg.pendingAction.status === "rejected" && "Rejected — nothing was sent"}
                                  {msg.pendingAction.status === "failed" && "Not completed"}
                                  {(msg.pendingAction.status === "pending" || msg.pendingAction.status === "deciding") &&
                                    "Action requires your approval"}
                                </span>
                              </div>
                              <p className="text-acr-warn dark:text-acr-warn leading-snug">
                                <span className="font-mono bg-acr-warn-soft dark:bg-acr-warn-soft px-1 rounded text-caption">{msg.pendingAction.toolName}</span>
                                {" "}{formatApprovalArgs(msg.pendingAction.toolName, msg.pendingAction.args)}
                              </p>
                              {msg.pendingAction.resultNote && (
                                <p className="text-muted-foreground leading-snug">{msg.pendingAction.resultNote}</p>
                              )}
                              {(msg.pendingAction.status === "pending" || msg.pendingAction.status === "deciding") && (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={msg.pendingAction.status === "deciding"}
                                    aria-label={`Approve and send ${msg.pendingAction.toolName.replace(/_/g, " ")}`}
                                    onClick={() => handlePendingActionDecision(msg.id, msg.pendingAction!.pendingActionId, "approve")}
                                    data-testid={`pending-action-approve-${msg.pendingAction.pendingActionId}`}
                                  >
                                    {msg.pendingAction.status === "deciding" ? "Working…" : "Approve & send"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={msg.pendingAction.status === "deciding"}
                                    aria-label={`Reject ${msg.pendingAction.toolName.replace(/_/g, " ")}`}
                                    onClick={() => handlePendingActionDecision(msg.id, msg.pendingAction!.pendingActionId, "reject")}
                                    data-testid={`pending-action-reject-${msg.pendingAction.pendingActionId}`}
                                  >
                                    Reject
                                  </Button>
                                </div>
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
                          {/* Rating buttons (shown after streaming completes) */}
                          {!msg.isStreaming && msg.role !== "error" && msg.content && (
                            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              <ReadAloudButton
                                text={msg.content}
                                data-testid={`pax-rail-read-aloud-${msg.id}`}
                              />
                              <button aria-label="Thumbs up"
                                onClick={() => handleRating(msg.id, 1)}
                                className={cn(
                                  "p-0.5 rounded hover:bg-muted transition-colors",
                                  ratings[msg.id] === 1 ? "text-acr-pos" : "text-muted-foreground/40 hover:text-muted-foreground"
                                )}
                                title="Good response"
                              >
                                <ThumbsUp className="w-3 h-3" />
                              </button>
                              <button aria-label="Thumbs down"
                                onClick={() => handleRating(msg.id, -1)}
                                className={cn(
                                  "p-0.5 rounded hover:bg-muted transition-colors",
                                  ratings[msg.id] === -1 ? "text-acr-neg" : "text-muted-foreground/40 hover:text-muted-foreground"
                                )}
                                title="Poor response"
                              >
                                <ThumbsDown className="w-3 h-3" />
                              </button>
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
              {/* Entity mention chips */}
              {mentionedEntities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {mentionedEntities.map((e) => (
                    <div
                      key={`${e.type}-${e.id}`}
                      className="flex items-center gap-1 text-caption bg-primary/10 text-primary rounded px-2 py-0.5 border border-primary/20"
                    >
                      @{e.name}
                      <button aria-label={`Remove mention of ${e.name}`}
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
                  {attachedFiles.map((f, i) => {
                    const isImage = f.type.startsWith("image/");
                    const previewUrl = isImage ? URL.createObjectURL(f) : null;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1 text-caption bg-muted rounded px-2 py-0.5 border"
                      >
                        {isImage && previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={f.name}
                            className="w-6 h-6 object-cover rounded"
                            onLoad={() => URL.revokeObjectURL(previewUrl)}
                          />
                        ) : (
                          <Paperclip className="w-3 h-3 text-muted-foreground" />
                        )}
                        <span className="truncate max-w-[100px]">{f.name}</span>
                        <button aria-label="Pax Slash Picker"
                          onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}
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
                        aria-label="Attach file"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Attach file (PDF, CSV, image…)</TooltipContent>
                  </Tooltip>
                  {/* Voice mic button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant={micState === "recording" ? "destructive" : "ghost"}
                        className={cn(
                          "h-8 w-8 flex-shrink-0",
                          micState === "recording" && "animate-pulse"
                        )}
                        onClick={handleMicToggle}
                        disabled={isStreaming || micState === "transcribing"}
                        aria-label={micState === "recording" ? "Stop recording" : "Voice input"}
                      >
                        {micState === "recording" ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : micState === "transcribing" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {micState === "recording" ? "Stop recording" : micState === "transcribing" ? "Transcribing…" : "Voice input"}
                    </TooltipContent>
                  </Tooltip>
                  {isStreaming ? (
                    <Button size="icon" variant="destructive" className="h-8 w-8 flex-shrink-0" onClick={handleStop} aria-label="Stop generating">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={handleSubmit}
                      disabled={!inputValue.trim() && attachedFiles.length === 0}
                      aria-label="Send message"
                      data-testid="pax-rail-send"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-micro text-muted-foreground/50 text-center">
                Pax can take real actions · Always review before sharing sensitive info
              </p>
            </div>
          </>
        )}
      </aside>

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

      {/* Memory Panel (Sheet) */}
      <PaxMemoryPanel open={showMemory} onClose={() => setShowMemory(false)} />

      {/* Knowledge Panel (Sheet) */}
      <PaxKnowledgePanel open={showKnowledge} onClose={() => setShowKnowledge(false)} />

      {/* Connector Panel (Sheet) */}
      <PaxConnectorPanel open={showConnectors} onOpenChange={setShowConnectors} />

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
