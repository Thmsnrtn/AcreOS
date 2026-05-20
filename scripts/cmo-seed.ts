#!/usr/bin/env tsx
/**
 * Seed CMO engine state — brand profile + hook archetypes + budget defaults.
 *
 * Safe to re-run: every seeder upserts on natural keys (slug). Used by
 * deploys (alongside scripts/migrate.mjs) and one-off manual runs.
 *
 * Usage: npm run cmo:seed
 */

import { seedAcreosBrandProfile } from "../server/services/cmo/brandProfiles";
import { seedHookArchetypes } from "../server/services/cmo/archetypes";

async function main() {
  console.log("[cmo:seed] seeding hook archetypes…");
  await seedHookArchetypes();
  console.log("[cmo:seed] seeding AcreOS brand profile + budget…");
  const profile = await seedAcreosBrandProfile();
  console.log(`[cmo:seed] done. profile id=${profile.id} slug=${profile.slug}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[cmo:seed] FATAL:", err);
  process.exit(1);
});
