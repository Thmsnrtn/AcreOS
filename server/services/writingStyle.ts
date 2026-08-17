import { db } from "../db";
import { writingStyleProfiles, messages, conversations } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../utils/logger";
import { routeAITask, TaskComplexity } from "./aiRouter";

import { wrapUntrusted } from "../ai/untrustedEnvelope";
// Migrated from direct OpenAI client to central aiRouter (P1-36).
// All calls flow through aiRouter for cost tracking, semantic caching,
// rate limiting, and provider failover.

interface ToneAnalysis {
  formality: "casual" | "semi-formal" | "formal";
  warmth: number;
  directness: number;
  enthusiasm: number;
  humor: boolean;
  empathy: number;
}

interface PatternAnalysis {
  greetings: string[];
  closings: string[];
  transitionPhrases: string[];
  emphasisStyle: string;
  questionStyle: string;
  commonPhrases: string[];
}

interface SampleMessage {
  id: string;
  context: string;
  content: string;
  sentiment: "positive" | "neutral" | "negative";
  addedAt: string;
}

interface StylePreferences {
  maxLength?: number;
  usesEmoji: boolean;
  signatureLine?: string;
  preferredChannels?: string[];
}

export interface WritingStyleProfile {
  id: number;
  organizationId: number;
  userId: string;
  name: string;
  isDefault: boolean | null;
  toneAnalysis: ToneAnalysis | null;
  patterns: PatternAnalysis | null;
  sampleMessages: SampleMessage[] | null;
  preferences: StylePreferences | null;
  totalSamples: number | null;
  lastTrainedAt: Date | null;
  confidenceScore: string | null;
}

export async function getWritingStyleProfile(
  organizationId: number, 
  userId: string
): Promise<WritingStyleProfile | null> {
  const [profile] = await db
    .select()
    .from(writingStyleProfiles)
    .where(
      and(
        eq(writingStyleProfiles.organizationId, organizationId),
        eq(writingStyleProfiles.userId, userId),
        eq(writingStyleProfiles.isDefault, true)
      )
    )
    .limit(1);
  
  return profile as WritingStyleProfile | null;
}

export async function createWritingStyleProfile(
  organizationId: number,
  userId: string,
  name: string = "Default Style"
): Promise<WritingStyleProfile> {
  const [profile] = await db
    .insert(writingStyleProfiles)
    .values({
      organizationId,
      userId,
      name,
      isDefault: true,
      sampleMessages: [],
      totalSamples: 0,
    })
    .returning();
  
  return profile as WritingStyleProfile;
}

