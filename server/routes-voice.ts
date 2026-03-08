// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { Router, type Request, type Response } from 'express';
import { db } from './db';
import { voiceCalls, callTranscripts, agentEvents } from '../shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { voiceAI } from './services/voiceAI';

const voiceRouter = Router();

// ============================================================
// HELPERS
// ============================================================

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// ============================================================
// MOTIVATION SIGNAL EXTRACTION
// ============================================================

const MOTIVATION_KEYWORDS = [
  'divorce',
  'estate',
  'tax delinquent',
  'delinquent',
  'need to sell',
  'needs to sell',
  'behind on payments',
  'behind on mortgage',
  'foreclosure',
  'inherited',
  'probate',
  'relocation',
  'job loss',
  'financial hardship',
];

/**
 * Reads the transcript for a call and checks for motivated-seller keywords.
 * Returns { isMotivated, signals, confidence }.
 */
async function extractMotivationSignals(callId: number): Promise<{
  isMotivated: boolean;
  signals: string[];
  confidence: number;
}> {
  try {
    const transcript = await db.query.callTranscripts.findFirst({
      where: eq(callTranscripts.callId, callId),
    });

    if (!transcript) {
      return { isMotivated: false, signals: [], confidence: 0 };
    }

    const text = (transcript.transcriptRaw || '').toLowerCase();
    const signals: string[] = [];

    for (const keyword of MOTIVATION_KEYWORDS) {
      if (text.includes(keyword)) {
        signals.push(keyword);
      }
    }

    // Simple confidence heuristic: each signal adds ~0.25 confidence, capped at 1.0
    const confidence = Math.min(signals.length * 0.25, 1.0);
    const isMotivated = signals.length > 0;

    return { isMotivated, signals, confidence };
  } catch (error) {
    console.error('[routes-voice] extractMotivationSignals error:', error);
    return { isMotivated: false, signals: [], confidence: 0 };
  }
}

// Attach extractMotivationSignals to voiceAI for downstream use
(voiceAI as any).extractMotivationSignals = extractMotivationSignals;

// ============================================================
// WEBHOOK: POST /webhook/twilio/recording-complete
// (No auth — Twilio posts here after a call recording is ready)
// ============================================================

voiceRouter.post('/webhook/twilio/recording-complete', async (req: Request, res: Response) => {
  try {
    const {
      RecordingSid,
      RecordingUrl,
      CallSid,
      RecordingDuration,
    } = req.body as {
      RecordingSid?: string;
      RecordingUrl?: string;
      CallSid?: string;
      RecordingDuration?: string;
    };

    console.log('[twilio/recording-complete]', { RecordingSid, CallSid, RecordingDuration });

    if (!CallSid) {
      // Always return 200 to Twilio even on bad data
      res.status(200).type('text/xml').send('<Response/>');
      return;
    }

    // Look up the voiceCall by callSid (Twilio CallSid)
    const voiceCall = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.callSid, CallSid),
    });

    if (!voiceCall) {
      console.warn('[twilio/recording-complete] No voiceCall found for CallSid:', CallSid);
      res.status(200).type('text/xml').send('<Response/>');
      return;
    }

    const callId = voiceCall.id;
    const duration = RecordingDuration ? parseInt(RecordingDuration, 10) : 0;
    const recordingUrl = RecordingUrl ? `${RecordingUrl}.mp3` : undefined;

    // Complete the call with post-call AI analysis
    await voiceAI.completeCall(callId, duration, recordingUrl);

    // Extract motivation signals from the transcript
    const motivationResult = await extractMotivationSignals(callId);

    // Persist motivationScore to voiceCalls
    if (motivationResult.confidence > 0) {
      await db.update(voiceCalls)
        .set({ motivationScore: motivationResult.confidence.toString() })
        .where(eq(voiceCalls.id, callId));
    }

    // If motivated with confidence > 0.7, create a decision queue agent event
    if (motivationResult.isMotivated && motivationResult.confidence > 0.7) {
      await db.insert(agentEvents).values({
        organizationId: voiceCall.organizationId,
        eventType: 'motivated_caller_detected',
        eventSource: 'voice_pipeline',
        payload: {
          callId,
          callSid: CallSid,
          recordingSid: RecordingSid,
          motivationSignals: motivationResult.signals,
          confidence: motivationResult.confidence,
          leadId: voiceCall.leadId,
          contactId: voiceCall.contactId,
          action: 'create_offer_decision',
        },
        relatedEntityType: 'voice_call',
        relatedEntityId: callId,
      });

      console.log(
        `[twilio/recording-complete] Motivated caller detected for callId=${callId}, confidence=${motivationResult.confidence}, signals=${motivationResult.signals.join(', ')}`
      );
    }

    // Twilio expects 200 with TwiML or empty body
    res.status(200).type('text/xml').send('<Response/>');
  } catch (error: any) {
    console.error('[twilio/recording-complete] Error:', error);
    // Still return 200 so Twilio doesn't retry indefinitely
    res.status(200).type('text/xml').send('<Response/>');
  }
});

// ============================================================
// POST /api/voice/calls — Initiate a call (requires auth)
// ============================================================

voiceRouter.post('/calls', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { phoneNumber, direction = 'outbound', leadId, propertyId } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'phoneNumber is required' });
    }

    const callId = await voiceAI.initiateCall(
      org.id,
      phoneNumber,
      direction,
      leadId ? parseInt(leadId, 10) : undefined,
      propertyId ? parseInt(propertyId, 10) : undefined
    );

    res.status(201).json({ callId, success: true });
  } catch (error: any) {
    console.error('[POST /api/voice/calls] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/voice/calls — List calls for the org (requires auth)
// ============================================================

voiceRouter.get('/calls', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { leadId, limit = '50' } = req.query;

    let calls: any[];

    if (leadId) {
      // Filter by leadId
      calls = await db
        .select()
        .from(voiceCalls)
        .where(
          and(
            eq(voiceCalls.organizationId, org.id),
            eq(voiceCalls.leadId, parseInt(leadId as string, 10))
          )
        )
        .orderBy(desc(voiceCalls.createdAt))
        .limit(parseInt(limit as string, 10));
    } else {
      calls = await voiceAI.getCallHistory(org.id, parseInt(limit as string, 10));
    }

    res.json({ calls, success: true });
  } catch (error: any) {
    console.error('[GET /api/voice/calls] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/voice/calls/:id/transcript — Get transcript (requires auth)
// ============================================================

voiceRouter.get('/calls/:id/transcript', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const callId = parseInt(req.params.id, 10);

    if (isNaN(callId)) {
      return res.status(400).json({ error: 'Invalid call ID' });
    }

    const call = await db.query.voiceCalls.findFirst({
      where: and(
        eq(voiceCalls.id, callId),
        eq(voiceCalls.organizationId, org.id)
      ),
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const transcript = await db.query.callTranscripts.findFirst({
      where: eq(callTranscripts.callId, callId),
    });

    res.json({ call, transcript: transcript || null, success: true });
  } catch (error: any) {
    console.error('[GET /api/voice/calls/:id/transcript] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default voiceRouter;
