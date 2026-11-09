/**
 * The expansion ladder, enforced instead of trusted.
 *
 * *"No marketplace before ~25 customers and no public API before ~50"* — the
 * approved expansion ladder, in `CLAUDE.md`'s DO-NOT-DO list and
 * `docs/company/roadmap-2026-07.md`. Until this file it was registered in
 * `shared/governance/constitution.ts` as **`prose-only`**: recorded, relying on
 * vigilance, with a note reading *"Enforced today by the marketplace/API
 * surfaces staying feature-flagged off. No automated customer-count gate.
 * GOVERNANCE DEBT."*
 *
 * Checking that note against HEAD found it half-true, and the half that was
 * wrong is the interesting half.
 *
 * THE API SIDE WAS FINE. `registerPublicApiV1` has zero callers, so
 * `server/api-v1/*` is unmounted (BLOCKERS B8). `/api/v1/*` in `routes.ts` is
 * only a passthrough that rewrites to `/api/*`, so the versioned prefix is an
 * alias rather than a public surface.
 *
 * THE MARKETPLACE SIDE WAS NOT. It was mounted behind
 * `featureGate("feature_marketplace")`, and `requireFlag` — which `featureGate`
 * aliases — carries two escape hatches:
 *
 *   1. **An enterprise-tier bypass.** Its own comment calls it back-compat for
 *      legacy reseller / white-label routes. Applied here it meant a
 *      SUBSCRIPTION TIER silently overrode a founder decision: a paid plan
 *      buying its way past the ladder.
 *   2. **Failing OPEN when the flag store throws** — *"DB unavailable — fail
 *      open to avoid breaking the app during initial setup"*. Kind for a
 *      product flag. For an expansion gate it means a transient database error
 *      opens the marketplace.
 *
 * Neither is a bug in `requireFlag`; both are wrong for a governance gate. So
 * the marketplace now uses `requireLadderFlag`, which keeps the founder bypass
 * — the founder must be able to look at the surface they are deciding about —
 * and drops the other two.
 *
 * WHY THE ASSERTIONS ARE INVERTED. A test cannot know the customer count, so it
 * cannot say "25 has not been reached". What it can do is fail the moment
 * either surface is switched on, and say what to check first. That is the same
 * shape as `FOUNDER_ROUTE_BASELINE` and `BLOCKED_ON_A_REAL_LINK`: a fact that
 * may only change deliberately, by someone who reads the message.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { CONSTITUTION } from "@shared/governance/constitution";
import { KNOWN_NON_MOUNTED, ROUTE_MANIFEST } from "../../server/routeManifest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

const routes = stripComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));
const gate = stripComments(
  fs.readFileSync(path.join(ROOT, "server/middleware/featureGate.ts"), "utf8"),
);

describe("the public API stays unmounted until the ladder says otherwise", () => {
  it("registerPublicApiV1 still has no caller", () => {
    // Inverted on purpose. When someone mounts it, this fails and asks them to
    // confirm the customer count first — which is the only thing a test can
    // usefully do about a threshold it cannot measure.
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/api-v1/index.ts"), "utf8"),
    );
    expect(src, "registerPublicApiV1 is gone — was the public API surface moved?")
      .toContain("export function registerPublicApiV1");
    expect(
      routes.includes("registerPublicApiV1("),
      "the public API v1 surface is now MOUNTED. The approved expansion ladder " +
        "puts a public API at ~50 customers. If that threshold has genuinely " +
        "been crossed, say so in the commit, update " +
        "shared/governance/constitution.ts, and change this assertion " +
        "deliberately — do not delete it.",
    ).toBe(false);
  });

  it("/api/v1 is still only a passthrough alias, not a separate surface", () => {
    // The thing that makes the claim above true in practice: a client calling
    // /api/v1/x today reaches /api/x, the internal route. If this rewrite were
    // replaced by a real v1 router, the surface would exist without
    // registerPublicApiV1 ever being called.
    const at = routes.indexOf('app.use("/api/v1/{*splat}"');
    expect(at, "the /api/v1 passthrough is gone — is there a real v1 surface now?")
      .toBeGreaterThan(-1);
    expect(routes.slice(at, at + 400)).toContain('replace("/api/v1/", "/api/")');
  });
});

/**
 * WHAT THE TWO ASSERTIONS ABOVE MISSED, and why this block exists.
 *
 * They pin `registerPublicApiV1` and `/api/v1` — the public API surface **by
 * name**. A SECOND one existed under a different name and neither noticed it:
 * `routes-epic-services.ts`, mounted at `/api` behind plain `isAuthenticated`,
 * carried
 *
 *     GET  /developer/openapi          a document titled "AcreOS Public API"
 *     POST /developer/api-keys         minted an `acr_…` secret for ANY customer
 *     GET  /developer/widget-embed/:t  handed out `pub_<orgId>_<base64(orgId)>`
 *                                      as a "publicApiKey" — the org id encoded
 *
 * while `routes-api-keys.ts` was kept deliberately dormant *because of this very
 * ladder* — the reachability ratchet's note records that as the reason its
 * `unregisteredRoutes` baseline is 1. **The decision was enforced in one place
 * and defeated in another**, which is what a name-based check cannot see.
 *
 * Worse, the keys were INERT: nothing verified `provider = "api_key"` (the only
 * consumer, `mcp-server.ts`, matches `provider = 'mcp_api_key'`), and the rate
 * limiter written for them had zero importers — while the response told the
 * customer *"Store this key securely. It will not be shown again."*
 *
 * Founder ruling (picker, 2026-08-15): remove the three endpoints. These
 * assertions are therefore SHAPE-based rather than name-based: they ask "does any
 * mounted route hand a customer an API key, or publish a public-API spec?", so a
 * third surface under a third name trips them too.
 */
