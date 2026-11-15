/**
 * T277 — Dodd-Frank Compliance Routes
 *
 * POST /api/dodd-frank/check — run compliance check for a seller-financed deal
 *
 * Notes V2 Leg 3 §5.5: an optional `noteId` (an ORIGINATED-book note, integer
 * id) makes the count come from the organization's own book instead of the
 * typed number:
 *  - noteId present → the note is loaded org-scoped (absent or another org's
 *    → 404); the seller-finance counter supplies the tracks for that note's
 *    seller at its consummation date, and the count the checker evaluates is
 *    track (a) — dwelling-secured deals in the rolling 12 months — including
 *    this deal. `countSource: "book"`; the unknown-dwelling bucket is returned
 *    alongside it, not folded in, so nothing is hidden. (The activation gate,
 *    not this advisory page, is where unknown-dwelling rows count
 *    conservatively as dwelling-secured — ruling R2.)
 *  - noteId absent → the typed `sellerFinancedDealsLast12Months` stands,
 *    `countSource: "hypothetical"`.
 * Every other request and response field is unchanged.
 *
 * Guard: a request carrying a `noteId` reads real book counts, so it takes the
 * same `requireRole(["owner", "admin"])` guard as the counter GET in
 * routes-note-origination.ts; the typed/hypothetical path stays open to any
 * authenticated org member.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { checkDoddFrankCompliance } from "./services/doddFrankChecker";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { db } from "./db";
import { storage } from "./storage";
import { getOrganizationId, type AuthenticatedRequest } from "./types/request";
import { clock } from "./utils/clock";
import { Errors } from "./utils/errors";

const router = Router();

const noteIdSchema = z.number().int().positive().max(2_147_483_647);

/** The book-derived count, or the 404 / 400 that stops the check. */
async function bookCount(organizationId: number, noteId: number) {
  const note = await storage.getNote(organizationId, noteId);
  if (!note) return null;
  const { resolveGateFacts } = await import("./services/notes/originationGate");
  const { countSellerFinance, SELLER_KEY_LIMITATION } = await import("./services/notes/sellerFinanceCounter");
  const resolved = await resolveGateFacts(db, organizationId, note, clock.now().toISOString());
  const counted = await countSellerFinance(db, {
    organizationId,
    sellerKey: resolved.facts.sellerKey,
    consummationDate: resolved.consummationDate,
  });
  // The checker's count is "including this one". A consummated,
  // dwelling-secured note is already in track (a); otherwise this deal is
  // added once.
  const alreadyCounted = counted.contributing.trackA.includes(noteId);
  return {
    evaluationCount: counted.trackA + (alreadyCounted ? 0 : 1),
    bookCounts: {
      noteId,
      sellerKey: counted.sellerKey,
      consummationDate: resolved.consummationDate,
      consummationDateSource: resolved.factsRecordId !== null ? "origination_facts" : "start_date",
      trackA_dwellingSecuredRolling12Months: counted.trackA,
      trackB_dwellingSecuredConsumerRolling12Months: counted.trackBRolling,
      trackB_dwellingSecuredConsumerCalendarYear: counted.trackBCalendarYear,
      trackC_allSellerFinancedRolling12Months: counted.trackC,
      unknownDwellingRolling12Months: counted.unknownDwelling,
      unknownDwellingCalendarYear: counted.unknownDwellingCalendarYear,
      legacyFlaggedNotCounted: counted.legacyFlagged,
      thisDealAddedToTrackA: !alreadyCounted,
      evaluatedCount: "track (a) including this deal; the unknown-dwelling bucket is reported here and not added",
      sellerKeyLimitation: SELLER_KEY_LIMITATION,
    },
  };
}

const bookCountRoleGuard = requireRole(["owner", "admin"]);

/** The noteId (book-count) branch requires owner/admin; the typed path does not. */
function requireRoleWhenNoteId(req: Request, res: Response, next: NextFunction) {
  const noteId = req.body?.noteId;
  if (noteId === undefined || noteId === null) return next();
  return bookCountRoleGuard(req, res, next);
}

router.post("/check", getOrCreateOrg, requireRoleWhenNoteId, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      noteId: rawNoteId,
      sellerFinancedDealsLast12Months: typedCount,
      sellerType,
      hasDwelling,
      sellerConstructedDwelling,
      isSellerResidence,
      loanTermMonths,
      rateType,
      balloonAfterMonths,
      interestRate,
      firstRateAdjustmentMonths,
      abilityToRepayDetermined,
      negativeAmortization,
    } = req.body ?? {};

    const fromBook = rawNoteId !== undefined && rawNoteId !== null;
    if (fromBook && !noteIdSchema.safeParse(rawNoteId).success) {
      return Errors.badRequest(res, "noteId must be a positive integer note id");
    }

    if ((!fromBook && typedCount == null) || !sellerType || hasDwelling == null || !rateType || interestRate == null) {
      return Errors.badRequest(res, "Required: sellerFinancedDealsLast12Months, sellerType, hasDwelling, rateType, interestRate");
    }

    let sellerFinancedDealsLast12Months = typedCount;
    let book: Awaited<ReturnType<typeof bookCount>> = null;
    if (fromBook) {
      book = await bookCount(getOrganizationId(req), rawNoteId as number);
      if (!book) return Errors.notFound(res, "Note");
      sellerFinancedDealsLast12Months = book.evaluationCount;
    }

    let result;
    try {
      result = checkDoddFrankCompliance({
        sellerFinancedDealsLast12Months,
        sellerType,
        hasDwelling,
        sellerConstructedDwelling: sellerConstructedDwelling ?? false,
        isSellerResidence,
        loanTermMonths: loanTermMonths ?? 60,
        rateType,
        balloonAfterMonths,
        interestRate,
        firstRateAdjustmentMonths: typeof firstRateAdjustmentMonths === "number" ? firstRateAdjustmentMonths : undefined,
        abilityToRepayDetermined: typeof abilityToRepayDetermined === "boolean" ? abilityToRepayDetermined : undefined,
        negativeAmortization: typeof negativeAmortization === "boolean" ? negativeAmortization : undefined,
      });
    } catch (err: unknown) {
      return Errors.badRequest(res, err instanceof Error ? err.message : String(err));
    }

    if (book) {
      return res.json({
        ...result,
        countSource: "book",
        sellerFinancedDealsLast12Months,
        ...(typedCount != null ? { typedCountIgnored: typedCount } : {}),
        bookCounts: book.bookCounts,
      });
    }
    return res.json({ ...result, countSource: "hypothetical" });
  } catch (err) {
    return Errors.internal(res, err);
  }
});

export default router;
