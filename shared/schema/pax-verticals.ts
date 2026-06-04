// ============================================================================
// SHARED/SCHEMA/PAX-VERTICALS.TS
// ----------------------------------------------------------------------------
// Type/enum surface for the vertical-aware Pax persona system.
//
// No DB table here — per-user context capture (vertical / experienceLevel /
// investmentGoals) is stored by the user-context schema (sibling D1-C).
// This file is the canonical enum + literal-union source consumed by:
//   - server/services/pax/personas.ts
//   - server/services/pax/verticalSystemPrompt.ts
//   - client/src/components/onboarding/PaxContextStep.tsx (D1-C)
// ============================================================================

export const PAX_VERTICALS = [
  "land_investing",
  "single_family_rentals",
  "notes",
  "multi_family",
  "mobile_homes",
  "wholesaling",
] as const;
export type PaxVertical = (typeof PAX_VERTICALS)[number];

export const PAX_EXPERIENCE_LEVELS = ["beginner", "intermediate", "expert"] as const;
export type PaxExperienceLevel = (typeof PAX_EXPERIENCE_LEVELS)[number];

export const PAX_INVESTMENT_GOALS = [
  "cash_flow",
  "appreciation",
  "passive_income",
  "value_add",
  "tax_advantages",
  "learning",
] as const;
export type PaxInvestmentGoal = (typeof PAX_INVESTMENT_GOALS)[number];

/**
 * Type-guard helpers — useful at runtime boundaries (form input, DB rows,
 * API payloads) where the value may be an arbitrary string.
 */
export function isPaxVertical(value: unknown): value is PaxVertical {
  return typeof value === "string" && (PAX_VERTICALS as readonly string[]).includes(value);
}

export function isPaxExperienceLevel(value: unknown): value is PaxExperienceLevel {
  return (
    typeof value === "string" && (PAX_EXPERIENCE_LEVELS as readonly string[]).includes(value)
  );
}

export function isPaxInvestmentGoal(value: unknown): value is PaxInvestmentGoal {
  return (
    typeof value === "string" && (PAX_INVESTMENT_GOALS as readonly string[]).includes(value)
  );
}
