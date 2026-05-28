import { db } from '../db';
import { voiceCalls, callTranscripts, properties, leads, activityLog } from '../../shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logActivity } from './systemActivityLogger';
import { requireOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";

interface CallIntent {
  type: string;
  confidence: number;
  entities: Record<string, any>;
}

class VoiceAI {
  /**
   * Initialize a new call
   */
  async initiateCall(
    organizationId: number,
    phoneNumber: string,
    direction: 'inbound' | 'outbound',
    leadId?: number,
    propertyId?: number
  ): Promise<string> {
    try {
      // voiceCalls stores fromNumber/toNumber (not a single phoneNumber),
      // callStatus (not status), durationSeconds (not duration); there is no
      // intent column. agentType is notNull.
      const [call] = await db.insert(voiceCalls).values({
        organizationId,
        fromNumber: direction === 'inbound' ? phoneNumber : null,
        toNumber: direction === 'outbound' ? phoneNumber : null,
        direction,
        leadId: leadId || null,
        propertyId: propertyId || null,
        callStatus: 'initiated',
        durationSeconds: 0,
        agentType: 'pax',
      }).returning();

      // In production, would initialize Twilio call here
      logger.info(`Initiated ${direction} call to ${phoneNumber}`);

      return call.id.toString();
    } catch (error) {
      logger.error('Failed to initiate call', error);
      throw error;
    }
  }

  /**
   * Handle real-time transcription using OpenAI Realtime API
   * This would be called via WebSocket in production
   */
  async handleRealtimeTranscription(
    callId: number,
    audioChunk: Buffer
  ): Promise<string> {
    try {
      // Real-time audio transcription requires a WebSocket connection
      // to OpenAI's Realtime API. This method is a no-op until
      // a WebSocket-based voice pipeline is configured.
      logger.warn('[VoiceAI] Real-time transcription not yet configured.');
      return '';
    } catch (error) {
      logger.error('Failed to process audio chunk', error);
      return '';
    }
  }

  /**
   * Transcribe completed call using Whisper
   */
  async transcribeCall(
    callId: number,
    audioUrl: string
  ): Promise<string> {
    try {
      const call = await db.query.voiceCalls.findFirst({
        where: eq(voiceCalls.id, callId),
      });

      if (!call) {
        throw new Error('Call not found');
      }

      // Transcribe with OpenAI Whisper API
      // Requires audioUrl to be a downloadable recording URL (e.g. from Twilio)
      if (!audioUrl) {
        throw new Error('No audio URL provided — cannot transcribe without a recording.');
      }

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Failed to download call recording from ${audioUrl}`);
      }

      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      const audioFile = new File([audioBuffer], 'recording.wav', { type: 'audio/wav' });

      const transcription = await requireOpenAIClient().audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
      });

      const transcriptText = transcription.text;

      // call_transcripts requires organizationId + leadId (notNull) and stores
      // the text under transcriptRaw; callId is an external text id.
      if (!call.leadId) {
        throw new Error('Cannot store transcript: call has no associated lead');
      }
      const [transcript] = await db.insert(callTranscripts).values({
        organizationId: call.organizationId,
        leadId: call.leadId,
        callId: callId.toString(),
        direction: call.direction,
        callType: 'follow_up',
        transcriptRaw: transcriptText,
        transcriptionProvider: 'whisper',
        transcriptionConfidence: '0.95',
      }).returning();

      return transcript.id.toString();
    } catch (error) {
      logger.error('Failed to transcribe call', error);
      throw error;
    }
  }

  /**
   * Analyze call intent and extract entities
   */
  async analyzeIntent(
    callId: number,
    transcript: string
  ): Promise<CallIntent> {
    try {
      const prompt = `Analyze this phone call transcript and determine the caller's primary intent and extract key entities.

Transcript:
${transcript}

Respond with JSON in this format:
{
  "type": "inquiry|listing|viewing|negotiation|complaint|other",
  "confidence": 0.0-1.0,
  "entities": {
    "propertyAddress": "address if mentioned",
    "budget": amount if mentioned,
    "timeframe": "when they want to buy/sell",
    "propertyType": "land type if mentioned"
  }
}`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      });

      const response = completion.choices[0].message.content || '{}';

      try {
        return JSON.parse(response);
      } catch {
        return {
          type: 'other',
          confidence: 0,
          entities: {},
        };
      }
    } catch (error) {
      logger.error('Failed to analyze intent', error);
      return {
        type: 'other',
        confidence: 0,
        entities: {},
      };
    }
  }

  /**
   * Analyze call sentiment
   */
  async analyzeSentiment(transcript: string): Promise<{
    score: number;
    label: string;
  }> {
    try {
      const prompt = `Analyze the sentiment of this call transcript. Return only a JSON object.

Transcript:
${transcript}

Format:
{
  "score": -1.0 to 1.0 (negative to positive),
  "label": "positive|neutral|negative"
}`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
      });

      const response = completion.choices[0].message.content || '{"score": 0, "label": "neutral"}';

      try {
        return JSON.parse(response);
      } catch {
        return { score: 0, label: 'neutral' };
      }
    } catch (error) {
      logger.error('Failed to analyze sentiment', error);
      return { score: 0, label: 'neutral' };
    }
  }

  /**
   * Generate call summary
   */
  async generateCallSummary(
    callId: number
  ): Promise<string> {
    try {
      const transcript = await db.query.callTranscripts.findFirst({
        where: eq(callTranscripts.callId, callId.toString()),
      });

      if (!transcript) {
        return 'No transcript available';
      }

      const prompt = `Summarize this phone call transcript in 2-3 concise sentences, focusing on key points and action items.

Transcript:
${transcript.transcriptRaw ?? ""}`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      });

      return completion.choices[0].message.content || 'Unable to generate summary';
    } catch (error) {
      logger.error('Failed to generate summary', error);
      return 'Error generating summary';
    }
  }

  /**
   * Complete call and perform post-call analysis
   */
  async completeCall(
    callId: number,
    duration: number,
    recordingUrl?: string
  ): Promise<void> {
    try {
      // Update call status. voiceCalls uses callStatus/durationSeconds; it has
      // no endedAt column.
      await db.update(voiceCalls)
        .set({
          callStatus: 'completed',
          durationSeconds: duration,
          recordingUrl: recordingUrl || null,
        })
        .where(eq(voiceCalls.id, callId));

      // If recording available, transcribe it
      if (recordingUrl) {
        await this.transcribeCall(callId, recordingUrl);

        // Get transcript and analyze
        const transcript = await db.query.callTranscripts.findFirst({
          where: eq(callTranscripts.callId, callId.toString()),
        });

        if (transcript) {
          // Analyze intent
          const intent = await this.analyzeIntent(callId, transcript.transcriptRaw ?? "");

          // Analyze sentiment
          const sentiment = await this.analyzeSentiment(transcript.transcriptRaw ?? "");

          // Generate summary
          const summary = await this.generateCallSummary(callId);

          // voiceCalls only stores a numeric sentimentScore; the sentiment
          // label, summary, and intent are persisted on the transcript record
          // (intent has no dedicated column, so it is omitted from storage).
          void intent;
          await db.update(voiceCalls)
            .set({
              sentimentScore: sentiment.score.toString(),
            })
            .where(eq(voiceCalls.id, callId));

          await db.update(callTranscripts)
            .set({
              sentiment: sentiment.label,
              sentimentScore: sentiment.score.toString(),
              summary,
            })
            .where(eq(callTranscripts.id, transcript.id));

          // Auto-sync insights back to the associated lead
          await this.updateLeadFromCall(callId);
        }
      }
    } catch (error) {
      logger.error('Failed to complete call', error);
      throw error;
    }
  }

  /**
   * Get call history for organization
   */
  async getCallHistory(
    organizationId: number,
    limit: number = 50
  ): Promise<any[]> {
    try {
      return await db.query.voiceCalls.findMany({
        where: eq(voiceCalls.organizationId, organizationId),
        orderBy: [desc(voiceCalls.createdAt)],
        limit,
      });
    } catch (error) {
      logger.error('Failed to get call history', error);
      return [];
    }
  }

  /**
   * Get call details with transcript
   */
  async getCallDetails(callId: number): Promise<any> {
    try {
      const call = await db.query.voiceCalls.findFirst({
        where: eq(voiceCalls.id, callId),
      });

      if (!call) {
        return null;
      }

      const transcript = await db.query.callTranscripts.findFirst({
        where: eq(callTranscripts.callId, callId.toString()),
      });

      return {
        ...call,
        transcript,
      };
    } catch (error) {
      logger.error('Failed to get call details', error);
      return null;
    }
  }

  /**
   * Search calls by content
   */
  async searchCalls(
    organizationId: number,
    query: string
  ): Promise<any[]> {
    try {
      // In production, would use full-text search on transcripts
      // For now, return recent calls
      return await this.getCallHistory(organizationId, 20);
    } catch (error) {
      logger.error('Failed to search calls', error);
      return [];
    }
  }

  /**
   * Get call analytics
   */
  async getCallAnalytics(
    organizationId: number,
    dateRange?: { start: Date; end: Date }
  ): Promise<{
    totalCalls: number;
    averageDuration: number;
    sentimentBreakdown: Record<string, number>;
    intentBreakdown: Record<string, number>;
    inboundVsOutbound: { inbound: number; outbound: number };
  }> {
    try {
      const calls = await db.query.voiceCalls.findMany({
        where: eq(voiceCalls.organizationId, organizationId),
      });

      const totalCalls = calls.length;

      const avgDuration = calls.length > 0
        ? calls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0) / calls.length
        : 0;

      // Sentiment breakdown — derived from the numeric sentimentScore (-1..1),
      // since voiceCalls has no sentiment label column.
      const sentimentBreakdown: Record<string, number> = {
        positive: 0,
        neutral: 0,
        negative: 0,
      };

      for (const call of calls) {
        if (call.sentimentScore != null) {
          const score = Number(call.sentimentScore);
          const label = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral';
          sentimentBreakdown[label]++;
        }
      }

      // Intent breakdown — voiceCalls has no intent column, so this stays empty.
      const intentBreakdown: Record<string, number> = {};

      // Direction breakdown
      const inbound = calls.filter(c => c.direction === 'inbound').length;
      const outbound = calls.filter(c => c.direction === 'outbound').length;

      return {
        totalCalls,
        averageDuration: Math.round(avgDuration),
        sentimentBreakdown,
        intentBreakdown,
        inboundVsOutbound: { inbound, outbound },
      };
    } catch (error) {
      logger.error('Failed to get call analytics', error);
      return {
        totalCalls: 0,
        averageDuration: 0,
        sentimentBreakdown: {},
        intentBreakdown: {},
        inboundVsOutbound: { inbound: 0, outbound: 0 },
      };
    }
  }

  /**
   * After a call is analyzed, update the associated lead record with
   * key insights: sentiment, intent, action items, and a call note.
   * This closes the loop so callers don't need to manually update leads.
   */
  async updateLeadFromCall(callId: number): Promise<void> {
    try {
      const call = await db.query.voiceCalls?.findFirst({
        where: eq(voiceCalls.id, callId),
      });
      if (!call?.leadId) return;

      const transcript = await db.query.callTranscripts?.findFirst({
        where: eq(callTranscripts.callId, callId.toString()),
      });
      if (!transcript) return;

      // Extract action items
      const actionItems = await this.extractActionItems(callId);

      // Build a note summarising the call for the lead record
      const callDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      // Summary/sentiment live on the transcript record (voiceCalls has no such
      // columns); intent is not persisted anywhere in the schema.
      const noteContent = [
        `📞 Call on ${callDate}`,
        transcript.summary ? `Summary: ${transcript.summary}` : null,
        transcript.sentiment ? `Sentiment: ${transcript.sentiment}` : null,
        actionItems.length ? `Action items:\n${actionItems.map((a: string) => `  • ${a}`).join('\n')}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      // Update the lead: bump lastContactedAt, append call note, update engagement score
      await db
        .update(leads)
        .set({
          lastContactedAt: new Date(),
          notes: sql`COALESCE(${leads.notes}, '') || ${'\n\n' + noteContent}`,
          // Bump engagement if call had positive sentiment (leads.score).
          ...(transcript.sentiment === 'positive' ? { score: sql`LEAST(100, COALESCE(${leads.score}, 50) + 10)` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, call.leadId));

      logActivity({
        orgId: call.organizationId,
        job: 'voice_ai',
        action: 'call_synced_to_lead',
        summary: `Call transcript analyzed and synced to lead — ${actionItems.length} action item(s) extracted`,
        entityType: 'lead',
        entityId: String(call.leadId),
        metadata: { callId, actionItems },
      }).catch(() => {});
    } catch (err) {
      logger.error('[VoiceAI] updateLeadFromCall failed', err);
    }
  }

  /**
   * Extract action items from call
   */
  async extractActionItems(callId: number): Promise<string[]> {
    try {
      const transcript = await db.query.callTranscripts.findFirst({
        where: eq(callTranscripts.callId, callId.toString()),
      });

      if (!transcript) {
        return [];
      }

      const prompt = `Extract action items from this call transcript. Return as a JSON array of strings.

Transcript:
${transcript.transcriptRaw ?? ""}

Format: ["Action item 1", "Action item 2", ...]`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      const response = completion.choices[0].message.content || '[]';

      try {
        return JSON.parse(response);
      } catch {
        return [];
      }
    } catch (error) {
      logger.error('Failed to extract action items', error);
      return [];
    }
  }
}

export const voiceAI = new VoiceAI();
