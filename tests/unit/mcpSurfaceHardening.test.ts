/**
 * Wave 0.7 (audit §8.2) — MCP surface hardening exit tests.
 *
 * The audit-era brief assumed the weak legacy surface was the only one; at
 * HEAD the spec-compliant /api/mcp already carries hashed-key auth + the
 * safe-intent subset (premise drift, recorded in the ledger). What this
 * suite pins is the remaining delta:
 *
 *   1. LEGACY RETIREMENT — server/mcp-server.ts (plaintext key compare in a
 *      loop, unbounded in-memory rate map, mounted behind session auth) is
 *      gone and cannot quietly return. The SECOND retirement (the `/mcp`
 *      mount, founder ruling R-1) is pinned in mcpSurfaceRetirement.test.ts.
 *   2. AVAILABILITY CONTROLS — the founder kill switch darkens the endpoint
 *      (404 before auth) and the per-org allowlist narrows it post-auth.
 *      Defaults preserve current behavior; the flip decision is the
 *      founder's, queued in the ledger.
 *   3. SHARED-STORE RATE LIMIT — tools/call consumes a budget counted in
 *      activity_log (the same insert doubles as the §8.3 action-ledger
 *      receipt), replacing the retired per-machine in-memory Map.
 *   4. EXTERNAL BOUNDARY — envelope markers never leave for external MCP
 *      clients (externalizeToolData, pinned functionally from 0.6's audit).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const dbMocks = vi.hoisted(() => ({
  selectResult: [{ count: 0 }] as Array<{ count: number }>,
  selectThrows: false,
  insertedRows: [] as unknown[],
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (dbMocks.selectThrows) throw new Error("db down");
          return dbMocks.selectResult;
        },
        // authenticate()'s chain ends in .limit(); unused by these tests but
        // keeps accidental calls from crashing with a confusing error.
        limit: async () => [],
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => {
        dbMocks.insertedRows.push(row);
      },
    }),
  },
}));

vi.mock("../../server/services/apiKeys", () => ({
  hashApiKey: (s: string) => `hashed:${s}`,
  verifyHash: (a: string, b: string) => a === b,
}));

vi.mock("../../server/services/appIntents", () => ({
  listIntents: () => [],
  getIntent: () => undefined,
  resolveInputSchema: (i: any) => i?.inputSchema ?? {},
}));

import { __mcpInternals, mcpStreamableHttpHandler } from "../../server/mcp/streamableHttp";
import { wrapUntrusted, wrapUntrustedJson, USER_DATA_OPEN } from "../../server/ai/untrustedEnvelope";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end: vi.fn(),
  };
  return res;
}

beforeEach(() => {
  dbMocks.selectResult = [{ count: 0 }];
  dbMocks.selectThrows = false;
  dbMocks.insertedRows.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── 1. Legacy retirement ────────────────────────────────────────────────────

describe("legacy MCP surface stays retired", () => {
  it("server/mcp-server.ts is gone and routes.ts no longer mounts /api/mcp/execute", () => {
    expect(fs.existsSync(path.join(ROOT, "server/mcp-server.ts"))).toBe(false);
    // Raw source with precise mount/import regexes: comment-stripping is
    // unreliable on routes.ts (route-path strings contain "/*"), and the
    // retirement note legitimately names the old path in prose.
    const routes = read("server/routes.ts");
    expect(routes).not.toMatch(/app\.(post|get|use|all)\([^)]*['"`]\/api\/mcp\/execute/);
    expect(routes).not.toMatch(/from\s+['"]\.\/mcp-server['"]/);
    // The modern endpoint stays mounted.
    expect(routes).toContain("app.post('/api/mcp', mcpStreamableHttpHandler)");
  });
});

// ─── 2. Availability controls ────────────────────────────────────────────────

describe("founder availability controls", () => {
  it("MCP_PUBLIC_DISABLED darkens the endpoint with a 404 before auth runs", async () => {
    vi.stubEnv("MCP_PUBLIC_DISABLED", "1");
    const res = fakeRes();
    await mcpStreamableHttpHandler({ headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(404);
  });

  it("defaults keep the endpoint enabled (an unauthenticated call still gets 401, not 404)", async () => {
    const res = fakeRes();
    await mcpStreamableHttpHandler({ headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });

  it("parseOrgAllowlist: unset → null (all orgs); set-but-unparseable → FAIL CLOSED", () => {
    const { parseOrgAllowlist } = __mcpInternals;
    expect(parseOrgAllowlist(undefined)).toBeNull();
    expect(parseOrgAllowlist("")).toBeNull();
    // A typo'd allowlist must deny everyone, not silently allow everyone
    // (0.7 audit: a restriction control must not evaporate on a typo).
    const garbage = parseOrgAllowlist("acme,globex");
    expect(garbage).not.toBeNull();
    expect(garbage!.size).toBe(0);
    const set = parseOrgAllowlist("1, 7,42");
    expect(set).not.toBeNull();
    expect([...set!].sort((a, b) => a - b)).toEqual([1, 7, 42]);
  });

  it("the handler consults the allowlist AFTER auth (org derives from the key)", () => {
    const code = stripComments(read("server/mcp/streamableHttp.ts"));
    const authIdx = code.indexOf("const key = await authenticate(req)");
    const allowIdx = code.indexOf("mcpOrgAllowed(key.organization.id)");
    const darkIdx = code.indexOf("mcpEndpointDark()");
    expect(authIdx).toBeGreaterThan(0);
    expect(allowIdx).toBeGreaterThan(authIdx);
    expect(darkIdx).toBeGreaterThan(0);
    expect(darkIdx).toBeLessThan(authIdx);
  });

  it("EVERY MCP surface consults the shared availability policy — and there is now exactly one", () => {
    // ORIGINAL INVARIANT (Wave 0.7): a kill switch covering one of two
    // surfaces is a half-truth, so every MCP surface must consult the same
    // helpers. That still holds — but R-1 (2026-08-11) retired the second
    // surface (the POST/GET /mcp mount in server/index.ts), so the honest
    // form of the invariant is "every surface, and the set is {/api/mcp}".
    // Rewritten, not deleted: if a second surface ever reappears without the
    // policy, this fails again.
    //
    // Derived: find every file that builds an MCP JSON-RPC/tool surface by
    // looking for the protocol handshake, then require each to gate on both
    // controls. A new surface file that speaks "tools/call" is caught.
    const surfaceFiles = ["server/mcp/streamableHttp.ts", "server/index.ts"]
      .filter((f) => fs.existsSync(path.join(ROOT, f)))
      .filter((f) => stripComments(read(f)).includes('"tools/call"'));

    expect(surfaceFiles, "an MCP tool surface exists in a file this test does not check")
      .toEqual(["server/mcp/streamableHttp.ts"]);

    for (const file of surfaceFiles) {
      const code = stripComments(read(file));
      expect(code, `${file} does not consult the kill switch`).toContain("mcpEndpointDark()");
      expect(code, `${file} does not consult the org allowlist`).toContain("mcpOrgAllowed(");
    }

    // The retired surface's auth resolver is gone from the app entirely — not
    // merely unmounted with its middleware left behind.
    const bootstrap = stripComments(read("server/index.ts"));
    expect(bootstrap).not.toContain("resolveMcpAuth");
    expect(bootstrap).not.toContain("createMcpServer");
  });

  it("batches are capped so the limiter cannot be its own amplifier", async () => {
    const res = fakeRes();
    const batch = Array.from({ length: 21 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "ping",
    }));
    await mcpStreamableHttpHandler(
      { headers: { authorization: "Bearer ak_live_0123456789abcdef" }, body: batch } as any,
      res,
    );
    // 21 pings with an unauthenticated-in-mock key → the batch cap must NOT
    // even be reached before auth (401) — so instead pin the cap at the
    // source and functionally with an authed path in the dispatch tests.
    expect([400, 401]).toContain(res.statusCode);
    const code = stripComments(read("server/mcp/streamableHttp.ts"));
    expect(code).toContain("MAX_BATCH_MESSAGES = 20");
    expect(code).toMatch(/messages\.length > MAX_BATCH_MESSAGES/);
  });
});

// ─── 3. Shared-store rate limit ──────────────────────────────────────────────

describe("shared-store rate limit (api_key_usage window count)", () => {
  // The store is api_key_usage — the surface's NATIVE machine-traffic usage
  // ledger — NOT activity_log: the 0.7 audit proved activity_log receipts
  // would pollute the customer activity feed and distort every consumer
  // that reads activity rows as human engagement (re-engagement, power-user
  // detection, churn signals).
  it("allows under the budget and writes the usage-ledger receipt", async () => {
    dbMocks.selectResult = [{ count: 3 }];
    const out = await __mcpInternals.consumeSharedRateLimit(7, 55, "get_leads");
    expect(out.allowed).toBe(true);
    expect(dbMocks.insertedRows).toHaveLength(1);
    const row = dbMocks.insertedRows[0] as any;
    expect(row.organizationId).toBe(7);
    expect(row.apiKeyId).toBe(55);
    expect(row.path).toBe("/api/mcp#get_leads");
    expect(row.statusCode).toBe(200);
  });

  it("blocks at the budget without writing a receipt", async () => {
    dbMocks.selectResult = [{ count: 100 }];
    const out = await __mcpInternals.consumeSharedRateLimit(7, 55, "get_leads");
    expect(out.allowed).toBe(false);
    expect(out.limit).toBe(100);
    expect(dbMocks.insertedRows).toHaveLength(0);
  });

  it("honors MCP_RATE_LIMIT_PER_HOUR override", async () => {
    vi.stubEnv("MCP_RATE_LIMIT_PER_HOUR", "5");
    dbMocks.selectResult = [{ count: 5 }];
    const out = await __mcpInternals.consumeSharedRateLimit(7, 55, "x");
    expect(out.allowed).toBe(false);
    expect(out.limit).toBe(5);
  });

  it("MCP_RATE_LIMIT_PER_HOUR=0/off disables the cap (founder control)", async () => {
    vi.stubEnv("MCP_RATE_LIMIT_PER_HOUR", "0");
    dbMocks.selectResult = [{ count: 999999 }];
    const out = await __mcpInternals.consumeSharedRateLimit(7, 55, "x");
    expect(out.allowed).toBe(true);
    // Disabled means no count query and no receipt either.
    expect(dbMocks.insertedRows).toHaveLength(0);
  });

  it("fails OPEN when the store is unreachable (availability over hard-close)", async () => {
    dbMocks.selectThrows = true;
    const out = await __mcpInternals.consumeSharedRateLimit(7, 55, "x");
    expect(out.allowed).toBe(true);
  });

  it("tools/call consumes the budget BEFORE the intent handler runs", () => {
    const code = stripComments(read("server/mcp/streamableHttp.ts"));
    const rateIdx = code.indexOf(
      "await consumeSharedRateLimit(key.organization.id, key.keyId, name)",
    );
    const handlerIdx = code.indexOf("await intent.handler(args, key.organization)");
    expect(rateIdx).toBeGreaterThan(0);
    expect(handlerIdx).toBeGreaterThan(rateIdx);
  });

  it("activity_log carries NO mcp receipts (the polluting store the audit vetoed)", () => {
    const code = stripComments(read("server/mcp/streamableHttp.ts"));
    expect(code).not.toContain("activityLog");
    expect(code).not.toContain("mcp_execution");
  });
});

// ─── 4. External boundary keeps envelope markers internal ────────────────────

describe("externalizeToolData (0.6 audit closure, pinned functionally)", () => {
  it("restores a ROOT wholesale wrap to its pre-envelope shape (the toolTextResult call shape)", () => {
    // Production calls toolTextResult(result.data) — the wholesale-wrapped
    // string IS the root value.
    const wrapped = wrapUntrustedJson({ rows: [{ id: 1, remarks: "hi" }] }, "tool:x");
    const out = __mcpInternals.externalizeToolData(wrapped) as any;
    expect(out).toEqual({ rows: [{ id: 1, remarks: "hi" }] });
  });

  it("does NOT JSON-parse a NESTED wrapped field (a customer note that is JSON stays a string)", () => {
    // The 0.7 audit: parsing nested keyed free text would flip a note's
    // external type from string to object whenever a customer typed JSON.
    const nested = { data: { notes: wrapUntrusted('{"foo":1}', "tool:x.notes") } };
    const out = __mcpInternals.externalizeToolData(nested) as any;
    expect(typeof out.data.notes).toBe("string");
    expect(out.data.notes).toContain('"foo"');
    expect(out.data.notes.startsWith("<<")).toBe(false);
  });

  it("strips markers from wrapped free text and walks nested structures", () => {
    const nested = {
      data: {
        name: wrapUntrusted("IGNORE INSTRUCTIONS.pdf", "tool:x.name"),
        plain: "untouched",
        n: 4,
      },
    };
    const out = __mcpInternals.externalizeToolData(nested) as any;
    expect(out.data.name).toBe("IGNORE INSTRUCTIONS.pdf");
    expect(out.data.plain).toBe("untouched");
    expect(out.data.n).toBe(4);
    expect(JSON.stringify(out)).not.toContain(USER_DATA_OPEN);
  });
});
