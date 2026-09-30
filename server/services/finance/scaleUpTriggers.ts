/**
 * Scale-up revenue triggers — the one ladder and the one reading of it.
 *
 * The ladder ("at $X of MRR, consider spending $Y on Z") lived as three
 * copies (the founder finance route, and the founder-chat inquiry and action
 * tools). Worse, the MRR it read was not MRR: it summed every revenue row
 * posted in the last 30 days — an annual plan's whole year and one-time
 * charges counted as a month's recurring revenue, refunds not netted — so one
 * annual signup could "cross" several rungs at once. And `crossedAt` was the
 * moment of the read, rendered as if it were when the threshold was crossed
 * (quality directive 2026-09-29).
 *
 * Now: a rung is crossed on RECURRING MRR (`liveMrrDetail`, the same source
 * the runway model and the weekly snapshot use). `crossedAt` is the first
 * weekly `mrr_snapshots` row at or above the threshold, or null when no
 * snapshot has recorded it yet. Trailing 30-day posted revenue is still
 * reported, under its own name. Every item is a recommendation for the
 * founder to approve or defer — nothing here spends.
 */
import { and, asc, desc, eq, gte, sum } from "drizzle-orm";
import { db } from "../../db";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { financialLedger, founderAudit, mrrSnapshots } from "@shared/schema";
import { liveMrrDetail } from "./runwayModel";

export const REVENUE_TRIGGER_LADDER: ReadonlyArray<{
  thresholdId: string;
  thresholdCents: number;
  action: string;
  costOneTimeCents: number;
  costRecurringCents: number;
}> = [
  { thresholdId: "mrr-50",     thresholdCents:    5_000, action: "Re-enable Sentry Starter",                  costOneTimeCents:     0, costRecurringCents:  2_900 },
  { thresholdId: "mrr-200",    thresholdCents:   20_000, action: "Upgrade Fly app to shared-cpu-2x",          costOneTimeCents:     0, costRecurringCents:    800 },
  { thresholdId: "mrr-500",    thresholdCents:   50_000, action: "Add 2nd Fly app machine for redundancy",    costOneTimeCents:     0, costRecurringCents:  2_400 },
  { thresholdId: "mrr-1000a",  thresholdCents:  100_000, action: "Apply for USPS Mail.dat permit",            costOneTimeCents: 35_000, costRecurringCents:  2_900 },
  { thresholdId: "mrr-1000b",  thresholdCents:  100_000, action: "Re-enable ElevenLabs Pro",                  costOneTimeCents:     0, costRecurringCents:  2_200 },
  { thresholdId: "mrr-2000",   thresholdCents:  200_000, action: "Migrate Postgres off Neon free tier",       costOneTimeCents:     0, costRecurringCents:  8_500 },
  { thresholdId: "mrr-3000",   thresholdCents:  300_000, action: "Telnyx account + A2P 10DLC registration",   costOneTimeCents:  5_000, costRecurringCents:      0 },
  { thresholdId: "mrr-5000",   thresholdCents:  500_000, action: "Wire aggregation queue + presort partner",  costOneTimeCents:     0, costRecurringCents:      0 },
  { thresholdId: "mrr-10000",  thresholdCents: 1_000_000, action: "Right-size Fly to performance-2x",         costOneTimeCents:     0, costRecurringCents: 54_000 },
];

/** Posted revenue over the trailing 30 days — revenue, not a run rate. */
export async function trailing30dRevenueCents(): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Platform-wide by definition: AcreOS's own subscription revenue across all
  // orgs, read only by the founder surfaces (founder-guarded router, founder
  // chat).
  const [row] = await unscopedForPlatformOps("founder scale-up triggers: AcreOS revenue across all orgs")
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, since)));
  return row?.total ?? 0;
}

/** First weekly snapshot at or above the threshold, or null if none recorded it. */
async function firstSnapshotAtOrAbove(thresholdCents: number): Promise<string | null> {
  const [row] = await db
    .select({ capturedAt: mrrSnapshots.capturedAt })
    .from(mrrSnapshots)
    .where(gte(mrrSnapshots.mrrCents, thresholdCents))
    .orderBy(asc(mrrSnapshots.capturedAt))
    .limit(1);
  return row?.capturedAt ? row.capturedAt.toISOString() : null;
}

export async function pendingScaleUpTriggers(): Promise<{
  items: Array<(typeof REVENUE_TRIGGER_LADDER)[number] & { status: "pending"; crossedAt: string | null }>;
  recurringMrrCents: number;
  payingOrgs: number;
  trailing30dRevenueCents: number;
}> {
  const [{ cents: recurringMrrCents, payingOrgs }, revenue] = await Promise.all([
    liveMrrDetail(),
    trailing30dRevenueCents(),
  ]);

  const priorRows = await db
    .select({ targetId: founderAudit.targetId, action: founderAudit.action, createdAt: founderAudit.createdAt })
    .from(founderAudit)
    .where(eq(founderAudit.area, "scale_up"))
    .orderBy(desc(founderAudit.createdAt));
  const decided = new Map<string, { status: "approved" | "deferred"; at: Date }>();
  for (const r of priorRows) {
    if (!r.targetId || decided.has(r.targetId)) continue; // first row is most recent
    if (r.action === "approve") decided.set(r.targetId, { status: "approved", at: r.createdAt });
    else if (r.action === "defer") decided.set(r.targetId, { status: "deferred", at: r.createdAt });
  }

  const now = Date.now();
  const pending = REVENUE_TRIGGER_LADDER.filter((t) => {
    if (recurringMrrCents < t.thresholdCents) return false;
    const d = decided.get(t.thresholdId);
    if (d?.status === "approved") return false;
    // A deferral expires after 7 days.
    if (d?.status === "deferred" && now - d.at.getTime() < 7 * 86_400_000) return false;
    return true;
  });
  const items = await Promise.all(
    pending.map(async (t) => ({
      ...t,
      status: "pending" as const,
      crossedAt: await firstSnapshotAtOrAbove(t.thresholdCents),
    })),
  );
  return { items, recurringMrrCents, payingOrgs, trailing30dRevenueCents: revenue };
}
