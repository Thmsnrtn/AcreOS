/**
 * `npm run test:simulation` runs the simulation specs it names, against a
 * server it has authenticated with — or it fails.
 *
 * Measured 2026-10-07, before this file:
 *
 *   · The script ran `vitest run tests/simulation/…spec.ts` under the DEFAULT
 *     config, whose include is `*.test.{ts,tsx,mjs}`. Vitest found no test
 *     files and exited 1. `scripts/verify-launch-ready.sh` runs the script as
 *     an optional check, so the run was reported as "SKIP (non-blocking)":
 *     the load and chaos simulations had not executed through that script.
 *   · Under the right config (vitest.simulation.config.ts), with no server,
 *     51 of 59 tests passed — each began `if (!session) return;` and the
 *     suite's beforeAll turned a failed sign-in into a console warning.
 *   · With a server, the session helper signed in through `/api/auth/signup`
 *     and `/api/auth/login`, which do not exist (auth is Clerk), and returned
 *     a session with an empty cookie. Every request was unauthenticated.
 *
 * Each of those is pinned below against the thing itself, not its spelling:
 * the scripts' file filters are resolved through the config each one actually
 * loads; the global setup and the session helper are run against servers that
 * refuse them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { globSync } from "tinyglobby";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// This gate globs a config's test population; its cost scales with the tree
// it is pointed at, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** The scripts that drive the API-level simulation suite. */
const SIM_SCRIPTS = ["test:simulation", "test:chaos"] as const;
/** The specs `test:simulation` must name — a floor, so a script trimmed to one file fails. */
const SIM_SPECS_FLOOR = 2;

interface ParsedVitestRun { config: string; filters: string[] }

function parseVitestRun(cmd: string): ParsedVitestRun {
  const argv = cmd.trim().split(/\s+/);
  expect(argv.slice(0, 2), `"${cmd}" is not a vitest run`).toEqual(["vitest", "run"]);
  let config = "vitest.config.ts";
  const filters: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--config" || argv[i] === "-c") config = argv[++i];
    else if (argv[i].startsWith("--config=")) config = argv[i].slice("--config=".length);
    else if (!argv[i].startsWith("-")) filters.push(argv[i]);
  }
  return { config, filters };
}

async function loadConfig(rel: string): Promise<{ include: string[]; exclude: string[]; globalSetup: string[] }> {
  const mod = (await import(path.join(ROOT, rel))) as { default: { test?: Record<string, unknown> } };
  const t = mod.default.test ?? {};
  const asList = (v: unknown) => (Array.isArray(v) ? (v as string[]) : v ? [v as string] : []);
  return { include: asList(t.include), exclude: asList(t.exclude), globalSetup: asList(t.globalSetup) };
}

describe("the simulation scripts read the specs they name", () => {
  for (const name of SIM_SCRIPTS) {
    it(`${name}: every file it names is a test file under the config it loads`, async () => {
      const cmd = pkg.scripts[name];
      expect(cmd, `package.json has no ${name} script`).toBeTruthy();
      const { config, filters } = parseVitestRun(cmd);
      expect(filters.length, `${name} names no spec`).toBeGreaterThan(0);
      const cfg = await loadConfig(config);
      // vitest's own resolution: the config's include/exclude globs, then the
      // CLI filters as path substrings. A filter matching nothing is exactly
      // the "No test files found" the script used to exit on.
      const included = globSync(cfg.include, {
        cwd: ROOT,
        ignore: cfg.exclude.map((e) => (e.includes("*") ? e : `${e}/**`)),
      });
      for (const f of filters) {
        expect(fs.existsSync(path.join(ROOT, f)), `${name} names ${f}, which does not exist`).toBe(true);
        expect(
          included.filter((p) => p.includes(f)),
          `${name} names ${f}, but ${config} does not include it — vitest would find no test files`,
        ).not.toEqual([]);
      }
      if (name === "test:simulation") expect(filters.length).toBeGreaterThanOrEqual(SIM_SPECS_FLOOR);
    });
  }

  it("the config those scripts load refuses to start without a server", async () => {
    const configs = new Set(SIM_SCRIPTS.map((n) => parseVitestRun(pkg.scripts[n]).config));
    for (const c of configs) {
      const cfg = await loadConfig(c);
      expect(cfg.globalSetup, `${c} declares no globalSetup — nothing stops a serverless run`).toContain(
        "./tests/simulation/global-setup.ts",
      );
    }
  });

});

