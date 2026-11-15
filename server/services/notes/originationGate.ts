// ============================================================================
// SERVER/SERVICES/NOTES/ORIGINATIONGATE.TS — Notes V2 Leg 3: the activation
// (consummation) gate for the originated book.
// ----------------------------------------------------------------------------
// The I/O half of shared/notes/sellerFinanceGate.ts: it resolves the facts
// (R7), asks the counter for the seller's tracks (R8), lets decideActivation
// decide, and on a pass writes the activation_gate_passed snapshot inside the
// CALLER's transaction — so the activation and its record commit or roll back
// together. Callers: noteRepo.createNote (status 'active') and
// noteRepo.updateNote (stored 'pending' → 'active', first activation only).
//
// Every query is org-scoped. Concurrent activations for the same seller are
// serialized by a transaction-scoped advisory lock taken before the count, so
// two deals cannot each see the other as "not yet counted".
// ============================================================================

import { and, eq, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { noteOriginationRecords, type Note } from "@shared/schema";
import {
  ENGINE_VERSION,
  activationGatePassedDetail,
  decideActivation,
  exemptionContradictedBy,
  isCompleteRmloEngagement,
  thresholdReleaseDetail,
  type ActivationGatePassedDetail,
  type AtrExemptionCode,
  type GateFacts,
  type Refusal,
  type SellerFinanceCounts,
} from "@shared/notes/sellerFinanceGate";
import { evaluateClaimedExclusion } from "@shared/regulatory/doddFrankElements";
import { isFounderUserId } from "../founder";
import {
  countSellerFinance,
  loadFactsHeads,
  normalizeSellerKey,
  validAtrDetermination,
  wallDateOf,
  type DbOrTx,
} from "./sellerFinanceCounter";

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * The message the pre-Leg-3 gate gave for a missing ATR basis. Kept as the
 * lead of every ATR_DETERMINATION_REQUIRED refusal so existing surfaces and
 * their pinned copy keep the citation, the fix and the accepted codes.
 */
const ATR_REQUIRED_MESSAGE =
  "Cannot activate a note (status='active') without an ATR determination or exemption code. " +
  "Per Reg Z §1026.43(c), creditors must make an ATR determination at or before consummation. " +
  "Record the determination with persistAtrDetermination first, or set atrExemptionCode to one of: " +
  "raw_land, business_purpose, commercial_borrower.";

export type ActivationRefusedCode = "ATR_DETERMINATION_REQUIRED" | "ACTIVATION_REFUSED";

/**
 * A refused activation, with every failed check named. `code` is
 * 'ATR_DETERMINATION_REQUIRED' whenever an 'atr_missing' refusal is among them
 * (the class the pre-Leg-3 gate already refused, so existing route mappings
 * keep working), else 'ACTIVATION_REFUSED'.
 */
export class ActivationRefused extends Error {
  readonly code: ActivationRefusedCode;
  readonly refusals: Refusal[];
  constructor(refusals: Refusal[]) {
    const code: ActivationRefusedCode = refusals.some((r) => r.check === "atr_missing")
      ? "ATR_DETERMINATION_REQUIRED"
      : "ACTIVATION_REFUSED";
    const body = refusals.map((r) => r.message).join(" ");
    super(code === "ATR_DETERMINATION_REQUIRED" ? `${ATR_REQUIRED_MESSAGE} ${body}` : `Activation refused. ${body}`);
    this.name = "ActivationRefused";
    this.code = code;
    this.refusals = refusals;
  }
}

// ── The note as the gate reads it ────────────────────────────────────────────

/**
 * The fields the gate reads. `id` is null for a draft (createNote, before the
 * insert): a draft cannot have records of its own, so no record lookups run.
 */
export interface GateNote {
  id: number | null;
  owningEntity: string | null | undefined;
  startDate: Date | string;
  atrDetermination: unknown;
  atrDeterminationCompleted: unknown;
  atrExemptionCode: unknown;
}

const ZERO_COUNTS: SellerFinanceCounts = {
  trackA: 0,
  trackBRolling: 0,
  trackBCalendarYear: 0,
  trackC: 0,
  unknownDwelling: 0,
  unknownDwellingCalendarYear: 0,
  legacyFlagged: 0,
};

/** A recognized code, or null. A case variant, an unknown string or a non-string is not a code. */
function recognizedExemptionCode(raw: unknown): AtrExemptionCode | null {
  return raw === "raw_land" || raw === "business_purpose" || raw === "commercial_borrower" || raw === "legacy" ? raw : null;
}

export interface ResolvedGateFacts {
  facts: GateFacts;
  factsRecordId: string | null;
  consummationDate: string;
}

/**
 * GateFacts from the note's own columns (R7 implications) — no I/O. Used for a
 * draft, and as the base for a stored note without a facts record.
 *  - A determination counts only when the payload passes
 *    validateAtrDetermination AND the completed flag is exactly true: the bare
 *    flag with no record is not a determination (founder decision
 *    2026-11-05 §3.2), and a payload the projection disowns is not one either.
 *  - Valid determination ⇒ dwelling yes, consumer yes (it wins over a code:
 *    the conservative reading for the counts). raw_land ⇒ dwelling no;
 *    business_purpose / commercial_borrower ⇒ consumer no; the rest unanswered.
 *  - Terms elements unanswered, seller type unanswered, no claim (a claim
 *    lives only in a facts record).
 */
export function impliedGateFacts(organizationId: number, note: GateNote, activatedAt: string): ResolvedGateFacts {
  const atr = validAtrDetermination(note.atrDetermination, note.id, organizationId);
  const hasAtr = atr.valid && note.atrDeterminationCompleted === true;
  const code = recognizedExemptionCode(note.atrExemptionCode);
  const dwellingSecured = hasAtr ? "yes" : code === "raw_land" ? "no" : "unanswered";
  const consumerPurpose = hasAtr ? "yes" : code === "business_purpose" || code === "commercial_borrower" ? "no" : "unanswered";
  return {
    factsRecordId: null,
    consummationDate: wallDateOf(note.startDate),
    facts: {
      sellerKey: normalizeSellerKey(note.owningEntity),
      sellerType: "unanswered",
      dwellingSecured,
      consumerPurpose,
      claimedExclusion: "none",
      hasFactsRecord: false,
      balloon: "unanswered",
      negativeAmortization: "unanswered",
      rateType: "unanswered",
      firstRateAdjustmentMonths: null,
      rateCapsStated: "unanswered",
      sellerConstructedDwelling: "unanswered",
      hasAtrDetermination: hasAtr,
      attestedAt: hasAtr && atr.valid ? atr.attestedAt : null,
      activatedAt,
      exemptionCode: code,
      factsContradictCode: false,
      hasCompleteRmlo: false,
      hasThresholdRelease: false,
    },
  };
}

/**
 * Resolve GateFacts for a note (R7). For a stored note, the governing
 * origination_facts record (chain head) replaces the implied facts, its seller
 * key and consummation date govern, a contradiction with the exemption code is
 * flagged, and the note's RMLO record is looked up. The threshold release is
 * seller-scoped and is resolved for drafts too.
 */
export async function resolveGateFacts(
  dbOrTx: DbOrTx,
  organizationId: number,
  note: GateNote,
  activatedAt: string,
): Promise<ResolvedGateFacts> {
  const base = impliedGateFacts(organizationId, note, activatedAt);
  let resolved = base;
  if (note.id !== null) {
    const head = (await loadFactsHeads(dbOrTx, organizationId, [note.id])).get(note.id);
    if (head) {
      const d = head.detail;
      const facts: GateFacts = {
        ...base.facts,
        sellerKey: d.sellerKey === null ? null : normalizeSellerKey(d.sellerKey),
        sellerType: d.sellerType,
        dwellingSecured: d.dwellingSecured,
        consumerPurpose: d.consumerPurpose,
        claimedExclusion: d.claimedExclusion,
        hasFactsRecord: true,
        balloon: d.balloon,
        negativeAmortization: d.negativeAmortization,
        rateType: d.rateType,
        firstRateAdjustmentMonths: d.firstRateAdjustmentMonths,
        rateCapsStated: d.rateCapsStated,
        sellerConstructedDwelling: d.sellerConstructedDwelling,
      };
      facts.factsContradictCode = exemptionContradictedBy(facts.exemptionCode, facts);
      resolved = { facts, factsRecordId: head.id, consummationDate: d.consummationDate };
    }
    resolved.facts.hasCompleteRmlo = await hasCompleteRmloRecord(dbOrTx, organizationId, note.id);
  }
  resolved.facts.hasThresholdRelease = await hasThresholdReleaseFor(
    dbOrTx,
    organizationId,
    resolved.facts.sellerKey,
    Number(resolved.consummationDate.slice(0, 4)),
  );
  return resolved;
}

/** A complete rmlo_engagement record for the note that no later record supersedes. */
async function hasCompleteRmloRecord(dbOrTx: DbOrTx, organizationId: number, noteId: number): Promise<boolean> {
  const superseder = alias(noteOriginationRecords, "rmlo_superseder");
  const rows = await dbOrTx
    .select({ detail: noteOriginationRecords.detail })
    .from(noteOriginationRecords)
    .where(
      and(
        eq(noteOriginationRecords.organizationId, organizationId),
        eq(noteOriginationRecords.kind, "rmlo_engagement"),
        eq(noteOriginationRecords.noteId, noteId),
        notExists(
          dbOrTx
            .select({ one: sql`1` })
            .from(superseder)
            .where(and(eq(superseder.organizationId, organizationId), eq(superseder.supersedesId, noteOriginationRecords.id))),
        ),
      ),
    );
  return rows.some((r) => isCompleteRmloEngagement(r.detail));
}

/**
 * A founder's threshold_release for (org, seller, calendar year) — R4.
 *
 * The release's seller is the sellerKey stored IN its detail at write time,
 * matched directly: never re-derived from the anchor note, whose governing
 * facts record can change its seller later (a release must not move between
 * sellers), and never lost when the anchor note is deleted. The recorder is
 * re-checked with isFounderUserId on read: the writing route enforces it,
 * but the table is reachable by any server code path.
 */
async function hasThresholdReleaseFor(
  dbOrTx: DbOrTx,
  organizationId: number,
  sellerKey: string | null,
  calendarYear: number,
): Promise<boolean> {
  const releases = await dbOrTx
    .select({
      detail: noteOriginationRecords.detail,
      recordedBy: noteOriginationRecords.recordedBy,
    })
    .from(noteOriginationRecords)
    .where(and(eq(noteOriginationRecords.organizationId, organizationId), eq(noteOriginationRecords.kind, "threshold_release")));
  return releases.some((r) => {
    const parsed = thresholdReleaseDetail.safeParse(r.detail);
    return (
      parsed.success &&
      parsed.data.calendarYear === calendarYear &&
      parsed.data.sellerKey === sellerKey &&
      isFounderUserId(r.recordedBy)
    );
  });
}

// ── Decide ───────────────────────────────────────────────────────────────────

/**
 * The count-independent half of the decision, with no I/O: every check
 * decideActivation can fail at zero prior deals (ATR basis, legacy, claim
 * without a record, terms, (a)(5) seller type). Counts only ever make the
 * decision stricter, so a refusal here is final — createNote runs this before
 * it opens a transaction, so those refusals never touch the database.
 */
export function preflightActivation(facts: GateFacts): void {
  const decision = decideActivation(facts, ZERO_COUNTS);
  if (!decision.allowed) throw new ActivationRefused(decision.refusals);
}

export interface EvaluateActivationArgs {
  organizationId: number;
  note: GateNote;
  /** The activation instant; also the gate's `activatedAt`. */
  activationInstant: Date;
}

/**
 * Resolve, count, decide. Throws ActivationRefused on a refusal; on a pass
 * returns the validated activation_gate_passed detail WITHOUT writing it (the
 * caller writes it once the note id exists — see recordActivationGatePassed).
 * Must run inside the transaction that performs the activation.
 */
export async function evaluateActivation(tx: DbOrTx, args: EvaluateActivationArgs): Promise<ActivationGatePassedDetail> {
  const { organizationId, note } = args;
  const activatedAt = args.activationInstant.toISOString();
  const { facts, factsRecordId, consummationDate } = await resolveGateFacts(tx, organizationId, note, activatedAt);
  preflightActivation(facts);

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`seller_finance_gate:${organizationId}:${facts.sellerKey ?? ""}`}))`);
  const counted = await countSellerFinance(tx, {
    organizationId,
    sellerKey: facts.sellerKey,
    consummationDate,
    ...(note.id !== null ? { excludeNoteId: note.id } : {}),
  });

  const decision = decideActivation(facts, counted);
  if (!decision.allowed) throw new ActivationRefused(decision.refusals);

  const code = facts.exemptionCode;
  const atrBasis: ActivationGatePassedDetail["atrBasis"] =
    facts.hasAtrDetermination && facts.attestedAt !== null
      ? { kind: "determination", attestedAt: facts.attestedAt }
      : code === "raw_land" || code === "business_purpose" || code === "commercial_borrower"
        ? { kind: "exemption", code }
        : null;
  const elementVerdicts =
    facts.claimedExclusion === "none"
      ? []
      : evaluateClaimedExclusion(facts.claimedExclusion, {
          balloon: facts.balloon,
          negativeAmortization: facts.negativeAmortization,
          rateType: facts.rateType,
          firstRateAdjustmentMonths: facts.firstRateAdjustmentMonths,
          rateCapsStated: facts.rateCapsStated,
          sellerConstructedDwelling: facts.sellerConstructedDwelling,
          hasDwelling: facts.dwellingSecured,
        });

  return activationGatePassedDetail.parse({
    sellerKey: facts.sellerKey,
    counts: {
      trackA: counted.trackA,
      trackBRolling: counted.trackBRolling,
      trackBCalendarYear: counted.trackBCalendarYear,
      trackC: counted.trackC,
      unknownDwelling: counted.unknownDwelling,
      unknownDwellingCalendarYear: counted.unknownDwellingCalendarYear,
      legacyFlagged: counted.legacyFlagged,
    },
    contributingNoteIds: counted.contributing,
    factsRecordId,
    atrBasis,
    elementVerdicts,
    engineVersion: ENGINE_VERSION,
    activatedAt,
  });
}

/** Write the activation_gate_passed record (in the caller's transaction). */
export async function recordActivationGatePassed(
  tx: DbOrTx,
  args: { organizationId: number; noteId: number; recordedBy: string; detail: ActivationGatePassedDetail },
): Promise<void> {
  await tx.insert(noteOriginationRecords).values({
    organizationId: args.organizationId,
    noteId: args.noteId,
    noteIdAtRecord: args.noteId,
    kind: "activation_gate_passed",
    detail: activationGatePassedDetail.parse(args.detail),
    recordedBy: args.recordedBy,
  });
}

/**
 * The gate for a stored note's first activation: evaluate, then record. The
 * note must belong to `organizationId` (the caller loaded it org-scoped).
 */
export async function assertActivationAllowed(
  tx: DbOrTx,
  args: { organizationId: number; note: Note | (GateNote & { id: number }); recordedBy: string; activationInstant: Date },
): Promise<ActivationGatePassedDetail> {
  const detail = await evaluateActivation(tx, {
    organizationId: args.organizationId,
    note: args.note,
    activationInstant: args.activationInstant,
  });
  await recordActivationGatePassed(tx, {
    organizationId: args.organizationId,
    noteId: args.note.id,
    recordedBy: args.recordedBy,
    detail,
  });
  return detail;
}
