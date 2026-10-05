/**
 * Persistence for county lists saved from the list builder (W10.3, behind the
 * Map door): the marketing_lists row, its members, and the leads created for
 * parcels the org did not already hold.
 *
 * DEDUPE READS DELETED LEADS ON PURPOSE. A county parcel is matched to the
 * org's leads on (state, county, APN) by the one parcel-identity rule
 * (server/services/leads/parcelDedupe.ts), read through
 * `leadsIncludingDeleted`: a soft-deleted lead may carry an opt-out, so a
 * county list must never mint a fresh contactable row for that parcel. A
 * parcel whose only match is a deleted lead is SUPPRESSED — not resurrected,
 * not linked, not re-created — and counted so the customer sees it.
 * (Registered in tests/unit/liveLeadReadsCensus.test.ts.)
 *
 * Every statement names the org inline.
 */
import { and, asc, count, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  activityLog,
  leads,
  marketingListMembers,
  marketingLists,
  type Lead,
  type MarketingList,
} from "@shared/schema";
import { splitOwnerName } from "@shared/parcel/ownerName";
import {
  apnMatchForm,
  apnMatchesAny,
  createParcelDedupeIndex,
  identitiesAreDistinct,
  parcelIdentityOf,
  type ParcelIdentity,
} from "../services/leads/parcelDedupe";
import { liveLead, leadsIncludingDeleted } from "./liveLeads";

/** marketing_lists.source for a list built from county records. */
export const COUNTY_RECORDS_SOURCE = "county_records";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** One county parcel as the list builder read it. */
export interface CountyParcel {
  apn: string | null;
  owner: string | null;
  acres: number | null;
  address: string | null;
}

/**
 * How every parcel the county returned lands. Each parcel is counted in
 * exactly ONE of linkedParcels / toCreate / suppressedDeleted / skippedNoApn
 * / skippedDuplicateApn, so their sum is the county's count.
 */
export interface MemberPlan {
  /** Existing LIVE leads the list will link (distinct). */
  linkLeadIds: number[];
  /** Parcels that matched an existing live lead (one per parcel). */
  linkedParcels: number;
  /** Parcels with no lead in the org, live or deleted — leads to create. */
  toCreate: CountyParcel[];
  /** Parcels whose only match is a soft-deleted lead: not linked, not re-created. */
  suppressedDeleted: number;
  /** Parcels with no APN: they cannot be matched to a lead, so they are not saved. */
  skippedNoApn: number;
  /** Repeats of an APN already earlier in this same read: one parcel, counted once. */
  skippedDuplicateApn: number;
}

/** The (state, county, APN) plan for a set of parcels against the org's leads. */
async function planWith(
  exec: Exec,
  organizationId: number,
  state: string,
  county: string,
  parcels: CountyParcel[],
): Promise<MemberPlan> {
  const seen = createParcelDedupeIndex();
  const candidates: Array<{ parcel: CountyParcel; ident: ParcelIdentity }> = [];
  let skippedNoApn = 0;
  let skippedDuplicateApn = 0;
  for (const parcel of parcels) {
    const apn = (parcel.apn ?? "").trim();
    // parcelIdentityOf is null exactly when the APN is blank.
    const ident = apn ? parcelIdentityOf({ apn, state, county }) : null;
    if (!ident) {
      skippedNoApn++;
      continue;
    }
    if (seen.has(state, county, apn)) {
      skippedDuplicateApn++;
      continue;
    }
    seen.add(state, county, apn);
    candidates.push({ parcel, ident });
  }

  const apns = Array.from(new Set(candidates.map((c) => apnMatchForm(c.parcel.apn))));
  const existing: Array<{ id: number; apn: string | null; state: string | null; county: string | null; deletedAt: Date | null }> = [];
  for (let i = 0; i < apns.length; i += 1000) {
    const rows = await exec
      .select({
        id: leadsIncludingDeleted.id,
        apn: leadsIncludingDeleted.apn,
        state: leadsIncludingDeleted.state,
        county: leadsIncludingDeleted.county,
        deletedAt: leadsIncludingDeleted.deletedAt,
      })
      .from(leadsIncludingDeleted)
      .where(
        and(
          eq(leadsIncludingDeleted.organizationId, organizationId),
          apnMatchesAny(leadsIncludingDeleted.apn, apns.slice(i, i + 1000)),
        ),
      );
    existing.push(...rows);
  }

  const byStateApn = new Map<string, Array<{ id: number; deleted: boolean; ident: ParcelIdentity }>>();
  for (const l of existing) {
    const ident = parcelIdentityOf(l);
    if (!ident) continue;
    const list = byStateApn.get(ident.stateApn) ?? [];
    list.push({ id: l.id, deleted: l.deletedAt !== null, ident });
    byStateApn.set(ident.stateApn, list);
  }

  const link = new Set<number>();
  const toCreate: CountyParcel[] = [];
  let linkedParcels = 0;
  let suppressedDeleted = 0;
  for (const { parcel, ident } of candidates) {
    const matches = (byStateApn.get(ident.stateApn) ?? []).filter((l) => !identitiesAreDistinct(ident, l.ident));
    const live = matches.filter((l) => !l.deleted).sort((a, b) => a.id - b.id)[0];
    if (live) {
      link.add(live.id);
      linkedParcels++;
    } else if (matches.length > 0) suppressedDeleted++;
    else toCreate.push(parcel);
  }
  return { linkLeadIds: Array.from(link), linkedParcels, toCreate, suppressedDeleted, skippedNoApn, skippedDuplicateApn };
}

