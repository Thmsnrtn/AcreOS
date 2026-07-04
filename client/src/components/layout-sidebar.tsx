/**
 * Prototype reference: /acreos/shell.jsx → Sidebar (~260 lines)
 *
 * Production layout-sidebar is ~1380 lines vs the prototype's 260 — most
 * structure (white-label branding, NotificationCenter, PaxNotificationBadge,
 * provider-status, customizer, mobile Sheet, collapsed-popover children,
 * sub-nav expansion, prefetch-on-hover, founder-only modules, etc.) is
 * production-original elite-refinement work and predates this build.
 *
 * Patterns brought across from the prototype:
 * - Phase 2.1: data-tour-nav={module.id} on every nav-row surface (matches
 *   the prototype's data-tour-nav={item.id} convention; see acreos/shell.jsx:29)
 * - Phase 2.2: Visible "Search or jump to…" trigger in the sidebar header
 *   (matches the prototype's acr-search-trigger; placement and copy mirror
 *   the prototype)
 * - Phase 2A.1: Active nav-item visual treatment per acreos/shell.jsx:195-203
 *   — subtle var(--acr-surface) bg + box-shadow + 2px brand-color pip at
 *   the row's left edge. Replaced the prior Tahoe-capsule pill (which was
 *   engineering-quality but visually conflicted with the prototype). See
 *   client/src/index.css:704 for the .nav-item-active treatment.
 * - Phase 2A.1: Active-icon color uses var(--acr-ink) (inherits from the
 *   active row's color), not text-primary, per prototype's behavior of not
 *   tinting icons brand on active.
 * - Phase 2A.1: Sidebar surface uses homestead literal #F1E7D0 (light) /
 *   #130C05 (dark) behind the existing vibrancy blur+saturation effect.
 *
 * Engineering refinement preserved:
 * - All aria-* attributes, min-h-[44px] mobile touch targets
 * - Mobile Sheet pattern, white-label brand name, founder gating via
 *   useAuth().isFounder
 * - PaxNotificationBadge, NotificationCenter, ThemeToggle wiring
 * - Vibrancy backdrop-filter blur(28px) saturate(185%)
 * - Sidebar collapse spring animation, hover prefetch, Popover for
 *   collapsed-children
 *
 * Phase 9 Final Coherence Pass remaining items:
 * - Active-state badge brand-tinting (.acr-nav-item-active .acr-nav-badge
 *   in prototype) is not yet replicated on production's <Badge variant=
 *   "secondary"> showBadge instances
 * - Optional "Workspace · ⌃" affordance below the brand
 */
import { useLocation } from "wouter";
// PrefetchLink is a drop-in for wouter's Link that warms the
// destination's primary query on hover/focus so navigation feels
// instant. Aliased as Link so existing JSX needs no changes; links
// pointing to routes without a known query mapping no-op the prefetch
// at zero overhead.
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Map,
  Banknote,
  Bot,
  Settings,
  LogOut,
  Menu,
  Mail,
  Inbox,
  GitBranch,
  GitMerge,
  Calculator,
  Crown,
  Home,
  Newspaper,
  Settings2,
  ToggleLeft,
  Receipt,
  HelpCircle,
  PieChart,
  Store,
  FileText,
  Zap,
  TrendingUp,
  Brain,
  Activity,
  Target,
  Shield,
  Globe,
  ShieldCheck,
  DollarSign,
  FileSearch,
  Search,
  Sliders,
  ContactRound,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Package,
  Wand2,
  Landmark,
  Bell,
  Sparkles,
  CheckCircle2,
  Eye,
  Wrench,
  LifeBuoy,
  Rocket,
  FlaskConical,
  Database,
  Lightbulb,
  History,
  Layers,
  FileCode,
  X,
  Send,
  Clock,
  Gavel,
  BookOpen,
  Scale,
  ClipboardList,
  Calendar,
  Ruler,
  Wallet,
  Key,
  ListChecks,
  Heart,
  Megaphone,
  Hammer,
  Workflow,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useBrandName } from "@/hooks/use-white-label";
import { useModals } from "@/stores/modal-store";
import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from "react";
import { useUiState } from "@/hooks/use-ui-state";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { prefetchRoute } from "@/lib/queryClient";
import { AcreosLogo } from "@/components/acreos-logo";
import { useContextProfile, type InvestorType } from "@/hooks/use-context-profile";
import { resolveHiddenRoutes, type OrgInvestorType } from "@/lib/sidebar-hidden-routes";
import { NotificationCenter } from "@/components/notification-center";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { useOrganization } from "@/hooks/use-organization";
// Phase 4 of the Solene migration — opt-in flag flips the founder
// sidebar to the 5-door structure (Today / Team / Customers / Money / Build).
import { useNewFounderUI } from "@/lib/featureFlags";
import {
  FOUNDER_NAV_NEW_5_DOORS,
  FOUNDER_NAV_SETTINGS_SHORTCUT,
  FOUNDER_NAV_ALL_TOOLS_SHORTCUT,
  type FounderNavDoor,
} from "@/lib/nav-items";
import { motion } from "framer-motion";
import { NAV_INDICATOR_LAYOUT_IDS, navIndicatorSpring } from "@/lib/animations";

// ─────────────────────────────────────────────────────────────────────
// Pax proactive notification badge
// Polls GET /api/pax/observations?unread=true every 2 min.
// Shows a Sparkles icon with a red count bubble when Pax has new
// observations for the org.  Clicking opens a popover with the
// latest insights and quick-dismiss actions.
// ─────────────────────────────────────────────────────────────────────
interface PaxObservation {
  id: number;
  type: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  detectedAt: string;
  metadata?: Record<string, any>;
}

