/**
 * 90-day lifecycle sim — ONE pro-tier land-investing org, driven over HTTP the
 * way a real operator works, with Postgres as the oracle after every step.
 *
 *   week 1   list import → properties → enrichment
 *   week 2   campaigns (direct mail / email / sms), credit burn, simulated sends
 *   week 3   inbound replies (signed email webhook, signed Twilio webhook, STOP)
 *   week 4-6 contact events → offers → offer letters → deals → stage walk
 *   week 7-9 seller-finance notes → schedules → payments (idempotency) →
 *            usury → delinquency → dunning → borrower portal → money-custody
 *   week 10-12 VA invite + role scoping, exports, bookkeeping reconciliation,
 *            usage counters
 *   finally  consistency pass (DB vs API counts, dangling refs) + honesty grep
 *
 * Every step records status + latency + the DB truth. A 5xx, a wrong money
 * or count, a silent exclusion, or a refusal without a reason is a finding; a
 * step that cannot run is a skip with its reason — never green by omission.
 *
 *   DATABASE_URL=postgresql://acreos:acreos@localhost:5432/acreos_sim \
 *   SIM_BASE_URL=http://localhost:5000 \
 *   npx tsx tests/simulation/campaign/lifecycle-90-days.ts
 */
import pg from "pg";
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SimClient, type Resp } from "./client";
import { recordFinding, recordMetric, recordSkip, outDir, type Severity } from "./ledger";
import { personaTestUserId } from "../../../server/auth/testAuth";

const SIM = "lifecycle-90-days";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

// Secrets the local build was started with (tests/simulation sim.env). The
// webhook signatures below are only valid against THAT build.
const SESSION_SECRET = process.env.SESSION_SECRET ?? "e2e-session-secret-at-least-32-characters-long";
const INBOUND_EMAIL_HMAC_SECRET = process.env.INBOUND_EMAIL_HMAC_SECRET ?? SESSION_SECRET;
const INBOUND_EMAIL_WEBHOOK_SECRET =
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? "e2e-dummy-inbound-email-webhook-secret-0123456789abcdef";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "e2e-dummy-twilio-token";
// Inbound SMS is routed to the FIRST organization_integrations row whose
// fromPhoneNumber matches `To`, across every org. Give this run its own number
// so a prior run's row cannot swallow its replies.
let ORG_TWILIO_NUMBER = "+15005550006";

// ─── ledger helpers ─────────────────────────────────────────────────────────
interface StepRow { week: string; step: string; status: number | string; ms: number; truth: string }
const steps: StepRow[] = [];
const kept: Array<{ step: string; status: number | string; text: string }> = [];
let findingSeq = 0;
const findingIds: string[] = [];
const skipRows: Array<{ step: string; reason: string }> = [];

