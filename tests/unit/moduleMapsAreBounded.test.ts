/**
 * DEFECT-0055 — module-level Maps keyed by client-controlled values are bounded.
 *
 * A module-level Map that is written and never deleted, cleared or
 * size-checked lives as long as the process. When its keys come from traffic
 * — an IP, an email, a coordinate pair, a job id — every web machine leaks in
 * proportion to distinct traffic. Seven such maps now use BoundedMap.
 *
 * Population: EVERY module-level `new Map` in server/ that only grows. Each
 * remaining one is registered below with the reason its key space is bounded,
 * and the register is compared both ways with what the source actually holds,
 * so a new grow-only Map fails until someone says why it cannot grow.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { BoundedMap } from "../../server/utils/boundedMap";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
    req.user = { id: req.headers["x-user"] };
    next();
  },
}));
vi.mock("../../server/services/certification", () => ({
  certificationService: {
    checkAndAward: vi.fn(async () => ({ awarded: false })),
    issueCertificate: vi.fn(async () => null),
    checkAchievements: vi.fn(async () => []),
    getLearningStats: vi.fn(async () => ({})),
  },
}));

import certificationRouter from "../../server/routes-certification";

describe("BoundedMap", () => {
  it("evicts the oldest key past the cap", () => {
    const m = new BoundedMap<string, number>(3);
    for (const k of ["a", "b", "c", "d"]) m.set(k, 1);
    expect([...m.keys()]).toEqual(["b", "c", "d"]);
  });

  it("re-setting a key makes it the newest", () => {
    const m = new BoundedMap<string, number>(2);
    m.set("a", 1).set("b", 1).set("a", 2).set("c", 1);
    expect([...m.keys()]).toEqual(["a", "c"]);
    expect(m.get("a")).toBe(2);
  });

  it("refuses a nonsense cap", () => {
    expect(() => new BoundedMap(0)).toThrow();
  });
});

/** Grow-only module Maps whose key space is bounded by construction. */
const BOUNDED_BY_CONSTRUCTION: Record<string, string> = {
  "server/jobs/scheduler.ts::_runtimeStatus": "keyed by registered job name",
  "server/mcp-server.ts::rateLimitMap": "keyed by organization id",
  "server/routes-deal-feed.ts::refreshTimestamps": "keyed by organization id",
  "server/services/agentActionExecutors.ts::executors": "static registry of executors",
  "server/services/aiCostCeiling.ts::lastKnownOrgDailyCents": "keyed by organization id",
  "server/services/certification.ts::achievementStore": "keyed by awarded achievement; the surface is flag-gated (DEFECT-0127)",
  "server/services/certification.ts::certificateStore": "keyed by awarded certificate; the surface is flag-gated (DEFECT-0127)",
  "server/services/certification.ts::userAchievements": "keyed by user; the surface is flag-gated (DEFECT-0127)",
  "server/services/certification.ts::userCertificates": "keyed by user; the surface is flag-gated (DEFECT-0127)",
  "server/services/comms/router.ts::REGISTRY": "static provider registry",
  "server/services/connections/platformConnections.ts::resolveCache": "keyed by platform config key",
  "server/services/contentEvolution.ts::revertTracker": "keyed by the SAFE_EVOLUTION_DOMAINS list",
  "server/services/dataQualityMonitor.ts::healthHistory": "keyed by data source name; each array is trimmed to 100",
  "server/services/lcsCalibrator.ts::lcsWeightHistory": "keyed by organization id",
  "server/services/lcsCalibrator.ts::orgWeights": "keyed by organization id",
  "server/services/outcomeVerifiers.ts::verifiers": "static registry of verifiers",
  "server/services/undoRegistry.ts::undoFunctions": "keyed by agent:action registered at boot",
  "server/services/voiceProfileTrigger.ts::newSampleCounts": "keyed by organization id",
};

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") serverFiles(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("DEFECT-0055 population — grow-only module Maps", () => {
  const ROOT = resolve(__dirname, "../..");
  const found: string[] = [];
  let moduleMaps = 0;
  for (const p of serverFiles(resolve(ROOT, "server"))) {
    const src = stripComments(readFileSync(p, "utf8"));
    for (const m of src.matchAll(/^(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::[^=\n]+)?=\s*new\s+Map\b/gm)) {
      moduleMaps++;
      const name = m[1];
      const grows = new RegExp(`\\b${name}\\.set\\(`).test(src);
      const shrinks = new RegExp(`\\b${name}\\.(delete|clear)\\(|\\b${name}\\.size\\b`).test(src);
      if (grows && !shrinks) found.push(`${relative(ROOT, p)}::${name}`);
    }
  }

  it("reads the module Maps (vacuity floor)", () => {
    expect(moduleMaps).toBeGreaterThanOrEqual(45); // 57 typed-or-untyped module Maps at 2026-09-28
  });

  it("every grow-only module Map is registered as bounded by construction (both directions)", () => {
    expect(found.sort()).toEqual(Object.keys(BOUNDED_BY_CONSTRUCTION).sort());
  });
});

describe("DEFECT-0127 — certification routes act on the session user only", () => {
  const app = express();
  app.use("/api/certification", certificationRouter);

  it("refuses another user's id in the path", async () => {
    for (const path of ["/achievements/victim", "/stats/victim", "/certificate/victim/1"]) {
      const res = await request(app).get(`/api/certification${path}`).set("x-user", "attacker");
      expect(res.status, path).toBe(403);
    }
    const post = await request(app).post("/api/certification/check/victim/1").set("x-user", "attacker");
    expect(post.status).toBe(403);
  });

  it("lets a user reach their own path", async () => {
    const res = await request(app).get("/api/certification/stats/me").set("x-user", "me");
    expect(res.status).not.toBe(403);
  });
});
