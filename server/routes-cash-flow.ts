import { Router, type Request, type Response } from 'express';
import { cashFlowForecasterService } from './services/cashFlowForecaster';
import { Errors } from './utils/errors';

const router = Router();


// =====================
// GENERATE FORECAST
// =====================

router.post('/forecast', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { noteId, propertyId, periodMonths = 12 } = req.body;
    const forecast = await cashFlowForecasterService.generateForecast(
      org.id,
      { noteId, propertyId, periodMonths }
    );
    res.json({ forecast });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// =====================
// PORTFOLIO SUMMARY
// =====================

router.get('/portfolio/summary', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const summary = await cashFlowForecasterService.getPortfolioCashFlowSummary(org.id);
    res.json({ summary });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.get('/portfolio/high-risk', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const highRisk = await cashFlowForecasterService.flagHighRiskNotes(org.id);
    res.json({ highRisk });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// NOTE HEALTH
// =====================

router.get('/notes/:noteId/health', async (req: Request, res: Response) => {
  try {
    const health = await cashFlowForecasterService.analyzePaymentHealth(parseInt(req.params.noteId));
    res.json({ health });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.get('/notes/:noteId/risk-score', async (req: Request, res: Response) => {
  try {
    const riskScore = await cashFlowForecasterService.calculatePaymentRiskScore(parseInt(req.params.noteId));
    const riskFactors = await cashFlowForecasterService.identifyRiskFactors(parseInt(req.params.noteId));
    res.json({ riskScore, riskFactors });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// INSIGHTS
// =====================

router.get('/forecast/:forecastId/insights', async (req: Request, res: Response) => {
  try {
    const insights = await cashFlowForecasterService.generateInsights(parseInt(req.params.forecastId));
    res.json({ insights });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// PORTFOLIO TIMELINE
// =====================

// GET /api/cash-flow/portfolio/timeline?months=24
// Returns month-by-month income projections across all active notes + owned properties.
router.get('/portfolio/timeline', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const months = Math.min(parseInt((req.query.months as string) || '24', 10), 36);
    const timeline = await cashFlowForecasterService.getPortfolioTimeline(org.id, months);
    res.json({ timeline });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// ACCURACY TRACKING
// =====================

router.get('/forecast/actual-vs-projected', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { periodMonths = 6 } = req.query;
    const comparison = await cashFlowForecasterService.compareActualVsProjected(
      org.id,
      parseInt(periodMonths as string)
    );
    res.json({ comparison });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
