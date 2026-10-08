/**
 * Founder-side autonomy simulation — shared kit.
 *
 * Runs INSIDE a tsx harness process launched by run-harness.sh (see README):
 *   - `env -i` (no container credentials reach server code),
 *   - cwd = the production-like copy (no .git, no docs/), SERVER_ROOT points at it,
 *   - world-shim.mjs preloaded (egress ledger/firewall + Clerk stand-in).
 *
 * The harness imports the SAME server source the prod-like dist was built
 * from (from SERVER_ROOT) to call registered job bodies directly (e.g.
 * runContinuousTick — what the `solene_continuous_tick` job runs every 30 min),
 * and observes ONLY through the founder's own HTTP surfaces on the running
 * web process plus direct DB reads.
 *
 * Time: `ageWorld(h)` subtracts h hours from every timestamp column in the
 * sim DB (simdb.sql) so JS Date.now() and SQL now() stay real and agree.
 */
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { SimClient } from "../client";

export const SERVER_ROOT = process.env.SERVER_ROOT ?? "/tmp/acreos-prodlike";
// Default output goes to the gitignored reports dir, never a shared temp dir.
export const OUT = process.env.FOUNDER_SIM_OUT ?? fileURLToPath(new URL("../../reports/founder-sim", import.meta.url));
export const STANDIN_DIR = process.env.STANDIN_DIR ?? join(OUT, "standin");
export const EGRESS_LOG = process.env.WORLD_EGRESS_LOG ?? join(OUT, "egress.jsonl");
export const EGRESS_RULES = process.env.WORLD_EGRESS_RULES ?? join(OUT, "egress-rules.json");

mkdirSync(OUT, { recursive: true });

// ── safety: this kit only ever touches the founder sim database ─────────────
const DB_URL = process.env.DATABASE_URL ?? "";
// Stage 2: a per-agent founder-sim DB is allowed (acreos_founder or
// acreos_founder_<x> / acreos_b2) so two founder sims never share a database.
if (!/\/acreos_(founder(_\w+)?|b2)(\?|$)/.test(DB_URL)) {
  throw new Error(`founder sim refuses DATABASE_URL=${DB_URL} (must be acreos_founder, acreos_founder_<x> or acreos_b2)`);
}
if (process.env.GH_TOKEN || process.env.FLY_API_TOKEN || process.env.GITHUB_TOKEN) {
  throw new Error("founder sim refuses to run with container credentials in env — launch via run-harness.sh (env -i)");
}

const pool = new pg.Pool({ connectionString: DB_URL, max: 3 });
export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params as any[]);
  return r.rows as T[];
}
export async function q1<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

/** Import a server module from the production-like source tree. */
export async function srv<T = any>(rel: string): Promise<T> {
  return (await import(join(SERVER_ROOT, "server", rel))) as T;
}

// ── world control ────────────────────────────────────────────────────────────
export async function resetWorld(): Promise<void> {
  await q("select simsnap.restore()");
  try {
    const s = await srv<any>("services/autopilot/settings.ts");
    s.__resetSettingsCacheForTest?.();
  } catch { /* harness may not have loaded it yet */ }
}
export async function ageWorld(hours: number): Promise<number> {
  const r = await q1<{ n: number }>("select simsnap.age_world(($1 || ' hours')::interval) as n", [String(hours)]);
  return Number(r?.n ?? 0);
}

export function setStandinRules(rules: { default: string; rules?: Array<{ match: string; mode: string }> }) {
  writeFileSync(join(STANDIN_DIR, "rules.json"), JSON.stringify({ rules: [], ...rules }, null, 1));
}
export function setEgressRules(rules: Record<string, string>) {
  writeFileSync(EGRESS_RULES, JSON.stringify(rules, null, 1));
}
// Stage 2: Stripe is UP in the baseline world (refunds + the ops watch's
// balance probe answer in Stripe's shape — world-shim.mjs), so an outage is a
// change the sim makes, not the permanent state.
export const PROVIDERS_UP = { "amazonaws.com": "mock", "twilio.com": "mock", "ntfy.sh": "mock", "stripe.com": "mock" };

