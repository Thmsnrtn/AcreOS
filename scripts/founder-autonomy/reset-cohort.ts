#!/usr/bin/env tsx
/**
 * Wipe every sim-* org and its cascaded data. Refuses to run without
 * SIMULATION_MODE=true so there's no chance of nuking real orgs.
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/founder-autonomy/reset-cohort.ts
 *
 * Safety checks:
 *   1. SIMULATION_MODE must be true
 *   2. Each org's slug must start with "sim-"
 *   3. Each org's settings.simulationMode must equal true
 *
 * The cascade is provided by the schema's ON DELETE CASCADE on the
 * child tables that use organizationId.
 */

import { db } from "../../server/db";
import {
  organizations,
  decisionsInboxItems,
  leads,
  properties,
  deals,
  teamMembers,
  supportTickets,
  systemAlerts,
  churnRiskScores,
  notes,
  simulatedActions,
} from "../../shared/schema";
import { like, eq, inArray, sql } from "drizzle-orm";
import { requireSimulationMode, isOrgSimulated } from "../../server/utils/simulationMode";

async function main() {
  requireSimulationMode();
  console.log("[reset-cohort] SIMULATION_MODE verified ✓");

  const rows = await db.select().from(organizations).where(like(organizations.slug, "sim-%"));
  console.log(`[reset-cohort] found ${rows.length} sim orgs`);

  let deleted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!isOrgSimulated(row)) {
      console.warn(
        `  SKIP ${row.slug} (id ${row.id}) — settings.simulationMode is not true`
      );
      skipped++;
      continue;
    }
    // Explicit child-table cleanup in dependency order. Some tables
    // (notably deals) reference organizations without ON DELETE CASCADE
    // so we have to delete bottom-up before we can drop the org row.
    await db.delete(decisionsInboxItems).where(eq(decisionsInboxItems.organizationId, row.id));
    await db.delete(supportTickets).where(eq(supportTickets.organizationId, row.id));
    await db.delete(systemAlerts).where(eq(systemAlerts.organizationId, row.id));
    await db.delete(churnRiskScores).where(eq(churnRiskScores.organizationId, row.id));
    await db.delete(notes).where(eq(notes.organizationId, row.id));
    await db.delete(deals).where(eq(deals.organizationId, row.id));
    await db.delete(properties).where(eq(properties.organizationId, row.id));
    await db.delete(leads).where(eq(leads.organizationId, row.id));
    await db.delete(teamMembers).where(eq(teamMembers.organizationId, row.id));
    await db.delete(simulatedActions).where(eq(simulatedActions.organizationId, row.id));
    await db.delete(organizations).where(eq(organizations.id, row.id));
    deleted++;
    console.log(`  deleted ${row.slug} (id ${row.id})`);
  }

  // Also clear any orphan decisionsInboxItems rows tagged by the
  // harness (scenarios stamp contextBundle.seededBy = 'founder-autonomy-harness').
  // Narrow via that tag so real decision rows are never touched.
  const purgedOrphans = await db
    .delete(decisionsInboxItems)
    .where(sql`${decisionsInboxItems.contextBundle}->>'seededBy' = 'founder-autonomy-harness'`)
    .returning({ id: decisionsInboxItems.id });
  console.log(`[reset-cohort] purged ${purgedOrphans.length} residual harness-tagged decision rows`);

  console.log(`\n[reset-cohort] done`);
  console.log(`  orgs deleted: ${deleted}`);
  console.log(`  orgs skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
