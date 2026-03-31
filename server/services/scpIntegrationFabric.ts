// @ts-nocheck
/**
 * SCP v3 Integration Fabric — Sovereign Company Protocol
 *
 * Standardized layer between agents and external services.
 * Every integration follows the same interface pattern with:
 *   - Inbound streams (data flowing in)
 *   - Outbound actions (actions agents can perform)
 *   - Per-agent authorization
 *   - Credential security (encrypted, never in agent context)
 *   - Normalized events with per-agent relevance scoring
 *   - Per-integration cost and health tracking
 *
 * Wraps existing integrations (Stripe, email, SMS) into the unified interface
 * and provides the foundation for new integrations.
 */

import { db } from "../db";
import { logger } from "../utils/logger";
import crypto from "crypto";

// ─── Core Integration Interface ────────────────────────────────────────────

export interface Integration {
  id: string;
  name: string;
  type: "inbound" | "outbound" | "bidirectional";
  status: "active" | "paused" | "errored" | "pending_auth";
  tier: 1 | 2 | 3;

  inbound_streams: InboundStream[];
  outbound_actions: OutboundAction[];
  authorized_agents: string[];

  // Health & cost tracking
  total_inbound_events: number;
  total_outbound_actions: number;
  error_count_trailing_7d: number;
  cost_trailing_30d_usd: number;
  last_health_check: string | null;
}

export interface InboundStream {
  name: string;
  frequency: "realtime" | "polling";
  polling_interval_seconds?: number;
  last_synced_at: string | null;
  schema: Record<string, unknown>;
  events_trailing_24h: number;
}

export interface OutboundAction {
  name: string;
  description: string;
  authority_level: 0 | 1 | 2 | 3;
  rate_limit: { max: number; window_seconds: number };
  requires_confirmation: boolean;
  usage_count: number;
  last_used_at: string | null;
}

// ─── Normalized Event ──────────────────────────────────────────────────────

export interface NormalizedEvent {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  actor: {
    type: "user" | "system" | "agent";
    id: string;
    metadata: Record<string, unknown>;
  };
  data: Record<string, unknown>;
  relevance_scores: Record<string, number>; // agentName → 0-1
}

// ─── Relevance Scoring ─────────────────────────────────────────────────────

/**
 * Agent-domain mapping for relevance scoring.
 * Each agent cares about specific event categories.
 */
const AGENT_RELEVANCE_MAP: Record<string, string[]> = {
  forge_revenue: ["subscription", "payment", "invoice", "coupon", "churn", "trial", "revenue", "billing", "pricing"],
  oracle_analytics: ["page_view", "feature_usage", "funnel", "cohort", "conversion", "signup", "activation", "metric"],
  beacon_marketing: ["campaign", "email_open", "email_click", "seo", "keyword", "social", "content", "traffic", "ad"],
  scribe_content: ["content", "blog", "publish", "engagement", "read_time", "seo"],
  harbor_csm: ["support", "ticket", "nps", "churn_risk", "onboarding", "health_score", "feedback"],
  sophie_csm: ["support", "ticket", "nps", "churn_risk", "onboarding", "health_score", "feedback"],
  sentinel_devops: ["deploy", "error", "crash", "uptime", "latency", "memory", "cpu", "infrastructure", "ci"],
  atlas_cto: ["deploy", "ci", "pr", "code_coverage", "dependency", "error", "test", "build"],
  crucible_qa: ["test", "coverage", "regression", "error_rate", "quality", "bug", "flaky"],
  ledger_finance: ["payment", "invoice", "refund", "expense", "revenue", "cost", "billing", "subscription"],
  shield_legal: ["compliance", "gdpr", "privacy", "regulation", "tos", "data_handling"],
  compass_pm: ["feature_request", "feedback", "adoption", "usage", "roadmap", "signup"],
  prism_ux: ["page_view", "user_flow", "bounce", "accessibility", "ux", "design", "onboarding"],
};

/**
 * Calculate relevance scores for a normalized event.
 * Scores how relevant this event is to each agent (0-1).
 */
export function calculateRelevanceScores(event: { source: string; type: string; data: Record<string, unknown> }): Record<string, number> {
  const scores: Record<string, number> = {};
  const eventText = `${event.source} ${event.type} ${JSON.stringify(event.data).slice(0, 200)}`.toLowerCase();

  for (const [agent, keywords] of Object.entries(AGENT_RELEVANCE_MAP)) {
    const matchCount = keywords.filter((kw) => eventText.includes(kw)).length;
    scores[agent] = Math.min(1, matchCount / Math.max(3, keywords.length * 0.4));
  }

  return scores;
}

