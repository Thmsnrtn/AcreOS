/**
 * Prototype reference: /acreos/command-palette.jsx → CommandPalette
 *
 * Key patterns from prototype:
 * - Three top-level groups: Navigate / Actions / Ask AcreOS
 * - Per-item two-letter chord shortcuts (e.g., "G H" go-home, "N D" new-deal)
 * - Bottom footer with discoverable keyboard hints (↑↓ navigate, ↵ open, ⌘J ask)
 * - Empty state offers "Ask AcreOS '<query>'" — press ↵ to send to AcreOS Intelligence
 * - Placeholder: "Search or ask AcreOS…"
 * - max-width 560px, top 14vh, max-height 70vh, blur backdrop
 *
 * Patterns extrapolated (not in prototype):
 * - Recent items section (production-only domain feature)
 * - Lead/deal sub-action mutations (Update lead status, change deal stage)
 * - Founder/admin group (gated by useIsFounder elsewhere)
 * - Explicit AI-mode toggle vs prototype's natural-language fallthrough
 * - Backdrop and dialog use Framer Motion spring rather than the prototype's CSS keyframes
 *
 * Phase 2A.2 visual application:
 * - Placeholder updated to "Search or ask AcreOS…" / "Ask AcreOS anything…"
 * - Modal: max-w-[560px] (was 640), top-[14vh] (was 20%)
 * - Background: .palette-modal (flat homestead surface) replaces .glass-panel
 *   .floating-window for this palette only — other glass-panel surfaces
 *   unaffected
 * - Backdrop: warm-tinted scrim (var(--acr-bg-sunken) at 60%) + blur(10px),
 *   replaces the prior cool-black scrim
 * - Footer hints aligned to prototype's 3-item density (navigate/open/close)
 *   on var(--acr-bg-sunken) with hairline top border
 *
 * Phase 9 Final Coherence Pass remaining:
 * - Two-letter chord shortcuts per item ("G H", "N D", etc.) — absent because
 *   production has many more nav targets than the prototype's curated set
 *   (would need a per-item chord registry; lower priority)
 * - Empty state copy: "Ask AcreOS '<query>'" with "Press ↵ to send as a
 *   question to AcreOS Intelligence" — production currently relies on the
 *   AI-mode toggle pattern instead
 */
import { useEffect, useState, useCallback, useRef, useMemo, useDeferredValue } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import type { Lead as SchemaLead, Property, Deal as SchemaDeal } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { telemetry } from "@/lib/telemetry";
import { queryClient, apiRequest, prefetchRoute } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useProviderStatus } from "@/hooks/use-provider-status";
import {
  detectEntity,
  looksLikeQuestion,
  parseScope,
  rankItems,
  type Scope,
  VALID_SCOPES,
} from "@shared/cmdkMatcher";
import { PALETTE_VERBS, type PaletteVerb } from "@/lib/cmdkVerbs";
import { readRecents, recordRecency } from "@/lib/cmdkRecency";
import { Kbd } from "@/components/ui/kbd";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Users,
  Building2,
  Handshake,
  DollarSign,
  Megaphone,
  Settings,
  Bot,
  UserPlus,
  Home,
  FileText,
  Mail,
  Sparkles,
  Clock,
  Target,
  Shield,
  BarChart2,
  Store,
  GraduationCap,
  TrendingUp,
  Brain,
  Activity,
  Search,
  Eye,
  Globe,
  ShieldCheck,
  Gavel,
  FileSearch,
  Loader2,
  Send,
  MessageSquare,
  Map,
  ListTodo,
  Phone,
  ArrowRight,
  CheckCircle,
  Keyboard,
  Archive,
  Trash2,
  Upload,
  Download,
  RefreshCw,
  Tag,
  ClipboardList,
  Filter,
} from "lucide-react";

// Map verb iconKey strings → lucide components. Centralised so the
// PALETTE_VERBS data records can stay decoupled from React.
const VERB_ICONS: Record<PaletteVerb["iconKey"], React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  UserPlus, Home, FileText, ListTodo, Mail, Sparkles, MessageSquare, Send,
  TrendingUp, Search, Phone, CheckCircle, DollarSign, Archive, Trash2,
  Upload, Download, Settings, RefreshCw, Building2, Handshake, Tag,
  ClipboardList, Filter, Users,
};

interface RecentItem {
  id: number;
  name: string;
  type: 'lead' | 'property' | 'deal';
}

interface RecentItemsResponse {
  leads: RecentItem[];
  properties: RecentItem[];
  deals: RecentItem[];
}

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  status: string;
  email?: string;
  phone?: string;
}

interface Deal {
  id: number;
  status: string;
  type: string;
  property?: {
    county?: string;
    state?: string;
  };
}

const leadStatuses = [
  { value: 'new', label: 'New' },
  { value: 'contacting', label: 'Contacting' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'closed', label: 'Closed' },
  { value: 'dead', label: 'Dead' },
];

