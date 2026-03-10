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
  Phone,
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
  { id: "today",         label: "Today",          icon: Home,        href: "/today",          description: "Daily briefing and action queue" },
  { id: "pipeline",      label: "Pipeline",        icon: GitBranch,   href: "/pipeline",       description: "Leads, deals, and properties hub" },
  { id: "money",         label: "Money",           icon: DollarSign,  href: "/money",          description: "Notes, portfolio, and cash flow" },
  { id: "atlas",         label: "Atlas",           icon: Sparkles,    href: "/atlas",          description: "AI assistant and automation" },
  { id: "settings",      label: "Settings",        icon: Settings,    href: "/settings",       description: "Account, billing, and preferences" },
  { id: "leads",         label: "Leads",           icon: Users,       href: "/leads",          description: "Land seller leads CRM" },
  { id: "properties",    label: "Properties",      icon: MapIcon,     href: "/properties",     description: "Property inventory" },
  { id: "deals",         label: "Deals",           icon: Briefcase,   href: "/deals",          description: "Deal pipeline board" },
  { id: "tasks",         label: "Tasks",           icon: ListTodo,    href: "/tasks",          description: "Your action items" },
  { id: "inbox",         label: "Inbox",           icon: Inbox,       href: "/inbox",          description: "Messages and communications" },
  { id: "campaigns",     label: "Campaigns",       icon: Mail,        href: "/campaigns",      description: "Email, SMS, and direct mail" },
  { id: "finance",       label: "Finance",         icon: Banknote,    href: "/finance",        description: "Seller-financed notes and loans" },
  { id: "portfolio",     label: "Portfolio",       icon: PieChart,    href: "/portfolio",      description: "Investment portfolio overview" },
  { id: "analytics",     label: "Analytics",       icon: BarChart3,   href: "/analytics",      description: "Insights and reporting" },
  { id: "automation",    label: "Automation",      icon: Zap,         href: "/automation",     description: "Automated rules and triggers" },
  { id: "workflows",     label: "Workflows",       icon: Workflow,    href: "/workflows",      description: "Complex workflow builder" },
  { id: "command-center",label: "Command Center",  icon: Bot,         href: "/command-center", description: "AI agents and assistants" },
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
  { id: "reseller",             label: "Reseller Dashboard",  icon: Building2,   href: "/reseller",             description: "White-label reseller management" },
  { id: "data-moat",            label: "Data Moat",           icon: Database,    href: "/data-moat",            description: "Proprietary data assets and API keys" },
  { id: "fee-dashboard",        label: "Fee Dashboard",       icon: Percent,     href: "/fee-dashboard",        description: "Transaction fee tracking and revenue" },
  { id: "marketplace-analytics",label: "Marketplace Analytics", icon: BarChart2, href: "/marketplace-analytics",description: "Marketplace performance and metrics" },
  { id: "voice-analytics",      label: "Voice Analytics",     icon: Phone,       href: "/voice-analytics",      description: "Call recording analysis and insights" },
  { id: "va-dashboard",         label: "VA Dashboard",        icon: Users,       href: "/va-dashboard",         description: "Virtual assistant task management" },
];

export const NAV_ITEM_MAP = new Map<string, MasterNavItem>(
  ALL_NAV_ITEMS.map((item) => [item.id, item])
);

export const DEFAULT_SIDEBAR_ITEMS = ["today", "pipeline", "money", "atlas", "settings"];
export const DEFAULT_MOBILE_ITEMS  = ["today", "pipeline", "money", "atlas"];
