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
import { eq } from "drizzle-orm";
import { generatedDocuments, organizations } from "@shared/schema";
import { verifySigningToken } from "./services/signingTokens";
import { storage } from "./storage";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerPublicSignRoutes(app: Express): void {
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
  app.post("/api/public/sign/:docId", async (req, res) => {
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
}
