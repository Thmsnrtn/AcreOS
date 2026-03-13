// @ts-nocheck
import { Router, type Request, type Response } from 'express';
import { taxOptimizationEngine as taxOptimizationService } from './services/taxOptimizationEngine';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// STRATEGIES
// =====================

// GET /tax-optimization/strategies — list recommended strategies for org
router.get('/tax-optimization/strategies', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { type } = req.query;
    const strategies = await taxOptimizationService.listStrategies({
      organizationId: org.id,
      type: type as string | undefined,
    });
    res.json({ strategies });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /tax-optimization/strategies/:id — single strategy detail
router.get('/tax-optimization/strategies/:id', async (req: Request, res: Response) => {
  try {
    const strategy = await taxOptimizationService.getStrategy(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json({ strategy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /tax-optimization/analyze — run full portfolio tax analysis
router.post('/tax-optimization/analyze', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyIds, taxYear, includeProjections } = req.body;
    const analysis = await taxOptimizationService.analyzePortfolio({
      organizationId: org.id,
      propertyIds: propertyIds ?? [],
      taxYear: taxYear ?? new Date().getFullYear(),
      includeProjections: includeProjections ?? true,
    });
    res.json({ analysis, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// SCENARIOS
// =====================

// GET /tax-optimization/scenarios — list tax forecast scenarios
router.get('/tax-optimization/scenarios', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId } = req.query;
    const scenarios = await taxOptimizationService.listScenarios({
      organizationId: org.id,
      propertyId: propertyId as string | undefined,
    });
    res.json({ scenarios });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /tax-optimization/scenarios — create new tax scenario
router.post('/tax-optimization/scenarios', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const {
      name,
      scenarioType,
      propertyId,
      parameters,
      notes,
    } = req.body;
    if (!name || !scenarioType) {
      return res.status(400).json({ error: 'name and scenarioType are required' });
    }
    const scenario = await taxOptimizationService.createScenario({
      organizationId: org.id,
      name,
      scenarioType,
      propertyId: propertyId ?? null,
      parameters: parameters ?? {},
      notes: notes ?? '',
    });
    res.status(201).json({ scenario, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /tax-optimization/scenarios/:id — get scenario detail
router.get('/tax-optimization/scenarios/:id', async (req: Request, res: Response) => {
  try {
    const scenario = await taxOptimizationService.getScenario(req.params.id);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }
    res.json({ scenario });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /tax-optimization/scenarios/:id — delete scenario
router.delete('/tax-optimization/scenarios/:id', async (req: Request, res: Response) => {
  try {
    await taxOptimizationService.deleteScenario(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// COST BASIS
// =====================

// GET /tax-optimization/cost-basis/:propertyId — cost basis for property
router.get('/tax-optimization/cost-basis/:propertyId', async (req: Request, res: Response) => {
  try {
    const costBasis = await taxOptimizationService.getCostBasis(req.params.propertyId);
    res.json({ costBasis });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /tax-optimization/cost-basis — record cost basis
router.post('/tax-optimization/cost-basis', async (req: Request, res: Response) => {
  try {
    const {
      propertyId,
      purchasePrice,
      closingCosts,
      improvements,
      depreciationTaken,
      acquisitionDate,
      notes,
    } = req.body;
    if (!propertyId || purchasePrice == null) {
      return res.status(400).json({ error: 'propertyId and purchasePrice are required' });
    }
    const costBasis = await taxOptimizationService.recordCostBasis({
      propertyId,
      purchasePrice,
      closingCosts: closingCosts ?? 0,
      improvements: improvements ?? [],
      depreciationTaken: depreciationTaken ?? 0,
      acquisitionDate: acquisitionDate ?? new Date().toISOString(),
      notes: notes ?? '',
    });
    res.status(201).json({ costBasis, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// OPPORTUNITY ZONES
// =====================

// GET /tax-optimization/oz-holdings — opportunity zone holdings
router.get('/tax-optimization/oz-holdings', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const holdings = await taxOptimizationService.getOZHoldings(org.id);
    res.json({ holdings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /tax-optimization/oz-holdings — add OZ holding
router.post('/tax-optimization/oz-holdings', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const {
      propertyId,
      censusTrackId,
      investmentDate,
      deferredGain,
      fundName,
      notes,
    } = req.body;
    if (!propertyId || !investmentDate) {
      return res.status(400).json({ error: 'propertyId and investmentDate are required' });
    }
    const holding = await taxOptimizationService.addOZHolding({
      organizationId: org.id,
      propertyId,
      censusTrackId: censusTrackId ?? null,
      investmentDate,
      deferredGain: deferredGain ?? 0,
      fundName: fundName ?? null,
      notes: notes ?? '',
    });
    res.status(201).json({ holding, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// DEPRECIATION
// =====================

// GET /tax-optimization/depreciation/:propertyId — depreciation schedule
router.get('/tax-optimization/depreciation/:propertyId', async (req: Request, res: Response) => {
  try {
    const { method } = req.query; // straight_line | accelerated | bonus
    const schedule = await taxOptimizationService.getDepreciationSchedule(
      req.params.propertyId,
      (method as string) ?? 'straight_line'
    );
    res.json({ schedule });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
