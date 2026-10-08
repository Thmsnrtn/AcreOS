// Outreach-sequences data layer: campaign sequences, sequence steps,
// enrollments (incl. the pause/resume/cancel/complete lifecycle + due-for-
// processing sweep), and A/B tests + variants. Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance.

import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { omitProtectedFields } from "../utils/updatePayload";
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
import { clock } from "../utils/clock";

// sequence_steps, sequence_enrollments and ab_test_variants carry no
// organization column: the owner is the parent sequence / A/B test. The reads
// and updates that address those rows by id or by parent constrain the parent
// to the caller's organization in the same statement, through these
// subqueries, as do deleteSequenceStep and deleteAbTestVariant. Not covered by
// that statement-level check: the child INSERTS (createSequenceStep,
// createSequenceEnrollment, createAbTestVariant), which take no organization
// and rely on the caller having loaded the parent within it; and the child
// deletes inside deleteSequence / deleteAbTest, which run only after a guarded
// read of the parent within the organization in the same method.
function orgSequenceIds(organizationId: number, sequenceId?: number) {
  return db.select({ id: campaignSequences.id }).from(campaignSequences).where(
    sequenceId === undefined
      ? eq(campaignSequences.organizationId, organizationId)
      : and(eq(campaignSequences.id, sequenceId), eq(campaignSequences.organizationId, organizationId)),
  );
}

