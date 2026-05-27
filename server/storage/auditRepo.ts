// Audit log + data retention + TCPA compliance.
// Extracted from the god-class server/storage.ts.

import { and, desc, eq, sql, count, gte, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  auditLog, leads, deals, leadActivities,
  type AuditLogEntry, type InsertAuditLog,
  type Lead,
} from "@shared/schema";
import { orgHasActiveHold } from "../services/legalHold";
import type { DatabaseStorage } from "../storage";

export const auditRepo = {
  // Audit Log (20.1)
  // Kareem §1: every insert is chained via SHA-256 (see
  // server/utils/auditLogChain.ts). The chain function still returns the
  // canonical row shape, so callers see no API change.
  async createAuditLogEntry(this: DatabaseStorage, entry: InsertAuditLog): Promise<AuditLogEntry> {
    const { chainAndInsertAuditLog } = await import("../utils/auditLogChain");
    return await chainAndInsertAuditLog(entry);
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
    const result = await db.delete(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        lte(leads.createdAt, beforeDate),
        eq(leads.status, "dead")
      ))
      .returning({ id: leads.id });
    return result.length;
  },

  async purgeOldDeals(this: DatabaseStorage, orgId: number, beforeDate: Date, status: string): Promise<number> {
    if (await orgHasActiveHold(orgId)) return 0;
    const result = await db.delete(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        lte(deals.createdAt, beforeDate),
        eq(deals.status, status)
      ))
      .returning({ id: deals.id });
    return result.length;
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
        )
      ))
      .orderBy(desc(leads.createdAt));
  },

  async getLeadsOptedOut(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.doNotContact, true)
      ))
      .orderBy(desc(leads.optOutDate));
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
    const [updated] = await db.update(leads)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  },
};

export type AuditRepo = typeof auditRepo;
