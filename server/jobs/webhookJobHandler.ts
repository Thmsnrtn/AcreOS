/**
 * Webhook job handler — extracted from runScheduledJobs.ts for T0-11
 * (2026-06-10).
 *
 * The jobQueue `webhook` handler fetched job.payload.url with a timeout but
 * NO SSRF validation — unlike /api/webhooks/test (server/routes-integrations.ts)
 * and server/services/webhookDispatcher.ts, which both run the shared guard.
 * A queued job with an internal URL (169.254.169.254, 10.x, localhost, …)
 * would have been fetched from inside the worker's network.
 *
 * Now every webhook job URL passes validateUrl() first. A blocked URL is a
 * PERMANENT failure: both queue implementations (BullMQ + in-memory, see
 * server/services/jobQueue.ts) decide retry-vs-fail by comparing
 * `job.attempts >= job.maxAttempts` on the same mutable job object handed to
 * the handler, so pinning maxAttempts to the current attempt marks the job
 * failed immediately — no retry storm against the guard.
 */

import { logger } from "../utils/logger";

/** The slice of the queue's Job shape this handler needs (keeps the module
 *  independently testable without importing the full jobQueue service). */
export interface WebhookJobLike {
  payload: Record<string, any>;
  attempts: number;
  maxAttempts: number;
}

/** Hostname-only extraction for log lines — never log the full URL (it can
 *  carry tokens in query strings). */
function safeHost(url: unknown): string {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "<unparseable>";
  }
}

export async function handleWebhookJob(
  job: WebhookJobLike,
): Promise<Record<string, any>> {
  const { url, method = "POST", payload } = job.payload;

  // T0-11 (2026-06-10): same SSRF guard as /api/webhooks/test and the
  // webhook dispatcher. Blocked URLs fail terminally (see module header).
  const { validateUrl, SSRFBlockedError } = await import(
    "../middleware/fileUploadSecurity"
  );
  try {
    await validateUrl(url);
  } catch (err) {
    if (err instanceof SSRFBlockedError) {
      logger.error("[jobQueue] webhook job blocked by SSRF guard", undefined, {
        source: "jobQueue",
        metadata: { host: safeHost(url), reason: err.message },
      });
      // Pin the failure as terminal under the queue's retry math.
      job.maxAttempts = job.attempts;
      throw new Error(`Webhook job blocked by SSRF guard: ${err.message}`);
    }
    throw err;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return { statusCode: response.status };
  } catch (err) {
    throw new Error(`Webhook job failed: ${err}`);
  }
}
