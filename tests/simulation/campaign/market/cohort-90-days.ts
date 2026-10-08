/**
 * THE 90-DAY MARKET COHORT — 25 customer orgs, each living its first 13 weeks
 * through the real API of a local production build, with Postgres, the model
 * stand-in and the provider stand-in (SES / Twilio / Lob) as the oracles.
 *
 * TIME IS COMPRESSED, HONESTLY. Each org runs 13 TENURE weeks back to back;
 * nothing waits a real week. The calendar is applied afterwards: burden.ts
 * places each org's tenure weeks on the cohort calendar using its arrival day
 * (three arrival curves: 3, 10 and 25 customers by day 90). Behaviour that
 * depends on elapsed time is only claimed where this sim TRIGGERED it:
 *   - contact-frequency cap: lead_activities.created_at of the org is aged
 *     7 days before each tenure week (the cap reads that ledger);
 *   - sequences: next_step_scheduled_at is shifted into the past and the
 *     RUNNING WORKER's 60 s sequence processor picks it up (waited for);
 *   - quiet hours: evaluated by the product on the REAL clock at send time —
 *     the cohort runs inside 15:00–01:00 UTC, and time-edges.ts covers DST;
 *   - late fees, trials, dunning, payment due dates: NOT triggered here
 *     (the migration-built DB cannot record a payment); notes-money-push.ts
 *     drives them on the push-built DB with an explicit clock.
 *
 * WHAT IS REAL vs MODELLED
 *   real:     every product call, every gate, every DB write, every send the
 *             product attempted (provider-calls.jsonl), every refusal message.
 *   modelled: what customers DO (list sizes, reply mix, who calls back) — the
 *             reply mix is stated in REPLY_MIX; the seed is fixed.
 *   bypassed (said each time, with a burden row when a customer would have
 *   needed the owner): Stripe checkout / credit purchase (Stripe unconfigured
 *   here → tier and credits set by SQL), DNS verification of email domains.
 *
 * Outputs (MARKET_OUT): cohort-steps.jsonl, burden.jsonl, cohort-orgs.json,
 * cohort-replies.jsonl. Compliance + money audits run at the end over the
 * provider log and the DB.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { transformSync } from "esbuild";
import {
  DB_LABEL, q, one, count, provisionOrg, msg, jsonl, writeJson, burden, classifyResponse, rnd, reseed, pick,
  ensureDefaultE2eUser, postTwilioSms, standinCalls, SimClient, giveOwnIp, type Org, type Resp, type BurdenClass, reEsc } from "./common";
import { personaTestUserId } from "../../../../server/auth/testAuth";
import { PAX_QUESTIONS } from "./pax-questions";
import { ARRIVAL_25, REPLY_RATE, REPLY_MIX, MAIL_CALLBACK_RATE } from "./parameters";
export { ARRIVAL_3, ARRIVAL_10, ARRIVAL_25, REPLY_RATE, REPLY_MIX } from "./parameters";
import { recordMetric, recordSkip } from "../ledger";

const SIM = "market-cohort";
const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDER_DIR = process.env.PROVIDER_DIR ?? "";
const PROVIDER_LOG = join(PROVIDER_DIR, "provider-calls.jsonl");
const ONLY = process.env.COHORT_ONLY ? new Set(process.env.COHORT_ONLY.split(",").map(Number)) : null;
const WEEKS = Number(process.env.COHORT_WEEKS ?? 13);
const PARALLEL = Number(process.env.COHORT_PARALLEL ?? 5);

// ─── the cohort ──────────────────────────────────────────────────────────────
type Kind = "land" | "note" | "wholesale" | "team" | "hybrid";
interface Spec {
  n: number; kind: Kind; businessType: string; noteRole?: string; tier: "starter" | "pro" | "scale"; rows: number;
  smsVia: "byok" | "integrations-then-byok" | "starter-manual" | "none";
  upgradeWeek?: number; downgradeWeek?: number; cancelWeek?: number; exportWeek?: number; deleteWeek?: number; vas?: number; badMailForm?: boolean;
}
// The first 3 and first 10 are deliberately a representative mix: the 3- and
// 10-customer bands are the first N of this list on their own arrival curves.
export const COHORT: Spec[] = [
  { n: 1, kind: "land", businessType: "land_flipper", tier: "pro", rows: 380, smsVia: "integrations-then-byok", exportWeek: 9 },
  { n: 2, kind: "note", businessType: "note_investor", noteRole: "invest", tier: "pro", rows: 120, smsVia: "none" },
  { n: 3, kind: "land", businessType: "land_flipper", tier: "starter", rows: 220, smsVia: "starter-manual", upgradeWeek: 6 },
  { n: 4, kind: "wholesale", businessType: "residential_wholesaler", tier: "pro", rows: 400, smsVia: "byok" },
  { n: 5, kind: "team", businessType: "land_flipper", tier: "scale", rows: 450, smsVia: "byok", vas: 2 },
  { n: 6, kind: "land", businessType: "land_flipper", tier: "starter", rows: 200, smsVia: "starter-manual", cancelWeek: 7, badMailForm: true },
  { n: 7, kind: "hybrid", businessType: "hybrid", tier: "pro", rows: 300, smsVia: "byok", downgradeWeek: 8 },
  { n: 8, kind: "note", businessType: "note_investor", noteRole: "invest", tier: "starter", rows: 60, smsVia: "none", deleteWeek: 11 },
  { n: 9, kind: "land", businessType: "land_flipper", tier: "pro", rows: 350, smsVia: "integrations-then-byok" },
  { n: 10, kind: "wholesale", businessType: "residential_wholesaler", tier: "pro", rows: 400, smsVia: "byok", cancelWeek: 10 },
  { n: 11, kind: "land", businessType: "land_flipper", tier: "starter", rows: 240, smsVia: "starter-manual" },
  { n: 12, kind: "land", businessType: "land_flipper", tier: "pro", rows: 380, smsVia: "byok", exportWeek: 6 },
  { n: 13, kind: "note", businessType: "note_investor", noteRole: "invest", tier: "pro", rows: 90, smsVia: "none" },
  { n: 14, kind: "team", businessType: "land_flipper", tier: "scale", rows: 450, smsVia: "byok", vas: 1 },
  { n: 15, kind: "land", businessType: "land_flipper", tier: "starter", rows: 230, smsVia: "starter-manual", badMailForm: true },
  { n: 16, kind: "wholesale", businessType: "residential_wholesaler", tier: "pro", rows: 420, smsVia: "integrations-then-byok" },
  { n: 17, kind: "land", businessType: "land_flipper", tier: "pro", rows: 360, smsVia: "byok", downgradeWeek: 9 },
  { n: 18, kind: "hybrid", businessType: "hybrid", tier: "pro", rows: 280, smsVia: "byok" },
  { n: 19, kind: "land", businessType: "land_flipper", tier: "starter", rows: 210, smsVia: "starter-manual", upgradeWeek: 5 },
  { n: 20, kind: "note", businessType: "note_investor", noteRole: "invest", tier: "pro", rows: 80, smsVia: "none", cancelWeek: 12 },
  { n: 21, kind: "land", businessType: "land_flipper", tier: "pro", rows: 390, smsVia: "byok" },
  { n: 22, kind: "wholesale", businessType: "residential_wholesaler", tier: "pro", rows: 410, smsVia: "byok" },
  { n: 23, kind: "land", businessType: "land_flipper", tier: "starter", rows: 200, smsVia: "starter-manual", upgradeWeek: 4 },
  { n: 24, kind: "land", businessType: "land_flipper", tier: "pro", rows: 370, smsVia: "integrations-then-byok", exportWeek: 4 },
  { n: 25, kind: "land", businessType: "land_flipper", tier: "pro", rows: 340, smsVia: "byok" },
];

// ─── list generation (list-broker shape: what customers actually buy) ────────
const SURN = ["SMITH", "JOHNSON", "GARCIA", "MARTINEZ", "BROWN", "LOPEZ", "DAVIS", "MILLER", "WILSON", "ANDERSON", "TAYLOR", "THOMAS", "MOORE", "JACKSON", "WHITE", "HARRIS", "CLARK", "LEWIS", "YOUNG", "NGUYEN"];
const GIV = ["John", "Mary", "Robert", "Patricia", "James", "Linda", "Michael", "Barbara", "David", "Elizabeth", "William", "Jennifer", "Richard", "Maria", "Jose", "Susan"];
// [state, city, zip, area code, IANA zone] — absentee owners live everywhere
const HOMES: Array<[string, string, string, string, string]> = [
  ["CA", "Los Angeles", "90012", "213", "America/Los_Angeles"], ["TX", "Houston", "77002", "713", "America/Chicago"], ["IL", "Chicago", "60601", "312", "America/Chicago"],
  ["NJ", "Newark", "07102", "973", "America/New_York"], ["MA", "Boston", "02108", "617", "America/New_York"], ["FL", "Miami", "33101", "305", "America/New_York"],
  ["AZ", "Phoenix", "85004", "602", "America/Phoenix"], ["WA", "Seattle", "98101", "206", "America/Los_Angeles"], ["CO", "Denver", "80202", "303", "America/Denver"],
  ["NY", "Buffalo", "14202", "716", "America/New_York"], ["GA", "Atlanta", "30303", "404", "America/New_York"], ["OR", "Portland", "97201", "503", "America/Los_Angeles"],
];
const PARCELS: Array<[string, string, string, string]> = [["AZ", "Cochise", "Willcox", "85643"], ["AZ", "Mohave", "Kingman", "86401"], ["NM", "Luna", "Deming", "88030"], ["TX", "Hudspeth", "Sierra Blanca", "79851"], ["CO", "Costilla", "San Luis", "81152"]];
interface Truth { apn: string; owner: string; mailAddr: string; mailCity: string; mailState: string; mailZip: string; mailZone: string; situsAddr: string; phone: string | null; email: string | null; parcelState: string; county: string }
function buildList(spec: Spec): { csv: string; truth: Truth[] } {
  reseed(1000 + spec.n);
  const truth: Truth[] = [];
  // phones are unique per org AND per cohort so a reply routes to one lead
  for (let i = 0; i < spec.rows; i++) {
    const h = HOMES[Math.floor(rnd() * HOMES.length)];
    const p = PARCELS[i % PARCELS.length];
    const g = pick(GIV), s = pick(SURN);
    const apn = `${100 + spec.n}-${String(i % 100).padStart(2, "0")}-${String(i).padStart(4, "0")}`;
    const phoneOk = rnd() < (spec.kind === "wholesale" ? 0.7 : 0.5);
    truth.push({
      apn, owner: `${g} ${s}`, mailAddr: `${100 + ((i * 37) % 9800)} ${["N Main St", "E Elm Ave", "W Oak Dr", "S 4th St"][i % 4]}`,
      mailCity: h[1], mailState: h[0], mailZip: h[2], mailZone: h[4],
      situsAddr: i % 3 === 0 ? "" : `${1000 + i} ${["Cholla Rd", "Sage Ln", "Mesa Trl"][i % 3]}`,
      phone: phoneOk ? `+1${h[3]}${String(200 + spec.n).padStart(3, "0")}${String(i).padStart(4, "0")}` : null,
      email: rnd() < 0.3 ? `${g.toLowerCase()}.${s.toLowerCase()}.${spec.n}.${i}@example.net` : null,
      parcelState: p[0], county: p[1],
    });
  }
  const H = ["Owner 1 First Name", "Owner 1 Last Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Property Address", "Property City", "Property State", "Property Zip", "APN", "County", "Phone 1", "Email"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = truth.map((t, i) => {
    const p = PARCELS[i % PARCELS.length];
    return [t.owner.split(" ")[0], t.owner.split(" ")[1], t.mailAddr, t.mailCity, t.mailState, t.mailZip, t.situsAddr, p[2], p[0], p[3], t.apn, p[1], t.phone ?? "", t.email ?? ""];
  });
  return { csv: [H.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n"), truth };
}

// the client's own CSV parser + header heuristic (as csv-imports.ts)
const sheetSrc = readFileSync(join(HERE, "../../../../client/src/components/leads/CsvImportSheet.tsx"), "utf8");
function extractFn(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`CsvImportSheet.tsx no longer declares ${name}()`);
  const open = src.lastIndexOf("{", src.indexOf("\n", start));
  let depth = 0;
  for (let j = open; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1); }
  throw new Error(`unterminated ${name}()`);
}
const sheetMod: any = { exports: {} };
new Function("module", "exports", transformSync(`${extractFn(sheetSrc, "suggestField")}\n${extractFn(sheetSrc, "parseCsv")}\nmodule.exports={suggestField,parseCsv};`, { loader: "ts", format: "cjs" }).code)(sheetMod, sheetMod.exports);
function sheetRows(csv: string) {
  const { headers, rows } = sheetMod.exports.parseCsv(csv);
  const map = headers.map((h: string) => sheetMod.exports.suggestField(h));
  return rows.map((r: string[]) => { const o: Record<string, string> = {}; map.forEach((t: string, i: number) => { if (t !== "skip" && r[i]) o[t] = r[i]; }); return o; });
}

// ─── per-org context ─────────────────────────────────────────────────────────
interface Lead { id: number; phone: string | null; email: string | null; apn: string | null; truth: Truth }
interface Ctx {
  spec: Spec; org: Org; arrival: number; week: number; leads: Lead[]; byPhone: Map<string, Lead>;
  consented: Set<number>; texted: Map<number, number>; mailed: Set<number>; emailed: Set<number>;
  optedOut: Map<number, { week: number; how: string; carrierBlocked: boolean; at: string; prodSig: number }>;
  interested: Lead[]; propertyFor: Map<number, number>; offers: Array<{ id: number; lead: Lead; week: number; status: string }>;
  deals: Array<{ id: number; stage: string }>; notes: number[]; smsReady: boolean; twilioToken: string | null; twilioNumber: string | null;
  smsCampaigns: Array<{ id: number; leadIds: number[] }>; mailCreditsCents: number; paxAsked: number; vaClients: SimClient[]; cancelled: boolean;
  charged: { email: number; sms: number; mail: number; offerLetter: number };
}
const ctxs: Ctx[] = [];
const day = (c: Ctx) => c.arrival + (c.week - 1) * 7 + Math.floor(rnd() * 5);

async function act(c: Ctx, label: string, p: Promise<Resp>, o: { cls?: BurdenClass | null; key?: string; what?: string } = {}): Promise<Resp> {
  const r = await p;
  const auto = classifyResponse(r);
  const cls = o.cls === null ? null : o.cls ?? auto;
  jsonl("cohort-steps.jsonl", { org: c.org.slug, n: c.spec.n, kind: c.spec.kind, tier: c.spec.tier, week: c.week, label, status: r.status, ms: Math.round(r.ms), msg: r.status >= 300 ? msg(r) : undefined, cls: cls ?? undefined });
  if (cls) burden({ org: c.org.slug, orgId: c.org.orgId, persona: c.spec.kind, day: day(c), tenureWeek: c.week, cls, what: o.what ?? `${label} → ${r.status}`, evidence: `${r.status} ${msg(r)}`.slice(0, 300), key: o.key ?? `${label.replace(/\d+/g, "#")}|${r.status}` } as any);
  return r;
}
function note(c: Ctx, cls: BurdenClass, what: string, evidence: string, extra: Record<string, unknown> = {}) {
  burden({ org: c.org.slug, orgId: c.org.orgId, persona: c.spec.kind, day: day(c), tenureWeek: c.week, cls, what, evidence: evidence.slice(0, 400), ...extra } as any);
}
const provCount = () => (existsSync(PROVIDER_LOG) ? readFileSync(PROVIDER_LOG, "utf8").split("\n").filter(Boolean).length : 0);
const provSince = (n: number) => (existsSync(PROVIDER_LOG) ? readFileSync(PROVIDER_LOG, "utf8").split("\n").filter(Boolean).slice(n).map((l) => JSON.parse(l)) : []);
function providerRules(mut: (r: any) => void) {
  const f = join(PROVIDER_DIR, "provider-rules.json");
  let r: any = {};
  try { r = JSON.parse(readFileSync(f, "utf8")); } catch {}
  mut(r);
  writeFileSync(f, JSON.stringify(r));
}
const credit = async (c: Ctx) => Number((await one(`SELECT credit_balance FROM organizations WHERE id=$1`, [c.org.orgId])).credit_balance);

// ─── week 1: arrive, onboard, connect, import ────────────────────────────────
async function week1(c: Ctx) {
  const { client } = c.org;
  await act(c, "onboarding/complete", client.post("/api/onboarding/complete", { businessType: c.spec.businessType, noteRole: c.spec.noteRole, orgName: `Market ${c.spec.n} ${c.spec.kind}`, seedSampleData: false }));
  await act(c, "GET today", client.get("/api/today"));
  // Paying: the customer picks a plan. Stripe is not configured here, so the
  // checkout cannot run; the tier is set by SQL and the gap is recorded once.
  const co = await act(c, "POST stripe/checkout", client.post("/api/stripe/checkout", { priceId: `price_${c.spec.tier}_monthly` }), { cls: null });
  await q(`UPDATE organizations SET subscription_tier=$2 WHERE id=$1`, [c.org.orgId, c.spec.tier]);
  const cp = await act(c, "POST credits/purchase", client.post("/api/credits/purchase", { packId: "growth" }), { cls: null });
  await q(`UPDATE organizations SET credit_balance = credit_balance + 5000 WHERE id=$1`, [c.org.orgId]); // a $50 pack
  jsonl("cohort-env-gaps.jsonl", { org: c.org.slug, checkout: co.status, checkoutMsg: msg(co), creditPurchase: cp.status, creditMsg: msg(cp), note: "Stripe unconfigured in this environment — tier + $50 credits set by SQL" });
  // Pax: the disclosure, then the first question
  await act(c, "POST pax/acknowledge-disclosure", client.post("/api/pax/acknowledge-disclosure", {}));
  await askPax(c, PAX_QUESTIONS[0]);

  // Return address for mail (some customers skip a field)
  if (c.spec.badMailForm) await act(c, "POST mail-identities (company name left blank)", client.post("/api/mail-identities", { name: `Main ${c.spec.n}`, addressLine1: "PO Box 100", city: "Tucson", state: "AZ", zipCode: "85701", isDefault: true }), { key: "mail-identity-incomplete" });
  await act(c, "POST mail-identities", client.post("/api/mail-identities", { name: `Main ${c.spec.n}`, companyName: `Market ${c.spec.n} Land LLC`, addressLine1: "PO Box 100", city: "Tucson", state: "AZ", zipCode: "85701", isDefault: true }));

  // Import the purchased list through the Leads → Import CSV sheet
  if (c.spec.kind !== "note" || c.spec.rows > 0) {
    const { csv, truth } = buildList(c.spec);
    const rows = sheetRows(csv);
    const r = await act(c, "POST leads/csv-import", client.post("/api/leads/csv-import", { rows }));
    const db = await q(`SELECT id, phone, email, apn FROM leads WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY id`, [c.org.orgId]);
    const byApn = new Map(truth.map((t) => [t.apn, t]));
    c.leads = db.map((l: any) => ({ id: l.id, phone: l.phone, email: l.email, apn: l.apn, truth: byApn.get(l.apn)! })).filter((l: Lead) => l.truth);
    for (const l of c.leads) if (l.phone) c.byPhone.set(l.phone.replace(/\D/g, "").slice(-10), l);
    jsonl("cohort-imports.jsonl", { org: c.org.slug, tier: c.spec.tier, rows: c.spec.rows, status: r.status, imported: r.body?.imported, persisted: db.length });
  }

  // SMS identity — the path depends on what the customer finds first
  c.twilioNumber = `+1500555${String(c.org.orgId).padStart(4, "0")}`;
  c.twilioToken = `tok_market_${c.org.orgId}_${crypto.randomBytes(4).toString("hex")}`;
  const sid = `AC${crypto.createHash("md5").update(String(c.org.orgId)).digest("hex")}`;
  if (c.spec.smsVia !== "none") {
    if (c.spec.smsVia === "integrations-then-byok" || c.spec.smsVia === "starter-manual") {
      // Settings → Integrations → Twilio: the form asks for Auth Token + Account SID
      await act(c, "POST integrations/twilio (Settings → Integrations form)", client.post("/api/integrations/twilio", { apiKey: c.twilioToken, settings: { accountSid: sid } }));
      await act(c, "POST integrations/twilio/test", client.post("/api/integrations/twilio/test", {}));
    }
    if (c.spec.smsVia !== "starter-manual") {
      const b = await act(c, "POST byok twilio (Settings → Your provider keys)", client.post("/api/byok", { channel: "twilio", plaintext: `${sid}:${c.twilioToken}:${c.twilioNumber}` }));
      c.smsReady = b.status < 300;
    } else {
      const b = await act(c, "POST byok twilio (starter)", client.post("/api/byok", { channel: "twilio", plaintext: `${sid}:${c.twilioToken}:${c.twilioNumber}` }));
      if (b.status >= 400) {
        // No UI path left for a Starter org. The owner connects it by hand
        // through the API-only legacy route (/api/sms/config has no client caller).
        note(c, "manual_request", "Starter customer cannot connect an SMS number in the UI; owner connects it via the API-only /api/sms/config", `byok → ${b.status} ${msg(b)}; Settings → Integrations Twilio saved but never satisfies the send gate`, { key: "starter-sms-connect" });
        const m = await act(c, "POST sms/config (owner, by hand)", client.post("/api/sms/config", { accountSid: sid, authToken: c.twilioToken, fromPhoneNumber: c.twilioNumber }), { cls: null });
        c.smsReady = m.status < 300;
      }
    }
  }
  // Email identity: every path the UI offers
  await act(c, "POST integrations/sendgrid", client.post("/api/integrations/sendgrid", { apiKey: `SG.market-${c.org.orgId}` }), { cls: null });
  await act(c, "POST email-domains", client.post("/api/email-domains", { domain: `market${c.org.orgId}.example.org`, fromEmail: `deals@market${c.org.orgId}.example.org`, fromName: `Market ${c.spec.n}` }), { cls: null });

  // Skip-trace the leads without a phone (FCRA attestation first)
  await act(c, "POST account/fcra-attestation", client.post("/api/account/fcra-attestation", {}));
  for (const l of c.leads.filter((x) => !x.phone).slice(0, 5)) {
    await act(c, "POST skip-traces", client.post("/api/skip-traces", { leadId: l.id, purposeOfUse: "legitimate_business_need", justification: "Owner of vacant parcel I want to make an offer on" }), { key: "skip-trace" });
  }
  // Wholesalers (modelled behaviour) bulk-mark their list as consented to get past the TCPA gate
  if (c.spec.kind === "wholesale") {
    const ids = c.leads.filter((l) => l.phone).map((l) => l.id);
    const r = await act(c, "POST leads/bulk-update tcpaConsent (whole purchased list)", client.post("/api/leads/bulk-update", { ids, updates: { tcpaConsent: true, consentSource: "list_vendor" } }));
    if (r.status < 300) {
      ids.forEach((i) => c.consented.add(i));
      note(c, "compliance_event", "A purchased list was marked TCPA-consented in bulk with consentSource 'list_vendor' and no consent evidence; the API accepted it", `bulk-update ${ids.length} leads → ${r.status}`, { key: "bulk-consent", legalBasis: "47 U.S.C. §227 — marketing texts need prior express written consent; a purchased list carries none", legalExposureUsd: 0 });
    }
  }
  // Properties for the first 6 leads (the ones the customer is serious about)
  for (const l of c.leads.slice(0, 6)) await ensureProperty(c, l);
}

async function ensureProperty(c: Ctx, l: Lead): Promise<number | null> {
  if (c.propertyFor.has(l.id)) return c.propertyFor.get(l.id)!;
  const t = l.truth;
  const r = await act(c, "POST properties", c.org.client.post("/api/properties", { apn: t.apn, county: t.county, state: t.parcelState, sizeAcres: String(2 + (l.id % 38)), address: t.situsAddr || undefined }));
  if (r.status === 201 && r.body?.id) {
    c.propertyFor.set(l.id, r.body.id);
    await act(c, "PUT properties landStatus", c.org.client.put(`/api/properties/${r.body.id}`, { landStatus: "fee" }), { cls: null });
    return r.body.id;
  }
  return null;
}

async function askPax(c: Ctx, qn: (typeof PAX_QUESTIONS)[number]) {
  const t0 = Date.now();
  const before = standinCalls().length;
  const r = await act(c, `POST ai/chat [${qn.kind}]`, c.org.client.post("/api/ai/chat", { message: qn.text }), { key: "pax" });
  c.paxAsked++;
  jsonl("cohort-pax.jsonl", { org: c.org.slug, q: qn.id, status: r.status, ms: Date.now() - t0, modelCalls: standinCalls().length - before, cost: r.body?.estimatedCost ?? null, msg: r.status >= 300 ? msg(r) : undefined });
  return r;
}

// ─── outreach ────────────────────────────────────────────────────────────────
async function emailTouch(c: Ctx) {
  const targets = c.leads.filter((l) => l.email && !c.emailed.has(l.id)).slice(0, 40);
  if (!targets.length) return;
  const camp = await act(c, "POST campaigns (email)", c.org.client.post("/api/campaigns", { name: `Email wk${c.week}`, type: "email", subject: "About your land in {{county}} County", content: "<p>Hi {{firstName}},</p><p>We buy vacant land for cash. Would you consider an offer?</p>" }));
  if (!camp.body?.id) return;
  const before = provCount(), cb = await credit(c);
  const r = await act(c, "POST campaigns/send-email", c.org.client.post(`/api/campaigns/${camp.body.id}/send-email`, { leadIds: targets.map((l) => l.id) }));
  const tset = new Set(targets.map((l) => String(l.email).toLowerCase()));
  const leftTheBuilding = provSince(before).filter((x) => x.rail === "ses" && [].concat(x.to ?? []).some((a: string) => tset.has(String(a).toLowerCase()))).length;
  const charged = cb - (await credit(c));
  c.charged.email += charged;
  targets.forEach((l) => c.emailed.add(l.id));
  jsonl("cohort-sends.jsonl", { org: c.org.slug, week: c.week, channel: "email", requested: targets.length, status: r.status, msg: r.status >= 300 ? msg(r) : undefined, reportedSent: r.body?.sent, failed: r.body?.failed, errors: (r.body?.errors ?? []).slice(0, 3), reachedProvider: leftTheBuilding, chargedCents: charged });
  if (r.status === 200 && (r.body?.sent ?? 0) > 0 && leftTheBuilding === 0) {
    note(c, "silent_noop", "Email campaign reported as sent; nothing reached any mail provider", `send-email → sent=${r.body.sent}, provider calls=0, charged ${charged}¢`, { key: "email-silent-noop" });
    note(c, "billing_dispute", "Credits charged for emails that never left", `${charged}¢ this send`, { key: "email-charged-for-nothing", moneyUsd: charged / 100 });
  }
}

async function smsTouch(c: Ctx, followUp: boolean) {
  if (!c.smsReady) return;
  let targets: Lead[];
  if (followUp && c.smsCampaigns.length) {
    // second touch to the previous recipients: nobody "replied" in the app
    const prev = c.smsCampaigns[c.smsCampaigns.length - 1];
    targets = prev.leadIds.map((id) => c.leads.find((l) => l.id === id)!).filter(Boolean);
  } else {
    const pool = c.leads.filter((l) => l.phone && c.consented.has(l.id) && !c.texted.has(l.id));
    targets = pool.slice(0, 12);
  }
  if (!targets.length) return;
  const camp = await act(c, "POST campaigns (sms)", c.org.client.post("/api/campaigns", { name: `SMS wk${c.week}${followUp ? " follow-up" : ""}`, type: "sms", content: "Hi {{firstName}}, this is Sam. Would you sell your land in {{county}} County? Reply STOP to opt out." }));
  if (!camp.body?.id) return;
  const before = provCount(), cb = await credit(c);
  const r = await act(c, "POST campaigns/send-sms", c.org.client.post(`/api/campaigns/${camp.body.id}/send-sms`, { leadIds: targets.map((l) => l.id) }, { headers: { "idempotency-key": `mkt-${c.org.orgId}-${camp.body.id}-${c.week}x` } }));
  const msgs = provSince(before).filter((x) => x.rail === "twilio" && x.op === "message" && x.from === c.twilioNumber);
  const charged = cb - (await credit(c));
  c.charged.sms += charged;
  for (const m of msgs) {
    const l = c.byPhone.get(String(m.to).replace(/\D/g, "").slice(-10));
    if (l) c.texted.set(l.id, (c.texted.get(l.id) ?? 0) + 1);
  }
  c.smsCampaigns.push({ id: camp.body.id, leadIds: targets.map((l) => l.id) });
  jsonl("cohort-sends.jsonl", { org: c.org.slug, week: c.week, channel: "sms", followUp, requested: targets.length, reportedSent: r.body?.sent, failed: r.body?.failed, tcpaBlocked: r.body?.tcpaBlocked, quietBlocked: r.body?.quietHoursBlocked, reachedProvider: msgs.length, delivered: msgs.filter((m) => !m.fail).length, carrierRefused: msgs.filter((m) => m.fail).length, chargedCents: charged, status: r.status, msg: r.status >= 300 ? msg(r) : undefined, errors: (r.body?.errors ?? []).slice(0, 3) });
  // replies — only to messages that were actually delivered
  for (const m of msgs.filter((x) => !x.fail)) {
    const l = c.byPhone.get(String(m.to).replace(/\D/g, "").slice(-10));
    if (!l || c.optedOut.has(l.id) || rnd() > REPLY_RATE) continue;
    let roll = rnd(), kind = REPLY_MIX[0];
    for (const k of REPLY_MIX) { if (roll < k[1]) { kind = k; break; } roll -= k[1]; }
    await reply(c, l, kind[0], pick(kind[2]));
  }
}

/** A seller's text reply, delivered the way Twilio would deliver it. */
async function reply(c: Ctx, l: Lead, kind: string, body: string) {
  const sidMsg = `SM${crypto.randomBytes(16).toString("hex")}`;
  const params = { From: l.phone!, To: c.twilioNumber!, Body: body, MessageSid: sidMsg, AccountSid: "AC" + "x".repeat(32) };
  // 1) production-faithful: Twilio signs with the auth token of the account the number belongs to — the CUSTOMER's
  const prodSig = await postTwilioWithToken(c.org.client, params, c.twilioToken!);
  // 2) the same reply signed with the platform token — what would happen IF it were verified
  const plat = await postTwilioSms(c.org.client, { ...params, MessageSid: sidMsg + "p" });
  const after = await one(`SELECT do_not_contact, tcpa_consent FROM leads WHERE id=$1`, [l.id]);
  const stored = await count(`sms_messages WHERE organization_id=$1 AND from_number LIKE $2`, [c.org.orgId, `%${l.phone!.slice(-10)}`]).catch(() => -1);
  const inbox = await count(`inbox_messages WHERE organization_id=$1 AND created_at > now() - interval '2 minutes'`, [c.org.orgId]).catch(() => -1);
  jsonl("cohort-replies.jsonl", { org: c.org.slug, n: c.spec.n, smsVia: c.spec.smsVia, week: c.week, leadId: l.id, kind, body, prodSignature: prodSig.status, platformSignature: plat.status, platformBody: plat.text.slice(0, 120), dncAfter: after?.do_not_contact, consentAfter: after?.tcpa_consent, storedRows: stored, inboxRecent: inbox });
  if (kind === "stop" || kind === "natural-optout") {
    // Twilio's own carrier-level opt-out blocks the exact STOP keywords on that number; nothing else.
    const carrierBlocked = kind === "stop";
    if (carrierBlocked) providerRules((r) => { r.smsFail = [...new Set([...(r.smsFail ?? []), l.phone])]; });
    c.optedOut.set(l.id, { week: c.week, how: kind, carrierBlocked, at: new Date().toISOString(), prodSig: prodSig.status });
  }
  if (prodSig.status >= 400) note(c, "silent_noop", "A seller's SMS reply to the customer's own (BYO) number is rejected by the inbound webhook — it never reaches the customer's inbox", `${kind} reply → ${prodSig.status} ${prodSig.text.slice(0, 80)}; DNC after=${after?.do_not_contact}`, { key: "inbound-sms-rejected" });
  if ((kind === "stop" || kind === "natural-optout") && !after?.do_not_contact) note(c, "compliance_event", "Seller opted out by SMS; the lead is NOT marked do-not-contact (later sends are counted by audit.ts)", `${kind} "${body}" → prod-signed ${prodSig.status}, platform-signed ${plat.status}; dnc=${after?.do_not_contact}`, { key: "optout-not-recorded", legalBasis: "47 CFR 64.1200(a)(10) — revocation by any reasonable means must be honoured", legalExposureUsd: 0 });
  // the customer only learns of interest if the reply reached them; otherwise ~30% of sellers phone in (modelled)
  if (kind === "interested" && (prodSig.status < 300 || rnd() < 0.3)) c.interested.push(l);
}
async function postTwilioWithToken(client: SimClient, params: Record<string, string>, token: string) {
  const url = "https://sim.acreos.test/api/webhooks/twilio/sms";
  const toSign = url + Object.keys(params).sort().reduce((s, k) => s + k + params[k], "");
  const sig = crypto.createHmac("sha1", token).update(Buffer.from(toSign, "utf-8")).digest("base64");
  return client.call("POST", "/api/webhooks/twilio/sms", undefined, { raw: new URLSearchParams(params).toString(), noAuth: true, noCsrf: true, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig, "x-forwarded-proto": "https", "x-forwarded-host": "sim.acreos.test" } });
}