/** Preview: how a county list's parcels would land in the org's leads. Reads only. */
export function planCountyListMembers(
  organizationId: number,
  state: string,
  county: string,
  parcels: CountyParcel[],
): Promise<MemberPlan> {
  return planWith(db, organizationId, state, county, parcels);
}

/**
 * Under the lock, the new leads would take the org past its plan (its leads
 * or the plan changed since the check). Carries the figures read under the lock.
 */
export class ListPlanChangedError extends Error {
  constructor(
    readonly newLeads: number,
    readonly limit: number,
    readonly current: number,
  ) {
    super("The org's leads changed while the list was being saved.");
    this.name = "ListPlanChangedError";
  }
}

export interface SaveCountyListInput {
  name: string;
  state: string;
  county: string;
  filters: NonNullable<MarketingList["filters"]>;
  /** The exact county count the customer confirmed. */
  sourceCount: number;
  parcels: CountyParcel[];
  /** The org's plan lead limit (null = unlimited), read BEFORE the transaction opens. */
  leadLimit: number | null;
  /**
   * The org's plan-counted leads, read AFTER the lock is held and THROUGH
   * the transaction (usageLimits.countPlanLeads(tx, org)) — never through the
   * global db, which would hold this connection while taking a second from
   * the pool. Called only when the list would create a lead under a limit.
   */
  countPlanLeads: (tx: Tx) => Promise<number>;
}

export interface SavedCountyList {
  listId: number;
  created: Lead[];
  linkedExisting: number;
  total: number;
  suppressedDeleted: number;
  skippedNoApn: number;
  skippedDuplicateApn: number;
}

/**
 * Create the list, the new leads and every membership in ONE transaction.
 *
 * WHAT THE LOCK COVERS. The per-org advisory lock (`list_builder:<org>`) is
 * taken ONLY by list-builder saves, so two county-list saves in one org
 * cannot both create a lead for the same parcel. The other lead writers —
 * the CSV and tax-delinquent imports, POST /api/leads, the importers in
 * services/importExport.ts — do NOT take it: against them this is a
 * re-check under the lock, not mutual exclusion, and a lead they commit
 * concurrently can still duplicate a parcel saved here.
 *
 * Under the lock, the member plan is recomputed and — when it creates any
 * lead — the org's live lead count is re-read through the transaction (the
 * limit was read before it opened: one connection per save, never two); if
 * the new leads would now exceed the plan, nothing is written
 * (ListPlanChangedError).
 */