function finding(sev: Severity, area: string, title: string, evidence: string, impact?: string, repro?: string) {
  // A stable id derived from the title, so a finding keeps its name across runs
  // (an ordinal renamed findings whenever an earlier step changed outcome).
  const id = `A-LC-${crypto.createHash("sha1").update(title).digest("hex").slice(0, 6)}`;
  ++findingSeq;
  findingIds.push(id);
  recordFinding({ sim: SIM, id, product: "AcreOS", sev, area, title, evidence: evidence.slice(0, 1500), impact, repro });
}
function skip(step: string, reason: string) {
  skipRows.push({ step, reason });
  recordSkip({ sim: SIM, step, reason });
}
/** Record a step: status, latency, DB truth. Auto-files a P1 on any 5xx / transport failure. */
function note(week: string, step: string, r: { status: number | string; ms: number; text?: string }, truth: string, opts?: { noAutoFinding?: boolean }) {
  const row = { week, step, status: r.status, ms: Math.round(r.ms), truth };
  steps.push(row);
  recordMetric(SIM, `${week}/${step}`, { status: r.status, ms: row.ms, truth });
  if (r.text !== undefined) kept.push({ step: `${week}/${step}`, status: r.status, text: r.text.slice(0, 200_000) });
  console.log(`  [${week}] ${step}: ${r.status} ${row.ms}ms — ${truth}`);
  if (!opts?.noAutoFinding && typeof r.status === "number" && (r.status >= 500 || r.status === 0)) {
    finding("P1", "robustness", `${step} returned ${r.status}`, (r.text ?? "").slice(0, 400), undefined, step);
  }
}
async function section(week: string, name: string, fn: () => Promise<void>) {
  console.log(`\n── ${week}: ${name}`);
  try {
    await fn();
  } catch (e) {
    skip(`${week}/${name}`, `harness/step threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
}
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
async function one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  return (await q<T>(sql, params))[0];
}
async function countWhere(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await one<{ n: string }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).n);
}
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    (t as any).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
function msg(r: Resp): string {
  return (r.body?.message ?? r.body?.error ?? r.text ?? "").toString().slice(0, 240);
}
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const dollars = (c: number) => (c / 100).toFixed(2);

// deterministic PRNG so two runs build the same list
let seed = 90;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ─── realistic list data ────────────────────────────────────────────────────
const COUNTIES: Array<[string, string, string]> = [
  ["AZ", "Cochise", "85603"], ["AZ", "Mohave", "86401"], ["AZ", "Navajo", "85901"], ["AZ", "Apache", "85936"],
  ["TX", "Hudspeth", "79851"], ["TX", "Presidio", "79845"], ["TX", "Brewster", "79830"],
  ["NM", "Luna", "88030"], ["NM", "Valencia", "87031"], ["NM", "Torrance", "87035"],
];
const FIRST = ["James", "Maria", "Robert", "Linda", "David", "Patricia", "Carlos", "Susan", "Thomas", "Karen", "Miguel", "Nancy", "Daniel", "Betty", "Jose", "Sandra", "Paul", "Donna", "Mark", "Carol"];
const LAST = ["Garcia", "Smith", "Johnson", "Martinez", "Williams", "Lopez", "Brown", "Hernandez", "Jones", "Gonzalez", "Miller", "Davis", "Rodriguez", "Wilson", "Anderson", "Taylor", "Moore", "Jackson", "Martin", "Lee"];
const TOTAL_ROWS = 300;
const DUP_ROWS = 10; // the last 10 rows re-use the APN of rows 0..9 (same state+county)

function apnFor(i: number): string {
  const c = COUNTIES[i % COUNTIES.length];
  return `${c[1].slice(0, 3).toUpperCase()}-${String(100 + i).padStart(5, "0")}-${i % 9}`;
}
function buildRows() {
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < TOTAL_ROWS; i++) {
    const c = COUNTIES[i % COUNTIES.length];
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    const dupOf = i >= TOTAL_ROWS - DUP_ROWS ? i - (TOTAL_ROWS - DUP_ROWS) : null;
    const row: Record<string, string> = {
      firstName: first,
      lastName: `${last}`,
      address: `${1000 + i} ${["Mesa", "Juniper", "Sage", "Cholla", "Ocotillo"][i % 5]} Rd`,
      city: ["Willcox", "Kingman", "Holbrook", "St Johns", "Sierra Blanca", "Marfa", "Alpine", "Deming", "Belen", "Estancia"][i % 10],
      state: c[0],
      county: c[1],
      zip: c[2],
      apn: dupOf !== null ? apnFor(dupOf) : apnFor(i),
    };
    if (i % 7 !== 3) row.email = `${first}.${last}.${i}@lifecycle-sim.test`.toLowerCase();
    if (i % 11 !== 5) row.phone = `+1520555${String(1000 + i).padStart(4, "0")}`;
    rows.push(row);
  }
  return rows;
}

// ─── signed webhooks ────────────────────────────────────────────────────────
function replyToAddress(leadId: number, orgId: number): string {
  const hash = crypto.createHmac("sha256", INBOUND_EMAIL_HMAC_SECRET).update(`${leadId}:${orgId}`).digest("hex").slice(0, 12);
  return `inbox+${leadId}-${hash}@replies.acreos.com`;
}
async function postInboundEmail(c: SimClient, payload: Record<string, unknown>, opts?: { badSig?: boolean }) {
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", INBOUND_EMAIL_WEBHOOK_SECRET).update(`${ts}.`).update(raw).digest("hex");
  return c.call("POST", "/api/webhooks/inbound-email", undefined, {
    raw,
    noAuth: true,
    noCsrf: true,
    headers: {
      "content-type": "application/json",
      "x-acreos-timestamp": ts,
      "x-acreos-signature": opts?.badSig ? sig.replace(/^./, (ch) => (ch === "a" ? "b" : "a")) : sig,
    },
  });
}
async function postTwilioSms(c: SimClient, params: Record<string, string>) {
  const proto = "https", host = "sim.acreos.test";
  const url = `${proto}://${host}/api/webhooks/twilio/sms`;
  const toSign = url + Object.keys(params).sort().reduce((s, k) => s + k + params[k], "");
  const signature = crypto.createHmac("sha1", TWILIO_AUTH_TOKEN).update(Buffer.from(toSign, "utf-8")).digest("base64");
  const raw = new URLSearchParams(params).toString();
  return c.call("POST", "/api/webhooks/twilio/sms", undefined, {
    raw,
    noAuth: true,
    noCsrf: true,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
      "x-forwarded-proto": proto,
      "x-forwarded-host": host,
    },
  });
}

// ─── shared state across weeks ──────────────────────────────────────────────
interface LeadRow { id: number; apn: string | null; email: string | null; phone: string | null; state: string | null; county: string | null; do_not_contact: boolean; tcpa_consent: boolean; status: string }
let orgId = 0;
let ownerUserId = "";
let leadsDb: LeadRow[] = [];
let dncIds: number[] = [];
let tcpaIds: number[] = [];
const propertyIds: number[] = []; // the 40 real properties, index-aligned with leadsDb[0..39]
let emailedIds: number[] = [];
let responders: LeadRow[] = [];
let stopLead: LeadRow | null = null;
let smsCampaignId = 0;
const offerIds: number[] = [];
const acceptedIdx: number[] = []; // responder indexes whose offer was accepted
const dealIds: number[] = [];
const noteIds: number[] = [];
let vaTeamMemberId = 0;

async function creditBalance(): Promise<number> {
  return Math.round(Number((await one(`SELECT credit_balance FROM organizations WHERE id=$1`, [orgId])).credit_balance));
}
async function simCount(category?: string): Promise<number> {
  return category
    ? countWhere(`simulated_actions WHERE organization_id=$1 AND category=$2`, [orgId, category])
    : countWhere(`simulated_actions WHERE organization_id=$1`, [orgId]);
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  await db.connect();

  // ── setup: a FRESH persona, auto-provisioned org, pro tier, sim mode ──────
  let slug = process.env.LIFECYCLE_SLUG ?? "lifecycle-operator";
  const existing = await one(`SELECT id FROM users WHERE clerk_user_id=$1`, [personaTestUserId(slug)]);
  if (existing) {
    // Keep the campaign slug but never re-use a tenant: counts below assume a
    // clean org, and deleting a prior org across ~40 FK'd tables is riskier
    // than a suffix.
    slug = `${slug}-${Date.now().toString(36)}`;
    recordMetric(SIM, "setup/slug-suffixed", { reason: "prior run's persona exists", slug });
  }
  const clerkId = personaTestUserId(slug);
  const ownerEmail = `${clerkId}@persona-test.local`;
  const u = await one(
    `INSERT INTO users (clerk_user_id, email, persona, first_name, last_name, tos_accepted_at, privacy_accepted_at)
     VALUES ($1, $2, 'land_investor', 'Lifecycle', 'Operator', now(), now())
     ON CONFLICT (clerk_user_id) DO NOTHING RETURNING id`,
    [clerkId, ownerEmail],
  ) ?? (await one(`SELECT id FROM users WHERE clerk_user_id=$1`, [clerkId]));
  ownerUserId = u.id;
  const c = new SimClient(slug);
  // A cookie-less request (every real webhook delivery) resolves to the DEFAULT
  // E2E identity under the test-auth bypass. When that identity has no users
  // row, hydrateUser falls through to clerkClient.users.getUser() with the
  // dummy key and every webhook is a Clerk 401 (`api_response_error`) before
  // its own signature check runs. Seed it like the Playwright suite does, and
  // record that this environment needs it.
  const e2eDefault = await one(`SELECT id FROM users WHERE clerk_user_id='e2e_test_user'`);
  if (!e2eDefault) {
    await q(`INSERT INTO users (clerk_user_id, email, persona, first_name, last_name, tos_accepted_at, privacy_accepted_at)
             VALUES ('e2e_test_user','e2e_test_user@persona-test.local','land_investor','E2E','Customer',now(),now()) ON CONFLICT (clerk_user_id) DO NOTHING`);
    recordMetric(SIM, "setup/seeded-default-e2e-user", { note: "cookie-less webhooks were 401 api_response_error (Clerk SDK) until e2e_test_user existed" });
    finding("P3", "test-env", "Under E2E auth, a cookie-less /api POST with the default identity unseeded fails with a Clerk SDK error code, not an AcreOS one", "POST /api/webhooks/inbound-email and /twilio/sms without cookies → 401 {error:'api_response_error', message:'Unauthorized'} (thrown by clerkClient.users.getUser on a dummy key) until a users row for e2e_test_user exists", "Not a production path, but it means any CI job that exercises inbound webhooks without seeding the default identity gets a misleading failure.");
  }

  await section("setup", "provision", async () => {
    const me = await c.get("/api/auth/user");
    note("setup", "GET /api/auth/user", me, `user=${me.body?.id ?? "?"} email=${me.body?.email ?? "?"}`);
    const org = await c.get("/api/organization"); // getOrCreateOrg provisions the org
    const row = await one(`SELECT id, subscription_tier, trial_ends_at FROM organizations WHERE owner_id=$1 ORDER BY id LIMIT 1`, [ownerUserId]);
    if (!row) throw new Error("org was not auto-provisioned for the new persona");
    orgId = row.id;
    ORG_TWILIO_NUMBER = `+1500555${String(orgId).padStart(4, "0")}`;
    c.setCookie("acreos_active_org", String(orgId));
    note("setup", "GET /api/organization (auto-provision)", org, `org=${orgId} tier=${row.subscription_tier}`);

    // `land_investor` is a PERSONA (the derived frame), not a businessType; the
    // registry's land vertical is `land_flipper`. Record what the API says when
    // handed the persona word, then onboard with the registry value.
    const wrong = await c.post("/api/onboarding/complete", { businessType: "land_investor", seedSampleData: false });
    note("setup", "POST /api/onboarding/complete businessType=land_investor (persona word)", wrong, msg(wrong));
    const onb = await c.post("/api/onboarding/complete", {
      businessType: "land_flipper",
      orgName: "Lifecycle Land Co",
      goals: ["buy_land", "seller_finance"],
      seedSampleData: false,
    });
    const onbRow = await one(`SELECT onboarding_completed, onboarding_data, investor_type FROM organizations WHERE id=$1`, [orgId]);
    const sampleLeads = await countWhere(`leads WHERE organization_id=$1 AND source IN ('sample_data','sample')`, [orgId]);
    const sampleProps = await countWhere(`properties WHERE organization_id=$1 AND apn LIKE 'SAMPLE-%'`, [orgId]);
    note("setup", "POST /api/onboarding/complete (land_flipper, seedSampleData:false)", onb, `${onb.status >= 400 ? msg(onb) + " | " : ""}completed=${onbRow.onboarding_completed} businessType=${onbRow.onboarding_data?.businessType} investor_type=${onbRow.investor_type} sampleLeads=${sampleLeads} sampleProps=${sampleProps}`);
    if (onb.status === 200 && !onbRow.onboarding_completed) finding("P1", "onboarding", "onboarding/complete returned 200 but onboarding_completed is still false", onb.text.slice(0, 200));
    if (sampleProps > 0) finding("P2", "honesty", "seedSampleData:false still seeded sample properties", `${sampleProps} SAMPLE-* parcels`);
    if (sampleLeads > 0) finding("P2", "honesty", "seedSampleData:false still seeded sample leads", `leads with source sample_data/sample = ${sampleLeads}`);

    await q(
      `UPDATE organizations SET subscription_tier='pro', credit_balance=50000,
         settings = coalesce(settings,'{}')::jsonb || '{"simulationMode":true}'::jsonb
       WHERE id=$1`,
      [orgId],
    );
    const after = await one(`SELECT subscription_tier, credit_balance, settings FROM organizations WHERE id=$1`, [orgId]);
    note("setup", "SQL pro/sim/credits", { status: "sql", ms: 0 }, `tier=${after.subscription_tier} credits=${after.credit_balance}¢ simulationMode=${after.settings?.simulationMode}`);
    const usage = await c.get("/api/usage");
    note("setup", "GET /api/usage", usage, `tier=${usage.body?.tier} limits leads=${usage.body?.usage?.leads?.limit} properties=${usage.body?.usage?.properties?.limit} notes=${usage.body?.usage?.notes?.limit}`);
  });
  if (!orgId) { console.error("no org — aborting"); process.exit(1); }

  // ── WEEK 1 ────────────────────────────────────────────────────────────────
  await section("w1", "csv-import 300 leads", async () => {
    const rows = buildRows();
    const r = await c.post("/api/leads/csv-import", { rows });
    const n = await countWhere(`leads WHERE organization_id=$1 AND source='csv_import' AND deleted_at IS NULL`, [orgId]);
    const b = r.body ?? {};
    note("w1", "POST /api/leads/csv-import (300 rows)", r, `resp imported=${b.imported} skippedExisting=${b.skippedExisting} skippedInvalid=${b.skippedInvalid} skippedDupInFile=${b.skippedDuplicateInFile} | DB csv_import rows=${n}`);
    if (r.status === 200) {
      if (b.imported !== n) finding("P1", "data-integrity", "csv-import reported a different count than it persisted", `response imported=${b.imported}, DB rows=${n}`);
      if (b.imported !== TOTAL_ROWS - DUP_ROWS || b.skippedDuplicateInFile !== DUP_ROWS)
        finding("P2", "import", `csv-import dedupe arithmetic off: expected ${TOTAL_ROWS - DUP_ROWS} imported + ${DUP_ROWS} in-file APN dupes`, JSON.stringify(b).slice(0, 300));
      const missingEmail = await countWhere(`leads WHERE organization_id=$1 AND source='csv_import' AND email IS NULL`, [orgId]);
      const missingPhone = await countWhere(`leads WHERE organization_id=$1 AND source='csv_import' AND phone IS NULL`, [orgId]);
      recordMetric(SIM, "w1/import-nulls", { missingEmail, missingPhone });
      if (missingEmail === 0 || missingPhone === 0) finding("P2", "import", "csv-import turned missing email/phone into non-null values", `missingEmail=${missingEmail} missingPhone=${missingPhone} (list had ~43 blank emails, ~27 blank phones)`);
    }
    // the second import of the SAME file must be a no-op (APN dedupe across requests)
    const r2 = await c.post("/api/leads/csv-import", { rows: rows.slice(0, 50) });
    const n2 = await countWhere(`leads WHERE organization_id=$1 AND source='csv_import' AND deleted_at IS NULL`, [orgId]);
    note("w1", "POST /api/leads/csv-import (re-import 50)", r2, `resp imported=${r2.body?.imported} skippedExisting=${r2.body?.skippedExisting} | DB rows=${n2}`);
    if (r2.status === 200 && (r2.body?.imported !== 0 || n2 !== n)) finding("P1", "data-integrity", "Re-importing the same list created duplicate leads", `imported=${r2.body?.imported}, rows ${n}→${n2}`);

    leadsDb = await q<LeadRow>(`SELECT id, apn, email, phone, state, county, do_not_contact, tcpa_consent, status FROM leads WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY id`, [orgId]);
  });

  await section("w1", "consent flags (5% DNC, 30% TCPA)", async () => {
    if (leadsDb.length === 0) { skip("w1/consent", "no leads imported"); return; }
    dncIds = leadsDb.filter((_, i) => i % 20 === 0).map((l) => l.id).slice(0, Math.round(leadsDb.length * 0.05));
    tcpaIds = leadsDb.filter((l) => l.phone && !dncIds.includes(l.id)).map((l) => l.id).slice(0, Math.round(leadsDb.length * 0.3));
    const r1 = await c.post("/api/leads/bulk-update", { ids: dncIds, updates: { doNotContact: true, optOutReason: "List marked DNC" } });
    const dncDb = await countWhere(`leads WHERE organization_id=$1 AND do_not_contact=true`, [orgId]);
    note("w1", "POST /api/leads/bulk-update doNotContact", r1, `requested=${dncIds.length} updatedCount=${r1.body?.updatedCount} | DB dnc=${dncDb}`);
    // Timestamps over JSON can only be strings; record what the contract does with ISO-8601.
    const iso = await c.post("/api/leads/bulk-update", { ids: tcpaIds.slice(0, 1), updates: { tcpaConsent: true, consentSource: "written_form_sim", consentDate: new Date().toISOString() } });
    note("w1", "POST /api/leads/bulk-update with ISO consentDate", iso, msg(iso));
    if (iso.status === 400 && /expected date/i.test(iso.text)) finding("P3", "api-contract", "Timestamp fields reject ISO-8601 strings over JSON ('expected date, received string')", `bulk-update consentDate → ${msg(iso)}; the only representation a JSON client can send is refused, so the field is unsettable over the API`);
    const r2 = await c.post("/api/leads/bulk-update", { ids: tcpaIds, updates: { tcpaConsent: true, consentSource: "written_form_sim" } });
    const tcpaDb = await countWhere(`leads WHERE organization_id=$1 AND tcpa_consent=true`, [orgId]);
    const consentDated = await countWhere(`leads WHERE organization_id=$1 AND tcpa_consent=true AND consent_date IS NOT NULL`, [orgId]);
    note("w1", "POST /api/leads/bulk-update tcpaConsent", r2, `${r2.status >= 400 ? msg(r2) + " | " : ""}requested=${tcpaIds.length} updatedCount=${r2.body?.updatedCount} | DB tcpa=${tcpaDb} with consent_date=${consentDated}`);
    if (r2.status < 300 && tcpaDb > 0 && consentDated === 0) finding("P2", "compliance", "Granting tcpaConsent over the API leaves consent_date NULL (no timestamp of when consent was captured)", `tcpa=${tcpaDb} consent_date set=${consentDated}`, "A TCPA defence needs the date consent was obtained; the record cannot show one.");
    if (r1.status < 300 && dncDb !== dncIds.length) finding("P1", "compliance", "bulk-update doNotContact did not persist for every requested lead", `requested ${dncIds.length}, DB ${dncDb}`);
    if (r2.status < 300 && tcpaDb !== tcpaIds.length) finding("P1", "compliance", "bulk-update tcpaConsent did not persist for every requested lead", `requested ${tcpaIds.length}, DB ${tcpaDb}`);
    leadsDb = await q<LeadRow>(`SELECT id, apn, email, phone, state, county, do_not_contact, tcpa_consent, status FROM leads WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY id`, [orgId]);
  });

  await section("w1", "40 properties + pro limit probe", async () => {
    const times: number[] = [];
    let last: Resp | null = null;
    for (let i = 0; i < 40; i++) {
      const l = leadsDb[i];
      const body: Record<string, unknown> = {
        apn: l?.apn ?? apnFor(i), county: l?.county ?? COUNTIES[i % 10][1], state: l?.state ?? COUNTIES[i % 10][0],
        sizeAcres: String(1 + Math.floor(rnd() * 40)), address: `${1000 + i} Parcel Rd`, zoning: "RU-4", roadAccess: i % 3 === 0 ? "dirt" : "paved",
      };
      if (i === 0) { body.latitude = "31.9135"; body.longitude = "-109.8526"; }
      last = await c.post("/api/properties", body);
      times.push(last.ms);
      if (last.status === 201 && last.body?.id) propertyIds.push(last.body.id);
      else if (last.status >= 500) { note("w1", `POST /api/properties #${i}`, last, msg(last)); }
    }
    const n = await countWhere(`properties WHERE organization_id=$1 AND status <> 'deleted'`, [orgId]);
    note("w1", "POST /api/properties x40", { status: last?.status ?? 0, ms: times.reduce((a, b) => a + b, 0), text: last?.text }, `created=${propertyIds.length} | DB=${n} avg=${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);

    // fill to the pro cap (100) and record the 101st
    const fillers: number[] = [];
    let refusal: Resp | null = null;
    for (let i = 40; i < 102; i++) {
      const r = await c.post("/api/properties", { apn: `FILL-${i}-${orgId}`, county: "Cochise", state: "AZ", sizeAcres: "5" });
      if (r.status === 201) fillers.push(r.body.id);
      else { refusal = r; note("w1", `POST /api/properties #${i + 1} (limit probe)`, r, `${msg(r)} | DB non-deleted=${await countWhere(`properties WHERE organization_id=$1 AND status <> 'deleted'`, [orgId])}`); break; }
    }
    if (!refusal) finding("P1", "billing", "Pro tier property limit (100) was never enforced — 102 properties created", `fillers=${fillers.length}`);
    else if (refusal.status !== 429) finding("P2", "api-contract", `Property limit refusal is ${refusal.status}, not 429`, msg(refusal));
    else if (!/limit|upgrade/i.test(refusal.text)) finding("P2", "ux", "Property-limit refusal does not say what the limit is or what to do", msg(refusal));
    // free the cap again and prove deletion frees it (DEFECT-0183)
    let delFail = 0;
    for (const id of fillers) { const d = await c.delete(`/api/properties/${id}`); if (d.status >= 300) delFail++; }
    const afterDel = await countWhere(`properties WHERE organization_id=$1 AND status <> 'deleted'`, [orgId]);
    const again = await c.post("/api/properties", { apn: `FILL-after-delete-${orgId}`, county: "Cochise", state: "AZ", sizeAcres: "5" });
    note("w1", "DELETE fillers then POST /api/properties", again, `deleted=${fillers.length - delFail}/${fillers.length} DB non-deleted=${afterDel} create-after-delete=${again.status}`);
    if (again.status === 429) finding("P2", "billing", "Deleting properties does not free the plan limit", msg(again));
    if (again.status === 201) await c.delete(`/api/properties/${again.body.id}`);
  });

  await section("w1", "enrich 3 properties (no provider keys)", async () => {
    for (let i = 0; i < 3 && i < propertyIds.length; i++) {
      const pid = propertyIds[i];
      const r = await withTimeout(c.post(`/api/properties/${pid}/enrich`), 60_000, { status: "timeout", ms: 60_000, text: "", body: null, headers: new Headers() } as unknown as Resp);
      const row = await one(`SELECT enrichment_status, enriched_at, latitude, enrichment_data FROM properties WHERE id=$1`, [pid]);
      const data = row?.enrichment_data ?? {};
      const cats = Object.keys(data).filter((k) => data[k] && typeof data[k] === "object" && !["errors", "metadata"].includes(k));
      const sources = new Set<string>();
      const walk = (v: any, depth = 0) => { if (!v || depth > 4) return; if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1)); if (typeof v === "object") { if (typeof v.source === "string") sources.add(v.source); Object.values(v).forEach((x) => walk(x, depth + 1)); } };
      walk(data);
      const errs0 = data?.errors ? Object.keys(data.errors) : [];
      note("w1", `POST /api/properties/${pid}/enrich (${i === 0 ? "has coords" : "no coords"})`, r, `${(r.status as number) >= 400 ? msg(r as Resp) : `categories=${cats.length} lookupErrors=${errs0.length}`} | DB status=${row?.enrichment_status ?? "null"} enriched_at=${row?.enriched_at ? "set" : "null"} sources=[${[...sources].slice(0, 6).join(",")}]`, { noAutoFinding: i === 2 });
      if (i === 1 && (r.status as number) >= 500) {
        // the 5xx itself is filed by note(); this is the UX angle, once
        finding("P2", "ux", "Enriching a property without coordinates is a 500 ('Something broke on our end'), not a refusal that says 'add coordinates first'", `${msg(r as Resp)} — propertyEnrichment.enrichProperty throws 'Property missing coordinates' and the route maps every throw to Errors.internal`);
      }
      const fab = [...sources].filter((s) => /\b(sample|placeholder|mock|fake|lorem)\b/i.test(s));
      if (fab.length) finding("P1", "honesty", "Enrichment stored a non-real source label as data", `property ${pid} sources: ${fab.join(", ")}`);
      const errs = data?.errors ? Object.keys(data.errors) : [];
      const bothErrAndData = errs.filter((k) => cats.includes(k));
      if (bothErrAndData.length) finding("P1", "honesty", "Enrichment reports data for a category whose lookup also errored", `property ${pid}: ${bothErrAndData.join(", ")}`);
      recordMetric(SIM, `w1/enrich-${pid}`, { status: r.status, categories: cats, errors: errs.length, sources: [...sources] });
    }
  });

  // ── WEEK 2 ────────────────────────────────────────────────────────────────
  let dmId = 0, emailCampaignId = 0;
  await section("w2", "create 3 campaigns", async () => {
    const mk = async (body: Record<string, unknown>) => c.post("/api/campaigns", body);
    const dm = await mk({ name: "Q4 Land Postcards", type: "direct_mail", content: "Hi {{firstName}}, we buy vacant land in {{county}} County for cash. Call us for a no-obligation offer.", budget: "500" });
    dmId = dm.body?.id ?? 0;
    note("w2", "POST /api/campaigns direct_mail", dm, `id=${dmId} status=${dm.body?.status}`);
    const em = await mk({ name: "Q4 Land Email", type: "email", subject: "Your {{county}} County parcel", content: "<p>Hi {{firstName}},</p><p>We are buying vacant land in {{county}} County, {{state}}. Reply to this email if you'd consider an offer.</p>" });
    emailCampaignId = em.body?.id ?? 0;
    note("w2", "POST /api/campaigns email", em, `id=${emailCampaignId}`);
    const sm = await mk({ name: "Q4 Land SMS", type: "sms", content: "Hi {{firstName}}, interested in a cash offer for your {{county}} County land? Reply STOP to opt out." });
    smsCampaignId = sm.body?.id ?? 0;
    note("w2", "POST /api/campaigns sms", sm, `id=${smsCampaignId}`);
    const n = await countWhere(`campaigns WHERE organization_id=$1`, [orgId]);
    recordMetric(SIM, "w2/campaigns-in-db", n);
  });

  await section("w2", "pre-send-check + estimate-cost", async () => {
    if (!dmId) { skip("w2/pre-send-check", "no direct-mail campaign"); return; }
    const ids = leadsDb.slice(0, 60).map((l) => l.id);
    const dncIn = ids.filter((id) => dncIds.includes(id)).length;
    const r = await c.post(`/api/campaigns/${dmId}/pre-send-check`, { leadIds: ids, pieceType: "postcard_4x6" });
    const d = r.body?.dedupe;
    note("w2", "POST pre-send-check (60 leads)", r, `input=${d?.input} accepted=${d?.accepted} skipped=${d?.skipped} dnc=${d?.breakdown?.doNotContact} missingAddr=${d?.breakdown?.missingAddress} runway=${r.body?.creditBurn?.lettersOfRunway} required=${r.body?.creditBurn?.requiredCents}¢ | sent DNC=${dncIn}`);
    if (r.status === 200 && d) {
      if (d.breakdown?.doNotContact !== dncIn) finding("P2", "compliance", "pre-send-check does not account for every DNC lead in the batch", `batch had ${dncIn} DNC leads, breakdown.doNotContact=${d.breakdown?.doNotContact}`);
      const sumBreak = Object.values(d.breakdown ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
      if (d.input !== d.accepted + d.skipped || sumBreak !== d.skipped) finding("P2", "ux", "pre-send-check skip arithmetic does not reconcile (silent exclusion)", `input=${d.input} accepted=${d.accepted} skipped=${d.skipped} breakdownSum=${sumBreak}`);
      if (r.body.creditBurn?.requiredCents !== 75 * d.accepted) finding("P2", "billing", "pre-send-check required credits ≠ 75¢ × accepted", JSON.stringify(r.body.creditBurn));
    }
    const e = await c.get(`/api/campaigns/${dmId}/estimate-cost?pieceType=postcard_4x6&recipientCount=50`);
    note("w2", "GET estimate-cost (50 postcards)", e, JSON.stringify(e.body).slice(0, 160));
  });

  await section("w2", "send-email to 100 leads (credits + simulated)", async () => {
    if (!emailCampaignId) { skip("w2/send-email", "no email campaign"); return; }
    const withEmail = leadsDb.filter((l) => l.email);
    const dncWithEmail = withEmail.filter((l) => dncIds.includes(l.id)).slice(0, 5);
    const okWithEmail = withEmail.filter((l) => !dncIds.includes(l.id)).slice(0, 100 - dncWithEmail.length);
    const targets = [...okWithEmail, ...dncWithEmail];
    const before = await creditBalance();
    const simBefore = await simCount("email");
    const r = await c.post(`/api/campaigns/${emailCampaignId}/send-email`, { leadIds: targets.map((l) => l.id) });
    const after = await creditBalance();
    const simAfter = await simCount("email");
    const delivered = await countWhere(`campaign_delivery_events WHERE campaign_id=$1 AND channel='email'`, [emailCampaignId]);
    const dncDelivered = dncWithEmail.length
      ? await countWhere(`campaign_delivery_events WHERE campaign_id=$1 AND channel='email' AND lead_id = ANY($2::int[])`, [emailCampaignId, dncWithEmail.map((l) => l.id)])
      : 0;
    const b = r.body ?? {};
    note("w2", "POST send-email (95 ok + 5 DNC)", r, `sent=${b.sent} failed=${b.failed} skippedDup=${b.skippedDuplicates} | credits ${before}→${after} (Δ${before - after}¢) simulated_actions.email +${simAfter - simBefore} delivery_events=${delivered} dncDelivered=${dncDelivered}`);
    if (r.status === 200) {
      if (before - after !== b.sent) finding("P1", "billing", "Email send credit deduction ≠ 1¢ × sent", `Δ=${before - after}¢ sent=${b.sent} failed=${b.failed}`);
      if (simAfter - simBefore !== b.sent) finding("P1", "honesty", "send-email reported sends that have no simulated_actions record (or vice-versa)", `sent=${b.sent} simulated rows=${simAfter - simBefore}`);
      if (delivered !== b.sent) finding("P1", "data-integrity", "campaign_delivery_events ≠ sent", `events=${delivered} sent=${b.sent}`);
      if (dncDelivered > 0) finding("P1", "compliance", "send-email delivered to leads flagged doNotContact", `${dncDelivered} of ${dncWithEmail.length} DNC leads received the campaign; the handler filters only on 'has an email'`, "A seller who opted out of ALL contact gets marketing email; TCPA/CAN-SPAM exposure per message.");
      const realSend = await countWhere(`simulated_actions WHERE organization_id=$1 AND category='email' AND payload->>'to' IS NULL`, [orgId]);
      recordMetric(SIM, "w2/email-sim-rows-without-recipient", realSend);
      emailedIds = okWithEmail.map((l) => l.id);
    }
    const again = await c.post(`/api/campaigns/${emailCampaignId}/send-email`, { leadIds: targets.slice(0, 10).map((l) => l.id) });
    const after2 = await creditBalance();
    note("w2", "POST send-email (same 10 again)", again, `${msg(again)} | credits ${after}→${after2}`);
    if (again.status === 200 && again.body?.sent > 0) finding("P2", "billing", "Re-sending a campaign to already-sent leads sent (and charged) again", JSON.stringify(again.body).slice(0, 200));
    if (after2 !== after) finding("P1", "billing", "A fully-deduped re-send still moved the credit balance", `${after}→${after2}`);
  });

  await section("w2", "send-sms to consented leads (TCPA gate)", async () => {
    if (!smsCampaignId) { skip("w2/send-sms", "no sms campaign"); return; }
    const byId = new Map(leadsDb.map((l) => [l.id, l]));
    const consented = tcpaIds.map((id) => byId.get(id)!).filter((l) => l.phone).slice(0, 25);
    const nonConsented = leadsDb.filter((l) => l.phone && !l.tcpa_consent && !l.do_not_contact).slice(0, 8);
    const dnc = leadsDb.filter((l) => l.phone && l.do_not_contact).slice(0, 3);
    const targets = [...consented, ...nonConsented, ...dnc];
    const before = await creditBalance();
    const simBefore = await simCount("sms");
    const r = await c.post(`/api/campaigns/${smsCampaignId}/send-sms`, { leadIds: targets.map((l) => l.id) });
    const after = await creditBalance();
    const simAfter = await simCount("sms");
    const b = r.body ?? {};
    const sentTo = await q<{ to: string }>(`SELECT payload->>'to' AS "to" FROM simulated_actions WHERE organization_id=$1 AND category='sms' AND (payload->>'campaignId')::int=$2`, [orgId, smsCampaignId]);
    const consentedPhones = new Set(consented.map((l) => l.phone));
    const leaked = sentTo.filter((s) => !consentedPhones.has(s.to));
    note("w2", "POST send-sms (25 consented + 8 unconsented + 3 DNC)", r, `${r.status >= 400 ? msg(r) + " | " : ""}sent=${b.sent} failed=${b.failed} tcpaBlocked=${b.tcpaBlocked} quietHours=${b.quietHoursBlocked} | credits Δ${before - after}¢ sim.sms +${simAfter - simBefore} leakedToUnconsented=${leaked.length}`);
    if (r.status === 200) {
      if (b.tcpaBlocked !== nonConsented.length + dnc.length) finding("P2", "compliance", "send-sms tcpaBlocked count ≠ number of unconsented+DNC leads in the batch", `expected ${nonConsented.length + dnc.length}, got ${b.tcpaBlocked}; samples=${JSON.stringify(b.tcpaBlockedSamples).slice(0, 200)}`);
      if (leaked.length) finding("P1", "compliance", "An SMS was (simulated-)sent to a lead without TCPA consent or flagged DNC", leaked.map((l) => l.to).join(","));
      if (before - after !== 3 * b.sent) finding("P1", "billing", "SMS credit deduction ≠ 3¢ × sent", `Δ=${before - after}¢ sent=${b.sent}`);
      if (b.quietHoursBlocked > 0) recordMetric(SIM, "w2/sms-quiet-hours", { blocked: b.quietHoursBlocked, note: "wall-clock dependent; not a defect" });
      if (b.sent === 0 && b.quietHoursBlocked > 0) skip("w2/send-sms", `all ${b.quietHoursBlocked} consented recipients blocked by quiet hours at ${new Date().toISOString()}`);
      if (!b.tcpaBlockedSamples?.[0]?.reason) finding("P2", "ux", "send-sms excludes TCPA-blocked leads without a per-lead reason", JSON.stringify(b).slice(0, 200));
    } else if (r.status === 400) {
      if (!/TCPA|quiet|consent|recipients/i.test(r.text)) finding("P2", "ux", "send-sms refused without naming why", msg(r));
    }
  });

  await section("w2", "send-direct-mail (no Lob key)", async () => {
    if (!dmId) { skip("w2/send-direct-mail", "no direct-mail campaign"); return; }
    const ids = leadsDb.filter((l) => !l.do_not_contact).slice(0, 10).map((l) => l.id);
    const before = await creditBalance();
    const r = await c.post(`/api/campaigns/${dmId}/send-direct-mail`, { pieceType: "postcard_4x6", leadIds: ids }, { headers: { "idempotency-key": `lc-dm-${orgId}-1` } });
    const after = await creditBalance();
    const lob = await simCount("lob");
    note("w2", "POST send-direct-mail (10 postcards)", r, `${msg(r)} | credits ${before}→${after} sim.lob=${lob}`);
    if (r.status >= 200 && r.status < 300) finding("P1", "honesty", "Direct mail 'sent' with no Lob key configured", r.text.slice(0, 300));
    else if (r.status >= 500) { /* filed by note() */ }
    else if (!/lob|configured|integration|return address|sender/i.test(r.text)) finding("P2", "ux", "Direct-mail refusal does not say what is missing", msg(r));
    if (after !== before) finding("P1", "billing", "A refused direct-mail send still moved credits", `${before}→${after}`);
  });

  // ── WEEK 3 ────────────────────────────────────────────────────────────────
  await section("w3", "15 inbound email replies (signed webhook)", async () => {
    if (emailedIds.length < 15) { skip("w3/inbound-email", `only ${emailedIds.length} leads were emailed`); return; }
    const byId = new Map(leadsDb.map((l) => [l.id, l]));
    responders = emailedIds.slice(0, 15).map((id) => byId.get(id)!);
    const unreadBefore = await countWhere(`inbox_messages WHERE organization_id=$1 AND is_read=false`, [orgId]);
    let ok = 0; let lastResp: Resp | null = null; let totalMs = 0;
    for (const [i, l] of responders.entries()) {
      const r = await postInboundEmail(c, {
        from: l.email, to: replyToAddress(l.id, orgId), subject: "Re: Your parcel",
        textBody: `Yes I'd consider an offer on my ${l.county} County land. What are you thinking? -${l.id}`,
        messageId: `<lc-${orgId}-${l.id}-${i}@lifecycle-sim.test>`,
      });
      lastResp = r; totalMs += r.ms;
      if (r.status === 200 && r.body?.success && r.body?.leadId === l.id) ok++;
      else if (r.status >= 500) note("w3", `inbound-email lead ${l.id}`, r, msg(r));
    }
    const responded = await countWhere(`leads WHERE organization_id=$1 AND status='responded' AND id = ANY($2::int[])`, [orgId, responders.map((l) => l.id)]);
    const emails = await countWhere(`lead_emails WHERE organization_id=$1 AND direction='inbound'`, [orgId]);
    const unreadAfter = await countWhere(`inbox_messages WHERE organization_id=$1 AND is_read=false`, [orgId]);
    const inbox = await c.get(`/api/inbox?isRead=false&limit=100`);
    note("w3", "POST /api/webhooks/inbound-email x15", { status: lastResp?.status ?? 0, ms: totalMs, text: lastResp?.text }, `accepted=${ok}/15 | DB responded=${responded} lead_emails(inbound)=${emails} inbox unread ${unreadBefore}→${unreadAfter} GET /api/inbox unread=${Array.isArray(inbox.body) ? inbox.body.length : "?"}`);
    if (ok !== 15) finding("P1", "inbound", "Signed inbound-email webhook rejected a valid reply", `${ok}/15 accepted; last=${lastResp?.status} ${msg(lastResp!)}`);
    if (responded !== ok) finding("P1", "data-integrity", "Inbound reply accepted but lead did not move to 'responded'", `accepted=${ok} responded=${responded}`);
    if (emails !== ok) finding("P1", "data-integrity", "Inbound reply accepted but lead_emails row missing", `accepted=${ok} rows=${emails}`);
    if (unreadAfter - unreadBefore !== ok) finding("P1", "data-integrity", "Inbox unread count did not grow by the number of accepted replies", `${unreadBefore}→${unreadAfter} accepted=${ok}`);
    // replay + tamper
    const l0 = responders[0];
    const replay = await postInboundEmail(c, { from: l0.email, to: replyToAddress(l0.id, orgId), subject: "Re: Your parcel", textBody: "dup", messageId: `<lc-${orgId}-${l0.id}-0@lifecycle-sim.test>` });
    const emails2 = await countWhere(`lead_emails WHERE organization_id=$1 AND direction='inbound'`, [orgId]);
    note("w3", "inbound-email replay (same Message-ID)", replay, `deduped=${replay.body?.deduped} lead_emails=${emails2}`);
    if (emails2 !== emails) finding("P1", "data-integrity", "Replayed inbound email (same Message-ID) was stored twice", `${emails}→${emails2}`);
    const bad = await postInboundEmail(c, { from: l0.email, to: replyToAddress(l0.id, orgId), textBody: "forged", messageId: `<forged-${Date.now()}@x>` }, { badSig: true });
    note("w3", "inbound-email forged signature", bad, msg(bad));
    if (bad.status > 0 && bad.status < 400) finding("P0", "security", "Inbound-email webhook accepted a forged HMAC signature", bad.text.slice(0, 200));
    const wrongHash = await postInboundEmail(c, { from: l0.email, to: `inbox+${l0.id}-000000000000@replies.acreos.com`, textBody: "wrong hash", messageId: `<wrong-${Date.now()}@x>` });
    note("w3", "inbound-email wrong lead hash", wrongHash, msg(wrongHash));
    if (wrongHash.status > 0 && wrongHash.status < 400) finding("P1", "security", "Inbound email with a wrong per-lead hash was accepted", wrongHash.text.slice(0, 200));
  });

  await section("w3", "5 inbound SMS via Twilio webhook incl. STOP", async () => {
    // The front door (POST /api/sms/config) verifies the SID/token against
    // api.twilio.com before storing, which a sim cannot pass; record that, then
    // write the same shape saveTwilioCredentials() writes.
    const cfg = await c.post("/api/sms/config", { accountSid: "ACe2e00000000000000000000000000000", authToken: TWILIO_AUTH_TOKEN, fromPhoneNumber: ORG_TWILIO_NUMBER });
    note("w3", "POST /api/sms/config (BYO Twilio, dummy creds)", cfg, msg(cfg));
    if (cfg.status < 300) finding("P1", "honesty", "Dummy Twilio credentials were accepted as a connected SMS identity", cfg.text.slice(0, 200));
    await q(`INSERT INTO organization_integrations (organization_id, provider, is_enabled, credentials, settings)
             VALUES ($1, 'twilio', true, $2::jsonb, '{}'::jsonb)`,
      [orgId, JSON.stringify({ accountSid: "ACe2e00000000000000000000000000000", authToken: TWILIO_AUTH_TOKEN, fromPhoneNumber: ORG_TWILIO_NUMBER })]);
    const sharedNumber = await countWhere(`organization_integrations WHERE provider='twilio' AND is_enabled AND credentials->>'fromPhoneNumber'=$1`, [ORG_TWILIO_NUMBER]);
    recordMetric(SIM, "w3/twilio-rows-sharing-this-number", sharedNumber);
    if (sharedNumber > 1) finding("P2", "tenant-isolation", "More than one org claims the same inbound SMS number; the webhook routes to whichever row sorts first", `${sharedNumber} enabled twilio rows with fromPhoneNumber=${ORG_TWILIO_NUMBER}`);
    const byId = new Map(leadsDb.map((l) => [l.id, l]));
    const smsLeads = tcpaIds.map((id) => byId.get(id)!).filter((l) => l.phone).slice(0, 5);
    if (smsLeads.length < 5) { skip("w3/inbound-sms", "fewer than 5 consented leads with phones"); return; }
    const msgBefore = await countWhere(`messages WHERE organization_id=$1 AND direction='inbound'`, [orgId]);
    let ok = 0; let totalMs = 0; let last: Resp | null = null;
    for (const [i, l] of smsLeads.entries()) {
      const isStop = i === 4;
      const r = await postTwilioSms(c, {
        From: l.phone!, To: ORG_TWILIO_NUMBER,
        Body: isStop ? "STOP" : `Yes, interested. What would you offer for my ${l.county} County lot?`,
        MessageSid: `SM${crypto.randomBytes(16).toString("hex")}`, AccountSid: "ACe2e00000000000000000000000000000",
      });
      last = r; totalMs += r.ms;
      if (r.status === 200) ok++;
      if (isStop) {
        stopLead = l;
        const row = await one(`SELECT do_not_contact, tcpa_consent, opt_out_reason FROM leads WHERE id=$1`, [l.id]);
        note("w3", `twilio STOP from lead ${l.id}`, r, `twiml=${/unsubscribed/i.test(r.text)} | DB dnc=${row.do_not_contact} tcpa=${row.tcpa_consent} reason=${(row.opt_out_reason ?? "").slice(0, 50)}`);
        if (r.status === 200 && !row.do_not_contact) finding("P0", "compliance", "STOP reply did not set doNotContact", JSON.stringify(row));
        if (r.status === 200 && row.tcpa_consent) finding("P0", "compliance", "STOP reply left tcpaConsent=true", JSON.stringify(row));
      }
    }
    const msgAfter = await countWhere(`messages WHERE organization_id=$1 AND direction='inbound'`, [orgId]);
    const convos = await countWhere(`conversations WHERE organization_id=$1 AND channel='sms'`, [orgId]);
    note("w3", "POST /api/webhooks/twilio/sms x5", { status: last?.status ?? 0, ms: totalMs, text: last?.text }, `accepted=${ok}/5 | DB inbound messages ${msgBefore}→${msgAfter} sms conversations=${convos}`);
    if (ok !== 5) finding("P1", "inbound", "Signed Twilio webhook rejected a valid inbound SMS", `${ok}/5; last=${last?.status} ${last?.text.slice(0, 160)}`);
    if (msgAfter - msgBefore !== 4) finding("P1", "data-integrity", "4 non-STOP inbound SMS did not produce 4 inbound message rows", `${msgBefore}→${msgAfter}`);
    const forged = await c.call("POST", "/api/webhooks/twilio/sms", undefined, { raw: "From=%2B15205551000&To=%2B15005550006&Body=hi&MessageSid=SMforged", noAuth: true, noCsrf: true, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "AAAA", "x-forwarded-proto": "https", "x-forwarded-host": "sim.acreos.test" } });
    note("w3", "twilio forged signature", forged, msg(forged));
    if (forged.status > 0 && forged.status < 400) finding("P0", "security", "Twilio webhook accepted a forged signature", forged.text.slice(0, 200));

    // a later send-sms must exclude the STOP lead
    const follow = await c.post("/api/campaigns", { name: "Q4 SMS follow-up", type: "sms", content: "Hi {{firstName}}, following up on your {{county}} County land." });
    const others = smsLeads.slice(0, 3).map((l) => l.id);
    const r = await c.post(`/api/campaigns/${follow.body?.id}/send-sms`, { leadIds: [stopLead!.id, ...others] });
    const sentToStop = await countWhere(`simulated_actions WHERE organization_id=$1 AND category='sms' AND payload->>'to'=$2 AND (payload->>'campaignId')::int=$3`, [orgId, stopLead!.phone, follow.body?.id ?? -1]);
    const stopBlocked = r.status === 200
      ? (r.body?.tcpaBlockedSamples ?? []).some((s: any) => s.leadId === stopLead!.id)
      : (r.body?.details?.tcpaBlocked ?? []).some((s: any) => s.leadId === stopLead!.id);
    note("w3", "POST send-sms after STOP", r, `${r.status >= 400 ? msg(r) + " | " : ""}sent=${r.body?.sent} tcpaBlocked=${r.body?.tcpaBlocked ?? r.body?.details?.tcpaBlocked?.length} quietHours=${r.body?.quietHoursBlocked ?? r.body?.details?.quietHoursBlocked?.length} stopLeadNamedAsBlocked=${stopBlocked} | sim rows to STOP lead=${sentToStop}`);
    if (sentToStop > 0) finding("P0", "compliance", "A lead that replied STOP was texted again by a later campaign send", `lead ${stopLead!.id}`);
    if (!stopBlocked && sentToStop === 0) finding("P2", "ux", "The STOP lead was excluded from the follow-up send without being named in the response", JSON.stringify(r.body).slice(0, 240));
  });

  // ── WEEK 4-6 ──────────────────────────────────────────────────────────────
  await section("w4-6", "contact events + negotiating", async () => {
    if (responders.length < 10) { skip("w4-6/contact-events", `only ${responders.length} responders`); return; }
    let ok = 0, okStatus = 0, ms = 0; let last: Resp | null = null;
    for (const [i, l] of responders.slice(0, 10).entries()) {
      const ce = await c.post(`/api/leads/${l.id}/contact-event`, { channel: "phone", method: "manual", outcome: i % 3 === 0 ? "hot" : "warm" });
      ms += ce.ms; last = ce; if (ce.status < 300) ok++;
      const st = await c.put(`/api/leads/${l.id}`, { status: "negotiating" });
      ms += st.ms; if (st.status < 300) okStatus++; else if (st.status >= 500) note("w4-6", `PUT lead ${l.id} negotiating`, st, msg(st));
    }
    const acts = await countWhere(`lead_activities WHERE organization_id=$1 AND type='phone_outcome'`, [orgId]);
    const neg = await countWhere(`leads WHERE organization_id=$1 AND status='negotiating'`, [orgId]);
    const lastContacted = await countWhere(`leads WHERE organization_id=$1 AND last_contacted_at IS NOT NULL`, [orgId]);
    note("w4-6", "contact-event + status→negotiating x10", { status: last?.status ?? 0, ms, text: last?.text }, `events ok=${ok}/10 status ok=${okStatus}/10 | DB phone_outcome activities=${acts} negotiating=${neg} last_contacted set=${lastContacted}`);
    if (acts !== ok) finding("P1", "data-integrity", "contact-event accepted but no lead_activities row", `ok=${ok} rows=${acts}`);
    if (neg !== okStatus) finding("P1", "data-integrity", "status PUT accepted but DB status differs", `ok=${okStatus} negotiating=${neg}`);
  });

  await section("w4-6", "offers: create 10, accept 3 / reject 4 / counter 3", async () => {
    if (responders.length < 10 || propertyIds.length < 10) { skip("w4-6/offers", "need 10 responders and 10 properties"); return; }
    const isoOffer = await c.post("/api/offers", { leadId: responders[0].id, propertyId: propertyIds[0], status: "sent", cashOffer: "20000", sentAt: new Date().toISOString() });
    note("w4-6", "POST /api/offers with ISO sentAt", isoOffer, msg(isoOffer));
    if (isoOffer.status === 201) offerIds.push(isoOffer.body.id);
    let ms = 0; let last: Resp | null = null;
    for (let i = offerIds.length; i < 10; i++) {
      const r = await c.post("/api/offers", { leadId: responders[i].id, propertyId: propertyIds[i], status: "sent", cashOffer: String(20000 + i * 1000), termsOffer: String(28000 + i * 1000), downPayment: "2000", monthlyPayment: "350", interestRate: "9", termMonths: 120, estimatedMarketValue: String(40000 + i * 1500) });
      ms += r.ms; last = r; if (r.status === 201) offerIds.push(r.body.id); else note("w4-6", `POST /api/offers #${i}`, r, msg(r));
    }
    note("w4-6", "POST /api/offers x10", { status: last?.status ?? 0, ms, text: last?.text }, `created=${offerIds.length} | DB=${await countWhere(`offers WHERE organization_id=$1`, [orgId])}`);
    const sentAtSet = await countWhere(`offers WHERE organization_id=$1 AND status='sent' AND sent_at IS NOT NULL`, [orgId]);
    if (offerIds.length > 0 && sentAtSet === 0) finding("P2", "data-integrity", "Offers created with status 'sent' carry no sent_at (and the API refuses an ISO sentAt)", `${offerIds.length} offers, sent_at set on ${sentAtSet}`);
    const outcomes: Array<[string, Record<string, unknown>]> = [
      ["accepted", {}], ["accepted", {}], ["accepted", {}],
      ["rejected", { sellerNotes: "Too low" }], ["rejected", {}], ["rejected", {}], ["rejected", {}],
      ["countered", { counterOffer: "31000" }], ["countered", { counterOffer: "29500" }], ["countered", { counterOffer: "35000" }],
    ];
    let pms = 0; let plast: Resp | null = null; let pok = 0;
    for (const [i, id] of offerIds.entries()) {
      const [status, extra] = outcomes[i];
      const r = await c.patch(`/api/offers/${id}`, { status, ...extra });
      pms += r.ms; plast = r; if (r.status < 300) { pok++; if (status === "accepted") acceptedIdx.push(i); }
      else if (r.status >= 500) note("w4-6", `PATCH /api/offers/${id}`, r, msg(r));
    }
    const dist = await q<{ status: string; n: string }>(`SELECT status, count(*)::int AS n FROM offers WHERE organization_id=$1 GROUP BY status ORDER BY status`, [orgId]);
    note("w4-6", "PATCH /api/offers x10 outcomes", { status: plast?.status ?? "n/a", ms: pms, text: plast?.text }, `ok=${pok}/${offerIds.length} ${plast && plast.status >= 400 ? msg(plast) : ""} | DB ${dist.map((d) => `${d.status}=${d.n}`).join(" ")}`);
    const respondedAt = await countWhere(`offers WHERE organization_id=$1 AND status IN ('accepted','rejected','countered') AND responded_at IS NOT NULL`, [orgId]);
    if (pok > 0 && respondedAt === 0) finding("P2", "data-integrity", "Resolving an offer (accepted/rejected/countered) does not stamp responded_at", `${pok} resolved, responded_at set on ${respondedAt}`);
    const want: Record<string, number> = { accepted: 3, rejected: 4, countered: 3 };
    for (const [s, n] of Object.entries(want)) if (Number(dist.find((d) => d.status === s)?.n ?? 0) !== n) finding("P1", "data-integrity", `offers.status '${s}' count ≠ ${n} after PATCH`, JSON.stringify(dist));
    const pr = await c.patch(`/api/offers/${offerIds[0]}`, { organizationId: orgId + 1 });
    const still = await one(`SELECT organization_id FROM offers WHERE id=$1`, [offerIds[0]]);
    note("w4-6", "PATCH offer with foreign organizationId", pr, `DB organization_id=${still?.organization_id}`);
    if (still && still.organization_id !== orgId) finding("P0", "tenant-isolation", "PATCH /api/offers/:id moved an offer to another organization", JSON.stringify(still));
  });

  await section("w4-6", "offer letters (5¢ each, credits)", async () => {
    if (acceptedIdx.length < 3) { skip("w4-6/offer-letters", "fewer than 3 accepted offers"); return; }
    // Every property is born with land_status='unknown', which the offer-letter
    // route treats as a hard stop. Record that, then set it the way the UI does.
    const i0 = acceptedIdx[0];
    const blocked = await c.post("/api/documents/offer-letter", { leadId: responders[i0].id, propertyId: propertyIds[i0], offerAmount: 20000 });
    note("w4-6", "POST /api/documents/offer-letter (land_status unknown)", blocked, msg(blocked));
    if (blocked.status === 422) finding("P2", "ux", "Offer letters are blocked for every newly-created parcel because land_status defaults to 'unknown', and the refusal describes it as federal trust property", msg(blocked), "A customer who adds a parcel and immediately tries to send an offer is told their land is Indian Country; nothing in property create asks for land status.");
    // The vocabulary is LAND_STATUS_VALUES ("fee", "tribal_trust", …, "unknown").
    // Probe the obvious wrong spelling first: does the update route validate it?
    const typo = await c.put(`/api/properties/${propertyIds[i0]}`, { landStatus: "fee_simple" });
    const typoRow = await one(`SELECT land_status FROM properties WHERE id=$1`, [propertyIds[i0]]);
    const typoLetter = await c.post("/api/documents/offer-letter", { leadId: responders[i0].id, propertyId: propertyIds[i0], offerAmount: 20000 });
    note("w4-6", "PUT /api/properties/:id landStatus='fee_simple' (not in vocabulary)", typo, `${typo.status} | DB land_status='${typoRow?.land_status}' | offer-letter afterwards → ${typoLetter.status} ${msg(typoLetter).slice(0, 90)}`);
    if (typo.status < 300 && typoRow?.land_status === "fee_simple") finding("P2", "data-integrity", "PUT /api/properties/:id stores any string as land_status (no landStatusSchema validation on update); the stored typo then blocks every auto-document with a 'Federal trust property' refusal", `PUT {landStatus:'fee_simple'} → ${typo.status}, DB land_status='fee_simple', offer-letter → ${typoLetter.status} '${msg(typoLetter).slice(0, 120)}'`, "A mis-typed status is accepted silently and permanently disables offer letters, deeds and contracts for the parcel with a misleading legal reason.");
    for (const i of acceptedIdx.slice(0, 3)) {
      const ls = await c.put(`/api/properties/${propertyIds[i]}`, { landStatus: "fee" });
      if (ls.status >= 300) note("w4-6", `PUT /api/properties/${propertyIds[i]} landStatus=fee`, ls, msg(ls));
    }
    const before = await creditBalance();
    const usageBefore = await countWhere(`usage_records WHERE organization_id=$1 AND action_type='pdf_generated'`, [orgId]);
    let pdfs = 0, ms = 0; let last: Resp | null = null;
    for (const i of acceptedIdx.slice(0, 3)) {
      const r = await c.post("/api/documents/offer-letter", { leadId: responders[i].id, propertyId: propertyIds[i], offerAmount: 20000 + i * 1000, earnestMoney: 500, closingDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
      ms += r.ms; last = r;
      const isPdf = r.status === 200 && (r.headers.get("content-type") ?? "").includes("pdf") && r.text.startsWith("%PDF");
      if (isPdf) pdfs++; else note("w4-6", `POST /api/documents/offer-letter lead ${responders[i].id}`, r, msg(r));
    }
    const after = await creditBalance();
    const usageAfter = await countWhere(`usage_records WHERE organization_id=$1 AND action_type='pdf_generated'`, [orgId]);
    const txn = await q(`SELECT amount_cents, description FROM credit_transactions WHERE organization_id=$1 AND description ILIKE '%PDF%' ORDER BY id DESC LIMIT 3`, [orgId]);
    note("w4-6", "POST /api/documents/offer-letter x3", { status: last?.status ?? 0, ms, text: pdfs === 3 ? "[pdf bytes]" : last?.text }, `pdfs=${pdfs}/3 | credits ${before}→${after} (Δ${before - after}¢) usage_records +${usageAfter - usageBefore} txns=${JSON.stringify(txn).slice(0, 120)}`);
    if (before - after !== 5 * pdfs) finding("P1", "billing", "Offer-letter credit deduction ≠ 5¢ × PDFs generated", `Δ=${before - after}¢ pdfs=${pdfs}`);
    if (usageAfter - usageBefore !== pdfs) finding("P2", "billing", "usage_records rows ≠ PDFs generated", `${usageAfter - usageBefore} vs ${pdfs}`);
    const zero = await c.post("/api/documents/offer-letter", { leadId: responders[0].id, propertyId: propertyIds[0] });
    note("w4-6", "offer-letter without offerAmount", zero, msg(zero));
    if (zero.status === 200) finding("P1", "honesty", "An offer letter was generated with no offer amount (invented price)", "200 with no offerAmount in body");
  });

  await section("w4-6", "deals for the 3 accepted offers + stage walk", async () => {
    if (acceptedIdx.length < 3) { skip("w4-6/deals", "fewer than 3 accepted offers"); return; }
    const isoDeal = await c.post("/api/deals", { propertyId: propertyIds[acceptedIdx[0]], type: "acquisition", status: "negotiating", offerAmount: "20000", offerDate: new Date().toISOString() });
    note("w4-6", "POST /api/deals with ISO offerDate", isoDeal, isoDeal.status >= 300 ? msg(isoDeal) + " " + JSON.stringify(isoDeal.body?.details).slice(0, 120) : `id=${isoDeal.body?.id}`);
    if (isoDeal.status === 201) dealIds.push(isoDeal.body.id);
    for (const i of acceptedIdx.slice(dealIds.length, 3)) {
      const r = await c.post("/api/deals", { propertyId: propertyIds[i], type: "acquisition", status: "negotiating", offerAmount: String(20000 + i * 1000), notes: `From offer for lead ${responders[i].id}` });
      note("w4-6", `POST /api/deals (property ${propertyIds[i]})`, r, `id=${r.body?.id} status=${r.body?.status} ${r.status >= 300 ? msg(r) + " " + JSON.stringify(r.body?.details).slice(0, 120) : ""}`);
      if (r.status === 201) dealIds.push(r.body.id);
    }
    let closingDateRefused = false;
    const stages = ["offer_sent", "accepted", "in_escrow", "closed"];
    for (const dealId of dealIds) {
      for (const stage of stages) {
        if (stage === "closed") {
          const cd = await c.put(`/api/deals/${dealId}`, { acceptedAmount: "24000", closingDate: new Date().toISOString(), closingCosts: "850", titleCompany: "Sim Title Co" });
          if (cd.status >= 400) {
            if (!closingDateRefused) {
              closingDateRefused = true;
              note("w4-6", `PUT /api/deals/${dealId} closingDate (ISO)`, cd, `${msg(cd)} ${JSON.stringify(cd.body?.details).slice(0, 120)}`);
              finding("P2", "api-contract", "A deal's closing date cannot be set over the API (ISO-8601 refused: 'expected date, received string'), so closed deals carry no closing_date and fall out of the P&L", `PUT /api/deals/:id {closingDate} → ${cd.status} ${msg(cd)}`, "portfolio-pnl selects closed deals by closing_date; a deal closed through the API is invisible to it.");
            }
            await c.put(`/api/deals/${dealId}`, { acceptedAmount: "24000", closingCosts: "850", titleCompany: "Sim Title Co" });
            await q(`UPDATE deals SET closing_date = now() WHERE id=$1 AND organization_id=$2`, [dealId, orgId]);
          }
        }
        let r = await c.patch(`/api/deals/${dealId}/stage`, { stage });
        let forced = false;
        if (r.status === 400 && r.body?.details?.incompleteItems) {
          const items = r.body.details.incompleteItems;
          recordMetric(SIM, `w4-6/stage-gate ${dealId}→${stage}`, { message: r.body.message, incomplete: items.length, first: items[0]?.title ?? items[0]?.name });
          r = await c.patch(`/api/deals/${dealId}/stage`, { stage, force: true });
          forced = true;
        }
        const row = await one(`SELECT status FROM deals WHERE id=$1`, [dealId]);
        note("w4-6", `PATCH /api/deals/${dealId}/stage → ${stage}${forced ? " (forced after checklist gate)" : ""}`, r, `DB status=${row?.status}`);
        if (r.status === 200 && row?.status !== stage) finding("P1", "data-integrity", "Stage PATCH returned 200 but DB status differs", `wanted ${stage}, DB ${row?.status}`);
        if (r.status >= 400 && r.status < 500 && !r.body?.message) finding("P2", "ux", "Stage refusal carries no message", r.text.slice(0, 200));
      }
    }
    if (dealIds.length) {
      const dealsPnl = await one(`SELECT count(*)::int AS n, count(closing_date)::int AS dated, count(accepted_amount)::int AS priced FROM deals WHERE organization_id=$1 AND status='closed'`, [orgId]);
      recordMetric(SIM, "w4-6/closed-deals", dealsPnl);
      const illegal = await c.patch(`/api/deals/${dealIds[0]}/stage`, { stage: "negotiating" });
      const row = await one(`SELECT status FROM deals WHERE id=$1`, [dealIds[0]]);
      note("w4-6", "PATCH stage closed→negotiating (illegal)", illegal, `${msg(illegal)} | DB status=${row?.status}`);
      if ((illegal.status > 0 && illegal.status < 400) || row?.status !== "closed") finding("P1", "data-integrity", "A closed deal was moved back to negotiating", `status=${illegal.status} DB=${row?.status}`);
      const forcedIllegal = await c.patch(`/api/deals/${dealIds[0]}/stage`, { stage: "negotiating", force: true });
      const row2 = await one(`SELECT status FROM deals WHERE id=$1`, [dealIds[0]]);
      note("w4-6", "PATCH stage closed→negotiating force:true", forcedIllegal, `DB status=${row2?.status}`);
      if (row2?.status !== "closed") finding("P1", "data-integrity", "force:true bypassed the deal state machine (closed→negotiating)", `DB=${row2?.status}`);
      const bulk = await c.post(`/api/deals/bulk-update`, { ids: [dealIds[0]], updates: { status: "negotiating" } });
      const row3 = await one(`SELECT status FROM deals WHERE id=$1`, [dealIds[0]]);
      note("w4-6", "bulk-update closed→negotiating", bulk, `DB status=${row3?.status}`);
      if (row3?.status !== "closed") finding("P1", "data-integrity", "bulk-update bypassed the deal state machine", `DB=${row3?.status}`);
    }
    // lead statuses follow the deal
    for (const i of acceptedIdx.slice(0, 3)) {
      await c.put(`/api/leads/${responders[i].id}`, { status: "accepted" });
      const r = await c.put(`/api/leads/${responders[i].id}`, { status: "closed" });
      if (r.status >= 400) note("w4-6", `PUT lead ${responders[i].id} → closed`, r, msg(r));
    }
    recordMetric(SIM, "w4-6/leads-closed", await countWhere(`leads WHERE organization_id=$1 AND status='closed'`, [orgId]));
  });

  // ── WEEK 7-9 ──────────────────────────────────────────────────────────────
  const noteMeta: Array<{ id: number; monthly: number; schedule: any[]; lead: LeadRow; propertyId: number }> = [];
  await section("w7-9", "seller-finance notes (raw_land exemption, active)", async () => {
    if (acceptedIdx.length < 3) { skip("w7-9/notes", "fewer than 3 accepted offers"); return; }
    // Originated two weeks ago, first instalment due in two weeks: the book is
    // CURRENT until the sim deliberately misses a payment later.
    const start = new Date(Date.now() - 15 * 864e5), first = new Date(Date.now() + 15 * 864e5);
    for (const i of acceptedIdx.slice(0, 3)) {
      const r = await c.post("/api/notes", { originalPrincipal: "30000", interestRate: "9", termMonths: 120, propertyId: propertyIds[i], borrowerId: responders[i].id, startDate: start.toISOString(), firstPaymentDate: first.toISOString(), status: "active", atrExemptionCode: "raw_land", gracePeriodDays: 10, lateFee: "25", downPayment: "2000", downPaymentReceived: true });
      const row = r.body?.id ? await one(`SELECT status, atr_exemption_code, monthly_payment, current_balance, next_payment_date, access_token FROM notes WHERE id=$1`, [r.body.id]) : null;
      note("w7-9", `POST /api/notes (property ${propertyIds[i]}, borrower ${responders[i].id})`, r, row ? `id=${r.body.id} status=${row.status} atr=${row.atr_exemption_code} monthly=${row.monthly_payment} balance=${row.current_balance} next=${String(row.next_payment_date).slice(0, 10)} token=${row.access_token ? "set" : "NULL"}` : msg(r));
      if (r.status === 201) {
        noteIds.push(r.body.id);
        noteMeta.push({ id: r.body.id, monthly: Number(row.monthly_payment), schedule: [], lead: responders[i], propertyId: propertyIds[i] });
        const expected = (30000 * (0.09 / 12)) / (1 - Math.pow(1 + 0.09 / 12, -120));
        if (Math.abs(Number(row.monthly_payment) - expected) > 0.02) finding("P1", "money", "Note monthly payment ≠ amortization formula", `DB ${row.monthly_payment} vs ${expected.toFixed(2)}`);
        if (row.status !== "active") finding("P2", "api-contract", "Note created with status:active + raw_land exemption landed as non-active", `status=${row.status}`);
      }
    }
    // usury: 12% on an AZ parcel (cap 10%) must be refused; on TX (cap 18%) allowed
    const az = propertyIds.find((_, i) => leadsDb[i]?.state === "AZ") ?? propertyIds[0];
    const usury = await c.post("/api/notes", { originalPrincipal: "15000", interestRate: "12", termMonths: 60, propertyId: az, borrowerId: responders[3]?.id, status: "active", atrExemptionCode: "raw_land" });
    note("w7-9", "POST /api/notes 12% on AZ parcel (usury)", usury, `${msg(usury)} code=${usury.body?.code}`);
    if (usury.status > 0 && usury.status < 400) finding("P1", "compliance", "A 12% note on an Arizona parcel (10% statutory cap) was accepted", usury.text.slice(0, 200));
    else if (!/usury|exceeds|limit/i.test(usury.text)) finding("P2", "ux", "Usury refusal does not explain the cap", msg(usury));
    const txIdx = leadsDb.findIndex((l, i) => i < propertyIds.length && l.state === "TX");
    if (txIdx >= 0) {
      const tx = await c.post("/api/notes", { originalPrincipal: "15000", interestRate: "12", termMonths: 60, propertyId: propertyIds[txIdx], borrowerId: responders[4]?.id, status: "active", atrExemptionCode: "raw_land" });
      note("w7-9", "POST /api/notes 12% on TX parcel (cap 18%)", tx, `${tx.status === 201 ? `id=${tx.body.id}` : msg(tx)}`);
      if (tx.status === 201) noteIds.push(tx.body.id);
    }
    const noAtr = await c.post("/api/notes", { originalPrincipal: "10000", interestRate: "8", termMonths: 36, propertyId: propertyIds[5], borrowerId: responders[5]?.id, status: "active" });
    note("w7-9", "POST /api/notes active without ATR/exemption", noAtr, `${msg(noAtr)} status=${noAtr.body?.status}`);
    if (noAtr.status === 201) {
      noteIds.push(noAtr.body.id);
      if (noAtr.body.status === "active") finding("P1", "compliance", "A consumer note went active with no ATR determination and no exemption", JSON.stringify(noAtr.body).slice(0, 200));
    }
  });

  await section("w7-9", "amortization schedules", async () => {
    for (const m of noteMeta) {
      const r = await c.post(`/api/notes/${m.id}/schedule/generate`);
      const row = await one(`SELECT jsonb_array_length(amortization_schedule) AS n FROM notes WHERE id=$1`, [m.id]);
      m.schedule = r.body?.schedule ?? [];
      note("w7-9", `POST /api/notes/${m.id}/schedule/generate`, r, `rows=${m.schedule.length} totalInterest=${r.body?.summary?.totalInterest} | DB schedule len=${row?.n}`);
      if (r.status === 200 && (m.schedule.length !== 120 || Number(row?.n) !== 120)) finding("P1", "money", "120-month note produced a schedule that is not 120 rows", `resp=${m.schedule.length} db=${row?.n}`);
      if (r.status === 200 && m.schedule.length && Math.abs(m.schedule[m.schedule.length - 1].balance) > 0.05) finding("P1", "money", "Schedule does not amortize to zero", `final balance ${m.schedule[m.schedule.length - 1].balance}`);
    }
  });

  await section("w7-9", "payments: 2 each, replay, different key", async () => {
    if (noteMeta.length === 0) { skip("w7-9/payments", "no notes"); return; }
    let paymentsBroken = false;
    for (const [ni, m] of noteMeta.entries()) {
      if (paymentsBroken) { skip(`w7-9/payments note ${m.id}`, "POST /api/payments is a 500 for every note in this schema (see finding); remaining payment steps not attempted"); continue; }
      const amount = m.monthly.toFixed(2);
      let rows = 0;
      for (let p = 1; p <= 2; p++) {
        const r = await c.post("/api/payments", { noteId: m.id, amount, paymentMethod: "ach" }, { headers: { "idempotency-key": `lc-${orgId}-${m.id}-p${p}` } });
        rows = await countWhere(`payments WHERE organization_id=$1 AND note_id=$2`, [orgId, m.id]);
        const bal = await one(`SELECT current_balance, next_payment_date FROM notes WHERE id=$1`, [m.id]);
        note("w7-9", `POST /api/payments note ${m.id} #${p}`, r, `${r.status >= 400 ? msg(r) + " | " : ""}principal=${r.body?.principalAmount} interest=${r.body?.interestAmount} status=${r.body?.status} | DB rows=${rows} balance=${bal?.current_balance} next=${String(bal?.next_payment_date).slice(0, 10)}`, { noAutoFinding: r.status >= 500 });
        if (r.status >= 500) {
          paymentsBroken = true;
          finding("P0", "money", "No note payment can be recorded: POST /api/payments is a 500 for every well-formed request",
            `${r.status} ${msg(r)} requestId=${r.body?.requestId}. Server log: 'Failed query: insert into "payments" … on conflict ("transaction_id") do nothing' — Postgres: 'there is no unique or exclusion constraint matching the ON CONFLICT specification'. payments_transaction_id_unique is a PARTIAL unique index (WHERE transaction_id IS NOT NULL); Drizzle's onConflictDoNothing({ target: payments.transactionId }) emits ON CONFLICT (transaction_id) without the predicate, which a partial index cannot satisfy.`,
            "The seller-finance book cannot record a single payment (operator-recorded or borrower-portal); balances, delinquency, P&L and 1099-INT are all computed from rows that can never exist.",
            `POST /api/payments {noteId, amount, paymentMethod} with Idempotency-Key → 500`);
          break;
        }
        if (r.status === 201 && m.schedule[p - 1]) {
          const sched = m.schedule[p - 1];
          if (Math.abs(Number(r.body.interestAmount) - sched.interest) > 0.02 || Math.abs(Number(r.body.principalAmount) - sched.principal) > 0.02)
            finding("P1", "money", `Payment #${p} split ≠ schedule row ${p}`, `api principal=${r.body.principalAmount} interest=${r.body.interestAmount}; schedule principal=${sched.principal} interest=${sched.interest}`);
        }
      }
      if (paymentsBroken) continue;
      // REPLAY the first key
      const replay = await c.post("/api/payments", { noteId: m.id, amount, paymentMethod: "ach" }, { headers: { "idempotency-key": `lc-${orgId}-${m.id}-p1` } });
      const rowsAfterReplay = await countWhere(`payments WHERE organization_id=$1 AND note_id=$2`, [orgId, m.id]);
      const balReplay = await one(`SELECT current_balance FROM notes WHERE id=$1`, [m.id]);
      note("w7-9", `POST /api/payments note ${m.id} REPLAY p1`, replay, `replayed=${replay.body?.replayed} | DB rows ${rows}→${rowsAfterReplay} balance=${balReplay?.current_balance}`);
      if (replay.status < 300 && replay.body?.replayed !== true) finding("P1", "money", "Idempotency-Key replay was not flagged replayed:true", replay.text.slice(0, 200));
      if (rowsAfterReplay !== rows) finding("P0", "money", "Idempotency-Key replay recorded a second payment", `rows ${rows}→${rowsAfterReplay}`);
      // same key, different amount → must be refused
      const reuse = await c.post("/api/payments", { noteId: m.id, amount: (m.monthly + 1).toFixed(2), paymentMethod: "ach" }, { headers: { "idempotency-key": `lc-${orgId}-${m.id}-p1` } });
      note("w7-9", `POST /api/payments note ${m.id} same key, different amount`, reuse, msg(reuse));
      if (reuse.status > 0 && reuse.status < 400) finding("P1", "money", "Same Idempotency-Key with a different amount was accepted", reuse.text.slice(0, 200));
      if (ni === 0) {
        // the same payment with a DIFFERENT key → a genuine third row
        const third = await c.post("/api/payments", { noteId: m.id, amount, paymentMethod: "ach" }, { headers: { "idempotency-key": `lc-${orgId}-${m.id}-p3-newkey` } });
        const rows3 = await countWhere(`payments WHERE organization_id=$1 AND note_id=$2`, [orgId, m.id]);
        const bal3 = await one(`SELECT current_balance FROM notes WHERE id=$1`, [m.id]);
        const schedBal = m.schedule[2]?.balance;
        note("w7-9", `POST /api/payments note ${m.id} same amount NEW key`, third, `DB rows=${rows3} balance=${bal3?.current_balance} schedule[3].balance=${schedBal}`);
        if (third.status === 201 && rows3 !== 3) finding("P1", "money", "A new-key payment did not add exactly one row", `rows=${rows3}`);
        if (third.status === 201 && schedBal != null && Math.abs(Number(bal3?.current_balance) - schedBal) > 0.05)
          finding("P1", "money", "After 3 scheduled-amount payments the note balance ≠ schedule row 3 balance", `DB ${bal3?.current_balance} vs schedule ${schedBal}`);
        const sum = await one(`SELECT sum(principal_amount) AS p FROM payments WHERE note_id=$1 AND status='completed'`, [m.id]);
        if (Math.abs(30000 - Number(sum?.p) - Number(bal3?.current_balance)) > 0.05)
          finding("P1", "money", "original_principal − Σprincipal paid ≠ current_balance", `30000 − ${sum?.p} vs ${bal3?.current_balance}`);
      } else {
        const bal2 = await one(`SELECT current_balance FROM notes WHERE id=$1`, [m.id]);
        const schedBal = m.schedule[1]?.balance;
        if (schedBal != null && Math.abs(Number(bal2?.current_balance) - schedBal) > 0.05) finding("P1", "money", "After 2 payments the note balance ≠ schedule row 2 balance", `note ${m.id}: DB ${bal2?.current_balance} vs schedule ${schedBal}`);
      }
    }
    const overpay = await c.post("/api/payments", { noteId: noteMeta[0].id, amount: "999999", paymentMethod: "wire" }, { headers: { "idempotency-key": `lc-${orgId}-overpay` } });
    note("w7-9", "POST /api/payments > payoff", overpay, msg(overpay), { noAutoFinding: paymentsBroken });
    if (overpay.status < 400) finding("P1", "money", "A payment larger than the payoff was recorded", overpay.text.slice(0, 200));
    const noKey = await c.post("/api/payments", { noteId: noteMeta[0].id, amount: "100", paymentMethod: "cash" });
    note("w7-9", "POST /api/payments without Idempotency-Key", noKey, msg(noKey));
    if (noKey.status < 400) finding("P2", "money", "A payment without an Idempotency-Key was recorded", noKey.text.slice(0, 200));
  });

  await section("w7-9", "delinquency after a missed payment", async () => {
    if (noteMeta.length < 2) { skip("w7-9/delinquency", "need 2 notes"); return; }
    const late = noteMeta[1];
    // the column is notes.next_payment_date (not next_due_date); days_delinquent/delinquency_status are derived columns
    await q(`UPDATE notes SET next_payment_date = now() - interval '45 days' WHERE id=$1`, [late.id]);
    const d1 = await c.get("/api/notes/delinquent");
    const inList = Array.isArray(d1.body) && d1.body.some((n: any) => n.id === late.id);
    const others = Array.isArray(d1.body) ? d1.body.filter((n: any) => n.id !== late.id).length : 0;
    const dbDelinquent = await countWhere(`notes WHERE organization_id=$1 AND status='active' AND next_payment_date <= now()`, [orgId]);
    note("w7-9", "GET /api/notes/delinquent", d1, `count=${Array.isArray(d1.body) ? d1.body.length : "?"} includesLateNote=${inList} others=${others} | DB active past-due=${dbDelinquent}`);
    if (d1.status === 200 && !inList) finding("P1", "money", "A note 45 days past next_payment_date is not in /api/notes/delinquent", JSON.stringify(d1.body).slice(0, 200));
    if (d1.status === 200 && Array.isArray(d1.body) && d1.body.length !== dbDelinquent) finding("P1", "fabrication", "/api/notes/delinquent count ≠ active notes with next_payment_date in the past", `api=${d1.body.length} db=${dbDelinquent}`);
    const d2 = await c.get("/api/finance/delinquency");
    const b = d2.body ?? {};
    const ab = b.agingBuckets ?? {};
    const dbPrincipal = Number((await one(`SELECT coalesce(sum(principal_amount),0) AS s FROM payments WHERE organization_id=$1 AND status='completed'`, [orgId])).s);
    const dbInterest = Number((await one(`SELECT coalesce(sum(interest_amount),0) AS s FROM payments WHERE organization_id=$1 AND status='completed'`, [orgId])).s);
    const dbAtRisk = Number((await one(`SELECT coalesce(sum(current_balance),0) AS s FROM notes WHERE organization_id=$1 AND status='active' AND next_payment_date < now() - interval '1 day'`, [orgId])).s);
    note("w7-9", "GET /api/finance/delinquency", d2, `rate=${b.delinquencyRate} delinquent=${b.totalDelinquentNotes} atRisk=${b.atRiskAmount} buckets current=${ab.current?.count} 30=${ab.days30?.count} 60=${ab.days60?.count} 90+=${ab.days90Plus?.count} principalCollected=${b.totalPrincipalCollected} interestCollected=${b.totalInterestCollected} | DB Σprincipal=${dbPrincipal.toFixed(2)} Σinterest=${dbInterest.toFixed(2)} atRisk=${dbAtRisk.toFixed(2)}`);
    if (d2.status === 200) {
      if (b.totalPrincipalCollected != null && Math.abs(Number(b.totalPrincipalCollected) - dbPrincipal) > 0.05) finding("P1", "fabrication", "finance/delinquency totalPrincipalCollected ≠ Σ payments.principal_amount", `${b.totalPrincipalCollected} vs ${dbPrincipal.toFixed(2)}`);
      if (b.totalInterestCollected != null && Math.abs(Number(b.totalInterestCollected) - dbInterest) > 0.05) finding("P1", "fabrication", "finance/delinquency totalInterestCollected ≠ Σ payments.interest_amount", `${b.totalInterestCollected} vs ${dbInterest.toFixed(2)}`);
      if (b.atRiskAmount != null && Math.abs(Number(b.atRiskAmount) - dbAtRisk) > 0.05) finding("P1", "fabrication", "finance/delinquency atRiskAmount ≠ Σ balance of past-due active notes", `${b.atRiskAmount} vs ${dbAtRisk.toFixed(2)}`);
      if (ab.days60 && ab.days60.count < 1) finding("P2", "money", "A 45-days-late note is not in the 31–60 day aging bucket", JSON.stringify(ab));
    }
    const dun = await c.post(`/api/notes/${late.id}/dunning`, { action: "send_reminder", stage: "late" });
    const rem = await q(`SELECT id, type, channel, status, failure_reason FROM payment_reminders WHERE note_id=$1 ORDER BY id DESC LIMIT 1`, [late.id]);
    const simEmail = await simCount("email");
    note("w7-9", `POST /api/notes/${late.id}/dunning send_reminder`, dun, `${msg(dun)} reminderId=${dun.body?.reminderId} | DB reminder=${JSON.stringify(rem[0] ?? null).slice(0, 200)} sim.email total=${simEmail}`);
    if (dun.status === 200 && rem.length === 0) finding("P1", "data-integrity", "Dunning reported success but no payment_reminders row", dun.text.slice(0, 200));
    if (dun.status === 200 && rem[0] && rem[0].status !== "sent" && /sent successfully/i.test(dun.body?.message ?? "")) finding("P2", "honesty", "Dunning answers 'Reminder sent successfully' while the reminder row is not sent", `API message='${dun.body.message}'; DB status='${rem[0].status}' failure_reason='${(rem[0].failure_reason ?? "").slice(0, 120)}'`, "The operator believes the borrower was reminded; the borrower was not, and the reason (no connected email identity) is only in the database.");
    if (dun.status === 200 && rem[0] && /sent/i.test(rem[0].status) && !/simulat/i.test(rem[0].failure_reason ?? "")) {
      const viaSim = await countWhere(`simulated_actions WHERE organization_id=$1 AND category IN ('email','sms') AND created_at > now() - interval '2 minutes'`, [orgId]);
      if (viaSim === 0) finding("P1", "honesty", "Reminder marked 'sent' with no simulated_actions record (nothing could have been sent in sim mode)", JSON.stringify(rem[0]));
    }
  });

  await section("w7-9", "borrower portal + money-custody refusal", async () => {
    if (noteMeta.length === 0) { skip("w7-9/portal", "no notes"); return; }
    const m = noteMeta[0];
    const link = await c.post(`/api/notes/${m.id}/portal-link`);
    const token = (link.body?.url ?? "").split("/portal/")[1] ?? "";
    note("w7-9", `POST /api/notes/${m.id}/portal-link`, link, `url=${link.body?.url} token=${token ? "present" : "MISSING"}`);
    if (!token) { skip("w7-9/portal", "no access token in portal link"); return; }
    const borrowerEmail = m.lead.email!;
    const bc = new SimClient("borrower-sim");
    const csrfCookie = `csrf_token=${bc.csrf}`;
    const ex = await bc.post("/api/borrower/auth/exchange", { accessToken: token, email: borrowerEmail }, { noAuth: true, headers: { cookie: csrfCookie } });
    const setCookie = ex.headers.get("set-cookie") ?? "";
    const stmt = /borrower_stmt_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
    note("w7-9", "POST /api/borrower/auth/exchange", ex, `${ex.status >= 400 ? msg(ex) + " | " : ""}cookie borrower_stmt_session=${stmt ? "issued" : "none"}`, { noAutoFinding: ex.status >= 500 });
    if (ex.status >= 500) finding("P1", "config", "A valid portal link + matching email is a 500 at /api/borrower/auth/exchange when BORROWER_SESSION_SECRET is unset", `${ex.status} ${msg(ex)}; server log: 'BORROWER_SESSION_SECRET is required (>=16 chars) — fail-closed.' thrown from signSession AFTER the borrower's token and email were verified`, "Fail-closed is right; a 500 'Something broke on our end' is the wrong answer — the secret is a deploy-time requirement that should refuse to boot (like INBOUND_EMAIL_WEBHOOK_SECRET does) or answer 503 with the reason.");
    if (stmt) {
      const s1 = await bc.get("/api/borrower/session", { noAuth: true, noCsrf: true, headers: { cookie: `borrower_stmt_session=${stmt}` } });
      note("w7-9", "GET /api/borrower/session (exchange cookie)", s1, `${s1.status === 200 ? `note=${s1.body?.note?.id} payments=${s1.body?.payments?.length}` : msg(s1)}`);
      if (s1.status === 401) finding("P2", "borrower-portal", "The session issued by /api/borrower/auth/exchange is not accepted by GET /api/borrower/session", "exchange sets borrower_stmt_session (signed, stateless); /api/borrower/session validates only the DB-backed borrower_session cookie from /api/borrower/verify", "A borrower who follows the portal link, exchanges it, and opens the dashboard is logged out immediately.");
    }
    const wrongEmail = await bc.post("/api/borrower/auth/exchange", { accessToken: token, email: "someone-else@example.com" }, { noAuth: true, headers: { cookie: csrfCookie } });
    note("w7-9", "exchange with wrong email", wrongEmail, msg(wrongEmail));
    if (wrongEmail.status < 400) finding("P0", "security", "Borrower portal exchange accepted a non-matching email", wrongEmail.text.slice(0, 200));
    else if (/session is no longer valid|sign in again/i.test(wrongEmail.text)) finding("P3", "ux", "Portal exchange with a non-matching email says 'Your session is no longer valid. Sign in again' — the borrower has no session and typed the wrong email", msg(wrongEmail));
    // the DB-backed login the portal UI uses
    const ver = await bc.post("/api/borrower/verify", { accessToken: token, email: borrowerEmail }, { noAuth: true, headers: { cookie: csrfCookie } });
    const sess = /borrower_session=([^;]+)/.exec(ver.headers.get("set-cookie") ?? "")?.[1] ?? "";
    note("w7-9", "POST /api/borrower/verify", ver, `session=${sess ? "issued" : "none"} note=${ver.body?.note?.id}`);
    if (!sess) { skip("w7-9/borrower-payment", "no borrower_session cookie from /api/borrower/verify"); return; }
    const cookie = `borrower_session=${sess}; ${csrfCookie}`;
    const s2 = await bc.get("/api/borrower/session", { noAuth: true, noCsrf: true, headers: { cookie } });
    const apiPayments = s2.body?.payments?.length;
    const dbPayments = await countWhere(`payments WHERE note_id=$1`, [m.id]);
    note("w7-9", "GET /api/borrower/session (verify cookie)", s2, `note=${s2.body?.note?.id} balance=${s2.body?.note?.currentBalance} payments api=${apiPayments} db=${dbPayments} servicing=${JSON.stringify(s2.body?.servicing).slice(0, 80)}`);
    if (s2.status === 200 && apiPayments !== dbPayments) finding("P1", "fabrication", "Borrower session payment list ≠ DB payments for the note", `api=${apiPayments} db=${dbPayments}`);
    if (s2.status === 200 && s2.body?.note?.organizationId && s2.body.note.organizationId !== orgId) finding("P0", "tenant-isolation", "Borrower session returned a note from another org", JSON.stringify(s2.body.note).slice(0, 200));

    const before = { payments: await countWhere(`payments WHERE organization_id=$1`, [orgId]), credits: await creditBalance(), note: await one(`SELECT current_balance, pending_checkout_session_id FROM notes WHERE id=$1`, [m.id]), stripeSim: await simCount("stripe") };
    const pay = await bc.post("/api/borrower/payment", { amount: m.monthly.toFixed(2) }, { noAuth: true, headers: { cookie } });
    const after = { payments: await countWhere(`payments WHERE organization_id=$1`, [orgId]), credits: await creditBalance(), note: await one(`SELECT current_balance, pending_checkout_session_id FROM notes WHERE id=$1`, [m.id]), stripeSim: await simCount("stripe") };
    const moved = before.payments !== after.payments || before.credits !== after.credits || before.note.current_balance !== after.note.current_balance || before.note.pending_checkout_session_id !== after.note.pending_checkout_session_id;
    note("w7-9", "POST /api/borrower/payment", pay, `${msg(pay)} reason=${pay.body?.details?.reason ?? pay.body?.reason} | moved=${moved} (payments ${before.payments}→${after.payments}, credits ${before.credits}→${after.credits}, balance ${before.note.current_balance}→${after.note.current_balance}, checkout ${before.note.pending_checkout_session_id}→${after.note.pending_checkout_session_id}, stripe sim ${before.stripeSim}→${after.stripeSim})`);
    const reason = pay.body?.details?.reason ?? pay.body?.reason;
    if (pay.status === 400) {
      if (!reason) finding("P2", "ux", "Borrower payment refused without a machine-readable reason", pay.text.slice(0, 200));
    } else if (pay.status < 300) {
      finding("P0", "money-custody", "Borrower card payment was accepted with no connected processor (platform-account fallback)", pay.text.slice(0, 300));
    } else if (pay.status !== 401 && pay.status !== 403) {
      /* 5xx filed by note() */
    }
    if (moved) finding("P0", "money-custody", "A refused borrower payment still changed state", JSON.stringify({ before, after }).slice(0, 400));
  });

  // ── WEEK 10-12 ────────────────────────────────────────────────────────────
  const vaSlug = `${slug}-va`;
  const vaClerk = personaTestUserId(vaSlug);
  const vaEmail = `${vaClerk}@persona-test.local`;
  const va = new SimClient(vaSlug);
  await section("w10-12", "invite a VA + accept as a second persona", async () => {
    let inv = await c.post("/api/organization/invitations", { email: vaEmail, role: "va" });
    note("w10-12", "POST /api/organization/invitations (seat_count default)", inv, `${inv.status === 201 ? "created" : msg(inv)} error=${inv.body?.error}`);
    if (inv.status === 402) {
      recordMetric(SIM, "w10-12/seat-gate", { error: inv.body?.error, details: inv.body?.details });
      if (inv.body?.error === "seat_purchase_required") finding("UX", "team", "Pro org with the default seat_count=1 cannot invite its first teammate (tier promises 2 seats)", msg(inv), "The first thing a new Pro customer does after paying is invite their VA; the product answers 'buy a seat'.");
      await q(`UPDATE organizations SET seat_count=5 WHERE id=$1`, [orgId]);
      inv = await c.post("/api/organization/invitations", { email: vaEmail, role: "va" });
      note("w10-12", "POST /api/organization/invitations (seat_count=5 via SQL)", inv, inv.status === 201 ? "created" : msg(inv));
    }
    const token = inv.body?.invitations?.[0]?.token ?? inv.body?.token;
    if (!token) { skip("w10-12/va", `no invite token (status ${inv.status})`); return; }
    const pending = await countWhere(`organization_invitations WHERE organization_id=$1 AND status='pending'`, [orgId]);
    recordMetric(SIM, "w10-12/pending-invites", pending);
    await q(`INSERT INTO users (clerk_user_id, email, persona, first_name, last_name, tos_accepted_at, privacy_accepted_at)
             VALUES ($1, $2, 'land_investor', 'Val', 'Assistant', now(), now()) ON CONFLICT (clerk_user_id) DO NOTHING`, [vaClerk, vaEmail]);
    const wrongUser = new SimClient(`${slug}-stranger`);
    await q(`INSERT INTO users (clerk_user_id, email, persona) VALUES ($1, $2, 'land_investor') ON CONFLICT (clerk_user_id) DO NOTHING`, [personaTestUserId(`${slug}-stranger`), `${personaTestUserId(`${slug}-stranger`)}@persona-test.local`]);
    const steal = await wrongUser.post("/api/organization/invitations/accept", { token });
    note("w10-12", "accept invite as a DIFFERENT email", steal, msg(steal));
    if (steal.status < 400) finding("P0", "security", "An invitation was accepted by a user whose email does not match the invite", steal.text.slice(0, 200));
    const acc = await va.post("/api/organization/invitations/accept", { token });
    const tm = await one(`SELECT id, role, is_active FROM team_members WHERE organization_id=$1 AND user_id=(SELECT id FROM users WHERE clerk_user_id=$2)`, [orgId, vaClerk]);
    vaTeamMemberId = tm?.id ?? 0;
    note("w10-12", "POST /api/organization/invitations/accept (VA)", acc, `${acc.status < 300 ? "ok" : msg(acc)} | DB team_member id=${tm?.id} role=${tm?.role} active=${tm?.is_active}`);
    if (acc.status < 300 && !tm) finding("P1", "team", "Invite accepted but no team_members row", acc.text.slice(0, 200));
    va.setCookie("acreos_active_org", String(orgId));
    const again = await va.post("/api/organization/invitations/accept", { token });
    note("w10-12", "accept the same invite twice", again, msg(again));
  });

  await section("w10-12", "VA scope: assigned-only leads, no delete/campaign/export", async () => {
    if (!vaTeamMemberId) { skip("w10-12/va-scope", "VA not a member"); return; }
    const vaUser = await one(`SELECT id FROM users WHERE clerk_user_id=$1`, [vaClerk]);
    const toAssign = leadsDb.slice(100, 105).map((l) => l.id);
    // assign via the API with the team-member id, then with the user id — record which the contract accepts
    const a1 = await c.put(`/api/leads/${toAssign[0]}`, { assignedTo: vaTeamMemberId });
    const a2 = await c.put(`/api/leads/${toAssign[1]}`, { assignedTo: vaUser.id });
    const assignedDb = await countWhere(`leads WHERE organization_id=$1 AND assigned_to=$2`, [orgId, vaTeamMemberId]);
    note("w10-12", "PUT /api/leads/:id assignedTo (team_member id | user id)", a1, `teamMemberId→${a1.status} ${msg(a1).slice(0, 80)}; userId→${a2.status} ${msg(a2).slice(0, 80)} | DB assigned_to=VA rows=${assignedDb}`);
    if (a1.status >= 400 && a2.status >= 400) finding("P1", "team", "No representation of assignedTo is accepted by PUT /api/leads/:id — a lead cannot be assigned to a VA over the API", `team_members.id → ${a1.status} ${msg(a1)}; users.id → ${a2.status} ${msg(a2)}. The guard validates assignedTo as a users.id while leads.assigned_to is an integer team_members.id the list filter uses.`, "Owner cannot hand leads to the VA; the VA sees an empty pipeline.");
    if (assignedDb === 0) {
      await q(`UPDATE leads SET assigned_to=$1 WHERE id = ANY($2::int[])`, [vaTeamMemberId, toAssign]);
      recordMetric(SIM, "w10-12/assign-fallback", { note: "assigned 5 leads via SQL after API refusal", ids: toAssign });
    }
    const assigned = await q<{ id: number }>(`SELECT id FROM leads WHERE organization_id=$1 AND assigned_to=$2`, [orgId, vaTeamMemberId]);
    const perms = await va.get("/api/me/permissions");
    const flag = await one(`SELECT view_only_assigned_leads FROM team_members WHERE id=$1`, [vaTeamMemberId]);
    note("w10-12", "VA GET /api/me/permissions", perms, `role=${perms.body?.role} viewOnlyAssignedLeads=${perms.body?.permissions?.viewOnlyAssignedLeads} canDeleteLeads=${perms.body?.permissions?.canDeleteLeads} | DB team_members.view_only_assigned_leads=${flag?.view_only_assigned_leads}`);
    const list = await va.get("/api/leads?pageSize=100");
    const total = list.body?.total;
    const ids = (list.body?.data ?? []).map((l: any) => l.id);
    const leak = ids.filter((id: number) => !assigned.some((a) => a.id === id));
    note("w10-12", "VA GET /api/leads", list, `total=${total} returned=${ids.length} assignedInDb=${assigned.length} unassignedReturned=${leak.length}`);
    if (list.status === 200 && (leak.length > 0 || total !== assigned.length)) {
      const rootCause = perms.body?.permissions?.viewOnlyAssignedLeads === false && flag?.view_only_assigned_leads === false
        ? "ROLE_PERMISSIONS.va.viewOnlyAssignedLeads is true, but getUserPermissionContext lets the per-user column team_members.view_only_assigned_leads (NOT NULL DEFAULT false) override it, so a freshly-accepted VA resolves to viewOnlyAssignedLeads=false and the list filter never applies"
        : "list filter did not apply";
      finding("P1", "authorization", "A VA sees every lead in the org, not only the ones assigned to them", `total=${total} assigned=${assigned.length} unassigned returned=${leak.length} (e.g. ${leak.slice(0, 5).join(",")}). ${rootCause}`, "The role's one scoping rule is dead on arrival; the whole list (owner names, phones, addresses) is visible to a contractor.", "invite role:va → accept → GET /api/leads");
    }
    const other = leadsDb.find((l) => !assigned.some((a) => a.id === l.id))!;
    const peek = await va.get(`/api/leads/${other.id}`);
    note("w10-12", "VA GET /api/leads/:id (unassigned lead)", peek, peek.status === 200 ? `returned ${peek.body?.firstName} ${peek.body?.lastName}` : msg(peek));
    if (peek.status === 200) finding("P2", "authorization", "VA can read an unassigned lead by id although the list hides it", `lead ${other.id}`);
    const edit = await va.put(`/api/leads/${assigned[0]?.id}`, { notes: "VA called, left voicemail" });
    note("w10-12", "VA PUT /api/leads/:id (assigned lead)", edit, edit.status < 300 ? "ok" : msg(edit));
    if (edit.status === 403) finding("P1", "authorization", "A VA cannot edit a lead that IS assigned to them", `${msg(edit)} — assertAssignedLeadWritable compares leads.assigned_to (team_members.id) to req.user.id (users.id uuid), so the check can never pass`);
    // With the per-user flag switched on (what an admin would do in Team settings), does scoping work?
    await q(`UPDATE team_members SET view_only_assigned_leads=true WHERE id=$1`, [vaTeamMemberId]);
    const scoped = await va.get("/api/leads?pageSize=100");
    const scopedIds = (scoped.body?.data ?? []).map((l: any) => l.id);
    const scopedLeak = scopedIds.filter((id: number) => !assigned.some((a) => a.id === id));
    note("w10-12", "VA GET /api/leads (view_only_assigned_leads=true via SQL)", scoped, `total=${scoped.body?.total} returned=${scopedIds.length} assigned=${assigned.length} unassignedReturned=${scopedLeak.length}`);
    if (scoped.status === 200 && (scopedLeak.length > 0 || scoped.body?.total !== assigned.length)) finding("P1", "authorization", "Even with view_only_assigned_leads=true the VA list is not scoped", `total=${scoped.body?.total} assigned=${assigned.length}`);
    const editScoped = await va.put(`/api/leads/${assigned[0]?.id}`, { notes: "VA follow-up" });
    const editOther = await va.put(`/api/leads/${other.id}`, { notes: "VA touching an unassigned lead" });
    note("w10-12", "VA PUT assigned vs unassigned lead (scoped)", editScoped, `assigned→${editScoped.status} ${editScoped.status >= 400 ? msg(editScoped) : ""}; unassigned→${editOther.status} ${editOther.status >= 400 ? msg(editOther) : ""}`);
    if (editScoped.status === 403) finding("P1", "authorization", "A scoped VA cannot edit the lead assigned to them", `${msg(editScoped)} — assertAssignedLeadWritable compares leads.assigned_to (an integer team_members.id) with req.user.id (a users.id uuid); the comparison can never be equal`, "The VA role's only write path (work your assigned leads) is unusable the moment scoping is on.");
    if (editOther.status < 300) finding("P1", "authorization", "A scoped VA edited a lead not assigned to them", `lead ${other.id} → ${editOther.status}`);
    const del = await va.delete(`/api/leads/${assigned[0]?.id}`);
    const stillThere = await countWhere(`leads WHERE id=$1 AND deleted_at IS NULL`, [assigned[0]?.id ?? -1]);
    note("w10-12", "VA DELETE /api/leads/:id", del, `${msg(del)} | DB still present=${stillThere === 1}`);
    if (del.status !== 403 || stillThere !== 1) finding("P1", "authorization", "VA could delete a lead (or refusal is not 403)", `status=${del.status} present=${stillThere}`);
    const camp = await va.post("/api/campaigns", { name: "VA rogue campaign", type: "email", subject: "x", content: "y" });
    note("w10-12", "VA POST /api/campaigns", camp, msg(camp));
    if (camp.status !== 403) finding("P1", "authorization", `VA campaign create returned ${camp.status}, not 403`, camp.text.slice(0, 200));
    const exp = await va.get("/api/leads/export");
    note("w10-12", "VA GET /api/leads/export", exp, msg(exp));
    if (exp.status === 429) finding("P3", "authorization", "VA lead export is answered by the export rate-limiter (429) before the permission check (403)", `${msg(exp)} — identityRateLimitKey falls back to the client IP when no Clerk auth is on the request, so the 5/day budget is shared by every caller behind one IP and is spent before requirePermission('canExportData') runs`, "A VA with no export right gets 'rate limit exceeded' instead of 'no permission', and consumes the owner's export budget while doing so.");
    else if (exp.status !== 403) finding("P1", "authorization", `VA lead export returned ${exp.status}, not 403`, exp.text.slice(0, 200));
    const expAll = await va.post("/api/export/everything", {});
    note("w10-12", "VA POST /api/export/everything", expAll, msg(expAll));
    if (expAll.status !== 403) finding("P1", "authorization", `VA export/everything returned ${expAll.status}, not 403`, expAll.text.slice(0, 200));
    const pay = await va.post("/api/payments", { noteId: noteIds[0] ?? 1, amount: "10", paymentMethod: "cash" }, { headers: { "idempotency-key": `lc-${orgId}-va-pay` } });
    note("w10-12", "VA POST /api/payments", pay, msg(pay));
    if (pay.status < 400) finding("P1", "authorization", "A VA recorded a note payment", pay.text.slice(0, 200));
    const members = await c.get("/api/team");
    note("w10-12", "owner GET /api/team", members, `members=${Array.isArray(members.body) ? members.body.length : "?"} | DB=${await countWhere(`team_members WHERE organization_id=$1 AND is_active`, [orgId])}`);
  });

  await section("w10-12", "owner exports", async () => {
    const e = await c.post("/api/export/everything", {});
    note("w10-12", "POST /api/export/everything", e, `jobId=${e.body?.jobId} status=${e.body?.status}`);
    if (e.status === 202 && e.body?.jobId) {
      let job: Resp | null = null;
      for (let i = 0; i < 10; i++) {
        job = await c.get(`/api/export/jobs/${e.body.jobId}`);
        if (["completed", "failed", "done", "error"].includes(job.body?.status)) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const row = await one(`SELECT status, entity_counts, error_message FROM export_jobs WHERE id=$1`, [e.body.jobId]);
      note("w10-12", `GET /api/export/jobs/${e.body.jobId} (polled)`, job!, `api status=${job?.body?.status} | DB status=${row?.status} counts=${JSON.stringify(row?.entity_counts).slice(0, 160)} err=${row?.error_message ?? ""}`);
      if (row?.entity_counts) {
        const dbLeads = await countWhere(`leads WHERE organization_id=$1 AND deleted_at IS NULL`, [orgId]);
        const ec = row.entity_counts;
        if (ec.leads != null && ec.leads !== dbLeads) finding("P2", "export", "export job entity_counts.leads ≠ DB leads", `${ec.leads} vs ${dbLeads}`);
      }
      if (row?.status === "failed") finding("P1", "export", "export/everything job failed", row.error_message ?? "");
    }
    const p = await c.post("/api/privacy/export", {});
    const dsar = p.body?.requestId
      ? await one(`SELECT request_type, requester_email, fulfilled_at, sla_deadline_at FROM dsar_requests_lifecycle WHERE id=$1`, [p.body.requestId]).catch(() => null)
      : null;
    note("w10-12", "POST /api/privacy/export", p, `requestId=${p.body?.requestId} status=${p.body?.status} eta=${p.body?.eta} | DB dsar_requests_lifecycle=${JSON.stringify(dsar)}`);
    if (p.status === 202 && !dsar) finding("P1", "data-integrity", "privacy/export returned 202 with a requestId that has no dsar_requests_lifecycle row", p.text.slice(0, 200));
    if (dsar && dsar.requester_email?.toLowerCase() !== ownerEmail.toLowerCase()) finding("P1", "data-integrity", "DSAR row was filed under a different email than the requester", JSON.stringify(dsar));
  });

  await section("w10-12", "bookkeeping + P&L reconcile against DB", async () => {
    const year = new Date().getFullYear();
    const sums = await one(`SELECT coalesce(sum(principal_amount),0) AS p, coalesce(sum(interest_amount),0) AS i, coalesce(sum(late_fee_amount),0) AS f, count(*)::int AS n
                            FROM payments WHERE organization_id=$1 AND status='completed' AND payment_date >= make_date($2,1,1) AND payment_date < make_date($2+1,1,1)`, [orgId, year]);
    const activeNotes = await countWhere(`notes WHERE organization_id=$1 AND status='active' AND deleted_at IS NULL`, [orgId]);
    const activeNotesAll = await countWhere(`notes WHERE organization_id=$1 AND status='active'`, [orgId]);
    const s = await c.get(`/api/bookkeeping/portfolio-summary?year=${year}`);
    const b = s.body ?? {};
    note("w10-12", `GET /api/bookkeeping/portfolio-summary?year=${year}`, s, `interest=${b.totalInterestIncome} principal=${b.totalPrincipalReceived} lateFees=${b.totalLateFees} gross=${b.totalGrossRevenue} activeNotes=${b.activeNotesCount} yield=${b.portfolioYield} | DB Σinterest=${Number(sums.i).toFixed(2)} Σprincipal=${Number(sums.p).toFixed(2)} Σfees=${Number(sums.f).toFixed(2)} active=${activeNotes}(${activeNotesAll} incl deleted)`);
    if (s.status === 200) {
      const chk = (label: string, api: unknown, dbv: number) => { if (api != null && Math.abs(Number(api) - dbv) > 0.05) finding("P1", "fabrication", `portfolio-summary ${label} ≠ DB`, `api=${api} db=${dbv.toFixed(2)}`); };
      chk("totalInterestIncome", b.totalInterestIncome, Number(sums.i));
      chk("totalPrincipalReceived", b.totalPrincipalReceived, Number(sums.p));
      chk("totalLateFees", b.totalLateFees, Number(sums.f));
      chk("totalGrossRevenue", b.totalGrossRevenue, Number(sums.i) + Number(sums.p) + Number(sums.f));
      if (b.activeNotesCount != null && b.activeNotesCount !== activeNotes && b.activeNotesCount !== activeNotesAll) finding("P1", "fabrication", "portfolio-summary activeNotesCount ≠ DB", `api=${b.activeNotesCount} db=${activeNotes}`);
      if (b.estimatedTaxLiability != null) recordMetric(SIM, "w10-12/estimatedTaxLiability", { value: b.estimatedTaxLiability, note: "flat 25% of interest — an assumption presented as a number" });
    }
    const pnl = await c.get("/api/portfolio-pnl");
    const t = pnl.body?.report?.totals ?? {};
    const closed = await one(`SELECT coalesce(sum(coalesce(accepted_amount, offer_amount)),0) AS acq, count(*)::int AS n FROM deals WHERE organization_id=$1 AND status='closed' AND type='acquisition' AND closing_date >= make_date($2,1,1)`, [orgId, year]);
    const outstanding = await one(`SELECT coalesce(sum(current_balance),0) AS o, count(*)::int AS n, coalesce(sum(monthly_payment),0) AS m FROM notes WHERE organization_id=$1 AND status='active' AND deleted_at IS NULL`, [orgId]);
    const nr = pnl.body?.report?.notesReceivable ?? {};
    note("w10-12", "GET /api/portfolio-pnl", pnl, `acquisitionCost=${t.acquisitionCost} saleProceeds=${t.saleProceeds} interestIncome=${t.interestIncome} totalRevenue=${t.totalRevenue} netProfit=${t.netProfit} cocReturn=${t.cocReturn} irr=${t.irr} notesReceivable outstanding=${nr.outstanding} count=${nr.count} monthly=${nr.monthlyIncome} | DB closed acq Σ=${Number(closed.acq).toFixed(2)} (${closed.n}) Σinterest=${Number(sums.i).toFixed(2)} notes outstanding=${Number(outstanding.o).toFixed(2)} (${outstanding.n}) monthly=${Number(outstanding.m).toFixed(2)}`);
    if (pnl.status === 200) {
      if (t.interestIncome != null && Math.abs(Number(t.interestIncome) - Number(sums.i)) > 0.05) finding("P1", "fabrication", "portfolio-pnl totals.interestIncome ≠ Σ payments.interest_amount", `api=${t.interestIncome} db=${Number(sums.i).toFixed(2)}`);
      if (t.acquisitionCost != null && Math.abs(Number(t.acquisitionCost) - Number(closed.acq)) > 0.05) finding("P1", "fabrication", "portfolio-pnl totals.acquisitionCost ≠ Σ closed acquisition deals", `api=${t.acquisitionCost} db=${Number(closed.acq).toFixed(2)}`);
      if (nr.outstanding != null && Math.abs(Number(nr.outstanding) - Number(outstanding.o)) > 0.05) finding("P1", "fabrication", "portfolio-pnl notesReceivable.outstanding ≠ Σ active notes current_balance", `api=${nr.outstanding} db=${Number(outstanding.o).toFixed(2)}`);
      if (nr.count != null && nr.count !== outstanding.n) finding("P1", "fabrication", "portfolio-pnl notesReceivable.count ≠ active notes", `api=${nr.count} db=${outstanding.n}`);
      if (t.saleProceeds != null && Number(t.saleProceeds) !== 0) finding("P1", "fabrication", "portfolio-pnl reports sale proceeds with no disposition deals", `saleProceeds=${t.saleProceeds}`);
      if (t.irr != null && !(Number(t.acquisitionCost) > 0)) recordMetric(SIM, "w10-12/irr-with-no-basis", t.irr);
    }
  });

  await section("w10-12", "usage counters vs DB", async () => {
    const u = await c.get("/api/usage");
    const dbc = {
      leads: await countWhere(`leads WHERE organization_id=$1 AND deleted_at IS NULL AND coalesce(source,'') NOT IN ('sample_data','sample')`, [orgId]),
      properties: await countWhere(`properties WHERE organization_id=$1 AND status <> 'deleted' AND apn NOT LIKE 'SAMPLE-%'`, [orgId]),
      notes: await countWhere(`notes WHERE organization_id=$1 AND deleted_at IS NULL`, [orgId]),
      campaigns: await countWhere(`campaigns WHERE organization_id=$1`, [orgId]),
    };
    const us = u.body?.usage ?? {};
    note("w10-12", "GET /api/usage", u, `api leads=${us.leads?.current}/${us.leads?.limit} properties=${us.properties?.current}/${us.properties?.limit} notes=${us.notes?.current}/${us.notes?.limit} campaigns=${us.campaigns?.current} | DB leads=${dbc.leads} properties=${dbc.properties} notes=${dbc.notes} campaigns=${dbc.campaigns}`);
    if (u.status === 200) {
      for (const k of ["leads", "properties", "notes", "campaigns"] as const) {
        if (us[k]?.current != null && us[k].current !== dbc[k]) finding("P2", "fabrication", `GET /api/usage ${k}.current ≠ DB count`, `api=${us[k].current} db=${dbc[k]}`);
      }
    }
    const st = await c.get("/api/usage/status");
    note("w10-12", "GET /api/usage/status", st, `tier=${st.body?.tier} ${JSON.stringify(st.body?.limits).slice(0, 160)}`);
  });

  // ── CONSISTENCY PASS ──────────────────────────────────────────────────────
  await section("final", "DB vs API row counts", async () => {
    const pairs: Array<[string, string, () => Promise<number | string>]> = [
      ["leads", `leads WHERE organization_id=$1 AND deleted_at IS NULL`, async () => (await c.get("/api/leads?pageSize=1")).body?.total],
      ["properties", `properties WHERE organization_id=$1 AND status <> 'deleted'`, async () => (await c.get("/api/properties?pageSize=1")).body?.total],
      ["deals", `deals WHERE organization_id=$1 AND deleted_at IS NULL`, async () => (await c.get("/api/deals?pageSize=1")).body?.total],
      ["notes", `notes WHERE organization_id=$1 AND deleted_at IS NULL`, async () => { const r = await c.get("/api/notes"); return Array.isArray(r.body) ? r.body.length : `status ${r.status}`; }],
      ["offers", `offers WHERE organization_id=$1`, async () => { const r = await c.get("/api/offers"); return Array.isArray(r.body) ? r.body.length : `status ${r.status}`; }],
      ["campaigns", `campaigns WHERE organization_id=$1`, async () => { const r = await c.get("/api/campaigns"); return Array.isArray(r.body) ? r.body.length : `status ${r.status}`; }],
      ["payments", `payments WHERE organization_id=$1`, async () => { const r = await c.get("/api/payments"); return Array.isArray(r.body) ? r.body.length : `status ${r.status}`; }],
      ["inbox", `inbox_messages WHERE organization_id=$1`, async () => { const r = await c.get("/api/inbox?limit=100"); return Array.isArray(r.body) ? r.body.length : `status ${r.status}`; }],
    ];
    for (const [name, where, api] of pairs) {
      const dbN = await countWhere(where, [orgId]);
      const apiN = await api();
      note("final", `count ${name}`, { status: typeof apiN === "number" ? 200 : apiN, ms: 0 }, `api=${apiN} db=${dbN}`);
      if (typeof apiN === "number" && apiN !== dbN) finding("P2", "consistency", `API list count for ${name} ≠ DB`, `api=${apiN} db=${dbN}`);
    }
    const touched = ["leads", "properties", "campaigns", "deals", "offers", "notes", "payments", "lead_emails", "inbox_messages", "simulated_actions", "lead_activities", "payment_reminders", "team_members", "organization_invitations", "usage_records", "credit_transactions", "messages", "conversations", "organization_integrations", "export_jobs", "activity_log", "audit_logs"];
    const perTable: Record<string, number> = {};
    for (const t of touched) {
      try { perTable[t] = await countWhere(`${t} WHERE organization_id=$1`, [orgId]); } catch (e) { perTable[t] = -1; }
    }
    recordMetric(SIM, "final/rows-per-table", perTable);
    console.log("  rows per table:", JSON.stringify(perTable));
  });

  await section("final", "dangling + cross-org references", async () => {
    const checks: Array<[string, string]> = [
      ["deals→properties", `SELECT count(*)::int AS n FROM deals d LEFT JOIN properties p ON p.id=d.property_id WHERE d.organization_id=$1 AND (p.id IS NULL OR p.organization_id<>d.organization_id)`],
      ["notes→leads", `SELECT count(*)::int AS n FROM notes n LEFT JOIN leads l ON l.id=n.borrower_id WHERE n.organization_id=$1 AND n.borrower_id IS NOT NULL AND (l.id IS NULL OR l.organization_id<>n.organization_id)`],
      ["notes→properties", `SELECT count(*)::int AS n FROM notes n LEFT JOIN properties p ON p.id=n.property_id WHERE n.organization_id=$1 AND n.property_id IS NOT NULL AND (p.id IS NULL OR p.organization_id<>n.organization_id)`],
      ["offers→leads", `SELECT count(*)::int AS n FROM offers o LEFT JOIN leads l ON l.id=o.lead_id WHERE o.organization_id=$1 AND o.lead_id IS NOT NULL AND (l.id IS NULL OR l.organization_id<>o.organization_id)`],
      ["offers→properties", `SELECT count(*)::int AS n FROM offers o LEFT JOIN properties p ON p.id=o.property_id WHERE o.organization_id=$1 AND o.property_id IS NOT NULL AND (p.id IS NULL OR p.organization_id<>o.organization_id)`],
      ["payments→notes", `SELECT count(*)::int AS n FROM payments p LEFT JOIN notes n ON n.id=p.note_id WHERE p.organization_id=$1 AND (n.id IS NULL OR n.organization_id<>p.organization_id)`],
      ["lead_emails→leads", `SELECT count(*)::int AS n FROM lead_emails e LEFT JOIN leads l ON l.id=e.lead_id WHERE e.organization_id=$1 AND (l.id IS NULL OR l.organization_id<>e.organization_id)`],
      ["inbox_messages→leads", `SELECT count(*)::int AS n FROM inbox_messages m LEFT JOIN leads l ON l.id=m.lead_id WHERE m.organization_id=$1 AND m.lead_id IS NOT NULL AND (l.id IS NULL OR l.organization_id<>m.organization_id)`],
      ["delivery_events→campaigns(org)", `SELECT count(*)::int AS n FROM campaign_delivery_events e JOIN campaigns c ON c.id=e.campaign_id JOIN leads l ON l.id=e.lead_id WHERE c.organization_id=$1 AND l.organization_id<>c.organization_id`],
      ["payment_reminders→notes", `SELECT count(*)::int AS n FROM payment_reminders r LEFT JOIN notes n ON n.id=r.note_id WHERE r.organization_id=$1 AND (n.id IS NULL OR n.organization_id<>r.organization_id)`],
      ["leads.assigned_to→team_members", `SELECT count(*)::int AS n FROM leads l LEFT JOIN team_members t ON t.id=l.assigned_to WHERE l.organization_id=$1 AND l.assigned_to IS NOT NULL AND (t.id IS NULL OR t.organization_id<>l.organization_id)`],
    ];
    for (const [name, sql] of checks) {
      const n = Number((await one(sql, [orgId])).n);
      note("final", `dangling ${name}`, { status: n === 0 ? "ok" : "DANGLING", ms: 0 }, `${n} rows`);
      if (n > 0) finding("P1", "data-integrity", `Dangling/cross-org reference: ${name}`, `${n} rows for org ${orgId}`);
    }
  });

  await section("final", "honesty pass (sample/demo/placeholder/lorem)", async () => {
    const re = /\b(sample|demo|placeholder|lorem)\b/i;
    const hits: Array<{ step: string; snippet: string }> = [];
    for (const k of kept) {
      const m = re.exec(k.text);
      if (m) hits.push({ step: k.step, snippet: k.text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ") });
    }
    recordMetric(SIM, "final/honesty-hits", hits);
    const dbSample = {
      leads: await countWhere(`leads WHERE organization_id=$1 AND (coalesce(source,'') IN ('sample_data','sample') OR last_name ILIKE '%sample%' OR first_name ILIKE '%demo%')`, [orgId]),
      properties: await countWhere(`properties WHERE organization_id=$1 AND apn LIKE 'SAMPLE-%'`, [orgId]),
      notes: await countWhere(`notes WHERE organization_id=$1 AND (notes_text ILIKE '%sample%' OR notes_text ILIKE '%demo%')`, [orgId]),
      deals: await countWhere(`deals WHERE organization_id=$1 AND (notes ILIKE '%sample%' OR notes ILIKE '%placeholder%' OR notes ILIKE '%lorem%')`, [orgId]),
    };
    note("final", "honesty grep", { status: hits.length === 0 && Object.values(dbSample).every((v) => v === 0) ? "clean" : "HITS", ms: 0 }, `responses with hits=${hits.length} DB sample rows=${JSON.stringify(dbSample)}`);
    for (const h of hits) {
      // The words also appear legitimately in API prose ("tcpaBlockedSamples", "sample size"); file only data-shaped hits.
      const dataShaped = /"(firstName|lastName|name|address|apn|subject|content|source)"\s*:\s*"[^"]*\b(sample|demo|placeholder|lorem)\b/i.test(h.snippet) || /\bsample_data\b|\bSAMPLE-/.test(h.snippet);
      if (dataShaped) finding("P2", "honesty", `Response in ${h.step} carries sample/demo/placeholder data for a seedSampleData:false org`, h.snippet);
      else recordMetric(SIM, "final/honesty-prose-hit", h);
    }
    for (const [t, n] of Object.entries(dbSample)) if (n > 0) finding("P2", "honesty", `${t} table holds sample/demo rows for a seedSampleData:false org`, `${n} rows`);
  });

  // ── REPORT ────────────────────────────────────────────────────────────────
  await db.end();
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n═══ ${SIM} — org ${orgId} (${slug}) — ${steps.length} steps, ${findingIds.length} findings, ${skipRows.length} skips, ${elapsed}s`);
  console.log("step | status | ms | truth");
  for (const s of steps) console.log(`${s.week} ${s.step} | ${s.status} | ${s.ms} | ${s.truth}`);
  const summary = { sim: SIM, orgId, slug, elapsedSeconds: elapsed, steps, findings: findingIds, skips: skipRows, at: new Date().toISOString() };
  const file = join(outDir(), "lifecycle-90-days.summary.json");
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(`summary → ${file}`);
  recordMetric(SIM, "elapsed-seconds", elapsed);
}

main().catch((e) => { console.error(e); process.exit(1); });
