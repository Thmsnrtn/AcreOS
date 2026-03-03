import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { telemetry } from "@/lib/telemetry";
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
  { name: "Acquisition Radar", icon: Target, path: "/radar" },
  { name: "Land Credit Score", icon: Shield, path: "/land-credit" },
  { name: "Portfolio Optimizer", icon: BarChart2, path: "/portfolio-optimizer" },
  { name: "AcreOS Valuation Model", icon: TrendingUp, path: "/avm" },
  { name: "Negotiation Copilot", icon: Brain, path: "/negotiation" },
  { name: "Cash Flow Forecaster", icon: Activity, path: "/cash-flow" },
  { name: "Deal Hunter", icon: Search, path: "/deal-hunter" },
  { name: "Vision AI", icon: Eye, path: "/vision-ai" },
  { name: "Capital Markets", icon: DollarSign, path: "/capital-markets" },
  { name: "Market Intelligence", icon: Globe, path: "/market-intelligence" },
  { name: "Compliance AI", icon: ShieldCheck, path: "/compliance" },
  { name: "Tax Researcher", icon: Gavel, path: "/tax-researcher" },
  { name: "Document Intelligence", icon: FileSearch, path: "/document-intelligence" },
  { name: "Marketplace", icon: Store, path: "/marketplace" },
  { name: "Academy", icon: GraduationCap, path: "/academy" },
  { name: "AI Assistant", icon: Bot, path: "/command-center" },
  { name: "Settings", icon: Settings, path: "/settings" },
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
              />
              <CommandList className="max-h-[400px]">
                <CommandEmpty>No results found.</CommandEmpty>

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
              </CommandList>
              <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    ↑↓
                  </kbd>{" "}
                  to navigate
                </span>
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    ↵
                  </kbd>{" "}
                  to select
                </span>
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
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
