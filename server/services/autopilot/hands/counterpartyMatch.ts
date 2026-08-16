/**
 * Is this address one of a CUSTOMER'S counterparties?
 *
 * Extracted from send-email.ts so the hand and its tests import the guard from
 * ONE place. It lived in the hand exported purely so the test could reach it,
 * which the reachability gate correctly counts as an export with no consumer
 * outside its defining module — the "exists only for its test" shape. A module
 * with a real importer is the honest fix; an allowlist entry would only have
 * recorded the smell.
 *
 * Founder ruling 2026-08-16 ("Autopilot is system-only"): the autopilot may
 * only ever mail AcreOS's own users. This is the guard that makes that a
 * property of the code rather than of the plays that happen to call it today.
 */
import { sql } from "drizzle-orm";
import { db } from "../../../db";
import {
  leads,
  borrowerPaymentProfiles,
  borrowerSessions,
  autopayEnrollments,
  buyerReservations,
} from "@shared/schema";

/** Human-readable identification of the counterparty record an address hit. */
export interface CounterpartyHit {
  /** Which relationship the address belongs to — named in the refusal. */
  kind: string;
  /** The owning customer org, when the record carries one. */
  organizationId: number | null;
  /** The matched row's primary key, so the founder can go look at it. */
  recordId: number;
}

/**
 * Resolve `email` against every table that stores a CUSTOMER'S COUNTERPARTY
 * address. Returns the first hit, or null when the address belongs to no
 * counterparty of record.
 *
 * Coverage — "lead / borrower / buyer / seller" in this schema:
 *   - `leads`                    the seller/buyer/borrower of record. Notes hang
 *                                off it (notes.borrowerId → leads.id) and so do
 *                                buyer reservations (buyerReservations.buyerId),
 *                                so this one table covers all four roles for any
 *                                counterparty that was ever a lead.
 *   - `borrowerPaymentProfiles`  borrower contact used for payment notifications.
 *   - `borrowerSessions`         borrower portal identity.
 *   - `autopayEnrollments`       borrower enrolled in autopay.
 *   - `buyerReservations`        buyer who reserved a property without a lead row.
 *
 * The comparison is `lower(column) = lower(input)` rather than an equality that
 * could use `leads_email_idx`. That is a deliberate cost/correctness trade: a
 * hard stop that a single capital letter defeats is not a hard stop. These five
 * lookups run in parallel and only ever run on a WITNESSED send — a human taps
 * Approve for each one — so the volume this scans at is a handful of sends, not a
 * campaign. If autopilot volume ever stops being human-paced, add `lower(email)`
 * expression indexes before relaxing the comparison.
 *
 * Cross-org by design: the question is not "is this address a counterparty of the
 * org named in the call", it is "is this address ANY customer's counterparty
 * anywhere in AcreOS". Scoping the check to `organization_id` would let a caller
 * walk straight through it by omitting or misstating the org.
 *
 * Throws on lookup failure. The caller must treat a throw as a refusal — see the
 * fail-closed note at the call site.
 */
export async function counterpartyMatch(email: string): Promise<CounterpartyHit | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;

  const [lead, payProfile, session, autopay, reservation] = await Promise.all([
    db
      .select({ id: leads.id, organizationId: leads.organizationId })
      .from(leads)
      .where(sql`lower(${leads.email}) = ${needle}`)
      .limit(1),
    db
      .select({ id: borrowerPaymentProfiles.id, organizationId: borrowerPaymentProfiles.organizationId })
      .from(borrowerPaymentProfiles)
      .where(sql`lower(${borrowerPaymentProfiles.email}) = ${needle}`)
      .limit(1),
    db
      .select({ id: borrowerSessions.id, organizationId: borrowerSessions.organizationId })
      .from(borrowerSessions)
      .where(sql`lower(${borrowerSessions.email}) = ${needle}`)
      .limit(1),
    db
      .select({ id: autopayEnrollments.id, organizationId: autopayEnrollments.organizationId })
      .from(autopayEnrollments)
      .where(sql`lower(${autopayEnrollments.borrowerEmail}) = ${needle}`)
      .limit(1),
    db
      .select({ id: buyerReservations.id, organizationId: buyerReservations.organizationId })
      .from(buyerReservations)
      .where(sql`lower(${buyerReservations.buyerEmail}) = ${needle}`)
      .limit(1),
  ]);

  // Any row returned is a hit. We deliberately do NOT re-verify the row's email
  // in JS: if the WHERE clause were ever wrong, re-verification would turn a
  // broken guard into a silently PASSING one. A row we cannot explain is still a
  // reason to stop.
  const candidates: Array<[string, { id: number; organizationId: number | null }[]]> = [
    ["lead / seller / buyer / borrower (leads)", lead],
    ["borrower payment profile", payProfile],
    ["borrower portal session", session],
    ["borrower autopay enrollment", autopay],
    ["buyer reservation", reservation],
  ];
  for (const [kind, rows] of candidates) {
    const row = rows[0];
    if (row) {
      return { kind, organizationId: row.organizationId ?? null, recordId: row.id };
    }
  }
  return null;
}
