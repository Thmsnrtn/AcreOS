/**
 * Founder Autopilot — the owned-growth playbook.
 *
 * When the brain decides "grow_owned_channels," this is the catalog it draws
 * from: a small, ordered set of OWNED, ~$0, no-external-key growth plays. The
 * point is concreteness + taste — the autopilot advances a *specific* tasteful
 * action (draft a county guide, write a parcel-check explainer), not a vague
 * "do some growth," and it ROTATES so it never hammers one channel.
 *
 * Owned-first by design (per the build plan): no paid ads, no cold blasts until
 * revenue earns them. Every play is a piece of genuinely useful content or an
 * honest on-platform improvement — the kind of thing a thoughtful operator
 * would be proud to ship. The craft standard is layered on at dispatch time so
 * the agent is held to the taste bar from the first token.
 *
 * Pure + deterministic: selectNextGrowthPlay(rotationIndex) is a total function
 * of an injected rotation counter (the loop supplies it from how many growth
 * plays have already run), so it's trivially testable and never random.
 */
import type { CraftSurface } from "./craftStandard";

export interface GrowthPlay {
  id: string;
  title: string;
  /** The craft surface that governs tone for this play. */
  surface: CraftSurface;
  /**
   * Whether the play's artifact is directed AT a customer (→ witnessed-send).
   * Owned content (SEO, explainers, on-platform polish) is NOT — it's published
   * to owned surfaces, not sent to a person. Kept explicit per-play so the
   * gate/escalation see the truth.
   */
  isCustomerFacing: boolean;
  /** The concrete, honest instruction handed to the agent. */
  brief: string;
}

/**
 * The catalog. Ordered, owned, ~$0. Add plays here as owned channels grow;
 * keep every brief honest (no fabricated proof, no hype) — the craft standard
 * enforces the rest.
 */
export const GROWTH_PLAYS: readonly GrowthPlay[] = [
  {
    id: "county-guide",
    title: "Programmatic county guide (SEO)",
    surface: "content",
    isCustomerFacing: false,
    brief:
      "Draft one genuinely useful, accurate county-level land guide for the programmatic SEO surface — the kind of reference a land investor would bookmark. Use only real, verifiable facts about the county (it's fine to leave a field blank rather than guess). Lead with usefulness; no marketing padding.",
  },
  {
    id: "parcel-check-explainer",
    title: "Parcel-check educational explainer",
    surface: "content",
    isCustomerFacing: false,
    brief:
      "Write a clear, top-of-funnel explainer that teaches a newcomer how to read a parcel check and what each signal means. Teach first; mention AcreOS only where it's genuinely the natural tool. Plain, expert, unhyped.",
  },
  {
    id: "buyer-faq",
    title: "Help/FAQ expansion",
    surface: "content",
    isCustomerFacing: false,
    brief:
      "Pick one real question a land investor commonly asks and write a thorough, honest help/FAQ answer for the owned docs. Accuracy and completeness over persuasion.",
  },
  {
    id: "topic-explainer",
    title: "Neutral land-investing explainer",
    surface: "content",
    isCustomerFacing: false,
    brief:
      "Write a neutral, evergreen explainer on one land-investing topic (e.g. due diligence, title, access, zoning basics) that stands on its own as a useful reference. No sales angle; earn trust by being the best free explanation on the topic.",
  },
  {
    id: "landing-proof",
    title: "Honest landing-surface improvement",
    surface: "marketing",
    isCustomerFacing: false,
    brief:
      "Propose one concrete, honest improvement to a landing surface that helps a visitor understand the real value faster — clearer mechanics, a truthful proof point, a friction removed. Never invent claims, testimonials, or urgency.",
  },
];

/**
 * Pick the next owned-growth play by rotation. Total: any integer index maps to
 * a play (wraps, handles negatives). Deterministic so the same counter always
 * yields the same play — the caller advances the counter as plays run.
 */
export function selectNextGrowthPlay(rotationIndex: number): GrowthPlay {
  const n = GROWTH_PLAYS.length;
  const i = ((Math.trunc(rotationIndex) % n) + n) % n;
  return GROWTH_PLAYS[i];
}

/** Look up a play by id (null if unknown). */
export function growthPlayById(id: string): GrowthPlay | null {
  return GROWTH_PLAYS.find((p) => p.id === id) ?? null;
}

/**
 * The concrete rationale a selected play contributes to its move — the title +
 * the brief. The craft standard is layered on separately at dispatch time
 * (dispatchPromptFor), so this stays the "what," not the "how to write."
 */
export function growthPlayRationale(play: GrowthPlay): string {
  return `${play.title} — ${play.brief}`;
}
