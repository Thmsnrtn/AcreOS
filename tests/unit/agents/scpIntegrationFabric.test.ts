import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getIntegration,
  getAllIntegrations,
  getIntegrationsByTier,
  getIntegrationsForAgent,
  isAuthorizedForAction,
  normalizeEvent,
  calculateRelevanceScores,
  ingestEvent,
  getEventsForAgent,
  getEventsBySource,
  checkRateLimit,
  getIntegrationHealth,
} from "../../../server/services/scpIntegrationFabric";

describe("SCP v3 Integration Fabric", () => {
  describe("Integration Registry", () => {
    it("registers all 10 core integrations on import", () => {
      const all = getAllIntegrations();
      expect(all.length).toBe(10);
    });

    it("retrieves integration by id", () => {
      const stripe = getIntegration("stripe");
      expect(stripe).toBeDefined();
      expect(stripe!.name).toBe("Stripe");
      expect(stripe!.type).toBe("bidirectional");
      expect(stripe!.tier).toBe(1);
    });

    it("filters integrations by tier", () => {
      const tier1 = getIntegrationsByTier(1);
      expect(tier1.length).toBe(3); // stripe, analytics, app_database
      expect(tier1.every((i) => i.tier === 1)).toBe(true);

      const tier2 = getIntegrationsByTier(2);
      expect(tier2.length).toBe(4); // email, sms, search_console, social

      const tier3 = getIntegrationsByTier(3);
      expect(tier3.length).toBe(3); // github, error_tracking, competitor_monitoring
    });

    it("filters integrations for a specific agent", () => {
      const forgeIntegrations = getIntegrationsForAgent("forge_revenue");
      expect(forgeIntegrations.some((i) => i.id === "stripe")).toBe(true);
      expect(forgeIntegrations.some((i) => i.id === "sms")).toBe(true);
      expect(forgeIntegrations.some((i) => i.id === "github")).toBe(false);
    });
  });

  describe("Authorization", () => {
    it("authorizes agents for their assigned integrations", () => {
      const result = isAuthorizedForAction("forge_revenue", "stripe", "read_subscription");
      expect(result.authorized).toBe(true);
      expect(result.authority_level).toBe(0);
    });

    it("rejects unauthorized agents", () => {
      const result = isAuthorizedForAction("harbor_csm", "stripe", "create_coupon");
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("not authorized");
    });

    it("rejects unknown integrations", () => {
      const result = isAuthorizedForAction("forge_revenue", "unknown_integration", "action");
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("rejects unknown actions", () => {
      const result = isAuthorizedForAction("forge_revenue", "stripe", "delete_everything");
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain("not found");
    });
  });

  describe("Relevance Scoring", () => {
    it("scores payment events high for forge_revenue and ledger_finance", () => {
      const scores = calculateRelevanceScores({
        source: "stripe",
        type: "payment_succeeded",
        data: { amount: 9900, subscription: "sub_123", invoice: "inv_456" },
      });

      expect(scores["forge_revenue"]).toBeGreaterThan(0);
      expect(scores["ledger_finance"]).toBeGreaterThan(0);
    });

    it("scores deploy events high for sentinel_devops and atlas_cto", () => {
      const scores = calculateRelevanceScores({
        source: "github",
        type: "deploy_completed",
        data: { environment: "production", status: "success" },
      });

      expect(scores["sentinel_devops"]).toBeGreaterThan(0);
      expect(scores["atlas_cto"]).toBeGreaterThan(0);
    });

    it("scores support events high for harbor_csm", () => {
      const scores = calculateRelevanceScores({
        source: "support",
        type: "ticket_created",
        data: { priority: "high", churn_risk: true },
      });

      expect(scores["harbor_csm"]).toBeGreaterThan(0);
    });

    it("returns low scores for irrelevant agents", () => {
      const scores = calculateRelevanceScores({
        source: "stripe",
        type: "payment_succeeded",
        data: { amount: 100 },
      });

      // Shield (legal/compliance) shouldn't care much about generic payments
      expect(scores["shield_legal"]).toBe(0);
    });
  });

  describe("Event Normalization", () => {
    it("creates a normalized event with relevance scores", () => {
      const event = normalizeEvent("stripe", "payment_succeeded", { amount: 4900 });
      expect(event.id).toBeTruthy();
      expect(event.source).toBe("stripe");
      expect(event.type).toBe("payment_succeeded");
      expect(event.timestamp).toBeTruthy();
      expect(event.actor.type).toBe("system");
      expect(event.relevance_scores).toBeDefined();
    });

    it("accepts custom actor", () => {
      const event = normalizeEvent("stripe", "payment", { amount: 100 }, {
        type: "user",
        id: "user_123",
        metadata: { plan: "pro" },
      });
      expect(event.actor.type).toBe("user");
      expect(event.actor.id).toBe("user_123");
    });
  });

  describe("Event Ingestion & Pipeline", () => {
    it("ingests events from active integrations", () => {
      const event = ingestEvent("stripe", "subscription_created", { plan: "pro" });
      expect(event).not.toBeNull();
      expect(event!.source).toBe("stripe");
    });

    it("rejects events from non-active integrations", () => {
      const event = ingestEvent("search_console", "keyword_update", { query: "test" });
      expect(event).toBeNull(); // search_console is pending_auth
    });

    it("rejects events from unknown integrations", () => {
      const event = ingestEvent("nonexistent", "event", {});
      expect(event).toBeNull();
    });

    it("retrieves events by source", () => {
      ingestEvent("stripe", "charge_refunded", { amount: 500 });
      const events = getEventsBySource("stripe");
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.source === "stripe")).toBe(true);
    });

    it("retrieves relevant events for an agent", () => {
      // Ingest events that should be relevant to forge_revenue
      ingestEvent("stripe", "subscription_payment", {
        revenue: 9900,
        billing: "monthly",
        subscription: "sub_test",
      });

      const events = getEventsForAgent("forge_revenue", 0.1);
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("Rate Limiting", () => {
    it("allows actions within rate limit", () => {
      const result = checkRateLimit("stripe", "create_coupon");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeDefined();
    });

    it("returns false for unknown integrations", () => {
      const result = checkRateLimit("nonexistent", "action");
      expect(result.allowed).toBe(false);
    });

    it("returns false for unknown actions", () => {
      const result = checkRateLimit("stripe", "nonexistent_action");
      expect(result.allowed).toBe(false);
    });

    it("enforces rate limits after max calls", () => {
      // read_subscription has max 100 per 60s - exhaust it
      for (let i = 0; i < 100; i++) {
        checkRateLimit("stripe", "read_subscription");
      }
      const result = checkRateLimit("stripe", "read_subscription");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reset_at).toBeDefined();
    });
  });

  describe("Health Dashboard", () => {
    it("returns complete health summary", () => {
      const health = getIntegrationHealth();
      expect(health.total_integrations).toBe(10);
      expect(health.active).toBeGreaterThan(0);
      expect(health.pending_auth).toBeGreaterThan(0);
      expect(health.integrations.length).toBe(10);
    });

    it("tracks integration statuses correctly", () => {
      const health = getIntegrationHealth();
      // 6 active (stripe, analytics, app_database, email, sms, github, error_tracking) = 7
      // 3 pending_auth (search_console, social, competitor_monitoring)
      expect(health.active).toBe(7);
      expect(health.pending_auth).toBe(3);
      expect(health.errored).toBe(0);
    });

    it("includes per-integration details", () => {
      const health = getIntegrationHealth();
      const stripeHealth = health.integrations.find((i) => i.id === "stripe");
      expect(stripeHealth).toBeDefined();
      expect(stripeHealth!.name).toBe("Stripe");
      expect(stripeHealth!.tier).toBe(1);
    });
  });
});
