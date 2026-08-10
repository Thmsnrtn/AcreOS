/**
 * X-A slice 2 — the abuse-signal READER. Evidence only.
 *
 * ─── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * This module enforces nothing, throttles nothing, writes nothing. It does not
 * import server/services/orgTrust.ts, it holds no thresholds of its own, and
 * it never touches `organizations.trust_tier`. The send-chokepoint caps
 * proposal (docs/proposals/x-a-send-chokepoint-caps.md) has NOT been ruled on
 * by the founder; until it is, the only legitimate thing to build is the
 * evidence a ruling would act on. That is this file.
 *
 * ─── THE HONESTY RULE THIS FILE EXISTS TO OBEY ──────────────────────────────
 * Every signal below either reads a REAL table at HEAD or is declared
 * UNAVAILABLE by name, with the reason. A signal is never invented, and a
 * count is never faked with a zero:
 *
 *   • `count: 0`    means "we queried a real table and it had no matching
 *                    rows" — a measurement.
 *   • `count: null` means "this was never measured" — either the substrate
 *                    does not exist (`availability: "unavailable"`) or the
 *                    read itself failed (`availability: "read_failed"`).
 *
 * Callers MUST render those three states differently. Collapsing null to 0 is
 * the exact defect class this slice was written to avoid: a founder reading
 * "0 spam complaints" for an org whose complaints were never attributable is
 * being told something the code never established.
 *
 * ─── PREMISE VERIFICATION (done at HEAD, 2026-08-10) ────────────────────────
 * Available, because the table and the org key both exist:
 *   decisions_inbox_items  — item_type='abuse_report', organization_id.
 *   email_suppressions     — organization_id, source, bounce_category.
 *   notes                  — organization_id, access_token, expiry.
 * Unavailable, and named as such rather than guessed:
 *   per-send complaint RATE — email_events carries NO organization_id column
 *                             (server/routes-deliverability.ts says so in its
 *                             own comment), so no honest per-org denominator
 *                             exists.
 *   portal-link REBIND rate — rebinds are logged (services/portalLink.ts
 *                             logger.info) but no table records the event;
 *                             notes.access_token_expires_at is overwritten in
 *                             place, so history is destroyed, not appended.
 */
import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { decisionsInboxItems, emailSuppressions, exportJobs, notes } from "@shared/schema";
import { logger } from "../utils/logger";

/**
 * Mirrors decisionsInbox.ts's ABUSE_REPORT_ITEM_TYPE. Deliberately a local
 * literal rather than an import: decisionsInbox is a large write-side service
 * and a read-only evidence reader should not pull it in. Drift is impossible
 * anyway — tests/unit/abuseSignals.test.ts pins this literal against the
 * declaration in decisionsInbox.ts.
 */
const ABUSE_REPORT_ITEM_TYPE = "abuse_report";

/** Open = still awaiting the founder's disposition. */
const OPEN_STATUSES = ["pending", "deferred"] as const;

/**
 * 30 days. Not a policy number: it is the window the deliverability substrate
 * already uses — the soft-bounce strike window in services/emailSuppressions.ts
 * is 30 days, and email_reputation_snapshot.window_days defaults to 30 — so
 * counts here line up with the rest of the mail evidence instead of inventing
 * a new period.
 *
 * (Deliberately NOT importing that constant: this is a display window, not a
 * suppression rule, and the two are free to diverge. Naming the symbol here in
 * prose would also have minted a phantom consumer for the reachability gate,
 * which counts symbol mentions — a ratchet must not move on a comment.)
 */
export const ABUSE_SIGNAL_WINDOW_DAYS = 30;

/**
 * Availability, three-valued on purpose (see the honesty rule above).
 *   "available"   — a real table was queried; `count` is a measurement.
 *   "unavailable" — no substrate records this at HEAD; `count` stays null.
 *   "read_failed" — the substrate exists but this read threw; `count` stays
 *                   null. Distinguished from "unavailable" so a transient DB
 *                   fault is never mistaken for a permanent data gap.
 */
export type AbuseSignalAvailability = "available" | "unavailable" | "read_failed";

export type AbuseSignalKey =
  | "abuse_reports_open"
  | "abuse_reports_window"
  | "spam_complaints_window"
  | "bounce_suppressions_window"
  | "active_portal_links"
  | "complaint_rate_per_send"
  | "portal_link_rebind_rate"
  | "export_velocity";

