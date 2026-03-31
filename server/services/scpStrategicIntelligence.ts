// @ts-nocheck
/**
 * SCP v3 Strategic Intelligence — Sovereign Company Protocol
 *
 * Cross-agent strategic synthesis with:
 *   - CompetitorProfile tracking
 *   - Market signal aggregation
 *   - Strategic initiative management
 *   - Rolling 90-day planning
 *   - Cross-agent strategic synthesis (multiple agents contribute insights)
 *   - Opportunity and threat scoring
 */

import { logger } from "../utils/logger";
import crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CompetitorProfile {
  id: string;
  name: string;
  domain: string;
  category: string; // direct, indirect, emerging
  strengths: string[];
  weaknesses: string[];
  recent_moves: CompetitorMove[];
  threat_level: number; // 0-1
  last_updated: string;
}

export interface CompetitorMove {
  type: "pricing_change" | "feature_launch" | "funding" | "partnership" | "acquisition" | "marketing_campaign" | "expansion";
  description: string;
  impact_assessment: string;
  detected_at: string;
  source: string;
  responding_agents: string[];
}

export interface MarketSignal {
  id: string;
  type: "opportunity" | "threat" | "trend" | "shift";
  title: string;
  description: string;
  source: string;
  confidence: number; // 0-1
  urgency: "low" | "medium" | "high" | "critical";
  contributing_agents: string[];
  tags: string[];
  created_at: string;
  status: "new" | "acknowledged" | "acting" | "resolved";
}

export interface StrategicInitiative {
  id: string;
  title: string;
  description: string;
  objective: string;
  owner_agent: string;
  collaborating_agents: string[];
  priority: 1 | 2 | 3 | 4 | 5; // 1 = highest
  status: "proposed" | "approved" | "in_progress" | "completed" | "abandoned";
  key_results: KeyResult[];
  timeline_days: number;
  started_at: string | null;
  target_date: string | null;
  created_at: string;
  progress_pct: number;
}

export interface KeyResult {
  description: string;
  metric: string;
  target_value: number;
  current_value: number;
  achieved: boolean;
}

// ─── In-Memory Stores ─────────────────────────────────────────────────────

const competitors = new Map<string, CompetitorProfile>();
const marketSignals: MarketSignal[] = [];
const initiatives = new Map<string, StrategicInitiative>();

// ─── Competitor Intelligence ──────────────────────────────────────────────

export function addCompetitor(input: {
  name: string;
  domain: string;
  category?: string;
  strengths?: string[];
  weaknesses?: string[];
}): CompetitorProfile {
  const profile: CompetitorProfile = {
    id: crypto.randomUUID(),
    name: input.name,
    domain: input.domain,
    category: input.category ?? "direct",
    strengths: input.strengths ?? [],
    weaknesses: input.weaknesses ?? [],
    recent_moves: [],
    threat_level: 0.5,
    last_updated: new Date().toISOString(),
  };

  competitors.set(profile.id, profile);
  logger.info("Competitor added", { name: input.name });
  return profile;
}

export function getCompetitor(id: string): CompetitorProfile | undefined {
  return competitors.get(id);
}

export function listCompetitors(): CompetitorProfile[] {
  return Array.from(competitors.values()).sort((a, b) => b.threat_level - a.threat_level);
}

export function recordCompetitorMove(
  competitorId: string,
  move: Omit<CompetitorMove, "detected_at">
): boolean {
  const competitor = competitors.get(competitorId);
  if (!competitor) return false;

  competitor.recent_moves.push({
    ...move,
    detected_at: new Date().toISOString(),
  });

  // Keep last 50 moves
  if (competitor.recent_moves.length > 50) {
    competitor.recent_moves = competitor.recent_moves.slice(-50);
  }

  competitor.last_updated = new Date().toISOString();
  return true;
}