function orgAbTestIds(organizationId: number, testId?: number) {
  return db.select({ id: abTests.id }).from(abTests).where(
    testId === undefined
      ? eq(abTests.organizationId, organizationId)
      : and(eq(abTests.id, testId), eq(abTests.organizationId, organizationId)),
  );
}

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

  async updateSequence(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertCampaignSequence>): Promise<CampaignSequence> {
    const [updated] = await db.update(campaignSequences)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(eq(campaignSequences.id, id), eq(campaignSequences.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteSequence(this: DatabaseStorage, organizationId: number, id: number): Promise<void> {
    // Verify sequence belongs to org before deleting child records
    const [seq] = await db.select().from(campaignSequences)
      .where(and(eq(campaignSequences.id, id), eq(campaignSequences.organizationId, organizationId)));
    if (!seq) return;
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seq.id));
    await db.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, seq.id));
    await db.delete(campaignSequences)
      .where(and(eq(campaignSequences.id, id), eq(campaignSequences.organizationId, organizationId)));
  },

  // Sequence Steps
  async getSequenceSteps(this: DatabaseStorage, organizationId: number, sequenceId: number): Promise<SequenceStep[]> {
    return await db.select().from(sequenceSteps)
      .where(and(
        eq(sequenceSteps.sequenceId, sequenceId),
        inArray(sequenceSteps.sequenceId, orgSequenceIds(organizationId, sequenceId)),
      ))
      .orderBy(sequenceSteps.stepNumber);
  },

  async createSequenceStep(this: DatabaseStorage, step: InsertSequenceStep): Promise<SequenceStep> {
    const [newStep] = await db.insert(sequenceSteps).values(step).returning();
    return newStep;
  },

  // 2026-06-10 (T0-2 sweep): optional sequenceId constrains the write to the
  // caller's (already org-checked) sequence so a foreign stepId is a no-op.
  async updateSequenceStep(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertSequenceStep>, sequenceId?: number): Promise<SequenceStep> {
    const conditions = [eq(sequenceSteps.id, id), inArray(sequenceSteps.sequenceId, orgSequenceIds(organizationId))];
    if (sequenceId !== undefined) conditions.push(eq(sequenceSteps.sequenceId, sequenceId));
    const [updated] = await db.update(sequenceSteps)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteSequenceStep(this: DatabaseStorage, organizationId: number, id: number, sequenceId?: number): Promise<void> {
    const conditions = [eq(sequenceSteps.id, id), inArray(sequenceSteps.sequenceId, orgSequenceIds(organizationId))];
    if (sequenceId !== undefined) conditions.push(eq(sequenceSteps.sequenceId, sequenceId));
    await db.delete(sequenceSteps).where(and(...conditions));
  },

  async reorderSequenceSteps(this: DatabaseStorage, organizationId: number, sequenceId: number, stepIds: number[]): Promise<void> {
    for (let i = 0; i < stepIds.length; i++) {
      await db.update(sequenceSteps)
        .set({ stepNumber: i + 1, updatedAt: clock.now() })
        .where(and(
          eq(sequenceSteps.id, stepIds[i]),
          eq(sequenceSteps.sequenceId, sequenceId),
          inArray(sequenceSteps.sequenceId, orgSequenceIds(organizationId, sequenceId)),
        ));
    }
  },

  // Sequence Enrollments
  // sequence_enrollments has no organizationId column — ownership is the
  // parent sequence's. The enrollment reads and updates below constrain that
  // parent to the caller's organization in the same statement;
  // createSequenceEnrollment does not (see the note at the top of this file).
  async getSequenceEnrollment(this: DatabaseStorage, organizationId: number, id: number): Promise<SequenceEnrollment | undefined> {
    const [enrollment] = await db.select().from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.id, id),
        inArray(sequenceEnrollments.sequenceId, orgSequenceIds(organizationId)),
      ));
    return enrollment;
  },

  async getSequenceEnrollments(this: DatabaseStorage, organizationId: number, sequenceId: number): Promise<SequenceEnrollment[]> {
    return await db.select().from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.sequenceId, sequenceId),
        inArray(sequenceEnrollments.sequenceId, orgSequenceIds(organizationId, sequenceId)),
      ))
      .orderBy(desc(sequenceEnrollments.enrolledAt));
  },

  async getLeadEnrollments(this: DatabaseStorage, organizationId: number, leadId: number): Promise<SequenceEnrollment[]> {
    return await db.select().from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.leadId, leadId),
        inArray(sequenceEnrollments.sequenceId, orgSequenceIds(organizationId)),
      ))
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
    const now = clock.now();
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

  async updateSequenceEnrollment(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertSequenceEnrollment>): Promise<SequenceEnrollment> {
    const [updated] = await db.update(sequenceEnrollments)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(
        eq(sequenceEnrollments.id, id),
        inArray(sequenceEnrollments.sequenceId, orgSequenceIds(organizationId)),
      ))
      .returning();
    return updated;
  },

  async pauseEnrollment(this: DatabaseStorage, organizationId: number, id: number, reason: string): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(organizationId, id, { status: "paused", pauseReason: reason });
  },

  async resumeEnrollment(this: DatabaseStorage, organizationId: number, id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(organizationId, id, { status: "active", pauseReason: null });
  },

  async cancelEnrollment(this: DatabaseStorage, organizationId: number, id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(organizationId, id, { status: "cancelled" });
  },

  async completeEnrollment(this: DatabaseStorage, organizationId: number, id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(organizationId, id, { status: "completed", completedAt: clock.now() });
  },

  async getSequenceStats(this: DatabaseStorage, orgId: number): Promise<{ sequenceId: number; name: string; totalEnrollments: number; activeEnrollments: number; completedEnrollments: number }[]> {
    const sequences = await this.getSequences(orgId);
    const stats = [];

    for (const seq of sequences) {
      const enrollments = await this.getSequenceEnrollments(orgId, seq.id);
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

  async getAbTestByCampaign(this: DatabaseStorage, orgId: number, campaignId: number): Promise<AbTest | undefined> {
    const [test] = await db.select().from(abTests)
      .where(and(eq(abTests.campaignId, campaignId), eq(abTests.organizationId, orgId)));
    return test;
  },

  async createAbTest(this: DatabaseStorage, test: InsertAbTest): Promise<AbTest> {
    const [newTest] = await db.insert(abTests).values(test).returning();
    return newTest;
  },

  async updateAbTest(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertAbTest>): Promise<AbTest> {
    const [updated] = await db.update(abTests)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(eq(abTests.id, id), eq(abTests.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteAbTest(this: DatabaseStorage, organizationId: number, id: number): Promise<void> {
    // Verify test belongs to org before deleting child records
    const [test] = await db.select().from(abTests)
      .where(and(eq(abTests.id, id), eq(abTests.organizationId, organizationId)));
    if (!test) return;
    await db.delete(abTestVariants).where(eq(abTestVariants.testId, test.id));
    await db.delete(abTests).where(and(eq(abTests.id, id), eq(abTests.organizationId, organizationId)));
  },

  // A/B Test Variants
  async getAbTestVariants(this: DatabaseStorage, organizationId: number, testId: number): Promise<AbTestVariant[]> {
    return await db.select().from(abTestVariants)
      .where(and(
        eq(abTestVariants.testId, testId),
        inArray(abTestVariants.testId, orgAbTestIds(organizationId, testId)),
      ))
      .orderBy(abTestVariants.id);
  },

  async createAbTestVariant(this: DatabaseStorage, variant: InsertAbTestVariant): Promise<AbTestVariant> {
    const [newVariant] = await db.insert(abTestVariants).values(variant).returning();
    return newVariant;
  },

  async updateAbTestVariant(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertAbTestVariant>): Promise<AbTestVariant> {
    const [updated] = await db.update(abTestVariants)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(eq(abTestVariants.id, id), inArray(abTestVariants.testId, orgAbTestIds(organizationId))))
      .returning();
    return updated;
  },

  async deleteAbTestVariant(this: DatabaseStorage, organizationId: number, id: number): Promise<void> {
    await db.delete(abTestVariants)
      .where(and(eq(abTestVariants.id, id), inArray(abTestVariants.testId, orgAbTestIds(organizationId))));
  },

  async getAbTestWithVariants(this: DatabaseStorage, orgId: number, testId: number): Promise<{ test: AbTest; variants: AbTestVariant[] } | undefined> {
    const test = await this.getAbTest(orgId, testId);
    if (!test) return undefined;
    const variants = await this.getAbTestVariants(orgId, testId);
    return { test, variants };
  },
};

export type SequencesRepo = typeof sequencesRepo;
