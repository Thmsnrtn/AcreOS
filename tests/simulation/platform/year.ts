/**
 * A YEAR of the business, on the real app, through the one clock.
 *
 * One seed per run (montecarlo.sh runs N seeds, each on a fresh database built
 * from the template). The REAL web and worker serve every customer request and
 * run every dispatch; the harness runs the registered job bodies on the
 * simulated calendar (simkit.defaultJobs — the same functions the worker's
 * timers call, through the real withJobLock) and plays the outside world from
 * the market twin:
 *
 *   - customers arrive on the cohort plan (3 → 25 → 100 by default), each one
 *     of the twin's personas, and live their weeks through the real API:
 *     onboarding, list import, their own Twilio number, mail identity, texts,
 *     emails, postcards, Pax questions, offers, credit-pack purchases;
 *   - sellers answer from the twin (replies worded by its generator, delivered
 *     as signed Twilio webhooks at their virtual time), carriers and providers
 *     fail as the twin decides (provider stand-in rules);
 *   - support tickets come ONLY from friction the app really produced
 *     (classifyResponse over real responses) and from refund requests for
 *     purchases the customer really made;
 *   - churn follows the twin's hazard, moved by what the customer lived;
 *   - three provider outages are caused on purpose (model, Stripe, SES);
 *   - the founder does his one-time setup on day 0, then opens the Letter and
 *     answers what is waiting once a week (approving non-hard-stop moves
 *     against the version he was shown);
 *   - the invariant monitor checks every invariant after EVERY simulated day.
 *
 *   stack.sh harness tests/simulation/platform/year.ts --seed 1 --days 365 [--step 12]
 *     [--plan 0:0,30:3,180:25,365:100] [--brain capable|adversarial] [--list-cap 60]
 *
 * Writes $SIMPLAT_DIR/out/seed-<n>/{metrics.json, daily.jsonl, violations.jsonl}.
 */
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import * as k from "../campaign/founder/simkit";
import { SimClient } from "../campaign/client";
import { classifyResponse } from "../campaign/market/common";
import { Rng } from "../twin/rng";
import { buildWorld, type Owner, type Parcel } from "../twin/world";
import { PARAMS } from "../twin/parameters";
import { smsReply, smsDelivery } from "../twin/responses";
import { PERSONAS, drawPersona, targetCustomers, ticketFromFriction, churnsToday, type PersonaId, type FrictionClass } from "../twin/customers";
import { providerRulesFor, writeProviderRules } from "../twin/providers";
import { InvariantMonitor } from "../invariants/monitor";
import { Collector, truthKey, type GroundTruth } from "./collector";
import { letterScreen } from "../invariants/screens";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name: string, d: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(arg("seed", "1"));
const DAYS = Number(arg("days", "14"));
const STEP_H = Number(arg("step", "12"));
const PLAN = arg("plan", DAYS >= 365 ? "0:0,30:3,180:25,365:100" : `0:1,${Math.max(1, Math.round(DAYS * 0.5))}:2,${DAYS}:3`)
  .split(",").map((p) => p.split(":").map(Number) as [number, number]);
const BRAIN = arg("brain", "capable");
const LIST_CAP = Number(arg("list-cap", "60"));
const DRAIN_MS = Number(arg("drain-ms", "8000"));
const DIR = process.env.SIMPLAT_DIR!;
const REPO = process.env.SIMPLAT_REPO!;
const OUT = join(DIR, "out", `seed-${SEED}${BRAIN === "capable" ? "" : `-${BRAIN}`}`);
mkdirSync(OUT, { recursive: true });
const daily = (o: unknown) => appendFileSync(join(OUT, "daily.jsonl"), JSON.stringify(o) + "\n");

// ── the clock: wall ↔ virtual ────────────────────────────────────────────────
const offsets: Array<{ wallFrom: number; offset: number }> = [];
function clockFileOffset(): number { try { return Number(JSON.parse(readFileSync(process.env.ACREOS_SIM_CLOCK_FILE!, "utf8")).offsetMs) || 0; } catch { return 0; } }
function noteOffset() { offsets.push({ wallFrom: Date.now(), offset: clockFileOffset() }); }
function toVirtual(wallIso: string): string {
  const w = Date.parse(wallIso);
  let off = 0;
  for (const o of offsets) if (o.wallFrom <= w) off = o.offset;
  return new Date(w + off).toISOString();
}
const vnow = () => Date.now() + clockFileOffset();

