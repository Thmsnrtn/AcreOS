/**
 * Lead → deal: make a seller lead's parcel a deal, in ONE transaction.
 *
 * POST /api/deals requires a propertyId, and nothing turned a lead into one —
 * a customer working a seller had to re-type the parcel as a property and then
 * create the deal by hand. This is that step, done once and done honestly:
 *
 *   - The parcel comes from the LEAD's own APN, county and state, normalised by
 *     the one owner of parcel identity (shared/parcel/parcelRef.ts). A lead
 *     without them is REFUSED with the list of what to add — nothing is
 *     invented. `properties.size_acres` is NOT NULL, so the lead's acreage is
 *     required too: a zero written to satisfy the column would be a number
 *     nobody measured.
 *   - IDEMPOTENT. A property in the same org with the same parcel key is
 *     reused, and an open deal already on that property is returned rather
 *     than a second one created. The whole read-then-write runs under a
 *     transaction-scoped advisory lock keyed on (org, parcel), so two clicks
 *     racing each other serialize and the second one finds the first's rows.
 *   - The deal is created at the schema's opening stage through the same
 *     repository writer POST /api/deals uses (storage.createDeal with the
 *     transaction's executor), validated by the same insertDealSchema, with
 *     the same audit entries in the same transaction.
 *   - Every read and write is scoped by organizationId.
 *
 * The caller (routes-leads.ts) owns authorization — the assigned-lead rule
 * and the canCreateDeals / canCreateProperties permissions — and the
 * post-commit announcements, which may only fire after the commit.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { deals, insertDealSchema, leads, properties, type Deal, type Property } from "@shared/schema";
import { ACTIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
import { normalizeParcelRef, parcelKey, sameParcel, type ParcelRef } from "@shared/parcel/parcelRef";
import { leadDealReadiness, type LeadDealReadiness, type LeadParcelFields } from "@shared/leads/leadToDeal";
import { withTransaction, type PrimaryDb } from "../../db";
import { storage } from "../../storage";
import type { UsageLimitResult } from "../usageLimits";

/**
 * Properties in THIS org that are the same parcel as `ref`, oldest first. The
 * SQL pre-filter is a candidate match on the upper-cased, whitespace-collapsed
 * APN (the form parcelRef keeps); identity is then decided by `sameParcel`.
 */
async function findParcelProperties(tx: PrimaryDb, orgId: number, ref: ParcelRef): Promise<Property[]> {
  const candidates = await tx
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        isNull(properties.deletedAt),
        sql`upper(regexp_replace(trim(${properties.apn}), '\\s+', ' ', 'g')) = ${ref.apn}`,
      ),
    )
    .orderBy(asc(properties.id));
  return candidates.filter((p) => {
    const r = normalizeParcelRef({ apn: p.apn, county: p.county, state: p.state });
    return r.ok && sameParcel(r.ref, ref);
  });
}

/** The oldest still-open deal (any pipeline stage) on any of these properties in this org. */
async function findOpenDeal(tx: PrimaryDb, orgId: number, propertyIds: number[]): Promise<Deal | undefined> {
  if (propertyIds.length === 0) return undefined;
  const [deal] = await tx
    .select()
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        inArray(deals.propertyId, propertyIds),
        inArray(deals.status, [...ACTIVE_DEAL_STATUSES]),
        isNull(deals.deletedAt),
      ),
    )
    .orderBy(asc(deals.id))
    .limit(1);
  return deal;
}

/** Prefer the property already sold by this lead; otherwise the oldest. */
function pickProperty(rows: Property[], leadId: number): Property | undefined {
  return rows.find((p) => p.sellerId === leadId) ?? rows[0];
}

/**
 * What the lead page shows before the click: whether the lead can convert,
 * and the open deal it would land on if one already exists. Read-only.
 */
export async function readLeadDealState(
  orgId: number,
  lead: LeadParcelFields & { id: number },
  tx: PrimaryDb,
): Promise<{ readiness: LeadDealReadiness; existingDeal: Deal | null }> {
  const readiness = leadDealReadiness(lead);
  if (!readiness.ready) return { readiness, existingDeal: null };
  const rows = await findParcelProperties(tx, orgId, readiness.ref);
  const deal = await findOpenDeal(tx, orgId, rows.map((p) => p.id));
  return { readiness, existingDeal: deal ?? null };
}