export async function saveCountyList(organizationId: number, input: SaveCountyListInput): Promise<SavedCountyList> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`list_builder:${organizationId}`}))`);
    const plan = await planWith(tx, organizationId, input.state, input.county, input.parcels);
    // A list that creates no lead cannot exceed a lead limit — an org already
    // over its plan (a downgrade) may still save a list of leads it holds.
    if (plan.toCreate.length > 0 && input.leadLimit !== null) {
      const current = await input.countPlanLeads(tx);
      if (current + plan.toCreate.length > input.leadLimit) {
        throw new ListPlanChangedError(plan.toCreate.length, input.leadLimit, current);
      }
    }

    const [list] = await tx
      .insert(marketingLists)
      .values({
        organizationId,
        name: input.name,
        source: COUNTY_RECORDS_SOURCE,
        status: "ready",
        // Only columns whose meaning matches: the county's count, the
        // parcels that became members, and the DUPLICATE APNs dropped. A
        // parcel with no APN is not a duplicate, and nothing here checked an
        // address, so invalid_addresses is left alone.
        totalRecords: input.sourceCount,
        validRecords: plan.linkLeadIds.length + plan.toCreate.length,
        duplicatesRemoved: plan.skippedDuplicateApn,
        filters: input.filters,
        processedAt: new Date(),
      })
      .returning({ id: marketingLists.id });

    const created: Lead[] = [];
    for (let i = 0; i < plan.toCreate.length; i += 500) {
      const values = plan.toCreate.slice(i, i + 500).map((p) => {
        const { firstName, lastName } = splitOwnerName(p.owner ?? "");
        return {
          organizationId,
          type: "seller",
          firstName,
          lastName,
          // A county layer's address is the PARCEL's situs, not where its
          // owner receives mail, so it is the property address; the mailing
          // address stays empty until it is known.
          propertyAddress: p.address,
          state: input.state,
          county: input.county,
          apn: (p.apn ?? "").trim(),
          acreage: p.acres === null ? null : String(p.acres),
          source: COUNTY_RECORDS_SOURCE,
          status: "new",
          tcpaConsent: false,
          consentSource: null,
        };
      });
      created.push(...(await tx.insert(leads).values(values).returning()));
    }
    if (created.length > 0) {
      await tx.insert(activityLog).values(
        created.map((lead) => ({
          organizationId,
          action: "created",
          entityType: "lead",
          entityId: lead.id,
          description: `Lead ${`${lead.firstName} ${lead.lastName}`.trim()} created from county list "${input.name}"`,
        })),
      );
    }

    const memberLeadIds = [...plan.linkLeadIds, ...created.map((l) => l.id)];
    for (let i = 0; i < memberLeadIds.length; i += 1000) {
      await tx
        .insert(marketingListMembers)
        .values(memberLeadIds.slice(i, i + 1000).map((leadId) => ({ organizationId, listId: list.id, leadId })))
        .onConflictDoNothing();
    }

    return {
      listId: list.id,
      created,
      linkedExisting: plan.linkLeadIds.length,
      total: memberLeadIds.length,
      suppressedDeleted: plan.suppressedDeleted,
      skippedNoApn: plan.skippedNoApn,
      skippedDuplicateApn: plan.skippedDuplicateApn,
    };
  });
}

export interface CountyListSummary {
  id: number;
  name: string;
  state: string | null;
  county: string | null;
  total: number;
  createdAt: Date | null;
}

/** The org's county lists, newest first, bounded, with the true total. */
export async function listCountyLists(
  organizationId: number,
  limit: number,
): Promise<{ lists: CountyListSummary[]; total: number }> {
  const scope = and(eq(marketingLists.organizationId, organizationId), eq(marketingLists.source, COUNTY_RECORDS_SOURCE));
  const [{ n }] = await db.select({ n: count() }).from(marketingLists).where(scope);
  const rows = await db
    .select({ id: marketingLists.id, name: marketingLists.name, filters: marketingLists.filters, createdAt: marketingLists.createdAt })
    .from(marketingLists)
    .where(scope)
    .orderBy(desc(marketingLists.createdAt), desc(marketingLists.id))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  // A list's size is its LIVE member leads — the number the leads view of the
  // list (listMemberLeadsCursor) and the mail composer act on. A member whose
  // lead was since deleted is not counted, so the picker never promises more.
  const liveMember = sql`${marketingListMembers.leadId} in (select ${leads.id} from ${leads} where ${leads.organizationId} = ${organizationId} and ${liveLead()})`;
  const sizes = ids.length
    ? await db
        .select({ listId: marketingListMembers.listId, n: count() })
        .from(marketingListMembers)
        .where(and(eq(marketingListMembers.organizationId, organizationId), inArray(marketingListMembers.listId, ids), liveMember))
        .groupBy(marketingListMembers.listId)
    : [];
  const sizeOf = new Map(sizes.map((s) => [s.listId, Number(s.n)]));
  return {
    total: Number(n),
    lists: rows.map((r) => ({
      id: r.id,
      name: r.name,
      state: r.filters?.states?.[0] ?? null,
      county: r.filters?.counties?.[0] ?? null,
      total: sizeOf.get(r.id) ?? 0,
      createdAt: r.createdAt,
    })),
  };
}

/** True when the list exists in THIS org. */
export async function orgHasMarketingList(organizationId: number, listId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: marketingLists.id })
    .from(marketingLists)
    .where(and(eq(marketingLists.organizationId, organizationId), eq(marketingLists.id, listId)))
    .limit(1);
  return Boolean(row);
}

/**
 * The live leads on one of the org's lists, cursor-paged newest first — the
 * same page shape as leadRepo.getLeadsCursor, narrowed to the list's members.
 */
export async function listMemberLeadsCursor(
  organizationId: number,
  listId: number,
  opts: { limit: number; cursor?: number; stageCondition?: SQL },
  filters?: { assignedTo?: number | null },
): Promise<{ data: Lead[]; total: number; hasMore: boolean }> {
  // Membership as an org-bound subquery inside the same statement, so the
  // page and its count are one read each.
  const isMember = sql`${leads.id} in (select ${marketingListMembers.leadId} from ${marketingListMembers} where ${marketingListMembers.organizationId} = ${organizationId} and ${marketingListMembers.listId} = ${listId})`;
  const conditions: SQL[] = [eq(leads.organizationId, organizationId), isMember];
  if (opts.stageCondition) conditions.push(opts.stageCondition);
  if (filters?.assignedTo === null) conditions.push(sql`${leads.assignedTo} IS NULL`);
  else if (filters?.assignedTo !== undefined) conditions.push(eq(leads.assignedTo, filters.assignedTo));

  const [{ n }] = await db.select({ n: count() }).from(leads).where(and(...conditions, liveLead()));
  const page = opts.cursor ? [...conditions, lt(leads.id, opts.cursor)] : conditions;
  const rows = await db
    .select()
    .from(leads)
    .where(and(...page, liveLead()))
    .orderBy(desc(leads.id))
    .limit(opts.limit + 1);
  return { data: rows.slice(0, opts.limit), total: Number(n), hasMore: rows.length > opts.limit };
}

/**
 * A marketing list's MEMBERS, for the skills that act on a list
 * (scrubLeadList, generateBatchOffers in services/agent-skills.ts).
 *
 * `memberList` is true when the list is defined by its memberships — it has
 * membership rows, or it is a county list (whose members ARE the list even
 * when every one was later deleted). Then `leads` is its LIVE member leads,
 * org-bound on both sides, and a caller must act on exactly those, never on
 * the whole book. When false (a legacy list that records only filters) the
 * caller keeps its filter behaviour.
 */
export async function readListMembership(
  organizationId: number,
  list: { id: number; source: string | null },
): Promise<{ memberList: boolean; leads: Lead[] }> {
  const [row] = await db
    .select({ id: marketingListMembers.id })
    .from(marketingListMembers)
    .where(and(eq(marketingListMembers.organizationId, organizationId), eq(marketingListMembers.listId, list.id)))
    .limit(1);
  const memberList = Boolean(row) || list.source === COUNTY_RECORDS_SOURCE;
  if (!memberList) return { memberList, leads: [] };
  const isMember = sql`${leads.id} in (select ${marketingListMembers.leadId} from ${marketingListMembers} where ${marketingListMembers.organizationId} = ${organizationId} and ${marketingListMembers.listId} = ${list.id})`;
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), isMember, liveLead()))
    .orderBy(asc(leads.id));
  return { memberList, leads: rows };
}