// ── jobs on the simulated calendar (each due job at most once per step) ─────
async function runStep(jobs: k.SimJob[], fromH: number, toH: number, log: Array<{ name: string; ok: boolean; err?: string }>) {
  for (const j of jobs) {
    const first = j.firstAtH ?? 0;
    let due = false;
    if (j.atUtcHour !== undefined) {
      for (let h = Math.ceil(fromH); h < toH; h++) if (((h % 24) + 24) % 24 === j.atUtcHour) due = true;
    } else {
      const n0 = Math.ceil((fromH - first) / j.everyH - 1e-9), t = first + n0 * j.everyH;
      due = t < toH - 1e-9 && t >= first - 1e-9;
    }
    if (!due) continue;
    try { await j.run(); log.push({ name: j.name, ok: true }); }
    catch (e) { log.push({ name: j.name, ok: false, err: String(e instanceof Error ? e.message : e).slice(0, 200) }); }
  }
}

// ── customers ────────────────────────────────────────────────────────────────
interface Lead { id: number; phone: string | null; email: string | null; owner: Owner; parcel: Parcel }
interface Customer {
  n: number; slug: string; persona: PersonaId; client: SimClient; orgId: number; arrivedDay: number;
  leads: Lead[]; byPhone: Map<string, Lead>; consented: Set<number>; texted: Set<number>; mailed: Set<number>; emailed: Set<number>;
  twilioNumber: string; twilioToken: string; smsReady: boolean; churnedDay: number | null;
  milestones: { imported?: number; firstSend?: number; firstReply?: number; firstOffer?: number };
  monthUnresolved: number; monthValue: number; interested: Lead[]; purchases: Array<{ pi: string; cents: number; asked: boolean }>;
  tickets: number[];
  learnedEmailConsent?: boolean;
}
const customers: Customer[] = [];
let ownerCursor = 0;

function wrapClient(c: SimClient, orgId: number) {
  const orig = c.call.bind(c);
  const ip = `10.${(orgId >> 16) & 255}.${(orgId >> 8) & 255}.${orgId & 255}`;
  (c as any).call = (m: string, p: string, b?: unknown, o?: any) =>
    orig(m, p, b, { ...(o ?? {}), headers: { "cf-connecting-ip": ip, "x-simplat-actor-org": String(orgId), ...(o?.headers ?? {}) } });
}

const friction: Record<string, number> = {};
async function act(c: Customer, label: string, p: Promise<any>, day: number, rng: Rng): Promise<any> {
  const r = await p;
  const cls = classifyResponse(r);
  if (cls) {
    friction[cls] = (friction[cls] ?? 0) + 1;
    daily({ kind: "friction", org: c.orgId, day, label, status: r.status, cls, msg: String(r.body?.message ?? r.body?.error ?? r.text ?? "").slice(0, 200) });
    const fc: FrictionClass | null = cls in PARAMS.ticketPerFriction.value ? (cls as FrictionClass) : cls === "billing_dispute" || cls === "wrong_money_number" ? "silent_noop" : null;
    if (fc) {
      const t = ticketFromFriction(rng, c.slug, day, fc, `${label} → ${r.status} ${String(r.body?.message ?? r.body?.error ?? r.text ?? "").slice(0, 200)}`);
      if (t) await openTicket(c, t.subject, t.body, fc === "manual_request" ? "billing" : "technical");
    }
  }
  return r;
}
async function openTicket(c: Customer, subject: string, description: string, category: string) {
  const r = await c.client.post("/api/support/tickets", { subject, description, category });
  const id = r.body?.ticket?.id ?? r.body?.id;
  if (id) { c.tickets.push(id); counts.ticketsOpened++; }
}

const counts = { signups: 0, churned: 0, smsSent: 0, emailsSent: 0, mailSent: 0, replies: 0, revocations: 0, paxAsked: 0, offers: 0, ticketsOpened: 0, refundRequests: 0, founderSessions: 0, founderAnswers: 0, grantRenewals: 0, dispatchesDrained: 0 };

