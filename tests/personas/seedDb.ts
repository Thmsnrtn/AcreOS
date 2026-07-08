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
    const data = JSON.stringify({ businessType: p.businessType });
    const upd = await client.query(
      `UPDATE organizations
         SET investor_type = $2, onboarding_data = $3, onboarding_completed = true
       WHERE owner_id = $1
       RETURNING id`,
      [userId, p.investorType, data],
    );
    let orgId: number;
    if ((upd.rowCount ?? 0) > 0) {
      orgId = upd.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO organizations (name, slug, owner_id, investor_type, onboarding_data, onboarding_completed)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [`${p.displayName} Org`, `persona-${p.slug}`, userId, p.investorType, data],
      );
      orgId = ins.rows[0].id;
    }

    // 2b. Ensure the owner is an ACTIVE member of the org. getOrCreateOrg
    //     normally creates this row alongside the org; a DB-seeded org has none,
    //     so membership checks would 403. (One row per org+user.)
    await client.query(
      `INSERT INTO team_members (organization_id, user_id, role, is_active)
       SELECT $1, $2, 'owner', true
       WHERE NOT EXISTS (
         SELECT 1 FROM team_members WHERE organization_id = $1 AND user_id = $2
       )`,
      [orgId, userId],
    );

    // 3. Seed ~6 leads (varied stages) so the pipeline/Today/deal-coach render
    //    populated surfaces, not just empty states. Idempotent per org.
    await client.query(`DELETE FROM leads WHERE organization_id = $1 AND email LIKE '%@persona-test.local'`, [orgId]);
    const FIRST = ["James", "Maria", "Robert", "Linda", "David", "Patricia"];
    const LAST = ["Garcia", "Smith", "Johnson", "Martinez", "Williams", "Lopez"];
    const STATUS = ["new", "contacted", "negotiating", "new", "contacted", "new"];
    for (let i = 0; i < 6; i++) {
      await client.query(
        `INSERT INTO leads (organization_id, first_name, last_name, email, phone, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, FIRST[i], `${LAST[i]}-${p.slug.slice(0, 5)}`, `lead${i}.${p.slug}@persona-test.local`, `555-01${String(i).padStart(2, "0")}`, STATUS[i]],
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
