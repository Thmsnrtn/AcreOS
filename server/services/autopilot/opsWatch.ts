/**
 * Ops watch — the Ops role worker (Stage 2, S8). Deterministic: no model.
 *
 * The founder simulation took the model provider, SES and Stripe down in turn
 * and the founder was told about none of them: 48 ticks of model 500s, a hung
 * model that stalled one tick for 15 minutes, every email bouncing off a dead
 * SES, Stripe unreachable for a day — zero pages naming any of it, while the
 * routine "still waiting on you" re-pages kept arriving.
 *
 * This watches each provider the business depends on and keeps ONE incident
 * per outage in the existing `incidents` table:
 *   • open   → the founder is paged ONCE, naming the provider;
 *   • still failing → nothing (never a second page for the same incident);
 *   • recovered     → the incident is resolved (recovery is recorded, the
 *                     founder is not paged again — the Letter shows it).
 *
 * Readings (each from a record the product already writes, or a cheap probe):
 *   model_provider — agent_llm_traces: N consecutive ticks' worth of calls all
 *                    failed (MODEL_FAILURE_TICKS), none succeeded.
 *   email_provider — job_health_logs `email_send` rows emailService writes on a
 *                    transport failure (and on the first success after one).
 *   stripe         — a balance probe at most once per tick window, recorded
 *                    as job_health_logs `ops_probe:stripe`; failing once no
 *                    probe has succeeded for STRIPE_DOWN_PAGE_HOURS.
 *
 * `decideTransitions` is pure; the reads/writes are thin and best-effort (a
 * failed read is "unknown", which never opens or closes anything).
 */
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { db } from "../../db";
import { agentLlmTraces, incidents, jobHealthLogs } from "@shared/schema";
import { logger } from "../../utils/logger";

export const OPS_PROVIDERS = ["model_provider", "email_provider", "stripe"] as const;
export type OpsProvider = (typeof OPS_PROVIDERS)[number];

/** Ticks (30 min each) of all-failed model calls before an incident opens. */
export const MODEL_FAILURE_TICKS = 3;
export const TICK_MINUTES = 30;
/**
 * Email transport failures, with no success after them, before an incident
 * opens. ONE: emailService only records a failure after its own retries are
 * exhausted, so a recorded failure is already a provider that would not take
 * the message — and the next send that gets through closes the incident.
 */
export const EMAIL_FAILURES_TO_OPEN = 1;
export const EMAIL_WINDOW_HOURS = 3;
/** Stripe unreachable this long (no successful probe) before the founder is paged. */
export const STRIPE_DOWN_PAGE_HOURS = 24;
/** Job names the watch writes; reflex health ignores probes (they measure, they are not jobs). */
export const EMAIL_SEND_JOB = "email_send";
export const STRIPE_PROBE_JOB = "ops_probe:stripe";

const INCIDENT_TITLE_PREFIX = "[ops] ";
export function incidentTitleFor(p: OpsProvider): string {
  return `${INCIDENT_TITLE_PREFIX}${p}`;
}

/** What a reading says about one provider right now. `null` = unknown (no change). */
export interface ProviderReading {
  provider: OpsProvider;
  failing: boolean | null;
  detail: string;
}

export interface OpenIncident {
  id: string;
  provider: OpsProvider;
}

export interface Transitions {
  open: ProviderReading[];
  resolve: Array<{ incident: OpenIncident; detail: string }>;
}

/**
 * Pure: which incidents to open (failing, none open) and which to resolve
 * (open, provider now healthy). Unknown readings change nothing.
 */
export function decideTransitions(readings: ProviderReading[], open: OpenIncident[]): Transitions {
  const t: Transitions = { open: [], resolve: [] };
  for (const r of readings) {
    const inc = open.find((o) => o.provider === r.provider);
    if (r.failing === true && !inc) t.open.push(r);
    if (r.failing === false && inc) t.resolve.push({ incident: inc, detail: r.detail });
  }
  return t;
}

