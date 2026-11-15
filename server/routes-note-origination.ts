/**
 * Origination records + seller-finance counter routes — Notes V2 Leg 3
 * (ORIGINATED book: integer `notes.id`). Spec:
 * docs/evidence/2026-11-09/notes-v2-leg3-step0.md and its coordinator rulings.
 *
 *   GET  /api/notes/:id/seller-finance-count     the counter for the note's seller at the
 *                                                note's consummation date (read only)
 *   POST /api/notes/:id/origination-facts        record the operator's origination facts
 *   POST /api/notes/:id/rmlo-engagement          record a stated RMLO engagement
 *   GET  /api/notes/:id/origination-records      the note's records, newest first
 *   POST /api/founder/seller-finance/threshold-release
 *                                                founder only: record a creditor-threshold
 *                                                release for an org + seller + calendar year
 *
 * The acquired book's routes (routes-notes.ts, routes-note-*.ts) take UUID
 * ids; these take positive integers. The two books never share a route, and
 * a non-integer id here is a 404, never a fall-through into the other book.
 *
 * Same guard as the Leg 1/Leg 2 note routes (owner or admin). Another org's
 * note is a 404. Every write is one append-only note_origination_records row
 * (migration 0307, PROVISIONAL) attributed to the signed-in user; nothing here
 * changes a note's status — activation stays behind the gate in
 * storage.createNote / storage.updateNote.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { notes, noteOriginationRecords, type NoteOriginationRecordKind } from "@shared/schema";
import {
  isCompleteRmloEngagement,
  originationFactsDetail,
  rmloEngagementDetail,
  type ThresholdReleaseDetail,
} from "@shared/notes/sellerFinanceGate";
import { isAuthenticated, requireFounder } from "./auth";
import { db } from "./db";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { isFounderUserId } from "./services/founder";
import { realNote } from "./services/onboarding/sampleFilters";
import { storage } from "./storage";
import { getClerkAuth, getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { clock } from "./utils/clock";
import { Errors } from "./utils/errors";
import { routeParam } from "./utils/routeParams";

/** The seller-key limitation on every counter read is the counter's own
 * SELLER_KEY_LIMITATION (ruling R3) — one sentence, stated by the service
 * that owns the key, imported at each use site below. */

/** The standing sentence on every RMLO engagement response. The licence itself is never checked. */
const RMLO_COMPLETENESS_STATEMENT =
  "AcreOS checks only that the stated fields are complete: the originator's name, the licence identifier as the originator stated it, and the engagement date. The licence is not looked up in NMLS or any other registry, and this record says nothing about whether it exists or is current.";

/** A positive integer note id on the originated book, else null (→ 404). */
function originatedNoteId(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= 2_147_483_647 ? n : null;
}

/**
 * Request bodies: the record's detail fields — the SAME validators as the
 * shared detail schema of its kind (its `.shape`, so the two cannot drift) —
 * plus an optional `supersedesId`. Every detail field is required, so a
 * misspelt key fails as a missing one. Any other key (including server-owned
 * ones: organizationId, recordedBy, noteId …) is dropped, never stored: the
 * route composes those from the session and the path.
 */
const supersedesId = z.uuid().nullable().optional();
const originationFactsBody = z.object({ ...originationFactsDetail.shape, supersedesId });
const rmloEngagementBody = z.object({ ...rmloEngagementDetail.shape, supersedesId });

/**
 * A supersedesId must name a record of the same kind, for this note, in this
 * org, that nothing supersedes yet. Returns the refusal message, or null.
 */
