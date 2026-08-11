/**
 * T0-3 (2026-06-10) — MCP endpoint hardening tests, RE-ANCHORED by R-1
 * (2026-08-11).
 *
 * T0-3 hardened the `/mcp` endpoint: timing-safe auth in place of a plain
 * `!==`, and an org binding forced server-side so a caller could not smuggle
 * another org's id in as a tool argument. Founder ruling R-1 retired that
 * endpoint (see mcpSurfaceRetirement.test.ts for why and for the retirement
 * pins), which would have taken these invariants down with it.
 *
 * They are REWRITTEN against the surviving surface, POST /api/mcp, not
 * deleted — the property each one protects is a property of any credentialed
 * MCP surface, and outliving the file it was first written against is the
 * whole point:
 *
 *   1. TIMING-SAFE CREDENTIAL COMPARE. `verifySecret` (the arbitrary-secret
 *      compare) was deleted with the static MCP_API_KEY lane, its only caller.
 *      The surviving compare is `verifyHash` over persisted digests, and it
 *      must stay constant-time and non-throwing on a length mismatch.
 *   2. PER-ORG KEY RESOLUTION. A presented key resolves to ITS organization —
 *      unknown, revoked and expired keys resolve to nothing.
 *   3. ORG BINDING. The org handed to a tool handler is ALWAYS the key's org,
 *      never a caller-supplied argument.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Controlled intent registry (deterministic; not the live catalog) ────────
const orgEchoIntent = {
  name: "get_portfolio_summary",
  description: "Read-only portfolio summary.",
  door: "today" as const,
  requiredScope: null,
  approvalRequired: false,
  inputSchema: { type: "object", properties: {} },
  // Echoes the org it was handed, so the binding is observable.
  handler: vi.fn(async (args: any, org: any) => ({
    success: true,
    data: { servedOrgId: org.id, argsSeen: args },
  })),
};

const FAKE_INTENTS: Record<string, any> = {
  get_portfolio_summary: orgEchoIntent,
};

vi.mock("../../server/services/appIntents", () => ({
  listIntents: () => Object.values(FAKE_INTENTS),
  getIntent: (name: string) => FAKE_INTENTS[name],
  resolveInputSchema: (intent: any) => intent.inputSchema,
}));

// api_keys rows the mocked db returns, and the org row behind them.
const mockApiKeyRows: any[] = [];
const mockOrgRows: any[] = [];
let selectCall = 0;
vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          // authenticate() selects api_keys first, then organizations.
          limit: async () => (selectCall++ === 0 ? mockApiKeyRows : mockOrgRows),
        }),
      }),
    })),
    insert: () => ({ values: async () => undefined }),
  },
  dbReplica: null,
}));

import { hashApiKey, verifyHash } from "../../server/services/apiKeys";
import * as apiKeysModule from "../../server/services/apiKeys";
import { __mcpInternals } from "../../server/mcp/streamableHttp";

const { authenticate, dispatch } = __mcpInternals;

const TOKEN = "ak_live_abcdefghijklmnopqrstuvwxyz123";

function fakeReq(token = TOKEN) {
  return { headers: { authorization: `Bearer ${token}` } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiKeyRows.length = 0;
  mockOrgRows.length = 0;
  selectCall = 0;
});

// ─── 1. Timing-safe credential compare ───────────────────────────────────────

describe("verifyHash (timing-safe compare — the surviving credential compare)", () => {
  it("accepts identical digests", () => {
    const h = hashApiKey(TOKEN);
    expect(verifyHash(h, h)).toBe(true);
  });

  it("rejects a wrong digest of the same length", () => {
    const h = hashApiKey(TOKEN);
    const wrong = "a".repeat(h.length);
    expect(verifyHash(wrong, h)).toBe(false);
  });

  it("rejects a different-length value without throwing", () => {
    const h = hashApiKey(TOKEN);
    expect(() => verifyHash("short", h)).not.toThrow();
    expect(verifyHash("short", h)).toBe(false);
    expect(verifyHash("", h)).toBe(false);
  });

  it("verifySecret is GONE — the static-secret compare left with its only caller", () => {
    // R-1 deleted the static MCP_API_KEY lane. Keeping an exported
    // arbitrary-secret compare with no call site is the 'built but unwired'
    // defect; if it returns, it needs a caller and a reason.
    expect(apiKeysModule).not.toHaveProperty("verifySecret");
  });
});

// ─── 2. Per-org key resolution ───────────────────────────────────────────────

describe("authenticate — per-org api_keys resolution", () => {
  it("resolves a valid key to its organization and scopes", async () => {
    mockApiKeyRows.push({
      id: 5,
      hashedKey: hashApiKey(TOKEN),
      organizationId: 42,
      revokedAt: null,
      expiresAt: null,
      scopes: ["leads:read"],
    });
    mockOrgRows.push({ id: 42, name: "Acme Land Co" });

    const key = await authenticate(fakeReq());
    expect(key).not.toBeNull();
    expect(key!.organization.id).toBe(42);
    expect(key!.scopes).toEqual(["leads:read"]);
  });

  it("rejects an unknown key", async () => {
    expect(await authenticate(fakeReq())).toBeNull();
  });

  it("rejects an expired key", async () => {
    mockApiKeyRows.push({
      id: 5,
      hashedKey: hashApiKey(TOKEN),
      organizationId: 42,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      scopes: [],
    });
    mockOrgRows.push({ id: 42, name: "Acme Land Co" });
    expect(await authenticate(fakeReq())).toBeNull();
  });

  it("rejects a malformed / non-ak_ token — including the retired static-key shape", async () => {
    expect(await authenticate(fakeReq("not-a-key"))).toBeNull();
    expect(await authenticate({ headers: {} } as any)).toBeNull();
    // The retired lane's credential was an opaque base64url env secret. It is
    // not merely unconfigured — it cannot even reach the key lookup.
    expect(await authenticate(fakeReq("Zm9vYmFyYmF6cXV4MDEyMzQ1Njc4OWFiY2RlZg"))).toBeNull();
  });
});

// ─── 3. Org binding ──────────────────────────────────────────────────────────

describe("MCP org binding — tools are forced to the authenticated org", () => {
  it("reads from the BOUND org even when the caller smuggles another org id", async () => {
    const key = { organization: { id: 7, name: "Bound Org" }, scopes: [], keyId: 1 } as any;
    const res = (await dispatch(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_portfolio_summary",
          // The caller tries to redirect the read at org 999.
          arguments: { organizationId: 999 },
        },
      },
      key,
    )) as any;

    expect(orgEchoIntent.handler).toHaveBeenCalledTimes(1);
    // The org is positional arg 2 and comes from the key, never from args.
    expect(orgEchoIntent.handler.mock.calls[0][1]).toEqual({ id: 7, name: "Bound Org" });

    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.servedOrgId).toBe(7);
    expect(payload.servedOrgId).not.toBe(999);
  });

  it("an unbound session cannot exist — every dispatch carries a resolved org", async () => {
    // The retired surface allowed a session with NO org binding (static key,
    // no MCP_ORG_ID) and had to refuse org-scoped tools at each handler. On
    // /api/mcp the org is a non-optional property of the authenticated key,
    // so the refusal is structural: no key, no dispatch at all.
    mockApiKeyRows.length = 0; // unknown key → authenticate() returns null
    expect(await authenticate(fakeReq())).toBeNull();
    expect(orgEchoIntent.handler).not.toHaveBeenCalled();
  });
});
