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

describe("GrowthAgent", () => {
  it("has correct name and feature flag", async () => {
    const { GrowthAgent } = await import("../../../server/agents/growth");
    const agent = new GrowthAgent();
    expect(agent.name).toBe("growth");
    expect(agent.featureFlag).toBe("agent_growth");
  });

  it("runOnce completes without throwing", async () => {
    const { GrowthAgent } = await import("../../../server/agents/growth");
    const agent = new GrowthAgent();
    await expect(agent.runOnce()).resolves.not.toThrow();
  });

  it("gracefully degrades when email not configured", async () => {
    const { GrowthAgent } = await import("../../../server/agents/growth");
    const agent = new GrowthAgent();
    const result = await (agent as any).trySendEmail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result).toBe(false);
  });
});
