/**
 * THE AGING LADDER BOARD — one component, both books.
 *
 * Renders an `AgingLadder` from `@shared/finance/agingLadder`. The rent ledger
 * (/rent-roll, behind Finance) and the acquired-notes book (/notes, behind
 * Finance) both mount THIS. There is no second board, and no surface restates
 * the rungs or their labels — both come out of `AGING_LADDER_BUCKETS`.
 *
 * ── THE FOUR HONESTY RULES THIS COMPONENT ENFORCES ─────────────────────────
 *
 * 1. AN EMPTY LEDGER IS NOT A ZEROED BOARD. `ladder.isEmpty` renders the
 *    caller's EmptyState. Five tiles reading $0.00 is the finding "you are
 *    owed nothing" — a different claim from "there is no ledger here yet", and
 *    the wrong one to make to someone who has not set up a lease.
 *
 * 2. AN INCOMPLETE TOTAL SAYS SO, IN THE TILE. When a bucket holds rows whose
 *    amount is unknown, the figure is prefixed "at least" and the tile carries
 *    the count of rows it could not price. A total that silently omits rows is
 *    a lie with a dollar sign on it.
 *
 * 3. NOT AGED IS ITS OWN TILE, NEVER FOLDED INTO CURRENT. A row with no due
 *    date has not been found to be current; it has not been measured at all.
 *    The tile is rendered whenever such rows exist, with the book's own reason
 *    for each one.
 *
 * 4. EXCLUDED ROWS ARE NAMED, NOT DROPPED. Anything held off the ladder
 *    (terminal notes, disputed balances) appears in a strip under the board
 *    with its count and the reason, so the board's totals can be reconciled
 *    against the ledger they came from.
 *
 * MONEY POSTURE: read-only. This board describes balances already recorded and
 * offers no action that moves money (founder ruling #15).
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, HelpCircle, EyeOff } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/animations";

import {
  AGING_LADDER_BUCKETS,
  NOT_AGED_ID,
  type AgingBucketId,
  type AgingLadder,
  type AgingSelection,
} from "@shared/finance/agingLadder";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Integer cents → "$1,234.56", formatted from the integer so no cent is ever
 * lost to a float. Shared by both books so the two boards format identically.
 */
export function centsExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Tone per rung. Severity is encoded in COLOUR and in ORDER, never in colour
 * alone — the labels carry the day ranges so the board reads without it.
 */
