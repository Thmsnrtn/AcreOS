/**
 * T0-3 (2026-06-10) — MCP endpoint hardening tests.
 *
 * Covers:
 *   1. Timing-safe static-key auth (verifySecret + resolveMcpAuth): the
 *      right key is accepted, wrong keys (including different-length keys)
 *      are rejected without throwing.
 *   2. Per-org api_keys path resolves the key to ITS org.
 *   3. Org binding: org-scoped MCP tools no longer accept an
 *      organizationId argument — the bound org is injected server-side,
 *      a caller-supplied org id is ignored, and an unbound session is
 *      refused.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks for the heavy transitive imports of server/mcp/index.ts ─────────
vi.mock("../../server/storage", () => ({
  storage: {
    getProperties: vi.fn(async () => []),
    getProperty: vi.fn(async () => undefined),
    getLeads: vi.fn(async () => []),
    getDeals: vi.fn(async () => []),
    getNotes: vi.fn(async () => []),
    getOrganization: vi.fn(async () => undefined),
  },
}));
vi.mock("../../server/services/data-source-broker", () => ({
  dataSourceBroker: { lookup: vi.fn(async () => ({ data: {}, source: { title: "mock" } })) },
}));
vi.mock("../../server/services/propertyEnrichment", () => ({
  propertyEnrichmentService: { enrichByCoordinates: vi.fn(async () => ({})) },
}));

// db is only touched by the ak_… auth path — mocked select chain below.
const mockApiKeyRows: any[] = [];
vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => mockApiKeyRows,
        }),
      }),
    })),
  },
}));

import { verifySecret, hashApiKey } from "../../server/services/apiKeys";
import { resolveMcpAuth } from "../../server/mcp/auth";
import { createMcpServer } from "../../server/mcp/index";
import { storage } from "../../server/storage";

const STATIC_KEY = "test-mcp-static-key-0123456789abcdef";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mockApiKeyRows.length = 0;
});

describe("verifySecret (timing-safe compare)", () => {
  it("accepts identical secrets", () => {
    expect(verifySecret(STATIC_KEY, STATIC_KEY)).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    const wrong = "x".repeat(STATIC_KEY.length);
    expect(verifySecret(wrong, STATIC_KEY)).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(() => verifySecret("short", STATIC_KEY)).not.toThrow();
    expect(verifySecret("short", STATIC_KEY)).toBe(false);
    expect(verifySecret("", STATIC_KEY)).toBe(false);
  });
});

describe("resolveMcpAuth — static MCP_API_KEY path", () => {
  it("accepts the right key and binds MCP_ORG_ID", async () => {
    vi.stubEnv("MCP_API_KEY", STATIC_KEY);
    vi.stubEnv("MCP_ORG_ID", "17");
    const result = await resolveMcpAuth(`Bearer ${STATIC_KEY}`);
    expect(result).toEqual({ status: "ok", organizationId: 17 });
  });

  it("accepts the right key with no MCP_ORG_ID → null binding", async () => {
    vi.stubEnv("MCP_API_KEY", STATIC_KEY);
    vi.stubEnv("MCP_ORG_ID", "");
    const result = await resolveMcpAuth(`Bearer ${STATIC_KEY}`);
    expect(result).toEqual({ status: "ok", organizationId: null });
  });

  it("rejects a wrong key", async () => {
    vi.stubEnv("MCP_API_KEY", STATIC_KEY);
    const result = await resolveMcpAuth("Bearer not-the-key");
    expect(result.status).toBe("unauthorized");
  });

  it("rejects a missing/malformed Authorization header", async () => {
    vi.stubEnv("MCP_API_KEY", STATIC_KEY);
    expect((await resolveMcpAuth("")).status).toBe("unauthorized");
    expect((await resolveMcpAuth("Basic abc")).status).toBe("unauthorized");
  });

  it("returns unconfigured when MCP_API_KEY is unset", async () => {
    vi.stubEnv("MCP_API_KEY", "");
    const result = await resolveMcpAuth("Bearer anything");
    expect(result.status).toBe("unconfigured");
  });
});

describe("resolveMcpAuth — per-org api_keys path", () => {
  const TOKEN = "ak_live_abcdefghijklmnopqrstuvwxyz123";

  it("resolves a valid key to its organization", async () => {
    mockApiKeyRows.push({
      hashedKey: hashApiKey(TOKEN),
      organizationId: 42,
      revokedAt: null,
      expiresAt: null,
    });
    const result = await resolveMcpAuth(`Bearer ${TOKEN}`);
    expect(result).toEqual({ status: "ok", organizationId: 42 });
  });

  it("rejects an unknown key", async () => {
    const result = await resolveMcpAuth(`Bearer ${TOKEN}`);
    expect(result.status).toBe("unauthorized");
  });

  it("rejects an expired key", async () => {
    mockApiKeyRows.push({
      hashedKey: hashApiKey(TOKEN),
      organizationId: 42,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = await resolveMcpAuth(`Bearer ${TOKEN}`);
    expect(result.status).toBe("unauthorized");
  });
});

describe("MCP org binding — tools are forced to the authenticated org", () => {
  const getTool = (server: any, name: string) =>
    (server as any)._registeredTools[name];

  it("org-scoped tool schemas no longer expose organizationId", () => {
    const server = createMcpServer({ organizationId: 1 });
    for (const name of [
      "search_properties",
      "get_property",
      "search_leads",
      "get_deals",
      "get_portfolio_summary",
    ]) {
      const reg = getTool(server, name);
      expect(reg, `tool ${name} should be registered`).toBeTruthy();
      const shape = reg.inputSchema?.shape ?? {};
      expect(Object.keys(shape)).not.toContain("organizationId");
    }
  });

  it("reads from the BOUND org even when the caller smuggles another org id", async () => {
    const server = createMcpServer({ organizationId: 7 });
    const reg = getTool(server, "search_properties");
    // Caller attempts to read org 999 — the argument no longer exists in the
    // schema, and the handler must use the session binding regardless.
    const result = await reg.handler({ organizationId: 999, limit: 5 }, {});
    expect(result.isError).toBeFalsy();
    expect(storage.getProperties).toHaveBeenCalledTimes(1);
    expect(storage.getProperties).toHaveBeenCalledWith(7);
  });

  it("refuses org-scoped tools when the session has no org binding", async () => {
    const server = createMcpServer();
    const reg = getTool(server, "search_properties");
    const result = await reg.handler({ limit: 5 }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not bound to an organization/i);
    expect(storage.getProperties).not.toHaveBeenCalled();
  });

  it("public-data tools still work without an org binding", async () => {
    const server = createMcpServer();
    const reg = getTool(server, "get_flood_zone");
    const result = await reg.handler({ latitude: 35.1, longitude: -106.6 }, {});
    expect(result.isError).toBeFalsy();
  });
});
