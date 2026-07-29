/**
 * Single source of truth for the persona ↔ businessType ↔ investorType model.
 *
 * AcreOS carries three related "what kind of investor is this?" fields:
 *   - users.persona                          — 9-value canonical persona (drives vocabulary + surfaces)
 *   - organizations.onboardingData.businessType — 15-value granular taxonomy (drives businessTypeOnly gating + sample data)
 *   - organizations.investorType             — 'land' | 'notes' | 'both' (the coarse note-vertical fork)
 *
 * These were previously mapped in THREE hand-synced copies (client
 * OnboardingWizard.tsx, server routes-onboarding.ts, server routes-persona.ts).
 * They drifted, which is how a user could set "Land Investor" yet have the
 * sidebar detect "Fix & Flip", and how onboarding could coarsen a specific
 * businessType in a parallel-write race. This module is the one place the
 * mapping lives; client and server both import it.
 *
 * Pure data + pure functions only — safe to import from both Vite (client) and
 * tsx (server); no DB, no React, no Node built-ins.
 */
import type { Persona } from "./auth";

export type BusinessType =
  | "land_flipper"
  | "note_investor"
  | "hybrid"
  | "residential_wholesaler"
  | "fix_and_flip"
  | "buy_and_hold"
  | "commercial"
  | "short_term_rental"
  | "creative_finance"
  | "developer"
  | "subdivider"
  | "tax_lien_deed"
  | "multifamily"
  | "mobile_home"
  | "agent_investor";

export type InvestorType = "land" | "notes" | "both";

/** The note vertical covers three distinct jobs, each its own persona. */
export type NoteRole = "invest" | "originate" | "service";

/** All 15 businessTypes — the canonical list the provision/onboarding enums validate against. */
export const BUSINESS_TYPES: readonly BusinessType[] = [
  "land_flipper",
  "note_investor",
  "hybrid",
  "residential_wholesaler",
  "fix_and_flip",
  "buy_and_hold",
  "commercial",
  "short_term_rental",
  "creative_finance",
  "developer",
  "subdivider",
  "tax_lien_deed",
  "multifamily",
  "mobile_home",
  "agent_investor",
];

/** 15 businessTypes collapse to 9 personas. */
export const BUSINESS_TYPE_TO_PERSONA: Record<BusinessType, Persona> = {
  note_investor: "note_investor",
  residential_wholesaler: "wholesaler",
  fix_and_flip: "fix_flipper",
  buy_and_hold: "landlord",
  short_term_rental: "landlord",
  multifamily: "landlord",
  mobile_home: "landlord",
  subdivider: "subdivider",
  developer: "subdivider",
  tax_lien_deed: "tax_delinquent",
  land_flipper: "land_investor",
  hybrid: "land_investor",
  commercial: "land_investor",
  creative_finance: "land_investor",
  agent_investor: "land_investor",
};

/**
 * Representative businessType per persona — the lossy inverse. Used ONLY to
 * reconcile the org when a persona is changed in isolation (Settings) and the
 * org has no more-specific businessType, or that businessType maps to a
 * DIFFERENT persona. Never use this to overwrite a specific businessType that
 * already collapses to the same persona (e.g. don't clobber short_term_rental
 * → buy_and_hold just because both are "landlord").
 */
export const PERSONA_TO_BUSINESS_TYPE: Record<Persona, BusinessType> = {
  land_investor: "land_flipper",
  note_investor: "note_investor",
  note_originator: "note_investor",
  note_servicer: "note_investor",
  tax_delinquent: "tax_lien_deed",
  wholesaler: "residential_wholesaler",
  subdivider: "subdivider",
  fix_flipper: "fix_and_flip",
  landlord: "buy_and_hold",
};

/** businessType → coarse investorType fork (the only path that yields "both"). */
export const BUSINESS_TYPE_TO_INVESTOR_TYPE: Record<BusinessType, InvestorType> = {
  note_investor: "notes",
  hybrid: "both",
  land_flipper: "land",
  residential_wholesaler: "land",
  fix_and_flip: "land",
  buy_and_hold: "land",
  commercial: "land",
  short_term_rental: "land",
  creative_finance: "land",
  developer: "land",
  subdivider: "land",
  tax_lien_deed: "land",
  multifamily: "land",
  mobile_home: "land",
  agent_investor: "land",
};

