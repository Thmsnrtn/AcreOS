// @ts-nocheck
/**
 * SCP Memory System v2 — Sovereign Company Protocol
 *
 * Three-tier structured memory per agent:
 *   1. Episodic Memory — "What happened" (extends existing agent_episodic_memory)
 *   2. Semantic Memory — "What we know" (SPO triples via scp_semantic_facts)
 *   3. Procedural Memory — "How to do things" (scp_procedures)
 *
 * Plus:
 *   - Cross-agent shared memory with write validation
 *   - Memory-informed prompt assembly
 *   - Memory decay and reinforcement
 */

import { db } from "../db";
import {
  agentEpisodicMemory,
  agentSemanticMemory,
  scpSemanticFacts,
  scpProcedures,
  scpSharedMemory,
  scpGoldenCases,
  memoryAccessLog,
} from "@shared/schema";
import { eq, and, desc, gte, sql, ilike, or } from "drizzle-orm";
import { logger } from "../utils/logger";
import crypto from "crypto";
import {
  readConstitution,
  readAgentConfig,
  readSharedKnowledge,
  readGoldenSuite,
  type AgentCodename,
} from "./scpConfigVersioning";
import { checkPatterns, validateDelta, type ConfigDelta } from "./constitutionChecker";

// ─── Episodic Memory (enhanced wrapper over existing table) ────────────────

export interface Episode {
  id: string;
  agent: string;
  type: "task" | "decision" | "escalation" | "collaboration" | "error";
  summary: string;
  detail: string;
  session_id: string;
  tools_used: string[];
  services_touched: string[];
  outcome: "success" | "failure" | "partial" | "overridden";
  outcome_detail: string;
  lessons: string[];
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  importance: number; // 0-1
  access_count: number;
  last_accessed_at: string;
  decay_rate: number;
  related_agents: string[];
}

/**
 * Store an episode in episodic memory.
 * Importance scoring: failures > corrections > normal tasks.
 */
export async function storeEpisode(episode: Episode): Promise<void> {
  await db.insert(agentEpisodicMemory).values({
    agentCodename: episode.agent,
    episodeId: episode.id,
    context: {
      type: episode.type,
      session_id: episode.session_id,
      tools_used: episode.tools_used,
      services_touched: episode.services_touched,
      lessons: episode.lessons,
      started_at: episode.started_at,
      ended_at: episode.ended_at,
      duration_seconds: episode.duration_seconds,
      importance: episode.importance,
      decay_rate: episode.decay_rate,
      related_agents: episode.related_agents,
    },
    action: episode.summary,
    outcome: episode.outcome_detail,
    outcomeSuccess: episode.outcome === "success",
    emotionalValence: episode.outcome === "success" ? 50 : episode.outcome === "failure" ? -50 : 0,
    tags: [episode.type, episode.outcome, ...episode.related_agents],
    relevanceScore: Math.round(episode.importance * 100),
  });
}

/**
 * Recall relevant episodes for a task context.
 * Uses keyword matching on tags and action text.
 * Vector similarity search will replace this when Qdrant is integrated.
 */