describe("no mounted route hands a customer an API key", () => {
  const routeFiles = fs
    .readdirSync(path.join(ROOT, "server"))
    .filter((f) => /^routes.*\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f));

  it("the /developer/* surface is gone from routes-epic-services", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-epic-services.ts"), "utf8"),
    );
    expect(
      src,
      "a /developer/* route is back in routes-epic-services.ts. That router mounts " +
        "at /api behind plain isAuthenticated, so this is customer-reachable — and " +
        "the ladder defers a public API to ~50 customers. If that threshold has " +
        "been crossed, build the VERIFIER first: the keys this used to mint were " +
        "accepted by nothing.",
    ).not.toMatch(/["'`]\/developer\//);
  });

  it("every generateApiKey call site is founder-gated or unmounted", () => {
    // Kept as the identifier-level floor. It is NOT the shape check it once
    // claimed to be: `POST /api/org/api-keys` minted inline with
    // crypto.randomBytes for months and this stayed green. The behavioural
    // check is the "API-key minting, by behaviour" block below.
    // Key MINTING is the affordance the ladder defers; where it
    // exists it must be behind requireFounder (as /api/data-api's is) or in a
    // router nothing mounts (as routes-api-keys.ts is).
    const offenders: string[] = [];
    for (const f of routeFiles) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, "server", f), "utf8"));
      if (!/\bgenerateApiKey\s*\(/.test(src)) continue;
      const founderGated = /requireFounder|founderOnly/.test(src);
      const mounted = routes.includes(f.replace(/\.tsx?$/, ""));
      if (!founderGated && mounted) offenders.push(f);
    }
    expect(
      offenders,
      "a MOUNTED route mints API keys without a founder gate. The expansion " +
        "ladder puts a public API at ~50 customers; routes-api-keys.ts stays " +
        "dormant for exactly that reason, and this is the same affordance by " +
        "another name.",
    ).toEqual([]);
  });

  it("no mounted route serves the public-API spec", () => {
    const offenders = routeFiles.filter((f) => {
      const src = stripComments(fs.readFileSync(path.join(ROOT, "server", f), "utf8"));
      return /ACREOS_OPENAPI_SPEC/.test(src);
    });
    expect(
      offenders,
      "a route serves ACREOS_OPENAPI_SPEC — a document titled 'AcreOS Public API' " +
        "instructing developers to authenticate with `Bearer acr_…`. Publishing " +
        "the spec IS launching the API, whether or not a verifier exists.",
    ).toEqual([]);
  });

  it("the spec and the minting helper still EXIST, kept for when the trigger fires", () => {
    // Deliberately not deleted. What was wrong was mounting them early, not
    // writing them — so this asserts the opposite of the three above, and stops a
    // future reader from "finishing the cleanup" and throwing away the head start.
    const svc = path.join(ROOT, "server/services/developerApiService.ts");
    expect(fs.existsSync(svc), "developerApiService.ts was deleted — see the ledger").toBe(true);
    const src = fs.readFileSync(svc, "utf8");
    expect(src).toContain("ACREOS_OPENAPI_SPEC");
    expect(src).toContain("export function generateApiKey");
  });

  it("the detectors would notice (guards against vacuous passes)", () => {
    expect(routeFiles.length, "no route files found — the scan is broken").toBeGreaterThan(20);
    expect(/\bgenerateApiKey\s*\(/.test("const k = generateApiKey();")).toBe(true);
    expect(/["'`]\/developer\//.test('router.get("/developer/openapi"')).toBe(true);
  });
});

/**
 * API-KEY MINTING, BY BEHAVIOUR — and why the check above was not enough.
 *
 * The identifier check above was green for months while Settings → Integrations
 * let any non-viewer member mint `acos_…` keys through a mounted route that
 * nothing ever verified. The route minted with `crypto.randomBytes` inline, so
 * the population "files that say generateApiKey(" never contained it, and
 * "founder-gated" was decided per FILE, so one founder handler anywhere in a
 * route file would have cleared every other handler in it.
 *
 * So this block asks the behavioural question, per HANDLER:
 *
 *   does any mounted handler, not itself founder-gated, issue an API key —
 *   i.e. write key material into an API-key store, directly, through raw SQL,
 *   or through any server function that (transitively) does, or call a key
 *   generator?
 *
 * - The STORES are derived from the schema, not typed here: every pgTable named
 *   `*api_keys` or carrying an `api_key` / `api_key_hash` column. A new key
 *   table joins the population by existing.
 * - The HANDLERS are every Express registration in every non-test server file,
 *   found by the TypeScript parser (never a bracket walk), on comment-stripped
 *   source. "Mounted" comes from the canonical route manifest; a route file the
 *   manifest does not classify fails the gate rather than being skipped, and a
 *   non-`routes-*` file is treated as mounted.
 * - FOUNDER-GATED means: a founder gate in the handler's own middleware list
 *   (directly, inside an array, or spread from a same-file const array); a
 *   `router.use(<founder gate>)` on the same receiver registered BEFORE the
 *   handler; or an early `if (!req.isFounder) … return` in the handler body
 *   before the first mint. Mount-level gating in routes.ts is deliberately not
 *   credited — gate a key mint at the handler, where a reader can see it.
 * - Revoking (an update that touches no key material) is not minting; rotating
 *   (an update that writes a hash or key) is.
 *
 * The canaries below run the SAME scanner over fixtures, one per shape.
 */
const FOUNDER_GATES = new Set(["requireFounder", "isFounderAdmin"]);
const CSPRNG_CALL = /\b(?:randomBytes|randomUUID|getRandomValues)\s*\(/;
const HASH_CALL = /\b(?:createHash|createHmac|hashSync)\s*\(|\bbcrypt\.hash\s*\(/;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);

interface KeyStore {
  table: string;
  exportNames: Set<string>;
  materialKeys: Set<string>;
  materialColumns: Set<string>;
}

interface SourceUnit {
  rel: string;
  src: string;
  mounted: boolean;
}

interface Registration {
  rel: string;
  method: string;
  route: string;
  mints: boolean;
  gated: boolean;
  mounted: boolean;
}

interface ScanResult {
  registrations: Registration[];
  offenders: string[];
  minters: Set<string>;
  unparsed: string[];
  routeChains: string[];
}

interface MintSite {
  at: number;
  /** insert = a new stored credential; update = key material rewritten; call = a minter or generator called. */
  kind: "insert" | "update" | "call";
}

const SCHEMA_FILES = [
  "shared/schema.ts",
  ...["shared/schema", "shared/models"].flatMap((dir) =>
    fs
      .readdirSync(path.join(ROOT, dir))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => `${dir}/${f}`),
  ),
];

async function loadKeyStores(): Promise<KeyStore[]> {
  const byTable = new Map<string, KeyStore>();
  for (const file of SCHEMA_FILES) {
    const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(mod)) {
      let table: string;
      try {
        table = getTableConfig(value as never).name;
      } catch {
        continue; // not a pgTable
      }
      if (!table) continue;
      const cols = getTableColumns(value as never) as Record<string, { name: string }>;
      const isStore =
        /api_keys$/.test(table) || Object.values(cols).some((c) => /(^|_)api_key(_hash)?$/.test(c.name));
      if (!isStore) continue;
      const store = byTable.get(table) ?? {
        table,
        exportNames: new Set<string>(),
        materialKeys: new Set<string>(),
        materialColumns: new Set<string>(),
      };
      store.exportNames.add(exportName);
      for (const [key, col] of Object.entries(cols)) {
        if (/key|hash|prefix|last4|secret/.test(col.name)) {
          store.materialKeys.add(key);
          store.materialColumns.add(col.name);
        }
      }
      byTable.set(table, store);
    }
  }
  return [...byTable.values()];
}

function parseSource(rel: string, src: string): { sf: ts.SourceFile; errors: number } {
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, stripComments(src), ts.ScriptTarget.Latest, true, kind);
  const errors = ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length;
  return { sf, errors };
}

