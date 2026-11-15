/**
 * Object documents (autonomy gap §8 slice 5) — the customer's own PDFs on a
 * deal, a property or an acquired note.
 *
 *   POST /api/{deals,properties,notes}/:objectId/documents
 *   GET  /api/{deals,properties,notes}/:objectId/documents
 *   GET  /api/{deals,properties,notes}/:objectId/documents/:documentId/download
 *
 * Nine routes from ONE factory over DOCUMENT_OBJECT_KINDS: one implementation
 * of each behaviour, three registrations of each path, and a population a test
 * can enumerate. Nested INCLUDING download, so a document is always reached
 * through its parent and the org⇢object⇢document scoping chain is identical on
 * all three verbs. A unified /api/documents surface would have had to carry
 * objectType in the body or query — exactly the shape that lets an org id or an
 * object kind arrive from the client.
 *
 * Org comes from getOrganizationId(req) and the uploader from getUserId(req);
 * neither is ever read from the body. The stored content type is the DETECTED
 * mime from validateFileMiddleware's magic-byte sniff, not the client's claim.
 *
 * REFUSE BEFORE WRITING (DEFECT-0164): with no blob store configured the bytes
 * would be dropped, so the upload answers 503 — with a message that says what
 * did NOT happen and what to do instead — before any row can exist.
 */