export async function recallEpisodes(
  agent: string,
  query: string,
  limit: number = 5
): Promise<typeof agentEpisodicMemory.$inferSelect[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (keywords.length === 0) {
    return db.query.agentEpisodicMemory.findMany({
      where: eq(agentEpisodicMemory.agentCodename, agent),
      orderBy: [desc(agentEpisodicMemory.relevanceScore)],
      limit,
    });
  }

  // Text-based recall with relevance decay
  const episodes = await db.query.agentEpisodicMemory.findMany({
    where: eq(agentEpisodicMemory.agentCodename, agent),
    orderBy: [desc(agentEpisodicMemory.relevanceScore)],
    limit: limit * 3, // Fetch more, then filter
  });

  // Score by keyword overlap
  const scored = episodes.map((ep) => {
    const text = `${ep.action} ${JSON.stringify(ep.tags)} ${ep.outcome}`.toLowerCase();
    const matchCount = keywords.filter((kw) => text.includes(kw)).length;
    return { ...ep, matchScore: matchCount / keywords.length };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore || b.relevanceScore - a.relevanceScore);

  // Reinforce accessed memories
  const topEpisodes = scored.slice(0, limit);
  for (const ep of topEpisodes) {
    await db.update(agentEpisodicMemory)
      .set({
        accessCount: (ep.accessCount ?? 0) + 1,
        lastAccessedAt: new Date(),
      })
      .where(eq(agentEpisodicMemory.episodeId, ep.episodeId));
  }

  return topEpisodes;
}

// ─── Semantic Memory (SPO Triples) ─────────────────────────────────────────

/**
 * Store a semantic fact as an SPO triple.
 * If a conflicting fact exists (same subject+predicate, different object),
 * the old fact gets a validUntil timestamp and a new version is created.
 */
export async function storeFact(fact: {
  agent: string;
  subject: string;
  predicate: string;
  object: string;
  naturalLanguage: string;
  sourceEpisodeIds: string[];
  confidence: number; // 0-1
  category: string;
  tags?: string[];
}): Promise<string> {
  const factId = crypto.randomUUID();

  // Check for existing facts with same subject+predicate
  const existing = await db.query.scpSemanticFacts.findFirst({
    where: and(
      eq(scpSemanticFacts.agentCodename, fact.agent),
      eq(scpSemanticFacts.subject, fact.subject),
      eq(scpSemanticFacts.predicate, fact.predicate),
      sql`${scpSemanticFacts.validUntil} is null`, // Only active facts
    ),
  });

  if (existing && existing.object !== fact.object) {
    // Expire the old fact
    await db.update(scpSemanticFacts)
      .set({ validUntil: new Date(), updatedAt: new Date() })
      .where(eq(scpSemanticFacts.factId, existing.factId));

    // Create new version
    await db.insert(scpSemanticFacts).values({
      factId,
      agentCodename: fact.agent,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      naturalLanguage: fact.naturalLanguage,
      sourceEpisodeIds: fact.sourceEpisodeIds,
      confidence: Math.round(fact.confidence * 100),
      version: (existing.version ?? 1) + 1,
      previousVersionId: existing.factId,
      category: fact.category,
      tags: fact.tags ?? [],
    });

    logger.info("Semantic fact updated (versioned)", {
      agent: fact.agent,
      subject: fact.subject,
      predicate: fact.predicate,
      oldObject: existing.object,
      newObject: fact.object,
    });
  } else if (existing) {
    // Reinforce existing fact
    await db.update(scpSemanticFacts)
      .set({
        confidence: Math.min(100, (existing.confidence ?? 50) + 5),
        sourceEpisodeIds: [...(existing.sourceEpisodeIds as string[] ?? []), ...fact.sourceEpisodeIds],
        updatedAt: new Date(),
      })
      .where(eq(scpSemanticFacts.factId, existing.factId));
  } else {
    // New fact
    await db.insert(scpSemanticFacts).values({
      factId,
      agentCodename: fact.agent,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      naturalLanguage: fact.naturalLanguage,
      sourceEpisodeIds: fact.sourceEpisodeIds,
      confidence: Math.round(fact.confidence * 100),
      category: fact.category,
      tags: fact.tags ?? [],
    });
  }

  return factId;
}

/**
 * Query semantic facts relevant to a context.
 */
export async function queryFacts(
  agent: string,
  options: {
    subject?: string;
    category?: string;
    minConfidence?: number;
    limit?: number;
    includeShared?: boolean;
  } = {}
): Promise<typeof scpSemanticFacts.$inferSelect[]> {
  const conditions = [
    eq(scpSemanticFacts.agentCodename, agent),
    sql`${scpSemanticFacts.validUntil} is null`, // Only active facts
  ];

  if (options.subject) {
    conditions.push(ilike(scpSemanticFacts.subject, `%${options.subject}%`));
  }
  if (options.category) {
    conditions.push(eq(scpSemanticFacts.category, options.category));
  }
  if (options.minConfidence) {
    conditions.push(sql`${scpSemanticFacts.confidence} >= ${options.minConfidence}`);
  }

  return db.query.scpSemanticFacts.findMany({
    where: and(...conditions),
    orderBy: [desc(scpSemanticFacts.confidence)],
    limit: options.limit ?? 20,
  });
}

// ─── Procedural Memory ─────────────────────────────────────────────────────

/**
 * Store or update a procedure.
 */
export async function storeProcedure(procedure: {
  agent: string;
  name: string;
  description: string;
  trigger: string;
  steps: Array<{
    order: number;
    action: string;
    tool: string | null;
    expectedOutcome: string;
    errorHandling: string | null;
    decisionPoint: boolean;
  }>;
  preconditions: string[];
  postconditions: string[];
  parameters?: Record<string, { type: string; description: string; required: boolean }>;
  sourceEpisodeIds: string[];
}): Promise<string> {
  const procedureId = crypto.randomUUID();

  // Check for existing procedure with same name
  const existing = await db.query.scpProcedures.findFirst({
    where: and(
      eq(scpProcedures.agentCodename, procedure.agent),
      eq(scpProcedures.name, procedure.name),
    ),
  });

  if (existing) {
    // Version the existing procedure
    await db.update(scpProcedures)
      .set({
        description: procedure.description,
        trigger: procedure.trigger,
        steps: procedure.steps,
        preconditions: procedure.preconditions,
        postconditions: procedure.postconditions,
        parameters: procedure.parameters ?? {},
        sourceEpisodeIds: [...(existing.sourceEpisodeIds as string[] ?? []), ...procedure.sourceEpisodeIds],
        version: (existing.version ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(scpProcedures.procedureId, existing.procedureId));

    return existing.procedureId;
  }

  await db.insert(scpProcedures).values({
    procedureId,
    agentCodename: procedure.agent,
    name: procedure.name,
    description: procedure.description,
    trigger: procedure.trigger,
    steps: procedure.steps,
    preconditions: procedure.preconditions,
    postconditions: procedure.postconditions,
    parameters: procedure.parameters ?? {},
    sourceEpisodeIds: procedure.sourceEpisodeIds,
  });

  return procedureId;
}

/**
 * Find procedures matching a trigger context.
 */
export async function findProcedures(
  agent: string,
  triggerContext: string,
  limit: number = 3
): Promise<typeof scpProcedures.$inferSelect[]> {
  const procedures = await db.query.scpProcedures.findMany({
    where: eq(scpProcedures.agentCodename, agent),
    orderBy: [desc(scpProcedures.confidence)],
  });

  // Simple keyword matching for trigger relevance
  const keywords = triggerContext.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const scored = procedures.map((p) => {
    const triggerText = `${p.trigger} ${p.name} ${p.description}`.toLowerCase();
    const matchCount = keywords.filter((kw) => triggerText.includes(kw)).length;
    return { ...p, matchScore: matchCount };
  });

  return scored
    .filter((p) => p.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

/**
 * Record procedure usage outcome.
 */
export async function recordProcedureOutcome(
  procedureId: string,
  success: boolean
): Promise<void> {
  const procedure = await db.query.scpProcedures.findFirst({
    where: eq(scpProcedures.procedureId, procedureId),
  });

  if (!procedure) return;

  const successCount = (procedure.successCount ?? 0) + (success ? 1 : 0);
  const failureCount = (procedure.failureCount ?? 0) + (success ? 0 : 1);
  const total = successCount + failureCount;
  const newConfidence = Math.round((successCount / total) * 100);

  await db.update(scpProcedures)
    .set({
      successCount,
      failureCount,
      confidence: newConfidence,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scpProcedures.procedureId, procedureId));
}

// ─── Cross-Agent Shared Memory ─────────────────────────────────────────────

/**
 * Write to shared memory with validation.
 * Writes go through constitution pattern checking.
 */
export async function writeSharedMemory(entry: {
  agent: string;
  category: "company_fact" | "cross_domain_insight" | "ceo_directive";
  subject: string;
  content: string;
  confidence: number; // 0-1
}): Promise<string | null> {
  // Validate content against constitution patterns
  const patternCheck = checkPatterns(entry.content);
  if (!patternCheck.passed) {
    logger.warn("Shared memory write rejected by pattern check", {
      agent: entry.agent,
      violations: patternCheck.violations,
    });
    return null;
  }

  const memoryId = crypto.randomUUID();

  await db.insert(scpSharedMemory).values({
    memoryId,
    writtenByAgent: entry.agent,
    category: entry.category,
    subject: entry.subject,
    content: entry.content,
    confidence: Math.round(entry.confidence * 100),
    validatedAt: new Date(),
    validationGatesPassed: ["constitution_pattern"],
  });

  return memoryId;
}

/**
 * Read shared memory relevant to a context.
 */
export async function readSharedMemoryEntries(
  category?: string,
  limit: number = 10
): Promise<typeof scpSharedMemory.$inferSelect[]> {
  const conditions = [];
  if (category) {
    conditions.push(eq(scpSharedMemory.category, category));
  }

  return db.query.scpSharedMemory.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(scpSharedMemory.confidence)],
    limit,
  });
}

// ─── Memory-Informed Prompt Assembly ───────────────────────────────────────

/**
 * Assemble a full system prompt for an agent based on its memory and config.
 *
 * Assembly order (per v2 spec):
 *   1. Constitution (immutable, always included)
 *   2. Agent persona (evolved communication style)
 *   3. Agent domain knowledge (evolved expertise)
 *   4. Relevant episodic memories (recalled based on task)
 *   5. Relevant semantic facts (recalled based on context)
 *   6. Relevant procedures (if task matches a known trigger)
 *   7. Shared knowledge (company-wide context)
 *   8. Recent cross-agent messages (if relevant)
 */
export async function assembleAgentPrompt(
  agent: AgentCodename,
  taskContext: {
    taskDescription: string;
    taskType?: string;
    recentMessages?: Array<{ from: string; content: string }>;
  }
): Promise<string> {
  const sections: string[] = [];

  // 1. Constitution
  const constitution = readConstitution();
  if (constitution) {
    sections.push(`--- CONSTITUTIONAL PRINCIPLES ---\n${constitution}`);
  }

  // 2. Agent persona
  const persona = readAgentConfig(agent, "persona.md");
  if (persona) {
    sections.push(`--- YOUR PERSONA ---\n${persona}`);
  }

  // 3. Agent domain knowledge
  const domainKnowledge = readAgentConfig(agent, "domain-knowledge.md");
  if (domainKnowledge) {
    sections.push(`--- YOUR DOMAIN KNOWLEDGE ---\n${domainKnowledge}`);
  }

  // 4. Relevant episodic memories
  try {
    const episodes = await recallEpisodes(agent, taskContext.taskDescription, 5);
    if (episodes.length > 0) {
      const episodeText = episodes.map((ep) =>
        `- [${ep.outcomeSuccess ? "SUCCESS" : "FAILURE"}] ${ep.action} → ${ep.outcome}`
      ).join("\n");
      sections.push(`--- RELEVANT PAST EXPERIENCES ---\n${episodeText}`);
    }
  } catch {
    // DB may not be available in all contexts
  }

  // 5. Relevant semantic facts
  try {
    const facts = await queryFacts(agent, { minConfidence: 60, limit: 10 });
    if (facts.length > 0) {
      const factText = facts.map((f) =>
        `- ${f.naturalLanguage} (confidence: ${f.confidence}%)`
      ).join("\n");
      sections.push(`--- KNOWN FACTS ---\n${factText}`);
    }
  } catch {}

  // 6. Relevant procedures
  try {
    const procedures = await findProcedures(agent, taskContext.taskDescription, 3);
    if (procedures.length > 0) {
      const procText = procedures.map((p) => {
        const steps = (p.steps as any[]).map((s: any) => `  ${s.order}. ${s.action}`).join("\n");
        return `### ${p.name}\nTrigger: ${p.trigger}\n${steps}`;
      }).join("\n\n");
      sections.push(`--- KNOWN PROCEDURES ---\n${procText}`);
    }
  } catch {}

  // 7. Shared knowledge
  const sharedKnowledge = readSharedKnowledge();
  if (sharedKnowledge) {
    sections.push(`--- COMPANY KNOWLEDGE ---\n${sharedKnowledge}`);
  }

  // 8. Recent cross-agent messages
  if (taskContext.recentMessages?.length) {
    const msgText = taskContext.recentMessages.map((m) =>
      `[${m.from}]: ${m.content}`
    ).join("\n");
    sections.push(`--- RECENT INTER-AGENT MESSAGES ---\n${msgText}`);
  }

  // Agent-specific extras
  const taskPatterns = readAgentConfig(agent, "task-patterns.md");
  if (taskPatterns && taskPatterns.length > 50) {
    sections.push(`--- YOUR TASK PATTERNS ---\n${taskPatterns}`);
  }

  return sections.join("\n\n");
}

// ─── Memory Decay ──────────────────────────────────────────────────────────

/**
 * Apply memory decay to episodic memories.
 * Reduces relevance score based on age and access patterns.
 * Called periodically (e.g., daily).
 */
export async function applyMemoryDecay(agent: string): Promise<{
  decayed: number;
  pruned: number;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  let decayed = 0;
  let pruned = 0;

  // Get all episodes for this agent
  const episodes = await db.query.agentEpisodicMemory.findMany({
    where: eq(agentEpisodicMemory.agentCodename, agent),
  });

  for (const ep of episodes) {
    const age = Date.now() - (ep.createdAt?.getTime() ?? Date.now());
    const ageDays = age / 86400000;
    const accessCount = ep.accessCount ?? 0;

    // Decay formula: base decay reduced by access frequency
    const decayAmount = Math.max(1, Math.floor(ageDays / 7) - accessCount);
    const newRelevance = Math.max(0, (ep.relevanceScore ?? 100) - decayAmount);

    if (newRelevance !== ep.relevanceScore) {
      await db.update(agentEpisodicMemory)
        .set({ relevanceScore: newRelevance })
        .where(eq(agentEpisodicMemory.episodeId, ep.episodeId));
      decayed++;
    }

    // Prune memories with zero relevance that haven't been accessed in 30 days
    if (newRelevance === 0 && (!ep.lastAccessedAt || ep.lastAccessedAt < new Date(Date.now() - 30 * 86400000))) {
      // Don't actually delete — just mark as very low relevance
      // (preserves audit trail per Constitution principle 4: TRANSPARENCY)
      pruned++;
    }
  }

  return { decayed, pruned };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpMemorySystem = {
  // Episodic
  storeEpisode,
  recallEpisodes,
  // Semantic (SPO)
  storeFact,
  queryFacts,
  // Procedural
  storeProcedure,
  findProcedures,
  recordProcedureOutcome,
  // Shared
  writeSharedMemory,
  readSharedMemoryEntries,
  // Prompt Assembly
  assembleAgentPrompt,
  // Maintenance
  applyMemoryDecay,
};