/**
 * The only cap in ORG_TRUST_CAPS that a signal here measures the SAME quantity
 * as. Kept a literal union (not `keyof OrgTrustCaps`) so this module needs no
 * orgTrust import — the caller passes cap VALUES in, this module never reads
 * the caps table. If a future signal maps to another cap, widen this union.
 */
export type AbuseSignalCapKey = "portalLinksActiveMax";

export interface AbuseSignal {
  key: AbuseSignalKey;
  /** What the value IS, in the founder's words. Never a euphemism. */
  label: string;
  /**
   * The real Postgres table this signal reads. NULL if and only if the signal
   * is unavailable — tests/unit/abuseSignals.test.ts fails BY NAME on any
   * non-null value that is not a declared pgTable in shared/schema.ts.
   */
  sourceTable: string | null;
  availability: AbuseSignalAvailability;
  /** Measurement, or null when nothing was measured. Never a stand-in zero. */
  count: number | null;
  /** Lookback in days; null for stock quantities (a count of things that ARE). */
  windowDays: number | null;
  /**
   * Why it is unavailable, or the caveat a reader must carry when reading the
   * number. Always present — an available signal with a caveat says so.
   */
  note: string;
  /** Set when a proposed cap measures this same quantity. */
  capKey?: AbuseSignalCapKey;
}

/** A signal's shape before any DB read — the catalog entry. */
type AbuseSignalSpec = Omit<AbuseSignal, "count" | "availability"> & {
  /** Present for available signals only. */
  available: boolean;
};

/**
 * THE CATALOG. Adding a row here without a real table behind it is what the
 * exit test exists to catch.
 */
const SIGNAL_SPECS: readonly AbuseSignalSpec[] = [
  {
    key: "abuse_reports_open",
    label: "Open abuse reports filed against this org",
    sourceTable: "decisions_inbox_items",
    windowDays: null,
    available: true,
    note:
      "Portal 'Report this page' items still awaiting the founder's disposition " +
      "(status pending or deferred), any age. A report is an allegation, not a finding. " +
      "A report whose access token did not resolve is filed with NO organization and is " +
      "therefore counted against nobody — read this as a floor, not a total.",
  },
  {
    key: "abuse_reports_window",
    label: "Abuse reports filed in the window",
    sourceTable: "decisions_inbox_items",
    windowDays: ABUSE_SIGNAL_WINDOW_DAYS,
    available: true,
    note:
      "All abuse_report cards filed against this org in the window, regardless of " +
      "how they were dispositioned. Dedupe means repeat reports of the SAME page " +
      "reuse one open card, so this undercounts report volume for a single page.",
  },
  {
    key: "spam_complaints_window",
    label: "Spam complaints attributed to this org",
    sourceTable: "email_suppressions",
    windowDays: ABUSE_SIGNAL_WINDOW_DAYS,
    available: true,
    note:
      "Recipients who hit the spam button on mail attributed to this org. " +
      "Attribution is BEST-EFFORT: it depends on the SES message carrying an " +
      "organization_id tag (server/routes-ses-events.ts), so untagged complaints " +
      "land against no org and are NOT counted here. Read this as a floor.",
  },
  {
    key: "bounce_suppressions_window",
    label: "Bounce suppressions attributed to this org",
    sourceTable: "email_suppressions",
    windowDays: ABUSE_SIGNAL_WINDOW_DAYS,
    available: true,
    note:
      "Addresses suppressed for bouncing on mail attributed to this org. Same " +
      "best-effort attribution caveat as complaints — a floor, not a total.",
  },
  {
    key: "active_portal_links",
    label: "Live borrower portal links held",
    sourceTable: "notes",
    windowDays: null,
    available: true,
    capKey: "portalLinksActiveMax",
    note:
      "Notes holding an access token that has not expired. A link with NO expiry " +
      "recorded counts as live — that is portalLinkExpired()'s migration-safe " +
      "fail-open, mirrored here so the two never disagree.",
  },
  {
    key: "complaint_rate_per_send",
    label: "Complaint rate per send",
    sourceTable: null,
    windowDays: null,
    available: false,
    note:
      "UNAVAILABLE — no per-org denominator covering ALL sends exists. " +
      "email_events has no organization_id column, so platform-wide delivery " +
      "volume cannot be split per org; email_reputation_snapshot stores a rate, " +
      "but its sent_count is a GLOBAL delivered-count (routes-deliverability.ts " +
      "says so in its own comment). outbound_email_log IS org-scoped, but it " +
      "records only registry-routed transactional/lifecycle mail from a handful " +
      "of call sites — using it as the denominator would divide complaints from " +
      "ALL mail by a fraction of it and overstate every org's rate. Complaint " +
      "COUNTS above are real; the rate is not computed rather than computed wrongly.",
  },
  {
    key: "portal_link_rebind_rate",
    label: "Portal-link rebind frequency",
    sourceTable: null,
    windowDays: null,
    available: false,
    note:
      "UNAVAILABLE — rebinds are logged, not recorded. services/portalLink.ts " +
      "emits a logger line per rebind and overwrites notes.access_token_expires_at " +
      "in place, so no table holds rebind history. Making this available needs an " +
      "append-only rebind event row (schema change, not this slice).",
  },
  {
    key: "export_velocity",
    label: "Bulk export jobs run",
    sourceTable: "export_jobs",
    windowDays: ABUSE_SIGNAL_WINDOW_DAYS,
    available: true,
    note:
      "Bulk export jobs this org queued in the window (export_jobs, org-scoped). " +
      "Covers the bulk archive path only — a per-view CSV download that never " +
      "creates a job row is NOT counted, so this is a floor on export activity, " +
      "not a total. Slice-2 note: an earlier draft declared this signal " +
      "unavailable on the premise that nothing records an export; export_jobs " +
      "does, and the fleet-10 audit caught the false premise before it reached " +
      "a founder decision.",
  },
] as const;

