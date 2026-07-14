/**
 * SOLENE — tick metric: the two numbers every cycle opens with.
 *
 * Kernel-restructure work-order step 5 (founder directive 2026-07-13):
 * "The Letter and the tick's own success criteria must open with two
 * numbers every cycle: (a) customer-visible/revenue-relevant outcomes
 * shipped, (b) founder decisions consumed vs. budget. A machine graded
 * only on restraint optimizes for restraint."
 *
 * The budget is CONSTITUTIONAL — FOUNDER_MINUTES_BUDGET from the
 * sovereign-protocol immutables loader (classABDecisionsPerWeek),
 * never a local constant that can drift from the amendment process.
 *
 * HONESTY CONTRACT — what metric (a) counts and what it does NOT:
 *
 *   COUNTED:     solene_dispatch_queue rows that reached status
 *                'completed' in the trailing 7 days, excluding internal
 *                machinery (code_review / self_debug / adversarial_test)
 *                — i.e. real agent work with an outward work product.
 *
 *   NOT COUNTED: production deploys and merged PRs (not tracked in the
 *                DB today), reflex-layer autonomic actions, and content
 *                that shipped through any path other than the dispatch
 *                queue. The breakdown string says so explicitly, so a
 *                founder reading the number knows the counter's blind
 *                spots. When those sources gain honest DB records they
 *                should be folded in here — never estimated.
 *
 * Metric (c) — verification COVERAGE (Jarvis Phase 1, CP4) — counts, over
 * the SAME trailing 7 days, work that entered the verification pipeline:
 *
 *   COUNTED:     completed solene_dispatch_queue rows whose review_status
 *                is not null (pending | passed | flagged | skipped — the
 *                unified verification state from CP1-CP3), completed
 *                import_jobs with a verify_status, and SENT mail_shipments
 *                with a verify_status. N = passed verdicts, M = all of the
 *                above. pending/flagged/skipped count in M but not N, so
 *                unfinished or failed verification honestly lowers coverage.
 *
 *   NOT COUNTED: work that never entered the verify pipeline (null
 *                review_status / verify_status — pre-CP2 rows, dispatch
 *                disabled, enqueue failures). The breakdown string names
 *                this blind spot so "verified: N/M" is read as coverage of
 *                the PIPELINE, not of everything the machine did.
 *
 * Metric (b) counts what the autonomy-score (v14) tables record over the
 * trailing 7 days: cascade resolutions that escalated to the founder
 * (cascade_resolutions.founder_escalated) plus founder overrides
 * (founder_overrides) plus founder-resolved decision-inbox cards
 * (decisions_inbox_items, Jarvis 2.3). Decisions are not yet classified
 * A/B/C per row, so EVERY founder-consumed decision counts against the
 * Class-A/B budget — conservative: it can overcount founder attention,
 * never undercount it. Founder-collab asks that never left the Solene
 * surface are NOT double-counted here.
 *
 * Week = trailing 7 days from `now` (injectable for tests). Both metrics
 * re-apply the window in process so the arithmetic is pinned by unit
 * tests independent of the SQL layer; the SQL WHERE clauses keep the
 * scans cheap in production.
 */

import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { cascadeResolutions, decisionsInboxItems, founderOverrides, importJobs, mailShipments } from "@shared/schema";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dispatch source types that improve the machine rather than ship anything
 * a customer (or the revenue line) can see. Excluded from metric (a).
 */
const INTERNAL_DISPATCH_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "code_review",
  "self_debug",
  "adversarial_test",
]);

export interface TickMetric {
  /** Metric (a): completed outward dispatches in the trailing 7 days. */
  revenueRelevantShippedThisWeek: number;
  /** Plain-language account of what (a) counted — and its blind spots. */
  shippedBreakdown: string;
  /** Metric (b): founder decisions consumed in the trailing 7 days. */
  founderDecisionsThisWeek: number;
  /** Constitutional weekly Class-A/B decision budget. */
  founderDecisionsBudget: number;
  /** Provenance of the budget — always the sovereign-protocol immutables. */
  budgetSource: "constitution";
  /** Metric (c): verifiables whose verdict is 'passed', trailing 7 days. */
  verifiedPassed: number;
  /** Verifiables whose verdict is 'flagged', trailing 7 days. */
  verifiedFlagged: number;
  /**
   * Everything that entered the verification pipeline this week: completed
   * dispatches with a review_status + completed imports and sent mail
   * shipments with a verify_status. 0 is an honest "nothing verifiable".
   */
  verifiablesTotal: number;
  /** Per-component account of (c) — and the pipeline's blind spot. */
  verificationBreakdown: string;
}