export function updateThreatLevel(competitorId: string, threatLevel: number): boolean {
  const competitor = competitors.get(competitorId);
  if (!competitor) return false;
  competitor.threat_level = Math.max(0, Math.min(1, threatLevel));
  competitor.last_updated = new Date().toISOString();
  return true;
}

// ─── Market Signals ───────────────────────────────────────────────────────

export function reportMarketSignal(input: {
  type: MarketSignal["type"];
  title: string;
  description: string;
  source: string;
  confidence: number;
  urgency: MarketSignal["urgency"];
  contributing_agents: string[];
  tags?: string[];
}): MarketSignal {
  const signal: MarketSignal = {
    id: crypto.randomUUID(),
    ...input,
    tags: input.tags ?? [],
    created_at: new Date().toISOString(),
    status: "new",
  };

  marketSignals.push(signal);
  logger.info("Market signal reported", { type: input.type, title: input.title });
  return signal;
}

export function getMarketSignals(filters?: {
  type?: MarketSignal["type"];
  urgency?: MarketSignal["urgency"];
  status?: MarketSignal["status"];
}): MarketSignal[] {
  let result = [...marketSignals];
  if (filters?.type) result = result.filter((s) => s.type === filters.type);
  if (filters?.urgency) result = result.filter((s) => s.urgency === filters.urgency);
  if (filters?.status) result = result.filter((s) => s.status === filters.status);
  return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function updateSignalStatus(signalId: string, status: MarketSignal["status"]): boolean {
  const signal = marketSignals.find((s) => s.id === signalId);
  if (!signal) return false;
  signal.status = status;
  return true;
}

// ─── Strategic Initiatives ────────────────────────────────────────────────

export function createInitiative(input: {
  title: string;
  description: string;
  objective: string;
  owner_agent: string;
  collaborating_agents?: string[];
  priority?: StrategicInitiative["priority"];
  key_results: Array<{ description: string; metric: string; target_value: number }>;
  timeline_days: number;
}): StrategicInitiative {
  const initiative: StrategicInitiative = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    objective: input.objective,
    owner_agent: input.owner_agent,
    collaborating_agents: input.collaborating_agents ?? [],
    priority: input.priority ?? 3,
    status: "proposed",
    key_results: input.key_results.map((kr) => ({
      ...kr,
      current_value: 0,
      achieved: false,
    })),
    timeline_days: input.timeline_days,
    started_at: null,
    target_date: null,
    created_at: new Date().toISOString(),
    progress_pct: 0,
  };

  initiatives.set(initiative.id, initiative);
  return initiative;
}

export function getInitiative(id: string): StrategicInitiative | undefined {
  return initiatives.get(id);
}

export function listInitiatives(status?: StrategicInitiative["status"]): StrategicInitiative[] {
  const all = Array.from(initiatives.values());
  if (status) return all.filter((i) => i.status === status);
  return all.sort((a, b) => a.priority - b.priority);
}

export function approveInitiative(id: string): boolean {
  const initiative = initiatives.get(id);
  if (!initiative || initiative.status !== "proposed") return false;
  initiative.status = "approved";
  return true;
}

export function startInitiative(id: string): boolean {
  const initiative = initiatives.get(id);
  if (!initiative || (initiative.status !== "approved" && initiative.status !== "proposed")) return false;
  initiative.status = "in_progress";
  initiative.started_at = new Date().toISOString();
  initiative.target_date = new Date(Date.now() + initiative.timeline_days * 24 * 60 * 60 * 1000).toISOString();
  return true;
}

export function updateKeyResult(
  initiativeId: string,
  krIndex: number,
  currentValue: number
): boolean {
  const initiative = initiatives.get(initiativeId);
  if (!initiative || krIndex < 0 || krIndex >= initiative.key_results.length) return false;

  const kr = initiative.key_results[krIndex];
  kr.current_value = currentValue;
  kr.achieved = currentValue >= kr.target_value;

  // Recalculate progress
  const achieved = initiative.key_results.filter((k) => k.achieved).length;
  initiative.progress_pct = (achieved / initiative.key_results.length) * 100;

  // Auto-complete if all KRs achieved
  if (initiative.progress_pct === 100) {
    initiative.status = "completed";
  }

  return true;
}

