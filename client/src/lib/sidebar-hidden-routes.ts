/**
 * Sidebar route-hiding registry — single source of truth for which sidebar
 * routes get hidden for which org/user state. Replaces the three parallel
 * maps that lived inline in `layout-sidebar.tsx` (BUSINESS_TYPE_*,
 * INVESTOR_TYPE_*, ORG_INVESTOR_TYPE_*) per Workstream B.6 (2026-05-04).
 *
 * Three input axes feed the hide decision:
 *
 *   1. **businessType** — legacy manual onboarding selection (residential_
 *      wholesaler, fix_and_flip, ...). Free-form string keyed by the
 *      onboarding wizard's vertical step.
 *   2. **detectedInvestorType** — auto-detected from contextProfile.ts
 *      (wholesaler, portfolio_builder, ...). Behaviour-based heuristic.
 *   3. **orgInvestorType** — explicit `organizations.investorType` column
 *      ('land' | 'notes' | 'both') captured during the Note Investor
 *      onboarding fork (Phase 5 §5).
 *
 * Precedence: any axis can hide a route. Union of all three is the
 * effective hidden set. Reasoning:
 *   - businessType is the user's self-report → trust it.
 *   - detectedInvestorType is behavioural → reinforces self-report.
 *   - orgInvestorType is explicit + recent → trust it.
 *
 * Adding a new vertical: drop a new entry in the appropriate axis. If the
 * vertical introduces a *new* axis, add a 4th input and union the same way.
 */

/**
 * Behaviorally-detected investor type. Inlined here because the previous
 * `contextProfile.ts` source was removed; this keeps sidebar gating
 * decoupled from any one detection implementation. The union below MUST
 * stay in sync with the keys of `byDetectedInvestorType` below.
 */
export type InvestorType =
  | "wholesaler"
  | "fix_and_flip"
  | "portfolio_builder"
  | "auction_hunter"
  | "developer"
  | "note_investor"
  | "new_investor"
  | "residential_wholesaler";

/**
 * Org-level investor-type ('land' | 'notes' | 'both'), the canonical
 * vertical-fork discriminator from `organizations.investorType`.
 */
export type OrgInvestorType = "land" | "notes" | "both";

interface HiddenRouteRegistry {
  /** Routes hidden by legacy manual `onboardingData.businessType`. */
  byBusinessType: Record<string, readonly string[]>;
  /** Routes hidden by auto-detected `contextProfile.investorType`. */
  byDetectedInvestorType: Record<InvestorType, readonly string[]>;
  /** Routes hidden by explicit `organizations.investorType`. */
  byOrgInvestorType: Record<OrgInvestorType, readonly string[]>;
}

// Buy-and-hold vertical BH-9 — Imelda §3 finance/notes:
// "I have zero notes. I have 25 leases." Hide note-investor surfaces
// and land-flavored maps. /borrower-portal and /exchange-1031
// (1031 exchange) is acquisition-side, not operations.
// V1 (founder ruling #11): shared by the whole landlord family —
// short_term_rental / multifamily / mobile_home derive the same landlord
// persona (persona-mapping.ts) and now get the same Rentals module, so
// they share this hiding profile for a coherent nav (they previously hid
// only /maps + /land-credit and kept note-investor surfaces visible).
const LANDLORD_FAMILY_HIDDEN = [
  "/maps",
  "/land-credit",
  "/notes",
  "/notes/pipeline",
  "/borrower-portal",
] as const;

