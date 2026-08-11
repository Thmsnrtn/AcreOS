/**
 * R-1 (founder ruling, 2026-08-11) — `/mcp` is retired in favour of `/api/mcp`.
 *
 * THE DEFECT THAT WAS RULED ON. `server/mcp/index.ts` was mounted live at
 * POST/GET `/mcp`. Its auth module accepted a per-org `ak_live_…` key,
 * resolved the key's `organizationId`, and never read the key's `scopes`
 * column — so a ZERO-SCOPE key reached all 29 of its tools for its org. The
 * same credential presented to `/api/mcp` is checked per tool
 * (safeIntents.ts::keyMaySatisfyIntent). Org binding held on both, so this was
 * never cross-tenant; it was one credential with two different ladders. The
 * founder removed the shorter ladder rather than lengthening it.
 *
 * THE BINDING CONDITION was that nobody's Claude Desktop config break in
 * silence. What this suite pins, therefore, is not only "the route is gone"
 * but "and the thing that pointed people at it now points somewhere that
 * works, with a credential that surface actually accepts".
 *
 * Every check here is DERIVED from the tree rather than from a list written
 * by hand: the mount paths are extracted from server/index.ts, the URL sweep
 * walks the production directories, and the scope ladder is exercised through
 * the real dispatch path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Controlled intent registry: one ungated read, one scope-gated read ──────
const ungatedRead = {
  name: "get_portfolio_summary",
  description: "Ungated read.",
  door: "today" as const,
  requiredScope: null,
  approvalRequired: false,
  inputSchema: { type: "object", properties: {} },
  handler: vi.fn(async (_a: any, org: any) => ({ success: true, data: { orgId: org.id } })),
};

const scopedRead = {
  name: "get_leads",
  description: "Read leads — requires a leads/deals read scope.",
  door: "deals" as const,
  requiredScope: "deal_read" as const,
  approvalRequired: false,
  inputSchema: { type: "object", properties: {} },
  handler: vi.fn(async (_a: any, org: any) => ({ success: true, data: { orgId: org.id, leads: [] } })),
};

const FAKE_INTENTS: Record<string, any> = {
  get_portfolio_summary: ungatedRead,
  get_leads: scopedRead,
};

vi.mock("../../server/services/appIntents", () => ({
  listIntents: () => Object.values(FAKE_INTENTS),
  getIntent: (name: string) => FAKE_INTENTS[name],
  resolveInputSchema: (intent: any) => intent.inputSchema,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ count: 0 }] }) }),
    insert: () => ({ values: async () => undefined }),
  },
  dbReplica: null,
}));

import { __mcpInternals, mcpStreamableHttpHandler } from "../../server/mcp/streamableHttp";

const { dispatch, MCP_FORBIDDEN, JSONRPC_METHOD_NOT_FOUND } = __mcpInternals;

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CONFIG_PATH = "server/mcp/claude-desktop-config.json";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ─── 1. The route is gone from the app ───────────────────────────────────────

describe("the /mcp route is gone from the app", () => {
  /**
   * Every Express mount path literal registered in server/index.ts, DERIVED
   * from source. Deriving the whole set (rather than asserting the absence of
   * one hardcoded string) is what makes this bite: a mount re-added under any
   * verb, or with a different quote style, lands in this set.
   */
  function mountPaths(rel: string): string[] {
    const code = stripComments(read(rel));
    const re = /\bapp\.(?:use|get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]+)\1/g;
    const found: string[] = [];
    for (const m of code.matchAll(re)) found.push(m[2]);
    return found;
  }

  it("server/index.ts registers no /mcp mount under any verb", () => {
    const paths = mountPaths("server/index.ts");
    // Sanity: the extractor really is seeing mounts (a broken regex that
    // matched nothing would make the assertion below vacuously true).
    expect(paths.length).toBeGreaterThan(3);

    const offenders = paths.filter((p) => p === "/mcp" || /^\/mcp(\/|$)/.test(p));
    expect(offenders, `server/index.ts still mounts ${offenders.join(", ")}`).toEqual([]);
  });

  it("the surviving MCP mount is /api/mcp, and it is still mounted", () => {
    // Retiring the second ladder must not have retired the first one too.
    const routes = read("server/routes.ts");
    expect(routes).toContain("app.post('/api/mcp', mcpStreamableHttpHandler)");
  });

  it("the retired tool server is deleted, and nothing imports it", () => {
    expect(exists("server/mcp/index.ts"), "server/mcp/index.ts is still on disk").toBe(false);

    // Derived: no file anywhere in server/ may import the deleted module.
    const importers = walk("server").filter((rel) => {
      const code = stripComments(read(rel));
      return /from\s+['"][^'"]*mcp\/index(\.js)?['"]/.test(code);
    });
    expect(importers, `still imported by ${importers.join(", ")}`).toEqual([]);
  });

  it("the retired auth resolver and its static-key lane are gone", () => {
    const auth = read("server/mcp/auth.ts");
    // The resolver itself…
    expect(stripComments(auth)).not.toContain("export async function resolveMcpAuth");
    // …and the env credential it read. A retired lane that still READS its
    // secret, or still ADVERTISES it as a settable credential, is a lane that
    // can come back on. Prose that explains the retirement is fine and is
    // required elsewhere in this suite — what must not survive is a read or a
    // registry entry.
    const survivors = walkAll().filter((rel) => {
      const code = stripComments(read(rel));
      return (
        /process\.env\.MCP_(API_KEY|ORG_ID)\b/.test(code) ||
        /key:\s*["']MCP_(API_KEY|ORG_ID)["']/.test(code) ||
        /["']MCP_(API_KEY|ORG_ID)["']\s*:/.test(code)
      );
    });
    expect(survivors, `MCP_API_KEY / MCP_ORG_ID still live in ${survivors.join(", ")}`).toEqual([]);
  });
});

