/**
 * Vertical-aware getting-started checklist — the single data-driven config.
 *
 * Onboarding rebuild (2026-07-29 audit): the old checklist keyed on the
 * 3-value `organizations.investorType` fork ("land" | "notes" | "both"),
 * which collapsed all 15 declared business types into three generic lists —
 * a tax-lien operator saw "send your first mailer", a landlord saw nothing
 * about properties. This module re-keys the checklist on
 * `organizations.onboardingData.businessType` (the 15-value taxonomy from
 * shared/business-types.ts + shared/models/persona-mapping.ts) so each
 * vertical sees ITS first wins in ITS vocabulary — from ONE config, no
 * 15-way component fork.
 *
 * HONESTY RULE (constitution: refuse-not-fabricate): every item names a
 * `signal` — a real completion flag computed server-side by
 * GET /api/onboarding/checklist-status from actual org rows (leads,
 * imports, campaigns/mail shipments, deals, payments, enriched parcels,
 * BYOK credentials). An item may NEVER show complete unless its signal is
 * true, and steps with no cheap real signal are DROPPED, not faked:
 *   - land_flipper "set your buy-box"          — no buy-box signal → dropped
 *   - tax_lien_deed "set county auction watch" — no watch signal   → dropped
 *   - buy_and_hold "add a tenant"              — tenants live in the rental
 *     schema with no checklist signal          → dropped
 *   - note_investor "connect your servicer"    — folded into the optional
 *     connect-services item (hasConnectedService / BYOK), never blocking.
 *
 * Pure data + pure functions (plus lucide icon references) — safe to import
 * from node-env vitest without jsdom.
 */
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Building2,
  Handshake,
  MapPin,
  Megaphone,
  Plug,
  Upload,
  Users,
} from "lucide-react";
import { BUSINESS_TYPE_IDS, type BusinessTypeId } from "@shared/business-types";

/** Shape of GET /api/onboarding/checklist-status — the ONLY completion sources. */
export interface ChecklistStatus {
  hasLead: boolean;
  hasImport: boolean;
  hasCampaign: boolean;
  hasDeal: boolean;
  hasNotePayment: boolean;
  hasPropertyLookup: boolean;
  hasConnectedService: boolean;
}

export type ChecklistSignal = keyof ChecklistStatus;

/** Canonical signal list (kept in sync with server/routes-onboarding.ts). */
export const CHECKLIST_SIGNALS: readonly ChecklistSignal[] = [
  "hasLead",
  "hasImport",
  "hasCampaign",
  "hasDeal",
  "hasNotePayment",
  "hasPropertyLookup",
  "hasConnectedService",
];

export interface ChecklistItemDef {
  id: string;
  /** Real completion source on /api/onboarding/checklist-status. */
  signal: ChecklistSignal;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  /**
   * Optional items (the connect-services nudge) render like any item but
   * never count toward progress or block auto-dismiss — value before
   * friction (R5 reshape, preserved).
   */
  optional?: boolean;
}

// ─── Step factory ──────────────────────────────────────────────────────────
// Each base step binds an id to its honest signal + icon + default door.
// Verticals re-title them in their own vocabulary; the signal never changes.

type StepBaseId =
  | "propertyLookup"
  | "lead"
  | "import"
  | "campaign"
  | "deal"
  | "notePayment";

const STEP_BASE: Record<
  StepBaseId,
  Pick<ChecklistItemDef, "id" | "signal" | "icon" | "href">
> = {
  propertyLookup: { id: "propertyLookup", signal: "hasPropertyLookup", icon: MapPin, href: "/maps" },
  lead: { id: "lead", signal: "hasLead", icon: Users, href: "/leads" },
  import: { id: "import", signal: "hasImport", icon: Upload, href: "/leads" },
  campaign: { id: "campaign", signal: "hasCampaign", icon: Megaphone, href: "/campaigns" },
  deal: { id: "deal", signal: "hasDeal", icon: Handshake, href: "/deals" },
  notePayment: { id: "notePayment", signal: "hasNotePayment", icon: Banknote, href: "/finance" },
};

function step(
  base: StepBaseId,
  title: string,
  description: string,
  overrides?: Partial<Pick<ChecklistItemDef, "href" | "icon">>,
): ChecklistItemDef {
  return { ...STEP_BASE[base], title, description, ...overrides };
}

// The optional connect-your-services nudge (R5 reshape) — appended after
// every vertical's required steps. Completes via hasConnectedService (any
// non-revoked BYOK credential); excluded from progress + auto-dismiss math.
export const CONNECT_SERVICES_ITEM: ChecklistItemDef = {
  id: "connectServices",
  signal: "hasConnectedService",
  title: "Connect your services (optional)",
  description:
    "Bring your own Twilio, SendGrid, Lob, or data accounts — your keys, your invoices. Or keep running on ours.",
  icon: Plug,
  href: "/settings/byok",
  optional: true,
};

