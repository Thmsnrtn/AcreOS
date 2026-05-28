import { Router, type Request, type Response } from 'express';
import { visionAI } from './services/visionAI';
import { Errors } from './utils/errors';

const router = Router();


// POST /analyze-photo — analyze a single property photo by URL
router.post('/analyze-photo', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { photoId, imageUrl } = req.body;
    const result = await visionAI.analyzePhoto(org.id.toString(), parseInt(photoId), imageUrl);
    res.json({ analysis: result });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /properties/:id/analyze — analyze all photos for a property
router.post('/properties/:id/analyze', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await visionAI.analyzePropertyPhotos(org.id.toString(), parseInt(req.params.id));
    res.json({ results: result });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /properties/:id/best-photo — get the highest-quality marketing photo
router.get('/properties/:id/best-photo', async (req: Request, res: Response) => {
  try {
    const photo = await visionAI.getBestMarketingPhoto(parseInt(req.params.id));
    res.json({ photo });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /properties/:id/description — generate AI marketing description
router.post('/properties/:id/description', async (req: Request, res: Response) => {
  try {
    const description = await visionAI.generatePropertyDescription(parseInt(req.params.id));
    res.json({ description });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /properties/:id/snapshots — list satellite snapshots
router.get('/properties/:id/snapshots', async (req: Request, res: Response) => {
  try {
    const snapshots = await visionAI.getPropertySnapshots(parseInt(req.params.id));
    res.json({ snapshots });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /properties/:id/satellite — capture new satellite snapshot
router.post('/properties/:id/satellite', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, zoom, imageUrl } = req.body;
    // captureSatelliteSnapshot persists an image URL + provider. Accept a
    // pre-built imageUrl, or compose a Google Static Maps URL from coordinates.
    const resolvedImageUrl: string =
      imageUrl ||
      `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=${zoom || 15}&size=640x640&maptype=satellite`;
    const snapshot = await visionAI.captureSatelliteSnapshot(
      parseInt(req.params.id),
      resolvedImageUrl,
      'google'
    );
    res.json({ snapshot });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /properties/:id/detect-changes — compare two satellite snapshots
router.post('/properties/:id/detect-changes', async (req: Request, res: Response) => {
  try {
    const { snapshotId1, snapshotId2 } = req.body;
    const result = await visionAI.detectChanges(
      parseInt(snapshotId1),
      parseInt(snapshotId2)
    );
    res.json({ changes: result });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /properties/:id/summary — full visual intelligence summary for a property
router.get('/properties/:id/summary', async (req: Request, res: Response) => {
  try {
    const summary = await visionAI.getPropertyAnalysisSummary(parseInt(req.params.id));
    res.json({ summary });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /find-similar — find visually similar properties
router.post('/find-similar', async (req: Request, res: Response) => {
  try {
    const { propertyId, limit } = req.body;
    const similar = await visionAI.findSimilarProperties(parseInt(propertyId), limit || 10);
    res.json({ properties: similar });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /batch-analyze — batch analyze multiple photos
router.post('/batch-analyze', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    // batchAnalyzePhotos works at the org level (organizationId, maxPhotos?);
    // the prior call passed (propertyId, orgId) which did not type-check.
    const { maxPhotos } = req.body;
    const results = await visionAI.batchAnalyzePhotos(
      org.id.toString(),
      maxPhotos ? parseInt(String(maxPhotos), 10) : undefined,
    );
    res.json({ results });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
