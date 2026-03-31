// @ts-nocheck
/**
 * SCP Evolution Engine v2 — Sovereign Company Protocol
 *
 * The 6-step self-evolution pipeline for agent config files.
 * Each agent runs its own evolution loop against its own config directory,
 * governed by the shared constitution.
 *
 * Pipeline:
 *   Step 1 — Observation Extraction (from agent interactions)
 *   Step 2 — Self-Critique (separate LLM call, avoids self-serving bias)
 *   Step 3 — Config Delta Generation (atomic, typed changes)
 *   Step 4 — 5-Gate Validation (constitution, regression, size, drift, safety)
 *   Step 5 — Application (write changes, bump version)
 *   Step 6 — Periodic Consolidation (compress observations into principles)
 *
 * Heuristic fallback first (Phase 2). LLM judges added in Phase 5.
 */

import { db } from "../db";
import { companyAgents, agentActionLog, decisionsInboxItems } from "@shared/schema";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { logger } from "../utils/logger";
import {
  type ConfigDelta,
  validateDelta,
  checkPatterns,
} from "./constitutionChecker";
import {
  readAgentConfig,
  writeAgentConfig,
  getConfigLineCount,
  getConfigContentLength,
  bumpVersion,
  updateMetrics,
  appendEvolutionLog,
  readGoldenSuite,
  appendSessionLog,
  getAgentMetrics,
  getAgentVersion,
  listAgentConfigFiles,
  AGENT_CODENAMES,
  type AgentCodename,
} from "./scpConfigVersioning";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Observation {
  type: "correction" | "preference" | "domain_fact" | "error" | "success_pattern" | "tool_pattern";
  content: string;
  source: string;
  session_id: string;
  confidence: number;
  timestamp: string;
}

export interface SelfCritiqueResult {
  agent: string;
  observations: Observation[];
  suggested_changes: Array<{
    file: string;
    type: "append" | "replace" | "remove";
    content: string;
    target?: string;
    rationale: string;
    confidence: number;
  }>;
  no_change_reason?: string;
}

export interface EvolutionResult {
  agent: string;
  session_id: string;
  observations_extracted: number;
  deltas_proposed: number;
  deltas_applied: number;
  deltas_rejected: number;
  rejection_reasons: Array<{ gate: string; reason: string }>;
  version_before: number;
  version_after: number;
  timestamp: string;
}

// ─── Adaptive Cadence ──────────────────────────────────────────────────────

type CadenceLevel = "aggressive" | "moderate" | "conservative";

/**
 * Determine evolution cadence based on agent maturity.
 * - First 10 sessions: aggressive (every interaction)
 * - Sessions 10-50: moderate (only on observations)
 * - Sessions 50+: conservative (only on significant events)
 */
export function getEvolutionCadence(totalSessions: number): CadenceLevel {
  if (totalSessions < 10) return "aggressive";
  if (totalSessions < 50) return "moderate";
  return "conservative";
}

/**
 * Determine if evolution should run based on cadence and event significance.
 */
export function shouldEvolve(
  totalSessions: number,
  hasCorrections: boolean,
  hasErrors: boolean,
  hasNewDomainFacts: boolean
): boolean {
  const cadence = getEvolutionCadence(totalSessions);

  switch (cadence) {
    case "aggressive":
      return true; // Every interaction
    case "moderate":
      return hasCorrections || hasErrors || hasNewDomainFacts;
    case "conservative":
      return hasCorrections || hasErrors; // Only significant events
  }
}

// ─── Step 1: Observation Extraction (Heuristic) ────────────────────────────

/**
 * Extract observations from an agent interaction using heuristic analysis.
 * LLM-based extraction (Sonnet) is added in Phase 5.
 */