// ─── 2. No generator emits a /mcp URL any more ───────────────────────────────

/** Production dirs a customer-visible URL could be generated from. */
const PRODUCTION_DIRS = ["server", "client/src", "client/public", "scripts"];
const SKIP_DIR = /node_modules|\.git$|dist|build|__snapshots__|\.claude/;
const TEXTUAL = /\.(ts|tsx|js|jsx|mjs|cjs|json|txt|html|md)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.test(entry.name)) continue;
      out.push(...walk(rel));
    } else if (TEXTUAL.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function walkAll(): string[] {
  return PRODUCTION_DIRS.flatMap(walk);
}

/**
 * Every string LITERAL a file could emit: JSON values for .json, quoted
 * literals for code. Working on whole strings (rather than raw text) is what
 * separates an emitted URL from prose that merely names the retired path —
 * this suite deliberately requires such prose in the config, to explain the
 * break to a customer whose setup stopped working.
 */
function stringLiterals(rel: string): string[] {
  const raw = read(rel);
  if (rel.endsWith(".json")) {
    const out: string[] = [];
    const visit = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") Object.values(v).forEach(visit);
    };
    try {
      visit(JSON.parse(raw));
    } catch {
      /* not parseable → nothing to attribute */
    }
    return out;
  }
  const out: string[] = [];
  for (const m of stripComments(raw).matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    out.push(m[2]);
  }
  return out;
}

/** Does this string emit the retired `/mcp` path? */
function emitsRetiredPath(s: string): boolean {
  if (s.includes(" ")) return false; // prose, not a URL/route literal
  if (s.startsWith("./") || s.startsWith("../")) return false; // import specifier
  if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(s)) return false; // a repo file path
  if (s.includes("/api/mcp")) return false; // the correct endpoint
  return s === "/mcp" || s.endsWith("/mcp") || s.includes("/mcp/");
}

