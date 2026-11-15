/**
 * W2-TEAM deletions: three team-dashboard reads no screen reached.
 *
 *   GET /api/team-readiness/rep-performance  — the orphan /team/dashboard page;
 *     duplicated the live team dashboard (GET /api/team/performance,
 *     Analytics → Team) and labelled purchase prices as revenue.
 *   GET /api/analytics/team-kpi              — no caller; a hardcoded "—" KPI and
 *     revenue read from columns deals does not have.
 *   GET /api/analytics/team-leaderboard      — no caller; an invented ranking
 *     score and lead counts comparing a team-member id to a user id.
 *
 * Pinned two ways:
 *   1. Through the modules that registered them: each path now 404s, while a
 *      sibling route in the same module still answers (so "404" cannot come
 *      from a module that registered nothing).
 *   2. Across the population of places a route or a claim can live — every
 *      .ts/.tsx/.mjs/.js/.json under server/, shared/, client/src/ and
 *      scripts/ — no STRING LITERAL names a deleted path. Files are parsed
 *      with TypeScript, so a comment recording the deletion is never read as
 *      the defect. A floor on files and literals read, plus a canary (a live
 *      path that must be found), keeps the scan from going vacuous.
 *   3. /team/dashboard is a redirect to the live team tab, not a page.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { clientRoutes } from "../helpers/clientRoutes";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const DELETED = [
  "/api/team-readiness/rep-performance",
  "/api/analytics/team-kpi",
  "/api/analytics/team-leaderboard",
];

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-1" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = { id: 7, subscriptionTier: "pro", seatCount: 3 };
    req.organizationId = 7;
    next();
  },
}));
vi.mock("../../server/utils/permissions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../server/utils/permissions");
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, requireAdminOrAbove: pass, requireOwner: pass, requirePermission: pass, attachPermissionContext: pass };
});
vi.mock("../../server/storage", () => {
  // Every select resolves to no rows — enough for the sibling routes to answer 200.
  const select = () => {
    const q: any = { from: () => q, where: () => q, orderBy: () => q, then: (r: any, j: any) => Promise.resolve([]).then(r, j) };
    return q;
  };
  return { db: { select }, storage: { getNotifications: async () => [] } };
});
vi.mock("../../server/db", () => ({ db: {} }));

async function appWith(register: (a: express.Express) => void) {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

describe("the deleted routes are gone from the modules that registered them", () => {
  it("team-readiness: rep-performance 404s; the rules list still answers", async () => {
    const { registerTeamReadinessRoutes } = await import("../../server/routes-team-readiness");
    const a = await appWith(registerTeamReadinessRoutes);
    expect((await request(a).get("/api/team-readiness/rep-performance")).status).toBe(404);
    expect((await request(a).get("/api/team-readiness/lead-assignment-rules")).status).toBe(200);
  });

  it("analytics: team-kpi and team-leaderboard 404; a sibling route is still registered", async () => {
    const { registerAnalyticsRoutes } = await import("../../server/routes-analytics");
    const a = await appWith(registerAnalyticsRoutes);
    expect((await request(a).get("/api/analytics/team-kpi")).status).toBe(404);
    expect((await request(a).get("/api/analytics/team-leaderboard")).status).toBe(404);
    // Any non-404 proves the module registered routes on this app.
    expect((await request(a).get("/api/notifications")).status).not.toBe(404);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", "build", "__snapshots__", "_archived"].includes(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js|json)$/.test(e) && !/\.test\.|\.spec\./.test(e)) out.push(p);
  }
  return out;
}

function stringsIn(file: string): string[] {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const out: string[] = [];
    const visit = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), visit(x));
    };
    try {
      visit(JSON.parse(text));
    } catch {
      out.push(text); // not strict JSON (e.g. tsconfig with comments): read it whole rather than skip it
    }
    return out;
  }
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("no route registration, client caller or registry still names a deleted path", () => {
  it("scans server/, shared/, client/src/ and scripts/ string literals", () => {
    const files = ["server", "shared", "client/src", "scripts"].flatMap((d) => walk(path.join(ROOT, d)));
    let literals = 0;
    let canary = 0;
    const hits: string[] = [];
    for (const f of files) {
      for (const s of stringsIn(f)) {
        literals++;
        if (s.includes("/api/team/performance")) canary++;
        for (const d of DELETED) if (s.includes(d)) hits.push(`${path.relative(ROOT, f)}: ${d}`);
      }
    }
    expect(files.length, "population shrank — is the scan reading the repo?").toBeGreaterThan(2000);
    expect(literals, "too few literals read — the parser stopped matching").toBeGreaterThan(100000);
    expect(canary, "canary: the live team dashboard path was not found").toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});

describe("/team/dashboard", () => {
  it("is a redirect (to Analytics → Team), not a page", () => {
    const route = clientRoutes().find((r) => r.path === "/team/dashboard");
    expect(route?.kind).toBe("redirect");
    const app = readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
    expect(app).not.toMatch(/import\(\s*"@\/pages\/team-manager-dashboard"\s*\)/);
    expect(app).toMatch(/<Route path="\/team\/dashboard">[\s\S]{0,200}?<Redirect to="\/analytics#team" \/>/);
  });
});
