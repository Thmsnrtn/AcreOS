/**
 * Public health probes answer status only; the component list needs a session.
 *
 * The 2026-08-31 fix redacted /api/health and /api/health/live by reading
 * req.auth — in a block that runs BEFORE clerkMiddleware, where req.auth never
 * exists. Those two were terse by accident, and /api/health/cached — Fly's own
 * health-check target in the same block — returned every provider's name,
 * state and failure text to anyone. /api/health/:service, /deep and /replica
 * answered without a session at all.
 *
 * Population: every `GET /api/health…` registration in server/, found by scan
 * and classified below. A new one fails the classification until it is placed.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => ({ overall: "degraded" }));
vi.mock("../../server/services/healthCheck", () => {
  const snapshot = () => ({
    overall: h.overall,
    timestamp: new Date("2026-10-07T00:00:00Z"),
    services: [
      { name: "regrid", status: "unavailable", message: "HTTP 401 from regrid: invalid token" },
      { name: "stripe", status: "unconfigured", message: "STRIPE_SECRET_KEY not set" },
    ],
  });
  return { healthCheckService: { getLastResults: snapshot, checkAll: async () => snapshot() } };
});

const PUBLIC_KEYS = new Set(["overall", "timestamp", "version", "uptime"]);

async function app() {
  const a = express();
  const { registerPublicHealthRoutes } = await import("../../server/routes-health");
  registerPublicHealthRoutes(a);
  return a;
}

describe("the public health probes", () => {
  for (const path of ["/api/health", "/api/health/live", "/api/health/cached"]) {
    it(`${path} carries no component list, vendor name or failure text`, async () => {
      h.overall = "degraded";
      const res = await request(await app()).get(path);
      expect(res.status).toBe(200);
      for (const k of Object.keys(res.body)) expect(PUBLIC_KEYS.has(k), `${path} exposes "${k}"`).toBe(true);
      expect(res.body.overall).toBe("degraded");
      expect(res.text).not.toMatch(/regrid|stripe|401|STRIPE_SECRET_KEY|services/i);
    });

    it(`${path} still answers 503 when unavailable (what Fly, Docker and CI read)`, async () => {
      h.overall = "unavailable";
      const res = await request(await app()).get(path);
      expect(res.status).toBe(503);
      expect(res.body.overall).toBe("unavailable");
    });
  }
});

describe("every GET /api/health* registration is classified", () => {
  const root = resolve(__dirname, "../../server");
  const regs: Array<{ file: string; path: string; args: string }> = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const n = e.name;
      const p = join(d, n);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.ts$/.test(n) && !/\.test\.ts$/.test(n)) {
        const src = stripComments(readFileSync(p, "utf8"));
        for (const m of src.matchAll(/\b(?:app|api|router)\.get\(\s*["'](\/api\/health[^"']*)["']([^\n]*)/g)) {
          regs.push({ file: p.slice(root.length + 1), path: m[1], args: m[2] });
        }
      }
    }
  };
  walk(root);

  it("finds the family (vacuity floor)", () => {
    expect(regs.length).toBeGreaterThanOrEqual(9);
  });

  it("each one is status-only (routes-health.ts), founder-gated, or a named detail-free probe", () => {
    // Detail-free by construction — each named with what it returns.
    const DETAIL_FREE: Record<string, string> = {
      "/api/healthz": "{ ok, uptime }",
      "/api/health/auth-config": "secret-free Clerk diagnostic, only with a session cookie",
      "/api/health/worker-heartbeat": "worker liveness: last beat, age, threshold",
    };
    const FOUNDER_ONLY = new Set(["/api/health/:service", "/api/health/deep", "/api/health/replica"]);
    for (const r of regs) {
      if (r.file === "routes-health.ts") continue;
      if (FOUNDER_ONLY.has(r.path)) {
        expect(r.args, `${r.path} (${r.file}) must require a founder session`).toMatch(/isAuthenticated[^)]*requireFounder/);
        continue;
      }
      expect(DETAIL_FREE[r.path], `${r.path} in ${r.file} is unclassified`).toBeDefined();
    }
    expect(regs.filter((r) => r.file === "routes-health.ts").map((r) => r.path).sort()).toEqual([
      "/api/health",
      "/api/health/cached",
      "/api/health/live",
    ]);
  });

  it("the signed-in detail view requires a session, and the client reads it there", () => {
    const integ = stripComments(readFileSync(join(root, "routes-integrations.ts"), "utf8"));
    expect(integ).toMatch(/api\.get\("\/api\/system\/health",\s*isAuthenticated,/);
    for (const f of ["components/system-health.tsx", "pages/pax.tsx", "components/campaigns-content.tsx"]) {
      const src = stripComments(readFileSync(resolve(__dirname, "../../client/src", f), "utf8"));
      expect(src, f).not.toMatch(/\/api\/health\/cached/);
      expect(src, f).toMatch(/\/api\/system\/health/);
    }
  });
});
