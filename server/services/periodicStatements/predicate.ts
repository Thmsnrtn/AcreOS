/**
 * §1026.41 predicate — gates whether AcreOS owes a periodic statement
 * for a given loan in a given cycle.
 *
 * Implements Beatrice's 2026-06-02 ruling
 * (docs/legal/acquired-notes-1026-41-ruling.md). The duty under §1026.41
 * attaches to the SERVICER, not the holder. The predicate enforces that
 * distinction — and persists the §-citation that authorised every decision.
 *
 * Two flows, one predicate:
 *
 *  - ORIGINATED notes (`shared/schema.notes`): AcreOS's seller-financed
 *    land flow. By construction the org is the servicer (no third-party
 *    servicing exists yet for this vertical). Generate unless explicitly
 *    opted out — currently no opt-out surface, so always qualifies.
 *
 *  - ACQUIRED notes (`shared/schema/notes-vertical.acquiredNotes`): paper
 *    AcreOS purchased. Only generates when ALL FOUR of:
 *      isConsumerPurpose === true
 *      collateralIsDwelling === true
 *      servicingArrangement === 'self_serviced'
 *      Active noteOwnershipOfRecord row for the org (defensive double-check
 *      against drift between servicingArrangement column + ownership rows).
 *
 * Return contract: { qualifies, skipReason?, citation? }. When qualifies
 * is false, BOTH skipReason and citation MUST be populated — the audit
 * ledger writes them as-is, and a silent skip is examiner-readable
 * negligence (Beatrice §4).
 *
 * State-overlay note: §6 of the ruling enumerates 6 state-overlay flags
 * (CA / NY / TX / IL / MN / OK). Those are Beatrice's domain and NOT
 * implemented here — see the TODO callout at the bottom. A federal "skip"
 * may still need to generate under state rules; the state matrix runs
 * AFTER federal in a follow-up patch.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { acquiredNotes, noteOwnershipOfRecord, type AcquiredNote } from "@shared/schema/notes-vertical";
import type { notes } from "@shared/schema";

// The union shape the predicate accepts. We avoid `Note | AcquiredNote`
// because the two flows have very different row shapes; the discriminator
// is the `__kind` tag.
export type PredicateInputNote =
  | { kind: "note"; row: typeof notes.$inferSelect }
  | { kind: "acquired_note"; row: AcquiredNote };

export interface PredicateResult {
  qualifies: boolean;
  /** Plain-English reason a future Beatrice audit reads at a glance. */
  skipReason?: string;
  /** The §-section that authorised the decision. ALWAYS populated. */
  citation: string;
}

/**
 * Beatrice's predicate — synchronous fast-path checks first, then the
 * defensive ownership-of-record query for acquired notes.
 *
 * Multi-tenant safety: the ownership-of-record query is org-scoped via
 * the orgId parameter (organizationId on noteOwnershipOfRecord).
 */
