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
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { motion, AnimatePresence } from "framer-motion";
import { useRespectfulTransition } from "@/lib/motion-tokens";
import type { Lead as SchemaLead, Property, Deal as SchemaDeal } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { usePersonaMode } from "@/hooks/use-persona-mode";
import { telemetry } from "@/lib/telemetry";
import { queryClient, apiRequest, prefetchRoute, fetchJsonArray } from "@/lib/queryClient";
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
import { ALL_NAV_ITEMS, type MasterNavItem } from "@/lib/nav-items";
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
  Shield,
  BarChart2,
  Store,
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
  Lightbulb,
  ListChecks,
  User,
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

// IA consolidation (Lens 4 Fix 2): the page-destination list is now
// derived from ALL_NAV_ITEMS (client/src/lib/nav-items.ts), the same
// canonical registry that drives the sidebar/mobile-drawer/customizer.
// One source of truth — no more drift between the palette and the rest
// of the nav surfaces. Each MasterNavItem already carries label + icon
// + href + description, so the palette's "Pages" group is a pure map.
//
// Extras beyond ALL_NAV_ITEMS — these are deep destinations the palette
// historically exposed that don't appear in the customer sidebar but
// are still navigable verbs (parcel maps, valuations, etc.). Kept as a
// supplementary list so removing them from nav-items.ts doesn't strand
// muscle-memory.
//
// REMOVED 2026-05-27 per Lens 4:
//   - "Acquisition Radar" (/radar)         → redirect to /deals/discover
//   - "Deal Hunter" (/deal-hunter)         → redirect to /deals/discover
//   - "Negotiation Copilot" (/negotiation) → behind FlaggedRoute, not in
//     customer nav; keep only as a verb if/when a verb registry adds it
//   - "Cash Flow Forecaster" (/cash-flow)  → reachable via /money sidebar
//   - "Finance"                            → ambiguous; /money is the canonical
//                                            customer surface, /finance is the
//                                            notes-and-loans hub already in nav
const palettePageIcon: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  // Override a couple of icons for visual continuity with the prior
  // hand-curated palette (e.g. dashboard icon for the today hub).
  today: LayoutDashboard,
};
function navItemToPage(item: MasterNavItem) {
  const Icon = palettePageIcon[item.id] ?? item.icon;
  return { name: item.label, icon: Icon as typeof Users, path: item.href };
}
// Surfaces beyond ALL_NAV_ITEMS that the palette has historically exposed.
// Each one has a real <Route> in App.tsx; keeping them here means typing
// "AVM" or "Vision AI" still resolves even though they're not in the
// 7-item customer sidebar.
const PALETTE_EXTRAS: Array<{ name: string; icon: typeof Users; path: string }> = [
  { name: "Valuation Model (AVM)", icon: TrendingUp, path: "/avm" },
  { name: "Vision AI", icon: Eye, path: "/vision-ai" },
  { name: "Capital Markets", icon: DollarSign, path: "/capital-markets" },
  { name: "Market Intelligence", icon: Globe, path: "/market-intelligence" },
  { name: "Compliance AI", icon: ShieldCheck, path: "/compliance" },
  { name: "Tax Researcher", icon: Gavel, path: "/tax-researcher" },
  { name: "Document Intelligence", icon: FileSearch, path: "/document-intelligence" },
  { name: "Property Map", icon: Map, path: "/maps" },
  { name: "Marketplace", icon: Store, path: "/marketplace" },
  { name: "Land Credit Score", icon: Shield, path: "/land-credit" },
  { name: "Portfolio Optimizer", icon: BarChart2, path: "/portfolio-optimizer" },
];
// Deduplicate by path: ALL_NAV_ITEMS contains multiple ids pointing at
// the same href (e.g. `ai-hub` and `ai-hub-chat` both → /ai).
const seenPaths = new Set<string>();
const pages = [
  ...ALL_NAV_ITEMS.map(navItemToPage),
  ...PALETTE_EXTRAS,
].filter((p) => {
  if (seenPaths.has(p.path)) return false;
  seenPaths.add(p.path);
  return true;
});