function calleeName(call: ts.CallExpression): string | undefined {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return undefined;
}

function storeOf(expr: ts.Expression | undefined, stores: KeyStore[]): KeyStore | undefined {
  if (!expr) return undefined;
  const name = ts.isIdentifier(expr)
    ? expr.text
    : ts.isPropertyAccessExpression(expr)
      ? expr.name.text
      : undefined;
  return name ? stores.find((s) => s.exportNames.has(name)) : undefined;
}

/** The store an `.update(<store>)` somewhere below this chain link targets. */
function updatedStore(expr: ts.Expression, stores: KeyStore[]): KeyStore | undefined {
  let cur: ts.Expression = expr;
  while (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) {
    if (ts.isCallExpression(cur) && calleeName(cur) === "update" && ts.isPropertyAccessExpression(cur.expression)) {
      const s = storeOf(cur.arguments[0], stores);
      if (s) return s;
    }
    cur = cur.expression;
  }
  return undefined;
}

function propertyKey(p: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isShorthandPropertyAssignment(p)) return p.name.text;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
    return p.name.text;
  }
  return undefined;
}

/** Every place inside `node` that writes key material into a store or calls a minter. */
function mintSites(node: ts.Node, sf: ts.SourceFile, stores: KeyStore[], minters: Set<string>): MintSite[] {
  const sites: MintSite[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name === "insert" && ts.isPropertyAccessExpression(n.expression) && storeOf(n.arguments[0], stores)) {
        sites.push({ at: n.getStart(sf), kind: "insert" });
      } else if (name === "set" && ts.isPropertyAccessExpression(n.expression)) {
        const store = updatedStore(n.expression.expression, stores);
        const obj = n.arguments[0];
        if (
          store &&
          (!obj ||
            !ts.isObjectLiteralExpression(obj) ||
            obj.properties.some((p) => ts.isSpreadAssignment(p) || store.materialKeys.has(propertyKey(p) ?? "")))
        ) {
          sites.push({ at: n.getStart(sf), kind: "update" });
        }
      } else if (name && minters.has(name)) {
        sites.push({ at: n.getStart(sf), kind: "call" });
      }
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      const text = n.getText(sf);
      for (const s of stores) {
        const t = s.table.replace(/[^a-z0-9_]/g, "");
        if (new RegExp(`insert\\s+into\\s+"?${t}"?\\b`, "i").test(text)) {
          sites.push({ at: n.getStart(sf), kind: "insert" });
        } else if (
          new RegExp(`update\\s+"?${t}"?\\s+set\\b`, "i").test(text) &&
          [...s.materialColumns].some((c) => text.includes(c))
        ) {
          sites.push({ at: n.getStart(sf), kind: "update" });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return sites;
}

interface NamedFunction {
  name: string;
  body: ts.Node;
}

function namedFunctions(sf: ts.SourceFile): NamedFunction[] {
  const out: NamedFunction[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) out.push({ name: n.name.text, body: n.body });
    else if (ts.isMethodDeclaration(n) && n.body && ts.isIdentifier(n.name)) out.push({ name: n.name.text, body: n.body });
    else if (
      (ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      out.push({ name: n.name.text, body: n.initializer.body });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** `X` itself, an array of gates, or `...X` where X is a same-file const array holding one. */
function isFounderGateExpr(expr: ts.Expression, sf: ts.SourceFile): boolean {
  let e: ts.Expression = expr;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) {
    if (FOUNDER_GATES.has(e.text)) return true;
    const target = e.text;
    let found = false;
    const visit = (n: ts.Node): void => {
      if (found) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === target && n.initializer) {
        let init: ts.Expression = n.initializer;
        while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
        if (ts.isArrayLiteralExpression(init)) found = init.elements.some((el) => isFounderGateExpr(el, sf));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  }
  if (ts.isSpreadElement(e)) return isFounderGateExpr(e.expression, sf);
  if (ts.isArrayLiteralExpression(e)) return e.elements.some((el) => isFounderGateExpr(el, sf));
  return false;
}

function bodyGuardsFounder(handler: ts.Expression, firstMint: number, sf: ts.SourceFile): boolean {
  if (!(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) return false;
  if (!ts.isBlock(handler.body)) return false;
  // Look through a top-level try { … } — the repo's handlers almost all open with one.
  const statements: ts.Statement[] = [];
  for (const st of handler.body.statements) {
    if (ts.isTryStatement(st)) statements.push(...st.tryBlock.statements);
    else statements.push(st);
  }
  for (const st of statements) {
    if (st.getStart(sf) >= firstMint) break;
    if (!ts.isIfStatement(st)) continue;
    if (!/!\s*req\.isFounder\b/.test(st.expression.getText(sf))) continue;
    const then = st.thenStatement;
    const returns = ts.isReturnStatement(then) || (ts.isBlock(then) && then.statements.some(ts.isReturnStatement));
    if (returns) return true;
  }
  return false;
}

function scanForKeyMinting(units: SourceUnit[], stores: KeyStore[]): ScanResult {
  const unparsed: string[] = [];
  const parsed = units.map((u) => {
    const { sf, errors } = parseSource(u.rel, u.src);
    if (errors > 0) unparsed.push(u.rel);
    return { ...u, sf };
  });

  // Minters: generators (a function with "key" in its name that both draws from
  // a CSPRNG and hashes — the hand-out-the-secret, keep-the-verifier shape) plus
  // every function that stores a NEW credential (an insert into a key store),
  // ROTATES one (rewrites key material alongside fresh randomness), or calls a
  // minter — closed transitively over callers. A helper that rewrites a hash
  // with no fresh randomness (dataApiKeys.verifyApiKey upgrading a legacy
  // plaintext row to its hash in place) issues nothing and is not a minter;
  // directly in a HANDLER, every key-material write counts.
  const fns = parsed.flatMap((p) => namedFunctions(p.sf).map((f) => ({ ...f, sf: p.sf })));
  const minters = new Set<string>();
  for (const f of fns) {
    const text = f.body.getText(f.sf);
    if (/key/i.test(f.name) && CSPRNG_CALL.test(text) && HASH_CALL.test(text)) minters.add(f.name);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of fns) {
      if (minters.has(f.name)) continue;
      const sites = mintSites(f.body, f.sf, stores, minters);
      const fresh = CSPRNG_CALL.test(f.body.getText(f.sf));
      if (sites.some((s) => s.kind !== "update" || fresh)) {
        minters.add(f.name);
        changed = true;
      }
    }
  }

  const registrations: Registration[] = [];
  const routeChains: string[] = [];
  for (const p of parsed) {
    const uses: Array<{ receiver: string; at: number; gated: boolean }> = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const receiver = n.expression.expression.getText(p.sf);
        const first = n.arguments[0];
        const firstIsPath =
          !!first &&
          (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first)) &&
          /^["'`]\//.test(first.getText(p.sf));
        if (method === "route" && firstIsPath) routeChains.push(`${p.rel}: ${first.getText(p.sf)}`);
        if (method === "use" && !firstIsPath) {
          uses.push({
            receiver,
            at: n.getStart(p.sf),
            gated: n.arguments.some((a) => isFounderGateExpr(a, p.sf)),
          });
        }
        if (HTTP_METHODS.has(method) && firstIsPath && n.arguments.length >= 2) {
          const sites = mintSites(n, p.sf, stores, minters);
          const handler = n.arguments[n.arguments.length - 1];
          const middleware = n.arguments.slice(1, -1);
          const at = n.getStart(p.sf);
          const gated =
            middleware.some((a) => isFounderGateExpr(a, p.sf)) ||
            uses.some((u) => u.gated && u.receiver === receiver && u.at < at) ||
            (sites.length > 0 && bodyGuardsFounder(handler, Math.min(...sites.map((s) => s.at)), p.sf));
          registrations.push({
            rel: p.rel,
            method: method.toUpperCase(),
            route: first.getText(p.sf).slice(1, -1),
            mints: sites.length > 0,
            gated,
            mounted: p.mounted,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(p.sf);
  }

  const offenders = registrations
    .filter((r) => r.mints && r.mounted && !r.gated)
    .map((r) => `${r.rel} ${r.method} ${r.route}`);
  return { registrations, offenders, minters, unparsed, routeChains };
}

function serverSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(rel);
      }
    }
  };
  walk("server");
  return out.sort();
}

describe("API-key minting, by behaviour: no mounted handler issues a key without a founder gate", () => {
  let stores: KeyStore[] = [];
  let real: ScanResult;
  const manifestFiles = new Set(ROUTE_MANIFEST.map((e) => e.file));
  const unmountedFiles = new Set(Object.keys(KNOWN_NON_MOUNTED));
  const unclassified: string[] = [];

  beforeAll(async () => {
    stores = await loadKeyStores();
    const units: SourceUnit[] = serverSourceFiles().map((rel) => {
      const base = rel.slice("server/".length);
      let mounted = true; // anything outside server/routes-*.ts is assumed reachable
      if (/^routes-[^/]*\.tsx?$/.test(base)) {
        // (server/routes.ts itself is the root registrar, so it is not classified)
        if (manifestFiles.has(base)) mounted = true;
        else if (unmountedFiles.has(base)) mounted = false;
        else unclassified.push(base);
      }
      return { rel, src: fs.readFileSync(path.join(ROOT, rel), "utf8"), mounted };
    });
    real = scanForKeyMinting(units, stores);
  }, REPO_SWEEP_TIMEOUT_MS);

  it("the API-key stores come from the schema, and the known ones are all found", () => {
    const tables = stores.map((s) => s.table).sort();
    expect(tables).toEqual(expect.arrayContaining(["api_keys", "org_api_keys", "system_api_keys", "title_partners"]));
    for (const s of stores) {
      expect(s.exportNames.size, `${s.table} has no export name`).toBeGreaterThan(0);
      expect(s.materialKeys.size, `${s.table} has no key-material column`).toBeGreaterThan(0);
    }
  });

  it("the population is whole: every server file parses, every route file is classified", () => {
    expect(real.unparsed, "server files the parser could not read cleanly — their handlers are unscanned").toEqual([]);
    expect(unclassified, "route files neither in ROUTE_MANIFEST nor KNOWN_NON_MOUNTED").toEqual([]);
    expect(real.routeChains, "router.route(...) chains are not modelled by this scanner — extend it first").toEqual([]);
    // Measured 2026-11-06: 2,770 registrations across 297 server files.
    expect(real.registrations.length).toBeGreaterThan(2500);
    expect(new Set(real.registrations.map((r) => r.rel)).size).toBeGreaterThan(280);
  });

  it("the scanner still SEES the legitimate key mints (per-member vacuity)", () => {
    // Each of these issues a key today and is allowed to. If one stops being
    // seen as minting, the detector broke — not the code.
    const seen = (rel: string, method: string, route: string) =>
      real.registrations.find((r) => r.rel === rel && r.method === method && r.route === route);
    const dataApi = seen("server/routes-data-api.ts", "POST", "/keys");
    const partners = seen("server/routes-title-partners.ts", "POST", "/api/founder/title-partners");
    const dormant = seen("server/routes-api-keys.ts", "POST", "/api/admin/api-keys");
    const rotate = seen("server/routes-api-keys.ts", "POST", "/api/admin/api-keys/:id/regenerate");
    for (const [label, r] of Object.entries({ dataApi, partners, dormant, rotate })) {
      expect(r, `${label}: registration not found`).toBeDefined();
      expect(r!.mints, `${label}: no longer detected as minting`).toBe(true);
    }
    expect(dataApi!.gated, "data-api mint: spread founderOnly no longer recognised").toBe(true);
    expect(partners!.gated, "title-partner mint: in-body founder guard no longer recognised").toBe(true);
    expect(dormant!.mounted, "routes-api-keys.ts is mounted now — the ladder gate must see it").toBe(false);
  });

  it("the founder gates it credits really are founder gates", () => {
    // Crediting a name is only sound if the name does what it says.
    const files = serverSourceFiles();
    for (const gate of FOUNDER_GATES) {
      const defs = files
        .map((rel) => parseSource(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")).sf)
        .flatMap((sf) => namedFunctions(sf).filter((f) => f.name === gate).map((f) => f.body.getText(sf)));
      expect(defs.length, `${gate} has no definition in server/`).toBeGreaterThan(0);
      for (const body of defs) expect(body, `${gate} does not check isFounderIdentity`).toContain("isFounderIdentity(");
    }
    // `req.isFounder` (the in-body guard) is only ever set behind isFounderIdentity.
    const auth = stripComments(fs.readFileSync(path.join(ROOT, "server/auth/clerkAuth.ts"), "utf8"));
    const sets = [...auth.matchAll(/req\.isFounder\s*=\s*true/g)];
    expect(sets.length).toBeGreaterThan(0);
    for (const m of sets) expect(auth.slice(Math.max(0, m.index! - 400), m.index)).toContain("isFounderIdentity(");
    const elsewhere = files.filter(
      (rel) =>
        rel !== "server/auth/clerkAuth.ts" &&
        /req\.isFounder\s*=\s*true/.test(stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"))),
    );
    expect(elsewhere, "req.isFounder is set somewhere new — check it is a founder identity check").toEqual([]);
  });

  it("no mounted, non-founder-gated handler issues an API key", () => {
    expect(
      real.offenders,
      "a MOUNTED handler issues an API key without a founder gate on that handler. " +
        "The expansion ladder puts a public API at ~50 customers, and founder " +
        "ruling 2026-08-15 removed the last customer mint whose keys nothing " +
        "verified. If the threshold has genuinely been crossed, build the " +
        "verifier first, record the founder decision, and change this assertion " +
        "deliberately — do not delete it.",
    ).toEqual([]);
  });

  describe("canaries: the same scanner over one fixture per shape", () => {
    const schemaStub = `import { orgApiKeys, apiKeys } from "@shared/schema";\nimport crypto from "crypto";\n`;
    const scan = (units: SourceUnit[]) => scanForKeyMinting(units, stores).offenders;
    const route = (body: string, mounted = true): SourceUnit => ({
      rel: "server/routes-canary.ts",
      src: `${schemaStub}export function registerCanary(api: any) {\n${body}\n}\n`,
      mounted,
    });
    const mint = `async (req, res) => { await db.insert(orgApiKeys).values({} as any); res.json({}); }`;

    it("inline randomBytes into org_api_keys (the shape that slipped past) is flagged", () => {
      expect(
        scan([
          route(`api.post("/api/org/api-keys", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const rawKey = "acos_" + crypto.randomBytes(20).toString("hex");
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const [row] = await db.insert(orgApiKeys).values({ organizationId: 1, name: "x", keyHash, keyPrefix: rawKey.slice(0, 12) }).returning();
  res.json({ ...row, key: rawKey });
});`),
        ]),
      ).toEqual(["server/routes-canary.ts POST /api/org/api-keys"]);
    });

    it("the generateApiKey helper is flagged even when nothing is stored", () => {
      const helper: SourceUnit = {
        rel: "server/services/canaryKeys.ts",
        src: `export function generateApiKey() { const p = crypto.randomBytes(24).toString("hex"); return { plaintext: p, hashed: crypto.createHmac("sha256", "x").update(p).digest("hex") }; }`,
        mounted: true,
      };
      expect(
        scan([helper, route(`api.post("/api/keys", isAuthenticated, async (req, res) => { const k = generateApiKey(); res.json({ key: k.plaintext }); });`)]),
      ).toEqual(["server/routes-canary.ts POST /api/keys"]);
    });

    it("a RENAMED helper two hops away is flagged (the store write is the invariant, not the name)", () => {
      const svc: SourceUnit = {
        rel: "server/services/canaryCreds.ts",
        src: `${schemaStub}async function persistCredential(orgId: number, h: string) { await db.insert(apiKeys).values({ organizationId: orgId, name: "n", prefix: "p", hashedKey: h, createdBy: "u" }); }
export async function issueAccess(orgId: number) { const s = crypto.randomBytes(16).toString("hex"); await persistCredential(orgId, s); return s; }`,
        mounted: true,
      };
      expect(
        scan([svc, route(`api.post("/api/integrations/token", isAuthenticated, async (req, res) => { res.json({ token: await issueAccess(1) }); });`)]),
      ).toEqual(["server/routes-canary.ts POST /api/integrations/token"]);
    });

    it("raw SQL and a schema-namespaced table reference are flagged", () => {
      expect(
        scan([
          route(`api.post("/a", isAuthenticated, async (req, res) => { await db.execute(sql\`INSERT INTO org_api_keys (key_hash) VALUES (\${"h"})\`); res.json({}); });
api.post("/b", isAuthenticated, async (req, res) => { await db.insert(schema.apiKeys).values({} as any); res.json({}); });`),
        ]),
      ).toEqual(["server/routes-canary.ts POST /a", "server/routes-canary.ts POST /b"]);
    });

    it("rotating (writing a new hash) is minting; revoking (touching no key material) is not", () => {
      expect(
        scan([
          route(`api.post("/rotate/:id", isAuthenticated, async (req, res) => { await db.update(apiKeys).set({ hashedKey: "h", updatedAt: new Date() }).where(eq(apiKeys.id, 1)); res.json({}); });
api.delete("/revoke/:id", isAuthenticated, async (req, res) => { await db.update(orgApiKeys).set({ isRevoked: true }).where(eq(orgApiKeys.id, 1)); res.json({}); });`),
        ]),
      ).toEqual(["server/routes-canary.ts POST /rotate/:id"]);
    });

    it("a helper rotating with fresh randomness is a minter; an in-place hash upgrade is not", () => {
      const svc: SourceUnit = {
        rel: "server/services/canaryRotate.ts",
        src: `${schemaStub}export async function cycleCredential(id: number) { const s = crypto.randomBytes(16).toString("hex"); await db.update(apiKeys).set({ hashedKey: s }).where(eq(apiKeys.id, id)); return s; }
export async function upgradeLegacy(id: number, presented: string) { await db.update(apiKeys).set({ hashedKey: hash(presented) }).where(eq(apiKeys.id, id)); }`,
        mounted: true,
      };
      expect(
        scan([
          svc,
          route(`api.post("/cycle", isAuthenticated, async (req, res) => { res.json({ k: await cycleCredential(1) }); });
api.get("/check", isAuthenticated, async (req, res) => { await upgradeLegacy(1, "x"); res.json({}); });`),
        ]),
      ).toEqual(["server/routes-canary.ts POST /cycle"]);
    });

    it("founder gating is credited per handler, in each recognised form — and only there", () => {
      expect(
        scan([
          route(`const founderOnly = [isAuthenticated, requireFounder] as const;
api.post("/direct", isAuthenticated, requireFounder, ${mint});
api.post("/spread", ...founderOnly, ${mint});
api.post("/array", [isAuthenticated, isFounderAdmin], ${mint});
api.post("/body", isAuthenticated, async (req, res) => { try { if (!req.isFounder) { return Errors.forbidden(res); } await db.insert(orgApiKeys).values({} as any); res.json({}); } catch (e) { res.json({}); } });
api.post("/sibling", isAuthenticated, ${mint});`),
        ]),
        "a founder gate on one handler must not clear its neighbour (the per-file weakness)",
      ).toEqual(["server/routes-canary.ts POST /sibling"]);
    });

    it("router.use(founder gate) covers only handlers registered after it", () => {
      expect(
        scan([route(`router.post("/before", ${mint});\nrouter.use(requireFounder);\nrouter.post("/after", ${mint});`)]),
      ).toEqual(["server/routes-canary.ts POST /before"]);
    });

    it("a guard AFTER the mint is not a gate; a mint in a comment or an unmounted file is not live", () => {
      expect(
        scan([
          route(`api.post("/late", isAuthenticated, async (req, res) => { await db.insert(orgApiKeys).values({} as any); if (!req.isFounder) { return res.json({}); } res.json({}); });
// api.post("/commented", isAuthenticated, async (req, res) => { await db.insert(orgApiKeys).values({}); });`),
          { ...route(`api.post("/dormant", isAuthenticated, async (req, res) => { await db.insert(apiKeys).values({} as any); });`, false), rel: "server/routes-canary-dormant.ts" },
        ]),
      ).toEqual(["server/routes-canary.ts POST /late"]);
    });
  });
});

describe("the marketplace gate is not overridable by a subscription tier", () => {
  it("the marketplace mount uses the strict ladder gate", () => {
    const at = routes.indexOf("app.use('/api/marketplace'");
    expect(at, "the marketplace mount is gone — renamed?").toBeGreaterThan(-1);
    const line = routes.slice(at, routes.indexOf("\n", at));
    expect(
      line,
      "the marketplace is back on featureGate, which lets an enterprise-tier " +
        "org bypass the flag and fails OPEN when the flag store errors — a " +
        "subscription tier must not override a founder decision",
    ).toContain("requireLadderFlag(");
    expect(line).toContain("feature_marketplace");
  });

  it("requireLadderFlag has no enterprise bypass", () => {
    const at = gate.indexOf("export function requireLadderFlag");
    expect(at, "requireLadderFlag is gone").toBeGreaterThan(-1);
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(
      body,
      "requireLadderFlag now honours the enterprise-tier bypass — that is a " +
        "paid plan buying past the expansion ladder",
    ).not.toContain('"enterprise"');
  });

  it("requireLadderFlag fails CLOSED", () => {
    const at = gate.indexOf("export function requireLadderFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    const catchAt = body.indexOf("} catch");
    expect(catchAt, "the flag read is no longer guarded").toBeGreaterThan(-1);
    const tail = body.slice(catchAt);
    expect(
      tail,
      "requireLadderFlag fails OPEN on a flag-store error — a transient " +
        "database blip would open the marketplace",
    ).not.toMatch(/return next\(\)/);
    // The refusal, not the literal status. A first draft asserted `"404"` in
    // the handler and broke the moment the raw `res.status(404)` became
    // `Errors.featureUnavailable` — an assertion coupled to where the number
    // is written rather than to what the code does.
    expect(tail).toContain("Errors.featureUnavailable(");
  });

  it("featureUnavailable really is a 404 (the other half of the check above)", () => {
    // Asserted here because the assertion above deliberately stopped looking
    // for the literal. Split across two checks, the property still holds
    // end to end: the catch refuses, and the refusal is a 404.
    const errors = stripComments(
      fs.readFileSync(path.join(ROOT, "server/utils/errors.ts"), "utf8"),
    );
    const at = errors.indexOf("featureUnavailable(");
    expect(at, "Errors.featureUnavailable is gone").toBeGreaterThan(-1);
    expect(errors.slice(at, at + 220)).toContain("404");
  });

  it("the founder bypass is deliberately KEPT", () => {
    // Not an oversight and not laziness: the founder has to be able to look at
    // the surface they are deciding about. Asserted so a later "tighten
    // everything" pass does not remove it as if it were the same kind of hole.
    const at = gate.indexOf("export function requireLadderFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(body).toContain("isFounderEmail(");
  });

  it("the ordinary featureGate still has its escape hatches (contrast guard)", () => {
    // If `requireFlag` were itself tightened, `requireLadderFlag` would be
    // redundant and this file would be asserting a distinction that no longer
    // exists — which is worth noticing rather than silently maintaining.
    const at = gate.indexOf("export function requireFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(
      body.includes('"enterprise"'),
      "requireFlag no longer has the enterprise bypass, so requireLadderFlag " +
        "may be redundant — collapse them rather than keeping two gates that " +
        "do the same thing",
    ).toBe(true);
  });
});

describe("the constitution registry reflects reality", () => {
  const entry = CONSTITUTION.find((i) => i.id === "expansion.marketplace-25-api-50");

  it("the entry still exists", () => {
    expect(entry, "the expansion-ladder invariant is gone from the registry").toBeDefined();
  });

  it("it is no longer prose-only", () => {
    // The point of the exercise. A hard-stop-adjacent decision backed only by
    // vigilance is one refactor away from being gone, and this one already had
    // a hole (the enterprise bypass) that vigilance had not caught.
    expect(entry!.enforcement.kind).toBe("ratchet-test");
  });

  it("its refs point at things that exist", () => {
    // constitution.test.ts checks this globally; asserted here too so a bad
    // ref in THIS entry fails in the file that owns it.
    for (const ref of entry!.enforcement.refs) {
      expect(fs.existsSync(path.join(ROOT, ref)), `${ref} does not exist`).toBe(true);
    }
    expect(entry!.enforcement.refs).toContain("tests/unit/expansionLadder.test.ts");
  });
});
