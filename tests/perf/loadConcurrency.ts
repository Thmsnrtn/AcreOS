/**
 * Load / concurrency / volume stress harness (red-team blueprint #5).
 *
 * The shell smoke measured one persona's door timing on a ~6-row org over
 * loopback — meaningless as a scale signal. Real launch concerns:
 *   - VOLUME: a user imports thousands of leads. Does the leads door paginate,
 *     or try to render everything and hang? Does an unindexed query blow up?
 *   - CONCURRENCY: many users at once. Does the connection pool saturate and
 *     start 5xx-ing? What's p95 under sustained parallel load?
 *
 * This seeds a high-volume org, then fires N concurrent authed requests at the
 * data-heavy endpoint and reports latency percentiles + status distribution.
 * Request-level (no browser) so it's cheap and high-throughput.
 *
 *   VOLUME=5000 CONCURRENCY=40 ROUNDS=4 \
 *   DATABASE_URL=... PLAYWRIGHT_BASE_URL=http://localhost:5050 \
 *   npx tsx tests/perf/loadConcurrency.ts
 *
 * Exit 1 if any 5xx under load or p95 over the budget.
 */

import pg from "pg";
import { personaCookieValue } from "../../server/auth/testAuth";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5050";
const PERSONA = "land-power-volume"; // a high-volume persona
const VOLUME = Number(process.env.VOLUME ?? 5000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 40);
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 3000);
const ENDPOINT = process.env.ENDPOINT ?? "/api/leads?page=1&pageSize=25";

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function seedVolume(client: pg.Client, orgId: number, n: number): Promise<number> {
  const have = (await client.query(`SELECT count(*)::int c FROM leads WHERE organization_id=$1`, [orgId])).rows[0].c;
  if (have >= n) return have;
  // Bulk insert in batches (generate_series for speed).
  const need = n - have;
  await client.query(
    `INSERT INTO leads (organization_id, first_name, last_name, email, phone, status)
     SELECT $1, 'Load', 'Test-' || g, 'load' || g || '@perf-test.local', '555-' || lpad(g::text,7,'0'),
            (ARRAY['new','contacted','negotiating'])[1 + (g % 3)]
     FROM generate_series(1, $2) g`,
    [orgId, need],
  );
  return n;
}

async function fire(): Promise<{ ms: number; status: number }> {
  const t = performance.now();
  const res = await fetch(`${BASE}${ENDPOINT}`, { headers: { Cookie: `__session=${personaCookieValue(PERSONA)}` } });
  await res.text().catch(() => "");
  return { ms: Math.round(performance.now() - t), status: res.status };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const orgRow = await client.query(
    `SELECT o.id FROM users u JOIN organizations o ON o.owner_id=u.id WHERE u.clerk_user_id=$1`,
    [`e2e_persona_${PERSONA.replace(/-/g, "_")}`],
  );
  const orgId = orgRow.rows[0]?.id;
  if (!orgId) throw new Error(`persona ${PERSONA} org not found — seed first`);

  console.log(`Seeding org ${orgId} to ${VOLUME} leads…`);
  const total = await seedVolume(client, orgId, VOLUME);
  console.log(`org has ${total} leads. Hammering ${ENDPOINT} — ${CONCURRENCY} concurrent × ${ROUNDS} rounds.\n`);
  await client.end();

  const all: number[] = [];
  const statuses: Record<number, number> = {};
  for (let r = 0; r < ROUNDS; r++) {
    const batch = await Promise.all(Array.from({ length: CONCURRENCY }, () => fire()));
    for (const b of batch) {
      all.push(b.ms);
      statuses[b.status] = (statuses[b.status] ?? 0) + 1;
    }
    process.stdout.write(`  round ${r + 1}/${ROUNDS} done\r`);
  }
  all.sort((a, b) => a - b);

  const p50 = pct(all, 50), p95 = pct(all, 95), p99 = pct(all, 99);
  const fivexx = Object.entries(statuses).filter(([s]) => Number(s) >= 500).reduce((n, [, c]) => n + c, 0);
  console.log(`\nrequests: ${all.length}  status: ${JSON.stringify(statuses)}`);
  console.log(`latency ms — p50 ${p50}  p95 ${p95}  p99 ${p99}  max ${all[all.length - 1]}`);
  console.log(`5xx under load: ${fivexx}  ·  p95 budget ${P95_BUDGET_MS}ms`);

  const fails: string[] = [];
  if (fivexx > 0) fails.push(`${fivexx} server errors under ${CONCURRENCY}-way concurrency (pool exhaustion / timeout)`);
  if (p95 > P95_BUDGET_MS) fails.push(`p95 ${p95}ms exceeds budget ${P95_BUDGET_MS}ms at ${total} rows`);
  if (fails.length) {
    console.log("\n✗ LOAD FINDINGS:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`\n✓ Held up: no 5xx, p95 ${p95}ms ≤ ${P95_BUDGET_MS}ms at ${total} leads under ${CONCURRENCY}-way concurrency.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
