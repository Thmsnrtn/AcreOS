import { lazy, Suspense, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  MoreHorizontal,
  Activity,
  Bot,
  Zap,
  Scale,
  SlidersHorizontal,
  ArrowUpRight,
} from "lucide-react";
import { DURATIONS, EASINGS } from "@/lib/motion-tokens";
import { PAX_CONTROLS_PATH, PAX_LABELS } from "@shared/pax-glossary";

// The standalone pages re-homed from the old peer tabs. Lazy so opening Pax
// doesn't ship them in the parent chunk — each loads on demand when the
// matching drawer opens.
const ActivityPage = lazy(() => import("@/pages/activity"));
// Quinn + Rafe — the customer recourse surface ("appeal the AI"). Lazy so it
// only loads when the Appeals drawer opens.
const PaxRecoursePanel = lazy(() =>
  import("@/components/pax/pax-recourse-panel").then((m) => ({
    default: m.PaxRecoursePanel,
  })),
);
// AgentCommandCenterPage archived 2026-06-01 — agents drawer now deep-links
// to /founder/agent-queue via the "Full page" button in the sheet header.

// Drawer lazy-load fallback — canonical motion tokens.
function DrawerFallback() {
  return (
    <motion.div
      className="flex items-center justify-center py-20"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATIONS.normal, ease: EASINGS.linearExpo }}
    >
      <span className="text-sm text-acr-ink-3">Loading…</span>
    </motion.div>
  );
}

type SheetView = "activity" | "agents" | "appeals" | null;

/** `/ai#appeals` — the footer's Appeals link opens the drawer from the page body. */
const APPEALS_HASH = "#appeals";

const SHEET_META: Record<
  Exclude<SheetView, null>,
  { title: string; description: string; route: string; routeLabel: string; founderOnly?: true }
> = {
  activity: {
    title: PAX_LABELS.receipts,
    description: "Every change Pax made and every rule that ran — when, what, which record, and whether you asked.",
    route: "/activity?actor=pax",
    routeLabel: "Open the full receipts page",
  },
  agents: {
    // Founder-only (spec §3b "founder-only entries stay gated"): the customer
    // menu is Controls · What Pax did · Appeals. `founderOnly` is the ONE
    // gate — the drawer's header, its "Full page" link to the founder route
    // and its body all hang off it, so a customer cannot reach this wording
    // even if `view` were set to "agents" some other way.
    founderOnly: true,
    title: "Agents",
    description: "The agent roster working behind Pax.",
    route: "/founder/agent-queue",
    routeLabel: "Open Agent Queue",
  },
  appeals: {
    title: "Appeals",
    description:
      "When Pax declines a request, see the rule it followed — and appeal it.",
    route: "/pax",
    routeLabel: "Stay on Pax",
  },
};

/**
 * Header overflow menu for the Pax conversation: Controls · What Pax did ·
 * Appeals (the Pax controls spec §3b), plus the founder-only Agents drawer and the
 * Automation link. Controls navigates to the ONE Pax control surface
 * (Settings → Pax); "What Pax did" opens the receipts feed (activity_log rows
 * with agent_type = 'pax', read through GET /api/pax/receipts) in a Sheet;
 * Appeals lives entirely in its drawer. The old "Insights" entry (a banned
 * menu label with fabricated dollar badges) is gone.
 */
export function PaxOverflowMenu() {
  const { isFounder } = useAuth();
  const [view, setView] = useState<SheetView>(null);

  // The /ai footer's "Appeals" text link is `/ai#appeals`: open the drawer
  // when the hash says so (on mount and on later hash changes), then clear
  // the hash so closing the drawer does not re-open it on the next render.
  useEffect(() => {
    const openFromHash = () => {
      if (typeof window === "undefined" || window.location.hash !== APPEALS_HASH) return;
      requestAnimationFrame(() => setView("appeals"));
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  // The founder gate for the drawer as a whole. Before this, only the drawer
  // BODY read `isFounder` — the header (title, description, "Full page" link
  // to /founder/agent-queue) rendered for whoever `view` named.
  const requested = view ? SHEET_META[view] : null;
  const meta = requested && (!requested.founderOnly || isFounder) ? requested : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="More Pax tools and history"
            data-testid="pax-overflow-trigger"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Pax</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild data-testid="pax-menu-controls">
            <Link href={PAX_CONTROLS_PATH}>
              <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
              Controls
              <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              // On iOS, DropdownMenu close and Sheet open happen in the same
              // synchronous batch. The SheetOverlay (frosted backdrop z-60)
              // renders before SheetContent slides in, producing a blank frosted
              // screen for the full 500ms open animation. Deferring via rAF
              // lets the dropdown finish its close cycle before the Sheet mounts.
              e.preventDefault();
              requestAnimationFrame(() => setView("activity"));
            }}
            data-testid="pax-menu-activity"
          >
            <Activity className="mr-2 h-4 w-4" aria-hidden="true" />
            {PAX_LABELS.receipts}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              requestAnimationFrame(() => setView("appeals"));
            }}
            data-testid="pax-menu-appeals"
          >
            <Scale className="mr-2 h-4 w-4" aria-hidden="true" />
            Appeals
          </DropdownMenuItem>
          {isFounder && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                requestAnimationFrame(() => setView("agents"));
              }}
              data-testid="pax-menu-agents"
            >
              <Bot className="mr-2 h-4 w-4" aria-hidden="true" />
              Agents
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild data-testid="pax-menu-automation">
            <Link href="/automation">
              <Zap className="mr-2 h-4 w-4" aria-hidden="true" />
              Automation
              <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={meta !== null} onOpenChange={(open) => !open && setView(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl flex flex-col overflow-hidden p-0"
          data-testid="pax-tool-drawer"
        >
          {meta && (
            <>
              <SheetHeader className="px-6 pt-6 pb-4 border-b text-left space-y-1">
                <div className="flex items-center justify-between gap-4 pr-8">
                  <SheetTitle>{meta.title}</SheetTitle>
                  {/* Appeals live entirely in this drawer (no separate full
                      page — it's already behind the Pax door), so no link. */}
                  {view !== "appeals" && (
                    <Button variant="ghost" size="sm" className="gap-1 text-xs shrink-0" asChild>
                      <Link href={meta.route} aria-label={meta.routeLabel}>
                        Full page
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                  )}
                </div>
                <SheetDescription>{meta.description}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {view === "activity" && (
                  <Suspense fallback={<DrawerFallback />}>
                    {/* embedded — the Sheet lives inside the app shell;
                        without it ActivityPage nested a second sidebar/topbar
                        and a duplicate id="main-content" (T0-9). The Pax
                        filter is the receipts feed. */}
                    <ActivityPage embedded initialFilter="pax" />
                  </Suspense>
                )}
                {view === "appeals" && (
                  <Suspense fallback={<DrawerFallback />}>
                    <PaxRecoursePanel />
                  </Suspense>
                )}
                {view === "agents" && isFounder && (
                  /* Agent Command Center archived 2026-06-01 — use the
                     "Full page" button above to navigate to /founder/agent-queue. */
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Open the agent queue via the Full page link above.
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