async function mailTouch(c: Ctx) {
  const targets = c.leads.filter((l) => !c.mailed.has(l.id)).slice(0, 30);
  if (!targets.length) return;
  const camp = await act(c, "POST campaigns (direct_mail)", c.org.client.post("/api/campaigns", { name: `Postcards wk${c.week}`, type: "direct_mail", content: "Hi {firstName}, we buy land in {county} County for cash. Call (520) 555-0100." }));
  if (!camp.body?.id) return;
  const before = provCount(), cb = await credit(c);
  const r = await act(c, "POST campaigns/send-direct-mail", c.org.client.post(`/api/campaigns/${camp.body.id}/send-direct-mail`, { pieceType: "postcard_4x6", leadIds: targets.map((l) => l.id) }, { headers: { "idempotency-key": `mkt-dm-${c.org.orgId}-${c.week}-${camp.body.id}` } }));
  await new Promise((res) => setTimeout(res, 1500));
  const mine = new RegExp(`^(Market|Main) ${reEsc(String(c.spec.n))}( |$)`);
  const pieces = provSince(before).filter((x) => x.rail === "lob" && /POST/.test(x.op) && mine.test(String(x.fromName ?? "")));
  const charged = cb - (await credit(c));
  c.charged.mail += charged;
  targets.forEach((l) => c.mailed.add(l.id));
  // was each piece addressed to the owner's MAILING address?
  const rows = await q(`SELECT id, address, city, state, zip, do_not_contact FROM leads WHERE id = ANY($1)`, [targets.map((l) => l.id)]);
  let wrongBlock = 0, toOptedOut = 0;
  for (const row of rows) {
    const t = targets.find((l) => l.id === row.id)!.truth;
    const ok = (row.address ?? "").toUpperCase() === t.mailAddr.toUpperCase() && (row.city ?? "").toUpperCase() === t.mailCity.toUpperCase() && (row.zip ?? "") === t.mailZip;
    if (!ok) wrongBlock++;
    if (c.optedOut.has(row.id)) toOptedOut++;
  }
  jsonl("cohort-sends.jsonl", { org: c.org.slug, week: c.week, channel: "mail", requested: targets.length, status: r.status, msg: r.status >= 300 ? msg(r) : undefined, reportedSent: r.body?.sent ?? r.body?.queued ?? r.body?.successCount, reachedProvider: pieces.length, chargedCents: charged, wrongAddressBlock: wrongBlock, toOptedOutLeads: toOptedOut });
  if (pieces.length > 0 && wrongBlock > 0) note(c, "wrong_money_number", "Postcards printed to the parcel/situs or a mixed address block, not the owner's mailing address (import mapping)", `${wrongBlock}/${targets.length} pieces this send`, { key: "mail-wrong-address", moneyUsd: (charged / 100) * (wrongBlock / targets.length) });
  // sellers who call in after a postcard (modelled) — only reachable if the card reached them
  for (const l of targets) {
    const reached = rows.find((x: any) => x.id === l.id && (x.address ?? "").toUpperCase() === l.truth.mailAddr.toUpperCase());
    if (reached && rnd() < MAIL_CALLBACK_RATE * 3) c.interested.push(l);
    else if (!reached && rnd() < 0.002) c.interested.push(l); // the occasional situs-address neighbour forwards it
  }
}