const REGISTRY: HiddenRouteRegistry = {
  byBusinessType: {
    residential_wholesaler: ["/maps", "/land-credit"],
    buy_and_hold: LANDLORD_FAMILY_HIDDEN,
    // Fix-and-flip vertical FF-9 — Devon §4: "Lots held as inventory aren't
    // depreciated; they're cost-of-goods-sold when sold. Different chapter
    // of the IRS code." So hide /depreciation. /notes is for note investors,
    // not flippers (Devon §1: "Maybe one in twenty buyers takes seller
    // financing"). /maps is land-flavored.
    fix_and_flip: [
      "/maps",
      "/land-credit",
      "/notes",
      "/notes/pipeline",
      "/depreciation",
      "/depreciation-calculator",
      "/exchange-1031",
      "/borrower-portal",
    ],
    commercial:             ["/maps", "/land-credit"],
    short_term_rental:      LANDLORD_FAMILY_HIDDEN,
    multifamily:            LANDLORD_FAMILY_HIDDEN,
    mobile_home:            LANDLORD_FAMILY_HIDDEN,
    agent_investor:         ["/land-credit"],
    creative_finance:       ["/land-credit"],
    // Subdivider vertical SD-9 — Brigid: "I have no notes. […] depreciation
    // doesn't apply to me — lots held as inventory aren't depreciated.
    // /portfolio, /money, /capital-markets, /forecasting are dead weight.
    // /tax-optimizer / /tax-optimization are about depreciation strategy,
    // wrong tax chapter for inventory COGS."
    subdivider: [
      "/notes",
      "/notes/pipeline",
      "/depreciation",
      "/depreciation-calculator",
      "/dunning",
      "/exchange-1031",
      "/borrower-portal",
      "/capital-markets",
      "/forecasting",
      "/cash-flow",
      "/tax-optimization",
      "/tax-optimizer",
      "/land-credit",
    ],
    // land_flipper / note_investor / hybrid / developer / tax_lien_deed:
    // all routes visible.
  },

  byDetectedInvestorType: {
    wholesaler:        ["/maps", "/land-credit", "/finance/cash-flow-forecaster"],
    fix_and_flip:     ["/maps", "/land-credit", "/borrower-portal"],
    portfolio_builder: ["/land-credit", "/deal-hunter"],
    auction_hunter:   [],
    developer:        ["/land-credit"],
    note_investor:    [],
    new_investor:     [],
    // Wholesaler vertical W-7: Trey explicitly flagged /money + /portfolio
    // as "100% wallpaper for me." Notes / portfolio / capital markets /
    // forecast are all hold-investor surfaces. Wholesalers flip contracts,
    // not properties — they keep no inventory and earn no cash flow.
    residential_wholesaler: [
      "/money",
      "/portfolio",
      "/portfolio-pnl",
      "/portfolio-health",
      "/portfolio-optimizer",
      "/finance",
      "/capital-markets",
      "/forecasting",
      "/cash-flow",
      "/notes",
      "/exchange-1031",
      "/depreciation",
      "/dunning",
      "/land-credit",
    ],
  },

  byOrgInvestorType: {
    // Pure-land orgs: hide the Notes module (empty for them).
    land:  ["/notes"],
    // Pure-notes orgs: hide land outreach + parcel-only modules.
    // /leads/dedupe is parcel-list-cleanup; note investors don't run mailings.
    // /avm + /avm-bulk are parcel-valuation flows; notes use BPO instead
    //   (see /notes/pipeline for the BPO field).
    // /skip-tracing is parcel-owner lookup; note investors need borrower
    //   locate which is queued as separate work in note-investor-followups.
    // /seller-intent + /deal-hunter are land-deal sourcing surfaces.
    // REO-relevant surfaces (/properties, /parcels, /portfolio) stay
    //   visible because Linnea: "useful when I take a property back
    //   through foreclosure."
    notes: [
      "/campaigns",
      "/direct-mail",
      "/sequences",
      "/blind-offer-wizard",
      "/offers/batches",
      "/leads/dedupe",
      "/avm",
      "/avm-bulk",
      "/skip-tracing",
      "/seller-intent",
      "/deal-hunter",
    ],
    // Mixed-strategy: everything visible.
    both:  [],
  },
};

export interface ResolveHiddenRoutesInput {
  businessType?: string;
  detectedInvestorType: InvestorType;
  orgInvestorType: OrgInvestorType;
}

/**
 * The five fixed doors (+ Inbox/Settings) — CLAUDE.md doctrine: "Persona
 * changes only the CONTENT behind each door … never the doors themselves."
 * The mobile bottom nav (MOBILE_DOORS in nav-items.ts) deliberately has no
 * persona filter, so any door hidden here produced a desktop sidebar that
 * DISAGREED with the same account's phone — four doors on desktop, five on
 * mobile (found independently by three 2026-07 design-panel reviews).
 * Doors are therefore unhideable: persona axes may gate any secondary
 * route, but never these.
 */
const PROTECTED_DOOR_ROUTES: ReadonlySet<string> = new Set([
  "/today",
  "/maps",
  "/deals",
  "/pipeline",
  "/money",
  "/finance",
  "/ai",
  "/inbox",
  "/settings",
]);

/**
 * Compute the union of hidden routes across all three input axes.
 * The single entry point used by `layout-sidebar.tsx`. Returns a
 * stable Array (not a Set) for stable React keying.
 */
export function resolveHiddenRoutes(input: ResolveHiddenRoutesInput): string[] {
  const out = new Set<string>();
  if (input.businessType) {
    for (const r of REGISTRY.byBusinessType[input.businessType] ?? []) out.add(r);
  }
  for (const r of REGISTRY.byDetectedInvestorType[input.detectedInvestorType] ?? []) out.add(r);
  for (const r of REGISTRY.byOrgInvestorType[input.orgInvestorType] ?? []) out.add(r);
  for (const door of PROTECTED_DOOR_ROUTES) out.delete(door);
  return Array.from(out);
}

// Exported for test introspection only.
export const _SIDEBAR_HIDDEN_ROUTES_REGISTRY = REGISTRY;
