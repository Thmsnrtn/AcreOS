/**
 * The Glass Engine — the "peek inside the machine" view on the Story door.
 *
 * The same records the timeline renders, seen as a machine: the six-stage
 * thinking loop with real counts, and the five trust lanes showing exactly how
 * much rope each domain has earned. Nothing here is illustrative — every
 * number derives from recorded moves (deriveLoopStats) or the live trust
 * ledger, and anything unrecorded says so plainly instead of pretending.
 */

import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  Eye,
  BrainCircuit,
  ShieldCheck,
  Hand,
  Target,
  GraduationCap,
  Lock,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { formatRelative } from "@/lib/format";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  deriveLoopStats,
  levelFill,
  ENGINE_LEVEL_LABEL,
  type EngineEntry,
  type EngineLedgerEntry,
  type LoopStats,
} from "@/lib/glass-engine";

interface ControlData {
  ledger: EngineLedgerEntry[];
  calibration: { grade: string; n: number } | null;
}

function levelTone(level: string): string {
  return level === "autonomous_gated"
    ? "text-acr-pos"
    : level === "execute_gated"
      ? "text-primary"
      : level === "draft"
        ? "text-acr-warn"
        : "text-muted-foreground";
}

function levelBarTone(level: string): string {
  return level === "autonomous_gated"
    ? "bg-acr-pos"
    : level === "execute_gated"
      ? "bg-primary"
      : level === "draft"
        ? "bg-acr-warn"
        : "bg-muted-foreground/40";
}