import type { Express, Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { createUploadMiddleware, validateFileMiddleware } from "./middleware/fileUploadSecurity";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { routeParam } from "./utils/routeParams";
import {
  DOCUMENT_DOWNLOAD_UNAVAILABLE_MESSAGE,
  DOCUMENT_OBJECT_KINDS,
  DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE,
  documentObjectIdLooksValid,
  documentParentId,
  documentStorageAvailable,
  getObjectDocument,
  listObjectDocuments,
  readObjectDocumentBytes,
  resolveDocumentParent,
  storeObjectDocument,
  type DocumentObjectKindDef,
} from "./services/objectDocuments";

const pdfUpload = createUploadMiddleware({ maxSizeMB: 25, allowedTypes: ["pdf"] });
const validatePdf = validateFileMiddleware(["pdf"]);

/**
 * The mime validateFileMiddleware DETECTED from the magic bytes. The client's
 * `file.mimetype` is its own claim and is never what we store.
 */
function detectedMimeOf(file: Express.Multer.File): string {
  const detected = (file as Express.Multer.File & { detectedMime?: string }).detectedMime;
  return detected && detected.length > 0 ? detected : "application/pdf";
}

/** A single optional multipart text field, or null. A repeated field is ignored. */
function optionalTextField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The download filename as it may appear inside a Content-Disposition
 * quoted-string. `fileName` is the uploader's own `originalname`, stored
 * verbatim: a `"` would corrupt the quoted-string, and CR/LF would make
 * setHeader throw ERR_INVALID_CHAR — either way one crafted upload name
 * breaks that file's download for the whole org, permanently. Control
 * characters, `"` and `\` become `_`; a name that sanitises to nothing
 * downloads as "document.pdf". Clean names pass through byte-identical
 * (the round-trip test pins the header for one).
 */
function contentDispositionFileName(fileName: string): string {
  const cleaned = fileName.replace(/[\u0000-\u001f\u007f"\\]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "document.pdf";
}

export function registerObjectDocumentRoutes(app: Express): void {
  for (const def of DOCUMENT_OBJECT_KINDS) {
    registerForKind(app, def);
  }
}

function registerForKind(app: Express, def: DocumentObjectKindDef): void {
  const base = `/api/${def.segment}/:objectId/documents`;

  // ── POST /api/<segment>/:objectId/documents ──────────────────────────────
  // Multipart, single field "file", optional "category".
  app.post(
    base,
    isAuthenticated,
    getOrCreateOrg,
    pdfUpload.single("file"),
    validatePdf,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const rawObjectId = routeParam(req.params.objectId);

        if (!documentObjectIdLooksValid(def.kind, rawObjectId)) {
          return Errors.badRequest(res, `Invalid ${def.kind} id`);
        }

        // Refuse BEFORE anything is written (DEFECT-0164). With no blob store
        // the bytes are dropped, and a 201 would be a record of a file we do
        // not have.
        if (!documentStorageAvailable()) {
          return Errors.serviceUnavailable(res, DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE);
        }

        const file = req.file;
        if (!file || !file.buffer || file.buffer.length === 0) {
          return Errors.badRequest(res, 'No file provided. Upload as multipart field "file".');
        }

        // The ONLY place an object id from the caller is trusted. Same answer
        // for "does not exist" and "belongs to another org", so the endpoint
        // never confirms that another org's id exists.
        const parent = await resolveDocumentParent(orgId, def.kind, rawObjectId);
        if (!parent) return Errors.notFound(res, def.entityLabel);

        const document = await storeObjectDocument({
          organizationId: orgId,
          kind: def.kind,
          parent,
          fileName: file.originalname,
          contentType: detectedMimeOf(file),
          bytes: file.buffer,
          category: optionalTextField(req.body?.category),
          uploadedBy: userId,
        });

        logger.info("[docstore] document uploaded", {
          orgId,
          userId,
          metadata: {
            objectType: def.kind,
            objectId: String(documentParentId(parent)),
            documentId: document.id,
            bytes: document.byteSize,
          },
        });

        return res.status(201).json({ document });
      } catch (err) {
        logger.error("[docstore] document upload error", err as Error);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/<segment>/:objectId/documents ───────────────────────────────
  app.get(base, isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rawObjectId = routeParam(req.params.objectId);

      if (!documentObjectIdLooksValid(def.kind, rawObjectId)) {
        return Errors.badRequest(res, `Invalid ${def.kind} id`);
      }

      const parent = await resolveDocumentParent(orgId, def.kind, rawObjectId);
      if (!parent) return Errors.notFound(res, def.entityLabel);

      const documents = await listObjectDocuments(orgId, def.kind, parent);
      const storageAvailable = documentStorageAvailable();

      return res.json({
        objectType: def.kind,
        objectId: documentParentId(parent),
        total: documents.length,
        // False while storage isn't configured: rows whose bytes cannot
        // currently be served must SAY so rather than render a download
        // button that 503s.
        storageAvailable,
        // Design §9: while the store is unconfigured the panel's notice
        // carries the server's OWN sentence, not a client-side paraphrase —
        // so the list response carries it alongside the boolean.
        ...(storageAvailable
          ? {}
          : { storageMessage: DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE }),
        documents,
      });
    } catch (err) {
      logger.error("[docstore] document list error", err as Error);
      return Errors.internal(res, err);
    }
  });

  // ── GET /api/<segment>/:objectId/documents/:documentId/download ──────────
  app.get(
    `${base}/:documentId/download`,
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rawObjectId = routeParam(req.params.objectId);
        const documentId = routeParam(req.params.documentId);

        if (!documentObjectIdLooksValid(def.kind, rawObjectId)) {
          return Errors.badRequest(res, `Invalid ${def.kind} id`);
        }

        const parent = await resolveDocumentParent(orgId, def.kind, rawObjectId);
        if (!parent) return Errors.notFound(res, def.entityLabel);

        // Org AND parent. Checked before any S3 call, so a cross-org request
        // never reaches the store at all.
        const document = await getObjectDocument(orgId, def.kind, parent, documentId);
        if (!document) return Errors.notFound(res, "Document");

        if (!documentStorageAvailable()) {
          return Errors.serviceUnavailable(res, DOCUMENT_DOWNLOAD_UNAVAILABLE_MESSAGE);
        }

        const bytes = await readObjectDocumentBytes(orgId, document);

        res.setHeader("Content-Type", document.contentType);
        res.setHeader("Content-Length", String(bytes.length));
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${contentDispositionFileName(document.fileName)}"`,
        );
        // Bare res.send: 200 is the default, and every precedent download in
        // routes-documents.ts sends this way (the res-status-raw ratchet
        // counts the explicit .status(200) as a raw-status occurrence).
        return res.send(bytes);
      } catch (err) {
        logger.error("[docstore] document download error", err as Error);
        return Errors.internal(res, err);
      }
    },
  );
}
