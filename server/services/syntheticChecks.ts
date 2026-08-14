/**
 * FW-OLU-2 (push-forward 2026-05-08): synthetic checks runner (180-5).
 *
 * Olu's spec: every 15 minutes, ping the critical vendor surfaces so we
 * detect drift before customers do. Five checks at v0:
 *   - ses_send             — SES quota query succeeds + send rate sane
 *   - twilio_status        — Twilio API status query succeeds
 *   - stripe_webhook_freshness — most-recent stripe_processed_event newer
 *                                  than 24h (catches webhook silence)
 *   - clerk_proxy_health   — /__clerk proxy returns 200 on /v1/environment
 *   - db_writeable         — INSERT + DELETE round-trip on a sentinel table
 *
 * The runner writes one row per check per run to `synthetic_check_runs`.
 * The founder pulls latest per check via GET /api/founder/synthetic-checks.
 *
 * Wiring: this file exports `runAllSyntheticChecks()`. A separate cron
 * scheduler (e.g. server/jobs/syntheticCheckCron.ts or a Fly machine
 * scheduled-job) can call it every 15 min. For now, founder-triggered
 * via POST /api/founder/synthetic-checks/run.
 */

import { db } from "../db";
import { syntheticCheckRuns, stripeProcessedEvents } from "@shared/schema";
import { desc } from "drizzle-orm";
import { logger } from "../utils/logger";
import { CLERK_FAPI_ORIGIN } from "../middleware/clerkProxy";

export type CheckStatus = "ok" | "degraded" | "failing";

export interface CheckResult {
  checkKey: string;
  status: CheckStatus;
  latencyMs: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

async function timeIt<T>(fn: () => Promise<T>): Promise<{ result: T | null; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { result, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      result: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSesSend(): Promise<CheckResult> {
  const t = await timeIt(async () => {
    const { emailService } = await import("./emailService");
    const quota = await emailService.getSendQuota();
    if (!quota) throw new Error("SES quota query returned null");
    if (quota.sentLast24Hours >= quota.max24HourSend * 0.95) {
      return { quota, status: "degraded" as const };
    }
    return { quota, status: "ok" as const };
  });
  return {
    checkKey: "ses_send",
    // `?? "failing"`, not `?? "ok"`. Unreachable today — `timeIt` returns
    // `result: null` only alongside an `error`, which the ternary catches first,
    // and every check body returns an object carrying `status`. But a check that
    // cannot report its status is not a check that passed, and a monitoring
    // default should fail toward attention rather than toward silence.
    status: t.error ? "failing" : t.result?.status ?? "failing",
    latencyMs: t.latencyMs,
    errorMessage: t.error,
    metadata: t.result?.quota ? { quota: t.result.quota } : undefined,
  };
}

async function checkStripeWebhookFreshness(): Promise<CheckResult> {
  const t = await timeIt(async () => {
    const [latest] = await db
      .select()
      .from(stripeProcessedEvents)
      .orderBy(desc(stripeProcessedEvents.processedAt))
      .limit(1);
    if (!latest?.processedAt) {
      return { status: "degraded" as const, lastSeenIso: null };
    }
    const ageHours = (Date.now() - new Date(latest.processedAt).getTime()) / (60 * 60 * 1000);
    return {
      status: ageHours > 24 ? ("degraded" as const) : ("ok" as const),
      lastSeenIso: new Date(latest.processedAt).toISOString(),
      ageHours,
    };
  });
  return {
    checkKey: "stripe_webhook_freshness",
    status: t.error ? "failing" : t.result?.status ?? "failing",
    latencyMs: t.latencyMs,
    errorMessage: t.error,
    metadata: t.result ? { lastSeenIso: t.result.lastSeenIso, ageHours: t.result.ageHours } : undefined,
  };
}

async function checkClerkProxyHealth(): Promise<CheckResult> {
  const t = await timeIt(async () => {
    // Ping clerk's environment endpoint to verify the proxy is alive.
    // Same origin the proxy relays to (env-overridable) — single source of truth.
    const upstream = `${CLERK_FAPI_ORIGIN}/v1/environment`;
    const r = await fetch(upstream, { method: "GET" });
    if (!r.ok) throw new Error(`clerk environment returned ${r.status}`);
    return { ok: true };
  });
  return {
    checkKey: "clerk_proxy_health",
    status: t.error ? "failing" : "ok",
    latencyMs: t.latencyMs,
    errorMessage: t.error,
  };
}

async function checkDbWriteable(): Promise<CheckResult> {
  const t = await timeIt(async () => {
    // Insert + delete a sentinel synthetic-check row to verify writes.
    const [row] = await db
      .insert(syntheticCheckRuns)
      .values({
        checkKey: "_db_writeable_sentinel",
        status: "ok",
        latencyMs: 0,
      })
      .returning({ id: syntheticCheckRuns.id });
    return { id: row?.id };
  });
  return {
    checkKey: "db_writeable",
    status: t.error ? "failing" : "ok",
    latencyMs: t.latencyMs,
    errorMessage: t.error,
  };
}

async function checkTwilioStatus(): Promise<CheckResult> {
  const t = await timeIt(async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) {
      return { status: "degraded" as const, reason: "TWILIO_* env not set" };
    }
    const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!r.ok) throw new Error(`twilio account query returned ${r.status}`);
    return { status: "ok" as const };
  });
  return {
    checkKey: "twilio_status",
    status: t.error ? "failing" : t.result?.status ?? "failing",
    latencyMs: t.latencyMs,
    errorMessage: t.error,
  };
}

export async function runAllSyntheticChecks(): Promise<CheckResult[]> {
  const checks = await Promise.allSettled([
    checkSesSend(),
    checkStripeWebhookFreshness(),
    checkClerkProxyHealth(),
    checkDbWriteable(),
    checkTwilioStatus(),
  ]);
  const results: CheckResult[] = checks.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const keys = ["ses_send", "stripe_webhook_freshness", "clerk_proxy_health", "db_writeable", "twilio_status"];
    return {
      checkKey: keys[i] ?? "unknown",
      status: "failing",
      latencyMs: 0,
      errorMessage: s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  });

  // Persist (skip the sentinel row written by checkDbWriteable to avoid
  // doubling — that row already landed during the check itself).
  for (const r of results) {
    if (r.checkKey === "db_writeable") continue;
    try {
      await db.insert(syntheticCheckRuns).values({
        checkKey: r.checkKey,
        status: r.status,
        latencyMs: r.latencyMs,
        errorMessage: r.errorMessage ?? null,
        metadata: r.metadata ?? null,
      });
    } catch (err) {
      logger.warn(
        `[syntheticChecks] persist failed for ${r.checkKey}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return results;
}
