/**
 * Client telemetry — a THIN ALIAS over the one analytics sink.
 *
 * Unit 121. This module used to be a second, independent `trackEvent` with the
 * identical name and signature, imported under the same bare name in the same
 * SPA as `@/lib/analytics`'s. They routed to sinks with opposite retention:
 *
 *   @/lib/analytics  → posthog.capture(...) — recorded, and read by the
 *                      acquisition dashboard.
 *   @/lib/telemetry  → queued, flushed to POST /api/telemetry — which, in
 *                      PRODUCTION, logs nothing, stores nothing, forwards
 *                      nothing, and returns { success: true }.
 *
 * So `trackEvent("today_queue_rendered", {...})` on the primary customer surface
 * was recorded or discarded depending on which module the author's editor
 * auto-imported — and the discarding one answered success. Four modules were on
 * the discarding side, including today.tsx.
 *
 * Consolidated onto the live sink (the founder's standing "one owner" ruling,
 * applied to sanitizePrompt, deal P&L, credential redaction, /metrics and Lob
 * credentials before this). The batching/sendBeacon machinery is gone rather
 * than ported: posthog-js already batches and flushes on unload, so keeping a
 * second queue in front of it would be a second owner of the same concern.
 *
 * `telemetryEventsAreRecorded.test.ts` pins that this module has no independent
 * sink again.
 */

import { trackEvent as captureEvent } from "@/lib/analytics";

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  captureEvent(event, properties);
}

// Pre-defined event helpers
export const telemetry = {
  pageView: (page: string) => trackEvent('page_view', { page }),
  featureUsed: (feature: string) => trackEvent('feature_used', { feature }),
  actionCompleted: (action: string, details?: Record<string, any>) => 
    trackEvent('action_completed', { action, ...details }),
  aiUsed: (agent: string, tokensUsed?: number) => 
    trackEvent('ai_used', { agent, tokensUsed }),
  error: (errorType: string, message: string) =>
    trackEvent('error', { errorType, message }),
  sessionStart: () => trackEvent('session_start'),
};

/** Check whether the user qualifies for beta activation (stub — extend as needed). */
export function checkBetaActivation(usageMinutes: number): boolean {
  return usageMinutes >= 30;
}
