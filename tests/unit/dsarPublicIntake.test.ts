/**
 * Autopilot B-3 — the public DSAR stub route is cured at source.
 *
 * Before B-3 there were two public DSAR doors writing two different
 * tables: POST /api/privacy/dsar (canonical, dsar_requests_lifecycle,
 * 24h clock, NO abuse controls) and POST /api/public/dsar (legacy alias,
 * dsar_requests, per-IP rate limit + Turnstile, but a "within 30 days"
 * promise against the ratified strict 24h internal clock — Tap #4), plus
 * founder fan-out/erasure handlers on the legacy table that always threw
 * NOT_IMPLEMENTED.
 *
 * These tests drive BOTH real route registrars (express + supertest,
 * mocked db capturing inserts) and pin:
 *   1. the legacy alias now writes the canonical lifecycle record with
 *      slaDeadlineAt − now === DSAR_CLOCK_HOURS and 24h-posture copy —
 *      no 30-day promise anywhere in the response;
 *   2. the canonical door stamps the same clock;
 *   3. BOTH doors enforce Turnstile when it is configured (403 without a
 *      token) — the canonical door gained the alias's defences, so
 *      retiring the stub does not retire the only protected door;
 *   4. BOTH doors share the per-IP rate limit: the 6th submission from
 *      one client IP inside the hour is a 429 RATE_LIMITED;
 *   5. in source: the legacy file no longer contains an execution stub
 *      or a 30-day promise, no longer inserts into dsar_requests, and
 *      the S-1 borrower-erasure refusal in gdprService is untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const intakeDb = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>> }));

vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          intakeDb.inserted.push(v);
          return [{ id: `intake-row-${intakeDb.inserted.length}`, ...v }];
        },
      }),
    }),
  },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireFounder: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/utils/auditLog", () => ({
  auditFromRequest: vi.fn(async () => undefined),
  AuditActions: {
    DSAR_INTAKE: "dsar.intake",
    DSAR_VERIFIED: "dsar.verified",
    DSAR_DENIED: "dsar.denied",
    DSAR_ERASURE: "dsar.erasure",
    DSAR_COMPLETED: "dsar.completed",
  },
}));
vi.mock("../../server/services/founder", () => ({
  isFounderIdentity: () => true,
}));
vi.mock("../../server/services/privacy/dsarActionGate", () => ({
  gateDsarAction: vi.fn(),
  listDsarSubjectCandidates: vi.fn(),
  loadDsarRecord: vi.fn(),
}));
vi.mock("../../server/services/privacy/dsarExporters", () => ({
  buildSubjectExport: vi.fn(),
}));
vi.mock("../../server/services/gdprService", () => ({
  eraseDsarSubject: vi.fn(),
  DsarErasureRefusedError: class extends Error {},
}));
vi.mock("../../server/services/legalHold", () => ({
  LegalHoldViolationError: class extends Error {},
}));

import { registerDsarRoutes } from "../../server/routes-dsar";
import { registerPrivacyDsarRoutes } from "../../server/routes-privacy-dsar";
import { clock } from "../../server/utils/clock";
import { DSAR_CLOCK_HOURS } from "@shared/privacy/dsarClock";

const FROZEN_MS = Date.parse("2026-11-18T05:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function buildApp() {
  const app = express();
  app.use(express.json());
  registerPrivacyDsarRoutes(app);
  registerDsarRoutes(app);
  return app;
}

// Each test keys the shared limiter on its own client IP (the limiter
// keys on CF-Connecting-IP via getClientIp), so buckets never leak
// between cases.
const ip = (n: number) => ({ "CF-Connecting-IP": `198.51.100.${n}` });

describe("B-3 public DSAR intake — one canonical pipeline", () => {
  beforeEach(() => {
    intakeDb.inserted = [];
    delete process.env.CLOUDFLARE_TURNSTILE_SECRET;
    vi.spyOn(clock, "nowMs").mockReturnValue(FROZEN_MS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLOUDFLARE_TURNSTILE_SECRET;
  });

  it("POST /api/public/dsar writes the lifecycle record on the 24h clock with honest copy", async () => {
    const res = await request(buildApp())
      .post("/api/public/dsar")
      .set(ip(11))
      .send({
        requestType: "erasure",
        email: "Former.Lead@Example.Test",
        fullName: "Former Lead",
        justification: "Delete everything you hold about me.",
      });
    expect(res.status).toBe(201);
    expect(intakeDb.inserted).toHaveLength(1);
    const row = intakeDb.inserted[0]!;
    expect(row.requestType).toBe("erasure");
    expect(row.requesterEmail).toBe("former.lead@example.test");
    expect((row.slaDeadlineAt as Date).getTime() - FROZEN_MS).toBe(DSAR_CLOCK_HOURS * HOUR_MS);
    // The requester's name/justification survive for the founder's
    // identity check — they ride in auditNotes, the lifecycle notes field.
    expect(String(row.auditNotes)).toContain("Former Lead");
    expect(String(row.auditNotes)).toContain("Delete everything");
    // Honest copy: 24-hour target named, no 30-day promise, deadline echoed.
    const body = JSON.stringify(res.body);
    expect(body).toContain("24-hour");
    expect(body).not.toMatch(/30 days/);
    expect(new Date(res.body.slaDeadlineAt).getTime()).toBe(FROZEN_MS + DSAR_CLOCK_HOURS * HOUR_MS);
  });

  it("POST /api/privacy/dsar stamps the same shared clock", async () => {
    const res = await request(buildApp())
      .post("/api/privacy/dsar")
      .set(ip(12))
      .send({ requestType: "access", requesterEmail: "Canon@Example.Test", notes: "All my data." });
    expect(res.status).toBe(201);
    expect(intakeDb.inserted).toHaveLength(1);
    const row = intakeDb.inserted[0]!;
    expect(row.requesterEmail).toBe("canon@example.test");
    expect((row.slaDeadlineAt as Date).getTime() - FROZEN_MS).toBe(DSAR_CLOCK_HOURS * HOUR_MS);
    expect(JSON.stringify(res.body)).not.toMatch(/30 days/);
  });

  it("both doors refuse a tokenless submission when Turnstile is configured", async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET = "test-secret-not-a-real-key";
    const legacy = await request(buildApp())
      .post("/api/public/dsar")
      .set(ip(13))
      .send({ requestType: "access", email: "a@example.test", fullName: "A Person" });
    expect(legacy.status).toBe(403);
    const canonical = await request(buildApp())
      .post("/api/privacy/dsar")
      .set(ip(14))
      .send({ requestType: "access", requesterEmail: "a@example.test" });
    expect(canonical.status).toBe(403);
    // Neither refusal wrote a record.
    expect(intakeDb.inserted).toHaveLength(0);
  });

  it("the shared per-IP rate limit caps the canonical door at 5/hour", async () => {
    const app = buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/privacy/dsar")
        .set(ip(15))
        .send({ requestType: "access", requesterEmail: `flood${i}@example.test` });
      statuses.push(res.status);
      if (i === 5) {
        expect(res.body.error).toBe("RATE_LIMITED");
      }
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(intakeDb.inserted).toHaveLength(5);
  });
});

describe("B-3 source pins — the stub and the false promise are gone", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  it("routes-dsar.ts has no execution stub and no 30-day promise", () => {
    const src = read("server/routes-dsar.ts");
    expect(src).not.toContain("notImplemented");
    expect(src).not.toContain("NOT_IMPLEMENTED");
    expect(src).not.toMatch(/30 days/);
    expect(src).not.toContain("runFanOutStub");
    expect(src).not.toContain("runErasureStub");
  });

  it("routes-dsar.ts intake writes the lifecycle table, never dsar_requests", () => {
    const src = read("server/routes-dsar.ts");
    expect(src).toContain("insert(dsarRequestsLifecycle)");
    expect(src).not.toContain("insert(dsarRequests)");
  });

  it("both doors mount the shared intake guards", () => {
    expect(read("server/routes-dsar.ts")).toContain("dsarIntakeLimiter");
    const canonical = read("server/routes-privacy-dsar.ts");
    expect(canonical).toContain("dsarIntakeLimiter");
    expect(canonical).toContain("verifyDsarTurnstile");
  });

  it("the S-1 borrower-erasure refusal stands untouched in gdprService", () => {
    const src = read("server/services/gdprService.ts");
    expect(src).toContain("RETENTION_REQUIRED_LOAN_RECORDS");
    expect(src).toContain("ruling S-1 stands");
  });
});
