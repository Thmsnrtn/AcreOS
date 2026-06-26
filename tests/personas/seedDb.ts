/**
 * Deterministic persona-frame seeder (DB-direct, no CSRF).
 *
 * The in-browser POST /api/onboarding/complete is CSRF-gated and brittle to
 * drive from a test context. This seeds each persona's frame straight into the
 * DB so the walk renders the REAL vertical (note/wholesaler/tax/etc.), not the
 * land_investor default:
 *   users.persona                       = the derived persona
 *   organizations.investor_type         = the derived investorType
 *   organizations.onboarding_data        = { businessType }
 *   organizations.onboarding_completed   = true
 *
 * Idempotent: ensures exactly ONE org per persona user (removes dupes from
 * prior getOrCreateOrg races), owned by that user.
 *
 *   DATABASE_URL=... npx tsx tests/personas/seedDb.ts
 */

import pg from "pg";
import { CUSTOMER_PERSONAS } from "./customer-personas";
import { personaTestUserId } from "../../server/auth/testAuth";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  let seeded = 0;
  for (const p of CUSTOMER_PERSONAS) {
    const clerkId = personaTestUserId(p.slug);
    // 1. Ensure the user exists + carries the derived persona.
    const u = await client.query(
      `INSERT INTO users (clerk_user_id, email, persona)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_user_id) DO UPDATE SET persona = EXCLUDED.persona
       RETURNING id`,
      [clerkId, `${clerkId}@persona-test.local`, p.persona],
    );
    const userId: string = u.rows[0].id;

    // 2. Set the frame on EVERY org owned by this user (getOrCreateOrg picks the
    //    oldest; updating all means whichever it picks carries the right frame).
    //    No deletes — dupe orgs from prior getOrCreateOrg races have FK children.
    const upd = await client.query(
      `UPDATE organizations
         SET investor_type = $2,
             onboarding_data = $3,
             onboarding_completed = true
       WHERE owner_id = $1`,
      [userId, p.investorType, JSON.stringify({ businessType: p.businessType })],
    );
    if (upd.rowCount === 0) {
      await client.query(
        `INSERT INTO organizations (name, owner_id, investor_type, onboarding_data, onboarding_completed)
         VALUES ($1, $2, $3, $4, true)`,
        [`${p.displayName} Org`, userId, p.investorType, JSON.stringify({ businessType: p.businessType })],
      );
    }
    seeded++;
  }

  await client.end();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${seeded} persona frames (persona + investorType + businessType).`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
