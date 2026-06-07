/**
 * routes-founder-life-cockpit — Founder Life-Cockpit API (FOUNDER-SIDE ONLY).
 *
 * Personal-ops surface that supports Tom alongside running AcreOS: taxes, a
 * blended income view, an encrypted document vault, and a deadline/obligation
 * tracker. Every route is gated behind isAuthenticated + getOrCreateOrg +
 * requireFounder, and every row is scoped to the requesting founder's user id.
 *
 * SECURITY (non-negotiable — Beatrice + Quinn):
 *   - SENSITIVE personal data (W2s, possibly SSNs, financials). Document bytes
 *     and dollar amounts are encrypted at rest (AES-256-GCM) before storage.
 *   - We NEVER log raw values and NEVER echo SSN/financial values back except as
 *     an authorized founder read of their own data.
 *   - This data must NEVER train or shape any customer feature, and must NEVER
 *     appear on any customer surface.
 *
 * SCOPE: FOUNDATION wave. Upload + profile-capture + income + obligations are
 * wired; the tax-COMPUTATION / draft-return engine is the explicit NEXT wave —
 * the /api/founder/life-cockpit/tax/draft endpoint returns the "Lena will
 * prepare your draft return here" seam.
 */

import type { Express, Response } from "express";

import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  createUploadMiddleware,
  validateFileMiddleware,
} from "./middleware/fileUploadSecurity";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import * as cockpit from "./services/founder/lifeCockpit";

// ─── Validation helpers ──────────────────────────────────────────────────────

const FILING_STATUSES = new Set([
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
  "qualifying_widow",
]);
const DOC_TYPES = new Set(["w2", "1099", "prior_return", "receipt", "statement", "other"]);
const OBLIGATION_TYPES = new Set(["tax", "legal", "financial"]);
const OBLIGATION_STATUSES = new Set(["open", "done", "dismissed"]);
const INCOME_TYPES = new Set(["w2_self", "w2_spouse", "acreos_draw", "side_income", "other"]);

function parseYear(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  return new Date().getUTCFullYear();
}

