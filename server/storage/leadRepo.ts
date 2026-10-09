// Leads + lead-activity + soft-delete/recovery + scoring + dedup.
// Extracted from the god-class server/storage.ts.

import { and, asc, desc, eq, sql, count, ilike, inArray, like, lte, or, type SQL } from "drizzle-orm";
import { omitProtectedFields } from "../utils/updatePayload";
import { db } from "../db";
import {
  leads, leadActivities, activityLog,
  type Lead, type InsertLead,
  type LeadActivity, type InsertLeadActivity,
} from "@shared/schema";
import { assertNotUnderLegalHold, filterOutHeldIds } from "../services/legalHold";
import type { DatabaseStorage, PaginationOptions, PaginatedResult } from "../storage";
import { LIST_READ_CAP, capListRead } from "./listCap";
import { clock } from "../utils/clock";
import { DEFAULT_GRANT_SOURCE, stampConsentForInsert, stampConsentForUpdate } from "../services/consentStamp";
import { leadHasOptedOut } from "../services/leadContactability";

/** Refused merge: the two leads are different parcels (DEFECT-0161). */
class LeadsAreDistinctParcelsError extends Error {
  constructor() {
    super("These leads are different parcels (different APN/county), not duplicates — merging would delete one.");
    this.name = "LeadsAreDistinctParcelsError";
  }
}

/**
 * The row a lead create actually inserts. Server-owned fields are set by the
 * server, never the caller: the database assigns `id` and `updatedAt`, a new
 * lead is never born soft-deleted, and `phoneNormalized` is a STORED generated
 * column Postgres refuses to accept a value for. `organizationId` is the
 * caller's (always the server's own org id) and is kept.
 *
 * `createdAt` is kept only as a real `Date`: the CSV import deliberately
 * preserves a row's original creation date (history-preserving extras in
 * services/importExport.ts) and constructs that Date itself, while a value
 * that arrived in a JSON body is at most a string — which the timestamp
 * column cannot take anyway — so it is dropped and the column default applies.
 *
 * Defence in depth behind the create contract's own strip
 * (shared/contracts/leads.ts); pinned by tests/unit/leadCreateServerFields.test.ts.
 */
const LEAD_INSERT_SERVER_OWNED = ["id", "updatedAt", "deletedAt", "deletedBy", "lastScoreAt", "phoneNormalized"];

function leadInsertRow<T extends InsertLead & { organizationId: number }>(lead: T): T {
  const row: Record<string, unknown> = { ...lead };
  for (const key of LEAD_INSERT_SERVER_OWNED) delete row[key];
  if ("createdAt" in row && !(row.createdAt instanceof Date)) delete row.createdAt;
  return row as T;
}

