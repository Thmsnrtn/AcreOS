import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/storage", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  storage: {},
}));

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/services/emailService", () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe("RevenueAgent", () => {
  it("has correct name and feature flag", async () => {
    const { RevenueAgent } = await import("../../../server/agents/revenue");
    const agent = new RevenueAgent();
    expect(agent.name).toBe("revenue");
    expect(agent.featureFlag).toBe("agent_revenue");
  });

  it("runOnce completes without throwing", async () => {
    const { RevenueAgent } = await import("../../../server/agents/revenue");
    const agent = new RevenueAgent();
    await expect(agent.runOnce()).resolves.not.toThrow();
  });

  it("reports health correctly", async () => {
    const { RevenueAgent } = await import("../../../server/agents/revenue");
    const agent = new RevenueAgent();
    const health = agent.getHealth();
    expect(health.status).toBe("idle");
    expect(health.enabled).toBe(true);
  });
});
