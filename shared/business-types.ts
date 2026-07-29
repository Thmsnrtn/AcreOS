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
 *
 * 2026-07-29 — founder ruling #11 activation program in progress
 * (docs/company/founder-decisions-2026-07-28.md: build ALL registered
 * verticals fully and activate all). Maturity flips happen wave by wave
 * and ONLY when the build genuinely passes the honesty bar — a vertical
 * that cannot honestly reach the bar stays gated with its gap stated
 * rather than activated on hope. This file also received a truth pass
 * the same date: every workflowTemplateId now names a template that
 * actually exists in server/services/workflow-engine.ts (the earlier
 * "land_..." and "note_..." ids never existed there), and
 * spotlightModules name real routed surfaces / sidebar-module children.
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
    // 2026-07-29 truth pass: the previously declared land_* ids never
    // existed in workflow-engine.ts. These are the real shipped templates
    // for the land flow (lead intake, seller-financed dunning, deal close).
    workflowTemplateIds: ["tpl_new_lead_received", "tpl_payment_missed_dunning", "tpl_deal_closed"],
    spotlightModules: ["parcels", "leads", "deals", "letters", "field-scout"],
    integrations: ["county_gis", "regrid", "usda_nass", "stripe", "lob"],
  },
  note_investor: {
    id: "note_investor",
    label: "Note investor",
    shortDescription: "Buy seller-financed notes, service the payments.",
    maturity: "core",
    // 2026-07-29 truth pass: the previously declared note_* ids never
    // existed in workflow-engine.ts. Real shipped note templates: missed
    // payment dunning, payment-received receipt, delinquency escalation,
    // and post-close note setup.
    workflowTemplateIds: [
      "tpl_payment_missed_dunning",
      "tpl_note_payment_received_receipt",
      "tpl_delinquency_escalation",
      "tpl_note_setup",
    ],
    spotlightModules: ["notes", "borrowers", "money", "letters"],
    integrations: ["stripe", "tax_identity"],
  },
  hybrid: {
    id: "hybrid",
    label: "Land + notes (hybrid)",
    shortDescription: "Operate both books in one workspace.",
    maturity: "core",
    // 2026-07-29 truth pass: real template ids (see land_flipper /
    // note_investor entries) — one from each book.
    workflowTemplateIds: ["tpl_new_lead_received", "tpl_payment_missed_dunning"],
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
    // 2026-07-29 truth pass: all three flip templates ship in
    // workflow-engine.ts; the Flip sidebar module (businessTypeOnly
    // fix_and_flip) surfaces /rehabs + /contractors, which existing
    // fix_and_flip orgs keep per the 2026-07-11 decision above.
    workflowTemplateIds: [
      "tpl_fix_flip_rehab_kickoff",
      "tpl_flip_milestone_demo_complete",
      "tpl_flip_listing_ready",
    ],
    spotlightModules: ["rehabs", "contractors", "properties", "deals"],
    integrations: ["stripe"],
  },
  residential_wholesaler: {
    id: "residential_wholesaler",
    label: "Residential wholesaler",
    shortDescription: "Assign contracts to investor buyers.",
    maturity: "beta",
    // 2026-07-29 truth pass: the wholesaler build was real but undeclared
    // here. Wholesale sidebar module (businessTypeOnly
    // residential_wholesaler): buyer blasts, /buyer-analytics,
    // /earnest-money, /double-close, /wholesaler-state-rules. All four
    // template ids exist in workflow-engine.ts.
    workflowTemplateIds: [
      "tpl_wholesaler_contract_signed_buyer_broadcast",
      "tpl_wholesaler_assignment_pending",
      "tpl_wholesaler_occupied_cash_for_keys",
      "tpl_buyer_match_found",
    ],
    spotlightModules: [
      "leads",
      "deals",
      "campaigns",
      "buyer-analytics",
      "earnest-money",
      "double-close",
      "wholesaler-state-rules",
    ],
    integrations: ["stripe"],
  },
  buy_and_hold: {
    id: "buy_and_hold",
    label: "Buy-and-hold rentals",
    shortDescription: "Long-term residential rental portfolios.",
    // 2026-07-29 (founder ruling #11, wave V1): roadmap → beta. The build
    // justifies it — verified against the tree, not hope:
    //   - 12 tables in shared/schema/rental.ts (tenants, tenant_screenings
    //     + fcra_attestations (FCRA), rental_leases + lease_tenants +
    //     lease_addendums, rent_charges, rent_payments, late_fee_rules,
    //     maintenance_tickets, move_inspections, security_deposits);
    //   - 4 registered route modules (routes-rentals, routes-rent-ledger,
    //     routes-rent-roll-import, routes-maintenance-tickets — routes.ts);
    //   - routed pages /rent-roll /tenants /leases /maintenance
    //     /investor-analytics (App.tsx) behind the dedicated "Rentals"
    //     sidebar module (layout-sidebar id "landlord", businessTypeOnly
    //     buy_and_hold).
    // Rent operations do NOT touch the residential-comps data plane, so
    // the "no residential comps before its revenue trigger" hard-stop is
    // unaffected (fix_and_flip stays roadmap for exactly that reason).
    maturity: "beta",
    // All four exist in workflow-engine.ts (landlord moments + lease expiry).
    workflowTemplateIds: [
      "tpl_landlord_lease_renewal_countdown",
      "tpl_landlord_maintenance_request_triage",
      "tpl_landlord_rent_received_receipt",
      "tpl_lease_expiring",
    ],
    spotlightModules: ["rent-roll", "tenants", "leases", "maintenance", "investor-analytics"],
    // Honest: no dedicated integration is wired yet — the rent ledger is
    // manual-entry (Stripe ACH explicitly out of scope per
    // routes-rent-ledger.ts) and no screening-bureau provider exists in
    // the provider registry.
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
    // 2026-07-29 (founder ruling #11, wave V1 truth pass): beta → roadmap.
    // "Beta" was aspirational — there is ZERO dedicated surface: no
    // businessTypeOnly sidebar module, no creative-finance tables, routes,
    // or pages; the only code references are the onboarding/contextProfile
    // persona mappings. Ruling #11's honesty bar says gated-with-gap-stated
    // beats activated-on-hope, so it goes to the waitlist honestly. Build
    // wave V2 brings it back to beta when a real subject-to / wrap /
    // lease-option surface actually exists.
    maturity: "roadmap",
    workflowTemplateIds: [],
    spotlightModules: [],
    integrations: [],
  },
  developer: {
    id: "developer",
    label: "Developer / builder",
    shortDescription: "New construction projects.",
    maturity: "roadmap",
    workflowTemplateIds: [],
    // 2026-07-29 truth pass: developer signups DO get a real surface —
    // the Subdivision sidebar module gates businessTypeOnly
    // ["subdivider", "developer"] (persona-mapping collapses developer →
    // subdivider), so the lots/permits/plats model applies to them too.
    spotlightModules: ["permits", "county-timelines", "lot-pricing", "ccr-templates"],
    integrations: ["county_gis"],
  },
  subdivider: {
    id: "subdivider",
    label: "Subdivider",
    shortDescription: "Buy parent parcels, split into lots.",
    maturity: "beta",
    // 2026-07-29 truth pass: all three subdivision templates exist in
    // workflow-engine.ts. "subdivision-editor" was a dangling name — there
    // is no such route; subdivision editing lives on the parcel-detail
    // Subdivision tab, and the Subdivision sidebar module surfaces
    // /permits, /county-timelines, /lot-pricing, /ccr-templates.
    workflowTemplateIds: [
      "tpl_subdivision_plat_submitted",
      "tpl_subdivision_vendor_milestone",
      "tpl_subdivision_phase_recorded",
    ],
    spotlightModules: ["parcels", "permits", "county-timelines", "lot-pricing", "ccr-templates"],
    integrations: ["county_gis"],
  },
  tax_lien_deed: {
    id: "tax_lien_deed",
    label: "Tax lien / deed",
    shortDescription: "Acquire properties through tax auctions.",
    maturity: "beta",
    // 2026-07-29 truth pass: the tax-delinquent build was real but
    // undeclared here. Tax-delinquent sidebar module (businessTypeOnly
    // tax_lien_deed): /redemption-clock, /auction-worksheet, /state-rules,
    // /quiet-title. All three certificate templates exist in
    // workflow-engine.ts.
    workflowTemplateIds: [
      "tpl_tax_cert_acquired_kickoff",
      "tpl_tax_cert_redemption_approaching",
      "tpl_tax_cert_foreclosure_eligible",
    ],
    spotlightModules: ["redemption-clock", "auction-worksheet", "state-rules", "quiet-title"],
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
