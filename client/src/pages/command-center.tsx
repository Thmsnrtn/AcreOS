import { useState, useRef, useEffect } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
// Sidebar / useSidebarCollapsed removed 2026-05-20 — this page is no longer
// rendered as a standalone route. The parent PageShell in pages/pax.tsx
// provides the sidebar + collapsed-margin chrome.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { clientLogger } from "@/lib/clientLogger";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Bot,
  FileText,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Wrench,
  Users,
  Settings,
  Brain,
  Sparkles,
  X,
  Gift,
  Paperclip,
  Image as ImageIcon,
  Square
} from "lucide-react";
import { Link, useSearch } from "wouter";
import PaxAskCard from "@/components/pax/PaxAskCard";
import {
  NEEDS_YOU_COUNT_KEY,
  NEEDS_YOU_KEY,
  usePaxAskActions,
  usePaxAskById,
  usePaxNeedsYou,
} from "@/hooks/usePaxNeedsYou";
import { PAX_CONTROLS_PATH, PAX_LABELS } from "@shared/pax-glossary";
import { formatDate } from "@/lib/format";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { ReadAloudButton } from "@/components/ReadAloudButton";
import { useAuth } from "@/hooks/use-auth";
// The founder-only AI console (VA roster, background services, AI ops).
// It moved out of this file 2026-09-04 — same panels, same queries, same
// isFounder guard below; it just no longer sits inside the customer's door.
import {
  AiOperationsPanel,
  BackgroundServicesPanel,
  VaTeamPanel,
} from "@/components/founder/ai-console";

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

interface Suggestion {
  label: string;
  skill: string;
  actionId: string;
  category: "insight" | "action";
  requiredTier?: string;
  available: boolean;
  currentTier: string;
  canUseTrialToken?: boolean;
}

interface SuggestionsResponse {
  suggestions: Suggestion[];
  trialTokens: number;
  tier: string;
}

interface ActiveSkill {
  type: string;
  label: string;
}

interface Attachment {
  id: string;
  file: File;
  preview?: string;
  type: "image" | "file";
}

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ACCEPTED_FILE_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/csv"];
const ACCEPTED_EXTENSIONS = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.txt,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

// ─── Ask hosts on /ai (the Pax controls spec §4.5) ────────────────────────────────
// Host 1 (the stream): an ask the server froze while this conversation
// streamed renders as a PaxAskCard right under the reply that proposed it.
// Host 2 (the strip): "Waiting for your tap (N)" is pinned above the composer
// on desktop AND mobile — the copilot rail returns null on phones, so the
// strip is how a phone answers. Both read the SAME server-formatted queue
// (GET /api/pax/needs-you) through usePaxNeedsYou; nothing is formatted here.

