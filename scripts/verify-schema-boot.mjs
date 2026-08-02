/**
 * Boot-and-SELECT schema verifier.
 *
 * Runs against a database that has just had the migration path applied (in CI:
 * a clean pgvector container). It asserts that EVERY pgTable declared in the
 * code exists as a real table in the database — i.e. that the migration path
 * actually creates the whole schema. This is the check that would have caught
 * the 95 "declared but never created" orphan tables and the users-table drift.
 *
 * Usage (CI): DATABASE_URL=... node scripts/verify-schema-boot.mjs
 * Exit 0 = every declared table exists; 1 = orphan(s); 2 = misuse.
 *
 * The name-extraction helpers are exported and pure so they can be unit-tested
 * without a database (tests/unit/verifySchemaBoot.test.ts).
 */
import { readFileSync } from "node:fs";
import { discoverSchemaFiles } from "./schema-files.mjs";

/** Extract the SQL table names from a schema source file. */
export function extractPgTableNames(src) {
  const names = new Set();
  const re = /pgTable\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

/** Every SQL table name declared across the canonical schema files. */
export function declaredTableNames() {
  const all = new Set();
  for (const file of discoverSchemaFiles()) {
    for (const name of extractPgTableNames(readFileSync(file, "utf8"))) all.add(name);
  }
  return all;
}

/** Compare declared names against a set of live table names; return the missing ones sorted. */
export function missingTables(declared, liveNames) {
  const live = liveNames instanceof Set ? liveNames : new Set(liveNames);
  return [...declared].filter((t) => !live.has(t)).sort();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[verify-schema-boot] DATABASE_URL is required.");
    process.exit(2);
  }
  const declared = declaredTableNames();

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let liveNames;
  try {
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    liveNames = new Set(rows.map((r) => r.table_name));
  } finally {
    await client.end();
  }

  const missing = missingTables(declared, liveNames);
  console.log(
    `[verify-schema-boot] declared=${declared.size} live=${liveNames.size} missing=${missing.length}`,
  );
  if (missing.length > 0) {
    console.error("[verify-schema-boot] Tables declared in code but ABSENT from the migrated database:");
    for (const t of missing) console.error(`  - ${t}`);
    console.error(
      "[verify-schema-boot] FAIL — the migration path did not create the full schema. " +
        "A fresh environment (staging / DR) would 500 on the first SELECT against these.",
    );
    process.exit(1);
  }
  console.log("[verify-schema-boot] PASS — every declared table exists in the database.");
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[verify-schema-boot] error:", err);
    process.exit(1);
  });
}