/** Pure: the model reading from per-tick-bucket (calls, failures) counts, oldest first. */
export function modelReadingFromBuckets(buckets: Array<{ calls: number; failures: number }>, recentSuccesses: number): ProviderReading {
  if (recentSuccesses > 0) {
    return { provider: "model_provider", failing: false, detail: `${recentSuccesses} model call(s) succeeded recently` };
  }
  const allFailed = buckets.length >= MODEL_FAILURE_TICKS && buckets.slice(-MODEL_FAILURE_TICKS).every((b) => b.calls > 0 && b.failures === b.calls);
  if (allFailed) {
    const n = buckets.slice(-MODEL_FAILURE_TICKS).reduce((a, b) => a + b.failures, 0);
    return { provider: "model_provider", failing: true, detail: `every AI model call failed for ${MODEL_FAILURE_TICKS} ticks in a row (${n} calls)` };
  }
  return { provider: "model_provider", failing: null, detail: "no consecutive all-failed ticks" };
}

/** Pure: the email reading. */
export function emailReadingFrom(failuresInWindow: number, lastFailureAt: Date | null, lastSuccessAt: Date | null): ProviderReading {
  if (lastSuccessAt && (!lastFailureAt || lastSuccessAt > lastFailureAt)) {
    return { provider: "email_provider", failing: false, detail: "an email went out after the last failure" };
  }
  if (failuresInWindow >= EMAIL_FAILURES_TO_OPEN) {
    return { provider: "email_provider", failing: true, detail: `${failuresInWindow} email send(s) failed in the last ${EMAIL_WINDOW_HOURS}h with none getting through (the email provider looks down)` };
  }
  return { provider: "email_provider", failing: null, detail: "no sustained email failures" };
}

/** Pure: the Stripe reading from probe history. */
export function stripeReadingFrom(lastProbe: { ok: boolean; at: Date } | null, lastSuccessAt: Date | null, firstProbeAt: Date | null, now: Date): ProviderReading {
  if (!lastProbe) return { provider: "stripe", failing: null, detail: "never probed" };
  if (lastProbe.ok) return { provider: "stripe", failing: false, detail: "Stripe answered the last probe" };
  const since = lastSuccessAt ?? firstProbeAt;
  const hours = since ? (now.getTime() - since.getTime()) / 3_600_000 : 0;
  if (hours >= STRIPE_DOWN_PAGE_HOURS) {
    return { provider: "stripe", failing: true, detail: `Stripe has been unreachable for ${Math.floor(hours)}h — billing reads and payment recovery cannot run` };
  }
  return { provider: "stripe", failing: null, detail: `Stripe unreachable for ${hours.toFixed(1)}h (paging at ${STRIPE_DOWN_PAGE_HOURS}h)` };
}

// ── reads ────────────────────────────────────────────────────────────────────

async function readModel(now: Date): Promise<ProviderReading> {
  try {
    const since = new Date(now.getTime() - MODEL_FAILURE_TICKS * TICK_MINUTES * 60_000);
    const rows = await db
      .select({ at: agentLlmTraces.createdAt, error: agentLlmTraces.error })
      .from(agentLlmTraces)
      .where(gte(agentLlmTraces.createdAt, since))
      .limit(5000);
    const buckets = Array.from({ length: MODEL_FAILURE_TICKS }, () => ({ calls: 0, failures: 0 }));
    let successes = 0;
    for (const r of rows) {
      const age = now.getTime() - r.at.getTime();
      const idx = MODEL_FAILURE_TICKS - 1 - Math.min(MODEL_FAILURE_TICKS - 1, Math.floor(age / (TICK_MINUTES * 60_000)));
      buckets[idx].calls += 1;
      if (r.error) buckets[idx].failures += 1;
      else successes += 1;
    }
    return modelReadingFromBuckets(buckets, successes);
  } catch (err) {
    logger.warn("[opsWatch] model reading failed — unknown", err instanceof Error ? err : undefined);
    return { provider: "model_provider", failing: null, detail: "unreadable" };
  }
}

