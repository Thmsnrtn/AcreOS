/**
 * No server code reads Clerk's `req.auth` as an object — every read goes
 * through `getClerkAuth(req)` (server/types/request.ts).
 *
 * @clerk/express 2.x installs `req.auth` as a FUNCTION. Reading a field off it
 * (`req.auth?.userId`) is always `undefined`, silently: before Fix B, 28 such
 * reads (plus two cast-form ones a literal `req.auth?.` grep never saw) threw
 * away the middleware's verdict on every request, and cookie auth survived
 * only on hydrateUser's CLERK_JWT_KEY fallback.
 *
 * The forbidden behaviour is "consume Clerk's auth state without the
 * normalizer", so the rule forbids every spelling of it, not one identifier:
 *   1. any `.auth` read on any receiver (`req`, `request`, a cast, an alias,
 *      a spread copy) other than an assignment target — a raw read, however
 *      it is later used. Non-Clerk receivers are allowlisted BY NAME, each
 *      checked by hand (Web Push keys, the rate-limit bucket config);
 *   2. a Clerk auth-object field read off ANY `.auth` member
 *      (`x.auth?.userId`, `(req as any).auth.sessionId`, …);
 *   3. string-keyed access: `x["auth"]`, `Reflect.get(x, "auth")`, …;
 *   4. destructuring `auth` — in a declaration or in a parameter list;
 *   5. an inline type literal that types `auth` as an object holding Clerk
 *      fields (`{ auth?: { userId?: string } }`) — the cast the census missed;
 *   6. installing the OBJECT shape on a request (`req.auth = { … }`,
 *      `Object.assign(req, { auth: { … } })`) — the pre-Fix-B test bypass,
 *      which hid the break from the suite.
 *
 * Rules 1–6 were widened after an independent audit showed the first
 * version (receiver `req` only) passing `request.auth`, `({ auth }) =>`,
 * `Reflect.get(req, "auth")` and a reverted object-shape bypass.
 *
 * Population: every .ts/.js/.mjs/.cjs file under server/, comments stripped
 * with the real scanner (tests/helpers/stripComments). Allowlist: the helper's
 * own file only. Vacuity floors: file count, the helper found and still
 * normalizing the callable, and a floor on getClerkAuth call sites. Canaries:
 * each forbidden shape, hidden in a fixture, must be flagged; each permitted
 * shape must not be.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const SERVER = path.join(ROOT, "server");
const HELPER_FILE = "server/types/request.ts";
const ALLOWLIST = new Set([HELPER_FILE]);

/** Fields of @clerk/backend 3.x's SignedInAuthObject / SignedOutAuthObject. */
const CLERK_AUTH_FIELDS = [
  "userId", "sessionId", "sessionClaims", "sessionStatus", "actor", "tokenType",
  "orgId", "orgRole", "orgSlug", "orgPermissions", "factorVerificationAge",
  "getToken", "has", "debug", "isAuthenticated",
];
const FIELDS = CLERK_AUTH_FIELDS.join("|");

/**
 * Receivers whose `.auth` is NOT Clerk's — each one checked by hand:
 *   keys / subscription  — Web Push subscription key material (p256dh + auth)
 *   RATE_LIMIT_CONFIGS   — the auth-route rate-limit bucket config
 * Any other receiver's `.auth` read (request, r, a spread copy of req, …)
 * is treated as Clerk's and must go through getClerkAuth.
 */
const NON_CLERK_AUTH_RECEIVERS = new Set(["keys", "subscription", "RATE_LIMIT_CONFIGS"]);