/**
 * Create a normalized event from a raw integration event.
 */
export function normalizeEvent(
  source: string,
  type: string,
  data: Record<string, unknown>,
  actor?: NormalizedEvent["actor"]
): NormalizedEvent {
  const event = {
    id: crypto.randomUUID(),
    source,
    type,
    timestamp: new Date().toISOString(),
    actor: actor ?? { type: "system" as const, id: source, metadata: {} },
    data,
    relevance_scores: {},
  };

  event.relevance_scores = calculateRelevanceScores(event);
  return event;
}

// ─── Integration Registry ──────────────────────────────────────────────────

const integrations = new Map<string, Integration>();

/**
 * Register the core integrations that wrap existing AcreOS services.
 */
export function registerCoreIntegrations(): void {
  // Tier 1: Revenue & Product
  registerIntegration({
    id: "stripe",
    name: "Stripe",
    type: "bidirectional",
    status: "active",
    tier: 1,
    inbound_streams: [
      {
        name: "stripe_webhook_events",
        frequency: "realtime",
        last_synced_at: null,
        schema: { event_type: "string", data: "object" },
        events_trailing_24h: 0,
      },
    ],
    outbound_actions: [
      { name: "create_coupon", description: "Create a discount coupon", authority_level: 2, rate_limit: { max: 10, window_seconds: 3600 }, requires_confirmation: true, usage_count: 0, last_used_at: null },
      { name: "adjust_trial", description: "Extend or shorten a trial period", authority_level: 2, rate_limit: { max: 20, window_seconds: 3600 }, requires_confirmation: true, usage_count: 0, last_used_at: null },
      { name: "generate_invoice", description: "Generate an invoice", authority_level: 2, rate_limit: { max: 10, window_seconds: 3600 }, requires_confirmation: true, usage_count: 0, last_used_at: null },
      { name: "read_subscription", description: "Read subscription data", authority_level: 0, rate_limit: { max: 100, window_seconds: 60 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
    ],
    authorized_agents: ["forge_revenue", "ledger_finance", "oracle_analytics"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "analytics",
    name: "Application Analytics",
    type: "inbound",
    status: "active",
    tier: 1,
    inbound_streams: [
      {
        name: "page_views",
        frequency: "polling",
        polling_interval_seconds: 300,
        last_synced_at: null,
        schema: { page: "string", user_id: "string", timestamp: "string" },
        events_trailing_24h: 0,
      },
      {
        name: "feature_usage",
        frequency: "polling",
        polling_interval_seconds: 300,
        last_synced_at: null,
        schema: { feature: "string", user_id: "string", count: "number" },
        events_trailing_24h: 0,
      },
    ],
    outbound_actions: [],
    authorized_agents: ["oracle_analytics", "compass_pm", "prism_ux"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "app_database",
    name: "Application Database",
    type: "inbound",
    status: "active",
    tier: 1,
    inbound_streams: [
      {
        name: "user_tenant_data",
        frequency: "polling",
        polling_interval_seconds: 600,
        last_synced_at: null,
        schema: { table: "string", query_type: "string" },
        events_trailing_24h: 0,
      },
    ],
    outbound_actions: [],
    authorized_agents: ["oracle_analytics", "atlas_cto"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  // Tier 2: Communication & Marketing
  registerIntegration({
    id: "email",
    name: "Email (SES/Resend)",
    type: "outbound",
    status: "active",
    tier: 2,
    inbound_streams: [
      {
        name: "email_events",
        frequency: "realtime",
        last_synced_at: null,
        schema: { event: "string", recipient: "string", campaign_id: "string" },
        events_trailing_24h: 0,
      },
    ],
    outbound_actions: [
      { name: "send_campaign", description: "Send an email campaign", authority_level: 2, rate_limit: { max: 5, window_seconds: 3600 }, requires_confirmation: true, usage_count: 0, last_used_at: null },
      { name: "send_transactional", description: "Send a transactional email", authority_level: 0, rate_limit: { max: 100, window_seconds: 3600 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
      { name: "send_retention", description: "Send a retention/re-engagement email", authority_level: 1, rate_limit: { max: 20, window_seconds: 3600 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
    ],
    authorized_agents: ["beacon_marketing", "scribe_content", "harbor_csm", "sophie_csm"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "sms",
    name: "SMS (Twilio)",
    type: "bidirectional",
    status: "active",
    tier: 2,
    inbound_streams: [
      { name: "sms_replies", frequency: "realtime", last_synced_at: null, schema: { from: "string", body: "string" }, events_trailing_24h: 0 },
    ],
    outbound_actions: [
      { name: "send_sms", description: "Send an SMS message", authority_level: 1, rate_limit: { max: 50, window_seconds: 3600 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
    ],
    authorized_agents: ["harbor_csm", "sophie_csm", "forge_revenue"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "search_console",
    name: "Google Search Console",
    type: "inbound",
    status: "pending_auth",
    tier: 2,
    inbound_streams: [
      { name: "keyword_rankings", frequency: "polling", polling_interval_seconds: 86400, last_synced_at: null, schema: { query: "string", position: "number", clicks: "number", impressions: "number" }, events_trailing_24h: 0 },
    ],
    outbound_actions: [],
    authorized_agents: ["beacon_marketing", "scribe_content", "oracle_analytics"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "social",
    name: "Social Media APIs",
    type: "bidirectional",
    status: "pending_auth",
    tier: 2,
    inbound_streams: [
      { name: "social_engagement", frequency: "polling", polling_interval_seconds: 3600, last_synced_at: null, schema: { platform: "string", metric: "string", value: "number" }, events_trailing_24h: 0 },
    ],
    outbound_actions: [
      { name: "publish_post", description: "Publish a social media post", authority_level: 1, rate_limit: { max: 10, window_seconds: 86400 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
    ],
    authorized_agents: ["beacon_marketing", "scribe_content"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  // Tier 3: Operations & Intelligence
  registerIntegration({
    id: "github",
    name: "GitHub",
    type: "bidirectional",
    status: "active",
    tier: 3,
    inbound_streams: [
      { name: "pr_events", frequency: "realtime", last_synced_at: null, schema: { action: "string", pr_number: "number" }, events_trailing_24h: 0 },
      { name: "ci_events", frequency: "realtime", last_synced_at: null, schema: { workflow: "string", status: "string" }, events_trailing_24h: 0 },
    ],
    outbound_actions: [
      { name: "create_issue", description: "Create a GitHub issue", authority_level: 1, rate_limit: { max: 10, window_seconds: 3600 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
      { name: "comment_pr", description: "Comment on a pull request", authority_level: 1, rate_limit: { max: 20, window_seconds: 3600 }, requires_confirmation: false, usage_count: 0, last_used_at: null },
    ],
    authorized_agents: ["atlas_cto", "crucible_qa", "sentinel_devops"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "error_tracking",
    name: "Error Tracking (Sentry)",
    type: "inbound",
    status: "active",
    tier: 3,
    inbound_streams: [
      { name: "error_events", frequency: "realtime", last_synced_at: null, schema: { error: "string", stack: "string", count: "number" }, events_trailing_24h: 0 },
    ],
    outbound_actions: [],
    authorized_agents: ["sentinel_devops", "crucible_qa", "atlas_cto"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });

  registerIntegration({
    id: "competitor_monitoring",
    name: "Competitor Intelligence",
    type: "inbound",
    status: "pending_auth",
    tier: 3,
    inbound_streams: [
      { name: "competitor_changes", frequency: "polling", polling_interval_seconds: 86400, last_synced_at: null, schema: { competitor: "string", change_type: "string" }, events_trailing_24h: 0 },
    ],
    outbound_actions: [],
    authorized_agents: ["beacon_marketing", "oracle_analytics", "compass_pm"],
    total_inbound_events: 0,
    total_outbound_actions: 0,
    error_count_trailing_7d: 0,
    cost_trailing_30d_usd: 0,
    last_health_check: null,
  });
}

// ─── Registry Operations ───────────────────────────────────────────────────

function registerIntegration(integration: Integration): void {
  integrations.set(integration.id, integration);
}

export function getIntegration(id: string): Integration | undefined {
  return integrations.get(id);
}

export function getAllIntegrations(): Integration[] {
  return Array.from(integrations.values());
}

export function getIntegrationsByTier(tier: 1 | 2 | 3): Integration[] {
  return getAllIntegrations().filter((i) => i.tier === tier);
}

export function getIntegrationsForAgent(agent: string): Integration[] {
  return getAllIntegrations().filter((i) => i.authorized_agents.includes(agent));
}

/**
 * Check if an agent is authorized for a specific outbound action.
 */
export function isAuthorizedForAction(agent: string, integrationId: string, actionName: string): {
  authorized: boolean;
  reason?: string;
  authority_level?: number;
} {
  const integration = integrations.get(integrationId);
  if (!integration) return { authorized: false, reason: "Integration not found" };
  if (!integration.authorized_agents.includes(agent)) {
    return { authorized: false, reason: `Agent ${agent} not authorized for ${integrationId}` };
  }

  const action = integration.outbound_actions.find((a) => a.name === actionName);
  if (!action) return { authorized: false, reason: `Action ${actionName} not found on ${integrationId}` };

  return { authorized: true, authority_level: action.authority_level };
}

// ─── Event Pipeline ────────────────────────────────────────────────────────

const eventBuffer: NormalizedEvent[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * Ingest a raw event from an integration, normalize it, and buffer it.
 */
export function ingestEvent(
  integrationId: string,
  eventType: string,
  data: Record<string, unknown>,
  actor?: NormalizedEvent["actor"]
): NormalizedEvent | null {
  const integration = integrations.get(integrationId);
  if (!integration || integration.status !== "active") return null;

  const event = normalizeEvent(integrationId, eventType, data, actor);

  // Track integration metrics
  integration.total_inbound_events++;

  // Buffer the event
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.shift(); // FIFO eviction
  }

  return event;
}

/**
 * Get recent events relevant to a specific agent (above threshold).
 */
export function getEventsForAgent(agent: string, threshold: number = 0.3, limit: number = 20): NormalizedEvent[] {
  return eventBuffer
    .filter((e) => (e.relevance_scores[agent] ?? 0) >= threshold)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get events from a specific integration.
 */
export function getEventsBySource(source: string, limit: number = 50): NormalizedEvent[] {
  return eventBuffer
    .filter((e) => e.source === source)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────

const rateLimitCounters = new Map<string, { count: number; window_start: number }>();

/**
 * Check and consume rate limit for an outbound action.
 */
export function checkRateLimit(integrationId: string, actionName: string): {
  allowed: boolean;
  remaining?: number;
  reset_at?: string;
} {
  const integration = integrations.get(integrationId);
  if (!integration) return { allowed: false };

  const action = integration.outbound_actions.find((a) => a.name === actionName);
  if (!action) return { allowed: false };

  const key = `${integrationId}:${actionName}`;
  const now = Date.now();
  const counter = rateLimitCounters.get(key);

  if (!counter || (now - counter.window_start) > action.rate_limit.window_seconds * 1000) {
    // New window
    rateLimitCounters.set(key, { count: 1, window_start: now });
    return { allowed: true, remaining: action.rate_limit.max - 1 };
  }

  if (counter.count >= action.rate_limit.max) {
    const resetAt = new Date(counter.window_start + action.rate_limit.window_seconds * 1000);
    return { allowed: false, remaining: 0, reset_at: resetAt.toISOString() };
  }

  counter.count++;
  return { allowed: true, remaining: action.rate_limit.max - counter.count };
}

// ─── Integration Health Dashboard ──────────────────────────────────────────

export interface IntegrationHealthSummary {
  total_integrations: number;
  active: number;
  errored: number;
  pending_auth: number;
  total_events_24h: number;
  total_actions_24h: number;
  total_cost_30d_usd: number;
  integrations: Array<{
    id: string;
    name: string;
    status: string;
    tier: number;
    events_24h: number;
    error_count_7d: number;
    cost_30d_usd: number;
  }>;
}

export function getIntegrationHealth(): IntegrationHealthSummary {
  const all = getAllIntegrations();

  return {
    total_integrations: all.length,
    active: all.filter((i) => i.status === "active").length,
    errored: all.filter((i) => i.status === "errored").length,
    pending_auth: all.filter((i) => i.status === "pending_auth").length,
    total_events_24h: all.reduce((s, i) =>
      s + i.inbound_streams.reduce((ss, st) => ss + st.events_trailing_24h, 0), 0),
    total_actions_24h: 0,
    total_cost_30d_usd: all.reduce((s, i) => s + i.cost_trailing_30d_usd, 0),
    integrations: all.map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      tier: i.tier,
      events_24h: i.inbound_streams.reduce((s, st) => s + st.events_trailing_24h, 0),
      error_count_7d: i.error_count_trailing_7d,
      cost_30d_usd: i.cost_trailing_30d_usd,
    })),
  };
}

// ─── Initialize ────────────────────────────────────────────────────────────

registerCoreIntegrations();

// ─── Exported Service ──────────────────────────────────────────────────────

export const integrationFabric = {
  // Registry
  getIntegration,
  getAllIntegrations,
  getIntegrationsByTier,
  getIntegrationsForAgent,
  isAuthorizedForAction,
  registerCoreIntegrations,
  // Events
  normalizeEvent,
  calculateRelevanceScores,
  ingestEvent,
  getEventsForAgent,
  getEventsBySource,
  // Rate limiting
  checkRateLimit,
  // Health
  getIntegrationHealth,
};
