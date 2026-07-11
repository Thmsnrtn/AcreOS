/**
 * Public e-signing endpoints — external signers have no AcreOS account
 * and authenticate via an HMAC token in the URL (see
 * server/services/signingTokens.ts). MUST be registered before the
 * `app.use('/api', isAuthenticated, …)` catch-all or Clerk's auth
 * middleware 401s them.
 *
 * Kept in its own file (rather than inside routes-doc-system, which
 * also lives past the catch-all) so the registration order in
 * routes.ts stays explicit.
 */
import type { Express } from "express";
import { db } from "./db";
import { and, desc, eq } from "drizzle-orm";
import {
  generatedDocuments,
  organizations,
  signingConsentAudit,
  ESIGN_DISCLOSURE_VERSION,
} from "@shared/schema";
import { verifySigningToken } from "./services/signingTokens";
import { storage } from "./storage";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { idempotencyMiddleware } from "./middleware/idempotency";

export function registerPublicSignRoutes(app: Express): void {
  // consent — registered BEFORE /api/public/sign/:docId so the literal path wins (2026-07-11 route-order sweep).
  app.post("/api/public/sign/consent", async (req, res) => {
    try {
      const {
        docId: docIdRaw,
        s: signerId,
        t: token,
        consentedHardwareRequirements,
        consentedPaperCopyRight,
        consentedWithdrawalRight,
        consentedContactUpdate,
        consentedScope,
        disclosureVersion,
      } = req.body || {};
      const docId = parseInt(String(docIdRaw), 10);
      if (!Number.isFinite(docId) || !signerId || !token) {
        return Errors.badRequest(res, "Missing doc, signer, or token");
      }
      if (!verifySigningToken(docId, String(signerId), String(token))) {
        return res.status(403).json({ error: "Invalid or expired signing link" });
      }
      // All five disclosures must be true — the legal minimum.
      if (
        consentedHardwareRequirements !== true ||
        consentedPaperCopyRight !== true ||
        consentedWithdrawalRight !== true ||
        consentedContactUpdate !== true ||
        consentedScope !== true
      ) {
        return Errors.badRequest(
          res,
          "All five §101(c) disclosures must be acknowledged before consent can be recorded.",
        );
      }
      // The disclosure version the client posts must match the server's
      // current version. Mismatch usually means the client cached an old
      // version of the dialog; the client will refetch on next mount.
      const version =
        typeof disclosureVersion === "string" && disclosureVersion.length > 0
          ? disclosureVersion
          : ESIGN_DISCLOSURE_VERSION;
      if (version !== ESIGN_DISCLOSURE_VERSION) {
        return Errors.badRequest(
          res,
          `Disclosure version mismatch — expected ${ESIGN_DISCLOSURE_VERSION}, got ${version}.`,
        );
      }

      const [doc] = await db
        .select({
          signers: generatedDocuments.signers,
          organizationId: generatedDocuments.organizationId,
        })
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, docId))
        .limit(1);
      if (!doc) return Errors.notFound(res, "Document");
      const signers = (doc.signers || []) as Array<{ id: string; email?: string }>;
      const signer = signers.find((s) => s.id === String(signerId));
      if (!signer) {
        return res.status(403).json({ error: "Invalid or expired signing link" });
      }

      const [row] = await db
        .insert(signingConsentAudit)
        .values({
          userId: null,
          organizationId: doc.organizationId,
          signerEmail: signer.email ?? null,
          documentId: docId,
          disclosureVersion: version,
          consentedHardwareRequirements: true,
          consentedPaperCopyRight: true,
          consentedWithdrawalRight: true,
          consentedContactUpdate: true,
          consentedScope: true,
          ipAddress: req.ip || (req.headers["x-forwarded-for"] as string) || null,
          userAgent: (req.headers["user-agent"] as string) || null,
        })
        .returning({ id: signingConsentAudit.id });

      logger.info("esign.consent.captured", {
        consentAuditId: row?.id,
        documentId: docId,
        signerEmail: signer.email ?? null,
        disclosureVersion: version,
      });

      res.json({
        success: true,
        consentAuditId: row?.id ?? null,
        disclosureVersion: version,
      });
    } catch (error: any) {
      logger.error(
        "Public sign consent capture error",
        error instanceof Error ? error : undefined,
      );
      Errors.internal(res, error);
    }
  });

  // GET /api/public/sign/:docId?s={signerId}&t={token}
  app.get("/api/public/sign/:docId", async (req, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      const signerId = String(req.query.s || "");
      const token = String(req.query.t || "");
      if (!Number.isFinite(docId) || !signerId || !token) {
        return Errors.badRequest(res, "Missing doc, signer, or token");
      }

      if (!verifySigningToken(docId, signerId, token)) {
        return res.status(403).json({ error: "Invalid or expired signing link" });
      }

      const [doc] = await db
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, docId))
        .limit(1);
      if (!doc) return Errors.notFound(res, "Document");

      const signers = (doc.signers || []) as Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        signedAt?: string;
        order?: number;
      }>;
      const signer = signers.find((s) => s.id === signerId);
      if (!signer) return res.status(403).json({ error: "Invalid or expired signing link" });

      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, doc.organizationId))
        .limit(1);

      if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This signing link has expired" });
      }

      res.json({
        document: {
          id: doc.id,
          name: doc.name,
          type: doc.type,
          content: doc.content,
          status: doc.status,
          expiresAt: doc.expiresAt,
        },
        organization: { name: org?.name ?? "AcreOS" },
        signer: {
          id: signer.id,
          name: signer.name,
          email: signer.email,
          role: signer.role,
          signedAt: signer.signedAt ?? null,
          order: signer.order ?? 1,
        },
        signersTotal: signers.length,
        signersCompleted: signers.filter((s) => !!s.signedAt).length,
      });
    } catch (error: any) {
      logger.error("Public sign fetch error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/public/sign/:docId
  //   body: { s: signerId, t: token, signatureData, signatureType, consentGiven }
  app.post("/api/public/sign/:docId", idempotencyMiddleware, async (req, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      const { s: signerId, t: token, signatureData, signatureType, consentGiven } = req.body || {};
      if (!Number.isFinite(docId) || !signerId || !token || !signatureData) {
        return Errors.badRequest(res, "Missing doc, signer, token, or signature data");
      }

      if (!verifySigningToken(docId, String(signerId), String(token))) {
        return res.status(403).json({ error: "Invalid or expired signing link" });
      }

      const [doc] = await db
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, docId))
        .limit(1);
      if (!doc) return Errors.notFound(res, "Document");

      if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This signing link has expired" });
      }

      const signers = (doc.signers || []) as Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        signedAt?: string;
        signatureUrl?: string;
        order?: number;
      }>;
      const signerIdx = signers.findIndex((x) => x.id === String(signerId));
      if (signerIdx < 0) return res.status(403).json({ error: "Invalid or expired signing link" });
      if (signers[signerIdx].signedAt) {
        return res.status(409).json({ error: "This document has already been signed" });
      }

      const signer = signers[signerIdx];

      // E-SIGN Act §101(c) server-side gate (Workstream A): before we will
      // record a signature on a consumer document, a consent audit row must
      // exist for this (signer_email, document_id) at the current disclosure
      // version. The client renders the consent dialog first, but a regulator
      // can't trust the client — the server enforces the gate independently.
      const consentFilters = [
        eq(signingConsentAudit.documentId, doc.id),
        eq(signingConsentAudit.disclosureVersion, ESIGN_DISCLOSURE_VERSION),
      ];
      if (signer.email) {
        consentFilters.push(eq(signingConsentAudit.signerEmail, signer.email));
      }
      const [consentRow] = await db
        .select({ id: signingConsentAudit.id })
        .from(signingConsentAudit)
        .where(and(...consentFilters))
        .orderBy(desc(signingConsentAudit.consentedAt))
        .limit(1);
      if (!consentRow) {
        return res.status(412).json({
          error: "ESIGN_CONSENT_REQUIRED",
          message:
            "E-SIGN Act §101(c) consent has not been captured for this signer + document. " +
            "The signing UI must present the five required disclosures before submitting a signature.",
          statusCode: 412,
        });
      }

      await storage.createSignature({
        organizationId: doc.organizationId,
        documentId: doc.id,
        signerName: signer.name,
        signerEmail: signer.email || null,
        signerRole: signer.role || "signer",
        signatureData: String(signatureData),
        signatureType: signatureType === "typed" ? "typed" : "drawn",
        ipAddress: req.ip || (req.headers["x-forwarded-for"] as string) || null,
        userAgent: (req.headers["user-agent"] as string) || null,
        consentGiven: consentGiven !== false,
        consentText:
          "I agree that this electronic signature is legally binding and has the same legal effect as a handwritten signature.",
      });

      const now = new Date().toISOString();
      const updatedSigners = signers.map((x, i) =>
        i === signerIdx ? { ...x, signedAt: now, signatureUrl: String(signatureData) } : x,
      );
      const allSigned = updatedSigners.every((x) => !!x.signedAt);
      await storage.updateGeneratedDocument(doc.id, {
        signers: updatedSigners,
        status: allSigned ? "signed" : "partially_signed",
        ...(allSigned ? { completedAt: new Date(), signedAt: new Date() } : {}),
      });

      res.json({
        success: true,
        signer: { id: signer.id, signedAt: now },
        allSigned,
      });
    } catch (error: any) {
      logger.error("Public sign submit error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ── E-SIGN Act §101(c)(1)(B) consent endpoints ──────────────────────────
  //
  // The signing page calls GET /api/public/sign/consent/status?docId&s&t
  // to find out whether to show the consent dialog. The server answers
  // boolean-only (no PII) — required=false iff there's already a
  // signing_consent_audit row for this (signer_email, document_id) at the
  // current disclosure version. Otherwise required=true.
  //
  // POST /api/public/sign/consent records the consent capture — five
  // disclosure flags + ip + user-agent + disclosure-version. Failure to
  // write the audit row is fatal: we refuse to advance the signing flow
  // without a successful audit landing first.
  app.get("/api/public/sign/consent/status", async (req, res) => {
    try {
      const docId = parseInt(String(req.query.docId), 10);
      const signerId = String(req.query.s || "");
      const token = String(req.query.t || "");
      if (!Number.isFinite(docId) || !signerId || !token) {
        return Errors.badRequest(res, "Missing doc, signer, or token");
      }
      if (!verifySigningToken(docId, signerId, token)) {
        return res.status(403).json({ error: "Invalid or expired signing link" });
      }

      // Look up the signer's email so we can match the audit row.
      const [doc] = await db
        .select({ signers: generatedDocuments.signers })
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, docId))
        .limit(1);
      if (!doc) return Errors.notFound(res, "Document");
      const signers = (doc.signers || []) as Array<{ id: string; email?: string }>;
      const signer = signers.find((s) => s.id === signerId);
      if (!signer) return res.status(403).json({ error: "Invalid or expired signing link" });

      // Match by signer email + document id at the current disclosure
      // version. We deliberately scope by document id so that consent on
      // a prior doc doesn't quietly skip the dialog on a new transaction
      // for the same signer (their scope statement may have changed).
      const filters = [
        eq(signingConsentAudit.documentId, docId),
        eq(signingConsentAudit.disclosureVersion, ESIGN_DISCLOSURE_VERSION),
      ];
      if (signer.email) {
        filters.push(eq(signingConsentAudit.signerEmail, signer.email));
      }
      const [existing] = await db
        .select({ id: signingConsentAudit.id })
        .from(signingConsentAudit)
        .where(and(...filters))
        .orderBy(desc(signingConsentAudit.consentedAt))
        .limit(1);

      res.json({
        required: !existing,
        disclosureVersion: ESIGN_DISCLOSURE_VERSION,
      });
    } catch (error: any) {
      logger.error(
        "Public sign consent status error",
        error instanceof Error ? error : undefined,
      );
      Errors.internal(res, error);
    }
  });

}
