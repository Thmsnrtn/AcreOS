/**
 * Lease-expiry detector (audit Wave 1, buy_and_hold beta→core).
 *
 * The landlord vertical modelled `rental_leases.end_date` but nothing turned "a
 * lease is ~60 days from ending" into a signal, so the two lease templates
 * (tpl_landlord_lease_renewal_countdown / tpl_lease_expiring, plus the
 * cross-vertical tpl_multifamily_unit_turn) sat idle forever. This daily scan is
 * their emit site.
 *
 * It mirrors notePaymentDueDetector.ts EXACTLY — same daily-scan + mesh-ledger
 * dedupe shape, no new migration:
 *
 *   (a) one mesh event per NEW finding on the `lease:expiry` channel, deduped by
 *       a deterministic key (lease + end-date) checked against the mesh's own
 *       ledger, so a rerun never re-publishes the same fact. The mesh event IS
 *       the durable dedupe record.
 *   (b) AFTER a successful publish, BOTH workflow events fire for the lease
 *       (lease.renewal_countdown_60d AND lease.expiring_60d) via
 *       rentalEvents.emitLeaseExpiryEvents — so exactly one pair per (lease,
 *       end-date), no matter how many times the job runs.
 *
 * Observe-only besides the workflow emit: a lease approaching its end is a real
 * fact worth a mesh signal, and that signal doubles as the dedupe ledger. Skips
 * month-to-month leases (null end_date — no end, no signal) and non-active
 * leases. No fabrication anywhere — a lease with no primary tenant / no property
 * address emits those fields as null (handled in rentalEvents), never invented.
 */
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { rentalLeases, eventMeshEvents } from "@shared/schema";
import { logger } from "../utils/logger";
import { eventMeshPublisher } from "./eventMeshPublisher";
import {
  type ExpiringLeaseRow,
  resolveLeaseContext,
  emitLeaseExpiryEvents,
} from "./rentalEvents";

export const LEASE_EXPIRY_CHANNEL = "lease:expiry";

/**
 * The renewal window. A lease whose end date is within the next 60 days (and not
 * already past) is "in the window" — deliberately the whole ≤60-day band rather
 * than an exact 60-day match, so a daily run never misses a lease (a gap of
 * missed job days, or a lease imported mid-window, still fires exactly once) and
 * the per-(lease, end-date) dedupe guarantees a single firing. Same "within N
 * days" shape as notePaymentDueDetector's due-soon window.
 */
