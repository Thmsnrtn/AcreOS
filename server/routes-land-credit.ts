import { Router, type Request, type Response } from 'express';
import { landCredit } from './services/landCredit';
import { Errors } from './utils/errors';

const router = Router();


// =====================
// CALCULATE / GET SCORE
// =====================

router.post('/score/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const score = await landCredit.calculateCreditScore(
      org.id.toString(),
      req.params.propertyId
    );
    res.json({ score });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.get('/property/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const history = await landCredit.getScoreHistory(
      org.id.toString(),
      req.params.propertyId
    );
    res.json({ history });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// PORTFOLIO DISTRIBUTION
// =====================

router.get('/portfolio', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const distribution = await landCredit.getPortfolioScoreDistribution(org.id.toString());
    res.json({ distribution });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// BULK SCORING
// =====================

router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    await landCredit.calculateBulkScores(org.id.toString());
    res.json({ success: true, message: 'Bulk scoring started' });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// =====================
// FEATURE IMPORTANCE
// =====================

router.get('/feature-importance', async (_req: Request, res: Response) => {
  try {
    const features = landCredit.getFeatureImportance();
    res.json({ features });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// SCORE DRILL-DOWN
// =====================

router.get('/drilldown/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const drillDown = await landCredit.generateScoreDrillDown(
      req.params.propertyId,
      org.id.toString()
    );
    res.json(drillDown);
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// INDUSTRY BENCHMARK
// =====================

router.get('/benchmark/:propertyId', async (req: Request, res: Response) => {
  try {
    // 2026-06-10 (Tier 2A): the benchmark is computed from the own-network
    // cohort (latest score per parcel, state-keyed, k>=5 privacy floor).
    // Below the floor it stays a typed insufficient-data result — the
    // fabricated defaults T0-12 removed do not come back.
    const { propertyType = '', state = '', score } = req.query;
    const numericScore = score ? parseInt(score as string) : 0;
    const benchmark = await landCredit.compareToIndustryBenchmarks(
      numericScore,
      propertyType as string,
      state as string
    );
    res.json({ benchmark });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// PERSONALIZE SCORE
// =====================

router.post('/personalize', async (req: Request, res: Response) => {
  try {
    const { baseScore, strategy } = req.body;
    if (!baseScore || !strategy) {
      return Errors.badRequest(res, 'baseScore and strategy are required');
    }
    const result = landCredit.personalizeScore(parseInt(baseScore), strategy);
    res.json(result);
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// BACKTEST SCORE
// =====================

router.get('/backtest/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await landCredit.backtestScore(org.id, req.params.propertyId);
    res.json(result);
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// LAND CREDIT REPORT PDF
// =====================

router.get('/report/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const pdf = await landCredit.generateLandCreditReport(
      req.params.propertyId,
      org.id.toString(),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=land-credit-report-${req.params.propertyId}.pdf`);
    res.send(pdf);
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
