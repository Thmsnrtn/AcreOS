/**
 * SOLENE — proactive pager service.
 *
 * Sends an ntfy.sh push to Tom's phone for genuinely-urgent items between
 * sessions. Page discipline lives in docs/internal/solene-page-discipline.md;
 * this service is the transport, not the judgment.
 *
 * Topic: env var SOLENE_PAGE_TOPIC (default
 * `acreos-solene-urgent-norton-9k4m7q3z`, mirroring the existing daily-pulse
 * topic-naming convention — long, opaque, non-discoverable). Tom subscribes
 * once on his iOS ntfy app.
 *
 * Severity → ntfy headers:
 *   urgent   → Priority 4, Tags "warning"          (sound + lock-screen)
 *   critical → Priority 5, Tags "warning,siren"    (max priority + siren tone)
 *
 * Persistence: every call writes a solene_page_events row regardless of
 * delivery outcome so the post-hoc audit can review whether Solene's
 * discipline held. A page that ntfy refused still counts as a discipline
 * event for retro review.
 */

import { logger } from "../../utils/logger";
import { db } from "../../db";
import {
  solenePageEvents,
  type SolenePageSeverity,
  type SolenePageDeliveryStatus,
} from "@shared/schema/solene-page";

const DEFAULT_TOPIC = "acreos-solene-urgent-norton-9k4m7q3z";

const NTFY_TIMEOUT_MS = 5000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SendPageInput {
  severity: SolenePageSeverity;
  subject: string;
  body: string;
}

export interface SendPageResult {
  eventId: number | null;
  deliveryStatus: SolenePageDeliveryStatus;
  deliveryDetail: string | null;
}

/**
 * Resolve the ntfy topic. In production an UNSET env returns null — the
 * built-in default topic string ships in the public repo, so pushing real
 * operational pages (incidents, MRR alerts, panic stops) to it would leak
 * founder telemetry to anyone who subscribes, while looking "delivered".
 * Dev/test keep the default so local paging is testable out of the box.
 */
export function pageTopic(): string | null {
  const t = process.env.SOLENE_PAGE_TOPIC;
  if (typeof t === "string" && t.length > 0) return t;
  if (process.env.NODE_ENV === "production") return null;
  return DEFAULT_TOPIC;
}

/**
 * Push a page to ntfy + record the event. Never throws — caller gets a
 * structured result either way so the API endpoint can return a coherent
 * status to Solene.
 */
export async function sendSolenePage(input: SendPageInput): Promise<SendPageResult> {
  const { severity, subject, body } = input;
  const topic = pageTopic();

  const priority = severity === "critical" ? "5" : "4";
  const tags = severity === "critical" ? "warning,siren" : "warning";

  let deliveryStatus: SolenePageDeliveryStatus = "skipped";
  let deliveryDetail: string | null = null;

  if (topic === null) {
    // Production with no SOLENE_PAGE_TOPIC: refuse to push to the public
    // repo-visible default (telemetry leak + nobody is subscribed). The
    // event row below still persists so the Control surface shows the
    // page; the error log is the loud signal that paging is unconfigured.
    logger.error(
      "[solenePager] SOLENE_PAGE_TOPIC not set in production — page NOT pushed (persisted only). Set the env to restore founder notifications.",
    );
    deliveryDetail = "SOLENE_PAGE_TOPIC unset in production — push refused";
  } else {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NTFY_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Title: `Solene: ${subject}`,
      Priority: priority,
      Tags: tags,
    };

    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      deliveryStatus = "delivered";
      deliveryDetail = `ntfy HTTP ${res.status}`;
    } else {
      deliveryStatus = "failed";
      deliveryDetail = `ntfy HTTP ${res.status}`;
      logger.warn(
        `[solenePager] ntfy push failed: HTTP ${res.status}`,
      );
    }
  } catch (err) {
    deliveryStatus = "failed";
    deliveryDetail = err instanceof Error ? err.message.slice(0, 250) : String(err).slice(0, 250);
    logger.warn(
      "[solenePager] ntfy push threw",
      err instanceof Error ? err : undefined,
    );
  }
  }

  // Second channel (step-away hardening): when the push did NOT reach the
  // founder — ntfy failed, or production refused the unset topic — fall back
  // to email via FOUNDER_EMAIL. One transport outage must never silence a
  // critical page. The email reaching the founder counts as delivery; the
  // detail records the full path honestly. Best-effort: an email failure
  // never throws past here.
  if (deliveryStatus !== "delivered") {
    const founderEmail = process.env.FOUNDER_EMAIL?.trim();
    if (founderEmail) {
      try {
        const { emailService } = await import("../emailService");
        const result = await emailService.sendEmail({
          to: founderEmail,
          from: process.env.SOLENE_PAGE_FROM ?? "alerts@acreos.io",
          fromName: "Solene (AcreOS autopilot)",
          subject: `[Solene ${severity.toUpperCase()}] ${subject}`,
          html: `<p><strong>${escapeHtml(subject)}</strong></p><pre style="font-family:monospace;white-space:pre-wrap">${escapeHtml(body)}</pre><p style="color:#666;font-size:12px">Sent by email because the push channel ${
            topic === null ? "is unconfigured (SOLENE_PAGE_TOPIC unset)" : "failed"
          }.</p>`,
        });
        if (result.success) {
          deliveryDetail = `${deliveryDetail ?? "push not delivered"}; email fallback delivered to FOUNDER_EMAIL`;
          deliveryStatus = "delivered";
        } else {
          deliveryDetail = `${deliveryDetail ?? "push not delivered"}; email fallback ALSO failed: ${(result.error ?? "unknown").slice(0, 150)}`;
          logger.error(
            "[solenePager] BOTH page channels failed — founder is unreachable for this page",
          );
        }
      } catch (err) {
        deliveryDetail = `${deliveryDetail ?? "push not delivered"}; email fallback threw: ${err instanceof Error ? err.message.slice(0, 150) : String(err).slice(0, 150)}`;
        logger.error(
          "[solenePager] BOTH page channels failed — founder is unreachable for this page",
          err instanceof Error ? err : undefined,
        );
      }
    }
  }

  // Persist regardless of delivery outcome.
  let eventId: number | null = null;
  try {
    const [inserted] = await db
      .insert(solenePageEvents)
      .values({
        severity,
        subject,
        body,
        deliveryStatus,
        deliveryDetail,
      })
      .returning({ id: solenePageEvents.id });
    eventId = inserted?.id ?? null;
  } catch (err) {
    logger.error(
      "[solenePager] failed to persist page event — ntfy push may have succeeded",
      err instanceof Error ? err : undefined,
    );
  }

  return { eventId, deliveryStatus, deliveryDetail };
}