async function workPipeline(c: Ctx) {
  const { client } = c.org;
  // call back interested sellers; consent given on the phone
  for (const l of c.interested.splice(0, 4)) {
    await act(c, "POST leads/contact-event", client.post(`/api/leads/${l.id}/contact-event`, { channel: "phone", method: "manual", outcome: "warm" }));
    if (!c.consented.has(l.id) && l.phone) {
      const r = await act(c, "PATCH leads/consent", client.patch(`/api/leads/${l.id}/consent`, { tcpaConsent: true, consentSource: "verbal_phone_call" }), { cls: null });
      if (r.status < 300) c.consented.add(l.id);
    }
    const pid = await ensureProperty(c, l);
    if (!pid) continue;
    const o = await act(c, "POST offers", client.post("/api/offers", { leadId: l.id, propertyId: pid, status: "sent", cashOffer: String(8000 + (l.id % 20) * 500) }));
    if (o.body?.id) c.offers.push({ id: o.body.id, lead: l, week: c.week, status: "sent" });
    await act(c, "POST documents/offer-letter", client.post("/api/documents/offer-letter", { leadId: l.id, propertyId: pid, offerAmount: 8000 + (l.id % 20) * 500 }), { key: "offer-letter" });
  }
  // offers resolve after a week
  for (const o of c.offers.filter((x) => x.status === "sent" && x.week < c.week)) {
    const accepted = rnd() < 0.4;
    const r = await act(c, "PATCH offers status", client.patch(`/api/offers/${o.id}`, { status: accepted ? "accepted" : "rejected" }));
    o.status = r.status < 300 ? (accepted ? "accepted" : "rejected") : o.status;
    if (accepted && c.propertyFor.has(o.lead.id)) {
      const d = await act(c, "POST deals", client.post("/api/deals", { propertyId: c.propertyFor.get(o.lead.id), type: "acquisition", status: "negotiating", offerAmount: String(8000 + (o.lead.id % 20) * 500) }));
      if (d.body?.id) c.deals.push({ id: d.body.id, stage: "negotiating" });
    }
  }
  // deals advance one stage a week
  const NEXT: Record<string, string> = { negotiating: "offer_sent", offer_sent: "accepted", accepted: "in_escrow", in_escrow: "closed" };
  for (const d of c.deals.filter((x) => NEXT[x.stage])) {
    const to = NEXT[d.stage];
    let r = await act(c, `PATCH deals/stage → ${to}`, client.patch(`/api/deals/${d.id}/stage`, { stage: to }), { cls: null });
    if (r.status === 400 || r.status === 409 || r.status === 422) {
      jsonl("cohort-steps.jsonl", { org: c.org.slug, week: c.week, label: "deal stage gate", status: r.status, msg: msg(r) });
      r = await act(c, `PATCH deals/stage → ${to} (force)`, client.patch(`/api/deals/${d.id}/stage`, { stage: to, force: true }), { key: "deal-stage-gate" });
    } else if (r.status >= 500) note(c, "error_5xx", "deal stage change 5xx", msg(r), { key: "deal-stage-5xx" });
    if (r.status < 300) d.stage = to;
  }
}

