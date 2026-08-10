/**
 * ScenarioMatrix — the Scenarios tab of the Story door (Wave S · S4).
 *
 * The scenario library rendered as the founder reads it: grouped by
 * responsible charter, each row showing its trigger (wired / can't-see-yet /
 * human-observed — derived server-side, never asserted), its playbook ref,
 * the founder-touch contract (runs quietly / your queue / pages you), the
 * declared autonomy REQUIREMENT (never a grant — the ladder is the only
 * place levels change), and the honest drill state ("never drilled" where no
 * ledger block exists; a due badge where the cadence has lapsed).
 *
 * Honesty pins (tests/unit/scenarioLibrary.test.ts):
 *   - a page row with no pager wire renders "declared, not yet wired to a pager";
 *   - a row with no drill record renders "never drilled" — no invented dates.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BellRing, BookOpenText, Eye, EyeOff, Inbox, MoonStar, User } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";

// ── Response shapes (mirror server/services/autopilot/scenarioLibrary.ts) ───

type ScenarioTrigger =
  | { kind: "sense"; senseKey: string; description: string }
  | { kind: "event"; literal: string; module: string; description: string }
  | { kind: "human"; description: string };

type ScenarioPlaybook =
  | { kind: "runbook"; ref: string }
  | { kind: "standing-order"; ref: string }
  | { kind: "builtin"; module: string; symbol: string };

interface ScenarioView {
  key: string;
  title: string;
  responsibleCharter: string;
  charterDisplayName: string;
  charterRole: string;
  trigger: ScenarioTrigger;
  playbook: ScenarioPlaybook;
  autonomyRequired: string;
  founderTouch: "none" | "queue" | "page";
  triggerWired: boolean;
  triggerEvidence: "sense-consumed" | "event-literal" | "human";
  pagerState: "wired" | "declared-not-wired" | null;
  drillCadence: "quarterly" | "annual" | "on-change" | null;
  lastDrilled: string | null;
  drillDue: boolean;
  notes?: string;
}

interface ScenarioLibraryResponse {
  generatedAt: string;
  scenarios: ScenarioView[];
  drillsDue: number;
  pagesDeclaredUnwired: number;
}

const SCENARIOS_KEY = ["/api/founder/autopilot/scenarios"];

// CEO-plain vocabulary — same discipline as the staff cards' LEVEL_LABEL.
const AUTONOMY_LABEL: Record<string, string> = {
  observe: "Needs: watching only",
  draft: "Needs: drafting rights",
  execute_gated: "Needs: gated action rights",
  autonomous_gated: "Needs: independent (gated) rights",
  "founder-only": "Always you — no staff autonomy, ever",
};

const TOUCH_META: Record<ScenarioView["founderTouch"], { label: string; icon: typeof Inbox; className: string }> = {
  none: { label: "runs quietly", icon: MoonStar, className: "border-border text-muted-foreground" },
  queue: { label: "your queue", icon: Inbox, className: "border-primary/40 text-primary" },
  page: { label: "pages you", icon: BellRing, className: "border-destructive/40 text-destructive" },
};

const CADENCE_LABEL: Record<NonNullable<ScenarioView["drillCadence"]>, string> = {
  quarterly: "quarterly drill",
  annual: "annual drill",
  "on-change": "drill on change",
};

function playbookRef(p: ScenarioPlaybook): string {
  if (p.kind === "builtin") return `${p.module} · ${p.symbol}`;
  return p.ref;
}

function triggerBadge(s: ScenarioView) {
  if (s.trigger.kind === "human") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
        <User className="h-2.5 w-2.5" aria-hidden="true" />
        human-observed
      </Badge>
    );
  }
  // An event row's evidence is a verified literal, NOT a consumed sense —
  // it gets its own badge rather than borrowing the stronger claim
  // (fleet-8 verifier note: a dormant emitter would still read "wired").
  if (s.triggerEvidence === "event-literal") {
    return (
      <Badge variant="outline" className="gap-1 border-acr-accent/40 text-[10px] text-acr-accent">
        <Eye className="h-2.5 w-2.5" aria-hidden="true" />
        event kind verified
      </Badge>
    );
  }
  return s.triggerWired ? (
    <Badge variant="outline" className="gap-1 border-acr-pos/40 text-[10px] text-acr-pos">
      <Eye className="h-2.5 w-2.5" aria-hidden="true" />
      trigger wired
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 border-acr-warn/40 text-[10px] text-acr-warn">
      <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />
      trigger not yet wired
    </Badge>
  );
}

function drillLine(s: ScenarioView): { text: string; due: boolean } | null {
  if (s.drillCadence === null) return null;
  const cadence = CADENCE_LABEL[s.drillCadence];
  if (s.lastDrilled === null) {
    return { text: `${cadence} — never drilled`, due: s.drillDue };
  }
  return { text: `${cadence} — last drilled ${s.lastDrilled}`, due: s.drillDue };
}

function ScenarioRowItem({ s }: { s: ScenarioView }) {
  const touch = TOUCH_META[s.founderTouch];
  const TouchIcon = touch.icon;
  const drill = drillLine(s);
  return (
    <motion.li
      variants={staggerItem}
      className="border-b border-border/60 px-2 py-3 last:border-0"
      data-testid={`scenario-row-${s.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{s.title}</span>
        <Badge variant="outline" className={`gap-1 text-[10px] ${touch.className}`}>
          <TouchIcon className="h-2.5 w-2.5" aria-hidden="true" />
          {touch.label}
        </Badge>
        {triggerBadge(s)}
        {drill?.due && (
          <Badge variant="outline" className="border-acr-warn/40 text-[10px] text-acr-warn" data-testid={`scenario-drill-due-${s.key}`}>
            drill due
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.trigger.description}</p>
      <p className="mt-1 flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground/80 break-all">
        <BookOpenText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {playbookRef(s.playbook)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {AUTONOMY_LABEL[s.autonomyRequired] ?? s.autonomyRequired}
        {drill ? <span className="tabular-nums"> · {drill.text}</span> : null}
      </p>
      {s.pagerState === "declared-not-wired" && (
        <p
          className="mt-1.5 rounded-md border border-acr-warn/30 bg-acr-warn/5 p-2 text-[11px] leading-relaxed text-muted-foreground"
          data-testid={`scenario-pager-gap-${s.key}`}
        >
          Paging declared, not yet wired to a pager — this row commits the humans, not a machine.
        </p>
      )}
      {s.notes && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">{s.notes}</p>}
    </motion.li>
  );
}

/**
 * The Scenarios tab. Self-contained fetch (same pattern as the governance
 * section) so a timeline hiccup never hides the doctrine.
 */
