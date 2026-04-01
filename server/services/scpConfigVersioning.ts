/**
 * SCP Config Versioning — Sovereign Company Protocol v2
 *
 * Manages per-agent config file versioning. Each agent's config directory
 * has a meta/version.json tracking version history and metrics snapshots.
 *
 * Provides read/write for agent config files, version bumping, and
 * evolution log appending.
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

const SOVEREIGN_PROTOCOL_DIR = path.resolve(__dirname, "../../sovereign-protocol");
const AGENTS_DIR = path.join(SOVEREIGN_PROTOCOL_DIR, "agents");

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AgentVersion {
  agent: string;
  version: number;
  parent: number | null;
  timestamp: string;
  session_id: string | null;
  changes: string[];
  metrics_snapshot: {
    total_sessions: number;
    success_rate: number;
    correction_rate: number;
    ceo_override_rate: number;
  };
}

export interface AgentMetrics {
  agent: string;
  total_sessions: number;
  success_rate: number;
  correction_rate: number;
  ceo_override_rate: number;
  escalation_accuracy: number;
  golden_suite_size: number;
  last_evolution_at: string | null;
  evolution_count: number;
}

export interface EvolutionLogEntry {
  timestamp: string;
  version: number;
  session_id: string;
  changes: string[];
  deltas: Array<{
    file: string;
    type: "append" | "replace" | "remove";
    rationale: string;
    confidence: number;
  }>;
  gates_passed: string[];
  gates_failed: string[];
}

// ─── Agent Config Names ────────────────────────────────────────────────────

export const AGENT_CODENAMES = [
  "atlas", "compass", "prism", "beacon", "scribe", "forge",
  "harbor", "sentinel", "ledger", "shield", "oracle", "crucible",
] as const;

export type AgentCodename = typeof AGENT_CODENAMES[number];

// ─── File Operations ───────────────────────────────────────────────────────

function agentDir(agent: string): string {
  return path.join(AGENTS_DIR, agent);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Read an agent's current version metadata.
 */
export function getAgentVersion(agent: string): AgentVersion | null {
  return readJsonFile<AgentVersion>(path.join(agentDir(agent), "meta", "version.json"));
}

/**
 * Read an agent's current metrics.
 */
export function getAgentMetrics(agent: string): AgentMetrics | null {
  return readJsonFile<AgentMetrics>(path.join(agentDir(agent), "meta", "metrics.json"));
}

/**
 * Read an agent config file (e.g. "domain-knowledge.md").
 */