const RUNG_TONE: Record<AgingBucketId, string> = {
  current: "text-foreground",
  d1_30: "text-acr-warn",
  d31_60: "text-acr-warn",
  d61_90: "text-acr-neg",
  d90_plus: "text-acr-neg",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgingLadderBoardProps {
  ladder: AgingLadder;
  /** Rendered instead of the board when `ladder.isEmpty`. Required — rule 1. */
  emptyState: React.ReactNode;
  /**
   * Selected rung, or `null` for "all". Passing `onSelectBucket` makes the
   * tiles interactive so the operator can narrow the list below to exactly the
   * rows a bucket total is made of.
   */
  selectedBucket?: AgingSelection;
  onSelectBucket?: (bucket: AgingSelection) => void;
  /** Sentence naming what the board does and does not include. */
  scopeNote?: string;
  /** Prefix for `data-testid` so both books get distinct selectors. */
  testIdPrefix: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function AgingLadderBoard({
  ladder,
  emptyState,
  selectedBucket = null,
  onSelectBucket,
  scopeNote,
  testIdPrefix,
  className,
}: AgingLadderBoardProps) {
  // Rungs come from the engine's own table, in the engine's own order. The
  // board cannot show a rung the engine does not have, or omit one it does.
  const rungs = useMemo(
    () =>
      AGING_LADDER_BUCKETS.map((definition) => {
        const bucket = ladder.buckets.find((b) => b.id === definition.id);
        return { definition, bucket };
      }),
    [ladder],
  );

  if (ladder.isEmpty) {
    return <div data-testid={`${testIdPrefix}-empty`}>{emptyState}</div>;
  }

  const interactive = typeof onSelectBucket === "function";

  return (
    <div className={cn("space-y-3", className)} data-testid={`${testIdPrefix}-board`}>
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 md:grid-cols-5 gap-3 list-none p-0 m-0"
      >
        {rungs.map(({ definition, bucket }) => {
          const count = bucket?.count ?? 0;
          const totalCents = bucket?.totalCents ?? 0;
          const complete = bucket?.totalIsComplete ?? true;
          const unpriced = bucket?.unknownAmountCount ?? 0;
          const selected = selectedBucket === definition.id;

          const body = (
            <>
              <div className="text-xs text-muted-foreground">{definition.shortLabel}</div>
              <div
                className={cn("text-xl font-semibold tabular-nums", RUNG_TONE[definition.id])}
                data-testid={`${testIdPrefix}-total-${definition.id}`}
              >
                {/* Rule 2 — an incomplete total never prints as if it were the
                    answer. "At least" is the honest quantifier for a floor. */}
                {complete ? centsExact(totalCents) : `At least ${centsExact(totalCents)}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {count === 1 ? "1 row" : `${count} rows`}
              </div>
              {!complete && (
                <div
                  className="mt-1 flex items-start gap-1 text-xs text-acr-warn"
                  data-testid={`${testIdPrefix}-incomplete-${definition.id}`}
                >
                  <AlertTriangle className="w-3 h-3 mt-[2px] shrink-0" aria-hidden="true" />
                  <span>
                    {unpriced === 1
                      ? "1 row here has no amount on file, so this total is a floor."
                      : `${unpriced} rows here have no amount on file, so this total is a floor.`}
                  </span>
                </div>
              )}
            </>
          );

          return (
            <motion.li key={definition.id} variants={staggerItem}>
              {interactive ? (
                <button
                  type="button"
                  onClick={() => onSelectBucket!(selected ? null : definition.id)}
                  aria-pressed={selected}
                  aria-label={`${definition.label} — ${count} rows, ${
                    complete ? "total" : "at least"
                  } ${centsExact(totalCents)}`}
                  className={cn(
                    "w-full text-left rounded-card border bg-card border-card-border p-3",
                    "transition-colors hover:border-primary/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    selected && "border-primary ring-1 ring-primary",
                  )}
                  data-testid={`${testIdPrefix}-bucket-${definition.id}`}
                >
                  {body}
                </button>
              ) : (
                <Card className="p-3 h-full" data-testid={`${testIdPrefix}-bucket-${definition.id}`}>
                  {body}
                </Card>
              )}
            </motion.li>
          );
        })}
      </motion.ul>

      {/* Rule 3 — NOT AGED is its own tile. Only rendered when it has rows: an
          always-present empty tile would train the eye to ignore it. */}
      {ladder.notAged.count > 0 && (
        <NotAgedPanel
          ladder={ladder}
          testIdPrefix={testIdPrefix}
          selected={selectedBucket === NOT_AGED_ID}
          onSelect={
            interactive
              ? () => onSelectBucket!(selectedBucket === NOT_AGED_ID ? null : NOT_AGED_ID)
              : undefined
          }
        />
      )}

      {/* Rule 4 — excluded rows are named. */}
      {ladder.excluded.count > 0 && (
        <div
          className="rounded-card border border-card-border bg-muted/40 p-3"
          data-testid={`${testIdPrefix}-excluded`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <EyeOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            {ladder.excluded.count === 1
              ? "1 row is held off this board"
              : `${ladder.excluded.count} rows are held off this board`}
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-none p-0">
            {ladder.excluded.byCode.map((entry) => (
              <li key={entry.code} data-testid={`${testIdPrefix}-excluded-${entry.code}`}>
                <span className="font-medium text-foreground">
                  {entry.count} · {centsExact(entry.totalCents)}
                </span>{" "}
                — {entry.reason ?? entry.code.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span data-testid={`${testIdPrefix}-aged-total`}>
          {/* The reconciliation line: what the five rungs add up to, stated so
              the board can be checked against the ledger under it. */}
          {ladder.totalIsComplete ? "Aged total" : "Aged total (a floor)"}:{" "}
          <span className="tabular-nums text-foreground font-medium">
            {centsExact(ladder.agedTotalCents)}
          </span>{" "}
          across{" "}
          {ladder.buckets.reduce((s, b) => s + b.count, 0)} rows, as of {ladder.asOf}
        </span>
        {scopeNote && <span data-testid={`${testIdPrefix}-scope`}>{scopeNote}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not aged
// ---------------------------------------------------------------------------

function NotAgedPanel({
  ladder,
  testIdPrefix,
  selected,
  onSelect,
}: {
  ladder: AgingLadder;
  testIdPrefix: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  const { count, totalCents, totalIsComplete, unknownAmountCount } = ladder.notAged;

  const inner = (
    <>
      <div className="flex items-center gap-2">
        <HelpCircle className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium">
          {count === 1 ? "1 row is not aged" : `${count} rows are not aged`}
        </span>
        <Badge variant="outline" className="text-xs">
          not in Current
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        These have no due date on file, so there is nothing to measure against{" "}
        {ladder.asOf}. They are <strong>not</strong> counted as current — that would be a
        finding we have not made.{" "}
        {totalIsComplete
          ? `Balance held here: ${centsExact(totalCents)}.`
          : `${unknownAmountCount} of them have no amount on file either.`}
      </p>
    </>
  );

  return (
    <div data-testid={`${testIdPrefix}-not-aged`}>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Not aged — ${count} rows with no due date on file`}
          className={cn(
            "w-full text-left rounded-card border border-card-border bg-card p-3",
            "transition-colors hover:border-primary/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            selected && "border-primary ring-1 ring-primary",
          )}
          data-testid={`${testIdPrefix}-not-aged-button`}
        >
          {inner}
        </button>
      ) : (
        <div className="rounded-card border border-card-border bg-card p-3">{inner}</div>
      )}
    </div>
  );
}
