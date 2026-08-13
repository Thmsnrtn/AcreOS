import { Router, type Request, type Response } from 'express';
import {
  documentIntelligenceService,
  DocumentNotInOrgError,
} from './services/documentIntelligence';
import { Errors } from './utils/errors';
import { getOrganizationId } from './types/request';
import { usageLimitGate, aiByokThresholdGate } from './middleware/usageLimitGate';
import { storage } from './storage';
import { logger } from './utils/logger';

const router = Router();

// W4.1 — every endpoint below that triggers a gpt-4o call now runs the same
// meter stack as chat (ai_requests limit + BYOK threshold) and counts the
// turn. Doc-intel used to bypass ALL metering — no turn count, no pool, not
// even the platform cost ceiling (raw OpenAI client, no routeAITask).
const aiMeter = [usageLimitGate("ai_requests"), aiByokThresholdGate()] as const;

/**
 * A document id that is not this org's answers 404, not 403 — a probe must not
 * be able to tell "exists, not yours" from "never existed". Everything else
 * keeps the handler's own 500.
 */
function refuse(res: Response, err: unknown): void {
  if (err instanceof DocumentNotInOrgError) {
    Errors.notFound(res, 'Document');
    return;
  }
  Errors.internal(res, err);
}
async function countAiTurn(req: Request): Promise<void> {
  try {
    if (req.organization?.id) await storage.trackUsage(req.organization.id, "ai_request");
  } catch (err) {
    logger.warn("[document-intelligence] trackUsage failed (continuing)", err instanceof Error ? err : undefined);
  }
}


// POST /upload — upload and process a document
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { name, documentName, fileUrl, fileType, documentType, propertyId, dealId } = req.body;
    // Service signature is (organizationId, { documentType, documentName, fileUrl, propertyId, dealId }).
    // Accept either the old shape ({ name, fileType }) or the service's native
    // shape ({ documentName, documentType }) for backward compatibility.
    const doc = await documentIntelligenceService.uploadDocument(org.id, {
      documentType: (documentType || fileType || "contract") as any,
      documentName: documentName || name || "Untitled Document",
      fileUrl: fileUrl || "",
      propertyId: propertyId ? parseInt(propertyId) : undefined,
      dealId: dealId ? parseInt(dealId) : undefined,
    });
    res.json({ document: doc });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /documents/:id/process — run AI analysis pipeline on a document
router.post('/documents/:id/process', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const analysis = await documentIntelligenceService.processDocument(
      parseInt(req.params.id),
      getOrganizationId(req),
    );
    res.json({ analysis });
  } catch (err) {
    refuse(res, err);
  }
});

// GET /documents/:id/text — extracted raw text
//
// `...aiMeter` and countAiTurn were missing here, and the W4.1 note above says
// "every endpoint below that triggers a gpt-4o call now runs the same meter
// stack". This one runs OpenAI Vision for OCR, so the note was false about it:
// an unmetered gpt-4o call on the platform account, no turn counted, no pool.
//
// `req.query.fileUrl` is gone. The service reads the URL off the stored row —
// see its header for why forwarding a caller's value was a write primitive, not
// just an odd parameter.
router.get('/documents/:id/text', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const text = await documentIntelligenceService.extractText(
      parseInt(req.params.id),
      getOrganizationId(req),
    );
    res.json({ text });
  } catch (err) {
    refuse(res, err);
  }
});

// GET /documents/:id/key-terms — extracted contract key terms
router.get('/documents/:id/key-terms', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const terms = await documentIntelligenceService.extractKeyTerms(
      parseInt(req.params.id),
      getOrganizationId(req),
    );
    res.json({ terms });
  } catch (err) {
    refuse(res, err);
  }
});

// GET /documents/:id/risks — risk flags and red flags
router.get('/documents/:id/risks', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const risks = await documentIntelligenceService.analyzeRisks(
      parseInt(req.params.id),
      getOrganizationId(req),
    );
    res.json({ risks });
  } catch (err) {
    refuse(res, err);
  }
});

// GET /documents/:id/summary — AI-generated document summary
router.get('/documents/:id/summary', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const summary = await documentIntelligenceService.generateDocumentSummary(
      parseInt(req.params.id),
      getOrganizationId(req),
    );
    res.json({ summary });
  } catch (err) {
    refuse(res, err);
  }
});

// GET /properties/:id/documents — all documents for a property
router.get('/properties/:id/documents', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const docs = await documentIntelligenceService.getDocumentsByProperty(org.id, parseInt(req.params.id));
    res.json({ documents: docs });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /deals/:id/documents — all documents for a deal
router.get('/deals/:id/documents', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const docs = await documentIntelligenceService.getDocumentsByDeal(org.id, parseInt(req.params.id));
    res.json({ documents: docs });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /search — semantic document search
router.post('/search', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { query } = req.body;
    const results = await documentIntelligenceService.searchDocuments(org.id, query);
    res.json({ results });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /documents/:id/compare — compare two document versions
//
// Metered for the same reason as /text: compareDocumentVersions writes a gpt-4o
// summary of the differences whenever there are any.
router.post('/documents/:id/compare', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const { compareDocumentId } = req.body;
    const diff = await documentIntelligenceService.compareDocumentVersions(
      parseInt(req.params.id),
      parseInt(compareDocumentId),
      getOrganizationId(req),
    );
    res.json({ diff });
  } catch (err) {
    refuse(res, err);
  }
});

export default router;
