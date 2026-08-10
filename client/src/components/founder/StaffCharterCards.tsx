/**
 * StaffCharterCards — the Staff tab of the Controls hub (Wave S · S1).
 *
 * The Trust Ledger's domains rendered as PEOPLE-SHAPED charters: mandate,
 * this week's numbers (or honest absence), current level + streak, the eyes
 * (core senses, each honestly marked wired / can't-see-yet), the hands (all
 * derived server-side from the real registry), the last three proof receipts,
 * and one "review charter" affordance deep-linking into the Story.
 *
 * Honesty doctrine, same as every founder surface:
 *   - Every number arrives from /api/founder/autopilot/charters where it was
 *     read from a real source or set to null — a null renders "no data yet",
 *     never a guessed zero.
 *   - The blindness lines (StaffBlindnessLines, rendered in the Letter) are
 *     the SAME unwired-sense derivation the S2 promotion gate enforces, so
 *     what the founder reads and what the ladder refuses can never disagree.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, Eye, EyeOff, Hand, ScrollText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { PrefetchLink } from "@/components/prefetch-link";
import { usd, formatRelative } from "@/lib/format";

// ── Response shapes (mirror server/services/autopilot/charters.ts) ──────────

interface CharterSense {
  key: string;
  label: string;
  wired: boolean;
  gap?: string;
}
interface CharterMetric {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "usd" | "pct";
}
interface CharterLadder {
  onLedger: boolean;
  level?: string;
  cleanCycleCount?: number;
  threshold?: number;
  lastDemotedAt?: string | null;
  lastDemotionReason?: string | null;
  promotionBlockedReason?: string | null;
  note?: string;
}
interface StaffCharter {
  domain: string;
  displayName: string;
  role: string;
  mandate: string;
  metricsOwned: CharterMetric[];
  coreSenses: CharterSense[];
  handsGranted: Array<{ name: string; witnessed: boolean }>;
  standingOrders: string[];
  ladder: CharterLadder;
  budget: { effectiveCapUsd: number; mtdSpendUsd: number } | null;
  escalationRules: string[];
  reportCadence: string;
  receipts: Array<{ atIso: string | null; line: string }>;
}
interface BlindSpot {
  senseKey: string;
  label: string;
  blinds: string[];
  line: string;
}
interface ChartersResponse {
  charters: StaffCharter[];
  blindSpots: BlindSpot[];
}

const CHARTERS_KEY = ["/api/founder/autopilot/charters"];

function useCharters() {
  return useQuery<ChartersResponse>({
    queryKey: CHARTERS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/founder/autopilot/charters")).json(),
    staleTime: 60 * 1000,
  });
}

// CEO-plain level words (same vocabulary as the Control Center's trust dials).
const LEVEL_LABEL: Record<string, string> = {
  observe: "Watching only",
  draft: "Drafts — you approve",
  execute_gated: "Acts — safety-checked",
  autonomous_gated: "Independent — safety-checked",
};

function metricValue(m: CharterMetric): string {
  if (m.value == null) return "no data yet";
  if (m.unit === "usd") return usd(m.value, { noCents: true });
  if (m.unit === "pct") return `${m.value.toFixed(1)}%`;
  return String(m.value);
}

// ── The Staff tab (Controls hub) ────────────────────────────────────────────

export function StaffCharterCards() {
  const { data, isLoading, error, refetch } = useCharters();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return <QueryErrorState error={error as Error} onRetry={() => refetch()} title="Couldn't load the staff charters" />;
  }
  const charters = data?.charters ?? [];
  if (charters.length === 0) {
    return <QueryErrorState error={new Error("No charters returned")} onRetry={() => refetch()} title="No charters yet" />;
  }

  return (
    <motion.div
      className="grid gap-4 md:grid-cols-2"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      data-testid="staff-charter-cards"
    >
      {charters.map((c) => (
        <motion.div key={c.domain} variants={staggerItem}>
          <CharterCard charter={c} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function CharterCard({ charter: c }: { charter: StaffCharter }) {
  const streak =
    c.ladder.onLedger && c.ladder.cleanCycleCount != null && c.ladder.threshold != null
      ? `${c.ladder.cleanCycleCount} of ${c.ladder.threshold} clean cycles toward the next rung`
      : null;
  return (
    <Card className="h-full" data-testid={`charter-card-${c.domain}`}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        {/* Who + where they stand */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{c.displayName}</p>
            <p className="text-xs text-muted-foreground">{c.role}</p>
          </div>
          {c.ladder.onLedger && c.ladder.level ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {LEVEL_LABEL[c.ladder.level] ?? c.ladder.level}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              Off the ladder
            </Badge>
          )}
        </div>

        {/* The mandate — the employment agreement, in one paragraph */}
        <p className="text-xs leading-relaxed text-muted-foreground">{c.mandate}</p>

        {/* Ladder standing — streak, off-ledger note, or the S2 block reason */}
        {streak && <p className="text-[11px] tabular-nums text-muted-foreground">{streak}</p>}
        {!c.ladder.onLedger && c.ladder.note && (
          <p className="text-[11px] text-muted-foreground">{c.ladder.note}</p>
        )}
        {c.ladder.promotionBlockedReason && (
          <p
            className="rounded-md border border-acr-warn/30 bg-acr-warn/5 p-2 text-[11px] leading-relaxed text-muted-foreground"
            data-testid={`charter-promotion-blocked-${c.domain}`}
          >
            {c.ladder.promotionBlockedReason}
          </p>
        )}

        {/* This week's numbers — real values or honest absence */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">This week's numbers</p>
          <ul role="list" className="mt-1 space-y-0.5">
            {c.metricsOwned.map((m) => (
              <li key={m.key} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 text-muted-foreground">{m.label}</span>
                <span className={`shrink-0 tabular-nums ${m.value == null ? "text-muted-foreground" : "font-medium text-foreground"}`}>
                  {metricValue(m)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* The eyes — every core sense, wired or honestly not */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Eyes</p>
          <ul role="list" className="mt-1 space-y-0.5">
            {c.coreSenses.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-xs">
                {s.wired ? (
                  <Eye className="h-3 w-3 shrink-0 text-acr-pos" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-3 w-3 shrink-0 text-acr-warn" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 text-muted-foreground">{s.label}</span>
                {!s.wired && (
                  <span className="shrink-0 text-[10px] text-acr-warn">can't see yet</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* The hands — derived from the real registry; none is an honest state */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Hands</p>
          {c.handsGranted.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No hands yet — judgment only.</p>
          ) : (
            <ul role="list" className="mt-1 flex flex-wrap gap-1">
              {c.handsGranted.map((h) => (
                <li key={h.name}>
                  <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                    <Hand className="h-2.5 w-2.5" aria-hidden="true" />
                    {h.name}
                    {h.witnessed ? " · your tap" : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Last three receipts — real proof-receipt rows, or the honest absence */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent receipts</p>
          {c.receipts.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No witnessed actions yet.</p>
          ) : (
            <ul role="list" className="mt-1 space-y-0.5">
              {c.receipts.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.atIso ? formatRelative(r.atIso) : "—"}
                  </span>
                  <span className="min-w-0 text-foreground">{r.line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Review charter — the audit trail behind everything above */}
        <div className="mt-auto pt-1">
          <PrefetchLink
            href="/founder/autopilot/story"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover-elevate"
            data-testid={`charter-review-${c.domain}`}
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
            Review charter in the Story
            <ArrowUpRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </PrefetchLink>
        </div>
      </CardContent>
    </Card>
  );
}

// ── The Letter's blindness lines (Wave S · S2) ──────────────────────────────

/**
 * "I cannot yet see X" — rendered in the Letter, derived server-side from the
 * charter registry's unwired core senses (the same derivation the promotion
 * gate enforces). Auxiliary-signal discipline, same as StepAwayLine: renders
 * nothing while loading, an honest muted line on failure, and nothing at all
 * when there are no blind spots (silence is the honest state).
 */
export function StaffBlindnessLines() {
  const { data, isError } = useCharters();
  if (isError) {
    return (
      <p
        className="rounded-lg border border-border bg-card/60 p-3 text-sm text-muted-foreground"
        data-testid="letter-blindness-error"
      >
        Couldn't read the staff charters just now — that's about this page, not what the staff can see.
      </p>
    );
  }
  if (!data || data.blindSpots.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="letter-blindness-lines">
      <div className="flex items-center gap-2">
        <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">What I can't see yet</p>
      </div>
      <ul role="list" className="mt-2 space-y-1">
        {data.blindSpots.map((b) => (
          <li key={b.senseKey} className="text-xs leading-relaxed text-muted-foreground">
            {b.line}
          </li>
        ))}
      </ul>
      <PrefetchLink
        href="/founder/autopilot/control?tab=staff"
        className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        The staff and their charters <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </PrefetchLink>
    </div>
  );
}
