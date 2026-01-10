import { db } from "../db";
import {
  callTranscripts,
  leads,
  deals,
  leadActivities,
  agentEvents,
  type CallTranscript,
  type InsertCallTranscript,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql, avg } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

interface RecordCallParams {
  leadId: number;
  dealId?: number;
  callId?: string;
  direction: "inbound" | "outbound";
  callType: "initial_contact" | "follow_up" | "negotiation" | "closing";
  callerPhone?: string;
  duration?: number;
  callStartedAt?: Date;
  callEndedAt?: Date;
  audioUrl?: string;
}

interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

interface ActionItem {
  id: string;
  description: string;
  assignedTo?: string;
  dueDate?: string;
  priority: string;
  completed: boolean;
  completedAt?: string;
  createdFromCall: boolean;
}

interface ExtractedData {
  pricesMentioned?: number[];
  datesMentioned?: string[];
  namesMentioned?: string[];
  objectionsRaised?: string[];
  commitmentsMade?: string[];
  questionsAsked?: string[];
  nextSteps?: string[];
}

interface CoachingInsights {
  talkToListenRatio?: number;
  questionCount?: number;
  objectionHandlingScore?: number;
  rapportScore?: number;
  closingEffectiveness?: number;
  improvementAreas?: string[];
  strengths?: string[];
}

interface CRMUpdate {
  field: string;
  oldValue: string;
  newValue: string;
  appliedAt: string;
  automated: boolean;
}

interface CRMUpdateRequest {
  leadUpdates?: {
    notes?: string;
    status?: string;
    tags?: string[];
  };
  dealUpdates?: {
    status?: string;
    notes?: string;
  };
}

interface DateRange {
  start: Date;
  end: Date;
}

interface CoachingMetrics {
  totalCalls: number;
  avgTalkToListenRatio: number;
  avgQuestionCount: number;
  avgObjectionHandlingScore: number;
  avgRapportScore: number;
  avgClosingEffectiveness: number;
  commonImprovementAreas: string[];
  commonStrengths: string[];
  callsByType: Record<string, number>;
  callsBySentiment: Record<string, number>;
}

export class VoiceCallAIService {
  async recordCall(
    organizationId: number,
    params: RecordCallParams
  ): Promise<number> {
    const insertData: InsertCallTranscript = {
      organizationId,
      leadId: params.leadId,
      dealId: params.dealId ?? null,
      callId: params.callId,
      direction: params.direction,
      callType: params.callType,
      callerPhone: params.callerPhone,
      duration: params.duration,
      callStartedAt: params.callStartedAt,
      callEndedAt: params.callEndedAt,
      audioUrl: params.audioUrl,
    };

    const [result] = await db.insert(callTranscripts).values(insertData).returning();

    await db.insert(agentEvents).values({
      organizationId,
      eventType: "call_recorded",
      eventSource: "voice_call_ai",
      payload: {
        transcriptId: result.id,
        leadId: params.leadId,
        dealId: params.dealId,
        direction: params.direction,
        callType: params.callType,
      },
      relatedEntityType: "call_transcript",
      relatedEntityId: result.id,
    });

    return result.id;
  }

  async transcribeCall(
    transcriptId: number,
    audioUrl: string
  ): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    const openai = getOpenAIClient();
    let transcriptRaw = "";
    let transcriptFormatted: TranscriptSegment[] = [];
    let confidence = 0.95;

