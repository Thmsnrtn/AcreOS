import { db } from "../db";
import { 
  leadQualificationSignals, 
  escalationAlerts, 
  leads, 
  conversations,
  messages 
} from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface QualificationSignal {
  signalType: string;
  confidence: number;
  extractedText?: string;
  intentScore: number;
  metadata?: Record<string, any>;
}

const SIGNAL_WEIGHTS: Record<string, number> = {
  viewing_request: 25,
  timeline_mention: 20,
  financing_question: 15,
  price_inquiry: 15,
  urgency: 20,
  negotiation: 15,
  comparison_shopping: -5,
  objection: -10,
};

export async function analyzeMessageForSignals(
  organizationId: number,
  leadId: number,
  conversationId: number | null,
  messageContent: string
): Promise<QualificationSignal[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a lead qualification expert for land investment. Analyze buyer messages for buying signals.

Identify these signal types:
- price_inquiry: Asking about price, payment terms, or financing options
- timeline_mention: Mentioning when they want to buy or move forward
- financing_question: Questions about owner financing, down payment, terms
- viewing_request: Wanting to see the property or get more photos/info
- comparison_shopping: Mentioning other properties they're considering
- urgency: Expressing time pressure or immediate interest
- objection: Raising concerns or objections
- negotiation: Making counter-offers or discussing terms

Return a JSON array of detected signals:
[
  {
    "signalType": "signal_type",
    "confidence": 0-1,
    "extractedText": "the exact text that triggered this",
    "metadata": { optional data like mentioned prices, timelines, etc. }
  }
]

Return an empty array [] if no signals detected.`
      },
      {
        role: "user",
        content: messageContent
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.3
  });
  
  const result = JSON.parse(response.choices[0]?.message?.content || "{}");
  const signals = result.signals || result || [];
  
  if (!Array.isArray(signals)) {
    return [];
  }
  
  const processedSignals: QualificationSignal[] = [];
  
  for (const signal of signals) {
    if (!signal.signalType) continue;
    
    const weight = SIGNAL_WEIGHTS[signal.signalType] || 0;
    const intentScore = Math.round(signal.confidence * weight);
    
    const [saved] = await db
      .insert(leadQualificationSignals)
      .values({
        organizationId,
        leadId,
        conversationId,
        signalType: signal.signalType,
        confidence: String(signal.confidence),
        extractedText: signal.extractedText,
        intentScore,
        metadata: signal.metadata,
      })
      .returning();
    
    processedSignals.push({
      signalType: signal.signalType,
      confidence: signal.confidence,
      extractedText: signal.extractedText,
      intentScore,
      metadata: signal.metadata,
    });
  }
  
  return processedSignals;
}

export async function calculateLeadIntentScore(
  organizationId: number,
  leadId: number
): Promise<{
  totalScore: number;
  signals: { type: string; score: number; count: number }[];
  isHot: boolean;
  recommendation: string;
}> {
  const recentSignals = await db
    .select()
    .from(leadQualificationSignals)
    .where(
      and(
        eq(leadQualificationSignals.organizationId, organizationId),
        eq(leadQualificationSignals.leadId, leadId),
        gte(leadQualificationSignals.detectedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(leadQualificationSignals.detectedAt));
  
  const signalSummary: Record<string, { score: number; count: number }> = {};
  let totalScore = 0;
  
  for (const signal of recentSignals) {
    const type = signal.signalType;
    const score = signal.intentScore || 0;
    
    if (!signalSummary[type]) {
      signalSummary[type] = { score: 0, count: 0 };
    }
    
    signalSummary[type].score += score;
    signalSummary[type].count++;
    totalScore += score;
  }
  
  const signals = Object.entries(signalSummary).map(([type, data]) => ({
    type,
    score: data.score,
    count: data.count,
  }));
  
  const normalizedScore = Math.min(100, Math.max(0, 50 + totalScore));
  const isHot = normalizedScore >= 75;
  
  let recommendation = "Continue nurturing with regular follow-ups";
  if (normalizedScore >= 90) {
    recommendation = "HIGH PRIORITY - Ready to close. Reach out immediately with final terms.";
  } else if (normalizedScore >= 75) {
    recommendation = "HOT LEAD - Serious buyer interest. Schedule a call or send detailed property info.";
  } else if (normalizedScore >= 60) {
    recommendation = "WARM LEAD - Good engagement. Send additional property details and payment options.";
  } else if (normalizedScore < 40) {
    recommendation = "COLD LEAD - Limited interest. Add to long-term nurture sequence.";
  }
  
  return {
    totalScore: normalizedScore,
    signals,
    isHot,
    recommendation,
  };
}

export async function createEscalationAlert(
  organizationId: number,
  params: {
    leadId?: number;
    conversationId?: number;
    propertyId?: number;
    alertType: string;
    priority: "low" | "medium" | "high" | "urgent";
    title: string;
    description?: string;
    suggestedAction?: string;
    suggestedResponse?: string;
    expiresInHours?: number;
  }
): Promise<number> {
  const expiresAt = params.expiresInHours
    ? new Date(Date.now() + params.expiresInHours * 60 * 60 * 1000)
    : null;
  
  const [alert] = await db
    .insert(escalationAlerts)
    .values({
      organizationId,
      leadId: params.leadId,
      conversationId: params.conversationId,
      propertyId: params.propertyId,
      alertType: params.alertType,
      priority: params.priority,
      title: params.title,
      description: params.description,
      suggestedAction: params.suggestedAction,
      suggestedResponse: params.suggestedResponse,
      expiresAt,
      status: "pending",
    })
    .returning({ id: escalationAlerts.id });
  
  return alert.id;
}

export async function getPendingAlerts(
  organizationId: number,
  options?: {
    priority?: string;
    limit?: number;
  }
): Promise<any[]> {
  let query = db
    .select()
    .from(escalationAlerts)
    .where(
      and(
        eq(escalationAlerts.organizationId, organizationId),
        eq(escalationAlerts.status, "pending")
      )
    )
    .orderBy(
      sql`CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`,
      desc(escalationAlerts.createdAt)
    );
  
  const alerts = await query.limit(options?.limit ?? 50);
  
  return alerts;
}

export async function acknowledgeAlert(
  alertId: number,
  userId: string,
  actionTaken?: string
): Promise<void> {
  await db
    .update(escalationAlerts)
    .set({
      status: actionTaken ? "actioned" : "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
      actionTaken,
    })
    .where(eq(escalationAlerts.id, alertId));
}

export async function dismissAlert(alertId: number): Promise<void> {
  await db
    .update(escalationAlerts)
    .set({
      status: "dismissed",
    })
    .where(eq(escalationAlerts.id, alertId));
}

export async function checkForHotLeads(organizationId: number): Promise<number[]> {
  const hotLeadIds: number[] = [];
  
  const recentlyActiveLeads = await db
    .select({
      leadId: leadQualificationSignals.leadId,
    })
    .from(leadQualificationSignals)
    .where(
      and(
        eq(leadQualificationSignals.organizationId, organizationId),
        gte(leadQualificationSignals.detectedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
    .groupBy(leadQualificationSignals.leadId);
  
  for (const { leadId } of recentlyActiveLeads) {
    const { totalScore, isHot } = await calculateLeadIntentScore(organizationId, leadId);
    
    if (isHot) {
      const existingAlert = await db
        .select()
        .from(escalationAlerts)
        .where(
          and(
            eq(escalationAlerts.organizationId, organizationId),
            eq(escalationAlerts.leadId, leadId),
            eq(escalationAlerts.alertType, "hot_lead"),
            eq(escalationAlerts.status, "pending")
          )
        )
        .limit(1);
      
      if (existingAlert.length === 0) {
        const [lead] = await db
          .select()
          .from(leads)
          .where(eq(leads.id, leadId))
          .limit(1);
        
        if (lead) {
          await createEscalationAlert(organizationId, {
            leadId,
            alertType: "hot_lead",
            priority: totalScore >= 90 ? "urgent" : "high",
            title: `Hot Lead: ${lead.firstName} ${lead.lastName}`,
            description: `Intent score: ${totalScore}. This buyer is showing strong interest signals.`,
            suggestedAction: "Review conversation and reach out with personalized follow-up",
            expiresInHours: 24,
          });
          
          hotLeadIds.push(leadId);
        }
      }
    }
  }
  
  return hotLeadIds;
}

export async function generateSuggestedResponse(
  organizationId: number,
  leadId: number,
  propertyId?: number
): Promise<string> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  
  if (!lead) {
    throw new Error("Lead not found");
  }
  
  const recentMessages = await db
    .select()
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.leadId, leadId))
    .orderBy(desc(messages.createdAt))
    .limit(10);
  
  const messageHistory = recentMessages
    .map(m => `${m.messages.direction === "inbound" ? "Buyer" : "You"}: ${m.messages.content}`)
    .reverse()
    .join("\n");
  
  const { totalScore, signals, recommendation } = await calculateLeadIntentScore(organizationId, leadId);
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a land investment sales expert. Generate a personalized follow-up message for a buyer.

Lead info:
- Name: ${lead.firstName} ${lead.lastName}
- Intent score: ${totalScore}/100
- Recent signals: ${signals.map(s => s.type).join(", ")}
- Recommendation: ${recommendation}

Guidelines:
- Be friendly but professional
- Address their specific interests/questions based on the conversation
- If they're hot, create urgency without being pushy
- If they have objections, address them directly
- Keep messages concise (2-3 paragraphs max)
- Include a clear next step or call to action`
      },
      {
        role: "user",
        content: `Recent conversation:\n${messageHistory || "No previous messages"}\n\nGenerate a follow-up message.`
      }
    ],
    temperature: 0.7,
    max_tokens: 500
  });
  
  return response.choices[0]?.message?.content || "";
}
