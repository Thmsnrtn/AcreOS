/**
 * Scenarios 2–5: single-customer business events, each entered through the
 * world's own door, then the worker's registered jobs run on the sim clock and
 * the outcome is read from the founder's surfaces + the DB + the egress ledger.
 *
 *   s2  activation — a customer signs up (Clerk user → first request →
 *       getOrCreateOrg creates the org) and never does anything. 16 days
 *       (covers the 14-day in-app trial end).
 *   s3  support — 5 tickets through the customer's support entry
 *       (POST /api/support/tickets) incl. refund $30, refund $80, a "how do I";
 *       the AI first-response runs on the stand-in (script) and escalates;
 *       then a follow-up chat message; then 2 days of jobs.
 *   s4  dunning — a paying customer's invoice fails (signed Stripe webhook
 *       invoice.payment_failed to /api/stripe/webhook), a 2nd attempt fails on
 *       day 3; 8 days of jobs.
 *   s5  churn — a paying customer works for a day (creates leads/notes through
 *       the API), then goes quiet for 15 days of jobs.
 *
 * Founder posture: Dispatch ON (what the Letter tells him to do), otherwise absent.
 */
import * as k from "./simkit";
import { writeSupportScript, writeRetentionScript, roleWorkerRules } from "./roleScripts";

const which = process.argv[2] ?? "s2";

async function baseWorld() {
  await k.resetWorld();
  await k.bootSeed();
  k.resetSimClock();
  k.setEgressRules(k.PROVIDERS_UP);
  k.setStandinRules({ default: "script" });
  await k.q("alter table organizations drop column if exists monthly_price_cents");
  await k.setSwitch("dispatchEnabled", true);
  return k.defaultJobs();
}

async function founderFootprint(orgId: number, words: RegExp) {
  const v = await k.founderView();
  const a = await k.askStats();
  const inbox = await k.q<any>("select id, item_type, status, recommended_action_label, organization_id from decisions_inbox_items where organization_id = $1", [orgId]);
  const askMentions = a.rows.filter((r: any) => words.test(`${r.question_summary}\n${r.question_body}`));
  const todo = await k.founder.get("/api/founder/intelligence/todo?limit=200");
  const todoItems = (todo.body?.items ?? []).filter((i: any) => JSON.stringify(i).includes(String(orgId)) || words.test(JSON.stringify(i)));
  return {
    needsYou: v.needsYou,
    briefNeeded: v.brief?.neededLine,
    briefWord: v.brief?.theWord,
    asksTotal: a.created,
    asksMentioningEvent: askMentions.map((r: any) => ({ id: r.id, status: r.status, summary: r.question_summary })),
    decisionsInboxForOrg: inbox,
    pendingActions: v.pendingActions.length,
    offDoorTodo: { status: todo.status, matching: todoItems.map((i: any) => i.title ?? i.type) },
  };
}