async function noteBook(c: Ctx) {
  const { client } = c.org;
  if (c.week === 2) {
    // Notes → Import (notes-import-dialog.tsx) — the investor's existing book
    const fd = new FormData();
    fd.append("file", new Blob(["borrowerFirstName,borrowerLastName,originalPrincipal,currentBalance,interestRate,termMonths,monthlyPayment\nAna,Owner,30000,24000,9,120,380.03\n"], { type: "text/csv" }), "notes.csv");
    await act(c, "POST import/notes (Notes → Import)", client.call("POST", "/api/import/notes", undefined, { raw: fd as any }), { key: "notes-import" });
    // …so the book is keyed in by hand
    for (const l of c.leads.slice(0, 3)) {
      const pid = await ensureProperty(c, l);
      const r = await act(c, "POST notes", client.post("/api/notes", { originalPrincipal: String(20000 + (l.id % 5) * 5000), interestRate: "9", termMonths: 120, propertyId: pid ?? undefined, borrowerId: l.id, startDate: new Date(Date.now() - 40 * 864e5).toISOString(), firstPaymentDate: new Date(Date.now() - 10 * 864e5).toISOString(), status: "active", atrExemptionCode: "raw_land", gracePeriodDays: 10, lateFee: "25" }));
      if (r.body?.id) c.notes.push(r.body.id);
    }
  }
  if ([4, 8, 12].includes(c.week)) {
    for (const id of c.notes) {
      const n = await one(`SELECT monthly_payment FROM notes WHERE id=$1`, [id]);
      await act(c, "POST payments (record borrower payment)", client.post("/api/payments", { noteId: id, amount: Number(n?.monthly_payment ?? 300).toFixed(2), paymentMethod: "check" }, { headers: { "idempotency-key": `mkt-pay-${id}-${c.week}-abcdef` } }), { key: "payment-record" });
    }
    await act(c, "GET bookkeeping/portfolio-summary", client.get(`/api/bookkeeping/portfolio-summary?year=${new Date().getFullYear()}`));
    await act(c, "GET notes/delinquent", client.get("/api/notes/delinquent"));
  }
  if (c.week === 6 && c.notes[0]) await act(c, "POST notes/portal-link", client.post(`/api/notes/${c.notes[0]}/portal-link`, {}));
}

