// Property-evaluation data layer: due-diligence assignments (incl. the
// pending sweep), SWOT reports, and go/no-go memos. Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  ddAssignments,
  swotReports,
  goNogoMemos,
  type DdAssignment,
  type SwotReport,
  type GoNogoMemo,
  type InsertDdAssignment,
  type InsertSwotReport,
  type InsertGoNogoMemo,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const evaluationRepo = {
  // DD Assignments
  async getDDAssignments(this: DatabaseStorage, organizationId: number): Promise<DdAssignment[]> {
    return await db.select().from(ddAssignments)
      .where(eq(ddAssignments.organizationId, organizationId))
      .orderBy(desc(ddAssignments.createdAt));
  },

  async getDDAssignmentById(this: DatabaseStorage, organizationId: number, id: number): Promise<DdAssignment | undefined> {
    const [assignment] = await db.select().from(ddAssignments)
      .where(and(eq(ddAssignments.id, id), eq(ddAssignments.organizationId, organizationId)));
    return assignment;
  },

  async getDDAssignmentsByProperty(this: DatabaseStorage, organizationId: number, propertyId: number): Promise<DdAssignment[]> {
    return await db.select().from(ddAssignments)
      .where(and(eq(ddAssignments.propertyId, propertyId), eq(ddAssignments.organizationId, organizationId)))
      .orderBy(desc(ddAssignments.createdAt));
  },

  async getPendingDDAssignments(this: DatabaseStorage, organizationId: number): Promise<DdAssignment[]> {
    return await db.select().from(ddAssignments)
      .where(and(
        eq(ddAssignments.organizationId, organizationId),
        eq(ddAssignments.status, "pending")
      ))
      .orderBy(desc(ddAssignments.createdAt));
  },

  async createDDAssignment(this: DatabaseStorage, data: InsertDdAssignment): Promise<DdAssignment> {
    const [created] = await db.insert(ddAssignments).values(data).returning();
    return created;
  },

  async updateDDAssignment(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertDdAssignment>): Promise<DdAssignment | undefined> {
    const [updated] = await db.update(ddAssignments)
      .set(data)
      .where(and(eq(ddAssignments.id, id), eq(ddAssignments.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteDDAssignment(this: DatabaseStorage, organizationId: number, id: number): Promise<boolean> {
    await db.delete(ddAssignments)
      .where(and(eq(ddAssignments.id, id), eq(ddAssignments.organizationId, organizationId)));
    return true;
  },

  // SWOT Reports
  async getSwotReports(this: DatabaseStorage, organizationId: number): Promise<SwotReport[]> {
    return await db.select().from(swotReports)
      .where(eq(swotReports.organizationId, organizationId))
      .orderBy(desc(swotReports.createdAt));
  },

  async getSwotReportById(this: DatabaseStorage, organizationId: number, id: number): Promise<SwotReport | undefined> {
    const [report] = await db.select().from(swotReports)
      .where(and(eq(swotReports.id, id), eq(swotReports.organizationId, organizationId)));
    return report;
  },

  async getSwotReportByProperty(this: DatabaseStorage, organizationId: number, propertyId: number): Promise<SwotReport | undefined> {
    const [report] = await db.select().from(swotReports)
      .where(and(eq(swotReports.propertyId, propertyId), eq(swotReports.organizationId, organizationId)))
      .orderBy(desc(swotReports.createdAt))
      .limit(1);
    return report;
  },

  async createSwotReport(this: DatabaseStorage, data: InsertSwotReport): Promise<SwotReport> {
    const [created] = await db.insert(swotReports).values(data).returning();
    return created;
  },

  async updateSwotReport(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertSwotReport>): Promise<SwotReport | undefined> {
    const [updated] = await db.update(swotReports)
      .set(data)
      .where(and(eq(swotReports.id, id), eq(swotReports.organizationId, organizationId)))
      .returning();
    return updated;
  },

  // Go/No-Go Memos
  async getGoNogoMemos(this: DatabaseStorage, organizationId: number): Promise<GoNogoMemo[]> {
    return await db.select().from(goNogoMemos)
      .where(eq(goNogoMemos.organizationId, organizationId))
      .orderBy(desc(goNogoMemos.createdAt));
  },

  async getGoNogoMemoById(this: DatabaseStorage, organizationId: number, id: number): Promise<GoNogoMemo | undefined> {
    const [memo] = await db.select().from(goNogoMemos)
      .where(and(eq(goNogoMemos.id, id), eq(goNogoMemos.organizationId, organizationId)));
    return memo;
  },

  async getGoNogoMemoByProperty(this: DatabaseStorage, organizationId: number, propertyId: number): Promise<GoNogoMemo | undefined> {
    const [memo] = await db.select().from(goNogoMemos)
      .where(and(eq(goNogoMemos.propertyId, propertyId), eq(goNogoMemos.organizationId, organizationId)))
      .orderBy(desc(goNogoMemos.createdAt))
      .limit(1);
    return memo;
  },

  async createGoNogoMemo(this: DatabaseStorage, data: InsertGoNogoMemo): Promise<GoNogoMemo> {
    const [created] = await db.insert(goNogoMemos).values(data).returning();
    return created;
  },

  async updateGoNogoMemo(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertGoNogoMemo>): Promise<GoNogoMemo | undefined> {
    const [updated] = await db.update(goNogoMemos)
      .set(data)
      .where(and(eq(goNogoMemos.id, id), eq(goNogoMemos.organizationId, organizationId)))
      .returning();
    return updated;
  },
};

export type EvaluationRepo = typeof evaluationRepo;
