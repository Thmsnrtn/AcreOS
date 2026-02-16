import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { telemetry } from "@/lib/telemetry";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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
  { name: "Settings", icon: Settings, path: "/settings" },
  { name: "AI Assistant", icon: Bot, path: "/command-center" },
];

const quickActions = [
  { name: "New Lead", icon: UserPlus, action: "new-lead", path: "/leads?new=true" },
  { name: "New Property", icon: Home, action: "new-property", path: "/properties?new=true" },
  { name: "New Deal", icon: FileText, action: "new-deal", path: "/deals?new=true" },
  { name: "New Task", icon: ListTodo, action: "new-task", path: "/tasks?action=new" },
  { name: "Send Email", icon: Mail, action: "send-email", path: "/inbox" },
  { name: "Generate Offer", icon: Sparkles, action: "generate-offer", path: "/offers?generate=true" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: recentItemsData } = useQuery<RecentItemsResponse>({
    queryKey: ["/api/recent-items"],
    enabled: open,
  });

  // Fetch leads for contextual actions (only when searching)
  const { data: leadsData } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    enabled: open && search.length > 0,
  });

  // Fetch deals for contextual actions (only when searching)
  const { data: dealsData } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    enabled: open && search.length > 0,
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
    }
    if (e.key === "Escape") {
      if (selectedLeadId || selectedDealId) {
        setSelectedLeadId(null);
        setSelectedDealId(null);
      } else {
        setOpen(false);
      }
    }
  }, [selectedLeadId, selectedDealId]);

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
      setOpen(false);
      setLocation(path);
    },
    [setLocation]
  );

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
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            data-testid="command-palette-backdrop"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-[640px] -translate-x-1/2 -translate-y-1/2 p-4"
            data-testid="command-palette-dialog"
          >
            <Command className="glass-panel floating-window overflow-hidden rounded-xl border">
              <CommandInput
                placeholder={selectedLeadId ? "Choose new status..." : selectedDealId ? "Choose new stage..." : "Search or type a command..."}
                data-testid="command-palette-input"
                autoFocus
                value={search}
                onValueChange={setSearch}
              />
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
                      Press <kbd className="mx-1 px-1.5 py-0.5 rounded border bg-muted font-mono text-[10px]">esc</kbd> to go back
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
                      Press <kbd className="mx-1 px-1.5 py-0.5 rounded border bg-muted font-mono text-[10px]">esc</kbd> to go back
                    </div>
                  </>
                )}

                {/* Main palette content (hidden when in sub-menu) */}
                {!selectedLeadId && !selectedDealId && (
                  <>
                    <CommandEmpty>
                      <div className="flex flex-col items-center gap-2 py-4">
                        <Keyboard className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No results found</p>
                        <p className="text-xs text-muted-foreground/70">
                          Try searching for a lead, deal, or page name
                        </p>
                      </div>
                    </CommandEmpty>

                    {/* Contextual Lead Actions */}
                    {matchingLeads.length > 0 && (
                      <>
                        <CommandGroup heading="Leads – Quick Actions">
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
                                  {lead.status} {lead.phone && `· ${lead.phone}`}
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
                        <CommandGroup heading="Deals – Quick Actions">
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
                                  {deal.type} · {deal.status.replace('_', ' ')}
                                </span>
                              </div>
                              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        <CommandSeparator />
                      </>
                    )}

                    <CommandGroup heading="Pages">
                  {pages.map((page) => (
                    <CommandItem
                      key={page.path}
                      onSelect={() => handleSelect(page.path)}
                      data-testid={`command-item-${page.name.toLowerCase().replace(/\s+/g, "-")}`}
                      className="cursor-pointer"
                    >
                      <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{page.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />

                <CommandGroup heading="Quick Actions">
                  {quickActions.map((action) => (
                    <CommandItem
                      key={action.action}
                      onSelect={() => handleSelect(action.path)}
                      data-testid={`command-item-${action.name.toLowerCase().replace(/\s+/g, "-")}`}
                      className="cursor-pointer"
                    >
                      <action.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{action.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>

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
                  <span>
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      ↑↓
                    </kbd>{" "}
                    navigate
                  </span>
                  <span>
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      ↵
                    </kbd>{" "}
                    select
                  </span>
                  <span>
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      ⌘K
                    </kbd>{" "}
                    toggle
                  </span>
                  <span>
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      esc
                    </kbd>{" "}
                    close
                  </span>
                </div>
              )}
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
