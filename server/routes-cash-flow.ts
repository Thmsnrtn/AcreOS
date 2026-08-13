import { Router, type Request, type Response } from 'express';
import {
  cashFlowForecasterService,
  CashFlowNotInOrgError,
} from './services/cashFlowForecaster';
import { Errors } from './utils/errors';
import { getOrganizationId } from './types/request';

const router = Router();

/**
 * A note, property or forecast id that is not this org's answers 404.
 *
 * The org-level handlers here always passed `org.id`; the ones keyed by
 * `:noteId` and `:forecastId` passed the id alone. And `generateForecast` —
 * which DOES take an organization — dropped it one call deep, so a `noteId`
 * from another org in the request body forecast that org's note through the
 * scoped-looking front door.
 */
function refuse(res: Response, err: unknown): void {
  if (err instanceof CashFlowNotInOrgError) {
    Errors.notFound(res, "Note");
    return;
  }
  refuse(res, err);
}


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
    // generateForecast throws CashFlowNotInOrgError when the body names a
    // note or property belonging to someone else. Without this branch the
    // refusal surfaced as a 400 quoting "not found in this organization".
    if (error instanceof CashFlowNotInOrgError) return Errors.notFound(res, 'Note');
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
    refuse(res, error);
  }
});

router.get('/portfolio/high-risk', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const highRisk = await cashFlowForecasterService.flagHighRiskNotes(org.id);
    res.json({ highRisk });
  } catch (error) {
    refuse(res, error);
  }
});

// =====================
// NOTE HEALTH
// =====================

router.get('/notes/:noteId/health', async (req: Request, res: Response) => {
  try {
    const health = await cashFlowForecasterService.analyzePaymentHealth(parseInt(req.params.noteId), getOrganizationId(req));
    res.json({ health });
  } catch (error) {
    refuse(res, error);
  }
});

router.get('/notes/:noteId/risk-score', async (req: Request, res: Response) => {
  try {
    const riskScore = await cashFlowForecasterService.calculatePaymentRiskScore(parseInt(req.params.noteId), getOrganizationId(req));
    const riskFactors = await cashFlowForecasterService.identifyRiskFactors(parseInt(req.params.noteId), getOrganizationId(req));
    res.json({ riskScore, riskFactors });
  } catch (error) {
    refuse(res, error);
  }
});

// =====================
// INSIGHTS
// =====================

router.get('/forecast/:forecastId/insights', async (req: Request, res: Response) => {
  try {
    const insights = await cashFlowForecasterService.generateInsights(parseInt(req.params.forecastId), getOrganizationId(req));
    res.json({ insights });
  } catch (error) {
    refuse(res, error);
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
    refuse(res, error);
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
    refuse(res, error);
  }
});

export default router;
