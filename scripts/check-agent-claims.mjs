#!/usr/bin/env node
// ============================================================================
// scripts/check-agent-claims.mjs
// ----------------------------------------------------------------------------
// Pre-commit hook helper for Layer 1 capability #2 (cross-agent coordination).
//
// Reads a list of file paths on stdin (one per line) and exits:
//
//   0 — no staged file falls under another agent's active claim
//       (or DB is unreachable; fail-open per the operating constraint)
//   1 — at least one staged file is under another agent's active claim
//
// On exit 1, prints a human-readable block to stderr naming the
// conflicting agent_role + dispatch_id so the developer or agent can
// coordinate before retrying.
//
// HONEST CONSTRAINT: fails OPEN when DATABASE_URL is missing or the DB is
// unreachable. The hook lives in shell + can't gate on a network round-trip
// during local dev when the dev DB is down. The dispatch-time predictor
// (predictDispatchConflicts) is the upstream gate; the pre-commit hook is
// the last line, not the first.
//
// To bypass intentionally (founder emergency / Solene-override commit):
//   SOLENE_BYPASS_AGENT_CLAIMS=1 git commit ...
//
// The shell hook checks SOLENE_BYPASS_AGENT_CLAIMS before invoking this
// script, so this script never needs to honour the env directly — but we
// honour it anyway as a defense-in-depth no-op.
// ============================================================================

import pg from "pg";
import { readFileSync } from "node:fs";
import { minimatch } from "minimatch";

// ── Bypass env (defense-in-depth — hook already checks this) ──
if (process.env.SOLENE_BYPASS_AGENT_CLAIMS === "1") {
  process.exit(0);
}

// ── Read staged files from stdin (one per line) ──
let raw = "";
try {
  raw = readFileSync(0, "utf-8");
} catch {
  // No stdin → nothing to check.
  process.exit(0);
}
const stagedFiles = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

if (stagedFiles.length === 0) {
  process.exit(0);
}

// ── Optional: own claim id (the commit author's claim, to exclude) ──
const ownClaimId = process.env.SOLENE_OWN_CLAIM_ID
  ? parseInt(process.env.SOLENE_OWN_CLAIM_ID, 10)
  : null;

// ── DB connection — fail-open on missing DATABASE_URL ──
if (!process.env.DATABASE_URL) {
  console.warn(
    "[check-agent-claims] DATABASE_URL not set — skipping cross-agent claim check (fail-open).",
  );
  process.exit(0);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  // Tight connection timeout so a down DB doesn't hang `git commit`.
  connectionTimeoutMillis: 3000,
  query_timeout: 3000,
  statement_timeout: 3000,
});

let activeClaims = [];
try {
  // First, expire stale rows so we don't block on a TTL'd claim.
  await pool.query(
    `UPDATE solene_agent_claims
       SET claim_status = 'expired', released_at = now()
       WHERE claim_status = 'active'
         AND (claimed_at + (ttl_minutes || ' minutes')::interval) < now()`,
  );

  const result = await pool.query(
    `SELECT id, dispatch_id, agent_role, claimed_at, ttl_minutes, file_surface_patterns
       FROM solene_agent_claims
       WHERE claim_status = 'active'
         ${ownClaimId ? "AND id <> $1" : ""}`,
    ownClaimId ? [ownClaimId] : [],
  );
  activeClaims = result.rows;
} catch (err) {
  console.warn(
    `[check-agent-claims] DB query failed — fail-open (cross-agent check skipped): ${err.message}`,
  );
  await pool.end().catch(() => {});
  process.exit(0);
} finally {
  // Pool may already be ended if we hit the catch above.
}

await pool.end().catch(() => {});

if (activeClaims.length === 0) {
  process.exit(0);
}

// ── Walk staged files against every active claim's patterns ──
const conflicts = [];
for (const file of stagedFiles) {
  for (const claim of activeClaims) {
    const patterns = claim.file_surface_patterns ?? [];
    for (const pattern of patterns) {
      let matched = false;
      try {
        matched = minimatch(file, pattern, { dot: true });
      } catch {
        matched = false;
      }
      if (matched) {
        conflicts.push({
          file,
          claimId: claim.id,
          dispatchId: claim.dispatch_id,
          agentRole: claim.agent_role,
          pattern,
          claimedAt: claim.claimed_at,
        });
        break;
      }
    }
  }
}

if (conflicts.length === 0) {
  process.exit(0);
}

// ── Block the commit + print a readable message ──
console.error("");
console.error("  ⚠ Cross-agent claim conflict detected:");
console.error("  ──────────────────────────────────────");
for (const c of conflicts) {
  const dispatch = c.dispatchId === null ? "(no dispatch_id)" : `dispatch ${c.dispatchId}`;
  console.error(
    `  - ${c.file}\n      claimed by ${c.agentRole} ${dispatch} via pattern ${c.pattern}`,
  );
}
console.error("  ──────────────────────────────────────");
console.error("  This file is under another agent's active claim.");
console.error("  Coordinate before committing — release the other claim,");
console.error("  wait for it to expire, or:");
console.error("  SOLENE_BYPASS_AGENT_CLAIMS=1 git commit ...   (use sparingly)");
console.error("");
process.exit(1);
