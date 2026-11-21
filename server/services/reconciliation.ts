/**
 * Panel-300 #9 — reconciliation cron service.
 *
 * Adjacent-industries (Yusra) + executive-strategy (Marisol). Nightly
 * reconciliation across Stripe / wire / 1099 / SendGrid sources. For each
 * rule in `reconciliation_rules`, compute source-system total + AcreOS-side
 * total; if divergence > tolerance, persist a `reconciliation_runs` row
 * with status='divergent' and emit a system_alert.
 *
 * v0 implementation: rules table is the spec; this file ships the runner.
 * Source-system totals are pulled via vendor APIs (Stripe SDK, AWS SES,
 * etc.) when credentials are available — when not, the run is skipped
 * and logged as `status='failing'` with a clear error message.
 *
 * REC-DEF-1 (2026-11-21): the Stripe source total must never silently
 * collapse. Paid invoices whose Stripe customer cannot be resolved to an
 * AcreOS org — no customer, unknown customer, or the resolver itself
 * throwing — are EXCLUDED from the source total but REPORTED (count +
 * cents on the result and in the persisted run record). When any
 * unresolved amount exists, the resolved source total is only a lower
 * bound, so the run is `indeterminate`: no divergence is assessed, no
 * alert is raised, and no difference is persisted. See fetchStripeMtdPaid
 * / decideReconciliationStatus below.
 */

import { db } from "../db";
import { reconciliationRules, reconciliationRuns } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { storage } from "../storage";
import { clock } from "../utils/clock";

export interface ReconciliationResult {
  ruleId: string;
  status: "ok" | "divergent" | "failing" | "indeterminate";
  sourceTotal: number | null;
  acreosTotal: number | null;
  differenceDollars: number | null;
  errorMessage?: string;
  /** REC-DEF-1: paid Stripe invoices excluded from the source total
   *  because their customer could not be resolved to an AcreOS org. */
  unresolvedCount: number;
  unresolvedCents: number;
}

/**
 * REC-DEF-1 — the verdict for one rule, decided purely so the money-spine
 * semantics are testable without any I/O.
 *
 * Order matters:
 *  1. A missing total on either side is `failing` (nothing was compared).
 *  2. Any unresolved Stripe amount makes the run `indeterminate` BEFORE
 *     the tolerance comparison: the resolved source total is a lower
 *     bound, so a "difference" against it would be manufactured, not
 *     measured. No difference is reported and (in the caller) no alert
 *     is raised. Zero-amount unresolved invoices carry unresolvedCents
 *     of 0 and therefore cannot block a verdict — they cannot move a
 *     total — but they are still counted and reported by the caller.
 *  3. Fully resolved: ok within tolerance, divergent beyond it.
 */
function decideReconciliationStatus(input: {
  sourceTotal: number | null;
  acreosTotal: number | null;
  toleranceDollars: number;
  unresolvedCents: number;
}): {
  status: ReconciliationResult["status"];
  differenceDollars: number | null;
} {
  const { sourceTotal, acreosTotal, toleranceDollars, unresolvedCents } = input;
  if (sourceTotal == null || acreosTotal == null) {
    return { status: "failing", differenceDollars: null };
  }
  if (unresolvedCents > 0) {
    return { status: "indeterminate", differenceDollars: null };
  }
  const differenceDollars = sourceTotal - acreosTotal;
  return {
    status: Math.abs(differenceDollars) <= toleranceDollars ? "ok" : "divergent",
    differenceDollars,
  };
}

/**
 * Generic reconciliation runner — given a rule, computes source vs
 * AcreOS totals and writes a run row. Caller wires per-source-system
 * fetchers below.
 */