function lineCount(file: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}
function linesSince(file: string, mark: number): any[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(mark).map((l) => {
    try { return JSON.parse(l); } catch { return { raw: l }; }
  });
}
/** Mark the model stand-in + egress ledgers; `since()` returns what arrived after. */
export function marks() {
  const m = { calls: lineCount(join(STANDIN_DIR, "calls.jsonl")), egress: lineCount(EGRESS_LOG) };
  return {
    ...m,
    since() {
      return {
        modelCalls: linesSince(join(STANDIN_DIR, "calls.jsonl"), m.calls),
        egress: linesSince(EGRESS_LOG, m.egress).filter((e) => e.via !== "boot"),
      };
    },
  };
}

// ── the founder's own surfaces ───────────────────────────────────────────────
export const founder = new SimClient("founder", { founder: true });

export interface FounderView {
  at: string;
  brief: any;
  asksOpen: any[];
  asksTotal: number;
  pendingActions: any[];
  control: any;
  story: any;
  needsYou: any;
  decisionsInbox: any;
  status: Record<string, number>;
}
export async function founderView(): Promise<FounderView> {
  const paths = {
    brief: "/api/founder/solene/brief",
    asks: "/api/founder/asks?status=open&limit=100",
    pending: "/api/founder/autopilot/pending-actions",
    control: "/api/founder/autopilot/control",
    story: "/api/founder/autopilot/story",
    needsYou: "/api/founder/needs-you",
    inbox: "/api/founder/intelligence/decisions-inbox",
  };
  const res: Record<string, any> = {};
  const status: Record<string, number> = {};
  await Promise.all(
    Object.entries(paths).map(async ([k, p]) => {
      const r = await founder.get(p);
      res[k] = r.body;
      status[k] = r.status;
    }),
  );
  return {
    at: new Date().toISOString(),
    brief: res.brief?.brief ?? res.brief,
    asksOpen: res.asks?.asks ?? [],
    asksTotal: res.asks?.total ?? 0,
    pendingActions: res.pending?.actions ?? [],
    control: res.control,
    story: res.story,
    needsYou: res.needsYou,
    decisionsInbox: res.inbox,
    status,
  };
}

export async function setSwitch(key: "dispatchEnabled" | "publishEnabled" | "cognitionEnabled" | "selfPatchEnabled", value: boolean) {
  const r = await founder.post("/api/founder/autopilot/settings", { key, value });
  if (r.status !== 200) throw new Error(`setSwitch ${key}=${value} → ${r.status} ${r.text.slice(0, 200)}`);
  const s = await srv<any>("services/autopilot/settings.ts");
  s.__resetSettingsCacheForTest?.();
  return r.body;
}

// ── Solene's registered job bodies ───────────────────────────────────────────
/** Exactly what the `solene_continuous_tick` job runs (runScheduledJobs.ts:2602-2606). */
export async function tick(): Promise<any> {
  const { runContinuousTick } = await srv<any>("services/solene/continuousLoop.ts");
  const t0 = Date.now();
  const r = await runContinuousTick();
  return { ...r, wallMs: Date.now() - t0 };
}

// ── founder-minute pricing (the brief's rubric) ──────────────────────────────
export const MINUTES = { yesNo: 1, approvalWithReading: 3, freeText: 8, investigation: 15 } as const;
/** Price one open ask by its shape: yes/no with a body to read = approval-with-reading. */
export function priceAsk(a: { answerFormat: string; questionBody?: string }): number {
  if (a.answerFormat === "free_text") return MINUTES.freeText;
  if (a.answerFormat === "yes_no") return (a.questionBody ?? "").length > 160 ? MINUTES.approvalWithReading : MINUTES.yesNo;
  return MINUTES.approvalWithReading;
}