// ─── Strategic Synthesis ──────────────────────────────────────────────────

export interface StrategicBriefing {
  timestamp: string;
  competitor_landscape: {
    total_competitors: number;
    high_threat: number;
    recent_moves: number;
  };
  market_signals: {
    total: number;
    new_signals: number;
    critical_threats: number;
    opportunities: number;
  };
  initiatives: {
    total: number;
    in_progress: number;
    avg_progress_pct: number;
    at_risk: number; // Past target date and not completed
  };
  top_priorities: Array<{
    type: "threat" | "opportunity" | "initiative";
    title: string;
    urgency: string;
  }>;
}

/**
 * Generate a cross-agent strategic briefing.
 * This is the 90-day rolling view synthesized across all agents.
 */
export function generateStrategicBriefing(): StrategicBriefing {
  const allCompetitors = Array.from(competitors.values());
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const recentMoves = allCompetitors.reduce((count, c) =>
    count + c.recent_moves.filter((m) => new Date(m.detected_at).getTime() > ninetyDaysAgo).length, 0);

  const allInitiatives = Array.from(initiatives.values());
  const inProgress = allInitiatives.filter((i) => i.status === "in_progress");
  const avgProgress = inProgress.length > 0
    ? inProgress.reduce((s, i) => s + i.progress_pct, 0) / inProgress.length
    : 0;

  const now = Date.now();
  const atRisk = inProgress.filter(
    (i) => i.target_date && new Date(i.target_date).getTime() < now && i.progress_pct < 100
  ).length;

  const newSignals = marketSignals.filter((s) => s.status === "new");
  const criticalThreats = marketSignals.filter(
    (s) => s.type === "threat" && s.urgency === "critical" && s.status !== "resolved"
  );
  const opportunities = marketSignals.filter(
    (s) => s.type === "opportunity" && s.status !== "resolved"
  );

  // Build top priorities
  const topPriorities: StrategicBriefing["top_priorities"] = [];

  for (const threat of criticalThreats.slice(0, 3)) {
    topPriorities.push({ type: "threat", title: threat.title, urgency: threat.urgency });
  }
  for (const opp of opportunities.slice(0, 2)) {
    topPriorities.push({ type: "opportunity", title: opp.title, urgency: opp.urgency });
  }
  for (const init of allInitiatives.filter((i) => i.priority <= 2 && i.status === "in_progress").slice(0, 2)) {
    topPriorities.push({ type: "initiative", title: init.title, urgency: "high" });
  }

  return {
    timestamp: new Date().toISOString(),
    competitor_landscape: {
      total_competitors: allCompetitors.length,
      high_threat: allCompetitors.filter((c) => c.threat_level >= 0.7).length,
      recent_moves: recentMoves,
    },
    market_signals: {
      total: marketSignals.length,
      new_signals: newSignals.length,
      critical_threats: criticalThreats.length,
      opportunities: opportunities.length,
    },
    initiatives: {
      total: allInitiatives.length,
      in_progress: inProgress.length,
      avg_progress_pct: avgProgress,
      at_risk: atRisk,
    },
    top_priorities: topPriorities,
  };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpStrategicIntelligence = {
  // Competitors
  addCompetitor,
  getCompetitor,
  listCompetitors,
  recordCompetitorMove,
  updateThreatLevel,
  // Market Signals
  reportMarketSignal,
  getMarketSignals,
  updateSignalStatus,
  // Initiatives
  createInitiative,
  getInitiative,
  listInitiatives,
  approveInitiative,
  startInitiative,
  updateKeyResult,
  // Synthesis
  generateStrategicBriefing,
};
