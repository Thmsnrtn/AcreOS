/**
 * FW-THEO-1 + FW-INDIRA-1 (push-forward 2026-05-08): per-org AI cost ceiling.
 *
 * Per the panel: any single org's daily AI cost should never exceed a
 * configured ceiling without explicit founder override. Theo frames as
 * cost discipline; Indira frames as runaway-loop protection (the
 * agent-loop-runaway runbook trips at $50/24h).
 *
 * Defaults:
 *   PLATFORM_DEFAULT_DAILY_CEILING_CENTS = 5000  ($50/day per org)
 *   PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS = 100000 ($1,000/month per org)
 *
 * Founder can set per-org overrides via ai_cost_ceiling_overrides. The
 * aiRouter consults this helper before routing a paid call; if the org
 * is at-or-over the ceiling, the call is rejected with an explicit
 * AiCostCeilingExceededError that the agent surfaces back to the
 * customer ("AI is paused for today; contact support@acreos.com").
 */

import { db } from "../db";
import { aiCostCeilingOverrides, aiTelemetryEvents } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const PLATFORM_DEFAULT_DAILY_CEILING_CENTS = 5000;
const PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS = 100_000;

export class AiCostCeilingExceededError extends Error {
  readonly code = "AI_COST_CEILING_EXCEEDED" as const;
  constructor(
    public readonly orgId: number,
    public readonly windowKey: "daily" | "monthly",
    public readonly currentCents: number,
    public readonly ceilingCents: number,
  ) {
    super(
      `AI cost ceiling exceeded for org ${orgId} (${windowKey}): ` +
      `$${(currentCents / 100).toFixed(2)} ≥ $${(ceilingCents / 100).toFixed(2)}`,
    );
    this.name = "AiCostCeilingExceededError";
  }
}

export async function getEffectiveCeilings(orgId: number): Promise<{
  dailyCents: number;
  monthlyCents: number;
  source: "platform_default" | "founder_override";
}> {
  const [override] = await db
    .select()
    .from(aiCostCeilingOverrides)
    .where(eq(aiCostCeilingOverrides.organizationId, orgId))
    .limit(1);
  if (override) {
    return {
      dailyCents: override.dailyCeilingCents,
      monthlyCents: override.monthlyCeilingCents ?? PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS,
      source: "founder_override",
    };
  }
  return {
    dailyCents: PLATFORM_DEFAULT_DAILY_CEILING_CENTS,
    monthlyCents: PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS,
    source: "platform_default",
  };
}

async function sumCostCentsSince(orgId: number, sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${aiTelemetryEvents.costCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(and(
      eq(aiTelemetryEvents.organizationId, orgId),
      gte(aiTelemetryEvents.createdAt, since),
    ));
  return Number(row?.sum ?? 0);
}

/**
 * Throw if the requesting org has exceeded its daily or monthly AI
 * cost ceiling. Call this BEFORE incurring a paid AI call.
 *
 * Bypass:
 *   - orgId === null (platform-internal calls) → no-op
 *   - process.env.AI_COST_CEILING_BYPASS === "1" (dev-loop only)
 */
export async function assertWithinAiCostCeiling(orgId: number | null): Promise<void> {
  if (orgId == null) return;
  if (process.env.AI_COST_CEILING_BYPASS === "1") return;

  const ceilings = await getEffectiveCeilings(orgId);
  const dayMs = 24 * 60 * 60 * 1000;
  const monthMs = 30 * dayMs;

  try {
    const dailyCents = await sumCostCentsSince(orgId, dayMs);
    if (dailyCents >= ceilings.dailyCents) {
      throw new AiCostCeilingExceededError(orgId, "daily", dailyCents, ceilings.dailyCents);
    }
    const monthlyCents = await sumCostCentsSince(orgId, monthMs);
    if (monthlyCents >= ceilings.monthlyCents) {
      throw new AiCostCeilingExceededError(orgId, "monthly", monthlyCents, ceilings.monthlyCents);
    }
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) throw err;
    // Telemetry-table read failure is fail-open (we don't want a transient
    // DB hiccup to brick AI for a customer); log and proceed.
    logger.warn(
      "[aiCostCeiling] could not check ceiling; falling open",
      err instanceof Error ? err : undefined,
    );
  }
}

export async function setFounderOverride(opts: {
  organizationId: number;
  dailyCeilingCents: number;
  monthlyCeilingCents?: number;
  setBy: string;
  notes?: string;
}): Promise<void> {
  await db
    .insert(aiCostCeilingOverrides)
    .values({
      organizationId: opts.organizationId,
      dailyCeilingCents: opts.dailyCeilingCents,
      monthlyCeilingCents: opts.monthlyCeilingCents ?? null,
      setBy: opts.setBy,
      notes: opts.notes ?? null,
    })
    .onConflictDoUpdate({
      target: aiCostCeilingOverrides.organizationId,
      set: {
        dailyCeilingCents: opts.dailyCeilingCents,
        monthlyCeilingCents: opts.monthlyCeilingCents ?? null,
        setBy: opts.setBy,
        notes: opts.notes ?? null,
        updatedAt: new Date(),
      },
    });
}
