import { Router, type Request, type Response } from 'express';
import { realtimeAlertsService } from './services/realtimeAlerts';
import { certificationService } from './services/certification';
import { wsServer } from './websocket';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

function getUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new Error('User not found');
  return user;
}

// ============================
// COMMAND PALETTE AI
// ============================

/**
 * POST /realtime/ask
 * Body: { message: string }
 * Answers a natural language question about the user's land business.
 * Returns a reply and optionally an action path to navigate to.
 */
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const systemPrompt = `You are an expert AI assistant built into AcreOS, a land investment management platform.
You help land investors with:
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

    const completion = await openai.chat.completions.create({
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    const org = getOrg(req);
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const alerts = realtimeAlertsService.getAlerts(org.id, limit);
    const unreadCount = realtimeAlertsService.getUnreadCount(org.id);
    res.json({ alerts, unreadCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /realtime/alerts/mark-read
 * Body: { alertIds: string[] }
 */
router.post('/alerts/mark-read', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { alertIds } = req.body;
    if (!Array.isArray(alertIds)) {
      return res.status(400).json({ error: 'alertIds must be an array' });
    }
    realtimeAlertsService.markRead(org.id, alertIds);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /realtime/alerts/count
 * Returns unread notification count (lightweight polling endpoint).
 */
router.get('/alerts/count', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const count = realtimeAlertsService.getUnreadCount(org.id);
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    const stats = await certificationService.getLearningStats(user.id);
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: 'courseId is required' });
    }

    const result = await certificationService.checkAndAward(user.id, parseInt(courseId));

    // If new certificate issued, push a real-time notification
    if (result.certificate) {
      const org = getOrg(req);
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      return res.status(404).json({ valid: false, error: 'Certificate not found' });
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
