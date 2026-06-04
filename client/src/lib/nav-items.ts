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
  // Phase 4 of the Solene migration — icons used by FOUNDER_NAV_NEW_5_DOORS
  // and FOUNDER_NAV_DEEP_DIVES below. Keep with the main lucide import block
  // so dead-import linters don't strip them when only the founder consts
  // reference them.
  Sun,
  Heart,
  Hammer,
  Cog,
  FileCode,
  History,
  Crown,
  Lightbulb,
  CheckCircle2,
  Rocket,
  FlaskConical,
  Wrench,
  Eye,
  LifeBuoy,
  Megaphone,
  Workflow as WorkflowIcon,
  Key,
  ListChecks,
  Search,
  Sliders,
} from "lucide-react";
import type { Persona } from "@shared/models/auth";

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
  { id: "money",         label: "Finance",         icon: DollarSign,  href: "/money",          description: "Notes, portfolio, cash flow, and capital markets" },
  { id: "settings",      label: "Settings",        icon: Settings,    href: "/settings",       description: "Account, billing, and preferences" },
  // Legacy entries — retained in the master map so command-palette,
  // mobile drawer, and existing nav-preferences continue to resolve.
  // Not part of the default sidebar.
  { id: "pipeline",      label: "Pipeline",        icon: GitBranch,   href: "/pipeline",       description: "Leads, deals, and properties hub" },
  { id: "map",           label: "Map",             icon: MapIcon,     href: "/maps",           description: "Interactive parcel map — discovery & comps" },
  { id: "ai-hub",        label: "Pax",             icon: Sparkles,    href: "/ai",             description: "Pax — your AI assistant" },
  { id: "campaigns",     label: "Campaigns",       icon: Mail,        href: "/campaigns",      description: "Email, SMS, and direct mail" },
  { id: "tasks",         label: "Tasks",           icon: ListTodo,    href: "/tasks",          description: "Your action items" },
  { id: "inbox",         label: "Inbox",           icon: Inbox,       href: "/inbox",          description: "Messages and communications" },
  { id: "finance",       label: "Note Ledger",     icon: Banknote,    href: "/finance",        description: "Seller-financed notes and loans (also the Notes tab under Finance)" },
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

// 2026-05-29 — customer sidebar aligned to the five fixed doors
// (Today · Map · Deals · Finance · Pax) + Inbox + Settings. "money" is the
// Finance door; "ai-hub" is the Pax door. Persona changes only the content
// behind each door, never the doors themselves (see MOBILE_DOORS).
export const DEFAULT_SIDEBAR_ITEMS = ["today", "map", "deals", "money", "ai-hub", "inbox", "settings"];
// 2026-05-29 — restored the mobile bottom nav to the surfaces founders expect
// (Today / Inbox / Pipeline / Portfolio), reachable directly instead of nested
// under the consolidated Deals/Money tabs. Everything else lives in the More
// drawer. The 5th slot is the More button (see MobileBottomNav).
export const DEFAULT_MOBILE_ITEMS  = ["today", "inbox", "pipeline", "portfolio"];

// The five canonical "doors" — the same for every persona on every device
// (design-review decision 2026-05-29). Persona changes the CONTENT behind each
// door (persona-gated sections, vocabulary, Finance tabs), never the doors
// themselves. The mobile bottom nav renders exactly these; Inbox/Settings and
// the long tail are reached from the top bar (Search/⌘K) + the More drawer.
//   Today · Map · Deals · Finance(money) · Pax(ai-hub)
export const MOBILE_DOORS = ["today", "map", "deals", "money", "ai-hub"];

/**
 * Persona-aware default mobile bottom-nav, keyed on the user's RELIABLE
 * `persona` field (shared/models/auth.ts Persona) — the same explicit value
 * the desktop sidebar trusts — NOT a behavioral inference.
 *
 * AcreOS serves a handful of distinct investor types; each should open the app
 * to the four surfaces that match their daily loop. A note servicer should not
 * land on a Deals tab, and a wholesaler should not have to dig for buyer
 * blasts. User-customized prefs (saved in useNavPreferences) still override.
 *
 * 4 ids = the bottom-nav tabs; the 5th slot is always the More drawer.
 */