async function signUp(n: number, day: number, rng: Rng, world: ReturnType<typeof buildWorld>) {
  const persona = drawPersona(rng);
  const spec = PERSONAS[persona];
  const slug = `simplat-s${SEED}-c${n}`;
  const { client, org } = await k.signUpCustomer(slug);
  wrapClient(client, org.id);
  client.setCookie("acreos_active_org", String(org.id));
  const c: Customer = {
    n, slug, persona, client, orgId: org.id, arrivedDay: day, leads: [], byPhone: new Map(), consented: new Set(), texted: new Set(), mailed: new Set(), emailed: new Set(),
    twilioNumber: `+1500555${String(org.id).padStart(4, "0")}`, twilioToken: `tok_simplat_${org.id}_${randomBytes(4).toString("hex")}`, smsReady: false, churnedDay: null,
    milestones: {}, monthUnresolved: 0, monthValue: 0, interested: [], purchases: [], tickets: [],
  };
  customers.push(c);
  counts.signups++;
  await act(c, "onboarding/complete", client.post("/api/onboarding/complete", { businessType: spec.businessType, noteRole: spec.noteRole, orgName: `Simplat ${n} ${spec.label}`, seedSampleData: false }), day, rng);
  // Stripe checkout cannot complete against the stand-in: the plan is set by SQL (recorded once per run).
  await k.q("update organizations set subscription_tier = $2, subscription_status = 'active' where id = $1", [org.id, spec.tier]);
  await act(c, "pax/acknowledge-disclosure", client.post("/api/pax/acknowledge-disclosure", {}), day, rng);
  await act(c, "mail-identities", client.post("/api/mail-identities", { name: `Main ${n}`, companyName: `Simplat ${n} Land LLC`, addressLine1: "PO Box 100", city: "Tucson", state: "AZ", zipCode: "85701", isDefault: true }), day, rng);
  // The list: the twin's parcels, owner MAILING address as the lead address.
  const size = Math.min(LIST_CAP, Math.max(10, Math.round(rng.lognormal(spec.listSize, 0.4) / 5)));
  const slice = world.parcels.slice(ownerCursor, ownerCursor + size);
  ownerCursor += size;
  const rows = slice.map((p) => ({ firstName: p.owner.first, lastName: p.owner.last, address: p.owner.mailLine1, city: "City", state: p.owner.mailState, zip: p.owner.mailZip, county: p.county.name, apn: p.apn, phone: p.owner.phone ?? undefined, email: p.owner.email ?? undefined, propertyState: p.county.state }));
  const imp = await act(c, "leads/csv-import", client.post("/api/leads/csv-import", { rows }), day, rng);
  const db = await k.q<any>("select id, phone, email, apn from leads where organization_id = $1 and deleted_at is null", [org.id]);
  const byApn = new Map(slice.map((p) => [p.apn, p]));
  for (const l of db) {
    const p = byApn.get(l.apn);
    if (!p) continue;
    const lead = { id: l.id, phone: l.phone, email: l.email, owner: p.owner, parcel: p };
    c.leads.push(lead);
    if (l.phone) c.byPhone.set(String(l.phone).replace(/\D/g, "").slice(-10), lead);
  }
  if (c.leads.length && imp.status < 300) c.milestones.imported = day;
  // Their own Twilio number (BYO).
  const sid = `AC${String(org.id).padStart(32, "0")}`;
  const b = await act(c, "byok twilio", client.post("/api/byok", { channel: "twilio", plaintext: `${sid}:${c.twilioToken}:${c.twilioNumber}` }), day, rng);
  c.smsReady = b.status < 300;
  // The VA-run team marks its purchased list consented in bulk (modelled behaviour the market sim recorded as a compliance risk).
  if (persona === "va_team") {
    const ids = c.leads.filter((l) => l.phone).map((l) => l.id);
    if (ids.length) {
      const r = await act(c, "leads/bulk-update consent", client.post("/api/leads/bulk-update", { ids, updates: { tcpaConsent: true, consentSource: "list_vendor" } }), day, rng);
      if (r.status < 300) ids.forEach((i) => c.consented.add(i));
    }
  }
  // A credit pack bought through Stripe Checkout (the world) — what a refund request can be about.
  const cents = rng.bernoulli(0.6) ? 3000 : 8000;
  const pi = `pi_simplat_${org.id}_${randomBytes(3).toString("hex")}`;
  await k.q("insert into credit_transactions (organization_id, type, amount_cents, balance_after_cents, description, stripe_payment_intent_id) values ($1, 'purchase', $2, $2, $3, $4)", [org.id, cents, cents === 3000 ? "Skip-trace credit pack" : "Comps add-on", pi]);
  // Credits for mail and lookups: the same SQL bypass the market cohort records (Stripe cannot charge here).
  await k.q("update organizations set credit_balance = coalesce(credit_balance, '0')::numeric + $2 + 5000 where id = $1", [org.id, cents]);
  // Their own sending identity: the provisioning route the market sim found delivers, with DNS verification bypassed by SQL.
  await act(c, "org/email-identity/provision", client.post("/api/org/email-identity/provision", { fromAddress: `deals@simplat${org.id}.example.org` }), day, rng);
  await k.q("update org_email_identities set status = 'verified' where organization_id = $1", [org.id]).catch(() => null);
  c.purchases.push({ pi, cents, asked: false });
}

// replies the twin scheduled, delivered at their virtual time
const replyQueue: Array<{ dueV: number; c: Customer; lead: Lead; text: string; revokes: boolean; kind: string }> = [];