/**
 * Compute the two numbers for the trailing 7 days ending at `now`.
 *
 * Throws on a genuine read failure — callers (the Letter, the tick, the
 * morning pulse) degrade to an explicit "unmeasured" line rather than a
 * fabricated zero.
 */
export async function getTickMetric(now: Date = new Date()): Promise<TickMetric> {
  const weekStart = new Date(now.getTime() - WEEK_MS);

  // ── Metric (a): completed outward dispatches, trailing 7 days ────────────
  const dispatchRows = await db
    .select({
      status: soleneDispatchQueue.status,
      sourceType: soleneDispatchQueue.sourceType,
      completedAt: soleneDispatchQueue.completedAt,
      reviewStatus: soleneDispatchQueue.reviewStatus,
    })
    .from(soleneDispatchQueue)
    .where(
      and(
        eq(soleneDispatchQueue.status, "completed"),
        gte(soleneDispatchQueue.completedAt, weekStart),
      ),
    );

  const shipped = dispatchRows.filter(
    (r) =>
      r.status === "completed" &&
      r.completedAt != null &&
      inTrailingWeek(r.completedAt, now) &&
      !INTERNAL_DISPATCH_SOURCE_TYPES.has(r.sourceType),
  ).length;

  // ── Metric (c): verification coverage, trailing 7 days ──────────────────
  // Dispatch component rides the metric-(a) query above (same completed +
  // window row set); a non-null review_status means the row entered the
  // CP1-CP3 verification pipeline.
  const verifiableDispatches = dispatchRows.filter(
    (r) =>
      r.status === "completed" &&
      r.completedAt != null &&
      inTrailingWeek(r.completedAt, now) &&
      r.reviewStatus != null,
  );

  const importRows = await db
    .select({
      status: importJobs.status,
      verifyStatus: importJobs.verifyStatus,
      completedAt: importJobs.completedAt,
    })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.status, "completed"),
        isNotNull(importJobs.verifyStatus),
        gte(importJobs.completedAt, weekStart),
      ),
    );
  const verifiableImports = importRows.filter(
    (r) =>
      r.status === "completed" &&
      r.verifyStatus != null &&
      r.completedAt != null &&
      inTrailingWeek(r.completedAt, now),
  );

  const mailRows = await db
    .select({
      status: mailShipments.status,
      verifyStatus: mailShipments.verifyStatus,
      sentAt: mailShipments.sentAt,
    })
    .from(mailShipments)
    .where(
      and(
        eq(mailShipments.status, "sent"),
        isNotNull(mailShipments.verifyStatus),
        gte(mailShipments.sentAt, weekStart),
      ),
    );
  const verifiableMail = mailRows.filter(
    (r) =>
      r.status === "sent" &&
      r.verifyStatus != null &&
      r.sentAt != null &&
      inTrailingWeek(r.sentAt, now),
  );

  const dispatchVerdicts = countVerdicts(verifiableDispatches.map((r) => r.reviewStatus));
  const importVerdicts = countVerdicts(verifiableImports.map((r) => r.verifyStatus));
  const mailVerdicts = countVerdicts(verifiableMail.map((r) => r.verifyStatus));

  const verifiedPassed = dispatchVerdicts.passed + importVerdicts.passed + mailVerdicts.passed;
  const verifiedFlagged = dispatchVerdicts.flagged + importVerdicts.flagged + mailVerdicts.flagged;
  const verifiablesTotal = dispatchVerdicts.total + importVerdicts.total + mailVerdicts.total;

  // ── Metric (b): founder decisions consumed, trailing 7 days ─────────────
  const founderDecisionsThisWeek = await countFounderDecisionsThisWeek(now);

  return {
    revenueRelevantShippedThisWeek: shipped,
    shippedBreakdown: renderShippedBreakdown(shipped),
    founderDecisionsThisWeek,
    founderDecisionsBudget: FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek,
    budgetSource: "constitution",
    verifiedPassed,
    verifiedFlagged,
    verifiablesTotal,
    verificationBreakdown: renderVerificationBreakdown(
      dispatchVerdicts,
      importVerdicts,
      mailVerdicts,
      verifiedFlagged,
      verifiablesTotal,
    ),
  };
}

/**
 * Metric (b) counting seam — founder decisions consumed in the trailing
 * 7 days ending at `now`: cascade resolutions that escalated to the founder,
 * founder overrides, and founder-resolved decision-inbox cards (Jarvis 2.3).
 * Exported on its own (Jarvis 2.2) because the
 * founder interrupt arbiter uses THIS SAME COUNT as the numerator of its
 * Class-B budget gate — the gate and the Letter can never disagree about
 * how many founder decisions this week consumed.
 *
 * Throws on a genuine read failure — callers degrade honestly (the metric
 * renders "unmeasured"; the arbiter fails CLOSED-quiet), never a fabricated
 * zero.
 */
