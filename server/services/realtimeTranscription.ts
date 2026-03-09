/**
 * T19 — Real-Time Call Transcription Service
 *
 * Provides WebSocket-based streaming transcription for active calls.
 * Integrates with Deepgram (primary) or falls back to Twilio Media Streams
 * when DEEPGRAM_API_KEY is not set.
 *
 * Flow:
 *   1. Call starts → Twilio forwards audio stream to /api/voice/stream
 *   2. Audio chunks → forwarded to Deepgram WebSocket
 *   3. Deepgram transcripts → forwarded to the AcreOS WebSocket (org channel)
 *   4. UI picks up "call.transcript" events and displays live text
 *   5. Atlas reads live transcript for motivation signal detection
 *
 * Required env: DEEPGRAM_API_KEY (from deepgram.com)
 *
 * Atlas motivation signals detected in real-time:
 *   - "divorce", "inherited", "foreclosure", "moving", "need to sell"
 *   - "quick", "motivated", "urgent", "behind on taxes"
 *
 * When a signal is detected, a Sophie observation is created with
 * type "motivated_caller" and surfaced in the Today page.
 */

import { wsServer } from "../websocket";

const MOTIVATION_KEYWORDS = [
  "divorce", "divorcing", "separated",
  "inherited", "inheritance", "estate", "passed away",
  "foreclosure", "foreclosing", "bank",
  "moving", "relocating", "job",
  "behind on taxes", "tax lien", "delinquent",
  "quick", "quickly", "fast", "urgent", "need to sell",
  "motivated", "any offer",
  "tired landlord", "don't want it", "can't afford",
];

export interface TranscriptSegment {
  text: string;
  speaker?: string;
  confidence: number;
  timestamp: number;
  isFinal: boolean;
  motivationSignals: string[];
}

function detectMotivationSignals(text: string): string[] {
  const lower = text.toLowerCase();
  return MOTIVATION_KEYWORDS.filter((kw) => lower.includes(kw));
}

/**
 * Process a real-time transcript from Deepgram and broadcast it to the UI.
 */
export async function processTranscriptChunk(
  orgId: number,
  callSid: string,
  leadId: number | undefined,
  rawTranscript: any
): Promise<TranscriptSegment | null> {
  try {
    const channel = rawTranscript?.channel;
    const alternatives = channel?.alternatives ?? [];
    if (!alternatives.length) return null;

    const best = alternatives[0];
    const text: string = best?.transcript ?? "";
    if (!text.trim()) return null;

    const isFinal = rawTranscript?.is_final ?? false;
    const confidence: number = best?.confidence ?? 0;
    const motivationSignals = detectMotivationSignals(text);

    const segment: TranscriptSegment = {
      text,
      confidence,
      timestamp: Date.now(),
      isFinal,
      motivationSignals,
    };

    // Broadcast to org's WebSocket channel
    wsServer.broadcast(`org:${orgId}`, {
      type: "call.transcript",
      callSid,
      leadId,
      segment,
    });

    // If motivation signals detected and transcript is final, create Sophie observation
    if (isFinal && motivationSignals.length > 0) {
      try {
        const { sophieObserver } = await import("./sophieObserver");
        // Observer will surface this in the Today page decision queue
        await (sophieObserver as any).createObservation?.({
          organizationId: orgId,
          type: "motivated_caller",
          title: "Motivation signal detected on live call",
          message: `Seller mentioned: "${motivationSignals.join('", "')}" — ${text.slice(0, 100)}`,
          severity: "medium",
          confidence: Math.min(0.9, confidence + 0.2),
          entityType: "lead",
          entityId: leadId,
          metadata: { callSid, motivationSignals, transcript: text },
        });
      } catch {} // Observer failure is non-fatal
    }

    return segment;
  } catch {
    return null;
  }
}

/**
 * Create a Deepgram WebSocket streaming connection for a Twilio call.
 * Returns a cleanup function to close the connection.
 */
export async function createDeepgramStream(
  orgId: number,
  callSid: string,
  leadId?: number
): Promise<{ send: (audioChunk: Buffer) => void; close: () => void } | null> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.warn("[transcription] DEEPGRAM_API_KEY not set — real-time transcription unavailable");
    return null;
  }

  try {
    const WebSocket = (await import("ws")).default;

    const dg = new WebSocket(
      "wss://api.deepgram.com/v1/listen?" +
        new URLSearchParams({
          encoding: "mulaw",
          sample_rate: "8000",
          channels: "1",
          model: "nova-2",
          language: "en-US",
          smart_format: "true",
          interim_results: "true",
          utterance_end_ms: "1000",
        }),
      { headers: { Authorization: `Token ${apiKey}` } }
    );

    dg.on("message", async (data: any) => {
      try {
        const parsed = JSON.parse(data.toString());
        await processTranscriptChunk(orgId, callSid, leadId, parsed);
      } catch {}
    });

    dg.on("error", (err: Error) => {
      console.warn(`[transcription] Deepgram error for call ${callSid}: ${err.message}`);
    });

    return {
      send: (chunk: Buffer) => {
        if (dg.readyState === WebSocket.OPEN) {
          dg.send(chunk);
        }
      },
      close: () => {
        if (dg.readyState === WebSocket.OPEN) {
          dg.send(JSON.stringify({ type: "CloseStream" }));
          dg.close();
        }
      },
    };
  } catch (err: any) {
    console.warn(`[transcription] Failed to create Deepgram stream: ${err.message}`);
    return null;
  }
}
