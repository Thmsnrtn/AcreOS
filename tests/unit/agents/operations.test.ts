import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/storage", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  storage: {},
}));

vi.mock("../../../server/services/emailService", () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../../../server/services/dataQualityMonitor", () => ({
  runHealthProbe: vi.fn().mockResolvedValue([
    { name: "FEMA", status: "up", latencyMs: 100 },
    { name: "Census", status: "up", latencyMs: 200 },
  ]),
  getLatestHealth: vi.fn().mockReturnValue([
    { name: "FEMA", status: "up" },
  ]),
}));

vi.mock("../../../server/services/healthCheck", () => ({
  healthCheckService: {
    checkAll: vi.fn().mockResolvedValue({
      overall: "healthy",
      services: [{ name: "database", status: "healthy" }],
    }),
  },
}));

describe("OperationsAgent", () => {
  it("has correct name and feature flag", async () => {
    const { OperationsAgent } = await import("../../../server/agents/operations");
    const agent = new OperationsAgent();
    expect(agent.name).toBe("operations");
    expect(agent.featureFlag).toBe("agent_operations");
  });

  it("runOnce completes without throwing", async () => {
    const { OperationsAgent } = await import("../../../server/agents/operations");
    const agent = new OperationsAgent();
    await expect(agent.runOnce()).resolves.not.toThrow();
  });

  it("runs every 15 minutes", async () => {
    const { OperationsAgent } = await import("../../../server/agents/operations");
    const agent = new OperationsAgent();
    expect(agent.intervalMs).toBe(15 * 60 * 1000);
  });
});