function parseId(raw: unknown): number | null {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse an optional whole-dollar amount from a request body.
 * Returns:
 *   - `undefined` when the key was absent (PATCH: don't touch it),
 *   - `null` when explicitly cleared (empty string / null),
 *   - a finite number when present,
 *   - `NaN` when present-but-invalid (caller rejects with 400).
 */
function parseOptionalAmount(raw: unknown, present: boolean): number | null | undefined {
  if (!present) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

// Vault upload: up to 15MB, PDF/image/document/text only (W2/1099/returns).
const vaultUpload = createUploadMiddleware({
  maxSizeMB: 15,
  allowedTypes: ["pdf", "image", "document", "text"],
});

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFounderLifeCockpitRoutes(app: Express): void {
  const base = "/api/founder/life-cockpit";
  const guard = [isAuthenticated, getOrCreateOrg, requireFounder] as const;

  // ── Overview: blended snapshot for the cockpit shell ──────────────────────
  app.get(`${base}/overview`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const founderUserId = getUserId(req);
      const taxYear = parseYear(req.query.taxYear);
      const [profile, documents, obligations, income] = await Promise.all([
        cockpit.getTaxProfile(founderUserId, taxYear),
        cockpit.listDocuments(founderUserId),
        cockpit.listObligations(founderUserId),
        cockpit.listIncomeSources(founderUserId, taxYear),
      ]);
      res.json({ taxYear, profile, documents, obligations, income });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ── Tax profile (intake capture) ──────────────────────────────────────────
  app.get(`${base}/tax/profile`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taxYear = parseYear(req.query.taxYear);
      const profile = await cockpit.getTaxProfile(getUserId(req), taxYear);
      res.json({ taxYear, profile });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.put(`${base}/tax/profile`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const b = req.body ?? {};
      const taxYear = parseYear(b.taxYear);
      const filingStatus = String(b.filingStatus ?? "married_joint");
      if (!FILING_STATUSES.has(filingStatus)) {
        return Errors.badRequest(res, "Invalid filing status");
      }
      const state = String(b.state ?? "MA").slice(0, 2).toUpperCase();
      const profile = await cockpit.upsertTaxProfile({
        founderUserId: getUserId(req),
        taxYear,
        filingStatus,
        state,
        hasSpouse: Boolean(b.hasSpouse),
        notes: b.notes ? String(b.notes).slice(0, 4000) : null,
      });
      res.json({ profile });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ── Tax draft (computed federal 1040 + MA Form 1 estimate) ─────────────────
  // GET computes from current data WITHOUT persisting a new version (opening the
  // tab shouldn't spam history). Self-prepared DRAFT software — never e-file.
  app.get(`${base}/tax/draft`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taxYear = parseYear(req.query.taxYear);
      const result = await cockpit.computeAndStoreDraft(getUserId(req), taxYear, false);
      res.json({ taxYear, ...result });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // POST computes AND persists a new draft version (founder hit "Generate").
  app.post(`${base}/tax/draft`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taxYear = parseYear((req.body ?? {}).taxYear);
      const result = await cockpit.computeAndStoreDraft(getUserId(req), taxYear, true);
      if (!result.ready) return Errors.badRequest(res, result.reason ?? "Not enough data to compute a draft");
      // Log metadata only — NEVER any tax figure.
      logger.info("[founder-cockpit] tax draft computed", {
        founderUserId: getUserId(req),
        taxYear,
        version: result.version,
        provisional: result.draft.provisional,
      });
      res.status(201).json({ taxYear, ...result });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // History of stored draft versions (metadata only — never decrypts figures).
  app.get(`${base}/tax/returns`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taxYear = parseYear(req.query.taxYear);
      const returns = await cockpit.listReturnHistory(getUserId(req), taxYear);
      res.json({ taxYear, returns });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Download a stored draft as a transcription-ready self-file package (markdown).
  app.get(`${base}/tax/returns/:id/package`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid return id");
      const stored = await cockpit.getStoredDraft(getUserId(req), id);
      if (!stored) return Errors.notFound(res, "Tax draft");
      res.setHeader("Content-Type", stored.package.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${stored.package.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
      res.send(stored.package.content);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Update a stored draft's workflow status (draft | reviewed | filed).
  app.patch(`${base}/tax/returns/:id`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid return id");
      const status = String((req.body ?? {}).status ?? "");
      const ok = await cockpit.updateReturnStatus(getUserId(req), id, status);
      if (!ok) return Errors.badRequest(res, "Invalid status or return not found");
      res.json({ updated: true, status });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ── Document vault ─────────────────────────────────────────────────────────
  app.get(`${base}/documents`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const documents = await cockpit.listDocuments(getUserId(req));
      res.json({ documents });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.post(
    `${base}/documents`,
    ...guard,
    vaultUpload.single("file"),
    validateFileMiddleware(["pdf", "image", "document", "text"]),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const file = (req as unknown as { file?: Express.Multer.File }).file;
        if (!file || !file.buffer || file.buffer.length === 0) {
          return Errors.badRequest(res, "A file is required");
        }
        const b = req.body ?? {};
        const docType = String(b.docType ?? "other");
        if (!DOC_TYPES.has(docType)) {
          return Errors.badRequest(res, "Invalid document type");
        }
        const label = String(b.label ?? file.originalname ?? "Untitled").slice(0, 200);
        const document = await cockpit.createDocument({
          founderUserId: getUserId(req),
          docType,
          label,
          taxYear: b.taxYear ? parseYear(b.taxYear) : null,
          fileName: file.originalname ?? null,
          mimeType: file.mimetype ?? null,
          bytes: file.buffer,
        });
        // Log metadata only — never the bytes, label PII, or any plaintext.
        logger.info("[founder-cockpit] document stored", {
          founderUserId: getUserId(req),
          docId: document?.id,
          docType,
          byteSize: document?.byteSize,
        });
        res.status(201).json({ document });
      } catch (error) {
        Errors.internal(res, error);
      }
    },
  );

  app.get(`${base}/documents/:id/download`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid document id");
      const doc = await cockpit.getDocumentBytes(getUserId(req), id);
      if (!doc) return Errors.notFound(res, "Document");
      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(doc.fileName || "document").replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
      res.send(doc.bytes);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.delete(`${base}/documents/:id`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid document id");
      const ok = await cockpit.deleteDocument(getUserId(req), id);
      if (!ok) return Errors.notFound(res, "Document");
      res.json({ deleted: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ── Obligations (deadline tracker CRUD) ────────────────────────────────────
  app.get(`${base}/obligations`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const obligations = await cockpit.listObligations(getUserId(req));
      res.json({ obligations });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.post(`${base}/obligations`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const b = req.body ?? {};
      const title = String(b.title ?? "").trim();
      if (!title) return Errors.badRequest(res, "Title is required");
      const obligationType = String(b.obligationType ?? "tax");
      if (!OBLIGATION_TYPES.has(obligationType)) {
        return Errors.badRequest(res, "Invalid obligation type");
      }
      const obligation = await cockpit.createObligation({
        founderUserId: getUserId(req),
        title: title.slice(0, 200),
        obligationType,
        dueDate: parseDate(b.dueDate),
        notes: b.notes ? String(b.notes).slice(0, 4000) : null,
      });
      res.status(201).json({ obligation });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.patch(`${base}/obligations/:id`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid obligation id");
      const b = req.body ?? {};
      if (b.obligationType !== undefined && !OBLIGATION_TYPES.has(String(b.obligationType))) {
        return Errors.badRequest(res, "Invalid obligation type");
      }
      if (b.status !== undefined && !OBLIGATION_STATUSES.has(String(b.status))) {
        return Errors.badRequest(res, "Invalid status");
      }
      const obligation = await cockpit.updateObligation(getUserId(req), id, {
        title: b.title !== undefined ? String(b.title).slice(0, 200) : undefined,
        obligationType: b.obligationType !== undefined ? String(b.obligationType) : undefined,
        dueDate: b.dueDate !== undefined ? parseDate(b.dueDate) : undefined,
        status: b.status !== undefined ? String(b.status) : undefined,
        notes: b.notes !== undefined ? (b.notes ? String(b.notes).slice(0, 4000) : null) : undefined,
      });
      if (!obligation) return Errors.notFound(res, "Obligation");
      res.json({ obligation });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.delete(`${base}/obligations/:id`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid obligation id");
      const ok = await cockpit.deleteObligation(getUserId(req), id);
      if (!ok) return Errors.notFound(res, "Obligation");
      res.json({ deleted: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ── Income sources (encrypted amounts) ─────────────────────────────────────
  app.get(`${base}/income`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taxYear = parseYear(req.query.taxYear);
      const income = await cockpit.listIncomeSources(getUserId(req), taxYear);
      res.json({ taxYear, income });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.post(`${base}/income`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const b = req.body ?? {};
      const sourceType = String(b.sourceType ?? "w2_self");
      if (!INCOME_TYPES.has(sourceType)) return Errors.badRequest(res, "Invalid income source type");
      const label = String(b.label ?? "").trim();
      if (!label) return Errors.badRequest(res, "Label is required");
      const amount =
        b.amount === null || b.amount === undefined || b.amount === ""
          ? null
          : Number(b.amount);
      if (amount !== null && !Number.isFinite(amount)) {
        return Errors.badRequest(res, "Amount must be a number");
      }
      const federalWithheld = parseOptionalAmount(b.federalWithheld, b.federalWithheld !== undefined);
      if (Number.isNaN(federalWithheld)) {
        return Errors.badRequest(res, "Federal withheld must be a number");
      }
      const stateWithheld = parseOptionalAmount(b.stateWithheld, b.stateWithheld !== undefined);
      if (Number.isNaN(stateWithheld)) {
        return Errors.badRequest(res, "State withheld must be a number");
      }
      const income = await cockpit.createIncomeSource({
        founderUserId: getUserId(req),
        taxYear: parseYear(b.taxYear),
        sourceType,
        label: label.slice(0, 200),
        amount,
        withholdingAtSource:
          b.withholdingAtSource === undefined ? true : Boolean(b.withholdingAtSource),
        federalWithheld: federalWithheld ?? null,
        stateWithheld: stateWithheld ?? null,
        notes: b.notes ? String(b.notes).slice(0, 4000) : null,
      });
      res.status(201).json({ income });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.patch(`${base}/income/:id`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid income source id");
      const b = req.body ?? {};
      if (b.sourceType !== undefined && !INCOME_TYPES.has(String(b.sourceType))) {
        return Errors.badRequest(res, "Invalid income source type");
      }
      let amount: number | null | undefined = undefined;
      if (b.amount !== undefined) {
        amount = b.amount === null || b.amount === "" ? null : Number(b.amount);
        if (amount !== null && !Number.isFinite(amount)) {
          return Errors.badRequest(res, "Amount must be a number");
        }
      }
      const federalWithheld = parseOptionalAmount(b.federalWithheld, b.federalWithheld !== undefined);
      if (Number.isNaN(federalWithheld)) {
        return Errors.badRequest(res, "Federal withheld must be a number");
      }
      const stateWithheld = parseOptionalAmount(b.stateWithheld, b.stateWithheld !== undefined);
      if (Number.isNaN(stateWithheld)) {
        return Errors.badRequest(res, "State withheld must be a number");
      }
      const income = await cockpit.updateIncomeSource(getUserId(req), id, {
        sourceType: b.sourceType !== undefined ? String(b.sourceType) : undefined,
        label: b.label !== undefined ? String(b.label).slice(0, 200) : undefined,
        amount,
        withholdingAtSource:
          b.withholdingAtSource !== undefined ? Boolean(b.withholdingAtSource) : undefined,
        federalWithheld,
        stateWithheld,
        notes: b.notes !== undefined ? (b.notes ? String(b.notes).slice(0, 4000) : null) : undefined,
      });
      if (!income) return Errors.notFound(res, "Income source");
      res.json({ income });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.delete(`${base}/income/:id`, ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return Errors.badRequest(res, "Invalid income source id");
      const ok = await cockpit.deleteIncomeSource(getUserId(req), id);
      if (!ok) return Errors.notFound(res, "Income source");
      res.json({ deleted: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });
}
