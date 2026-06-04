#!/usr/bin/env node
/**
 * Test-borrower seeder for the F3.4 cookie-session E2E suite.
 *
 * Phase D3 (Beatrice). Builds a fully-shaped borrower fixture in a target
 * Postgres so the borrower-cookie-session.spec.ts walk-through has a real
 * (organization, user, lead, note) to authenticate against. The borrower
 * surfaces (the F3.4 `POST /api/borrower/auth/exchange` + the cookie-gated
 * `GET /api/borrower/statements/generate`) need a real `notes` row with a
 * unique `access_token` plus a `leads` row whose email is the borrower's.
 *
 * Idempotent — every row is keyed on a fixed sentinel
 * (`test_borrower_e2e_v1`) so re-running just refreshes the same fixture.
 * Generated credentials land in a gitignored `.test-borrower-credentials.json`
 * file at the repo root; stdout shows only length / masked-email proof per
 * Solene's credential-discipline rule (see MEMORY.md
 * `feedback_credential_value_handling.md`).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/seed-test-borrower.mjs seed
 *   DATABASE_URL=... node scripts/seed-test-borrower.mjs cleanup
 *   DATABASE_URL=... node scripts/seed-test-borrower.mjs status
 *   node scripts/seed-test-borrower.mjs --help
 *
 * Safety:
 *   - NEVER prints the raw accessToken or email to stdout — length-only +
 *     `t***@***.io` mask. The actual values land in the gitignored
 *     credentials file the E2E runner reads.
 *   - Refuses to run against a DATABASE_URL containing common production
 *     markers (`.fly.dev`, `acreos.io`, host suffixes) unless the
 *     `--i-know-this-is-prod` flag is passed. The whole point of this
 *     seeder is to populate a throwaway test DB.
 */

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const SENTINEL = "test_borrower_e2e_v1";
const ORG_NAME = "Test Org for Borrower E2E";
const ORG_SLUG = "test-borrower-e2e";
const CLERK_USER_ID = `test_borrower_e2e_clerk_user`;
const OWNER_EMAIL = "owner.test-borrower-e2e@acreos.test";
const BORROWER_EMAIL = "borrower.test-borrower-e2e@acreos.test";
const CREDENTIALS_FILE = ".test-borrower-credentials.json";

// ────────────────────────────────────────────────────────────────────────────
// CLI dispatch
// ────────────────────────────────────────────────────────────────────────────

