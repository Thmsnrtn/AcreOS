/**
 * Tahoe E12 — MCP Streamable HTTP endpoint tests.
 *
 * Proves the three security-critical behaviours of the external MCP surface:
 *   1. tools/list returns ONLY the safe, read-mostly subset of the App Intent
 *      registry, further filtered to what the calling key's scopes allow.
 *   2. tools/call REJECTS an unauthenticated request (transport-level 401) and
 *      an over-privileged call (a tool the key's scopes don't authorize).
 *   3. tools/call RUNS an allowed intent with the authed org and returns the
 *      MCP result shape.
 *
 * We mock the App Intent registry with a controlled set of intents (one
 * read-only allowed, one read-only requiring a scope the key lacks, one
 * write/approval intent that must be invisible) so the assertions are
 * deterministic and don't depend on the live catalog. We mock ../../server/db
 * so importing the handler doesn't open a Postgres pool.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Controlled intent registry ───────────────────────────────────────────────
// Three intents exercise the full safety matrix.
const readAllowed = {
  name: "get_portfolio_summary",
  description: "Read-only portfolio summary.",
  door: "today" as const,
  requiredScope: null, // ungated read → always callable
  approvalRequired: false,
  inputSchema: { type: "object", properties: {} },
  handler: vi.fn(async (_args: any, org: any) => ({
    success: true,
    data: { orgId: org.id, totalLeads: 3 },
  })),
};

const readScoped = {
  name: "get_leads",
  description: "Read leads (requires a leads/deals read scope).",
  door: "deals" as const,
  requiredScope: "deal_read" as const, // → deals:read | leads:read
  approvalRequired: false,
  inputSchema: { type: "object", properties: { status: { type: "string" } } },
  handler: vi.fn(async () => ({ success: true, data: [] })),
};

const writeUnsafe = {
  name: "create_lead",
  description: "Create a lead — MUST NOT be exposed to external agents.",
  door: "deals" as const,
  requiredScope: "deal_write" as const, // write → excluded by safe filter
  approvalRequired: false,
  inputSchema: { type: "object", properties: {} },
  handler: vi.fn(async () => ({ success: true, data: { id: 99 } })),
};

const FAKE_INTENTS: Record<string, any> = {
  get_portfolio_summary: readAllowed,
  get_leads: readScoped,
  create_lead: writeUnsafe,
};

vi.mock("../../server/services/appIntents", () => ({
  listIntents: () => Object.values(FAKE_INTENTS),
  getIntent: (name: string) => FAKE_INTENTS[name],
  resolveInputSchema: (intent: any) => intent.inputSchema,
}));

// Avoid opening a real DB pool when the handler module is imported.
vi.mock("../../server/db", () => ({ db: {}, dbReplica: null }));
vi.mock("../../server/services/apiKeys", () => ({
  hashApiKey: (s: string) => `hashed:${s}`,
  verifyHash: (a: string, b: string) => a === b,
}));

// Import AFTER the mocks are registered.
import { __mcpInternals } from "../../server/mcp/streamableHttp";
import {
  listExternalSafeIntents,
  keyMaySatisfyIntent,
  isExternalSafeIntent,
} from "../../server/mcp/safeIntents";

const { dispatch, MCP_FORBIDDEN, JSONRPC_METHOD_NOT_FOUND, PROTOCOL_VERSION } = __mcpInternals;

const ORG = { id: 42, name: "Acme Land Co" } as any;

// A key that can read leads/deals but holds no write scope.
const readKey = { organization: ORG, scopes: ["leads:read", "deals:read"] };
// A key with NO scopes — only ungated reads should be callable.
const noScopeKey = { organization: ORG, scopes: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MCP safe-intent subset", () => {
  it("excludes write/approval intents from the external surface", () => {
    const safe = listExternalSafeIntents().map((i) => i.name);
    expect(safe).toContain("get_portfolio_summary");
    expect(safe).toContain("get_leads");
    // The write intent must NEVER appear.
    expect(safe).not.toContain("create_lead");
    expect(isExternalSafeIntent(writeUnsafe)).toBe(false);
  });

  it("maps role-scope to API scope for authorization", () => {
    // Ungated read is always satisfiable.
    expect(keyMaySatisfyIntent(readAllowed, [])).toBe(true);
    // deal_read on the deals door needs deals:read OR leads:read.
    expect(keyMaySatisfyIntent(readScoped, ["leads:read"])).toBe(true);
    expect(keyMaySatisfyIntent(readScoped, ["notes:read"])).toBe(false);
  });
});

describe("MCP dispatch — initialize", () => {
  it("returns the protocol handshake", async () => {
    const res = (await dispatch(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      readKey,
    )) as any;
    expect(res.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(res.result.serverInfo.name).toBe("acreos");
    expect(res.result.capabilities.tools).toBeDefined();
  });
});

describe("MCP dispatch — tools/list", () => {
  it("returns the safe subset the key's scopes can invoke", async () => {
    const res = (await dispatch(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      readKey,
    )) as any;
    const names = res.result.tools.map((t: any) => t.name).sort();
    // Both safe reads are callable with leads:read+deals:read; write excluded.
    expect(names).toEqual(["get_leads", "get_portfolio_summary"]);
    // Each tool carries the MCP { name, description, inputSchema } shape.
    for (const t of res.result.tools) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("inputSchema");
    }
  });

  it("hides scoped tools the key cannot invoke", async () => {
    const res = (await dispatch(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      noScopeKey,
    )) as any;
    const names = res.result.tools.map((t: any) => t.name);
    // No scopes → only the ungated read is visible.
    expect(names).toEqual(["get_portfolio_summary"]);
  });
});

describe("MCP dispatch — tools/call", () => {
  it("runs an allowed intent with the authed org and returns the MCP result", async () => {
    const res = (await dispatch(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_portfolio_summary", arguments: {} },
      },
      readKey,
    )) as any;
    // The handler must have received the KEY's org — never a caller-supplied one.
    expect(readAllowed.handler).toHaveBeenCalledTimes(1);
    expect(readAllowed.handler.mock.calls[0][1]).toBe(ORG);
    // MCP CallToolResult shape: content[].text, isError false.
    expect(res.result.isError).toBe(false);
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload).toEqual({ orgId: 42, totalLeads: 3 });
  });

  it("rejects an over-privileged call (key lacks the required scope)", async () => {
    const res = (await dispatch(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_leads", arguments: {} },
      },
      noScopeKey, // has no leads:read / deals:read
    )) as any;
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(MCP_FORBIDDEN);
    // The handler must NOT have run.
    expect(readScoped.handler).not.toHaveBeenCalled();
  });

  it("refuses to call a write/unsafe intent even by name", async () => {
    const res = (await dispatch(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "create_lead", arguments: {} },
      },
      readKey,
    )) as any;
    // Treated as unknown — does not reveal that the unsafe intent exists.
    expect(res.error.code).toBe(JSONRPC_METHOD_NOT_FOUND);
    expect(writeUnsafe.handler).not.toHaveBeenCalled();
  });

  it("returns method-not-found for an unknown tool", async () => {
    const res = (await dispatch(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "definitely_not_a_tool", arguments: {} },
      },
      readKey,
    )) as any;
    expect(res.error.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });
});

describe("MCP authenticate — unauthenticated rejection", () => {
  it("returns null when no Bearer token is present", async () => {
    const result = await __mcpInternals.authenticate({ headers: {} } as any);
    expect(result).toBeNull();
  });

  it("returns null for a malformed (non-ak_) token", async () => {
    const result = await __mcpInternals.authenticate({
      headers: { authorization: "Bearer not-an-api-key" },
    } as any);
    expect(result).toBeNull();
  });
});
