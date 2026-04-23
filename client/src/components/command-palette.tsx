import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import type { Lead as SchemaLead, Property, Deal as SchemaDeal } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { telemetry } from "@/lib/telemetry";
import { queryClient, apiRequest, prefetchRoute } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useProviderStatus } from "@/hooks/use-provider-status";
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
} from "lucide-react";

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
  { value: 'offer_sent', label: 'Offer Sent' },
  { value: 'countered', label: 'Countered' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'in_escrow', label: 'In Escrow' },
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

const quickActions = [
  { name: "New Lead", icon: UserPlus, action: "new-lead", path: "/leads?new=true" },
  { name: "New Property", icon: Home, action: "new-property", path: "/properties?new=true" },
  { name: "New Deal", icon: FileText, action: "new-deal", path: "/deals?new=true" },
  { name: "New Task", icon: ListTodo, action: "new-task", path: "/tasks?action=new" },
  { name: "Send Email", icon: Mail, action: "send-email", path: "/inbox" },
  { name: "Generate Offer", icon: Sparkles, action: "generate-offer", path: "/offers?generate=true" },
];

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
        title: "Error",
        description: "Failed to update lead status",
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
        title: "Error",
        description: "Failed to update deal stage",
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
    (path: string) => {
      // Prefetch common API for the target route for perceived speed
      const prefetchMap: Record<string, string[]> = {
        "/leads": ["/api/leads"],
        "/properties": ["/api/properties"],
        "/deals": ["/api/deals"],
        "/": ["/api/dashboard/stats"],
      };
      (prefetchMap[path] || []).forEach(prefetchRoute);
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 command-backdrop"
            onClick={() => setOpen(false)}
            data-testid="command-palette-backdrop"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -12 }}
            transition={{ type: "spring", stiffness: 500, damping: 32, mass: 0.8 }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-[640px] -translate-x-1/2 p-4"
            data-testid="command-palette-dialog"
          >
            <Command className="glass-panel floating-window overflow-hidden rounded-xl border" shouldFilter={!showAIMode}>
              <div className="relative">
                <CommandInput
                  ref={inputRef}
                  placeholder={showAIMode ? "Ask me anything about your real estate business..." : "Search pages, actions, or type a question..."}
                  value={inputValue}
                  onValueChange={(val) => { setInputValue(val); setSearch(val); setQuery(val); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && showAIMode) {
                      e.preventDefault();
                      handleAISubmit();
                    }
                  }}
                  data-testid="command-palette-input"
                  autoFocus
                />
                {showAIMode && (
                  <button
                    onClick={handleAISubmit}
                    disabled={aiMutation.isPending || !inputValue.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
                  >
                    {aiMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>

              {/* AI Mode Hint */}
              {!showAIMode && inputValue.length === 0 && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  <span>Start with <span className="font-mono bg-muted px-1 rounded">?</span> or ask a question for AI assistance</span>
                </div>
              )}

              {/* AI Response Panel */}
              {showAIMode && (
                <div className="px-4 py-3 border-b">
                  {aiMutation.isPending && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  )}
                  {aiResponse && !aiMutation.isPending && (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <p className="text-sm leading-relaxed">{aiResponse.reply}</p>
                      </div>
                      {aiResponse.actionPath && aiResponse.actionLabel && (
                        <button
                          onClick={() => handleSelect(aiResponse.actionPath!)}
                          className="ml-6 text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <span>{"\u2192"}</span>
                          <span>{aiResponse.actionLabel}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {!aiResponse && !aiMutation.isPending && (
                    <p className="text-xs text-muted-foreground">Press Enter or click the send button to ask</p>
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
                            <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4 text-muted-foreground" />
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
                            <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4 text-muted-foreground" />
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

                    {/* Search Results (leads, properties, deals) */}
                    {query.trim().length > 0 && (
                      <CommandGroup heading="Search Results">
                        {(() => {
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
                          const results = [...leadMatches, ...propertyMatches, ...dealMatches].slice(0, 8);
                          return results.length ? results.map(r => (
                            <CommandItem key={r.path} onSelect={() => handleSelect(r.path)} className="cursor-pointer">
                              <Search className="mr-2 h-4 w-4 text-muted-foreground" />
                              <span>{r.name}</span>
                            </CommandItem>
                          )) : <CommandItem disabled>No matches</CommandItem>;
                        })()}
                      </CommandGroup>
                    )}

                    {/* Contextual Lead Actions */}
                    {matchingLeads.length > 0 && (
                      <>
                        <CommandGroup heading="Leads - Quick Actions">
                          {matchingLeads.map((lead) => (
                            <CommandItem
                              key={`lead-action-${lead.id}`}
                              onSelect={() => setSelectedLeadId(lead.id)}
                              className="cursor-pointer"
                              data-testid={`command-lead-${lead.id}`}
                            >
                              <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                              <div className="flex flex-col">
                                <span>{lead.firstName} {lead.lastName}</span>
                                <span className="text-xs text-muted-foreground capitalize">
                                  {lead.status} {lead.phone && `\u00b7 ${lead.phone}`}
                                </span>
                              </div>
                              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    {/* Contextual Deal Actions */}
                    {matchingDeals.length > 0 && (
                      <>
                        <CommandGroup heading="Deals - Quick Actions">
                          {matchingDeals.map((deal) => (
                            <CommandItem
                              key={`deal-action-${deal.id}`}
                              onSelect={() => setSelectedDealId(deal.id)}
                              className="cursor-pointer"
                              data-testid={`command-deal-${deal.id}`}
                            >
                              <Handshake className="mr-2 h-4 w-4 text-muted-foreground" />
                              <div className="flex flex-col">
                                <span>
                                  {deal.property?.county ? `${deal.property.county}, ${deal.property.state}` : deal.type}
                                </span>
                                <span className="text-xs text-muted-foreground capitalize">
                                  {deal.type} {"\u00b7"} {deal.status.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    {isFounder && (
                      <>
                        <CommandGroup heading="Founder / Admin">
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            data-testid="command-item-founder-dashboard"
                            className="cursor-pointer"
                          >
                            <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                            <span>Open Founder Dashboard</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/analytics")}
                            data-testid="command-item-system-health"
                            className="cursor-pointer"
                          >
                            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>View System Health</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/finance")}
                            data-testid="command-item-credits"
                            className="cursor-pointer"
                          >
                            <DollarSign className="mr-2 h-4 w-4 text-green-600" />
                            <span>Open Credits & Costs</span>
                          </CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    <CommandGroup heading="Pages">
                      {pages.map((page, idx) => (
                        <CommandItem
                          key={page.path}
                          onSelect={() => handleSelect(page.path)}
                          onMouseEnter={() => ( {"/": ["/api/dashboard/stats"], "/leads": ["/api/leads"], "/properties": ["/api/properties"], "/deals": ["/api/deals"] }[page.path] || []).forEach(prefetchRoute)}
                          data-testid={`command-item-${page.name.toLowerCase().replace(/\s+/g, "-")}`}
                          className="cursor-pointer"
                        >
                          <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>{page.name}</span>
                          {idx < 9 && (
                            <CommandShortcut>{`\u2318${idx + 1}`}</CommandShortcut>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>

                    <CommandSeparator />

                    <CommandGroup heading="Quick Actions">
                      {quickActions.map((action) => {
                        const requiresAI = action.action === 'generate-offer';
                        const disabled = requiresAI && !isAvailable('ai');
                        return (
                          <CommandItem
                            key={action.action}
                            onSelect={() => !disabled && handleSelect(action.path)}
                            data-testid={`command-item-${action.name.toLowerCase().replace(/\s+/g, "-")}`}
                            className="cursor-pointer"
                            disabled={disabled}
                          >
                            <action.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>{action.name}{disabled ? ' (AI unavailable)' : ''}</span>
                            <CommandShortcut>{"\u21b5"}</CommandShortcut>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>

                    {/* "Ask Your Team" exposes founder-internal agent
                        codenames (Forge, Sophie, Sentinel, ...) and routes
                        to /founder/*. Gated to the founder only; customers
                        should never see these names — their AI is Pax. */}
                    {isFounder && (
                      <>
                        <CommandSeparator />
                        <CommandGroup heading="Ask Your Team">
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-emerald-500" />
                            <span>How's revenue doing?</span>
                            <span className="ml-auto text-xs text-muted-foreground">Forge</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-amber-500" />
                            <span>Any support issues?</span>
                            <span className="ml-auto text-xs text-muted-foreground">Sophie</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-blue-500" />
                            <span>Is anything broken?</span>
                            <span className="ml-auto text-xs text-muted-foreground">Sentinel</span>
                          </CommandItem>
                          <CommandItem
                            onSelect={() => handleSelect("/founder")}
                            className="cursor-pointer"
                          >
                            <MessageSquare className="mr-2 h-4 w-4 text-purple-500" />
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
                              <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
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
                <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                  <span><Kbd size="sm">{"\u2191\u2193"}</Kbd> navigate</span>
                  <span><Kbd size="sm">{"\u21b5"}</Kbd> {showAIMode ? "ask AI" : "select"}</span>
                  <span><Kbd size="sm">{"\u2318K"}</Kbd> toggle</span>
                  <span><Kbd size="sm">esc</Kbd> close</span>
                </div>
              )}
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
