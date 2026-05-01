/**
 * Persona vocabulary registry — JC#7 / VERTICAL-EXPANSION-PLAN.md primitive #2.
 *
 * Maps shared-concept keys to persona-specific copy. Pages opt into
 * persona-aware labels via the `useTerm(key)` hook; pages that haven't
 * migrated keep their hardcoded copy and continue to render correctly for
 * the default land-investor persona. Gradual rollout is the point — this
 * file should grow as surfaces opt in, not all at once.
 *
 * Keys are dotted scope.concept (e.g. "entity.lead", "pipeline.stage.closed").
 * Missing key for a persona falls through to land_investor; missing key
 * everywhere returns the key string itself so it's visible in dev.
 *
 * Why a registry vs. raw t-fn: TypeScript catches typos in keys at call
 * sites, and adding a new persona is a column-of-strings exercise rather
 * than chasing every call site.
 */

import type { Persona } from "@shared/models/auth";

type VocabularyMap = Partial<Record<Persona, string>>;

const VOCABULARY = {
  // Entities — what the user calls the things in their pipeline.
  "entity.lead": {
    land_investor: "Lead",
    note_investor: "Note seller",
    tax_delinquent: "Tax-delinquent owner",
    wholesaler: "Motivated seller",
    subdivider: "Lead",
    fix_flipper: "Distressed owner",
    landlord: "Lead",
  },
  "entity.lead.plural": {
    land_investor: "Leads",
    note_investor: "Note sellers",
    tax_delinquent: "Tax-delinquent owners",
    wholesaler: "Motivated sellers",
    subdivider: "Leads",
    fix_flipper: "Distressed owners",
    landlord: "Leads",
  },
  "entity.property": {
    land_investor: "Property",
    note_investor: "Note",
    tax_delinquent: "Property",
    wholesaler: "Subject property",
    subdivider: "Parent parcel",
    fix_flipper: "Project",
    landlord: "Rental",
  },
  "entity.property.plural": {
    land_investor: "Properties",
    note_investor: "Notes",
    tax_delinquent: "Properties",
    wholesaler: "Subject properties",
    subdivider: "Parent parcels",
    fix_flipper: "Projects",
    landlord: "Rentals",
  },
  "entity.deal": {
    land_investor: "Deal",
    note_investor: "Note acquisition",
    tax_delinquent: "Tax certificate",
    wholesaler: "Assignment",
    subdivider: "Deal",
    fix_flipper: "Flip",
    landlord: "Acquisition",
  },
  "entity.deal.plural": {
    land_investor: "Deals",
    note_investor: "Note acquisitions",
    tax_delinquent: "Tax certificates",
    wholesaler: "Assignments",
    subdivider: "Deals",
    fix_flipper: "Flips",
    landlord: "Acquisitions",
  },
  // Pipeline stages — final-stage label varies most across personas.
  "pipeline.stage.closed": {
    land_investor: "Closed",
    note_investor: "Acquired",
    tax_delinquent: "Awarded",
    wholesaler: "Assigned",
    subdivider: "Closed",
    fix_flipper: "Sold",
    landlord: "Leased",
  },
  // Display names of the persona itself — for settings + onboarding.
  "persona.name": {
    land_investor: "Land Investor",
    note_investor: "Note Investor",
    tax_delinquent: "Tax-Delinquent Specialist",
    wholesaler: "Wholesaler",
    subdivider: "Subdivider",
    fix_flipper: "Fix-and-Flipper",
    landlord: "Buy-and-Hold Landlord",
  },
} as const satisfies Record<string, VocabularyMap>;

export type VocabularyKey = keyof typeof VOCABULARY;

const DEFAULT_PERSONA: Persona = "land_investor";

export function getTerm(key: VocabularyKey, persona: Persona | null | undefined): string {
  const entry = VOCABULARY[key];
  const resolved = persona ?? DEFAULT_PERSONA;
  return entry[resolved] ?? entry[DEFAULT_PERSONA] ?? key;
}

export const PERSONAS: readonly Persona[] = [
  "land_investor",
  "note_investor",
  "tax_delinquent",
  "wholesaler",
  "subdivider",
  "fix_flipper",
  "landlord",
];