async function deliverReplies(truth: GroundTruth) {
  replyQueue.sort((a, b) => a.dueV - b.dueV);
  while (replyQueue.length && replyQueue[0].dueV <= vnow()) {
    const r = replyQueue.shift()!;
    const params: Record<string, string> = { From: r.lead.phone!, To: r.c.twilioNumber, Body: r.text, MessageSid: `SM${randomBytes(16).toString("hex")}`, AccountSid: "AC" + "x".repeat(32) };
    const url = "https://sim.acreos.test/api/webhooks/twilio/sms";
    const toSign = url + Object.keys(params).sort().reduce((s, key) => s + key + params[key], "");
    const sig = createHmac("sha1", r.c.twilioToken).update(Buffer.from(toSign, "utf-8")).digest("base64");
    const res = await r.c.client.call("POST", "/api/webhooks/twilio/sms", undefined, { raw: new URLSearchParams(params).toString(), noAuth: true, noCsrf: true, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig, "x-forwarded-proto": "https", "x-forwarded-host": "sim.acreos.test" } });
    counts.replies++;
    if (r.revokes) {
      counts.revocations++;
      const key = truthKey("sms", r.lead.phone!);
      if (!truth.revokedAtVirtual.has(key)) truth.revokedAtVirtual.set(key, r.dueV);
    }
    if (res.status < 300) { r.c.milestones.firstReply ??= Math.floor((r.dueV - startV) / 864e5); if (r.kind === "interested") { r.c.interested.push(r.lead); r.c.monthValue++; } }
    daily({ kind: "reply", org: r.c.orgId, lead: r.lead.id, replyKind: r.kind, status: res.status, at: new Date(r.dueV).toISOString() });
  }
}

const provLog = () => join(DIR, "provider", "provider-calls.jsonl");
const provCount = () => (existsSync(provLog()) ? readFileSync(provLog(), "utf8").split("\n").filter(Boolean).length : 0);
const provSince = (n: number) => (existsSync(provLog()) ? readFileSync(provLog(), "utf8").split("\n").filter(Boolean).slice(n).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : []);