export async function addSampleMessage(
  profileId: number,
  context: string,
  content: string
): Promise<void> {
  const [profile] = await db
    .select()
    .from(writingStyleProfiles)
    .where(eq(writingStyleProfiles.id, profileId))
    .limit(1);
  
  if (!profile) {
    throw new Error("Profile not found");
  }
  
  const existingSamples = (profile.sampleMessages as SampleMessage[]) || [];
  const sentiment = await analyzeSentiment(content);
  
  const newSample: SampleMessage = {
    id: `sample-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    context,
    content,
    sentiment,
    addedAt: new Date().toISOString(),
  };
  
  const updatedSamples = [...existingSamples, newSample].slice(-50);
  
  await db
    .update(writingStyleProfiles)
    .set({
      sampleMessages: updatedSamples,
      totalSamples: updatedSamples.length,
      updatedAt: new Date(),
    })
    .where(eq(writingStyleProfiles.id, profileId));
}

async function analyzeSentiment(content: string): Promise<"positive" | "neutral" | "negative"> {
  try {
    const response = await routeAITask({
      taskType: "categorize",
      complexity: TaskComplexity.SIMPLE,
      taskTier: "standard", // writing-style sentiment
      messages: [
        {
          role: "system",
          content: "Analyze the sentiment of the following message. Respond with exactly one word: positive, neutral, or negative."
        },
        {
          role: "user",
          content
        }
      ],
      maxTokens: 10,
      temperature: 0,
    });

    const result = response.content?.toLowerCase().trim();
    if (result === "positive" || result === "neutral" || result === "negative") {
      return result;
    }
    return "neutral";
  } catch (error) {
    logger.error("Error analyzing sentiment", error);
    return "neutral";
  }
}

export async function analyzeWritingStyle(profileId: number): Promise<{
  toneAnalysis: ToneAnalysis;
  patterns: PatternAnalysis;
  preferences: StylePreferences;
  confidenceScore: number;
}> {
  const [profile] = await db
    .select()
    .from(writingStyleProfiles)
    .where(eq(writingStyleProfiles.id, profileId))
    .limit(1);
  
  if (!profile) {
    throw new Error("Profile not found");
  }
  
  const samples = (profile.sampleMessages as SampleMessage[]) || [];
  
  if (samples.length < 3) {
    throw new Error("Need at least 3 sample messages to analyze style");
  }
  
  const sampleTexts = samples.map(s => s.content).join("\n---\n");
  
  const response = await routeAITask({
    taskType: "writing_style_analysis",
    complexity: TaskComplexity.COMPLEX,
    taskTier: "standard", // one-time style extraction — Haiku is sufficient
    messages: [
      {
        role: "system",
        content: `You are a writing style analyst. Analyze the provided sample messages and extract the writer's unique style characteristics.

Return a JSON object with this exact structure:
{
  "toneAnalysis": {
    "formality": "casual" | "semi-formal" | "formal",
    "warmth": 0-100,
    "directness": 0-100,
    "enthusiasm": 0-100,
    "humor": true/false,
    "empathy": 0-100
  },
  "patterns": {
    "greetings": ["array of greeting phrases they use"],
    "closings": ["array of sign-off phrases they use"],
    "transitionPhrases": ["phrases they use to transition between topics"],
    "emphasisStyle": "description of how they emphasize (caps, exclamation, etc.)",
    "questionStyle": "description of how they ask questions",
    "commonPhrases": ["frequently used expressions or phrases"]
  },
  "preferences": {
    "maxLength": average message length in characters,
    "usesEmoji": true/false,
    "signatureLine": "their typical sign-off or null if none"
  },
  "confidenceScore": 0-1 confidence in the analysis
}

Only output valid JSON, no other text.`
      },
      {
        role: "user",
        content: `Analyze these ${samples.length} sample messages:\n\n${wrapUntrusted(sampleTexts, "writing-style-samples")}`
      }
    ],
    responseFormat: "json",
    temperature: 0.3,
  }, { orgId: profile.organizationId ?? undefined });

  const analysis = JSON.parse(response.content || "{}");
  
  await db
    .update(writingStyleProfiles)
    .set({
      toneAnalysis: analysis.toneAnalysis,
      patterns: analysis.patterns,
      preferences: analysis.preferences,
      confidenceScore: String(analysis.confidenceScore || 0.5),
      lastTrainedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(writingStyleProfiles.id, profileId));
  
  return analysis;
}

export async function generateStyledResponse(
  profileId: number,
  messageContext: {
    recipientName?: string;
    topic: string;
    previousMessages?: string[];
    intent: "initial_outreach" | "follow_up" | "negotiation" | "closing" | "general";
    propertyDetails?: {
      address?: string;
      acres?: number;
      price?: number;
    };
  }
): Promise<{
  message: string;
  confidence: number;
  alternatives?: string[];
}> {
  const [profile] = await db
    .select()
    .from(writingStyleProfiles)
    .where(eq(writingStyleProfiles.id, profileId))
    .limit(1);
  
  if (!profile) {
    throw new Error("Profile not found");
  }
  
  const toneAnalysis = profile.toneAnalysis as ToneAnalysis | null;
  const patterns = profile.patterns as PatternAnalysis | null;
  const samples = (profile.sampleMessages as SampleMessage[]) || [];
  const preferences = profile.preferences as StylePreferences | null;
  
  const relevantSamples = samples
    .filter(s => s.context === messageContext.intent || s.context === "general")
    .slice(0, 5);
  
  const styleDescription = toneAnalysis
    ? `- Formality: ${toneAnalysis.formality}
- Warmth level: ${toneAnalysis.warmth}/100
- Directness: ${toneAnalysis.directness}/100
- Enthusiasm: ${toneAnalysis.enthusiasm}/100
- Uses humor: ${toneAnalysis.humor}
- Empathy level: ${toneAnalysis.empathy}/100`
    : "Style not yet analyzed - use a friendly, professional tone.";
  
  const patternDescription = patterns
    ? `Common greetings: ${patterns.greetings.join(", ")}
Common closings: ${patterns.closings.join(", ")}
Common phrases: ${patterns.commonPhrases.join(", ")}
Emphasis style: ${patterns.emphasisStyle}
Question style: ${patterns.questionStyle}`
    : "";
  
  const examplesSection = relevantSamples.length > 0
    ? `\n\nExample messages from this user:\n${relevantSamples.map(s => `---\n${s.content}`).join("\n")}`
    : "";
  
  const response = await routeAITask({
    taskType: "draft_email",
    complexity: TaskComplexity.MODERATE,
    taskTier: "standard", // ghostwrite draft
    messages: [
      {
        role: "system",
        content: `You are a ghostwriter who writes messages in the exact style of a specific person. Your goal is to write a message that sounds exactly like they would write it - matching their vocabulary, tone, phrasing patterns, and personality.

STYLE PROFILE:
${styleDescription}

${patternDescription}
${examplesSection}

RULES:
1. Match the writing style exactly - don't make it "better" or more formal
2. Use their actual phrases and expressions where appropriate
3. Keep the length similar to their typical messages (${preferences?.maxLength || 200} characters average)
4. ${preferences?.usesEmoji ? "Include emojis as they would" : "Do not use emojis"}
5. Sound natural and authentic to this person's voice

Respond with a JSON object:
{
  "message": "the message text",
  "confidence": 0-1 confidence that this matches their style,
  "alternatives": ["optional alternative versions if useful"]
}`
      },
      {
        // `propertyDetails.address` arrives raw from the request body
        // (`POST /api/writing-styles/:id/generate` destructures it out of
        // `req.body` and passes it straight through), so it is exactly P0-14's
        // "property descriptions / customer-typed" category reaching a model.
        // Wrapped in the same idiom this file already uses for the sample
        // messages above. lint-prompt-envelope.mjs cannot see this site — its
        // inline `content:` reader is one regex that stops at the first inner
        // backtick, and the `recipientName` ternary on the line above opens one
        // — so the count does NOT move when this is wrapped or unwrapped. It was
        // found and fixed by hand; do not read a green gate as cover for
        // unwrapping it.
        role: "user",
        content: `Write a ${messageContext.intent.replace("_", " ")} message about: ${messageContext.topic}
${messageContext.recipientName ? `Recipient: ${messageContext.recipientName}` : ""}
${messageContext.propertyDetails ? `Property: ${messageContext.propertyDetails.address ? wrapUntrusted(messageContext.propertyDetails.address, "property-address") : "Property"}, ${messageContext.propertyDetails.acres} acres, $${messageContext.propertyDetails.price}` : ""}
${messageContext.previousMessages?.length ? `Previous messages in conversation:\n${messageContext.previousMessages.join("\n")}` : ""}`
      }
    ],
    responseFormat: "json",
    temperature: 0.7,
  }, { orgId: profile.organizationId ?? undefined });

  const result = JSON.parse(response.content || "{}");
  
  return {
    message: result.message || "",
    confidence: result.confidence || 0.5,
    alternatives: result.alternatives
  };
}

export async function importMessagesFromConversations(
  organizationId: number,
  userId: string,
  profileId: number,
  limit: number = 20
): Promise<number> {
  const orgConversations = await db
    .select()
    .from(conversations)
    .where(eq(conversations.organizationId, organizationId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
  
  if (orgConversations.length === 0) {
    return 0;
  }
  
  const conversationIds = orgConversations.map(c => c.id);
  
  const outboundMessages = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.direction, "outbound"),
        eq(messages.sender, "human")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  
  let addedCount = 0;
  for (const msg of outboundMessages) {
    try {
      await addSampleMessage(profileId, "general", msg.content);
      addedCount++;
    } catch (error) {
      logger.error("Error adding sample message", error);
    }
  }
  
  return addedCount;
}

export async function getAllStyleProfiles(
  organizationId: number
): Promise<WritingStyleProfile[]> {
  const profiles = await db
    .select()
    .from(writingStyleProfiles)
    .where(eq(writingStyleProfiles.organizationId, organizationId))
    .orderBy(desc(writingStyleProfiles.updatedAt));
  
  return profiles as WritingStyleProfile[];
}

/**
 * Delete one writing-style profile, PINNED TO THE OWNING ORG.
 *
 * The org predicate is the whole point of this function's signature. Until
 * 2026-08-16 this took a bare `profileId` and emitted
 * `DELETE … WHERE id = $1`, while `DELETE /api/writing-styles/:id`
 * (server/routes-va-engine.ts) handed it `parseInt(req.params.id)` with NO
 * organization comparison anywhere in the handler — so any authenticated
 * member of any org could destroy another org's profile by guessing an
 * integer. `writing_style_profiles.organization_id` is NOT NULL, so there was
 * never a row this predicate could not be applied to.
 *
 * Returns TRUE iff a row in THIS org was deleted. A cross-tenant id deletes
 * nothing and returns false — the caller turns that into a 404, which is also
 * why the route no longer leaks whether the id exists in some other tenant.
 */
export async function deleteStyleProfile(
  organizationId: number,
  profileId: number,
): Promise<boolean> {
  const deleted = await db
    .delete(writingStyleProfiles)
    .where(
      and(
        eq(writingStyleProfiles.id, profileId),
        eq(writingStyleProfiles.organizationId, organizationId)
      )
    )
    .returning({ id: writingStyleProfiles.id });

  return deleted.length > 0;
}