export async function runReconciliation(): Promise<ReconciliationResult[]> {
  const rules = await db
    .select()
    .from(reconciliationRules)
    .where(eq(reconciliationRules.enabled, true));

  const results: ReconciliationResult[] = [];

  for (const rule of rules) {
    let sourceTotal: number | null = null;
    let acreosTotal: number | null = null;
    let status: ReconciliationResult["status"] = "failing";
    let errorMessage: string | undefined;
    let differenceDollars: number | null = null;
    // REC-DEF-1: unresolved-customer Stripe invoices excluded from the
    // source total (see fetchStripeMtdPaid). Zero for non-Stripe rules.
    let unresolvedCount = 0;
    let unresolvedCents = 0;

    try {
      // Source system fetcher dispatch.
      const source = await fetchSourceTotal(rule.sourceSystem, rule.entityType, rule.aggregationKey);
      sourceTotal = source.total;
      if (source.stripeBreakdown) {
        unresolvedCount = source.stripeBreakdown.unresolvedCount;
        unresolvedCents = source.stripeBreakdown.unresolvedCents;
      }
      acreosTotal = await fetchAcreosTotal(rule.sourceSystem, rule.entityType, rule.aggregationKey);

      const decision = decideReconciliationStatus({
        sourceTotal,
        acreosTotal,
        toleranceDollars: Number(rule.toleranceDollars ?? 1),
        unresolvedCents,
      });
      status = decision.status;
      differenceDollars = decision.differenceDollars;

      if (status === "failing") {
        errorMessage = "Source or AcreOS total unavailable (missing credentials or query)";
      } else if (status === "indeterminate") {
        // Exclude-and-report: the run record itself carries what was
        // left out and why no verdict was reached, so the exclusion is
        // triageable from the record alone — never a silent $0.
        errorMessage =
          `INDETERMINATE (REC-DEF-1): ${unresolvedCount} paid Stripe invoice(s) totalling ` +
          `$${(unresolvedCents / 100).toFixed(2)} could not be resolved to an AcreOS organization ` +
          `and were EXCLUDED from the source total ($${(sourceTotal ?? 0).toFixed(2)} resolved). ` +
          `The source total is a lower bound, so no divergence was assessed and no alert was raised. ` +
          `Triage the unresolved customer(s): a real AcreOS customer whose org mapping is missing ` +
          `surfaces here instead of manufacturing a divergence page.`;
      } else if (unresolvedCount > 0) {
        // Only reachable with unresolvedCents === 0: reported, but a
        // zero-amount invoice cannot move a total, so the verdict stands.
        logger.warn(
          `[reconciliation] rule ${rule.id}: ${unresolvedCount} unresolved-customer Stripe invoice(s) ` +
            `totalling $0.00 excluded from the source total (zero amount — verdict unaffected)`,
        );
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(`[reconciliation] rule ${rule.id} failed`, err instanceof Error ? err : undefined);
    }

    try {
      await db.insert(reconciliationRuns).values({
        ruleId: rule.id,
        sourceTotal: sourceTotal != null ? String(sourceTotal) : null,
        acreosTotal: acreosTotal != null ? String(acreosTotal) : null,
        differenceDollars: differenceDollars != null ? String(differenceDollars) : null,
        status,
        errorMessage: errorMessage ?? null,
      });
      await db
        .update(reconciliationRules)
        .set({ lastRunAt: clock.now() })
        .where(eq(reconciliationRules.id, rule.id));
    } catch (writeErr) {
      logger.warn(
        `[reconciliation] persist failed for rule ${rule.id}`,
        writeErr instanceof Error ? writeErr : undefined,
      );
    }

    // Tier 1D: divergence goes through the ONE alert spine — a >$100 gap is
    // critical (pages, throttled) and any divergence lands as a finding +
    // the same system_alerts row /admin/alerts always showed. Tolerated if
    // the spine itself fails.
    //
    // Tier 2B: divergence on the financial_ledger rule (Stripe-truth vs the
    // money spine) is ALWAYS critical — any beyond-tolerance mismatch on the
    // system of record pages the founder via 1D, regardless of dollar size.
    if (status === "divergent" && differenceDollars != null) {
      try {
        const { raiseAlert } = await import("./alertSpine");
        await raiseAlert({
          severity:
            rule.aggregationKey === LEDGER_AGGREGATION_KEY ||
            Math.abs(differenceDollars) > 100
              ? "critical"
              : "warning",
          source: "reconciliation",
          title: `Reconciliation divergence: ${rule.sourceSystem} ${rule.aggregationKey}`,
          detail:
            `Source total $${sourceTotal} vs AcreOS total $${acreosTotal} ` +
            `(diff $${differenceDollars.toFixed(2)}). Tolerance was $${rule.toleranceDollars}.`,
          dedupeKey: `divergent:${rule.sourceSystem}:${rule.entityType}:${rule.aggregationKey}`,
          domain: "finance",
          citedReason:
            "Source-of-truth totals must reconcile within tolerance (Panel-300 #9; blueprint 2B: divergence pages via 1D).",
          alertType: "reconciliation_divergent",
          pagePriority: "P1",
          metadata: {
            ruleId: rule.id,
            sourceSystem: rule.sourceSystem,
            entityType: rule.entityType,
            aggregationKey: rule.aggregationKey,
            sourceTotal,
            acreosTotal,
            differenceDollars,
          },
        });
      } catch (alertErr) {
        logger.warn(
          "[reconciliation] alert spine raise failed",
          alertErr instanceof Error ? alertErr : undefined,
        );
      }
    }

    results.push({
      ruleId: rule.id,
      status,
      sourceTotal,
      acreosTotal,
      differenceDollars,
      errorMessage,
      unresolvedCount,
      unresolvedCents,
    });
  }

  return results;
}

/**
 * Tier 2B — the money-spine rule's aggregation key. Stripe MTD-paid invoice
 * total vs the sum of category='revenue' rows in financial_ledger (the five
 * bucket-split rows of every postRevenue sum to the gross amount_paid, so the
 * two totals must match to the cent when every webhook posting landed). Any
 * beyond-tolerance divergence on this rule is CRITICAL — it means money
 * Stripe collected never reached the system of record (or vice versa).
 */
export const LEDGER_AGGREGATION_KEY = "mtd_paid_ledger";

/** First moment of the current UTC month — both totals window on this. */
function utcMonthStart(): Date {
  const start = clock.now();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** One paid Stripe invoice, reduced to what the summarizer needs (cents). */
interface StripePaidInvoice {
  customer: string | null;
  amountPaidCents: number;
}

/**
 * REC-DEF-1 breakdown of the Stripe MTD paid-invoice population. The
 * resolved total is the source total a run compares; the unresolved
 * fields are what the old fetcher silently threw away.
 */
interface StripeMtdPaidBreakdown {
  /** Resolved (AcreOS-attributable) source total, dollars. */
  totalDollars: number;
  resolvedCount: number;
  resolvedCents: number;
  /** Paid invoices excluded because their customer did not resolve. */
  unresolvedCount: number;
  unresolvedCents: number;
  /** Distinct customers whose resolution THREW (a subset of unresolved). */
  resolverErrorCount: number;
}

/**
 * REC-DEF-1 — pure summarizer for the Stripe MTD paid population.
 *
 * An invoice is resolved ONLY when its customer is in
 * `resolvedCustomerIds`. Everything else is unresolved and reported:
 * invoices with no customer, invoices whose customer resolved to no org,
 * and invoices whose customer is in `resolverErrorCustomerIds` (the
 * resolver threw). The pre-cure code treated a resolver throw exactly
 * like a legitimate non-AcreOS customer — silently excluded — which is
 * how a resolution failure collapsed the source total to $0 and
 * manufactured a CRITICAL divergence page on staging (2026-11-19).
 * All arithmetic is integer cents; dollars are derived once at the end.
 */
function summarizeStripeMtdPaid(
  paid: StripePaidInvoice[],
  resolvedCustomerIds: ReadonlySet<string>,
  resolverErrorCustomerIds: ReadonlySet<string>,
): StripeMtdPaidBreakdown {
  let resolvedCount = 0;
  let resolvedCents = 0;
  let unresolvedCount = 0;
  let unresolvedCents = 0;
  for (const invoice of paid) {
    if (invoice.customer && resolvedCustomerIds.has(invoice.customer)) {
      resolvedCount += 1;
      resolvedCents += invoice.amountPaidCents;
    } else {
      unresolvedCount += 1;
      unresolvedCents += invoice.amountPaidCents;
    }
  }
  return {
    totalDollars: resolvedCents / 100,
    resolvedCount,
    resolvedCents,
    unresolvedCount,
    unresolvedCents,
    resolverErrorCount: resolverErrorCustomerIds.size,
  };
}

/**
 * Stripe MTD paid-invoice breakdown, paginated (the old single
 * `limit: 100` call silently under-counted past 100 invoices/month, which
 * would have FALSE-PAGED a divergence). Null when no credential, or when
 * the Stripe fetch itself fails (the run then reports `failing`).
 */
async function fetchStripeMtdPaid(): Promise<StripeMtdPaidBreakdown | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const createdGte = Math.floor(utcMonthStart().getTime() / 1000);
    // The account is SHARED with personal land sales + Foundry. Summing every
    // paid invoice would fold their money into AcreOS revenue and false-page a
    // divergence. Collect invoices first, then keep only those billed to an
    // AcreOS org (customer → org via the same resolver every webhook uses).
    // REC-DEF-1 trade-off, stated plainly: a customer with no org mapping is
    // indistinguishable at resolve time from an AcreOS customer whose mapping
    // is missing, so unresolved invoices are excluded-and-REPORTED and any
    // unresolved amount makes the run indeterminate (see the caller) rather
    // than guessed at in either direction.
    const paid: StripePaidInvoice[] = [];
    let startingAfter: string | undefined;
    // Hard cap of 50 pages (5,000 invoices/month) as a runaway guard.
    for (let page = 0; page < 50; page++) {
      const invoices = await stripe.invoices.list({
        status: "paid",
        created: { gte: createdGte },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const i of invoices.data) {
        const customer =
          typeof i.customer === "string" ? i.customer : (i.customer?.id ?? null);
        paid.push({ customer, amountPaidCents: i.amount_paid ?? 0 });
      }
      if (!invoices.has_more || invoices.data.length === 0) break;
      startingAfter = invoices.data[invoices.data.length - 1].id;
    }

    const customerIds = [
      ...new Set(paid.map((p) => p.customer).filter((c): c is string => !!c)),
    ];
    const acreosCustomers = new Set<string>();
    const resolverErrorCustomers = new Set<string>();
    await Promise.all(
      customerIds.map(async (id) => {
        try {
          if (await storage.getOrganizationByStripeCustomerId(id)) {
            acreosCustomers.add(id);
          }
        } catch {
          // REC-DEF-1: a resolver THROW is unresolved, never a silent
          // exclusion — the customer stays out of the resolved set (so
          // its invoices are counted unresolved by the summarizer) and
          // is tallied here so the failure is visible in the log.
          resolverErrorCustomers.add(id);
        }
      }),
    );

    const breakdown = summarizeStripeMtdPaid(paid, acreosCustomers, resolverErrorCustomers);
    if (breakdown.unresolvedCount > 0) {
      logger.warn(
        `[reconciliation] ${breakdown.unresolvedCount} paid Stripe invoice(s) totalling ` +
          `$${(breakdown.unresolvedCents / 100).toFixed(2)} excluded from the source total: ` +
          `customer did not resolve to an AcreOS organization ` +
          `(${breakdown.resolverErrorCount} resolver error(s))`,
      );
    }
    return breakdown;
  } catch (err) {
    logger.warn("[reconciliation] Stripe fetch failed", err instanceof Error ? err : undefined);
    return null;
  }
}

/**
 * v0 fetcher dispatch. Each source-system / entity_type / aggregation_key
 * combination needs a real implementation to produce a number. This is
 * the registry — extend as new rules are added. The Stripe fetcher also
 * returns its REC-DEF-1 breakdown so the runner can report (and gate the
 * verdict on) invoices it had to exclude.
 */
async function fetchSourceTotal(
  sourceSystem: string,
  entityType: string,
  aggregationKey: string,
): Promise<{ total: number | null; stripeBreakdown: StripeMtdPaidBreakdown | null }> {
  // Both Stripe rules share the same source-of-truth total: MTD paid invoices.
  if (
    sourceSystem === "stripe" &&
    entityType === "invoice" &&
    (aggregationKey === "mtd_paid" || aggregationKey === LEDGER_AGGREGATION_KEY)
  ) {
    const stripeBreakdown = await fetchStripeMtdPaid();
    return { total: stripeBreakdown?.totalDollars ?? null, stripeBreakdown };
  }
  return { total: null, stripeBreakdown: null };
}

/**
 * POPULATION DEFINITIONS (REC-DEF-1 secondary finding — documented, not
 * unified). The two AcreOS totals below measure DIFFERENT populations by
 * design, and neither is expected to equal the other:
 *
 *  - `mtd_paid` reads revenue_recognition_periods — SCHEDULE-DRIVEN
 *    ASC 606 recognition: one row per active paid-tier org at the catalog
 *    price (yearly plans recognized at 1/12 per month), whether or not
 *    an invoice was actually paid that month.
 *  - `mtd_paid_ledger` reads financial_ledger — EVENT-DRIVEN cash:
 *    postRevenue bucket splits written only when a paid-invoice webhook
 *    (or its dead-letter replay) lands, at the actual amount_paid.
 *
 * They legitimately diverge on: yearly-billing timing, unpaid/failed
 * invoices for still-active orgs, dead-letter replay lag, discounts vs
 * catalog price, and single-path fixtures (the staging instance behind
 * REC-DEF-1: org 107's $99 recognition row had no webhook posting, while
 * orgs 23/25's $98 of ledger postings had no recognition rows — neither
 * side was wrong). Each rule separately promises its own comparison
 * against Stripe cash; that per-rule comparison is what this runner
 * verdicts on.
 */
async function fetchAcreosTotal(
  sourceSystem: string,
  entityType: string,
  aggregationKey: string,
): Promise<number | null> {
  // Stripe MTD paid → sum recognized_cents from revenue_recognition_periods
  // for the current period_key.
  if (sourceSystem === "stripe" && entityType === "invoice" && aggregationKey === "mtd_paid") {
    const { revenueRecognitionPeriods } = await import("@shared/schema");
    const { currentPeriodKey } = await import("./revenueRecognition");
    const period = currentPeriodKey();
    const [row] = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${revenueRecognitionPeriods.recognizedCents}), 0)`,
      })
      .from(revenueRecognitionPeriods)
      .where(eq(revenueRecognitionPeriods.periodKey, period));
    return Number(row?.sum ?? 0) / 100;
  }
  // Tier 2B — Stripe MTD paid vs financial_ledger revenue rows (the money
  // spine). postRevenue's five bucket splits all carry category='revenue'
  // and sum to the gross amount_paid, so SUM(amount_cents) over the month
  // equals Stripe's MTD-paid total when every posting landed.
  if (
    sourceSystem === "stripe" &&
    entityType === "invoice" &&
    aggregationKey === LEDGER_AGGREGATION_KEY
  ) {
    const { financialLedger } = await import("@shared/schema");
    const [row] = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${financialLedger.amountCents}), 0)`,
      })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.category, "revenue"),
          gte(financialLedger.postedAt, utcMonthStart()),
        ),
      );
    return Number(row?.sum ?? 0) / 100;
  }
  return null;
}

/**
 * Ensure the default reconciliation rules exist. Called by the daily
 * reconciliation cron before each run (Tier 2B activation — previously this
 * was never invoked anywhere, so the rules table stayed empty in prod and the
 * cron was a registered no-op).
 */
export async function ensureDefaultRules(): Promise<void> {
  await db
    .insert(reconciliationRules)
    .values([
      {
        sourceSystem: "stripe",
        entityType: "invoice",
        aggregationKey: "mtd_paid",
        toleranceDollars: "1.00" as any,
        enabled: true,
      },
      // Tier 2B — Stripe-truth vs financial_ledger (system of record).
      {
        sourceSystem: "stripe",
        entityType: "invoice",
        aggregationKey: LEDGER_AGGREGATION_KEY,
        toleranceDollars: "1.00" as any,
        enabled: true,
      },
    ])
    .onConflictDoNothing({
      target: [
        reconciliationRules.sourceSystem,
        reconciliationRules.entityType,
        reconciliationRules.aggregationKey,
      ],
    });
}
