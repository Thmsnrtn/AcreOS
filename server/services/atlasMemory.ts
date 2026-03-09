/**
 * Atlas Episodic Memory System
 *
 * After each Atlas conversation, extract key facts and store them in the
 * agentMemory table. Future conversations inject relevant memories into
 * the system prompt context, giving Atlas persistent cross-session knowledge.
 *
 * Memory types:
 *   fact        — concrete facts about leads, deals, sellers, markets
 *   preference  — user investment preferences and operating style
 *   pattern     — recurring patterns observed across deals
 *   goal        — stated goals and targets
 *   warning     — important warnings to remember (e.g., "don't contact John on Mondays")
 */

import { db } from "../db";
import { agentMemory } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

export type MemoryType = 'fact' | 'preference' | 'pattern' | 'goal' | 'warning';

export interface MemoryEntry {
  agentType: string;
  memoryType: MemoryType;
  key: string;
  value: Record<string, any>;
  confidence?: number;
}

export interface ExtractedMemory {
  type: MemoryType;
  key: string;
  value: Record<string, any>;
  confidence: number;
}

/**
 * Store a memory entry for an organization.
 * If a memory with the same key already exists, upsert it with higher confidence.
 */
export async function storeMemory(
  organizationId: number,
  entry: MemoryEntry
): Promise<void> {
  const existing = await db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.organizationId, organizationId),
        eq(agentMemory.agentType, entry.agentType),
        eq(agentMemory.key, entry.key)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Increase confidence on repeated observation (Bayesian-style update)
    const prev = parseFloat(existing[0].confidence ?? '0.5');
    const newConfidence = Math.min(0.99, prev + (1 - prev) * 0.3);
    await db
      .update(agentMemory)
      .set({
        value: entry.value,
        confidence: String(newConfidence),
        usageCount: (existing[0].usageCount || 0) + 1,
        lastUsedAt: new Date(),
      })
      .where(eq(agentMemory.id, existing[0].id));
  } else {
    await db.insert(agentMemory).values({
      organizationId,
      agentType: entry.agentType,
      memoryType: entry.memoryType,
      key: entry.key,
      value: entry.value,
      confidence: String(entry.confidence ?? 0.7),
    });
  }
}

/**
 * Retrieve relevant memories for context injection.
 * Returns up to `limit` memories, ordered by confidence + recency.
 */
export async function getRelevantMemories(
  organizationId: number,
  agentType: string = 'atlas',
  limit: number = 15
): Promise<Array<{ type: MemoryType; key: string; value: Record<string, any>; confidence: number }>> {
  const memories = await db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.organizationId, organizationId),
        eq(agentMemory.agentType, agentType)
      )
    )
    .orderBy(desc(agentMemory.confidence), desc(agentMemory.lastUsedAt))
    .limit(limit);

  return memories.map(m => ({
    type: m.memoryType as MemoryType,
    key: m.key,
    value: m.value as Record<string, any>,
    confidence: parseFloat(m.confidence ?? '0.5'),
  }));
}

/**
 * Format memories into a concise context string for injection into the system prompt.
 */
export function formatMemoriesForContext(
  memories: Array<{ type: MemoryType; key: string; value: Record<string, any>; confidence: number }>
): string {
  if (memories.length === 0) return '';

  const groups: Record<MemoryType, string[]> = {
    fact: [],
    preference: [],
    pattern: [],
    goal: [],
    warning: [],
  };

  for (const m of memories) {
    const desc = m.value.summary || m.value.description || JSON.stringify(m.value);
    groups[m.type].push(`• ${m.key}: ${desc}`);
  }

  const sections: string[] = [];
  if (groups.warning.length) sections.push(`⚠️ IMPORTANT NOTES:\n${groups.warning.join('\n')}`);
  if (groups.goal.length) sections.push(`🎯 INVESTOR GOALS:\n${groups.goal.join('\n')}`);
  if (groups.preference.length) sections.push(`📋 PREFERENCES:\n${groups.preference.join('\n')}`);
  if (groups.fact.length) sections.push(`💡 KNOWN FACTS:\n${groups.fact.join('\n')}`);
  if (groups.pattern.length) sections.push(`📊 OBSERVED PATTERNS:\n${groups.pattern.join('\n')}`);

  if (sections.length === 0) return '';

  return `\n\n--- ATLAS MEMORY (Persistent Cross-Session Context) ---\n${sections.join('\n\n')}\n--- END MEMORY ---\n`;
}

