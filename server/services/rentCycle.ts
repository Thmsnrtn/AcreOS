/**
 * The daily rent cycle (P3-3, decided 2026-11-16) — the scheduler half of
 * rent collection, plus its late-rent trigger.
 *
 * Two halves, one daily job (`rent_cycle_daily`, 09:00 UTC):
 *
 *   1. CHARGE GENERATION. `rentChargeGenerator.generateScheduledCharges` has
 *      existed as an operator-triggered action: a landlord who never pressed
 *      "generate scheduled" had an EMPTY rent_charges table, so every arrears
 *      number computed over rent that was owed and never recorded. This cycle
 *      runs it for every org with a generatable lease, through today.
 *      Generation is idempotent twice over (the planner subtracts periods
 *      already on the ledger; the insert is ON CONFLICT DO NOTHING), so a
 *      rerun — or the operator ALSO pressing the button — posts nothing twice.
 *
 *   2. LATE-RENT TRIGGER. A charge whose due date has passed (beyond its
 *      grace) with a balance still owed is a fact nobody was told: the
 *      late-fee engine only ever PROPOSED a fee for an operator to confirm,
 *      and nothing fired when rent simply didn't arrive. This scan turns it
 *      into a signal on the existing rails, mirroring notePaymentDueDetector /
 *      leaseExpiryDetector exactly:
 *        (a) one mesh event per NEW finding on the `rent:late` channel,
 *            deduped by a deterministic key (charge + due date) checked
 *            against the mesh's own ledger — a rerun never re-publishes;
 *            priority 3, so it crosses the notification-router's ≤3 dispatch
 *            threshold (money that didn't arrive is worth a notification);
 *        (b) after a successful publish, the charge's legalPosture flips
 *            ok → late (a charge already under notice/eviction keeps its
 *            stronger posture — the trigger never weakens one).
 *
 *      The trigger does NOT charge a late fee. Fees stay what they have
 *      always been in this vertical: a statutory proposal an operator
 *      confirms (routes-rent-ledger late-fee endpoints). The trigger is the
 *      signal; the fee is a separate, human-confirmed act.
 *
 * Grace: the lease's own `lateFeeGraceDays` when the lease states one, else
 * the state rule's `graceDays` (late_fee_rules), else 0 — the conservative
 * reading, the same order the note book applies to its grace.
 */

import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { eventMeshEvents, lateFeeRules, rentalLeases, rentCharges } from "@shared/schema";
import { GENERATABLE_LEASE_STATUSES } from "@shared/rental/leaseActivation";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { logger } from "../utils/logger";
import { eventMeshPublisher } from "./eventMeshPublisher";
import { generateScheduledCharges } from "./rental/rentChargeGenerator";
import { outstandingCentsForCharge } from "./rental/rentCollection";
import { clock } from "../utils/clock";

export const RENT_LATE_CHANNEL = "rent:late";

const DAY_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
// Pure classification — the late-rent decision, testable without a database
// ───────────────────────────────────────────────────────────────────────────

export interface LateRentChargeRow {
  id: string;
  organizationId: number;
  leaseId: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  amountCents: number;
  lateFeeCents: number;
  paidCents: number;
  /** Stored balance cache — carried for the payload; the DECISION derives. */
  balanceCents: number;
  legalPosture: string;
  /** The lease's own stated grace (commercial terms), or null. */
  leaseGraceDays: number | null;
  /** The state rule's grace for the lease's state, or null when unseeded. */
  stateGraceDays: number | null;
}

export interface LateRentFinding {
  chargeId: string;
  orgId: number;
  leaseId: string;
  /** Due date as YYYY-MM-DD — part of the idempotency key. */
  dueDate: string;
  /** Whole days the charge is past due (before grace is applied). */
  daysPastDue: number;
  /** Grace applied to this charge (lease's own, else state rule, else 0). */
  graceDays: number;
  /** Derived outstanding (amount + lateFee − paid), never the stored cache. */
  outstandingCents: number;
  /** Deterministic idempotency key: same charge + due date never fires twice. */
  dedupeKey: string;
  row: LateRentChargeRow;
}

/**
 * A charge is LATE when it still owes money (derived), its due date is
 * strictly before today (a charge is not late on its own due day), and the
 * days past due exceed its grace. Deterministic + total — `now` is an
 * argument so the rule is testable without a clock or a database.
 */
