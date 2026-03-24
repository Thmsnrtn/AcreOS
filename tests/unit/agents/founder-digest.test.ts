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

describe("FounderDigestAgent", () => {
  it("has correct name and feature flag", async () => {
    const { FounderDigestAgent } = await import("../../../server/agents/founder-digest");
    const agent = new FounderDigestAgent();
    expect(agent.name).toBe("digest");
    expect(agent.featureFlag).toBe("agent_digest");
  });

  it("runOnce completes without throwing", async () => {
    const { FounderDigestAgent } = await import("../../../server/agents/founder-digest");
    const agent = new FounderDigestAgent();
    await expect(agent.runOnce()).resolves.not.toThrow();
  });

  it("runs every hour", async () => {
    const { FounderDigestAgent } = await import("../../../server/agents/founder-digest");
    const agent = new FounderDigestAgent();
    expect(agent.intervalMs).toBe(60 * 60 * 1000);
  });

  it("gracefully degrades when email not configured", async () => {
    const { FounderDigestAgent } = await import("../../../server/agents/founder-digest");
    const agent = new FounderDigestAgent();
    const result = await (agent as any).trySendEmail({
      to: "test@example.com",
      subject: "Digest",
      html: "<p>Test</p>",
    });
    expect(result).toBe(false);
  });
});
