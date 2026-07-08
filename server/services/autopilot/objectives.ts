/**
 * Founder Autopilot — objectives (Hands roadmap P5).
 *
 * Structured goals the brain plans toward. The founder declares targets (in Your
 * Voice); `current` is refreshed from real senses; the planner weights moves by
 * how far the owning domain's objectives sit from target; the daily letter
 * reports progress. This is what turns "operate the business" into "move these N
 * numbers" — and makes autonomy MEASURABLE, therefore grantable.
 *
 * The math (computeProgress, domainUrgency) is PURE → unit-testable without a DB.
 * `current` is only ever set from a measured sense — never invented.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { autopilotObjectives, type AutopilotObjective } from "@shared/schema";
import { logger } from "../../utils/logger";
import type { AutopilotDomain } from "./policyGate";

/** Units that are LOWER-is-better (e.g. first-reply time). Everything else is
 * higher-is-better (counts, cents, rates). */
const LOWER_IS_BETTER = new Set(["minutes", "hours", "seconds"]);

export interface ObjectiveProgress {
  key: string;
  label: string;
  unit: string;
  target: number;
  current: number;
  /** Fraction toward the target, clamped 0..1. Direction-aware. */
  pct: number;
  /** True once the objective is met. */
  met: boolean;
}

/**
 * Progress toward an objective. Direction-aware: for higher-is-better metrics
 * pct = current/target; for lower-is-better, pct rises as `current` falls toward
 * target. Pure + total (handles target 0 and overshoot).
 */
export function computeProgress(o: Pick<AutopilotObjective, "key" | "label" | "unit" | "target" | "current">): ObjectiveProgress {
  const target = Number(o.target);
  const current = Number(o.current);
  const lower = LOWER_IS_BETTER.has(o.unit);
  let pct: number;
  let met: boolean;
  if (lower) {
    met = current <= target;
    // Start measuring from 2x target as "0%"; at/under target = 100%.
    const span = target > 0 ? target : 1;
    pct = current <= target ? 1 : Math.max(0, 1 - (current - target) / span);
  } else {
    met = target <= 0 ? current >= 0 : current >= target;
    pct = target <= 0 ? (met ? 1 : 0) : Math.min(1, Math.max(0, current / target));
  }
  return { key: o.key, label: o.label, unit: o.unit, target, current, pct, met };
}

/**
 * The planner's per-domain urgency multiplier from the active objectives: the
 * further the domain's objectives sit from their targets, the higher the weight
 * (so the brain prioritizes the domain whose numbers most need moving). Returns
 * 1.0 when the domain owns no objective (neutral). Pure.
 */
export function domainUrgency(
  objectives: Array<Pick<AutopilotObjective, "key" | "label" | "unit" | "target" | "current" | "owningDomain">>,
  domain: AutopilotDomain,
): number {
  const owned = objectives.filter((o) => o.owningDomain === domain);
  if (owned.length === 0) return 1;
  // Average shortfall (1 - pct) across the domain's objectives → 1.0 (all met)
  // to 2.0 (all maximally short). A bounded, transparent nudge — never inverts
  // the brain's safety ladder, only orders within a tier.
  const avgShortfall = owned.reduce((acc, o) => acc + (1 - computeProgress(o).pct), 0) / owned.length;
  return 1 + Math.min(1, Math.max(0, avgShortfall));
}

// ── DB helpers (thin) ────────────────────────────────────────────────────────

export async function listObjectives(activeOnly = true): Promise<AutopilotObjective[]> {
  try {
    const rows = await db
      .select()
      .from(autopilotObjectives)
      .where(activeOnly ? eq(autopilotObjectives.active, true) : undefined as any)
      .orderBy(desc(autopilotObjectives.updatedAt));
    return rows;
  } catch (err) {
    logger.warn("[autopilot/objectives] list failed", err instanceof Error ? err : undefined);
    return [];
  }
}

/** Upsert an objective by key (founder action from Your Voice). */
export async function upsertObjective(input: {
  key: string;
  label: string;
  target: number;
  unit?: string;
  owningDomain?: string | null;
  deadline?: Date | null;
  createdBy?: string;
}): Promise<void> {
  const stamp = { updatedAt: new Date() };
  await db
    .insert(autopilotObjectives)
    .values({
      key: input.key,
      label: input.label,
      target: input.target,
      unit: input.unit ?? "count",
      owningDomain: input.owningDomain ?? null,
      deadline: input.deadline ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: autopilotObjectives.key,
      set: { label: input.label, target: input.target, unit: input.unit ?? "count", owningDomain: input.owningDomain ?? null, deadline: input.deadline ?? null, ...stamp },
    });
}

/** Refresh an objective's `current` from a measured value (never invented). */
export async function setObjectiveCurrent(key: string, current: number): Promise<void> {
  try {
    await db
      .update(autopilotObjectives)
      .set({ current, updatedAt: new Date() })
      .where(and(eq(autopilotObjectives.key, key), eq(autopilotObjectives.active, true)));
  } catch (err) {
    logger.warn("[autopilot/objectives] setCurrent failed", err instanceof Error ? err : undefined);
  }
}

/** Render a one-line progress summary for the daily letter. */
export function summarizeObjective(p: ObjectiveProgress): string {
  const pctTxt = `${Math.round(p.pct * 100)}%`;
  const fmt = (n: number) => (p.unit === "cents" ? `$${(n / 100).toFixed(0)}` : p.unit === "rate" ? `${(n * 100).toFixed(0)}%` : String(n));
  return `${p.label}: ${fmt(p.current)} → ${fmt(p.target)} (${pctTxt}${p.met ? " ✓" : ""})`;
}
