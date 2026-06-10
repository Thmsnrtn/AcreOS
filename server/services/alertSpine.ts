/**
 * alertSpine.ts — THE one alert policy layer (elevation blueprint Tier 1D).
 *
 * Before this file the platform had FOUR disconnected alert nervous systems:
 *
 *   1. notifyOnCall (services/oncall.ts)              — P0/P1 founder page:
 *      VAPID push + email + ack-deadline timer. Written by deadmanCheck,
 *      autonomousHealthMonitor, burnRateMonitor, the audit-chain verifier.
 *   2. sendSolenePage (services/solene/pagerService)  — ntfy.sh push to Tom's
 *      phone. Written by Solene's between-session loop + founder collab.
 *   3. findings (services/audit/domainAudit.ts)       — domain_audit_findings
 *      table behind the founder cockpit "is it green?" surface. Written by
 *      the domain detectors, deadman, burn-rate monitor.
 *   4. system_alerts (shared/schema.ts → systemAlerts) — /admin/alerts +
 *      per-org banners. Written by alerting.ts rules, externalStatusMonitor,
 *      reconciliation, a dozen jobs.
 *
 * The failure mode: a CRITICAL finding landed in a table nobody watches; a
 * reconciliation divergence wrote a system_alerts row and nothing else; a
 * vendor outage told customers but never the founder. This module makes the
 * four systems TRANSPORTS behind one policy:
 *
 *   severity "critical" → page (notifyOnCall + sendSolenePage — the deadman's
 *                         throttled repage channel, hoisted here) + findings
 *                         row + system_alerts row
 *   severity "warning"  → findings row + system_alerts row (no page)
 *   severity "info"     → findings row only
 *
 * Dedupe: pages and system_alerts writes are suppressed per
 * (source, dedupeKey) within ALERT_DEDUPE_WINDOW_MS so a flapping check
 * pages once an hour, not 50 times. Findings always pass through —
 * recordFinding upserts on (detector, dedupe_key) natively, so re-fires bump
 * last_seen_at instead of duplicating.
 *
 * The headline 1D fix: recordFinding(severity:"critical") now routes back
 * through pageCriticalThrottled (see domainAudit.ts), so a critical finding
 * raised ANYWHERE actually pages instead of rotting in a table.
 */

import { db } from "../db";
import { systemAlerts } from "@shared/schema";
import type { DomainAuditDomain, DomainAuditSeverity } from "@shared/schema";
import { logger } from "../utils/logger";
import { notifyOnCall, type OnCallSeverity } from "./oncall";
import { sendSolenePage } from "./solene/pagerService";
import { recordFinding } from "./audit/domainAudit";

export type AlertSpineSeverity = "critical" | "warning" | "info";

/** Mirror of the deadman's REPAGE_THROTTLE_MS — one page per key per hour. */
export const ALERT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

// Per-(source:dedupeKey) last-fired timestamps. In-process, mirroring the
// deadman's original _lastPagedAt map — a worker restart resets the window,
// which only risks ONE extra page, never a missed one.
const _lastPagedAt = new Map<string, number>();
const _lastSystemAlertAt = new Map<string, number>();

function pruneMap(map: Map<string, number>, now: number): void {
  if (map.size < 2000) return;
  for (const [k, t] of map) {
    if (now - t > ALERT_DEDUPE_WINDOW_MS) map.delete(k);
  }
}

/** Test hook — clears the in-process dedupe windows. */
export function __resetAlertSpineForTests(): void {
  _lastPagedAt.clear();
  _lastSystemAlertAt.clear();
}

/**
 * Seed the page-throttle window from an externally persisted timestamp
 * (Tier 1H): the in-process window resets on deploy, so callers that persist
 * their own last-paged-at (e.g. the deadman's deadman_page_state) can carry
 * the throttle across restarts. Only ever moves the window FORWARD — a stale
 * persisted row can never un-throttle a page the live window already stamped.
 */
export function seedPageThrottle(
  source: string,
  dedupeKey: string,
  lastPagedAtMs: number,
): void {
  const key = `${source}:${dedupeKey}`;
  const existing = _lastPagedAt.get(key) ?? 0;
  if (lastPagedAtMs > existing) {
    _lastPagedAt.set(key, lastPagedAtMs);
  }
}

export interface PageCriticalInput {
  /** Detector / subsystem id — half of the dedupe key. */
  source: string;
  title: string;
  detail: string;
  /** Stable identity for THIS condition within the source. */
  dedupeKey: string;
  /** P0 (page-now, 15m ack) or P1 (urgent, 60m ack). Default P0. */
  priority?: OnCallSeverity;
  metadata?: Record<string, unknown>;
}

/**
 * The throttled critical-page channel (the deadman's repage discipline,
 * generalized). Fans out to BOTH page transports — notifyOnCall (VAPID push +
 * email + ack-timer) and sendSolenePage (ntfy) — best-effort and independent.
 *
 * @returns true if a page was actually dispatched, false if throttled.
 */