// ─── Shared per-persona builders ───────────────────────────────────────────
// The landlord family (buy_and_hold / short_term_rental / multifamily /
// mobile_home — all "landlord" in persona-mapping.ts) shares one loop with
// per-type nouns. hasPropertyLookup completes on a real property row
// (enrichment completed OR the first_property_added / first_lead_enriched
// activation events), so "add your first X" is honest for it.
function landlordSteps(noun: string, addDescription: string): ChecklistItemDef[] {
  return [
    step("propertyLookup", `Add your first ${noun}`, addDescription, {
      href: "/properties",
      icon: Building2,
    }),
    step(
      "lead",
      "Add your first seller lead",
      "Your next acquisition starts as a lead — import a list or paste an address",
    ),
    step(
      "deal",
      "Track your first acquisition",
      "Move a lead into Deals and follow it from offer to close",
    ),
  ];
}

// The land sourcing loop (land_flipper vocabulary; agent_investor and
// hybrid re-title pieces of it).
const PARCEL_AHA_DESCRIPTION =
  "Open a parcel on the map — soils, flood, wetlands & elevation light up from free public data";

// ─── The config: all 15 business types ─────────────────────────────────────

export const CHECKLISTS_BY_BUSINESS_TYPE: Record<BusinessTypeId, ChecklistItemDef[]> = {
  land_flipper: [
    step("propertyLookup", "Look up your first parcel", PARCEL_AHA_DESCRIPTION),
    step(
      "import",
      "Pull your first county list",
      "Import a CSV of owners from your target county — your acquisition pipeline starts here",
    ),
    step(
      "campaign",
      "Send your first mailer",
      "Pick a template, target your list, watch responses land",
    ),
    step(
      "deal",
      "Track your first deal",
      "Move a lead to deal and see the offer/close pipeline light up",
    ),
  ],
  note_investor: [
    step(
      "import",
      "Import your note portfolio",
      "Upload your existing notes — amortization schedules render automatically",
      { href: "/finance" },
    ),
    step(
      "notePayment",
      "Record your first payment",
      "Log a P&I payment and see the schedule update to the cent",
    ),
    step(
      "deal",
      "Track a note buy or sell",
      "Move a note acquisition or disposition through your pipeline",
    ),
  ],
  hybrid: [
    step("propertyLookup", "Look up your first property", PARCEL_AHA_DESCRIPTION),
    step(
      "lead",
      "Add your first lead or note",
      "Import a CSV — leads, notes, or both. Same pipeline, different surfaces",
    ),
    step(
      "campaign",
      "Send your first outreach",
      "Mailer for sellers, or direct outreach to note holders",
    ),
    step(
      "notePayment",
      "Record your first note payment",
      "Log a P&I payment and see the schedule update to the cent",
    ),
  ],
  residential_wholesaler: [
    step(
      "lead",
      "Add your first seller lead",
      "Import a motivated-seller list or paste an address — your assignment pipeline starts here",
    ),
    step(
      "campaign",
      "Launch your first outreach campaign",
      "Reach sellers by mail — responses land as leads you can put under contract",
    ),
    step(
      "deal",
      "Get your first contract into the pipeline",
      "Move a signed contract into Deals — buyer blasts and assignment tracking light up",
    ),
  ],
  fix_and_flip: [
    step(
      "lead",
      "Add your first property lead",
      "Import a distressed-property list or paste an address — your flip pipeline starts here",
    ),
    step(
      "campaign",
      "Send your first off-market mailer",
      "Reach owners before the MLS does — pick a template, target your list",
    ),
    step(
      "deal",
      "Track your first flip",
      "Move a lead into Deals and follow it from offer through rehab to resale",
    ),
  ],
  buy_and_hold: landlordSteps(
    "rental property",
    "Add a property (or look one up on the map) — your portfolio starts here",
  ),
  short_term_rental: landlordSteps(
    "rental",
    "Add a property (or look one up on the map) — your portfolio starts here",
  ),
  multifamily: landlordSteps(
    "building",
    "Add a building (or look one up on the map) — your unit portfolio starts here",
  ),
  mobile_home: landlordSteps(
    "park or home",
    "Add a park or home (or look one up on the map) — your portfolio starts here",
  ),
  commercial: [
    step("propertyLookup", "Look up your first parcel", PARCEL_AHA_DESCRIPTION),
    step(
      "lead",
      "Add your first owner lead",
      "Import an owner list or paste an address — your acquisition pipeline starts here",
    ),
    step(
      "deal",
      "Track your first acquisition",
      "Move a lead into Deals and follow it from LOI to close",
    ),
  ],
  creative_finance: [
    step(
      "lead",
      "Add your first seller lead",
      "Subject-to and owner-carry candidates enter here — import a list or paste an address",
    ),
    step(
      "deal",
      "Move your first creative deal",
      "Track a subject-to or wrap through the pipeline — Close & Carry turns it into a serviced note",
    ),
    step(
      "notePayment",
      "Record a payment on your carried note",
      "Log a P&I payment and see the amortization schedule update to the cent",
    ),
  ],
  developer: [
    step(
      "propertyLookup",
      "Look up your first parent parcel",
      "Soils, flood, wetlands & elevation from free public data — the build decision starts here",
    ),
    step(
      "lead",
      "Add your first landowner lead",
      "Import a list or paste an address — your land pipeline starts here",
    ),
    step(
      "deal",
      "Track your first acquisition",
      "Move a parent parcel into Deals — permits, timelines and lot pricing follow",
    ),
  ],
  subdivider: [
    step(
      "propertyLookup",
      "Look up your first parent parcel",
      "Soils, flood, wetlands & elevation from free public data — the split decision starts here",
    ),
    step(
      "lead",
      "Add your first landowner lead",
      "Import a list or paste an address — your parent-parcel pipeline starts here",
    ),
    step(
      "deal",
      "Track your first acquisition",
      "Move a parent parcel into Deals — plats, permits and lot pricing follow",
    ),
  ],
  tax_lien_deed: [
    step(
      "import",
      "Import your first certificate list",
      "Upload the county's delinquent roll as a CSV — every certificate becomes a trackable lead",
    ),
    step(
      "propertyLookup",
      "Look up a delinquent parcel",
      "Open it on the map — soils, flood, wetlands & elevation from free public data",
    ),
    step(
      "deal",
      "Track a certificate to deed",
      "Move a certificate into Deals — the redemption clock and foreclosure timeline follow",
    ),
  ],
  agent_investor: [
    step("propertyLookup", "Look up your first parcel", PARCEL_AHA_DESCRIPTION),
    step(
      "lead",
      "Add your first seller lead",
      "Import a list or paste an address — own book or client sourcing, same pipeline",
    ),
    step(
      "deal",
      "Track your first deal",
      "Move a lead into Deals and follow it from offer to close",
    ),
  ],
};