async function team(c: Ctx) {
  if (!c.spec.vas || c.week !== 3) return;
  for (let v = 0; v < c.spec.vas; v++) {
    const vaSlug = `${c.org.slug}-va${v}`;
    const vaClerk = personaTestUserId(vaSlug);
    const vaEmail = `${vaClerk}@persona-test.local`;
    let inv = await act(c, "POST organization/invitations (va)", c.org.client.post("/api/organization/invitations", { email: vaEmail, role: "va" }), { key: "invite" });
    if (inv.status === 402) {
      note(c, "manual_request", "Paid team plan cannot invite a teammate until seats are bought (seat_count default)", msg(inv), { key: "seat-gate" });
      await q(`UPDATE organizations SET seat_count=greatest(coalesce(seat_count,1), 12) WHERE id=$1`, [c.org.orgId]);
      inv = await act(c, "POST organization/invitations (va, after seats)", c.org.client.post("/api/organization/invitations", { email: vaEmail, role: "va" }));
    }
    const token = inv.body?.invitations?.[0]?.token ?? inv.body?.token;
    if (!token) continue;
    await q(`INSERT INTO users (clerk_user_id, email, persona, first_name, last_name, tos_accepted_at, privacy_accepted_at) VALUES ($1,$2,'land_investor','Val','Assistant',now(),now()) ON CONFLICT (clerk_user_id) DO NOTHING`, [vaClerk, vaEmail]);
    const va = new SimClient(vaSlug);
    giveOwnIp(va, 50000 + c.org.orgId * 10 + v);
    await act(c, "VA accept invitation", va.post("/api/organization/invitations/accept", { token }));
    va.setCookie("acreos_active_org", String(c.org.orgId));
    c.vaClients.push(va);
  }
}
async function vaWork(c: Ctx) {
  for (const va of c.vaClients) {
    const list = await act(c, "VA GET leads", va.get("/api/leads?pageSize=25"));
    const total = list.body?.total ?? 0;
    jsonl("cohort-va.jsonl", { org: c.org.slug, week: c.week, sees: total, orgLeads: c.leads.length });
    const target = (list.body?.data ?? [])[0];
    if (target) {
      await act(c, "VA PUT lead status", va.put(`/api/leads/${target.id}`, { status: "contacted" }), { key: "va-edit" });
      await act(c, "VA POST contact-event", va.post(`/api/leads/${target.id}/contact-event`, { channel: "phone", method: "manual", outcome: "no_answer" }), { key: "va-contact" });
    }
  }
}