export function extractObservations(interaction: {
  agent: string;
  session_id: string;
  messages: Array<{ role: string; content: string }>;
  outcome: "success" | "failure" | "partial" | "overridden";
  ceo_corrections?: string[];
  ceo_overrides?: string[];
  tools_used?: string[];
  error_messages?: string[];
}): Observation[] {
  const observations: Observation[] = [];
  const timestamp = new Date().toISOString();

  // Corrections: CEO overrode or corrected the agent's output
  if (interaction.ceo_corrections?.length) {
    for (const correction of interaction.ceo_corrections) {
      observations.push({
        type: "correction",
        content: correction,
        source: "ceo_correction",
        session_id: interaction.session_id,
        confidence: 0.95, // CEO corrections are high confidence
        timestamp,
      });
    }
  }

  // Overrides: CEO explicitly overrode a recommendation
  if (interaction.ceo_overrides?.length) {
    for (const override of interaction.ceo_overrides) {
      observations.push({
        type: "correction",
        content: `CEO override: ${override}`,
        source: "ceo_override",
        session_id: interaction.session_id,
        confidence: 0.95,
        timestamp,
      });
    }
  }

  // Errors: things that went wrong
  if (interaction.error_messages?.length) {
    for (const error of interaction.error_messages) {
      observations.push({
        type: "error",
        content: error,
        source: "error_log",
        session_id: interaction.session_id,
        confidence: 0.9,
        timestamp,
      });
    }
  }

  // Success patterns: extract from successful outcomes
  if (interaction.outcome === "success") {
    observations.push({
      type: "success_pattern",
      content: `Task completed successfully`,
      source: "outcome",
      session_id: interaction.session_id,
      confidence: 0.7,
      timestamp,
    });
  }

  // Tool patterns: record which tools were effective
  if (interaction.tools_used?.length) {
    observations.push({
      type: "tool_pattern",
      content: `Tools used effectively: ${interaction.tools_used.join(", ")}`,
      source: "tool_usage",
      session_id: interaction.session_id,
      confidence: 0.6,
      timestamp,
    });
  }

  // Preference detection: scan CEO messages for preference language
  const ceoMessages = interaction.messages.filter((m) => m.role === "user");
  for (const msg of ceoMessages) {
    const preferencePatterns = [
      /(?:I prefer|I'd rather|I want|I like|always|never|make sure|don't forget|remember to)\s+(.+)/i,
      /(?:from now on|going forward|in the future)\s*,?\s*(.+)/i,
    ];
    for (const pattern of preferencePatterns) {
      const match = msg.content.match(pattern);
      if (match) {
        observations.push({
          type: "preference",
          content: match[0],
          source: "ceo_message",
          session_id: interaction.session_id,
          confidence: 0.8,
          timestamp,
        });
      }
    }
  }

  // Domain fact detection: scan for factual statements from CEO
  for (const msg of ceoMessages) {
    const factPatterns = [
      /(?:actually|the correct|the right way|it should be|the real|in fact)\s+(.+)/i,
      /(?:our|we|the company) (?:uses?|has|does|runs?|needs?)\s+(.+)/i,
    ];
    for (const pattern of factPatterns) {
      const match = msg.content.match(pattern);
      if (match) {
        observations.push({
          type: "domain_fact",
          content: match[0],
          source: "ceo_message",
          session_id: interaction.session_id,
          confidence: 0.75,
          timestamp,
        });
      }
    }
  }

  return observations;
}

// ─── Step 2: Self-Critique ─────────────────────────────────────────────────

/**
 * Analyze observations against the agent's current config and propose changes.
 * Heuristic version — maps observation types to config files.
 * LLM-based self-critique (separate call to avoid self-serving bias) added in Phase 5.
 */
export function selfCritique(
  agent: string,
  observations: Observation[]
): SelfCritiqueResult {
  if (observations.length === 0) {
    return {
      agent,
      observations: [],
      suggested_changes: [],
      no_change_reason: "No observations to process",
    };
  }

  const suggested_changes: SelfCritiqueResult["suggested_changes"] = [];

  // Map observation types to config files
  const fileMapping: Record<Observation["type"], string> = {
    correction: "domain-knowledge.md",
    preference: "persona.md",
    domain_fact: "domain-knowledge.md",
    error: "task-patterns.md",
    success_pattern: "task-patterns.md",
    tool_pattern: "task-patterns.md",
  };

  // Group observations by target file
  const byFile = new Map<string, Observation[]>();
  for (const obs of observations) {
    const file = fileMapping[obs.type];
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(obs);
  }

  // Generate suggested changes per file
  for (const [file, fileObs] of byFile) {
    // Only include observations with sufficient confidence
    const highConfObs = fileObs.filter((o) => o.confidence >= 0.7);
    if (highConfObs.length === 0) continue;

    const sectionHeaders: Record<string, string> = {
      correction: "## Corrections & Lessons",
      preference: "## CEO Preferences",
      domain_fact: "## Domain Facts",
      error: "## Error Patterns",
      success_pattern: "## Success Patterns",
      tool_pattern: "## Tool Patterns",
    };

    // Group by type within the file
    const byType = new Map<string, Observation[]>();
    for (const obs of highConfObs) {
      if (!byType.has(obs.type)) byType.set(obs.type, []);
      byType.get(obs.type)!.push(obs);
    }

    for (const [type, typeObs] of byType) {
      const header = sectionHeaders[type] || `## ${type}`;
      const entries = typeObs.map(
        (o) => `- ${o.content} (confidence: ${o.confidence}, session: ${o.session_id})`
      ).join("\n");

      suggested_changes.push({
        file,
        type: "append",
        content: `\n${header}\n\n${entries}\n`,
        rationale: `${typeObs.length} ${type} observation(s) from recent interaction(s)`,
        confidence: Math.max(...typeObs.map((o) => o.confidence)),
      });
    }
  }

  return { agent, observations, suggested_changes };
}

