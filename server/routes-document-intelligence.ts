import { Router, type Request, type Response } from 'express';
import { documentIntelligenceService } from './services/documentIntelligence';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// POST /upload — upload and process a document
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { name, fileUrl, fileType, propertyId, dealId } = req.body;
    const doc = await documentIntelligenceService.uploadDocument({
      organizationId: org.id,
      name,
      fileUrl,
      fileType,
      propertyId: propertyId ? parseInt(propertyId) : undefined,
      dealId: dealId ? parseInt(dealId) : undefined,
    });
    res.json({ document: doc });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /documents/:id/process — run AI analysis pipeline on a document
router.post('/documents/:id/process', async (req: Request, res: Response) => {
  try {
    const analysis = await documentIntelligenceService.processDocument(parseInt(req.params.id));
    res.json({ analysis });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents/:id/text — extracted raw text
router.get('/documents/:id/text', async (req: Request, res: Response) => {
  try {
    const doc = await documentIntelligenceService.uploadDocument as any; // placeholder to get fileUrl
    // Fetch fileUrl from document record then extract
    const text = await documentIntelligenceService.extractText(parseInt(req.params.id), req.query.fileUrl as string || '');
    res.json({ text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents/:id/key-terms — extracted contract key terms
router.get('/documents/:id/key-terms', async (req: Request, res: Response) => {
  try {
    const terms = await documentIntelligenceService.extractKeyTerms(parseInt(req.params.id));
    res.json({ terms });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents/:id/risks — risk flags and red flags
router.get('/documents/:id/risks', async (req: Request, res: Response) => {
  try {
    const risks = await documentIntelligenceService.analyzeRisks(parseInt(req.params.id));
    res.json({ risks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents/:id/summary — AI-generated document summary
router.get('/documents/:id/summary', async (req: Request, res: Response) => {
  try {
    const summary = await documentIntelligenceService.generateDocumentSummary(parseInt(req.params.id));
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /properties/:id/documents — all documents for a property
router.get('/properties/:id/documents', async (req: Request, res: Response) => {
  try {
    const docs = await documentIntelligenceService.getDocumentsByProperty(parseInt(req.params.id));
    res.json({ documents: docs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /deals/:id/documents — all documents for a deal
router.get('/deals/:id/documents', async (req: Request, res: Response) => {
  try {
    const docs = await documentIntelligenceService.getDocumentsByDeal(parseInt(req.params.id));
    res.json({ documents: docs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /search — semantic document search
router.post('/search', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { query, filters } = req.body;
    const results = await documentIntelligenceService.searchDocuments(org.id, query, filters);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