    if (openai && audioUrl) {
      try {
        const response = await fetch(audioUrl);
        if (response.ok) {
          const audioBuffer = await response.arrayBuffer();
          const audioFile = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });
          
          const whisperResponse = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            response_format: "verbose_json",
          });

          transcriptRaw = whisperResponse.text;
          confidence = 0.92;

          if (whisperResponse.segments) {
            transcriptFormatted = whisperResponse.segments.map((seg: any, idx: number) => ({
              speaker: idx % 2 === 0 ? "Agent" : "Customer",
              text: seg.text,
              startTime: seg.start,
              endTime: seg.end,
              confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.9,
            }));
          } else {
            transcriptFormatted = [{
              speaker: "Unknown",
              text: transcriptRaw,
              startTime: 0,
              endTime: transcript.duration || 0,
              confidence: 0.9,
            }];
          }
        }
      } catch (error) {
        console.error("[voice-call-ai] Whisper transcription error:", error);
      }
    }

    if (!transcriptRaw) {
      transcriptRaw = "[Transcription placeholder - no audio available]";
      transcriptFormatted = [{
        speaker: "System",
        text: transcriptRaw,
        startTime: 0,
        endTime: 0,
        confidence: 1.0,
      }];
      confidence = 1.0;
    }

    const [updated] = await db
      .update(callTranscripts)
      .set({
        transcriptRaw,
        transcriptFormatted,
        transcriptionProvider: "whisper",
        transcriptionConfidence: confidence.toString(),
        updatedAt: new Date(),
      })
      .where(eq(callTranscripts.id, transcriptId))
      .returning();

    await db.insert(agentEvents).values({
      organizationId: transcript.organizationId,
      eventType: "call_transcribed",
      eventSource: "voice_call_ai",
      payload: {
        transcriptId,
        confidence,
        segmentCount: transcriptFormatted.length,
      },
      relatedEntityType: "call_transcript",
      relatedEntityId: transcriptId,
    });

    return updated;
  }

  async analyzeTranscript(transcriptId: number): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    const transcriptText = transcript.transcriptRaw || "";
    if (!transcriptText || transcriptText.includes("[Transcription placeholder")) {
      const [updated] = await db
        .update(callTranscripts)
        .set({
          summary: "No transcript available for analysis",
          sentiment: "neutral",
          sentimentScore: "0",
          updatedAt: new Date(),
        })
        .where(eq(callTranscripts.id, transcriptId))
        .returning();
      return updated;
    }

    const openai = getOpenAIClient();
    let summary = "";
    let sentiment: "positive" | "negative" | "neutral" | "mixed" = "neutral";
    let sentimentScore = 0;

    if (openai) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are an expert call analyst. Analyze the following call transcript and provide:
1. A concise summary (2-3 sentences)
2. Overall sentiment: positive, negative, neutral, or mixed
3. Sentiment score from -1 (very negative) to 1 (very positive)

Respond in JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral|mixed",
  "sentimentScore": 0.5
}`,
            },
            {
              role: "user",
              content: transcriptText,
            },
          ],
          response_format: { type: "json_object" },
        });

        const analysisText = response.choices[0]?.message?.content || "{}";
        const analysis = JSON.parse(analysisText);
        summary = analysis.summary || "Unable to generate summary";
        sentiment = analysis.sentiment || "neutral";
        sentimentScore = analysis.sentimentScore || 0;
      } catch (error) {
        console.error("[voice-call-ai] Analysis error:", error);
        summary = "Error analyzing transcript";
      }
    } else {
      summary = "AI analysis unavailable - OpenAI not configured";
    }

    const [updated] = await db
      .update(callTranscripts)
      .set({
        summary,
        sentiment,
        sentimentScore: sentimentScore.toString(),
        updatedAt: new Date(),
      })
      .where(eq(callTranscripts.id, transcriptId))
      .returning();

    await db.insert(agentEvents).values({
      organizationId: transcript.organizationId,
      eventType: "call_analyzed",
      eventSource: "voice_call_ai",
      payload: {
        transcriptId,
        sentiment,
        sentimentScore,
      },
      relatedEntityType: "call_transcript",
      relatedEntityId: transcriptId,
    });

    return updated;
  }

  async extractActionItems(transcriptId: number): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    const transcriptText = transcript.transcriptRaw || "";
    let actionItems: ActionItem[] = [];

    const openai = getOpenAIClient();
    if (openai && transcriptText && !transcriptText.includes("[Transcription placeholder")) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Extract action items from this call transcript. Look for:
- Commitments made by either party
- Next steps mentioned
- Follow-up items promised
- Deadlines or dates mentioned

For each action item, assign a priority: high, medium, or low.

Respond in JSON format:
{
  "actionItems": [
    {
      "description": "...",
      "priority": "high|medium|low",
      "dueDate": "YYYY-MM-DD or null"
    }
  ]
}`,
            },
            {
              role: "user",
              content: transcriptText,
            },
          ],
          response_format: { type: "json_object" },
        });

        const extractedText = response.choices[0]?.message?.content || "{}";
        const extracted = JSON.parse(extractedText);
        
        actionItems = (extracted.actionItems || []).map((item: any, idx: number) => ({
          id: `action-${transcriptId}-${idx}-${Date.now()}`,
          description: item.description,
          priority: item.priority || "medium",
          dueDate: item.dueDate,
          completed: false,
          createdFromCall: true,
        }));
      } catch (error) {
        console.error("[voice-call-ai] Action item extraction error:", error);
      }
    }

    const [updated] = await db
      .update(callTranscripts)
      .set({
        actionItems,
        updatedAt: new Date(),
      })
      .where(eq(callTranscripts.id, transcriptId))
      .returning();

    return updated;
  }

  async extractKeyData(transcriptId: number): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    const transcriptText = transcript.transcriptRaw || "";
    let extractedData: ExtractedData = {};

    const openai = getOpenAIClient();
    if (openai && transcriptText && !transcriptText.includes("[Transcription placeholder")) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Extract structured data from this call transcript. Look for:
