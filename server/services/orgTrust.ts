/**
 * X-A slice 1 — the org-level trust-tier spine (abuse and bad-customer spine).
 *
 * Three tiers, earned in order:
 *
 *   new         → every org at signup (schema default; migration 0229 seeded
 *                 existing orgs deterministically from real data — age via
 *                 created_at, activity via last_active_at, standing via
 *                 subscription_status + dunning_stage)
 *   established → aged + active + in good standing
 *   trusted     → earned or founder-granted (only the founder's own org was
 *                 auto-seeded here)
 *
 * DELIBERATELY DISTINCT from investorNetworkService's trustTier
 * (platinum/gold/silver/bronze/new): that scores an individual marketplace
 * INVESTOR's transaction history; this gates what an ORGANIZATION may do on
 * shared rails (wedge sends, portal links, exports). Do not conflate them.
 *
 * ENFORCEMENT STATUS — READ BEFORE WIRING:
 * The caps table below is CONFIG ONLY. It is unit-tested
 * (tests/unit/orgTrust.test.ts) and consumed today for two NON-send
 * affordances: portal-link TTL on rebind (routes-borrower.ts) and trust-tier
 * context on abuse-report queue items. Enforcing these caps at the send
 * chokepoints (wedge velocity, per-recipient frequency/dedupe, export
 * velocity), the payment-method-to-exceed ladder, the signup friction ladder,
 * demotion-on-complaint, and any suspension ladder are ALL send-lane/policy
 * changes reserved for founder approval — see
 * docs/proposals/x-a-send-chokepoint-caps.md. Do not wire enforcement without
 * that ruling.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { logger } from "../utils/logger";

// Module-internal by design (fleet-6 verifier catch: exported, these three had
// no production consumer and tripped the reachability gate). The ladder and
// the caps are fully observable through resolveOrgTrustTier/resolveOrgTrustCaps,
// which is also how tests exercise them.
const ORG_TRUST_TIERS = ["new", "established", "trusted"] as const;
export type OrgTrustTier = (typeof ORG_TRUST_TIERS)[number];

function isOrgTrustTier(value: unknown): value is OrgTrustTier {
  return (
    typeof value === "string" &&
    (ORG_TRUST_TIERS as readonly string[]).includes(value)
  );
}

/**
 * The cap set a tier grants. Every number here is a POLICY PROPOSAL awaiting
 * the founder's ruling before any chokepoint enforces it (see the header) —
 * the two exceptions consumed today (portalLinkTtlDays,
 * portalLinkRefreshesPerDay) govern the portal-link lifecycle only and move
 * no mail.
 */
export interface OrgTrustCaps {
  /** Wedge (platform-lane) sends allowed per day. NOT ENFORCED YET. */
  wedgeSendsPerDay: number;
  /** Distinct recipients one wedge send may address. NOT ENFORCED YET. */
  wedgeRecipientsPerDay: number;
  /**
   * Minimum days between two wedge sends to the SAME recipient
   * (per-recipient dedupe window). NOT ENFORCED YET.
   */
  wedgeSameRecipientCooldownDays: number;
  /** Active borrower portal links an org may hold. NOT ENFORCED YET. */
  portalLinksActiveMax: number;
  /** Portal-link rebinds (token rotations) allowed per day. ENFORCED: no —
   *  consumed today only as advisory context; the rebind endpoint is
   *  authenticated + org-scoped and cheap. */
  portalLinkRefreshesPerDay: number;
  /** Lifetime a freshly minted/rebound portal link gets, in days. CONSUMED
   *  TODAY by POST /api/notes/:id/portal-link/refresh. */
  portalLinkTtlDays: number;
  /** Export jobs allowed per hour. NOT ENFORCED YET. */
  exportJobsPerHour: number;
  /** Rows a single day of exports may total. NOT ENFORCED YET. */
  exportRowsPerDay: number;
}

/**
 * The caps table. Monotonic by construction: every cap is non-decreasing as
 * trust grows (pinned by tests/unit/orgTrust.test.ts).
 */
const ORG_TRUST_CAPS: Record<OrgTrustTier, OrgTrustCaps> = {
  new: {
    wedgeSendsPerDay: 2,
    wedgeRecipientsPerDay: 10,
    wedgeSameRecipientCooldownDays: 7,
    portalLinksActiveMax: 25,
    portalLinkRefreshesPerDay: 5,
    portalLinkTtlDays: 90,
    exportJobsPerHour: 2,
    exportRowsPerDay: 2_000,
  },
  established: {
    wedgeSendsPerDay: 10,
    wedgeRecipientsPerDay: 100,
    wedgeSameRecipientCooldownDays: 7,
    portalLinksActiveMax: 250,
    portalLinkRefreshesPerDay: 25,
    portalLinkTtlDays: 365,
    exportJobsPerHour: 6,
    exportRowsPerDay: 25_000,
  },
  trusted: {
    wedgeSendsPerDay: 50,
    wedgeRecipientsPerDay: 500,
    wedgeSameRecipientCooldownDays: 3,
    portalLinksActiveMax: 2_500,
    portalLinkRefreshesPerDay: 100,
    portalLinkTtlDays: 365,
    exportJobsPerHour: 20,
    exportRowsPerDay: 250_000,
  },
};

/** Pure lookup — the tier's cap set. */
export function resolveOrgTrustCaps(tier: OrgTrustTier): OrgTrustCaps {
  return ORG_TRUST_CAPS[tier];
}

/**
 * Resolve an org's trust tier from the DB. Fails CLOSED to "new" (the most
 * restrictive tier) on a missing org, an unrecognized stored value, or a DB
 * error — an abuse spine must never widen anyone's caps because a read
 * failed.
 */
export async function resolveOrgTrustTier(orgId: number): Promise<OrgTrustTier> {
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { trustTier: true },
    });
    if (!org) return "new";
    if (isOrgTrustTier(org.trustTier)) return org.trustTier;
    logger.warn("[orgTrust] unrecognized trust_tier value — treating as 'new'", {
      metadata: { organizationId: orgId, storedValue: String(org.trustTier) },
    });
    return "new";
  } catch (err) {
    logger.error(
      "[orgTrust] trust-tier read failed — failing closed to 'new'",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId: orgId } },
    );
    return "new";
  }
}