// ─── Residential data-plane routing (wave V3, founder ruling #11) ──────────
//
// BUSINESS_TYPE_TO_INVESTOR_TYPE maps every non-note vertical to the "land"
// investorType. That fork exists for the NOTE-vertical modules (1099-INT
// batches, lender/servicer surfaces) — it says nothing about which DATA
// sources should serve a vertical's comps/valuation. Using it for data
// routing is exactly how fix_and_flip customers got LAND comps/AVM/due-
// diligence under house labels (the 2026-07-11 demotion root cause).
//
// This set names the businessTypes whose SUBJECT PROPERTIES are houses/units.
// Their comps + valuation lookups must route through the residential seam
// (server/services/residentialComps.ts → provider registry restricted to
// residential-capable providers, i.e. ATTOM, pay-per-call) and must NEVER
// silently fall back to land-parcel sources. Deliberately a separate,
// explicit set — NOT derived from investorType — because the data-plane fork
// is orthogonal to the notes/land module fork.
//
// residential_wholesaler is deliberately NOT in this set yet: the sanctioned
// wave-V3 scope is fix_and_flip plus the landlord family (buy_and_hold /
// short_term_rental / multifamily / mobile_home). Widening the set is a
// deliberate follow-up decision, not a drive-by.
export const RESIDENTIAL_BUSINESS_TYPES: ReadonlySet<BusinessType> = new Set<BusinessType>([
  "fix_and_flip",
  "buy_and_hold",
  "short_term_rental",
  "multifamily",
  "mobile_home",
]);

/** True when the (possibly unknown) businessType string is a residential vertical. */
export function isResidentialBusinessType(value: string | null | undefined): boolean {
  return value != null && RESIDENTIAL_BUSINESS_TYPES.has(value as BusinessType);
}

const NOTE_ROLE_TO_PERSONA: Record<NoteRole, Persona> = {
  invest: "note_investor",
  originate: "note_originator",
  service: "note_servicer",
};

export function isBusinessType(value: string | undefined | null): value is BusinessType {
  return value != null && value in BUSINESS_TYPE_TO_PERSONA;
}

export function businessTypeToPersona(bt: BusinessType): Persona {
  return BUSINESS_TYPE_TO_PERSONA[bt] ?? "land_investor";
}

/**
 * Resolve the persona from an onboarding selection. The note vertical wins
 * first (investorType is the authoritative fork for 1099-INT batches and the
 * lender/servicer modules); the note-role sub-fork then picks which of the
 * three note personas applies. Falls back to land_investor for unknown input.
 */
export function derivePersona(
  businessType: BusinessType | string | undefined,
  investorType?: string,
  noteRole: NoteRole = "invest",
): Persona {
  if (investorType === "notes" || businessType === "note_investor") {
    return NOTE_ROLE_TO_PERSONA[noteRole];
  }
  if (isBusinessType(businessType)) {
    return businessTypeToPersona(businessType);
  }
  return "land_investor";
}

/** Coarse investorType from a persona (single-persona path can never yield "both"). */
export function personaToInvestorType(persona: Persona): Exclude<InvestorType, "both"> {
  return persona === "note_investor" ||
    persona === "note_originator" ||
    persona === "note_servicer"
    ? "notes"
    : "land";
}

// ─── Pax voice contexts (wave V1, founder ruling #11) ─────────────────────
//
// Pax's vertical voice registry (server/services/paxPersona.ts
// VERTICAL_CONTEXTS) historically carried only the 7 contextProfile
// InvestorType buckets, so note_servicer / note_originator collapsed to the
// generic note-investor voice and subdivider fell through to "developer".
// This union is the COMPLETE set of Pax voice keys: the original 7
// contextProfile buckets plus the three persona-resolution-only voices.
// paxPersona.ts types its registry against this union, so adding a key here
// without a voice entry there is a compile error.

export type PaxVerticalContextKey =
  // the 7 contextProfile InvestorType buckets (keep in sync with
  // server/services/contextProfile.ts — its InvestorType must stay a
  // subset of this union)
  | "wholesaler"
  | "note_investor"
  | "fix_and_flip"
  | "portfolio_builder"
  | "auction_hunter"
  | "developer"
  | "new_investor"
  // persona-resolved voices with no contextProfile bucket of their own
  | "note_servicer"
  | "note_originator"
  | "subdivider";

/**
 * Every one of the 9 personas resolves to a defined Pax voice — no persona
 * may fall through to a wrong-domain voice. Notes on the non-obvious rows:
 *   - land_investor → "new_investor": that context IS the land-investor
 *     launch voice (noun "Land Investor"; the base prompts default to it).
 *   - tax_delinquent → "auction_hunter": the redemption/auction voice —
 *     previously reachable only via the businessType bridge, now wired
 *     explicitly.
 *   - landlord → "portfolio_builder": the long-term-hold voice (cap rate /
 *     NOI / DSCR), matching contextProfile's buy_and_hold mapping.
 */
export const PAX_CONTEXT_BY_PERSONA: Record<Persona, PaxVerticalContextKey> = {
  land_investor: "new_investor",
  note_investor: "note_investor",
  note_originator: "note_originator",
  note_servicer: "note_servicer",
  tax_delinquent: "auction_hunter",
  wholesaler: "wholesaler",
  subdivider: "subdivider",
  fix_flipper: "fix_and_flip",
  landlord: "portfolio_builder",
};

/** Pax voice key for a persona; unknown input falls back to the land launch voice. */
export function paxContextKeyForPersona(persona: Persona | string | null | undefined): PaxVerticalContextKey {
  if (persona && persona in PAX_CONTEXT_BY_PERSONA) {
    return PAX_CONTEXT_BY_PERSONA[persona as Persona];
  }
  return "new_investor";
}
