// Outreach-sequences data layer: campaign sequences, sequence steps,
// enrollments (incl. the pause/resume/cancel/complete lifecycle + due-for-
// processing sweep), and A/B tests + variants. Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance.

import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../db";
import {
  campaignSequences,
  leads,
  type Lead,
  sequenceSteps,
  sequenceEnrollments,
  abTests,
  abTestVariants,
  type CampaignSequence,
  type SequenceStep,
  type SequenceEnrollment,
  type AbTest,
  type AbTestVariant,
  type InsertCampaignSequence,
  type InsertSequenceStep,
  type InsertSequenceEnrollment,
  type InsertAbTest,
  type InsertAbTestVariant,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const sequencesRepo = {
  // Campaign Sequences
  async getSequences(this: DatabaseStorage, orgId: number): Promise<CampaignSequence[]> {
    return await db.select().from(campaignSequences)
      .where(eq(campaignSequences.organizationId, orgId))
      .orderBy(desc(campaignSequences.createdAt));
  },

  async getSequence(this: DatabaseStorage, orgId: number, id: number): Promise<CampaignSequence | undefined> {
    const [sequence] = await db.select().from(campaignSequences)
      .where(and(eq(campaignSequences.organizationId, orgId), eq(campaignSequences.id, id)));
    return sequence;
  },

  async createSequence(this: DatabaseStorage, sequence: InsertCampaignSequence): Promise<CampaignSequence> {
    const [newSequence] = await db.insert(campaignSequences).values(sequence).returning();
    return newSequence;
  },

  async updateSequence(this: DatabaseStorage, id: number, updates: Partial<InsertCampaignSequence>, organizationId?: number): Promise<CampaignSequence> {
    const conditions = [eq(campaignSequences.id, id)];
    if (organizationId) conditions.push(eq(campaignSequences.organizationId, organizationId));
    const [updated] = await db.update(campaignSequences)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteSequence(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Verify sequence belongs to org before deleting child records
    if (organizationId) {
      const [seq] = await db.select().from(campaignSequences)
        .where(and(eq(campaignSequences.id, id), eq(campaignSequences.organizationId, organizationId)));
      if (!seq) return;
    }
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, id));
    await db.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, id));
    const conditions = [eq(campaignSequences.id, id)];
    if (organizationId) conditions.push(eq(campaignSequences.organizationId, organizationId));
    await db.delete(campaignSequences).where(and(...conditions));
  },

  // Sequence Steps
  async getSequenceSteps(this: DatabaseStorage, sequenceId: number): Promise<SequenceStep[]> {
    return await db.select().from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, sequenceId))
      .orderBy(sequenceSteps.stepNumber);
  },

  async createSequenceStep(this: DatabaseStorage, step: InsertSequenceStep): Promise<SequenceStep> {
    const [newStep] = await db.insert(sequenceSteps).values(step).returning();
    return newStep;
  },

  // 2026-06-10 (T0-2 sweep): optional sequenceId constrains the write to the
  // caller's (already org-checked) sequence so a foreign stepId is a no-op.
  async updateSequenceStep(this: DatabaseStorage, id: number, updates: Partial<InsertSequenceStep>, sequenceId?: number): Promise<SequenceStep> {
    const conditions = [eq(sequenceSteps.id, id)];
    if (sequenceId !== undefined) conditions.push(eq(sequenceSteps.sequenceId, sequenceId));
    const [updated] = await db.update(sequenceSteps)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteSequenceStep(this: DatabaseStorage, id: number, sequenceId?: number): Promise<void> {
    const conditions = [eq(sequenceSteps.id, id)];
    if (sequenceId !== undefined) conditions.push(eq(sequenceSteps.sequenceId, sequenceId));
    await db.delete(sequenceSteps).where(and(...conditions));
  },

  async reorderSequenceSteps(this: DatabaseStorage, sequenceId: number, stepIds: number[]): Promise<void> {
    for (let i = 0; i < stepIds.length; i++) {
      await db.update(sequenceSteps)
        .set({ stepNumber: i + 1, updatedAt: new Date() })
        .where(and(eq(sequenceSteps.id, stepIds[i]), eq(sequenceSteps.sequenceId, sequenceId)));
    }
  },

  // Sequence Enrollments
  // 2026-06-10 (T0-2 sweep): single-enrollment fetch so routes can verify the
  // parent sequence's org before mutating (enrollments carry no org column).
  // NOTE (Tier 1F): sequence_enrollments has no organizationId column —
  // ownership is proven through the parent sequence (see getOwnedEnrollment
  // in routes-campaigns.ts). Do not org-pin here.
  async getSequenceEnrollment(this: DatabaseStorage, id: number): Promise<SequenceEnrollment | undefined> {
    const [enrollment] = await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.id, id));
    return enrollment;
  },

  async getSequenceEnrollments(this: DatabaseStorage, sequenceId: number): Promise<SequenceEnrollment[]> {
    return await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.sequenceId, sequenceId))
      .orderBy(desc(sequenceEnrollments.enrolledAt));
  },

  async getLeadEnrollments(this: DatabaseStorage, leadId: number): Promise<SequenceEnrollment[]> {
    return await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.leadId, leadId))
      .orderBy(desc(sequenceEnrollments.enrolledAt));
  },

  async getActiveEnrollments(this: DatabaseStorage, orgId: number): Promise<(SequenceEnrollment & { sequence: CampaignSequence; lead: Lead })[]> {
    const results = await db.select({
      enrollment: sequenceEnrollments,
      sequence: campaignSequences,
      lead: leads,
    })
      .from(sequenceEnrollments)
      .innerJoin(campaignSequences, eq(sequenceEnrollments.sequenceId, campaignSequences.id))
      .innerJoin(leads, eq(sequenceEnrollments.leadId, leads.id))
      .where(and(
        eq(campaignSequences.organizationId, orgId),
        eq(sequenceEnrollments.status, "active")
      ))
      .orderBy(desc(sequenceEnrollments.enrolledAt));

    return results.map(r => ({ ...r.enrollment, sequence: r.sequence, lead: r.lead }));
  },

  async getEnrollmentsDueForProcessing(this: DatabaseStorage): Promise<(SequenceEnrollment & { sequence: CampaignSequence; lead: Lead })[]> {
    const now = new Date();
    const results = await db.select({
      enrollment: sequenceEnrollments,
      sequence: campaignSequences,
      lead: leads,
    })
      .from(sequenceEnrollments)
      .innerJoin(campaignSequences, eq(sequenceEnrollments.sequenceId, campaignSequences.id))
      .innerJoin(leads, eq(sequenceEnrollments.leadId, leads.id))
      .where(and(
        eq(sequenceEnrollments.status, "active"),
        eq(campaignSequences.isActive, true),
        lte(sequenceEnrollments.nextStepScheduledAt, now)
      ))
      .orderBy(sequenceEnrollments.nextStepScheduledAt);

    return results.map(r => ({ ...r.enrollment, sequence: r.sequence, lead: r.lead }));
  },

  async createSequenceEnrollment(this: DatabaseStorage, enrollment: InsertSequenceEnrollment): Promise<SequenceEnrollment> {
    const [newEnrollment] = await db.insert(sequenceEnrollments).values(enrollment).returning();
    return newEnrollment;
  },

  async updateSequenceEnrollment(this: DatabaseStorage, id: number, updates: Partial<InsertSequenceEnrollment>): Promise<SequenceEnrollment> {
    // Note: sequenceEnrollments table doesn't have organizationId column;
    // tenant isolation is enforced via the parent sequence's organizationId.
    const [updated] = await db.update(sequenceEnrollments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sequenceEnrollments.id, id))
      .returning();
    return updated;
  },

  async pauseEnrollment(this: DatabaseStorage, id: number, reason: string): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "paused", pauseReason: reason });
  },

  async resumeEnrollment(this: DatabaseStorage, id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "active", pauseReason: null });
  },

  async cancelEnrollment(this: DatabaseStorage, id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "cancelled" });
  },

  async completeEnrollment(this: DatabaseStorage, id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "completed", completedAt: new Date() });
  },

  async getSequenceStats(this: DatabaseStorage, orgId: number): Promise<{ sequenceId: number; name: string; totalEnrollments: number; activeEnrollments: number; completedEnrollments: number }[]> {
    const sequences = await this.getSequences(orgId);
    const stats = [];

    for (const seq of sequences) {
      const enrollments = await this.getSequenceEnrollments(seq.id);
      stats.push({
        sequenceId: seq.id,
        name: seq.name,
        totalEnrollments: enrollments.length,
        activeEnrollments: enrollments.filter(e => e.status === "active").length,
        completedEnrollments: enrollments.filter(e => e.status === "completed").length,
      });
    }

    return stats;
  },

  // A/B Tests
  async getAbTests(this: DatabaseStorage, orgId: number): Promise<AbTest[]> {
    return await db.select().from(abTests)
      .where(eq(abTests.organizationId, orgId))
      .orderBy(desc(abTests.createdAt));
  },

  async getAbTest(this: DatabaseStorage, orgId: number, id: number): Promise<AbTest | undefined> {
    const [test] = await db.select().from(abTests)
      .where(and(eq(abTests.organizationId, orgId), eq(abTests.id, id)));
    return test;
  },

  async getAbTestByCampaign(this: DatabaseStorage, campaignId: number): Promise<AbTest | undefined> {
    const [test] = await db.select().from(abTests)
      .where(eq(abTests.campaignId, campaignId));
    return test;
  },

  async createAbTest(this: DatabaseStorage, test: InsertAbTest): Promise<AbTest> {
    const [newTest] = await db.insert(abTests).values(test).returning();
    return newTest;
  },

  async updateAbTest(this: DatabaseStorage, id: number, updates: Partial<InsertAbTest>, organizationId?: number): Promise<AbTest> {
    const conditions = [eq(abTests.id, id)];
    if (organizationId) conditions.push(eq(abTests.organizationId, organizationId));
    const [updated] = await db.update(abTests)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteAbTest(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Verify test belongs to org before deleting child records
    if (organizationId) {
      const [test] = await db.select().from(abTests)
        .where(and(eq(abTests.id, id), eq(abTests.organizationId, organizationId)));
      if (!test) return;
    }
    await db.delete(abTestVariants).where(eq(abTestVariants.testId, id));
    const conditions = [eq(abTests.id, id)];
    if (organizationId) conditions.push(eq(abTests.organizationId, organizationId));
    await db.delete(abTests).where(and(...conditions));
  },

  // A/B Test Variants
  async getAbTestVariants(this: DatabaseStorage, testId: number): Promise<AbTestVariant[]> {
    return await db.select().from(abTestVariants)
      .where(eq(abTestVariants.testId, testId))
      .orderBy(abTestVariants.id);
  },

  async createAbTestVariant(this: DatabaseStorage, variant: InsertAbTestVariant): Promise<AbTestVariant> {
    const [newVariant] = await db.insert(abTestVariants).values(variant).returning();
    return newVariant;
  },

  async updateAbTestVariant(this: DatabaseStorage, id: number, updates: Partial<InsertAbTestVariant>): Promise<AbTestVariant> {
    const [updated] = await db.update(abTestVariants)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(abTestVariants.id, id))
      .returning();
    return updated;
  },

  async deleteAbTestVariant(this: DatabaseStorage, id: number): Promise<void> {
    await db.delete(abTestVariants).where(eq(abTestVariants.id, id));
  },

  async getAbTestWithVariants(this: DatabaseStorage, orgId: number, testId: number): Promise<{ test: AbTest; variants: AbTestVariant[] } | undefined> {
    const test = await this.getAbTest(orgId, testId);
    if (!test) return undefined;
    const variants = await this.getAbTestVariants(testId);
    return { test, variants };
  },
};

export type SequencesRepo = typeof sequencesRepo;
