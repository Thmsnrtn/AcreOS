/**
 * Global setup for the mobile E2E suite.
 *
 * Runs once before the suite. Pushes the Drizzle schema to the (CI or local)
 * Postgres in DATABASE_URL and seeds a single test user + org so the
 * test-auth bypass (server/auth/testAuth.ts) resolves to a real, onboarded
 * account. Idempotent — safe to re-run against an existing DB.
 *
 * Requires:
 *   DATABASE_URL    — points at a throwaway Postgres (CI service / local).
 *   E2E_TEST_AUTH=1 — so the app accepts the injected test user.
 */
import { execSync } from "node:child_process";
import pg from "pg";

const TEST_CLERK_ID = process.env.E2E_TEST_USER_ID || "e2e_test_user";
const TEST_EMAIL = "e2e@acreos.test";

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    throw new Error("[e2e] DATABASE_URL is required for the mobile E2E suite");
  }

  // 1. Push the full schema (creates every table). --force skips prompts.
  console.log("[e2e] pushing schema to test DB…");
  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: process.env,
  });

  // 2. Seed an onboarded user + org + active membership.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: userRows } = await client.query(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, persona)
       VALUES ($1, $2, 'E2E', 'Tester', 'land_investor')
       ON CONFLICT (clerk_user_id) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [TEST_CLERK_ID, TEST_EMAIL],
    );
    const userId: string = userRows[0].id;

    const { rows: orgRows } = await client.query(
      `INSERT INTO organizations (name, slug, owner_id, onboarding_completed)
       VALUES ('E2E Test Org', 'e2e-test-org', $1, true)
       ON CONFLICT (slug) DO UPDATE SET owner_id = EXCLUDED.owner_id, onboarding_completed = true
       RETURNING id`,
      [userId],
    );
    const orgId: number = orgRows[0].id;

    await client.query(
      `INSERT INTO team_members (organization_id, user_id, role, is_active)
       SELECT $1, $2, 'owner', true
       WHERE NOT EXISTS (
         SELECT 1 FROM team_members WHERE organization_id = $1 AND user_id = $2
       )`,
      [orgId, userId],
    );

    console.log(`[e2e] seeded user=${userId} org=${orgId}`);
  } finally {
    await client.end();
  }
}