export async function qualifiesForRegZStatement(
  input: PredicateInputNote,
  orgId: number,
): Promise<PredicateResult> {
  if (input.kind === "note") {
    // Originated notes: AcreOS is always the servicer for this vertical.
    // The §1026.41 attachment is the default state; no opt-out surface
    // exists yet (and per Beatrice's ruling, opt-out for an originated
    // dwelling-secured consumer loan is not constitutionally defensible).
    //
    // TODO(beatrice-state-overlay): when state overlay matrix lands, this
    // path is also where a state-level skip would attach (e.g. a non-
    // dwelling consumer loan in CA that still owes Cal. Civ. §2954).
    return {
      qualifies: true,
      citation: "12 C.F.R. §1026.41(a), §1026.41(b)",
    };
  }

  // ── Acquired-notes path — Beatrice's 4-gate decision tree ───────────
  const note = input.row;

  // Gate 1: §1026.3(a) consumer-purpose scope.
  if (!note.isConsumerPurpose) {
    return {
      qualifies: false,
      skipReason: "business-purpose loan — out of Reg-Z scope",
      citation: "12 C.F.R. §1026.3(a)",
    };
  }

  // Gate 2: §1026.41(a) / §1026.2(a)(19) dwelling-secured trigger.
  if (!note.collateralIsDwelling) {
    return {
      qualifies: false,
      skipReason:
        "collateral is not a dwelling — out of federal §1026.41 scope (state overlay may still apply)",
      citation: "12 C.F.R. §1026.2(a)(19), §1026.41(a)",
    };
  }

  // Gate 3: §1026.36(a)(4) / §1024.2(b) servicer-of-record. Duty attaches
  // to the SERVICER, not the holder. Any non-self_serviced arrangement
  // delegates the §1026.41 duty elsewhere.
  if (note.servicingArrangement !== "self_serviced") {
    return {
      qualifies: false,
      skipReason: `servicing arrangement '${note.servicingArrangement}' delegates duty to another party`,
      citation: "12 C.F.R. §1026.36(a)(4), 12 C.F.R. §1024.2(b)",
    };
  }

  // Gate 4: defensive double-check. The ownership-of-record table is the
  // authoritative record of WHO services this note. If `servicingArrangement`
  // says 'self_serviced' but no active ownership row exists, the column has
  // drifted from the underlying paperwork — refuse to generate until that's
  // reconciled. Beatrice §8 adversarial defense #1.
  const activeOwnership = await db
    .select({ id: noteOwnershipOfRecord.id })
    .from(noteOwnershipOfRecord)
    .where(
      and(
        eq(noteOwnershipOfRecord.noteId, note.id),
        eq(noteOwnershipOfRecord.organizationId, orgId),
        isNull(noteOwnershipOfRecord.supersededAt),
      ),
    )
    .limit(1);

  if (activeOwnership.length === 0) {
    return {
      qualifies: false,
      skipReason:
        "no active note_ownership_of_record row for this org — cannot confirm servicer-of-record",
      citation: "12 C.F.R. §1026.36(a)(4)",
    };
  }

  return {
    qualifies: true,
    citation: "12 C.F.R. §1026.41(a), §1026.41(b)",
  };
}

/**
 * Pure-function variant of the predicate — exposes the synchronous gates
 * without the DB-backed defensive check. Used by unit tests + by callers
 * that have already loaded the ownership row separately. The async
 * `qualifiesForRegZStatement` above is the canonical entry point.
 *
 * The DB-backed gate (Gate 4) is intentionally absent here — a caller
 * using this pure variant is taking on the responsibility of confirming
 * the ownership row independently.
 */
export function qualifiesForRegZStatementSync(
  input: PredicateInputNote,
): PredicateResult {
  if (input.kind === "note") {
    return {
      qualifies: true,
      citation: "12 C.F.R. §1026.41(a), §1026.41(b)",
    };
  }

  const note = input.row;
  if (!note.isConsumerPurpose) {
    return {
      qualifies: false,
      skipReason: "business-purpose loan — out of Reg-Z scope",
      citation: "12 C.F.R. §1026.3(a)",
    };
  }
  if (!note.collateralIsDwelling) {
    return {
      qualifies: false,
      skipReason:
        "collateral is not a dwelling — out of federal §1026.41 scope (state overlay may still apply)",
      citation: "12 C.F.R. §1026.2(a)(19), §1026.41(a)",
    };
  }
  if (note.servicingArrangement !== "self_serviced") {
    return {
      qualifies: false,
      skipReason: `servicing arrangement '${note.servicingArrangement}' delegates duty to another party`,
      citation: "12 C.F.R. §1026.36(a)(4), 12 C.F.R. §1024.2(b)",
    };
  }
  return {
    qualifies: true,
    citation: "12 C.F.R. §1026.41(a), §1026.41(b)",
  };
}

// Re-export for callers that want to identify acquired notes inline:
export { acquiredNotes };