export async function pageCriticalThrottled(
  input: PageCriticalInput,
): Promise<boolean> {
  const key = `${input.source}:${input.dedupeKey}`;
  const now = Date.now();
  const last = _lastPagedAt.get(key) ?? 0;
  if (now - last < ALERT_DEDUPE_WINDOW_MS) {
    return false;
  }
  _lastPagedAt.set(key, now);
  pruneMap(_lastPagedAt, now);

  // Transport A: notifyOnCall — push + email + ack-deadline timer.
  try {
    await notifyOnCall(input.priority ?? "P0", input.title, input.detail, {
      source: input.source,
      dedupeKey: input.dedupeKey,
      ...(input.metadata ?? {}),
    });
  } catch (err) {
    logger.error(
      "[alertSpine] notifyOnCall transport failed",
      err instanceof Error ? err : undefined,
      { metadata: { source: input.source, dedupeKey: input.dedupeKey } },
    );
  }

  // Transport B: Solene ntfy page (never throws by contract).
  try {
    await sendSolenePage({
      severity: "critical",
      subject: input.title,
      body: input.detail,
    });
  } catch (err) {
    logger.error(
      "[alertSpine] sendSolenePage transport failed",
      err instanceof Error ? err : undefined,
      { metadata: { source: input.source, dedupeKey: input.dedupeKey } },
    );
  }

  return true;
}

export interface RaiseAlertInput {
  severity: AlertSpineSeverity;
  /** Detector / subsystem id. Becomes the findings `detector` column. */
  source: string;
  title: string;
  detail: string;
  /**
   * Stable identity for THIS condition within the source — the same condition
   * must produce the same dedupeKey on every run (findings upsert on it; the
   * page + system_alerts windows key on it).
   */
  dedupeKey: string;
  /** Founder-cockpit domain for the finding. Default "reliability". */
  domain?: DomainAuditDomain;
  /** The SLO / charter rule this violates. Findings require one. */
  citedReason?: string;
  subjectRef?: string | null;
  metadata?: Record<string, unknown>;
  /** Optional org context for the system_alerts row (platform alerts: null). */
  organizationId?: number | null;
  /** system_alerts type/alert_type. Default = source. */
  alertType?: string;
  /** Page priority when severity is "critical". Default P0. */
  pagePriority?: OnCallSeverity;
}

export interface RaiseAlertResult {
  paged: boolean;
  findingRecorded: boolean;
  systemAlertWritten: boolean;
}

const SEVERITY_TO_FINDING: Record<AlertSpineSeverity, DomainAuditSeverity> = {
  critical: "critical",
  warning: "warn",
  info: "info",
};

/**
 * Raise an alert through the ONE policy layer. Every step is best-effort and
 * independent — a DB outage must never suppress the page, and a page failure
 * must never suppress the durable finding.
 */
export async function raiseAlert(
  input: RaiseAlertInput,
): Promise<RaiseAlertResult> {
  const result: RaiseAlertResult = {
    paged: false,
    findingRecorded: false,
    systemAlertWritten: false,
  };
  const key = `${input.source}:${input.dedupeKey}`;

  // ── Policy step 1: critical pages (throttled) ─────────────────────────────
  // Page FIRST so a dying database can't suppress the page about itself.
  if (input.severity === "critical") {
    try {
      result.paged = await pageCriticalThrottled({
        source: input.source,
        title: input.title,
        detail: input.detail,
        dedupeKey: input.dedupeKey,
        priority: input.pagePriority,
        metadata: input.metadata,
      });
    } catch (err) {
      logger.error(
        "[alertSpine] page step failed",
        err instanceof Error ? err : undefined,
        { metadata: { key } },
      );
    }
  }

  // ── Policy step 2: every severity gets a durable finding ─────────────────
  // recordFinding upserts on (detector, dedupe_key), so re-fires are free.
  // (recordFinding itself re-routes critical findings into
  // pageCriticalThrottled; the window we just stamped suppresses the double.)
  try {
    await recordFinding({
      domain: input.domain ?? "reliability",
      detector: input.source,
      severity: SEVERITY_TO_FINDING[input.severity],
      title: input.title,
      detail: input.detail,
      citedReason:
        input.citedReason ?? "Raised through the alert spine (Tier 1D policy).",
      dedupeKey: input.dedupeKey,
      subjectRef: input.subjectRef ?? null,
      metadata: input.metadata,
    });
    result.findingRecorded = true;
  } catch (err) {
    logger.error(
      "[alertSpine] recordFinding transport failed",
      err instanceof Error ? err : undefined,
      { metadata: { key } },
    );
  }

  // ── Policy step 3: warning + critical also land in system_alerts ─────────
  // (windowed so a flapping check doesn't spam /admin/alerts either).
  if (input.severity === "critical" || input.severity === "warning") {
    const now = Date.now();
    const last = _lastSystemAlertAt.get(key) ?? 0;
    if (now - last >= ALERT_DEDUPE_WINDOW_MS) {
      _lastSystemAlertAt.set(key, now);
      pruneMap(_lastSystemAlertAt, now);
      try {
        await db.insert(systemAlerts).values({
          type: input.alertType ?? input.source,
          alertType: input.alertType ?? input.source,
          severity: input.severity,
          title: input.title,
          message: input.detail,
          organizationId: input.organizationId ?? null,
          metadata: {
            source: input.source,
            dedupeKey: input.dedupeKey,
            ...(input.metadata ?? {}),
          },
        });
        result.systemAlertWritten = true;
      } catch (err) {
        logger.error(
          "[alertSpine] system_alerts transport failed",
          err instanceof Error ? err : undefined,
          { metadata: { key } },
        );
      }
    }
  }

  logger.info(`[alertSpine] ${input.severity} alert raised: ${input.title}`, {
    metadata: {
      source: input.source,
      dedupeKey: input.dedupeKey,
      paged: result.paged,
      findingRecorded: result.findingRecorded,
      systemAlertWritten: result.systemAlertWritten,
    },
  });

  return result;
}
