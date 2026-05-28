import { Router, type Request, type Response } from 'express';
import { portfolioOptimizer } from './services/portfolioOptimizer';
import { Errors } from './utils/errors';

const router = Router();


// =====================
// FULL ANALYSIS
// =====================

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { yearsForward = 5 } = req.body;
    const analysis = await portfolioOptimizer.runCompleteAnalysis(
      org.id,
      yearsForward
    );
    res.json({ analysis });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// =====================
// MONTE CARLO
// =====================

router.post('/simulate', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { yearsForward = 5, numSimulations = 10000 } = req.body;
    const holdings = await portfolioOptimizer.getPortfolioHoldings(org.id);
    if (holdings.length === 0) {
      return Errors.badRequest(res, 'No owned properties found in portfolio');
    }
    const monteCarlo = await portfolioOptimizer.runMonteCarloSimulation(
      org.id,
      holdings,
      yearsForward,
      numSimulations
    );
    res.json({ monteCarlo });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.get('/simulations', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { limit = 10 } = req.query;
    const simulations = await portfolioOptimizer.getSimulations(
      org.id,
      parseInt(limit as string)
    );
    res.json({ simulations });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// METRICS & DIVERSIFICATION
// =====================

router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const holdings = await portfolioOptimizer.getPortfolioHoldings(org.id);
    if (holdings.length === 0) {
      return res.json({ metrics: null, holdings: [] });
    }
    const metrics = await portfolioOptimizer.calculatePortfolioMetrics(
      org.id,
      holdings
    );
    res.json({ metrics, holdings });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.get('/diversification', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const holdings = await portfolioOptimizer.getPortfolioHoldings(org.id);
    if (holdings.length === 0) {
      return res.json({ diversification: null });
    }
    const diversification = await portfolioOptimizer.analyzeDiversification(
      org.id,
      holdings
    );
    res.json({ diversification });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// RECOMMENDATIONS
// =====================

router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const recommendations = await portfolioOptimizer.getPendingRecommendations(
      org.id
    );
    res.json({ recommendations });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.patch('/recommendations/:id', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { status } = req.body;
    await portfolioOptimizer.updateRecommendationStatus(
      org.id,
      parseInt(req.params.id),
      status
    );
    res.json({ success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

export default router;