const RULES: Array<{ name: string; re: RegExp; receiverGroup?: number }> = [
  // Any `<receiver>.auth` / `(…).auth` that is not an assignment target
  // (`=` but not `==`/`=>`): a raw read, however it is used afterwards.
  {
    name: "raw .auth read",
    re: /(?:([A-Za-z_$][\w$]*)|\))\s*\??\.\s*auth\b(?!\s*=(?![=>]))/g,
    receiverGroup: 1,
  },
  { name: "Clerk field read off .auth", re: new RegExp(String.raw`\.\s*auth\s*\??\.\s*(?:${FIELDS})\b`, "g") },
  // `x["auth"]`, `Reflect.get(x, "auth")`, `Object.getOwnPropertyDescriptor(x, "auth")`, …
  { name: "string-keyed auth access", re: /\[\s*["'`]auth["'`]\s*\]|\b(?:Reflect\.get|Object\.getOwnPropertyDescriptor|_\.get|lodash\.get)\([^()]*["'`]auth["'`]/g },
  // `const { auth } = request`, `let { auth: a, user } = r`, …
  { name: "auth destructured in a declaration", re: /\b(?:const|let|var)\s*\{[^{}]*\bauth\b[^{}]*\}\s*=/g },
  // `({ auth }) => …`, `function h({ auth }: Req) {…}`, `async ({ auth, user }, res) => …`.
  // A parameter list is followed by `=>` or a body; an object-literal CALL
  // argument (`push({ auth: … })`) is not, and must not match.
  {
    name: "auth destructured in a parameter",
    re: /\(\s*\{[^{}]*\bauth\b[^{}]*\}\s*(?::[^(){}=]*)?\)\s*(?::[^={;]*)?(?:=>|\{)/g,
  },
  { name: "inline auth object type", re: new RegExp(String.raw`\bauth\s*\??\s*:\s*\{[^{}]*\b(?:${FIELDS})\b`, "g") },
  // Installing the OBJECT shape on a request (the pre-Fix-B test-auth bypass):
  // `req.auth = { … }`, `Object.assign(req, { auth: { … } })`.
  { name: "object-shaped req.auth installed", re: /\b(?:req|request)\s*\.\s*auth\s*=\s*\{|\bObject\.assign\(\s*(?:req|request)\b[^;]*?\bauth\s*:\s*\{/g },
];

function findings(source: string): Array<{ rule: string; line: number; text: string }> {
  const stripped = stripComments(source);
  const out: Array<{ rule: string; line: number; text: string }> = [];
  for (const { name, re, receiverGroup } of RULES) {
    for (const m of stripped.matchAll(re)) {
      if (receiverGroup !== undefined && NON_CLERK_AUTH_RECEIVERS.has(m[receiverGroup] ?? "")) continue;
      const line = stripped.slice(0, m.index).split("\n").length;
      out.push({ rule: name, line, text: stripped.split("\n")[line - 1].trim() });
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("server code never reads Clerk's req.auth as an object", () => {
  const files = walk(SERVER).map((abs) => ({ rel: path.relative(ROOT, abs).split(path.sep).join("/"), abs }));

  it("vacuity: the scan read the server tree and found the helper", () => {
    expect(files.length).toBeGreaterThan(1000);
    const helper = files.find((f) => f.rel === HELPER_FILE);
    expect(helper, "server/types/request.ts must be in the population").toBeDefined();
    const src = stripComments(readFileSync(helper!.abs, "utf8"));
    expect(src).toMatch(/export function getClerkAuth\(/);
    expect(src).toMatch(/typeof raw === "function"/);
    // The clerkAuth.ts reads, the MFA gate, the two Pax gates and the 21
    // pre-existing helper call sites all route through it.
    const callSites = files
      .filter((f) => f.rel !== HELPER_FILE)
      .reduce((n, f) => n + (stripComments(readFileSync(f.abs, "utf8")).match(/\bgetClerkAuth\(/g)?.length ?? 0), 0);
    expect(callSites).toBeGreaterThanOrEqual(30);
  });

  it("finds no object-style req.auth read outside the helper", () => {
    const violations: string[] = [];
    for (const f of files) {
      if (ALLOWLIST.has(f.rel)) continue;
      for (const v of findings(readFileSync(f.abs, "utf8"))) {
        violations.push(`${f.rel}:${v.line} [${v.rule}] ${v.text}`);
      }
    }
    expect(violations, "read Clerk auth via getClerkAuth(req) — req.auth is a function in @clerk/express 2.x").toEqual([]);
  });
});

describe("canaries — each forbidden shape is flagged, each permitted one is not", () => {
  const forbidden: Record<string, string> = {
    "optional member read": "const id = req.auth?.userId ?? null;",
    "plain member read": "if (req.auth.userId) next();",
    "cast member read": "const id = (req as Request & { x: 1 }).auth?.userId;",
    "any-cast session read": "const s = (req as any).auth.sessionId;",
    "raw alias read": "const a = req.auth; use(a);",
    "other-receiver field read": "const fva = request.auth?.factorVerificationAge;",
    "index read": 'const a = req["auth"];',
    "destructure": "const { auth, user } = req;",
    "inline cast type": "const a = (req as { auth?: { userId?: string } });",
    "multi-line cast": "const id = (req as AuthenticatedRequest & { auth?: { userId?: string } })\n  .auth?.userId;",
    // Audit-found evasions of the first version:
    "other receiver aliased": "const a = request.auth; const id = a?.userId;",
    "short receiver aliased": "const a = r.auth; use(a);",
    "spread copy read": "const c = { ...req }; const a = c.auth;",
    "destructure from request": "const { auth } = request;",
    "destructure with rename": "let { auth: clerk, user } = r;",
    "param destructure arrow": "app.get('/x', ({ auth }) => auth?.userId);",
    "param destructure typed": "function h({ auth, user }: Req, res: Res) { return auth; }",
    "Reflect.get": 'const a = Reflect.get(req, "auth");',
    "descriptor read": 'const d = Object.getOwnPropertyDescriptor(req, "auth");',
    "object bypass reverted": "req.auth = { userId: resolveTestUserId(req.headers.cookie) };",
    "object installed via assign": "Object.assign(req, { auth: { userId: 'u1' } });",
  };
  for (const [name, code] of Object.entries(forbidden)) {
    it(`flags: ${name}`, () => {
      expect(findings(code).length, code).toBeGreaterThan(0);
    });
  }

  const permitted: Record<string, string> = {
    "helper read": "const id = getClerkAuth(req)?.userId ?? null;",
    "local named auth": "const auth = getClerkAuth(req); const id = auth?.userId;",
    "bypass assignment": "req.auth = () => ({ userId: testUserId });",
    "comment mention": "// reading req.auth?.userId here was always undefined\nconst x = 1;",
    "block comment": "/* req.auth.userId (object shape) */ const y = 2;",
    "rate-limit config": "windowMs: RATE_LIMIT_CONFIGS.auth.windowMs,",
    "push keys": "VALUES (${keys.p256dh}, ${keys.auth})",
    "push subscription": "auth: subscription.auth,",
    "health status assignment": 'services.auth = { status: "configured", latencyMs: 0 };',
    "object literal with auth value": "const body = { endpoint, keys: { p256dh, auth: k } };",
    "object-literal call argument": "checks.push({ key: 'auth', auth: probe.ok });",
    "call argument inside if": "if (validate({ auth: token })) { go(); }",
  };
  for (const [name, code] of Object.entries(permitted)) {
    it(`permits: ${name}`, () => {
      expect(findings(code), code).toEqual([]);
    });
  }
});