export function mobileItemsForPersona(persona: Persona | undefined): string[] {
  switch (persona) {
    case "wholesaler":
      // Contracts + buyer blasts + reply triage.
      return ["today", "deals", "campaigns", "inbox"];
    case "note_investor":
      // Owns notes — monitors payments, delinquencies, portfolio value.
      return ["today", "finance", "money", "inbox"];
    case "note_originator":
      // Originates seller-financed notes — deals close into the note book.
      return ["today", "deals", "finance", "money"];
    case "note_servicer":
      // Services notes for others — payments ledger + borrower comms.
      return ["today", "finance", "money", "inbox"];
    case "tax_delinquent":
      // Auction/tax-lien buyers — county research + property pipeline.
      return ["today", "properties", "counties", "money"];
    case "subdivider":
      // Splits parcels and lists the children.
      return ["today", "properties", "listings", "money"];
    case "fix_flipper":
      // Rehab projects on owned properties through to disposition.
      return ["today", "properties", "deals", "money"];
    case "landlord":
      // Buy-and-hold — rent roll + portfolio (finance surfaces cash flow).
      return ["today", "properties", "finance", "money"];
    case "land_investor":
    default:
      // Land flipper / unknown — the launch-vertical default.
      return DEFAULT_MOBILE_ITEMS;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4 — new founder UI (Solene migration)
// ─────────────────────────────────────────────────────────────────────
// When the `useNewFounderUI` localStorage flag is true, the founder
// sidebar collapses from 30+ entries to exactly 5 doors. The remaining
// 30+ pages stay routable and are listed in FOUNDER_NAV_DEEP_DIVES,
// grouped by category so Solene can open the right one from chat
// ("open the engineering deep-dive on telemetry").
// ─────────────────────────────────────────────────────────────────────

export interface FounderNavDoor {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description: string;
}

export interface FounderNavDeepDive {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  category:
    | "engineering"
    | "ai"
    | "customers"
    | "money"
    | "strategy"
    | "ops"
    | "experimental";
}

/** The 5 doors Tom approved for the new founder surface. Always visible. */
export const FOUNDER_NAV_NEW_5_DOORS: FounderNavDoor[] = [
  {
    label: "Today",
    icon: Sun,
    href: "/founder/today",
    description:
      "Morning pulse + active asks + decisions waiting + start a conversation with Solene.",
  },
  {
    label: "Team",
    icon: Users,
    href: "/founder/team",
    description:
      "12-member roster: who's active, who's dormant, what each is working on.",
  },
  {
    label: "Customers",
    icon: Heart,
    href: "/founder/customers",
    description:
      "Funnel + lifecycle + Pax interactions (mostly Phase 0 placeholder).",
  },
  {
    label: "Money",
    icon: DollarSign,
    href: "/founder/money",
    description:
      "Runway + envelope + recent capital events (mostly Phase 0 placeholder).",
  },
  {
    label: "Build",
    icon: Hammer,
    href: "/founder/build",
    description:
      "Live dispatch queue + agent asks + recent commits + audit-finding summary.",
  },
];

/** Settings shortcut — rendered as a separate icon row below the 5 doors. */
export const FOUNDER_NAV_SETTINGS_SHORTCUT: FounderNavDoor = {
  label: "Settings",
  icon: Cog,
  href: "/founder/settings",
  description: "Live-apply operational knobs",
};

/**
 * The existing 30+ founder pages. NOT shown in the primary 5-door nav —
 * reachable via direct URL or via Solene opening them from chat.
 *
 * Categories let Solene pick the right page when Tom asks an open-ended
 * question ("how's engineering looking?" → engineering deep-dives).
 *
 * Keep this list in sync with the founder routes in App.tsx and the
 * "Founder business" module overflow in NAV_MODULES (layout-sidebar.tsx).
 */
export const FOUNDER_NAV_DEEP_DIVES: FounderNavDeepDive[] = [
  // ── Engineering ─────────────────────────────────────────────────────
  { label: "API telemetry", icon: Activity, href: "/founder/telemetry", category: "engineering" },
  { label: "AI costs", icon: DollarSign, href: "/founder/ai-costs", category: "engineering" },
  { label: "Sentry cost", icon: Eye, href: "/founder/observability-cost", category: "engineering" },
  { label: "Cost optimizer", icon: TrendingUp, href: "/founder/cost-optimizer", category: "engineering" },
  { label: "Providers", icon: Database, href: "/founder/providers", category: "engineering" },
  { label: "Job health", icon: Activity, href: "/job-health", category: "engineering" },
  { label: "Event log", icon: FileCode, href: "/event-log", category: "engineering" },

  // ── AI / Agents ─────────────────────────────────────────────────────
  { label: "Pax traces", icon: FileCode, href: "/founder/pax-traces", category: "ai" },
  { label: "Pax calibration", icon: Target, href: "/founder/pax-calibration", category: "ai" },
  { label: "Agent traces", icon: FileCode, href: "/founder/traces", category: "ai" },
  { label: "Agent queue", icon: Bot, href: "/founder/agent-queue", category: "ai" },
  { label: "Dispatches", icon: WorkflowIcon, href: "/founder/dispatches", category: "ai" },
  { label: "Agent asks", icon: HelpCircle, href: "/founder/asks", category: "ai" },
  { label: "Prompt evolutions", icon: Brain, href: "/founder/prompt-evolutions", category: "ai" },
  { label: "Prompt history", icon: History, href: "/founder/prompt-history", category: "ai" },
  { label: "Memory browser", icon: Database, href: "/memory-browser", category: "ai" },
  { label: "Agent performance", icon: Activity, href: "/agent-performance", category: "ai" },
  { label: "Agent collaboration", icon: Bot, href: "/agent-collaboration", category: "ai" },

  // ── Customers ───────────────────────────────────────────────────────
  { label: "Customer health", icon: Heart, href: "/founder/customers/health", category: "customers" },
  { label: "Onboarding funnel", icon: Activity, href: "/founder/onboarding-funnel", category: "customers" },
  { label: "Feedback inbox", icon: Inbox, href: "/founder/feedback", category: "customers" },
  { label: "Founder feed", icon: Activity, href: "/founder/feed", category: "customers" },
  { label: "Growth campaigns", icon: Megaphone, href: "/founder/growth/campaigns", category: "customers" },
  { label: "CMO", icon: Megaphone, href: "/founder/cmo", category: "customers" },

  // ── Money ───────────────────────────────────────────────────────────
  { label: "Cost", icon: DollarSign, href: "/founder/cost", category: "money" },
  { label: "Unit economics", icon: Receipt, href: "/founder/unit-economics", category: "money" },

  // ── Strategy ────────────────────────────────────────────────────────
  { label: "Pulse", icon: Activity, href: "/founder", category: "strategy" },
  { label: "Bridge", icon: CheckCircle2, href: "/founder/bridge", category: "strategy" },
  { label: "Steering", icon: TrendingUp, href: "/founder/steering", category: "strategy" },
  { label: "Decisions", icon: Shield, href: "/founder/decisions", category: "strategy" },
  { label: "Strategy", icon: Lightbulb, href: "/founder/strategy", category: "strategy" },
  { label: "System trends", icon: TrendingUp, href: "/founder/trends", category: "strategy" },
  { label: "Monthly letter", icon: FileText, href: "/founder/letter", category: "strategy" },
  { label: "What needs you", icon: CheckCircle2, href: "/founder/todo", category: "strategy" },
  { label: "Expansion radar", icon: Target, href: "/founder/expansion", category: "strategy" },
  { label: "Action preview", icon: Eye, href: "/founder/preview", category: "strategy" },

  // ── Ops / admin ─────────────────────────────────────────────────────
  { label: "Studio", icon: Sliders, href: "/founder/studio", category: "ops" },
  { label: "Inspector", icon: Search, href: "/founder/inspector/audit", category: "ops" },
  { label: "System keys", icon: Key, href: "/founder/keys", category: "ops" },
  { label: "Launch readiness", icon: ListChecks, href: "/founder/readiness", category: "ops" },
  { label: "Founder settings", icon: Settings, href: "/founder/settings", category: "ops" },
  { label: "Recovery console", icon: LifeBuoy, href: "/founder/recovery-console", category: "ops" },
  { label: "Onboarding", icon: Rocket, href: "/founder/onboarding", category: "ops" },
  { label: "Experiments", icon: FlaskConical, href: "/founder/experiments", category: "ops" },
  { label: "Tool proposals", icon: Wrench, href: "/founder/tools", category: "ops" },
  { label: "Trust graduation", icon: Shield, href: "/founder/trust-graduation", category: "ops" },

  // ── Experimental ────────────────────────────────────────────────────
  { label: "Sovereign dashboard", icon: Crown, href: "/sovereign", category: "experimental" },
  { label: "Sovereign v13", icon: Sparkles, href: "/founder/v13", category: "experimental" },
  { label: "Board of directors", icon: Shield, href: "/board-of-directors", category: "experimental" },
  { label: "Conscious organization", icon: Brain, href: "/conscious-organization", category: "experimental" },
  { label: "Anticipatory enterprise", icon: TrendingUp, href: "/anticipatory-enterprise", category: "experimental" },
  { label: "Data moat", icon: Database, href: "/data-moat", category: "experimental" },
  { label: "Reseller program", icon: Store, href: "/reseller", category: "experimental" },
  { label: "Executive dashboard", icon: BarChart3, href: "/executive-dashboard", category: "experimental" },
];

/** Resolve all deep-dives within a given category — used by Solene's
 *  open-page tool when she gets an open-ended question. */
export function founderDeepDivesByCategory(
  category: FounderNavDeepDive["category"]
): FounderNavDeepDive[] {
  return FOUNDER_NAV_DEEP_DIVES.filter((d) => d.category === category);
}