// Founder-only "Pages" — surfaced when isFounder is true. Mirrors the
// Founder scope chip's destinations.
const FOUNDER_PAGES: Array<{ name: string; icon: typeof Users; path: string }> = [
  { name: "Founder — Bridge", icon: LayoutDashboard, path: "/founder/bridge" },
  { name: "Founder — Steering", icon: TrendingUp, path: "/founder/steering" },
  { name: "Founder — Studio", icon: Settings, path: "/founder/studio" },
  { name: "Founder — Inspector", icon: Search, path: "/founder/inspector/audit" },
  { name: "Founder — Decisions", icon: Shield, path: "/founder/decisions" },
  { name: "Founder — Monthly letter", icon: FileText, path: "/founder/letter" },
  { name: "Founder — Strategy", icon: Brain, path: "/founder/strategy" },
  { name: "Founder — CMO", icon: Megaphone, path: "/founder/cmo" },
  { name: "Founder — Customer health", icon: Activity, path: "/founder/customers/health" },
  { name: "Founder — Recovery console", icon: ShieldCheck, path: "/founder/recovery-console" },
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
  // Respect prefers-reduced-motion for backdrop fade + palette spring.
  const backdropFade = useRespectfulTransition({ duration: 0.18 });
  const paletteSpring = useRespectfulTransition({ type: "spring", stiffness: 500, damping: 32, mass: 0.8 });
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

  // /api/leads /api/properties /api/deals all return paginated
  // envelopes {data, total, page, pageSize, totalPages}. Bare useQuery
  // here previously yielded the envelope object — every downstream
  // .filter / .find call (matchingLeads, selectedLead etc.) crashed
  // when the founder typed in the command palette. Normalize via
  // fetchJsonArray so the data is always an array. (2026-05-26)
  const { data: leadsData = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"], enabled: open,
    queryFn: () => fetchJsonArray<Lead>("/api/leads?pageSize=100"),
  });
  const { data: propertiesData = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"], enabled: open,
    queryFn: () => fetchJsonArray<Property>("/api/properties?pageSize=100"),
  });
  const { data: dealsData = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals"], enabled: open,
    queryFn: () => fetchJsonArray<Deal>("/api/deals?pageSize=100"),
  });

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

  // ── Founder intelligence search (IA consolidation Lens 4 Fix 3) ──────
  // Folded in from the ex-FounderCommandPalette (⌘⇧K). Hits the
  // founder-only /api/founder/intelligence/search endpoint to surface
  // decisions, agents, customer orgs, monthly letters, and strategic
  // proposals. Gated by isFounder — non-founder users never get the
  // query enabled, and the founder-only UI groups below are also
  // hidden behind the same flag.
  type FounderDecisionHit = { id: number; label: string; itemType: string; status: string; agent: string | null };
  type FounderAgentHit = { codename: string; title: string; wing: string; trustScore: number };
  type FounderOrgHit = { id: number; name: string; slug: string; subscriptionTier: string; subscriptionStatus: string };
  type FounderLetterHit = { monthKey: string; status: string };
  type FounderProposalHit = { id: number; title: string; category: string; status: string; proposedBy: string; monthKey: string | null };
  type FounderSearchResponse = {
    groups: Array<
      | { key: "decisions"; label: string; items: FounderDecisionHit[] }
      | { key: "agents"; label: string; items: FounderAgentHit[] }
      | { key: "organizations"; label: string; items: FounderOrgHit[] }
      | { key: "letters"; label: string; items: FounderLetterHit[] }
      | { key: "proposals"; label: string; items: FounderProposalHit[] }
    >;
  };
  const { data: founderSearchData } = useQuery<FounderSearchResponse>({
    queryKey: ["/api/founder/intelligence/search", search],
    enabled: open && isFounder && search.trim().length >= 2,
    staleTime: 5_000,
    queryFn: async () => {
      const r = await fetch(
        `/api/founder/intelligence/search?q=${encodeURIComponent(search.trim())}`,
        { credentials: "include" },
      );
      if (!r.ok) return { groups: [] };
      return r.json();
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
  //
  // When activeScope is "founder" we narrow to FOUNDER_PAGES so the
  // chip filters cleanly to founder-only destinations.
  const matchedPages = useMemo(() => {
    if (activeScope === "founder") {
      if (!isFounder) return [];
      const items = FOUNDER_PAGES.map((p) => ({
        id: `page:${p.path}`,
        title: p.name,
        kind: "page" as const,
        page: p,
      }));
      if (!matcherQuery.trim()) return rankItems("", items, { recents, keepAll: true }).slice(0, 10);
      return rankItems(matcherQuery, items, { recents }).slice(0, 8);
    }
    if (activeScope && activeScope !== "settings") return []; // pages list is the cross-cutting nav surface
    const items = pages.map((p) => ({
      id: `page:${p.path}`,
      title: p.name,
      kind: "page" as const,
      page: p,
    }));
    if (!matcherQuery.trim()) return [];
    return rankItems(matcherQuery, items, { recents }).slice(0, 6);
  }, [matcherQuery, activeScope, recents, isFounder]);

  // ── Founder inspector shortcuts (IA consolidation Lens 4 Fix 3) ──────
  // "lob" → provider page, "org #12" → org cost tab, "#12345" → cost
  // event provenance. Pattern-matched against the raw query (not the
  // remainder), so the founder doesn't need the :founder chip to
  // resolve a provider/org/ledger reference quickly.
  const founderInspectorHits = useMemo(() => {
    if (!isFounder) return null;
    const trimmed = matcherQuery.trim().toLowerCase();
    if (!trimmed) return null;
    const SUPPORTED_PROVIDERS = [
      "lob", "postgrid", "twilio", "telnyx", "sendgrid", "ses",
      "openrouter", "anthropic", "openai", "elevenlabs",
      "stripe", "sentry", "fly", "neon",
    ];
    return {
      provider: SUPPORTED_PROVIDERS.find((p) => p === trimmed) ?? null,
      orgId: /^org[ #]+(\d+)$/.exec(trimmed)?.[1] ?? null,
      ledgerId: /^#?(\d{4,})$/.exec(trimmed)?.[1] ?? null,
    };
  }, [matcherQuery, isFounder]);

  // Persona toggle (folded in from ex-FounderCommandPalette). Cmd+; is
  // still the global shortcut wired in App.tsx; this CommandItem is
  // discoverable from the palette so first-time founders find it.
  const { mode: personaMode, setMode: setPersonaMode } = usePersonaMode();

  const aiMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", "/api/realtime/ask", { message: question });
      return res.json() as Promise<AIResponse>;
    },
    onSuccess: (data) => {
      setAiResponse(data);
    },
  });

  // Mutation for updating lead status — optimistic so the palette
  // close + toast fire instantly, with a rollback on server reject.
  const updateLeadMutation = useOptimisticUpdate<{ id: number; status: string }>(
    {
      mutationFn: async ({ id, status }) => {
        const res = await apiRequest("PUT", `/api/leads/${id}`, { status });
        if (!res.ok) throw new Error("Failed to update lead");
        return res.json();
      },
      listKeys: [["/api/leads"]],
      detailKey: ({ id }) => ["/api/leads", id],
      getId: ({ id }) => id,
      buildPatch: ({ status }) => ({ status }),
      extraInvalidateKeys: [["/api/recent-items"]],
    },
    {
      onSuccess: (_, variables) => {
        const statusLabel = leadStatuses.find(s => s.value === variables.status)?.label || variables.status;
        toast({
          title: "Lead updated",
          description: `Status changed to ${statusLabel}`,
        });
        telemetry.actionCompleted('command_palette_lead_status_update', { newStatus: variables.status });
        setSelectedLeadId(null);
        setOpen(false);
      },
    },
  );

  // Mutation for updating deal stage — optimistic with rollback.
  const updateDealMutation = useOptimisticUpdate<{ id: number; status: string }>(
    {
      mutationFn: async ({ id, status }) => {
        const res = await apiRequest("PUT", `/api/deals/${id}`, { status });
        if (!res.ok) throw new Error("Failed to update deal");
        return res.json();
      },
      listKeys: [["/api/deals"]],
      detailKey: ({ id }) => ["/api/deals", id],
      getId: ({ id }) => id,
      buildPatch: ({ status }) => ({ status }),
      extraInvalidateKeys: [["/api/recent-items"]],
    },
    {
      onSuccess: (_, variables) => {
        const stageLabel = dealStages.find(s => s.value === variables.status)?.label || variables.status;
        toast({
          title: "Deal updated",
          description: `Stage changed to ${stageLabel}`,
        });
        telemetry.actionCompleted('command_palette_deal_stage_update', { newStage: variables.status });
        setSelectedDealId(null);
        setOpen(false);
      },
    },
  );

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
            transition={backdropFade}
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
            transition={paletteSpring}
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
                    className="px-2 py-0.5 rounded-full text-caption font-medium"
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
                    <span className="text-micro uppercase tracking-wider opacity-70">Scope:</span>
                    {/* IA consolidation (Lens 4 Fix 3): the "founder"
                        scope is the merged ⌘⇧K palette folded in here;
                        gate it on isFounder so non-founder users never
                        see the chip. */}
                    {VALID_SCOPES.filter((s) => s !== "founder" || isFounder).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { const v = `:${s} `; setInputValue(v); setSearch(v); setQuery(v); }}
                        className="font-mono text-micro px-1 rounded bg-muted hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

                    {/* Persona toggle (folded in from ex-FounderCommandPalette).
                        Always shown for founders since it's the #1 nav
                        pain — Cmd+; is the keyboard shortcut, but the
                        palette item makes it discoverable. */}
                    {isFounder && (
                      <CommandGroup heading="Switch mode">
                        <CommandItem
                          onSelect={() => {
                            const next = personaMode === "founder" ? "customer" : "founder";
                            setOpen(false);
                            setInputValue("");
                            setSearch("");
                            setPersonaMode(next);
                          }}
                          data-testid="palette-persona-toggle"
                          className="cursor-pointer"
                        >
                          <User className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <div className="flex flex-col min-w-0">
                            <span>{personaMode === "founder" ? "Switch to customer mode" : "Switch to founder mode"}</span>
                            <span className="text-caption text-muted-foreground">
                              {personaMode === "founder" ? "/today" : "/founder/bridge"}
                            </span>
                          </div>
                          <CommandShortcut>{"⌘;"}</CommandShortcut>
                        </CommandItem>
                      </CommandGroup>
                    )}

                    {/* Inspector shortcuts (folded in from ex-FounderCommandPalette).
                        "lob" → provider page, "org #12" → org cost tab,
                        "#12345" → cost-event provenance. */}
                    {isFounder && founderInspectorHits && (founderInspectorHits.provider || founderInspectorHits.orgId || founderInspectorHits.ledgerId) && (
                      <>
                        <CommandGroup heading="Inspector shortcuts">
                          {founderInspectorHits.provider && (
                            <CommandItem
                              onSelect={() => handleSelect(`/founder/inspector/provider/${founderInspectorHits.provider}`)}
                              data-testid={`palette-provider-${founderInspectorHits.provider}`}
                              className="cursor-pointer"
                            >
                              <ListChecks className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <div className="flex flex-col min-w-0">
                                <span>Provider audit: {founderInspectorHits.provider}</span>
                                <span className="text-caption text-muted-foreground">/founder/inspector/provider/{founderInspectorHits.provider}</span>
                              </div>
                            </CommandItem>
                          )}
                          {founderInspectorHits.orgId && (
                            <CommandItem
                              onSelect={() => handleSelect(`/founder/inspector/org/${founderInspectorHits.orgId}`)}
                              data-testid={`palette-org-${founderInspectorHits.orgId}`}
                              className="cursor-pointer"
                            >
                              <Building2 className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <div className="flex flex-col min-w-0">
                                <span>Org #{founderInspectorHits.orgId} — Cost tab</span>
                                <span className="text-caption text-muted-foreground">/founder/inspector/org/{founderInspectorHits.orgId}</span>
                              </div>
                            </CommandItem>
                          )}
                          {founderInspectorHits.ledgerId && (
                            <CommandItem
                              onSelect={() => handleSelect(`/founder/inspector/cost-event/${founderInspectorHits.ledgerId}`)}
                              data-testid={`palette-cost-event-${founderInspectorHits.ledgerId}`}
                              className="cursor-pointer"
                            >
                              <ListChecks className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <div className="flex flex-col min-w-0">
                                <span>Cost event #{founderInspectorHits.ledgerId}</span>
                                <span className="text-caption text-muted-foreground">/founder/inspector/cost-event/{founderInspectorHits.ledgerId}</span>
                              </div>
                            </CommandItem>
                          )}
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    {/* Founder intelligence search (folded in from
                        ex-FounderCommandPalette). Decisions / agents /
                        organizations / monthly letters / strategic
                        proposals — gated by isFounder. */}
                    {isFounder && founderSearchData?.groups?.map((g) => {
                      if (g.key === "decisions") {
                        return (
                          <CommandGroup key={`founder-${g.key}`} heading={g.label}>
                            {g.items.map((d) => (
                              <CommandItem
                                key={`fd-${d.id}`}
                                onSelect={() => handleSelect(`/founder/decisions?id=${d.id}`)}
                                data-testid={`palette-decision-${d.id}`}
                                className="cursor-pointer"
                              >
                                <ListChecks className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate">{d.label}</span>
                                  <span className="text-caption text-muted-foreground">{d.agent ?? "agent"} · {d.itemType} · {d.status}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        );
                      }
                      if (g.key === "agents") {
                        return (
                          <CommandGroup key={`founder-${g.key}`} heading={g.label}>
                            {g.items.map((a) => (
                              <CommandItem
                                key={`fa-${a.codename}`}
                                onSelect={() => handleSelect(`/founder/agents/${a.codename}`)}
                                data-testid={`palette-agent-${a.codename}`}
                                className="cursor-pointer"
                              >
                                <Brain className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <div className="flex flex-col min-w-0">
                                  <span>{a.title} <span className="text-caption text-muted-foreground font-mono">({a.codename})</span></span>
                                  <span className="text-caption text-muted-foreground">{a.wing} wing · trust {a.trustScore}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        );
                      }
                      if (g.key === "organizations") {
                        return (
                          <CommandGroup key={`founder-${g.key}`} heading={g.label}>
                            {g.items.map((o) => (
                              <CommandItem
                                key={`fo-${o.id}`}
                                onSelect={() => handleSelect(`/founder/inspector/org/${o.id}`)}
                                data-testid={`palette-org-${o.id}`}
                                className="cursor-pointer"
                              >
                                <Building2 className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate">{o.name}</span>
                                  <span className="text-caption text-muted-foreground">{o.slug} · {o.subscriptionTier} / {o.subscriptionStatus}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        );
                      }
                      if (g.key === "letters") {
                        return (
                          <CommandGroup key={`founder-${g.key}`} heading={g.label}>
                            {g.items.map((l) => (
                              <CommandItem
                                key={`fl-${l.monthKey}`}
                                onSelect={() => handleSelect(`/founder/letter`)}
                                data-testid={`palette-letter-${l.monthKey}`}
                                className="cursor-pointer"
                              >
                                <FileText className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <div className="flex flex-col min-w-0">
                                  <span>{l.monthKey}</span>
                                  <span className="text-caption text-muted-foreground">{l.status}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        );
                      }
                      if (g.key === "proposals") {
                        return (
                          <CommandGroup key={`founder-${g.key}`} heading={g.label}>
                            {g.items.map((p) => (
                              <CommandItem
                                key={`fp-${p.id}`}
                                onSelect={() => handleSelect(`/founder/letter`)}
                                data-testid={`palette-proposal-${p.id}`}
                                className="cursor-pointer"
                              >
                                <Lightbulb className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate">{p.title}</span>
                                  <span className="text-caption text-muted-foreground">{p.proposedBy} · {p.category} · {p.status}{p.monthKey ? ` · ${p.monthKey}` : ""}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        );
                      }
                      return null;
                    })}

                    {isFounder && (
                      <>
                        <CommandGroup heading="Founder / admin">
                          <CommandItem
                            onSelect={() => handleSelect("/founder/bridge")}
                            data-testid="command-item-founder-dashboard"
                            className="cursor-pointer"
                          >
                            <Sparkles className="mr-2 h-4 w-4 text-acr-warn" aria-hidden="true" />
                            <span>Open founder home</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder/telemetry")}
                            data-testid="command-item-system-health"
                            className="cursor-pointer"
                          >
                            <Clock className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <span>View system health</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder/ai-costs")}
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
                  className="flex items-center gap-4 px-4 py-2.5 border-t text-caption font-medium text-muted-foreground"
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
