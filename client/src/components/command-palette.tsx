import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { telemetry } from "@/lib/telemetry";
import { apiRequest } from "@/lib/queryClient";
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
  Loader2,
  Send,
  MessageSquare,
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
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: recentItemsData } = useQuery<RecentItemsResponse>({
    queryKey: ["/api/recent-items"],
    enabled: open,
  });

  const aiMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", "/api/realtime/ask", { message: question });
      return res.json() as Promise<AIResponse>;
    },
    onSuccess: (data) => {
      setAiResponse(data);
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
      } else {
        setOpen(false);
      }
    }
  }, [open, aiMode]);

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
            <Command className="glass-panel floating-window overflow-hidden rounded-xl border" shouldFilter={!showAIMode}>
              <div className="relative">
                <CommandInput
                  ref={inputRef}
                  placeholder={showAIMode ? "Ask me anything about your land business..." : "Search pages, actions, or type a question..."}
                  value={inputValue}
                  onValueChange={setInputValue}
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
                          <span>→</span>
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

              <CommandList className="max-h-[360px]">
                {!showAIMode && (
                  <>
                    <CommandEmpty>No results found. Start with "?" to ask AI.</CommandEmpty>

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
                  {showAIMode ? "ask AI" : "select"}
                </span>
                <span>
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    esc
                  </kbd>{" "}
                  close
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
