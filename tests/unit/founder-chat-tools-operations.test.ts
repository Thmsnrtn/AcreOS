/**
 * Phase G read-only operations tools — Fly batch.
 *
 * Stubs global.fetch so we exercise the tool registration + handler
 * pipeline without hitting the live Fly API. Verifies:
 *   - 4 tools register and are findable by slash alias
 *   - fly_status renders a sane text artifact
 *   - fly_secrets_list NEVER includes secret values (only names)
 *   - missing FLY_API_TOKEN degrades gracefully
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  getToolBySlashAlias,
} from "../../server/services/founder-chat/tool-registry";

let realFetch: typeof globalThis.fetch;
let realFlyToken: string | undefined;

beforeAll(async () => {
  __resetRegistryForTests();
  // Side-effect register against the live registry singleton — once.
  await import("../../server/services/founder-chat/tools/operations");
});

afterAll(() => {
  __resetRegistryForTests();
});

function stubFetchOk(payload: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof globalThis.fetch;
}

const FAKE_CTX = {
  founderUserId: "user_test",
  organizationId: 1,
  threadId: 1,
  recentMentions: [],
  auditLog: async () => {},
} as const;

beforeEach(() => {
  realFetch = globalThis.fetch;
  realFlyToken = process.env.FLY_API_TOKEN;
  process.env.FLY_API_TOKEN = "test_token";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realFlyToken === undefined) delete process.env.FLY_API_TOKEN;
  else process.env.FLY_API_TOKEN = realFlyToken;
  vi.restoreAllMocks();
});

describe("founder-chat operations tools — Stripe", () => {
  it("registers stripe_lookup_customer / stripe_customer_invoices / stripe_customer_subscriptions", () => {
    expect(getTool("stripe_lookup_customer")?.name).toBe("stripe_lookup_customer");
    expect(getTool("stripe_customer_invoices")?.name).toBe("stripe_customer_invoices");
    expect(getTool("stripe_customer_subscriptions")?.name).toBe("stripe_customer_subscriptions");
    expect(getToolBySlashAlias("customer")?.name).toBe("stripe_lookup_customer");
  });

  it("stripe_lookup_customer rejects too-short queries via the Zod schema", () => {
    const tool = getTool("stripe_lookup_customer")!;
    const result = tool.schema.safeParse({ query: "ab" });
    expect(result.success).toBe(false);
  });

  it("stripe_customer_invoices rejects malformed customer ids", () => {
    const tool = getTool("stripe_customer_invoices")!;
    expect(tool.schema.safeParse({ customerId: "not_a_customer", limit: 5 }).success).toBe(false);
    expect(tool.schema.safeParse({ customerId: "cus_abcd1234", limit: 5 }).success).toBe(true);
  });
});

describe("founder-chat operations tools — Fly", () => {
  it("registers fly_status / fly_releases / fly_machines / fly_secrets_list", async () => {
    expect(getTool("fly_status")?.name).toBe("fly_status");
    expect(getTool("fly_releases")?.name).toBe("fly_releases");
    expect(getTool("fly_machines")?.name).toBe("fly_machines");
    expect(getTool("fly_secrets_list")?.name).toBe("fly_secrets_list");

    expect(getToolBySlashAlias("fly")?.name).toBe("fly_status");
    expect(getToolBySlashAlias("releases")?.name).toBe("fly_releases");
    expect(getToolBySlashAlias("machines")?.name).toBe("fly_machines");
    expect(getToolBySlashAlias("secrets")?.name).toBe("fly_secrets_list");
  });

  it("fly_status renders machine-state breakdown from the API payload", async () => {
    stubFetchOk([
      { id: "m1", name: "app", region: "iad", state: "started", created_at: new Date(Date.now() - 3_600_000).toISOString() },
      { id: "m2", name: "app", region: "iad", state: "started" },
      { id: "m3", name: "worker", region: "iad", state: "stopped" },
    ]);

    const tool = getTool("fly_status")!;
    const result = await tool.handler({}, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/started \(2\)/);
      expect(result.artifact.markdown).toMatch(/stopped \(1\)/);
      expect(result.artifact.markdown).toMatch(/iad/);
    }
  });

  it("fly_secrets_list returns names only — never any value-looking field", async () => {
    stubFetchOk([
      { name: "STRIPE_SECRET_KEY", created_at: "2025-09-01" },
      { name: "CLERK_SECRET_KEY", created_at: "2025-09-01" },
      { name: "SOMETHING_ELSE" },
    ]);

    const tool = getTool("fly_secrets_list")!;
    const result = await tool.handler({}, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      const md = result.artifact.markdown;
      expect(md).toMatch(/STRIPE_SECRET_KEY/);
      expect(md).toMatch(/Values are never returned/);
      // Sanity — nothing that looks like a secret value should leak.
      expect(md).not.toMatch(/sk_live/);
      expect(md).not.toMatch(/whsec_/);
    }
  });

  it("fly_machines degrades gracefully on 503 (missing token)", async () => {
    delete process.env.FLY_API_TOKEN;
    const tool = getTool("fly_machines")!;
    const result = await tool.handler({}, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/Fly machines unavailable/);
    }
  });
});
