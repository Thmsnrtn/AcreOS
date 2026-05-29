import { lazy, Suspense, useState } from "react";
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
  Sparkles,
  ArrowUpRight,
} from "lucide-react";

// The standalone pages re-homed from the old peer tabs. Lazy so opening Pax
// doesn't ship them in the parent chunk — each loads on demand when the
// matching drawer opens.
const ActivityPage = lazy(() => import("@/pages/activity"));
const AgentCommandCenterPage = lazy(() => import("@/pages/agent-command-center"));

function DrawerFallback() {
  return (
    <div
      className="flex items-center justify-center py-20"
      role="status"
      aria-live="polite"
    >
      <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
    </div>
  );
}

type SheetView = "activity" | "agents" | "insights" | null;

const SHEET_META: Record<
  Exclude<SheetView, null>,
  { title: string; description: string; route: string; routeLabel: string }
> = {
  activity: {
    title: "What Pax did",
    description: "A running log of the actions Pax has taken for you.",
    route: "/activity",
    routeLabel: "Open Activity full page",
  },
  agents: {
    title: "Agents",
    description: "The agent roster working behind Pax.",
    route: "/agent-command-center",
    routeLabel: "Open Agents full page",
  },
  insights: {
    title: "Insights",
    description: "What Pax is watching across your pipeline.",
    route: "/pipeline",
    routeLabel: "Go to pipeline",
  },
};

/**
 * Header overflow menu for the Pax conversation. Re-homes the capabilities
 * that used to be peer tabs (Activity / Agents / Automation / Insights) so the
 * conversation stays the single primary surface. Activity, Agents and Insights
 * open in a right-side Sheet (reusing the existing standalone pages / insights
 * panel); Automation navigates to its standalone route.
 *
 * `insightsContent` is passed in so this component stays free of the insights
 * data dependency — the page owns that query and renders it here when the
 * Insights drawer opens.
 */
export function PaxOverflowMenu({
  insightsContent,
}: {
  insightsContent: React.ReactNode;
}) {
  const { isFounder } = useAuth();
  const [view, setView] = useState<SheetView>(null);

  const meta = view ? SHEET_META[view] : null;

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
          <DropdownMenuLabel>Pax tools</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setView("insights")}
            data-testid="pax-menu-insights"
          >
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            Insights
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setView("activity")}
            data-testid="pax-menu-activity"
          >
            <Activity className="mr-2 h-4 w-4" aria-hidden="true" />
            What Pax did
          </DropdownMenuItem>
          {isFounder && (
            <DropdownMenuItem
              onSelect={() => setView("agents")}
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

      <Sheet open={view !== null} onOpenChange={(open) => !open && setView(null)}>
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
                  <Button variant="ghost" size="sm" className="gap-1 text-xs shrink-0" asChild>
                    <Link href={meta.route} aria-label={meta.routeLabel}>
                      Full page
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
                <SheetDescription>{meta.description}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {view === "insights" && insightsContent}
                {view === "activity" && (
                  <Suspense fallback={<DrawerFallback />}>
                    <ActivityPage />
                  </Suspense>
                )}
                {view === "agents" && isFounder && (
                  <Suspense fallback={<DrawerFallback />}>
                    <AgentCommandCenterPage />
                  </Suspense>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