async function lifecycle(c: Ctx) {
  const { client } = c.org;
  const s = c.spec;
  if (s.upgradeWeek === c.week) {
    const r = await act(c, "POST stripe/checkout (upgrade to pro)", client.post("/api/stripe/checkout", { priceId: "price_pro_monthly" }), { cls: null });
    await q(`UPDATE organizations SET subscription_tier='pro' WHERE id=$1`, [c.org.orgId]);
    jsonl("cohort-env-gaps.jsonl", { org: c.org.slug, upgrade: r.status, msg: msg(r), note: "upgrade applied by SQL (Stripe unconfigured)" });
    c.spec = { ...c.spec, tier: "pro" };
    // a Starter that upgrades can now use BYOK; the legacy row keeps working
  }
  if (s.downgradeWeek === c.week) {
    await q(`UPDATE organizations SET subscription_tier='starter' WHERE id=$1`, [c.org.orgId]);
    const n = await count(`leads WHERE organization_id=$1 AND deleted_at IS NULL`, [c.org.orgId]);
    const add = await act(c, "POST leads (after downgrade, over the Starter cap)", client.post("/api/leads", { firstName: "New", lastName: "Seller" }), { cls: null });
    const camp = await act(c, "POST campaigns (after downgrade)", client.post("/api/campaigns", { name: "post-downgrade", type: "direct_mail", content: "Hi" }), { cls: null });
    const smsAfter = c.smsCampaigns.length ? await act(c, "send-sms after downgrade (BYOK is Pro+)", client.post(`/api/campaigns/${c.smsCampaigns[0].id}/send-sms`, { leadIds: [...c.consented].slice(0, 2) }, { headers: { "idempotency-key": `mkt-dg-${c.org.orgId}-abcdefgh` } }), { cls: null }) : null;
    jsonl("cohort-downgrades.jsonl", { org: c.org.slug, leads: n, starterCap: 250, newLead: add.status, newLeadMsg: msg(add), newCampaign: camp.status, campMsg: msg(camp), smsAfter: smsAfter?.status, smsAfterMsg: smsAfter ? msg(smsAfter) : null });
    if (add.status === 429 && /faster than the system/i.test(msg(add))) note(c, "support_question", "After a downgrade the customer is told 'You're sending requests faster than the system can handle' instead of 'over the Starter lead limit'", msg(add), { key: "limit-message" });
    c.spec = { ...c.spec, tier: "starter" };
  }
  if (s.exportWeek === c.week) {
    const e = await act(c, "POST export/everything", client.post("/api/export/everything", {}));
    const p = await act(c, "POST privacy/export (Privacy & data page)", client.post("/api/privacy/export", {}));
    if (p.status === 202) note(c, "manual_request", "A 'download my data' request becomes a manual DSAR for the owner (24 h SLA promised to the customer)", `requestId=${p.body?.requestId} eta=${p.body?.eta}`, { key: "dsar-export" });
    jsonl("cohort-lifecycle.jsonl", { org: c.org.slug, week: c.week, event: "export", everything: e.status, privacy: p.status, eta: p.body?.eta });
  }
  if (s.deleteWeek === c.week) {
    const d = await act(c, "POST privacy/delete", client.post("/api/privacy/delete", { confirm: "DELETE MY DATA" }));
    if (d.status === 202) note(c, "manual_request", "Account deletion is a manual DSAR (verify → fan-out → erasure by the owner) against a 24 h promise", `requestId=${d.body?.requestId} sla=${d.body?.slaDeadlineAt}`, { key: "dsar-delete" });
    jsonl("cohort-lifecycle.jsonl", { org: c.org.slug, week: c.week, event: "delete", status: d.status, sla: d.body?.slaDeadlineAt });
  }
  if (s.cancelWeek === c.week) {
    const ctxR = await act(c, "GET subscription/cancellation-context", client.get("/api/subscription/cancellation-context"), { cls: null });
    const r = await act(c, "POST subscription/cancel", client.post("/api/subscription/cancel", { reason: pick(["too_expensive", "not_using", "missing_features"]), feedback: "Texts never got replies and emails never went out" }));
    const org = await one(`SELECT subscription_tier, subscription_status, cancel_at_period_end FROM organizations WHERE id=$1`, [c.org.orgId]).catch(async () => one(`SELECT subscription_tier, subscription_status FROM organizations WHERE id=$1`, [c.org.orgId]));
    jsonl("cohort-lifecycle.jsonl", { org: c.org.slug, week: c.week, event: "cancel", status: r.status, msg: msg(r), context: ctxR.status, after: org });
    c.cancelled = true;
  }
}

