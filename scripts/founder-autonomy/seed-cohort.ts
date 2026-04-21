#!/usr/bin/env tsx
/**
 * Founder-autonomy testing cohort — 25 deliberately varied orgs
 *
 * Creates a predictable, reproducible customer-org cohort so the
 * autonomous executor + founder decision UI have representative state
 * to run over pre-launch.
 *
 * Variance dimensions: 5 tiers × 5 lifecycle stages = 25 orgs.
 *   Tiers:     free, starter, pro, scale, enterprise
 *   Lifecycle: new, onboarding, active, at_risk, churning
 *
 * Every row is tagged with settings.simulationMode=true and its slug
 * carries the "sim-" prefix so the reset script can clean up precisely
 * without touching real customer data.
 *
 * Safety requirements:
 *   1. SIMULATION_MODE=true must be set (belt-and-suspenders — the
 *      kill-switch should prevent real side effects, but we refuse to
 *      run without it as insurance).
 *   2. All owner IDs start with "sim-owner-" so there's no chance of
 *      attaching the cohort to a real Clerk user.
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/founder-autonomy/seed-cohort.ts
 *
 * Re-running is idempotent: existing sim-* orgs are updated rather
 * than duplicated. Pair with `reset-cohort.ts` for a full wipe.
 */

import { db } from "../../server/db";
import { organizations, leads, properties, deals, teamMembers } from "../../shared/schema";
import { eq, like } from "drizzle-orm";
import { requireSimulationMode } from "../../server/utils/simulationMode";

type Tier = "free" | "starter" | "pro" | "scale" | "enterprise";
type Lifecycle = "new" | "onboarding" | "active" | "at_risk" | "churning";

const TIERS: Tier[] = ["free", "starter", "pro", "scale", "enterprise"];
const LIFECYCLES: Lifecycle[] = ["new", "onboarding", "active", "at_risk", "churning"];

// 8 states matching a realistic land-investor distribution.
const STATES = ["AZ", "TX", "FL", "CA", "OK", "NM", "CO", "MT"];

// How many leads / properties / deals each lifecycle gets. Kept modest
// so the cohort is cheap to seed and wipe — the scenario scripts inject
// the dramatic state (dunning, churn risk, anomalies) on top.
const LIFECYCLE_SHAPE: Record<
  Lifecycle,
  { leads: number; properties: number; deals: number; ageDays: number }
> = {
  new: { leads: 2, properties: 0, deals: 0, ageDays: 3 },
  onboarding: { leads: 6, properties: 2, deals: 0, ageDays: 14 },
  active: { leads: 18, properties: 6, deals: 2, ageDays: 90 },
  at_risk: { leads: 24, properties: 10, deals: 3, ageDays: 180 },
  churning: { leads: 12, properties: 8, deals: 2, ageDays: 270 },
};

function slugFor(tier: Tier, lifecycle: Lifecycle, idx: number): string {
  return `sim-${tier}-${lifecycle}-${String(idx).padStart(2, "0")}`;
}

function nameFor(tier: Tier, lifecycle: Lifecycle, idx: number): string {
  const label = {
    new: "Fresh Signup",
    onboarding: "Still Onboarding",
    active: "Active Customer",
    at_risk: "At Risk",
    churning: "Churning",
  }[lifecycle];
  const tierPretty = tier.charAt(0).toUpperCase() + tier.slice(1);
  return `[SIM] ${tierPretty} ${label} #${idx}`;
}

function createdAtFor(ageDays: number): Date {
  return new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
}

function randomFromList<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