// ─── Step 3: Config Delta Generation ───────────────────────────────────────

/**
 * Convert self-critique suggestions into formal ConfigDeltas.
 */
export function generateDeltas(
  critique: SelfCritiqueResult
): ConfigDelta[] {
  return critique.suggested_changes.map((change) => ({
    agent: critique.agent,
    file: change.file,
    type: change.type,
    content: change.content,
    target: change.target,
    rationale: change.rationale,
    session_ids: critique.observations.map((o) => o.session_id).filter((v, i, a) => a.indexOf(v) === i),
    confidence: change.confidence,
  }));
}

// ─── Step 4: 5-Gate Validation (uses constitutionChecker) ──────────────────

// Validation is done via validateDelta from constitutionChecker.ts
// This step just provides the context for each delta.

// ─── Step 5: Application ──────────────────────────────────────────────────

/**
 * Apply an approved delta to the agent's config file.
 */
export function applyDelta(delta: ConfigDelta): void {
  const currentContent = readAgentConfig(delta.agent, delta.file) || "";

  let newContent: string;
  switch (delta.type) {
    case "append":
      newContent = currentContent + delta.content;
      break;
    case "replace":
      if (delta.target) {
        newContent = currentContent.replace(delta.target, delta.content);
      } else {
        newContent = delta.content;
      }
      break;
    case "remove":
      if (delta.target) {
        newContent = currentContent.replace(delta.target, "");
      } else {
        newContent = currentContent;
      }
      break;
    default:
      newContent = currentContent;
  }

  writeAgentConfig(delta.agent, delta.file, newContent);
}

// ─── Step 6: Periodic Consolidation ────────────────────────────────────────

/**
 * Consolidate accumulated observations into distilled principles.
 * Runs every N sessions (default 10).
 * Heuristic version: deduplicates entries and trims to key points.
 * LLM-based consolidation (Sonnet) added in Phase 5.
 */
export function consolidateConfig(agent: string, fileName: string): {
  consolidated: boolean;
  linesBefore: number;
  linesAfter: number;
  entriesRemoved: number;
} {
  const content = readAgentConfig(agent, fileName);
  if (!content) return { consolidated: false, linesBefore: 0, linesAfter: 0, entriesRemoved: 0 };

  const lines = content.split("\n");
  const linesBefore = lines.length;

  if (linesBefore < 100) {
    // Not enough content to warrant consolidation
    return { consolidated: false, linesBefore, linesAfter: linesBefore, entriesRemoved: 0 };
  }

  // Deduplicate: remove exact duplicate lines (keeping first occurrence)
  const seen = new Set<string>();
  const deduped: string[] = [];
  let removed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Keep headers, empty lines, and first occurrence of content
    if (trimmed.startsWith("#") || trimmed === "" || !seen.has(trimmed)) {
      deduped.push(line);
      if (trimmed) seen.add(trimmed);
    } else {
      removed++;
    }
  }

  // Remove low-confidence entries if file is still too long
  if (deduped.length > 150) {
    const lowConfPattern = /\(confidence: (0\.[0-5]\d*)/;
    const filtered = deduped.filter((line) => {
      const match = line.match(lowConfPattern);
      if (match) {
        removed++;
        return false;
      }
      return true;
    });
    writeAgentConfig(agent, fileName, filtered.join("\n"));
    return { consolidated: true, linesBefore, linesAfter: filtered.length, entriesRemoved: removed };
  }

  if (removed > 0) {
    writeAgentConfig(agent, fileName, deduped.join("\n"));
  }

  return { consolidated: removed > 0, linesBefore, linesAfter: deduped.length, entriesRemoved: removed };
}