export async function countFounderDecisionsThisWeek(now: Date = new Date()): Promise<number> {
  const weekStart = new Date(now.getTime() - WEEK_MS);

  const escalationRows = await db
    .select({
      founderEscalated: cascadeResolutions.founderEscalated,
      createdAt: cascadeResolutions.createdAt,
    })
    .from(cascadeResolutions)
    .where(
      and(
        eq(cascadeResolutions.founderEscalated, true),
        gte(cascadeResolutions.createdAt, weekStart),
      ),
    );

  const overrideRows = await db
    .select({ createdAt: founderOverrides.createdAt })
    .from(founderOverrides)
    .where(gte(founderOverrides.createdAt, weekStart));

  // Jarvis 2.3 — founder answers on decision-inbox cards are real founder
  // decisions and count against the same budget (they escaped this counter
  // before). Double-count risk with the cascade term is nil today: inbox
  // items never originate from cascade_resolutions rows (entirely different
  // sources). If a creator ever starts minting inbox items FROM cascade
  // escalations, this join must dedupe on that linkage before summing.
  const inboxRows = await db
    .select({
      status: decisionsInboxItems.status,
      resolvedBy: decisionsInboxItems.resolvedBy,
      resolvedAt: decisionsInboxItems.resolvedAt,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        eq(decisionsInboxItems.resolvedBy, "founder"),
        inArray(decisionsInboxItems.status, ["approved", "rejected"]),
        gte(decisionsInboxItems.resolvedAt, weekStart),
      ),
    );

  return (
    escalationRows.filter(
      (r) => r.founderEscalated === true && r.createdAt != null && inTrailingWeek(r.createdAt, now),
    ).length +
    overrideRows.filter((r) => r.createdAt != null && inTrailingWeek(r.createdAt, now)).length +
    inboxRows.filter(
      (r) =>
        r.resolvedBy === "founder" &&
        (r.status === "approved" || r.status === "rejected") &&
        r.resolvedAt != null &&
        inTrailingWeek(r.resolvedAt, now),
    ).length
  );
}

/**
 * The canonical opener — the two numbers plus verification coverage (CP4).
 * Used verbatim as the first content line of The Letter; the tick logs the
 * same fields as structured metadata.
 */
export function renderTickMetricLine(m: TickMetric): string {
  return (
    `Shipped for customers this week: ${m.revenueRelevantShippedThisWeek} (${m.shippedBreakdown}). ` +
    `Founder decisions consumed: ${m.founderDecisionsThisWeek} of ${m.founderDecisionsBudget} budget. ` +
    `Verified: ${m.verifiedPassed}/${m.verifiablesTotal} (${m.verificationBreakdown}).`
  );
}

function renderShippedBreakdown(shipped: number): string {
  // Honest about the blind spots in every rendering — including zero.
  const notCounted = "deploys and merged PRs not counted yet";
  return shipped === 0
    ? `no completed outward dispatches; ${notCounted}`
    : `${shipped} completed outward dispatch${shipped === 1 ? "" : "es"}; internal review/debug machinery excluded; ${notCounted}`;
}

interface VerdictCounts {
  passed: number;
  flagged: number;
  total: number;
}

function countVerdicts(verdicts: Array<string | null>): VerdictCounts {
  return {
    passed: verdicts.filter((v) => v === "passed").length,
    flagged: verdicts.filter((v) => v === "flagged").length,
    total: verdicts.length,
  };
}

/**
 * Names each component of the coverage denominator honestly. The blind spot
 * is structural, so it is stated on every non-zero rendering: work that
 * never entered the verify pipeline (null review_status / verify_status)
 * is invisible to this number — never estimated in.
 */
function renderVerificationBreakdown(
  dispatches: VerdictCounts,
  imports: VerdictCounts,
  mail: VerdictCounts,
  verifiedFlagged: number,
  verifiablesTotal: number,
): string {
  if (verifiablesTotal === 0) return "nothing verifiable this week";
  const component = (label: string, c: VerdictCounts): string =>
    c.total === 0 ? `${label} 0 verifiable` : `${label} ${c.passed}/${c.total} passed`;
  const parts = [
    component("dispatches", dispatches),
    component("imports", imports),
    component("mail", mail),
  ].join(", ");
  const flaggedNote = verifiedFlagged > 0 ? `; ${verifiedFlagged} flagged` : "";
  return `${parts}${flaggedNote}; work that never entered the verify pipeline is not counted`;
}

function inTrailingWeek(ts: Date, now: Date): boolean {
  const t = ts.getTime();
  return t > now.getTime() - WEEK_MS && t <= now.getTime();
}
