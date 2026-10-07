/**
 * The production invariant watch, falsified on a REAL schema.
 *
 * For each production query (server/services/invariantWatch.ts): measure it on
 * the simulation database, plant exactly one breach of that invariant, require
 * the count to rise by one, then remove the breach. A query that does not move
 * is reading the wrong population (wrong table, wrong status, wrong join).
 *
 *   DATABASE_URL=postgresql://…/acreos_simplat npx tsx tests/simulation/platform/prodAlertsOnDb.ts
 *
 * Refuses any database that is not a simulation database.
 */
import pg from "pg";

const URL = process.env.DATABASE_URL ?? "";
if (!/\/acreos_simplat\w*(\?|$)/.test(URL)) throw new Error(`refusing DATABASE_URL=${URL}`);
const pool = new pg.Pool({ connectionString: URL, max: 2 });
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows;

async function main() {
  const { checkProductionInvariants } = await import("../../../server/services/invariantWatch");
  const read = async () => Object.fromEntries((await checkProductionInvariants()).map((h) => [h.name, h]));
  const before = await read();
  const results: Array<{ id: string; before: string; after: string; moved: boolean }> = [];
  const tag = `simplat-${Date.now()}`;
  const [org] = await q(`insert into organizations (name, slug, owner_id) values ($1, $1, $1) returning id`, [tag]);
  const [lead] = await q(`insert into leads (organization_id, first_name, last_name, email) values ($1, 'Pat', 'Seller', $2) returning id`, [org.id, `${tag}@example.net`]);
  const [camp] = await q(`insert into campaigns (organization_id, name, type) values ($1, $2, 'sms') returning id`, [org.id, tag]);
  const plant: Record<string, () => Promise<void>> = {
    "invariant:one-page-per-incident": async () => {
      await q(`insert into incidents (id, severity, title, summary, started_at) values ($1, 'sev2', '[ops] stripe', 'sim', now() - interval '2 hours')`, [tag]);
      await q(`insert into solene_page_events (severity, subject, body, delivery_status, fired_at) values ('critical', 'Stripe (billing) is down', $1, 'skipped', now() - interval '90 minutes'), ('critical', 'Still no payments', 'Stripe has not answered', 'skipped', now() - interval '30 minutes')`, [tag]);
    },
    "invariant:no-platform-counterparty-mail": async () => {
      await q(`insert into outbound_email_log (id, kind, category, recipient, subject, status) values ($1, 'system', 'transactional', $2, 'x', 'sent')`, [tag, `${tag}@EXAMPLE.net`]);
    },
    "invariant:no-send-without-consent": async () => {
      await q(`insert into lead_consent_events (organization_id, lead_id, event_type, channels, source, created_at) values ($1, $2, 'revoked', '["sms"]', 'inbound_sms', now() - interval '1 hour')`, [org.id, lead.id]);
      await q(`insert into campaign_delivery_events (campaign_id, lead_id, channel, status, sent_at) values ($1, $2, 'sms', 'sent', now())`, [camp.id, lead.id]);
    },
    "invariant:refunds-within-rules": async () => {
      await q(`insert into credit_transactions (organization_id, type, amount_cents, balance_after_cents, description, metadata) values ($1, 'purchase_refund', -8000, 0, $2, $3)`, [org.id, tag, JSON.stringify({ refundAmountCents: 8000, approvedBy: "solene (delegated by founder via witness-grant #3)", state: "refunded" })]);
    },
  };
  try {
    for (const [name, fn] of Object.entries(plant)) {
      const b = before[name];
      await fn();
      const a = (await read())[name];
      const n = (h: any) => Number(/^(\d+) breach/.exec(h?.message ?? "")?.[1] ?? (h?.status === "healthy" ? 0 : NaN));
      const moved = n(a) === n(b) + 1;
      results.push({ id: name, before: `${b?.status} ${b?.message ?? ""}`, after: `${a?.status} ${a?.message ?? ""}`, moved });
      console.log(`${moved ? "MOVED " : "STUCK "} ${name}: ${b?.status}/${n(b)} → ${a?.status}/${n(a)}`);
    }
  } finally {
    await q(`delete from campaign_delivery_events where campaign_id = $1`, [camp.id]);
    await q(`delete from lead_consent_events where organization_id = $1`, [org.id]);
    await q(`delete from credit_transactions where organization_id = $1`, [org.id]);
    await q(`delete from outbound_email_log where id = $1`, [tag]);
    await q(`delete from solene_page_events where body = $1 or (subject = 'Still no payments' and body = 'Stripe has not answered')`, [tag]);
    await q(`delete from incidents where id = $1`, [tag]);
    await q(`delete from campaigns where id = $1`, [camp.id]);
    await q(`delete from leads where id = $1`, [lead.id]);
    await q(`delete from organizations where id = $1`, [org.id]);
  }
  await pool.end();
  const stuck = results.filter((r) => !r.moved);
  if (stuck.length) { console.log("FAIL", stuck); process.exit(1); }
  console.log(`PASS: ${results.length} production invariant queries each counted their planted breach`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
