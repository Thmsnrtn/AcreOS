import { Router, type Request, type Response } from 'express';
import { visionAI } from './services/visionAI';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// POST /analyze-photo — analyze a single property photo by URL
router.post('/analyze-photo', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { photoId, imageUrl } = req.body;
    const result = await visionAI.analyzePhoto(org.id.toString(), parseInt(photoId), imageUrl);
    res.json({ analysis: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /properties/:id/analyze — analyze all photos for a property
router.post('/properties/:id/analyze', async (req: Request, res: Response) => {
  try {
    const result = await visionAI.analyzePropertyPhotos(parseInt(req.params.id));
    res.json({ results: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /properties/:id/best-photo — get the highest-quality marketing photo
router.get('/properties/:id/best-photo', async (req: Request, res: Response) => {
  try {
    const photo = await visionAI.getBestMarketingPhoto(parseInt(req.params.id));
    res.json({ photo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /properties/:id/description — generate AI marketing description
router.post('/properties/:id/description', async (req: Request, res: Response) => {
  try {
    const description = await visionAI.generatePropertyDescription(parseInt(req.params.id));
    res.json({ description });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /properties/:id/snapshots — list satellite snapshots
router.get('/properties/:id/snapshots', async (req: Request, res: Response) => {
  try {
    const snapshots = await visionAI.getPropertySnapshots(parseInt(req.params.id));
    res.json({ snapshots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /properties/:id/satellite — capture new satellite snapshot
router.post('/properties/:id/satellite', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, zoom } = req.body;
    const snapshot = await visionAI.captureSatelliteSnapshot(
      parseInt(req.params.id),
      { latitude, longitude },
      zoom || 15
    );
    res.json({ snapshot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /properties/:id/detect-changes — compare two satellite snapshots
router.post('/properties/:id/detect-changes', async (req: Request, res: Response) => {
  try {
    const { snapshotId1, snapshotId2 } = req.body;
    const result = await visionAI.detectChanges(
      parseInt(req.params.id),
      parseInt(snapshotId1),
      parseInt(snapshotId2)
    );
    res.json({ changes: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /properties/:id/summary — full visual intelligence summary for a property
router.get('/properties/:id/summary', async (req: Request, res: Response) => {
  try {
    const summary = await visionAI.getPropertyAnalysisSummary(parseInt(req.params.id));
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /find-similar — find visually similar properties
router.post('/find-similar', async (req: Request, res: Response) => {
  try {
    const { propertyId, limit } = req.body;
    const similar = await visionAI.findSimilarProperties(parseInt(propertyId), limit || 10);
    res.json({ properties: similar });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /batch-analyze — batch analyze multiple photos
router.post('/batch-analyze', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId } = req.body;
    const results = await visionAI.batchAnalyzePhotos(parseInt(propertyId), org.id.toString());
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
