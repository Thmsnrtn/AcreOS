/**
 * Production invariant watch — the read-only half of the simulation's
 * invariant monitor (tests/simulation/invariants/registry.ts).
 *
 * The simulation checks nine business invariants after every simulated tick.
 * The ones that are cheap and safe to read in production run here as health
 * checks (healthCheck.checkAll → `invariant:<id>`), each a bounded SELECT over
 * a record the product already writes. Nothing here writes, sends or pages:
 * a breach shows as a `degraded` health entry, which the existing health
 * alerting (consecutive-failure system alerts) already escalates.
 *
 *   one-page-per-incident          solene_page_events during each [ops] incident
 *   no-platform-counterparty-mail  outbound_email_log (the system-mail log) rows
 *                                  sent to an address that is some lead's email
 *   no-send-without-consent        campaign_delivery_events sent to a lead after
 *                                  that lead's recorded opt-out event
 *   refunds-within-rules           witness-granted refunds above the refund ceiling
 *   clock                          this process is on the real calendar
 *
 * A read that fails reports `degraded` with the reason — an unread invariant is
 * never reported healthy.
 */
import { sql } from "drizzle-orm";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { clockStatus } from "../utils/clock";
import { INCIDENT_TITLE_PREFIX } from "./autopilot/opsWatch";
import { REFUND_CEILING_CENTS } from "./autopilot/hands/apply-refund";
import type { ServiceHealth } from "./healthCheck";
import { clock } from "../utils/clock";

const REASON = "Production invariant watch: read-only checks of business invariants across every org (a breach anywhere is a platform incident)";
const PAGE_KEYWORDS: Record<string, string> = { stripe: "stripe", email_provider: "email", model_provider: "model" };

type Reading = { id: string; breaches: number; detail: string };

function health(r: Reading): ServiceHealth {
  return {
    name: `invariant:${r.id}`,
    status: r.breaches === 0 ? "healthy" : "degraded",
    message: r.breaches === 0 ? undefined : `${r.breaches} breach(es): ${r.detail}`,
    lastChecked: clock.now(),
  };
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const res = await unscopedForPlatformOps(REASON).execute(query);
  const row = (res as unknown as { rows?: Array<{ n: number | string }> }).rows?.[0];
  return Number(row?.n ?? 0);
}

/** Pure: the SQL each production invariant runs (exported for the shape test). */
export function invariantQueries(now: Date) {
  const day = new Date(now.getTime() - 24 * 3600_000);
  const month = new Date(now.getTime() - 30 * 24 * 3600_000);
  const pageCases = Object.entries(PAGE_KEYWORDS)
    .map(([p, kw]) => sql`when ${INCIDENT_TITLE_PREFIX + p} then ${"%" + kw + "%"}`);
  return {
    "one-page-per-incident": sql`
      select count(*)::int as n from (
        select i.id
          from incidents i
          join solene_page_events p
            on p.fired_at >= i.started_at
           and p.fired_at <= coalesce(i.resolved_at, ${now})
           and (p.subject || ' ' || coalesce(p.body, '')) ilike (case i.title ${sql.join(pageCases, sql` `)} else '%' || i.title || '%' end)
         where i.title like ${INCIDENT_TITLE_PREFIX + "%"} and i.started_at >= ${month}
         group by i.id
        having count(p.id) > 1
      ) x`,
    "no-platform-counterparty-mail": sql`
      select count(*)::int as n
        from outbound_email_log l
       where l.created_at >= ${day} and l.status = 'sent'
         and exists (select 1 from leads ld where lower(ld.email) = lower(l.recipient))`,
    "no-send-without-consent": sql`
      select count(*)::int as n
        from campaign_delivery_events e
       where e.sent_at >= ${day} and e.status in ('sent', 'delivered')
         and exists (select 1 from lead_consent_events c
                      where c.lead_id = e.lead_id and c.event_type = 'revoked'
                        and c.created_at < e.sent_at)`,
    "refunds-within-rules": sql`
      select count(*)::int as n
        from credit_transactions t
       where t.type = 'purchase_refund' and t.created_at >= ${month}
         and coalesce((t.metadata->>'refundAmountCents')::int, 0) > ${REFUND_CEILING_CENTS}
         and coalesce(t.metadata->>'approvedBy', '') like '%via witness-grant%'`,
  } as const;
}

export async function checkProductionInvariants(): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  const queries = invariantQueries(clock.now());
  for (const [id, q] of Object.entries(queries)) {
    try {
      out.push(health({ id, breaches: await count(q), detail: id }));
    } catch (err) {
      out.push({ name: `invariant:${id}`, status: "degraded", message: `unread: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`, lastChecked: clock.now() });
    }
  }
  const c = clockStatus();
  out.push({
    name: "invariant:clock",
    status: c.offsetMs === 0 ? "healthy" : "degraded",
    message: c.offsetMs === 0 ? undefined : `this process runs on a simulated clock (offset ${c.offsetMs} ms)`,
    lastChecked: clock.now(),
  });
  return out;
}
