import {
  Home,
  GitBranch,
  DollarSign,
  Sparkles,
  Settings,
  Users,
  Map as MapIcon,
  Briefcase,
  ListTodo,
  Inbox,
  Mail,
  Banknote,
  PieChart,
  BarChart3,
  Zap,
  Bot,
  Activity,
  Calculator,
  FileText,
  HelpCircle,
  Store,
  Workflow,
  MapPin,
  Tag,
  Layers,
  Target,
  Receipt,
  Webhook,
  Share2,
  Brain,
  UserCheck,
  Shield,
  BarChart2,
  Database,
  Percent,
  Building2,
  TrendingUp,
} from "lucide-react";

export interface MasterNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description: string;
}

export const ALL_NAV_ITEMS: MasterNavItem[] = [
  // 2026-05-11 sidebar audit — 7 canonical customer entries.
  // Today / Leads / Properties / Deals / Outreach / Money / Settings.
  // Pipeline is reachable as a Deals view; AI Hub stays as a mobile-nav
  // entry only. Founder-mode surfaces are gated separately under /founder
  // and are NEVER listed in this customer-facing registry.
  { id: "today",         label: "Today",          icon: Home,        href: "/today",          description: "Daily briefing and action queue" },
  { id: "leads",         label: "Leads",           icon: Users,       href: "/leads",          description: "Land seller leads CRM" },
  { id: "properties",    label: "Properties",      icon: MapIcon,     href: "/properties",     description: "Property inventory" },
  { id: "deals",         label: "Deals",           icon: Briefcase,   href: "/deals",          description: "Deal pipeline board" },
  { id: "outreach",      label: "Outreach",        icon: Mail,        href: "/campaigns",      description: "Email, SMS, direct mail, sequences, buyer blasts" },
  { id: "money",         label: "Money",           icon: DollarSign,  href: "/money",          description: "Notes, portfolio, and cash flow" },
  { id: "settings",      label: "Settings",        icon: Settings,    href: "/settings",       description: "Account, billing, and preferences" },
  // Legacy entries — retained in the master map so command-palette,
  // mobile drawer, and existing nav-preferences continue to resolve.
  // Not part of the default sidebar.
  { id: "pipeline",      label: "Pipeline",        icon: GitBranch,   href: "/pipeline",       description: "Leads, deals, and properties hub" },
  { id: "ai-hub",      label: "AI Hub",        icon: Sparkles,    href: "/ai",           description: "AI assistant, agents, and automation" },
  { id: "campaigns",     label: "Campaigns",       icon: Mail,        href: "/campaigns",      description: "Email, SMS, and direct mail" },
  { id: "tasks",         label: "Tasks",           icon: ListTodo,    href: "/tasks",          description: "Your action items" },
  { id: "inbox",         label: "Inbox",           icon: Inbox,       href: "/inbox",          description: "Messages and communications" },
  { id: "finance",       label: "Finance",         icon: Banknote,    href: "/finance",        description: "Seller-financed notes and loans" },
  { id: "portfolio",     label: "Portfolio",       icon: PieChart,    href: "/portfolio",      description: "Investment portfolio overview" },
  { id: "analytics",     label: "Analytics",       icon: BarChart3,   href: "/analytics",      description: "Insights and reporting" },
  { id: "automation",    label: "Automation",      icon: Zap,         href: "/automation",     description: "Automated rules and triggers" },
  { id: "workflows",     label: "Workflows",       icon: Workflow,    href: "/workflows",      description: "Complex workflow builder" },
  { id: "ai-hub-chat",  label: "AI Hub",          icon: Bot,         href: "/ai",            description: "AI assistant, agents, and automation" },
  { id: "activity",      label: "Activity",        icon: Activity,    href: "/activity",       description: "Agent activity log" },
  { id: "tools",         label: "Tools",           icon: Calculator,  href: "/tools",          description: "Calculators and utilities" },
  { id: "documents",     label: "Documents",       icon: FileText,    href: "/documents",      description: "Document storage" },
  { id: "listings",      label: "Listings",        icon: Store,       href: "/listings",       description: "Properties listed for sale" },
  { id: "counties",      label: "Counties",        icon: MapPin,      href: "/counties",       description: "County research and data" },
  { id: "offers",        label: "Offers",          icon: Tag,         href: "/offers",         description: "Offer tracking" },
  { id: "sequences",     label: "Sequences",       icon: Layers,      href: "/sequences",      description: "Follow-up sequences" },
  { id: "help",          label: "Help",            icon: HelpCircle,  href: "/help",           description: "Help and support" },
  // T76-T90 New Feature Pages
  { id: "goals",         label: "Goals & OKRs",    icon: Target,      href: "/goals",          description: "Track organizational goals and KPIs" },
  { id: "tax-optimizer", label: "Tax Optimizer",   icon: Receipt,     href: "/tax-optimizer",  description: "Capital gains and year-end tax planning" },
  { id: "webhooks",      label: "Webhooks",        icon: Webhook,     href: "/webhooks",       description: "Outbound webhook management" },
  { id: "syndication",   label: "Syndication",     icon: Share2,      href: "/syndication",    description: "Publish listings to Land.com, LandWatch, etc." },
  { id: "model-training",label: "Valuation Model", icon: Brain,       href: "/model-training", description: "AcreOS Market Value model training and insights" },
  { id: "investor-network", label: "Investor Network", icon: UserCheck, href: "/investor-network", description: "Verified investor directory and profiles" },
  // Additional Pages
  { id: "avm-bulk",             label: "Bulk AVM",            icon: TrendingUp,  href: "/avm-bulk",             description: "Bulk AI valuations via CSV upload" },
  { id: "marketplace-analytics",label: "Marketplace Analytics", icon: BarChart2, href: "/marketplace-analytics",description: "Marketplace performance and metrics" },
  // voice-analytics removed — AI Voice feature deprecated
  { id: "va-dashboard",         label: "VA Dashboard",        icon: Users,       href: "/va-dashboard",         description: "Virtual assistant task management" },
  // Sovereign Protocol / agent-mesh / reseller / data-moat / fee-dashboard
  // entries removed from the customer-facing master list 2026-05-11. Those
  // surfaces are founder-only and now live exclusively under
  // FounderProtectedRoute in App.tsx — they must never appear in the
  // command palette, mobile drawer, or nav-customizer for customers.
];