async function supersedesRefusal(
  organizationId: number,
  noteId: number,
  kind: NoteOriginationRecordKind,
  supersedesId: string,
): Promise<string | null> {
  const [target] = await db
    .select({ id: noteOriginationRecords.id })
    .from(noteOriginationRecords)
    .where(
      and(
        eq(noteOriginationRecords.organizationId, organizationId),
        eq(noteOriginationRecords.noteId, noteId),
        eq(noteOriginationRecords.kind, kind),
        eq(noteOriginationRecords.id, supersedesId),
      ),
    )
    .limit(1);
  if (!target) return `supersedesId ${supersedesId} is not a ${kind} record for this note.`;
  const [already] = await db
    .select({ id: noteOriginationRecords.id })
    .from(noteOriginationRecords)
    .where(and(eq(noteOriginationRecords.organizationId, organizationId), eq(noteOriginationRecords.supersedesId, supersedesId)))
    .limit(1);
  if (already) return `Record ${supersedesId} is already superseded by ${already.id}. Supersede the current record instead.`;
  return null;
}

function serializeRecord(r: typeof noteOriginationRecords.$inferSelect) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    noteId: r.noteId,
    noteIdAtRecord: r.noteIdAtRecord,
    kind: r.kind,
    detail: r.detail,
    supersedesId: r.supersedesId,
    recordedBy: r.recordedBy,
    recordedAt: r.recordedAt.toISOString(),
  };
}

const thresholdReleaseBody = z
  .object({
    organizationId: z.number().int().positive(),
    /** R3 seller key; null = the organization itself. */
    sellerKey: z.string().nullable(),
    calendarYear: z.number().int().min(1900).max(9999),
    decisionRef: z.string().trim().min(1).max(500),
  })
  .strict();