async function customerWeek(c: Customer, day: number, rng: Rng) {
  const spec = PERSONAS[c.persona];
  const { client } = c;
  // texts
  for (let i = 0; i < rng.poisson(spec.weekly.sms); i++) {
    if (!c.smsReady) break;
    const targets = c.leads.filter((l) => l.phone && c.consented.has(l.id) && !c.texted.has(l.id)).slice(0, 10);
    if (!targets.length) break;
    const camp = await act(c, "campaigns sms", client.post("/api/campaigns", { name: `SMS d${day}`, type: "sms", content: "Hi {{firstName}}, this is Sam. Would you sell your land in {{county}} County? Reply STOP to opt out." }), day, rng);
    if (!camp.body?.id) break;
    const before = provCount();
    await act(c, "campaigns send-sms", client.post(`/api/campaigns/${camp.body.id}/send-sms`, { leadIds: targets.map((l) => l.id) }, { headers: { "idempotency-key": `simplat-${c.orgId}-${camp.body.id}` } }), day, rng);
    const msgs = provSince(before).filter((x: any) => x.rail === "twilio" && x.op === "message" && x.from === c.twilioNumber);
    targets.forEach((l) => c.texted.add(l.id));
    for (const m of msgs) {
      counts.smsSent++;
      c.milestones.firstSend ??= day;
      const lead = c.byPhone.get(String(m.to).replace(/\D/g, "").slice(-10));
      if (!lead || m.fail) continue;
      const rep = smsReply(rng, lead.owner, lead.parcel.acres);
      if (rep) replyQueue.push({ dueV: vnow() + rep.delayHours * 3600e3, c, lead, text: rep.text, revokes: rep.revokesConsent, kind: rep.kind });
    }
  }
  // emails
  for (let i = 0; i < rng.poisson(spec.weekly.email); i++) {
    // After one refusal the customer learns email needs consent too and sends only to consented leads.
    const targets = c.leads.filter((l) => l.email && !c.emailed.has(l.id) && (!c.learnedEmailConsent || c.consented.has(l.id))).slice(0, 15);
    if (!targets.length) break;
    const camp = await act(c, "campaigns email", client.post("/api/campaigns", { name: `Email d${day}`, type: "email", subject: "About your land in {{county}} County", content: "<p>Hi {{firstName}},</p><p>We buy vacant land for cash. Would you consider an offer?</p>" }), day, rng);
    if (!camp.body?.id) break;
    const before = provCount();
    const se = await act(c, "campaigns send-email", client.post(`/api/campaigns/${camp.body.id}/send-email`, { leadIds: targets.map((l) => l.id) }), day, rng);
    if (se.status === 400) c.learnedEmailConsent = true;
    const sent = provSince(before).filter((x: any) => (x.rail === "ses" || x.rail === "sendgrid")).length;
    counts.emailsSent += sent;
    if (sent) c.milestones.firstSend ??= day;
    targets.forEach((l) => c.emailed.add(l.id));
  }
  // postcards
  for (let i = 0; i < rng.poisson(spec.weekly.mail); i++) {
    const targets = c.leads.filter((l) => !c.mailed.has(l.id)).slice(0, 10);
    if (!targets.length) break;
    const camp = await act(c, "campaigns mail", client.post("/api/campaigns", { name: `Postcards d${day}`, type: "direct_mail", content: "Hi {firstName}, we buy land in {county} County for cash. Call (520) 555-0100." }), day, rng);
    if (!camp.body?.id) break;
    const before = provCount();
    await act(c, "campaigns send-direct-mail", client.post(`/api/campaigns/${camp.body.id}/send-direct-mail`, { pieceType: "postcard_4x6", leadIds: targets.map((l) => l.id) }, { headers: { "idempotency-key": `simplat-dm-${c.orgId}-${camp.body.id}` } }), day, rng);
    const pieces = provSince(before).filter((x: any) => x.rail === "lob" && /POST/.test(x.op) && !x.rejected).length;
    counts.mailSent += pieces;
    if (pieces) c.milestones.firstSend ??= day;
    targets.forEach((l) => c.mailed.add(l.id));
    for (const l of targets) if (rng.bernoulli(PARAMS.mailCallbackRate.value * (0.5 + l.owner.motivation))) { c.interested.push(l); c.monthValue++; }
  }
  // Pax
  for (let i = 0; i < rng.poisson(spec.weekly.pax); i++) {
    const q = rng.pick(PAX_QUESTIONS[c.persona]);
    await act(c, "ai/chat", client.post("/api/ai/chat", { message: q }), day, rng);
    counts.paxAsked++;
  }
  // pipeline: call back interested sellers, make offers
  for (const l of c.interested.splice(0, Math.max(1, rng.poisson(spec.weekly.pipeline)))) {
    await act(c, "leads contact-event", client.post(`/api/leads/${l.id}/contact-event`, { channel: "phone", method: "manual", outcome: "warm" }), day, rng);
    if (l.phone && !c.consented.has(l.id)) {
      const r = await act(c, "leads consent (verbal)", client.patch(`/api/leads/${l.id}/consent`, { tcpaConsent: true, consentSource: "verbal_phone_call" }), day, rng);
      if (r.status < 300) c.consented.add(l.id);
    }
    const prop = await act(c, "properties", client.post("/api/properties", { apn: l.parcel.apn, county: l.parcel.county.name, state: l.parcel.county.state, sizeAcres: String(l.parcel.acres) }), day, rng);
    if (prop.body?.id) {
      const o = await act(c, "offers", client.post("/api/offers", { leadId: l.id, propertyId: prop.body.id, status: "sent", cashOffer: String(Math.max(1000, Math.round(l.parcel.assessedUsd * 0.6))) }), day, rng);
      if (o.body?.id) { counts.offers++; c.milestones.firstOffer ??= day; }
    }
  }
  // a refund request about a purchase the customer really made
  const p = c.purchases.find((x) => !x.asked);
  if (p && rng.bernoulli(PARAMS.refundRequestPerCustomerWeek.value)) {
    p.asked = true;
    counts.refundRequests++;
    await openTicket(c, `Please refund $${p.cents / 100}`, `I was charged $${p.cents / 100} for something I didn't use. Can I get the $${p.cents / 100} refunded please?`, "billing");
  }
}

const PAX_QUESTIONS: Record<PersonaId, string[]> = {
  land_flipper: ["How do I import my list of owners?", "Why didn't my texts go out?", "How do I send postcards to my leads?", "What does do-not-contact mean for my campaign?", "How do I make an offer on a parcel?"],
  note_investor: ["How do I record a borrower payment?", "Where do I see late payments?", "How do I set up a new note?", "Can AcreOS collect payments for me?", "How do I send a payoff quote?"],
  va_team: ["How do I give my VA access?", "Can my VA send texts?", "How do I see what my VA did today?", "How do I import a list for my team?", "Why was a text blocked?"],
};