export function ScenarioMatrix() {
  const { data, isLoading, error, refetch } = useQuery<ScenarioLibraryResponse>({
    queryKey: SCENARIOS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/founder/autopilot/scenarios")).json(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <QueryErrorState
        error={error instanceof Error ? error : new Error("Failed")}
        title="Couldn't read the scenario library"
        onRetry={() => void refetch()}
      />
    );
  }

  // Group by charter, preserving the server's (charter-registry) order.
  const groups: Array<{ charter: string; role: string; rows: ScenarioView[] }> = [];
  for (const s of data.scenarios) {
    const g = groups.find((x) => x.charter === s.charterDisplayName);
    if (g) g.rows.push(s);
    else groups.push({ charter: s.charterDisplayName, role: s.charterRole, rows: [s] });
  }

  return (
    <div className="space-y-4" data-testid="scenario-matrix">
      {/* The derived rollup — drills due + pager debt, both honest counts. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3" data-testid="scenario-drills-due">
          <p className="text-xs text-muted-foreground">Drills due</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">{data.drillsDue}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {data.drillsDue === 0
              ? "Every drilled row is inside its cadence."
              : "Rows whose drill cadence has lapsed or that have never been drilled. Game-days that walk them are scheduled by you — nothing runs itself."}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3" data-testid="scenario-pager-debt">
          <p className="text-xs text-muted-foreground">Page rules without a pager wire</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">{data.pagesDeclaredUnwired}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {data.pagesDeclaredUnwired === 0
              ? "Every always-page row names a real paging path."
              : "Rows declared always-page that no machine can fire yet — shown honestly until wired."}
          </p>
        </div>
      </div>

      {groups.map((g) => (
        <Card key={g.charter}>
          <CardContent className="p-2 sm:p-3">
            <div className="px-2 pt-2">
              <h2 className="text-sm font-semibold text-foreground">{g.charter}</h2>
              {g.role && <p className="text-xs text-muted-foreground">{g.role}</p>}
            </div>
            <motion.ul role="list" className="mt-2" variants={staggerContainer} initial="hidden" animate="visible">
              {g.rows.map((s) => (
                <ScenarioRowItem key={s.key} s={s} />
              ))}
            </motion.ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