export const NAV_ITEM_MAP = new Map<string, MasterNavItem>(
  ALL_NAV_ITEMS.map((item) => [item.id, item])
);

// 2026-05-11 audit — customer sidebar trimmed to 7 canonical entries.
// AI Hub stays on mobile bottom-nav (Today/Deals/Money/AI Hub + More).
export const DEFAULT_SIDEBAR_ITEMS = ["today", "leads", "properties", "deals", "outreach", "money", "settings"];
export const DEFAULT_MOBILE_ITEMS  = ["today", "deals", "money", "ai-hub"];

/**
 * Persona-aware default mobile bottom-nav.
 *
 * The 4-tab default above is a Land-Flipper-shaped set; a Note Investor
 * shouldn't open the app and see a Deals tab as their primary action.
 * This returns the right 4 IDs per persona so brand-new users land on
 * tabs that match their workflow. User-customized prefs (saved in
 * `useNavPreferences`) still override.
 *
 * Persona inputs come from `useContextProfile()`'s `investorType` —
 * see client/src/hooks/use-context-profile.ts.
 */
export function defaultMobileItemsFor(
  investorType:
    | "wholesaler"
    | "note_investor"
    | "fix_and_flip"
    | "portfolio_builder"
    | "auction_hunter"
    | "developer"
    | "new_investor"
    | undefined,
): string[] {
  switch (investorType) {
    case "wholesaler":
      // Wholesalers' day is contracts + EMD timer + buyer blasts.
      return ["today", "deals", "campaigns", "money"];
    case "note_investor":
      // Note investors monitor payments, manage delinquencies, prep taxes.
      // No native "notes" id in nav (yet); finance is the canonical hub.
      return ["today", "finance", "money", "ai-hub"];
    case "fix_and_flip":
      // Rehab projects + properties + deals dominate their day.
      return ["today", "properties", "deals", "money"];
    case "portfolio_builder":
      // Buy-and-hold landlords — rent collection + maintenance.
      // "finance" surfaces rent roll + cash flow until we ship persona-specific tabs.
      return ["today", "properties", "finance", "money"];
    case "auction_hunter":
      // Tax-delinquent auction buyers — counties, properties, deals.
      return ["today", "properties", "deals", "money"];
    case "developer":
      // Subdividers — properties + listings + deals.
      return ["today", "properties", "listings", "money"];
    case "new_investor":
    default:
      // Land Flipper / unknown — the launch vertical default.
      return DEFAULT_MOBILE_ITEMS;
  }
}
