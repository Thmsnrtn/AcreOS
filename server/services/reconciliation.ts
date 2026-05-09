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
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

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
 * v0 fetcher dispatch. Each source-system / entity_type / aggregation_key
 * combination needs a real implementation to produce a number. This is
 * the registry — extend as new rules are added.
 */
async function fetchSourceTotal(
  sourceSystem: string,
  entityType: string,
  aggregationKey: string,
): Promise<number | null> {
  // Stripe MTD invoice total — placeholder; wire via Stripe SDK
  // when STRIPE_SECRET_KEY is available.
  if (sourceSystem === "stripe" && entityType === "invoice" && aggregationKey === "mtd_paid") {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const invoices = await stripe.invoices.list({
        status: "paid",
        created: { gte: Math.floor(start.getTime() / 1000) },
        limit: 100,
      });
      return invoices.data.reduce((s, i) => s + (i.amount_paid ?? 0), 0) / 100;
    } catch (err) {
      logger.warn("[reconciliation] Stripe fetch failed", err instanceof Error ? err : undefined);
      return null;
    }
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
  return null;
}

/**
 * Convenience for seed: ensure a default Stripe MTD reconciliation rule
 * exists. Call once at boot if you want auto-provisioned rules.
 */
export async function ensureDefaultRules(): Promise<void> {
  await db
    .insert(reconciliationRules)
    .values({
      sourceSystem: "stripe",
      entityType: "invoice",
      aggregationKey: "mtd_paid",
      toleranceDollars: "1.00" as any,
      enabled: true,
    })
    .onConflictDoNothing({
      target: [
        reconciliationRules.sourceSystem,
        reconciliationRules.entityType,
        reconciliationRules.aggregationKey,
      ],
    });
}
