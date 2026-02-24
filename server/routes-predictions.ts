import { Router, type Request, type Response } from 'express';
import { marketPredictionService } from './services/marketPrediction';

const router = Router();

/**
 * GET /api/predictions/county/:state/:county
 * Get market predictions for a specific county
 */
router.get('/county/:state/:county', async (req: Request, res: Response) => {
  try {
    const { state, county } = req.params;
    const prediction = await marketPredictionService.getPrediction({ state, county });

    if (!prediction) {
      return res.json({
        success: true,
        prediction: null,
        message: 'No prediction data available for this market yet.',
      });
    }

    res.json({ success: true, prediction });
  } catch (error) {
    console.error('Failed to get county prediction:', error);
    res.status(500).json({ error: 'Failed to get market prediction' });
  }
});

/**
 * GET /api/predictions/property/:id/trajectory
 * Get price trajectory predictions for a specific property
 */
router.get('/property/:id/trajectory', async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.id);
    const trajectory = await marketPredictionService.getPropertyTrajectory(propertyId);

    if (!trajectory) {
      return res.json({
        success: true,
        trajectory: null,
        message: 'Not enough data to generate trajectory for this property.',
      });
    }

    res.json({ success: true, trajectory });
  } catch (error) {
    console.error('Failed to get property trajectory:', error);
    res.status(500).json({ error: 'Failed to get price trajectory' });
  }
});

/**
 * GET /api/predictions/opportunity-windows
 * Get current opportunity windows (hot markets)
 */
router.get('/opportunity-windows', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const windows = await marketPredictionService.getOpportunityWindows(limit);

    res.json({ success: true, windows });
  } catch (error) {
    console.error('Failed to get opportunity windows:', error);
    res.status(500).json({ error: 'Failed to detect opportunity windows' });
  }
});

/**
 * GET /api/predictions/market-timing/:state/:county
 * Get market timing indicator (hot/warm/cooling/cold)
 */
router.get('/market-timing/:state/:county', async (req: Request, res: Response) => {
  try {
    const { state, county } = req.params;
    const prediction = await marketPredictionService.getPrediction({ state, county });

    if (!prediction) {
      return res.json({
        success: true,
        timing: null,
        message: 'No timing data available for this market.',
      });
    }

    res.json({
      success: true,
      timing: {
        marketTiming: prediction.prediction.marketTiming,
        confidence: prediction.prediction.timingConfidence,
        demandScore: prediction.prediction.demandScore,
        isOpportunityWindow: prediction.prediction.isOpportunityWindow,
      },
    });
  } catch (error) {
    console.error('Failed to get market timing:', error);
    res.status(500).json({ error: 'Failed to get market timing' });
  }
});

/**
 * POST /api/predictions/refresh/:state/:county
 * Force refresh predictions for a specific county
 */
router.post('/refresh/:state/:county', async (req: Request, res: Response) => {
  try {
    const { state, county } = req.params;
    // getPrediction will regenerate if stale
    const prediction = await marketPredictionService.getPrediction({ state, county });

    res.json({
      success: true,
      message: 'Predictions refreshed',
      prediction,
    });
  } catch (error) {
    console.error('Failed to refresh predictions:', error);
    res.status(500).json({ error: 'Failed to refresh predictions' });
  }
});

/**
 * GET /api/predictions/hot-markets
 * Get list of hot markets based on predictions
 */
router.get('/hot-markets', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const markets = await marketPredictionService.getOpportunityWindows(limit);

    res.json({ success: true, markets });
  } catch (error) {
    console.error('Failed to get hot markets:', error);
    res.status(500).json({ error: 'Failed to get hot markets' });
  }
});

export default router;
