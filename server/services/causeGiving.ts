/**
 * Cause Giving — command layer (CG-1; spec §2 "tool-first, permissioned,
 * receipted"). The member UI (CG-2), founder console (CG-3), and quarter
 * engine (CG-4) are equal clients of these commands; CG-1 ships the layer
 * only — no HTTP routes, no client code.
 *
 * Every command:
 *   (a) refuses with CauseGivingDisabledError unless the `cause_giving`
 *       flag evaluates ON for the actor. The seeded state is 'off', which
 *       evaluateFlag resolves to false for EVERYONE, founder included —
 *       flag-OFF invisibility until Tom flips it per spec §5. A missing
 *       flag row also fails closed here (deliberately stricter than
 *       featureFlagService.isEnabled's founder provisioning bypass).
 *   (b) checks the actor's role: member commands act only on the actor's
 *       own selection/nomination; founder commands require isFounder.
 *   (c) returns a receipt and writes the append-only trail the schema
 *       provides (selection events; decided-by/at; recorded-by).
 *
 * Money posture: the program's only money is AcreOS's own. No command here
 * touches a member's funds. recordDisbursement writes the disbursement row
 * and, when a ledger writer is wired in (CG-4 owns the financial_ledger
 * bucket semantics for the `donation_disbursement` event), stamps
 * ledger_event_ref from it; CG-1 wires none, so the ref stays null until
 * CG-4 — named in the CG-1 PR body as the deviation-watch item.
 *
 * Snapshot stats (named limitation): in CG-1 both quarter snapshot stats
 * are computed over selection-holding members — payingMembersAtSnapshot is
 * the count of distinct paying members AMONG selection holders (or the
 * caller-supplied paying set), not a platform-wide billing census. CG-4's
 * engine refines this with billing truth.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  causeAllocations,
  causeCategories,
  causeDisbursements,
  causeGivingQuarters,
  causeNominations,
  causeQuarterSnapshots,
  causeReportCorrections,
  causeReportEntries,
  causes,
  causeVettingRecords,
  memberCauseSelectionEvents,
  memberCauseSelections,
  organizations,
} from "@shared/schema";
import {
  CAUSE_GIVING_FLAG_KEY,
  CAUSE_REMOVAL_TRIGGER_CODES,
  PROFIT_DEFINITION_VERSION,
  computeAllocations,
  computeQuarterPool,
  tallySnapshot,
  type AllocationDisposition,
  type CauseAgreementState,
  type CauseRemovalTriggerCode,
  type CauseStatus,
  type DisbursementMethod,
  type TallyRow,
  type VettingOutcome,
} from "@shared/cause-giving/rules";
import { evaluateFlag, featureFlagService } from "./featureFlags";
import { clock } from "../utils/clock";

// ── Errors (fail-closed, named) ─────────────────────────────────────────────

export class CauseGivingDisabledError extends Error {
  constructor() {
    super(
      `Cause Giving is disabled (flag '${CAUSE_GIVING_FLAG_KEY}' is not on for this actor)`,
    );
    this.name = "CauseGivingDisabledError";
  }
}

class CauseGivingForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauseGivingForbiddenError";
  }
}

class CauseGivingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauseGivingValidationError";
  }
}

class CauseGivingNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "CauseGivingNotFoundError";
  }
}

// ── Actor, receipt, dependencies ────────────────────────────────────────────

export interface CauseGivingActor {
  userId: string;
  organizationId?: number;
  isFounder: boolean;
  /** Subscription tier of the actor's org, for flag evaluation. */
  tier?: string;
}

export interface CauseGivingReceipt {
  receiptId: string;
  command: string;
  actorId: string;
  at: Date;
  refs: Record<string, string>;
}

export interface CauseGivingLedgerWriterArgs {
  disbursementId: string;
  allocationId: string;
  amountCents: number;
  actorId: string;
}

