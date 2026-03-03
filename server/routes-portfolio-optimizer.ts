import { Router, type Request, type Response } from 'express';
import { portfolioOptimizer } from './services/portfolioOptimizer';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// FULL ANALYSIS
// =====================

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { yearsForward = 5 } = req.body;
    const analysis = await portfolioOptimizer.runCompleteAnalysis(
      org.id.toString(),
      yearsForward
    );
    res.json({ analysis });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// MONTE CARLO
// =====================

router.post('/simulate', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { yearsForward = 5, numSimulations = 10000 } = req.body;
    const holdings = await portfolioOptimizer.getPortfolioHoldings(org.id.toString());
    if (holdings.length === 0) {
      return res.status(400).json({ error: 'No owned properties found in portfolio' });
    }
    const monteCarlo = await portfolioOptimizer.runMonteCarloSimulation(
      org.id.toString(),
      holdings,
      yearsForward,
      numSimulations
    );
    res.json({ monteCarlo });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/simulations', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { limit = 10 } = req.query;
    const simulations = await portfolioOptimizer.getSimulations(
      org.id.toString(),
      parseInt(limit as string)
    );
    res.json({ simulations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// METRICS & DIVERSIFICATION
// =====================

router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const holdings = await portfolioOptimizer.getPortfolioHoldings(org.id.toString());
    if (holdings.length === 0) {
      return res.json({ metrics: null, holdings: [] });
    }
    const metrics = await portfolioOptimizer.calculatePortfolioMetrics(
      org.id.toString(),
      holdings
    );
    res.json({ metrics, holdings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/diversification', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const holdings = await portfolioOptimizer.getPortfolioHoldings(org.id.toString());
    if (holdings.length === 0) {
      return res.json({ diversification: null });
    }
    const diversification = await portfolioOptimizer.analyzeDiversification(
      org.id.toString(),
      holdings
    );
    res.json({ diversification });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// RECOMMENDATIONS
// =====================

router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const recommendations = await portfolioOptimizer.getPendingRecommendations(
      org.id.toString()
    );
    res.json({ recommendations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/recommendations/:id', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { status } = req.body;
    await portfolioOptimizer.updateRecommendationStatus(
      org.id.toString(),
      req.params.id,
      status
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
