/**
 * Fix-and-flip vertical FF-5 — bid comparison.
 *
 * Devon §2.2: "Two of my three GCs sent bids on Cherokee yesterday — $58K,
 * $71K, $63K — for the same scope. I want to put them side-by-side: line
 * by line, where does Marcus go cheaper than Tony on flooring; where does
 * Carlos pad the demolition. AcreOS has no bid-comparison surface."
 *
 *   GET    /api/rehabs/:id/bids                  — list bids w/ side-by-side
 *   POST   /api/rehabs/:id/bids                  — record a bid
 *   PATCH  /api/bids/:id                         — update
 *   POST   /api/bids/:id/accept                  — mark accepted (others rejected)
 *   DELETE /api/bids/:id
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { db } from "./db";
import { bidEstimates, contractors, rehabLineItems, rehabs, REHAB_LINE_CATEGORIES } from "@shared/schema";
import { refuseRedeemableDeedSpend } from "./services/tax/landExit";
import { bidVsEstimate } from "@shared/rehab/variance";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { createUploadMiddleware, validateFileMiddleware } from "./middleware/fileUploadSecurity";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";

// FW-6: PDF estimate upload — 10MB cap. PDFs only.
const pdfUpload = createUploadMiddleware({ maxSizeMB: 10, allowedTypes: ["pdf"] });
const validatePdf = validateFileMiddleware(["pdf"]);

const bidSchema = z.object({
  contractorId: z.string().uuid(),
  totalCents: z.coerce.number().int().nonnegative(),
  submittedAt: z.string().optional(),
  validUntil: z.string().optional(),
  // Per-category breakdown — keys must be valid categories.
  categoryBreakdown: z.record(z.enum(REHAB_LINE_CATEGORIES), z.coerce.number().int().nonnegative()).optional(),
  notes: z.string().optional(),
});

const updateSchema = bidSchema.partial();

const applyToLinesSchema = z.object({
  categories: z.array(z.enum(REHAB_LINE_CATEGORIES)).min(1).max(REHAB_LINE_CATEGORIES.length),
  /** Required to overwrite a committed amount the operator already entered on a line. */
  replaceCommitted: z.boolean().default(false),
});