/** One org's evidence. */
export interface OrgAbuseSignals {
  organizationId: number;
  signals: AbuseSignal[];
}

/**
 * A pre-read (no DB) copy of the catalog for one org: every signal present,
 * availables carrying `count: null` until a read fills them in.
 */
function blankSignals(): AbuseSignal[] {
  return SIGNAL_SPECS.map((spec) => {
    const { available, ...rest } = spec;
    return {
      ...rest,
      availability: available ? ("available" as const) : ("unavailable" as const),
      // An available signal starts unmeasured. A read that never lands leaves
      // null here, and the "read_failed" marking below makes that explicit —
      // it must never fall through as 0.
      count: null,
    };
  });
}

/** Fold a `{orgId, count}` aggregate into the per-org signal rows. */
function applyCounts(
  reports: Map<number, AbuseSignal[]>,
  key: AbuseSignalKey,
  rows: Array<{ orgId: number | null; count: number }>,
  orgIds: number[],
): void {
  const byOrg = new Map<number, number>();
  for (const row of rows) {
    if (row.orgId == null) continue;
    byOrg.set(row.orgId, Number(row.count) || 0);
  }
  for (const orgId of orgIds) {
    const signal = reports.get(orgId)?.find((s) => s.key === key);
    if (!signal) continue;
    // GROUP BY returns no row for an org with no matching rows — that IS a
    // measured zero, because the query ran against a real table.
    signal.count = byOrg.get(orgId) ?? 0;
    signal.availability = "available";
  }
}

/** Mark an available signal as unread when its query threw. Never zero. */
function markReadFailed(
  reports: Map<number, AbuseSignal[]>,
  key: AbuseSignalKey,
  orgIds: number[],
  reason: string,
): void {
  for (const orgId of orgIds) {
    const signal = reports.get(orgId)?.find((s) => s.key === key);
    if (!signal) continue;
    signal.availability = "read_failed";
    signal.count = null;
    signal.note = `Not measured — this read failed (${reason}). The count below is absent, not zero.`;
  }
}

/**
 * Read every available abuse signal for a batch of orgs. One aggregate query
 * per signal (GROUP BY organization_id), not one per org.
 *
 * Pure read. No writes, no tier changes, no enforcement — by construction:
 * this module imports no update/insert helper and no policy table.
 */