async function sequences(c: Ctx) {
  if (c.week !== 5 || c.spec.kind === "note") return;
  const { client } = c.org;
  const s = await act(c, "POST sequences", client.post("/api/sequences", { name: "Postcard follow-up", description: "email then sms", isActive: true }));
  if (!s.body?.id) return;
  await act(c, "POST sequences/steps (email)", client.post(`/api/sequences/${s.body.id}/steps`, { channel: "email", delayDays: 0, subject: "Following up", content: "Hi {{firstName}}, following up on my postcard." }));
  await act(c, "POST sequences/steps (sms)", client.post(`/api/sequences/${s.body.id}/steps`, { channel: "sms", delayDays: 0, content: "Hi {{firstName}}, following up on my postcard. Reply STOP to opt out." }));
  // enroll texted leads, INCLUDING any that opted out (the customer cannot see the opt-out)
  const optedOut = [...c.optedOut.keys()].slice(0, 3);
  const others = [...c.texted.keys()].filter((id) => !c.optedOut.has(id)).slice(0, 4);
  for (const id of [...optedOut, ...others]) await act(c, "POST sequences/enroll", client.post(`/api/sequences/${s.body.id}/enroll`, { leadId: id }), { key: "seq-enroll" });
  // the processor runs every 60 s on the worker; due now
  await q(`UPDATE sequence_enrollments SET next_step_scheduled_at = now() - interval '1 minute' WHERE sequence_id=$1`, [s.body.id]).catch(() => null);
  jsonl("cohort-sequences.jsonl", { org: c.org.slug, sequenceId: s.body.id, enrolledOptedOut: optedOut, enrolledOthers: others, shiftedAt: new Date().toISOString() });
}

