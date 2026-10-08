/**
 * Global setup for the API-level simulation suite (vitest.simulation.config.ts).
 *
 * THE VACUITY FLOOR. Run with no server, this suite used to report 51 of 59
 * tests passing: each began `if (!session) return;`, and its beforeAll turned
 * "could not authenticate" into a console warning. Against a running server it
 * fared no better — the session helper called signup and login routes that do
 * not exist and handed back an empty cookie. A green run therefore said
 * nothing about the product.
 *
 * So the run does not start unless it can be real:
 *   1. SIM_BASE_URL answers GET /api/health with 200;
 *   2. when SIM_DATABASE_URL is set (never DATABASE_URL — see ./target.ts), each
 *      persona's test-auth user row is seeded; the server provisions the org on
 *      first contact;
 *   3. every persona the suite uses authenticates (GET /api/auth/user → 200).
 *
 * Any failure throws, and vitest reports the run failed with the reason.
 */
import pg from "pg";
import { personaTestUserId } from "../../server/auth/testAuth";
import { PERSONAS, type PersonaKey } from "./personas";
import { createAuthenticatedSession, simPersonaSlug } from "./helpers";
import { simBaseUrl, simDatabaseUrl } from "./target";

export async function requireHealthyServer(baseUrl = simBaseUrl()): Promise<void> {
  let status: number | string;
  try {
    status = (await fetch(`${baseUrl}/api/health`)).status;
  } catch (err) {
    status = (err as Error).message;
  }
  if (status !== 200) {
    throw new Error(
      `[sim] ${baseUrl}/api/health → ${status}. The simulation suite drives a running server ` +
        "(E2E_TEST_AUTH=1) and refuses to report on one it cannot reach.",
    );
  }
}

export async function seedPersonaUsers(databaseUrl: string, keys: PersonaKey[]): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const key of keys) {
      const clerkId = personaTestUserId(simPersonaSlug(key));
      await client.query(
        `INSERT INTO users (clerk_user_id, email) VALUES ($1, $2)
         ON CONFLICT (clerk_user_id) DO NOTHING`,
        [clerkId, `${clerkId}@sim-test.local`],
      );
    }
  } finally {
    await client.end();
  }
}

/** Tiers subscription_tier accepts; a persona naming any other keeps the default. */
const BILLABLE_TIERS = new Set(["free", "starter", "pro", "scale"]);

/**
 * Put each persona's org on the tier its definition names, and remove the rows
 * earlier runs created (every simulation fixture email ends `@sim-test.com`).
 * Without this a second run starts with the first run's leads, the free-tier
 * cap is already spent, and the load profile's seed step creates nothing.
 * Touches only rows in the simulation personas' own orgs.
 */
export async function resetPersonaOrgs(databaseUrl: string, keys: PersonaKey[]): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const key of keys) {
      const clerkId = personaTestUserId(simPersonaSlug(key));
      const tier = PERSONAS[key].tier;
      const orgs = await client.query<{ id: number }>(
        `SELECT o.id FROM organizations o JOIN users u ON u.id = o.owner_id WHERE u.clerk_user_id = $1`,
        [clerkId],
      );
      for (const { id } of orgs.rows) {
        if (BILLABLE_TIERS.has(tier)) {
          await client.query(`UPDATE organizations SET subscription_tier = $2 WHERE id = $1`, [id, tier]);
        }
        await client.query(`DELETE FROM leads WHERE organization_id = $1 AND email LIKE '%@sim-test.com'`, [id]);
      }
    }
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<void> {
  // Both targets are validated before anything is sent or written.
  const baseUrl = simBaseUrl();
  const dbUrl = simDatabaseUrl();
  await requireHealthyServer(baseUrl);
  const keys = Object.keys(PERSONAS) as PersonaKey[];
  if (dbUrl) await seedPersonaUsers(dbUrl, keys);
  // Authenticating provisions each persona's org, so the reset follows it.
  for (const key of keys) await createAuthenticatedSession(key);
  if (dbUrl) await resetPersonaOrgs(dbUrl, keys);
}