// ── result ledger ────────────────────────────────────────────────────────────
export type Outcome = "HANDLED" | "ESCALATED" | "DROPPED" | "REFUSED-CORRECTLY" | "NOT-RUN";
export interface EventRow {
  scenario: string;
  event: string;
  outcome: Outcome;
  founderMinutes: number;
  evidence: string;
  smallestFix?: string;
  vacuity: string;
}
export function recordEvent(row: EventRow) {
  appendFileSync(join(OUT, "autonomy-ledger.jsonl"), JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n");
  console.log(`  [${row.outcome}] ${row.scenario} :: ${row.event} (${row.founderMinutes} min) — ${row.evidence.slice(0, 160)}`);
}
export function saveJson(name: string, data: unknown) {
  const dir = join(OUT, "scenarios");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data, null, 1));
}
/** A vacuity guard that throws: a scenario that never exercised its path must not report. */
export function vacuity(cond: unknown, what: string): string {
  if (!cond) throw new Error(`VACUOUS: ${what}`);
  return what;
}

export async function shutdown(code = 0) {
  await pool.end().catch(() => {});
  setTimeout(() => process.exit(code), 200).unref?.();
  process.exit(code);
}

// ── the sim scheduler: the worker's registered job bodies on a simulated clock ─
// Each entry names the job exactly as runScheduledJobs registers it and calls
// the same function its timer calls, through the real withJobLock (so failures
// land in job_health_logs exactly as in production). Cadences are the
// registered ones; the clock advances in 30-minute steps and the world is aged
// by ageWorld() between steps.
export interface SimJob {
  name: string;
  everyH: number;
  firstAtH?: number;
  /** Only fire when the simulated UTC hour equals this (jobs gated on getUTCHours()). */
  atUtcHour?: number;
  run: () => Promise<unknown>;
}
export interface JobRunLog { h: number; name: string; ok: boolean; ms: number; err?: string; result?: unknown }

export async function defaultJobs(opts: { include?: string[]; exclude?: string[] } = {}): Promise<SimJob[]> {
  const rt = await srv<any>("utils/jobRuntime.ts");
  const L = (name: string, ttl: number, fn: () => Promise<unknown>) => () => rt.withJobLock(name, ttl, fn);
  const jobs: SimJob[] = [
    // runScheduledJobs.ts:2593 — every 30 min
    { name: "solene_continuous_tick", everyH: 0.5, run: L("solene_continuous_tick", 25 * 60, async () => (await srv<any>("services/solene/continuousLoop.ts")).runContinuousTick()) },
    // runScheduledJobs.ts:2795 — every 5 min (stepped at 30 min here)
    { name: "autopilot_auto_witness_sweep", everyH: 0.5, run: L("autopilot_auto_witness_sweep", 270, async () => (await srv<any>("services/autopilot/autoWitness.ts")).runAutoWitnessSweep()) },
    // runScheduledJobs.ts:2648 — loop-stall watchdog every 30 min
    { name: "solene_loop_watchdog", everyH: 0.5, run: L("solene_loop_watchdog", 25 * 60, async () => (await srv<any>("services/autopilot/loopStall.ts")).observeLoopHealth()) },
    // runScheduledJobs.ts:1881 — onboarding-journey sweeper hourly
    { name: "onboarding_sweeper", everyH: 1, run: L("onboarding_sweeper", 55 * 60, async () => (await srv<any>("services/onboardingAutonomy.ts")).sweepAndFireDueSteps()) },
    // runScheduledJobs.ts:362 — Pax nudges every 6h (first at +5 min)
    { name: "pax_nudges", everyH: 6, firstAtH: 0.5, run: L("pax_nudges", 5 * 3600, async () => (await srv<any>("services/paxNudges.ts")).processPaxNudges()) },
    // runScheduledJobs.ts:1036 — growth automation every 6h, first run +3h
    { name: "growth_automation", everyH: 6, firstAtH: 3, run: L("growth_automation", 55 * 60, async () => (await srv<any>("jobs/growthAutomation.ts")).runGrowthAutomation()) },
    // runScheduledJobs.ts:4636 — dunning tasks every 6h (first +2 min)
    { name: "dunning_tasks", everyH: 6, firstAtH: 0.5, run: L("dunning_tasks", 55 * 60, async () => (await srv<any>("services/dunning.ts")).dunningService.processScheduledTasks()) },
    // runScheduledJobs.ts:1056 — churn engine daily
    { name: "churn_engine", everyH: 24, firstAtH: 1, run: L("churn_engine", 23 * 3600, async () => (await srv<any>("services/churnEngine.ts")).churnEngine.runForAllOrgs()) },
    // runScheduledJobs.ts:1529 — trial expiry daily 9 UTC
    { name: "trial_engine", everyH: 1, atUtcHour: 9, run: L("trial_engine", 23 * 3600, async () => (await srv<any>("services/trialEngine.ts")).runTrialExpiryCycle()) },
    // runScheduledJobs.ts:1587 — onboarding scheduler daily 10 UTC
    { name: "onboarding_scheduler", everyH: 1, atUtcHour: 10, run: L("onboarding_scheduler", 23 * 3600, async () => (await srv<any>("services/onboardingScheduler.ts")).runOnboardingScheduler()) },
    // founderDigest.ts:244 — daily at 14 UTC
    { name: "founder_digest", everyH: 1, atUtcHour: 14, run: L("founder_digest", 23 * 3600, async () => (await srv<any>("services/founderDigest.ts")).founderDigestService.generate()) },
    // runScheduledJobs.ts:2543 — morning pulse daily 12 UTC
    {
      name: "solene_morning_pulse", everyH: 1, atUtcHour: 12,
      run: L("solene_morning_pulse", 30 * 60, async () => {
        const m = await srv<any>("services/solene/continuousLoop.ts");
        return m.persistMorningPulse(await m.composeMorningPulse());
      }),
    },
    // runScheduledJobs.ts:264 — Operator daily cognition cycle (no-op unless cognition on)
    {
      name: "operator_cycle", everyH: 24, firstAtH: 0.5,
      run: L("operator_cycle", 23 * 3600, async () => {
        const { runOperatorCycle } = await srv<any>("services/autopilot/operator.ts");
        const { askFounder } = await srv<any>("services/solene/founderCollab.ts");
        return runOperatorCycle({ ask: async (input: any) => ({ askId: (await askFounder(input)).askId }) });
      }),
    },
    // runScheduledJobs.ts:905 — founder weekly digest, Mondays 14 UTC
    { name: "founder_weekly_digest", everyH: 1, atUtcHour: 14, run: L("founder_weekly_digest", 30 * 60, async () => {
      if (simNow().getUTCDay() !== 1) return "not-monday";
      return (await srv<any>("jobs/founderWeeklyDigest.ts")).sendFounderWeeklyDigest();
    }) },
  ];
  return jobs.filter((j) => (!opts.include || opts.include.includes(j.name)) && !(opts.exclude ?? []).includes(j.name));
}

