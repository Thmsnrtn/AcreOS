import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock at the path agents use (relative to server/agents/)
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

describe("CustomerSuccessAgent", () => {
  it("has correct name and feature flag", async () => {
    const { CustomerSuccessAgent } = await import("../../../server/agents/customer-success");
    const agent = new CustomerSuccessAgent();
    expect(agent.name).toBe("customer_success");
    expect(agent.featureFlag).toBe("agent_customer_success");
  });

  it("runOnce completes without throwing when no data", async () => {
    const { CustomerSuccessAgent } = await import("../../../server/agents/customer-success");
    const agent = new CustomerSuccessAgent();
    await expect(agent.runOnce()).resolves.not.toThrow();
  });

  it("gracefully degrades when email not configured", async () => {
    const { CustomerSuccessAgent } = await import("../../../server/agents/customer-success");
    const agent = new CustomerSuccessAgent();
    const result = await (agent as any).trySendEmail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result).toBe(false);
  });

  it("reports correct health status", async () => {
    const { CustomerSuccessAgent } = await import("../../../server/agents/customer-success");
    const agent = new CustomerSuccessAgent();
    const health = agent.getHealth();
    expect(health.name).toBe("customer_success");
    expect(health.status).toBe("idle");
    expect(health.runCount).toBe(0);
  });

  it("can be enabled and disabled", async () => {
    const { CustomerSuccessAgent } = await import("../../../server/agents/customer-success");
    const agent = new CustomerSuccessAgent();
    agent.setEnabled(false);
    expect(agent.getHealth().enabled).toBe(false);
    agent.setEnabled(true);
    expect(agent.getHealth().enabled).toBe(true);
  });
});