export interface CauseGivingDeps {
  db: typeof db;
  isEnabled: (actor: CauseGivingActor) => Promise<boolean>;
  now: () => Date;
  /** CG-4 wires the financial_ledger pairing; CG-1 leaves it unwired. */
  ledgerWriter?: (
    args: CauseGivingLedgerWriterArgs,
  ) => Promise<string>;
}

async function defaultIsEnabled(actor: CauseGivingActor): Promise<boolean> {
  const flag = await featureFlagService.getByKey(CAUSE_GIVING_FLAG_KEY);
  if (!flag) return false; // missing row fails closed — see header (a)
  return evaluateFlag(flag, {
    userId: actor.userId,
    tier: actor.tier,
    isFounder: actor.isFounder,
  });
}

const FC_CG_1_TREATMENT = "schedule-c-as-is";

export function createCauseGivingService(
  depsOverride?: Partial<CauseGivingDeps>,
) {
  const deps: CauseGivingDeps = {
    db,
    isEnabled: defaultIsEnabled,
    now: () => clock.now(),
    ...depsOverride,
  };

  async function requireEnabled(actor: CauseGivingActor): Promise<void> {
    if (!(await deps.isEnabled(actor))) throw new CauseGivingDisabledError();
  }

  function requireFounder(actor: CauseGivingActor): void {
    if (!actor.isFounder) {
      throw new CauseGivingForbiddenError("founder-only command");
    }
  }

  function requireMember(actor: CauseGivingActor): number {
    if (actor.organizationId == null) {
      throw new CauseGivingValidationError(
        "member commands require the actor's organization",
      );
    }
    return actor.organizationId;
  }

  function receipt(
    command: string,
    actor: CauseGivingActor,
    refs: Record<string, string>,
  ): CauseGivingReceipt {
    return {
      receiptId: `cg:${command}:${randomUUID()}`,
      command,
      actorId: actor.userId,
      at: deps.now(),
      refs,
    };
  }

  // ── Member commands ──────────────────────────────────────────────────────

  async function selectCause(
    actor: CauseGivingActor,
    args: { causeId: string },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    const organizationId = requireMember(actor);
    const [cause] = await deps.db
      .select()
      .from(causes)
      .where(eq(causes.id, args.causeId))
      .limit(1);
    if (!cause) throw new CauseGivingNotFoundError(`cause ${args.causeId}`);
    if (cause.status !== "ballot") {
      throw new CauseGivingValidationError(
        "members may select only causes on the live ballot",
      );
    }
    const now = deps.now();
    const selectionId = await deps.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(memberCauseSelections)
        .where(
          and(
            eq(memberCauseSelections.organizationId, organizationId),
            eq(memberCauseSelections.memberUserId, actor.userId),
          ),
        )
        .limit(1);
      let id: string;
      if (existing) {
        id = existing.id;
        if (existing.causeId !== args.causeId) {
          await tx
            .update(memberCauseSelections)
            .set({ causeId: args.causeId, setAt: now, updatedAt: now })
            .where(
              and(
                eq(memberCauseSelections.id, existing.id),
                eq(memberCauseSelections.organizationId, organizationId),
                eq(memberCauseSelections.memberUserId, actor.userId),
              ),
            );
        }
      } else {
        const [inserted] = await tx
          .insert(memberCauseSelections)
          .values({
            organizationId,
            memberUserId: actor.userId,
            causeId: args.causeId,
            setAt: now,
          })
          .returning();
        id = inserted.id;
      }
      if (!existing || existing.causeId !== args.causeId) {
        await tx.insert(memberCauseSelectionEvents).values({
          organizationId,
          memberUserId: actor.userId,
          fromCauseId: existing?.causeId ?? null,
          toCauseId: args.causeId,
        });
      }
      return id;
    });
    return receipt("selectCause", actor, {
      selectionId,
      causeId: args.causeId,
    });
  }

  async function nominateCause(
    actor: CauseGivingActor,
    args: {
      charityLegalName: string;
      ein?: string;
      website?: string;
      note?: string;
    },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    const organizationId = requireMember(actor);
    if (!args.charityLegalName.trim()) {
      throw new CauseGivingValidationError("charity legal name is required");
    }
    const [inserted] = await deps.db
      .insert(causeNominations)
      .values({
        organizationId,
        nominatorUserId: actor.userId,
        charityLegalName: args.charityLegalName.trim(),
        ein: args.ein ?? null,
        website: args.website ?? null,
        note: args.note ?? null,
        status: "pending",
      })
      .returning();
    return receipt("nominateCause", actor, { nominationId: inserted.id });
  }

  // ── Founder commands ─────────────────────────────────────────────────────

  async function decideNomination(
    actor: CauseGivingActor,
    args: {
      nominationId: string;
      /** The org the nomination belongs to — the tenancy pin on the fetch. */
      organizationId: number;
      decision: "approved" | "declined";
      declineReason?: string;
      categoryId?: string;
      /** Founder-confirmed EIN when creating a cause the nomination left EIN-less. */
      ein?: string;
    },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    if (args.decision === "declined" && !args.declineReason?.trim()) {
      throw new CauseGivingValidationError(
        "a declined nomination requires a decline reason",
      );
    }
    const now = deps.now();
    const refs = await deps.db.transaction(async (tx) => {
      const [nomination] = await tx
        .select()
        .from(causeNominations)
        .where(
          and(
            eq(causeNominations.id, args.nominationId),
            eq(causeNominations.organizationId, args.organizationId),
          ),
        )
        .limit(1);
      if (!nomination) {
        throw new CauseGivingNotFoundError(`nomination ${args.nominationId}`);
      }
      if (nomination.status !== "pending") {
        throw new CauseGivingValidationError(
          `nomination is already ${nomination.status}`,
        );
      }
      let resultingCauseId: string | null = null;
      if (args.decision === "approved") {
        const lookupEin = nomination.ein ?? args.ein;
        if (lookupEin) {
          const [existingCause] = await tx
            .select()
            .from(causes)
            .where(eq(causes.ein, lookupEin))
            .limit(1);
          if (existingCause) resultingCauseId = existingCause.id;
        }
        if (!resultingCauseId) {
          if (!args.categoryId) {
            throw new CauseGivingValidationError(
              "approving a nomination for a new cause requires a category",
            );
          }
          const ein = nomination.ein ?? args.ein;
          if (!ein) {
            // causes.ein is the program's identity key (grants go to that
            // EIN or nowhere) — never fabricate one to fill the column.
            throw new CauseGivingValidationError(
              "approving a nomination for a new cause requires its EIN",
            );
          }
          const [created] = await tx
            .insert(causes)
            .values({
              legalName: nomination.charityLegalName,
              ein,
              categoryId: args.categoryId,
              status: "candidate",
              agreementState: "none",
              addedVia: "nomination",
            })
            .returning();
          resultingCauseId = created.id;
        }
      }
      await tx
        .update(causeNominations)
        .set({
          status: args.decision,
          declineReason:
            args.decision === "declined" ? args.declineReason!.trim() : null,
          decidedBy: actor.userId,
          decidedAt: now,
          resultingCauseId,
          updatedAt: now,
        })
        .where(
          and(
            eq(causeNominations.id, nomination.id),
            eq(causeNominations.organizationId, args.organizationId),
          ),
        );
      return {
        nominationId: nomination.id,
        ...(resultingCauseId ? { causeId: resultingCauseId } : {}),
      };
    });
    return receipt("decideNomination", actor, refs);
  }

  async function recordVetting(
    actor: CauseGivingActor,
    args: {
      causeId: string;
      teosCheckedAt?: Date;
      teosResult?: string;
      teosSnapshotRef?: string;
      form990Period?: string;
      form990ReviewedAt?: Date;
      solicitationCheckResult?: string;
      sanctionsCheckResult?: string;
      outcome: VettingOutcome;
      notes?: string;
    },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const [cause] = await deps.db
      .select()
      .from(causes)
      .where(eq(causes.id, args.causeId))
      .limit(1);
    if (!cause) throw new CauseGivingNotFoundError(`cause ${args.causeId}`);
    const [inserted] = await deps.db
      .insert(causeVettingRecords)
      .values({
        causeId: args.causeId,
        teosCheckedAt: args.teosCheckedAt ?? null,
        teosResult: args.teosResult ?? null,
        teosSnapshotRef: args.teosSnapshotRef ?? null,
        form990Period: args.form990Period ?? null,
        form990ReviewedAt: args.form990ReviewedAt ?? null,
        solicitationCheckResult: args.solicitationCheckResult ?? null,
        sanctionsCheckResult: args.sanctionsCheckResult ?? null,
        reviewedBy: actor.userId,
        outcome: args.outcome,
        notes: args.notes ?? null,
      })
      .returning();
    return receipt("recordVetting", actor, {
      vettingRecordId: inserted.id,
      causeId: args.causeId,
    });
  }

  async function setCauseAgreementState(
    actor: CauseGivingActor,
    args: { causeId: string; agreementState: CauseAgreementState },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const [updated] = await deps.db
      .update(causes)
      .set({ agreementState: args.agreementState, updatedAt: deps.now() })
      .where(eq(causes.id, args.causeId))
      .returning();
    if (!updated) throw new CauseGivingNotFoundError(`cause ${args.causeId}`);
    return receipt("setCauseAgreementState", actor, { causeId: args.causeId });
  }

  async function setCauseStatus(
    actor: CauseGivingActor,
    args: {
      causeId: string;
      status: CauseStatus;
      reason?: string;
      removalTriggerCode?: CauseRemovalTriggerCode;
    },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    if (args.status === "removed") {
      if (
        !args.removalTriggerCode ||
        !CAUSE_REMOVAL_TRIGGER_CODES.includes(args.removalTriggerCode)
      ) {
        throw new CauseGivingValidationError(
          "removal requires an §1.6 objective trigger code",
        );
      }
    }
    const [cause] = await deps.db
      .select()
      .from(causes)
      .where(eq(causes.id, args.causeId))
      .limit(1);
    if (!cause) throw new CauseGivingNotFoundError(`cause ${args.causeId}`);
    if (args.status === "ballot") {
      // §2 invariant: no cause reaches ballot without a complete passing
      // vetting record AND an executed agreement (§1.6).
      const [latestVetting] = await deps.db
        .select()
        .from(causeVettingRecords)
        .where(eq(causeVettingRecords.causeId, args.causeId))
        .orderBy(desc(causeVettingRecords.createdAt))
        .limit(1);
      if (!latestVetting || latestVetting.outcome !== "pass") {
        throw new CauseGivingValidationError(
          "a cause reaches ballot only with a complete passing vetting record",
        );
      }
      if (cause.agreementState !== "executed") {
        throw new CauseGivingValidationError(
          "a cause reaches ballot only with an executed agreement",
        );
      }
    }
    await deps.db
      .update(causes)
      .set({
        status: args.status,
        statusReason: args.reason ?? null,
        removalTriggerCode:
          args.status === "removed" ? (args.removalTriggerCode ?? null) : null,
        updatedAt: deps.now(),
      })
      .where(eq(causes.id, args.causeId));
    return receipt("setCauseStatus", actor, { causeId: args.causeId });
  }

  // ── Quarter engine commands ──────────────────────────────────────────────

  async function snapshotQuarter(
    actor: CauseGivingActor,
    args: { quarterId: string; payingMemberUserIds?: readonly string[] },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const now = deps.now();
    const refs = await deps.db.transaction(async (tx) => {
      const [quarter] = await tx
        .select()
        .from(causeGivingQuarters)
        .where(eq(causeGivingQuarters.id, args.quarterId))
        .limit(1);
      if (!quarter) {
        throw new CauseGivingNotFoundError(`quarter ${args.quarterId}`);
      }
      if (quarter.status !== "open") {
        throw new CauseGivingValidationError(
          `snapshot requires an open quarter (status is ${quarter.status})`,
        );
      }
      const snapshotDayStart = new Date(`${quarter.periodEnd}T00:00:00.000Z`);
      if (now.getTime() < snapshotDayStart.getTime()) {
        throw new CauseGivingValidationError(
          "snapshot date not reached: the snapshot is taken on the last day of the quarter",
        );
      }
      const existing = await tx
        .select()
        .from(causeQuarterSnapshots)
        .where(eq(causeQuarterSnapshots.quarterId, quarter.id))
        .limit(1);
      if (existing.length > 0) {
        throw new CauseGivingValidationError(
          "snapshot rows are frozen once written and cannot be re-taken",
        );
      }
      const selections = await tx.select().from(memberCauseSelections);
      // Paying determination is per (organization, member): a member of a
      // paid org and a free org counts only for the paid org's selection.
      let isPaying: (s: (typeof selections)[number]) => boolean;
      if (args.payingMemberUserIds) {
        const supplied = new Set(args.payingMemberUserIds);
        isPaying = (s) => supplied.has(s.memberUserId);
      } else {
        // Derived paying set: orgs on a paid tier with an active/trialing
        // subscription (see the header's named limitation).
        const orgs = await tx
          .select()
          .from(organizations)
          .where(
            inArray(organizations.subscriptionStatus, ["active", "trialing"]),
          );
        const paidOrgIds = new Set(
          orgs
            .filter((o) => o.subscriptionTier !== "free")
            .map((o) => o.id),
        );
        isPaying = (s) => paidOrgIds.has(s.organizationId);
      }
      // Cause ids are uuid strings in the schema; the rules engine keys on
      // numbers, so map through a stable per-run index and back.
      const causeIdByIndex = new Map<number, string>();
      const indexByCauseId = new Map<string, number>();
      for (const s of selections) {
        if (!indexByCauseId.has(s.causeId)) {
          const idx = indexByCauseId.size + 1;
          indexByCauseId.set(s.causeId, idx);
          causeIdByIndex.set(idx, s.causeId);
        }
      }
      const tally = tallySnapshot(
        selections.map((s) => ({
          causeId: indexByCauseId.get(s.causeId)!,
          isPayingMember: isPaying(s),
        })),
      );
      for (const row of tally.rows) {
        await tx.insert(causeQuarterSnapshots).values({
          quarterId: quarter.id,
          causeId: causeIdByIndex.get(row.causeId)!,
          votes: row.votes,
          sharePct: (row.share * 100).toFixed(4),
        });
      }
      const membersWithSelection = new Set(
        selections.map((s) => `${s.organizationId}:${s.memberUserId}`),
      ).size;
      const payingMembers = new Set(
        selections
          .filter((s) => isPaying(s))
          .map((s) => `${s.organizationId}:${s.memberUserId}`),
      ).size;
      await tx
        .update(causeGivingQuarters)
        .set({
          status: "snapshotted",
          snapshotTakenAt: now,
          payingMembersAtSnapshot: payingMembers,
          membersWithSelectionAtSnapshot: membersWithSelection,
          updatedAt: now,
        })
        .where(eq(causeGivingQuarters.id, quarter.id));
      return {
        quarterId: quarter.id,
        snapshotRows: String(tally.rows.length),
        totalVotes: String(tally.totalVotes),
      };
    });
    return receipt("snapshotQuarter", actor, refs);
  }

  async function computeAllocationsCommand(
    actor: CauseGivingActor,
    args: { quarterId: string },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const now = deps.now();
    const refs = await deps.db.transaction(async (tx) => {
      const [quarter] = await tx
        .select()
        .from(causeGivingQuarters)
        .where(eq(causeGivingQuarters.id, args.quarterId))
        .limit(1);
      if (!quarter) {
        throw new CauseGivingNotFoundError(`quarter ${args.quarterId}`);
      }
      if (quarter.status !== "snapshotted" && quarter.status !== "allocated") {
        throw new CauseGivingValidationError(
          `allocations require a snapshotted quarter (status is ${quarter.status})`,
        );
      }
      if (quarter.revenueCents == null || quarter.expenseCents == null) {
        throw new CauseGivingValidationError(
          "profit inputs are not recorded on this quarter yet",
        );
      }
      const disbursed = await tx
        .select()
        .from(causeDisbursements)
        .innerJoin(
          causeAllocations,
          eq(causeDisbursements.allocationId, causeAllocations.id),
        )
        .where(eq(causeAllocations.quarterId, quarter.id))
        .limit(1);
      if (disbursed.length > 0) {
        throw new CauseGivingValidationError(
          "allocations cannot be recomputed after a disbursement exists",
        );
      }
      const snapshotRows = await tx
        .select()
        .from(causeQuarterSnapshots)
        .where(eq(causeQuarterSnapshots.quarterId, quarter.id));
      const allCauses = await tx.select().from(causes);
      const allCategories = await tx.select().from(causeCategories);
      const categoryKeyById = new Map(
        allCategories.map((c) => [c.id, c.key]),
      );

      // Prior-quarter state: carryforward-in, sub-threshold streaks, and the
      // unpayable-held set all derive from earlier quarters' frozen rows.
      const priorQuarters = (
        await tx
          .select()
          .from(causeGivingQuarters)
          .where(
            inArray(causeGivingQuarters.status, [
              "allocated",
              "disbursing",
              "reported",
            ]),
          )
          .orderBy(asc(causeGivingQuarters.year), asc(causeGivingQuarters.quarter))
      ).filter(
        (q) =>
          q.id !== quarter.id &&
          (q.year < quarter.year ||
            (q.year === quarter.year && q.quarter < quarter.quarter)),
      );
      const carryforwardInByCause: Record<number, number> = {};
      const streakByCause: Record<number, number> = {};
      const heldCauseIds = new Set<string>();
      // Map uuid cause ids to the rules engine's numeric keys.
      const indexByCauseId = new Map<string, number>();
      const causeIdByIndex = new Map<number, string>();
      const idxFor = (causeId: string): number => {
        let idx = indexByCauseId.get(causeId);
        if (idx == null) {
          idx = indexByCauseId.size + 1;
          indexByCauseId.set(causeId, idx);
          causeIdByIndex.set(idx, causeId);
        }
        return idx;
      };
      if (priorQuarters.length > 0) {
        const priorAllocations = await tx
          .select()
          .from(causeAllocations)
          .where(
            inArray(
              causeAllocations.quarterId,
              priorQuarters.map((q) => q.id),
            ),
          );
        const quarterOrder = new Map(
          priorQuarters.map((q, i) => [q.id, i]),
        );
        const byCause = new Map<string, typeof priorAllocations>();
        for (const a of priorAllocations) {
          const list = byCause.get(a.causeId) ?? [];
          list.push(a);
          byCause.set(a.causeId, list);
        }
        for (const [causeId, list] of byCause) {
          list.sort(
            (a, b) =>
              (quarterOrder.get(a.quarterId) ?? 0) -
              (quarterOrder.get(b.quarterId) ?? 0),
          );
          const latest = list[list.length - 1];
          const idx = idxFor(causeId);
          if (latest.carryforwardOutCents > 0) {
            carryforwardInByCause[idx] = latest.carryforwardOutCents;
          }
          if (latest.disposition === "unpayable-held") {
            heldCauseIds.add(causeId);
          }
          // A prior quarter counts toward the sub-threshold streak exactly
          // when its frozen row rolled: by construction a rolled row's
          // final balance was below MIN_DISBURSEMENT_CENTS and nothing was
          // disbursed (see computeAllocations).
          let streak = 0;
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].disposition === "rolled") streak++;
            else break;
          }
          if (streak > 0) streakByCause[idx] = streak;
        }
      }

      const tallyRows: TallyRow[] = snapshotRows.map((r) => ({
        causeId: idxFor(r.causeId),
        votes: r.votes,
        share: Number(r.sharePct) / 100,
      }));
      const payableCauseIds = allCauses
        .filter((c) => c.status === "ballot" && c.agreementState === "executed")
        .map((c) => idxFor(c.id));
      const categoryByCause: Record<number, string> = {};
      for (const c of allCauses) {
        categoryByCause[idxFor(c.id)] =
          categoryKeyById.get(c.categoryId) ?? "";
      }
      const poolCents = computeQuarterPool(
        quarter.revenueCents,
        quarter.expenseCents,
      );
      const rows = computeAllocations({
        poolCents,
        snapshot: tallyRows,
        carryforwardInByCause,
        consecutiveSubThresholdQuartersByCause: streakByCause,
        payableCauseIds,
        unpayableHeldCauseIds: [...heldCauseIds].map((id) => idxFor(id)),
        categoryByCause,
      });

      await tx
        .delete(causeAllocations)
        .where(eq(causeAllocations.quarterId, quarter.id));
      for (const row of rows) {
        await tx.insert(causeAllocations).values({
          quarterId: quarter.id,
          causeId: causeIdByIndex.get(row.causeId)!,
          allocatedCents: row.allocatedCents,
          carryforwardInCents: row.carryforwardInCents,
          disbursableCents: row.disbursableCents,
          carryforwardOutCents: row.carryforwardOutCents,
          disposition: row.disposition as AllocationDisposition,
          redistributionFromCauseIds: row.redistributionFromCauseIds.map(
            (i) => causeIdByIndex.get(i)!,
          ),
          redistributionToCauseIds: row.redistributionToCauseIds.map(
            (i) => causeIdByIndex.get(i)!,
          ),
        });
      }
      await tx
        .update(causeGivingQuarters)
        .set({
          status: "allocated",
          computedBaseCents: Math.max(
            quarter.revenueCents - quarter.expenseCents,
            0,
          ),
          poolCents,
          definitionVersion: PROFIT_DEFINITION_VERSION,
          founderCallTreatment: FC_CG_1_TREATMENT,
          updatedAt: now,
        })
        .where(eq(causeGivingQuarters.id, quarter.id));
      return {
        quarterId: quarter.id,
        poolCents: String(poolCents),
        allocations: String(rows.length),
      };
    });
    return receipt("computeAllocations", actor, refs);
  }

  async function recordDisbursement(
    actor: CauseGivingActor,
    args: {
      allocationId: string;
      amountCents: number;
      disbursedOn: string;
      method: DisbursementMethod;
      externalRef?: string;
      unpayableAttemptLog?: unknown;
    },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const refs = await deps.db.transaction(async (tx) => {
      const [allocation] = await tx
        .select()
        .from(causeAllocations)
        .where(eq(causeAllocations.id, args.allocationId))
        .limit(1);
      if (!allocation) {
        throw new CauseGivingNotFoundError(`allocation ${args.allocationId}`);
      }
      if (
        allocation.disposition !== "disbursed" &&
        allocation.disposition !== "redistributed-in"
      ) {
        throw new CauseGivingValidationError(
          `allocation is not disbursable (disposition is ${allocation.disposition ?? "unset"})`,
        );
      }
      if (args.amountCents !== allocation.disbursableCents) {
        throw new CauseGivingValidationError(
          "disbursement amount must equal the allocation's disbursable amount",
        );
      }
      const existing = await tx
        .select()
        .from(causeDisbursements)
        .where(eq(causeDisbursements.allocationId, allocation.id))
        .limit(1);
      if (existing.length > 0) {
        throw new CauseGivingValidationError(
          "a disbursement already exists for this allocation",
        );
      }
      const [inserted] = await tx
        .insert(causeDisbursements)
        .values({
          allocationId: allocation.id,
          amountCents: args.amountCents,
          disbursedOn: args.disbursedOn,
          method: args.method,
          externalRef: args.externalRef ?? null,
          unpayableAttemptLog: args.unpayableAttemptLog ?? null,
          recordedBy: actor.userId,
        })
        .returning();
      let ledgerEventRef: string | null = null;
      if (deps.ledgerWriter) {
        ledgerEventRef = await deps.ledgerWriter({
          disbursementId: inserted.id,
          allocationId: allocation.id,
          amountCents: args.amountCents,
          actorId: actor.userId,
        });
        await tx
          .update(causeDisbursements)
          .set({ ledgerEventRef })
          .where(eq(causeDisbursements.id, inserted.id));
      }
      await tx
        .update(causeGivingQuarters)
        .set({ status: "disbursing", updatedAt: deps.now() })
        .where(
          and(
            eq(causeGivingQuarters.id, allocation.quarterId),
            eq(causeGivingQuarters.status, "allocated"),
          ),
        );
      return {
        disbursementId: inserted.id,
        allocationId: allocation.id,
        ...(ledgerEventRef ? { ledgerEventRef } : {}),
      };
    });
    return receipt("recordDisbursement", actor, refs);
  }

  async function publishQuarterReport(
    actor: CauseGivingActor,
    args: {
      quarterId: string;
      content: unknown;
      renderedBody: string;
      disclosureVersion: string;
    },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const now = deps.now();
    const refs = await deps.db.transaction(async (tx) => {
      const [quarter] = await tx
        .select()
        .from(causeGivingQuarters)
        .where(eq(causeGivingQuarters.id, args.quarterId))
        .limit(1);
      if (!quarter) {
        throw new CauseGivingNotFoundError(`quarter ${args.quarterId}`);
      }
      const allocations = await tx
        .select()
        .from(causeAllocations)
        .where(eq(causeAllocations.quarterId, quarter.id));
      // §2: the report freezes only when every allocation has a disposition,
      // and every disbursable allocation has its disbursement recorded —
      // the report may not claim money moved that has not.
      for (const a of allocations) {
        if (!a.disposition) {
          throw new CauseGivingValidationError(
            "every allocation must have a disposition before the report publishes",
          );
        }
        if (a.disbursableCents > 0) {
          const [d] = await tx
            .select()
            .from(causeDisbursements)
            .where(eq(causeDisbursements.allocationId, a.id))
            .limit(1);
          if (!d) {
            throw new CauseGivingValidationError(
              "a disbursable allocation has no recorded disbursement",
            );
          }
        }
      }
      const [entry] = await tx
        .insert(causeReportEntries)
        .values({
          quarterId: quarter.id,
          publishedBy: actor.userId,
          publishedAt: now,
          content: args.content,
          renderedBody: args.renderedBody,
          definitionVersion:
            quarter.definitionVersion ?? PROFIT_DEFINITION_VERSION,
          disclosureVersion: args.disclosureVersion,
        })
        .returning();
      await tx
        .update(causeGivingQuarters)
        .set({
          status: "reported",
          publishedEntryId: entry.id,
          updatedAt: now,
        })
        .where(eq(causeGivingQuarters.id, quarter.id));
      return { entryId: entry.id, quarterId: quarter.id };
    });
    return receipt("publishQuarterReport", actor, refs);
  }

  async function appendReportCorrection(
    actor: CauseGivingActor,
    args: { entryId: string; text: string; reason: string },
  ): Promise<CauseGivingReceipt> {
    await requireEnabled(actor);
    requireFounder(actor);
    const [entry] = await deps.db
      .select()
      .from(causeReportEntries)
      .where(eq(causeReportEntries.id, args.entryId))
      .limit(1);
    if (!entry) {
      throw new CauseGivingNotFoundError(`report entry ${args.entryId}`);
    }
    const [inserted] = await deps.db
      .insert(causeReportCorrections)
      .values({
        entryId: entry.id,
        publishedBy: actor.userId,
        publishedAt: deps.now(),
        text: args.text,
        reason: args.reason,
      })
      .returning();
    return receipt("appendReportCorrection", actor, {
      correctionId: inserted.id,
      entryId: entry.id,
    });
  }

  return {
    selectCause,
    nominateCause,
    decideNomination,
    recordVetting,
    setCauseAgreementState,
    setCauseStatus,
    snapshotQuarter,
    computeAllocations: computeAllocationsCommand,
    recordDisbursement,
    publishQuarterReport,
    appendReportCorrection,
  };
}
