// ============================================================================
// server/services/audit/domainAudit.ts
// ----------------------------------------------------------------------------
// IRIS — the ONE shared continuous-audit substrate.
//
// Six domains (Lena/Beatrice/Quinn/Andrei/Tess/Iyari) each want a per-domain
// "audit loop that writes findings" + the founder wants a single "is it green?"
// surface. Rather than six bespoke ledgers, they all share `domain_audit_findings`
// and this service:
//
//   recordFinding(finding)   — UPSERT on (detector, dedupe_key). Insert once;
//                              re-firing the same logical finding bumps
//                              last_seen_at (and refreshes severity/detail),
//                              never duplicating. A re-fired finding that had
//                              been resolved/stale re-opens.
//   acknowledgeFinding(id)   — founder marks a finding seen-but-not-yet-fixed.
//   resolveFinding(id)       — founder/closing-detector marks it fixed.
//   staleFindings(days)      — auto-mark `open` findings not seen in N days as
//                              'stale' (the underlying condition stopped firing
//                              but nobody explicitly resolved it).
//
//   DomainDetector           — the interface each domain implements.
//   runDomainAudits(detectors) — runs each detector in isolation (one bad
//                              detector NEVER breaks the others) and records
//                              every finding it returns.
//
// COMPANY/FOUNDER-LEVEL — findings are facts about the company, not a tenant.
// No organization_id. See shared/schema/domain-audit-findings.ts.
// ============================================================================

import { and, eq, lt, inArray, sql } from "drizzle-orm";

import { db } from "../../db";
import { logger } from "../../utils/logger";
import {
  domainAuditFindings,
  type DomainAuditDomain,
  type DomainAuditSeverity,
  type DomainAuditFinding,
} from "@shared/schema";

// ── Detector contract ────────────────────────────────────────────────────────

/**
 * The shape a detector returns for each finding. The substrate supplies
 * `status`, `first_seen_at`, `last_seen_at`, etc. — a detector only describes
 * WHAT is wrong + WHY it matters + a stable dedupe key.
 */