// ── founder ──────────────────────────────────────────────────────────────────
async function founderSession(truth: GroundTruth) {
  counts.founderSessions++;
  await k.founder.get("/api/founder/solene/brief");
  const open = (await k.founder.get("/api/founder/asks?status=open&limit=100")).body?.asks ?? [];
  for (const a of open) {
    const full = (await k.founder.get(`/api/founder/asks/${a.id}`)).body?.ask;
    if (!full) continue;
    const acts = full.actsPayload ? { moveKind: full.actsPayload.moveKind, domain: full.actsPayload.domain } : null;
    if (full.answerFormat === "yes_no") {
      // He approves an ordinary move after reading it, and declines anything that smells of a hard-stop.
      const hard = /pric|legal|sign|delet|\$[5-9]\d\d|\$\d{4,}/i.test(`${full.questionSummary} ${full.questionBody}`);
      const answer: "yes" | "no" = hard ? "no" : "yes";
      const r = await k.founder.post(`/api/founder/asks/${a.id}/answer`, { answerText: answer, expectedBodyHash: full.bodyHash ?? undefined });
      if (r.status < 300) { counts.founderAnswers++; truth.approvalsShown.set(a.id, { shownHash: full.bodyHash ?? null, shownActs: acts, answer }); }
    } else if (full.answerFormat === "free_text") {
      const r = await k.founder.post(`/api/founder/asks/${a.id}/answer`, { answerText: "Handled it myself.", expectedBodyHash: full.bodyHash ?? undefined });
      if (r.status < 300) counts.founderAnswers++;
    }
  }
}

/** The Letter as a screen (tests/simulation/invariants/screens.ts — the same extraction the unit test pins). */
async function readLetter(truth: GroundTruth) {
  const r = await k.founder.get("/api/founder/solene/brief");
  const b = r.body?.brief;
  if (!b) return;
  // The Letter's narrative is composed from the persisted morning pulse too; its fields count as sources.
  const pulse = (await k.founder.get("/api/founder/solene/morning-pulse")).body?.pulse;
  truth.screens.push(letterScreen(b, pulse));
}

