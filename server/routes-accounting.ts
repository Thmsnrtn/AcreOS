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
import { type AuthenticatedRequest, getOrganization, getClerkAuth } from "./types/request";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { stampTraceContext } from "./utils/queueTraceContext";
import { generateTrialBalance } from "./services/trialBalance";
import { generateGeneralLedgerPdf } from "./services/glPdfExport";
import { exportLedgerAsIIF, exportLedgerAsQBOJournal } from "./services/qboExport";
import {
  generate1099Batch,
  getForm1099BatchStatus,
} from "./services/form1099Batch";
import {
  generateInvestorStatementBatch,
  aggregateInvestorIncomeForYear,
} from "./services/investorStatementBatch";
import { TaxIdentityError } from "./services/bookkeeping";
import { db } from "./db";
import { outbox, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

/** Founder-only middleware shim — keeps the gate consistent across routes. */
function requireFounder(req: AuthenticatedRequest, res: Response): boolean {
  const user = req.user as any;
  const userId = getClerkAuth(req)?.userId ?? user?.clerkUserId ?? user?.id ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.notFound(res, "Resource");
    return false;
  }
  return true;
}

/**
 * Org-scoped customer-data gate. Owner / admin / founder can use it.
 * Distinct from requireFounder — applied to endpoints that produce
 * the customer's own org-scoped accounting outputs (their own 1099
 * forms, their own investor statements). Trial balance + GL stay
 * founder-only because they're cross-org introspection.
 */
function requireOrgOwnerOrAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (req.isFounder) return true;
  const role = (req.permissionContext as any)?.role as string | undefined;
  if (role === "owner" || role === "admin") return true;
  Errors.forbidden(res, "Owner or admin role required");
  return false;
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
// Synchronous render — kept for back-compat. New callers should POST the
// same path to enqueue the job onto the worker process group (below).
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

// ── POST /general-ledger.pdf — enqueue to worker ──────────────────────────
// Returns { jobId, status } immediately. Client polls
// `/api/accounting/general-ledger.pdf/job/:jobId` for completion. The
// `pdf_render` event flows through the `outbox` table and is consumed by
// the worker process group (see server/worker.ts) — keeps the customer-
// facing app machines from blocking on PDF render CPU.
router.post("/general-ledger.pdf", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const org = getOrganization(req);
    const from = (req.body?.from as string) ?? `${new Date().getFullYear()}-01-01`;
    const to = (req.body?.to as string) ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return Errors.badRequest(res, "from/to must be YYYY-MM-DD");
    }
    const [row] = await db
      .insert(outbox)
      .values({
        eventType: "pdf_render",
        status: "pending",
        attempts: 0,
        payload: stampTraceContext({
          variant: "general_ledger",
          organizationId: org.id,
          organizationName: org.name,
          fromDate: from,
          toDate: to,
        }),
      })
      .returning({ id: outbox.id });
    logger.info("accounting.generalLedger.enqueued", {
      organizationId: org.id,
      jobId: row?.id,
      from,
      to,
    });
    res.status(202).json({ jobId: row?.id, status: "pending" });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /general-ledger.pdf/job/:jobId — poll worker job status ───────────
