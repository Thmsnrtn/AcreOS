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
    // tpl_parcel_owner_changed_followup rides the ONLY live-emitted trigger
    // (parcelDeltaDetector) — added wave V3 with the other real-event templates.
    workflowTemplateIds: [
      "tpl_new_lead_received",
      "tpl_payment_missed_dunning",
      "tpl_deal_closed",
      "tpl_parcel_owner_changed_followup",
    ],
    // "field-scout" removed 2026-07-29: FieldScoutPage is imported but no
    // route registers it — the registry must not name unreachable surfaces.
    spotlightModules: ["parcels", "leads", "deals", "letters"],
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
    // note_investor entries) — one from each book, plus the live-emitted
    // parcel owner-change follow-up (wave V3).
    workflowTemplateIds: [
      "tpl_new_lead_received",
      "tpl_payment_missed_dunning",
      "tpl_parcel_owner_changed_followup",
    ],
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
    //
    // 2026-07-29 (founder ruling #11, wave V3): roadmap → beta. The
    // demotion's root cause is FIXED — not by a residential data PLANE
    // (that hard-stop stands: no bulk ingest, no dedicated vendors), but by
    // routing residential verticals' comps/valuation through the EXISTING
    // provider registry's ATTOM provider (pay-per-call: comps 20¢ /
    // valuation 10¢, BYOK channel "attom") via the residentialComps seam:
    //   - RESIDENTIAL_BUSINESS_TYPES (shared/models/persona-mapping.ts) is
    //     the explicit data-plane fork — no longer inferred from the
    //     investorType="land" collapse;
    //   - server/services/residentialComps.ts restricts registry candidates
    //     to residential-capable providers (allowProviders ["attom"]) so a
    //     house subject can never silently get Regrid LAND comps;
    //   - both chokepoints fork: comps.ts getComparableProperties (behind
    //     every comps consumer) and acreOSValuation.generateValuation
    //     (behind /api/avm/*), with land $/acre math disabled on house
    //     comps and attom_avm labeled honestly in history/pin-tap;
    //   - honest degradation: no ATTOM key (platform or BYOK) → an explicit
    //     unavailable state naming the fix path, never land-as-house data
    //     (pinned by residentialComps / residentialNoLandFallback /
    //     residentialConsumerFork tests).
    //
    // 2026-08 (audit Wave 1, beta→core): the renovate half of the loop is now
    // LIVE, not just declared — rehab.milestone + rehab.punch_list_complete are
    // emitted from the rehab status machine (server/services/rehabEvents.ts,
    // registered in shared/workflow-live-triggers.ts, pinned by
    // tests/unit/rehabEvents.test.ts + workflowActionHonesty). The two flip
    // milestone templates were corrected to bind only real rehab fields and
    // prompt the operator to pull comps rather than interpolate an invented
    // comp number. With the ATTOM data seam already wired, the loop now fires
    // end-to-end — so this passes the honesty bar for core.
    maturity: "core",
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
    // ATTOM is the vertical-defining data integration (residential comps +
    // valuation, pay-per-call via the residentialComps seam / provider
    // registry) — named here honestly, not just Stripe (audit Wave 1).
    integrations: ["stripe", "attom"],
  },
  residential_wholesaler: {
    id: "residential_wholesaler",
    label: "Residential wholesaler",
    shortDescription: "Assign contracts to investor buyers.",
    // 2026-08 audit Wave 1: beta → core. Three of the four wholesaler templates
    // are now LIVE — deal.contract_signed + deal.assignment_pending fire from the
    // deal/assignment write-paths (wholesaleEvents.ts) and buyer.match_created
    // fires from the AI matcher's fresh-insert branch (buyerEvents.ts); all three
    // are registered in shared/workflow-live-triggers.ts and pinned by
    // workflowActionHonesty. The vertical passes the honesty bar for core.
    maturity: "core",
    // 2026-07-29 truth pass: the wholesaler build was real but undeclared
    // here. Wholesale sidebar module (businessTypeOnly
    // residential_wholesaler): buyer blasts, /buyer-analytics,
    // /earnest-money, /double-close, /wholesaler-state-rules.
    //
    // 2026-08 audit Wave 1: tpl_wholesaler_occupied_cash_for_keys was REMOVED
    // from this advertised list. Its event (deal.occupied) has ZERO schema
    // backing — no occupancy/occupant/cash-for-keys column or table exists on the
    // deal/property path, so it cannot be made honest. The template object stays
    // in workflow-engine.ts (pinned by PRE_EXISTING_IDS, still installable) but
    // honestly badged "not live" — it is no longer advertised as part of the core
    // wholesaler pack. The remaining three are the live ones.
    workflowTemplateIds: [
      "tpl_wholesaler_contract_signed_buyer_broadcast",
      "tpl_wholesaler_assignment_pending",
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
    // 2026-08 audit Wave 1: corrected ["stripe"] → []. No wholesaler surface uses
    // Stripe — earnest-money and double-close are pure record tables, and the
    // money-custody hard-stop (founder ruling 2026-07-29) FORBIDS customer EMD /
    // assignment funds transiting AcreOS's own account, so there is no platform
    // payment rail here to name. Subscription payments TO AcreOS are billing, not
    // a vertical integration.
    integrations: [],
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
    // 2026-08 audit Wave 1: beta → core. All four landlord templates are now
    // LIVE — rent.received fires on the rent-ledger payment POST seam,
    // maintenance.request_received on the maintenance-ticket POST seam, and the
    // two lease events (renewal countdown + expiring) from the new daily
    // leaseExpiryDetector job (server/services/rentalEvents.ts → emitRentalEvent).
    // The templates were de-fabricated in the same change — the market/suggested
    // rent placeholders were dropped rather than touch the residential-comps data
    // plane (that hard-stop is upheld: the templates now PROMPT the operator to
    // pull market rent on their own surface). The vertical passes the honesty bar
    // for core.
    maturity: "core",
    // All four exist in workflow-engine.ts (landlord moments + lease expiry) and
    // are now wired live (see rentalEvents.ts + leaseExpiryDetector.ts).
    workflowTemplateIds: [
      "tpl_landlord_lease_renewal_countdown",
      "tpl_landlord_maintenance_request_triage",
      "tpl_landlord_rent_received_receipt",
      "tpl_lease_expiring",
    ],
    spotlightModules: ["rent-roll", "tenants", "leases", "maintenance", "investor-analytics"],
    // Honest, and UNCHANGED by the beta→core flip: no dedicated integration is
    // wired yet — the rent ledger is manual-entry (Stripe ACH explicitly out of
    // scope per routes-rent-ledger.ts) and no screening-bureau provider exists in
    // the provider registry. The rent-receipt / renewal / acknowledgment emails
    // ride the org's OWN connected identity (the BYO counterparty email lane),
    // not a provider-registry integration, so there is nothing to declare here.
    integrations: [],
  },
  short_term_rental: {
    id: "short_term_rental",
    label: "Short-term rentals",
    shortDescription: "Airbnb / VRBO operators.",
    // 2026-07-29 (founder ruling #11, wave V3): stays roadmap — the honesty
    // bar for beta is not met. What EXISTS today (V1 widened the landlord
    // family): the Rentals sidebar module (rent roll, tenants, leases,
    // maintenance, analytics), the landlord Today lede + surfaces cluster,
    // and the real landlord dashboard. What's MISSING for beta: everything
    // STR-specific — no channel manager / booking-calendar sync (Airbnb,
    // VRBO), no nightly-rate pricing, no turnover/cleaning scheduling; the
    // rentals stack models monthly term leases, not nightly stays.
    maturity: "roadmap",
    // Only the landlord templates whose mechanics genuinely apply to the
    // nightly-booking model: maintenance triage (property upkeep is
    // universal) and the rent-received receipt (fires when the operator
    // runs mid-term stays through the rent ledger). The lease-renewal /
    // lease-expiring templates are deliberately EXCLUDED — nightly bookings
    // have no 60-day renewal moment.
    workflowTemplateIds: [
      "tpl_landlord_maintenance_request_triage",
      "tpl_landlord_rent_received_receipt",
    ],
    // The real Rentals surfaces this businessType reaches (V1 gate; same
    // children as buy_and_hold in layout-sidebar.tsx).
    spotlightModules: ["rent-roll", "tenants", "leases", "maintenance", "investor-analytics"],
    integrations: [],
  },
  commercial: {
    id: "commercial",
    label: "Commercial real estate",
    shortDescription: "Retail, office, industrial assets.",
    // 2026-07-29 (founder ruling #11, wave V3): stays roadmap — the honesty
    // bar for beta is not met. What EXISTS today: a schema audit of
    // shared/schema/rental.ts found the core loop lease-generic (term
    // leases, base-rent charges/payments, maintenance→contractor dispatch,
    // security deposits; Section 8 / FCRA / lead-paint fields optional and
    // default off), so the Rentals sidebar module gate now includes
    // commercial, the dashboard routes commercial to the real landlord
    // dashboard (wave V2, type-specific-widgets.tsx), and /today gets a
    // commercial cluster (rentals stack + /deals + /properties). What's
    // MISSING for beta: entity tenants (the tenants table is person-shaped
    // — required first/last name, no company field), CAM / NNN
    // pass-through reconciliation, percentage rent, escalation schedules,
    // per-square-foot metrics, and the state late-fee rules table encodes
    // RESIDENTIAL statutes (operator-initiated; wrong-domain for a
    // commercial lease — a commercial operator should skip that endpoint).
    maturity: "roadmap",
    // Landlord templates whose mechanics genuinely apply to commercial
    // base-rent operations: maintenance triage, rent-received receipt, and
    // the plain lease-expiring renewal task. tpl_landlord_lease_renewal_
    // countdown is deliberately EXCLUDED — its rent-review math cites
    // AVM/comps market rent, and no commercial rent-comps source exists.
    workflowTemplateIds: [
      "tpl_landlord_maintenance_request_triage",
      "tpl_landlord_rent_received_receipt",
      "tpl_lease_expiring",
    ],
    // The real surfaces a commercial org reaches today: the Rentals module
    // children (V3 gate) plus the deal pipeline and property inventory.
    spotlightModules: [
      "rent-roll",
      "tenants",
      "leases",
      "maintenance",
      "investor-analytics",
      "deals",
      "properties",
    ],
    // Honest: like buy_and_hold, the rent ledger is manual-entry — no
    // dedicated commercial integration is wired.
    integrations: [],
  },
  creative_finance: {
    id: "creative_finance",
    label: "Creative finance",
    shortDescription: "Subject-to, wraps, lease-options.",
    // 2026-07-29 (founder ruling #11, wave V2): roadmap → beta. V1 demoted
    // this honestly (zero dedicated surface); V2 assembled the surface from
    // the seller-finance rails that already shipped — verified against the
    // tree, not hope:
    //   - dedicated "Creative finance" sidebar module (layout-sidebar id
    //     "creative-finance", businessTypeOnly creative_finance): /deals
    //     pipeline, /finance carried-note book, /dodd-frank checker,
    //     /regulatory-intel state rules — all routed in App.tsx and none
    //     nav-hidden for this profile;
    //   - the Close & Carry deal→note bridge: CarryNoteDialog on /deals/:id
    //     → POST /api/notes/from-deal/:dealId (mapDealToNoteFields in
    //     server/routes-notes.ts, pinned by tests/unit/carryNoteFromDeal
    //     .test.ts) — a closed seller-finance deal becomes a serviced note
    //     with no re-keying, landing "pending" behind the Reg-Z chokepoint;
    //   - origination compliance: the Dodd-Frank checker page (/dodd-frank →
    //     /api/dodd-frank/check), the ATR/Reg-Z §1026.43 activation gate
    //     (AtrGate in the /finance note drawer), the RMLO advisor
    //     (shared/regulatory/rmloAdvisor.ts), and amortization schedules on
    //     every serviced note;
    //   - /today "Creative-finance surfaces" cluster (today-vertical-
    //     surfaces.ts) for the morning loop;
    //   - onboarding CREATIVE_FINANCE_TEMPLATES (subject-to + lease-option
    //     campaigns, tags, owner-carry note settings) + a seeded subject-to
    //     lead/deal + note-shaped sample fixtures (server/services/
    //     onboarding.ts).
    // Known gap, stated: the Mortgage Notes module itself stays nav-hidden
    // for this vertical (creative_finance derives orgInvestorType "land";
    // byOrgInvestorType.land hides /notes) — the carried book is reached via
    // the Finance door instead. The seller-finance workflow runs on deal/
    // note rails and does NOT touch the residential-comps data plane, so the
    // "no residential comps before its revenue trigger" hard-stop is
    // unaffected (fix_and_flip stays roadmap for exactly that reason).
    // 2026-08 audit Wave 1: beta → core. The balloon lane is now LIVE —
    // note.balloon_approaching is emitted from the daily notePaymentDueDetector
    // scan (server/services/noteEvents.ts → emitNoteEvent; the balloon scan
    // folded into runNotePaymentDueScan, no new job), deduped per (note,
    // maturityDate) on the mesh ledger, and its two templates were de-fabricated
    // in the same change (the invented {{balloonAmount}} → the honest,
    // approximate {{outstandingBalance}} = notes.currentBalance; the exact
    // balloon lives in the amortization schedule, never claimed). This was
    // creative_finance's ONLY genuinely-dead template lane — the deal→note bridge
    // (tpl_deal_closed / tpl_note_setup) and payment.missed dunning already fire —
    // so the vertical now passes the honesty bar for core. rentalEvents.ts +
    // noteEvents.ts + workflowActionHonesty pin the live-trigger relationship.
    maturity: "core",
    // All four exist in workflow-engine.ts: deal close (with the
    // seller-financed note-setup task), owner-finance note setup, missed-
    // payment dunning, and the balloon 90-day countdown (balloons being a
    // hallmark of wrap/owner-carry paper).
    workflowTemplateIds: [
      "tpl_deal_closed",
      "tpl_note_setup",
      "tpl_payment_missed_dunning",
      "tpl_balloon_approaching",
    ],
    spotlightModules: ["deals", "finance", "dodd-frank", "regulatory-intel"],
    // Serviced notes ride the same Stripe rails as the note vertical
    // (payment links / Stripe Connect in the /finance note drawer).
    integrations: ["stripe"],
  },
  developer: {
    id: "developer",
    label: "Developer / entitlements",
    shortDescription: "Entitle land: permits, county timelines, lot pricing, plats.",
    // 2026-08 (audit Wave 2, roadmap → beta): "developer" is really the
    // subdivider / entitlement workspace under a mislabeled name.
    // persona-mapping.ts collapses developer → subdivider, and the Subdivision
    // sidebar module already gates businessTypeOnly ["subdivider","developer"],
    // so the lots / permits / plats / county-timeline model is this vertical's
    // REAL surface — it was always live for these signups, just described
    // wrong. The over-promise was the framing, not the build: the "New
    // construction projects." shortDescription (and the onboarding "and new
    // construction" clause) advertised a ground-up construction product that
    // does not exist; both were removed in this change. The three subdivision
    // templates below are ALREADY LIVE for subdivider —
    // tpl_subdivision_plat_submitted / _vendor_milestone / _phase_recorded fire
    // on genuine entity transitions via subdivisionEvents.ts (plat.submitted,
    // subdivision.vendor_milestone, subdivision.phase_recorded are all in
    // shared/workflow-live-triggers.ts, pinned by workflowActionHonesty) — so
    // adopting them here is ZERO emitter work and honestly live for developer
    // too (same collapsed persona/surface). With the real entitlement surface,
    // three live templates, and the construction promise removed, the vertical
    // passes the honesty bar for beta. 2026-08 founder decision to promote.
    maturity: "beta",
    // The three subdivision templates, adopted verbatim from subdivider — the
    // same LIVE emitters serve both (developer collapses to the subdivider
    // persona/surface, so no re-wiring is required).
    workflowTemplateIds: [
      "tpl_subdivision_plat_submitted",
      "tpl_subdivision_vendor_milestone",
      "tpl_subdivision_phase_recorded",
    ],
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
    maturity: "core",
    // 2026-07-29 truth pass: all three subdivision templates exist in
    // workflow-engine.ts. "subdivision-editor" was a dangling name — there
    // is no such route; subdivision editing lives on the parcel-detail
    // Subdivision tab, and the Subdivision sidebar module surfaces
    // /permits, /county-timelines, /lot-pricing, /ccr-templates.
    // 2026-08 audit Wave 1: beta → core. All THREE subdivision templates now
    // have LIVE emitters on genuine operator transitions — subdivisionEvents.ts
    // → emitSubdivisionEvent fires subdivision.vendor_milestone when a permit
    // gate reaches "approved" (routes-permit-tracker PATCH), plat.submitted when
    // a plan reaches "county_submitted", and subdivision.phase_recorded when a
    // plan reaches "recorded" (routes-subdivision-plans PATCH). The two
    // fabricated placeholders were corrected in the same change
    // ({{nextCountyCheckinDays}} dropped, {{phaseNumber}} → {{planName}}).
    // Registered in shared/workflow-live-triggers.ts; workflowActionHonesty pins
    // the call-site ↔ list relationship. Passes the honesty bar for core.
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
    maturity: "core",
    // 2026-07-29 truth pass: the tax-delinquent build was real but
    // undeclared here. Tax-delinquent sidebar module (businessTypeOnly
    // tax_lien_deed): /redemption-clock, /auction-worksheet, /state-rules,
    // /quiet-title. All three certificate templates exist in
    // workflow-engine.ts.
    // Wave V3 added the redeemed-payoff packet and the live-emitted
    // parcel tax-status watchlist trigger (parcelDeltaDetector).
    // 2026-08 audit Wave 1: beta → core. All FOUR cert templates now have
    // LIVE emitters wired on genuine state transitions —
    // certificateEvents.ts → emitCertEvent fires cert.acquired on certificate
    // create (routes-tax-certificates POST + the won-bid handoff in
    // routes-tax-researcher), cert.redeemed on a genuine active→redeemed PATCH,
    // and cert.redemption_period_60d / cert.foreclosure_eligible from the
    // nightly redemption-clock job's 60-day and lapsed-deadline branches.
    // Registered in shared/workflow-live-triggers.ts; workflowActionHonesty
    // pins the call-site ↔ list relationship. Passes the honesty bar for core.
    workflowTemplateIds: [
      "tpl_tax_cert_acquired_kickoff",
      "tpl_tax_cert_redemption_approaching",
      "tpl_tax_cert_foreclosure_eligible",
      "tpl_tax_cert_redeemed_payoff",
      "tpl_parcel_tax_delinquent_watchlist",
    ],
    spotlightModules: ["redemption-clock", "auction-worksheet", "state-rules", "quiet-title"],
    integrations: ["county_gis"],
  },
  multifamily: {
    id: "multifamily",
    label: "Multifamily",
    shortDescription: "Small + mid apartment buildings.",
    // 2026-07-31 (migration 0219 — units): STILL roadmap, but one of the
    // three named gaps has genuinely closed, so the prose moves with it.
    // Leaving a closed gap asserted here would make this registry the exact
    // kind of lie the honesty gate exists to prevent.
    //
    // What EXISTS today (V1 widened the landlord family): the full Rentals
    // stack — per-unit liability, 4+ unit late-fee caps — plus the landlord
    // Today lede + cluster and the real landlord dashboard. AND, as of 0219,
    // a first-class unit inventory: `rental_units` (shared/schema/rental.ts)
    // is one row per rentable slot with its own kind (unit/pad/suite),
    // bedrooms, bathrooms, square feet, asking rent and status
    // (active/offline/retired), so a unit exists whether or not anyone has
    // ever leased it. Occupancy is now computed over that table
    // (`computeOccupancySnapshot`, GET /api/rent-roll/occupancy — a vacancy
    // is finally visible, and an unmeasurable ratio says so instead of
    // reporting 100%); the rent-roll importer writes vacant rows instead of
    // dropping them; and the §92.019 unit count is EXACT where units are
    // modelled instead of a floor (`unitCountForProperty`,
    // server/routes-rent-ledger.ts). There is deliberately no separate
    // buildings table — `properties` IS the building.
    //
    // What's still MISSING for beta — the two gaps that genuinely stand,
    // stated precisely, because the first draft of this paragraph overstated
    // one of them and an audit caught it:
    //
    //   * Building-level rollups. A per-building NOI surface DOES exist
    //     (GET /api/properties/:id/analytics and /api/portfolio/analytics,
    //     server/routes-investor-analytics.ts) — saying otherwise was wrong.
    //     What is missing is that its OPERATING EXPENSE is a 40%-of-collected
    //     rule of thumb, overridable only by a query param and never stored,
    //     because the platform holds no property-expense records at all
    //     (maintenance invoices are the only expense-shaped number anywhere).
    //     A cap rate computed off an assumed expense ratio is an assumption
    //     wearing a number's clothes. The occupancy snapshot is also ORG-WIDE
    //     with no per-building breakdown.
    //   * The T-12 / underwriting workspace multifamily operators need at
    //     scale. Nothing in the repo renders a monthly income/expense grid,
    //     and it cannot be built honestly until the expense axis above exists
    //     — a T-12 without expenses is just a rent report.
    //
    // Two of three is not beta — the standard used through 2026-07.
    //
    // 2026-08 (audit Wave 2, roadmap → beta): the founder promoted multifamily
    // to beta on the HONEST tier definition, not by closing those two gaps.
    // What makes beta defensible: all five templates FIRE (the four landlord
    // templates + tpl_multifamily_unit_turn — rent.received, lease
    // renewal/expiry, maintenance all live per shared/workflow-live-triggers.ts,
    // pinned by workflowActionHonesty), and the one number that rests on an
    // assumption — the 40%-of-collected op-ex behind per-building NOI / cap rate
    // — is DISCLOSED as an estimate everywhere it surfaces (opExBasis
    // "assumed_ratio" at the server, "(est.)" on the client analytics tiles, and
    // named in the Pax multifamily voice), so nothing presents an assumption as
    // a measurement. The two gaps above do NOT vanish: the real
    // property-expense axis and the T-12 / underwriting workspace remain the
    // CORE goal (this stays roadmap-FOR-CORE until that expense model ships).
    // Beta is scoped to the unit-scale rental operations the shipped stack
    // genuinely runs today.
    maturity: "beta",
    // All four landlord templates genuinely apply — multifamily IS
    // long-term rental operations at unit scale (term leases that renew,
    // a rent ledger, maintenance dispatch). Wave V3 added the dedicated
    // unit-turn checklist on the 60-day renewal countdown.
    workflowTemplateIds: [
      "tpl_landlord_lease_renewal_countdown",
      "tpl_landlord_maintenance_request_triage",
      "tpl_landlord_rent_received_receipt",
      "tpl_lease_expiring",
      "tpl_multifamily_unit_turn",
    ],
    spotlightModules: ["rent-roll", "tenants", "leases", "maintenance", "investor-analytics"],
    integrations: [],
  },
  mobile_home: {
    id: "mobile_home",
    label: "Mobile home / park",
    shortDescription: "Mobile home park operators + flippers.",
    // 2026-07-31 (pad inventory): stays roadmap — but for TWO reasons now,
    // not three. What EXISTS today (V1 widened the landlord family): the
    // Rentals stack works for lot leases (a lot lease is a term lease with
    // monthly rent, renewals, deposits, and maintenance — the mechanics the
    // stack models), plus the landlord Today lede + cluster and the real
    // landlord dashboard.
    //
    // PAD INVENTORY — CLOSED. This entry used to record that `rental_units.kind`
    // enumerated 'pad' and the route accepted it, while no write path in the
    // product ever set it — a column that could hold a value was not an
    // inventory anybody had. Three write paths now set it, and each is
    // driven by a real operator action:
    //   - the units surface (Units tab of /leases → UnitsPanel): create, edit,
    //     retire a pad, with the vocabulary — pads/lots, not "units";
    //   - bulk create (POST /api/rentals/properties/:id/units/bulk): "Lot 1"–
    //     "Lot 60" in one action, idempotent against the (org, property, label)
    //     unique index and reporting created-vs-already-there separately;
    //   - the lease form's slot-kind picker and the rent-roll importer's
    //     `unitKind`, which now has a driver instead of being an unwired field.
    // A park's pads are therefore an inventory an operator has, and occupancy
    // over them is computable.
    //
    // 2026-08 (audit Wave 2, roadmap → beta): the founder promoted mobile_home
    // to a LOT-LEASE-ONLY beta. What makes it defensible: the lot-lease
    // operations are honest and live — pad inventory is REAL (three write paths
    // set rental_units.kind='pad', occupancy is computed over the pads) and all
    // five templates FIRE (the four landlord templates + the
    // tpl_mobile_home_lot_rent_receipt on the real rent.received trigger, per
    // shared/workflow-live-triggers.ts + workflowActionHonesty). The home side
    // is NOT in beta scope, and it is DISCLOSED, never fabricated: no
    // home-as-chattel handling (titles, home-vs-lot rent split), no utilities
    // pass-through billing. Those are the CORE build — until they ship the
    // persona voice must keep saying both, and beta stays scoped to the lot
    // lease the shipped stack genuinely runs.
    maturity: "beta",
    // All four landlord templates genuinely apply to lot-lease operations
    // (lot leases renew, lot rent hits the ledger, park infrastructure
    // needs maintenance dispatch). Wave V3 added the lot-rent receipt on
    // the real rent.received trigger.
    workflowTemplateIds: [
      "tpl_landlord_lease_renewal_countdown",
      "tpl_landlord_maintenance_request_triage",
      "tpl_landlord_rent_received_receipt",
      "tpl_lease_expiring",
      "tpl_mobile_home_lot_rent_receipt",
    ],
    spotlightModules: ["rent-roll", "tenants", "leases", "maintenance", "investor-analytics"],
    integrations: [],
  },
  agent_investor: {
    id: "agent_investor",
    label: "Agent-investor",
    shortDescription: "Licensed agents who also invest.",
    // 2026-07-29 (founder ruling #11, wave V3): stays roadmap — the honesty
    // bar for beta is not met. What EXISTS today, DELIBERATELY: the full
    // land_investor surface (persona-mapping.ts maps agent_investor →
    // land_investor on purpose — an agent who invests in land runs the
    // same map → owner → offer sourcing loop), with nothing hidden on the
    // businessType axis (sidebar-hidden-routes.ts) and a /today cluster
    // confirming the land default is a choice, not a fallback. What's
    // MISSING for beta: everything agent-specific — commission tracking,
    // client-deals vs. own-book separation, MLS integration, dual-agency
    // disclosure workflows.
    maturity: "roadmap",
    // The generic land-loop templates genuinely apply (lead intake, deal
    // close). Dunning is excluded — it assumes a serviced-note book this
    // operator doesn't necessarily carry.
    workflowTemplateIds: ["tpl_new_lead_received", "tpl_deal_closed"],
    // The real land surfaces this operator uses (all routed; none hidden
    // for its org fingerprint): parcel map, parcel detail, seller-lead CRM,
    // deal pipeline, owner skip tracing.
    spotlightModules: ["maps", "parcels", "leads", "deals", "skip-tracing"],
    // The land data plane this surface runs on (parcel data on /maps and
    // parcel detail) — same providers the land_flipper surface uses.
    integrations: ["county_gis", "regrid"],
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
