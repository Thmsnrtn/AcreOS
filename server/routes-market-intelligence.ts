import { Router, type Request, type Response } from 'express';
import { marketIntelligence } from './services/marketIntelligence';

const router = Router();

// GET /analyze?county=&state= — full market analysis for a county
router.get('/analyze', async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return res.status(400).json({ error: 'county and state required' });
    const result = await marketIntelligence.analyzeMarket(county as string, state as string);
    res.json({ analysis: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /health?county=&state= — market health score
router.get('/health', async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return res.status(400).json({ error: 'county and state required' });
    const health = await marketIntelligence.getMarketHealth(county as string, state as string);
    res.json({ health });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trends?county=&state= — price trend predictions
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return res.status(400).json({ error: 'county and state required' });
    const trends = await marketIntelligence.predictPriceTrends(county as string, state as string);
    res.json({ trends });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /compare — compare multiple markets side by side
router.post('/compare', async (req: Request, res: Response) => {
  try {
    const { markets } = req.body; // [{ county, state }]
    const comparison = await marketIntelligence.compareMarkets(markets);
    res.json({ comparison });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /growth-indicators?county=&state= — growth factor breakdown
router.get('/growth-indicators', async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return res.status(400).json({ error: 'county and state required' });
    const indicators = await marketIntelligence.getGrowthIndicators(county as string, state as string);
    res.json({ indicators });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /accuracy — prediction accuracy tracking
router.get('/accuracy', async (req: Request, res: Response) => {
  try {
    const accuracy = await marketIntelligence.trackPredictionAccuracy();
    res.json({ accuracy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
