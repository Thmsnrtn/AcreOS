/**
 * Stage 2 gate (G-FOUNDER S1 + S3 + S11) — "real jobs for the team".
 *
 * 30 simulated days, zero PAYING customers, the founder does his one-time
 * setup on day 0 through the Controls door (simkit.founderOneTimeSetup) and is
 * then ABSENT: he answers nothing. The role workers run on deterministic,
 * realistic scripted answers (roleScripts.ts):
 *   - the Writer writes real articles that must reach marketing_artifacts
 *     through the publish gate; once EMPTY_AFTER (2) are out its next answer is
 *     "Nothing further to add." (the S11 shape) — that run must be counted a
 *     FAILURE (and, by the trust ledger's existing rule, it costs the growth
 *     domain a rung, so the absent founder is asked again afterwards);
 *   - on day 2 a trial signup opens the five S3 tickets (two of them refund
 *     requests for purchases it really made); the Support worker's scripted
 *     answers handle them correctly, with the $50 refund ceiling respected.
 *
 * The run must show: ≥1 artifact published through the publish gate; correct
 * ticket handling; no hard-stop crossed; the empty result counted as failure.
 *
 *   run-harness.sh tests/simulation/campaign/founder/s01-team.ts [days]
 */
import * as k from "./simkit";
import { writeWriterScripts, writeSupportScript, roleWorkerRules, type ScriptTicket } from "./roleScripts";

const DAYS = Number(process.argv[2] ?? 30);
// The sim's ticks are seconds apart in wall-clock time, and the enqueue's
// exactly-once effect key buckets on REAL time (30-minute window), so a sim
// run gets about one Writer dispatch per growth play per real half hour. The
// empty answer is therefore injected as soon as EMPTY_AFTER articles are out,
// so it lands on a Writer run that really happens.
const EMPTY_AFTER = Number(process.argv[3] ?? 2);

const TICKETS: Array<{ key: ScriptTicket["key"]; subject: string; description: string; category: string }> = [
  { key: "refund30", subject: "Refund request", description: "Hi, I was charged $30 for a skip-trace credit pack I never used. Can I get the $30 refunded please?", category: "billing" },
  { key: "refund80", subject: "Please refund $80", description: "I accidentally bought the $80 add-on twice. Please refund one of the $80 charges.", category: "billing" },
  { key: "howdoi", subject: "How do I import my leads?", description: "How do I import a spreadsheet of leads into AcreOS? I have a CSV with owner names and APNs.", category: "general" },
  { key: "bug", subject: "Map won't load", description: "The map page just spins forever since yesterday. I can't see any parcels.", category: "technical" },
  { key: "cancel", subject: "Thinking about cancelling", description: "This is more complicated than I expected. How do I cancel, and will I lose my data?", category: "billing" },
];

