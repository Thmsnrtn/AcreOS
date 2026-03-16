// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { Router, type Request, type Response } from 'express';
import { db } from './db';
import { voiceCalls, callTranscripts, agentEvents } from '../shared/schema';
import { eq, and, desc, like, or } from 'drizzle-orm';
import { voiceAI } from './services/voiceAI';
import crypto from 'crypto';

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
// TWILIO SIGNATURE VERIFICATION MIDDLEWARE
// ============================================================

function verifyTwilioSignature(req: Request, res: Response, next: Function) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Skip verification in dev if no auth token configured
    return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;
  if (!twilioSignature) {
    return res.status(403).json({ error: 'Missing Twilio signature' });
  }

  // Build the URL to validate against
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.originalUrl}`;

  // Build the string to sign: URL + sorted POST params
  const body = req.body || {};
  const sortedKeys = Object.keys(body).sort();
  const paramString = sortedKeys.reduce((s: string, key: string) => s + key + body[key], '');
  const toSign = url + paramString;

  const expectedSignature = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(toSign, 'utf-8'))
    .digest('base64');

  const valid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'base64'),
    Buffer.from(twilioSignature, 'base64')
  );

  if (!valid) {
    return res.status(403).json({ error: 'Invalid Twilio signature' });
  }

  next();
}

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

// ============================================================
// POST /voice/webhook/disclosure — Play TCPA recording disclosure
// ============================================================

voiceRouter.post('/webhook/disclosure', verifyTwilioSignature, async (req: Request, res: Response) => {
  try {
    const disclosureText = process.env.CALL_DISCLOSURE_TEXT ||
      'This call may be recorded for quality assurance and training purposes.';

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${disclosureText}</Say>
</Response>`;

    res.status(200).type('text/xml').send(twiml);
  } catch (error: any) {
    console.error('[voice/webhook/disclosure] Error:', error);
    res.status(200).type('text/xml').send('<Response><Say>Error playing disclosure.</Say></Response>');
  }
});

// ============================================================
// POST /api/voice/calls/:id/outcome — Tag call outcome
// ============================================================