function PaxNotificationBadge() {
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/pax/observations", "unread"],
    queryFn: async () => {
      const res = await fetch("/api/pax/observations?unread=true", { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const { data: observationsData, refetch: refetchObservations } = useQuery<{ observations: PaxObservation[] }>({
    queryKey: ["/api/pax/observations"],
    queryFn: async () => {
      const res = await fetch("/api/pax/observations?limit=10", { credentials: "include" });
      if (!res.ok) return { observations: [] };
      return res.json();
    },
    enabled: false, // Only fetch when popover opens
    staleTime: 30 * 1000,
  });

  const unreadCount = unreadData?.count ?? 0;
  const observations = observationsData?.observations ?? [];

  const handleDismiss = async (id: number) => {
    try {
      await fetch(`/api/pax/observations/${id}/dismiss`, {
        method: "POST",
        credentials: "include",
      });
      refetchObservations();
    } catch {}
  };

  const handleAcknowledge = async (id: number) => {
    try {
      await fetch(`/api/pax/observations/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
      });
      refetchObservations();
    } catch {}
  };

  const severityColor: Record<string, string> = {
    high: "text-acr-neg",
    medium: "text-acr-warn",
    low: "text-acr-accent",
    info: "text-muted-foreground",
  };

  return (
    <Popover onOpenChange={(open) => { if (open) refetchObservations(); }}>
      <Tooltip delayDuration={0}>
        {/* Single asChild Slot: TooltipTrigger clones the PopoverTrigger,
            which itself renders the real <button>. Nesting two asChild
            Slots (Tooltip + Popover) over one child made both try to
            clone+ref it → React "Function components cannot be given refs". */}
        <TooltipTrigger asChild>
          <PopoverTrigger
            className="relative p-1.5 rounded-card text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground transition-colors"
            aria-label="Pax AI insights"
            data-testid="button-pax-notifications"
          >
            <Sparkles className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">Pax AI Insights</p>
          {unreadCount > 0 && (
            <p className="text-xs text-muted-foreground">{unreadCount} new observation{unreadCount === 1 ? "" : "s"}</p>
          )}
        </TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="start" className="w-80 p-0 ml-2 shadow-xl" sideOffset={4}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Pax Insights</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">{unreadCount} new</Badge>
            )}
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {observations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Pax is watching for insights.</p>
              <p className="text-xs text-muted-foreground mt-1">You'll be notified when something needs attention.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {observations.map((obs) => (
                <div key={obs.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-2">
                    <Sparkles className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${severityColor[obs.severity] || "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground leading-snug">{obs.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{obs.description}</p>
                      <p className="text-micro text-muted-foreground/60 mt-1">
                        {formatDate(obs.detectedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDismiss(obs.id)}
                      className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted transition-colors"
                      aria-label="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {obs.status === "detected" && (
                    <button
                      onClick={() => handleAcknowledge(obs.id)}
                      className="mt-1.5 ml-5 text-micro text-primary hover:underline active:underline"
                    >
                      Mark as seen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar collapse context — consumed by page-shell to adjust margin
// ─────────────────────────────────────────────────────────────────────
interface SidebarContextValue {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  setIsCollapsed: () => {},
});

export function useSidebarCollapsed() {
  return useContext(SidebarContext);
}

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
interface NavChild {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
  showUnreadBadge?: boolean;
  // Sigfried §1 sunset marker — when true, the child renders with a small
  // "Legacy" badge next to the label. Used for surfaces being extracted /
  // deprecated but still reachable while the migration is in flight.
  legacy?: boolean;
}

interface NavModule {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
  showUnreadBadge?: boolean;
  founderOnly?: boolean;
  // Hide unless the user's businessType matches one of these values.
  // Used for sub-vertical modules (tax-delinquent, etc.) that only
  // make sense for that operator profile.
  businessTypeOnly?: string[];
  children?: NavChild[];
  // Secondary children — rendered behind a "Show more" disclosure. Lets the
  // primary list stay scannable while the long tail (admin, niche surfaces)
  // remains reachable from the sidebar instead of disappearing entirely.
  // ⌘K command palette covers anyone who'd rather search than scan.
  overflow?: NavChild[];
}

// ─────────────────────────────────────────────────────────────────────
// Navigation structure — consolidated into logical groups
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// 2026-05-11 sidebar audit (multi-lens strategic review):
//
// Customer surface trimmed to 7 canonical top-level entries:
//   Today / Leads / Properties / Deals / Outreach / Money / Settings.
//
// Persona-vertical modules (Notes, Tax-Delinquent, Wholesale, Rentals,
// Flip, Subdivision) remain — each is `businessTypeOnly` and only
// appears for a matching operator profile. The Founder module remains
// `founderOnly` and is the ONLY place internal agent-codename surfaces
// (/founder/governance, /founder/scenarios, /founder/memory, etc.) are
// linked from. Customers never see them.
// ─────────────────────────────────────────────────────────────────────
const NAV_MODULES: NavModule[] = [
  // ── Five fixed doors (+ Inbox, Settings) ──────────────────────────
  // Customer nav = exactly five doors, identical for every persona:
  //   Today · Map · Deals · Finance · Pax  (+ Inbox, Settings).
  // Persona changes only the CONTENT behind each door (children /
  // overflow / persona verticals below), never the doors themselves.
  // The mobile bottom nav renders the same five. Any new surface lives
  // behind one of these doors as a child/section — never as a new
  // top-level nav entry. (See CLAUDE.md "Customer navigation".)
  {
    id: "today",
    label: "Today",
    icon: Home,
    href: "/today",
    description: "Daily briefing and action queue",
  },
  // ── Map (promoted to a top-level door 2026-05-29) ─────────────────
  // Map-first parcel discovery is the core daily land-investor surface
  // (tap a parcel → owner → offer), so /maps is now its own door rather
  // than a child of Properties. The former "Properties" module is folded
  // in as Map's content: /properties is the "Inventory" child, and the
  // listings / documents surfaces live under it.
  {
    id: "map",
    label: "Map",
    icon: Map,
    href: "/maps",
    description: "Interactive parcel map — discovery, inventory & comps",
    children: [
      { label: "Inventory", icon: Package, href: "/properties", description: "Property inventory" },
    ],
    overflow: [
      { label: "Listings", icon: Store, href: "/listings", description: "Properties for sale" },
      { label: "Documents", icon: FileText, href: "/documents", description: "Property documents" },
    ],
  },
  {
    id: "deals",
    label: "Deals",
    icon: GitBranch,
    href: "/deals",
    description: "Deal pipeline, leads + discovery",
    children: [
      { label: "Pipeline", icon: GitBranch, href: "/deals", description: "Kanban view of active deals" },
      { label: "Discover", icon: Target, href: "/deals/discover", description: "Scored deal opportunities + hunter + feed + patterns" },
      // Leads folded in from the former top-level Leads door (2026-05-29):
      // leads feed the pipeline, so they live behind the Deals door.
      { label: "Leads", icon: ContactRound, href: "/leads", description: "Land seller leads CRM" },
    ],
    overflow: [
      { label: "Marketplace", icon: Store, href: "/marketplace", description: "Buy and sell deals" },
      { label: "Valuations", icon: TrendingUp, href: "/avm", description: "Automated property valuations" },
      { label: "Markets", icon: Globe, href: "/market-intelligence", description: "Market analysis and price trends" },
      // Leads sub-surfaces (folded in with Leads, 2026-05-29).
      { label: "Skip Tracing", icon: Search, href: "/skip-tracing", description: "Find owner contact info" },
      { label: "Dedupe", icon: GitMerge, href: "/leads/dedupe", description: "Find and merge duplicate leads" },
      { label: "Blind Offers", icon: Wand2, href: "/blind-offer-wizard", description: "Calculate blind offers step-by-step" },
      { label: "Offer Batches", icon: Layers, href: "/offers/batches", description: "Bulk-generated offers" },
      // Outreach folded in from the former top-level Outreach door
      // (marketing lives behind Deals, 2026-05-29). Channel-tabs live
      // inside /campaigns.
      { label: "Outreach", icon: Mail, href: "/campaigns", description: "Email, SMS, direct mail, sequences, buyer blasts" },
      { label: "Direct Mail", icon: Newspaper, href: "/campaigns?channel=direct-mail", description: "Direct mail campaign automation" },
      { label: "Mail (new)", icon: Newspaper, href: "/outreach/mail", description: "Composer + live in-flight tracker with router-priced sends" },
      { label: "Sequences", icon: Zap, href: "/campaigns?channel=sequences", description: "Automated follow-up sequences" },
    ],
  },

  // ── Note Investor vertical (Phase 5 §5) ───────────────────────────
  // Primary entry for orgs that selected "Buying notes" or "Both" during
  // onboarding. Hidden for pure-land orgs via byOrgInvestorType.land
  // in sidebar-hidden-routes.ts.
  {
    id: "notes",
    label: "Mortgage Notes",
    icon: FileText,
    href: "/notes",
    description: "Servicing book — performing, late, default, paid off",
    children: [
      { label: "Servicing book", icon: FileText, href: "/notes", description: "Acquired notes ledger" },
      { label: "Pipeline", icon: Layers, href: "/notes/pipeline", description: "Pre-book diligence — sourcing → BPO → diligence → offer → escrow" },
      { label: "Tax readiness", icon: Receipt, href: "/notes/tax-readiness", description: "1099-INT pre-flight — eligible recipients, blockers, batch generation" },
    ],
  },

  // ── Tax-Delinquent vertical (TD-1..TD-7) ──────────────────────────
  // Visible to operators whose businessType is 'tax_lien_deed' (Marcus's
  // profile). Surfaces the redemption clock, auction worksheet, state-rules
  // library, and quiet-title workflow. Marcus: "the redemption clock is a
  // fiduciary obligation. Build a tax-delinquent variant of /today that the
  // persona registry can swap in."
  {
    id: "tax-delinquent",
    label: "Tax-delinquent",
    icon: Clock,
    href: "/redemption-clock",
    description: "Certificates, auctions, state rules, quiet title",
    businessTypeOnly: ["tax_lien_deed"],
    children: [
      { label: "Redemption clock", icon: Clock, href: "/redemption-clock", description: "Active certificates sorted by days to deadline" },
      { label: "Auction worksheet", icon: Gavel, href: "/auction-worksheet", description: "Pre-auction max-bid + day-of bid log" },
      { label: "State rules", icon: BookOpen, href: "/state-rules", description: "Per-state redemption math, statutes, notice procedures" },
      { label: "Quiet title", icon: Scale, href: "/quiet-title", description: "10-step post-deed legal workflow with deadline math" },
    ],
  },

  // ── Wholesaler vertical (W-1..W-7) ────────────────────────────────
  // Visible to operators whose businessType is 'residential_wholesaler'
  // (Trey's profile). Surfaces buyer blasts, buyer analytics, EMD timer,
  // double-close, and assignment-legality state rules. Trey:
  // "AcreOS thinks the world ends at 'seller closed and we recorded the
  // deed.' I don't ever record a deed. I assign a contract."
  {
    id: "wholesaler",
    label: "Wholesale",
    icon: Send,
    href: "/campaigns?channel=buyer-blasts",
    description: "Buyer blasts, EMD, double-close, state rules",
    businessTypeOnly: ["residential_wholesaler"],
    children: [
      // 2026-05-11 — buyer-blasts is now a channel-tab inside /campaigns.
      { label: "Buyer blasts", icon: Send, href: "/campaigns?channel=buyer-blasts", description: "One-click outreach to matched cash buyers" },
      { label: "Buyer analytics", icon: TrendingUp, href: "/buyer-analytics", description: "Per-blast funnel + freshness" },
      { label: "Earnest money", icon: Banknote, href: "/earnest-money", description: "EMD inspection-period timer + at-risk view" },
      { label: "Double-close", icon: GitBranch, href: "/double-close", description: "A→B + B→C linked transactions" },
      { label: "Assignment legality", icon: Scale, href: "/wholesaler-state-rules", description: "Per-state wholesaler-licensing rules" },
    ],
  },

  // ── Buy-and-hold vertical (BH-1..BH-9) ────────────────────────────
  // Imelda §7: "AcreOS is an acquisition platform with a landlord persona
  // painted on the wall. […] If those six items ship in the next 12
  // months, I'd cancel Buildium." We've shipped tenants, leases, rent
  // ledger, maintenance, inspections, analytics. Surface them.
  {
    id: "landlord",
    label: "Rentals",
    icon: Home,
    href: "/rent-roll",
    description: "Tenants, leases, rent roll, maintenance, analytics",
    businessTypeOnly: ["buy_and_hold"],
    children: [
      { label: "Rent roll", icon: Wallet, href: "/rent-roll", description: "Org-wide aging buckets + open balances" },
      { label: "Tenants", icon: Users, href: "/tenants", description: "Tenant CRM (separate from acquisition leads)" },
      { label: "Leases", icon: FileText, href: "/leases", description: "Lease lineage w/ renewal-as-addendum" },
      { label: "Maintenance", icon: Hammer, href: "/maintenance", description: "Ticket queue → contractor dispatch" },
      { label: "Analytics", icon: TrendingUp, href: "/investor-analytics", description: "NOI / cap rate / DSCR / vacancy" },
    ],
  },

  // ── Fix-and-flip vertical (FF-1..FF-9) ───────────────────────────
  // Devon §7: "Until then I'm just running comps in here while Builders
  // Cloud does the real work." Five surfaces operators actually open.
  {
    id: "flipper",
    label: "Flip",
    icon: Hammer,
    href: "/rehabs",
    description: "Active rehabs, contractors, ARV, bids, draws",
    businessTypeOnly: ["fix_and_flip"],
    children: [
      { label: "Active rehabs", icon: Hammer, href: "/rehabs", description: "Project list + kanban board" },
      { label: "Contractors", icon: Users, href: "/contractors", description: "Sub bench w/ YTD totals" },
      { label: "1099-NEC batch", icon: FileText, href: "/contractors/1099-nec", description: "Year-end Copy B PDF generator" },
    ],
  },

  // ── Subdivider vertical (SD-1..SD-9) ──────────────────────────────
  // Brigid: "My left-rail nav: /maps, /parcels/:id 'Subdivision' tab,
  // /permits (new), /lots (new), /plats (new). Five entries. Nothing else.
  // The current nav has thirty-something entries and most of them don't
  // apply to my model. A persona-driven nav that hides what I don't need
  // would do more for my onboarding than any AI feature."
  {
    id: "subdivider",
    label: "Subdivision",
    icon: Layers,
    href: "/permits",
    description: "Lots, permits, plans, pricing grid, county timelines",
    // W2.5: "developer" derives the subdivider persona (persona-mapping.ts) —
    // developers get the same lots/permits/plats model, so the module gate
    // matches both businessTypes instead of stranding developer signups.
    businessTypeOnly: ["subdivider", "developer"],
    children: [
      { label: "Permits", icon: ClipboardList, href: "/permits", description: "County-by-county permit checklists w/ stalled-gate alerts" },
      { label: "County timelines", icon: Calendar, href: "/county-timelines", description: "Subdivision approval lead times by county" },
      { label: "Lot pricing", icon: Ruler, href: "/lot-pricing", description: "Premium-rule grid for child lots (open from a parent parcel)" },
      { label: "CC&R templates", icon: FileText, href: "/ccr-templates", description: "Restrictive covenants + road maintenance + HOA bylaws" },
    ],
  },

  // ── Finance (door 4 — the module formerly id "money") ─────────────
  // Finance is the canonical customer surface for finance/portfolio/
  // cash-flow. The legacy /finance + /portfolio + /analytics surfaces are
  // still reachable from inside /money's tabs and from the command palette.
  // Outreach was demoted to a child/overflow under the Deals door
  // (marketing lives behind Deals, 2026-05-29).
  {
    id: "money",
    label: "Finance",
    icon: DollarSign,
    href: "/money",
    description: "Notes, portfolio, and cash flow",
    overflow: [
      { label: "Portfolio", icon: PieChart, href: "/portfolio", description: "Investment portfolio view" },
      { label: "Cash Flow", icon: Activity, href: "/cash-flow", description: "12-month forecasting" },
      { label: "Capital Markets", icon: DollarSign, href: "/capital-markets", description: "Note securitization and lenders" },
      { label: "Analytics", icon: Brain, href: "/analytics", description: "Insights and reporting" },
    ],
  },

  // ── Pax (door 5 — the AI assistant) ───────────────────────────────
  // Promoted to a top-level door 2026-05-29 to match the unified five-door
  // model. Pax is the customer-facing AI persona (founders see the agent
  // codename surfaces only under the founder-only module).
  {
    id: "ai-hub",
    label: "Pax",
    icon: Sparkles,
    href: "/ai",
    description: "Pax — your AI assistant",
  },

  // ── Inbox (communications, reachable from the top bar too) ─────────
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    href: "/inbox",
    description: "Messages and communications",
    showUnreadBadge: true,
  },

  // ── Founder business ──────────────────────────────────────────────
  // The full autonomous-operation surface. Appears only to founders.
  // FOUR-DOOR DOCTRINE (client/src/lib/founder-doors.ts): the primary
  // children ARE the four doors — the same model the mobile bottom nav
  // renders — so desktop and mobile teach the identical mental map:
  //   Letter (read) → Decisions (act) → Controls (configure) → Story (verify).
  // Everything else is a deep tool, reached deliberately via the overflow
  // (led by the categorized All-tools index), never competing for daily
  // attention.
  {
    id: "founder-business",
    label: "Founder",
    icon: Crown,
    href: "/founder",
    description: "Autonomous-operation command center",
    founderOnly: true,
    children: [
      { label: "The Letter", icon: Sparkles, href: "/founder", description: "The daily read — what happened, what it decided, whether you can step away. 90% of days: read and close." },
      { label: "Decisions", icon: Shield, href: "/founder/decisions", description: "The ONLY place you're required — the witnessed-send queue, asks, appeals" },
      { label: "Controls", icon: Sliders, href: "/founder/autopilot/control", description: "Step-away readiness, master switches, trust levels, delegation, budgets, emergency stop" },
      { label: "Story", icon: BookOpen, href: "/founder/autopilot/story", description: "The glass-box audit timeline — for verifying, not operating" },
    ],
    // ── Deep tools ────────────────────────────────────────────────────
    // Visited deliberately; collapsed by default. All-tools leads as the
    // categorized index of everything below (and everything not listed).
    overflow: [
      { label: "All tools", icon: LayoutDashboard, href: "/founder/all-tools", description: "Categorized index of every founder deep-dive surface" },
      { label: "Costs", icon: DollarSign, href: "/founder/admin/costs", description: "AI spend, infra, unit economics, optimizer, providers — one hub" },
      { label: "Customers", icon: Users, href: "/founder/customers", description: "Distribution truth — paid / trial / churned counts + UTM sources + recent signups" },
      // ── Weekly-touch surfaces ─────────────────────────────────────
      { label: "Bridge", icon: CheckCircle2, href: "/founder/bridge", description: "Chat + telemetry bridge" },
      { label: "Steering", icon: TrendingUp, href: "/founder/steering", description: "Weekly / monthly check-in: what changed, what's the trend, one strategic call" },
      { label: "Studio", icon: Sliders, href: "/founder/studio", description: "Every dial — autonomy thresholds, cost caps, lifecycle, voice, safety" },
      { label: "Inspector", icon: Search, href: "/founder/inspector/audit", description: "Provenance lens — per-agent, per-decision, founder audit feed" },
      { label: "CMO", icon: Megaphone, href: "/founder/cmo", description: "Native ad generation, approval, broadcast to Meta + TikTok" },
      // ── Customer health ────────────────────────────────────────────
      { label: "Customer health", icon: Heart, href: "/founder/customers/health", description: "MRR trajectory, churn risk, org health" },
      // ── Pax traces / calibration ───────────────────────────────────
      { label: "Pax traces", icon: FileCode, href: "/founder/pax-traces", description: "Read-only Pax LLM trace viewer — prompts, tool calls, guardrails, dispositions" },
      { label: "Pax calibration", icon: Target, href: "/founder/pax-calibration", description: "Reliability diagram — Pax stated confidence vs. realized accept-rate" },
      // ── Agent / AI tooling ─────────────────────────────────────────
      { label: "Agent traces", icon: FileCode, href: "/founder/traces", description: "Raw LLM prompt + response for every agent call" },
      { label: "Agent queue", icon: Bot, href: "/founder/agent-queue", description: "Autonomous-agent code-change proposals, event feed, weekly LLM budget" },
      { label: "Dispatches", icon: Workflow, href: "/founder/dispatches", description: "Real-time view of the auto-dispatch queue — queued / in-progress / terminal rows + cancel + review status" },
      { label: "Agent asks", icon: HelpCircle, href: "/founder/asks", description: "Real-time questions from agents (L6.32 founder-collab) — answer to unblock a dispatch or supersede if no longer relevant" },
      { label: "Onboarding funnel", icon: Activity, href: "/founder/onboarding-funnel", description: "Signup-to-first-value time per org with 90s-target indicator + abandonment-by-step + per-org drill-down" },
      { label: "Prompt evolutions", icon: Brain, href: "/founder/prompt-evolutions", description: "Agent prompt revision approvals" },
      { label: "Prompt history", icon: History, href: "/founder/prompt-history", description: "Per-agent version timeline with diffs" },
      // ── Strategy ───────────────────────────────────────────────────
      { label: "Strategy", icon: Lightbulb, href: "/founder/strategy", description: "Strategic proposals (weekly + synthesis)" },
      { label: "System trends", icon: TrendingUp, href: "/founder/trends", description: "90-day trust gauge" },
      { label: "Monthly letter", icon: FileText, href: "/founder/letter", description: "Chief-of-Staff narrative" },
      // ── Ops / admin ────────────────────────────────────────────────
      { label: "System keys", icon: Key, href: "/founder/keys", description: "Platform-wide API keys (BYOK overrides)" },
      { label: "Launch readiness", icon: ListChecks, href: "/founder/readiness", description: "Daily-during-launch progress checklist" },
      { label: "API telemetry", icon: Activity, href: "/founder/telemetry", description: "In-process per-route 2xx/4xx/5xx + p95 latency" },
      { label: "Market reports", icon: Newspaper, href: "/founder/market-reports", description: "Quarterly data-co-op market report DRAFTS (k≥5 floor) — review only, no publish" },
      { label: "Founder settings", icon: Settings2, href: "/founder/settings", description: "Live-apply operational knobs" },
      { label: "Recovery console", icon: LifeBuoy, href: "/founder/recovery-console", description: "Last-resort account recovery — 2FA, sessions, autopay, ownership" },
      { label: "Feedback inbox", icon: Inbox, href: "/founder/feedback", description: "Public support/feedback/question submissions from landing pages" },
      { label: "Founder feed", icon: Activity, href: "/founder/feed", description: "Unified timeline — feedback + agent events + code proposals in one view" },
      { label: "Growth campaigns", icon: Megaphone, href: "/founder/growth/campaigns", description: "Meta ads, AI campaign wizard, attribution" },
      { label: "Action preview", icon: Eye, href: "/founder/preview", description: "Before-commit action feed" },
      { label: "Expansion radar", icon: Target, href: "/founder/expansion", description: "Weekly upsell-ready candidates" },
      { label: "Onboarding", icon: Rocket, href: "/founder/onboarding", description: "New-customer activation journeys" },
      { label: "Experiments", icon: FlaskConical, href: "/founder/experiments", description: "A/B tests on decision playbooks" },
      { label: "Tool proposals", icon: Wrench, href: "/founder/tools", description: "Capability-growth queue" },
      // ── Sovereignty / experimental surfaces ────────────────────────
      // Census W3-1 (2026-06-11): sovereign-dashboard, sovereign-v13,
      // anticipatory-enterprise, and agent-collaboration retired.
      // The four refit survivors live under /founder/*.
      { label: "Governance", icon: Shield, href: "/founder/governance", description: "Agent negotiations, delegation authority, trust enforcement, founder overrides" },
      { label: "Scenarios", icon: Brain, href: "/founder/scenarios", description: "Scenario war room + org self-awareness (agent-role taxonomy)" },
      { label: "Agent performance", icon: Activity, href: "/agent-performance", description: "Per-agent trust + decision quality metrics" },
      { label: "Memory browser", icon: Database, href: "/founder/memory", description: "Per-agent semantic + episodic memory inspector" },
      { label: "Event log", icon: FileCode, href: "/founder/event-log", description: "Agent-event firehose — every decision and side effect" },
      { label: "Job health", icon: Activity, href: "/job-health", description: "Background worker queues — scheduled jobs, retries, failures" },
      { label: "Data moat", icon: Database, href: "/data-moat", description: "Proprietary data accumulation + competitive moat metrics" },
      { label: "Reseller program", icon: Store, href: "/reseller", description: "White-label reseller dashboard — partners, commissions" },
      { label: "Executive dashboard", icon: LayoutDashboard, href: "/executive-dashboard", description: "Cross-org executive KPI roll-up" },
    ],
  },

  // ── Settings ──────────────────────────────────────────────────────
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    href: "/settings",
    description: "Account settings and preferences",
    children: [
      // Removed redundant "Settings" child — parent href already goes to /settings.
      { label: "Tools", icon: Calculator, href: "/tools", description: "Calculators and utilities" },
      { label: "Data Export", icon: Package, href: "/data-export", description: "Export your data as CSV or JSON" },
      { label: "Help & Support", icon: HelpCircle, href: "/help", description: "Help topics and support" },
    ],
  },
];

// Default expanded modules (open by default).
// 2026-05-29 — IDs aligned to the five-door customer surface.
const DEFAULT_EXPANDED = new Set<string>(["map", "deals", "founder-business"]);

// Tahoe E6: sidebar-collapsed migrated from localStorage to useUiState so the
// rail's collapsed/expanded state follows the user across devices. The key is
// unchanged so any existing localStorage value is reused as the first-paint
// cache until the server value hydrates.
const COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
const EXPANDED_STORAGE_KEY = "sidebar-expanded-modules";
const HIDDEN_MODULES_KEY = "sidebar-hidden-modules";

import { DevBanner } from "@/components/dev-banner";
import { ProviderStatusBadges } from "@/components/provider-status";

const routePrefetchMap: Record<string, string> = {
  "/leads": "/api/leads",
  "/properties": "/api/properties",
  "/deals": "/api/deals",
  "/finance": "/api/notes",
  "/notes": "/api/notes",
  "/payments": "/api/payments",
  "/tasks": "/api/tasks",
  "/campaigns": "/api/campaigns",
  "/inbox": "/api/inbox",
  "/ai": "/api/pax/insights",
  "/today": "/api/dashboard/today-priorities",
  "/": "/api/dashboard/today-priorities",
  "/alerts": "/api/alerts/active",
  "/notifications": "/api/notifications",
  "/activity": "/api/activity",
  "/dashboard": "/api/dashboard/intelligence",
  "/settings": "/api/organization",
  "/changelog": "/api/changelog",
  "/status": "/api/status",
};

// ─────────────────────────────────────────────────────────────────────
// Provider — wrap app at root so page-shell can consume
// ─────────────────────────────────────────────────────────────────────
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Server-backed (Tahoe E6): collapsed state follows the user across devices.
  // useUiState keeps the same localStorage key warm for instant first paint.
  const [isCollapsed, setIsCollapsed] = useUiState<boolean>(COLLAPSED_STORAGE_KEY, false);

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main Sidebar component
//
// Sidebar route-hiding logic moved to `client/src/lib/sidebar-hidden-routes.ts`
// per Workstream B.6 (2026-05-04). All three hide-axes (businessType,
// detectedInvestorType, orgInvestorType) live in one registry with a
// single `resolveHiddenRoutes()` entry point and documented precedence.

// ─────────────────────────────────────────────────────────────────────
export function Sidebar() {
  const [location] = useLocation();
  const { logout, isFounder } = useAuth();
  const brandName = useBrandName();
  const [isOpen, setIsOpen] = useState(false);
  const { isCollapsed, setIsCollapsed } = useSidebarCollapsed();
  const { isRouteEnabled, isLoading: flagsLoading } = useFeatureFlags();
  const { data: organization } = useOrganization();

  // Phase 4 of the Solene migration — when the founder is on a /founder/*
  // route AND has opted into the new UI, render the compact 5-door sidebar
  // instead of the 30+ entry full sidebar. Customer-facing routes are
  // unaffected. We branch here (top of Sidebar) so the rest of the function
  // is unchanged for the false case (and for non-founder users).
  const newFounderUI = useNewFounderUI();
  if (isFounder && newFounderUI && location.startsWith("/founder")) {
    return (
      <NewFounderSidebar
        location={location}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        brandName={brandName}
        onLogout={() => logout()}
      />
    );
  }

  const businessType = (organization?.onboardingData as any)?.businessType as string | undefined;
  const { investorType } = useContextProfile();
  // Note Investor vertical (Phase 5 §5) — explicit org-level fork from
  // onboarding step 0. Distinct from `investorType` above which is
  // auto-detected from the user's behaviour. The org-level value takes
  // priority because the user actively declared it.
  const orgInvestorType = ((organization as any)?.investorType ?? "land") as OrgInvestorType;
  // Hidden routes = union of all three axes. See sidebar-hidden-routes.ts
  // for the registry and precedence documentation.
  const hiddenForType = resolveHiddenRoutes({
    businessType,
    detectedInvestorType: investorType,
    orgInvestorType,
  });

  // Filter NAV_MODULES: hide any nav items whose route is feature-flagged off
  // or hidden for the user's investor type.
  // While flags are loading we show everything (prevents flicker on initial load)
  const visibleModules = flagsLoading
    ? NAV_MODULES.filter((module) => !module.founderOnly || isFounder)
    : NAV_MODULES.map((module) => ({
        ...module,
        children: module.children?.filter(
          (child) => isRouteEnabled(child.href) && !hiddenForType.includes(child.href)
        ),
        overflow: module.overflow?.filter(
          (child) => isRouteEnabled(child.href) && !hiddenForType.includes(child.href)
        ),
      })).filter((module) => {
        // Hide founder-only modules for non-founders
        if (module.founderOnly && !isFounder) return false;
        // Hide businessType-gated modules for non-matching operators.
        // Tax-delinquent module is the first user — only visible when
        // businessType is 'tax_lien_deed'.
        if (module.businessTypeOnly && module.businessTypeOnly.length > 0) {
          if (!businessType || !module.businessTypeOnly.includes(businessType)) return false;
        }
        // If the module itself has a controlled route, check it
        if (!isRouteEnabled(module.href)) return false;
        if (hiddenForType.includes(module.href)) return false;
        // If all children + overflow were filtered out and the module is purely
        // a container, hide it. A module with overflow but no primary children
        // still renders so the user can find the surfaces under "Show more."
        if (module.children !== undefined) {
          const hasPrimary = module.children.length > 0;
          const hasOverflow = (module.overflow?.length ?? 0) > 0;
          if (!hasPrimary && !hasOverflow) return false;
        }
        return true;
      });

  // Which modules have their overflow ("Show more") sections open. Persisted
  // separately from expandedModules so flipping a module open/closed doesn't
  // discard the user's choice to reveal niche surfaces.
  const OVERFLOW_STORAGE_KEY = "sidebar-overflow-expanded";
  const [expandedOverflow, setExpandedOverflow] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(OVERFLOW_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    // Auto-open overflow if the active route is in any module's overflow list.
    const active = new Set<string>();
    NAV_MODULES.forEach((m) => {
      if (m.overflow?.some((c) => location.startsWith(c.href) && c.href !== "/")) {
        active.add(m.id);
      }
    });
    return active;
  });
  useEffect(() => {
    try {
      localStorage.setItem(OVERFLOW_STORAGE_KEY, JSON.stringify(Array.from(expandedOverflow)));
    } catch {}
  }, [expandedOverflow, OVERFLOW_STORAGE_KEY]);
  const toggleOverflow = (id: string) => {
    setExpandedOverflow((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Which modules are expanded (only relevant when not collapsed)
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    // Auto-expand the module that contains the current route
    const active = new Set(DEFAULT_EXPANDED);
    NAV_MODULES.forEach((m) => {
      if (
        m.children?.some((c) => location.startsWith(c.href) && c.href !== "/") ||
        location === m.href
      ) {
        active.add(m.id);
      }
    });
    return active;
  });

  // Persist expanded state
  useEffect(() => {
    try {
      localStorage.setItem(
        EXPANDED_STORAGE_KEY,
        JSON.stringify(Array.from(expandedModules))
      );
    } catch {}
  }, [expandedModules]);

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
    refetchInterval: 60000,
  });
  const inboxUnreadCount = unreadCountData?.count ?? 0;

  const handlePrefetch = useCallback((href: string) => {
    const apiRoute = routePrefetchMap[href];
    if (apiRoute) prefetchRoute(apiRoute);
  }, []);

  const toggleModule = (id: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isRouteActive = (href: string) => {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(href + "/");
  };

  const isModuleActive = (module: NavModule) => {
    if (isRouteActive(module.href)) return true;
    return module.children?.some((c) => isRouteActive(c.href)) ?? false;
  };

  // ─── Desktop nav content ───────────────────────────────────────────
  const DesktopNavContent = () => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      {/* Header */}
      <div
        className={cn(
          "border-b border-sidebar-border transition-all duration-200",
          isCollapsed ? "p-3" : "p-4 md:p-5"
        )}
      >
        {isCollapsed ? (
          <div className="flex justify-center">
            <AcreosLogo variant="mark" size={32} />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 shrink">
              <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent shrink-0">
                {brandName}
              </h1>
              {isFounder && (
                <Badge
                  variant="outline"
                  className="bg-acr-warn/10 text-acr-warn border-acr-warn/30 text-micro px-1.5 py-0 shrink-0"
                  data-testid="badge-founder"
                >
                  <Crown className="w-2.5 h-2.5 mr-0.5" />
                  Founder
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <PaxNotificationBadge />
              <NotificationCenter />
            </div>
          </div>
        )}
        {!isCollapsed && (
          <p className="text-xs text-muted-foreground mt-1">
            Land Investor OS
          </p>
        )}
      </div>

      {/* Search / command palette trigger + Quick Offer trigger.
          - Search dispatches acreos:open-command-palette which the global
            CommandPalette listens for. Mirrors the prototype's
            acr-search-trigger placement (sidebar header, above nav).
          - Quick Offer opens the modal via the useModals store. Tour
            anchor `data-tour="quick-offer"` per HANDOFF §7. */}
      <div className={cn("border-b border-sidebar-border", isCollapsed ? "px-2 py-2 space-y-2" : "px-3 py-2 space-y-2")}>
        {isCollapsed ? (
          <>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("acreos:open-command-palette"))}
                  className="flex items-center justify-center w-full p-2.5 rounded-card text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground transition-colors min-h-[44px]"
                  aria-label="Search (⌘K)"
                  data-tour="cmd-palette-trigger"
                  data-testid="button-search-trigger"
                >
                  <Search className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">Search</p>
                <p className="text-xs text-muted-foreground">⌘K</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => useModals.getState().openQuickOffer()}
                  className="flex items-center justify-center w-full p-2.5 rounded-card text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground transition-colors min-h-[44px]"
                  aria-label="Quick offer (⌘O)"
                  data-tour="quick-offer"
                  data-testid="button-quick-offer-trigger"
                >
                  <Send className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">Quick offer</p>
                <p className="text-xs text-muted-foreground">⌘O</p>
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("acreos:open-command-palette"))}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-card border border-sidebar-border bg-sidebar-accent/40 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground transition-colors min-h-[44px] text-sm"
              aria-label="Search or jump to anywhere (Cmd K)"
              data-tour="cmd-palette-trigger"
              data-testid="button-search-trigger"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left truncate">Search or jump to…</span>
              <span className="hidden md:inline-flex items-center gap-0.5 text-micro text-muted-foreground/70">
                <kbd className="px-1 rounded bg-background/60 border border-sidebar-border font-sans">⌘</kbd>
                <kbd className="px-1 rounded bg-background/60 border border-sidebar-border font-sans">K</kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={() => useModals.getState().openQuickOffer()}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-card border border-sidebar-border bg-sidebar-accent/40 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground transition-colors min-h-[44px] text-sm"
              aria-label="Quick offer (Cmd O)"
              data-tour="quick-offer"
              data-testid="button-quick-offer-trigger"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left truncate">Quick offer</span>
              <span className="hidden md:inline-flex items-center gap-0.5 text-micro text-muted-foreground/70">
                <kbd className="px-1 rounded bg-background/60 border border-sidebar-border font-sans">⌘</kbd>
                <kbd className="px-1 rounded bg-background/60 border border-sidebar-border font-sans">O</kbd>
              </span>
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {/* Founder home link — clean autonomy-health + todo hub.
            D6 declutter: the redundant "Operations console (legacy)" and "What
            needs you" sidebar entries were removed (their destinations have
            canonical entries — Bridge and Pulse). The /founder-dashboard +
            /founder/todo paths still REDIRECT (route-redirects.ts) for old
            bookmarks; they're just no longer surfaced as nav clutter. */}
        {isFounder && (
          <DesktopNavItem
            href="/founder"
            icon={Crown}
            label="Founder home"
            isActive={location === "/founder" || location === "/founder-home"}
            isCollapsed={isCollapsed}
            accentClass={
              location === "/founder" || location === "/founder-home"
                ? "bg-acr-warn text-white shadow-md"
                : "bg-acr-warn/10 text-acr-warn hover:bg-acr-warn/20 active:bg-acr-warn/25"
            }
            iconClass={
              location === "/founder" || location === "/founder-home" ? "text-white" : "text-acr-warn"
            }
            testId="link-founder-dashboard"
            onMouseEnter={() => {}}
          />
        )}

        {/* Decisions link used to live here standalone; now it's a
            child of the Founder business module below alongside 12
            other founder surfaces (todo, letter, preview, trends,
            strategy, expansion, etc). */}

        {/* Nav modules (filtered by feature flags) */}
        {visibleModules.map((module) => {
          const active = isModuleActive(module);
          const expanded = expandedModules.has(module.id);
          const hasChildren = (module.children?.length ?? 0) > 0 || (module.overflow?.length ?? 0) > 0;
          const showBadge =
            module.showUnreadBadge && inboxUnreadCount > 0;

          if (isCollapsed) {
            // Collapsed: icon-only with popover for children
            return (
              <CollapsedModuleItem
                key={module.id}
                module={module}
                isActive={active}
                inboxUnreadCount={inboxUnreadCount}
                isRouteActive={isRouteActive}
                onPrefetch={handlePrefetch}
              />
            );
          }

          return (
            <div key={module.id}>
              {/* Module row */}
              <div
                className={cn(
                  "relative flex items-center gap-2 px-3 py-2 rounded-card transition-colors duration-150 group cursor-pointer min-h-[44px]",
                  active
                    ? "nav-item-active nav-item-active--animated"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
                )}
                onClick={() => {
                  if (hasChildren) toggleModule(module.id);
                }}
                onMouseEnter={() => handlePrefetch(module.href)}
                data-testid={`module-${module.id}`}
                data-tour-nav={module.id}
              >
                {active && (
                  <SidebarActivePip
                    layoutId={NAV_INDICATOR_LAYOUT_IDS.customerSidebar}
                  />
                )}
                {/* If no children, make the whole row a link */}
                {!hasChildren ? (
                  <Link
                    href={module.href}
                    className="flex items-center gap-2 flex-1 min-w-0"
                    aria-current={active ? "page" : undefined}
                    aria-label={module.label}
                    data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                  >
                    <module.icon
                      className={cn(
                        "w-4 h-4 shrink-0 transition-colors",
                        active
                          ? "text-acr-ink"
                          : "text-muted-foreground group-hover:text-sidebar-foreground"
                      )}
                    />
                    <span className="font-medium text-sm truncate flex-1">
                      {module.label}
                    </span>
                    {showBadge && (
                      <Badge
                        variant="secondary"
                        className="text-xs shrink-0"
                        data-testid="badge-inbox-unread"
                      >
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                  </Link>
                ) : (
                  <>
                    <module.icon
                      className={cn(
                        "w-4 h-4 shrink-0 transition-colors",
                        active
                          ? "text-acr-ink"
                          : "text-muted-foreground group-hover:text-sidebar-foreground"
                      )}
                    />
                    <Link
                      href={module.href}
                      className="font-medium text-sm flex-1 truncate"
                      data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={() => handlePrefetch(module.href)}
                    >
                      {module.label}
                    </Link>
                    {showBadge && (
                      <Badge
                        variant="secondary"
                        className="text-xs shrink-0"
                        data-testid="badge-inbox-unread"
                      >
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                    {expanded ? (
                      <ChevronUp className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </>
                )}
              </div>

              {/* Children */}
              {hasChildren && expanded && (
                <div className="ml-3 pl-3 border-l border-sidebar-border/60 mt-0.5 mb-1 space-y-0.5">
                  {(module.children ?? []).map((child) => {
                    const childActive = isRouteActive(child.href);
                    const childBadge =
                      child.showUnreadBadge && inboxUnreadCount > 0;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors duration-150 group min-h-[34px] text-xs",
                          childActive
                            ? "nav-item-active"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
                        )}
                        aria-current={childActive ? "page" : undefined}
                        onMouseEnter={() => handlePrefetch(child.href)}
                        data-testid={`link-nav-${child.href.replace("/", "")}`}
                      >
                        <child.icon
                          className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            childActive
                              ? "text-acr-ink"
                              : "text-muted-foreground group-hover:text-sidebar-foreground"
                          )}
                        />
                        <span className="font-medium flex-1 truncate">
                          {child.label}
                        </span>
                        {childBadge && (
                          <Badge
                            variant="secondary"
                            className="text-xs shrink-0"
                          >
                            {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                          </Badge>
                        )}
                      </Link>
                    );
                  })}

                  {/* Overflow disclosure — niche surfaces stay reachable from
                      the sidebar without crowding the daily list. */}
                  {(module.overflow?.length ?? 0) > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleOverflow(module.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors duration-150 min-h-[34px] text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground w-full"
                        data-testid={`button-overflow-${module.id}`}
                        aria-expanded={expandedOverflow.has(module.id)}
                      >
                        {expandedOverflow.has(module.id) ? (
                          <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span className="font-medium">
                          {expandedOverflow.has(module.id) ? "Less" : "More"}
                        </span>
                        <span className="text-caption text-muted-foreground/70 ml-auto tabular-nums">
                          {module.overflow!.length}
                        </span>
                      </button>
                      {expandedOverflow.has(module.id) && module.overflow!.map((child) => {
                        const childActive = isRouteActive(child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors duration-150 group min-h-[34px] text-xs",
                              childActive
                                ? "nav-item-active"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
                            )}
                            aria-current={childActive ? "page" : undefined}
                            onMouseEnter={() => handlePrefetch(child.href)}
                            data-testid={`link-nav-${child.href.replace("/", "")}`}
                          >
                            <child.icon
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                childActive
                                  ? "text-acr-ink"
                                  : "text-muted-foreground group-hover:text-sidebar-foreground"
                              )}
                            />
                            <span className="font-medium flex-1 truncate">
                              {child.label}
                            </span>
                            {child.legacy && (
                              <Badge
                                variant="outline"
                                className="text-[9px] uppercase tracking-wide shrink-0 border-acr-warn/40 text-acr-warn"
                                aria-label="Legacy surface"
                              >
                                Legacy
                              </Badge>
                            )}
                          </Link>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-sidebar-border safe-area-bottom",
          isCollapsed ? "p-2 space-y-1" : "p-3 space-y-2"
        )}
      >
        {isCollapsed ? (
          <>
            <div className="flex justify-center py-1">
              <ThemeToggle />
            </div>
            <button aria-label="Tooltip"
              onClick={() => logout()}
              data-testid="button-logout"
              className="flex items-center justify-center w-full p-2 rounded-card text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:text-destructive active:bg-destructive/15 transition-colors min-h-[44px]"
            >
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <LogOut className="w-4 h-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Sign Out</TooltipContent>
              </Tooltip>
            </button>
            <button
              onClick={() => setIsCollapsed(false)}
              className="flex items-center justify-center w-full p-2 rounded-card text-muted-foreground hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors min-h-[44px]"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <button
              onClick={() => logout()}
              data-testid="button-logout"
              className="flex items-center gap-2 px-3 py-2 w-full rounded-card text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:text-destructive active:bg-destructive/15 transition-colors min-h-[44px]"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium text-sm">Sign Out</span>
            </button>
            <button
              onClick={() => setIsCollapsed(true)}
              className="flex items-center gap-2 px-3 py-2 w-full rounded-card text-muted-foreground hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors min-h-[44px]"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-xs text-muted-foreground">Collapse</span>
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ─── Mobile nav content ────────────────────────────────────────────
  const MobileNavContent = ({ onNavClick }: { onNavClick?: () => void }) => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      <div className="p-0 md:p-0 border-b border-sidebar-border">
        <DevBanner />
        <div className="p-4 md:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {brandName}
            </h1>
            {isFounder && (
              <Badge
                variant="outline"
                className="bg-acr-warn/10 text-acr-warn border-acr-warn/30 text-xs"
              >
                <Crown className="w-3 h-3 mr-1" />
                Founder
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <PaxNotificationBadge />
            <ProviderStatusBadges />
            <NotificationCenter />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Land Investor OS</p>
        </div>
      </div>

      {/* Mobile search / command palette trigger — full-tap-target row.
          Dispatches the same custom event the desktop trigger uses. */}
      <div className="px-3 py-2 border-b border-sidebar-border">
        <button
          type="button"
          onClick={() => {
            onNavClick?.();
            window.dispatchEvent(new CustomEvent("acreos:open-command-palette"));
          }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-card border border-sidebar-border bg-sidebar-accent/40 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground transition-colors min-h-[44px] text-sm"
          aria-label="Search or jump to anywhere"
          data-tour="cmd-palette-trigger"
          data-testid="button-search-trigger-mobile"
        >
          <Search className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left truncate">Search or jump to…</span>
        </button>
      </div>

      <nav aria-label="Mobile navigation" className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {isFounder && (
          <Link
            href="/founder"
            onClick={onNavClick}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-card transition-colors duration-150 group mb-2 min-h-[44px]",
              location === "/founder" || location === "/founder-home"
                ? "bg-acr-warn text-white shadow-md"
                : "bg-acr-warn/10 text-acr-warn hover:bg-acr-warn/20 active:bg-acr-warn/25"
            )}
            data-testid="link-founder-dashboard"
            data-tour-nav="founder-business"
          >
            <Crown
              className={cn(
                "w-5 h-5",
                location === "/founder" || location === "/founder-home" ? "text-white" : "text-acr-warn"
              )}
            />
            <span className="font-medium text-sm">Founder home</span>
          </Link>
        )}

        {visibleModules.map((module) => {
          const active = isModuleActive(module);
          const expanded = expandedModules.has(module.id);
          const hasChildren = (module.children?.length ?? 0) > 0;
          const showBadge = module.showUnreadBadge && inboxUnreadCount > 0;

          return (
            <div key={module.id}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-card transition-colors duration-150 group cursor-pointer min-h-[44px]",
                  active && !hasChildren
                    ? "nav-item-active"
                    : active
                    ? "nav-item-active"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
                )}
                onClick={() => {
                  if (hasChildren) toggleModule(module.id);
                }}
                data-tour-nav={module.id}
              >
                {!hasChildren ? (
                  <Link
                    href={module.href}
                    onClick={onNavClick}
                    className="flex items-center gap-3 flex-1 min-w-0"
                    data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                  >
                    <module.icon
                      className={cn(
                        "w-5 h-5 shrink-0",
                        active ? "text-acr-ink" : "text-muted-foreground"
                      )}
                    />
                    <span className="font-medium text-sm flex-1 truncate">
                      {module.label}
                    </span>
                    {showBadge && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                  </Link>
                ) : (
                  <>
                    <module.icon
                      className={cn(
                        "w-5 h-5 shrink-0",
                        active ? "text-acr-ink" : "text-muted-foreground"
                      )}
                    />
                    <Link
                      href={module.href}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavClick?.();
                      }}
                      className="font-medium text-sm flex-1 truncate"
                      data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                    >
                      {module.label}
                    </Link>
                    {showBadge && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                    {expanded ? (
                      <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                  </>
                )}
              </div>

              {hasChildren && expanded && (
                <div className="ml-4 pl-3 border-l border-sidebar-border/60 mt-0.5 mb-1 space-y-0.5">
                  {(module.children ?? []).map((child) => {
                    const childActive = isRouteActive(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavClick}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md transition-colors duration-150 min-h-[44px]",
                          childActive
                            ? "nav-item-active"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
                        )}
                        data-testid={`link-nav-${child.href.replace("/", "")}`}
                      >
                        <child.icon
                          className={cn(
                            "w-4 h-4 shrink-0",
                            childActive
                              ? "text-acr-ink"
                              : "text-muted-foreground"
                          )}
                        />
                        <span className="font-medium text-sm">{child.label}</span>
                      </Link>
                    );
                  })}

                  {(module.overflow?.length ?? 0) > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleOverflow(module.id)}
                        className="flex items-center gap-3 px-3 py-2 rounded-md transition-colors duration-150 min-h-[44px] text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground w-full"
                        aria-expanded={expandedOverflow.has(module.id)}
                      >
                        {expandedOverflow.has(module.id) ? (
                          <ChevronUp className="w-4 h-4 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 shrink-0" />
                        )}
                        <span className="font-medium text-sm">
                          {expandedOverflow.has(module.id) ? "Less" : "More"}
                        </span>
                        <span className="text-xs text-muted-foreground/70 ml-auto tabular-nums">
                          {module.overflow!.length}
                        </span>
                      </button>
                      {expandedOverflow.has(module.id) && module.overflow!.map((child) => {
                        const childActive = isRouteActive(child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onNavClick}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors duration-150 min-h-[44px]",
                              childActive
                                ? "nav-item-active"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
                            )}
                            data-testid={`link-nav-${child.href.replace("/", "")}`}
                          >
                            <child.icon
                              className={cn(
                                "w-4 h-4 shrink-0",
                                childActive ? "text-acr-ink" : "text-muted-foreground"
                              )}
                            />
                            <span className="font-medium text-sm flex-1 truncate">{child.label}</span>
                            {child.legacy && (
                              <Badge
                                variant="outline"
                                className="text-[9px] uppercase tracking-wide shrink-0 border-acr-warn/40 text-acr-warn"
                                aria-label="Legacy surface"
                              >
                                Legacy
                              </Badge>
                            )}
                          </Link>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border safe-area-bottom space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button
          onClick={() => logout()}
          data-testid="button-logout"
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-card text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:text-destructive active:bg-destructive/15 transition-colors min-h-[44px]"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium text-sm">Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile trigger removed 2026-05-11: bottom-nav "More" already
          opens the full nav (MobileCommandDrawer), and the top-left
          hamburger was double-clutter — and was opening to nothing
          on some routes. Customers reach every page via bottom-nav. */}

      {/* Desktop Sidebar */}
      <aside
        aria-label="Sidebar"
        className={cn(
          "hidden md:flex flex-col fixed inset-y-0 left-0 z-floating m-2 rounded-xl border border-sidebar-border shadow-xl overflow-hidden sidebar-vibrancy sidebar-spring",
          isCollapsed ? "w-[68px]" : "w-64"
        )}
      >
        <DesktopNavContent />
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Collapsed icon-only module item with popover for children
// ─────────────────────────────────────────────────────────────────────
function CollapsedModuleItem({
  module,
  isActive,
  inboxUnreadCount,
  isRouteActive,
  onPrefetch,
}: {
  module: NavModule;
  isActive: boolean;
  inboxUnreadCount: number;
  isRouteActive: (href: string) => boolean;
  onPrefetch: (href: string) => void;
}) {
  const hasChildren = (module.children?.length ?? 0) > 0 || (module.overflow?.length ?? 0) > 0;
  const showBadge = module.showUnreadBadge && inboxUnreadCount > 0;

  if (!hasChildren) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            href={module.href}
            className={cn(
              "flex items-center justify-center w-full p-2.5 rounded-card transition-colors duration-150 min-h-[44px] relative",
              isActive
                ? "nav-item-active"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
            )}
            onMouseEnter={() => onPrefetch(module.href)}
            data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
            data-tour-nav={module.id}
          >
            <module.icon
              className={cn(
                "w-4 h-4 shrink-0",
                isActive ? "text-acr-ink" : "text-muted-foreground"
              )}
            />
            {showBadge && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{module.label}</p>
          {module.description && (
            <p className="text-xs text-muted-foreground">{module.description}</p>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover>
      <Tooltip delayDuration={0}>
        {/* Single asChild Slot: TooltipTrigger clones the PopoverTrigger,
            which renders the real <button>. Two nested asChild Slots both
            tried to clone+ref this child → the React refs warning. */}
        <TooltipTrigger asChild>
          <PopoverTrigger
            className={cn(
              "flex items-center justify-center w-full p-2.5 rounded-card transition-colors duration-150 min-h-[44px] relative",
              isActive
                ? "nav-item-active"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
            )}
            onMouseEnter={() => onPrefetch(module.href)}
            data-testid={`module-${module.id}`}
            data-tour-nav={module.id}
          >
            <module.icon
              className={cn(
                "w-4 h-4 shrink-0",
                isActive ? "text-acr-ink" : "text-muted-foreground"
              )}
            />
            {showBadge && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{module.label}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="w-48 p-1.5 ml-1">
        <p className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wide">
          {module.label}
        </p>
        {(module.children ?? []).map((child) => {
          const childActive = isRouteActive(child.href);
          return (
            <Link
              key={child.href}
              href={child.href}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors duration-150 text-sm",
                childActive
                  ? "nav-item-active"
                  : "text-foreground hover:bg-accent active:bg-accent"
              )}
              onMouseEnter={() => onPrefetch(child.href)}
            >
              <child.icon className="w-3.5 h-3.5 shrink-0" />
              <span>{child.label}</span>
            </Link>
          );
        })}
        {/* Collapsed mode: popover already requires a click to open, so flatten
            primary + overflow into one list rather than nesting another
            disclosure. The visual divider preserves the primary/overflow
            grouping for users who scan the popover. */}
        {(module.overflow?.length ?? 0) > 0 && (
          <>
            <div className="my-1 border-t border-border" />
            {module.overflow!.map((child) => {
              const childActive = isRouteActive(child.href);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors duration-150 text-sm",
                    childActive
                      ? "nav-item-active"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent"
                  )}
                  onMouseEnter={() => onPrefetch(child.href)}
                >
                  <child.icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{child.label}</span>
                </Link>
              );
            })}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Simple desktop nav item helper (for founder link with custom accent)
// ─────────────────────────────────────────────────────────────────────
// Shared-element active pip for the desktop sidebar. A single `layoutId`
// per surface means the brand-color marker SLIDES from the previously-active
// row to the newly-active one when the route changes, rather than fading in
// place. The host row must be `position: relative` (the `.nav-item-active`
// class already is) and carry `nav-item-active--animated` so the static CSS
// ::before pip is suppressed. Under prefers-reduced-motion the app-level
// <MotionConfig reducedMotion="user"> disables the layout animation, so the
// pip simply appears instantly — no extra gating needed here.
function SidebarActivePip({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-sm bg-[var(--acr-brand)]"
      transition={navIndicatorSpring}
      aria-hidden="true"
    />
  );
}

function DesktopNavItem({
  href,
  icon: Icon,
  label,
  isActive,
  isCollapsed,
  accentClass,
  iconClass,
  testId,
  onMouseEnter,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  accentClass: string;
  iconClass: string;
  testId: string;
  onMouseEnter: () => void;
}) {
  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={cn(
              "flex items-center justify-center w-full p-2.5 rounded-card transition-all min-h-[44px]",
              accentClass
            )}
            onMouseEnter={onMouseEnter}
            data-testid={testId}
          >
            <Icon className={cn("w-4 h-4 shrink-0", iconClass)} />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-card transition-all mb-1 min-h-[44px]",
        accentClass
      )}
      onMouseEnter={onMouseEnter}
      data-testid={testId}
    >
      <Icon className={cn("w-4 h-4 shrink-0", iconClass)} />
      <span className="font-medium text-sm">{label}</span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4 of the Solene migration — new 5-door founder sidebar
// ─────────────────────────────────────────────────────────────────────
// Compact founder navigation: Today / Team / Customers / Money / Build,
// plus a Settings shortcut and a persistent "Chat with Solene" CTA that
// routes back to /founder/today (where the chat surface lives). The 31
// existing /founder/* pages stay routable — Solene opens them inline
// when relevant; they're listed in FOUNDER_NAV_DEEP_DIVES (nav-items.ts).
//
// Rendered by `Sidebar()` only when:
//   - user is a founder, AND
//   - useNewFounderUI() === true, AND
//   - the current route is under /founder/*
//
// Krieger-bar A11y discipline: every icon button has aria-label,
// every link has visible focus, touch targets ≥ 44×44.
// ─────────────────────────────────────────────────────────────────────
function NewFounderSidebar({
  location,
  isCollapsed,
  setIsCollapsed,
  brandName,
  onLogout,
}: {
  location: string;
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  brandName: string;
  onLogout: () => void;
}) {
  const isActive = (href: string) =>
    href === "/founder/today"
      ? location === "/founder/today" || location === "/founder"
      : location === href || location.startsWith(href + "/");

  return (
    <aside
      aria-label="Founder navigation"
      className={cn(
        "hidden md:flex flex-col fixed inset-y-0 left-0 z-floating m-2 rounded-xl border border-sidebar-border shadow-xl overflow-hidden sidebar-vibrancy sidebar-spring",
        isCollapsed ? "w-[68px]" : "w-64"
      )}
      data-testid="new-founder-sidebar"
    >
      <div className="flex flex-col h-full vibrancy-sidebar">
        {/* Header */}
        <div
          className={cn(
            "border-b border-sidebar-border transition-all duration-200",
            isCollapsed ? "p-3" : "p-4 md:p-5"
          )}
        >
          {isCollapsed ? (
            <div className="flex justify-center">
              <AcreosLogo variant="mark" size={32} />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 shrink">
                <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent shrink-0">
                  {brandName}
                </h1>
                <Badge
                  variant="outline"
                  className="bg-acr-warn/10 text-acr-warn border-acr-warn/30 text-micro px-1.5 py-0 shrink-0"
                  data-testid="badge-founder"
                >
                  <Crown className="w-2.5 h-2.5 mr-0.5" />
                  Founder
                </Badge>
              </div>
            </div>
          )}
          {!isCollapsed && (
            <p className="text-xs text-muted-foreground mt-1">
              Solene · Chief of Staff
            </p>
          )}
        </div>

        {/* Persistent chat CTA — wired (Phase 3) to the iOS-Claude-UX
            chat surface that consumes the Phase 2 backend. */}
        <div
          className={cn(
            "border-b border-sidebar-border",
            isCollapsed ? "px-2 py-2" : "px-3 py-2"
          )}
        >
          {isCollapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href="/founder/solene-chat"
                  className="flex items-center justify-center w-full p-2.5 rounded-card bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors min-h-[44px] shadow-sm"
                  aria-label="Chat with Solene"
                  data-testid="button-chat-solene-collapsed"
                >
                  <Sparkles className="w-4 h-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">Chat with Solene</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Link
              href="/founder/solene-chat"
              className="flex items-center gap-2 w-full px-3 py-2 rounded-card bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors min-h-[44px] text-sm font-medium shadow-sm"
              aria-label="Chat with Solene"
              data-testid="button-chat-solene"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left truncate">Chat with Solene</span>
            </Link>
          )}
        </div>

        {/* 5-door nav */}
        <nav
          aria-label="Founder doors"
          className="flex-1 px-2 py-3 space-y-1 overflow-y-auto overflow-x-hidden"
        >
          {FOUNDER_NAV_NEW_5_DOORS.map((door) => (
            <FounderDoorItem
              key={door.href}
              door={door}
              isActive={isActive(door.href)}
              isCollapsed={isCollapsed}
            />
          ))}

          {/* Secondary: the categorized index of every founder deep-dive.
              Keeps the ~70 surfaces beyond the 5 doors clickable + findable
              without a wall of links in the primary nav. */}
          <div
            className={cn(
              "my-1 border-t border-sidebar-border/60",
              isCollapsed ? "mx-2" : "mx-1"
            )}
            aria-hidden="true"
          />
          <FounderDoorItem
            door={FOUNDER_NAV_ALL_TOOLS_SHORTCUT}
            isActive={isActive(FOUNDER_NAV_ALL_TOOLS_SHORTCUT.href)}
            isCollapsed={isCollapsed}
          />
        </nav>

        {/* Footer — Settings + theme + sign out */}
        <div className="p-3 border-t border-sidebar-border safe-area-bottom space-y-2">
          <FounderDoorItem
            door={FOUNDER_NAV_SETTINGS_SHORTCUT}
            isActive={isActive(FOUNDER_NAV_SETTINGS_SHORTCUT.href)}
            isCollapsed={isCollapsed}
          />
          {!isCollapsed && (
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-card text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors min-h-[44px]"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-testid="button-collapse-toggle"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 shrink-0" />
                <span className="font-medium text-sm">Collapse</span>
              </>
            )}
          </button>
          <button
            onClick={onLogout}
            data-testid="button-logout"
            className="flex items-center gap-3 px-3 py-2 w-full rounded-card text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:text-destructive active:bg-destructive/15 transition-colors min-h-[44px]"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!isCollapsed && (
              <span className="font-medium text-sm">Sign out</span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

function FounderDoorItem({
  door,
  isActive,
  isCollapsed,
}: {
  door: FounderNavDoor;
  isActive: boolean;
  isCollapsed: boolean;
}) {
  const Icon = door.icon;
  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            href={door.href}
            aria-label={door.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex items-center justify-center w-full p-2.5 rounded-card transition-colors min-h-[44px]",
              isActive
                ? "nav-item-active nav-item-active--animated"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
            )}
            data-testid={`founder-door-${door.label.toLowerCase()}`}
          >
            {isActive && (
              <SidebarActivePip
                layoutId={NAV_INDICATOR_LAYOUT_IDS.founderSidebar}
              />
            )}
            <Icon
              className={cn(
                "w-4 h-4 shrink-0",
                isActive ? "text-acr-ink" : "text-muted-foreground"
              )}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{door.label}</p>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            {door.description}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Link
          href={door.href}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-3 px-3 py-2.5 rounded-card transition-colors min-h-[44px]",
            isActive
              ? "nav-item-active nav-item-active--animated"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground"
          )}
          data-testid={`founder-door-${door.label.toLowerCase()}`}
        >
          {isActive && (
            <SidebarActivePip
              layoutId={NAV_INDICATOR_LAYOUT_IDS.founderSidebar}
            />
          )}
          <Icon
            className={cn(
              "w-4 h-4 shrink-0",
              isActive ? "text-acr-ink" : "text-muted-foreground"
            )}
          />
          <span className="font-medium text-sm truncate flex-1">
            {door.label}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">
        <p className="text-xs text-muted-foreground">{door.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