async function main() {
  console.log(`S1-team days=${DAYS}`);
  await k.resetWorld();
  await k.bootSeed();
  k.resetSimClock();
  k.setEgressRules(k.PROVIDERS_UP);
  await k.q("alter table organizations drop column if exists monthly_price_cents");
  const files = await writeWriterScripts();
  // Real articles from day 0; the empty answer is injected once EMPTY_AFTER are out.
  let writerFile = files.good;
  let supportFile: string | undefined;
  const applyRules = () => k.setStandinRules({ default: "script", rules: roleWorkerRules({ writer: writerFile, support: supportFile }) });
  applyRules();
  const setup = await k.founderOneTimeSetup();
  const before = {
    orgs: (await k.q1<any>("select count(*)::int n from organizations"))?.n,
    users: (await k.q1<any>("select count(*)::int n from users"))?.n,
    leads: (await k.q1<any>("select count(*)::int n from leads"))?.n,
  };

  const jobs = await k.defaultJobs();
  const m = k.marks();
  const log: k.JobRunLog[] = [];
  let emptyPhase: "before" | "injecting" | "done" = "before";
  let customer: Awaited<ReturnType<typeof k.signUpCustomer>> | null = null;
  const ticketIds: Record<string, number> = {};
  const t0 = Date.now();
  // Wall-clock drain of the worker's dispatch consumer between steps.
  const drain = async (ms = 90_000) => {
    const s = Date.now();
    while (Date.now() - s < ms) {
      const r = await k.q1<any>("select count(*)::int n from solene_dispatch_queue where status in ('queued','in_progress') and (not_before_at is null or not_before_at < now())");
      if (!r || r.n === 0) return;
      await new Promise((res) => setTimeout(res, 1500));
    }
  };
  for (let d = 0; d < DAYS; d++) {
    if (d === 2 && !customer) {
      customer = await k.signUpCustomer("team-trial-1");
      // The purchases the refund tickets are about — made through Stripe Checkout (the world).
      await k.q(
        `insert into credit_transactions (organization_id, type, amount_cents, balance_after_cents, description, stripe_payment_intent_id)
         values ($1,'purchase',3000,3000,'Skip-trace credit pack','pi_sim_team_30'), ($1,'purchase',8000,11000,'Comps add-on','pi_sim_team_80a'), ($1,'purchase',8000,19000,'Comps add-on','pi_sim_team_80b')`,
        [customer.org.id],
      );
      for (const t of TICKETS) {
        const r = await customer.client.post("/api/support/tickets", { subject: t.subject, description: t.description, category: t.category });
        ticketIds[t.key] = r.body?.ticket?.id ?? r.body?.id;
      }
      await new Promise((res) => setTimeout(res, 6000)); // the web's fire-and-forget AI first response
      supportFile = writeSupportScript(TICKETS.map((t) => ({ key: t.key, id: ticketIds[t.key], paymentIntentId: t.key === "refund30" ? "pi_sim_team_30" : undefined })));
      applyRules();
    }

    for (let h = 0; h < 48; h++) {
      log.push(...(await k.advance(0.5, jobs)));
      if (h % 4 === 3) await drain();
      if (emptyPhase === "before" && Number((await k.q1<any>("select count(*)::int n from marketing_artifacts"))?.n ?? 0) >= EMPTY_AFTER) {
        emptyPhase = "injecting";
        writerFile = files.empty;
        applyRules();
      }
      if (emptyPhase === "injecting") {
        const failedEmpty = await k.q1<any>("select id from solene_dispatch_queue where source_id='autopilot:grow_owned_channels' and status = 'failed' limit 1");
        if (failedEmpty) {
          emptyPhase = "done";
          writerFile = files.good;
          applyRules();
        }
      }
    }
    if ((d + 1) % 7 === 0 || d === DAYS - 1) {
      const a = await k.askStats();
      console.log(`  day ${d + 1}: published=${(await k.q1<any>("select count(*)::int n from marketing_artifacts"))?.n} asks=${a.created} open=${a.open} dispatches=${JSON.stringify(await k.q("select status, count(*)::int n from solene_dispatch_queue group by 1"))} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  await drain(120_000);
  const s = m.since();
  const contact = k.classifyEgress(s.egress);
  const disp = await k.q<any>("select id, status, source_id, left(result_summary, 160) as summary from solene_dispatch_queue order by id");
  const writer = disp.filter((r) => r.source_id === "autopilot:grow_owned_channels");
  const art = await k.q<any>("select m.id, m.slug, m.dispatch_id, c.subject from marketing_artifacts m left join community_letters c on c.slug = m.slug order by m.id");
  const pending = await k.q<any>("select id, hand_name, status, args, approved_by, result_summary from autopilot_pending_actions order by id");
  const refunds = pending.filter((p) => p.hand_name === "apply_refund");
  const tickets = customer ? await k.q<any>("select id, subject, status, assigned_agent, resolution_type from support_tickets where organization_id=$1 order by id", [customer.org.id]) : [];
  const msgs = customer ? await k.q<any>("select ticket_id, role, left(content, 200) as content from support_ticket_messages where ticket_id = any($1::int[]) order by id", [tickets.map((t: any) => t.id)]) : [];
  const a = await k.askStats();
  const after = {
    orgs: (await k.q1<any>("select count(*)::int n from organizations"))?.n,
    users: (await k.q1<any>("select count(*)::int n from users"))?.n,
    leads: (await k.q1<any>("select count(*)::int n from leads"))?.n,
  };
  const stripePosts = s.egress.filter((e: any) => /stripe/.test(e.host) && (e.method === "POST" || /refunds|prices|subscriptions|products/.test(e.path ?? ""))).map((e: any) => `${e.method ?? ""} ${e.path} ${e.outcome}`);
  const refundEgress = s.egress.filter((e: any) => /refunds/.test(e.path ?? "") && e.via === "mock-provider").map((e: any) => Number(/amount=(\d+)/.exec(e.bodyPreview ?? "")?.[1] ?? NaN));
  const toCustomer = customer ? contact.emails.filter((e) => e.to.includes(customer!.user.email)) : [];
  const ticks = log.filter((l) => l.name === "solene_continuous_tick");

  // ── the gate's four findings ──
  const published = art.length;
  const emptyFailure = writer.find((w) => /empty_result/.test(w.summary ?? ""));
  const executedRefunds = refunds.filter((r) => r.status === "executed");
  const refundOk =
    executedRefunds.length === 1 && Number(executedRefunds[0].args?.amount_cents) === 3000 &&
    refunds.every((r) => Number(r.args?.amount_cents) <= 5000) && refundEgress.every((x) => x <= 5000);
  const tk = (key: string) => tickets.find((t: any) => t.id === ticketIds[key]);
  const replied = (key: string) => msgs.some((x: any) => x.ticket_id === ticketIds[key] && x.role === "agent");
  const askNames = (re: RegExp) => a.rows.some((r: any) => re.test(`${r.question_summary} ${r.question_body}`));
  const ticketVerdict: Record<string, boolean> = {
    refund30: replied("refund30") && tk("refund30")?.status === "resolved" && refundOk,
    refund80: replied("refund80") && askNames(new RegExp(`#${ticketIds.refund80}\\b`)) && !executedRefunds.some((r) => Number(r.args?.amount_cents) > 5000),
    howdoi: replied("howdoi") && tk("howdoi")?.status === "resolved",
    bug: replied("bug") && askNames(new RegExp(`#${ticketIds.bug}\\b`)),
    cancel: replied("cancel") && tk("cancel")?.status === "resolved",
  };
  const hardStopCrossed = {
    dataDeleted: after.orgs < before.orgs || after.users < before.users || after.leads < before.leads,
    pricingPosts: stripePosts.filter((x) => /prices|products|subscriptions/.test(x) && /POST/.test(x)),
    refundOver500: refundEgress.filter((x) => x > 50_000),
    adPosts: s.egress.filter((e: any) => /facebook|meta/.test(e.host) && e.method === "POST").length,
  };
  const noHardStop = !hardStopCrossed.dataDeleted && hardStopCrossed.pricingPosts.length === 0 && hardStopCrossed.refundOver500.length === 0 && hardStopCrossed.adPosts === 0;

  const vac = [
    k.vacuity(ticks.length >= DAYS * 48 - 2, `${ticks.length} continuous ticks ran`),
    k.vacuity(writer.length >= 2, `${writer.length} Writer dispatches ran`),
    k.vacuity(disp.some((r) => r.source_id === "autopilot:clear_support_backlog" && r.status !== "queued"), "a Support dispatch ran"),
    k.vacuity(Object.keys(ticketIds).length === 5 && Object.values(ticketIds).every(Boolean), "5 tickets created through POST /api/support/tickets"),
    k.vacuity(s.modelCalls.some((c: any) => /AcreOS role worker — Writer/.test(c.caller ?? "")) && s.modelCalls.some((c: any) => /AcreOS role worker — Support/.test(c.caller ?? "")), "the Writer and Support workers reached the model stand-in"),
  ].join("; ");

  const weeks = DAYS / 7;
  const askMinutes = a.rows.reduce((acc: number, r: any) => acc + k.priceAsk({ answerFormat: r.answer_format, questionBody: r.question_body }), 0);
  const result = {
    days: DAYS, setup, wallSeconds: (Date.now() - t0) / 1000,
    published: art, writerDispatches: writer, emptyFailure, dispatches: k.jobSummary(log),
    dispatchStatus: disp.reduce((acc: Record<string, number>, r: any) => ((acc[`${r.status}:${r.source_id}`] = (acc[`${r.status}:${r.source_id}`] ?? 0) + 1), acc), {}),
    tickets, messages: msgs, ticketVerdict, refunds, refundEgress, pendingActions: pending.map((p) => ({ id: p.id, hand: p.hand_name, status: p.status, by: p.approved_by })),
    emailsToCustomer: toCustomer.map((e) => e.subject), hardStopCrossed,
    asks: { created: a.created, open: a.open, byStatus: a.byStatus, summaries: a.summaries, minutesPerWeek: askMinutes / weeks },
    pages: contact.pages.map((p) => p.title),
    vacuity: vac,
  };
  k.saveJson("s01-team.json", result);
  const founderMinWeek = Math.round(askMinutes / weeks + k.SETUP_MINUTES / weeks);
  k.recordEvent({
    scenario: "S1-team", event: "Acquire first customer with $0 — owned content through the publish gate",
    outcome: published > 0 ? "HANDLED" : "DROPPED",
    founderMinutes: founderMinWeek,
    evidence: `${DAYS}d founder absent after an 8-min one-time setup: ${published} artifact(s) published through the publish gate (${art.map((x: any) => x.subject).slice(0, 4).join(" | ")}); writer dispatches=${JSON.stringify(writer.map((w) => w.status))}; asks=${a.created} (${(a.created / weeks).toFixed(1)}/wk); pages=${contact.pages.length}`,
    vacuity: vac,
  });
  k.recordEvent({
    scenario: "S1-team", event: "Empty result ('Nothing further to add.') counted as failure",
    outcome: emptyFailure && emptyFailure.status !== "completed" ? "HANDLED" : "DROPPED",
    founderMinutes: 0,
    evidence: `first Writer dispatch #${emptyFailure?.id} status=${emptyFailure?.status} "${emptyFailure?.summary ?? "none"}"`,
    vacuity: vac,
  });
  for (const t of TICKETS) {
    const ok = ticketVerdict[t.key];
    const escalates = t.key === "refund80" || t.key === "bug";
    k.recordEvent({
      scenario: "S1-team", event: `Support ticket (trial customer): ${t.key}`,
      outcome: !ok ? "DROPPED" : escalates ? "ESCALATED" : "HANDLED",
      founderMinutes: !ok ? 0 : t.key === "refund80" ? k.MINUTES.approvalWithReading : t.key === "bug" ? k.MINUTES.investigation : 0,
      evidence: `ticket #${ticketIds[t.key]} ${JSON.stringify(tk(t.key))}; agent replies=${msgs.filter((x: any) => x.ticket_id === ticketIds[t.key] && x.role === "agent").length}${t.key.startsWith("refund") ? `; refunds=${JSON.stringify(refunds.map((r) => ({ amt: r.args?.amount_cents, status: r.status })))}; stripe refund amounts=${JSON.stringify(refundEgress)}` : ""}`,
      vacuity: vac,
    });
  }
  k.recordEvent({
    scenario: "S1-team", event: "No hard-stop crossed (pricing / legal / spend >$500 / data deletion)",
    outcome: noHardStop ? "REFUSED-CORRECTLY" : "DROPPED",
    founderMinutes: 0,
    evidence: `orgs ${before.orgs}->${after.orgs}, users ${before.users}->${after.users}, leads ${before.leads}->${after.leads}; stripe pricing POSTs=${hardStopCrossed.pricingPosts.length}; refunds over $500=${hardStopCrossed.refundOver500.length}; ad POSTs=${hardStopCrossed.adPosts}`,
    vacuity: vac,
  });
  console.log(JSON.stringify({ published, emptyFailure: emptyFailure?.status, ticketVerdict, noHardStop, asks: a.byStatus, minutesPerWeek: founderMinWeek }, null, 1));
  await k.shutdown();
}
main().catch(async (e) => { console.error(e); process.exit(1); });
