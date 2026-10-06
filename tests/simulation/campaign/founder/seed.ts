/**
 * Founder-sim seed — identities the E2E test-auth bypass resolves to.
 *
 * The bypass (server/auth/testAuth.ts) injects a Clerk user id; hydrateUser
 * then looks that id up in `users` and, on a miss, calls the real Clerk API
 * (which fails offline). So every identity a sim drives must exist first.
 *
 *   founder  — e2e_founder_user / founder-e2e@acreos.test (FOUNDER_EMAILS)
 *   customer — e2e_persona_<slug> (one isolated tenant per slug)
 *
 * Writes ONLY to the database named in DATABASE_URL, and refuses to run
 * against the shared sim databases.
 */
import pg from "pg";

export const FOUNDER_CLERK_ID = "e2e_founder_user";
export const FOUNDER_EMAIL = "founder-e2e@acreos.test";
const AI_DISCLOSURE_VERSION = "v2"; // client/src/components/onboarding/AiDisclosureDialog.tsx:49

export function dbUrl(): string {
  const url = process.env.DATABASE_URL ?? "postgresql://acreos:acreos@localhost:5432/acreos_founder";
  if (/\/(acreos_sim|acreos_mobile)(\?|$)/.test(url)) {
    throw new Error(`refusing to seed a shared database: ${url}`);
  }
  return url;
}

export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface SeededIdentity {
  userId: string;
  orgId: number;
  email: string;
}

async function seedUserOrg(
  c: pg.Client,
  clerkId: string,
  email: string,
  first: string,
  last: string,
  orgName: string,
  slug: string,
  orgExtra: Record<string, unknown> = {},
): Promise<SeededIdentity> {
  const { rows: u } = await c.query(
    `INSERT INTO users (clerk_user_id, email, first_name, last_name, persona, ai_disclosed_at, ai_disclosure_version)
     VALUES ($1,$2,$3,$4,'land_investor',now(),$5)
     ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email, ai_disclosed_at=EXCLUDED.ai_disclosed_at,
       ai_disclosure_version=EXCLUDED.ai_disclosure_version
     RETURNING id`,
    [clerkId, email, first, last, AI_DISCLOSURE_VERSION],
  );
  const userId: string = u[0].id;
  const { rows: o } = await c.query(
    `INSERT INTO organizations (name, slug, owner_id, onboarding_completed)
     VALUES ($1,$2,$3,true)
     ON CONFLICT (slug) DO UPDATE SET owner_id=EXCLUDED.owner_id
     RETURNING id`,
    [orgName, slug, userId],
  );
  const orgId: number = o[0].id;
  await c.query(
    `INSERT INTO team_members (organization_id, user_id, role, is_active)
     SELECT $1,$2,'owner',true WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE organization_id=$1 AND user_id=$2)`,
    [orgId, userId],
  );
  for (const [k, v] of Object.entries(orgExtra)) {
    await c.query(`UPDATE organizations SET ${k} = $1 WHERE id = $2`, [v, orgId]);
  }
  return { userId, orgId, email };
}

export async function seedFounder(): Promise<SeededIdentity> {
  return withDb((c) =>
    seedUserOrg(c, FOUNDER_CLERK_ID, FOUNDER_EMAIL, "Tom", "Founder", "AcreOS (founder)", "e2e-founder-org"),
  );
}

/** A customer tenant as the world would create it (sign-up → org). */
export async function seedCustomer(
  slug: string,
  opts: { onboardingCompleted?: boolean; email?: string; orgExtra?: Record<string, unknown> } = {},
): Promise<SeededIdentity> {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return withDb(async (c) => {
    const id = await seedUserOrg(
      c,
      `e2e_persona_${clean}`,
      opts.email ?? `${clean}@customer.sim.test`,
      "Cust",
      clean,
      `Sim Customer ${clean}`,
      `sim-cust-${clean.replace(/_/g, "-")}`,
      opts.orgExtra ?? {},
    );
    if (opts.onboardingCompleted === false) {
      await c.query(`UPDATE organizations SET onboarding_completed=false WHERE id=$1`, [id.orgId]);
    }
    return id;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFounder()
    .then((f) => console.log(JSON.stringify({ founder: f })))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

/**
 * The Clerk half of a self-serve sign-up: the user row hydrateUser would
 * create on first login (server/auth/clerkAuth.ts:226-260). The ORG is then
 * created by the app itself on the customer's first request
 * (getOrCreateOrg) — see simkit.signUpCustomer — exactly as in production.
 */
export async function seedCustomerUser(slug: string, email?: string): Promise<{ userId: string; clerkId: string; email: string }> {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const clerkId = `e2e_persona_${clean}`;
  const addr = email ?? `${clean}@customer.sim.test`;
  return withDb(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, persona, ai_disclosed_at, ai_disclosure_version, tos_accepted_at, privacy_accepted_at)
       VALUES ($1,$2,$3,'Customer','land_investor',now(),$4,now(),now())
       ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email
       RETURNING id`,
      [clerkId, addr, clean.slice(0, 20), AI_DISCLOSURE_VERSION],
    );
    return { userId: rows[0].id, clerkId, email: addr };
  });
}
