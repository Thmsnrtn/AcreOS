// ============================================================================
// SERVER/SERVICES/NOTES/SELLERFINANCECOUNTER.TS — Notes V2 Leg 3: how many
// seller-financed deals has this seller consummated, per track?
// ----------------------------------------------------------------------------
// READ-ONLY. Nothing here writes. Every query carries the organization
// predicate. Spec: docs/evidence/2026-11-09/notes-v2-leg3-step0.md, rulings
// R2 (unknown bucket), R3 (seller key), R6 (synthetic rows), R7 (facts
// resolution) and R8 (population).
//
// POPULATION (R8)
//  1. Live `notes` rows in the org meeting the §8.1 consummation predicate —
//       status <> 'pending' AND (atr_determination_completed = true
//         OR atr_exemption_code IN ('raw_land','business_purpose','commercial_borrower'))
//     — that are not synthetic (`realNote()` from onboarding/sampleFilters.ts,
//     reused verbatim, not mirrored). `legacy` rows fail the predicate by
//     construction and are reported separately in `legacyFlagged`.
//  2. activation_gate_passed records in the org whose note was since hard-
//     deleted (note_id IS NULL — the FK is ON DELETE SET NULL), deduplicated
//     by note_id_at_record (latest record wins). Their consummation date is the
//     snapshot's `activatedAt` (R8); their contributing id is note_id_at_record.
//  The acquired book (acquired_notes) is never read: it is not this seller's
//  origination population.
//
// SELLER KEY (R3). (organization_id, normalized owning_entity). Normalization =
// trim, collapse internal whitespace to one space, lower-case. A NULL or blank
// owning_entity is the organization itself, represented as `null` — the same
// representation shared/notes/sellerFinanceGate.ts uses for `sellerKey`.
// Normalization runs in JS over the org's rows (one function, so SQL and JS
// can never disagree about what a key is). LIMITATION, stated on the output:
// two spellings of one entity are two sellers.
//
// WINDOW. Rolling 12 months ending at the consummation date, on calendar
// dates: a deal dated exactly 12 months before does NOT count, 12 months less
// a day does, and deals dated after the consummation date do not count. The
// calendar-year track reads the WHOLE calendar year of the consummation date
// (Jan 1 – Dec 31), including deals dated later in that year — the
// conservative reading of "in the calendar year". `legacyFlagged` is NOT
// windowed: every consummated legacy row for the seller, any date.
// Dates come from `start_date` (timestamp without time zone; drizzle reads and
// writes it as UTC, so the stored wall date is its UTC date). The SQL reads it
// with to_char so no JS time-zone conversion touches it.
//
// CLASSIFICATION of a live row. Where an origination_facts record exists (chain
// head), it governs — an 'unanswered' fact there is 'unknown', not a fall back
// to the columns. Absent a record (R7 implications):
//   dwelling  'yes' if a valid atr_determination is present; 'no' if raw_land;
//             else 'unknown'.
//   consumer  'yes' if a valid atr_determination is present; 'no' if
//             business_purpose / commercial_borrower; else 'unknown'.
// Tracks: (a) dwelling yes; (b) dwelling yes AND consumer yes, rolling AND
// calendar year; (c) every population row in window. Dwelling-unknown rows in
// window go to unknownDwelling (never (a)/(b)); in the calendar year, those not
// recorded non-consumer go to unknownDwellingCalendarYear (the R2 bucket for
// the creditor threshold — see SellerFinanceCounts).
// ============================================================================

import { and, desc, eq, gte, inArray, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notes, noteOriginationRecords } from "@shared/schema";
import {
  activationGatePassedDetail,
  originationFactsDetail,
  type OriginationFactsDetail,
  type SellerFinanceCounts,
} from "@shared/notes/sellerFinanceGate";
import type { PrimaryDb } from "../../db";
import { realNote } from "../onboarding/sampleFilters";
import { validateAtrDetermination, type AtrDeterminationInput } from "../atrSafeHarbor";
import { logger } from "../../utils/logger";

/** A db handle or a transaction handle (withTransaction hands out the same type). */
export type DbOrTx = PrimaryDb;

export const SELLER_KEY_LIMITATION =
  "The seller is identified by the note's owning entity, trimmed and lower-cased. Two spellings of one entity count as two sellers; a blank owning entity is the organization itself.";

/** R3 normalization. `null` = the organization itself. */
export function normalizeSellerKey(owningEntity: string | null | undefined): string | null {
  if (owningEntity === null || owningEntity === undefined) return null;
  const key = owningEntity.trim().replace(/\s+/g, " ").toLowerCase();
  return key === "" ? null : key;
}

export type Classification = "yes" | "no" | "unknown";