export interface FindingInput {
  domain: DomainAuditDomain;
  /** Detector id — stable, matches DomainDetector.id. Half of the dedupe key. */
  detector: string;
  severity: DomainAuditSeverity;
  title: string;
  detail: string;
  /** The charter rule / immutable / SLO this finding violates. */
  citedReason: string;
  /**
   * Stable identity for THIS logical finding within the detector. The same
   * condition must produce the same dedupe_key on every run so re-fires update
   * rather than duplicate. e.g. "tax_reserve:underfunded" or
   * `observation_rate:stalled`.
   */
  dedupeKey: string;
  /** Optional pointer to the subject (org id / parcel apn / bucket name). */
  subjectRef?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Each domain implements this. `run()` is read-only — it reads existing data
 * and returns the findings it observed. It must NOT write to the findings
 * table itself; the runner does that via recordFinding so dedupe + isolation
 * are uniform.
 */
export interface DomainDetector {
  /** Stable detector id (also the `detector` column on every emitted finding). */
  id: string;
  domain: DomainAuditDomain;
  run(): Promise<FindingInput[]>;
}

// ── recordFinding (upsert) ───────────────────────────────────────────────────

/**
 * Insert a finding, or — if one already exists for (detector, dedupe_key) —
 * bump its last_seen_at and refresh the mutable fields. A re-fired finding
 * that had been resolved/stale is re-opened (the condition is back). An
 * acknowledged finding STAYS acknowledged on re-fire (the founder already
 * saw it; don't spam them back to 'open').
 */
export async function recordFinding(input: FindingInput): Promise<void> {
  const now = new Date();
  await db
    .insert(domainAuditFindings)
    .values({
      domain: input.domain,
      detector: input.detector,
      severity: input.severity,
      title: input.title,
      detail: input.detail,
      citedReason: input.citedReason,
      status: "open",
      dedupeKey: input.dedupeKey,
      subjectRef: input.subjectRef ?? null,
      metadata: input.metadata ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [domainAuditFindings.detector, domainAuditFindings.dedupeKey],
      set: {
        // Refresh the human-facing fields — severity/detail can change as the
        // condition worsens (warn → critical).
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        citedReason: input.citedReason,
        domain: input.domain,
        subjectRef: input.subjectRef ?? null,
        metadata: input.metadata ?? null,
        lastSeenAt: now,
        // Re-open if previously resolved/stale; keep 'acknowledged' sticky.
        // open + acknowledged are left as-is.
        status: sql`CASE WHEN ${domainAuditFindings.status} IN ('resolved','stale') THEN 'open' ELSE ${domainAuditFindings.status} END`,
        // Clear resolved_at when we re-open.
        resolvedAt: sql`CASE WHEN ${domainAuditFindings.status} IN ('resolved','stale') THEN NULL ELSE ${domainAuditFindings.resolvedAt} END`,
      },
    });
}

// ── acknowledge / resolve ────────────────────────────────────────────────────

/** Mark a finding acknowledged (seen, not yet fixed). Returns the updated row or null. */
export async function acknowledgeFinding(
  id: number,
): Promise<DomainAuditFinding | null> {
  const [row] = await db
    .update(domainAuditFindings)
    .set({ status: "acknowledged", lastSeenAt: new Date() })
    .where(eq(domainAuditFindings.id, id))
    .returning();
  return row ?? null;
}

/** Mark a finding resolved (fixed). Stamps resolved_at. Returns the updated row or null. */
export async function resolveFinding(
  id: number,
): Promise<DomainAuditFinding | null> {
  const now = new Date();
  const [row] = await db
    .update(domainAuditFindings)
    .set({ status: "resolved", resolvedAt: now })
    .where(eq(domainAuditFindings.id, id))
    .returning();
  return row ?? null;
}

// ── staleFindings sweep ──────────────────────────────────────────────────────

/**
 * Auto-mark `open` findings whose underlying condition has stopped firing —
 * i.e. their last_seen_at is older than `olderThanDays` — as 'stale'. This is
 * the self-healing path: a detector that no longer emits a finding lets it age
 * out without the founder having to click resolve on every transient blip.
 *
 * Only touches `open` findings — acknowledged ones are explicitly the founder's
 * to close, and resolved ones are already terminal.
 *
 * @returns number of findings transitioned to 'stale'.
 */
export async function staleFindings(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .update(domainAuditFindings)
    .set({ status: "stale" })
    .where(
      and(
        eq(domainAuditFindings.status, "open"),
        lt(domainAuditFindings.lastSeenAt, cutoff),
      ),
    )
    .returning({ id: domainAuditFindings.id });
  if (rows.length > 0) {
    logger.info("[domainAudit] staleFindings swept open findings", {
      metadata: { count: rows.length, olderThanDays },
    });
  }
  return rows.length;
}

// ── runDomainAudits runner ───────────────────────────────────────────────────

export interface RunDomainAuditsResult {
  detectorsRun: number;
  detectorsFailed: number;
  findingsRecorded: number;
  /** Detector ids that threw. */
  failures: Array<{ detector: string; error: string }>;
}

/**
 * Run each detector in ISOLATION and record every finding it returns. A single
 * detector throwing (bad query, missing data) never aborts the others — its
 * failure is logged and the runner moves on. This is the daily cron entrypoint.
 */
export async function runDomainAudits(
  detectors: DomainDetector[],
): Promise<RunDomainAuditsResult> {
  let detectorsFailed = 0;
  let findingsRecorded = 0;
  const failures: Array<{ detector: string; error: string }> = [];

  for (const detector of detectors) {
    try {
      const findings = await detector.run();
      for (const finding of findings) {
        try {
          await recordFinding(finding);
          findingsRecorded += 1;
        } catch (err) {
          // A single un-recordable finding shouldn't sink the detector's batch.
          logger.error(
            "[domainAudit] failed to record finding",
            err instanceof Error ? err : undefined,
            { metadata: { detector: detector.id, dedupeKey: finding.dedupeKey } },
          );
        }
      }
    } catch (err) {
      detectorsFailed += 1;
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ detector: detector.id, error: message });
      logger.error(
        "[domainAudit] detector threw — skipping, others continue",
        err instanceof Error ? err : undefined,
        { metadata: { detector: detector.id, domain: detector.domain } },
      );
    }
  }

  logger.info("[domainAudit] runDomainAudits complete", {
    metadata: { detectorsRun: detectors.length, detectorsFailed, findingsRecorded },
  });

  return {
    detectorsRun: detectors.length,
    detectorsFailed,
    findingsRecorded,
    failures,
  };
}

// ── read helpers (shared by the founder route) ───────────────────────────────

/** Statuses the cockpit treats as "still needs attention". */
export const ACTIVE_FINDING_STATUSES = ["open", "acknowledged"] as const;

/**
 * Fetch findings, optionally filtered by domain + status. Newest-seen first.
 */
export async function listFindings(opts: {
  domain?: string;
  statuses?: string[];
} = {}): Promise<DomainAuditFinding[]> {
  const conditions = [];
  if (opts.domain) conditions.push(eq(domainAuditFindings.domain, opts.domain));
  if (opts.statuses && opts.statuses.length > 0) {
    conditions.push(inArray(domainAuditFindings.status, opts.statuses));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(domainAuditFindings)
    .where(where)
    .orderBy(sql`${domainAuditFindings.lastSeenAt} DESC`);
}
