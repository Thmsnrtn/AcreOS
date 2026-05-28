import { Router, type Request, type Response } from 'express';
import { negotiationCopilotService } from './services/negotiationCopilot';
import { Errors } from './utils/errors';

const router = Router();


// =====================
// SESSION MANAGEMENT
// =====================

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { dealId, leadId, initialOffer, askingPrice } = req.body;
    const session = await negotiationCopilotService.startSession(
      org.id,
      Number(dealId),
      Number(leadId),
      Number(initialOffer),
      Number(askingPrice)
    );
    res.json({ session });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const sessions = await negotiationCopilotService.getSessionHistory(org.id, parseInt(req.params.id));
    res.json({ sessions });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.get('/deal/:dealId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const sessions = await negotiationCopilotService.getSessionHistory(org.id, parseInt(req.params.dealId));
    res.json({ sessions });
  } catch (error) {
    Errors.internal(res, error);
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
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
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
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
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
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.post('/sessions/:id/counter-offer', async (req: Request, res: Response) => {
  try {
    const suggestion = await negotiationCopilotService.suggestCounterOffer(parseInt(req.params.id));
    res.json({ suggestion });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
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
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.get('/sessions/:id/strategy', async (req: Request, res: Response) => {
  try {
    const strategy = await negotiationCopilotService.getRecommendedStrategy(parseInt(req.params.id));
    res.json({ strategy });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// ANALYTICS
// =====================

router.get('/effectiveness', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const effectiveness = await negotiationCopilotService.analyzeObjectionEffectiveness(org.id);
    res.json({ effectiveness });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
