/**
 * assert-entity-org.ts — Atlas defense-in-depth for destructive tools.
 *
 * Lens 23 (Yuki audit) finding: Atlas's destructive tools accept their
 * target entity ID (a Stripe charge, a Clerk userId, a deal id, etc.)
 * from the LLM's tool-call args without re-validating that the entity
 * belongs to the org Tom currently has loaded. The `FounderToolContext`
 * does carry `organizationId`, but most destructive tool handlers don't
 * cross-check it against the target — they just pass the id to the
 * provider and execute.
 *
 * That is the "Atlas-is-founder-only-so-it's-fine" assumption. It works
 * until either:
 *   (a) a prompt-injection convinces Atlas to operate on a different
 *       org's customer ID embedded in some scraped doc;
 *   (b) a poorly-scoped sub-agent confuses two orgs in flight;
 *   (c) future product surface lets a non-founder admin trigger Atlas
 *       tools through a UI affordance (already planned per persona work).
 *
 * In any of those scenarios, we want a hard chokepoint that refuses
 * destructive ops against entities outside the expected org.
 *
 * Usage in a destructive tool handler:
 *
 *   await assertEntityOrg("stripe_customer", args.customerId, ctx.organizationId);
 *
 * If the assertion fails:
 *   - the function throws AtlasEntityOrgMismatchError
 *   - the executor catches it (same path as any other handler throw),
 *     audit-logs `tool_call_failed`, and Atlas reports the refusal
 *
 * Resolution rules per entityType:
 *   - 'stripe_customer'     → lookup organizations.stripe_customer_id
 *   - 'stripe_subscription' → lookup organizations.stripe_subscription_id
 *   - 'stripe_charge'       → resolve charge.customer at Stripe, then map
 *                              back through organizations
 *   - 'clerk_user'          → lookup team_members.user_id → organization
 *   - 'note'                → lookup notes.organization_id
 *   - 'lead'                → lookup leads.organization_id
 *   - 'property'            → lookup properties.organization_id
 *   - 'deal'                → lookup deals.organization_id
 *
 * Entity types not in this list are explicitly out-of-scope (Fly machines,
 * GitHub PRs, etc. — those are global/platform-wide by definition;
 * there is no "wrong org" for `fly_restart_machine`).
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { organizations, teamMembers, leads, properties, deals, notes } from "@shared/schema";
import { logger } from "../../utils/logger";

export type AtlasEntityType =
  | "stripe_customer"
  | "stripe_subscription"
  | "stripe_charge"
  | "clerk_user"
  | "note"
  | "lead"
  | "property"
  | "deal";

export class AtlasEntityOrgMismatchError extends Error {
  public readonly code = "ATLAS_ENTITY_ORG_MISMATCH";
  public readonly entityType: AtlasEntityType;
  public readonly entityId: string | number;
  public readonly expectedOrgId: number;
  public readonly actualOrgId: number | null;

  constructor(
    entityType: AtlasEntityType,
    entityId: string | number,
    expectedOrgId: number,
    actualOrgId: number | null,
  ) {
    super(
      `Atlas refuses destructive op: ${entityType} ${entityId} ${
        actualOrgId == null
          ? "could not be resolved to any organization"
          : `belongs to org ${actualOrgId}, not expected org ${expectedOrgId}`
      }`,
    );
    this.name = "AtlasEntityOrgMismatchError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedOrgId = expectedOrgId;
    this.actualOrgId = actualOrgId;
  }
}

/**
 * Look up the org id that owns the given entity. Returns null when the
 * entity cannot be resolved at all (orphan, deleted, never existed).
 */