- Prices mentioned (as numbers)
- Dates mentioned (as YYYY-MM-DD strings)
- Names mentioned (people, companies)
- Objections raised by the customer
- Commitments made by either party
- Questions asked
- Next steps discussed

Respond in JSON format:
{
  "pricesMentioned": [50000, 75000],
  "datesMentioned": ["2025-01-15"],
  "namesMentioned": ["John Smith", "ABC Corp"],
  "objectionsRaised": ["Price too high", "Need to think about it"],
  "commitmentsMade": ["Will send documents", "Will call back"],
  "questionsAsked": ["What is the acreage?", "Is there road access?"],
  "nextSteps": ["Send offer letter", "Schedule site visit"]
}`,
            },
            {
              role: "user",
              content: transcriptText,
            },
          ],
          response_format: { type: "json_object" },
        });

        const extractedText = response.choices[0]?.message?.content || "{}";
        extractedData = JSON.parse(extractedText);
      } catch (error) {
        console.error("[voice-call-ai] Key data extraction error:", error);
      }
    }

    const [updated] = await db
      .update(callTranscripts)
      .set({
        extractedData,
        updatedAt: new Date(),
      })
      .where(eq(callTranscripts.id, transcriptId))
      .returning();

    return updated;
  }

  async generateCoachingInsights(transcriptId: number): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    const transcriptText = transcript.transcriptRaw || "";
    const formatted = transcript.transcriptFormatted as TranscriptSegment[] || [];
    
    let coachingInsights: CoachingInsights = {};

    let agentWordCount = 0;
    let customerWordCount = 0;
    let questionCount = 0;

    for (const segment of formatted) {
      const words = segment.text.split(/\s+/).length;
      if (segment.speaker === "Agent" || segment.speaker === "Rep") {
        agentWordCount += words;
        const questions = (segment.text.match(/\?/g) || []).length;
        questionCount += questions;
      } else {
        customerWordCount += words;
      }
    }

    const totalWords = agentWordCount + customerWordCount;
    const talkToListenRatio = totalWords > 0 ? agentWordCount / totalWords : 0.5;

    coachingInsights.talkToListenRatio = parseFloat(talkToListenRatio.toFixed(2));
    coachingInsights.questionCount = questionCount;

    const openai = getOpenAIClient();
    if (openai && transcriptText && !transcriptText.includes("[Transcription placeholder")) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Analyze this sales call transcript for coaching purposes. Score from 0-100:
- Objection handling: How well did the agent address concerns?
- Rapport building: Did the agent build connection?
- Closing effectiveness: How well did they move toward next steps?

Also identify improvement areas and strengths.

Respond in JSON format:
{
  "objectionHandlingScore": 75,
  "rapportScore": 80,
  "closingEffectiveness": 70,
  "improvementAreas": ["Ask more discovery questions", "Handle price objections better"],
  "strengths": ["Good active listening", "Clear communication"]
}`,
            },
            {
              role: "user",
              content: transcriptText,
            },
          ],
          response_format: { type: "json_object" },
        });

        const insightsText = response.choices[0]?.message?.content || "{}";
        const aiInsights = JSON.parse(insightsText);
        
        coachingInsights = {
          ...coachingInsights,
          objectionHandlingScore: aiInsights.objectionHandlingScore,
          rapportScore: aiInsights.rapportScore,
          closingEffectiveness: aiInsights.closingEffectiveness,
          improvementAreas: aiInsights.improvementAreas || [],
          strengths: aiInsights.strengths || [],
        };
      } catch (error) {
        console.error("[voice-call-ai] Coaching insights error:", error);
      }
    }

    const [updated] = await db
      .update(callTranscripts)
      .set({
        coachingInsights,
        updatedAt: new Date(),
      })
      .where(eq(callTranscripts.id, transcriptId))
      .returning();

    return updated;
  }

  async applyCRMUpdates(
    transcriptId: number,
    updates: CRMUpdateRequest
  ): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    const appliedUpdates: CRMUpdate[] = [];
    const now = new Date().toISOString();

    if (updates.leadUpdates) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, transcript.leadId))
        .limit(1);

      if (lead) {
        const updateData: Record<string, any> = {};

        if (updates.leadUpdates.notes) {
          const oldNotes = lead.notes || "";
          const newNotes = oldNotes 
            ? `${oldNotes}\n\n[Call ${new Date().toLocaleDateString()}]\n${updates.leadUpdates.notes}`
            : `[Call ${new Date().toLocaleDateString()}]\n${updates.leadUpdates.notes}`;
          updateData.notes = newNotes;
          appliedUpdates.push({
            field: "lead.notes",
            oldValue: oldNotes,
            newValue: newNotes,
            appliedAt: now,
            automated: false,
          });
        }

        if (updates.leadUpdates.status) {
          appliedUpdates.push({
            field: "lead.status",
            oldValue: lead.status,
            newValue: updates.leadUpdates.status,
            appliedAt: now,
            automated: false,
          });
          updateData.status = updates.leadUpdates.status;
        }

        if (updates.leadUpdates.tags) {
          const oldTags = (lead.tags as string[]) || [];
          const newTags = Array.from(new Set([...oldTags, ...updates.leadUpdates.tags]));
          appliedUpdates.push({
            field: "lead.tags",
            oldValue: JSON.stringify(oldTags),
            newValue: JSON.stringify(newTags),
            appliedAt: now,
            automated: false,
          });
          updateData.tags = newTags;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updatedAt = new Date();
          await db
            .update(leads)
            .set(updateData)
            .where(eq(leads.id, transcript.leadId));

          await db.insert(leadActivities).values({
            leadId: transcript.leadId,
            organizationId: transcript.organizationId,
            type: "call_made",
            description: `Call recorded and CRM updated`,
            metadata: { transcriptId, updatesApplied: Object.keys(updateData) },
          });
        }
      }
    }

    if (updates.dealUpdates && transcript.dealId) {
      const [deal] = await db
        .select()
        .from(deals)
        .where(eq(deals.id, transcript.dealId))
        .limit(1);

      if (deal) {
        const updateData: Record<string, any> = {};

        if (updates.dealUpdates.status) {
          appliedUpdates.push({
            field: "deal.status",
            oldValue: deal.status,
            newValue: updates.dealUpdates.status,
            appliedAt: now,
            automated: false,
          });
          updateData.status = updates.dealUpdates.status;
        }

        if (updates.dealUpdates.notes) {
          const oldNotes = deal.notes || "";
          const newNotes = oldNotes 
            ? `${oldNotes}\n\n[Call ${new Date().toLocaleDateString()}]\n${updates.dealUpdates.notes}`
            : `[Call ${new Date().toLocaleDateString()}]\n${updates.dealUpdates.notes}`;
          updateData.notes = newNotes;
          appliedUpdates.push({
            field: "deal.notes",
            oldValue: oldNotes,
            newValue: newNotes,
            appliedAt: now,
            automated: false,
          });
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updatedAt = new Date();
          await db
            .update(deals)
            .set(updateData)
            .where(eq(deals.id, transcript.dealId));
        }
      }
    }

    const existingUpdates = (transcript.crmUpdatesApplied as CRMUpdate[]) || [];
    const allUpdates = [...existingUpdates, ...appliedUpdates];

    const [updated] = await db
      .update(callTranscripts)
      .set({
        crmUpdatesApplied: allUpdates,
        updatedAt: new Date(),
      })
      .where(eq(callTranscripts.id, transcriptId))
      .returning();

    await db.insert(agentEvents).values({
      organizationId: transcript.organizationId,
      eventType: "crm_updates_applied",
      eventSource: "voice_call_ai",
      payload: {
        transcriptId,
        updatesApplied: appliedUpdates.length,
        fields: appliedUpdates.map(u => u.field),
      },
      relatedEntityType: "call_transcript",
      relatedEntityId: transcriptId,
    });

    return updated;
  }

  async processCallComplete(transcriptId: number): Promise<CallTranscript> {
    const [transcript] = await db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.id, transcriptId))
      .limit(1);

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    await db.insert(agentEvents).values({
      organizationId: transcript.organizationId,
      eventType: "call_processing_started",
      eventSource: "voice_call_ai",
      payload: { transcriptId },
      relatedEntityType: "call_transcript",
      relatedEntityId: transcriptId,
    });

    try {
      if (transcript.audioUrl) {
        await this.transcribeCall(transcriptId, transcript.audioUrl);
      }

      await this.analyzeTranscript(transcriptId);

      await Promise.all([
        this.extractActionItems(transcriptId),
        this.extractKeyData(transcriptId),
      ]);

      await this.generateCoachingInsights(transcriptId);

      const [finalTranscript] = await db
        .select()
        .from(callTranscripts)
        .where(eq(callTranscripts.id, transcriptId))
        .limit(1);

      await db.insert(agentEvents).values({
        organizationId: transcript.organizationId,
        eventType: "call_processing_completed",
        eventSource: "voice_call_ai",
        payload: {
          transcriptId,
          hasTranscript: !!finalTranscript.transcriptRaw,
          hasSummary: !!finalTranscript.summary,
          actionItemCount: (finalTranscript.actionItems as any[] || []).length,
        },
        relatedEntityType: "call_transcript",
        relatedEntityId: transcriptId,
      });

      return finalTranscript;
    } catch (error) {
      await db.insert(agentEvents).values({
        organizationId: transcript.organizationId,
        eventType: "call_processing_failed",
        eventSource: "voice_call_ai",
        payload: {
          transcriptId,
          error: error instanceof Error ? error.message : String(error),
        },
        relatedEntityType: "call_transcript",
        relatedEntityId: transcriptId,
      });
      throw error;
    }
  }

  async getCallsForLead(
    organizationId: number,
    leadId: number
  ): Promise<CallTranscript[]> {
    const transcripts = await db
      .select()
      .from(callTranscripts)
      .where(
        and(
          eq(callTranscripts.organizationId, organizationId),
          eq(callTranscripts.leadId, leadId)
        )
      )
      .orderBy(desc(callTranscripts.createdAt));

    return transcripts;
  }

  async getCoachingMetrics(
    organizationId: number,
    dateRange?: DateRange
  ): Promise<CoachingMetrics> {
    let query = db
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.organizationId, organizationId));

    if (dateRange) {
      query = db
        .select()
        .from(callTranscripts)
        .where(
          and(
            eq(callTranscripts.organizationId, organizationId),
            gte(callTranscripts.createdAt, dateRange.start),
            lte(callTranscripts.createdAt, dateRange.end)
          )
        );
    }

    const transcripts = await query;

    const metrics: CoachingMetrics = {
      totalCalls: transcripts.length,
      avgTalkToListenRatio: 0,
      avgQuestionCount: 0,
      avgObjectionHandlingScore: 0,
      avgRapportScore: 0,
      avgClosingEffectiveness: 0,
      commonImprovementAreas: [],
      commonStrengths: [],
      callsByType: {},
      callsBySentiment: {},
    };

    if (transcripts.length === 0) {
      return metrics;
    }

    let talkToListenSum = 0;
    let questionSum = 0;
    let objectionSum = 0;
    let rapportSum = 0;
    let closingSum = 0;
    let coachingCount = 0;

    const improvementCounts: Record<string, number> = {};
    const strengthCounts: Record<string, number> = {};

    for (const t of transcripts) {
      metrics.callsByType[t.callType] = (metrics.callsByType[t.callType] || 0) + 1;
      
      if (t.sentiment) {
        metrics.callsBySentiment[t.sentiment] = (metrics.callsBySentiment[t.sentiment] || 0) + 1;
      }

      const insights = t.coachingInsights as CoachingInsights;
      if (insights) {
        coachingCount++;
        if (insights.talkToListenRatio !== undefined) {
          talkToListenSum += insights.talkToListenRatio;
        }
        if (insights.questionCount !== undefined) {
          questionSum += insights.questionCount;
        }
        if (insights.objectionHandlingScore !== undefined) {
          objectionSum += insights.objectionHandlingScore;
        }
        if (insights.rapportScore !== undefined) {
          rapportSum += insights.rapportScore;
        }
        if (insights.closingEffectiveness !== undefined) {
          closingSum += insights.closingEffectiveness;
        }

        for (const area of insights.improvementAreas || []) {
          improvementCounts[area] = (improvementCounts[area] || 0) + 1;
        }
        for (const strength of insights.strengths || []) {
          strengthCounts[strength] = (strengthCounts[strength] || 0) + 1;
        }
      }
    }

    if (coachingCount > 0) {
      metrics.avgTalkToListenRatio = parseFloat((talkToListenSum / coachingCount).toFixed(2));
      metrics.avgQuestionCount = parseFloat((questionSum / coachingCount).toFixed(1));
      metrics.avgObjectionHandlingScore = parseFloat((objectionSum / coachingCount).toFixed(1));
      metrics.avgRapportScore = parseFloat((rapportSum / coachingCount).toFixed(1));
      metrics.avgClosingEffectiveness = parseFloat((closingSum / coachingCount).toFixed(1));
    }

    metrics.commonImprovementAreas = Object.entries(improvementCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([area]) => area);

    metrics.commonStrengths = Object.entries(strengthCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([strength]) => strength);

    return metrics;
  }
}

export const voiceCallAIService = new VoiceCallAIService();
