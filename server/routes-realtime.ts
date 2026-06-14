import { Router, type Request, type Response } from 'express';
import type { AuthenticatedRequest } from './types/request';
import { realtimeAlertsService } from './services/realtimeAlerts';
import { certificationService } from './services/certification';
import { wsServer } from './websocket';
import { CreditService } from './services/credits';
import { requireOpenAIClient } from './utils/openaiClient';
import { logger } from './utils/logger';
import { Errors, sendError } from './utils/errors';
const creditService = new CreditService();

const router = Router();


function getUser(req: Request) {
  const user = req.user;
  if (!user) throw new Error('User not found');
  return user;
}

// ============================
// COMMAND PALETTE AI
// ============================

/**
 * POST /realtime/ask
 * Body: { message: string }
 * Answers a natural language question about the user's real estate business.
 * Returns a reply and optionally an action path to navigate to.
 */
router.post('/ask', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return Errors.badRequest(res, 'message is required');
    }

    // Credit check — block if org can't afford the AI call
    const org = req.organization;
    if (org) {
      const hasCredits = await creditService.hasEnoughCredits(org.id, 2);
      if (!hasCredits) {
        return sendError(res, 402, "INSUFFICIENT_CREDITS", "Insufficient credits for AI request");
      }
      // Deduct after response (fire-and-forget)
      res.on('finish', () => {
        creditService.deductCredits(org.id, 2, 'Command palette AI query').catch((err) =>
          logger.error('[realtime] credit deduction failed', err instanceof Error ? err : undefined)
        );
      });
    }

    const systemPrompt = `You are an expert AI assistant built into AcreOS, a real estate management platform.
You help real estate professionals with:
- Finding and evaluating properties
- Managing leads and deals
- Understanding market conditions
- Portfolio optimization
- Seller financing and note investing
- Negotiation strategies
- Campaign and marketing optimization

When the user asks a question, give a concise, actionable answer (2-4 sentences max).
If the answer relates to a specific feature, suggest a navigation path.

Available app paths:
/leads, /properties, /deals, /finance, /portfolio, /campaigns, /deal-hunter,
/marketplace, /academy, /negotiation, /portfolio-optimizer, /avm, /market-intelligence,
/cash-flow, /land-credit, /radar, /vision-ai, /compliance, /command-center

Respond with JSON: { "reply": "...", "actionPath": "/path or null", "actionLabel": "Button label or null" }`;

    const completion = await requireOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 300,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content || '{}';
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = { reply: raw, actionPath: null, actionLabel: null };
    }

    res.json({
      reply: parsed.reply || 'I can help with that. Try exploring the relevant section.',
      actionPath: parsed.actionPath || null,
      actionLabel: parsed.actionLabel || null,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ============================
// REAL-TIME ALERTS
// ============================

/**
 * GET /realtime/alerts
 * Returns recent notifications for the current org.
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const alerts = realtimeAlertsService.getAlerts(org.id, limit);
    const unreadCount = realtimeAlertsService.getUnreadCount(org.id);
    res.json({ alerts, unreadCount });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * POST /realtime/alerts/mark-read
 * Body: { alertIds: string[] }
 */
router.post('/alerts/mark-read', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { alertIds } = req.body;
    if (!Array.isArray(alertIds)) {
      return Errors.badRequest(res, 'alertIds must be an array');
    }
    realtimeAlertsService.markRead(org.id, alertIds);
    res.json({ success: true });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : 'Bad request');
  }
});

/**
 * GET /realtime/alerts/count
 * Returns unread notification count (lightweight polling endpoint).
 */
router.get('/alerts/count', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const count = realtimeAlertsService.getUnreadCount(org.id);
    res.json({ count });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /realtime/stats
 * WebSocket + alert system stats (for admin monitoring).
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = realtimeAlertsService.getStats();
    res.json({ stats });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ============================
// ACADEMY CERTIFICATIONS
// ============================

/**
 * GET /realtime/certifications/stats
 * Full learning stats for the current user.
 */
router.get('/certifications/stats', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    // certificationService keys learning data by numeric user id.
    const stats = await certificationService.getLearningStats(parseInt(String(user.id), 10));
    res.json({ stats });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * POST /realtime/certifications/check
 * Body: { courseId: number }
 * Checks completion and awards certificate + achievements if complete.
 */
router.post('/certifications/check', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { courseId } = req.body;

    if (!courseId) {
      return Errors.badRequest(res, 'courseId is required');
    }

    const result = await certificationService.checkAndAward(parseInt(String(user.id), 10), parseInt(courseId));

    // If new certificate issued, push a real-time notification
    if (result.certificate) {
      const org = req.organization;
      await realtimeAlertsService.pushAlert({
        type: 'system',
        title: 'Certificate Earned! 🎓',
        message: `You completed "${result.certificate.courseTitle}" — certificate issued`,
        priority: 'high',
        organizationId: org.id,
        actionUrl: '/academy',
        metadata: { certificateId: result.certificate.id },
      });
    }

    res.json({
      certificate: result.certificate,
      newAchievements: result.newAchievements,
      awarded: result.certificate !== null || result.newAchievements.length > 0,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /realtime/certifications/verify/:code
 * Public endpoint to verify a certificate by its verification code.
 */
router.get('/certifications/verify/:code', (req: Request, res: Response) => {
  try {
    const cert = certificationService.verifyCertificate(req.params.code);
    if (!cert) {
      return Errors.notFound(res, 'Certificate');
    }
    res.json({
      valid: true,
      certificate: {
        courseTitle: cert.courseTitle,
        userName: cert.userName,
        issuedAt: cert.issuedAt,
        verificationCode: cert.verificationCode,
        score: cert.score,
      },
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
