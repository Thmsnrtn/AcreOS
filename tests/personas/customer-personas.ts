/**
 * The 30 First Users — a code-grounded customer persona catalog.
 *
 * This is the spine of the persona test (tests/e2e/customer-personas.spec.ts).
 * Every persona is anchored to REAL product behavior, not invented:
 *
 *   - `businessType` is one of the 15 canonical BUSINESS_TYPE_IDS
 *     (shared/business-types.ts), spanning all three maturity tiers
 *     (core / beta / roadmap).
 *   - `persona` + `investorType` are DERIVED via the same functions the
 *     onboarding endpoint uses (derivePersona / BUSINESS_TYPE_TO_INVESTOR_TYPE
 *     in shared/models/persona-mapping.ts). A unit test asserts every row is
 *     self-consistent, so the catalog can never drift from the product.
 *   - `expect` encodes what the platform should actually DO differently for
 *     this persona: which sidebar modules appear/disappear, which
 *     PersonaFinanceHero renders on /money, the persona vocabulary that should
 *     show on each door, and which capabilities are config-gated (so the test
 *     reports "honestly off" vs "broken").
 *
 * The 30 span every axis the prompt asked for:
 *   experience  — brand_new · returning_beginner · intermediate · power_user · skeptic
 *   business    — all 15 verticals, all 3 note roles (invest/originate/service) + hybrid
 *   device      — all 12 Playwright projects (tiny phone → ultrawide desktop)
 *   tier        — free → enterprise
 *   need/goal   — find parcels · run mail · work a pipeline · collect on notes ·
 *                 assign contracts · manage a team · just kicking the tires
 *
 * 2026-07-29 (founder ruling #11 waves V1/V2, PRs #250/#251): rows
 * re-verified against the CURRENT registry. buy_and_hold and creative_finance
 * are beta (the Rentals and Creative-finance sidebar modules are live);
 * fix_and_flip is roadmap (demoted 2026-07-11 pending a residential data
 * plane — existing orgs keep their Flip surfaces); the landlord family
 * (short_term_rental / multifamily / mobile_home) reaches the shared Rentals
 * module — short_term_rental's own vertical stays waitlisted, mobile_home is
 * beta, and multifamily is now CORE (Wave 3). A unit test pins
 * "(beta)"/"(waitlist)" display-name tags to registry maturity so these
 * labels can't silently go stale again.
 */

import {
  derivePersona,
  BUSINESS_TYPE_TO_INVESTOR_TYPE,
  type Persona,
  type InvestorType,
  type NoteRole,
} from "@shared/models/persona-mapping";
import type { BusinessTypeId } from "@shared/business-types";

/** Playwright project names (see playwright.config.ts) we assign personas to. */
export type Device =
  | "iphone-14"
  | "iphone-se"
  | "pixel-5"
  | "galaxy-s9"
  | "tiny-phone"
  | "ipad-portrait"
  | "ipad-landscape"
  | "ipad-pro"
  | "desktop-chrome"
  | "desktop-1280"
  | "desktop-ultrawide"
  | "short-wide";

export type ExperienceLevel =
  | "brand_new"
  | "returning_beginner"
  | "intermediate"
  | "power_user"
  | "skeptic";

export type Tier = "free" | "sprout" | "starter" | "pro" | "scale" | "enterprise";

/** Which PersonaFinanceHero should render on /money. null = land default hero. */
export type FinanceHero =
  | "origination"
  | "servicing"
  | "portfolio"
  | "assignment"
  | "projectPnl"
  | "lotEconomics"
  | "certificates"
  | null;

/** The five doors + the two top-bar surfaces, with their real routes. */
export const DOOR_ROUTES = {
  today: "/today",
  map: "/maps",
  deals: "/deals",
  money: "/money",
  pax: "/ai",
  inbox: "/inbox",
  settings: "/settings",
} as const;
export type Door = keyof typeof DOOR_ROUTES;