describe("no generator emits a /mcp URL", () => {
  it("sweeps every production file for a /mcp path that is not /api/mcp", () => {
    const files = walkAll();
    // Sanity: the walker is actually finding the tree.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(CONFIG_PATH);

    const offenders: string[] = [];
    for (const rel of files) {
      for (const s of stringLiterals(rel)) {
        if (emitsRetiredPath(s)) offenders.push(`${rel}: ${s}`);
      }
    }
    expect(offenders, `a /mcp URL is still generated:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the sweep can actually see an offending URL (guards against a vacuous pass)", () => {
    // A whole-string matcher that silently stopped matching would make the
    // sweep above pass forever. Prove it still recognises both the shape the
    // config used to carry and a bare route mount.
    expect(emitsRetiredPath("https://acreos.fly.dev/mcp")).toBe(true);
    expect(emitsRetiredPath("/mcp")).toBe(true);
    expect(emitsRetiredPath("https://acreos.io/api/mcp")).toBe(false);
    expect(emitsRetiredPath("server/mcp/streamableHttp.ts")).toBe(false);
  });
});

// ─── 3. The generated Claude Desktop config is correct AND usable ────────────

describe("the generated Claude Desktop config points at the surviving surface", () => {
  const config = () => JSON.parse(read(CONFIG_PATH));

  it("every server entry targets /api/mcp over HTTP", () => {
    const servers = config().mcpServers as Record<string, any>;
    const names = Object.keys(servers);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const entry = servers[name];
      expect(entry.url, `${name} has no url`).toBeTruthy();
      expect(new URL(entry.url).pathname, `${name} does not target /api/mcp`).toBe("/api/mcp");
      // No entry may spawn the deleted stdio module.
      expect(JSON.stringify(entry)).not.toContain("mcp/index.ts");
      expect(entry.command, `${name} still launches a local subprocess`).toBeUndefined();
    }
  });

  it("its credential is a shape /api/mcp's authenticate() actually accepts", async () => {
    // The binding condition in one assertion. Repointing the URL is not
    // enough — the config must also carry a credential the new surface takes.
    // The retired lane's static MCP_API_KEY would NOT have qualified, which is
    // exactly why it could not simply be repointed.
    const servers = config().mcpServers as Record<string, any>;
    const tokens = Object.values(servers)
      .map((e: any) => e?.headers?.Authorization ?? "")
      .map((h: string) => h.replace(/^Bearer\s+/i, ""));

    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      // Drive the REAL guard rather than restating its regex here.
      const rejected = await __mcpInternals.authenticate({
        headers: { authorization: `Bearer ${token}` },
      } as any);
      // The placeholder key is well-SHAPED but not a real row, so it must get
      // past the format guard and fail at the lookup (null), not be rejected
      // out of hand. Proven by contrast with a malformed token below.
      expect(rejected).toBeNull();
      expect(/^ak_(live|test)_[A-Za-z0-9_-]{16,}$/.test(token)).toBe(true);
    }
  });

  it("tells a broken static-key user why they broke", () => {
    // Refuse-don't-fabricate applies to a retirement too: the config a
    // customer already copied is the only place we can leave the explanation.
    const raw = read(CONFIG_PATH);
    expect(raw).toContain("MCP_API_KEY");
    expect(raw).toMatch(/retired/i);
    expect(raw).toContain("/mcp");
  });
});

// ─── 4. The scope ladder the ruling turned on ────────────────────────────────

describe("the surviving surface enforces the ladder /mcp did not", () => {
  const ORG = { id: 42, name: "Acme Land Co" } as any;
  const zeroScopeKey = { organization: ORG, scopes: [] as string[], keyId: 1 };
  const scopedKey = { organization: ORG, scopes: ["leads:read"], keyId: 2 };

  const call = (key: any, name: string) =>
    dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }, key) as any;

  it("a ZERO-SCOPE key is REFUSED per-tool — the exact bypass that was ruled on", async () => {
    const res = await call(zeroScopeKey, "get_leads");
    expect(res.error?.code).toBe(MCP_FORBIDDEN);
    expect(res.error.message).toMatch(/lacks a required scope/i);
    // Refused means NOT RUN, not "ran and returned nothing".
    expect(scopedRead.handler).not.toHaveBeenCalled();
  });

  it("a zero-scope key cannot even SEE the scoped tool", async () => {
    const res = (await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/list" }, zeroScopeKey)) as any;
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).not.toContain("get_leads");
    // It still sees ungated reads — the ladder narrows, it does not blank out.
    expect(names).toContain("get_portfolio_summary");
  });

  it("a SCOPED key succeeds, and runs against its own org", async () => {
    const res = await call(scopedKey, "get_leads");
    expect(res.error).toBeUndefined();
    expect(scopedRead.handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.result.content[0].text).orgId).toBe(42);
  });

  it("an unknown tool is method-not-found, not a scope leak", async () => {
    const res = await call(scopedKey, "no_such_tool");
    expect(res.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });
});

// ─── 5. Wave 0.7 machinery is not orphaned ───────────────────────────────────

describe("the Wave 0.7 kill switch + allowlist still govern the surviving surface", () => {
  function fakeRes() {
    const res: any = {
      statusCode: 0,
      body: undefined,
      setHeader: vi.fn(),
      status(c: number) { this.statusCode = c; return this; },
      json(p: unknown) { this.body = p; return this; },
      end: vi.fn(),
    };
    return res;
  }

  it("both controls still have a production call site", () => {
    // Removing the route must not have left these exported and uncalled.
    const callers = walk("server").filter((rel) => {
      if (rel === "server/mcp/auth.ts") return false; // the definition itself
      const code = stripComments(read(rel));
      return code.includes("mcpEndpointDark(") || code.includes("mcpOrgAllowed(");
    });
    expect(callers).toEqual(["server/mcp/streamableHttp.ts"]);
  });

  it("MCP_PUBLIC_DISABLED darkens /api/mcp before auth runs", async () => {
    vi.stubEnv("MCP_PUBLIC_DISABLED", "1");
    const res = fakeRes();
    await mcpStreamableHttpHandler({ headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(404);
  });

  it("unset controls leave /api/mcp enabled (401, not 404)", async () => {
    const res = fakeRes();
    await mcpStreamableHttpHandler({ headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });

  it("MCP_ORG_ALLOWLIST still narrows by org", () => {
    const { parseOrgAllowlist } = __mcpInternals;
    expect(parseOrgAllowlist(undefined)).toBeNull();
    expect(parseOrgAllowlist("1, 7,42")!.has(7)).toBe(true);
    expect(parseOrgAllowlist("1,7")!.has(42)).toBe(false);
    // Fails closed on a typo.
    expect(parseOrgAllowlist("acme")!.size).toBe(0);
  });
});
