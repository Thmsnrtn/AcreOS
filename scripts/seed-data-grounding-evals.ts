#!/usr/bin/env tsx
/**
 * Andrei (2026-06-06) — seed the data-grounding eval cases into ai_test_cases.
 *
 * Idempotent upsert keyed on the stable case id, so re-running it after editing
 * server/ai/dataGroundingEvalCases.ts brings the DB in sync. The DB-backed eval
 * harness (server/services/aiEvalHarness.ts) reads these rows for
 * surface=pax_inbox; the critical-severity rows form the gateOutputOrThrow gate.
 *
 * Run inside a fly ssh console (DATABASE_URL available):
 *   npx tsx scripts/seed-data-grounding-evals.ts
 *
 * The same rows are also expressed as a raw SQL migration
 * (migrations/0122_data_grounding_eval_cases.sql) so deployed DBs get them
 * through the standard migrate path; this script is the dev/local convenience
 * and the canonical re-sync tool.
 */
import { db } from "../server/db";
import { aiTestCases } from "../shared/schema";
import { toAiTestCaseRows } from "../server/ai/dataGroundingEvalCases";

async function main() {
  const rows = toAiTestCaseRows();
  let upserted = 0;
  for (const row of rows) {
    await db
      .insert(aiTestCases)
      .values({
        id: row.id,
        surface: row.surface,
        name: row.name,
        description: row.description,
        inputPrompt: row.inputPrompt,
        expectedTraits: row.expectedTraits,
        forbiddenTraits: row.forbiddenTraits,
        severity: row.severity,
        isActive: row.isActive,
      })
      .onConflictDoUpdate({
        target: aiTestCases.id,
        set: {
          surface: row.surface,
          name: row.name,
          description: row.description,
          inputPrompt: row.inputPrompt,
          expectedTraits: row.expectedTraits,
          forbiddenTraits: row.forbiddenTraits,
          severity: row.severity,
          isActive: row.isActive,
          updatedAt: new Date(),
        },
      });
    upserted++;
  }
  console.log(`[seed-data-grounding-evals] upserted ${upserted} ai_test_cases (surface=pax_inbox)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-data-grounding-evals] failed:", err);
  process.exit(1);
});
