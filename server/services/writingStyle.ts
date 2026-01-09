import { db } from "../db";
import { writingStyleProfiles, messages, conversations } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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
      max_tokens: 10,
      temperature: 0
    });
    
    const result = response.choices[0]?.message?.content?.toLowerCase().trim();
    if (result === "positive" || result === "neutral" || result === "negative") {
      return result;
    }
    return "neutral";
  } catch (error) {
    console.error("Error analyzing sentiment:", error);
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
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
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
        content: `Analyze these ${samples.length} sample messages:\n\n${sampleTexts}`
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.3
  });
  
  const analysis = JSON.parse(response.choices[0]?.message?.content || "{}");
  
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
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
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
        role: "user",
        content: `Write a ${messageContext.intent.replace("_", " ")} message about: ${messageContext.topic}
${messageContext.recipientName ? `Recipient: ${messageContext.recipientName}` : ""}
${messageContext.propertyDetails ? `Property: ${messageContext.propertyDetails.address || "Property"}, ${messageContext.propertyDetails.acres} acres, $${messageContext.propertyDetails.price}` : ""}
${messageContext.previousMessages?.length ? `Previous messages in conversation:\n${messageContext.previousMessages.join("\n")}` : ""}`
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.7
  });
  
  const result = JSON.parse(response.choices[0]?.message?.content || "{}");
  
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
      console.error("Error adding sample message:", error);
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

export async function deleteStyleProfile(profileId: number): Promise<void> {
  await db
    .delete(writingStyleProfiles)
    .where(eq(writingStyleProfiles.id, profileId));
}