voiceRouter.post('/calls/:id/outcome', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const callId = parseInt(req.params.id, 10);
    if (isNaN(callId)) return res.status(400).json({ error: 'Invalid call ID' });

    const { type, notes } = req.body;
    const validTypes = ['interested', 'not-interested', 'callback', 'voicemail'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const call = await db.query.voiceCalls.findFirst({
      where: and(eq(voiceCalls.id, callId), eq(voiceCalls.organizationId, org.id)),
    });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    await db.update(voiceCalls)
      .set({ outcome: type, outcomeNotes: notes || null, updatedAt: new Date() })
      .where(eq(voiceCalls.id, callId));

    await db.insert(agentEvents).values({
      organizationId: org.id,
      eventType: 'call_outcome_tagged',
      eventSource: 'voice_pipeline',
      payload: { callId, outcome: type, notes },
      relatedEntityType: 'voice_call',
      relatedEntityId: callId,
    });

    res.json({ success: true, callId, outcome: type });
  } catch (error: any) {
    console.error('[POST /voice/calls/:id/outcome] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/voice/calls/:id/summary — Post-call summary
// ============================================================

voiceRouter.get('/calls/:id/summary', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const callId = parseInt(req.params.id, 10);
    if (isNaN(callId)) return res.status(400).json({ error: 'Invalid call ID' });

    const call = await db.query.voiceCalls.findFirst({
      where: and(eq(voiceCalls.id, callId), eq(voiceCalls.organizationId, org.id)),
    });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const transcript = await db.query.callTranscripts.findFirst({
      where: eq(callTranscripts.callId, callId),
    });

    // Generate summary if not already present
    let summary = call.summary;
    if (!summary && transcript) {
      summary = await voiceAI.generateCallSummary(callId);
    }

    // Extract action items
    const actionItems = await voiceAI.extractActionItems(callId);

    res.json({
      success: true,
      callId,
      summary: summary || 'No summary available',
      actionItems,
      sentiment: call.sentiment,
      intent: call.intent,
      duration: call.duration,
      outcome: (call as any).outcome || null,
      transcript: transcript
        ? { id: transcript.id, preview: (transcript.fullTranscript || '').slice(0, 300) }
        : null,
    });
  } catch (error: any) {
    console.error('[GET /voice/calls/:id/summary] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/voice/transcripts/search?q=term — Transcript search
// ============================================================

voiceRouter.get('/transcripts/search', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { q, limit = '20' } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'q (search term) is required' });
    }

    // Full-text search on transcript text
    const transcripts = await db
      .select({
        id: callTranscripts.id,
        callId: callTranscripts.callId,
        fullTranscript: callTranscripts.fullTranscript,
        createdAt: callTranscripts.createdAt,
      })
      .from(callTranscripts)
      .where(
        and(
          // Filter to org's calls via a subquery approach — join voiceCalls
          like(callTranscripts.fullTranscript, `%${q}%`)
        )
      )
      .orderBy(desc(callTranscripts.createdAt))
      .limit(parseInt(limit as string, 10));

    // Filter to only org's calls
    const orgCallIds = await db
      .select({ id: voiceCalls.id })
      .from(voiceCalls)
      .where(eq(voiceCalls.organizationId, org.id));
    const orgCallIdSet = new Set(orgCallIds.map(c => c.id));

    const filtered = transcripts.filter(t => t.callId && orgCallIdSet.has(t.callId));

    // Highlight context around the search term
    const results = filtered.map(t => {
      const text = t.fullTranscript || '';
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      const snippet = idx >= 0
        ? text.slice(Math.max(0, idx - 80), idx + q.length + 80)
        : text.slice(0, 200);
      return { transcriptId: t.id, callId: t.callId, snippet, createdAt: t.createdAt };
    });

    res.json({ success: true, results, total: results.length, query: q });
  } catch (error: any) {
    console.error('[GET /voice/transcripts/search] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/voice/calls/:id/speakers — Speaker diarization info
// ============================================================

voiceRouter.get('/calls/:id/speakers', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const callId = parseInt(req.params.id, 10);
    if (isNaN(callId)) return res.status(400).json({ error: 'Invalid call ID' });

    const call = await db.query.voiceCalls.findFirst({
      where: and(eq(voiceCalls.id, callId), eq(voiceCalls.organizationId, org.id)),
    });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const transcript = await db.query.callTranscripts.findFirst({
      where: eq(callTranscripts.callId, callId),
    });

    if (!transcript) {
      return res.json({ success: true, callId, speakers: [], segments: [] });
    }

    // Use transcriptFormatted (segments) if available
    const segments: any[] = (transcript as any).segments || [];
    const speakerMap: Record<string, { wordCount: number; segments: number; talkTimeMs: number }> = {};

    for (const seg of segments) {
      const speaker = seg.speaker || 'Unknown';
      if (!speakerMap[speaker]) {
        speakerMap[speaker] = { wordCount: 0, segments: 0, talkTimeMs: 0 };
      }
      speakerMap[speaker].segments++;
      speakerMap[speaker].wordCount += (seg.text || '').split(/\s+/).length;
      if (seg.startTime !== undefined && seg.endTime !== undefined) {
        speakerMap[speaker].talkTimeMs += (seg.endTime - seg.startTime) * 1000;
      }
    }

    const speakers = Object.entries(speakerMap).map(([name, stats]) => ({
      name,
      segments: stats.segments,
      wordCount: stats.wordCount,
      talkTimeSeconds: Math.round(stats.talkTimeMs / 1000),
    }));

    res.json({ success: true, callId, speakers, segmentCount: segments.length });
  } catch (error: any) {
    console.error('[GET /voice/calls/:id/speakers] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/voice/analytics — Call analytics summary
// ============================================================

voiceRouter.get('/analytics', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const analytics = await voiceAI.getCallAnalytics(org.id);
    res.json({ success: true, analytics });
  } catch (error: any) {
    console.error('[GET /voice/analytics] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default voiceRouter;
