// Audit log + data retention + TCPA compliance.
// Extracted from the god-class server/storage.ts.

import { and, desc, eq, sql, count, gte, lte, or } from "drizzle-orm";
import { db, type PrimaryDb } from "../db";
import {
  auditLog, leads, deals, leadActivities,
  type AuditLogEntry, type InsertAuditLog,
  type Lead,
} from "@shared/schema";
import { orgHasActiveHold } from "../services/legalHold";
import { DEAL_PURGED, recordDealTransitionEvidence } from "../services/dealLifecycleEvents";
import type { DatabaseStorage } from "../storage";
import { liveLead, leadsIncludingDeleted } from "./liveLeads";

export const auditRepo = {
  // Audit Log (20.1)
  // Kareem §1: every insert is chained via SHA-256 (see
  // server/utils/auditLogChain.ts). The chain function still returns the
  // canonical row shape, so callers see no API change.
  async createAuditLogEntry(
    this: DatabaseStorage,
    entry: InsertAuditLog,
    tx?: PrimaryDb,
  ): Promise<AuditLogEntry> {
    const { chainAndInsertAuditLog } = await import("../utils/auditLogChain");
    return await chainAndInsertAuditLog(entry, tx);
  },

  async getAuditLogs(this: DatabaseStorage, orgId: number, filters?: {
    action?: string;
    entityType?: string;
    entityId?: number;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    const conditions = [eq(auditLog.organizationId, orgId)];

    if (filters?.action) {
      conditions.push(eq(auditLog.action, filters.action));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLog.entityType, filters.entityType));
    }
    if (filters?.entityId !== undefined) {
      conditions.push(eq(auditLog.entityId, filters.entityId));
    }
    if (filters?.userId) {
      conditions.push(eq(auditLog.userId, filters.userId));
    }
    if (filters?.startDate) {
      conditions.push(gte(auditLog.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(auditLog.createdAt, filters.endDate));
    }

    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;

    return await db.select().from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async getAuditLogCount(this: DatabaseStorage, orgId: number, filters?: {
    action?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<number> {
    const conditions = [eq(auditLog.organizationId, orgId)];

    if (filters?.action) {
      conditions.push(eq(auditLog.action, filters.action));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLog.entityType, filters.entityType));
    }
    if (filters?.startDate) {
      conditions.push(gte(auditLog.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(auditLog.createdAt, filters.endDate));
    }

    const [result] = await db.select({ count: count() }).from(auditLog)
      .where(and(...conditions));
    return result?.count || 0;
  },

  // Data Retention (20.3)
  // Phase 3 Week 11 — Legal-hold (FRCP 37(e)): every retention sweep below
  // short-circuits when an active legal hold exists for the org. We block at
  // the org granularity rather than per-row because: (1) retention is a
  // scheduled bulk operation where a held org should not have ANY automatic
  // delete fire, and (2) per-row scope filtering for org_wide holds collapses
  // to "skip all" anyway. Founder admin UI / DSAR fan-out remains the path
  // for surgical, hold-aware deletion.
  async purgeOldLeads(this: DatabaseStorage, orgId: number, beforeDate: Date): Promise<number> {
    if (await orgHasActiveHold(orgId)) return 0;
    const result = await db.delete(leadsIncludingDeleted)
      .where(and(
        eq(leads.organizationId, orgId),
        lte(leads.createdAt, beforeDate),
        eq(leads.status, "dead")
      ))
      .returning({ id: leads.id });
    return result.length;
  },

  /**
   * The retention purge of an org's deals of one status created before a date.
   *
   * Only a deal NOTHING references is removed. Thirteen-odd tables point at
   * deals with ON DELETE NO ACTION — signed contracts (generated_documents),
   * the close's own deal_won outcome and pattern fingerprint, checklists,
   * closing packets, transcripts — and a retention rule has no business
   * cascading those away (customer-data deletion beyond the rule is a
   * founder decision). A deal one of them references is KEPT and counted, so
   * the purge neither fails with 23503 on the first linked deal (W10.4
   * re-audit) nor reports a purge it did not do. The referencing tables are
   * read from the live catalog (orgDataClear.loadBlockingEdges), never from a
   * list here that a new child table would silently outgrow; one DELETE
   * statement, so a deal reopened under it is re-checked and survives.
   */
  async purgeOldDeals(
    this: DatabaseStorage,
    orgId: number,
    beforeDate: Date,
    status: string,
  ): Promise<{ purged: number; keptLinked: number }> {
    if (await orgHasActiveHold(orgId)) return { purged: 0, keptLinked: 0 };
    const { loadBlockingEdges } = await import("../services/orgDataClear");
    const children = (await loadBlockingEdges()).filter((e) => e.parent === "deals" && e.parentCol === "id");
    const unreferenced = children.map(
      (c) =>
        // The child is aliased, so a future self-reference (deals → deals)
        // still correlates with the OUTER deal row.
        sql`NOT EXISTS (SELECT 1 FROM ${sql.identifier(c.child)} AS "blocking_child" WHERE "blocking_child".${sql.identifier(c.childCol)} = ${deals.id})`,
    );
    const result = await db
      .delete(deals)
      .where(and(eq(deals.organizationId, orgId), lte(deals.createdAt, beforeDate), eq(deals.status, status), ...unreferenced))
      .returning({ id: deals.id });
    const [kept] = await db
      .select({ n: count() })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), lte(deals.createdAt, beforeDate), eq(deals.status, status)));
    // A purged closed deal is not a sale: the comp its close recorded is
    // retracted, as for any deal leaving closed (audit of 7cc7345). Its owed
    // commission stands — aging out is not an undone sale (DEAL_PURGED).
    for (const d of result) recordDealTransitionEvidence(orgId, { status }, { id: d.id, status: DEAL_PURGED });
    return { purged: result.length, keptLinked: Number(kept?.n ?? 0) };
  },

  async purgeOldAuditLogs(this: DatabaseStorage, orgId: number, beforeDate: Date): Promise<number> {
    if (await orgHasActiveHold(orgId)) return 0;
    // Lens 13 / Kareem §1: naïve DELETE breaks the SHA-256 hash chain. Use
    // the seal-and-purge flow which writes a tamper-evident sealing row +
    // ledger entry before removing the underlying rows. The chain verifier
    // tolerates the documented gap by consulting `audit_log_purges`.
    const { sealAndPurgeAuditLogs } = await import("../utils/auditLogPurge");
    const result = await sealAndPurgeAuditLogs({
      organizationId: orgId,
      beforeDate,
    });
    return result.purgedCount;
  },

  async purgeOldCommunications(this: DatabaseStorage, orgId: number, beforeDate: Date): Promise<number> {
    if (await orgHasActiveHold(orgId)) return 0;
    const result = await db.delete(leadActivities)
      .where(and(
        eq(leadActivities.organizationId, orgId),
        lte(leadActivities.createdAt, beforeDate),
        or(
          eq(leadActivities.type, "communication_email"),
          eq(leadActivities.type, "communication_sms")
        )
      ))
      .returning({ id: leadActivities.id });
    return result.length;
  },

  // TCPA Compliance (20.2)
  async getLeadsWithoutConsent(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        or(
          eq(leads.tcpaConsent, false),
          sql`${leads.tcpaConsent} IS NULL`
        ),
        liveLead()
      ))
      .orderBy(desc(leads.createdAt));
  },

  async getLeadsOptedOut(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    // The TCPA opt-out RECORD includes leads deleted since they opted out: the
    // opt-out still binds their number, and the record must show it (W10.2a audit).
    return await db.select().from(leadsIncludingDeleted)
      .where(and(
        eq(leadsIncludingDeleted.organizationId, orgId),
        eq(leadsIncludingDeleted.doNotContact, true),
      ))
      .orderBy(desc(leadsIncludingDeleted.optOutDate));
  },

  async updateLeadConsent(this: DatabaseStorage, leadId: number, consent: {
    tcpaConsent: boolean;
    consentSource?: string;
    optOutReason?: string;
  }, organizationId?: number): Promise<Lead> {
    const updates: Partial<Lead> = {
      tcpaConsent: consent.tcpaConsent,
      updatedAt: new Date(),
    };

    if (consent.tcpaConsent) {
      updates.consentDate = new Date();
      updates.consentSource = consent.consentSource || "manual";
      updates.optOutDate = null;
      updates.optOutReason = null;
      updates.doNotContact = false;
    } else {
      updates.optOutDate = new Date();
      updates.optOutReason = consent.optOutReason;
      updates.doNotContact = true;
    }

    const conditions = [eq(leads.id, leadId)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    const [updated] = await db.update(leadsIncludingDeleted)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  },
};

export type AuditRepo = typeof auditRepo;
