/**
 * aiCostAlert — founder alerting when an AI cost ceiling TRIPS (P1-5 / I-5 R4).
 *
 * Before P1-5, a ceiling trip was silent: the first signal was user-facing
 * "AI is paused" errors, or the daily cost-guard summary the next midnight
 * (and only when the prior 24h crossed its $5 threshold). This module is
 * the proactive leg: the ceiling gate calls notifyAiCeilingTrip at the
 * moment of a MEASURED trip — including the platform bucket's 70%
 * background trip (background callers are cut there to reserve headroom
 * for customer chat) — and the founder gets one email per scope per UTC
 * day, within minutes, naming the scope and the numbers.
 *
 * Posture mirrors dailyAiCostGuard: FOUNDER_ALERT_EMAIL unset → the alert
 * is logged, not emailed. Dedup is in-process (a trip storm produces one
 * email); the structured `[ai-cost-alert]` log line fires on every first
 * trip regardless of email configuration. Never throws — alerting must
 * not break the gate that called it.
 *
 * Env:
 *   FOUNDER_ALERT_EMAIL — recipient. Unset → log-only.
 *   AI_COST_ALERT_FROM  — sender, default "alerts@acreos.io".
 */

import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

export type AiCeilingTripScope = "platform" | "platform_background" | "org" | "org_background";

export interface AiCeilingTrip {
  scope: AiCeilingTripScope;
  orgId: number | null;
  windowKey: "daily" | "monthly" | "background_monthly";
  currentCents: number;
  ceilingCents: number;
}

const alertedKeys = new Set<string>();

/** Test seam: forget which scopes have already alerted today. */
export function __resetAiCostAlertDedupForTests(): void {
  alertedKeys.clear();
}

function scopeLabel(trip: AiCeilingTrip): string {
  switch (trip.scope) {
    case "platform":
      return "platform daily ceiling (all orgs)";
    case "platform_background":
      return "platform daily ceiling — background reserve trip at 70% (background callers now paused; customer chat retains the reserved 30%)";
    case "org":
      return `org ${trip.orgId} ${trip.windowKey} ceiling`;
    case "org_background":
      return `org ${trip.orgId} background monthly sub-ceiling (P1-5 R1)`;
  }
}

/**
 * Notify the founder of a measured ceiling trip. First trip per scope per
 * UTC day emails; repeats the same day are suppressed. Always resolves.
 */
export async function notifyAiCeilingTrip(trip: AiCeilingTrip): Promise<void> {
  try {
    const day = clock.now().toISOString().slice(0, 10);
    const key = `${trip.scope}:${trip.orgId ?? "platform"}:${day}`;
    if (alertedKeys.has(key)) return;
    alertedKeys.add(key);

    const label = scopeLabel(trip);
    logger.error("[ai-cost-alert] AI cost ceiling tripped", {
      metadata: {
        scope: trip.scope,
        orgId: trip.orgId,
        windowKey: trip.windowKey,
        currentCents: trip.currentCents,
        ceilingCents: trip.ceilingCents,
        label,
      },
    });

    const to = process.env.FOUNDER_ALERT_EMAIL;
    if (!to) {
      logger.warn("[aiCostAlert] ceiling tripped but FOUNDER_ALERT_EMAIL is unset; alert not emailed", {
        metadata: { scope: trip.scope, orgId: trip.orgId },
      });
      return;
    }

    const { emailService } = await import("./emailService");
    const from = process.env.AI_COST_ALERT_FROM ?? "alerts@acreos.io";
    const result = await emailService.sendEmail({
      to,
      from,
      fromName: "AcreOS AI cost guard",
      // Protected send (outwardActionCoverage): the dedup identity above —
      // scope:orgId:UTC-day — is durable domain identity (one alert per
      // scope per day), so it doubles as the outward-action idempotency
      // key. For org trips organizationId is present and the boundary
      // engages for real; for platform trips there is no org to scope a
      // claim to, and this module's dedup is the guard (the lane
      // emailService documents for platform-scoped system mail).
      idempotencyKey: `ai-cost-alert:${key}`,
      ...(trip.orgId != null ? { organizationId: trip.orgId } : {}),
      subject: `[AcreOS] AI cost ceiling tripped — ${label}`,
      html: [
        `<p><strong>AI cost ceiling tripped:</strong> ${label}.</p>`,
        `<p>Spend in window: <strong>$${(trip.currentCents / 100).toFixed(2)}</strong>`,
        ` ≥ ceiling <strong>$${(trip.ceilingCents / 100).toFixed(2)}</strong>`,
        ` (window: ${trip.windowKey}).</p>`,
        `<p style="color:#888;font-size:12px">First trip for this scope today;`,
        ` further trips today are logged, not emailed. Lower or raise the`,
        ` relevant ceiling in aiCostCeiling.ts / AI_PLATFORM_DAILY_CEILING_CENTS,`,
        ` or set a founder override for the org.</p>`,
      ].join("\n"),
    });
    if (!result.success) {
      logger.error("[aiCostAlert] trip alert email send failed", new Error(result.error ?? "unknown email error"), {
        metadata: { scope: trip.scope, orgId: trip.orgId, errorType: result.errorType },
      });
    }
  } catch (err) {
    logger.error("[aiCostAlert] notifyAiCeilingTrip failed", err instanceof Error ? err : undefined, {
      metadata: { scope: trip.scope, orgId: trip.orgId },
    });
  }
}
