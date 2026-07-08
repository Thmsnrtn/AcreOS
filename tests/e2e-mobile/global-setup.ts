/**
 * Global setup for the mobile E2E suite.
 *
 * Runs once before the suite. Pushes the Drizzle schema to the (CI or local)
 * Postgres in DATABASE_URL and seeds TWO test identities so the test-auth
 * bypass (server/auth/testAuth.ts) resolves to real, onboarded accounts:
 *   - customer:  e2e_test_user    / e2e@acreos.test         (any cookie value)
 *   - founder:   e2e_founder_user / founder-e2e@acreos.test (cookie "e2e-founder")
 * The workflow points FOUNDER_EMAIL/FOUNDER_EMAILS at the founder email ONLY,
 * so the customer identity is genuinely a non-founder — pax-founder-gate's
 * leak assertions and founder-positive specs can both run in one job.
 * Idempotent — safe to re-run against an existing DB.
 *
 * Requires:
 *   DATABASE_URL    — points at a throwaway Postgres (CI service / local).
 *   E2E_TEST_AUTH=1 — so the app accepts the injected test user.
 */
import { execSync } from "node:child_process";
import pg from "pg";

const TEST_CLERK_ID = process.env.E2E_TEST_USER_ID || "e2e_test_user";
const TEST_EMAIL = "e2e@acreos.test";
const FOUNDER_CLERK_ID = process.env.E2E_FOUNDER_USER_ID || "e2e_founder_user";
const FOUNDER_EMAIL = "founder-e2e@acreos.test";

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
    // Idempotent: clear demo rows first. TRUNCATE … CASCADE (not per-org
    // DELETE) because journey specs create child rows with FKs onto leads
    // (conversations → messages, campaign_delivery_events, consent events…)
    // that block a plain DELETE on local reruns. This DB is a dedicated
    // throwaway E2E database — nothing in it is precious.
    await client.query(
      `TRUNCATE deals, notes, properties, leads, campaigns RESTART IDENTITY CASCADE`,
    );

    await client.query(
      `INSERT INTO leads (organization_id, first_name, last_name, status, score, state, city)
       VALUES
         ($1, 'Marina', 'Hollowell', 'new', 88, 'AZ', 'Buckeye'),
         ($1, 'Desmond', 'Trujillo', 'contacted', 72, 'TX', 'Marfa'),
         ($1, 'Priya', 'Vanterpool', 'negotiating', 64, 'CO', 'Alamosa')`,
      [orgId],
    );

    // 4b. Wedge-journey fixtures (tests/e2e-mobile/wedge-journey.spec.ts):
    //   - a lead with a phone + express TCPA consent (the campaign send-sms
    //     pre-filter drops anything less). The spec sets lead.timezone at
    //     runtime to a currently-daytime zone so quiet hours can't flake.
    //   - prepaid credits so the send's upfront credit debit succeeds.
    //   - org-level simulationMode so the "send" records a simulated action
    //     instead of touching Twilio (server/utils/simulationMode.ts).
    //   - a twilio integration row whose fromPhoneNumber lets the inbound
    //     webhook (/api/webhooks/twilio/sms) match this org.
    await client.query(
      `INSERT INTO leads (organization_id, first_name, last_name, status, score, state, city,
                          phone, tcpa_consent, consent_date, consent_source)
       VALUES ($1, 'Wedge', 'Seller', 'new', 91, 'AZ', 'Wickenburg',
               '+14805550142', true, now(), 'e2e_seed')`,
      [orgId],
    );
    // 4b-ii. Email-reply fixture (tests/e2e-mobile/wedge-email-reply.spec.ts):
    //   a lead with a real email address so the synthetic inbound reply can
    //   honestly come "from the seeded lead's email". The inbound handler
    //   routes on the reply-to address (inbox+{leadId}-{hash}@…), which the
    //   spec derives with the same HMAC recipe the server uses
    //   (server/services/inboundEmailService.ts: INBOUND_EMAIL_HMAC_SECRET
    //   || SESSION_SECRET). Distinct from the Wedge Seller so the two
    //   journey specs never fight over one lead's status.
    await client.query(
      `INSERT INTO leads (organization_id, first_name, last_name, status, score, state, city, email)
       VALUES ($1, 'Emmy', 'Replywell', 'contacted', 77, 'NM', 'Taos',
               'emmy.replywell@seller-e2e.test')`,
      [orgId],
    );
    // The wedge journey models a PAYING customer. Since PR #112 the campaign
    // cap is genuinely enforced (free tier = 0 campaigns — intended product
    // behavior), so the default free-tier org can no longer create the
    // journey's campaign. 'pro' (unlimited campaigns) also keeps the 5
    // device projects + retries, which all share this one org, under any cap.
    await client.query(
      `UPDATE organizations
       SET credit_balance = '100000',
           subscription_tier = 'pro',
           subscription_status = 'active',
           settings = COALESCE(settings, '{}'::jsonb) || '{"simulationMode": true}'::jsonb
       WHERE id = $1`,
      [orgId],
    );
    await client.query(
      `DELETE FROM organization_integrations WHERE organization_id = $1 AND provider = 'twilio'`,
      [orgId],
    );
    await client.query(
      `INSERT INTO organization_integrations (organization_id, provider, is_enabled, credentials)
       VALUES ($1, 'twilio', true,
               '{"fromPhoneNumber": "+15005550006", "accountSid": "ACe2e00000000000000000000000000000"}'::jsonb)`,
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

    // 5. Seed the founder identity — own user + org + membership. Selected
    // by the "e2e-founder" __session cookie (see server/auth/testAuth.ts);
    // its email is the workflow's FOUNDER_EMAIL/FOUNDER_EMAILS value, so
    // founder-positive specs see Tom's surfaces while the customer user
    // above stays a genuine non-founder.
    const { rows: founderRows } = await client.query(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, persona)
       VALUES ($1, $2, 'E2E', 'Founder', 'land_investor')
       ON CONFLICT (clerk_user_id) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [FOUNDER_CLERK_ID, FOUNDER_EMAIL],
    );
    const founderUserId: string = founderRows[0].id;

    const { rows: founderOrgRows } = await client.query(
      `INSERT INTO organizations (name, slug, owner_id, onboarding_completed)
       VALUES ('E2E Founder Org', 'e2e-founder-org', $1, true)
       ON CONFLICT (slug) DO UPDATE SET owner_id = EXCLUDED.owner_id, onboarding_completed = true
       RETURNING id`,
      [founderUserId],
    );
    const founderOrgId: number = founderOrgRows[0].id;

    await client.query(
      `INSERT INTO team_members (organization_id, user_id, role, is_active)
       SELECT $1, $2, 'owner', true
       WHERE NOT EXISTS (
         SELECT 1 FROM team_members WHERE organization_id = $1 AND user_id = $2
       )`,
      [founderOrgId, founderUserId],
    );

    console.log(
      `[e2e] seeded customer user=${userId} org=${orgId} + demo data; founder user=${founderUserId} org=${founderOrgId}`,
    );
  } finally {
    await client.end();
  }
}