const dealStages = [
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'offer_sent', label: 'Offer sent' },
  { value: 'countered', label: 'Countered' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'in_escrow', label: 'In escrow' },
  { value: 'closed', label: 'Closed' },
];

const pages = [
  { name: "Dashboard", icon: LayoutDashboard, path: "/" },
  { name: "Leads", icon: Users, path: "/leads" },
  { name: "Properties", icon: Building2, path: "/properties" },
  { name: "Deals", icon: Handshake, path: "/deals" },
  { name: "Finance", icon: DollarSign, path: "/finance" },
  { name: "Marketing", icon: Megaphone, path: "/campaigns" },
  { name: "Acquisition Radar", icon: Target, path: "/radar" },
  { name: "Land Credit Score", icon: Shield, path: "/land-credit" },
  { name: "Portfolio Optimizer", icon: BarChart2, path: "/portfolio-optimizer" },
  { name: "Valuation Model (AVM)", icon: TrendingUp, path: "/avm" },
  { name: "Negotiation Copilot", icon: Brain, path: "/negotiation" },
  { name: "Cash Flow Forecaster", icon: Activity, path: "/cash-flow" },
  { name: "Deal Hunter", icon: Search, path: "/deal-hunter" },
  { name: "Vision AI", icon: Eye, path: "/vision-ai" },
  { name: "Capital Markets", icon: DollarSign, path: "/capital-markets" },
  { name: "Market Intelligence", icon: Globe, path: "/market-intelligence" },
  { name: "Compliance AI", icon: ShieldCheck, path: "/compliance" },
  { name: "Tax Researcher", icon: Gavel, path: "/tax-researcher" },
  { name: "Document Intelligence", icon: FileSearch, path: "/document-intelligence" },
  { name: "Property Map", icon: Map, path: "/maps" },
  { name: "Marketplace", icon: Store, path: "/marketplace" },
  { name: "Academy", icon: GraduationCap, path: "/academy" },
  { name: "AI Hub", icon: Bot, path: "/ai" },
  { name: "Settings", icon: Settings, path: "/settings" },
];

// Phase 4 Week 19-20 (cmdk-v2 / Anya §3): the prior 6-action
// `quickActions` array was superseded by the 30-verb registry in
// `client/src/lib/cmdkVerbs.ts`. The verb registry is matcher-aware
// (acronym + bigram + recency scoring via shared/cmdkMatcher) and
// scope-filterable, where this static list was neither.

