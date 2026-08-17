/**
 * OpportunityStore — persistence for the Reality Graph's Opportunity.
 *
 * An Opportunity is a POTENTIAL action on a parcel, held before commitment.
 * `deals` already owns the transaction process that begins AFTER commitment;
 * this is the half that had nowhere to live, and its absence was not merely
 * untidy — it was a live cross-entity defect:
 *
 *   `shared/economics/scenario.ts` and `shared/decisions/snapshot.ts` both
 *   declare an `opportunity` subject type, so two already-canonical tables
 *   accepted a subject id that pointed at no table at all. Faced with an
 *   `opportunity` subject, `decisions/decisionStore.ts` resolved the id AS a
 *   `properties.id` — so a decision recorded against opportunity #5 froze
 *   PROPERTY #5's evidence. Two unrelated entities, one id space, no error.
 *
 * This module is the read side that makes the subject real. It deliberately
 * exposes no update to `organizationId` and no delete: an opportunity is
 * referenced by decisions and outcomes that must stay legible afterwards.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  opportunities,
  parcelRefColumns,
  type OpportunityKind,
  type OpportunityOrigin,
  type OpportunityRow,
  type OpportunityStatus,
} from "@shared/schema";
import { type ParcelRef } from "@shared/parcel/parcelRef";
import { logger } from "../utils/logger";

/** A subject with more open opportunities than this has a runaway writer. */
const OPPORTUNITY_READ_CAP = 500;

/**
 * Raised when a caller references an opportunity this organization cannot use.
 *
 * THE MESSAGE NAMES NO IDS AND DRAWS NO DISTINCTION, deliberately — the same
 * rule `UnavailableScenarioError` follows. "Belongs to another tenant" and
 * "does not exist" must be indistinguishable from outside, or the error becomes
 * an oracle for probing which sequential ids are real.
 */
export class UnavailableOpportunityError extends Error {
  constructor() {
    super(
      "The referenced opportunity is not available in this organization. A " +
        "record must not be written against an opportunity it cannot actually " +
        "cite — correct the reference and retry.",
    );
    this.name = "UnavailableOpportunityError";
  }
}

/**
 * Read one opportunity, scoped to its organization.
 *
 * MODULE-PRIVATE on purpose. It reads naturally as a public accessor, and it
 * had no caller outside this file — the shape the reachability gate calls
 * "built but unwired". Exporting an API because it seems like one people will
 * want is how this codebase accumulated 1,400 unreached exports; when something
 * genuinely needs a non-throwing existence check, export it THEN, with its
 * consumer in the same commit.
 *
 * `requireOpportunity` below is the exported surface: callers about to freeze a
 * durable reference must not be able to silently skip an unreadable id.
 */
async function getOpportunity(
  organizationId: number,
  opportunityId: number,
): Promise<OpportunityRow | null> {
  const [row] = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, opportunityId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Read one opportunity or REFUSE.
 *
 * Used at the points where something durable is about to reference it. The
 * org-scoped predicate already makes a foreign row unreadable; what this adds
 * is that an unreadable row stops the write instead of being quietly dropped.
 */
export async function requireOpportunity(
  organizationId: number,
  opportunityId: number,
): Promise<OpportunityRow> {
  const row = await getOpportunity(organizationId, opportunityId);
  if (!row) throw new UnavailableOpportunityError();
  return row;
}

/**
 * Every opportunity on one parcel — the BI93 read.
 *
 * Takes a `ParcelRef`, not three strings, so a caller cannot reach this table
 * without having gone through `normalizeParcelRef`. Two rows differing only in
 * `strategy` are two simultaneous evaluations of the same land, which is the
 * thing `properties.status` could never express.
 */
export async function opportunitiesForParcel(
  organizationId: number,
  ref: ParcelRef,
): Promise<OpportunityRow[]> {
  const cols = parcelRefColumns(ref);
  return db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.parcelState, cols.parcelState),
        eq(opportunities.parcelCounty, cols.parcelCounty),
        eq(opportunities.parcelApn, cols.parcelApn),
      ),
    )
    .orderBy(desc(opportunities.openedAt))
    .limit(OPPORTUNITY_READ_CAP);
}

export interface CreateOpportunityInput {
  organizationId: number;
  /** Already normalised — the type is the enforcement. */
  parcel: ParcelRef;
  kind: OpportunityKind;
  /** NULL until chosen. Never defaulted: a default would fabricate an intent. */
  strategy?: string | null;
  originType: OpportunityOrigin;
  originRef?: string | null;
}

/**
 * Open an opportunity.
 *
 * No duplicate check, deliberately. (org, parcel, kind, strategy) looks like
 * the natural uniqueness rule, but `strategy` is nullable and two "not yet
 * chosen" evaluations of one parcel are a legitimate state that BI93 exists to
 * permit. Callers that need at-most-one should consult
 * `opportunitiesForParcel` and decide with their own rule, in the open.
 */
export async function createOpportunity(
  input: CreateOpportunityInput,
): Promise<OpportunityRow> {
  const [row] = await db
    .insert(opportunities)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      strategy: input.strategy ?? null,
      ...parcelRefColumns(input.parcel),
      originType: input.originType,
      originRef: input.originRef ?? null,
    })
    .returning();
  if (!row) {
    // An insert that returns nothing is not a success with an empty result —
    // it means the row is not there, and returning a fabricated shape would
    // hand the caller an id that references nothing.
    throw new Error("createOpportunity: insert returned no row");
  }
  logger.info("[Opportunity] opened", {
    metadata: {
      organizationId: input.organizationId,
      opportunityId: row.id,
      kind: input.kind,
      __pii_safe: true,
    },
  });
  return row;
}

/**
 * Close an opportunity, or mark it converted.
 *
 * `status` carries only lifecycle. "passed" and "won" are DECISIONS and live in
 * `decision_snapshots`; restating them here would give one judgement two owners
 * (canonical law 8) and let the two disagree.
 */
export async function closeOpportunity(
  organizationId: number,
  opportunityId: number,
  status: Extract<OpportunityStatus, "converted" | "closed">,
): Promise<OpportunityRow> {
  // Existence and tenancy first, so a miss refuses instead of silently
  // updating zero rows and reporting success.
  await requireOpportunity(organizationId, opportunityId);
  const now = new Date();
  const [row] = await db
    .update(opportunities)
    .set({ status, closedAt: now, updatedAt: now })
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, opportunityId),
      ),
    )
    .returning();
  if (!row) throw new UnavailableOpportunityError();
  return row;
}