export interface PersonaExpectations {
  /** PersonaFinanceHero expected on /money. */
  financeHero: FinanceHero;
  /**
   * Sidebar module hrefs that SHOULD be reachable for this persona's
   * businessType/investorType (e.g. "/notes" for note orgs, "/redemption-clock"
   * for tax-lien operators). Checked against the rendered nav.
   */
  modulesVisible: string[];
  /**
   * Module hrefs that MUST be hidden for this persona (cross-vertical leakage).
   * e.g. a pure note org must not show land outreach; a land org must not show
   * the Notes register.
   */
  modulesHidden: string[];
  /**
   * Persona vocabulary that should appear on the given door (drawn from
   * client/src/lib/personaVocabulary.ts — these strings are persona-specific,
   * so seeing them proves the persona frame is live).
   */
  vocab: Partial<Record<Door, string[]>>;
  /**
   * Capabilities this persona will reach that are gated behind an external
   * key. The test treats a visible "not configured" state here as a PASS
   * (honest), and only flags a hard crash / silent dead button as a finding.
   */
  gatedCapabilities: string[];
}

export interface CustomerPersona {
  /** Stable kebab slug — drives the `__session=e2e-persona-<slug>` cookie. */
  slug: string;
  displayName: string;
  experience: ExperienceLevel;
  device: Device;
  tier: Tier;
  businessType: BusinessTypeId;
  /** Only set for the note vertical; selects originate/service/invest. */
  noteRole?: NoteRole;
  /** One sentence: who they are + what they came to do. */
  narrative: string;
  /** What success looks like for them in the first session. */
  goals: string[];
  /** Derived — filled by buildPersona(); never hand-set so it can't drift. */
  persona: Persona;
  investorType: InvestorType;
  expect: PersonaExpectations;
}

/** Strings that must NEVER appear on any customer surface (founder codenames). */
export const FORBIDDEN_EVERYWHERE = ["Sophie", "Forge", "Atlas", "Solene", "Autopilot Control", "/founder"];

type PersonaSeed = Omit<CustomerPersona, "persona" | "investorType">;

/** Derive persona + investorType the same way onboarding does, so rows can't drift. */
function buildPersona(seed: PersonaSeed): CustomerPersona {
  const investorType = BUSINESS_TYPE_TO_INVESTOR_TYPE[seed.businessType];
  const persona = derivePersona(seed.businessType, investorType, seed.noteRole ?? "invest");
  return { ...seed, persona, investorType };
}

// Reusable expectation fragments ───────────────────────────────────────────
const LAND_MODULES = ["/maps", "/leads", "/deals", "/campaigns"];
const NOTE_LAND_OUTREACH_HIDDEN = ["/campaigns", "/direct-mail", "/sequences", "/avm", "/skip-tracing"];