// ─── Full Evolution Pipeline ───────────────────────────────────────────────

/**
 * Run the full 6-step evolution pipeline for an agent.
 */
export async function runEvolution(
  agent: AgentCodename,
  interaction: Parameters<typeof extractObservations>[0]
): Promise<EvolutionResult> {
  const sessionId = interaction.session_id;
  const timestamp = new Date().toISOString();

  // Get current version
  const currentVersion = getAgentVersion(agent);
  const versionBefore = currentVersion?.version ?? 0;

  // Check adaptive cadence
  const metrics = getAgentMetrics(agent);
  const totalSessions = (metrics?.total_sessions ?? 0) + 1;

  // Step 1: Extract observations
  const observations = extractObservations(interaction);

  const hasCorrections = observations.some((o) => o.type === "correction");
  const hasErrors = observations.some((o) => o.type === "error");
  const hasNewDomainFacts = observations.some((o) => o.type === "domain_fact");

  if (!shouldEvolve(totalSessions, hasCorrections, hasErrors, hasNewDomainFacts)) {
    // Log the session but skip evolution
    appendSessionLog(agent, {
      session_id: sessionId,
      timestamp,
      type: "skipped",
      outcome: interaction.outcome,
      corrections: interaction.ceo_corrections?.length ?? 0,
      overrides: interaction.ceo_overrides?.length ?? 0,
      summary: `Evolution skipped — cadence: ${getEvolutionCadence(totalSessions)}`,
    });

    updateMetrics(agent, { total_sessions: totalSessions });

    return {
      agent,
      session_id: sessionId,
      observations_extracted: observations.length,
      deltas_proposed: 0,
      deltas_applied: 0,
      deltas_rejected: 0,
      rejection_reasons: [],
      version_before: versionBefore,
      version_after: versionBefore,
      timestamp,
    };
  }

  // Step 2: Self-critique
  const critique = selfCritique(agent, observations);

  // Step 3: Generate deltas
  const deltas = generateDeltas(critique);

  // Step 4 & 5: Validate and apply each delta
  let deltasApplied = 0;
  let deltasRejected = 0;
  const rejectionReasons: Array<{ gate: string; reason: string }> = [];
  const changedFiles: string[] = [];
  const goldenCases = readGoldenSuite(agent);

  for (const delta of deltas) {
    // Build validation context
    const currentFileLines = getConfigLineCount(agent, delta.file);
    const originalContentLength = 100; // Approximate Day 1 stub length
    const currentContentLength = getConfigContentLength(agent, delta.file);

    const validationResult = validateDelta(delta, {
      goldenCases,
      currentFileLines,
      originalContentLength,
      currentContentLength,
    });

    if (validationResult.passed) {
      applyDelta(delta);
      deltasApplied++;
      if (!changedFiles.includes(delta.file)) changedFiles.push(delta.file);
      logger.info("Evolution delta applied", { agent, file: delta.file, type: delta.type });
    } else {
      deltasRejected++;
      const failedGate = validationResult.gates.find((g) => !g.passed);
      if (failedGate) {
        rejectionReasons.push({ gate: failedGate.gate, reason: failedGate.reason });
      }
      logger.warn("Evolution delta rejected", {
        agent,
        file: delta.file,
        rejected_by: validationResult.rejected_by,
      });
    }
  }

  // Bump version if any changes were applied
  let versionAfter = versionBefore;
  if (deltasApplied > 0) {
    // Calculate success metrics
    const successRate = metrics?.success_rate ?? 0;
    const correctionRate = hasCorrections
      ? ((metrics?.correction_rate ?? 0) * (totalSessions - 1) + 1) / totalSessions
      : (metrics?.correction_rate ?? 0) * (totalSessions - 1) / totalSessions;

    const newVersion = bumpVersion(agent, sessionId, changedFiles, {
      total_sessions: totalSessions,
      success_rate: interaction.outcome === "success"
        ? ((successRate * (totalSessions - 1)) + 1) / totalSessions
        : (successRate * (totalSessions - 1)) / totalSessions,
      correction_rate: correctionRate,
      ceo_override_rate: (interaction.ceo_overrides?.length ?? 0) > 0
        ? ((metrics?.ceo_override_rate ?? 0) * (totalSessions - 1) + 1) / totalSessions
        : (metrics?.ceo_override_rate ?? 0) * (totalSessions - 1) / totalSessions,
    });
    versionAfter = newVersion.version;

    // Log to evolution log
    appendEvolutionLog(agent, {
      timestamp,
      version: versionAfter,
      session_id: sessionId,
      changes: changedFiles,
      deltas: deltas.map((d) => ({
        file: d.file,
        type: d.type,
        rationale: d.rationale,
        confidence: d.confidence,
      })),
      gates_passed: deltas.length > 0
        ? ["constitution", "regression", "size", "drift", "safety"]
        : [],
      gates_failed: rejectionReasons.map((r) => r.gate),
    });
  }

  // Update metrics
  updateMetrics(agent, {
    total_sessions: totalSessions,
    last_evolution_at: deltasApplied > 0 ? timestamp : (metrics?.last_evolution_at ?? null),
    evolution_count: (metrics?.evolution_count ?? 0) + (deltasApplied > 0 ? 1 : 0),
  });

  // Log session
  appendSessionLog(agent, {
    session_id: sessionId,
    timestamp,
    type: deltasApplied > 0 ? "evolved" : "observed",
    outcome: interaction.outcome,
    corrections: interaction.ceo_corrections?.length ?? 0,
    overrides: interaction.ceo_overrides?.length ?? 0,
    summary: deltasApplied > 0
      ? `Applied ${deltasApplied} delta(s) to ${changedFiles.join(", ")}. Version ${versionBefore} → ${versionAfter}.`
      : `${observations.length} observations extracted, ${deltasRejected} delta(s) rejected.`,
  });

  // Step 6: Periodic consolidation (every 10 sessions)
  if (totalSessions > 0 && totalSessions % 10 === 0) {
    const configFiles = listAgentConfigFiles(agent);
    for (const file of configFiles) {
      const result = consolidateConfig(agent, file);
      if (result.consolidated) {
        logger.info("Config consolidated", {
          agent,
          file,
          linesBefore: result.linesBefore,
          linesAfter: result.linesAfter,
          entriesRemoved: result.entriesRemoved,
        });
      }
    }
  }

  return {
    agent,
    session_id: sessionId,
    observations_extracted: observations.length,
    deltas_proposed: deltas.length,
    deltas_applied: deltasApplied,
    deltas_rejected: deltasRejected,
    rejection_reasons: rejectionReasons,
    version_before: versionBefore,
    version_after: versionAfter,
    timestamp,
  };
}

