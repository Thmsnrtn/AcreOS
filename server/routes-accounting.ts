/**
 * Accounting Routes — Lavender Week 10 monthly-close + Olympia 1099 batch.
 *
 * Founder-gated for v1; later exposed to all org owners (the production-
 * ready surface will include a permission check on the org-membership
 * role rather than the founder flag). The routes are mounted under
 * `/api/accounting/*` from server/routes.ts.
 *
 *   GET  /api/accounting/trial-balance?asOfDate=YYYY-MM-DD
 *   GET  /api/accounting/general-ledger.pdf?from=&to=
 *   GET  /api/accounting/qbo-export?from=&to=&format=iif|json
 *   POST /api/accounting/1099-batch?taxYear=2026
 *   GET  /api/accounting/1099-batch/:jobId
 */

import { Router, type Response } from "express";
import { type AuthenticatedRequest, getOrganization } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { generateTrialBalance } from "./services/trialBalance";
import { generateGeneralLedgerPdf } from "./services/glPdfExport";
import { exportLedgerAsIIF, exportLedgerAsQBOJournal } from "./services/qboExport";
import {
  generate1099Batch,
  getForm1099BatchStatus,
} from "./services/form1099Batch";
import { TaxIdentityError } from "./services/bookkeeping";

const router = Router();

/** Founder-only middleware shim — keeps the gate consistent across routes. */
function requireFounder(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.isFounder) {
    Errors.forbidden(res, "Accounting endpoints are currently founder-only");
    return false;
  }
  return true;
}

// ── GET /trial-balance ────────────────────────────────────────────────────
router.get("/trial-balance", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const org = getOrganization(req);
    const asOfRaw = (req.query.asOfDate as string) ?? new Date().toISOString().slice(0, 10);
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null;
    if (!asOf) {
      return Errors.badRequest(res, "asOfDate must be YYYY-MM-DD");
    }
    const tb = await generateTrialBalance(org.id, asOf);
    res.json(tb);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /general-ledger.pdf ───────────────────────────────────────────────
router.get("/general-ledger.pdf", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const org = getOrganization(req);
    const from = (req.query.from as string) ?? `${new Date().getFullYear()}-01-01`;
    const to = (req.query.to as string) ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return Errors.badRequest(res, "from/to must be YYYY-MM-DD");
    }
    const pdf = await generateGeneralLedgerPdf({
      organizationId: org.id,
      organizationName: org.name,
      fromDate: from,
      toDate: to,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="general-ledger-${from}-to-${to}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /qbo-export ───────────────────────────────────────────────────────
router.get("/qbo-export", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const org = getOrganization(req);
    const from = (req.query.from as string) ?? `${new Date().getFullYear()}-01-01`;
    const to = (req.query.to as string) ?? new Date().toISOString().slice(0, 10);
    const format = ((req.query.format as string) || "json").toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return Errors.badRequest(res, "from/to must be YYYY-MM-DD");
    }

    if (format === "iif") {
      const text = await exportLedgerAsIIF(org.id, from, to);
      res.setHeader("Content-Type", "text/plain");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="acreos-journal-${from}-to-${to}.iif"`,
      );
      res.send(text);
      return;
    }

    const out = await exportLedgerAsQBOJournal(org.id, from, to);
    res.json(out);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── POST /1099-batch ──────────────────────────────────────────────────────
router.post("/1099-batch", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const org = getOrganization(req);
    const taxYear = parseInt((req.query.taxYear as string) ?? String(new Date().getFullYear() - 1));
    if (Number.isNaN(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return Errors.badRequest(res, "taxYear must be a valid 4-digit year");
    }
    const result = await generate1099Batch(org.id, taxYear);
    logger.info("accounting.1099Batch.completed", {
      organizationId: org.id,
      taxYear,
      formCount: result.formCount,
      fireBytes: result.fireFileBytes,
    });
    res.json({
      jobId: result.jobId,
      status: result.status,
      formCount: result.formCount,
      totalInterestCents: result.totalInterestCents,
      fireRecordCounts: result.fireRecordCounts,
      fireFileBytes: result.fireFileBytes,
      errors: result.errors,
    });
  } catch (err) {
    if (err instanceof TaxIdentityError) {
      return res.status(422).json({
        error: "tax_identity_missing",
        message: err.message,
        code: err.code,
        orgId: err.orgId,
        noteId: err.noteId,
        statusCode: 422,
      });
    }
    Errors.internal(res, err);
  }
});

// ── GET /1099-batch/:jobId ────────────────────────────────────────────────
router.get("/1099-batch/:jobId", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const org = getOrganization(req);
    const jobId = req.params.jobId;
    const row = await getForm1099BatchStatus(jobId);
    if (!row) return Errors.notFound(res, "Batch");
    if (row.organizationId !== org.id) {
      return Errors.forbidden(res, "Batch belongs to a different organization");
    }
    res.json({
      jobId: row.id,
      status: row.status,
      taxYear: row.taxYear,
      formCount: row.formCount,
      totalInterestCents: row.totalInterestCents,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      errorMessage: row.errorMessage,
      result: row.resultBlob,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
