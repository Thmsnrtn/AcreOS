import { Router, type Request, type Response } from 'express';
import { acquisitionRadar } from './services/acquisitionRadar';

const router = Router();


// =====================
// CONFIGURATION
// =====================

router.get('/config', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const config = await acquisitionRadar.getOrCreateConfig(org.id);
    res.json({ config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config/:id', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const config = await acquisitionRadar.updateConfig(
      org.id,
      parseInt(req.params.id),
      req.body
    );
    res.json({ config });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// OPPORTUNITIES
// =====================

router.get('/opportunities', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { limit, county, state, opportunityType, minScore, status } = req.query;
    const opportunities = await acquisitionRadar.getTopOpportunities(org.id, {
      limit: limit ? parseInt(limit as string) : 20,
      county: county as string | undefined,
      state: state as string | undefined,
      opportunityType: opportunityType as any,
      minScore: minScore ? parseInt(minScore as string) : 40,
      status: status as string | undefined,
    });
    res.json({ opportunities });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/opportunities/by-market', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const byMarket = await acquisitionRadar.getOpportunitiesByMarket(org.id);
    res.json({ byMarket });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const stats = await acquisitionRadar.getRadarStats(org.id);
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// SCORING A PARCEL
// =====================

router.post('/score', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const config = await acquisitionRadar.getOrCreateConfig(org.id);
    const result = await acquisitionRadar.scoreParcel(req.body, config);

    // Save the score
    await acquisitionRadar.saveOpportunityScore(org.id, req.body, result, config.id);

    res.json({ result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// STATUS UPDATE
// =====================

router.patch('/opportunities/:id/status', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { status, reviewNotes } = req.body;
    await acquisitionRadar.updateOpportunityStatus(parseInt(req.params.id), org.id, status, reviewNotes);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
