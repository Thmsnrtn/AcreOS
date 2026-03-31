import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  addCompetitor,
  getCompetitor,
  listCompetitors,
  recordCompetitorMove,
  updateThreatLevel,
  reportMarketSignal,
  getMarketSignals,
  updateSignalStatus,
  createInitiative,
  getInitiative,
  listInitiatives,
  approveInitiative,
  startInitiative,
  updateKeyResult,
  generateStrategicBriefing,
} from "../../../server/services/scpStrategicIntelligence";

describe("SCP v3 Strategic Intelligence", () => {
  describe("Competitor Intelligence", () => {
    it("adds a competitor profile", () => {
      const comp = addCompetitor({
        name: "RivalCRM",
        domain: "rivalcrm.com",
        category: "direct",
        strengths: ["Market share", "Brand recognition"],
        weaknesses: ["Slow iteration", "High pricing"],
      });

      expect(comp.id).toBeTruthy();
      expect(comp.name).toBe("RivalCRM");
      expect(comp.threat_level).toBe(0.5);
    });

    it("retrieves competitor by id", () => {
      const comp = addCompetitor({ name: "CompeteInc", domain: "compete.inc" });
      const found = getCompetitor(comp.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("CompeteInc");
    });

    it("lists competitors sorted by threat level", () => {
      const low = addCompetitor({ name: "LowThreat", domain: "low.com" });
      const high = addCompetitor({ name: "HighThreat", domain: "high.com" });
      updateThreatLevel(high.id, 0.9);
      updateThreatLevel(low.id, 0.1);

      const list = listCompetitors();
      const highIdx = list.findIndex((c) => c.id === high.id);
      const lowIdx = list.findIndex((c) => c.id === low.id);
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it("records competitor moves", () => {
      const comp = addCompetitor({ name: "MoverCo", domain: "mover.co" });
      const recorded = recordCompetitorMove(comp.id, {
        type: "pricing_change",
        description: "Dropped prices by 20%",
        impact_assessment: "May pressure our pricing",
        source: "press_release",
        responding_agents: ["forge_revenue", "beacon_marketing"],
      });

      expect(recorded).toBe(true);
      const updated = getCompetitor(comp.id);
      expect(updated!.recent_moves.length).toBe(1);
    });

    it("updates threat level clamped to 0-1", () => {
      const comp = addCompetitor({ name: "ClampCo", domain: "clamp.co" });
      updateThreatLevel(comp.id, 1.5);
      expect(getCompetitor(comp.id)!.threat_level).toBe(1);
      updateThreatLevel(comp.id, -0.5);
      expect(getCompetitor(comp.id)!.threat_level).toBe(0);
    });
  });

  describe("Market Signals", () => {
    it("reports a market signal", () => {
      const signal = reportMarketSignal({
        type: "opportunity",
        title: "New vertical: Healthcare SaaS",
        description: "Healthcare CRM market growing 30% YoY",
        source: "market_research",
        confidence: 0.8,
        urgency: "medium",
        contributing_agents: ["oracle_analytics", "compass_pm"],
      });

      expect(signal.id).toBeTruthy();
      expect(signal.status).toBe("new");
    });

    it("filters signals by type", () => {
      reportMarketSignal({
        type: "threat",
        title: "Regulatory change",
        description: "New GDPR amendment",
        source: "news",
        confidence: 0.9,
        urgency: "critical",
        contributing_agents: ["shield_legal"],
      });

      const threats = getMarketSignals({ type: "threat" });
      expect(threats.every((s) => s.type === "threat")).toBe(true);
    });

    it("updates signal status", () => {
      const signal = reportMarketSignal({
        type: "trend",
        title: "AI adoption",
        description: "AI CRM tools growing",
        source: "analysis",
        confidence: 0.7,
        urgency: "low",
        contributing_agents: ["oracle_analytics"],
      });

      const updated = updateSignalStatus(signal.id, "acknowledged");
      expect(updated).toBe(true);
      const found = getMarketSignals({ status: "acknowledged" });
      expect(found.some((s) => s.id === signal.id)).toBe(true);
    });
  });

  describe("Strategic Initiatives", () => {
    it("creates a strategic initiative with key results", () => {
      const init = createInitiative({
        title: "Expand to Healthcare",
        description: "Launch healthcare vertical",
        objective: "Capture 5% of healthcare CRM market in 6 months",
        owner_agent: "compass_pm",
        collaborating_agents: ["beacon_marketing", "forge_revenue"],
        priority: 1,
        key_results: [
          { description: "Sign 10 healthcare customers", metric: "healthcare_customers", target_value: 10 },
          { description: "Launch HIPAA compliance", metric: "hipaa_ready", target_value: 1 },
        ],
        timeline_days: 180,
      });

      expect(init.id).toBeTruthy();
      expect(init.status).toBe("proposed");
      expect(init.key_results.length).toBe(2);
      expect(init.progress_pct).toBe(0);
    });

    it("approves and starts an initiative", () => {
      const init = createInitiative({
        title: "SEO Push",
        description: "Improve organic traffic",
        objective: "Double organic signups",
        owner_agent: "beacon_marketing",
        key_results: [{ description: "Reach 10K monthly visits", metric: "monthly_visits", target_value: 10000 }],
        timeline_days: 90,
      });

      expect(approveInitiative(init.id)).toBe(true);
      expect(getInitiative(init.id)!.status).toBe("approved");

      expect(startInitiative(init.id)).toBe(true);
      expect(getInitiative(init.id)!.status).toBe("in_progress");
      expect(getInitiative(init.id)!.started_at).toBeTruthy();
      expect(getInitiative(init.id)!.target_date).toBeTruthy();
    });

    it("updates key results and calculates progress", () => {
      const init = createInitiative({
        title: "Onboarding Improvement",
        description: "Reduce time-to-value",
        objective: "Cut activation time by 50%",
        owner_agent: "prism_ux",
        key_results: [
          { description: "Reduce steps from 8 to 4", metric: "onboard_steps", target_value: 4 },
          { description: "Increase activation rate to 80%", metric: "activation_rate", target_value: 80 },
        ],
        timeline_days: 60,
      });

      startInitiative(init.id);
      updateKeyResult(init.id, 0, 4); // Achieved
      expect(getInitiative(init.id)!.progress_pct).toBe(50);

      updateKeyResult(init.id, 1, 80); // Achieved
      expect(getInitiative(init.id)!.progress_pct).toBe(100);
      expect(getInitiative(init.id)!.status).toBe("completed");
    });

    it("lists initiatives by status", () => {
      const proposed = listInitiatives("proposed");
      expect(proposed.every((i) => i.status === "proposed")).toBe(true);
    });
  });

  describe("Strategic Briefing", () => {
    it("generates a comprehensive strategic briefing", () => {
      const briefing = generateStrategicBriefing();

      expect(briefing.timestamp).toBeTruthy();
      expect(briefing.competitor_landscape.total_competitors).toBeGreaterThan(0);
      expect(briefing.market_signals.total).toBeGreaterThan(0);
      expect(briefing.initiatives.total).toBeGreaterThan(0);
      expect(Array.isArray(briefing.top_priorities)).toBe(true);
    });

    it("includes critical threats in top priorities", () => {
      reportMarketSignal({
        type: "threat",
        title: "Critical threat for briefing test",
        description: "Major competitor pivot",
        source: "intel",
        confidence: 0.95,
        urgency: "critical",
        contributing_agents: ["oracle_analytics"],
      });

      const briefing = generateStrategicBriefing();
      expect(briefing.market_signals.critical_threats).toBeGreaterThan(0);
    });
  });
});
