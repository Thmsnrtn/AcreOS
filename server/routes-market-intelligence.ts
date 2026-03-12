import { Router, type Request, type Response } from 'express';
import { marketIntelligence } from './services/marketIntelligence';
import { cacheResponse } from './middleware/responseCache';

const router = Router();

// GET /analyze?county=&state= — full market analysis for a county
// Cached for 10 minutes: expensive AI call, data changes slowly
router.get('/analyze', cacheResponse(600), async (req: Request, res: Response) => {
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
// Cached for 5 minutes
router.get('/health', cacheResponse(300), async (req: Request, res: Response) => {
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
// Cached for 10 minutes: ML inference, stable over short windows
router.get('/trends', cacheResponse(600), async (req: Request, res: Response) => {
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
// Cached for 5 minutes
router.get('/growth-indicators', cacheResponse(300), async (req: Request, res: Response) => {
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
// Cached for 15 minutes: aggregate metric, updated infrequently
router.get('/accuracy', cacheResponse(900), async (req: Request, res: Response) => {
  try {
    const accuracy = await marketIntelligence.trackPredictionAccuracy();
    res.json({ accuracy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