export function readAgentConfig(agent: string, fileName: string): string | null {
  try {
    return fs.readFileSync(path.join(agentDir(agent), fileName), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write an agent config file.
 */
export function writeAgentConfig(agent: string, fileName: string, content: string): void {
  fs.writeFileSync(path.join(agentDir(agent), fileName), content, "utf-8");
}

/**
 * Get the line count of an agent config file.
 */
export function getConfigLineCount(agent: string, fileName: string): number {
  const content = readAgentConfig(agent, fileName);
  return content ? content.split("\n").length : 0;
}

/**
 * Get the character count of an agent config file.
 */
export function getConfigContentLength(agent: string, fileName: string): number {
  const content = readAgentConfig(agent, fileName);
  return content ? content.length : 0;
}

/**
 * Bump an agent's version after a successful evolution.
 */
export function bumpVersion(
  agent: string,
  sessionId: string,
  changedFiles: string[],
  metricsSnapshot: AgentVersion["metrics_snapshot"]
): AgentVersion {
  const current = getAgentVersion(agent);
  const newVersion: AgentVersion = {
    agent,
    version: (current?.version ?? 0) + 1,
    parent: current?.version ?? null,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    changes: changedFiles,
    metrics_snapshot: metricsSnapshot,
  };

  writeJsonFile(path.join(agentDir(agent), "meta", "version.json"), newVersion);
  return newVersion;
}

/**
 * Update an agent's metrics.
 */
export function updateMetrics(agent: string, updates: Partial<AgentMetrics>): AgentMetrics {
  const current = getAgentMetrics(agent) || {
    agent,
    total_sessions: 0,
    success_rate: 0,
    correction_rate: 0,
    ceo_override_rate: 0,
    escalation_accuracy: 0,
    golden_suite_size: 0,
    last_evolution_at: null,
    evolution_count: 0,
  };

  const updated = { ...current, ...updates };
  writeJsonFile(path.join(agentDir(agent), "meta", "metrics.json"), updated);
  return updated;
}

/**
 * Append to an agent's evolution log.
 */
export function appendEvolutionLog(agent: string, entry: EvolutionLogEntry): void {
  const logPath = path.join(agentDir(agent), "meta", "evolution-log.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Read an agent's evolution log.
 */
export function readEvolutionLog(agent: string): EvolutionLogEntry[] {
  try {
    const content = fs.readFileSync(path.join(agentDir(agent), "meta", "evolution-log.jsonl"), "utf-8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Append a golden case to an agent's golden suite.
 */
export function appendGoldenCase(agent: string, goldenCase: {
  id: string;
  description: string;
  lesson: string;
  session_id: string;
  created_at: string;
}): void {
  const suitePath = path.join(agentDir(agent), "meta", "golden-suite.jsonl");
  fs.appendFileSync(suitePath, JSON.stringify({ ...goldenCase, agent }) + "\n", "utf-8");
}

/**
 * Read an agent's golden suite.
 */
export function readGoldenSuite(agent: string): Array<{
  id: string;
  agent: string;
  description: string;
  lesson: string;
  session_id: string;
  created_at: string;
}> {
  try {
    const content = fs.readFileSync(path.join(agentDir(agent), "meta", "golden-suite.jsonl"), "utf-8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Append to an agent's session log.
 */
export function appendSessionLog(agent: string, entry: {
  session_id: string;
  timestamp: string;
  type: string;
  outcome: string;
  corrections: number;
  overrides: number;
  summary: string;
}): void {
  const logPath = path.join(agentDir(agent), "meta", "session-log.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Read the constitution file.
 */
export function readConstitution(): string {
  try {
    return fs.readFileSync(path.join(SOVEREIGN_PROTOCOL_DIR, "constitution.md"), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Read the shared knowledge file.
 */
export function readSharedKnowledge(): string {
  try {
    return fs.readFileSync(path.join(SOVEREIGN_PROTOCOL_DIR, "shared-knowledge.md"), "utf-8");
  } catch {
    return "";
  }
}

/**
 * List all config files for an agent (excluding meta/).
 */
export function listAgentConfigFiles(agent: string): string[] {
  try {
    const dir = agentDir(agent);
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
  } catch {
    return [];
  }
}

/**
 * Get all agents' version summaries.
 */
export function getAllAgentVersions(): Array<AgentVersion & { configFiles: string[] }> {
  return AGENT_CODENAMES.map((agent) => ({
    ...(getAgentVersion(agent) || {
      agent,
      version: 0,
      parent: null,
      timestamp: new Date().toISOString(),
      session_id: null,
      changes: [],
      metrics_snapshot: { total_sessions: 0, success_rate: 0, correction_rate: 0, ceo_override_rate: 0 },
    }),
    configFiles: listAgentConfigFiles(agent),
  }));
}

export const scpConfigVersioning = {
  getAgentVersion,
  getAgentMetrics,
  readAgentConfig,
  writeAgentConfig,
  getConfigLineCount,
  getConfigContentLength,
  bumpVersion,
  updateMetrics,
  appendEvolutionLog,
  readEvolutionLog,
  appendGoldenCase,
  readGoldenSuite,
  appendSessionLog,
  readConstitution,
  readSharedKnowledge,
  listAgentConfigFiles,
  getAllAgentVersions,
  AGENT_CODENAMES,
};