export function registerBidEstimateRoutes(app: Express): void {
  // List bids for a rehab — includes side-by-side category matrix.
  app.get("/api/rehabs/:id/bids", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rehabId = routeParam(req.params.id);

      const bids = await db.select()
        .from(bidEstimates)
        .where(and(eq(bidEstimates.rehabId, rehabId), eq(bidEstimates.organizationId, orgId)))
        .orderBy(asc(bidEstimates.totalCents));

      // Pull contractor names.
      const contractorIds = Array.from(new Set(bids.map((b) => b.contractorId).filter(Boolean)));
      const contractorRows = contractorIds.length > 0
        ? await db.select({ id: contractors.id, name: contractors.name, businessName: contractors.businessName })
            .from(contractors)
            .where(eq(contractors.organizationId, orgId))
        : [];
      const nameById = new Map(contractorRows.map((c) => [c.id, c.businessName ?? c.name]));

      // Side-by-side: union of all category keys, then per-category cents per
      // bid plus per-category min/max + delta to the cheapest bid.
      const allCategories = new Set<string>();
      for (const b of bids) {
        for (const k of Object.keys((b.categoryBreakdown as any) ?? {})) allCategories.add(k);
      }
      const categories = Array.from(allCategories).sort();

      const matrix = categories.map((cat) => {
        const cellsByBid = bids.map((b) => ({
          bidId: b.id,
          contractorName: nameById.get(b.contractorId ?? "") ?? "Unknown",
          cents: ((b.categoryBreakdown as any) ?? {})[cat] ?? null,
        }));
        const valued = cellsByBid.filter((c) => c.cents !== null) as Array<{ bidId: string; contractorName: string; cents: number }>;
        const minCells = valued.length > 0 ? Math.min(...valued.map((c) => c.cents)) : null;
        const maxCells = valued.length > 0 ? Math.max(...valued.map((c) => c.cents)) : null;
        return {
          category: cat,
          cells: cellsByBid,
          minCents: minCells,
          maxCents: maxCells,
          spreadCents: minCells !== null && maxCells !== null ? maxCells - minCells : null,
        };
      });

      // Each bid's category amounts beside this project's own estimate for the
      // category — arithmetic, not a verdict on the contractor (Leg 2 §4.5).
      const lines = await db
        .select({ id: rehabLineItems.id, category: rehabLineItems.category, scope: rehabLineItems.scope, budgetCents: rehabLineItems.budgetCents, committedCents: rehabLineItems.committedCents, spentCents: rehabLineItems.spentCents })
        .from(rehabLineItems)
        .where(and(eq(rehabLineItems.rehabId, rehabId), eq(rehabLineItems.organizationId, orgId)));
      const estimateLines = lines.map((l) => ({ ...l, id: String(l.id) }));

      return res.json({
        bids: bids.map((b) => ({
          ...b,
          contractorName: nameById.get(b.contractorId ?? "") ?? "Unknown",
          vsEstimate: bidVsEstimate((b.categoryBreakdown as Record<string, number>) ?? {}, estimateLines),
        })),
        categories,
        matrix,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Create.
  app.post("/api/rehabs/:id/bids", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const rehabId = routeParam(req.params.id);
      const parsed = bidSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // If categoryBreakdown supplied, total should equal sum of breakdown.
      // Don't enforce — operator may add line items not in our enum yet.
      const [created] = await db.insert(bidEstimates).values({
        organizationId: orgId,
        rehabId,
        contractorId: parsed.data.contractorId,
        totalCents: parsed.data.totalCents,
        submittedAt: parsed.data.submittedAt ?? null,
        validUntil: parsed.data.validUntil ?? null,
        categoryBreakdown: parsed.data.categoryBreakdown ?? {},
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[FF-5] bid recorded", { orgId, userId, rehabId, bidId: created.id, total: parsed.data.totalCents });
      return res.status(201).json({ bid: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Update.
  app.patch("/api/bids/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: clock.now() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(bidEstimates).set(updates)
        .where(and(eq(bidEstimates.id, routeParam(req.params.id)), eq(bidEstimates.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Bid");
      return res.json({ bid: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Accept — flips this bid to accepted, marks all others on the same rehab rejected.
  app.post("/api/bids/:id/accept", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const [target] = await db.select().from(bidEstimates)
        .where(and(eq(bidEstimates.id, routeParam(req.params.id)), eq(bidEstimates.organizationId, orgId)));
      if (!target) return Errors.notFound(res, "Bid");

      await db.transaction(async (tx) => {
        await tx.update(bidEstimates).set({ isAccepted: false, rejectedAt: clock.now(), updatedAt: clock.now() })
          .where(and(
            eq(bidEstimates.organizationId, orgId),
            eq(bidEstimates.rehabId, target.rehabId as string),
          ));
        await tx.update(bidEstimates).set({ isAccepted: true, rejectedAt: null, updatedAt: clock.now() })
          .where(eq(bidEstimates.id, target.id));
      });

      logger.info("[FF-5] bid accepted", { orgId, userId, bidId: target.id });
      return res.json({ accepted: true, id: target.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Apply an ACCEPTED bid's category amounts to the project's lines as their
  // committed figure (fix-and-flip package, Leg 2 §4.1). An explicit act the
  // operator confirms per category — accepting a bid writes nothing to the
  // lines. A category maps only when exactly one line on the project carries
  // it; otherwise the whole request is refused, naming the categories, so a
  // partial copy never lands. Estimates are not touched (they may be locked);
  // committed stays the operator's to change afterwards.
  app.post("/api/bids/:id/apply-to-lines", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = applyToLinesSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const [bid] = await db.select().from(bidEstimates)
        .where(and(eq(bidEstimates.id, routeParam(req.params.id)), eq(bidEstimates.organizationId, orgId)));
      if (!bid) return Errors.notFound(res, "Bid");
      if (!bid.isAccepted) {
        return Errors.badRequest(res, "Only an accepted bid can set what is committed. Accept this bid first.");
      }
      // Committing contractor amounts is rehab spend on the parcel (V-Tax-1 T4b).
      const [owner] = await db.select({ propertyId: rehabs.propertyId }).from(rehabs)
        .where(and(eq(rehabs.id, bid.rehabId as string), eq(rehabs.organizationId, orgId)));
      if (!owner) return Errors.notFound(res, "Rehab");
      if (!(await refuseRedeemableDeedSpend(res, orgId, owner.propertyId, "Committing a bid to rehab lines"))) return;
      const breakdown = (bid.categoryBreakdown as Record<string, number>) ?? {};
      const lines = await db.select({ id: rehabLineItems.id, category: rehabLineItems.category, committedCents: rehabLineItems.committedCents })
        .from(rehabLineItems)
        .where(and(eq(rehabLineItems.rehabId, bid.rehabId as string), eq(rehabLineItems.organizationId, orgId)));

      const plan: Array<{ lineId: string; category: string; committedCents: number }> = [];
      const refused: Array<{ category: string; reason: string }> = [];
      for (const category of parsed.data.categories) {
        const amount = breakdown[category];
        const matches = lines.filter((l) => l.category === category);
        if (typeof amount !== "number") refused.push({ category, reason: "This bid has no amount for this category." });
        else if (matches.length === 0) refused.push({ category, reason: "The project has no line in this category." });
        else if (matches.length > 1) refused.push({ category, reason: `The project has ${matches.length} lines in this category — enter the committed amount on each line yourself.` });
        else if (!parsed.data.replaceCommitted && Number(matches[0].committedCents) > 0 && Number(matches[0].committedCents) !== Math.round(amount)) {
          refused.push({ category, reason: `The line already has $${Math.round(Number(matches[0].committedCents) / 100).toLocaleString("en-US")} committed — choose to replace it if this bid supersedes it.` });
        } else plan.push({ lineId: String(matches[0].id), category, committedCents: Math.round(amount) });
      }
      if (refused.length > 0) {
        return Errors.badRequest(res, `Nothing was applied. ${refused.map((r) => `${r.category}: ${r.reason}`).join(" ")}`, { refused });
      }
      await db.transaction(async (tx) => {
        for (const p of plan) {
          await tx.update(rehabLineItems).set({ committedCents: p.committedCents, updatedAt: clock.now() })
            .where(and(eq(rehabLineItems.id, p.lineId), eq(rehabLineItems.organizationId, orgId)));
        }
      });
      logger.info("[FF-5] accepted bid applied to lines as committed", { orgId, bidId: bid.id, lines: plan.length });
      return res.json({ applied: plan });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // CT-3: LLM extract a contractor estimate text → bid shape (preview only;
  // operator confirms before persistence). Devon §2.2: "drop three contractor
  // PDFs into a job, LLM-extract line items, normalize to your scope template,
  // show a side-by-side."
  app.post("/api/rehabs/:id/bids/extract", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const rawText = typeof req.body?.text === "string" ? req.body.text : null;
      if (!rawText || rawText.trim().length < 30) {
        return Errors.badRequest(res, "Estimate text is required (paste at least 30 chars from the PDF/email).");
      }
      const { extractBidEstimate } = await import("./services/bidEstimateExtractor");
      try {
        const extracted = await extractBidEstimate(rawText, orgId);
        logger.info("[FF-5/CT-3] bid extracted", {
          orgId, userId, rehabId: routeParam(req.params.id),
          totalCents: extracted.totalCents,
          confidence: extracted.confidence,
          warningCount: extracted.warnings.length,
        });
        return res.json({ extracted });
      } catch (err: any) {
        return Errors.badRequest(res, err.message ?? "Extraction failed");
      }
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // FW-6: PDF estimate upload — extracts text from the PDF, then pipes
  // through the existing extractBidEstimate() LLM extractor.
  app.post(
    "/api/rehabs/:id/bids/extract-pdf",
    isAuthenticated,
    getOrCreateOrg,
    pdfUpload.single("pdf"),
    validatePdf,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const file = req.file;
        if (!file) return Errors.badRequest(res, "No PDF uploaded.");

        let pdfText: string;
        try {
          // pdf-parse 2.x exports a function default that takes a Buffer.
          const pdfParseMod: any = await import("pdf-parse");
          const pdfParse = pdfParseMod.default ?? pdfParseMod;
          const parsed = await pdfParse(file.buffer);
          pdfText = String(parsed?.text ?? "").trim();
        } catch (err: any) {
          return Errors.badRequest(res, `PDF parse failed: ${err.message ?? "unknown error"}`);
        }

        if (pdfText.length < 30) {
          return Errors.badRequest(res, "Couldn't extract usable text from the PDF (got " + pdfText.length + " chars). Is it a scanned image? OCR support is on the roadmap.");
        }

        const { extractBidEstimate } = await import("./services/bidEstimateExtractor");
        try {
          const extracted = await extractBidEstimate(pdfText, orgId);
          logger.info("[FF-5/FW-6] bid extracted from PDF", {
            orgId, userId, rehabId: routeParam(req.params.id),
            filename: file.originalname,
            pdfChars: pdfText.length,
            totalCents: extracted.totalCents,
            confidence: extracted.confidence,
            warningCount: extracted.warnings.length,
          });
          return res.json({
            extracted,
            sourceText: pdfText.slice(0, 500),  // preview the parsed text so the UI can show "we read this"
            sourceCharCount: pdfText.length,
            filename: file.originalname,
          });
        } catch (err: any) {
          return Errors.badRequest(res, err.message ?? "Extraction failed");
        }
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.delete("/api/bids/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(bidEstimates)
        .where(and(eq(bidEstimates.id, routeParam(req.params.id)), eq(bidEstimates.organizationId, orgId)))
        .returning({ id: bidEstimates.id });
      if (!deleted) return Errors.notFound(res, "Bid");
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
