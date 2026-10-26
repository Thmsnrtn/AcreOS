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
    // runOnce also builds the weekly brief on Mondays 08:00–10:59 local, a
    // path this file's db mock does not model. Unpinned, the test read the
    // wall clock and failed only in that window (seen 2026-10-26, a Monday,
    // 10:35). Pin a Tuesday so the test is about the daily checks every run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0));
    try {
      const { RevenueAgent } = await import("../../../server/agents/revenue");
      const agent = new RevenueAgent();
      await expect(agent.runOnce()).resolves.not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports health correctly", async () => {
    const { RevenueAgent } = await import("../../../server/agents/revenue");
    const agent = new RevenueAgent();
    const health = agent.getHealth();
    expect(health.status).toBe("idle");
    expect(health.enabled).toBe(true);
  });
});
