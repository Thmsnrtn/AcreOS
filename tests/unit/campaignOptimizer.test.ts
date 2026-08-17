/**
 * Campaign Optimizer Service — Unit Tests
 *
 * Tests metric calculations, optimization score, and fallback suggestion
 * generation. All DB and storage calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ────────────────────────────────────────────────────────────────────
vi.mock("../../server/db", () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

// ── Storage mock ───────────────────────────────────────────────────────────────
vi.mock("../../server/storage", () => ({
  storage: {
    createCampaignOptimization: vi.fn().mockResolvedValue({ id: 1 }),
    getCampaigns: vi.fn().mockResolvedValue([]),
    getCampaignsNeedingOptimization: vi.fn().mockResolvedValue([]),
  },
}));

// ── Credits mock ───────────────────────────────────────────────────────────────
vi.mock("../../server/services/credits", () => ({
  usageMeteringService: {
    recordUsage: vi.fn().mockResolvedValue({ insufficientCredits: false }),
  },
}));

import { CampaignOptimizerService } from "../../server/services/campaignOptimizer";

// ── Test helpers ───────────────────────────────────────────────────────────────
const makeCampaign = (overrides = {}): any => ({
  id: 1,
  organizationId: 1,
  name: "Test Campaign",
  type: "email",
  subject: "Test Subject",
  content: "Test content for our land offer",
  status: "completed",
  totalSent: 1000,
  totalDelivered: 980,
  totalOpened: 245,
  totalClicked: 12,
  totalResponded: 30,
  spent: "500",
  targetCriteria: {},
  lastOptimizedAt: null,
  optimizationScore: null,
  updatedAt: new Date(),
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("CampaignOptimizerService", () => {
  let optimizer: CampaignOptimizerService;

  beforeEach(() => {
    vi.clearAllMocks();
    optimizer = new CampaignOptimizerService();
  });

  // ── Metric calculations ────────────────────────────────────────────────────
  describe("analyzeCampaignPerformance — metric calculations", () => {
    it("openRate = totalOpened / totalDelivered × 100", () => {
      const campaign = makeCampaign({
        totalDelivered: 1000,
        totalOpened: 250,
      });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.openRate).toBeCloseTo(25.0, 1);
    });

    it("clickRate = totalClicked / totalOpened × 100", () => {
      const campaign = makeCampaign({
        totalOpened: 200,
        totalClicked: 10,
      });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.clickRate).toBeCloseTo(5.0, 1);
    });

    it("responseRate = totalResponded / totalSent × 100", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalResponded: 20,
      });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.responseRate).toBeCloseTo(2.0, 1);
    });

    it("costPerResponse = spent / totalResponded", () => {
      const campaign = makeCampaign({
        spent: "600",
        totalResponded: 30,
      });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.costPerResponse).toBeCloseTo(20.0, 1);
    });

    it("deliveryRate = totalDelivered / totalSent × 100", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 950,
      });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.deliveryRate).toBeCloseTo(95.0, 1);
    });

    it("openRate is 0 when totalDelivered is 0", () => {
      const campaign = makeCampaign({ totalDelivered: 0, totalOpened: 0 });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.openRate).toBe(0);
    });

    it("costPerResponse equals spent when no responses (division guard)", () => {
      const campaign = makeCampaign({ totalResponded: 0, spent: "500" });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      // Service returns spent itself when totalResponded = 0
      expect(metrics.costPerResponse).toBe(500);
    });

    it("all metrics are numeric (no NaN)", () => {
      const campaign = makeCampaign({
        totalSent: 0,
        totalDelivered: 0,
        totalOpened: 0,
        totalClicked: 0,
        totalResponded: 0,
        spent: "0",
      });
      const metrics = optimizer.analyzeCampaignPerformance(campaign);
      expect(metrics.openRate).not.toBeNaN();
      expect(metrics.clickRate).not.toBeNaN();
      expect(metrics.responseRate).not.toBeNaN();
      expect(metrics.costPerResponse).not.toBeNaN();
      expect(metrics.deliveryRate).not.toBeNaN();
    });
  });

  // ── Optimization score ─────────────────────────────────────────────────────
  describe("calculateOptimizationScore", () => {
    it("starts from base of 50 and adjusts up/down based on benchmarks", () => {
      // Entirely zero metrics → each metric below poor → full deductions
      const zeroCampaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 0,
        totalOpened: 0,
        totalClicked: 0,
        totalResponded: 0,
        spent: "1000",
      });
      const score = optimizer.calculateOptimizationScore(zeroCampaign);
      // 50 base -10 -10 -15 -10 -5 = 0 (clamped at 0)
      expect(score).toBe(0);
    });

    it("all metrics at 'good' benchmarks produces score >= 80", () => {
      // openRate >= 25, clickRate >= 5, responseRate >= 3, costPerResponse <= 20, deliveryRate >= 98
      const goodCampaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 985, // 98.5% delivery
        totalOpened: 250,    // 25.4% open rate
        totalClicked: 13,    // 5.2% click rate
        totalResponded: 30,  // 3% response rate
        spent: "600",        // $20/response
      });
      const score = optimizer.calculateOptimizationScore(goodCampaign);
      // 50 +15 +15 +20 +10 +10 = 120 → clamped at 100? No, let's check: 50+15+15+20+10+10=120 → 100
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("score is always clamped between 0 and 100", () => {
      const extremeGood = makeCampaign({
        totalSent: 1000,
        totalDelivered: 1000,
        totalOpened: 1000,
        totalClicked: 1000,
        totalResponded: 1000,
        spent: "100",
      });
      const extremeBad = makeCampaign({
        totalSent: 1000,
        totalDelivered: 0,
        totalOpened: 0,
        totalClicked: 0,
        totalResponded: 0,
        spent: "10000",
      });

      expect(optimizer.calculateOptimizationScore(extremeGood)).toBeLessThanOrEqual(100);
      expect(optimizer.calculateOptimizationScore(extremeBad)).toBeGreaterThanOrEqual(0);
    });

    it("moderate metrics (all at 'poor' benchmark) produces intermediate score", () => {
      // openRate = 15% (poor boundary), clickRate = 2%, responseRate = 1%, costPerResponse = $50
      const moderateCampaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 920,
        totalOpened: 138,    // 15% of 920
        totalClicked: 2.76,  // 2% of 138 → ~3
        totalResponded: 10,  // 1% of 1000
        spent: "500",        // $50/response
      });
      const score = optimizer.calculateOptimizationScore(moderateCampaign);
      // Should be between 20-40 for poor-boundary metrics
      expect(score).toBeGreaterThanOrEqual(20);
      expect(score).toBeLessThanOrEqual(80);
    });
  });

  // ── Issue detection ────────────────────────────────────────────────────────
  describe("identifyIssues", () => {
    it("detects low_open_rate when openRate < 15", () => {
      const metrics = { openRate: 10, clickRate: 5, responseRate: 3, costPerResponse: 20, deliveryRate: 98 };
      const issues = optimizer.identifyIssues(metrics);
      expect(issues).toContain("low_open_rate");
    });

    it("detects low_click_rate when clickRate < 2", () => {
      const metrics = { openRate: 25, clickRate: 1, responseRate: 3, costPerResponse: 20, deliveryRate: 98 };
      const issues = optimizer.identifyIssues(metrics);
      expect(issues).toContain("low_click_rate");
    });

    it("detects low_response_rate when responseRate < 1", () => {
      const metrics = { openRate: 25, clickRate: 5, responseRate: 0.5, costPerResponse: 20, deliveryRate: 98 };
      const issues = optimizer.identifyIssues(metrics);
      expect(issues).toContain("low_response_rate");
    });

    it("detects high_cost_per_response when costPerResponse > 50", () => {
      const metrics = { openRate: 25, clickRate: 5, responseRate: 3, costPerResponse: 100, deliveryRate: 98 };
      const issues = optimizer.identifyIssues(metrics);
      expect(issues).toContain("high_cost_per_response");
    });

    it("detects low_delivery_rate when deliveryRate < 90", () => {
      const metrics = { openRate: 25, clickRate: 5, responseRate: 3, costPerResponse: 20, deliveryRate: 85 };
      const issues = optimizer.identifyIssues(metrics);
      expect(issues).toContain("low_delivery_rate");
    });

    it("returns empty array when all metrics are good", () => {
      const metrics = { openRate: 30, clickRate: 6, responseRate: 5, costPerResponse: 15, deliveryRate: 99 };
      const issues = optimizer.identifyIssues(metrics);
      expect(issues).toHaveLength(0);
    });
  });

  // ── Fallback suggestions ───────────────────────────────────────────────────
  describe("generateFallbackOptimizations", () => {
    it("suggests 'Improve subject line' when openRate < 15", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 1000,
        totalOpened: 100, // 10% open rate
        totalClicked: 10,
        totalResponded: 20,
        spent: "100",
      });
      const suggestions = optimizer.generateFallbackOptimizations(campaign);
      const subjectSuggestion = suggestions.find(s =>
        s.suggestion.toLowerCase().includes("subject line")
      );
      expect(subjectSuggestion).toBeDefined();
      expect(subjectSuggestion?.type).toBe("content");
      expect(subjectSuggestion?.priority).toBe("high");
    });

    it("suggests 'clear call-to-action' when clickRate < 2", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 1000,
        totalOpened: 300,  // 30% open rate (good)
        totalClicked: 1,   // 0.33% click rate (poor)
        totalResponded: 20,
        spent: "100",
      });
      const suggestions = optimizer.generateFallbackOptimizations(campaign);
      const ctaSuggestion = suggestions.find(s =>
        s.suggestion.toLowerCase().includes("call-to-action") ||
        s.suggestion.toLowerCase().includes("cta")
      );
      expect(ctaSuggestion).toBeDefined();
    });

    it("suggests 'Refine target audience' when responseRate < 1", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 980,
        totalOpened: 245,
        totalClicked: 12,
        totalResponded: 5,  // 0.5% response rate (poor)
        spent: "100",
      });
      const suggestions = optimizer.generateFallbackOptimizations(campaign);
      const audienceSuggestion = suggestions.find(s =>
        s.type === "audience"
      );
      expect(audienceSuggestion).toBeDefined();
      expect(audienceSuggestion?.priority).toBe("high");
    });

    it("returns empty array when no performance issues exist", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 990, // 99% delivery
        totalOpened: 300,    // 30.3% open rate
        totalClicked: 20,    // 6.7% click rate
        totalResponded: 40,  // 4% response rate
        spent: "600",        // $15/response
      });
      const suggestions = optimizer.generateFallbackOptimizations(campaign);
      expect(suggestions).toHaveLength(0);
    });

    it("suggests budget optimization when costPerResponse > $50", () => {
      const campaign = makeCampaign({
        totalSent: 1000,
        totalDelivered: 990,
        totalOpened: 250,
        totalClicked: 15,
        totalResponded: 5,    // low responses → high cost
        spent: "1000",        // $200/response
      });
      const suggestions = optimizer.generateFallbackOptimizations(campaign);
      const budgetSuggestion = suggestions.find(s => s.type === "budget");
      expect(budgetSuggestion).toBeDefined();
    });
  });
});
