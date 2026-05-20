/**
 * Hook archetype taxonomy + seeder.
 *
 * Archetypes are the *intent shape* of a hook, not the topic. The same
 * archetype maps cleanly across verticals (a `contrarian_question` works
 * for note investing AND fix-and-flip). Performance is tracked per archetype
 * in `cmo_hook_archetypes` so the generator can bias toward what's winning
 * in the last 30 days of spend-weighted CTR.
 *
 * Don't expand this list lightly — every archetype is a row that demands
 * weeks of spend to score meaningfully. 12 archetypes is the right ballpark;
 * 50 is over-fitting before any data exists.
 */

import { db } from "../../db";
import { cmoHookArchetypes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";

export interface ArchetypeDef {
  slug: string;
  displayName: string;
  description: string;
  examplePrompt: string;
}

export const HOOK_ARCHETYPES: ArchetypeDef[] = [
  {
    slug: "problem_specific",
    displayName: "Specific problem",
    description:
      "Name a precise, visceral problem the viewer has felt in the last week. No vague pain. The hook is a sentence the viewer would say out loud about their own day.",
    examplePrompt:
      "'You spent the weekend running comps on twelve parcels and ended up with two you'd actually buy.' Then demonstrate AcreOS doing the same work in 90 seconds.",
  },
  {
    slug: "contrarian_question",
    displayName: "Contrarian question",
    description:
      "Open with a question that flips conventional wisdom and creates a curiosity gap the viewer needs to close.",
    examplePrompt:
      "'What if your CRM was the reason your follow-ups are falling through, not your discipline?'",
  },
  {
    slug: "specific_number_proof",
    displayName: "Specific number proof",
    description:
      "Lead with a precise number that's surprising in either direction. Numbers build credibility faster than adjectives.",
    examplePrompt:
      "'Pax drafted 47 replies overnight. The operator approved 41. Zero of them sounded AI-generated.'",
  },
  {
    slug: "demonstration_first",
    displayName: "Demonstration first",
    description:
      "Skip the hook copy entirely. Open with the product doing the thing. Voiceover narrates what the viewer is watching.",
    examplePrompt:
      "[Screen recording: typing an APN, comp results appearing in seconds] VO: 'Comps for any parcel. Thirty seconds. That's the whole workflow.'",
  },
  {
    slug: "comparison_implicit",
    displayName: "Implicit comparison",
    description:
      "Show the old way next to the new way without naming a competitor. Side-by-side timeline beats any superlative claim.",
    examplePrompt:
      "Left: spreadsheet, twelve hours, three leads ranked. Right: AcreOS, thirty seconds, sorted queue. VO: 'Same Monday. Different operating system.'",
  },
  {
    slug: "objection_handle",
    displayName: "Objection handle",
    description:
      "Pre-empt the most common reason this viewer didn't sign up last time. Retargeting only — does not fit cold traffic.",
    examplePrompt:
      "'You're worried it's another CRM you'll abandon in two weeks. Here's the 60-second daily loop most users actually keep.'",
  },
  {
    slug: "before_after_window",
    displayName: "Before / after window",
    description:
      "Compress a one-week timeline of friction into 12 seconds, then end on the after state with the product. Strongest when paired with a literal calendar visual.",
    examplePrompt:
      "Calendar week 1: scattered notes, missed calls. Week 2 with AcreOS: clean pipeline, three closed deals. VO: 'Two weeks. Same operator.'",
  },
  {
    slug: "founder_voice_direct",
    displayName: "Founder voice direct",
    description:
      "Cloned founder voice narrates a single specific insight. No screen graphics in the first three seconds — the voice carries it.",
    examplePrompt:
      "VO over slow B-roll of a parcel: 'The reason most land deals die isn't the offer. It's the silence after week two.' Cut to AcreOS auto-follow-up demo.",
  },
  {
    slug: "stat_then_demo",
    displayName: "Stat then demo",
    description:
      "Lead with a category-level stat (industry-wide, not AcreOS-specific). Then show how AcreOS solves the gap that stat implies.",
    examplePrompt:
      "'73% of land investors lose deals to slower follow-up.' Cut to AcreOS sending an auto-drafted reply within 60 seconds of a seller text.",
  },
  {
    slug: "anti_guru_pattern_break",
    displayName: "Anti-guru pattern break",
    description:
      "Open by *rejecting* a familiar guru framing the audience has seen 500 times. The pattern break itself is the hook.",
    examplePrompt:
      "'This isn't a course. It's not a coaching call. It's the software the guys you already follow are using to actually run their business.'",
  },
  {
    slug: "audit_log_proof",
    displayName: "Audit-log proof",
    description:
      "Show a literal audit log entry — agent took action X at time Y based on data Z. Trust through transparency, not testimonials.",
    examplePrompt:
      "Screen of Pax audit log: 'Drafted reply to Janet Ruiz at 6:42am · used Coconino comp median · operator approved · sent.'",
  },
  {
    slug: "operator_day_montage",
    displayName: "Operator day montage",
    description:
      "Quick montage of a real operator day — calls, field visits, kids — with the AcreOS surface as the through-line. Sells the lifestyle without claiming it.",
    examplePrompt:
      "Truck cab, parcel walk, kid's soccer game, evening dashboard check showing the day's work already triaged. VO: 'The platform runs while you do.'",
  },
];

export async function seedHookArchetypes(): Promise<void> {
  for (const archetype of HOOK_ARCHETYPES) {
    const existing = await db.query.cmoHookArchetypes.findFirst({
      where: eq(cmoHookArchetypes.slug, archetype.slug),
    });

    if (existing) {
      await db
        .update(cmoHookArchetypes)
        .set({
          displayName: archetype.displayName,
          description: archetype.description,
          examplePrompt: archetype.examplePrompt,
          updatedAt: new Date(),
        })
        .where(eq(cmoHookArchetypes.id, existing.id));
    } else {
      await db.insert(cmoHookArchetypes).values({
        slug: archetype.slug,
        displayName: archetype.displayName,
        description: archetype.description,
        examplePrompt: archetype.examplePrompt,
      });
    }
  }
  logger.info(`[cmo] seeded ${HOOK_ARCHETYPES.length} hook archetypes`);
}

/**
 * Resolves the archetype slug → full definition. Used by the script
 * generator when biasing toward proven archetypes.
 */
export async function listActiveArchetypes() {
  return db.query.cmoHookArchetypes.findMany({
    where: eq(cmoHookArchetypes.active, true),
  });
}
