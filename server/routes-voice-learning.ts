import { Router, type Request, type Response } from 'express';
import { voiceLearningService } from './services/voiceLearning';
import { contextProfileService } from './services/contextProfile';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// ============================
// VOICE LEARNING
// ============================

/**
 * GET /voice-profile
 * Returns the org's learned voice profile.
 * If none exists, builds one on-demand (may take 2-5 seconds).
 */
router.get('/voice-profile', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const profile = await voiceLearningService.getProfile(org.id);
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /voice-profile/refresh
 * Triggers a fresh analysis of recent communications.
 * Returns the new profile.
 */
router.post('/voice-profile/refresh', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    voiceLearningService.invalidateProfile(org.id);
    const profile = await voiceLearningService.buildProfile(org.id);
    res.json({ profile, refreshed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /voice-profile/apply
 * Body: { text: string }
 * Returns the text rewritten in the org's voice.
 */
router.post('/voice-profile/apply', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    const profile = await voiceLearningService.getProfile(org.id);
    const rewritten = await voiceLearningService.applyVoice(text, profile);
    res.json({ original: text, rewritten, profile: { formality: profile.formality, tone: profile.tone } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /voice-profile/style-instruction
 * Returns the system prompt instruction string for use in custom AI calls.
 */
router.get('/voice-profile/style-instruction', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const profile = await voiceLearningService.getProfile(org.id);
    const instruction = voiceLearningService.buildStyleInstruction(profile);
    res.json({ instruction, profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// CONTEXT PROFILE
// ============================

/**
 * GET /context-profile
 * Returns the org's investor type, suggested modules, dashboard widgets.
 */
router.get('/context-profile', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const profile = await contextProfileService.getProfile(org.id);
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /context-profile/refresh
 * Force rebuilds the context profile from current data.
 */
router.post('/context-profile/refresh', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    contextProfileService.invalidate(org.id);
    const profile = await contextProfileService.buildProfile(org.id);
    res.json({ profile, refreshed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