/**
 * A test that returns before asserting anything is reported as a pass. The
 * suite had two such shapes in nearly every test: a guard at the top of the
 * body (`if (!session) return;`, `if (!orgA || !orgB) { return; }`) and a hook
 * that caught a failed sign-in and logged it. Read with TypeScript's parser,
 * so a comment naming the old guard is never a guard.
 */
const TEST_CALLEES = new Set(["it", "test", "it.only", "test.only", "it.concurrent", "test.concurrent"]);
const HOOK_CALLEES = new Set([
  "beforeAll", "beforeEach", "test.beforeAll", "test.beforeEach",
]);

interface Vacuity { line: number; kind: "guard-return" | "swallowed-hook-error"; text: string }

function isBareReturn(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return !stmt.expression;
  if (ts.isBlock(stmt)) return stmt.statements.length === 1 && isBareReturn(stmt.statements[0]);
  return false;
}

function callbackOf(call: ts.CallExpression): ts.Block | null {
  for (const a of call.arguments) {
    if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && a.body && ts.isBlock(a.body)) return a.body;
  }
  return null;
}

function vacuityIn(source: string, fileName = "spec.ts"): Vacuity[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Vacuity[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const body = callbackOf(node);
      if (body && TEST_CALLEES.has(callee)) {
        // A guard at the TOP of the body: any leading `if (…) return;` with no
        // else, whatever it tests.
        for (const stmt of body.statements) {
          if (ts.isIfStatement(stmt) && !stmt.elseStatement && isBareReturn(stmt.thenStatement)) {
            out.push({ line: at(stmt), kind: "guard-return", text: stmt.getText(sf).replace(/\s+/g, " ").slice(0, 80) });
          }
        }
      }
      if (body && HOOK_CALLEES.has(callee)) {
        // A hook that catches and does not rethrow turns a failed setup into
        // a suite of tests that run against nothing.
        const walk = (n: ts.Node) => {
          if (ts.isCatchClause(n)) {
            let rethrows = false;
            const find = (m: ts.Node) => {
              if (ts.isThrowStatement(m)) rethrows = true;
              else if (!ts.isFunctionLike(m)) ts.forEachChild(m, find);
            };
            find(n.block);
            if (!rethrows) out.push({ line: at(n), kind: "swallowed-hook-error", text: n.getText(sf).replace(/\s+/g, " ").slice(0, 80) });
          }
          ts.forEachChild(n, walk);
        };
        walk(body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("no simulation spec passes by returning early", () => {
  it("reads every spec vitest.simulation.config.ts includes", async () => {
    const cfg = await loadConfig("vitest.simulation.config.ts");
    const specs = globSync(cfg.include, {
      cwd: ROOT,
      ignore: cfg.exclude.map((e) => (e.includes("*") ? e : `${e}/**`)),
    }).sort();
    // The population is the config's, not the npm scripts' — every spec a
    // `--config vitest.simulation.config.ts` run can reach. Floored, and two
    // members named, so a glob that stops matching fails here.
    expect(specs.length, "the simulation config's include matched almost nothing").toBeGreaterThanOrEqual(8);
    for (const known of ["tests/simulation/chaos.spec.ts", "tests/simulation/sim-multi-tenant.spec.ts"]) {
      expect(specs).toContain(known);
    }
    const findings: string[] = [];
    let testsRead = 0;
    for (const rel of specs) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      // Per-member vacuity: a file the parser reads no test from is a file
      // this gate did not read.
      const n = (stripComments(src).match(/\b(?:it|test)(?:\.only|\.concurrent)?\s*\(/g) ?? []).length;
      expect(n, `${rel}: no test call found — the parser would read nothing here`).toBeGreaterThan(0);
      testsRead += n;
      for (const v of vacuityIn(src, rel)) findings.push(`${rel}:${v.line} ${v.kind}  ${v.text}`);
    }
    expect(testsRead).toBeGreaterThan(100);
    expect(findings.join("\n") || "(none)").toBe("(none)");
  });

  it("canaries: each guard shape is caught, whatever it tests", () => {
    const kinds = (src: string) => vacuityIn(src).map((v) => v.kind);
    expect(kinds(`it("a", async () => { if (!session) return; expect(1).toBe(1); });`)).toEqual(["guard-return"]);
    expect(kinds(`test("b", async () => { if (!orgA || !orgB) { return; } expect(1).toBe(1); });`)).toEqual(["guard-return"]);
    expect(kinds(`it("c", () => { if (items.length === 0) return; });`)).toEqual(["guard-return"]);
    expect(kinds(`beforeAll(async () => { try { s = await f(); } catch { console.warn("no"); } });`)).toEqual([
      "swallowed-hook-error",
    ]);
    expect(kinds(`test.beforeAll(async () => { try { s = await f(); } catch (e) { log(e); } });`)).toEqual([
      "swallowed-hook-error",
    ]);
  });

  it("canaries: what is not a guard is not flagged", () => {
    const kinds = (src: string) => vacuityIn(src).map((v) => v.kind);
    // A comment naming the old guard; a return with a value; a guard inside a
    // nested helper; an if/else; a hook that rethrows.
    expect(kinds(`it("d", () => { /* if (!session) return; */ expect(1).toBe(1); });`)).toEqual([]);
    expect(kinds(`it("e", () => { const f = (x) => { if (!x) return; }; f(1); });`)).toEqual([]);
    expect(kinds(`it("f", () => { if (a) return; else expect(a).toBe(0); });`)).toEqual([]);
    expect(kinds(`beforeAll(async () => { try { await f(); } catch (e) { throw e; } });`)).toEqual([]);
  });
});

describe("the simulation's floor holds against servers that refuse it", () => {
  type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
  const servers: http.Server[] = [];
  const serve = async (handler: Handler): Promise<string> => {
    const s = http.createServer(handler);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };
  const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  let closedPort = "";
  const ENV_KEYS = ["SIM_BASE_URL", "SIM_DATABASE_URL", "DATABASE_URL", "SIM_ALLOW_REMOTE_BASE_URL"] as const;
  const prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  beforeAll(async () => {
    const s = http.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    closedPort = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    await new Promise<void>((r) => s.close(() => r()));
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  // helpers.ts reads SIM_BASE_URL at module load, so each case loads it fresh.
  const freshHelpers = async (base: string) => {
    process.env.SIM_BASE_URL = base;
    vi.resetModules();
    return (await import("../simulation/helpers")) as typeof import("../simulation/helpers");
  };

  it("global setup rejects an unreachable server", async () => {
    const { requireHealthyServer } = await import("../simulation/global-setup");
    await expect(requireHealthyServer(closedPort)).rejects.toThrow(/api\/health/);
  });

  it("global setup rejects a server whose health check is not 200", async () => {
    const base = await serve((_req, res) => json(res, 503, { ok: false }));
    const { requireHealthyServer } = await import("../simulation/global-setup");
    await expect(requireHealthyServer(base)).rejects.toThrow(/503/);
  });

  it("the session helper throws when the identity is not accepted", async () => {
    // Everything else on this server answers as if signed in, so only the
    // identity check itself can refuse — a helper that skipped it would pass.
    const base = await serve((req, res) => {
      if (req.url === "/api/auth/user") return json(res, 401, { error: "Unauthorized" });
      return json(res, 200, { id: 42 }, { "set-cookie": "csrf_token=tok123; Path=/" });
    });
    const { createAuthenticatedSession } = await freshHelpers(base);
    await expect(createAuthenticatedSession("scalingOperator")).rejects.toThrow(/api\/auth\/user answered 401/);
  });

  it("the session helper throws when no org or CSRF token comes back", async () => {
    const base = await serve((req, res) => {
      if (req.url === "/api/auth/user") return json(res, 200, { id: "u1" });
      return json(res, 200, {}); // no org id, no csrf cookie
    });
    const { createAuthenticatedSession } = await freshHelpers(base);
    await expect(createAuthenticatedSession("scalingOperator")).rejects.toThrow(/no usable session/);
  });

  it("the session helper returns a session only when the server authenticated it", async () => {
    const seen: string[] = [];
    const base = await serve((req, res) => {
      seen.push(String(req.headers.cookie ?? ""));
      if (req.url === "/api/auth/user") return json(res, 200, { id: "u1" });
      if (req.url === "/api/organization") {
        return json(res, 200, { id: 42 }, { "set-cookie": "csrf_token=tok123; Path=/; SameSite=Lax" });
      }
      return json(res, 404, {});
    });
    const { createAuthenticatedSession, assertSession } = await freshHelpers(base);
    const s = await createAuthenticatedSession("scalingOperator");
    expect(s).toMatchObject({ orgId: 42, csrfToken: "tok123" });
    expect(s.cookie).toContain("__session=e2e-persona-sim-scalingoperator");
    expect(s.cookie).toContain("csrf_token=tok123");
    expect(seen.every((c) => c.includes("__session=e2e-persona-sim-scalingoperator"))).toBe(true);
    expect(() => assertSession(s)).not.toThrow();
    expect(() => assertSession(undefined)).toThrow(/no authenticated session/);
  });

  // ── where the suite may point ────────────────────────────────────────────
  // The global setup writes user rows directly into a database. These pin
  // that it reads only SIM_DATABASE_URL, only for a local host, and that the
  // HTTP target is local unless the operator opts in.

  const authenticatingServer = () =>
    serve((req, res) => {
      if (req.url === "/api/health") return json(res, 200, { ok: true });
      if (req.url === "/api/auth/user") return json(res, 200, { id: "u1" });
      if (req.url === "/api/organization") return json(res, 200, { id: 42 }, { "set-cookie": "csrf_token=t; Path=/" });
      return json(res, 404, {});
    });
  const freshSetup = async (env: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);
    vi.resetModules();
    return (await import("../simulation/global-setup")).default;
  };

  it("the HTTP target must be local unless the opt-in is set", async () => {
    const { simBaseUrl, DEFAULT_SIM_BASE_URL } = await import("../simulation/target");
    expect(simBaseUrl({})).toBe(DEFAULT_SIM_BASE_URL);
    for (const local of ["http://localhost:5077", "http://127.0.0.1:5077", "http://[::1]:5077"]) {
      expect(simBaseUrl({ SIM_BASE_URL: local })).toBe(local);
    }
    expect(() => simBaseUrl({ SIM_BASE_URL: "https://app.example.com" })).toThrow(/not a local host/);
    expect(() => simBaseUrl({ SIM_BASE_URL: "http://localhost.example.com" })).toThrow(/not a local host/);
    expect(simBaseUrl({ SIM_BASE_URL: "https://app.example.com", SIM_ALLOW_REMOTE_BASE_URL: "1" })).toBe(
      "https://app.example.com",
    );
  });

  it("the database is SIM_DATABASE_URL only, and only a local one", async () => {
    const { simDatabaseUrl } = await import("../simulation/target");
    expect(simDatabaseUrl({ DATABASE_URL: "postgresql://u:p@localhost:5432/app" })).toBeUndefined();
    expect(simDatabaseUrl({ SIM_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/sim" })).toBe(
      "postgresql://u:p@127.0.0.1:5432/sim",
    );
    expect(() => simDatabaseUrl({ SIM_DATABASE_URL: "postgresql://u:p@db.example.com:5432/sim" })).toThrow(
      /does not name a local host/,
    );
  });

  it("global setup never falls back to DATABASE_URL", async () => {
    // DATABASE_URL names a port nothing listens on. A setup that fell back to
    // it would try to seed there and reject; one that ignores it resolves.
    const base = await authenticatingServer();
    const setup = await freshSetup({ SIM_BASE_URL: base, DATABASE_URL: `postgresql://u:p@${closedPort.slice(7)}/none` });
    await expect(setup()).resolves.toBeUndefined();
  });

  it("global setup refuses a non-local database before sending anything", async () => {
    let requests = 0;
    const base = await serve((_req, res) => { requests++; json(res, 200, {}); });
    const setup = await freshSetup({ SIM_BASE_URL: base, SIM_DATABASE_URL: "postgresql://u:p@db.example.com:5432/sim" });
    await expect(setup()).rejects.toThrow(/does not name a local host/);
    expect(requests, "the setup contacted the server before validating its database target").toBe(0);
  });

  it("global setup refuses a non-local server without the opt-in", async () => {
    // The refusal may land when the helpers resolve their target at load, or
    // when setup runs; either way nothing is sent.
    await expect((async () => (await freshSetup({ SIM_BASE_URL: "https://app.example.com" }))())()).rejects.toThrow(
      /not a local host/,
    );
  });
});