async function ensureOrg(
  tier: Tier,
  lifecycle: Lifecycle,
  idx: number
): Promise<{ id: number; created: boolean }> {
  const slug = slugFor(tier, lifecycle, idx);
  const ownerId = `sim-owner-${slug}`;
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (existing) {
    // Update the lifecycle-specific metadata in place so re-seeding
    // keeps the cohort current without duplicating rows.
    await db
      .update(organizations)
      .set({
        subscriptionTier: tier,
        subscriptionStatus: lifecycle === "churning" ? "past_due" : "active",
        dunningStage:
          lifecycle === "churning"
            ? "warning"
            : lifecycle === "at_risk"
              ? "grace_period"
              : "none",
        settings: {
          simulationMode: true,
          timezone: "America/New_York",
          currency: "USD",
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, existing.id));
    return { id: existing.id, created: false };
  }

  const shape = LIFECYCLE_SHAPE[lifecycle];
  const [row] = await db
    .insert(organizations)
    .values({
      name: nameFor(tier, lifecycle, idx),
      slug,
      ownerId,
      subscriptionTier: tier,
      subscriptionStatus: lifecycle === "churning" ? "past_due" : "active",
      dunningStage:
        lifecycle === "churning"
          ? "warning"
          : lifecycle === "at_risk"
            ? "grace_period"
            : "none",
      settings: {
        simulationMode: true,
        timezone: "America/New_York",
        currency: "USD",
      },
      trialStartedAt: createdAtFor(shape.ageDays),
      trialEndsAt:
        lifecycle === "new"
          ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          : createdAtFor(shape.ageDays - 14),
      createdAt: createdAtFor(shape.ageDays),
      updatedAt: new Date(),
    })
    .returning();

  // Owner team-member row so org permissions work.
  await db.insert(teamMembers).values({
    organizationId: row.id,
    userId: ownerId,
    email: `${ownerId}@sim.acreos.io`,
    displayName: `Sim Owner ${slug}`,
    role: "owner",
    isActive: true,
    joinedAt: createdAtFor(shape.ageDays),
  });

  return { id: row.id, created: true };
}

async function seedLeads(orgId: number, count: number, ageDays: number): Promise<number> {
  if (count === 0) return 0;
  const rows = Array.from({ length: count }).map((_, i) => {
    const state = randomFromList(STATES);
    const statusPool = ["new", "contacting", "warm", "cold", "negotiation", "closed", "dead"] as const;
    return {
      organizationId: orgId,
      type: "seller" as const,
      firstName: `Sim${String(i + 1).padStart(3, "0")}`,
      lastName: `Lead-${orgId}`,
      email: `sim-lead-${orgId}-${i + 1}@sim.acreos.io`,
      phone: `+1555${String(1000000 + orgId * 1000 + i).slice(-7)}`,
      address: `${100 + i} Sim Rd`,
      city: "Simville",
      state,
      zip: String(85000 + i).padStart(5, "0"),
      source: randomFromList(["tax_list", "direct_mail", "cold_call", "referral", "manual"]),
      status: randomFromList(statusPool),
      createdAt: createdAtFor(ageDays),
      updatedAt: new Date(),
    };
  });
  // Drizzle can insert many at once.
  const inserted = await db.insert(leads).values(rows).returning({ id: leads.id });
  return inserted.length;
}

async function seedProperties(orgId: number, count: number, ageDays: number): Promise<number> {
  if (count === 0) return 0;
  const rows = Array.from({ length: count }).map((_, i) => {
    const state = randomFromList(STATES);
    const sizeAcres = Math.round((1 + Math.random() * 40) * 100) / 100;
    return {
      organizationId: orgId,
      apn: `SIM-${orgId}-${String(i + 1).padStart(4, "0")}`,
      address: `${200 + i} Sim Parcel Rd`,
      city: "Simville",
      state,
      zip: String(85000 + i).padStart(5, "0"),
      county: `Sim County`,
      sizeAcres: String(sizeAcres),
      estimatedValue: String(5000 + Math.floor(Math.random() * 80000)),
      status: randomFromList(["prospect", "under_contract", "owned", "listed", "sold"]),
      createdAt: createdAtFor(ageDays),
      updatedAt: new Date(),
    };
  });
  const inserted = await db.insert(properties).values(rows).returning({ id: properties.id });
  return inserted.length;
}

async function seedDeals(orgId: number, propIds: number[], count: number, ageDays: number): Promise<number> {
  if (count === 0 || propIds.length === 0) return 0;
  const rows = Array.from({ length: Math.min(count, propIds.length) }).map((_, i) => ({
    organizationId: orgId,
    propertyId: propIds[i],
    type: "acquisition" as const,
    status: randomFromList(["prospecting", "offer_sent", "negotiating", "under_contract", "closed", "lost"]),
    offerAmount: String(1000 + Math.floor(Math.random() * 50000)),
    createdAt: createdAtFor(ageDays),
    updatedAt: new Date(),
  }));
  const inserted = await db.insert(deals).values(rows).returning({ id: deals.id });
  return inserted.length;
}

async function main() {
  requireSimulationMode();
  console.log("[seed-cohort] SIMULATION_MODE verified ✓");

  let created = 0;
  let updated = 0;
  let totalLeads = 0;
  let totalProperties = 0;
  let totalDeals = 0;

  for (const tier of TIERS) {
    for (const lifecycle of LIFECYCLES) {
      const idx = TIERS.indexOf(tier) * 5 + LIFECYCLES.indexOf(lifecycle) + 1;
      const { id, created: wasCreated } = await ensureOrg(tier, lifecycle, idx);
      if (wasCreated) created++;
      else updated++;

      // Only seed baseline child rows on first creation — re-running
      // shouldn't double up leads/properties/deals.
      if (wasCreated) {
        const shape = LIFECYCLE_SHAPE[lifecycle];
        const leadCount = await seedLeads(id, shape.leads, shape.ageDays);
        const propCount = await seedProperties(id, shape.properties, shape.ageDays);
        const propIds = (
          await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, id))
        ).map((p) => p.id);
        const dealCount = await seedDeals(id, propIds, shape.deals, shape.ageDays);
        totalLeads += leadCount;
        totalProperties += propCount;
        totalDeals += dealCount;
      }

      console.log(
        `  ${wasCreated ? "+ created" : "= updated"} ${slugFor(tier, lifecycle, idx)} (org #${id})`
      );
    }
  }

  console.log("\n[seed-cohort] done");
  console.log(`  orgs created: ${created}`);
  console.log(`  orgs updated: ${updated}`);
  console.log(`  leads seeded: ${totalLeads}`);
  console.log(`  properties seeded: ${totalProperties}`);
  console.log(`  deals seeded: ${totalDeals}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