export function classifyLateRentCharges(
  rows: LateRentChargeRow[],
  now: Date,
): LateRentFinding[] {
  const todayMs = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  const findings: LateRentFinding[] = [];
  for (const row of rows) {
    const outstandingCents = outstandingCentsForCharge(row);
    if (outstandingCents <= 0) continue; // paid (or never owed) — not late
    const dueDate = String(row.dueDate).slice(0, 10);
    const dueMs = new Date(`${dueDate}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(dueMs)) continue;
    const daysPastDue = Math.floor((todayMs - dueMs) / DAY_MS);
    if (daysPastDue <= 0) continue; // due today or later — not late yet
    const graceDays = row.leaseGraceDays ?? row.stateGraceDays ?? 0;
    if (daysPastDue <= graceDays) continue; // past due, inside grace
    findings.push({
      chargeId: row.id,
      orgId: row.organizationId,
      leaseId: row.leaseId,
      dueDate,
      daysPastDue,
      graceDays,
      outstandingCents,
      dedupeKey: `rent-late:${row.id}:${dueDate}`,
      row,
    });
  }
  return findings;
}

/** Findings whose dedupe key has NOT already been published. Pure. */
export function selectNewLateFindings(
  findings: LateRentFinding[],
  alreadyPublished: ReadonlySet<string>,
): LateRentFinding[] {
  return findings.filter((f) => !alreadyPublished.has(f.dedupeKey));
}

// ───────────────────────────────────────────────────────────────────────────
// The daily cycle
// ───────────────────────────────────────────────────────────────────────────

export interface RentCycleResult {
  orgsGenerated: number;
  chargesInserted: number;
  lateScanned: number;
  lateFindings: number;
  latePublished: number;
  posturesFlipped: number;
  errors: number;
}

export async function runRentCycle(now: Date = clock.now()): Promise<RentCycleResult> {
  const result: RentCycleResult = {
    orgsGenerated: 0,
    chargesInserted: 0,
    lateScanned: 0,
    lateFindings: 0,
    latePublished: 0,
    posturesFlipped: 0,
    errors: 0,
  };
  const todayIso = now.toISOString().slice(0, 10);

  // ── Half 1: scheduled charge generation, per org ──────────────────────
  // PLATFORM SWEEP, said out loud: a scheduled job that must touch every
  // org's leases in one pass. Per-org generation keeps each org's writes
  // inside generateScheduledCharges' own org predicate.
  try {
    const orgRows = await unscopedForPlatformOps(
      "rent cycle charge generation: a scheduled platform job that lists every organization holding a generatable lease so it can generate that org's scheduled rent charges",
    )
      .selectDistinct({ organizationId: rentalLeases.organizationId })
      .from(rentalLeases)
      .where(inArray(rentalLeases.status, [...GENERATABLE_LEASE_STATUSES]));
    for (const { organizationId } of orgRows) {
      try {
        const gen = await generateScheduledCharges({ organizationId, throughDate: todayIso });
        result.orgsGenerated += 1;
        result.chargesInserted += gen.inserted;
      } catch (err) {
        result.errors += 1;
        logger.warn(
          `[rentCycle] charge generation failed for org ${organizationId} (swallowed)`,
          err instanceof Error ? err : undefined,
        );
      }
    }
  } catch (err) {
    result.errors += 1;
    logger.warn(
      "[rentCycle] org listing failed; generation degraded to none",
      err instanceof Error ? err : undefined,
    );
  }

  // ── Half 2: the late-rent trigger ─────────────────────────────────────
  let findings: LateRentFinding[] = [];
  try {
    const chargeRows = await unscopedForPlatformOps(
      "rent cycle late scan: a scheduled platform job that scans every organization's open rent charges past their due date and publishes one per-org mesh event per new late finding",
    )
      .select({
        id: rentCharges.id,
        organizationId: rentCharges.organizationId,
        leaseId: rentCharges.leaseId,
        dueDate: rentCharges.dueDate,
        amountCents: rentCharges.amountCents,
        lateFeeCents: rentCharges.lateFeeCents,
        paidCents: rentCharges.paidCents,
        balanceCents: rentCharges.balanceCents,
        legalPosture: rentCharges.legalPosture,
        leaseGraceDays: rentalLeases.lateFeeGraceDays,
        leaseState: rentalLeases.state,
      })
      .from(rentCharges)
      .innerJoin(rentalLeases, eq(rentCharges.leaseId, rentalLeases.id))
      .where(
        and(
          gt(rentCharges.balanceCents, 0),
          lt(rentCharges.dueDate, todayIso),
          eq(rentalLeases.status, "active"),
        ),
      );
    result.lateScanned = chargeRows.length;

    const rules = await db.select().from(lateFeeRules);
    const graceByState = new Map(rules.map((r) => [r.state.toUpperCase(), r.graceDays]));

    findings = classifyLateRentCharges(
      chargeRows.map((c) => ({
        ...c,
        dueDate: String(c.dueDate).slice(0, 10),
        stateGraceDays: graceByState.get(String(c.leaseState).toUpperCase()) ?? null,
      })),
      now,
    );
  } catch (err) {
    result.errors += 1;
    logger.warn(
      "[rentCycle] late scan read failed; trigger degraded to none",
      err instanceof Error ? err : undefined,
    );
    return result;
  }

  result.lateFindings = findings.length;

  // Ledger dedupe: the mesh itself is the record of what already fired. The
  // keys embed the globally-unique charge uuid, so this cross-org read can
  // only match keys the caller already holds (same proof as leaseExpiry).
  let alreadyPublished = new Set<string>();
  if (findings.length > 0) {
    try {
      const keys = findings.map((f) => f.dedupeKey);
      const existing = await unscopedForPlatformOps(
        "rent late dedupe ledger: matches globally-unique charge-id keys the caller already holds against the mesh channel, returning only those keys",
      )
        .select({ key: sql<string>`${eventMeshEvents.payload} ->> 'dedupeKey'` })
        .from(eventMeshEvents)
        .where(
          and(
            eq(eventMeshEvents.channel, RENT_LATE_CHANNEL),
            sql`${eventMeshEvents.payload} ->> 'dedupeKey' IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
          ),
        );
      alreadyPublished = new Set(existing.map((r) => r.key));
    } catch (err) {
      result.errors += 1;
      // Fail CLOSED on publishing rather than re-firing every day the
      // ledger read is broken.
      alreadyPublished = new Set(findings.map((f) => f.dedupeKey));
      logger.warn(
        "[rentCycle] dedupe ledger read failed; skipping late publish this run",
        err instanceof Error ? err : undefined,
      );
    }
  }

  for (const f of selectNewLateFindings(findings, alreadyPublished)) {
    try {
      await eventMeshPublisher.publish(
        RENT_LATE_CHANNEL,
        "rent:late",
        {
          chargeId: f.chargeId,
          leaseId: f.leaseId,
          dueDate: f.dueDate,
          daysPastDue: f.daysPastDue,
          graceDays: f.graceDays,
          outstandingCents: f.outstandingCents,
          dedupeKey: f.dedupeKey,
        },
        {
          publisher: "rent-cycle",
          // Money that didn't arrive is worth a notification — priority 3
          // crosses the notification-router's ≤3 dispatch threshold, the
          // same call notePaymentDueDetector makes for an overdue borrower.
          priority: 3,
          orgId: f.orgId,
        },
      );
      result.latePublished += 1;

      // The visible ledger state, flipped only after a successful publish
      // (so a publish failure retries both together next run) and only from
      // `ok` — a stronger posture (notice served, eviction filed) is never
      // weakened by the trigger.
      if (f.row.legalPosture === "ok") {
        const flipped = await db
          .update(rentCharges)
          .set({ legalPosture: "late", legalPostureAt: now, updatedAt: now })
          .where(
            and(
              eq(rentCharges.id, f.chargeId),
              eq(rentCharges.organizationId, f.orgId),
              eq(rentCharges.legalPosture, "ok"),
            ),
          )
          .returning({ id: rentCharges.id });
        result.posturesFlipped += flipped.length;
      }
    } catch (err) {
      result.errors += 1;
      logger.warn(
        `[rentCycle] late publish failed for ${f.dedupeKey} (swallowed)`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  logger.info("[rentCycle] daily rent cycle complete", { metadata: { ...result, throughDate: todayIso } });
  return result;
}