router.get("/general-ledger.pdf/job/:jobId", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFounder(req, res)) return;
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) return Errors.badRequest(res, "jobId must be numeric");
    const [row] = await db.select().from(outbox).where(eq(outbox.id, jobId)).limit(1);
    if (!row) return Errors.notFound(res, "Job");
    if (row.eventType !== "pdf_render") {
      return Errors.notFound(res, "Job");
    }
    const org = getOrganization(req);
    if ((row.payload as any)?.organizationId !== org.id) {
      return Errors.forbidden(res, "Job belongs to a different organization");
    }
    res.json({
      jobId: row.id,
      status: row.status,
      attempts: row.attempts,
      lastErrorMessage: row.lastErrorMessage,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    });
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
// Wave: cost — opt-in worker dispatch via `?async=1`. Without that flag we
// preserve the prior synchronous behavior (this is what the current UI
// expects and what the existing GET /1099-batch/:jobId endpoint reads).
// With `async=1`, the request enqueues a `1099_batch_generate` event onto
// the outbox table (consumed by server/worker.ts) and returns 202 + outbox
// id; clients poll the existing /1099-batch/:jobId surface via the
// resolved internal jobId once the worker writes it back.
router.post("/1099-batch", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireOrgOwnerOrAdmin(req, res)) return;
  try {
    const org = getOrganization(req);
    const taxYear = parseInt((req.query.taxYear as string) ?? String(new Date().getFullYear() - 1));
    if (Number.isNaN(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return Errors.badRequest(res, "taxYear must be a valid 4-digit year");
    }

    // Async/worker path
    if (req.query.async === "1" || req.body?.async === true) {
      const [row] = await db
        .insert(outbox)
        .values({
          eventType: "1099_batch_generate",
          status: "pending",
          attempts: 0,
          payload: stampTraceContext({
            organizationId: org.id,
            taxYear,
          }),
        })
        .returning({ id: outbox.id });
      logger.info("accounting.1099Batch.enqueued", {
        organizationId: org.id,
        taxYear,
        outboxId: row?.id,
      });
      return res.status(202).json({
        outboxId: row?.id,
        status: "pending",
        message: "Batch enqueued; poll /api/accounting/1099-batch/job/:outboxId for status",
      });
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

// ── GET /1099-batch/job/:outboxId — poll outbox status for async batch ───
router.get("/1099-batch/job/:outboxId", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireOrgOwnerOrAdmin(req, res)) return;
  try {
    const outboxId = parseInt(req.params.outboxId, 10);
    if (Number.isNaN(outboxId)) return Errors.badRequest(res, "outboxId must be numeric");
    const [row] = await db.select().from(outbox).where(eq(outbox.id, outboxId)).limit(1);
    if (!row || row.eventType !== "1099_batch_generate") return Errors.notFound(res, "Job");
    const org = getOrganization(req);
    if ((row.payload as any)?.organizationId !== org.id) {
      return Errors.forbidden(res, "Job belongs to a different organization");
    }
    res.json({
      outboxId: row.id,
      status: row.status,
      attempts: row.attempts,
      lastErrorMessage: row.lastErrorMessage,
      sentAt: row.sentAt,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /1099-batch/:jobId ────────────────────────────────────────────────
router.get("/1099-batch/:jobId", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireOrgOwnerOrAdmin(req, res)) return;
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

// ── GET /investor-income — preview per-LP income for a tax year ──────────
// Read-only aggregation; surfaces what the batch generator would produce.
router.get("/investor-income", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireOrgOwnerOrAdmin(req, res)) return;
  try {
    const org = getOrganization(req);
    const taxYear = parseInt((req.query.taxYear as string) ?? String(new Date().getFullYear() - 1));
    if (Number.isNaN(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return Errors.badRequest(res, "taxYear must be a valid 4-digit year");
    }
    const statements = await aggregateInvestorIncomeForYear(org.id, taxYear);
    const totalCents = statements.reduce((s, x) => s + x.totalInterestCents, 0);
    res.json({ taxYear, statements, totalInvestorInterestCents: totalCents });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── POST /investor-statements — generate per-LP statement PDFs ───────────
// Linnea: "AcreOS computes each investor's share of every payment,
// generates per-investor 1099-INTs." This is that surface — the
// downstream form-1099-vs-K-1 choice still belongs to the user's CPA
// because pool legal structure determines it.
router.post("/investor-statements", async (req: AuthenticatedRequest, res: Response) => {
  if (!requireOrgOwnerOrAdmin(req, res)) return;
  try {
    const org = getOrganization(req);
    const taxYear = parseInt((req.query.taxYear as string) ?? String(new Date().getFullYear() - 1));
    if (Number.isNaN(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return Errors.badRequest(res, "taxYear must be a valid 4-digit year");
    }
    const [orgRow] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .limit(1);
    const orgName = orgRow?.name ?? "Note Holder";

    const result = await generateInvestorStatementBatch(org.id, orgName, taxYear);
    logger.info("accounting.investorStatements.completed", {
      organizationId: org.id,
      taxYear,
      statements: result.statements.length,
      totalCents: result.totalInvestorInterestCents,
      reconciliationOk: result.reconciliation?.ok ?? null,
      variances: result.reconciliation?.variances.length ?? 0,
    });
    // Rachel: when the reconciliation gate refuses, return 422 so the UI
    // surfaces the variance and the operator can't accidentally ship a
    // misstatement. PDFs are intentionally empty on the failure path.
    if (result.reconciliation && !result.reconciliation.ok) {
      return res.status(422).json({
        error: "reconciliation_failed",
        message: `Per-LP sums don't reconcile on ${result.reconciliation.variances.length} note(s). Fix splits or post missing payments, then retry.`,
        ...result,
      });
    }
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