export const RENEWAL_WINDOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC-midnight epoch ms for a YYYY-MM-DD string (time-of-day never leaks in). */
function utcMidnight(dateStr: string): number {
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00.000Z`).getTime();
}

/** The scanned lease row (real columns only) — a superset of ExpiringLeaseRow. */
export interface ScannedLeaseRow extends ExpiringLeaseRow {
  status: string;
}

export interface LeaseExpiryFinding {
  leaseId: string;
  orgId: number;
  propertyId: number;
  /** End date as YYYY-MM-DD — part of the idempotency key. */
  endDate: string;
  /** Whole days until the lease ends (0..RENEWAL_WINDOW_DAYS for a finding). */
  daysUntilEnd: number;
  /** Deterministic idempotency key: same lease + end-date never fires twice. */
  dedupeKey: string;
  /** The full row, carried so the scan can resolve lease context on a new hit. */
  row: ScannedLeaseRow;
}

/**
 * Pure window + skip logic. A lease is a finding when it is ACTIVE, has a real
 * end date (month-to-month / null is skipped — no end, no signal), and that end
 * date is within the next `windowDays` (inclusive) and not already past.
 * Deterministic + total — `now` is an argument so the rule is testable without a
 * clock or a database.
 */
export function classifyExpiringLeases(
  rows: ScannedLeaseRow[],
  now: Date,
  windowDays: number = RENEWAL_WINDOW_DAYS,
): LeaseExpiryFinding[] {
  const todayMs = utcMidnight(now.toISOString().slice(0, 10));
  const findings: LeaseExpiryFinding[] = [];
  for (const row of rows) {
    if (row.status !== "active") continue; // non-active never renews here
    if (!row.endDate) continue; // month-to-month: no end date, no signal
    const endMs = utcMidnight(row.endDate);
    if (!Number.isFinite(endMs)) continue;
    const daysUntilEnd = Math.floor((endMs - todayMs) / DAY_MS);
    if (daysUntilEnd < 0) continue; // already ended — not an upcoming renewal
    if (daysUntilEnd > windowDays) continue; // not yet in the window
    const endDate = String(row.endDate).slice(0, 10);
    findings.push({
      leaseId: row.id,
      orgId: row.organizationId,
      propertyId: row.propertyId,
      endDate,
      daysUntilEnd,
      dedupeKey: `lease-expiry:${row.id}:${endDate}`,
      row,
    });
  }
  return findings;
}

/**
 * The findings whose durable dedupe key has NOT already been published. Pure, so
 * the "a daily rerun does not re-emit" guarantee is directly testable: feed the
 * same findings and the prior run's key set and the result is empty.
 */
export function selectNewFindings(
  findings: LeaseExpiryFinding[],
  alreadyPublished: ReadonlySet<string>,
): LeaseExpiryFinding[] {
  return findings.filter((f) => !alreadyPublished.has(f.dedupeKey));
}

export interface LeaseExpiryScanResult {
  scanned: number;
  inWindow: number;
  published: number;
  emitted: number;
  errors: number;
}

/**
 * Daily scan: read active leases ending within the window, classify, dedupe
 * against the mesh ledger, publish one mesh event per NEW finding and then fire
 * both lease workflow events for it. Best-effort throughout — a failure degrades
 * to fewer signals, never a crash or an invented value.
 */
export async function runLeaseExpiryScan(now: Date = new Date()): Promise<LeaseExpiryScanResult> {
  const result: LeaseExpiryScanResult = { scanned: 0, inWindow: 0, published: 0, emitted: 0, errors: 0 };

  let findings: LeaseExpiryFinding[] = [];
  try {
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const horizon = new Date(today.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS);
    const todayIso = today.toISOString().slice(0, 10);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const rows = await db
      .select({
        id: rentalLeases.id,
        organizationId: rentalLeases.organizationId,
        propertyId: rentalLeases.propertyId,
        endDate: rentalLeases.endDate,
        monthlyRentCents: rentalLeases.monthlyRentCents,
        state: rentalLeases.state,
        status: rentalLeases.status,
      })
      .from(rentalLeases)
      .where(
        and(
          eq(rentalLeases.status, "active"),
          isNotNull(rentalLeases.endDate),
          gte(rentalLeases.endDate, todayIso),
          lte(rentalLeases.endDate, horizonIso),
        ),
      );
    result.scanned = rows.length;
    findings = classifyExpiringLeases(rows as ScannedLeaseRow[], now);
  } catch (err) {
    result.errors += 1;
    logger.warn(
      "[leaseExpiryDetector] leases read failed; scan degraded to none",
      err instanceof Error ? err : undefined,
    );
    return result;
  }

  result.inWindow = findings.length;

  // Ledger dedupe: the mesh itself is the record of what was already published.
  // A finding whose dedupeKey exists on the channel is old news. Same mechanism
  // as notePaymentDueDetector — no new migration.
  let alreadyPublished = new Set<string>();
  if (findings.length > 0) {
    try {
      const keys = findings.map((f) => f.dedupeKey);
      const existing = await db
        .select({ key: sql<string>`${eventMeshEvents.payload} ->> 'dedupeKey'` })
        .from(eventMeshEvents)
        .where(
          and(
            eq(eventMeshEvents.channel, LEASE_EXPIRY_CHANNEL),
            sql`${eventMeshEvents.payload} ->> 'dedupeKey' IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
          ),
        );
      alreadyPublished = new Set(existing.map((r) => r.key));
    } catch (err) {
      result.errors += 1;
      // Fail CLOSED on publishing (skip all) rather than risk re-emitting the
      // same lease events every day the ledger read is broken.
      alreadyPublished = new Set(findings.map((f) => f.dedupeKey));
      logger.warn(
        "[leaseExpiryDetector] dedupe ledger read failed; skipping event publish this run",
        err instanceof Error ? err : undefined,
      );
    }
  }

  for (const f of selectNewFindings(findings, alreadyPublished)) {
    try {
      await eventMeshPublisher.publish(
        LEASE_EXPIRY_CHANNEL,
        "lease:expiring_soon",
        {
          leaseId: f.leaseId,
          endDate: f.endDate,
          daysUntilEnd: f.daysUntilEnd,
          dedupeKey: f.dedupeKey,
        },
        {
          publisher: "lease-expiry-detector",
          // Routine visibility (not a page): a renewal decision is planned work,
          // not an alert. Stays below the notification-router's ≤3 threshold.
          priority: 4,
          orgId: f.orgId,
        },
      );
      result.published += 1;

      // The mesh event is now the ledger entry that makes this finding "old
      // news" on every later run, so emitting BOTH lease events here — after a
      // SUCCESSFUL publish — gives exactly one pair per (lease, end-date). A
      // publish failure skips the emit so the next run retries both together.
      const ctx = await resolveLeaseContext(f.row);
      emitLeaseExpiryEvents(ctx);
      result.emitted += 1;
    } catch (err) {
      result.errors += 1;
      logger.warn(
        `[leaseExpiryDetector] publish/emit failed for ${f.dedupeKey} (swallowed)`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return result;
}