let simHours = 0;
const SIM_EPOCH = Date.UTC(2026, 9, 5, 0, 0, 0); // a Monday 00:00 UTC — the sim calendar
export function simNow(): Date {
  return new Date(SIM_EPOCH + simHours * 3600_000);
}
export function simHour(): number {
  return simHours;
}
export function resetSimClock() {
  simHours = 0;
}

/**
 * Advance the simulated clock by `hours` in `stepH` steps. At each step every
 * due job runs (serially, real withJobLock), then the world is aged by stepH.
 * `onStep` lets a scenario inject world events or play the founder.
 */
export async function advance(
  hours: number,
  jobs: SimJob[],
  onStep?: (h: number) => Promise<void>,
  stepH = 0.5,
): Promise<JobRunLog[]> {
  const log: JobRunLog[] = [];
  const end = simHours + hours;
  while (simHours < end - 1e-9) {
    const h = simHours;
    if (onStep) await onStep(h);
    for (const j of jobs) {
      const first = j.firstAtH ?? 0;
      if (h + 1e-9 < first) continue;
      const due = Math.abs(((h - first) / j.everyH) - Math.round((h - first) / j.everyH)) < 1e-6;
      if (!due) continue;
      if (j.atUtcHour !== undefined && (simNow().getUTCHours() !== j.atUtcHour || simNow().getUTCMinutes() !== 0)) continue;
      const t0 = Date.now();
      try {
        const result = await j.run();
        log.push({ h, name: j.name, ok: true, ms: Date.now() - t0, result: summarize(result) });
      } catch (e) {
        log.push({ h, name: j.name, ok: false, ms: Date.now() - t0, err: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      }
    }
    await ageWorld(stepH);
    simHours += stepH;
  }
  return log;
}
function summarize(r: unknown): unknown {
  if (r == null || typeof r !== "object") return r;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (v == null || typeof v !== "object") o[k] = v;
    else if (Array.isArray(v)) o[k] = `[${v.length}]`;
  }
  return o;
}
export function jobSummary(log: JobRunLog[]) {
  const by: Record<string, { runs: number; failed: number; lastErr?: string }> = {};
  for (const l of log) {
    const b = (by[l.name] ??= { runs: 0, failed: 0 });
    b.runs++;
    if (!l.ok) { b.failed++; b.lastErr = l.err; }
  }
  return by;
}

/** What worker boot does before any job fires (runScheduledJobs.ts:4188-4191). */
export async function bootSeed() {
  await (await srv<any>("services/autopilot/domainAutonomy.ts")).ensureDomainsSeeded();
}

// ── egress classification: what reached the world ───────────────────────────
export interface WorldContact {
  emails: Array<{ to: string; subject: string; role: string }>;
  pages: Array<{ title: string; body: string; role: string }>;
  sms: Array<{ to: string; role: string }>;
  refused: Array<{ host: string; role: string; outcome: string }>;
  other: Array<{ host: string; path?: string; outcome: string; role: string }>;
}
function formField(body: string, key: string): string {
  const m = new RegExp(`(?:^|&|\\n)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^&\\n]*)`).exec(body);
  if (!m) return "";
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch { return m[1]; }
}
export function classifyEgress(events: any[]): WorldContact {
  const out: WorldContact = { emails: [], pages: [], sms: [], refused: [], other: [] };
  for (const e of events) {
    if (e.via === "boot") continue;
    const body: string = e.bodyPreview ?? "";
    if (e.via === "mock-provider" && /amazonaws/.test(e.host)) {
      const raw = /^(?:[\s\S]*?\n)?To: *(.+)$/m.exec(body)?.[1];
      const subj = /^Subject: *(.+)$/m.exec(body)?.[1];
      out.emails.push({
        to: (raw ?? formField(body, "Destination.ToAddresses.member.1")).trim(),
        subject: (subj ?? formField(body, "Message.Subject.Data")).trim(),
        role: e.role,
      });
      continue;
    }
    if (e.via === "mock-provider" && /twilio/.test(e.host)) {
      out.sms.push({ to: formField(body, "To"), role: e.role });
      continue;
    }
    if (/ntfy\.sh/.test(e.host) && e.via === "fetch") {
      out.pages.push({ title: e.title ?? "", body: body.slice(0, 300), role: e.role });
      continue;
    }
    if (e.via === "mock-provider") continue;
    if (/^(refuse|fail|hang)/.test(String(e.outcome))) out.refused.push({ host: e.host, role: e.role, outcome: e.outcome });
    else if (e.outcome !== "mock") out.other.push({ host: e.host, path: e.path, outcome: e.outcome, role: e.role });
  }
  return out;
}

/** Ask-table facts the founder would live with. */
export async function askStats() {
  const rows = await q<any>(
    `select id, status, urgency, answer_format, question_summary, question_body, asked_at, answered_at, answer_text
       from solene_founder_asks order by id`,
  );
  const open = rows.filter((r) => r.status === "open");
  const bySummary = new Map<string, number>();
  for (const r of rows) bySummary.set(r.question_summary, (bySummary.get(r.question_summary) ?? 0) + 1);
  const openSummaries = new Map<string, number>();
  for (const r of open) openSummaries.set(r.question_summary, (openSummaries.get(r.question_summary) ?? 0) + 1);
  return {
    created: rows.length,
    open: open.length,
    byStatus: rows.reduce((a: Record<string, number>, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}),
    byUrgency: rows.reduce((a: Record<string, number>, r) => ((a[r.urgency] = (a[r.urgency] ?? 0) + 1), a), {}),
    distinctSummaries: bySummary.size,
    openDistinctSummaries: openSummaries.size,
    openSameSummaryDuplicates: [...openSummaries.values()].reduce((a, n) => a + (n - 1), 0),
    summaries: [...bySummary.entries()].map(([s, n]) => ({ s, n })),
    openMinutes: open.reduce((a, r) => a + priceAsk({ answerFormat: r.answer_format, questionBody: r.question_body }), 0),
    rows,
  };
}

/** Self-serve sign-up through the world's own path: Clerk user row, then the
 *  customer's first request lets getOrCreateOrg create the org. */
export async function signUpCustomer(slug: string, email?: string) {
  const { seedCustomerUser } = await import("./seed");
  const u = await seedCustomerUser(slug, email);
  const c = new SimClient(slug);
  const r = await c.get("/api/organization");
  const org = await q1<any>("select o.* from organizations o where o.owner_id = $1", [u.userId]);
  if (!org) throw new Error(`sign-up for ${slug} created no org (GET /api/organization → ${r.status} ${r.text.slice(0, 200)})`);
  return { client: c, user: u, org };
}

// ── Stripe as the world: a signed webhook to the real ingress ────────────────
import { createHmac, randomBytes } from "node:crypto";
export async function stripeWebhook(type: string, object: Record<string, unknown>) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const event = {
    id: `evt_sim_${randomBytes(8).toString("hex")}`,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const r = await fetch(`${process.env.SIM_BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
    body: payload,
  });
  return { status: r.status, text: await r.text(), eventId: event.id };
}


// ── Stage 2: the founder's ONE-TIME setup through his own doors ──────────────
/**
 * What a founder who wants the business to run itself does once, on day 0,
 * through the Controls door (each is a real founder HTTP surface):
 *   - Dispatch ON and Publish ON (the master switches);
 *   - growth / support / finance / deploy trusted to execute_gated (the trust
 *     ledger's "let it act inside the gates");
 *   - two bounded WitnessGrants so the machine can witness its own drafts
 *     inside the founder's bounds: support replies/emails (no money, ≤ 30 days)
 *     and refunds (money allowed, ≤ $50 each, ≤ 20 of them).
 * Priced at 8 founder-minutes, ONCE (a 30-day grant is renewed monthly).
 */
export const SETUP_MINUTES = 8;
export async function founderOneTimeSetup(opts: { levels?: string[] } = {}) {
  await setSwitch("dispatchEnabled", true);
  await setSwitch("publishEnabled", true);
  for (const d of opts.levels ?? ["growth", "support", "finance", "deploy"]) {
    const r = await founder.post(`/api/founder/autopilot/domains/${d}/level`, { level: "execute_gated", reason: "founder one-time setup: let it act inside the gates" });
    if (r.status !== 200) throw new Error(`setup level ${d} → ${r.status} ${r.text.slice(0, 200)}`);
  }
  const g1 = await founder.post("/api/founder/autopilot/witness-grants", { granteeId: "solene", domains: ["support"], maxCostUsd: 1, maxActions: 500, expiresInDays: 30, note: "support replies and system emails to our own customers" });
  const g2 = await founder.post("/api/founder/autopilot/witness-grants", { granteeId: "solene", domains: ["finance"], maxCostUsd: 50, maxActions: 20, expiresInDays: 30, allowMoney: true, note: "refunds up to $50" });
  if (g1.status !== 200 || g2.status !== 200) throw new Error(`setup grants → ${g1.status}/${g2.status} ${g1.text.slice(0, 120)} ${g2.text.slice(0, 120)}`);
  const s = await srv<any>("services/autopilot/settings.ts");
  s.__resetSettingsCacheForTest?.();
  return { grants: [g1.body?.grant?.id, g2.body?.grant?.id] };
}

/** Wait (wall clock) until the worker has drained every queued/running dispatch. */
export async function drainDispatches(timeoutMs = 120_000): Promise<{ drained: boolean; waitedMs: number }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await q1<any>("select count(*)::int n from solene_dispatch_queue where status in ('queued','in_progress') and (not_before_at is null or not_before_at < now())");
    if (!r || r.n === 0) return { drained: true, waitedMs: Date.now() - t0 };
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { drained: false, waitedMs: Date.now() - t0 };
}
