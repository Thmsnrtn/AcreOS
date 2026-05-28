import { Router, type Request, type Response } from 'express';
import { taxOptimizationEngine as taxOptimizationService } from './services/taxOptimizationEngine';
import { Errors } from "./utils/errors";

const router = Router();


// =====================
// STRATEGIES
// =====================

// TODO(tsc): taxOptimizationEngine exposes analyzePortfolio(orgId),
// generateTaxScenario, rankStrategies, getMultiYearProjection,
// computeDepreciationStrategy, and OZ benefit calculators — NOT the
// listStrategies/getStrategy/listScenarios/createScenario/getScenario/
// deleteScenario/getCostBasis/recordCostBasis/getOZHoldings/addOZHolding/
// getDepreciationSchedule API these routes were written against. Those methods
// do not exist on the service and crashed at runtime previously. The portfolio
// analyze endpoint is wired to analyzePortfolio(org.id); the strategy CRUD,
// scenario CRUD, cost-basis, OZ-holdings, and depreciation-schedule endpoints
// return 501 until those service methods are built.

// GET /tax-optimization/strategies — list recommended strategies for org
router.get('/tax-optimization/strategies', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Strategies endpoint not implemented' });
});

// GET /tax-optimization/strategies/:id — single strategy detail
router.get('/tax-optimization/strategies/:id', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Strategy detail endpoint not implemented' });
});

// POST /tax-optimization/analyze — run full portfolio tax analysis
router.post('/tax-optimization/analyze', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const analysis = await taxOptimizationService.analyzePortfolio(org.id);
    res.json({ analysis, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
});

// =====================
// SCENARIOS
// =====================

// GET /tax-optimization/scenarios — list tax forecast scenarios
router.get('/tax-optimization/scenarios', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Scenarios list endpoint not implemented' });
});

// POST /tax-optimization/scenarios — create new tax scenario
router.post('/tax-optimization/scenarios', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Scenario create endpoint not implemented' });
});

// GET /tax-optimization/scenarios/:id — get scenario detail
router.get('/tax-optimization/scenarios/:id', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Scenario detail endpoint not implemented' });
});

// DELETE /tax-optimization/scenarios/:id — delete scenario
router.delete('/tax-optimization/scenarios/:id', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Scenario delete endpoint not implemented' });
});

// =====================
// COST BASIS
// =====================

// GET /tax-optimization/cost-basis/:propertyId — cost basis for property
router.get('/tax-optimization/cost-basis/:propertyId', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Cost-basis get endpoint not implemented' });
});

// POST /tax-optimization/cost-basis — record cost basis
router.post('/tax-optimization/cost-basis', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Cost-basis record endpoint not implemented' });
});

// =====================
// OPPORTUNITY ZONES
// =====================

// GET /tax-optimization/oz-holdings — opportunity zone holdings
router.get('/tax-optimization/oz-holdings', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'OZ-holdings list endpoint not implemented' });
});

// POST /tax-optimization/oz-holdings — add OZ holding
router.post('/tax-optimization/oz-holdings', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'OZ-holding create endpoint not implemented' });
});

// =====================
// DEPRECIATION
// =====================

// GET /tax-optimization/depreciation/:propertyId — depreciation schedule
router.get('/tax-optimization/depreciation/:propertyId', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Depreciation-schedule endpoint not implemented' });
});

export default router;