export interface ContributingNoteIds {
  trackA: number[];
  trackBRolling: number[];
  trackBCalendarYear: number[];
  trackC: number[];
  unknownDwelling: number[];
  unknownDwellingCalendarYear: number[];
  legacyFlagged: number[];
}

export interface SellerFinanceCountResult extends SellerFinanceCounts {
  contributing: ContributingNoteIds;
  sellerKey: string | null;
  window: { startExclusive: string; endInclusive: string; calendarYear: number };
  /** Contributions from activation records whose note was deleted (their ids are note_id_at_record). */
  orphanedActivationIds: number[];
  sellerKeyLimitation: string;
}

export interface CountSellerFinanceArgs {
  organizationId: number;
  sellerKey: string | null;
  /** ISO calendar date, YYYY-MM-DD. */
  consummationDate: string;
  /** The deal being gated: it is not yet consummated, so it never counts itself. */
  excludeNoteId?: number;
}

// ── Date helpers (pure, on YYYY-MM-DD strings) ───────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The same calendar date one year earlier (Feb 29 → Feb 28). */
function twelveMonthsBefore(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new Error(`sellerFinanceCounter: consummation date must be YYYY-MM-DD, got "${isoDate}"`);
  const year = Number(m[1]) - 1;
  const month = Number(m[2]);
  const day = Math.min(Number(m[3]), daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${m[2]}-${String(day).padStart(2, "0")}`;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The stored wall date of a `timestamp without time zone` value as drizzle hands it back (UTC). */
export function wallDateOf(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

// ── ATR validity (shared with originationGate.ts) ────────────────────────────

/**
 * Does the stored `atr_determination` payload pass validateAtrDetermination?
 * Returns its attestedAt when it does. A null payload, or one that throws, is
 * not a determination — whatever atr_determination_completed says.
 */
export function validAtrDetermination(
  payload: unknown,
  noteId: number | null,
  organizationId: number,
): { valid: true; attestedAt: string | null } | { valid: false } {
  if (payload === null || payload === undefined || typeof payload !== "object") return { valid: false };
  try {
    // The stored payload is the AtrDeterminationInput minus the routing ids;
    // validateAtrDetermination reads neither id.
    validateAtrDetermination({ ...(payload as object), noteId: noteId ?? 0, organizationId } as AtrDeterminationInput);
  } catch {
    return { valid: false };
  }
  const attestedAt = (payload as { attestedAt?: unknown }).attestedAt;
  return { valid: true, attestedAt: typeof attestedAt === "string" ? attestedAt : null };
}

// ── Origination-facts chain heads ────────────────────────────────────────────

export interface FactsHead {
  id: string;
  detail: OriginationFactsDetail;
}

/**
 * The governing origination_facts record per note: the record no other record
 * in the org supersedes; ties broken by recorded_at DESC, then id DESC. A head
 * whose detail fails its schema is an integrity fault and throws — a gate must
 * not silently fall back to weaker implied facts.
 */
export async function loadFactsHeads(
  dbOrTx: DbOrTx,
  organizationId: number,
  noteIds: number[],
): Promise<Map<number, FactsHead>> {
  const out = new Map<number, FactsHead>();
  if (noteIds.length === 0) return out;
  const superseder = alias(noteOriginationRecords, "superseder");
  const rows = await dbOrTx
    .select({
      id: noteOriginationRecords.id,
      noteId: noteOriginationRecords.noteId,
      detail: noteOriginationRecords.detail,
    })
    .from(noteOriginationRecords)
    .where(
      and(
        eq(noteOriginationRecords.organizationId, organizationId),
        eq(noteOriginationRecords.kind, "origination_facts"),
        inArray(noteOriginationRecords.noteId, noteIds),
        notExists(
          dbOrTx
            .select({ one: sql`1` })
            .from(superseder)
            .where(and(eq(superseder.organizationId, organizationId), eq(superseder.supersedesId, noteOriginationRecords.id))),
        ),
      ),
    )
    .orderBy(desc(noteOriginationRecords.recordedAt), desc(noteOriginationRecords.id));
  for (const row of rows) {
    if (row.noteId === null || out.has(row.noteId)) continue;
    const parsed = originationFactsDetail.safeParse(row.detail);
    if (!parsed.success) {
      throw new Error(`origination_facts record ${row.id} (note ${row.noteId}) does not match its schema`);
    }
    out.set(row.noteId, { id: row.id, detail: parsed.data });
  }
  return out;
}

function fromTriState(v: "yes" | "no" | "unanswered"): Classification {
  return v === "unanswered" ? "unknown" : v;
}

/** Classify one deal from its facts record, else from its column implications. */
function classifyDeal(input: {
  facts: Pick<OriginationFactsDetail, "dwellingSecured" | "consumerPurpose"> | null;
  hasValidAtr: boolean;
  exemptionCode: string | null;
}): { dwelling: Classification; consumer: Classification } {
  if (input.facts) {
    return { dwelling: fromTriState(input.facts.dwellingSecured), consumer: fromTriState(input.facts.consumerPurpose) };
  }
  const code = input.exemptionCode;
  const dwelling: Classification = input.hasValidAtr ? "yes" : code === "raw_land" ? "no" : "unknown";
  const consumer: Classification = input.hasValidAtr
    ? "yes"
    : code === "business_purpose" || code === "commercial_borrower"
      ? "no"
      : "unknown";
  return { dwelling, consumer };
}

// ── The counter ──────────────────────────────────────────────────────────────

interface Deal {
  id: number;
  date: string;
  dwelling: Classification;
  consumer: Classification;
}

export async function countSellerFinance(dbOrTx: DbOrTx, args: CountSellerFinanceArgs): Promise<SellerFinanceCountResult> {
  const { organizationId, consummationDate } = args;
  const sellerKey = args.sellerKey === null ? null : normalizeSellerKey(args.sellerKey);
  const windowStartExclusive = twelveMonthsBefore(consummationDate);
  const calendarYear = Number(consummationDate.slice(0, 4));
  const yearStart = `${consummationDate.slice(0, 4)}-01-01`;
  const yearEnd = `${consummationDate.slice(0, 4)}-12-31`;
  const lowerBound = windowStartExclusive < yearStart ? windowStartExclusive : yearStart;
  const upperExclusive = nextDay(consummationDate > yearEnd ? consummationDate : yearEnd);

  const excludeSelf = args.excludeNoteId !== undefined ? [ne(notes.id, args.excludeNoteId)] : [];

  // 1. Live consummated rows, bounded to the dates either track can read.
  const liveRows = await dbOrTx
    .select({
      id: notes.id,
      owningEntity: notes.owningEntity,
      startIso: sql<string>`to_char(${notes.startDate}, 'YYYY-MM-DD')`,
      atrDetermination: notes.atrDetermination,
      atrExemptionCode: notes.atrExemptionCode,
    })
    .from(notes)
    .where(
      and(
        eq(notes.organizationId, organizationId),
        ne(notes.status, "pending"),
        or(
          eq(notes.atrDeterminationCompleted, true),
          inArray(notes.atrExemptionCode, ["raw_land", "business_purpose", "commercial_borrower"]),
        ),
        realNote(),
        gte(notes.startDate, new Date(`${lowerBound}T00:00:00.000Z`)),
        lt(notes.startDate, new Date(`${upperExclusive}T00:00:00.000Z`)),
        ...excludeSelf,
      ),
    );
  const sellerRows = liveRows.filter((r) => normalizeSellerKey(r.owningEntity) === sellerKey);
  const facts = await loadFactsHeads(
    dbOrTx,
    organizationId,
    sellerRows.map((r) => r.id),
  );
  const deals: Deal[] = sellerRows.map((r) => {
    const head = facts.get(r.id) ?? null;
    const c = classifyDeal({
      facts: head?.detail ?? null,
      hasValidAtr: validAtrDetermination(r.atrDetermination, r.id, organizationId).valid,
      exemptionCode: r.atrExemptionCode ?? null,
    });
    return { id: r.id, date: r.startIso, ...c };
  });

  // 2. Legacy rows — flagged, never counted, any date.
  const legacyRows = await dbOrTx
    .select({ id: notes.id, owningEntity: notes.owningEntity })
    .from(notes)
    .where(
      and(
        eq(notes.organizationId, organizationId),
        ne(notes.status, "pending"),
        eq(notes.atrExemptionCode, "legacy"),
        realNote(),
        ...excludeSelf,
      ),
    );
  const legacyFlagged = legacyRows.filter((r) => normalizeSellerKey(r.owningEntity) === sellerKey).map((r) => r.id);

  // 3. Activations whose note was since deleted.
  const orphanRecords = await dbOrTx
    .select({
      id: noteOriginationRecords.id,
      noteIdAtRecord: noteOriginationRecords.noteIdAtRecord,
      detail: noteOriginationRecords.detail,
    })
    .from(noteOriginationRecords)
    .where(
      and(
        eq(noteOriginationRecords.organizationId, organizationId),
        eq(noteOriginationRecords.kind, "activation_gate_passed"),
        isNull(noteOriginationRecords.noteId),
      ),
    )
    .orderBy(desc(noteOriginationRecords.recordedAt), desc(noteOriginationRecords.id));
  const seenOrphan = new Set<number>();
  const orphanSnapshots: Array<{ noteId: number; date: string; factsRecordId: string | null; atrBasis: { kind: string; code?: string } | null }> = [];
  let unreadableOrphans = 0;
  for (const rec of orphanRecords) {
    if (seenOrphan.has(rec.noteIdAtRecord)) continue;
    const parsed = activationGatePassedDetail.safeParse(rec.detail);
    if (!parsed.success) {
      unreadableOrphans++;
      continue;
    }
    seenOrphan.add(rec.noteIdAtRecord);
    if (args.excludeNoteId !== undefined && rec.noteIdAtRecord === args.excludeNoteId) continue;
    const snapKey = parsed.data.sellerKey === null ? null : normalizeSellerKey(parsed.data.sellerKey);
    if (snapKey !== sellerKey) continue;
    orphanSnapshots.push({
      noteId: rec.noteIdAtRecord,
      date: wallDateOf(parsed.data.activatedAt),
      factsRecordId: parsed.data.factsRecordId,
      atrBasis: parsed.data.atrBasis,
    });
  }
  if (unreadableOrphans > 0) {
    // Counted, never silently skipped: the caller sees it in the log, and the
    // record stays in the table for review.
    logger.warn("sellerFinanceCounter.unreadableActivationRecords", { organizationId, count: unreadableOrphans });
  }
  // The snapshot carries no per-deal dwelling/consumer classification of its
  // own; classify an orphan by the facts record it was activated on, else by
  // its ATR basis (determination ⇒ yes/yes; exemption code ⇒ R7 implications).
  const orphanFactIds = orphanSnapshots.map((o) => o.factsRecordId).filter((id): id is string => id !== null);
  const orphanFacts = new Map<string, OriginationFactsDetail>();
  if (orphanFactIds.length > 0) {
    const rows = await dbOrTx
      .select({ id: noteOriginationRecords.id, detail: noteOriginationRecords.detail })
      .from(noteOriginationRecords)
      .where(
        and(
          eq(noteOriginationRecords.organizationId, organizationId),
          eq(noteOriginationRecords.kind, "origination_facts"),
          inArray(noteOriginationRecords.id, orphanFactIds),
        ),
      );
    for (const row of rows) {
      const parsed = originationFactsDetail.safeParse(row.detail);
      if (parsed.success) orphanFacts.set(row.id, parsed.data);
    }
  }
  for (const o of orphanSnapshots) {
    const factsDetail = o.factsRecordId ? (orphanFacts.get(o.factsRecordId) ?? null) : null;
    const c = classifyDeal({
      facts: factsDetail,
      hasValidAtr: o.atrBasis?.kind === "determination",
      exemptionCode: o.atrBasis?.kind === "exemption" ? (o.atrBasis.code ?? null) : null,
    });
    deals.push({ id: o.noteId, date: o.date, ...c });
  }

  // 4. Tracks.
  const contributing: ContributingNoteIds = {
    trackA: [],
    trackBRolling: [],
    trackBCalendarYear: [],
    trackC: [],
    unknownDwelling: [],
    unknownDwellingCalendarYear: [],
    legacyFlagged,
  };
  for (const d of deals) {
    const inWindow = d.date > windowStartExclusive && d.date <= consummationDate;
    const inYear = d.date.slice(0, 4) === consummationDate.slice(0, 4);
    if (inWindow) {
      contributing.trackC.push(d.id);
      if (d.dwelling === "yes") contributing.trackA.push(d.id);
      if (d.dwelling === "yes" && d.consumer === "yes") contributing.trackBRolling.push(d.id);
      if (d.dwelling === "unknown") contributing.unknownDwelling.push(d.id);
    }
    if (inYear) {
      if (d.dwelling === "yes" && d.consumer === "yes") contributing.trackBCalendarYear.push(d.id);
      if (d.dwelling === "unknown" && d.consumer !== "no") contributing.unknownDwellingCalendarYear.push(d.id);
    }
  }
  for (const key of Object.keys(contributing) as Array<keyof ContributingNoteIds>) {
    contributing[key].sort((a, b) => a - b);
  }

  return {
    trackA: contributing.trackA.length,
    trackBRolling: contributing.trackBRolling.length,
    trackBCalendarYear: contributing.trackBCalendarYear.length,
    trackC: contributing.trackC.length,
    unknownDwelling: contributing.unknownDwelling.length,
    unknownDwellingCalendarYear: contributing.unknownDwellingCalendarYear.length,
    legacyFlagged: contributing.legacyFlagged.length,
    contributing,
    sellerKey,
    window: { startExclusive: windowStartExclusive, endInclusive: consummationDate, calendarYear },
    orphanedActivationIds: orphanSnapshots.map((o) => o.noteId).sort((a, b) => a - b),
    sellerKeyLimitation: SELLER_KEY_LIMITATION,
  };
}
