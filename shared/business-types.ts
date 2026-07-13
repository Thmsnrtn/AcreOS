/**
 * Pillar H / H1 — Vertical maturity scorecard.
 *
 * Single source of truth for which of the 15 declared business types
 * are production-ready vs. beta vs. roadmap-only. Drives:
 *
 *   - Landing-page filtering (which verticals to show as "shipping today")
 *   - Onboarding wizard default-shown options
 *   - Sidebar module gating
 *   - Marketing copy generation
 *   - Vertical-aware Pax personalization
 *
 * Maturity tiers:
 *   core     — production-ready, full workflow templates, dedicated
 *              integrations, primary marketing surface.
 *   beta     — schema + onboarding path defined, partial workflow, no
 *              dedicated marketing surface. Customers can opt in but
 *              see "Beta" badges throughout.
 *   roadmap  — declared in the registry for waitlist + research, but
 *              UI affordances are intentionally suppressed.
 */

export const BUSINESS_TYPE_IDS = [
  "land_flipper",
  "note_investor",
  "hybrid",
  "residential_wholesaler",
  "fix_and_flip",
  "buy_and_hold",
  "short_term_rental",
  "commercial",
  "creative_finance",
  "developer",
  "subdivider",
  "tax_lien_deed",
  "multifamily",
  "mobile_home",
  "agent_investor",
] as const;

export type BusinessTypeId = (typeof BUSINESS_TYPE_IDS)[number];
export type VerticalMaturity = "core" | "beta" | "roadmap";

export interface BusinessTypeMeta {
  id: BusinessTypeId;
  label: string;
  shortDescription: string;
  maturity: VerticalMaturity;
  // Workflow template ids that ship with this vertical (only meaningful
  // for core + beta).
  workflowTemplateIds: string[];
  // Sidebar modules to highlight for this vertical. Empty array = all.
  spotlightModules: string[];
  // Vertical-specific integrations. Used by /api/trust/sub-processors
  // filtering + onboarding nudges.
  integrations: string[];
}

export const BUSINESS_TYPES: Record<BusinessTypeId, BusinessTypeMeta> = {
  land_flipper: {
    id: "land_flipper",
    label: "Land flipper",
    shortDescription: "Buy vacant parcels, mark them up, sell.",
    maturity: "core",
    workflowTemplateIds: ["land_lead_received", "land_payment_dunning", "land_deal_closed"],
    spotlightModules: ["parcels", "leads", "deals", "letters", "field-scout"],
    integrations: ["county_gis", "regrid", "usda_nass", "stripe", "lob"],
  },
  note_investor: {
    id: "note_investor",
    label: "Note investor",
    shortDescription: "Buy seller-financed notes, service the payments.",
    maturity: "core",
    workflowTemplateIds: ["note_payment_missed", "note_partial_payment", "note_payoff"],
    spotlightModules: ["notes", "borrowers", "money", "letters"],
    integrations: ["stripe", "tax_identity"],
  },
  hybrid: {
    id: "hybrid",
    label: "Land + notes (hybrid)",
    shortDescription: "Operate both books in one workspace.",
    maturity: "core",
    workflowTemplateIds: ["land_lead_received", "note_payment_missed"],
    spotlightModules: ["parcels", "notes", "deals", "money"],
    integrations: ["county_gis", "regrid", "stripe", "lob"],
  },
  fix_and_flip: {
    id: "fix_and_flip",
    label: "Fix-and-flip",
    shortDescription: "Buy distressed houses, renovate, resell.",
    // Founder decision 2026-07-11 (roadmap Founder decision #4): demoted
    // beta → roadmap (waitlist) until a RESIDENTIAL comps/data source
    // exists — the investorType fork maps fix_and_flip to the LAND data
    // plane, so flip customers were getting land comps/AVM/due-diligence
    // under house labels. The 70%-rule underwriting math stays available;
    // existing fix_and_flip orgs keep their surfaces.
    maturity: "roadmap",
    workflowTemplateIds: ["tpl_fix_flip_rehab_kickoff"],
    spotlightModules: ["properties", "deals"],
    integrations: ["stripe"],
  },
  residential_wholesaler: {
    id: "residential_wholesaler",
    label: "Residential wholesaler",
    shortDescription: "Assign contracts to investor buyers.",
    maturity: "beta",
    workflowTemplateIds: [],
    spotlightModules: ["leads", "deals", "campaigns"],
    integrations: ["stripe"],
  },
  buy_and_hold: {
    id: "buy_and_hold",
    label: "Buy-and-hold rentals",
    shortDescription: "Long-term residential rental portfolios.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  short_term_rental: {
    id: "short_term_rental",
    label: "Short-term rentals",
    shortDescription: "Airbnb / VRBO operators.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  commercial: {
    id: "commercial",
    label: "Commercial real estate",
    shortDescription: "Retail, office, industrial assets.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  creative_finance: {
    id: "creative_finance",
    label: "Creative finance",
    shortDescription: "Subject-to, wraps, lease-options.",
    maturity: "beta",
    workflowTemplateIds: [],
    spotlightModules: ["notes", "deals"],
    integrations: ["stripe"],
  },
  developer: {
    id: "developer",
    label: "Developer / builder",
    shortDescription: "New construction projects.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  subdivider: {
    id: "subdivider",
    label: "Subdivider",
    shortDescription: "Buy parent parcels, split into lots.",
    maturity: "beta",
    workflowTemplateIds: [],
    spotlightModules: ["parcels", "subdivision-editor"],
    integrations: ["county_gis"],
  },
  tax_lien_deed: {
    id: "tax_lien_deed",
    label: "Tax lien / deed",
    shortDescription: "Acquire properties through tax auctions.",
    maturity: "beta",
    workflowTemplateIds: [],
    spotlightModules: ["properties", "deals"],
    integrations: ["county_gis"],
  },
  multifamily: {
    id: "multifamily",
    label: "Multifamily",
    shortDescription: "Small + mid apartment buildings.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  mobile_home: {
    id: "mobile_home",
    label: "Mobile home / park",
    shortDescription: "Mobile home park operators + flippers.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  agent_investor: {
    id: "agent_investor",
    label: "Agent-investor",
    shortDescription: "Licensed agents who also invest.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
};

export function getBusinessType(id: string | null | undefined): BusinessTypeMeta | null {
  if (!id) return null;
  return (BUSINESS_TYPES as Record<string, BusinessTypeMeta>)[id] ?? null;
}

export function listByMaturity(maturity: VerticalMaturity): BusinessTypeMeta[] {
  return Object.values(BUSINESS_TYPES).filter((b) => b.maturity === maturity);
}

export function isCore(id: string | null | undefined): boolean {
  return getBusinessType(id)?.maturity === "core";
}
export function isProductionReady(id: string | null | undefined): boolean {
  const m = getBusinessType(id)?.maturity;
  return m === "core" || m === "beta";
}
