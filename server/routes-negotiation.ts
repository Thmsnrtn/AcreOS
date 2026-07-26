import { Router, type Request, type Response } from 'express';
import { negotiationCopilotService } from './services/negotiationCopilot';
import { Errors } from './utils/errors';

const router = Router();

// Verify the :id session belongs to the caller's org before any action. Without
// this, any authenticated user could read/close/manipulate another org's
// negotiation session just by guessing the numeric id (cross-tenant IDOR).
// Mirrors requireOwnedQualificationId in routes-buyer-qualification.ts. Returns
// the parsed id, or null after having already sent the 400/404 response.
async function requireOwnedSessionId(req: Request, res: Response): Promise<number | null> {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { Errors.badRequest(res, "Invalid session ID"); return null; }
  const org = req.organization;
  const session = await negotiationCopilotService.getSessionById(id);
  if (!session || session.organizationId !== org.id) {
    Errors.notFound(res, "Session");
    return null;
  }
  return id;
}


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
    const id = await requireOwnedSessionId(req, res);
    if (id === null) return;
    const { outcome, finalPrice, lessons } = req.body;
    await negotiationCopilotService.closeSession(id, outcome, finalPrice);
    if (lessons) {
      await negotiationCopilotService.recordLessonsLearned(id, lessons);
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
    const id = await requireOwnedSessionId(req, res);
    if (id === null) return;
    const { messageText } = req.body;
    const objection = await negotiationCopilotService.detectObjection(id, messageText);
    res.json({ objection });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.post('/sessions/:id/generate-response', async (req: Request, res: Response) => {
  try {
    const id = await requireOwnedSessionId(req, res);
    if (id === null) return;
    const { objectionId, strategy } = req.body;
    const response = await negotiationCopilotService.generateResponse(
      id,
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
    const id = await requireOwnedSessionId(req, res);
    if (id === null) return;
    const suggestion = await negotiationCopilotService.suggestCounterOffer(id);
    res.json({ suggestion });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.post('/sessions/:id/analyze-sentiment', async (req: Request, res: Response) => {
  try {
    const id = await requireOwnedSessionId(req, res);
    if (id === null) return;
    const { messageText } = req.body;
    const sentiment = await negotiationCopilotService.analyzeSentiment(
      id,
      messageText
    );
    res.json({ sentiment });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.get('/sessions/:id/strategy', async (req: Request, res: Response) => {
  try {
    const id = await requireOwnedSessionId(req, res);
    if (id === null) return;
    const strategy = await negotiationCopilotService.getRecommendedStrategy(id);
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