export const leadRepo = {
  // Leads
  async getLeads(this: DatabaseStorage, orgId: number, filters?: { assignedTo?: number | null }): Promise<Lead[]> {
    const conditions: any[] = [eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`];
    if (filters?.assignedTo === null) {
      conditions.push(sql`${leads.assignedTo} IS NULL`);
    } else if (filters?.assignedTo !== undefined) {
      conditions.push(eq(leads.assignedTo, filters.assignedTo));
    }
    // Audit F-10-2: loud cap — truncation past the cap is logged, not silent.
    const rows = await db.select().from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt))
      .limit(LIST_READ_CAP + 1);
    return capListRead(rows, LIST_READ_CAP, "getLeads", orgId);
  },

  async getLeadsPaginated(this: DatabaseStorage, orgId: number, options: PaginationOptions, filters?: { assignedTo?: number | null; q?: string }): Promise<PaginatedResult<Lead>> {
    const conditions: any[] = [eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`];
    if (filters?.assignedTo === null) {
      conditions.push(sql`${leads.assignedTo} IS NULL`);
    } else if (filters?.assignedTo !== undefined) {
      conditions.push(eq(leads.assignedTo, filters.assignedTo));
    }
    // Server-side search across the same fields the previous client-side
    // filters covered (name, email, phone, address+city+state). Without
    // this a user typing "Smith" while standing on /leads page 1 of 7
    // could not find their Smith on page 7 — the search was scoped to
    // the current page only. ILIKE is fine for the org-scoped row counts
    // we typically deal with (≤ low six figures); the index on email
    // helps the email path. Phone is matched against phoneNormalized
    // (digits-only generated column) so "(602) 555-1212" finds "6025551212".
    const q = filters?.q?.trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const phoneDigits = q.replace(/\D/g, "");
      const phoneLike = phoneDigits.length >= 3 ? `%${phoneDigits}%` : null;
      const ors: any[] = [
        ilike(leads.firstName, like),
        ilike(leads.lastName, like),
        ilike(leads.email, like),
        ilike(leads.address, like),
        ilike(leads.city, like),
        ilike(leads.state, like),
        ilike(leads.zip, like),
        // Concatenated "First Last" match so "John Smith" hits a row
        // where first=John, last=Smith — neither column alone contains
        // the space.
        sql`(${leads.firstName} || ' ' || ${leads.lastName}) ILIKE ${like}`,
      ];
      if (phoneLike) {
        ors.push(ilike(leads.phoneNormalized, phoneLike));
      }
      conditions.push(or(...ors)!);
    }
    const whereClause = and(...conditions);
    const [{ count: total }] = await db.select({ count: count() }).from(leads).where(whereClause);
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / options.pageSize));
    const offset = (options.page - 1) * options.pageSize;

    const sortColumn = (leads as any)[options.sortBy] ?? leads.createdAt;
    const orderFn = options.sortOrder === "asc" ? asc : desc;

    const data = await db.select().from(leads)
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(options.pageSize)
      .offset(offset);

    return { data, total: totalNum, page: options.page, pageSize: options.pageSize, totalPages };
  },

  /**
   * W5.3 — SQL mirror of leadNurturerService.calculateLeadScore/segmentLead
   * so stage-filtered lists paginate in the database instead of loading the
   * entire org's leads into memory and scoring them in JS.
   *
   * MUST stay in lockstep with SCORING_WEIGHTS + STAGE_THRESHOLDS in
   * server/services/leadNurturer.ts (tests/unit/leadStageSql.test.ts pins
   * the two implementations to each other). Every term is deterministic
   * from row columns + now(), which is what makes the SQL mirror possible.
   */
  computedScoreSql(): SQL<number> {
    const daysSince = sql`floor(extract(epoch from (now() - coalesce(${leads.lastContactedAt}, ${leads.createdAt}, now() - interval '30 days'))) / 86400)`;
    return sql<number>`least(100, greatest(0,
      50
      + case when coalesce(${leads.responses}, 0) > 0 and ${daysSince} <= 7 then 40 else 0 end
      + least(coalesce(${leads.emailOpens}, 0) * 10 + coalesce(${leads.emailClicks}, 0) * 15, 30)
      + case ${leads.source} when 'referral' then 15 when 'website' then 10 else 0 end
      + case ${leads.status}
          when 'negotiating' then 25
          when 'interested' then 15
          when 'responded' then 20
          when 'qualified' then 20
          when 'accepted' then 35
          when 'under_contract' then 35
          when 'dead' then -50
          else 0
        end
      + greatest(${daysSince} * -2, -20)
    ))::int`;
  },

  /** Stage → score band, mirroring segmentLead's thresholds. */
  stageConditionSql(this: DatabaseStorage, stage: "hot" | "warm" | "cold" | "dead"): SQL {
    const score = leadRepo.computedScoreSql();
    switch (stage) {
      case "hot": return sql`${score} >= 80`;
      case "warm": return sql`${score} >= 50 and ${score} < 80`;
      case "cold": return sql`${score} >= 20 and ${score} < 50`;
      case "dead": return sql`${score} < 20`;
    }
  },

  /**
   * Paginated, stage-filtered lead list — filtering AND pagination in SQL.
   * Same q/assignedTo semantics as getLeadsPaginated. Ordered by computed
   * score (hottest first) then id desc for a stable cursorless page walk.
   */
  async getLeadsByComputedStage(
    this: DatabaseStorage,
    orgId: number,
    stage: "hot" | "warm" | "cold" | "dead",
    options: { page: number; pageSize: number },
    filters?: { assignedTo?: number | null; q?: string },
  ): Promise<PaginatedResult<Lead>> {
    const conditions: any[] = [
      eq(leads.organizationId, orgId),
      sql`${leads.deletedAt} IS NULL`,
      leadRepo.stageConditionSql.call(this, stage),
    ];
    if (filters?.assignedTo === null) {
      conditions.push(sql`${leads.assignedTo} IS NULL`);
    } else if (filters?.assignedTo !== undefined) {
      conditions.push(eq(leads.assignedTo, filters.assignedTo));
    }
    const q = filters?.q?.trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const phoneDigits = q.replace(/\D/g, "");
      const phoneLike = phoneDigits.length >= 3 ? `%${phoneDigits}%` : null;
      const ors: any[] = [
        ilike(leads.firstName, like),
        ilike(leads.lastName, like),
        ilike(leads.email, like),
        ilike(leads.address, like),
        ilike(leads.city, like),
        ilike(leads.state, like),
        ilike(leads.zip, like),
        sql`(${leads.firstName} || ' ' || ${leads.lastName}) ILIKE ${like}`,
      ];
      if (phoneLike) ors.push(ilike(leads.phoneNormalized, phoneLike));
      conditions.push(or(...ors)!);
    }
    const whereClause = and(...conditions);
    const [{ count: total }] = await db.select({ count: count() }).from(leads).where(whereClause);
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / options.pageSize));
    const offset = (options.page - 1) * options.pageSize;

    const data = await db.select().from(leads)
      .where(whereClause)
      .orderBy(desc(leadRepo.computedScoreSql()), desc(leads.id))
      .limit(options.pageSize)
      .offset(offset);

    return { data, total: totalNum, page: options.page, pageSize: options.pageSize, totalPages };
  },

  /**
   * W5.3 — cursor-paginated (id desc) lead walk for the infinite-scroll
   * endpoint, with the stage filter applied in SQL. The old implementation
   * loaded EVERY lead in the org (even unfiltered) and sliced in JS.
   */
  async getLeadsCursor(
    this: DatabaseStorage,
    orgId: number,
    opts: { limit: number; cursor?: number; stage?: "hot" | "warm" | "cold" | "dead" },
    filters?: { assignedTo?: number | null },
  ): Promise<{ data: Lead[]; total: number; hasMore: boolean }> {
    const conditions: any[] = [eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`];
    if (opts.stage) conditions.push(leadRepo.stageConditionSql.call(this, opts.stage));
    if (filters?.assignedTo === null) {
      conditions.push(sql`${leads.assignedTo} IS NULL`);
    } else if (filters?.assignedTo !== undefined) {
      conditions.push(eq(leads.assignedTo, filters.assignedTo));
    }
    const whereClause = and(...conditions);
    const [{ count: total }] = await db.select({ count: count() }).from(leads).where(whereClause);

    const pageConditions = opts.cursor
      ? and(whereClause, sql`${leads.id} < ${opts.cursor}`)
      : whereClause;
    // limit+1 so hasMore is exact without a second count at the cursor.
    const rows = await db.select().from(leads)
      .where(pageConditions)
      .orderBy(desc(leads.id))
      .limit(opts.limit + 1);

    return {
      data: rows.slice(0, opts.limit),
      total: Number(total),
      hasMore: rows.length > opts.limit,
    };
  },

  async getLead(this: DatabaseStorage, orgId: number, id: number): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.organizationId, orgId), eq(leads.id, id)));
    return lead;
  },

  /**
   * EVERY lead in the org whose phone ends in the same ten digits as `phone`
   * (DEFECT-0104). Replaces three full-org `select().from(leads)` scans that
   * each `.find()`-ed the FIRST match, so two leads sharing a number with
   * contradictory consent resolved by row order. Uses the stored generated
   * `phone_normalized` column (trigram-indexed, migration 0051) for the
   * suffix match, then re-checks the exact last ten in JS because a LIKE
   * suffix match is only as precise as the pattern.
   *
   * Soft-deleted leads are excluded by default — a deleted CRM row is not a
   * consent record. Inbound STOP handling passes `includeDeleted` because a
   * revocation must land on every row that could ever be restored.
   */
  async findLeadsByPhoneLast10(
    this: DatabaseStorage,
    orgId: number,
    phone: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Lead[]> {
    const last10 = phone.replace(/\D/g, "").slice(-10);
    if (last10.length < 7) return [];
    const conditions = [
      eq(leads.organizationId, orgId),
      like(leads.phoneNormalized, `%${last10}`),
    ];
    if (!opts.includeDeleted) conditions.push(sql`${leads.deletedAt} IS NULL`);
    const rows = await db.select().from(leads)
      .where(and(...conditions))
      .limit(LIST_READ_CAP);
    return rows.filter((l) => {
      const digits = (l.phoneNormalized ?? l.phone?.replace(/\D/g, "") ?? "");
      return digits.length >= 7 && digits.slice(-10) === last10;
    });
  },

  // organizationId is omitted from InsertLead (set server-side) but the DB
  // column is NOT NULL — callers supply it, so it is required here.
  async createLead(this: DatabaseStorage, lead: InsertLead & { organizationId: number }): Promise<Lead> {
    // consentDate is the server's clock, never the caller's (consentStamp.ts).
    const [newLead] = await db.insert(leads).values(stampConsentForInsert(leadInsertRow(lead), DEFAULT_GRANT_SOURCE, clock.now())).returning();
    await this.logActivity({
      organizationId: lead.organizationId,
      action: "created",
      entityType: "lead",
      entityId: newLead.id,
      description: `Lead ${newLead.firstName} ${newLead.lastName} created`,
    });
    return newLead;
  },

  async createLeadsBatch(this: DatabaseStorage, leadsData: (InsertLead & { organizationId: number })[]): Promise<Lead[]> {
    if (leadsData.length === 0) return [];
    // Batch insert all leads in a single query instead of N individual inserts
    const newLeads = await db
      .insert(leads)
      .values(leadsData.map((l) => stampConsentForInsert(leadInsertRow(l), "imported", clock.now())))
      .returning();
    // Batch-log activity for all created leads
    if (newLeads.length > 0) {
      const activityEntries = newLeads.map((lead) => ({
        organizationId: lead.organizationId,
        action: "created" as const,
        entityType: "lead" as const,
        entityId: lead.id,
        description: `Lead ${lead.firstName} ${lead.lastName} created (batch import)`,
      }));
      await db.insert(activityLog).values(activityEntries);
    }
    return newLeads;
  },

  async updateLead(this: DatabaseStorage, id: number, updates: Partial<InsertLead>, organizationId?: number): Promise<Lead> {
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    const [updated] = await db.update(leads)
      .set({ ...stampConsentForUpdate(omitProtectedFields(updates), DEFAULT_GRANT_SOURCE), updatedAt: clock.now() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteLead(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Task 223: Soft delete — set status='deleted' instead of hard-deleting so the
    // record is preserved for audit purposes.
    // Phase 3 Week 11 (legal-hold): even soft-delete is blocked while a hold
    // is active — operators must explicitly release the hold first to make
    // the audit trail of deletion-attempts unambiguous.
    if (organizationId !== undefined) {
      await assertNotUnderLegalHold(organizationId, "lead", id);
    }
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    // `deletedAt` is the soft delete: every list read filters on it, so a
    // lead deleted with status alone kept appearing — the "clear sample
    // data" leads included (audit of 224a5c0). The status is kept, as the
    // route's own delete keeps it, so a restore brings the lead back as it
    // was (audit of 9ed61f4).
    await db.update(leads)
      .set({ deletedAt: clock.now(), updatedAt: clock.now() })
      .where(and(...conditions));
  },

  async getLeadCount(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(leads)
      .where(and(eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`));
    return result?.count || 0;
  },

  async bulkDeleteLeads(this: DatabaseStorage, orgId: number, ids: number[], _userId?: string): Promise<number> {
    // Soft delete is `deletedAt` — the one field every list read filters and
    // restore clears. This set status='deleted' instead, so a bulk-deleted
    // lead stayed listed and the Undo (restoreLeads, which matches
    // `deletedAt IS NOT NULL`) restored nothing (audit of 9ed61f4). The
    // lead's real status is kept, so a restore brings it back as it was.
    // Legal-hold (Phase 3 Week 11): drop held ids from the batch before delete.
    if (ids.length === 0) return 0;
    const allowed = await filterOutHeldIds(orgId, "lead", ids);
    if (allowed.length === 0) return 0;
    await db.update(leads)
      .set({ deletedAt: clock.now(), deletedBy: _userId ?? null, updatedAt: clock.now() })
      .where(and(eq(leads.organizationId, orgId), inArray(leads.id, allowed)));
    return allowed.length;
  },

  async bulkUpdateLeads(this: DatabaseStorage, orgId: number, ids: number[], updates: Partial<InsertLead>): Promise<number> {
    if (ids.length === 0) return 0;
    await db.update(leads)
      .set({ ...stampConsentForUpdate(omitProtectedFields(updates), DEFAULT_GRANT_SOURCE), updatedAt: clock.now() })
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, ids),
        sql`${leads.deletedAt} IS NULL` // Only update active leads
      ));
    return ids.length;
  },

  // Lead Soft-Delete & Recovery methods
  async getDeletedLeads(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.deletedAt} IS NOT NULL`
      ))
      .orderBy(desc(leads.deletedAt))
      .limit(5000);
  },

  async restoreLeads(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    // A legacy row soft-deleted by status alone comes back as "new"; any
    // other status is the lead's own and is kept. The count is what matched,
    // not what was asked for (audit of 9ed61f4: it reported every id).
    const restored = await db.update(leads)
      .set({
        deletedAt: null,
        deletedBy: null,
        status: sql`case when ${leads.status} = 'deleted' then 'new' else ${leads.status} end`,
        updatedAt: clock.now()
      })
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, ids),
        or(sql`${leads.deletedAt} IS NOT NULL`, eq(leads.status, "deleted"))
      ))
      .returning({ id: leads.id });
    return restored.length;
  },

  async permanentlyDeleteLeads(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Hard delete - only for already soft-deleted leads
    // Legal-hold (Phase 3 Week 11): permadelete is the destructive path
    // FRCP 37(e) targets — every held id is filtered out before DELETE.
    const allowed = await filterOutHeldIds(orgId, "lead", ids);
    if (allowed.length === 0) return 0;
    await db.delete(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, allowed),
        sql`${leads.deletedAt} IS NOT NULL`
      ));
    return allowed.length;
  },

  async getLeadsByIds(this: DatabaseStorage, orgId: number, ids: number[]): Promise<Lead[]> {
    if (ids.length === 0) return [];
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, ids),
        sql`${leads.deletedAt} IS NULL`
      ));
  },

  async findDuplicateLeads(this: DatabaseStorage, orgId: number, criteria: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
  }): Promise<Lead[]> {
    // Deleted leads are duplicates too, deliberately: this guards import and
    // lead creation, and a deleted row may carry a STOP's doNotContact — a
    // fresh row would be contactable again (DEFECT-0273's one exception).
    const conditions: SQL[] = [eq(leads.organizationId, orgId)];

    const orConditions: SQL[] = [];

    if (criteria.email) {
      orConditions.push(ilike(leads.email, criteria.email.trim()));
    }

    if (criteria.phone) {
      const normalizedPhone = criteria.phone.replace(/\D/g, "");
      if (normalizedPhone.length >= 10) {
        orConditions.push(sql`REPLACE(REPLACE(REPLACE(${leads.phone}, '-', ''), ' ', ''), '(', '') LIKE '%' || ${normalizedPhone.slice(-10)} || '%'`);
      }
    }

    if (criteria.firstName && criteria.lastName) {
      orConditions.push(
        and(
          ilike(leads.firstName, criteria.firstName.trim()),
          ilike(leads.lastName, criteria.lastName.trim())
        )!
      );
    }

    if (criteria.address) {
      const cleanAddress = criteria.address.trim().toLowerCase();
      orConditions.push(sql`LOWER(${leads.address}) LIKE '%' || ${cleanAddress} || '%'`);
    }

    if (orConditions.length === 0) {
      return [];
    }

    conditions.push(or(...orConditions)!);

    return await db.select().from(leads)
      .where(and(...conditions))
      .limit(20);
  },

  async mergeLeads(this: DatabaseStorage, orgId: number, primaryId: number, duplicateId: number): Promise<Lead> {
    const [primary, duplicate] = await Promise.all([
      this.getLead(orgId, primaryId),
      this.getLead(orgId, duplicateId),
    ]);

    if (!primary || !duplicate) {
      throw new Error("Lead not found");
    }
    // The merge ends by deleting the duplicate, so a hold on it refuses the
    // whole merge here, before the primary is rewritten.
    await assertNotUnderLegalHold(orgId, "lead", duplicateId);
    // Two different parcels are not duplicates, however alike their owner
    // details: the merge deletes one (DEFECT-0161).
    const { areDistinctParcels } = await import("../services/leads/parcelDedupe");
    if (areDistinctParcels(primary, duplicate)) {
      throw new LeadsAreDistinctParcelsError();
    }

    const mergedData: Partial<InsertLead> = {};
    const fieldsToMerge: (keyof InsertLead)[] = [
      "email", "phone", "address", "city", "state", "zip", "notes", "source",
    ];

    for (const field of fieldsToMerge) {
      const primaryVal = primary[field as keyof Lead];
      const duplicateVal = duplicate[field as keyof Lead];
      if (!primaryVal && duplicateVal) {
        (mergedData as any)[field] = duplicateVal;
      }
    }

    // The parcel moves as ONE unit (DEFECT-0161). Field by field, a primary
    // with a county but no APN took the duplicate's APN under its own county —
    // a parcel matching neither lead — and the parcel's attributes were
    // dropped with the deleted row. When only the duplicate has a parcel, the
    // whole parcel comes across; when both have it (the same parcel, or the
    // merge was refused above), only the primary's gaps are filled.
    const parcelAttrs = ["propertyAddress", "acreage", "estimatedValue", "taxDelinquent"] as const;
    const blank = (v: unknown) => v === null || v === undefined || v === "";
    if (blank(primary.apn) && !blank(duplicate.apn)) {
      for (const field of ["apn", "county", ...parcelAttrs] as const) {
        (mergedData as Record<string, unknown>)[field] = duplicate[field];
      }
    } else if (blank(primary.apn) === blank(duplicate.apn)) {
      // Same parcel, or neither names one. A duplicate with no APN has no
      // parcel to vouch for its attributes, so it cannot fill the primary's.
      for (const field of ["county", ...parcelAttrs] as const) {
        if (blank(primary[field]) && !blank(duplicate[field])) {
          (mergedData as Record<string, unknown>)[field] = duplicate[field];
        }
      }
    }

    if (duplicate.notes && primary.notes) {
      mergedData.notes = `${primary.notes}\n\n--- Merged from duplicate lead ---\n${duplicate.notes}`;
    } else if (duplicate.notes && !primary.notes) {
      mergedData.notes = duplicate.notes;
    }

    // An opt-out survives the merge. The fields above only fill the primary's
    // GAPS, so a duplicate that had said STOP was deleted and its opt-out with
    // it — the merged lead was contactable again. Either lead's opt-out now
    // carries over: doNotContact if either had it, and the EARLIEST opt-out
    // date (the moment the person first revoked contact).
    if (leadHasOptedOut(primary) || leadHasOptedOut(duplicate)) {
      if (primary.doNotContact === true || duplicate.doNotContact === true) mergedData.doNotContact = true;
      const dates = [primary.optOutDate, duplicate.optOutDate]
        .filter((d): d is Date => d !== null && d !== undefined)
        .map((d) => new Date(d));
      if (dates.length > 0) {
        const earliest = dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
        mergedData.optOutDate = earliest;
        const reasonFrom = primary.optOutDate && new Date(primary.optOutDate).getTime() === earliest.getTime() ? primary : duplicate;
        if (reasonFrom.optOutReason) mergedData.optOutReason = reasonFrom.optOutReason;
      }
    }

    const updated = await this.updateLead(primaryId, mergedData, orgId);
    await this.deleteLead(duplicateId, orgId);

    await this.logActivity({
      organizationId: orgId,
      action: "merged",
      entityType: "lead",
      entityId: primaryId,
      description: `Merged duplicate lead #${duplicateId} into lead #${primaryId}`,
    });

    return updated;
  },

  // Lead Scoring & Nurturing
  async getLeadsNeedingScoring(this: DatabaseStorage, orgId: number, limit: number = 50): Promise<Lead[]> {
    const oneDayAgo = new Date(clock.nowMs() - 24 * 60 * 60 * 1000);
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} != 'dead'`,
        sql`${leads.status} != 'closed'`,
        or(
          sql`${leads.lastScoreAt} IS NULL`,
          lte(leads.lastScoreAt, oneDayAgo)
        )
      ))
      .orderBy(sql`${leads.lastScoreAt} NULLS FIRST`)
      .limit(limit);
  },

  async getLeadsDueForFollowUp(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    const now = clock.now();
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} != 'dead'`,
        sql`${leads.status} != 'closed'`,
        lte(leads.nextFollowUpAt, now)
      ))
      .orderBy(leads.nextFollowUpAt)
      .limit(100);
  },

  async createLeadActivity(this: DatabaseStorage, activity: InsertLeadActivity): Promise<LeadActivity> {
    const [newActivity] = await db.insert(leadActivities).values(activity).returning();
    return newActivity;
  },

  // Tenancy: `lead_activities.organization_id` is NOT NULL, so the timeline is
  // scoped INSIDE the statement rather than trusting the caller to have proven
  // the lead first. This used to read `(leadId, limit)` with no org anywhere;
  // four of its five production callers passed `(organizationId, leadId)`, and
  // because both parameters are `number` that type-checked while the query
  // became `where lead_id = <organizationId> limit <leadId>` — org A's agent
  // skills read another tenant's activity rows. The org id is now the leading
  // argument (repo convention: getLead(orgId, id), getLeadsNeedingScoring(orgId,
  // limit)) AND a predicate, so a swap can no longer widen the read.
  async getLeadActivities(this: DatabaseStorage, organizationId: number, leadId: number, limit: number = 50): Promise<LeadActivity[]> {
    return await db.select().from(leadActivities)
      .where(and(
        eq(leadActivities.organizationId, organizationId),
        eq(leadActivities.leadId, leadId),
      ))
      .orderBy(desc(leadActivities.createdAt))
      .limit(limit);
  },

  async updateLeadScore(this: DatabaseStorage, leadId: number, score: number, scoreFactors: Lead["scoreFactors"], organizationId?: number): Promise<Lead> {
    const conditions = [eq(leads.id, leadId)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    const [updated] = await db.update(leads)
      .set({
        score,
        scoreFactors,
        lastScoreAt: clock.now(),
        updatedAt: clock.now(),
      })
      .where(and(...conditions))
      .returning();
    return updated;
  },
};

export type LeadRepo = typeof leadRepo;