const HELP = `seed-test-borrower.mjs — test-borrower fixture for the F3.4 cookie-session E2E

Usage:
  DATABASE_URL=... node scripts/seed-test-borrower.mjs <command> [flags]

Commands:
  seed       Upsert the (org, user, lead, note) fixture. Writes the
             generated (accessToken, email) to .test-borrower-credentials.json
             (gitignored). Re-running refreshes the same sentinel rows.
  cleanup    Delete every row keyed by the test sentinel.
  status     Print whether the fixture exists (length-only / masked output).
  --help     Show this message and exit 0.

Flags:
  --i-know-this-is-prod   Override the prod-host refusal. Required when
                          DATABASE_URL contains .fly.dev / acreos.io etc.

Credential discipline:
  Stdout shows only token length + masked email (e.g. "b***@***.test").
  The actual values are written to ${CREDENTIALS_FILE} which is gitignored
  via .gitignore's .test-* rule.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const cmd = args[0];
  const overrideProd = args.includes("--i-know-this-is-prod");

  if (!process.env.DATABASE_URL) {
    console.error("[seed-test-borrower] DATABASE_URL is required.");
    process.exit(2);
  }
  refuseProdUnlessOverridden(process.env.DATABASE_URL, overrideProd);

  const pg = require("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (cmd === "seed") {
      await cmdSeed(client);
    } else if (cmd === "cleanup") {
      await cmdCleanup(client);
    } else if (cmd === "status") {
      await cmdStatus(client);
    } else {
      console.error(`[seed-test-borrower] unknown command: ${cmd}`);
      process.stdout.write(HELP);
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────────

async function cmdSeed(client) {
  // 1. user — Clerk-id keyed UPSERT (unique on clerk_user_id).
  const { rows: userRows } = await client.query(
    `INSERT INTO users (clerk_user_id, email, first_name, last_name, persona)
       VALUES ($1, $2, 'Test', 'Borrower-Org-Owner', 'land_investor')
     ON CONFLICT (clerk_user_id)
       DO UPDATE SET email = EXCLUDED.email, updated_at = now()
     RETURNING id`,
    [CLERK_USER_ID, OWNER_EMAIL],
  );
  const userId = userRows[0].id;

  // 2. organization — slug-keyed UPSERT.
  const { rows: orgRows } = await client.query(
    `INSERT INTO organizations
       (name, slug, owner_id, onboarding_completed, investor_type)
       VALUES ($1, $2, $3, true, 'notes')
     ON CONFLICT (slug)
       DO UPDATE SET name = EXCLUDED.name, owner_id = EXCLUDED.owner_id
     RETURNING id`,
    [ORG_NAME, ORG_SLUG, userId],
  );
  const orgId = orgRows[0].id;

  // 3. borrower lead — keyed by (organization_id, email). Drop the prior row
  // (if any) and re-insert so the seeder is reset-safe.
  await client.query(
    `DELETE FROM leads WHERE organization_id = $1 AND email = $2`,
    [orgId, BORROWER_EMAIL],
  );
  const { rows: leadRows } = await client.query(
    `INSERT INTO leads
       (organization_id, type, first_name, last_name, email, phone,
        status, source, stage)
       VALUES ($1, 'buyer', 'Testy', 'Borrower', $2, '+15555550199',
               'closed', $3, 'converted')
     RETURNING id`,
    [orgId, BORROWER_EMAIL, SENTINEL],
  );
  const borrowerId = leadRows[0].id;

  // 4. note — drop the prior sentinel-tagged row (matched via the lead) and
  // re-insert with a fresh access token. notes.access_token is UNIQUE; we
  // can't UPSERT-on-token because we want a fresh token each seed cycle.
  await client.query(
    `DELETE FROM notes WHERE organization_id = $1 AND borrower_id = $2`,
    [orgId, borrowerId],
  );
  const accessToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const firstPayment = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const maturity = new Date(now.getTime() + 120 * 30 * 24 * 60 * 60 * 1000);
  const { rows: noteRows } = await client.query(
    `INSERT INTO notes
       (organization_id, borrower_id,
        original_principal, current_balance, interest_rate, term_months,
        monthly_payment, service_fee, late_fee, grace_period_days,
        start_date, first_payment_date, next_payment_date, maturity_date,
        status, access_token)
       VALUES ($1, $2,
               '50000', '49250', '8.5', 120,
               '619.96', '0', '25', 10,
               $3, $4, $4, $5,
               'active', $6)
     RETURNING id`,
    [orgId, borrowerId, now, firstPayment, maturity, accessToken],
  );
  const noteId = noteRows[0].id;

  // 5. lifecycle_events — one synthetic activation event so the row exists
  // and downstream tests/cohorts have something to read. The sentinel is
  // tucked into metadata for unambiguous cleanup.
  await client.query(
    `DELETE FROM lifecycle_events
       WHERE organization_id = $1
         AND event_type = 'borrower.test_seed'`,
    [orgId],
  );
  await client.query(
    `INSERT INTO lifecycle_events
       (organization_id, user_id, event_type, stage, metadata,
        source_table, source_id)
       VALUES ($1, $2, 'borrower.test_seed', 'activation',
               $3::jsonb, 'notes', $4)`,
    [
      orgId,
      userId,
      JSON.stringify({ sentinel: SENTINEL, noteId, source: "seed-test-borrower" }),
      String(noteId),
    ],
  );

  // 6. Persist credentials to the gitignored side-channel file.
  const credsPath = await writeCredentialsFile({
    accessToken,
    email: BORROWER_EMAIL,
    organizationId: orgId,
    userId,
    borrowerLeadId: borrowerId,
    noteId,
    sentinel: SENTINEL,
    seededAt: new Date().toISOString(),
  });

  // 7. Safe stdout — length + mask only.
  console.log("[seed-test-borrower] seeded fixture:");
  console.log(`  organization_id = ${orgId}`);
  console.log(`  user_id         = ${userId}`);
  console.log(`  lead_id         = ${borrowerId}`);
  console.log(`  note_id         = ${noteId}`);
  console.log(`  accessToken     = <length ${accessToken.length} hex>`);
  console.log(`  email           = ${maskEmail(BORROWER_EMAIL)}`);
  console.log(`  credentials     = ${path.relative(process.cwd(), credsPath)}`);
  console.log("(actual values written to gitignored credentials file)");
}

async function cmdCleanup(client) {
  // Resolve org first so we cascade against a single id.
  const { rows: orgRows } = await client.query(
    `SELECT id FROM organizations WHERE slug = $1`,
    [ORG_SLUG],
  );
  if (orgRows.length === 0) {
    console.log("[seed-test-borrower] cleanup: no fixture to remove.");
  } else {
    const orgId = orgRows[0].id;
    // notes → leads → lifecycle → org → user. Deleting the org cascades to
    // notes + leads via ON DELETE CASCADE (see notes.organization_id +
    // leads.organization_id schemas), but the user is shared infra so we
    // only drop the dedicated test user explicitly.
    await client.query(`DELETE FROM lifecycle_events WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    console.log(`[seed-test-borrower] cleanup: dropped org_id=${orgId} (cascade).`);
  }
  await client.query(`DELETE FROM users WHERE clerk_user_id = $1`, [CLERK_USER_ID]);

  // Wipe the gitignored credentials file too.
  const credsPath = path.resolve(repoRoot(), CREDENTIALS_FILE);
  try {
    await fs.unlink(credsPath);
    console.log(`[seed-test-borrower] removed ${CREDENTIALS_FILE}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function cmdStatus(client) {
  const { rows: orgRows } = await client.query(
    `SELECT id FROM organizations WHERE slug = $1`,
    [ORG_SLUG],
  );
  if (orgRows.length === 0) {
    console.log("[seed-test-borrower] status: no fixture present.");
    return;
  }
  const orgId = orgRows[0].id;
  const { rows: leadRows } = await client.query(
    `SELECT id FROM leads WHERE organization_id = $1 AND email = $2`,
    [orgId, BORROWER_EMAIL],
  );
  const { rows: noteRows } = await client.query(
    `SELECT id, access_token FROM notes WHERE organization_id = $1 LIMIT 1`,
    [orgId],
  );
  console.log("[seed-test-borrower] status:");
  console.log(`  organization_id = ${orgId}`);
  console.log(`  lead_present    = ${leadRows.length > 0}`);
  console.log(`  note_present    = ${noteRows.length > 0}`);
  if (noteRows.length > 0) {
    const tok = noteRows[0].access_token || "";
    console.log(`  accessToken     = <length ${tok.length} hex>`);
    console.log(`  email           = ${maskEmail(BORROWER_EMAIL)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function repoRoot() {
  // scripts/seed-test-borrower.mjs → ../
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function writeCredentialsFile(payload) {
  const credsPath = path.resolve(repoRoot(), CREDENTIALS_FILE);
  await fs.writeFile(
    credsPath,
    JSON.stringify(payload, null, 2) + "\n",
    { mode: 0o600 },
  );
  return credsPath;
}

function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  const firstChar = local[0] ?? "x";
  const tld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  return `${firstChar}***@***${tld}`;
}

function refuseProdUnlessOverridden(url, override) {
  const lower = url.toLowerCase();
  const looksProd =
    lower.includes(".fly.dev") ||
    lower.includes("acreos.io") ||
    lower.includes("supabase.co") ||
    lower.includes("amazonaws.com");
  if (looksProd && !override) {
    console.error(
      "[seed-test-borrower] DATABASE_URL looks like a production host. " +
        "Refusing to run. Pass --i-know-this-is-prod to override.",
    );
    process.exit(3);
  }
}

main().catch((err) => {
  console.error("[seed-test-borrower] failed:", err.message);
  process.exit(1);
});