function prettyDomain(d: string) {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

interface Stage {
  key: string;
  icon: typeof Eye;
  name: string;
  line: string;
  stat: (s: LoopStats, calibration: ControlData["calibration"]) => string | null;
}

/**
 * The six stages of every cycle. Each stat() returns a REAL derived line or
 * null — null renders the honest "nothing recorded yet" state, never a sample.
 */
const STAGES: Stage[] = [
  {
    key: "senses",
    icon: Eye,
    name: "Senses",
    line: "Reads the company's vitals before every move.",
    stat: (s) =>
      s.latestSenses
        ? `Last reading: ${s.latestSenses.summary}`
        : null,
  },
  {
    key: "brain",
    icon: BrainCircuit,
    name: "Brain",
    line: "Weighs its options and forecasts honestly before choosing.",
    stat: (s, calibration) => {
      const parts: string[] = [];
      if (s.latestOptionsWeighed !== null) parts.push(`${s.latestOptionsWeighed} option${s.latestOptionsWeighed === 1 ? "" : "s"} weighed on the latest move`);
      if (s.forecastsMade > 0) parts.push(`${s.forecastsMade} honest forecast${s.forecastsMade === 1 ? "" : "s"} made`);
      if (calibration && calibration.n > 0) parts.push(`forecast grade ${calibration.grade} over ${calibration.n} scored`);
      return parts.length > 0 ? parts.join(" · ") : null;
    },
  },
  {
    key: "gates",
    icon: ShieldCheck,
    name: "Gates",
    line: "Every move passes the full safety stack — or stops here.",
    stat: (s) =>
      s.recordedMoves > 0
        ? `${s.gates.cleared} cleared · ${s.gates.askedYou} asked you · ${s.gates.held} held`
        : null,
  },
  {
    key: "hands",
    icon: Hand,
    name: "Hands",
    line: "Only gate-cleared moves ever reach the outside world.",
    stat: (s) => (s.recordedMoves > 0 ? `${s.acted} move${s.acted === 1 ? "" : "s"} went out` : null),
  },
  {
    key: "outcomes",
    icon: Target,
    name: "Outcomes",
    line: "Each move is scored against what it predicted.",
    stat: (s) =>
      s.recordedMoves > 0
        ? `${s.outcomes.wentWell} went well · ${s.outcomes.didntLand} didn't land · ${s.outcomes.pending} not yet scored`
        : null,
  },
  {
    key: "learning",
    icon: GraduationCap,
    name: "Learning",
    line: "Lessons feed the next cycle; clean runs earn trust slowly.",
    stat: (s) =>
      s.lessonsRemembered > 0
        ? `${s.lessonsRemembered} lesson${s.lessonsRemembered === 1 ? "" : "s"} carried forward`
        : null,
  },
];

/** The four constitutional hard-stops — founder-only forever, never earnable. */
const FOREVER_GATES = ["Pricing changes", "Legal signing", "Spends over $500", "Customer-data deletion"];

function LoopStage({ stage, stats, calibration }: { stage: Stage; stats: LoopStats; calibration: ControlData["calibration"] }) {
  const Icon = stage.icon;
  const stat = stage.stat(stats, calibration);
  return (
    <motion.li variants={staggerItem} className="relative flex gap-3 md:flex-col md:gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{stage.name}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{stage.line}</p>
        {stat ? (
          <p className="mt-1.5 text-xs font-medium text-foreground/90" data-testid={`engine-stat-${stage.key}`}>
            {stat}
          </p>
        ) : (
          <p className="mt-1.5 text-xs italic text-muted-foreground" data-testid={`engine-stat-${stage.key}-empty`}>
            Nothing recorded yet.
          </p>
        )}
      </div>
    </motion.li>
  );
}

function TrustLane({ entry }: { entry: EngineLedgerEntry }) {
  const fill = levelFill(entry.level);
  const label = ENGINE_LEVEL_LABEL[entry.level] ?? entry.level;
  const towardNext =
    entry.level !== "autonomous_gated" && entry.threshold > 0
      ? `${Math.min(entry.cleanCycleCount, entry.threshold)} of ${entry.threshold} clean cycles toward the next level`
      : null;
  return (
    <motion.li variants={staggerItem} className="space-y-1.5" data-testid={`engine-lane-${entry.domain}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{prettyDomain(entry.domain)}</span>
        <span className={`text-xs font-medium ${levelTone(entry.level)}`}>{label}</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${prettyDomain(entry.domain)}: ${label}, level ${Math.round(fill * 3) + 1} of 4`}
      >
        <div
          className={`h-full rounded-full transition-all ${levelBarTone(entry.level)}`}
          style={{ width: `${Math.max(fill * 100, 4)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {towardNext ?? "At the highest earnable level — still fully gated."}
        {entry.shadowLine ? ` · ${entry.shadowLine}` : ""}
      </p>
    </motion.li>
  );
}

export function GlassEngine({ entries }: { entries: EngineEntry[] }) {
  const reduceMotion = useReducedMotion();
  const stats = deriveLoopStats(entries);

  const control = useQuery<ControlData>({
    queryKey: ["/api/founder/autopilot/control"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/control", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load the trust ledger (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-6">
      {/* ── The thinking loop ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-serif text-xl font-semibold text-foreground">The thinking loop</h2>
            <p className="text-xs text-muted-foreground" data-testid="engine-loop-caption">
              {stats.recordedMoves > 0
                ? `Derived from the last ${stats.recordedMoves} recorded move${stats.recordedMoves === 1 ? "" : "s"}${stats.lastMoveAt ? ` · latest ${formatRelative(stats.lastMoveAt)}` : ""}`
                : "The loop hasn't made a recorded move yet — the structure below is how it will think."}
            </p>
          </div>
          {/* The cycle line: a quiet flow indicator, animated only when the
              loop has actually moved (a pulsing line over an empty history
              would fabricate liveness). */}
          <div className="mt-4 h-px w-full overflow-hidden bg-border" aria-hidden="true">
            {stats.recordedMoves > 0 && !reduceMotion && (
              <motion.div
                className="h-full w-1/4 bg-gradient-to-r from-transparent via-primary to-transparent"
                animate={{ x: ["-100%", "500%"] }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              />
            )}
          </div>
          <motion.ol
            variants={staggerContainer}
            className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
          >
            {STAGES.map((stage) => (
              <LoopStage key={stage.key} stage={stage} stats={stats} calibration={control.data?.calibration ?? null} />
            ))}
          </motion.ol>
        </CardContent>
      </Card>

      {/* ── The five trust lanes ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <h2 className="font-serif text-xl font-semibold text-foreground">How much rope each part has earned</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Autonomy is earned per domain, one clean cycle at a time — and every level still passes the full gate
            stack. Grant or pause any lane from Controls.
          </p>
          {control.isLoading ? (
            <div className="mt-4 space-y-3" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : control.isError ? (
            <QueryErrorState
              error={control.error instanceof Error ? control.error : new Error("Failed")}
              title="Couldn't read the trust ledger"
              description="The lanes render only from the live ledger — nothing is shown from memory."
              onRetry={() => void control.refetch()}
              compact
              className="mt-4"
              testId="engine-lanes-error"
            />
          ) : (control.data?.ledger.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm italic text-muted-foreground" data-testid="engine-lanes-empty">
              The trust ledger is empty — lanes appear once the domains are seeded.
            </p>
          ) : (
            <motion.ul variants={staggerContainer} className="mt-4 space-y-4">
              {control.data!.ledger.map((entry) => (
                <TrustLane key={entry.domain} entry={entry} />
              ))}
            </motion.ul>
          )}
        </CardContent>
      </Card>

      {/* ── The gates that never open ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-serif text-xl font-semibold text-foreground">Yours forever</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Four decisions no amount of earned trust ever unlocks — the machine can only bring them to you:
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {FOREVER_GATES.map((g) => (
              <li
                key={g}
                className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground"
              >
                {g}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}
