import { Router, type Request, type Response } from 'express';
import { landCredit } from './services/landCredit';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// CALCULATE / GET SCORE
// =====================

router.post('/score/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const score = await landCredit.calculateCreditScore(
      org.id.toString(),
      req.params.propertyId
    );
    res.json({ score });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/property/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const history = await landCredit.getScoreHistory(
      org.id.toString(),
      req.params.propertyId
    );
    res.json({ history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// PORTFOLIO DISTRIBUTION
// =====================

router.get('/portfolio', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const distribution = await landCredit.getPortfolioScoreDistribution(org.id.toString());
    res.json({ distribution });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// BULK SCORING
// =====================

router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    await landCredit.calculateBulkScores(org.id.toString());
    res.json({ success: true, message: 'Bulk scoring started' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
