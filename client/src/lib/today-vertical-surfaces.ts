/**
 * Today vertical-surfaces registry (FW-10).
 *
 * Drives the single "Your surfaces" card on /today. Each entry maps a
 * vertical key (businessType + investorType combinations) to the title,
 * tagline, and cluster of links the operator hits in their morning loop.
 *
 * Adding a vertical: drop a new entry. The /today renderer iterates and
 * picks all matching verticals in a stable priority order so an org
 * that's BOTH (e.g. land + note investor) sees both clusters in one
 * scannable card instead of two stacked banners.
 */

export interface VerticalSurfaceLink {
  label: string;
  href: string;
}

export interface VerticalSurfaceCluster {
  /** Stable id used for React keys. */
  id: string;
  /** Header text. */
  title: string;
  /** Sub-title / persona-quote tagline. */
  description: string;
  /** Quick-jump links shown as outline buttons. */
  links: VerticalSurfaceLink[];
  /** Sort order — lower numbers render first. */
  priority: number;
}

export interface VerticalSurfacesInput {
  businessType: string | null | undefined;
  investorType: string | null | undefined;
}

const REGISTRY: Array<{
  match: (input: VerticalSurfacesInput) => boolean;
  cluster: VerticalSurfaceCluster;
}> = [
  {
    match: (i) => i.businessType === "residential_wholesaler",
    cluster: {
      id: "wholesaler",
      title: "Wholesaler surfaces",
      description: "Buyer blasts, EMD timer, double-close, assignment legality — tuned for transactional wholesalers (no inventory, no cash flow).",
      priority: 10,
      links: [
        { label: "Buyer blasts", href: "/buyer-blasts" },
        { label: "EMD", href: "/earnest-money" },
        { label: "Double-close", href: "/double-close" },
        { label: "State rules", href: "/wholesaler-state-rules" },
      ],
    },
  },
  {
    // V1 (founder ruling #11): the whole landlord family — short_term_rental /
    // multifamily / mobile_home derive the landlord persona (persona-mapping.ts)
    // and run the same rent-roll/leases/maintenance morning loop, so they get
    // the same cluster instead of no surfaces card at all.
    match: (i) =>
      i.businessType === "buy_and_hold" ||
      i.businessType === "short_term_rental" ||
      i.businessType === "multifamily" ||
      i.businessType === "mobile_home",
    cluster: {
      id: "landlord",
      title: "Landlord surfaces",
      description: "Tenants, leases, rent roll, maintenance, portfolio analytics.",
      priority: 20,
      links: [
        { label: "Rent roll", href: "/rent-roll" },
        { label: "Maintenance", href: "/maintenance" },
        { label: "Leases", href: "/leases" },
        { label: "Analytics", href: "/investor-analytics" },
      ],
    },
  },
  {
    match: (i) => i.businessType === "fix_and_flip",
    cluster: {
      id: "flipper",
      title: "Fix-and-flip surfaces",
      description: "Active rehabs, contractor 1099-NECs, ARV calculator, bid comparison, draw schedule.",
      priority: 30,
      links: [
        { label: "Active rehabs", href: "/rehabs" },
        { label: "Contractors", href: "/contractors" },
        { label: "1099-NEC", href: "/contractors/1099-nec" },
      ],
    },
  },
  {
    match: (i) => i.businessType === "subdivider",
    cluster: {
      id: "subdivider",
      title: "Subdivider surfaces",
      description: "Permits, county timelines, lot pricing grid, CC&R templates — tuned for one-parent-into-many-children workflows.",
      priority: 40,
      links: [
        { label: "Permits", href: "/permits" },
        { label: "County timelines", href: "/county-timelines" },
        { label: "CC&R templates", href: "/ccr-templates" },
      ],
    },
  },
  {
    match: (i) => i.businessType === "tax_lien_deed",
    cluster: {
      id: "tax-delinquent",
      title: "Tax-delinquent surfaces",
      description: "Redemption clock, auction worksheet, state rules, quiet-title workflow.",
      priority: 50,
      links: [
        { label: "Redemption clock", href: "/redemption-clock" },
        { label: "Auction worksheet", href: "/auction-worksheet" },
        { label: "Counties", href: "/counties" },
        { label: "State rules", href: "/state-rules" },
      ],
    },
  },
  {
    // V2 (founder ruling #11): creative finance = seller financing /
    // subject-to / wrap / lease-option operators. Their morning loop runs on
    // rails that already shipped: the deal pipeline (Close & Carry on the
    // closed deal → serviced note), the carried book behind the Finance
    // door, and the origination-compliance surfaces. Deliberately no /notes
    // link — that route is nav-hidden for the "land" orgInvestorType this
    // businessType derives (see sidebar-hidden-routes.ts); /finance is the
    // carried-book surface that can never be hidden (protected door).
    match: (i) => i.businessType === "creative_finance",
    cluster: {
      id: "creative-finance",
      title: "Creative-finance surfaces",
      description: "Seller-finance pipeline, Close & Carry into the serviced book, Dodd-Frank / Reg-Z checks, per-state seller-financing rules.",
      priority: 55,
      links: [
        { label: "Pipeline", href: "/deals" },
        { label: "Carried notes", href: "/finance" },
        { label: "Dodd-Frank", href: "/dodd-frank" },
        { label: "State rules", href: "/regulatory-intel" },
      ],
    },
  },
  {
    // Note investor matches on investorType (org-level), not businessType.
    // 'both' = land + notes mixed; we still surface notes because the rest
    // of the page already shows land-flavored content.
    match: (i) => i.investorType === "notes" || i.investorType === "both",
    cluster: {
      id: "note-investor",
      title: "Note investor surfaces",
      description: "Servicing book, acquisition pipeline, and 1099-INT readiness.",
      priority: 60,
      links: [
        { label: "Servicing book", href: "/notes" },
        { label: "Pipeline", href: "/notes/pipeline" },
        { label: "Tax readiness", href: "/notes/tax-readiness" },
      ],
    },
  },
];

/**
 * Resolve every cluster that matches the operator's vertical fingerprint.
 * Returns clusters in stable priority order. Empty array → no banner.
 */
export function resolveVerticalSurfaces(input: VerticalSurfacesInput): VerticalSurfaceCluster[] {
  return REGISTRY.filter((entry) => entry.match(input))
    .map((entry) => entry.cluster)
    .sort((a, b) => a.priority - b.priority);
}

// Exported for test introspection only.
export const _VERTICAL_SURFACES_REGISTRY = REGISTRY;
