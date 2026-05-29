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

  // 1. Enable pgvector — the schema has a vector(1536) column, and
  // `drizzle-kit push` will fail with `type "vector" does not exist` unless
  // the extension is created first. The CI Postgres image ships pgvector;
  // this just enables it in the target database.
  {
    const ext = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await ext.connect();
    try {
      await ext.query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (err) {
      console.warn(
        "[e2e] could not create pgvector extension (continuing): " +
          (err as Error).message,
      );
    } finally {
      await ext.end();
    }
  }

  // 2. Push the full schema (creates every table). --force skips prompts.
  console.log("[e2e] pushing schema to test DB…");
  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: process.env,
  });

  // 3. Seed an onboarded user + org + active membership.
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

    // 4. Seed realistic, assertable data so pages render real content (not
    // just empty states). Distinctive values let the spec assert on them.
    // Idempotent: clear this org's demo rows first, then insert.
    await client.query(`DELETE FROM deals WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM notes WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM properties WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM leads WHERE organization_id = $1`, [orgId]);

    await client.query(
      `INSERT INTO leads (organization_id, first_name, last_name, status, score, state, city)
       VALUES
         ($1, 'Marina', 'Hollowell', 'new', 88, 'AZ', 'Buckeye'),
         ($1, 'Desmond', 'Trujillo', 'contacted', 72, 'TX', 'Marfa'),
         ($1, 'Priya', 'Vanterpool', 'negotiating', 64, 'CO', 'Alamosa')`,
      [orgId],
    );

    const { rows: propRows } = await client.query(
      `INSERT INTO properties (organization_id, apn, county, state, size_acres, status, city, address)
       VALUES
         ($1, 'E2E-APN-7781', 'Maricopa', 'AZ', '40', 'owned', 'Buckeye', '0 W Vista Rd'),
         ($1, 'E2E-APN-3322', 'Presidio', 'TX', '160', 'prospect', 'Marfa', 'TBD Ranch Rd')
       RETURNING id`,
      [orgId],
    );
    const propertyId: number = propRows[0].id;

    await client.query(
      `INSERT INTO deals (organization_id, property_id, type, status, offer_amount)
       VALUES ($1, $2, 'acquisition', 'negotiating', '32000')`,
      [orgId, propertyId],
    );

    await client.query(
      `INSERT INTO notes
         (organization_id, property_id, original_principal, current_balance,
          interest_rate, term_months, monthly_payment, start_date, first_payment_date, status)
       VALUES
         ($1, $2, '40000', '38200', '9.5', 120, '517.42', now(), now() + interval '1 month', 'active')`,
      [orgId, propertyId],
    );

    console.log(`[e2e] seeded user=${userId} org=${orgId} + demo data`);
  } finally {
    await client.end();
  }
}
