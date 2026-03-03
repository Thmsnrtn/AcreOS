import { Router, type Request, type Response } from 'express';
import { negotiationCopilotService } from './services/negotiationCopilot';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// SESSION MANAGEMENT
// =====================

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { dealId, leadId, propertyId, initialOffer, askingPrice } = req.body;
    const session = await negotiationCopilotService.startSession(
      org.id,
      dealId,
      leadId,
      propertyId,
      { initialOffer, askingPrice }
    );
    res.json({ session });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const sessions = await negotiationCopilotService.getSessionHistory(org.id, parseInt(req.params.id));
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/deal/:dealId', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const sessions = await negotiationCopilotService.getSessionHistory(org.id, parseInt(req.params.dealId));
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sessions/:id/close', async (req: Request, res: Response) => {
  try {
    const { outcome, finalPrice, lessons } = req.body;
    await negotiationCopilotService.closeSession(parseInt(req.params.id), outcome, finalPrice);
    if (lessons) {
      await negotiationCopilotService.recordLessonsLearned(parseInt(req.params.id), lessons);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// ANALYSIS ENDPOINTS
// =====================

router.post('/sessions/:id/detect-objection', async (req: Request, res: Response) => {
  try {
    const { messageText } = req.body;
    const objection = await negotiationCopilotService.detectObjection(parseInt(req.params.id), messageText);
    res.json({ objection });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/sessions/:id/generate-response', async (req: Request, res: Response) => {
  try {
    const { objectionId, strategy } = req.body;
    const response = await negotiationCopilotService.generateResponse(
      parseInt(req.params.id),
      objectionId,
      strategy
    );
    res.json({ response });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/sessions/:id/counter-offer', async (req: Request, res: Response) => {
  try {
    const suggestion = await negotiationCopilotService.suggestCounterOffer(parseInt(req.params.id));
    res.json({ suggestion });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/sessions/:id/analyze-sentiment', async (req: Request, res: Response) => {
  try {
    const { messageText } = req.body;
    const sentiment = await negotiationCopilotService.analyzeSentiment(
      parseInt(req.params.id),
      messageText
    );
    res.json({ sentiment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/sessions/:id/strategy', async (req: Request, res: Response) => {
  try {
    const strategy = await negotiationCopilotService.getRecommendedStrategy(parseInt(req.params.id));
    res.json({ strategy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// ANALYTICS
// =====================

router.get('/effectiveness', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const effectiveness = await negotiationCopilotService.analyzeObjectionEffectiveness(org.id);
    res.json({ effectiveness });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