interface AIResponse {
  reply: string;
  actionPath?: string;
  actionLabel?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [aiMode, setAiMode] = useState(false);
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: recentItemsData } = useQuery<RecentItemsResponse>({
    queryKey: ["/api/recent-items"],
    enabled: open,
  });
  const { isFounder } = useAuth();
  const { isAvailable } = useProviderStatus();

  const [query, setQuery] = useState("");

  const { data: leadsData } = useQuery<Lead[]>({ queryKey: ["/api/leads"], enabled: open });
  const { data: propertiesData } = useQuery<Property[]>({ queryKey: ["/api/properties"], enabled: open });
  const { data: dealsData } = useQuery<Deal[]>({ queryKey: ["/api/deals"], enabled: open });

  // Phase 3 Week 14 (Anaïs §2): server-side fuzzy/hybrid search.
  // The local `leadsData.filter(...)` paths above are kept as a hot
  // cache for instant typing feedback; this query overlays the
  // tsvector + unaccent + phone-normalized matches once the server
  // responds. Debounced via React Query's intrinsic dedup + 200ms
  // staleTime so a fast typist doesn't flood the server.
  type ServerSearchResult = {
    type: "lead" | "property" | "deal";
    id: number;
    title: string;
    subtitle: string;
    rank: number;
    url: string;
  };
  const { data: serverSearchData } = useQuery<{
    results: Record<string, ServerSearchResult[]>;
    query: string;
    total: number;
  }>({
    queryKey: ["/api/search", search],
    enabled: open && search.trim().length >= 2,
    staleTime: 200,
    queryFn: async () => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(search.trim())}`,
        { credentials: "include" },
      );
      if (!res.ok) return { results: {}, query: search, total: 0 };
      return res.json();
    },
  });

  // ── ⌘K v2 derived state ──────────────────────────────────────────────
  // useDeferredValue lets React drop intermediate renders while the user
  // is still typing, keeping keystroke latency well under the 100ms
  // target on the 30-verb + N-page + N-entity haystack.
  const deferredInput = useDeferredValue(inputValue);
  const parsed = useMemo(() => parseScope(deferredInput), [deferredInput]);
  const activeScope: Scope | null = parsed.scope;
  const matcherQuery = parsed.remainder;
  const isQuestion = useMemo(
    () => looksLikeQuestion(deferredInput),
    [deferredInput],
  );
  const detectedEntity = useMemo(
    () => detectEntity(deferredInput),
    [deferredInput],
  );
  const recents = useMemo(
    () => (open ? readRecents() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, deferredInput],
  );

  // Verb matcher — re-ranks PALETTE_VERBS against the current query
  // every render. Cheap (≤30 items) so no debounce needed beyond the
  // useDeferredValue above.
  const matchedVerbs = useMemo(() => {
    const items = PALETTE_VERBS.filter((v) =>
      activeScope ? v.scope === activeScope || v.scope === "global" : true,
    ).map((v) => ({
      id: v.id,
      title: v.label,
      subtitle: v.hint,
      keywords: v.keywords,
      kind: "verb" as const,
      verb: v,
    }));
    if (!matcherQuery.trim()) {
      // No query → surface a stable subset (top-7 by recency) when the
      // palette opens, instead of an overwhelming dump of all 30.
      const ranked = rankItems("", items, { recents, keepAll: true });
      return ranked.slice(0, 7);
    }
    return rankItems(matcherQuery, items, { recents }).slice(0, 8);
  }, [matcherQuery, activeScope, recents]);

  // Page matcher — re-ranks the static `pages` list with the same
  // scoring logic so acronyms ("tdc" → Tax Delinquent Counties) and
  // 1-edit substring matches ("leaf" → Leaflet) work for navigation.
  const matchedPages = useMemo(() => {
    if (activeScope && activeScope !== "settings") return []; // pages list is the cross-cutting nav surface
    const items = pages.map((p) => ({
      id: `page:${p.path}`,
      title: p.name,
      kind: "page" as const,
      page: p,
    }));
    if (!matcherQuery.trim()) return [];
    return rankItems(matcherQuery, items, { recents }).slice(0, 6);
  }, [matcherQuery, activeScope, recents]);

  const aiMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", "/api/realtime/ask", { message: question });
      return res.json() as Promise<AIResponse>;
    },
    onSuccess: (data) => {
      setAiResponse(data);
    },
  });

  // Mutation for updating lead status
  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PUT", `/api/leads/${id}`, { status });
      if (!res.ok) throw new Error("Failed to update lead");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recent-items"] });
      const statusLabel = leadStatuses.find(s => s.value === variables.status)?.label || variables.status;
      toast({
        title: "Lead updated",
        description: `Status changed to ${statusLabel}`,
      });
      telemetry.actionCompleted('command_palette_lead_status_update', { newStatus: variables.status });
      setSelectedLeadId(null);
      setOpen(false);
    },
    onError: () => {
      toast({
        title: "Couldn't update lead status",
        description: "The lead's existing status is unchanged.",
        variant: "destructive",
      });
    },
  });

  // Mutation for updating deal stage
  const updateDealMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PUT", `/api/deals/${id}`, { status });
      if (!res.ok) throw new Error("Failed to update deal");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recent-items"] });
      const stageLabel = dealStages.find(s => s.value === variables.status)?.label || variables.status;
      toast({
        title: "Deal updated",
        description: `Stage changed to ${stageLabel}`,
      });
      telemetry.actionCompleted('command_palette_deal_stage_update', { newStage: variables.status });
      setSelectedDealId(null);
      setOpen(false);
    },
    onError: () => {
      toast({
        title: "Couldn't update deal stage",
        description: "The deal's existing stage is unchanged.",
        variant: "destructive",
      });
    },
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => !prev);
      if (!open) {
        setAiMode(false);
        setAiResponse(null);
        setInputValue("");
      }
    }
    if (e.key === "Escape") {
      if (aiMode) {
        setAiMode(false);
        setAiResponse(null);
      } else if (selectedLeadId || selectedDealId) {
        setSelectedLeadId(null);
        setSelectedDealId(null);
      } else {
        setOpen(false);
      }
    }
  }, [open, aiMode, selectedLeadId, selectedDealId]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Programmatic opener for surfaces without keyboard access (mobile,
  // visible search button). Listens for the acreos:open-command-palette
  // CustomEvent dispatched from layout-sidebar.tsx and elsewhere.
  useEffect(() => {
    const onOpenEvent = () => {
      setOpen(true);
      setAiMode(false);
      setAiResponse(null);
      setInputValue("");
    };
    window.addEventListener("acreos:open-command-palette", onOpenEvent);
    return () => window.removeEventListener("acreos:open-command-palette", onOpenEvent);
  }, []);

  useEffect(() => {
    if (open) {
      telemetry.featureUsed('command_palette');
    } else {
      // Reset state when closing
      setSearch("");
      setSelectedLeadId(null);
      setSelectedDealId(null);
    }
  }, [open]);

  const handleSelect = useCallback(
    (path: string, recencyId?: string) => {
      // Prefetch common API for the target route for perceived speed
      const prefetchMap: Record<string, string[]> = {
        "/leads": ["/api/leads"],
        "/properties": ["/api/properties"],
        "/deals": ["/api/deals"],
        "/": ["/api/dashboard/stats"],
      };
      (prefetchMap[path] || []).forEach(prefetchRoute);
      // Phase 4 Week 19-20 (cmdk-v2): persist this selection so the
      // matcher's recency signal lifts it next time the user opens ⌘K.
      if (recencyId) recordRecency(recencyId);
      setOpen(false);
      setAiMode(false);
      setAiResponse(null);
      setInputValue("");
      setLocation(path);
    },
    [setLocation]
  );

  const handleAISubmit = useCallback(() => {
    if (!inputValue.trim() || aiMutation.isPending) return;
    aiMutation.mutate(inputValue.trim());
  }, [inputValue, aiMutation]);

  // Detect AI mode: starts with "?" or contains natural language question words
  const isAIQuery = (val: string) => {
    const lower = val.toLowerCase().trim();
    return lower.startsWith("?") ||
      lower.startsWith("how") ||
      lower.startsWith("what") ||
      lower.startsWith("why") ||
      lower.startsWith("when") ||
      lower.startsWith("find me") ||
      lower.startsWith("show me") ||
      lower.startsWith("help") ||
      lower.startsWith("create") ||
      lower.startsWith("analyze");
  };

  const recentItems = [
    ...(recentItemsData?.leads?.slice(0, 2).map((lead) => ({
      type: "lead" as const,
      name: lead.name,
      path: `/leads?id=${lead.id}`,
    })) || []),
    ...(recentItemsData?.properties?.slice(0, 2).map((property) => ({
      type: "property" as const,
      name: property.name,
      path: `/properties?id=${property.id}`,
    })) || []),
    ...(recentItemsData?.deals?.slice(0, 1).map((deal) => ({
      type: "deal" as const,
      name: deal.name,
      path: `/deals?id=${deal.id}`,
    })) || []),
  ];

  const showAIMode = aiMode || (inputValue.length > 3 && isAIQuery(inputValue));

  // Filter leads matching search
  const matchingLeads = search.length >= 2 ? (leadsData || []).filter(lead => {
    const fullName = `${lead.firstName} ${lead.lastName}`.toLowerCase();
    return fullName.includes(search.toLowerCase());
  }).slice(0, 5) : [];

  // Filter deals matching search
  const matchingDeals = search.length >= 2 ? (dealsData || []).filter(deal => {
    const dealName = deal.property 
      ? `${deal.property.county || ''} ${deal.property.state || ''} ${deal.type}`.toLowerCase()
      : deal.type.toLowerCase();
    return dealName.includes(search.toLowerCase()) || deal.type.toLowerCase().includes(search.toLowerCase());
  }).slice(0, 5) : [];

  // Get current lead/deal for sub-menu
  const selectedLead = selectedLeadId ? leadsData?.find(l => l.id === selectedLeadId) : null;
  const selectedDeal = selectedDealId ? dealsData?.find(d => d.id === selectedDealId) : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] command-backdrop"
            onClick={() => setOpen(false)}
            data-testid="command-palette-backdrop"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.92, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -12 }}
            transition={{ type: "spring", stiffness: 500, damping: 32, mass: 0.8 }}
            className="fixed left-1/2 top-[14vh] z-[60] w-full max-w-[560px] -translate-x-1/2 p-4"
            data-testid="command-palette-dialog"
          >
            {/* shouldFilter=false: we hand-curate results via the
                cmdkMatcher (acronym/bigram/substring + recency) so
                the cmdk default fuzzy filter would just remove items
                we deliberately scored in. */}
            <Command className="palette-modal" shouldFilter={false}>
              <div className="relative">
                <CommandInput
                  ref={inputRef}
                  placeholder={showAIMode ? "Ask AcreOS anything…" : "Search or ask AcreOS…"}
                  value={inputValue}
                  onValueChange={(val) => { setInputValue(val); setSearch(val); setQuery(val); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && showAIMode) {
                      e.preventDefault();
                      handleAISubmit();
                    }
                    // Phase 4 Week 19-20: when the query reads like a
                    // question and the user presses ⌘↵ (or just ↵ if
                    // there are no other matches), forward straight to
                    // Pax instead of opening the highlighted item.
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && isQuestion) {
                      e.preventDefault();
                      setAiMode(true);
                      handleAISubmit();
                    }
                  }}
                  data-testid="command-palette-input"
                  autoFocus
                />
                {showAIMode && (
                  <button
                    type="button"
                    onClick={handleAISubmit}
                    disabled={aiMutation.isPending || !inputValue.trim()}
                    aria-busy={aiMutation.isPending}
                    aria-label={aiMutation.isPending ? "Asking AI" : "Ask AI"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {aiMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>

              {/* Scope chip indicator. Active scope filters the verb +
                  results haystack to one domain ("only leads" / "only
                  deals"…). Chips are typed into the input as `:leads`
                  etc. — no extra UI to drive them. */}
              {activeScope && (
                <div
                  className="px-3 py-1.5 text-xs border-b flex items-center gap-2"
                  data-testid="command-palette-scope-chip"
                >
                  <span className="font-medium text-muted-foreground">Scope:</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ background: "var(--acr-bg-sunken)", color: "var(--acr-fg)" }}
                  >
                    :{activeScope}
                  </span>
                  <span className="text-muted-foreground">
                    Press <Kbd size="sm" className="mx-1">⌫</Kbd> to clear
                  </span>
                </div>
              )}

              {/* Ask Pax inline preview. When the query reads like a
                  question (ends with "?" or starts with what/why/how/when
                  per shared/cmdkMatcher#looksLikeQuestion) we pin a
                  prominent "Ask Pax" affordance to the top of the
                  palette — Enter sends to the existing /api/realtime/ask
                  pipeline (same backend as the AI-mode toggle, just
                  surfaced earlier). */}
              {!showAIMode && isQuestion && inputValue.trim().length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setAiMode(true);
                    aiMutation.mutate(inputValue.trim());
                  }}
                  className="w-full px-4 py-3 border-b flex items-start gap-2 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40"
                  data-testid="command-palette-ask-pax"
                  aria-label={`Ask Pax: ${inputValue.trim()}`}
                >
                  <Sparkles className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--acr-brand)" }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Ask Pax</div>
                    <div className="text-xs text-muted-foreground truncate">{inputValue.trim()}</div>
                  </div>
                  <Kbd size="sm" className="ml-2 shrink-0">↵</Kbd>
                </button>
              )}

              {/* AI Mode Hint */}
              {!showAIMode && inputValue.length === 0 && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                    <span>Start with <span className="font-mono bg-muted px-1 rounded">?</span> or ask a question for AI assistance</span>
                  </span>
                  {/* Scope chip discoverability — shown only when the
                      palette is empty so it doesn't crowd the results. */}
                  <span className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider opacity-70">Scope:</span>
                    {VALID_SCOPES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { const v = `:${s} `; setInputValue(v); setSearch(v); setQuery(v); }}
                        className="font-mono text-[10px] px-1 rounded bg-muted hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        data-testid={`command-palette-scope-suggest-${s}`}
                      >
                        :{s}
                      </button>
                    ))}
                  </span>
                </div>
              )}

              {/* AI Response Panel */}
              {showAIMode && (
                <div className="px-4 py-3 border-b">
                  {aiMutation.isPending && (
                    <div role="status" aria-busy="true" aria-label="AI is thinking" className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Thinking…</span>
                    </div>
                  )}
                  {aiResponse && !aiMutation.isPending && (
                    <div className="space-y-2" role="status">
                      <div className="flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                        <p className="text-sm leading-relaxed m-0">{aiResponse.reply}</p>
                      </div>
                      {aiResponse.actionPath && aiResponse.actionLabel && (
                        <button
                          type="button"
                          onClick={() => handleSelect(aiResponse.actionPath!)}
                          className="ml-6 text-xs text-primary hover:underline flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                          aria-label={aiResponse.actionLabel}
                        >
                          <span aria-hidden="true">{"\u2192"}</span>
                          <span>{aiResponse.actionLabel}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {!aiResponse && !aiMutation.isPending && (
                    <p className="text-xs text-muted-foreground m-0">Press Enter or click the send button to ask</p>
                  )}
                </div>
              )}

              <CommandList className="max-h-[400px]">
                {/* Lead Status Sub-menu */}
                {selectedLead && (
                  <>
                    <CommandGroup heading={`Update ${selectedLead.firstName} ${selectedLead.lastName}`}>
                      {leadStatuses.map((status) => (
                        <CommandItem
                          key={status.value}
                          onSelect={() => updateLeadMutation.mutate({ id: selectedLead.id, status: status.value })}
                          disabled={selectedLead.status === status.value || updateLeadMutation.isPending}
                          className="cursor-pointer"
                          data-testid={`command-lead-status-${status.value}`}
                        >
                          {selectedLead.status === status.value ? (
                            <CheckCircle className="mr-2 h-4 w-4 text-acr-pos" aria-hidden="true" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span>{status.label}</span>
                          {selectedLead.status === status.value && (
                            <span className="ml-auto text-xs text-muted-foreground">(current)</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                      Press <Kbd size="sm" className="mx-1">esc</Kbd> to go back
                    </div>
                  </>
                )}

                {/* Deal Stage Sub-menu */}
                {selectedDeal && (
                  <>
                    <CommandGroup heading={`Update ${selectedDeal.property?.county || selectedDeal.type} Deal`}>
                      {dealStages.map((stage) => (
                        <CommandItem
                          key={stage.value}
                          onSelect={() => updateDealMutation.mutate({ id: selectedDeal.id, status: stage.value })}
                          disabled={selectedDeal.status === stage.value || updateDealMutation.isPending}
                          className="cursor-pointer"
                          data-testid={`command-deal-stage-${stage.value}`}
                        >
                          {selectedDeal.status === stage.value ? (
                            <CheckCircle className="mr-2 h-4 w-4 text-acr-pos" aria-hidden="true" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span>{stage.label}</span>
                          {selectedDeal.status === stage.value && (
                            <span className="ml-auto text-xs text-muted-foreground">(current)</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                      Press <Kbd size="sm" className="mx-1">esc</Kbd> to go back
                    </div>
                  </>
                )}

                {!showAIMode && !selectedLeadId && !selectedDealId && (
                  <>
                    <CommandEmpty>No results found. Start with "?" to ask AI.</CommandEmpty>

                    {/* Search Results (leads, properties, deals).
                        Prefer server-side fuzzy/hybrid results when the
                        /api/search query has resolved (Anaïs §2 wiring).
                        Fall back to client-side filter for instant
                        feedback while the server round-trip is in
                        flight. */}
                    {query.trim().length > 0 && (
                      <CommandGroup heading="Search results">
                        {(() => {
                          const serverResults = serverSearchData?.results;
                          const serverFlat: Array<{ name: string; path: string; rank: number }> = [];
                          if (serverResults && Object.keys(serverResults).length) {
                            for (const [type, items] of Object.entries(serverResults)) {
                              for (const r of items) {
                                const label =
                                  type === "lead" ? `Lead: ${r.title}` :
                                  type === "property" ? `Property: ${r.title}` :
                                  type === "deal" ? `Deal: ${r.title}` :
                                  r.title;
                                serverFlat.push({
                                  name: label,
                                  path: r.url,
                                  rank: r.rank ?? 0,
                                });
                              }
                            }
                            serverFlat.sort((a, b) => b.rank - a.rank);
                          }

                          let results: Array<{ name: string; path: string }>;
                          if (serverFlat.length) {
                            results = serverFlat.slice(0, 8);
                          } else {
                            // Client-side fallback while server is in flight.
                            const q = query.trim().toLowerCase();
                            const leadMatches = (leadsData || []).filter(l =>
                              (l.firstName + " " + l.lastName).toLowerCase().includes(q) || (l.email||"").toLowerCase().includes(q)
                            ).slice(0, 5).map(l => ({ name: `Lead: ${l.firstName} ${l.lastName}`, path: `/leads?id=${l.id}` }));
                            const propertyMatches = (propertiesData || []).filter(p =>
                              (p.county+" "+p.state).toLowerCase().includes(q) || String(p.apn||'').toLowerCase().includes(q)
                            ).slice(0, 5).map(p => ({ name: `Property: ${p.county}, ${p.state}`, path: `/properties?id=${p.id}` }));
                            const dealMatches = (dealsData || []).filter(d =>
                              String(d.id).includes(q)
                            ).slice(0, 5).map(d => ({ name: `Deal #${d.id}`, path: `/deals?id=${d.id}` }));
                            results = [...leadMatches, ...propertyMatches, ...dealMatches].slice(0, 8);
                          }
                          return results.length ? results.map(r => (
                            <CommandItem key={r.path} onSelect={() => handleSelect(r.path)} className="cursor-pointer">
                              <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <span>{r.name}</span>
                            </CommandItem>
                          )) : <CommandItem disabled>No matches</CommandItem>;
                        })()}
                      </CommandGroup>
                    )}

                    {/* Contextual Lead Actions */}
                    {matchingLeads.length > 0 && (
                      <>
                        <CommandGroup heading="Leads — quick actions">
                          {matchingLeads.map((lead) => (
                            <CommandItem
                              key={`lead-action-${lead.id}`}
                              onSelect={() => setSelectedLeadId(lead.id)}
                              className="cursor-pointer"
                              data-testid={`command-lead-${lead.id}`}
                            >
                              <Users className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <div className="flex flex-col">
                                <span>{lead.firstName} {lead.lastName}</span>
                                <span className="text-xs text-muted-foreground capitalize">
                                  {lead.status} {lead.phone && `\u00b7 ${lead.phone}`}
                                </span>
                              </div>
                              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    {/* Contextual Deal Actions */}
                    {matchingDeals.length > 0 && (
                      <>
                        <CommandGroup heading="Deals — quick actions">
                          {matchingDeals.map((deal) => (
                            <CommandItem
                              key={`deal-action-${deal.id}`}
                              onSelect={() => setSelectedDealId(deal.id)}
                              className="cursor-pointer"
                              data-testid={`command-deal-${deal.id}`}
                            >
                              <Handshake className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <div className="flex flex-col">
                                <span>
                                  {deal.property?.county ? `${deal.property.county}, ${deal.property.state}` : deal.type}
                                </span>
                                <span className="text-xs text-muted-foreground capitalize">
                                  {deal.type} {"\u00b7"} {deal.status.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    {isFounder && (
                      <>
                        <CommandGroup heading="Founder / admin">
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            data-testid="command-item-founder-dashboard"
                            className="cursor-pointer"
                          >
                            <Sparkles className="mr-2 h-4 w-4 text-acr-warn" aria-hidden="true" />
                            <span>Open founder dashboard</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/analytics")}
                            data-testid="command-item-system-health"
                            className="cursor-pointer"
                          >
                            <Clock className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <span>View system health</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/finance")}
                            data-testid="command-item-credits"
                            className="cursor-pointer"
                          >
                            <DollarSign className="mr-2 h-4 w-4 text-acr-pos" aria-hidden="true" />
                            <span>Open credits & costs</span>
                          </CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    {/* Entity-resolution shortcut \u2014 when the query
                        contains an email or phone, we surface the
                        contact/lead match first (Anya \u00a76). The actual
                        contact match is filed under the existing Search
                        results group above; this affordance gives the
                        user an explicit "open contact for this
                        email/phone" target even when the server search
                        hasn't returned yet. */}
                    {detectedEntity && (
                      <CommandGroup heading={`${detectedEntity.kind === "email" ? "Email" : "Phone"} match`}>
                        <CommandItem
                          key={`entity-${detectedEntity.kind}-${detectedEntity.value}`}
                          onSelect={() =>
                            handleSelect(
                              `/leads?${detectedEntity.kind === "email" ? "email" : "phone"}=${encodeURIComponent(detectedEntity.value)}`,
                              `entity:${detectedEntity.kind}:${detectedEntity.value}`,
                            )
                          }
                          className="cursor-pointer"
                          data-testid="command-palette-entity-match"
                        >
                          {detectedEntity.kind === "email" ? (
                            <Mail className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <Phone className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span>Find lead by {detectedEntity.kind}</span>
                          <span className="ml-auto text-xs text-muted-foreground truncate max-w-[180px]">{detectedEntity.value}</span>
                        </CommandItem>
                      </CommandGroup>
                    )}

                    {/* Phase 4 Week 19-20 \u2014 verb-first results when a
                        query is present, plus the matched-page list.
                        Verbs are 30-strong (Anya \u00a73) and ranked by the
                        cmdkMatcher (acronym + bigram + recency), so
                        "tdc" surfaces "Tax Delinquent Counties" via
                        page match; "send" surfaces send-letter / text
                        / email via verb match. */}
                    {matcherQuery.trim().length > 0 && matchedVerbs.length > 0 && (
                      <CommandGroup heading="Actions">
                        {matchedVerbs.map(({ item: m }) => {
                          const verb: PaletteVerb = (m as { verb: PaletteVerb }).verb;
                          const Icon = VERB_ICONS[verb.iconKey] ?? Sparkles;
                          const requiresAI = verb.id === "verb:generate-offer";
                          const disabled = requiresAI && !isAvailable("ai");
                          return (
                            <CommandItem
                              key={verb.id}
                              onSelect={() => !disabled && handleSelect(verb.path, verb.id)}
                              data-testid={`command-verb-${verb.id.replace(/:/g, "-")}`}
                              className="cursor-pointer"
                              disabled={disabled}
                            >
                              <Icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <div className="flex flex-col min-w-0">
                                <span>{verb.label}{disabled ? " (AI unavailable)" : ""}</span>
                                {verb.hint && (
                                  <span className="text-xs text-muted-foreground truncate">{verb.hint}</span>
                                )}
                              </div>
                              <CommandShortcut>{"\u21b5"}</CommandShortcut>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}

                    {matcherQuery.trim().length > 0 && matchedPages.length > 0 && (
                      <CommandGroup heading="Pages">
                        {matchedPages.map(({ item: m }) => {
                          const page = (m as { page: typeof pages[number] }).page;
                          return (
                            <CommandItem
                              key={page.path}
                              onSelect={() => handleSelect(page.path, `page:${page.path}`)}
                              onMouseEnter={() => ({ "/": ["/api/dashboard/stats"], "/leads": ["/api/leads"], "/properties": ["/api/properties"], "/deals": ["/api/deals"] }[page.path] || []).forEach(prefetchRoute)}
                              data-testid={`command-item-${page.name.toLowerCase().replace(/\s+/g, "-")}`}
                              className="cursor-pointer"
                            >
                              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <span>{page.name}</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}

                    {/* Empty-query state \u2014 show the canonical Pages +
                        verb-suggestion (top-7 by recency) lists so the
                        palette is never blank. */}
                    {matcherQuery.trim().length === 0 && (
                      <>
                        <CommandGroup heading={activeScope ? `${activeScope[0].toUpperCase()}${activeScope.slice(1)} actions` : "Quick actions"}>
                          {matchedVerbs.map(({ item: m }) => {
                            const verb: PaletteVerb = (m as { verb: PaletteVerb }).verb;
                            const Icon = VERB_ICONS[verb.iconKey] ?? Sparkles;
                            const requiresAI = verb.id === "verb:generate-offer";
                            const disabled = requiresAI && !isAvailable("ai");
                            return (
                              <CommandItem
                                key={verb.id}
                                onSelect={() => !disabled && handleSelect(verb.path, verb.id)}
                                data-testid={`command-verb-${verb.id.replace(/:/g, "-")}`}
                                className="cursor-pointer"
                                disabled={disabled}
                              >
                                <Icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <span>{verb.label}{disabled ? " (AI unavailable)" : ""}</span>
                                <CommandShortcut>{"\u21b5"}</CommandShortcut>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>

                        <CommandSeparator />

                        <CommandGroup heading="Pages">
                          {pages.map((page, idx) => (
                            <CommandItem
                              key={page.path}
                              onSelect={() => handleSelect(page.path, `page:${page.path}`)}
                              onMouseEnter={() => ({ "/": ["/api/dashboard/stats"], "/leads": ["/api/leads"], "/properties": ["/api/properties"], "/deals": ["/api/deals"] }[page.path] || []).forEach(prefetchRoute)}
                              data-testid={`command-item-${page.name.toLowerCase().replace(/\s+/g, "-")}`}
                              className="cursor-pointer"
                            >
                              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <span>{page.name}</span>
                              {idx < 9 && (
                                <CommandShortcut>{`\u2318${idx + 1}`}</CommandShortcut>
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}

                    {/* "Ask Your Team" exposes founder-internal agent
                        codenames (Forge, Sophie, Sentinel, ...) and routes
                        to /founder/*. Gated to the founder only; customers
                        should never see these names — their AI is Pax. */}
                    {isFounder && (
                      <>
                        <CommandSeparator />
                        <CommandGroup heading="Ask your team">
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-acr-pos" aria-hidden="true" />
                            <span>How's revenue doing?</span>
                            {/* eslint-disable-next-line acreos/no-founder-codenames-in-customer-jsx -- founder-gated by `isFounder` above */}
                            <span className="ml-auto text-xs text-muted-foreground">Forge</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-acr-warn" aria-hidden="true" />
                            <span>Any support issues?</span>
                            {/* eslint-disable-next-line acreos/no-founder-codenames-in-customer-jsx -- founder-gated by `isFounder` above */}
                            <span className="ml-auto text-xs text-muted-foreground">Sophie</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-acr-accent" aria-hidden="true" />
                            <span>Is anything broken?</span>
                            {/* eslint-disable-next-line acreos/no-founder-codenames-in-customer-jsx -- founder-gated by `isFounder` above */}
                            <span className="ml-auto text-xs text-muted-foreground">Sentinel</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-acr-brand" aria-hidden="true" />
                            <span>Morning briefing</span>
                            <span className="ml-auto text-xs text-muted-foreground">All agents</span>
                          </CommandItem>
                        </CommandGroup>
                      </>
                    )}

                    {recentItems.length > 0 && (
                      <>
                        <CommandSeparator />
                        <CommandGroup heading="Recent">
                          {recentItems.map((item, index) => (
                            <CommandItem
                              key={`${item.type}-${index}`}
                              onSelect={() => handleSelect(item.path)}
                              data-testid={`command-item-recent-${item.type}-${index}`}
                              className="cursor-pointer"
                            >
                              <Clock className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <span className="capitalize text-muted-foreground text-xs mr-2">
                                {item.type}:
                              </span>
                              <span className="truncate">{item.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}
                  </>
                )}
              </CommandList>

              {!selectedLeadId && !selectedDealId && (
                /* Footer hints per acreos/command-palette.jsx:128 .cp-foot \u2014
                   3-item flat density on bg-sunken with hairline top border. */
                <div
                  className="flex items-center gap-4 px-4 py-2.5 border-t text-[11px] font-medium text-muted-foreground"
                  style={{ background: "var(--acr-bg-sunken)", borderColor: "var(--acr-line)" }}
                >
                  <span className="inline-flex items-center gap-1"><Kbd size="sm">{"\u2191"}</Kbd><Kbd size="sm">{"\u2193"}</Kbd> navigate</span>
                  <span className="inline-flex items-center gap-1"><Kbd size="sm">{"\u21b5"}</Kbd> {showAIMode ? "ask" : "open"}</span>
                  <span className="inline-flex items-center gap-1"><Kbd size="sm">esc</Kbd> close</span>
                </div>
              )}
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
