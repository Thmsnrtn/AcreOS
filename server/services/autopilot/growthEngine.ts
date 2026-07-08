/**
 * Founder Autopilot — proactive growth engine (pull customers in).
 *
 * The autopilot already has the PARTS to pull customers: owned content
 * (growthPlaybook → county guides, parcel-check explainers, FAQ), the publish
 * path (publishArtifact → /field-notes + sitemap → SEO), and attribution
 * (field-note → signup). This module makes that loop PROACTIVE and SELF-IMPROVING
 * rather than a flat rotation:
 *
 *   1. Default growth objectives give the brain real acquisition targets (so it
 *      pursues signups, not just "do sensible things").
 *   2. Play selection is conversion-weighted: once a play has accrued real
 *      attribution outcomes, Thompson sampling (efficacy.ts) favors the plays
 *      that actually convert; while cold, it falls back to honest rotation so it
 *      explores every channel. Cold-start-safe by construction.
 *
 * Pure selection (selectProactiveGrowthPlay) → unit-testable; objective seeding
 * is a thin idempotent upsert.
 */
import { selectPlay, pooledPrior, type PlayStats, type Rng } from "./efficacy";
import { selectNextGrowthPlay, growthPlayById, type GrowthPlay } from "./growthPlaybook";
import { upsertObjective } from "./objectives";

/**
 * Pick the next owned-growth play. With real per-play outcome stats, Thompson
 * sampling favors proven converters (exploit) while still exploring; with no
 * data yet, falls back to deterministic rotation so every channel gets a turn.
 * Pure given the rng.
 */
export function selectProactiveGrowthPlay(
  stats: PlayStats[],
  rotationIndex: number,
  rng: Rng,
): GrowthPlay {
  const hasData = stats.some((s) => s.successes + s.failures > 0);
  if (hasData) {
    // T3 (#14): an unproven play inherits the org's POOLED success rate as its
    // prior (not a blind 0.5) — the hierarchical primitive (pools across plays
    // now, across tenants when scoped).
    const id = selectPlay(stats, rng, pooledPrior(stats));
    const play = id ? growthPlayById(id) : null;
    if (play) return play;
  }
  return selectNextGrowthPlay(rotationIndex);
}

/** The default acquisition funnel the brain pursues. Idempotent (upsert by key). */
export async function seedGrowthObjectives(): Promise<void> {
  await upsertObjective({
    key: "weekly_signups",
    label: "New signups / week",
    target: 5,
    unit: "count",
    owningDomain: "growth",
  });
  await upsertObjective({
    key: "published_field_notes",
    label: "Published field-notes (SEO surface)",
    target: 20,
    unit: "count",
    owningDomain: "growth",
  });
  await upsertObjective({
    key: "activated_orgs",
    label: "Orgs reaching first value",
    target: 10,
    unit: "count",
    owningDomain: "growth",
  });
  await upsertObjective({
    key: "attributed_signups",
    label: "Signups attributed to owned content",
    target: 3,
    unit: "count",
    owningDomain: "growth",
  });
}

/** One-line owned-growth funnel health for the daily letter. Pure. */
export function growthFunnelLine(published: number, signups: number, attributed: number): string {
  const rate = signups > 0 ? Math.round((attributed / signups) * 100) : 0;
  return `Owned growth: ${published} field-note(s) published · ${signups} signup(s) · ${attributed} attributed to content (${rate}%).`;
}