// ─── the run ────────────────────────────────────────────────────────────────
async function runOrg(spec: Spec) {
  const org = await provisionOrg(`mkt-${spec.n}-${spec.kind}-${spec.tier}`, { businessType: spec.businessType, noteRole: spec.noteRole, orgName: `Market ${spec.n}` });
  const c: Ctx = { spec, org, arrival: ARRIVAL_25[spec.n - 1], week: 1, leads: [], byPhone: new Map(), consented: new Set(), texted: new Map(), mailed: new Set(), emailed: new Set(), optedOut: new Map(), interested: [], propertyFor: new Map(), offers: [], deals: [], notes: [], smsReady: false, twilioToken: null, twilioNumber: null, smsCampaigns: [], mailCreditsCents: 0, paxAsked: 0, vaClients: [], cancelled: false, charged: { email: 0, sms: 0, mail: 0, offerLetter: 0 } };
  ctxs.push(c);
  reseed(5000 + spec.n);
  console.log(`▶ org ${spec.n} (${spec.kind}/${spec.tier}) → ${org.orgId}`);
  for (c.week = 1; c.week <= WEEKS; c.week++) {
    try {
      if (c.cancelled) { await act(c, "GET today (after cancel)", c.org.client.get("/api/today"), { cls: null }); break; }
      if (c.week === 1) { await week1(c); continue; }
      // TIME COMPRESSION: a tenure week is 7 days. The contact-frequency cap reads
      // lead_activities.created_at, so every touch this org made is aged by 7 days
      // before the next week runs (otherwise a weekly follow-up reads as "twice in 24 h").
      await q(`UPDATE lead_activities SET created_at = created_at - interval '7 days' WHERE organization_id=$1`, [org.orgId]);
      // A customer whose balance is low buys another $50 pack (Stripe unconfigured → SQL; recorded as credit revenue).
      if ((await credit(c)) < 1000 && !c.cancelled) {
        await q(`UPDATE organizations SET credit_balance = credit_balance + 5000 WHERE id=$1`, [org.orgId]);
        jsonl("cohort-topups.jsonl", { org: org.slug, n: spec.n, tier: c.spec.tier, week: c.week, cents: 5000 });
      }
      await act(c, "GET today", org.client.get("/api/today"));
      await act(c, "GET inbox", org.client.get("/api/inbox?limit=20"));
      await act(c, "GET leads", org.client.get("/api/leads?pageSize=25"));
      await act(c, "GET deals", org.client.get("/api/deals"));
      await askPax(c, PAX_QUESTIONS[(spec.n * 3 + c.week) % 26]); // how-to / money / legal / own-data only
      if (c.spec.kind !== "note") {
        if (c.week % 2 === 0) await mailTouch(c);
        await emailTouch(c);
        if (c.spec.kind === "wholesale" || c.week % 2 === 1) await smsTouch(c, false);
        if (c.week % 3 === 0) await smsTouch(c, true);
        await workPipeline(c);
        await sequences(c);
      } else await noteBook(c);
      await team(c);
      await vaWork(c);
      await lifecycle(c);
    } catch (e) {
      recordSkip({ sim: SIM, step: `org ${spec.n} week ${c.week}`, reason: String(e).slice(0, 300) });
      console.error(`org ${spec.n} week ${c.week}:`, e);
    }
  }
  console.log(`■ org ${spec.n} done: leads=${c.leads.length} texted=${c.texted.size} optedOut=${c.optedOut.size} offers=${c.offers.length} deals=${c.deals.length}`);
}

async function main() {
  if (!PROVIDER_DIR) throw new Error("PROVIDER_DIR must point at the provider stand-in's directory");
  await ensureDefaultE2eUser();
  providerRules((r) => { r.smsFail = []; });
  const t0 = Date.now();
  const specs = COHORT.filter((s) => !ONLY || ONLY.has(s.n));
  const queue = [...specs];
  await Promise.all(Array.from({ length: PARALLEL }, async () => { while (queue.length) await runOrg(queue.shift()!); }));
  // let the worker's 60 s sequence processor run on the shifted enrollments
  console.log("waiting 150 s for the worker's sequence processor…");
  await new Promise((r) => setTimeout(r, 150_000));
  writeJson("cohort-orgs.json", ctxs.map((c) => ({
    n: c.spec.n, slug: c.org.slug, orgId: c.org.orgId, kind: c.spec.kind, tier: c.spec.tier, arrival: c.arrival, smsVia: c.spec.smsVia, smsReady: c.smsReady,
    leads: c.leads.length, texted: c.texted.size, optedOut: [...c.optedOut.entries()].map(([id, v]) => ({ id, ...v, phone: c.leads.find((l) => l.id === id)?.phone, mailZone: c.leads.find((l) => l.id === id)?.truth.mailZone })),
    textedLeads: [...c.texted.keys()].map((id) => { const l = c.leads.find((x) => x.id === id)!; return { id, phone: l.phone, mailZone: l.truth.mailZone, mailState: l.truth.mailState }; }),
    mailed: c.mailed.size, emailed: c.emailed.size, offers: c.offers.length, deals: c.deals.map((d) => d.stage), notes: c.notes.length, vas: c.vaClients.length, cancelled: c.cancelled, charged: c.charged, paxAsked: c.paxAsked,
  })));
  recordMetric(SIM, "cohort-wall-seconds", Math.round((Date.now() - t0) / 1000));
  console.log(`cohort done in ${Math.round((Date.now() - t0) / 1000)} s on ${DB_LABEL}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
