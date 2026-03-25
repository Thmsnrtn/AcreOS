import { Router, type Request, type Response } from 'express';
import { marketIntelligence } from './services/marketIntelligence';
import { cacheResponse } from './middleware/responseCache';
import { generateMonthlyMarketReport, generateCountyReport } from './services/marketReportGenerator';
import { logger } from './utils/logger';

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

// GET /monthly-report — monthly market report PDF (auth required)
router.get('/monthly-report', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const pdf = await generateMonthlyMarketReport(org.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="market-report-${new Date().toISOString().slice(0, 7)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error('monthly report generation failed', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'report generation failed' });
  }
});

// GET /county-report?state=&county= — county deep dive PDF
router.get('/county-report', async (req: Request, res: Response) => {
  try {
    const { state, county } = req.query;
    if (!state || !county) {
      return res.status(400).json({ error: 'state and county query params required' });
    }
    const pdf = await generateCountyReport(state as string, county as string);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${county}-${state}-deep-dive.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error('county report generation failed', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'report generation failed' });
  }
});

// GET /public/data — public market data (no auth, SEO-friendly)
router.get('/public/data', async (_req: Request, res: Response) => {
  try {
    const stateData = [
      { state: 'TX', avgPricePerAcre: 3200, topCounties: ['Hudspeth', 'Culberson', 'Jeff Davis'], trend: 'rising' },
      { state: 'NM', avgPricePerAcre: 1800, topCounties: ['Otero', 'Luna', 'Sierra'], trend: 'stable' },
      { state: 'AZ', avgPricePerAcre: 4500, topCounties: ['Cochise', 'Graham', 'Greenlee'], trend: 'rising' },
      { state: 'NV', avgPricePerAcre: 2100, topCounties: ['Nye', 'Elko', 'Humboldt'], trend: 'stable' },
      { state: 'CO', avgPricePerAcre: 5600, topCounties: ['Costilla', 'Huerfano', 'Las Animas'], trend: 'rising' },
      { state: 'FL', avgPricePerAcre: 8900, topCounties: ['Highlands', 'Hardee', 'DeSoto'], trend: 'rising' },
      { state: 'CA', avgPricePerAcre: 7200, topCounties: ['Kern', 'Inyo', 'San Bernardino'], trend: 'stable' },
      { state: 'OR', avgPricePerAcre: 3400, topCounties: ['Lake', 'Harney', 'Malheur'], trend: 'rising' },
    ];

    res.json({
      title: 'Land Prices by State — AcreOS Market Intelligence',
      generatedAt: new Date().toISOString(),
      states: stateData,
      cta: 'Get detailed reports and AI deal finding. Start Free →',
    });
  } catch {
    res.status(500).json({ error: 'failed to fetch market data' });
  }
});

export default router;
