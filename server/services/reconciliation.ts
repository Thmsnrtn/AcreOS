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
 */

import { db } from "../db";
import { reconciliationRules, reconciliationRuns } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { storage } from "../storage";

export interface ReconciliationResult {
  ruleId: string;
  status: "ok" | "divergent" | "failing";
  sourceTotal: number | null;
  acreosTotal: number | null;
  differenceDollars: number | null;
  errorMessage?: string;
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

    try {
      // Source system fetcher dispatch.
      sourceTotal = await fetchSourceTotal(rule.sourceSystem, rule.entityType, rule.aggregationKey);
      acreosTotal = await fetchAcreosTotal(rule.sourceSystem, rule.entityType, rule.aggregationKey);

      if (sourceTotal == null || acreosTotal == null) {
        status = "failing";
        errorMessage = "Source or AcreOS total unavailable (missing credentials or query)";
      } else {
        const diff = Math.abs(sourceTotal - acreosTotal);
        const tolerance = Number(rule.toleranceDollars ?? 1);
        status = diff <= tolerance ? "ok" : "divergent";
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(`[reconciliation] rule ${rule.id} failed`, err instanceof Error ? err : undefined);
    }

    const differenceDollars =
      sourceTotal != null && acreosTotal != null ? sourceTotal - acreosTotal : null;

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
        .set({ lastRunAt: new Date() })
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
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Stripe MTD paid-invoice total in dollars, paginated (the old single
 * `limit: 100` call silently under-counted past 100 invoices/month, which
 * would have FALSE-PAGED a divergence). Null when no credential.
 */
async function fetchStripeMtdPaidTotal(): Promise<number | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const createdGte = Math.floor(utcMonthStart().getTime() / 1000);
    // The account is SHARED with personal land sales + Foundry. Summing every
    // paid invoice would fold their money into AcreOS revenue and false-page a
    // divergence. Collect invoices first, then keep only those billed to an
    // AcreOS org (customer → org via the same resolver every webhook uses).
    const paid: Array<{ customer: string | null; amountPaid: number }> = [];
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
        paid.push({ customer, amountPaid: i.amount_paid ?? 0 });
      }
      if (!invoices.has_more || invoices.data.length === 0) break;
      startingAfter = invoices.data[invoices.data.length - 1].id;
    }

    const customerIds = [
      ...new Set(paid.map((p) => p.customer).filter((c): c is string => !!c)),
    ];
    const acreosCustomers = new Set<string>();
    await Promise.all(
      customerIds.map(async (id) => {
        try {
          if (await storage.getOrganizationByStripeCustomerId(id)) {
            acreosCustomers.add(id);
          }
        } catch {
          /* unresolved customer → treated as non-AcreOS, excluded */
        }
      }),
    );

    const totalCents = paid
      .filter((p) => p.customer && acreosCustomers.has(p.customer))
      .reduce((s, p) => s + p.amountPaid, 0);
    return totalCents / 100;
  } catch (err) {
    logger.warn("[reconciliation] Stripe fetch failed", err instanceof Error ? err : undefined);
    return null;
  }
}

/**
 * v0 fetcher dispatch. Each source-system / entity_type / aggregation_key
 * combination needs a real implementation to produce a number. This is
 * the registry — extend as new rules are added.
 */
async function fetchSourceTotal(
  sourceSystem: string,
  entityType: string,
  aggregationKey: string,
): Promise<number | null> {
  // Both Stripe rules share the same source-of-truth total: MTD paid invoices.
  if (
    sourceSystem === "stripe" &&
    entityType === "invoice" &&
    (aggregationKey === "mtd_paid" || aggregationKey === LEDGER_AGGREGATION_KEY)
  ) {
    return fetchStripeMtdPaidTotal();
  }
  return null;
}

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