export async function readAbuseSignals(
  orgIds: number[],
  options?: { windowDays?: number; now?: Date },
): Promise<Map<number, OrgAbuseSignals>> {
  const reports = new Map<number, OrgAbuseSignals>();
  const signalsByOrg = new Map<number, AbuseSignal[]>();
  const uniqueIds = Array.from(new Set(orgIds.filter((id) => Number.isFinite(id))));
  for (const orgId of uniqueIds) {
    const signals = blankSignals();
    signalsByOrg.set(orgId, signals);
    reports.set(orgId, { organizationId: orgId, signals });
  }
  if (uniqueIds.length === 0) return reports;

  const now = options?.now ?? new Date();
  const windowDays = options?.windowDays ?? ABUSE_SIGNAL_WINDOW_DAYS;
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  for (const signals of signalsByOrg.values()) {
    for (const signal of signals) {
      if (signal.windowDays !== null) signal.windowDays = windowDays;
    }
  }

  // ── decisions_inbox_items: open abuse reports (any age) ──────────────────
  try {
    const rows = await db
      .select({
        orgId: decisionsInboxItems.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(decisionsInboxItems)
      .where(
        and(
          eq(decisionsInboxItems.itemType, ABUSE_REPORT_ITEM_TYPE),
          inArray(decisionsInboxItems.organizationId, uniqueIds),
          inArray(decisionsInboxItems.status, [...OPEN_STATUSES]),
        ),
      )
      .groupBy(decisionsInboxItems.organizationId);
    applyCounts(signalsByOrg, "abuse_reports_open", rows, uniqueIds);
  } catch (err) {
    logger.error(
      "[abuseSignals] open abuse-report read failed",
      err instanceof Error ? err : undefined,
    );
    markReadFailed(signalsByOrg, "abuse_reports_open", uniqueIds, "decisions_inbox_items");
  }

  // ── decisions_inbox_items: reports filed inside the window ───────────────
  try {
    const rows = await db
      .select({
        orgId: decisionsInboxItems.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(decisionsInboxItems)
      .where(
        and(
          eq(decisionsInboxItems.itemType, ABUSE_REPORT_ITEM_TYPE),
          inArray(decisionsInboxItems.organizationId, uniqueIds),
          gte(decisionsInboxItems.createdAt, since),
        ),
      )
      .groupBy(decisionsInboxItems.organizationId);
    applyCounts(signalsByOrg, "abuse_reports_window", rows, uniqueIds);
  } catch (err) {
    logger.error(
      "[abuseSignals] windowed abuse-report read failed",
      err instanceof Error ? err : undefined,
    );
    markReadFailed(signalsByOrg, "abuse_reports_window", uniqueIds, "decisions_inbox_items");
  }

  // ── email_suppressions: complaints ───────────────────────────────────────
  // source='spam' is the SES/SendGrid complaint lane; bounce_category
  // 'complaint' is the Eleonora taxonomy written alongside it. OR'd so a row
  // carrying either marking counts once.
  try {
    const rows = await db
      .select({
        orgId: emailSuppressions.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(emailSuppressions)
      .where(
        and(
          inArray(emailSuppressions.organizationId, uniqueIds),
          gte(emailSuppressions.suppressedAt, since),
          or(
            eq(emailSuppressions.source, "spam"),
            eq(emailSuppressions.bounceCategory, "complaint"),
          ),
        ),
      )
      .groupBy(emailSuppressions.organizationId);
    applyCounts(signalsByOrg, "spam_complaints_window", rows, uniqueIds);
  } catch (err) {
    logger.error(
      "[abuseSignals] complaint read failed",
      err instanceof Error ? err : undefined,
    );
    markReadFailed(signalsByOrg, "spam_complaints_window", uniqueIds, "email_suppressions");
  }

  // ── export_jobs: bulk export velocity ────────────────────────────────────
  // Org-scoped and indexed on (organization_id, status, created_at). Counts
  // jobs QUEUED in the window regardless of status: a failed or cancelled
  // export still evidences the attempt, which is the abuse signal.
  try {
    const rows = await db
      .select({
        orgId: exportJobs.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(exportJobs)
      .where(
        and(
          inArray(exportJobs.organizationId, uniqueIds),
          gte(exportJobs.createdAt, since),
        ),
      )
      .groupBy(exportJobs.organizationId);
    applyCounts(signalsByOrg, "export_velocity", rows, uniqueIds);
  } catch (err) {
    logger.error(
      "[abuseSignals] export velocity read failed",
      err instanceof Error ? err : undefined,
    );
    markReadFailed(signalsByOrg, "export_velocity", uniqueIds, "export_jobs");
  }

  // ── email_suppressions: bounces ──────────────────────────────────────────
  try {
    const rows = await db
      .select({
        orgId: emailSuppressions.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(emailSuppressions)
      .where(
        and(
          inArray(emailSuppressions.organizationId, uniqueIds),
          gte(emailSuppressions.suppressedAt, since),
          eq(emailSuppressions.source, "bounce"),
        ),
      )
      .groupBy(emailSuppressions.organizationId);
    applyCounts(signalsByOrg, "bounce_suppressions_window", rows, uniqueIds);
  } catch (err) {
    logger.error(
      "[abuseSignals] bounce read failed",
      err instanceof Error ? err : undefined,
    );
    markReadFailed(signalsByOrg, "bounce_suppressions_window", uniqueIds, "email_suppressions");
  }

  // ── notes: live portal links held ────────────────────────────────────────
  try {
    const rows = await db
      .select({
        orgId: notes.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(notes)
      .where(
        and(
          inArray(notes.organizationId, uniqueIds),
          isNotNull(notes.accessToken),
          // NULL expiry = "no expiry recorded" = still live, matching
          // portalLink.portalLinkExpired()'s fail-open. The two must agree or
          // the founder reads a different world than the borrower gets.
          or(
            isNull(notes.accessTokenExpiresAt),
            gte(notes.accessTokenExpiresAt, now),
          ),
        ),
      )
      .groupBy(notes.organizationId);
    applyCounts(signalsByOrg, "active_portal_links", rows, uniqueIds);
  } catch (err) {
    logger.error(
      "[abuseSignals] portal-link read failed",
      err instanceof Error ? err : undefined,
    );
    markReadFailed(signalsByOrg, "active_portal_links", uniqueIds, "notes");
  }

  return reports;
}

// ───────────────────────────────────────────────────────────────────────────
// Demotion EVIDENCE — never demotion.
// ───────────────────────────────────────────────────────────────────────────

export interface TrustReviewEvidence {
  /**
   * True only when a MEASURED signal exceeds a threshold that actually exists
   * in code. It is a recommendation to LOOK, never an instruction to act, and
   * never a tier change.
   */
  reviewRecommended: boolean;
  /** One line per exceeded threshold, naming the signal, the value and the cap. */
  exceeded: string[];
  /**
   * Signals with real, non-zero measurements for which NO threshold exists
   * anywhere in code. Named rather than silently ignored: the absence of a
   * threshold is itself the thing the founder has to rule on (proposal item 5
   * leaves complaint/bounce/report thresholds explicitly unset).
   */
  awaitingThreshold: string[];
  /** Signals that could not be measured at all — carried so the panel can say so. */
  notMeasured: string[];
}

/**
 * Compare measured signals against the PROPOSED caps the caller supplies.
 *
 * Deliberately takes cap VALUES as an argument instead of reading the caps
 * table: this function holds no policy, invents no threshold, and cannot
 * become an enforcement point. It returns sentences, not decisions — a trust
 * tier is changed by the founder, and nothing in this file writes one.
 */
export function evaluateTrustReviewEvidence(
  signals: AbuseSignal[],
  proposedCaps: Record<AbuseSignalCapKey, number>,
): TrustReviewEvidence {
  const exceeded: string[] = [];
  const awaitingThreshold: string[] = [];
  const notMeasured: string[] = [];

  for (const signal of signals) {
    if (signal.availability !== "available" || signal.count === null) {
      notMeasured.push(
        `${signal.label} — ${signal.availability === "unavailable" ? "no source at HEAD" : "read failed"}`,
      );
      continue;
    }
    const capKey = signal.capKey;
    if (capKey) {
      const cap = proposedCaps[capKey];
      if (typeof cap === "number" && signal.count > cap) {
        exceeded.push(
          `${signal.label}: ${signal.count} exceeds the PROPOSED ${capKey} of ${cap} for this tier`,
        );
      }
      continue;
    }
    if (signal.count > 0) {
      awaitingThreshold.push(
        `${signal.label}: ${signal.count} recorded — no threshold for this signal exists in code`,
      );
    }
  }

  return {
    reviewRecommended: exceeded.length > 0,
    exceeded,
    awaitingThreshold,
    notMeasured,
  };
}
