#!/usr/bin/env node
// Release-command schema patch. Applies idempotent ALTER TABLE IF NOT EXISTS
// statements to catch schema drift (columns added to shared/schema.ts that
// never got a proper Drizzle migration file). All statements are safe to
// re-run — they no-op when columns already exist. We deliberately avoid
// drizzle-orm's migrator here because the local _journal.json is out of
// sync with what's actually been applied to prod (many migration files
// live outside the journal), and running a migrator against drifted state
// risks re-applying already-applied migrations.

import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL not set — aborting");
  process.exit(1);
}

const STATEMENTS = [
  // notes: columns that never got a proper Drizzle migration applied in prod.
  // All idempotent — re-running is a no-op.
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "owning_entity" text',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_by" text',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1',
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let exitCode = 0;

try {
  for (const stmt of STATEMENTS) {
    try {
      await pool.query(stmt);
      console.log(`[migrate] OK: ${stmt}`);
    } catch (err) {
      console.error(`[migrate] FAILED: ${stmt}\n  ${err.message}`);
      exitCode = 1;
    }
  }
} finally {
  await pool.end().catch(() => {});
}

process.exit(exitCode);