function tickMoves(log: k.JobRunLog[]) {
  return log.filter((l) => l.name === "solene_continuous_tick").reduce((acc: Record<string, number>, l: any) => {
    const key = `${l.result?.actOutcomeStatus}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
async function topMovesSeen() {
  return k.q(`select move_kind, outcome, count(*)::int n from autopilot_experiences group by 1,2 order by 3 desc`);
}

// ── S2 activation ─────────────────────────────────────────────────────────────
async function s2() {
  const jobs = await baseWorld();
  const m = k.marks();
  const { org, user } = await k.signUpCustomer("stall-1");
  const journeys = await k.q("select count(*)::int n from onboarding_journeys where organization_id=$1", [org.id]);
  const log = await k.advance(16 * 24, jobs);
  const contact = k.classifyEgress(m.since().egress);
  const toCustomer = contact.emails.filter((e) => e.to.includes(user.email));
  const nudges = await k.q("select category, created_at from pax_nudges where organization_id=$1", [org.id]).catch((e) => [{ error: String(e) }]);
  const orgAfter = await k.q1<any>("select subscription_tier, subscription_status, trial_ends_at, onboarding_completed from organizations where id=$1", [org.id]);
  const fp = await founderFootprint(org.id, /activation|stall|onboard|trial|stall-1/i);
  const moves = await topMovesSeen();
  const vac = [
    k.vacuity(org?.id, `customer org ${org.id} created by getOrCreateOrg`),
    k.vacuity(log.filter((l) => l.name === "onboarding_sweeper").length >= 380, "onboarding sweeper ran hourly for 16 days"),
    k.vacuity(log.filter((l) => l.name === "trial_engine").length >= 15, "trial engine ran daily"),
  ].join("; ");
  const result = { org: { id: org.id, ...orgAfter }, onboardingJourneysAtSignup: journeys[0]?.n, emailsToCustomer: toCustomer, allEmails: contact.emails, nudges, founder: fp, experiences: moves, tickOutcomes: tickMoves(log), jobSummary: k.jobSummary(log), vacuity: vac };
  k.saveJson("s02-activation.json", result);
  const unblockSeen = moves.some((r: any) => r.move_kind === "unblock_activation");
  k.recordEvent({
    scenario: "S2", event: "New signup stalls before first value",
    outcome: toCustomer.length > 0 ? "HANDLED" : fp.decisionsInboxForOrg.length || fp.asksMentioningEvent.length ? "ESCALATED" : "DROPPED",
    founderMinutes: fp.decisionsInboxForOrg.length * k.MINUTES.investigation + fp.asksMentioningEvent.length * k.MINUTES.approvalWithReading,
    evidence: `onboarding_journeys at signup=${journeys[0]?.n}; customer emails=${toCustomer.length} [${toCustomer.map((e) => e.subject).join(" | ")}]; pax_nudges=${Array.isArray(nudges) ? nudges.length : "?"}; decisions_inbox for org=${fp.decisionsInboxForOrg.length}; asks mentioning=${fp.asksMentioningEvent.length}; unblock_activation ever ranked=${unblockSeen}`,
    vacuity: vac,
  });
  k.recordEvent({
    scenario: "S2", event: "In-app trial ends without conversion (day 14)",
    outcome: toCustomer.some((e) => /trial/i.test(e.subject)) ? "HANDLED" : "DROPPED",
    founderMinutes: 0,
    evidence: `org after 16d: ${JSON.stringify(orgAfter)}; trial-related emails=${toCustomer.filter((e) => /trial/i.test(e.subject)).map((e) => e.subject).join(" | ") || "none"}`,
    vacuity: vac,
  });
  console.log(JSON.stringify({ journeys, toCustomer, fp }, null, 1).slice(0, 3000));
}

// ── S3 support ────────────────────────────────────────────────────────────────
const TICKETS = [
  { key: "refund30", subject: "Refund request", description: "Hi, I was charged $30 for a skip-trace credit pack I never used. Can I get the $30 refunded please?", category: "billing" },
  { key: "refund80", subject: "Please refund $80", description: "I accidentally bought the $80 add-on twice. Please refund one of the $80 charges.", category: "billing" },
  { key: "howdoi", subject: "How do I import my leads?", description: "How do I import a spreadsheet of leads into AcreOS? I have a CSV with owner names and APNs.", category: "general" },
  { key: "bug", subject: "Map won't load", description: "The map page just spins forever since yesterday. I can't see any parcels.", category: "technical" },
  { key: "cancel", subject: "Thinking about cancelling", description: "This is more complicated than I expected. How do I cancel, and will I lose my data?", category: "billing" },
];
async function s3() {
  const jobs = await baseWorld();
  // Stage 2: the founder's one-time setup (levels + bounded grants), so the
  // Support role worker can act and witness its own drafts inside his bounds.
  await k.founderOneTimeSetup();
  const m = k.marks();
  const { org, user, client } = await k.signUpCustomer("support-1");
  // The purchases the two refund tickets are about (Stripe Checkout — the world).
  await k.q(
    `insert into credit_transactions (organization_id, type, amount_cents, balance_after_cents, description, stripe_payment_intent_id)
     values ($1,'purchase',3000,3000,'Skip-trace credit pack','pi_sim_s3_30'), ($1,'purchase',8000,11000,'Comps add-on','pi_sim_s3_80a'), ($1,'purchase',8000,19000,'Comps add-on','pi_sim_s3_80b')`,
    [org.id],
  );
  const created: any[] = [];
  for (const t of TICKETS) {
    const r = await client.post("/api/support/tickets", { subject: t.subject, description: t.description, category: t.category });
    created.push({ key: t.key, status: r.status, id: r.body?.ticket?.id ?? r.body?.id, body: r.status !== 200 && r.status !== 201 ? r.text.slice(0, 200) : undefined });
  }
  // Realistic scripted answers for the Support worker (roleScripts.ts).
  const supportScript = writeSupportScript(created.map((c) => ({ key: c.key, id: c.id, paymentIntentId: c.key === "refund30" ? "pi_sim_s3_30" : undefined })));
  k.setStandinRules({ default: "script", rules: roleWorkerRules({ support: supportScript }) });
  // let the fire-and-forget AI first-response pass settle on the web process
  await new Promise((res) => setTimeout(res, 8000));
  const afterFirst = await k.q<any>("select id, subject, status, resolution_type, ai_handled, ai_confidence_score from support_tickets where organization_id=$1 order by id", [org.id]);
  // the customer follows up in the chat on the refund ticket
  const firstId = created[0]?.id;
  const follow = firstId ? await client.post(`/api/support/tickets/${firstId}/messages`, { content: "Any update on my $30 refund?" }) : null;
  await new Promise((res) => setTimeout(res, 3000));
  const log: k.JobRunLog[] = [];
  for (let h = 0; h < 96; h++) {
    log.push(...(await k.advance(0.5, jobs)));
    if (h % 4 === 3) await k.drainDispatches(90_000);
  }
  const tickets = await k.q<any>("select id, subject, status, resolution_type, assigned_agent, ai_confidence_score from support_tickets where organization_id=$1 order by id", [org.id]);
  const refunds = await k.q<any>("select id, status, args, approved_by from autopilot_pending_actions where hand_name='apply_refund' order by id");
  const msgs = await k.q<any>("select ticket_id, role, left(content, 160) as content from support_ticket_messages where ticket_id = any($1::int[]) order by id", [tickets.map((t) => t.id)]);
  const supportCases = await k.q("select count(*)::int n from support_cases");
  const contact = k.classifyEgress(m.since().egress);
  const toCustomer = contact.emails.filter((e) => e.to.includes(user.email));
  const fp = await founderFootprint(org.id, /support|ticket|refund|customer.*waiting|support-1/i);
  const moves = await topMovesSeen();
  const pendingHands = await k.q("select hand_name, status, count(*)::int n from autopilot_pending_actions group by 1,2").catch(() => []);
  const modelCalls = m.since().modelCalls;
  const vac = [
    k.vacuity(created.filter((c) => c.id).length === 5, "5 tickets created via POST /api/support/tickets"),
    k.vacuity(modelCalls.some((c: any) => /support|ticket|resol/i.test(c.caller ?? "")), "the AI first-response pass reached the model stand-in"),
    k.vacuity(log.filter((l) => l.name === "solene_continuous_tick").length >= 96, "96 Solene ticks ran after the tickets"),
  ].join("; ");
  const result = { created, afterFirstResponse: afterFirst, followUp: follow ? { status: follow.status, body: follow.text.slice(0, 400) } : null, tickets, messages: msgs, supportCasesTableRows: supportCases, emailsToCustomer: toCustomer, founder: fp, experiences: moves, pendingHands, modelCallers: modelCalls.map((c: any) => (c.caller ?? "").slice(0, 90)), tickOutcomes: tickMoves(log), vacuity: vac };
  k.saveJson("s03-support.json", result);
  // Stage 2: a reply is the Support worker's (role 'agent'), witnessed under
  // the founder's grant; a ticket handed to the founder is named in an ask.
  const assistantReplies = (id: number) => msgs.filter((x: any) => x.ticket_id === id && /assistant|agent|pax/i.test(x.role));
  const askNaming = (id: number) => fp.asksMentioningEvent.filter((a: any) => new RegExp(`#${id}\\b`).test(a.summary)).length;
  const executed = refunds.filter((r: any) => r.status === "executed");
  for (const t of TICKETS) {
    const c = created.find((x) => x.key === t.key);
    const row = tickets.find((x: any) => x.id === c?.id);
    const replies = row ? assistantReplies(row.id) : [];
    const named = row ? askNaming(row.id) > 0 : false;
    const refundRight = t.key === "refund30" ? executed.some((r: any) => Number(r.args?.amount_cents) === 3000) : t.key === "refund80" ? !executed.some((r: any) => Number(r.args?.amount_cents) > 5000) : true;
    const outcome: k.Outcome = replies.length > 0 && refundRight ? (named ? "ESCALATED" : "HANDLED") : named ? "ESCALATED" : "DROPPED";
    k.recordEvent({
      scenario: "S3", event: `Support ticket: ${t.key}`,
      outcome,
      founderMinutes: outcome === "ESCALATED" ? (t.key === "refund80" ? k.MINUTES.approvalWithReading : k.MINUTES.investigation) : 0,
      evidence: `ticket #${row?.id} status=${row?.status} assigned=${row?.assigned_agent} resolution=${row?.resolution_type}; agent replies=${replies.length}${replies[0] ? ` ("${replies[0].content.slice(0, 80)}")` : ""}; refunds=${JSON.stringify(refunds.map((r: any) => ({ amt: r.args?.amount_cents, status: r.status })))}; customer emails=${toCustomer.length}; founder asks naming it=${named}; on-door needsYou=${JSON.stringify(fp.needsYou)}`,
      vacuity: vac,
    });
  }
  console.log(JSON.stringify({ afterFirst, tickets, fp, toCustomer: toCustomer.length }, null, 1).slice(0, 4000));
}

// ── S4 dunning ────────────────────────────────────────────────────────────────
async function s4() {
  const jobs = await baseWorld();
  await k.founderOneTimeSetup();
  const m = k.marks();
  const { org, user } = await k.signUpCustomer("pay-1");
  // Retention worker's scripted answer (used only if the dunning service has not emailed).
  k.setStandinRules({ default: "script", rules: roleWorkerRules({ retention: writeRetentionScript(org.id, "payment_recovery") }) });
  // Stripe checkout already happened (the world): the org is a paying Pro customer.
  await k.q(`update organizations set subscription_tier='pro', subscription_status='active', stripe_customer_id='cus_sim_pay1', stripe_subscription_id='sub_sim_pay1' where id=$1`, [org.id]);
  const invoice = (attempt: number) => ({
    id: "in_sim_pay1_0001", object: "invoice", customer: "cus_sim_pay1", amount_due: 9900, amount_paid: 0, attempt_count: attempt,
    status: "open", currency: "usd", parent: { subscription_details: { subscription: "sub_sim_pay1" } },
  });
  const w1 = await k.stripeWebhook("invoice.payment_failed", invoice(1));
  await new Promise((res) => setTimeout(res, 2000));
  const afterW1 = await k.q1<any>("select dunning_stage, subscription_status from organizations where id=$1", [org.id]);
  const log1 = await k.advance(72, jobs);
  const w2 = await k.stripeWebhook("invoice.payment_failed", invoice(2));
  await new Promise((res) => setTimeout(res, 2000));
  const log2 = await k.advance(5 * 24, jobs);
  const log = [...log1, ...log2];
  const orgAfter = await k.q1<any>("select dunning_stage, subscription_status, subscription_tier from organizations where id=$1", [org.id]);
  const dunningEvents = await k.q("select * from dunning_events where organization_id=$1 order by id", [org.id]).catch((e) => [{ error: String(e) }]);
  const senses = await k.q("select kind, value, count(*)::int n from autopilot_senses group by 1,2");
  const contact = k.classifyEgress(m.since().egress);
  const toCustomer = contact.emails.filter((e) => e.to.includes(user.email));
  const fp = await founderFootprint(org.id, /payment|dunning|recover|invoice|finance|pay-1/i);
  const moves = await topMovesSeen();
  const vac = [
    k.vacuity(w1.status === 200 && w2.status === 200, `both signed webhooks accepted (${w1.status}, ${w2.status})`),
    k.vacuity(log.filter((l) => l.name === "dunning_tasks").length >= 30, "dunning task job ran every 6h for 8 days"),
  ].join("; ");
  const result = { webhooks: [w1, w2], afterFirstWebhook: afterW1, orgAfter, dunningEvents, senses, emailsToCustomer: toCustomer, founder: fp, experiences: moves, tickOutcomes: tickMoves(log), stripeEgressRefused: contact.refused.filter((r) => /stripe/.test(r.host)).length, vacuity: vac };
  k.saveJson("s04-dunning.json", result);
  k.recordEvent({
    scenario: "S4", event: "Failed subscription payment → dunning",
    outcome: toCustomer.length > 0 ? "HANDLED" : fp.asksMentioningEvent.length ? "ESCALATED" : "DROPPED",
    founderMinutes: fp.asksMentioningEvent.length * k.MINUTES.approvalWithReading,
    evidence: `dunning_stage after webhook1=${afterW1?.dunning_stage}, after 8d=${orgAfter?.dunning_stage}/${orgAfter?.subscription_status}; customer emails=${toCustomer.length} [${toCustomer.map((e) => e.subject).join(" | ")}]; recover_payments experiences=${JSON.stringify(moves.filter((r: any) => r.move_kind === "recover_payments"))}; founder asks re payment=${fp.asksMentioningEvent.length}`,
    vacuity: vac,
  });
  console.log(JSON.stringify({ afterW1, orgAfter, toCustomer, fp }, null, 1).slice(0, 3000));
}

// ── S5 churn ──────────────────────────────────────────────────────────────────
async function s5() {
  const jobs = await baseWorld();
  await k.founderOneTimeSetup();
  const m = k.marks();
  const { org, user, client } = await k.signUpCustomer("quiet-1");
  k.setStandinRules({ default: "script", rules: roleWorkerRules({ retention: writeRetentionScript(org.id, "win_back") }) });
  await k.q(`update organizations set subscription_tier='pro', subscription_status='active', stripe_customer_id='cus_sim_quiet1' where id=$1`, [org.id]);
  const made: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await client.post("/api/leads", { firstName: `Owner${i}`, lastName: "Parcel", status: "new", state: "TX", city: "Austin", email: `owner${i}@lead.sim.test` });
    made.push(r.status);
  }
  const leadsMade = await k.q1<any>("select count(*)::int n from leads where organization_id=$1", [org.id]);
  const log = await k.advance(16 * 24, jobs); // goes quiet: no further customer activity
  const orgAfter = await k.q1<any>("select churn_risk_score, churn_risk_updated_at, churn_rescue_sent_at from organizations where id=$1", [org.id]);
  const alerts = await k.q("select type, severity, title from system_alerts where organization_id=$1", [org.id]);
  const rungs = await k.q("select rung from pre_churn_rungs where organization_id=$1", [org.id]);
  const contact = k.classifyEgress(m.since().egress);
  const toCustomer = contact.emails.filter((e) => e.to.includes(user.email));
  const fp = await founderFootprint(org.id, /churn|quiet|retain|at.risk|quiet-1/i);
  const moves = await topMovesSeen();
  const vac = [
    k.vacuity(Number(leadsMade?.n ?? 0) >= 1, `customer created ${leadsMade?.n} leads before going quiet (POST statuses ${made.join(",")})`),
    k.vacuity(log.filter((l) => l.name === "churn_engine").length >= 15, "churn engine ran daily"),
  ].join("; ");
  const result = { leadsMade, orgAfter, systemAlerts: alerts, preChurnRungs: rungs, emailsToCustomer: toCustomer, founder: fp, experiences: moves, tickOutcomes: tickMoves(log), vacuity: vac };
  k.saveJson("s05-churn.json", result);
  k.recordEvent({
    scenario: "S5", event: "Paying customer goes quiet 14+ days (churn risk)",
    outcome: toCustomer.length > 0 ? "HANDLED" : fp.asksMentioningEvent.length || fp.decisionsInboxForOrg.length ? "ESCALATED" : "DROPPED",
    founderMinutes: (fp.asksMentioningEvent.length + fp.decisionsInboxForOrg.length) * k.MINUTES.investigation,
    evidence: `churn score=${orgAfter?.churn_risk_score} rescueSent=${orgAfter?.churn_rescue_sent_at}; system_alerts=${alerts.length} (not on any founder door); customer emails=${toCustomer.length} [${toCustomer.map((e) => e.subject).join(" | ")}]; retain_at_risk ranked=${moves.some((r: any) => r.move_kind === "retain_at_risk")}; founder asks=${fp.asksMentioningEvent.length}`,
    vacuity: vac,
  });
  console.log(JSON.stringify({ orgAfter, alerts, toCustomer, fp }, null, 1).slice(0, 3000));
}

const RUN: Record<string, () => Promise<void>> = { s2, s3, s4, s5 };
RUN[which]()
  .then(() => k.shutdown())
  .catch((e) => { console.error(e); process.exit(1); });
