// ============================================================================
// SERVER/SERVICES/PAX/VERTICALSYSTEMPROMPT.TS
// ----------------------------------------------------------------------------
// Builder for the vertical-aware appendix to Pax's base system prompt.
//
// The base system prompt (in pax/executive.ts — sibling territory) is
// unchanged; this composes a string that the user-context injection layer
// (D1-C's territory) appends to it.
//
// Pure functions. Fall-open defaults so the absence of any field is graceful:
//   - missing vertical          → land_investing default appendix
//   - missing experienceLevel   → intermediate tone
//   - empty investmentGoals[]   → generic framing
// ============================================================================

import type {
  PaxExperienceLevel,
  PaxInvestmentGoal,
  PaxVertical,
} from "@shared/schema/pax-verticals";
import { getPersonaOrDefault } from "./personas";

export interface VerticalPromptInput {
  vertical: PaxVertical | null;
  experienceLevel: PaxExperienceLevel | null;
  investmentGoals: PaxInvestmentGoal[];
  userDisplayName?: string;
  geographicFocus?: string;
}

// ----------------------------------------------------------------------------
// EXPERIENCE-LEVEL TONE
// ----------------------------------------------------------------------------

const EXPERIENCE_LEVEL_TONE: Record<PaxExperienceLevel, string> = {
  beginner:
    "Tone: explain context before terms; surface common pitfalls before they happen; use plain language without over-simplifying the math.",
  intermediate:
    "Tone: assume working vocabulary; surface non-obvious angles; offer the second-look on assumptions without belaboring fundamentals.",
  expert:
    "Tone: match their precision; be the second opinion, not the teacher; if you push back, push back on the specific number or assumption, not the framing.",
};

export function buildExperienceLevelTone(level: PaxExperienceLevel): string {
  return EXPERIENCE_LEVEL_TONE[level];
}

// ----------------------------------------------------------------------------
// INVESTMENT-GOALS FRAMING
// ----------------------------------------------------------------------------

const GOAL_FRAMING: Record<PaxInvestmentGoal, string> = {
  cash_flow:
    "Frame deals by monthly net cash flow and cap rate; surface anything that compresses month-1 cash.",
  appreciation:
    "Frame by 5/10-year IRR and underlying market thesis; surface demographic or supply-driven catalysts.",
  passive_income:
    "Frame by hands-off-ness and management overhead; surface anything that pulls the operator back into active work.",
  value_add:
    "Frame by post-improvement value and execution risk; surface scope creep, holding-cost drift, and exit assumptions.",
  tax_advantages:
    "Frame by depreciation schedule, 1031 eligibility, and bonus depreciation timing; flag for CPA verification, never give tax advice.",
  learning:
    "Frame as a teaching opportunity; surface the underlying principle, then the specific application.",
};

export function buildGoalsFraming(goals: PaxInvestmentGoal[]): string {
  if (!goals || goals.length === 0) {
    return "Frame deals against the customer's stated objective; if unclear, ask one calibrating question before running the math.";
  }
  const lines = goals.map((g) => `- ${GOAL_FRAMING[g]}`);
  return ["Investment-goals framing:", ...lines].join("\n");
}

// ----------------------------------------------------------------------------
// VERTICAL APPENDIX BUILDER
// ----------------------------------------------------------------------------

export function buildVerticalPromptAppendix(input: VerticalPromptInput): string {
  const persona = getPersonaOrDefault(input.vertical);
  const level: PaxExperienceLevel = input.experienceLevel ?? "intermediate";

  const sections: string[] = [];

  // 1. Vertical-specific appendix from the persona profile.
  sections.push(`## Vertical context — ${persona.verticalLabel}`);
  sections.push(persona.systemPromptAppendix);

  // 2. Key terminology hints (compact — Pax already has the persona internalized,
  //    this is a reminder list, not a glossary dump).
  if (persona.domainTerminology.length > 0) {
    const terms = persona.domainTerminology.slice(0, 8).join("; ");
    sections.push(`Terminology cues: ${terms}.`);
  }

  // 3. Experience-level tone.
  sections.push(`## Calibration`);
  sections.push(buildExperienceLevelTone(level));

  // 4. Investment-goals framing.
  sections.push(buildGoalsFraming(input.investmentGoals));

  // 5. Optional personalization.
  if (input.userDisplayName || input.geographicFocus) {
    const personalization: string[] = ["## Personalization"];
    if (input.userDisplayName) {
      personalization.push(`Address the customer as ${input.userDisplayName} when natural.`);
    }
    if (input.geographicFocus) {
      personalization.push(
        `Geographic focus: ${input.geographicFocus}. When discussing comps, rules, or market dynamics, default to this geography unless they specify otherwise.`,
      );
    }
    sections.push(personalization.join("\n"));
  }

  // 6. Scaffolded-vertical honesty flag.
  if (!persona.productionReady) {
    sections.push(
      `## Depth posture\nThis vertical is scaffolded — depth is roadmap. Stay accurate, don't over-claim expertise. If the customer asks a question beyond your confident knowledge, say so and offer to bring in a deeper resource rather than improvise.`,
    );
  }

  return sections.join("\n\n").trim();
}
