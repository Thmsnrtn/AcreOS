import { Router, type Request, type Response } from 'express';
import { cashFlowForecasterService } from './services/cashFlowForecaster';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// GENERATE FORECAST
// =====================

router.post('/forecast', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { noteId, propertyId, periodMonths = 12 } = req.body;
    const forecast = await cashFlowForecasterService.generateForecast(
      org.id,
      { noteId, propertyId, periodMonths }
    );
    res.json({ forecast });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// PORTFOLIO SUMMARY
// =====================

router.get('/portfolio/summary', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const summary = await cashFlowForecasterService.getPortfolioCashFlowSummary(org.id);
    res.json({ summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/portfolio/high-risk', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const highRisk = await cashFlowForecasterService.flagHighRiskNotes(org.id);
    res.json({ highRisk });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// NOTE HEALTH
// =====================

router.get('/notes/:noteId/health', async (req: Request, res: Response) => {
  try {
    const health = await cashFlowForecasterService.analyzePaymentHealth(parseInt(req.params.noteId));
    res.json({ health });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notes/:noteId/risk-score', async (req: Request, res: Response) => {
  try {
    const riskScore = await cashFlowForecasterService.calculatePaymentRiskScore(parseInt(req.params.noteId));
    const riskFactors = await cashFlowForecasterService.identifyRiskFactors(parseInt(req.params.noteId));
    res.json({ riskScore, riskFactors });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// INSIGHTS
// =====================

router.get('/forecast/:forecastId/insights', async (req: Request, res: Response) => {
  try {
    const insights = await cashFlowForecasterService.generateInsights(parseInt(req.params.forecastId));
    res.json({ insights });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// ACCURACY TRACKING
// =====================

router.get('/forecast/actual-vs-projected', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { periodMonths = 6 } = req.query;
    const comparison = await cashFlowForecasterService.compareActualVsProjected(
      org.id,
      parseInt(periodMonths as string)
    );
    res.json({ comparison });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