function ConversationAsk({ pendingActionId }: { pendingActionId: number }) {
  const { ask, isLoading } = usePaxAskById(pendingActionId);
  const { approve, reject, revise } = usePaxAskActions();
  if (ask) {
    return (
      <div className="flex justify-start" data-testid={`conversation-ask-${pendingActionId}`}>
        <div className="w-full max-w-[80%]">
          <PaxAskCard
            ask={ask}
            onApprove={(a) => approve(a.id)}
            onReject={(a) => reject(a.id)}
            onRevise={(a, args) => revise(a.id, args)}
          />
        </div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex justify-start" role="status" aria-busy="true" aria-label="Loading what Pax is asking">
        <div className="w-full max-w-[80%] space-y-2">
          <Skeleton announce={false} className="h-4 w-1/2" />
          <Skeleton announce={false} className="h-16 w-full" />
        </div>
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground" data-testid={`conversation-ask-gone-${pendingActionId}`}>
      This ask is no longer waiting — it was answered or expired.
    </p>
  );
}

function PaxNeedsYouStrip() {
  const { pending, expired, isLoading, isError } = usePaxNeedsYou();
  const { approve, reject, revise } = usePaxAskActions();
  const [open, setOpen] = useState(false);
  const count = pending.length;
  // No chrome for an empty queue — and no number until the server has answered.
  if (isLoading || isError || (count === 0 && expired.length === 0)) return null;
  const label = `${PAX_LABELS.queue} (${count})`;
  return (
    <section
      className="mb-2 rounded-card border border-acr-warn/40 bg-acr-warn-soft/40"
      aria-label={label}
      data-testid="pax-needs-you-strip"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="pax-needs-you-list"
        className="flex w-full items-center justify-between gap-2 px-3 min-h-11 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-card"
        data-testid="pax-needs-you-toggle"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-acr-warn shrink-0" aria-hidden="true" />
          <span className="truncate" data-testid="pax-needs-you-count">{label}</span>
          {expired.length > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">· {expired.length} expired</span>
          )}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div id="pax-needs-you-list" className="px-3 pb-3 space-y-2 max-h-[50vh] overflow-y-auto" data-testid="pax-needs-you-list">
          {pending.map((ask) => (
            <PaxAskCard
              key={ask.id}
              ask={ask}
              compact
              onApprove={(a) => approve(a.id)}
              onReject={(a) => reject(a.id)}
              onRevise={(a, args) => revise(a.id, args)}
            />
          ))}
          {expired.map((ask) => (
            <PaxAskCard
              key={ask.id}
              ask={ask}
              compact
              onApprove={(a) => approve(a.id)}
              onReject={(a) => reject(a.id)}
              onRevise={(a, args) => revise(a.id, args)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CommandCenterPage() {
  useDocumentTitle("Pax");
  const queryClient = useQueryClient();
  const { isMobile } = useIsMobile();
  const { toast } = useToast();
  const { isFounder } = useAuth();
  const [mainTab, setMainTab] = useState<string>("chat");

  // Constitution guard: if a non-founder somehow lands on a founder-only tab
  // (e.g. via a saved URL hash), redirect them silently to the Chat tab.
  // This runs on mount and whenever mainTab or isFounder changes.
  const FOUNDER_ONLY_TABS = ["team", "agents", "ai-ops"] as const;
  useEffect(() => {
    if (!isFounder && FOUNDER_ONLY_TABS.includes(mainTab as (typeof FOUNDER_ONLY_TABS)[number])) {
      setMainTab("chat");
    }
  }, [isFounder, mainTab]);
  const [input, setInput] = useState("");
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ name: string; result?: any }>>([]);
  const [activeSkill, setActiveSkill] = useState<ActiveSkill | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isImageMode, setIsImageMode] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [deleteConvoId, setDeleteConvoId] = useState<number | null>(null);
  // Asks the server froze during THIS session's turns, per conversation. The
  // card reads the server summary by id; this only remembers where it landed.
  const [conversationAsks, setConversationAsks] = useState<Record<number, number[]>>({});
  // ?prefill= — an expired ask's "Ask Pax to draft it again" lands here with
  // the original request; it fills the composer and waits for the human.
  const search = useSearch();
  useEffect(() => {
    const prefill = new URLSearchParams(search).get("prefill");
    if (prefill && prefill.trim()) {
      setInput(prefill);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [search]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 2026-06-05 Krieger P0 — Pax stream cancellation. The send button used
  // to spin forever with no way to stop a misfired prompt; an
  // AbortController per sendMessage call lets the user hit Stop and
  // reclaim the conversation.
  const abortControllerRef = useRef<AbortController | null>(null);

  const { data: suggestionsData } = useQuery<SuggestionsResponse>({
    queryKey: ["/api/assistant/suggestions"],
  });
  
  const suggestions = suggestionsData?.suggestions || [];
  const trialTokens = suggestionsData?.trialTokens || 0;

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
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/conversations", { agentRole: "assistant" });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (conversation) => {
      setCurrentConversationId(conversation.id);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
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
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  // allow-no-invalidation: pure NLP classification — result drives local chat flow only
  const classifyIntentMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/assistant/classify-intent", { message });
      return res.json();
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentConversation?.messages, streamingContent]);

  const isValidFileType = (file: File): boolean => {
    return ACCEPTED_IMAGE_TYPES.includes(file.type) || ACCEPTED_FILE_TYPES.includes(file.type);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    if (remainingSlots <= 0) return;

    const newAttachments: Attachment[] = [];
    for (const file of fileArray.slice(0, remainingSlots)) {
      if (!isValidFileType(file)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
      newAttachments.push({
        id: crypto.randomUUID(),
        file,
        type: isImage ? "image" : "file",
        preview: isImage ? URL.createObjectURL(file) : undefined,
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
  };

  const sendMessage = async () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming || isGeneratingImage) return;

    const message = input.trim();
    const currentAttachments = [...attachments];
    setInput("");
    setAttachments([]);
    setStreamingContent("");
    setPendingToolCalls([]);
    setIsStreaming(true);
    setActiveSkill(null);
    // Fresh AbortController per send. The previous one (if any) has either
    // completed or the user explicitly aborted it.
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const intentResult = await classifyIntentMutation.mutateAsync(message);
      if (intentResult?.skillLabel) {
        setActiveSkill({ type: intentResult.agentType, label: intentResult.skillLabel });
      }

      let conversationId = currentConversationId;
      if (!conversationId) {
        try {
          const newConversation = await createConversationMutation.mutateAsync();
          conversationId = newConversation.id;
          setCurrentConversationId(conversationId);
        } catch (err) {
          toast({
            title: "Couldn't start conversation",
            description: "Your message draft is preserved. Try sending again.",
            variant: "destructive",
          });
          setInput(message);
          setAttachments(currentAttachments);
          setIsStreaming(false);
          return;
        }
      }

      // Process attachments to base64 - separate images and files
      const imageContents: string[] = [];
      const fileAttachments: { name: string; content: string; size: number }[] = [];
      
      for (const att of currentAttachments) {
        const base64 = await fileToBase64(att.file);
        if (att.type === "image") {
          imageContents.push(base64);
        } else {
          fileAttachments.push({
            name: att.file.name,
            content: base64,
            size: att.file.size,
          });
        }
      }

      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId,
          // "executive" is the canonical Pax profile key. The old value
          // "assistant" isn't in agentProfiles, so every send 422'd before
          // reaching the model (WS1 interactive pass, 2026-07-07).
          agentRole: "executive",
          images: imageContents.length > 0 ? imageContents : undefined,
          files: fileAttachments.length > 0 ? fileAttachments : undefined,
        }),
        credentials: "include",
        signal,
      });

      if (response.status === 402) {
        toast({
          title: "Insufficient AI credits",
          description: "Please add credits to continue using the AI assistant. Visit Settings to purchase more.",
          variant: "destructive",
        });
        setInput(message);
        setIsStreaming(false);
        setActiveSkill(null);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Tier 1I — BYOK-required refusal: surface the structured message
        // (it explains the recovery path) instead of a generic failure.
        if (response.status === 429 && errorData?.details?.reason === "byok_required") {
          throw new Error(
            errorData.details.message
              ?? "You've used this month's included Pax turns. Add your own AI key in Settings → Your provider keys to keep chatting without limits.",
          );
        }
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

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
              } else if (data.type === "pending_action" && typeof data.pendingAction?.pendingActionId === "number") {
                // The server froze the tool call as a pending_actions row and
                // nothing was sent. Remember the id under this conversation so
                // the PaxAskCard renders beneath the reply, and refresh the
                // queue read so the card lands with it.
                const pendingActionId: number = data.pendingAction.pendingActionId;
                const convId = conversationId;
                if (typeof convId === "number") {
                  setConversationAsks((prev) => ({
                    ...prev,
                    [convId]: [...(prev[convId] ?? []).filter((id) => id !== pendingActionId), pendingActionId],
                  }));
                }
                queryClient.invalidateQueries({ queryKey: [...NEEDS_YOU_KEY] });
                queryClient.invalidateQueries({ queryKey: [...NEEDS_YOU_COUNT_KEY] });
              } else if (data.type === "done") {
                queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
                if (currentConversationId) {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/ai/conversations", currentConversationId],
                  });
                }
              }
            } catch (e) {
            }
          }
        }
      }
    } catch (error) {
      // User-initiated abort is the success path for the Stop button; don't
      // surface it as an error toast.
      if (
        error instanceof DOMException && error.name === "AbortError"
        || (error as any)?.name === "AbortError"
      ) {
        clientLogger.info("Pax stream aborted by user");
      } else {
        clientLogger.error("Streaming error:", error);
        // Make the promise true: put the draft back in the composer.
        setInput(message);
        toast({ title: "Couldn't send message", description: "Your draft is preserved. Try again or check the system status.", variant: "destructive" });
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamingContent("");
      setPendingToolCalls([]);
      setActiveSkill(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewConversation = () => {
    createConversationMutation.mutate();
  };

  const handleSelectConversation = (id: number) => {
    setCurrentConversationId(id);
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    if (!suggestion.available && suggestion.category === "action") {
      if (suggestion.canUseTrialToken && trialTokens > 0) {
        toast({
          title: "Trial token available",
          description: `You have ${trialTokens} trial tokens. This action will use 1 token. Type your request to try it!`,
          variant: "default",
        });
        setInput(suggestion.label);
        textareaRef.current?.focus();
      } else {
        toast({
          title: "Upgrade required",
          description: `This action requires ${suggestion.requiredTier || 'a higher'} tier. Upgrade in Settings to unlock it.`,
          variant: "default",
        });
      }
      return;
    }
    setInput(suggestion.label);
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setDeleteConvoId(id);
  };

  const messages = currentConversation?.messages || [];

  // CommandCenterPage is mounted inside the /pax (AI hub) tab content via
  // Suspense — it is no longer used as a standalone route (/command-center
  // is just a Redirect → /ai#chat now). The earlier `<Sidebar />` + h-screen
  // shell here duplicated the parent PageShell's chrome and was the source
  // of the "weird spacing / unanchored / content cut off" reports: two
  // sidebars overlapped on desktop and h-screen clipped the chat panel
  // below the parent's topbar on mobile. Rendering as embedded content now;
  // the parent provides scroll + sidebar + topbar.
  return (
    <div className="flex flex-col min-h-[60vh]">
      <div className="pb-4 border-b border-border">
        <DisclaimerBanner type="ai" className="mb-4" />
          <div className="flex items-center gap-2">
            {/* Customer tabs collapsed to the conversation alone (Pax
                controls program, spec §3b): the Tasks tab, its queue and
                its invented price are gone. Founders keep their own tabs
                (Team / Background / AI Ops) behind the same isFounder gate
                the constitution requires. */}
            {isFounder ? (
              <Tabs value={mainTab} onValueChange={setMainTab} className="flex-1 min-w-0">
                <div className="md:overflow-visible md:mx-0 md:px-0">
                  <TabsList className="w-full md:w-auto">
                    <TabsTrigger value="chat" data-testid="tab-chat" aria-label="Assistant">
                      <MessageSquare className="w-4 h-4 md:mr-2" />
                      <span className="hidden md:inline">Assistant</span>
                    </TabsTrigger>
                    {isFounder && (
                      <TabsTrigger value="team" data-testid="tab-team" aria-label="Team">
                        <Users className="w-4 h-4 md:mr-2" />
                        <span className="hidden md:inline">Team</span>
                      </TabsTrigger>
                    )}
                    {isFounder && (
                      <TabsTrigger value="agents" data-testid="tab-agents" aria-label="Background agents">
                        <Bot className="w-4 h-4 md:mr-2" />
                        <span className="hidden md:inline">Background</span>
                      </TabsTrigger>
                    )}
                    {isFounder && (
                      <TabsTrigger value="ai-ops" data-testid="tab-ai-ops" aria-label="AI Ops">
                        <Brain className="w-4 h-4 md:mr-2" />
                        <span className="hidden md:inline">AI Ops</span>
                      </TabsTrigger>
                    )}
                  </TabsList>
                </div>
              </Tabs>
            ) : (
              <div className="flex-1 min-w-0" />
            )}
            {/* The gear opens the ONE Pax control surface (Settings → Pax).
                The old in-place "AI settings" dialog had zero readers of the
                fields it wrote (the Pax controls spec §3d) and is deleted. */}
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="shrink-0 relative z-docked min-h-11 min-w-11 md:min-h-10 md:min-w-10"
            >
              <Link
                href={PAX_CONTROLS_PATH}
                aria-label="Pax settings — when it asks, what runs on its own"
                data-testid="button-pax-settings"
              >
                <Settings className="w-4 h-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {mainTab === "chat" && (
            <div className="flex flex-1 h-full overflow-hidden">
              {!isMobile && (
                <div className="w-72 border-r border-border flex flex-col">
                  <div className="p-4 border-b border-border">
                    <Button
                      onClick={handleNewConversation}
                      className="w-full"
                      disabled={createConversationMutation.isPending}
                      data-testid="button-new-conversation"
                    >
                      {createConversationMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                      )}
                      New Conversation
                    </Button>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1" data-testid="list-conversations">
                      {conversationsLoading ? (
                        <div className="space-y-1 py-1" role="status" aria-busy="true" aria-live="polite">
                          <span className="sr-only">Loading conversations</span>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="p-2 space-y-1.5">
                              <Skeleton announce={false} className="h-4 w-3/4" />
                              <Skeleton announce={false} className="h-3 w-1/2" />
                            </div>
                          ))}
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
                            className={`flex items-center gap-2 p-3 rounded-card cursor-pointer group transition-colors ${
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
                                {formatDate(conv.createdAt)}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-60 shrink-0"
                              onClick={(e) => handleDeleteConversation(e, conv.id)}
                              aria-label={`Delete conversation ${conv.title ?? ""}`.trim()}
                              data-testid={`button-delete-conversation-${conv.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 p-4" data-testid="list-messages">
                  <div className="max-w-3xl mx-auto space-y-4">
                    {!currentConversationId ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                          <Sparkles className="w-10 h-10 text-primary" />
                        </div>
                        {/* Bold Tahoe re-skin (Wave R, §3.2): the welcome H1
                            renders in the Fraunces `heading-section` grade
                            rather than a raw `text-xl font-bold`. testid kept. */}
                        <h3 className="heading-section mb-2" data-testid="text-assistant-welcome">Pax</h3>
                        <p className="text-sm text-acr-ink-2 max-w-md mb-4">
                          Ask about your pipeline, a specific deal, or anything across your portfolio.
                        </p>
                        {trialTokens > 0 && (
                          <div
                            className="flex items-center gap-2 mb-8 px-3 py-2 rounded-md bg-acr-pos-soft border border-acr-pos/30"
                            data-testid="trial-tokens-indicator"
                          >
                            <Gift className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
                            <span className="text-sm text-acr-pos">
                              {trialTokens} trial token{trialTokens !== 1 ? 's' : ''} available
                            </span>
                          </div>
                        )}
                        
                        {suggestions.length > 0 && (
                          <div className="w-full max-w-2xl">
                            <p className="text-xs font-semibold text-acr-ink-3 uppercase tracking-wide mb-3">Try asking Pax:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {suggestions.slice(0, 6).map((suggestion, idx) => (
                                <Button
                                  key={idx}
                                  variant="outline"
                                  className={`justify-start text-left h-auto py-3 px-4 ${
                                    !suggestion.available && suggestion.category === "action" && !suggestion.canUseTrialToken
                                      ? "opacity-60" 
                                      : ""
                                  }`}
                                  onClick={() => handleSuggestionClick(suggestion)}
                                  data-testid={`button-suggestion-${idx}`}
                                >
                                  <div className="flex flex-col items-start gap-1 w-full">
                                    <div className="flex items-center gap-2 w-full">
                                      <span className="font-medium text-sm">{suggestion.label}</span>
                                      {suggestion.category === "insight" && (
                                        <Badge variant="secondary" className="text-xs ml-auto">
                                          Free
                                        </Badge>
                                      )}
                                      {suggestion.category === "action" && !suggestion.available && suggestion.canUseTrialToken && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs ml-auto bg-acr-pos-soft text-acr-pos-soft-ink border-acr-pos/30"
                                        >
                                          Try Free
                                        </Badge>
                                      )}
                                      {suggestion.category === "action" && !suggestion.available && !suggestion.canUseTrialToken && (
                                        <Badge variant="outline" className="text-xs ml-auto">
                                          {suggestion.requiredTier}
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">{suggestion.skill}</span>
                                  </div>
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : messagesLoading ? (
                      <div className="space-y-4 py-4" role="status" aria-busy="true" aria-live="polite">
                        <span className="sr-only">Loading messages</span>
                        <Skeleton announce={false} className="h-16 w-3/4" />
                        <Skeleton announce={false} className="h-12 w-2/3 ml-auto" />
                        <Skeleton announce={false} className="h-16 w-3/4" />
                        <Skeleton announce={false} className="h-12 w-1/2 ml-auto" />
                      </div>
                    ) : messages.length === 0 && !streamingContent ? (
                      <div className="flex flex-col items-center justify-center h-64 text-center">
                        <MessageSquare className="w-12 h-12 text-acr-ink-3/30 mb-4" aria-hidden="true" />
                        <p className="text-sm text-acr-ink-3">
                          Quiet — nothing yet. Send a message to begin.
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
                              className={`max-w-[80%] rounded-card p-4 shadow-acr-1 ${
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-card border"
                              }`}
                            >
                              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

                              {msg.role === "assistant" && msg.content && (
                                <div className="mt-2 flex justify-end">
                                  <ReadAloudButton
                                    text={msg.content}
                                    data-testid={`command-center-read-aloud-${msg.id}`}
                                  />
                                </div>
                              )}

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
                            <div className="max-w-[80%] rounded-card p-4 bg-card border shadow-acr-1">
                              {activeSkill && (
                                <div className="flex items-center gap-2 mb-3 text-xs">
                                  <Badge variant="secondary" className="text-xs">
                                    <Brain className="w-3 h-3 mr-1" />
                                    {activeSkill.label}
                                  </Badge>
                                </div>
                              )}
                              
                              {pendingToolCalls.length > 0 && (
                                <div className="mb-3 space-y-2">
                                  {pendingToolCalls.map((tc, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2"
                                    >
                                      <Wrench className="w-3 h-3" aria-hidden="true" />
                                      <span>{tc.name}</span>
                                      {!tc.result ? (
                                        <Loader2 className="w-3 h-3 animate-spin ml-auto" aria-hidden="true" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3 ml-auto text-accent" aria-hidden="true" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {streamingContent ? (
                                <p className="whitespace-pre-wrap text-sm">{streamingContent}</p>
                              ) : pendingToolCalls.length === 0 ? (
                                <div className="flex items-center gap-2" role="status" aria-label="Pax is thinking">
                                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                  <span className="text-sm text-muted-foreground">Thinking...</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {/* Host 1 of 4: asks proposed in this conversation, under the reply. */}
                    {currentConversationId != null && (conversationAsks[currentConversationId] ?? []).length > 0 && (
                      <div className="space-y-3" data-testid="conversation-asks">
                        {(conversationAsks[currentConversationId] ?? []).map((id) => (
                          <ConversationAsk key={id} pendingActionId={id} />
                        ))}
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                <div className="p-4 border-t border-border">
                  <div className="max-w-3xl mx-auto flex flex-col gap-2">
                    {/* Host 2 of 4: the pinned queue, desktop and mobile. */}
                    <PaxNeedsYouStrip />
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileInputChange}
                      accept={ACCEPTED_EXTENSIONS}
                      multiple
                      className="hidden"
                      data-testid="input-file-upload"
                    />
                    
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-card">
                        {attachments.map((att) => (
                          <div
                            key={att.id}
                            className="relative group flex items-center gap-2 bg-background rounded-md p-2 pr-7 border"
                          >
                            {att.type === "image" && att.preview ? (
                              <img
                                src={att.preview}
                                alt={att.file.name}
                                className="w-8 h-8 object-cover rounded"
                              />
                            ) : (
                              <FileText className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                            )}
                            <span className="text-xs truncate max-w-[100px]">{att.file.name}</span>
                            <button aria-label={`Remove attachment ${att.file.name}`}
                              onClick={() => removeAttachment(att.id)}
                              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid={`button-remove-attachment-${att.id}`}
                            >
                              <X className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Compact button sizes on mobile: 5 controls (attach,
                        image-mode, textarea, send) on a 390px viewport with
                        h-10/w-10 each + a Send button leaves the textarea
                        with ~200px and clips the placeholder. Shrink the
                        side buttons to h-9/w-9 below sm so the input gets
                        breathing room. */}
                    <div className="flex gap-1 sm:gap-2 items-end">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleAttachClick}
                          disabled={isStreaming || attachments.length >= MAX_ATTACHMENTS}
                          className="h-9 w-9 sm:h-10 sm:w-10 shrink-0"
                          aria-label="Attach file"
                          data-testid="button-attach-file"
                        >
                          <Paperclip className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant={isImageMode ? "default" : "ghost"}
                          size="icon"
                          onClick={() => setIsImageMode(!isImageMode)}
                          disabled={isStreaming}
                          className="h-9 w-9 sm:h-10 sm:w-10 shrink-0"
                          aria-label={isImageMode ? "Disable image mode" : "Enable image mode"}
                          data-testid="button-image-mode"
                        >
                          <ImageIcon className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <Textarea
                        ref={textareaRef}
                        aria-label="Message"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={isImageMode ? "Describe the image…" : "Ask Pax anything…"}
                        className="flex-1 min-w-0 min-h-[44px] sm:min-h-[48px] max-h-32 resize-none"
                        disabled={isStreaming}
                        data-testid="input-message"
                      />
                      {isStreaming ? (
                        <Button
                          onClick={stopStreaming}
                          variant="destructive"
                          size="icon"
                          className="h-9 w-9 sm:h-10 sm:w-auto sm:px-4 shrink-0"
                          aria-label="Stop generating"
                          data-testid="button-stop-streaming"
                        >
                          <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                        </Button>
                      ) : (
                        <Button
                          onClick={sendMessage}
                          disabled={!input.trim() && attachments.length === 0}
                          size="icon"
                          className="h-9 w-9 sm:h-10 sm:w-auto sm:px-4 shrink-0"
                          aria-label="Send message"
                          data-testid="button-send-message"
                        >
                          <Send className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{isImageMode ? "Image generation mode" : ""}</span>
                      {/* Three text links, nothing else (the Pax controls spec §3b).
                          No per-message price here: the cap badge on the Pax
                          door is the only customer-facing usage number. */}
                      <nav aria-label="Pax links" className="flex items-center gap-1" data-testid="pax-footer-links">
                        <Link href={PAX_CONTROLS_PATH} className="inline-flex items-center min-h-11 md:min-h-0 px-1 underline-offset-2 hover:underline" data-testid="pax-footer-controls">
                          Controls
                        </Link>
                        <span aria-hidden="true">·</span>
                        <Link href="/activity?actor=pax" className="inline-flex items-center min-h-11 md:min-h-0 px-1 underline-offset-2 hover:underline" data-testid="pax-footer-receipts">
                          {PAX_LABELS.receipts}
                        </Link>
                        <span aria-hidden="true">·</span>
                        <Link href="/ai#appeals" className="inline-flex items-center min-h-11 md:min-h-0 px-1 underline-offset-2 hover:underline" data-testid="pax-footer-appeals">
                          Appeals
                        </Link>
                      </nav>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mainTab === "team" && isFounder && (
            <VaTeamPanel />
          )}

          {mainTab === "agents" && isFounder && (
            <BackgroundServicesPanel />
          )}

          {mainTab === "ai-ops" && isFounder && (
            <AiOperationsPanel />
          )}
        </div>

      <ConfirmDialog
        open={deleteConvoId !== null}
        onOpenChange={(open) => !open && setDeleteConvoId(null)}
        title="Delete Conversation"
        description="Are you sure you want to delete this conversation? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => { deleteConversationMutation.mutate(deleteConvoId!); setDeleteConvoId(null); }}
        isLoading={deleteConversationMutation.isPending}
        variant="destructive"
      />
    </div>
  );
}
