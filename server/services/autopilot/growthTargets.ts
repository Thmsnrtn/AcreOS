/**
 * Autonomous Self-Acquisition — Growth targets (which county to write next).
 *
 * The owned-content engine writes ONE genuinely-useful guide per day. This is
 * the queue of WHICH county it targets: seeded from the founder's buy-box
 * counties at ignition (the honest cold-start prior), later demand-ranked from
 * real parcel-check volume. The daily grow loop drains the highest-priority
 * pending target instead of blind play rotation — the single highest-leverage
 * change every acquisition panel named.
 *
 * Pure parsing + a pure ordering comparator (tested without a DB); thin DB glue
 * for seed/select/mark. Best-effort reads degrade to "no target" → the loop
 * falls back to its existing rotation, so this can never break the live loop.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { growthTargets, type GrowthTarget } from "@shared/schema";
import { logger } from "../../utils/logger";

export interface CountyTarget {
  state: string;
  countySlug: string;
  countyLabel: string;
}

const STATE_RE = /^[A-Za-z]{2}$/;

/** Slugify a county label: lowercase, strip a trailing "county", hyphenate. */
export function countySlugFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\bcounty\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Title-case a slug back into a display label ("travis" → "Travis"). */
function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Parse one founder-supplied county line into a canonical target. Accepts
 * "TX/Travis", "Travis, TX", "TX Travis", "TX Travis County" (case-insensitive).
 * Pure + total — returns null on anything it can't confidently parse.
 */
export function parseCountyInput(raw: string): CountyTarget | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  let state: string | null = null;
  let countyPart: string | null = null;

  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => x.trim());
    if (STATE_RE.test(a)) { state = a; countyPart = b; }
    else if (STATE_RE.test(b)) { state = b; countyPart = a; }
  } else if (s.includes(",")) {
    const [a, b] = s.split(",").map((x) => x.trim());
    if (STATE_RE.test(b)) { state = b; countyPart = a; }
    else if (STATE_RE.test(a)) { state = a; countyPart = b; }
  } else {
    const parts = s.split(/\s+/);
    if (parts.length >= 2 && STATE_RE.test(parts[0])) { state = parts[0]; countyPart = parts.slice(1).join(" "); }
    else if (parts.length >= 2 && STATE_RE.test(parts[parts.length - 1])) { state = parts[parts.length - 1]; countyPart = parts.slice(0, -1).join(" "); }
  }

  if (!state || !countyPart) return null;
  const countySlug = countySlugFromLabel(countyPart);
  if (!countySlug) return null;
  return { state: state.toUpperCase(), countySlug, countyLabel: `${labelFromSlug(countySlug)}` };
}

/** Parse a free-form multi-line / comma-separated founder county list. Pure. */
export function parseCountyList(raw: string): CountyTarget[] {
  const lines = raw.split(/[\n;]+/).flatMap((l) => (l.includes("/") || l.includes(",") ? [l] : l.split(/\s{2,}/)));
  const seen = new Set<string>();
  const out: CountyTarget[] = [];
  for (const line of lines) {
    const t = parseCountyInput(line);
    if (!t) continue;
    const key = `${t.state}/${t.countySlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Ordering for target selection (most-deserving first). Pure. Higher demand
 * wins; ties break to the earliest-created (seed order) so the founder's list is
 * drained in the order given before demand data accrues. At cold-start every
 * demandScore is 0 → pure FIFO seed order.
 */
export function compareTargets(
  a: Pick<GrowthTarget, "demandScore" | "id">,
  b: Pick<GrowthTarget, "demandScore" | "id">,
): number {
  if (b.demandScore !== a.demandScore) return b.demandScore - a.demandScore;
  return a.id - b.id;
}

// ── DB glue ───────────────────────────────────────────────────────────────────

/** Seed buy-box counties. Idempotent (skips existing state/county). Returns count inserted. */
export async function seedGrowthTargets(counties: CountyTarget[]): Promise<number> {
  let inserted = 0;
  for (const c of counties) {
    try {
      const res = await db
        .insert(growthTargets)
        .values({ state: c.state, countySlug: c.countySlug, countyLabel: c.countyLabel, source: "seed" })
        .onConflictDoNothing({ target: [growthTargets.state, growthTargets.countySlug] })
        .returning({ id: growthTargets.id });
      if (res.length) inserted += 1;
    } catch (err) {
      logger.warn("[growthTargets] seed insert failed", err instanceof Error ? err : undefined);
    }
  }
  logger.info("[growthTargets] seeded", { requested: counties.length, inserted });
  return inserted;
}

/** The next county to write a guide for, or null if the queue is empty/all dispatched. */
export async function selectNextGrowthTarget(): Promise<GrowthTarget | null> {
  try {
    const [row] = await db
      .select()
      .from(growthTargets)
      .where(eq(growthTargets.status, "pending"))
      .orderBy(desc(growthTargets.demandScore), asc(growthTargets.id))
      .limit(1);
    return row ?? null;
  } catch {
    return null; // loop falls back to rotation
  }
}

/** Mark a target dispatched (optimistic — drains the queue; re-seed if a publish never lands). */
export async function markTargetDispatched(id: number, dispatchId: number | null): Promise<void> {
  try {
    await db
      .update(growthTargets)
      .set({ status: "dispatched", dispatchedAt: new Date(), lastDispatchId: dispatchId ?? null })
      .where(and(eq(growthTargets.id, id), eq(growthTargets.status, "pending")));
  } catch (err) {
    logger.warn("[growthTargets] mark dispatched failed", err instanceof Error ? err : undefined);
  }
}

/**
 * Demand-rank the queue from REAL parcel-check activity: count public parcel
 * reports per (state, county) in the recent window and write that as each
 * target's demandScore, so the daily loop writes guides for the counties
 * strangers actually check. Existing seeded rows keep their source/status and
 * just gain a score; new high-demand counties are added as source='demand'.
 * Best-effort; never throws. Returns how many counties were touched.
 */
export async function refreshGrowthDemand(windowDays = 30): Promise<number> {
  try {
    const { publicParcelReports } = await import("@shared/schema");
    const { sql, gte } = await import("drizzle-orm");
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const counts = await db
      .select({
        state: publicParcelReports.state,
        countySlug: publicParcelReports.countySlug,
        n: sql<number>`count(*)::int`,
      })
      .from(publicParcelReports)
      .where(gte(publicParcelReports.createdAt, since))
      .groupBy(publicParcelReports.state, publicParcelReports.countySlug);

    let touched = 0;
    for (const row of counts) {
      if (!row.state || !row.countySlug) continue;
      const score = Math.max(0, Number(row.n) || 0);
      try {
        await db
          .insert(growthTargets)
          .values({
            state: row.state.toUpperCase(),
            countySlug: row.countySlug,
            countyLabel: labelFromSlug(row.countySlug),
            source: "demand",
            demandScore: score,
          })
          .onConflictDoUpdate({
            target: [growthTargets.state, growthTargets.countySlug],
            set: { demandScore: score }, // preserve existing source/status; just rank it
          });
        touched += 1;
      } catch {
        /* skip this county */
      }
    }
    if (touched) logger.info("[growthTargets] demand refreshed", { counties: touched, windowDays });
    return touched;
  } catch {
    return 0; // no parcel-check data / read error → queue keeps its seed order
  }
}

/** How many targets remain pending (for the founder letter's "inventory accreting" line). */
export async function countPendingTargets(): Promise<number> {
  try {
    const rows = await db.select({ id: growthTargets.id }).from(growthTargets).where(eq(growthTargets.status, "pending"));
    return rows.length;
  } catch {
    return 0;
  }
}