export interface ConvertLeadToDealInput {
  orgId: number;
  leadId: number;
  userId: string | undefined;
  /** False when the caller may create deals but not properties; a NEW property is then refused. */
  mayCreateProperty: boolean;
  /** Plan check for a new property — called only when one would be created. */
  checkPropertyLimit: () => Promise<UsageLimitResult>;
  ipAddress?: string;
  userAgent?: string;
}

export type ConvertLeadToDealResult =
  | { kind: "not_found" }
  | { kind: "not_ready"; readiness: Exclude<LeadDealReadiness, { ready: true }> }
  | { kind: "property_forbidden" }
  | { kind: "plan_limit"; usage: UsageLimitResult }
  | {
      kind: "ok";
      deal: Deal;
      property: Property;
      createdDeal: boolean;
      createdProperty: boolean;
    };

export async function convertLeadToDeal(input: ConvertLeadToDealInput): Promise<ConvertLeadToDealResult> {
  const { orgId, leadId } = input;
  return withTransaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), eq(leads.id, leadId), isNull(leads.deletedAt)));
    if (!lead) return { kind: "not_found" } as const;

    const readiness = leadDealReadiness(lead);
    if (!readiness.ready) return { kind: "not_ready", readiness } as const;
    const { ref, acres } = readiness;

    // Serialize every conversion of THIS parcel in THIS org: the find-or-create
    // below is a read followed by a write, and two concurrent requests would
    // otherwise both read "none" and both insert.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead_to_deal:${orgId}:${parcelKey(ref)}`}))`);

    const parcelRows = await findParcelProperties(tx, orgId, ref);
    const openDeal = await findOpenDeal(tx, orgId, parcelRows.map((p) => p.id));
    if (openDeal) {
      const property = parcelRows.find((p) => p.id === openDeal.propertyId)!;
      return { kind: "ok", deal: openDeal, property, createdDeal: false, createdProperty: false } as const;
    }

    let property = pickProperty(parcelRows, lead.id);
    let createdProperty = false;
    if (property) {
      if (property.sellerId == null) {
        const [linked] = await tx
          .update(properties)
          .set({ sellerId: lead.id })
          .where(and(eq(properties.organizationId, orgId), eq(properties.id, property.id)))
          .returning();
        property = linked ?? property;
      }
    } else {
      if (!input.mayCreateProperty) return { kind: "property_forbidden" } as const;
      const usage = await input.checkPropertyLimit();
      if (!usage.allowed) return { kind: "plan_limit", usage } as const;
      const values = {
        organizationId: orgId,
        // The lead's own spelling, trimmed — the parcel key is for matching,
        // the stored APN is what the county wrote.
        apn: (lead.apn ?? "").trim(),
        county: (lead.county ?? "").trim(),
        state: ref.state,
        sizeAcres: acres,
        address: lead.propertyAddress?.trim() || null,
        sellerId: lead.id,
      };
      const [created] = await tx.insert(properties).values(values).returning();
      property = created;
      createdProperty = true;
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId: input.userId,
        action: "create",
        entityType: "property",
        entityId: created.id,
        changes: { after: { ...values, fromLeadId: lead.id }, fields: Object.keys(values) },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      }, tx);
    }

    // The same schema POST /api/deals parses; status is the schema's opening
    // default (negotiating), never a later stage.
    const dealInput = insertDealSchema.parse({ propertyId: property.id, type: "acquisition" });
    const deal = await storage.createDeal({ ...dealInput, organizationId: orgId }, tx);
    await storage.createAuditLogEntry({
      organizationId: orgId,
      userId: input.userId,
      action: "create",
      entityType: "deal",
      entityId: deal.id,
      changes: { after: { ...dealInput, fromLeadId: lead.id }, fields: Object.keys(dealInput) },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }, tx);

    return { kind: "ok", deal, property, createdDeal: true, createdProperty } as const;
  });
}