// ── main ─────────────────────────────────────────────────────────────────────
let startV = 0;
async function main() {
  const t0 = Date.now();
  console.log(`simplat year: seed=${SEED} days=${DAYS} step=${STEP_H}h brain=${BRAIN} plan=${JSON.stringify(PLAN)}`);
  const rng = new Rng(SEED);
  const world = buildWorld(SEED, { parcels: 14000 });
  writeProviderRules(join(DIR, "provider"), providerRulesFor(world));
  k.setEgressRules(k.PROVIDERS_UP);
  k.setStandinRules({ default: `brain:${REPO}/tests/simulation/standin/brains/${BRAIN}.mjs`, rules: [] });
  await k.bootSeed();
  if (!(await k.startVirtualClock())) throw new Error("VACUOUS: the simulation database has no simclock — the year would run on the wall clock");
  noteOffset();
  startV = vnow();
  const setup = await k.founderOneTimeSetup();
  const jobs = await k.defaultJobs();
  const monitor = new InvariantMonitor(join(OUT, "violations.jsonl"));
  const collector = new Collector(k.q, DIR, toVirtual);
  await collector.init();
  const truth: GroundTruth = { revokedAtVirtual: new Map(), outages: [], founderTaps: [], approvalsShown: new Map(), screens: [] };
  const outagePlan = [
    { provider: "model_provider", names: ["model"], fromDay: Math.floor(DAYS * 0.3), hours: 24 },
    { provider: "stripe", names: ["Stripe"], fromDay: Math.floor(DAYS * 0.6), hours: 36 },
    { provider: "email_provider", names: ["Email", "SES"], fromDay: Math.floor(DAYS * 0.85), hours: 8 },
  ];
  const jobLog: Array<{ name: string; ok: boolean; err?: string }> = [];
  const metrics = { weeks: [] as Array<{ week: number; customers: number; askMinutes: number; dropMinutes: number; pageMinutes: number; setupMinutes: number; total: number; asks: number; pages: number; dropped: number }>, wallSeconds: 0 };
  let weekAskMark = 0, weekPageMark = 0;

  for (let day = 0; day < DAYS; day++) {
    const dayStartH = day * 24;
    const tJobs0 = Date.now();
    // 00:00 → 16:00: jobs
    for (let h = 0; h < 16; h += STEP_H) {
      const to = Math.min(16, h + STEP_H);
      await runStep(jobs, dayStartH + h, dayStartH + to, jobLog);
      await k.setVirtualTime(startV + (dayStartH + to) * 3600e3); noteOffset();
    }
    // outages, by ground truth
    for (const o of outagePlan) {
      const fromV = startV + o.fromDay * 864e5 + 16 * 3600e3, toV = fromV + o.hours * 3600e3;
      const now = vnow();
      const on = now >= fromV && now < toV;
      if (on && !truth.outages.some((x) => x.provider === o.provider && x.to == null)) truth.outages.push({ provider: o.provider, names: o.names, from: new Date(now).toISOString(), to: null });
      const w = truth.outages.find((x) => x.provider === o.provider && x.to == null);
      if (!on && w && now >= toV) w.to = new Date(now).toISOString();
    }
    const down = new Set(truth.outages.filter((x) => x.to == null).map((x) => x.provider));
    k.setStandinRules({ default: down.has("model_provider") ? "fail:500" : `brain:${REPO}/tests/simulation/standin/brains/${BRAIN}.mjs`, rules: [] });
    k.setEgressRules({ ...k.PROVIDERS_UP, ...(down.has("stripe") ? { "stripe.com": "refuse" } : {}) });
    const pr = JSON.parse(readFileSync(join(DIR, "provider", "provider-rules.json"), "utf8"));
    pr.sesDown = down.has("email_provider");
    writeFileSync(join(DIR, "provider", "provider-rules.json"), JSON.stringify(pr));

    // 16:00: the customers' day (local morning across the US)
    const target = targetCustomers(day, { at: PLAN });
    while (customers.length < target) await signUp(customers.length + 1, day, rng, world);
    await deliverReplies(truth);
    const tCust = Date.now();
    for (const c of customers) {
      // Each customer works its week on its own weekday — and right away on the day it arrives.
      if (c.churnedDay != null || ((c.n + day) % 7 !== 0 && c.arrivedDay !== day)) continue;
      await customerWeek(c, day, rng.fork(`${c.n}:${day}`));
    }
    for (const c of customers) {
      if (c.churnedDay != null) continue;
      const unresolved = c.tickets.length ? Number((await k.q1<any>("select count(*)::int n from support_tickets where id = any($1::int[]) and status not in ('resolved','closed')", [c.tickets]))?.n ?? 0) : 0;
      if (churnsToday(rng, c.persona, { unresolvedTickets: unresolved, valueEvents: c.monthValue })) {
        c.churnedDay = day;
        counts.churned++;
        await act(c, "subscription/cancel", c.client.post("/api/subscription/cancel", { reason: rng.pick(["too_expensive", "not_using", "missing_features"] as const), feedback: unresolved ? "Support didn't solve my problem" : "Not using it enough" }), day, rng);
      }
      if (day % 30 === 29) c.monthValue = 0;
    }
    const custMs = Date.now() - tCust;
    let drainMs = 0;
    // the founder: weekly, and the two 30-day grants renewed every four weeks
    if (day % 7 === 6) await founderSession(truth);
    if (day % 28 === 27) { await k.issueFounderGrants(); counts.grantRenewals++; }

    // 16:00 → 24:00: jobs, and the worker drains what they queued
    for (let h = 16; h < 24; h += STEP_H) {
      const to = Math.min(24, h + STEP_H);
      await runStep(jobs, dayStartH + h, dayStartH + to, jobLog);
      const d = await k.drainDispatches(DRAIN_MS);
      drainMs += d.waitedMs;
      if (d.drained) counts.dispatchesDrained++;
      await k.setVirtualTime(startV + (dayStartH + to) * 3600e3); noteOffset();
    }
    await deliverReplies(truth);
    await readLetter(truth);
    const obs = await collector.observe(new Date(vnow()).toISOString(), truth, 0);
    const v = monitor.observe(obs);
    if (v.length) console.log(`  day ${day + 1}: ${v.length} invariant violation(s): ${v.slice(0, 3).map((x) => `${x.invariant}: ${x.evidence.slice(0, 120)}`).join(" | ")}`);

    // founder minutes, weekly (the autonomy ledger's minutes model)
    if (day % 7 === 6 || day === DAYS - 1) {
      const asks = await k.q<any>("select id, answer_format, question_body from solene_founder_asks where id > $1 order by id", [weekAskMark]);
      if (asks.length) weekAskMark = asks[asks.length - 1].id;
      const askMinutes = asks.reduce((a, r) => a + k.priceAsk({ answerFormat: r.answer_format, questionBody: r.question_body }), 0);
      const pages = await k.q<any>("select id from solene_page_events where id > $1", [weekPageMark]);
      if (pages.length) weekPageMark = Math.max(...pages.map((p) => p.id));
      const dropped = Number((await k.q1<any>(`select count(*)::int n from support_tickets where status not in ('resolved','closed') and coalesce(assigned_agent,'') <> 'founder' and created_at < now() - interval '3 days' and created_at >= now() - interval '10 days'`))?.n ?? 0);
      const week = Math.floor(day / 7) + 1;
      const row = { week, customers: customers.filter((c) => c.churnedDay == null).length, askMinutes, dropMinutes: dropped * k.MINUTES.investigation, pageMinutes: pages.length * k.MINUTES.yesNo, setupMinutes: week === 1 ? k.SETUP_MINUTES : week % 4 === 0 ? k.MINUTES.approvalWithReading : 0, total: 0, asks: asks.length, pages: pages.length, dropped };
      row.total = row.askMinutes + row.dropMinutes + row.pageMinutes + row.setupMinutes;
      metrics.weeks.push(row);
      console.log(`  week ${week}: customers=${row.customers} founder-min=${row.total} (asks ${asks.length}=${askMinutes}m, dropped ${dropped}, pages ${pages.length}) violations=${monitor.violations.length} wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    daily({ kind: "day", day, wallMs: { total: Date.now() - tJobs0, customers: custMs, drain: drainMs }, customers: customers.filter((c) => c.churnedDay == null).length, violations: monitor.violations.length, counts: { ...counts } });
  }
  await k.drainDispatches(60_000);

  // ── the year's outcome, measured from the DB and the logs ──
  const tickets = await k.q<any>("select id, status, assigned_agent, resolution_type, created_at from support_tickets where organization_id = any($1::int[])", [customers.map((c) => c.orgId)]);
  const handled = tickets.filter((t) => ["resolved", "closed"].includes(t.status) && t.assigned_agent !== "founder").length;
  const escalated = tickets.filter((t) => t.assigned_agent === "founder").length;
  const dropped = tickets.length - handled - escalated;
  const ai = await k.q<any>("select organization_id o, coalesce(sum(estimated_cost_cents),0)::float c from ai_telemetry_events group by 1");
  const customerIds = new Set(customers.map((c) => c.orgId));
  const aiCustomerCents = ai.filter((r) => customerIds.has(r.o)).reduce((a, r) => a + r.c, 0);
  const aiPlatformCents = ai.filter((r) => !customerIds.has(r.o)).reduce((a, r) => a + r.c, 0);
  const customerMonths = customers.reduce((a, c) => a + Math.max(1, ((c.churnedDay ?? DAYS) - c.arrivedDay) / 30), 0);
  const activated = customers.filter((c) => c.milestones.imported != null && c.milestones.firstSend != null && c.milestones.firstSend - c.arrivedDay <= 30).length;
  const summary = monitor.summary();
  const compliance = monitor.violations.filter((v) => ["no-send-without-consent", "no-platform-counterparty-mail", "customer-money-not-on-platform"].includes(v.invariant)).length;
  const weeksTotal = metrics.weeks.map((w) => w.total);
  const result = {
    seed: SEED, days: DAYS, stepHours: STEP_H, brain: BRAIN, plan: PLAN, wallSeconds: Math.round((Date.now() - t0) / 1000), setup,
    founderMinutesPerWeek: { mean: weeksTotal.reduce((a, b) => a + b, 0) / Math.max(1, weeksTotal.length), weeks: metrics.weeks },
    support: { tickets: tickets.length, handled, escalated, dropped },
    complianceIncidents: compliance,
    invariants: summary,
    customers: { signedUp: customers.length, activated, churned: counts.churned, byPersona: Object.fromEntries((["land_flipper", "note_investor", "va_team"] as const).map((p) => [p, customers.filter((c) => c.persona === p).length])) },
    aiCost: { customerCentsPerCustomerMonth: aiCustomerCents / Math.max(1, customerMonths), platformCentsPerCustomerMonth: aiPlatformCents / Math.max(1, customerMonths), customerMonths },
    counts, friction,
    jobs: Object.entries(jobLog.reduce((a: Record<string, { runs: number; failed: number; lastErr?: string }>, l) => { const b = (a[l.name] ??= { runs: 0, failed: 0 }); b.runs++; if (!l.ok) { b.failed++; b.lastErr = l.err; } return a; }, {})),
    coverage: collector.coverage,
    outages: truth.outages,
    vacuity: {
      virtualClock: true,
      customersActed: counts.smsSent + counts.emailsSent + counts.mailSent > 0,
      tapInspected: collector.coverage.queriesInspected > 0,
      tapSawOrgColumns: collector.coverage.queriesWithOrgColumn > 0,
      sendsChecked: collector.coverage.sends,
      letterRead: collector.coverage.screens,
    },
  };
  writeFileSync(join(OUT, "metrics.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ seed: SEED, founderMinPerWeek: result.founderMinutesPerWeek.mean, support: result.support, compliance, violations: summary.violations, customers: result.customers, aiCost: result.aiCost, wall: result.wallSeconds }));
  await k.shutdown(0);
}
main().catch(async (e) => { console.error(e); await k.shutdown(1); });
