import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import type { Lead, Property, Deal } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { telemetry } from "@/lib/telemetry";
import { useProviderStatus } from "@/hooks/use-provider-status";
import { prefetchRoute } from "@/lib/queryClient";
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
  Search,
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
  { name: "Send Email", icon: Mail, action: "send-email", path: "/inbox" },
  { name: "Generate Offer", icon: Sparkles, action: "generate-offer", path: "/offers?generate=true" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      telemetry.featureUsed('command_palette');
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
                placeholder="Search or type a command..."
                data-testid="command-palette-input"
                autoFocus
                onValueChange={(val) => setQuery(val)}
              />
              <CommandList className="max-h-[400px]">
                <CommandEmpty>No results found.</CommandEmpty>

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
                        <CommandShortcut>{`⌘${idx + 1}`}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />

                <CommandGroup heading="Search Results">
                  {(() => {
                    const q = query.trim().toLowerCase();
                    if (!q) return null;
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
                      <CommandShortcut>↵</CommandShortcut>
                    </CommandItem>
                  );
                  })}
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
              </CommandList>
              <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-[6px] font-mono text-[10px] font-medium text-muted-foreground">
                    ↑↓
                  </kbd>{" "}
                  to navigate
                </span>
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-[6px] font-mono text-[10px] font-medium text-muted-foreground">
                    ↵
                  </kbd>{" "}
                  to select
                </span>
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-[6px] font-mono text-[10px] font-medium text-muted-foreground">
                    esc
                  </kbd>{" "}
                  to close
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