async function readEmail(now: Date): Promise<ProviderReading> {
  try {
    const since = new Date(now.getTime() - EMAIL_WINDOW_HOURS * 3_600_000);
    const [f] = await db
      .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${jobHealthLogs.runStartedAt})` })
      .from(jobHealthLogs)
      .where(and(eq(jobHealthLogs.jobName, EMAIL_SEND_JOB), eq(jobHealthLogs.status, "failed"), gte(jobHealthLogs.runStartedAt, since)));
    const [lastFail] = await db
      .select({ at: jobHealthLogs.runStartedAt })
      .from(jobHealthLogs)
      .where(and(eq(jobHealthLogs.jobName, EMAIL_SEND_JOB), eq(jobHealthLogs.status, "failed")))
      .orderBy(desc(jobHealthLogs.runStartedAt))
      .limit(1);
    const [lastOk] = await db
      .select({ at: jobHealthLogs.runStartedAt })
      .from(jobHealthLogs)
      .where(and(eq(jobHealthLogs.jobName, EMAIL_SEND_JOB), eq(jobHealthLogs.status, "success")))
      .orderBy(desc(jobHealthLogs.runStartedAt))
      .limit(1);
    return emailReadingFrom(Number(f?.n ?? 0), lastFail?.at ?? null, lastOk?.at ?? null);
  } catch (err) {
    logger.warn("[opsWatch] email reading failed — unknown", err instanceof Error ? err : undefined);
    return { provider: "email_provider", failing: null, detail: "unreadable" };
  }
}

/** Probe Stripe at most once per tick window; record the result; read the history. */
async function readStripe(now: Date, probe?: () => Promise<boolean>): Promise<ProviderReading> {
  try {
    const [last] = await db
      .select({ at: jobHealthLogs.runStartedAt, status: jobHealthLogs.status })
      .from(jobHealthLogs)
      .where(eq(jobHealthLogs.jobName, STRIPE_PROBE_JOB))
      .orderBy(desc(jobHealthLogs.runStartedAt))
      .limit(1);
    const due = !last || now.getTime() - last.at.getTime() >= (TICK_MINUTES - 1) * 60_000;
    const doProbe = probe ?? defaultStripeProbe;
    if (due && (probe || process.env.STRIPE_SECRET_KEY)) {
      const ok = await doProbe().catch(() => false);
      await db.insert(jobHealthLogs).values({ jobName: STRIPE_PROBE_JOB, runStartedAt: now, runCompletedAt: now, durationMs: 0, status: ok ? "success" : "failed" });
    }
    const [latest] = await db
      .select({ at: jobHealthLogs.runStartedAt, status: jobHealthLogs.status })
      .from(jobHealthLogs)
      .where(eq(jobHealthLogs.jobName, STRIPE_PROBE_JOB))
      .orderBy(desc(jobHealthLogs.runStartedAt))
      .limit(1);
    const [lastOk] = await db
      .select({ at: jobHealthLogs.runStartedAt })
      .from(jobHealthLogs)
      .where(and(eq(jobHealthLogs.jobName, STRIPE_PROBE_JOB), eq(jobHealthLogs.status, "success")))
      .orderBy(desc(jobHealthLogs.runStartedAt))
      .limit(1);
    const [first] = await db
      .select({ at: jobHealthLogs.runStartedAt })
      .from(jobHealthLogs)
      .where(eq(jobHealthLogs.jobName, STRIPE_PROBE_JOB))
      .orderBy(jobHealthLogs.runStartedAt)
      .limit(1);
    return stripeReadingFrom(latest ? { ok: latest.status === "success", at: latest.at } : null, lastOk?.at ?? null, first?.at ?? null, now);
  } catch (err) {
    logger.warn("[opsWatch] stripe reading failed — unknown", err instanceof Error ? err : undefined);
    return { provider: "stripe", failing: null, detail: "unreadable" };
  }
}

async function defaultStripeProbe(): Promise<boolean> {
  const { getUncachableStripeClient } = await import("../../stripeClient");
  const stripe = await getUncachableStripeClient();
  await stripe.balance.retrieve(undefined, { timeout: 15_000, maxNetworkRetries: 0 });
  return true;
}

async function openIncidents(): Promise<OpenIncident[]> {
  const rows = await db
    .select({ id: incidents.id, title: incidents.title })
    .from(incidents)
    .where(and(eq(incidents.status, "open"), like(incidents.title, `${INCIDENT_TITLE_PREFIX}%`)));
  return rows
    .map((r) => ({ id: r.id, provider: r.title.slice(INCIDENT_TITLE_PREFIX.length) as OpsProvider }))
    .filter((r) => (OPS_PROVIDERS as readonly string[]).includes(r.provider));
}

const PROVIDER_NAMES: Record<OpsProvider, string> = {
  model_provider: "The AI model provider",
  email_provider: "Email (SES) delivery",
  stripe: "Stripe (billing)",
};

export interface OpsWatchResult {
  readings: ProviderReading[];
  opened: OpsProvider[];
  resolved: OpsProvider[];
  paged: number;
}

/**
 * One watch pass: read every provider, open/resolve incidents, page ONCE per
 * opened incident. Called every tick by the continuous loop and by the Ops role
 * worker when the brain dispatches stabilize_reflexes. Never throws.
 */
export async function runOpsWatch(opts: { now?: Date; stripeProbe?: () => Promise<boolean> } = {}): Promise<OpsWatchResult> {
  const now = opts.now ?? new Date();
  const result: OpsWatchResult = { readings: [], opened: [], resolved: [], paged: 0 };
  try {
    result.readings = await Promise.all([readModel(now), readEmail(now), readStripe(now, opts.stripeProbe)]);
    const t = decideTransitions(result.readings, await openIncidents());
    for (const r of t.open) {
      const [row] = await db
        .insert(incidents)
        .values({
          severity: "SEV-2",
          title: incidentTitleFor(r.provider),
          summary: `${PROVIDER_NAMES[r.provider]} is failing: ${r.detail}`,
          status: "open",
          startedAt: now,
          detectedAt: now,
          detectionSource: "monitor",
          rootCauseCategory: "provider",
          createdBy: "solene-ops",
        })
        .returning({ id: incidents.id });
      result.opened.push(r.provider);
      try {
        const { sendSolenePage } = await import("../solene/pagerService");
        await sendSolenePage({
          severity: "critical",
          subject: `${PROVIDER_NAMES[r.provider]} is down`,
          body: `${r.detail}.\nOne page per outage — I will not page again for this incident, and I'll close it when the provider recovers (it shows in the Letter).\nIncident ${row?.id ?? ""}`,
        });
        result.paged += 1;
      } catch (err) {
        logger.error("[opsWatch] incident page failed", err instanceof Error ? err : undefined);
      }
    }
    for (const { incident, detail } of t.resolve) {
      await db
        .update(incidents)
        .set({ status: "resolved", resolvedAt: now, mitigatedAt: now, impactSummary: `Recovered: ${detail}`, updatedAt: now })
        .where(eq(incidents.id, incident.id));
      result.resolved.push(incident.provider);
    }
  } catch (err) {
    logger.warn("[opsWatch] watch pass failed", err instanceof Error ? err : undefined);
  }
  return result;
}

/** Open ops incidents in plain words, for the Letter. Best-effort. */
export async function openOpsIncidentLines(): Promise<string[]> {
  try {
    const rows = await db
      .select({ summary: incidents.summary, startedAt: incidents.startedAt })
      .from(incidents)
      .where(and(eq(incidents.status, "open"), like(incidents.title, `${INCIDENT_TITLE_PREFIX}%`)));
    return rows.map((r) => r.summary);
  } catch {
    return [];
  }
}
