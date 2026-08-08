// ---------------------------------------------------------------------------
// Creative-finance note workflow-event emitter (audit Wave 1, beta→core).
//
// `emitNoteEvent` has lived in the workflow engine but had ZERO call sites, so
// note.balloon_approaching's two templates a customer installed
// (tpl_balloon_approaching / tpl_note_balloon_approaching_extended) sat idle
// forever — the balloon lane, the hallmark of wrap / owner-carry paper, was
// dead. This module is the ONE seam a serviced note goes through to make
// `note.balloon_approaching` real. The emit site is the EXISTING daily
// notePaymentDueDetector scan (server/services/notePaymentDueDetector.ts, folded
// in — no new job), which already walks the notes table for due dates; it now
// also finds notes ~90 days from maturity with a positive balance and calls
// emitNoteBalloonApproaching once per new (note, maturityDate), deduped against
// the mesh ledger.
//
// Sibling of rentalEvents.ts / certificateEvents.ts; same rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail the detector scan.
//      emitNoteBalloonApproaching swallows its own errors and never throws.
//   2. NO FABRICATION. The payload carries ONLY columns the note row genuinely
//      holds plus the borrower resolved from a real join (notes.borrowerId →
//      leads). CRITICALLY, the money field is the note's current
//      `outstandingBalance` (notes.currentBalance) — labelled as the APPROXIMATE
//      outstanding / residual balance, NEVER a precise "balloon payment amount".
//      The exact balloon figure lives in the amortization schedule, so
//      currentBalance is honest only as an approximate outstanding figure; the
//      two templates were corrected in the same change to drop the fabricated
//      {{balloonAmount}} for {{outstandingBalance}}. A null borrower email
//      suppresses the send_email recipient honestly (an unlinked note has no
//      borrower to email); a note with no linked borrower emits name/email as
//      null, never invented.
//   3. SELF-GUARDING. emitNoteBalloonApproaching fires ONLY for a note that is
//      genuinely in the balloon window — status "active", a non-null
//      maturityDate whose whole-day distance from today is within [0, 90], and a
//      positive currentBalance. Any other row is an honest no-op (no emit). The
//      detector's SQL pre-filters to the same window; this guard makes the
//      emitter independently correct and testable.
//
// entityType/entityId: a note's numeric handle is its propertyId when a parcel
// is attached (notes.propertyId → properties.id, nullable), else the note's own
// numeric id (notes.id is a serial — always a real number). emitNoteEvent uses
// entityType "note" and entityId = propertyId ?? id; the note id + template
// fields ride in `data`.
//
// When this emit call site is added, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts
// DERIVES the live set from these call sites and pins both directions.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { leads, organizations } from "@shared/schema";
import { emitNoteEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/** The balloon window: a note whose maturity is within the next 90 days (and
 * not already past) is "approaching". Deliberately the whole ≤90-day band rather
 * than an exact-90 match, so a daily scan never misses a note and the
 * per-(note, maturityDate) dedupe guarantees a single firing. */
export const BALLOON_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The slice of a `notes` row the balloon emitter needs. Real columns only. */
export interface NoteBalloonRow {
  /** notes.id — a serial (numeric); the entity handle fallback + the {{noteId}}. */
  id: number;
  organizationId: number;
  /** notes.propertyId — nullable; the numeric entity handle when attached. */
  propertyId: number | null;
  /** notes.borrowerId → leads.id — nullable (unlinked note has no borrower). */
  borrowerId: number | null;
  /** notes.status — only "active" notes are in the balloon lane. */
  status: string;
  /** notes.maturityDate — the balloon date; null (never set) → no signal. */
  maturityDate: Date | null;
  /** notes.currentBalance — a dollar numeric (string). Approximate outstanding. */
  currentBalance: string | number | null;
}

/** A dollar numeric column → a number, or null when genuinely absent / unparsable.
 * NOT a cents conversion: notes.currentBalance is already stored in dollars. */
function dollars(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** UTC-midnight epoch ms for a Date (time-of-day never leaks into the day math). */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** maturityDate as YYYY-MM-DD (UTC) — the {{balloonDate}} placeholder. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure window guard. Returns the whole days from today to the note's maturity
 * when the note is genuinely in the balloon window (active, real maturityDate in
 * [0, windowDays], positive balance), else null (an honest no-op — no emit).
 * Deterministic + total; `now` is an argument so it is testable without a clock.
 */
function balloonDaysToMaturity(
  row: NoteBalloonRow,
  now: Date,
  windowDays: number = BALLOON_WINDOW_DAYS,
): number | null {
  if (row.status !== "active") return null; // only active notes balloon here
  if (!row.maturityDate) return null; // no maturity, no signal
  const maturityMs = utcMidnight(row.maturityDate);
  if (!Number.isFinite(maturityMs)) return null;
  const balance = dollars(row.currentBalance);
  if (balance == null || balance <= 0) return null; // nothing outstanding to balloon
  const days = Math.floor((maturityMs - utcMidnight(now)) / DAY_MS);
  if (days < 0) return null; // already matured — not "approaching"
  if (days > windowDays) return null; // not yet in the window
  return days;
}

/** The borrower (notes.borrowerId → leads), or null when unlinked / not found. */
async function resolveBorrower(
  organizationId: number,
  borrowerId: number,
): Promise<{ name: string; firstName: string; email: string | null } | null> {
  const [row] = await db
    .select({ firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
    .from(leads)
    .where(and(eq(leads.id, borrowerId), eq(leads.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return {
    name: `${row.firstName} ${row.lastName}`.trim(),
    firstName: row.firstName,
    email: row.email ?? null,
  };
}

/** The org's display name, or null. Rides the borrower-letter signature line. */
async function resolveOrgName(organizationId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * The note.balloon_approaching payload. Drives BOTH tpl_balloon_approaching and
 * tpl_note_balloon_approaching_extended — every placeholder either template
 * interpolates is bound here to a real field or null:
 *   noteId / borrowerName / borrowerFirstName / borrowerEmail / balloonDate /
 *   daysToBalloon / outstandingBalance / orgName.
 */
function buildBalloonPayload(
  row: NoteBalloonRow,
  daysToBalloon: number,
  borrower: { name: string; firstName: string; email: string | null } | null,
  orgName: string | null,
): Record<string, any> {
  return {
    noteId: row.id,
    borrowerName: borrower?.name ?? null,
    borrowerFirstName: borrower?.firstName ?? null,
    // Null suppresses the send_email recipient honestly — never a fabricated one.
    borrowerEmail: borrower?.email ?? null,
    balloonDate: row.maturityDate ? isoDay(row.maturityDate) : null,
    daysToBalloon,
    // Approximate current outstanding balance — NOT a precise balloon payoff
    // (that lives in the amortization schedule). Honest as an outstanding figure.
    outstandingBalance: dollars(row.currentBalance),
    orgName,
  };
}

/**
 * Emit note.balloon_approaching for a note ~90 days from maturity. Self-guarding
 * (see balloonDaysToMaturity — a note outside the window / non-active / with no
 * positive balance is an honest no-op) and fire-and-forget: resolves the
 * borrower + org off the scan path and never throws back into the detector.
 */
export function emitNoteBalloonApproaching(row: NoteBalloonRow, now: Date = new Date()): void {
  const daysToBalloon = balloonDaysToMaturity(row, now);
  if (daysToBalloon === null) return; // not in the balloon window — no signal
  void (async () => {
    const [borrower, orgName] = await Promise.all([
      row.borrowerId != null
        ? resolveBorrower(row.organizationId, row.borrowerId)
        : Promise.resolve(null),
      resolveOrgName(row.organizationId),
    ]);
    emitNoteEvent(
      "note.balloon_approaching",
      row.organizationId,
      row.propertyId ?? row.id,
      buildBalloonPayload(row, daysToBalloon, borrower, orgName),
    );
  })().catch((err) => {
    logger.warn(`[noteEvents] emit note.balloon_approaching failed for note ${row.id}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  });
}