async function resolveEntityOrg(
  entityType: AtlasEntityType,
  entityId: string | number,
): Promise<number | null> {
  switch (entityType) {
    case "stripe_customer": {
      const id = String(entityId);
      const [row] = await db
        .select({ orgId: organizations.id })
        .from(organizations)
        .where(eq(organizations.stripeCustomerId, id))
        .limit(1);
      return row?.orgId ?? null;
    }
    case "stripe_subscription": {
      const id = String(entityId);
      const [row] = await db
        .select({ orgId: organizations.id })
        .from(organizations)
        .where(eq(organizations.stripeSubscriptionId, id))
        .limit(1);
      return row?.orgId ?? null;
    }
    case "stripe_charge": {
      // Charges don't carry the org directly. Resolve via Stripe → customer
      // → organizations. We require live Stripe API access for this lookup;
      // if Stripe is down, we fail closed (return null → mismatch error).
      try {
        // Lazy import to avoid pulling Stripe into the assertion module
        // unless we actually need it.
        const { default: Stripe } = await import("stripe");
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) return null;
        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" as any });
        const charge = await stripe.charges.retrieve(String(entityId));
        const customer = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
        if (!customer) return null;
        return resolveEntityOrg("stripe_customer", customer);
      } catch (err: any) {
        logger.warn("[assertEntityOrg] stripe_charge resolution failed", {
          metadata: { chargeId: entityId, error: err?.message },
        });
        return null;
      }
    }
    case "clerk_user": {
      // A Clerk user can belong to multiple orgs via team_members. The
      // assertion succeeds if the expected org is ANY of them — i.e.,
      // we're asking "is this user a member of the expected org?"
      // resolveEntityOrg returns the first match; the assertion below
      // additionally accepts a match anywhere in their org list.
      const userId = String(entityId);
      const rows = await db
        .select({ orgId: teamMembers.organizationId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId));
      return rows[0]?.orgId ?? null;
    }
    case "note": {
      const id = Number(entityId);
      if (!Number.isFinite(id)) return null;
      const [row] = await db
        .select({ orgId: notes.organizationId })
        .from(notes)
        .where(eq(notes.id, id))
        .limit(1);
      return row?.orgId ?? null;
    }
    case "lead": {
      const id = Number(entityId);
      if (!Number.isFinite(id)) return null;
      const [row] = await db
        .select({ orgId: leads.organizationId })
        .from(leads)
        .where(eq(leads.id, id))
        .limit(1);
      return row?.orgId ?? null;
    }
    case "property": {
      const id = Number(entityId);
      if (!Number.isFinite(id)) return null;
      const [row] = await db
        .select({ orgId: properties.organizationId })
        .from(properties)
        .where(eq(properties.id, id))
        .limit(1);
      return row?.orgId ?? null;
    }
    case "deal": {
      const id = Number(entityId);
      if (!Number.isFinite(id)) return null;
      const [row] = await db
        .select({ orgId: deals.organizationId })
        .from(deals)
        .where(eq(deals.id, id))
        .limit(1);
      return row?.orgId ?? null;
    }
  }
}

/**
 * Assert that the given entity belongs to the expected organization.
 * Throws AtlasEntityOrgMismatchError if not, or if the entity cannot be
 * resolved at all (fail-closed).
 *
 * For `clerk_user`, accepts membership in any org — the user must be a
 * team_members row in `expectedOrgId`. This is the correct semantic for
 * "is this Clerk userId in scope for the org Atlas is operating on?"
 */
export async function assertEntityOrg(
  entityType: AtlasEntityType,
  entityId: string | number,
  expectedOrgId: number,
): Promise<void> {
  if (entityType === "clerk_user") {
    // Special case: membership check (user may be in multiple orgs).
    const userId = String(entityId);
    const rows = await db
      .select({ orgId: teamMembers.organizationId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    const matches = rows.some((r) => r.orgId === expectedOrgId);
    if (!matches) {
      throw new AtlasEntityOrgMismatchError(
        entityType,
        entityId,
        expectedOrgId,
        rows[0]?.orgId ?? null,
      );
    }
    return;
  }

  const actualOrgId = await resolveEntityOrg(entityType, entityId);
  if (actualOrgId !== expectedOrgId) {
    throw new AtlasEntityOrgMismatchError(
      entityType,
      entityId,
      expectedOrgId,
      actualOrgId,
    );
  }
}

/**
 * Convenience wrapper for tool handlers that have a `ctx`. Same as
 * assertEntityOrg but reads `expectedOrgId` from the context.
 *
 * If the founder context doesn't carry an organizationId (rare — happens
 * when Atlas is operating in pure platform mode with no org loaded),
 * the assertion is SKIPPED with a structured warning. That keeps
 * legitimate global ops (fly_restart_machine, etc.) working while
 * still surfacing the gap in audit logs.
 */
export async function assertEntityOrgFromCtx(
  entityType: AtlasEntityType,
  entityId: string | number,
  ctx: { organizationId?: number | null },
): Promise<void> {
  const orgId = ctx.organizationId;
  if (!orgId) {
    logger.warn("[assertEntityOrg] skipped — no organizationId in ctx", {
      metadata: { entityType, entityId },
    });
    return;
  }
  return assertEntityOrg(entityType, entityId, orgId);
}