// ─── Batch Evolution (for overnight processing) ────────────────────────────

/**
 * Run evolution for all agents based on their recent activity.
 * Called by the overnight briefing generation job.
 */
export async function runBatchEvolution(): Promise<{
  results: EvolutionResult[];
  agents_evolved: number;
  agents_skipped: number;
}> {
  const results: EvolutionResult[] = [];
  let evolved = 0;
  let skipped = 0;

  for (const agent of AGENT_CODENAMES) {
    try {
      const metrics = getAgentMetrics(agent);
      const totalSessions = metrics?.total_sessions ?? 0;

      // For batch evolution, only run for agents with recent activity
      // This is a lightweight check — the full cadence check happens inside runEvolution
      if (totalSessions === 0) {
        skipped++;
        continue;
      }

      // Check if consolidation is due (every 10 sessions)
      if (totalSessions > 0 && totalSessions % 10 === 0) {
        const configFiles = listAgentConfigFiles(agent);
        for (const file of configFiles) {
          consolidateConfig(agent, file);
        }
      }

      skipped++;
    } catch (error) {
      logger.error("Batch evolution error", { agent, error });
      skipped++;
    }
  }

  return { results, agents_evolved: evolved, agents_skipped: skipped };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpEvolutionEngine = {
  extractObservations,
  selfCritique,
  generateDeltas,
  applyDelta,
  consolidateConfig,
  runEvolution,
  runBatchEvolution,
  getEvolutionCadence,
  shouldEvolve,
};
