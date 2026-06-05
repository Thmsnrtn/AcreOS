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
 * customer ("AI is paused for today; contact support@acreos.io").
 */

import { db } from "../db";
import { aiCostCeilingOverrides, aiTelemetryEvents } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const PLATFORM_DEFAULT_DAILY_CEILING_CENTS = 5000;
const PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS = 100_000;

// Platform-wide cap across ALL orgs + platform-internal calls. This is the
// outer envelope: the per-org ceilings prevent one customer from hogging
// spend; this prevents the whole platform from quietly billing $30/day at
// $0 MRR. Settable via env so Tom can ratchet it without a deploy.
// Default $5/day = 500 cents.
function getPlatformDailyCeilingCents(): number {
  const fromEnv = process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 500;
}

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
      sum: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(and(
      eq(aiTelemetryEvents.organizationId, orgId),
      gte(aiTelemetryEvents.createdAt, since),
    ));
  return Number(row?.sum ?? 0);
}

async function sumPlatformCostCentsSince(sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since));
  return Number(row?.sum ?? 0);
}

/**
 * Platform-wide daily ceiling check. Throws AiCostCeilingExceededError
 * (with orgId=0 sentinel) if the sum of all telemetry across all orgs +
 * platform-internal calls in the last 24h is at-or-over
 * AI_PLATFORM_DAILY_CEILING_CENTS. Call this for every paid AI call,
 * regardless of whether an orgId is available.
 *
 * Bypass: `AI_COST_CEILING_BYPASS=1`.
 */
export async function assertWithinPlatformCostCeiling(): Promise<void> {
  if (process.env.AI_COST_CEILING_BYPASS === "1") return;

  const ceilingCents = getPlatformDailyCeilingCents();
  const dayMs = 24 * 60 * 60 * 1000;

  try {
    const dailyCents = await sumPlatformCostCentsSince(dayMs);
    if (dailyCents >= ceilingCents) {
      throw new AiCostCeilingExceededError(0, "daily", dailyCents, ceilingCents);
    }
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) throw err;
    // Telemetry read failure is fail-open; log + proceed.
    logger.warn(
      "[aiCostCeiling] platform ceiling check failed; falling open",
      err instanceof Error ? err : undefined,
    );
  }
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
  // Platform-wide check ALWAYS runs (including for orgId === null platform
  // calls). This is the outer envelope that prevents the runaway $30/day
  // scenario regardless of which surface initiated the call.
  await assertWithinPlatformCostCeiling();

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