export function registerNoteOriginationRoutes(app: Express): void {
  const guard = [isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"])] as const;

  // ── The counter, read for one note ──────────────────────────────────────────
  app.get("/api/notes/:id/seller-finance-count", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const noteId = originatedNoteId(routeParam(req.params.id));
      if (noteId === null) return Errors.notFound(res, "Note");
      const organizationId = getOrganizationId(req);
      const note = await storage.getNote(organizationId, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const { resolveGateFacts } = await import("./services/notes/originationGate");
      const { countSellerFinance, SELLER_KEY_LIMITATION } = await import("./services/notes/sellerFinanceCounter");
      // The gate's own resolution (R3/R7): the governing origination-facts
      // record's seller key and consummation date, else the note's
      // owning_entity and start_date. The read and the gate cannot disagree
      // about which seller or which date is being counted.
      const resolved = await resolveGateFacts(db, organizationId, note, clock.now().toISOString());
      // No excludeNoteId: this is a read, not a gate. The note counts itself
      // when it is consummated (it meets the counter's population predicate).
      const counted = await countSellerFinance(db, {
        organizationId,
        sellerKey: resolved.facts.sellerKey,
        consummationDate: resolved.consummationDate,
      });

      return res.json({
        noteId,
        sellerKey: counted.sellerKey,
        consummationDate: resolved.consummationDate,
        consummationDateSource: resolved.factsRecordId !== null ? "origination_facts" : "start_date",
        factsRecordId: resolved.factsRecordId,
        includesThisNote: counted.contributing.trackC.includes(noteId),
        window: {
          rolling12MonthsStartExclusive: counted.window.startExclusive,
          rolling12MonthsEndInclusive: counted.window.endInclusive,
          calendarYear: counted.window.calendarYear,
        },
        counts: {
          trackA_dwellingSecuredRolling12Months: counted.trackA,
          trackB_dwellingSecuredConsumerRolling12Months: counted.trackBRolling,
          trackB_dwellingSecuredConsumerCalendarYear: counted.trackBCalendarYear,
          trackC_allSellerFinancedRolling12Months: counted.trackC,
          unknownDwellingRolling12Months: counted.unknownDwelling,
          unknownDwellingCalendarYear: counted.unknownDwellingCalendarYear,
          legacyFlaggedNotCounted: counted.legacyFlagged,
        },
        contributingNoteIds: counted.contributing,
        orphanedActivationNoteIds: counted.orphanedActivationIds,
        sellerKeyLimitation: SELLER_KEY_LIMITATION,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Origination facts ──────────────────────────────────────────────────────
  app.post("/api/notes/:id/origination-facts", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const noteId = originatedNoteId(routeParam(req.params.id));
      if (noteId === null) return Errors.notFound(res, "Note");
      const organizationId = getOrganizationId(req);
      const note = await storage.getNote(organizationId, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const parsed = originationFactsBody.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { supersedesId: supersedes, ...detail } = parsed.data;
      if (supersedes) {
        const refusal = await supersedesRefusal(organizationId, noteId, "origination_facts", supersedes);
        if (refusal) return Errors.badRequest(res, refusal);
      }

      const [row] = await db
        .insert(noteOriginationRecords)
        .values({
          organizationId,
          noteId,
          noteIdAtRecord: noteId,
          kind: "origination_facts",
          detail,
          supersedesId: supersedes ?? null,
          recordedBy: getUserId(req),
        })
        .returning();
      return res.json({ record: serializeRecord(row) });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── RMLO engagement ────────────────────────────────────────────────────────
  app.post("/api/notes/:id/rmlo-engagement", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const noteId = originatedNoteId(routeParam(req.params.id));
      if (noteId === null) return Errors.notFound(res, "Note");
      const organizationId = getOrganizationId(req);
      const note = await storage.getNote(organizationId, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const parsed = rmloEngagementBody.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { supersedesId: supersedes, ...detail } = parsed.data;
      if (supersedes) {
        const refusal = await supersedesRefusal(organizationId, noteId, "rmlo_engagement", supersedes);
        if (refusal) return Errors.badRequest(res, refusal);
      }

      const [row] = await db
        .insert(noteOriginationRecords)
        .values({
          organizationId,
          noteId,
          noteIdAtRecord: noteId,
          kind: "rmlo_engagement",
          detail,
          supersedesId: supersedes ?? null,
          recordedBy: getUserId(req),
        })
        .returning();
      return res.json({
        record: serializeRecord(row),
        complete: isCompleteRmloEngagement(row.detail),
        completenessStatement: RMLO_COMPLETENESS_STATEMENT,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── The note's records ─────────────────────────────────────────────────────
  app.get("/api/notes/:id/origination-records", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const noteId = originatedNoteId(routeParam(req.params.id));
      if (noteId === null) return Errors.notFound(res, "Note");
      const organizationId = getOrganizationId(req);
      const note = await storage.getNote(organizationId, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const rows = await db
        .select()
        .from(noteOriginationRecords)
        .where(and(eq(noteOriginationRecords.organizationId, organizationId), eq(noteOriginationRecords.noteId, noteId)))
        .orderBy(desc(noteOriginationRecords.recordedAt), desc(noteOriginationRecords.id));
      return res.json({ noteId, records: rows.map(serializeRecord) });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Founder: creditor-threshold release (R4) ───────────────────────────────
  //
  // A threshold release is per org + seller + calendar year, but the 0307
  // table requires note_id_at_record NOT NULL. So the release is anchored
  // on the seller's most recent consummated note in that org (storage
  // only); its seller scope travels IN the detail's sellerKey, and the
  // gate (originationGate.hasThresholdReleaseFor) matches on that key
  // directly — never re-derived from the anchor note, whose facts can
  // change later. No consummated note for the seller means there is
  // nothing to release, and the request is refused by name.
  app.post(
    "/api/founder/seller-finance/threshold-release",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = thresholdReleaseBody.safeParse(req.body ?? {});
        if (!body.success) return Errors.validationFailed(res, body.error.issues);
        const { organizationId, calendarYear, decisionRef } = body.data;

        // The gate honours a release only when isFounderUserId(recorded_by)
        // holds, and FOUNDER_USER_IDS holds Clerk user ids. requireFounder
        // also admits by email, so a founder admitted by email alone would
        // write a release the gate then ignores. Refuse that instead of
        // writing a dead record.
        const founderClerkId = getClerkAuth(req)?.userId ?? req.user.clerkUserId ?? null;
        if (!founderClerkId || !isFounderUserId(founderClerkId)) {
          return Errors.forbidden(
            res,
            "A threshold release is honoured only when its recorder's Clerk user id is in FOUNDER_USER_IDS. This session's founder access comes from the founder email list, so the release would be recorded and then ignored by the gate. Add the Clerk user id to FOUNDER_USER_IDS and retry.",
          );
        }

        const { loadFactsHeads, normalizeSellerKey, countSellerFinance, SELLER_KEY_LIMITATION } = await import(
          "./services/notes/sellerFinanceCounter"
        );
        const sellerKey = body.data.sellerKey === null ? null : normalizeSellerKey(body.data.sellerKey);

        // The seller's consummated notes in that org — the counter's own
        // population predicate (R8 / §8.1), synthetic rows excluded (R6).
        const consummated = await db
          .select({ id: notes.id, owningEntity: notes.owningEntity, startDate: notes.startDate })
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
            ),
          )
          .orderBy(desc(notes.startDate), desc(notes.id));
        // A note's seller is its governing facts record's seller key, else its
        // owning_entity — the same attribution the gate uses on read.
        const heads = await loadFactsHeads(
          db,
          organizationId,
          consummated.map((n) => n.id),
        );
        const anchor = consummated.find((n) => {
          const head = heads.get(n.id);
          const key = head
            ? head.detail.sellerKey === null
              ? null
              : normalizeSellerKey(head.detail.sellerKey)
            : normalizeSellerKey(n.owningEntity);
          return key === sellerKey;
        });
        if (!anchor) {
          return Errors.unprocessable(
            res,
            `There is nothing to release: organization ${organizationId} has no consummated note for seller ${sellerKey === null ? "(the organization itself)" : `"${sellerKey}"`}.`,
            { reason: "NO_CONSUMMATED_NOTE_FOR_SELLER", organizationId, sellerKey, calendarYear },
          );
        }

        // Counts at write time, by the counter: as of today in the current
        // year, else as of the year's last day.
        const today = clock.now().toISOString().slice(0, 10);
        const asOf = Number(today.slice(0, 4)) === calendarYear ? today : `${calendarYear}-12-31`;
        const counted = await countSellerFinance(db, { organizationId, sellerKey, consummationDate: asOf });

        // Built server-side, typed to the 0307 detail shape (every value
        // comes from the validated body or the counter).
        const detail: ThresholdReleaseDetail = {
          threshold: "creditor_1026_2_a_17_v",
          sellerKey,
          calendarYear,
          rollingCount: counted.trackBRolling,
          calendarYearCount: counted.trackBCalendarYear,
          decisionRef,
        };
        const [row] = await db
          .insert(noteOriginationRecords)
          .values({
            organizationId,
            noteId: anchor.id,
            noteIdAtRecord: anchor.id,
            kind: "threshold_release",
            detail,
            recordedBy: founderClerkId,
          })
          .returning();

        return res.json({
          record: serializeRecord(row),
          scope: { organizationId, sellerKey, calendarYear },
          anchorNoteId: anchor.id,
          anchorNote:
            "The release is stored against this seller's most recent consummated note because the record table requires a note. Its scope is the organization, seller and calendar year above, not that one note.",
          countsAsOf: asOf,
          counts: {
            trackB_dwellingSecuredConsumerRolling12Months: counted.trackBRolling,
            trackB_dwellingSecuredConsumerCalendarYear: counted.trackBCalendarYear,
            unknownDwellingRolling12Months: counted.unknownDwelling,
            unknownDwellingCalendarYear: counted.unknownDwellingCalendarYear,
          },
          sellerKeyLimitation: SELLER_KEY_LIMITATION,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
