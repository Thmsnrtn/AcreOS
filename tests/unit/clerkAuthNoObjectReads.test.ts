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
 *   1. any reference to `req.auth` / `(cast).auth` other than an assignment —
 *      a raw read, however it is later used;
 *   2. a Clerk auth-object field read off ANY `.auth` member
 *      (`x.auth?.userId`, `(req as any).auth.sessionId`, …);
 *   3. `req["auth"]` / `req['auth']`;
 *   4. destructuring `auth` out of a request (`const { auth } = req`);
 *   5. an inline type literal that types `auth` as an object holding Clerk
 *      fields (`{ auth?: { userId?: string } }`) — the cast the census missed.
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

const RULES: Array<{ name: string; re: RegExp }> = [
  // `req.auth` or `(…).auth` not immediately assigned (`=` but not `==`/`=>`).
  { name: "raw req.auth read", re: /(?:\breq\b|\))\s*\??\.\s*auth\b(?!\s*=(?![=>]))/g },
  { name: "Clerk field read off .auth", re: new RegExp(String.raw`\.\s*auth\s*\??\.\s*(?:${FIELDS})\b`, "g") },
  { name: "req[\"auth\"] read", re: /\breq\s*\??\.?\s*\[\s*["'`]auth["'`]\s*\]/g },
  { name: "auth destructured from a request", re: /\{[^{}]*\bauth\b[^{}]*\}\s*=\s*\(?\s*req\b/g },
  { name: "inline auth object type", re: new RegExp(String.raw`\bauth\s*\??\s*:\s*\{[^{}]*\b(?:${FIELDS})\b`, "g") },
];

function findings(source: string): Array<{ rule: string; line: number; text: string }> {
  const stripped = stripComments(source);
  const out: Array<{ rule: string; line: number; text: string }> = [];
  for (const { name, re } of RULES) {
    for (const m of stripped.matchAll(re)) {
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
  };
  for (const [name, code] of Object.entries(permitted)) {
    it(`permits: ${name}`, () => {
      expect(findings(code), code).toEqual([]);
    });
  }
});
