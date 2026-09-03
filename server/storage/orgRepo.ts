// Organizations + trial-token domain repo.
// Extracted from the god-class server/storage.ts in the storage refactor.
// Methods are merged into DatabaseStorage.prototype at construction time;
// `this` therefore refers to the full DatabaseStorage instance and may
// call methods from any sibling repo.

import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, type Organization, type InsertOrganization } from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { logger } from "../utils/logger";

export const orgRepo = {
  async getOrganization(this: DatabaseStorage, id: number): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  },

  async getOrganizationBySlug(this: DatabaseStorage, slug: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org;
  },

  async getOrganizationByOwner(this: DatabaseStorage, ownerId: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerId, ownerId));
    return org;
  },

  async getOrganizationByStripeCustomerId(this: DatabaseStorage, customerId: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.stripeCustomerId, customerId));
    return org;
  },

  async createOrganization(this: DatabaseStorage, org: InsertOrganization): Promise<Organization> {
    const [newOrg] = await db.insert(organizations).values(org).returning();
    // Phase 3 Week 14 — Activation telemetry. Idempotent on
    // (orgId, eventName) so safe even if getOrCreateOrg also fires it.
    if (newOrg) {
      import("../services/activation")
        .then(({ recordActivationEventAsync }) =>
          recordActivationEventAsync({
            orgId: newOrg.id,
            userId: (org as any)?.ownerId ?? null,
            eventName: "org_created",
            eventValue: { source: "storage.createOrganization" },
          }),
        )
        .catch(() => { /* non-fatal */ });
    }
    // Fire-and-forget: start Sophie's 30-day onboarding journey for
    // real (non-simulated) orgs. Sim orgs opt out to keep test state
    // clean.
    if (newOrg && !org?.settings?.simulationMode) {
      import("../services/onboardingAutonomy")
        .then(({ startJourney }) => startJourney(newOrg.id))
        .catch((err) =>
          logger.warn(`[onboarding] startJourney failed for org ${newOrg.id}: ${err?.message ?? err}`),
        );
    }
    // Lavender §1 / Hilda §2 — every org gets a default 15-account chart
    // of accounts so the monthly-close pipeline (recognition worker,
    // trial-balance, GL-PDF — Week 10) has a non-empty target. Seed is
    // idempotent so retries / re-imports are safe. Fire-and-forget; an
    // org without a chart degrades gracefully (Week 10 reports show
    // empty) but should never block org creation.
    if (newOrg) {
      import("../services/chartOfAccountsSeed")
        .then(({ seedChartOfAccountsForOrg }) => seedChartOfAccountsForOrg(newOrg.id))
        .catch((err) =>
          logger.warn(`[chartOfAccountsSeed] failed for org ${newOrg.id}: ${err?.message ?? err}`),
        );
    }
    return newOrg;
  },

  async updateOrganization(this: DatabaseStorage, id: number, updates: Partial<InsertOrganization>): Promise<Organization> {
    const [updated] = await db.update(organizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return updated;
  },

  async getTrialTokens(this: DatabaseStorage, orgId: number): Promise<number> {
    const org = await this.getOrganization(orgId);
    if (!org) return 0;
    return org.trialTokens ?? 0;
  },

  async consumeTrialToken(this: DatabaseStorage, orgId: number): Promise<{ success: boolean; remaining: number }> {
    // Atomic decrement with check - prevents race conditions
    const result = await db.execute(sql`
      UPDATE organizations
      SET trial_tokens = trial_tokens - 1, updated_at = NOW()
      WHERE id = ${orgId} AND trial_tokens > 0
      RETURNING trial_tokens
    `);

    if (result.rowCount === 0) {
      // No rows updated - either org doesn't exist or no tokens available
      const org = await this.getOrganization(orgId);
      return { success: false, remaining: org?.trialTokens ?? 0 };
    }

    const newTokens = (result.rows[0] as any).trial_tokens ?? 0;
    return { success: true, remaining: newTokens };
  },
};

export type OrgRepo = typeof orgRepo;
