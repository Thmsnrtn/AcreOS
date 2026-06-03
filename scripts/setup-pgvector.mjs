#!/usr/bin/env node
// ============================================================================
// SCRIPTS/SETUP-PGVECTOR.MJS
// ----------------------------------------------------------------------------
// Operator one-shot — verify or install pgvector on a freshly-provisioned
// Postgres.
//
// Usage:
//   DATABASE_URL=... node scripts/setup-pgvector.mjs verify
//   DATABASE_URL=... node scripts/setup-pgvector.mjs install
//
// `verify`  — checks pg_extension for `vector`. Exits 0 if present, 1 if not.
// `install` — runs `CREATE EXTENSION IF NOT EXISTS vector` then re-verifies.
//
// Both modes are idempotent and safe to re-run.
//
// This is intentionally self-contained — no project imports — so it can
// be run against a brand-new DB before `npm install` has resolved any of
// the workspace's drizzle/schema chain.
// ============================================================================

import pg from "pg";

const MODE = process.argv[2];

if (!MODE || (MODE !== "verify" && MODE !== "install")) {
  console.error("Usage: node scripts/setup-pgvector.mjs <verify|install>");
  process.exit(2);
}

if (!process.env.DATABASE_URL) {
  console.error("[setup-pgvector] DATABASE_URL not set — aborting");
  process.exit(2);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
});

async function checkExtensionInstalled() {
  const res = await pool.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1",
  );
  if (res.rows.length === 0) {
    return { installed: false, version: null };
  }
  return { installed: true, version: res.rows[0].extversion ?? null };
}

async function runInstall() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
}

let exitCode = 0;

try {
  if (MODE === "install") {
    console.log("[setup-pgvector] running CREATE EXTENSION IF NOT EXISTS vector …");
    try {
      await runInstall();
    } catch (err) {
      console.error(`[setup-pgvector] CREATE EXTENSION failed: ${err.message}`);
      console.error(
        "[setup-pgvector] On managed Postgres this may require admin/superuser " +
          "credentials, or the extension may need to be enabled via the provider " +
          "console first (Fly: `fly pg connect` then `CREATE EXTENSION vector;` as " +
          "the postgres superuser).",
      );
      exitCode = 1;
    }
  }

  // verify path runs for both modes
  const { installed, version } = await checkExtensionInstalled();
  if (installed) {
    console.log(
      `[setup-pgvector] pgvector OK — extversion=${version ?? "unknown"}`,
    );
    if (exitCode === 0) exitCode = 0;
  } else {
    console.error(
      "[setup-pgvector] pgvector NOT installed. " +
        (MODE === "verify"
          ? "Re-run with `install` to attempt CREATE EXTENSION."
          : "CREATE EXTENSION ran but extension is still absent — check provider perms."),
    );
    exitCode = 1;
  }
} finally {
  await pool.end().catch(() => {});
}

process.exit(exitCode);
