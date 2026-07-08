import { Router, type Request, type Response } from 'express';
import { documentIntelligenceService } from './services/documentIntelligence';
import { Errors } from './utils/errors';
import { usageLimitGate, aiByokThresholdGate } from './middleware/usageLimitGate';
import { storage } from './storage';
import { logger } from './utils/logger';

const router = Router();

// W4.1 — every endpoint below that triggers a gpt-4o call now runs the same
// meter stack as chat (ai_requests limit + BYOK threshold) and counts the
// turn. Doc-intel used to bypass ALL metering — no turn count, no pool, not
// even the platform cost ceiling (raw OpenAI client, no routeAITask).
const aiMeter = [usageLimitGate("ai_requests"), aiByokThresholdGate()] as const;
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
    const analysis = await documentIntelligenceService.processDocument(parseInt(req.params.id));
    res.json({ analysis });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /documents/:id/text — extracted raw text
router.get('/documents/:id/text', async (req: Request, res: Response) => {
  try {
    const doc = await documentIntelligenceService.uploadDocument as any; // placeholder to get fileUrl
    // Fetch fileUrl from document record then extract
    const text = await documentIntelligenceService.extractText(parseInt(req.params.id), req.query.fileUrl as string || '');
    res.json({ text });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /documents/:id/key-terms — extracted contract key terms
router.get('/documents/:id/key-terms', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const terms = await documentIntelligenceService.extractKeyTerms(parseInt(req.params.id));
    res.json({ terms });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /documents/:id/risks — risk flags and red flags
router.get('/documents/:id/risks', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const risks = await documentIntelligenceService.analyzeRisks(parseInt(req.params.id));
    res.json({ risks });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /documents/:id/summary — AI-generated document summary
router.get('/documents/:id/summary', ...aiMeter, async (req: Request, res: Response) => {
  try {
    await countAiTurn(req);
    const summary = await documentIntelligenceService.generateDocumentSummary(parseInt(req.params.id));
    res.json({ summary });
  } catch (err) {
    Errors.internal(res, err);
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
router.post('/documents/:id/compare', async (req: Request, res: Response) => {
  try {
    const { compareDocumentId } = req.body;
    const diff = await documentIntelligenceService.compareDocumentVersions(
      parseInt(req.params.id),
      parseInt(compareDocumentId)
    );
    res.json({ diff });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
