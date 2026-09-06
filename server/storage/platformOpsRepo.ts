// Platform-ops data layer: feature requests (customer + founder views),
// API usage logs + stats, background agent-run status tracking, borrower
// portal sessions (incl. expiry sweeps), and multi-instance job locks (the
// UPSERT-with-conditional-WHERE acquire pattern moves verbatim). Extracted
// from the god-class server/storage.ts in the storage refactor. Methods are
// merged into DatabaseStorage.prototype at construction time; `this` refers
// to the full DatabaseStorage instance.

import { and, desc, eq, gte, lt, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  featureRequests,
  apiUsageLogs,
  agentRuns,
  borrowerSessions,
  jobLocks,
  type FeatureRequest,
  type AgentRun,
  type BorrowerSession,
  type JobLock,
  type InsertFeatureRequest,
  type InsertApiUsageLog,
  type InsertBorrowerSession,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { assertWritablePatch } from "../utils/patch";

export const platformOpsRepo = {
  // Feature Requests
  async getFeatureRequests(this: DatabaseStorage, organizationId?: number): Promise<FeatureRequest[]> {
    if (organizationId !== undefined) {
      return await db.select()
        .from(featureRequests)
        .where(eq(featureRequests.organizationId, organizationId))
        .orderBy(desc(featureRequests.createdAt));
    }
    return await db.select()
      .from(featureRequests)
      .orderBy(desc(featureRequests.createdAt));
  },

  async createFeatureRequest(this: DatabaseStorage, request: InsertFeatureRequest): Promise<FeatureRequest> {
    const [newRequest] = await db.insert(featureRequests)
      .values(request)
      .returning();
    return newRequest;
  },

  async updateFeatureRequest(this: DatabaseStorage, id: number, updates: Partial<FeatureRequest>, organizationId?: number): Promise<FeatureRequest> {
    const conditions = [eq(featureRequests.id, id)];
    if (organizationId) conditions.push(eq(featureRequests.organizationId, organizationId));
    const [updated] = await db.update(featureRequests)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async getAllFeatureRequestsForFounder(this: DatabaseStorage): Promise<FeatureRequest[]> {
    return await db.select()
      .from(featureRequests)
      .orderBy(desc(featureRequests.createdAt));
  },

  // API Usage Logs
  async logApiUsage(this: DatabaseStorage, log: InsertApiUsageLog): Promise<void> {
    await db.insert(apiUsageLogs).values(log);
  },

  async getApiUsageStats(this: DatabaseStorage, startDate?: Date, endDate?: Date): Promise<{
    totalCostCents: number;
    byService: {
      lob: { count: number; costCents: number };
      regrid: { count: number; costCents: number };
      openai: { count: number; costCents: number };
    };
    recentUsage: Array<{ date: string; costCents: number }>;
  }> {
    const now = new Date();
    const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate || now;
    
    const conditions = [
      gte(apiUsageLogs.createdAt, start),
      lte(apiUsageLogs.createdAt, end),
    ];
    
    const logs = await db.select()
      .from(apiUsageLogs)
      .where(and(...conditions));
    
    const byService = {
      lob: { count: 0, costCents: 0 },
      regrid: { count: 0, costCents: 0 },
      openai: { count: 0, costCents: 0 },
    };
    
    let totalCostCents = 0;
    
    for (const log of logs) {
      const costCents = log.estimatedCostCents || 0;
      const logCount = log.count || 1;
      totalCostCents += costCents;
      
      if (log.service === 'lob') {
        byService.lob.count += logCount;
        byService.lob.costCents += costCents;
      } else if (log.service === 'regrid') {
        byService.regrid.count += logCount;
        byService.regrid.costCents += costCents;
      } else if (log.service === 'openai') {
        byService.openai.count += logCount;
        byService.openai.costCents += costCents;
      }
    }
    
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentLogs = await db.select()
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, sevenDaysAgo));
    
    const dailyCosts: Record<string, number> = {};
    for (const log of recentLogs) {
      if (log.createdAt) {
        const dateStr = log.createdAt.toISOString().split('T')[0];
        dailyCosts[dateStr] = (dailyCosts[dateStr] || 0) + (log.estimatedCostCents || 0);
      }
    }
    
    const recentUsage: Array<{ date: string; costCents: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      recentUsage.push({ date: dateStr, costCents: dailyCosts[dateStr] || 0 });
    }
    
    return { totalCostCents, byService, recentUsage };
  },

  // Agent Runs (background agent status tracking)
  async getAgentStatuses(this: DatabaseStorage): Promise<AgentRun[]> {
    return await db.select().from(agentRuns).orderBy(agentRuns.agentName);
  },

  async updateAgentStatus(this: DatabaseStorage, agentName: string, updates: Partial<AgentRun>): Promise<AgentRun> {
    const [existing] = await db.select().from(agentRuns).where(eq(agentRuns.agentName, agentName));
    
    if (existing) {
      const [updated] = await db.update(agentRuns)
        .set(assertWritablePatch(updates, "agent_runs.updateAgentStatus"))
        .where(eq(agentRuns.agentName, agentName))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(agentRuns)
        .values({ agentName, ...updates })
        .returning();
      return created;
    }
  },

  // Borrower Sessions
  async createBorrowerSession(this: DatabaseStorage, data: InsertBorrowerSession): Promise<BorrowerSession> {
    const [session] = await db.insert(borrowerSessions).values(data).returning();
    return session;
  },

  async getBorrowerSession(this: DatabaseStorage, token: string): Promise<BorrowerSession | undefined> {
    const [session] = await db.select()
      .from(borrowerSessions)
      .where(eq(borrowerSessions.sessionToken, token));
    return session;
  },

  async updateBorrowerSessionAccess(this: DatabaseStorage, token: string): Promise<BorrowerSession | undefined> {
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    const [updated] = await db.update(borrowerSessions)
      .set({ 
        lastAccessedAt: now,
        expiresAt: newExpiresAt, // Sliding expiration
      })
      .where(eq(borrowerSessions.sessionToken, token))
      .returning();
    return updated;
  },

  async deleteBorrowerSession(this: DatabaseStorage, token: string): Promise<void> {
    await db.delete(borrowerSessions)
      .where(eq(borrowerSessions.sessionToken, token));
  },

  async cleanExpiredBorrowerSessions(this: DatabaseStorage): Promise<number> {
    const now = new Date();
    const result = await db.delete(borrowerSessions)
      .where(lt(borrowerSessions.expiresAt, now))
      .returning();
    return result.length;
  },

  // Job Locks (prevent duplicate execution in multi-instance deployment)
  //
  // 2026-06-05 Iris reliability audit fix: the previous implementation read
  // the existing row, branched on its expiresAt, then issued an UPDATE
  // without a guard — two workers racing past expiration both saw the same
  // expired row and both UPDATE'd, both returning true, both running the
  // job. Could double-fire paid AI work. Rewritten as a single atomic
  // UPSERT-with-conditional-WHERE: the UPDATE only succeeds for callers
  // that either own the lock OR find it expired, and we trust the
  // 0-vs-non-0 rowcount as the acquire signal.
  async acquireJobLock(this: DatabaseStorage, jobName: string, instanceId: string, ttlSeconds: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      // Atomic conditional UPDATE: succeeds only if (lock expired OR we
      // already own it). Returns 1 row on win, 0 rows otherwise. Drizzle
      // exposes .returning() to detect that.
      const updated = await db
        .update(jobLocks)
        .set({ lockedBy: instanceId, lockedAt: now, expiresAt })
        .where(
          and(
            eq(jobLocks.jobName, jobName),
            or(
              lt(jobLocks.expiresAt, now),
              eq(jobLocks.lockedBy, instanceId),
            ),
          ),
        )
        .returning({ id: jobLocks.id });
      if (updated.length > 0) return true;

      // No existing row matched. Try to insert a fresh row.
      try {
        await db.insert(jobLocks).values({
          jobName,
          lockedBy: instanceId,
          expiresAt,
        });
        return true;
      } catch (err: any) {
        // 23505 = unique violation → they own the lock. drizzle wraps the pg
        // error, so the code may live on err.cause (WS5 drill, 2026-07-08).
        if (err?.code === "23505" || err?.cause?.code === "23505") return false;
        throw err;
      }
    } catch (error: any) {
      if (error?.code === "23505" || error?.cause?.code === "23505") return false;
      throw error;
    }
  },

  async releaseJobLock(this: DatabaseStorage, jobName: string, instanceId: string): Promise<void> {
    await db.delete(jobLocks)
      .where(and(
        eq(jobLocks.jobName, jobName),
        eq(jobLocks.lockedBy, instanceId)
      ));
  },

  async cleanExpiredJobLocks(this: DatabaseStorage): Promise<void> {
    const now = new Date();
    await db.delete(jobLocks).where(lt(jobLocks.expiresAt, now));
  },
};

export type PlatformOpsRepo = typeof platformOpsRepo;
