/**
 * Market-cohort shared plumbing: DB access, org provisioning, the burden
 * ledger, the model stand-in's control files and the signed-webhook helpers.
 *
 * Everything here drives a LOCAL production build under the E2E test-auth
 * bypass (see ../client.ts). Never valid against a deployed instance.
 *
 * Output goes to MARKET_OUT (default: a `market-results/` dir under cwd); the
 * shared campaign ledger (../ledger.ts) is pointed at the same place by
 * setting CAMPAIGN_OUT before import — see `run-all.sh` in the README.
 */
import pg from "pg";
import crypto from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SimClient, type Resp } from "../client";
import { personaTestUserId } from "../../../../server/auth/testAuth";

export const OUT = process.env.MARKET_OUT ?? join(process.cwd(), "market-results");
mkdirSync(OUT, { recursive: true });
export const DB_LABEL = process.env.MARKET_DB_LABEL ?? (process.env.DATABASE_URL ?? "").split("/").pop() ?? "?";
export const STANDIN_DIR = process.env.STANDIN_DIR ?? "";

// ─── db ──────────────────────────────────────────────────────────────────────
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  return (await q<T>(sql, params))[0];
}
export async function count(sqlFrom: string, params: unknown[] = []): Promise<number> {
  return Number((await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${sqlFrom}`, params)).n);
}

// ─── jsonl writers ───────────────────────────────────────────────────────────
export function jsonl(file: string, row: unknown) {
  appendFileSync(join(OUT, file), JSON.stringify(row) + "\n");
}
export function writeJson(file: string, v: unknown) {
  writeFileSync(join(OUT, file), JSON.stringify(v, null, 2));
}
export function msg(r: Resp | { text?: string; body?: any }): string {
  return String(r.body?.message ?? r.body?.error ?? r.text ?? "").replace(/\s+/g, " ").slice(0, 260);
}

// ─── the burden ledger ───────────────────────────────────────────────────────
/**
 * Minutes of OWNER (or one human support person) time per event class. The
 * rubric is deliberately conservative and explicit so a reader can re-weight
 * it; every event row carries its class, so re-weighting is a re-sum.
 */
export const RUBRIC_MINUTES = {
  // a customer asks something the product cannot answer for them (Pax down /
  // refuses / no path) → owner reads, answers by email
  support_question: 10,
  // a refusal (4xx) with no next step in the message → ticket + explanation
  refusal_no_next_step: 10,
  // a refusal that names the fix → most customers self-serve; 2 min amortised
  refusal_with_next_step: 2,
  // customer-visible 5xx → read logs, reproduce, reply, maybe hotfix
  error_5xx: 20,
  // silent no-op: the customer is told it worked and it did not → found later,
  // investigate + remediate + apologise
  silent_noop: 30,
  // money shown wrong to a customer (P&L, interest, balances)
  wrong_money_number: 45,
  // customer charged for something that did not happen → refund + reply
  billing_dispute: 20,
  // a compliance event (message to an opted-out contact, quiet hours, missing
  // unsubscribe) → triage, apologise, document; legal exposure tracked apart
  compliance_event: 60,
  // a manual operational request the product does not complete on its own
  // (export, deletion, plan change, cancellation) → owner does it by hand
  manual_request: 15,
  // a security / isolation incident → investigate, notify, fix
  incident: 240,
} as const;
export type BurdenClass = keyof typeof RUBRIC_MINUTES;

export interface BurdenEvent {
  org: string;
  orgId: number;
  persona: string;
  /** simulated cohort day (0..90) and tenure week of THIS org (1-based) */
  day: number;
  tenureWeek: number;
  cls: BurdenClass;
  what: string;
  evidence: string;
  /** a statutory / dollar exposure, when the event carries one (see legalBasis) */
  legalExposureUsd?: number;
  legalBasis?: string;
  moneyUsd?: number;
  db: string;
}
export function burden(e: Omit<BurdenEvent, "db">) {
  jsonl("burden.jsonl", { ...e, db: DB_LABEL, minutes: RUBRIC_MINUTES[e.cls], at: new Date().toISOString() });
}

/** Classify an API response a CUSTOMER saw into a burden class, or null when fine. */
export function classifyResponse(r: Resp): BurdenClass | null {
  if (r.status === 0 || r.status >= 500) return "error_5xx";
  if (r.status >= 400) {
    const m = msg(r).toLowerCase();
    // Errors.limitExceeded() prints a rate-limit sentence for PLAN caps and credit
    // shortfalls too; "wait a few seconds" is not the next step there.
    if (r.status === 429 && /faster than the system/.test(m)) return "refusal_no_next_step";
    const named = /upgrade|connect|configure|add |set up|settings|plan|limit of|first|verify|required|must|missing|invalid|not found|exceed|choose|enter|provide|acknowledg|consent|quiet|opted|do not contact|insufficient|purchase|buy|wait|try again in/.test(m);
    return named ? "refusal_with_next_step" : "refusal_no_next_step";
  }
  return null;
}

// ─── provisioning ────────────────────────────────────────────────────────────
export interface Org {
  slug: string;
  client: SimClient;
  orgId: number;
  userId: string;
  email: string;
}
/** A FRESH tenant for `slug` (suffixing the slug if a prior run used it). */
export async function provisionOrg(baseSlug: string, opts: { businessType: string; noteRole?: string; orgName: string; persona?: string }): Promise<Org> {
  let slug = baseSlug;
  if (await one(`SELECT id FROM users WHERE clerk_user_id=$1`, [personaTestUserId(slug)])) slug = `${baseSlug}-${Date.now().toString(36)}`;
  const clerkId = personaTestUserId(slug);
  const email = `${clerkId}@persona-test.local`;
  const u = await one(
    `INSERT INTO users (clerk_user_id, email, persona, first_name, last_name, tos_accepted_at, privacy_accepted_at)
     VALUES ($1,$2,$3,'Market','Customer',now(),now()) ON CONFLICT (clerk_user_id) DO NOTHING RETURNING id`,
    [clerkId, email, opts.persona ?? "land_investor"],
  ) ?? (await one(`SELECT id FROM users WHERE clerk_user_id=$1`, [clerkId]));
  const client = new SimClient(slug);
  let row: any = null;
  let last = "";
  for (let attempt = 0; attempt < 4 && !row; attempt++) {
    const a = await client.get("/api/auth/user");
    const o = await client.get("/api/organization");
    last = `auth=${a.status} org=${o.status} ${msg(o)}`;
    row = await one(`SELECT id FROM organizations WHERE owner_id=$1 ORDER BY id LIMIT 1`, [u.id]);
    if (!row) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!row) throw new Error(`org not auto-provisioned for ${slug}: ${last}`);
  client.setCookie("acreos_active_org", String(row.id));
  giveOwnIp(client, row.id);
  return { slug, client, orgId: row.id, userId: u.id, email };
}

/**
 * Each customer browses from their own address. getClientIp() prefers the
 * CF-Connecting-IP header Cloudflare stamps in production, so per-IP limiters
 * (imports: 10 per 15 min) see one customer per org, as they would live —
 * without this, every org in the cohort would share the harness's one IP.
 */
export function giveOwnIp(client: SimClient, n: number) {
  const ip = `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  const orig = client.call.bind(client);
  (client as any).call = (m: string, p: string, b?: unknown, o?: any) =>
    orig(m, p, b, { ...(o ?? {}), headers: { "cf-connecting-ip": ip, ...(o?.headers ?? {}) } });
}

/** Webhook deliveries carry no cookie → the default E2E identity must exist (see lifecycle-90-days.ts). */
export async function ensureDefaultE2eUser() {
  await q(`INSERT INTO users (clerk_user_id, email, persona, first_name, last_name, tos_accepted_at, privacy_accepted_at)
           VALUES ('e2e_test_user','e2e_test_user@persona-test.local','land_investor','E2E','Customer',now(),now()) ON CONFLICT (clerk_user_id) DO NOTHING`);
}

// ─── model stand-in control ─────────────────────────────────────────────────
export function standinRules(rules: { default: string; rules?: Array<{ match: string; mode: string }> }) {
  if (!STANDIN_DIR) throw new Error("STANDIN_DIR not set");
  writeFileSync(join(STANDIN_DIR, "rules.json"), JSON.stringify({ rules: [], ...rules }));
}
export function standinCalls(): any[] {
  if (!STANDIN_DIR) return [];
  const f = join(STANDIN_DIR, "calls.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ─── signed webhooks (secrets of the LOCAL build — sim.env) ────────────────
const SESSION_SECRET = process.env.SESSION_SECRET ?? "e2e-session-secret-at-least-32-characters-long";
const INBOUND_EMAIL_HMAC_SECRET = process.env.INBOUND_EMAIL_HMAC_SECRET ?? SESSION_SECRET;
const INBOUND_EMAIL_WEBHOOK_SECRET = process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? "e2e-dummy-inbound-email-webhook-secret-0123456789abcdef";
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "e2e-dummy-twilio-token";

export function replyToAddress(leadId: number, orgId: number): string {
  const hash = crypto.createHmac("sha256", INBOUND_EMAIL_HMAC_SECRET).update(`${leadId}:${orgId}`).digest("hex").slice(0, 12);
  return `inbox+${leadId}-${hash}@replies.acreos.com`;
}
export async function postInboundEmail(c: SimClient, payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", INBOUND_EMAIL_WEBHOOK_SECRET).update(`${ts}.`).update(raw).digest("hex");
  return c.call("POST", "/api/webhooks/inbound-email", undefined, {
    raw, noAuth: true, noCsrf: true,
    headers: { "content-type": "application/json", "x-acreos-timestamp": ts, "x-acreos-signature": sig },
  });
}
export async function postTwilioSms(c: SimClient, params: Record<string, string>) {
  const proto = "https", host = "sim.acreos.test";
  const url = `${proto}://${host}/api/webhooks/twilio/sms`;
  const toSign = url + Object.keys(params).sort().reduce((s, k) => s + k + params[k], "");
  const signature = crypto.createHmac("sha1", TWILIO_AUTH_TOKEN).update(Buffer.from(toSign, "utf-8")).digest("base64");
  return c.call("POST", "/api/webhooks/twilio/sms", undefined, {
    raw: new URLSearchParams(params).toString(), noAuth: true, noCsrf: true,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature, "x-forwarded-proto": proto, "x-forwarded-host": host },
  });
}

// ─── misc ────────────────────────────────────────────────────────────────────
let seed = 2026;
export function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function reseed(n: number) { seed = n; }
export const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    (t as any).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
export { SimClient, type Resp };

/** Escape a value for literal use inside a RegExp. */
export const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
