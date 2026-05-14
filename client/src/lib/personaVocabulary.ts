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
    // Note Investor vertical (Phase 5 §5): leads → note opportunities (a
    // tape entry / a single note offered for sale) rather than note
    // sellers. The seller of the tape is a relationship, not a pipeline
    // entity for note investors.
    note_investor: "Note opportunity",
    // Pillar K sub-personas. Originators see leads as prospective
    // borrowers (people they might lend to); servicers don't have a
    // lead funnel — they service existing notes, so the term collapses
    // to the note itself.
    note_originator: "Prospective borrower",
    note_servicer: "Serviced note",
    tax_delinquent: "Tax-delinquent owner",
    wholesaler: "Motivated seller",
    subdivider: "Lead",
    fix_flipper: "Distressed owner",
    landlord: "Lead",
  },
  "entity.lead.plural": {
    land_investor: "Leads",
    note_investor: "Note opportunities",
    note_originator: "Prospective borrowers",
    note_servicer: "Serviced notes",
    tax_delinquent: "Tax-delinquent owners",
    wholesaler: "Motivated sellers",
    subdivider: "Leads",
    fix_flipper: "Distressed owners",
    landlord: "Leads",
  },
  "entity.property": {
    land_investor: "Property",
    // Note investors think of the secured asset as collateral, not a
    // property — the collateral is the parcel that backs the note.
    note_investor: "Collateral",
    note_originator: "Collateral",
    note_servicer: "Collateral",
    tax_delinquent: "Property",
    wholesaler: "Subject property",
    subdivider: "Parent parcel",
    fix_flipper: "Project",
    landlord: "Rental",
  },
  "entity.property.plural": {
    land_investor: "Properties",
    note_investor: "Collateral",
    note_originator: "Collateral",
    note_servicer: "Collateral",
    tax_delinquent: "Properties",
    wholesaler: "Subject properties",
    subdivider: "Parent parcels",
    fix_flipper: "Projects",
    landlord: "Rentals",
  },
  "entity.deal": {
    land_investor: "Deal",
    note_investor: "Note acquisition",
    note_originator: "Origination",
    note_servicer: "Servicing event",
    tax_delinquent: "Tax certificate",
    wholesaler: "Assignment",
    subdivider: "Deal",
    fix_flipper: "Flip",
    landlord: "Acquisition",
  },
  "entity.deal.plural": {
    land_investor: "Deals",
    note_investor: "Note acquisitions",
    note_originator: "Originations",
    note_servicer: "Servicing events",
    tax_delinquent: "Tax certificates",
    wholesaler: "Assignments",
    subdivider: "Deals",
    fix_flipper: "Flips",
    landlord: "Acquisitions",
  },
  // Pipeline scope — what the user thinks of as "their pipeline".
  "pipeline.label": {
    land_investor: "Pipeline",
    note_investor: "Note pipeline",
    note_originator: "Origination pipeline",
    note_servicer: "Servicing book",
    tax_delinquent: "Pipeline",
    wholesaler: "Pipeline",
    subdivider: "Pipeline",
    fix_flipper: "Pipeline",
    landlord: "Pipeline",
  },
  // Pipeline stages — final-stage label varies most across personas.
  "pipeline.stage.closed": {
    land_investor: "Closed",
    note_investor: "Acquired",
    note_originator: "Originated",
    note_servicer: "Resolved",
    tax_delinquent: "Awarded",
    wholesaler: "Assigned",
    subdivider: "Closed",
    fix_flipper: "Sold",
    landlord: "Leased",
  },
  // Outreach artefacts. Yellow letters are land-flipper specific (paper
  // letters mailed to landowners) — note investors don't use them. We
  // expose the key for parity but pages should hide the surface entirely
  // when the persona is note_investor rather than translate.
  "outreach.yellow_letter": {
    land_investor: "Yellow letter",
    note_investor: "Yellow letter", // n/a — surface is hidden upstream
    note_originator: "Yellow letter",
    note_servicer: "Yellow letter",
    tax_delinquent: "Yellow letter",
    wholesaler: "Yellow letter",
    subdivider: "Yellow letter",
    fix_flipper: "Yellow letter",
    landlord: "Yellow letter",
  },
  // Discovery / enrichment actions.
  "action.skip_trace": {
    land_investor: "Skip trace",
    // Borrower-locate is the note-industry term for what land investors
    // call skip tracing. Same provider stack underneath.
    note_investor: "Borrower locate",
    note_originator: "Borrower locate",
    note_servicer: "Borrower locate",
    tax_delinquent: "Skip trace",
    wholesaler: "Skip trace",
    subdivider: "Skip trace",
    fix_flipper: "Skip trace",
    landlord: "Skip trace",
  },
  // Valuation product.
  "product.avm": {
    land_investor: "AVM",
    // BPO (Broker Price Opinion) is the note-industry equivalent of an
    // AVM — a valuation of the collateral by an independent broker.
    note_investor: "BPO",
    // Originators typically order a full appraisal (Reg-Z / Dodd-Frank
    // depend on collateral value at origination). Servicers reuse the
    // BPO the owner provides.
    note_originator: "Appraisal",
    note_servicer: "BPO",
    tax_delinquent: "AVM",
    wholesaler: "AVM",
    subdivider: "AVM",
    fix_flipper: "AVM",
    landlord: "AVM",
  },
  // Comparables — the supporting evidence under a valuation.
  "product.comp": {
    land_investor: "Comp",
    note_investor: "Recent comparable note sale",
    note_originator: "Comparable origination",
    note_servicer: "Recent comparable note sale",
    tax_delinquent: "Comp",
    wholesaler: "Comp",
    subdivider: "Comp",
    fix_flipper: "Comp",
    landlord: "Comp",
  },
  // Display names of the persona itself — for settings + onboarding.
  "persona.name": {
    land_investor: "Land Investor",
    note_investor: "Note Investor",
    note_originator: "Note Originator",
    note_servicer: "Note Servicer",
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
  "note_originator",
  "note_servicer",
  "tax_delinquent",
  "wholesaler",
  "subdivider",
  "fix_flipper",
  "landlord",
];

/**
 * Map the org-level `investorType` column ('land' | 'notes' | 'both') to
 * the persona key the vocabulary registry expects. 'both' resolves to
 * note_investor on note-specific surfaces; surfaces that are mixed
 * (dashboard, founder views) call getTerm() with land_investor and
 * fall through to land copy. Surfaces that opt into note vocabulary
 * (e.g. /notes) pass note_investor explicitly.
 */
export function personaForInvestorType(
  investorType: string | null | undefined,
): Persona {
  if (investorType === "notes" || investorType === "both") return "note_investor";
  return "land_investor";
}