const SEEDS: PersonaSeed[] = [
  // ── LAND FLIPPER (core) × 5 — the most common first user, every device class
  {
    slug: "land-rookie-mobile",
    displayName: "Maria — first parcel, never used a CRM",
    experience: "brand_new",
    device: "iphone-14",
    tier: "free",
    businessType: "land_flipper",
    narrative: "Bought one cheap desert lot, heard AcreOS finds parcels and mails owners. On her phone in the truck.",
    goals: ["See the daily Today brief", "Run a free parcel check", "Add her first lead", "Understand what Pax can do"],
    expect: {
      financeHero: null,
      modulesVisible: LAND_MODULES,
      modulesHidden: ["/notes"],
      vocab: { deals: ["Lead", "Pipeline"], today: ["Today"] },
      gatedCapabilities: ["Regrid parcel enrichment", "Twilio SMS", "Lob direct mail", "Pax AI chat"],
    },
  },
  {
    slug: "land-operator-desktop",
    displayName: "Dwight — 120 parcels, wants a real pipeline",
    experience: "intermediate",
    device: "desktop-chrome",
    tier: "starter",
    businessType: "land_flipper",
    narrative: "Spreadsheet operator graduating to a CRM; wants the deal board and saved map views.",
    goals: ["Import leads", "Work the deal board", "Filter the parcel map", "Set up a mail campaign"],
    expect: {
      financeHero: null,
      modulesVisible: LAND_MODULES,
      modulesHidden: ["/notes"],
      vocab: { deals: ["Pipeline", "Deal"] },
      gatedCapabilities: ["Lob direct mail", "Regrid parcel enrichment"],
    },
  },
  {
    slug: "land-power-volume",
    displayName: "Pat — high-volume mail, scale tier",
    experience: "power_user",
    device: "desktop-ultrawide",
    tier: "scale",
    businessType: "land_flipper",
    narrative: "Runs thousands of mailers a month; lives on an ultrawide; cares about cost-per-piece and sequences.",
    goals: ["Build a sequence", "Check mail credits + cost", "Review pipeline analytics", "Use bulk AVM"],
    expect: {
      financeHero: null,
      modulesVisible: [...LAND_MODULES, "/sequences"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Pipeline"] },
      gatedCapabilities: ["Lob direct mail", "SES email"],
    },
  },
  {
    slug: "land-returning-ipad",
    displayName: "Rhonda — came back after a month away",
    experience: "returning_beginner",
    device: "ipad-portrait",
    tier: "sprout",
    businessType: "land_flipper",
    narrative: "Signed up, drifted, returns on an iPad — does the empty-state and re-onboarding hold up?",
    goals: ["Re-orient on Today", "Find where her one lead went", "Resume onboarding checklist"],
    expect: {
      financeHero: null,
      modulesVisible: LAND_MODULES,
      modulesHidden: ["/notes"],
      vocab: { today: ["Today"] },
      gatedCapabilities: ["Pax AI chat"],
    },
  },
  {
    slug: "land-skeptic-se",
    displayName: "Frank — kicking the tires, distrusts AI",
    experience: "skeptic",
    device: "iphone-se",
    tier: "free",
    businessType: "land_flipper",
    narrative: "Small old phone, suspicious of autonomy; will poke empty states and the Pax disclosure rail.",
    goals: ["Verify nothing auto-sends", "Read Pax transparency", "Confirm free-tier limits are honest"],
    expect: {
      financeHero: null,
      modulesVisible: LAND_MODULES,
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Pax AI chat"],
    },
  },

  // ── NOTE INVESTOR (core) — all three roles + a second investor
  {
    slug: "note-investor-buyer",
    displayName: "Nadia — buys seller-financed notes",
    experience: "intermediate",
    device: "desktop-1280",
    tier: "pro",
    businessType: "note_investor",
    noteRole: "invest",
    narrative: "Acquires performing notes; lives in the Notes register + portfolio yield.",
    goals: ["See the Notes module", "Read portfolio/UPB hero on Finance", "Record a payment", "Confirm NO land outreach clutter"],
    expect: {
      financeHero: "portfolio",
      modulesVisible: ["/notes", "/money"],
      modulesHidden: NOTE_LAND_OUTREACH_HIDDEN,
      vocab: { deals: ["Note opportunity", "Note pipeline"], money: ["Collateral", "Acquired"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "note-investor-newbie",
    displayName: "Theo — first note, learning servicing",
    experience: "brand_new",
    device: "pixel-5",
    tier: "sprout",
    businessType: "note_investor",
    noteRole: "invest",
    narrative: "New to notes on Android; needs the empty Notes state to teach, not confuse.",
    goals: ["Create his first note", "See an amortization schedule", "Understand borrower portal"],
    expect: {
      financeHero: "portfolio",
      modulesVisible: ["/notes", "/money"],
      modulesHidden: NOTE_LAND_OUTREACH_HIDDEN,
      vocab: { deals: ["Note opportunity"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "note-originator",
    displayName: "Olivia — originates notes via seller financing",
    experience: "power_user",
    device: "desktop-chrome",
    tier: "pro",
    businessType: "note_investor",
    noteRole: "originate",
    narrative: "Creates the paper she sells; Finance should show origination economics, vocabulary 'Prospective borrower'.",
    goals: ["See origination hero on Finance", "Originate a note", "Confirm 'Originated' stage vocabulary"],
    expect: {
      financeHero: "origination",
      modulesVisible: ["/notes", "/money"],
      modulesHidden: NOTE_LAND_OUTREACH_HIDDEN,
      vocab: { deals: ["Prospective borrower", "Origination"], money: ["Originated"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "note-servicer",
    displayName: "Sven — sub-services other people's notes",
    experience: "intermediate",
    device: "ipad-pro",
    tier: "scale",
    businessType: "note_investor",
    noteRole: "service",
    narrative: "Licensed servicer, not the beneficial owner; Finance should show servicing fee income + delinquency.",
    goals: ["See servicing hero", "Work the servicing book", "Confirm 'Serviced note' + 'Resolved' vocabulary"],
    expect: {
      financeHero: "servicing",
      modulesVisible: ["/notes", "/money"],
      modulesHidden: NOTE_LAND_OUTREACH_HIDDEN,
      vocab: { deals: ["Serviced note", "Servicing book"], money: ["Resolved"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },

  // ── HYBRID (core, investorType "both") × 2 — sees everything
  {
    slug: "hybrid-power",
    displayName: "Harriet — land + notes in one book",
    experience: "power_user",
    device: "desktop-ultrawide",
    tier: "enterprise",
    businessType: "hybrid",
    narrative: "Runs both books; both Notes AND land outreach must be visible — the one persona that hides nothing.",
    goals: ["Confirm BOTH notes + land modules", "Switch between land deals and the note register", "See both Finance frames"],
    expect: {
      financeHero: "portfolio",
      modulesVisible: ["/notes", "/maps", "/deals", "/campaigns", "/money"],
      modulesHidden: [],
      vocab: { deals: ["Pipeline"] },
      gatedCapabilities: ["Lob direct mail", "Stripe Connect payments"],
    },
  },
  {
    slug: "hybrid-mobile",
    displayName: "Hugo — mixed strategy, works from his phone",
    experience: "intermediate",
    device: "galaxy-s9",
    tier: "pro",
    businessType: "hybrid",
    narrative: "Older Android, does everything mobile; tests the five-door bottom nav with the densest content set.",
    goals: ["Reach all 5 doors on mobile", "Open both a deal and a note", "No horizontal overflow on a small screen"],
    expect: {
      financeHero: "portfolio",
      modulesVisible: ["/notes", "/maps", "/deals", "/money"],
      modulesHidden: [],
      vocab: {},
      gatedCapabilities: ["Lob direct mail"],
    },
  },

  // ── RESIDENTIAL WHOLESALER (core, audit Wave 1) × 3
  {
    slug: "wholesaler-operator",
    displayName: "Wanda — assigns contracts, runs buyer blasts",
    experience: "intermediate",
    device: "iphone-14",
    tier: "starter",
    businessType: "residential_wholesaler",
    narrative: "Motivated-seller → assignment fee; needs the wholesaler module + assignment-fee Finance hero.",
    goals: ["See wholesaler module (buyer blasts, earnest money)", "Confirm assignment-fee hero", "Vocabulary 'Motivated seller' / 'Assigned'"],
    expect: {
      financeHero: "assignment",
      modulesVisible: ["/leads", "/deals", "/campaigns", "/buyer-analytics", "/earnest-money"],
      modulesHidden: ["/notes", "/land-credit"],
      vocab: { deals: ["Motivated seller", "Assignment"], money: ["Assigned"] },
      gatedCapabilities: ["Twilio SMS", "SES email"],
    },
  },
  {
    slug: "wholesaler-rookie-tiny",
    displayName: "Wes — first assignment, tiny old phone",
    experience: "brand_new",
    device: "tiny-phone",
    tier: "free",
    businessType: "residential_wholesaler",
    narrative: "320px screen — the stress test for the wholesaler nav + forms on the smallest viewport.",
    goals: ["Reach every door at 320px", "Add a motivated seller", "No clipped buttons / overflow"],
    expect: {
      financeHero: "assignment",
      modulesVisible: ["/leads", "/deals", "/campaigns"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Motivated seller"] },
      gatedCapabilities: ["Twilio SMS"],
    },
  },
  {
    slug: "wholesaler-volume",
    displayName: "Winnie — high-volume buyer list",
    experience: "power_user",
    device: "desktop-chrome",
    tier: "scale",
    businessType: "residential_wholesaler",
    narrative: "Big cash-buyer database; cares about buyer analytics + double-close + blast deliverability.",
    goals: ["Open buyer analytics", "Set up a buyer blast", "Confirm double-close tooling"],
    expect: {
      financeHero: "assignment",
      modulesVisible: ["/leads", "/deals", "/campaigns", "/buyer-analytics", "/double-close"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Assignment"] },
      gatedCapabilities: ["Twilio SMS", "SES email"],
    },
  },

  // ── FIX-AND-FLIP (roadmap — demoted beta → roadmap 2026-07-11 pending a
  //    residential comps/data plane; ruling #11 keeps it gated with the gap
  //    stated. Existing fix_and_flip orgs keep the Flip module + surfaces.) × 2
  {
    slug: "flipper-rehab",
    displayName: "Felix — rehab projects, project P&L",
    experience: "intermediate",
    device: "ipad-landscape",
    tier: "starter",
    businessType: "fix_and_flip",
    narrative: "Distressed house → renovate → resell; Finance should show project P&L, vocabulary 'Project'/'Sold'.",
    goals: ["See project P&L hero", "Track a flip through stages", "Confirm 'Distressed owner' / 'Sold' vocab"],
    expect: {
      financeHero: "projectPnl",
      modulesVisible: ["/properties", "/deals", "/rehabs"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Distressed owner", "Project"], money: ["Sold"] },
      gatedCapabilities: ["Twilio SMS", "Stripe Connect payments"],
    },
  },
  {
    slug: "flipper-rookie",
    displayName: "Faye — her first flip",
    experience: "brand_new",
    device: "iphone-se",
    tier: "sprout",
    businessType: "fix_and_flip",
    narrative: "New flipper on a small phone; the vertical is waitlisted (no residential data plane yet) so the honest gap framing + empty rehab state must read clearly.",
    goals: ["Understand what's gated and why", "Create her first project", "See what's coming vs available"],
    expect: {
      financeHero: "projectPnl",
      modulesVisible: ["/properties", "/deals"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Project"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },

  // ── CREATIVE FINANCE (beta — promoted roadmap → beta in ruling #11 wave
  //    V2 with a dedicated sidebar module; /notes stays deliberately
  //    nav-hidden for this profile — the carried book lives behind Finance) × 2
  {
    slug: "creative-subto",
    displayName: "Cleo — subject-to + wraps",
    experience: "intermediate",
    device: "desktop-1280",
    tier: "pro",
    businessType: "creative_finance",
    narrative: "Subject-to / wrap operator on the beta Creative-finance module: deal pipeline with Close & Carry into a serviced note, carried book via the Finance door, Dodd-Frank checker, per-state rules.",
    goals: ["Open the Creative finance module", "Run the Dodd-Frank exemption check", "Close & Carry a seller-finance deal into the carried book"],
    expect: {
      financeHero: null,
      modulesVisible: ["/deals", "/money", "/finance", "/dodd-frank", "/regulatory-intel"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Deal", "Pipeline"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "creative-skeptic-wide",
    displayName: "Cal — creative deals on a short-wide monitor",
    experience: "skeptic",
    device: "short-wide",
    tier: "starter",
    businessType: "creative_finance",
    narrative: "1920×600 letterbox monitor — the vertical-space stress test for sticky headers + tabs.",
    goals: ["No vertical clipping at 600px tall", "Tabs reachable", "Deal calculator usable"],
    expect: {
      financeHero: null,
      modulesVisible: ["/deals", "/money"],
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },

  // ── SUBDIVIDER (core, audit Wave 1) × 2
  {
    slug: "subdivider-power",
    displayName: "Sasha — splits parent parcels into lots",
    experience: "power_user",
    device: "desktop-ultrawide",
    tier: "scale",
    businessType: "subdivider",
    narrative: "Parent parcel → lots; needs the parcel map + the Subdivision module (subdivision editing lives on the parcel-detail Subdivision tab); vocabulary 'Parent parcel'.",
    goals: ["Open the Subdivision tab on a parent parcel", "Use the parcel map", "Confirm 'Parent parcel' vocab"],
    expect: {
      financeHero: "lotEconomics",
      modulesVisible: ["/maps", "/parcels", "/deals", "/permits", "/lot-pricing"],
      modulesHidden: ["/notes", "/capital-markets"],
      vocab: { deals: ["Parent parcel"] },
      gatedCapabilities: ["Regrid parcel enrichment"],
    },
  },
  {
    slug: "subdivider-ipad",
    displayName: "Saul — lot splits, reviews on iPad Pro",
    experience: "intermediate",
    device: "ipad-pro",
    tier: "pro",
    businessType: "subdivider",
    narrative: "Reviews plats on a big tablet; map + GIS filters must be touch-usable.",
    goals: ["Touch-pan the parcel map", "Apply GIS filters", "Open a parcel detail"],
    expect: {
      financeHero: "lotEconomics",
      modulesVisible: ["/maps", "/parcels", "/deals"],
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Regrid parcel enrichment"],
    },
  },

  // ── TAX LIEN / DEED (core, audit Wave 1) × 2
  {
    slug: "tax-lien-operator",
    displayName: "Tara — tax auctions + redemption clock",
    experience: "intermediate",
    device: "desktop-chrome",
    tier: "starter",
    businessType: "tax_lien_deed",
    narrative: "Acquires via tax sales; needs the tax-delinquent module (redemption clock, auction worksheet).",
    goals: ["Open the redemption clock", "Use the auction worksheet", "Read state rules", "Vocabulary 'Tax-delinquent owner'/'Awarded'"],
    expect: {
      financeHero: "certificates",
      modulesVisible: ["/redemption-clock", "/auction-worksheet", "/state-rules", "/deals"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Tax-delinquent owner"], money: ["Awarded"] },
      gatedCapabilities: ["Regrid parcel enrichment"],
    },
  },
  {
    slug: "tax-lien-rookie",
    displayName: "Theo — his first tax sale, on Android",
    experience: "brand_new",
    device: "pixel-5",
    tier: "free",
    businessType: "tax_lien_deed",
    narrative: "New to tax deeds; the redemption-clock empty state must teach the workflow.",
    goals: ["Find the redemption clock", "Add a target property", "Understand quiet title"],
    expect: {
      financeHero: "certificates",
      modulesVisible: ["/redemption-clock", "/deals"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Tax-delinquent owner"] },
      gatedCapabilities: ["Regrid parcel enrichment"],
    },
  },

  // ── BUY-AND-HOLD RENTALS (beta — promoted roadmap → beta in ruling #11
  //    wave V1; the dedicated Rentals module is live: rent roll, tenants,
  //    leases, maintenance, investor analytics) × 1
  {
    slug: "rental-landlord",
    displayName: "Lena — buy-and-hold rentals",
    experience: "returning_beginner",
    device: "iphone-14",
    tier: "sprout",
    businessType: "buy_and_hold",
    narrative: "Beta vertical → landlord persona; the Rentals module (rent roll, tenants, leases, maintenance) is her workspace and Finance leads with the project P&L hero.",
    goals: ["Open the rent roll", "Find tenants + leases", "File a maintenance ticket", "See rental vocabulary + project P&L on Finance"],
    expect: {
      financeHero: "projectPnl",
      modulesVisible: ["/rent-roll", "/tenants", "/leases", "/maintenance", "/investor-analytics", "/deals", "/money"],
      modulesHidden: ["/notes"],
      vocab: { deals: ["Rental"] },
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },

  // ── GATED / early verticals (collapse to a base persona's surface). These
  //    test that a vertical with a limited or shared surface degrades
  //    gracefully, never crashes. The set is no longer uniformly roadmap:
  //    the 2026-08 audits promoted developer, mobile_home (Wave 2), commercial
  //    (Wave 2 pass B) and agent_investor (Wave 2 pass C, the commission-tracking
  //    wedge) roadmap → beta on the honest tier definition (their surfaces are
  //    real and their gaps disclosed), so their display-name tags below read
  //    "(beta)". multifamily went further — promoted roadmap → beta (Wave 2)
  //    then beta → CORE (Wave 3) once the measured-expense axis, per-building
  //    occupancy and the T-12 workspace shipped — so its row carries NO tag
  //    (core, like the land/notes rows). short_term_rental stays roadmap
  //    ("(waitlist)") until its beta bar is met. The display-name tags are
  //    pinned to registry maturity by tests/unit/customerPersonas.test.ts. The
  //    landlord family here reaches the shared Rentals module and developer
  //    reaches the Subdivision module.
  {
    slug: "str-operator",
    displayName: "Sky — short-term rental operator (waitlist)",
    experience: "brand_new",
    device: "ipad-portrait",
    tier: "free",
    businessType: "short_term_rental",
    narrative: "Airbnb operator exploring; her own vertical is waitlisted but she lands on the shared landlord surface — Rentals module reachable, honest framing, no breakage.",
    goals: ["Reach Today + Finance", "See honest roadmap framing", "Reach the shared Rentals module", "No crash on suppressed modules"],
    expect: {
      financeHero: "projectPnl",
      modulesVisible: ["/deals", "/money", "/rent-roll"],
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "commercial-investor",
    displayName: "Cora — commercial RE",
    experience: "intermediate",
    device: "desktop-ultrawide",
    tier: "pro",
    businessType: "commercial",
    narrative: "Core on the broadest desktop; commercial runs the shared Rentals stack (leases, base-rent ledger, maintenance, company/entity tenants) plus the Wave 4 core build — CAM/NNN reconciliation from the recoverable operating-expense ledger, percentage rent from reported sales, rent-escalation schedules, per-square-foot metrics, and commercial-correct NOI (an unmeasured commercial property shows no assumed cap rate). Late fees are contractual (the residential statutory surface is correctly hidden); every commercial number refuses rather than fabricates when its inputs are missing.",
    goals: ["Land on the land_investor surface", "Confirm Finance loads", "No blank pages"],
    expect: {
      financeHero: null,
      modulesVisible: ["/deals", "/money"],
      modulesHidden: [],
      vocab: {},
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "developer-builder",
    displayName: "Dev — developer / entitlements (beta)",
    experience: "power_user",
    device: "desktop-1280",
    tier: "scale",
    businessType: "developer",
    narrative: "Beta → subdivider surface; developer collapses to the subdivider persona, so the Subdivision module (permits, county timelines, lot pricing, CC&Rs) and its three live subdivision templates are this vertical's real workspace. The old 'new construction' framing was removed — no ground-up construction product exists.",
    goals: ["Confirm subdivider surfacing", "Open the Subdivision module", "Finance + deals usable"],
    expect: {
      financeHero: "lotEconomics",
      modulesVisible: ["/deals", "/permits", "/county-timelines"],
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Regrid parcel enrichment"],
    },
  },
  {
    slug: "multifamily-investor",
    displayName: "Mona — small multifamily",
    experience: "intermediate",
    device: "galaxy-s9",
    tier: "starter",
    businessType: "multifamily",
    narrative: "Core on mobile; multifamily runs the shared Rentals stack (rent roll, unit inventory, renewals, maintenance) plus the Wave 3 core build — measured per-building NOI / cap rate from the recorded property-expense ledger (thin coverage marked '(N/12 mo)', an unrecorded property still labelled '(est.)'), per-building occupancy, and the T-12 underwriting grid on the leases page. DSCR still shows '—' (no debt-service tracking).",
    goals: ["Reach all doors on mobile", "Finance loads", "No dead modules"],
    expect: {
      financeHero: "projectPnl",
      modulesVisible: ["/deals", "/money", "/rent-roll"],
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "mobilehome-operator",
    displayName: "Milo — mobile-home park operator (beta)",
    experience: "brand_new",
    device: "iphone-se",
    tier: "free",
    businessType: "mobile_home",
    narrative: "Beta → landlord; smallest iPhone — a lot-lease-only beta on the shared Rentals stack with real pad inventory. The home-as-chattel (titles, home-vs-lot rent) and utilities pass-through gaps stay disclosed, not fabricated.",
    goals: ["Land somewhere usable", "No crash", "Understand it's early"],
    expect: {
      financeHero: "projectPnl",
      modulesVisible: ["/deals", "/rent-roll"],
      modulesHidden: ["/notes"],
      vocab: {},
      gatedCapabilities: ["Stripe Connect payments"],
    },
  },
  {
    slug: "agent-investor",
    displayName: "Aggie — licensed agent who also invests (beta)",
    experience: "skeptic",
    device: "desktop-chrome",
    tier: "starter",
    businessType: "agent_investor",
    narrative: "Beta → land_investor base with the commission-tracking wedge live behind the Finance door; a skeptic agent checking the product is honest — commissions real, MLS/client-vs-own-book/dual-agency disclosed as roadmap, nothing oversold.",
    goals: ["Confirm land_investor base surface", "Reach commissions behind Finance", "Honest roadmap messaging on the gaps", "Nothing oversold"],
    expect: {
      financeHero: null,
      modulesVisible: ["/deals", "/money"],
      modulesHidden: [],
      vocab: {},
      gatedCapabilities: ["Twilio SMS", "Stripe Connect payments"],
    },
  },

  // ── TEAM / ENTERPRISE — the org-isolation + multi-seat persona
  {
    slug: "team-lead-enterprise",
    displayName: "Eleanor — runs a team of VAs, enterprise tier",
    experience: "power_user",
    device: "ipad-landscape",
    tier: "enterprise",
    businessType: "land_flipper",
    narrative: "Manages seats + roles; the test that team surfaces, settings, and org isolation hold for a power admin.",
    goals: ["Open team/seat management in Settings", "Confirm billing surface", "Verify her data is org-scoped"],
    expect: {
      financeHero: null,
      modulesVisible: [...LAND_MODULES, "/team"],
      modulesHidden: ["/notes"],
      vocab: { settings: ["Team"] },
      gatedCapabilities: ["Stripe subscription"],
    },
  },
];

export const CUSTOMER_PERSONAS: CustomerPersona[] = SEEDS.map(buildPersona);

/** Lookup by slug (used by the seeder + spec). */
export function getPersona(slug: string): CustomerPersona | undefined {
  return CUSTOMER_PERSONAS.find((p) => p.slug === slug);
}
