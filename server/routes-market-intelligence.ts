import { Router, type Request, type Response } from 'express';
import { marketIntelligence } from './services/marketIntelligence';
import { cacheResponse } from './middleware/responseCache';
import { generateMonthlyMarketReport, generateCountyReport } from './services/marketReportGenerator';
import { logger } from './utils/logger';
import { Errors } from "./utils/errors";

const router = Router();

// GET /analyze?county=&state= — full market analysis for a county
// Cached for 10 minutes: expensive AI call, data changes slowly
router.get('/analyze', cacheResponse(600), async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return Errors.badRequest(res, 'county and state required');
    const result = await marketIntelligence.analyzeMarket(county as string, state as string);
    res.json({ analysis: result });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /health?county=&state= — market health score
// Cached for 5 minutes
router.get('/health', cacheResponse(300), async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return Errors.badRequest(res, 'county and state required');
    const health = await marketIntelligence.getMarketHealth(county as string, state as string);
    res.json({ health });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /trends?county=&state= — price trend predictions
// Cached for 10 minutes: ML inference, stable over short windows
router.get('/trends', cacheResponse(600), async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return Errors.badRequest(res, 'county and state required');
    const trends = await marketIntelligence.predictPriceTrends(county as string, state as string);
    res.json({ trends });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// POST /compare — compare multiple markets side by side
router.post('/compare', async (req: Request, res: Response) => {
  try {
    const { markets } = req.body; // [{ county, state }]
    const comparison = await marketIntelligence.compareMarkets(markets);
    res.json({ comparison });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /growth-indicators?county=&state= — growth factor breakdown
// Cached for 5 minutes
router.get('/growth-indicators', cacheResponse(300), async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) return Errors.badRequest(res, 'county and state required');
    const indicators = await marketIntelligence.getGrowthIndicators(county as string, state as string);
    res.json({ indicators });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /accuracy — prediction accuracy tracking
// Cached for 15 minutes: aggregate metric, updated infrequently
router.get('/accuracy', cacheResponse(900), async (req: Request, res: Response) => {
  try {
    const accuracy = await marketIntelligence.trackPredictionAccuracy();
    res.json({ accuracy });
  } catch (err: any) {
    Errors.internal(res, err);
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
    Errors.internal(res, err);
  }
});

// GET /county-report?state=&county= — county deep dive PDF
router.get('/county-report', async (req: Request, res: Response) => {
  try {
    const { state, county } = req.query;
    if (!state || !county) {
      return Errors.badRequest(res, 'state and county query params required');
    }
    const pdf = await generateCountyReport(state as string, county as string);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${county}-${state}-deep-dive.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error('county report generation failed', err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// GET /public/data was removed (quality directive 2026-09-29): it served
// eight hard-coded state price-per-acre figures stamped with a fresh
// `generatedAt`, unauthenticated, presented as market intelligence. It had no
// caller. There is no public market figure until one is computed from real,
// consented data (DEFECT-0155's cohort rules).

export default router;