// ─── Resolution + progress helpers (pure) ──────────────────────────────────

const VALID_BUSINESS_TYPES: ReadonlySet<string> = new Set(BUSINESS_TYPE_IDS);

/**
 * Resolve which vertical's checklist to show. Prefers the org's declared
 * `onboardingData.businessType`; orgs that predate the 15-type taxonomy (or
 * skipped the wizard before picking one) fall back through the coarse
 * investorType fork to a representative type — never to an empty list.
 */
export function resolveChecklistBusinessType(
  businessType: string | null | undefined,
  investorType: string | null | undefined,
): BusinessTypeId {
  if (businessType && VALID_BUSINESS_TYPES.has(businessType)) {
    return businessType as BusinessTypeId;
  }
  if (investorType === "notes") return "note_investor";
  if (investorType === "both") return "hybrid";
  return "land_flipper";
}

/** The vertical's required steps plus the optional connect-services nudge. */
export function getChecklistItems(businessType: BusinessTypeId): ChecklistItemDef[] {
  return [...CHECKLISTS_BY_BUSINESS_TYPE[businessType], CONNECT_SERVICES_ITEM];
}

/**
 * An item is complete ONLY when its real signal is true. No status yet
 * (query loading / failed) → nothing is complete. Never fabricate progress.
 */
export function isItemComplete(
  item: ChecklistItemDef,
  status: ChecklistStatus | undefined,
): boolean {
  return status ? status[item.signal] === true : false;
}

export interface ChecklistProgress {
  completedCount: number;
  requiredCount: number;
  progressPct: number;
  /** All REQUIRED items complete — optional items never block this. */
  allComplete: boolean;
}

export function computeChecklistProgress(
  items: ChecklistItemDef[],
  status: ChecklistStatus | undefined,
): ChecklistProgress {
  const required = items.filter((item) => !item.optional);
  const completedCount = required.filter((item) => isItemComplete(item, status)).length;
  const requiredCount = required.length;
  return {
    completedCount,
    requiredCount,
    progressPct: requiredCount > 0 ? (completedCount / requiredCount) * 100 : 0,
    allComplete: requiredCount > 0 && completedCount === requiredCount,
  };
}

/**
 * Checklist visibility — DELIBERATELY independent of empty-state, hasAnyData,
 * onboardingCompleted, and onboardingData.skipped (2026-07-29 audit fixes #1
 * and #4): a user with data still sees their remaining steps, and a user who
 * skipped the wizard gets the checklist as their gentle path in. It hides
 * only when the org dismissed it, when every required step is genuinely
 * done, or while real completion state hasn't loaded yet (never render
 * unverified checkboxes).
 */
export function shouldShowChecklist(input: {
  dismissed: boolean;
  statusLoaded: boolean;
  allComplete: boolean;
}): boolean {
  return !input.dismissed && input.statusLoaded && !input.allComplete;
}