/**
 * Extract memories from a completed conversation using a structured prompt.
 * Call this after a conversation ends to update the memory bank.
 *
 * Returns extracted memories that should be stored.
 */
export async function extractMemoriesFromConversation(
  messages: Array<{ role: string; content: string }>,
  openaiClient: { chat: { completions: { create: (opts: any) => Promise<any> } } }
): Promise<ExtractedMemory[]> {
  if (messages.length < 2) return [];

  // Summarize last ~10 messages to avoid token overflow
  const recentMessages = messages.slice(-10);
  const conversationText = recentMessages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
    .join('\n');

  const extractionPrompt = `You are analyzing a conversation between a land investor and their AI assistant (Atlas).

Extract any persistent facts, preferences, goals, patterns, or warnings that would be valuable to remember for FUTURE conversations.

Focus on:
- Investment preferences (deal size, geography, land type, seller type)
- Stated goals and targets (revenue goals, volume goals, timeline)
- Specific seller details that are important to remember
- Patterns in how they do business
- Important warnings ("don't call before 10am", "seller wants to use own title company")
- Market insights specific to their counties

Return ONLY a JSON array of memory objects. Empty array if nothing important.
Each object: { "type": "fact|preference|pattern|goal|warning", "key": "short identifier", "value": {"summary": "concise description"}, "confidence": 0.0-1.0 }

CONVERSATION:
${conversationText}

EXTRACTED MEMORIES (JSON array only, no other text):`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: extractionPrompt }],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices?.[0]?.message?.content || '{"memories":[]}';
    const parsed = JSON.parse(raw);
    const memoriesArray = Array.isArray(parsed) ? parsed : (parsed.memories || []);

    return memoriesArray.filter((m: any) =>
      m && typeof m.type === 'string' && typeof m.key === 'string' && m.value
    ).slice(0, 10); // Max 10 memories per conversation
  } catch (err: any) {
    console.warn('[AtlasMemory] Failed to extract memories:', err.message);
    return [];
  }
}

/**
 * Process end-of-conversation memory extraction and storage.
 * Call this after every Atlas conversation completes.
 */
export async function processConversationMemories(
  organizationId: number,
  messages: Array<{ role: string; content: string }>,
  openaiClient: any,
  agentType: string = 'atlas'
): Promise<number> {
  try {
    const extracted = await extractMemoriesFromConversation(messages, openaiClient);

    for (const memory of extracted) {
      await storeMemory(organizationId, {
        agentType,
        memoryType: memory.type,
        key: memory.key,
        value: memory.value,
        confidence: memory.confidence,
      });
    }

    console.log(`[AtlasMemory] Stored ${extracted.length} memories for org ${organizationId}`);
    return extracted.length;
  } catch (err: any) {
    console.error('[AtlasMemory] processConversationMemories failed:', err.message);
    return 0;
  }
}

/**
 * Manually add a memory (e.g., from user settings or explicit "Remember that..." command).
 */
export async function manuallyAddMemory(
  organizationId: number,
  type: MemoryType,
  key: string,
  summary: string,
  agentType: string = 'atlas'
): Promise<void> {
  await storeMemory(organizationId, {
    agentType,
    memoryType: type,
    key,
    value: { summary, addedAt: new Date().toISOString(), manual: true },
    confidence: 0.95, // High confidence for manual entries
  });
}

/**
 * Delete a specific memory by key.
 */
export async function deleteMemory(
  organizationId: number,
  key: string,
  agentType: string = 'atlas'
): Promise<boolean> {
  const result = await db
    .delete(agentMemory)
    .where(
      and(
        eq(agentMemory.organizationId, organizationId),
        eq(agentMemory.agentType, agentType),
        eq(agentMemory.key, key)
      )
    )
    .returning({ id: agentMemory.id });

  return result.length > 0;
}

/**
 * Get all memories for management/display.
 */
export async function getAllMemories(
  organizationId: number,
  agentType: string = 'atlas'
): Promise<Array<{ id: number; type: string; key: string; value: Record<string, any>; confidence: number; usageCount: number; createdAt: Date | null }>> {
  const memories = await db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.organizationId, organizationId),
        eq(agentMemory.agentType, agentType)
      )
    )
    .orderBy(desc(agentMemory.createdAt));

  return memories.map(m => ({
    id: m.id,
    type: m.memoryType,
    key: m.key,
    value: m.value as Record<string, any>,
    confidence: parseFloat(m.confidence ?? '0.5'),
    usageCount: m.usageCount || 0,
    createdAt: m.createdAt,
  }));
}
