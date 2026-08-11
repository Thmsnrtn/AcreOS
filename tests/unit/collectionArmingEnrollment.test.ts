/**
 * R-3 enrollment chokepoint — BEHAVIOURAL test (founder ruling 2026-08-11).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM collectionArmingGate.test.ts:
 * The first version of the chokepoint assertion was a presence check —
 * `expect(enrollBlock).toContain("assertSequenceArmed")`. Mutation M6 replaced
 * the real guard with `void assertSequenceArmed;`, deleting the refusal while
 * leaving the substring in place, and the suite stayed GREEN. That is exactly
 * the one-directional shape the standing rules call out: it proved the symbol
 * appeared and nothing about what it did.
 *
 * So the chokepoint is pinned here by BEHAVIOUR instead: drive the real Express
 * handler and assert on the response AND on whether an enrollment row was
 * created. "Contacts nobody" is only true if no enrollment exists, so
 * `createCollectionEnrollment` call count is the load-bearing assertion — it
 * cannot be satisfied by any amount of dead code that merely mentions the gate.
 *
 * MONEY POSTURE: nothing here moves money.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = 7;

/** Ladder deliberately unlike any plausible default. */
const STEPS = [
  { stepNumber: 1, daysAfterDue: -6, channel: "sms" as const, escalationLevel: "reminder" as const },
  { stepNumber: 2, daysAfterDue: 21, channel: "call" as const, escalationLevel: "urgent" as const },
];

/** Rows the mocked storage serves, keyed by sequence id. */
const SEQUENCES = new Map<number, Record<string, unknown>>();
/** Every enrollment the route actually managed to create. */
const CREATED: Array<Record<string, unknown>> = [];

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// collectionArming imports the drizzle client for its list/arm/disarm queries.
// The chokepoint itself (assertSequenceArmed) is pure, so a stub is enough and
// no DATABASE_URL is needed.
vi.mock("../../server/db", () => ({ db: {} }));

vi.mock("../../server/storage", () => ({
  storage: {
    getCollectionSequenceById: async (orgId: number, id: number) => {
      const row = SEQUENCES.get(id);
      return row && row.organizationId === orgId ? row : undefined;
    },
    createCollectionEnrollment: async (data: Record<string, unknown>) => {
      CREATED.push(data);
      return { id: 900 + CREATED.length, ...data };
    },
    getCollectionEnrollments: async () => [],
    getCollectionEnrollmentById: async () => undefined,
    getCollectionEnrollmentsByNote: async () => [],
  },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = { id: ORG_ID, name: "Test Org" };
    req.organizationId = ORG_ID;
    req.userId = "user_test";
    next();
  },
}));

const { registerVAEngineRoutes } = await import("../../server/routes-va-engine");

async function makeApp() {
  const app = express();
  app.use(express.json());
  await registerVAEngineRoutes(app);
  return app;
}

beforeEach(() => {
  SEQUENCES.clear();
  CREATED.length = 0;
  // Created AFTER the migration: born unarmed.
  SEQUENCES.set(1, {
    id: 1, organizationId: ORG_ID, name: "Fresh", steps: STEPS,
    autoStart: false, armedAt: null, armedBy: null, armedLadderDigest: null,
  });
  // Created BEFORE the migration: armed by the old schema default, nobody on record.
  SEQUENCES.set(2, {
    id: 2, organizationId: ORG_ID, name: "Legacy", steps: STEPS,
    autoStart: true, armedAt: null, armedBy: null, armedLadderDigest: null,
  });
  // Armed and confirmed by a person.
  SEQUENCES.set(3, {
    id: 3, organizationId: ORG_ID, name: "Confirmed", steps: STEPS,
    autoStart: true, armedAt: new Date("2026-08-11T12:00:00Z"),
    armedBy: "user_abc", armedLadderDigest: "whatever",
  });
});

describe("R-3 · POST /api/collection-enrollments refuses unarmed sequences", () => {
  it("an UNARMED sequence is refused AND creates no enrollment", async () => {
    const res = await request(await makeApp())
      .post("/api/collection-enrollments")
      .send({ sequenceId: 1, noteId: 55, status: "active" });

    expect(res.status).toBe(403);
    // The load-bearing assertion: nobody got contacted because nothing exists.
    expect(CREATED).toEqual([]);
    expect(res.body.message ?? res.body.error).toMatch(/not armed/i);
  });

  it("a sequence armed under the OLD default still enrolls — not cut off mid-ladder", async () => {
    const res = await request(await makeApp())
      .post("/api/collection-enrollments")
      .send({ sequenceId: 2, noteId: 55, status: "active" });

    expect(res.status).toBe(201);
    expect(CREATED).toHaveLength(1);
    expect(CREATED[0]).toMatchObject({ sequenceId: 2, noteId: 55, organizationId: ORG_ID });
  });

  it("a confirmed sequence enrolls normally", async () => {
    const res = await request(await makeApp())
      .post("/api/collection-enrollments")
      .send({ sequenceId: 3, noteId: 56, status: "active" });

    expect(res.status).toBe(201);
    expect(CREATED).toHaveLength(1);
  });

  it("a sequence belonging to ANOTHER org is not found (org-scoped at the query)", async () => {
    SEQUENCES.set(4, {
      id: 4, organizationId: ORG_ID + 1, name: "Other org", steps: STEPS,
      autoStart: true, armedAt: null, armedBy: null, armedLadderDigest: null,
    });
    const res = await request(await makeApp())
      .post("/api/collection-enrollments")
      .send({ sequenceId: 4, noteId: 57, status: "active" });

    expect(res.status).toBe(404);
    expect(CREATED).toEqual([]);
  });
});

describe("R-3 · the AI-invokable skill refuses unarmed sequences", () => {
  // startCollectionSequence is exposed to "operations" agents, so it is the
  // path where a model could otherwise start consumer contact off a schema
  // default. Same load-bearing assertion: no enrollment row => nobody contacted.
  async function runSkill(sequenceId: number) {
    const storage = (await import("../../server/storage")).storage as any;
    storage.getNote = async () => ({ id: 55, organizationId: ORG_ID });
    storage.getCollectionSequences = async () => [...SEQUENCES.values()];
    const { skillRegistry } = await import("../../server/services/agent-skills");
    const skill = skillRegistry.getSkillById("startCollectionSequence");
    expect(skill).toBeDefined();
    return skill!.execute({ noteId: 55, sequenceId }, { organizationId: ORG_ID } as any);
  }

  it("refuses an UNARMED sequence and creates no enrollment", async () => {
    const result = await runSkill(1);
    expect(result.success).toBe(false);
    expect(CREATED).toEqual([]);
    expect(String(result.error)).toMatch(/not armed/i);
  });

  it("still enrolls for a sequence armed under the OLD default", async () => {
    const result = await runSkill(2);
    expect(result.success).toBe(true);
    expect(CREATED).toHaveLength(1);
  });
});

describe("R-3 · POST /api/collection-sequences cannot self-arm", () => {
  it("a body asking for autoStart:true still produces an unarmed row", async () => {
    let captured: Record<string, unknown> | null = null;
    const storage = (await import("../../server/storage")).storage as any;
    storage.createCollectionSequence = async (data: Record<string, unknown>) => {
      captured = data;
      return { id: 10, ...data };
    };

    const res = await request(await makeApp())
      .post("/api/collection-sequences")
      .send({
        name: "Self-arming attempt",
        steps: STEPS,
        autoStart: true,
        armedAt: new Date().toISOString(),
        armedBy: "forged_user",
        armedLadderDigest: "forged",
      });

    expect(res.status).toBe(201);
    expect(captured).not.toBeNull();
    // Every arming field is server-controlled, whatever the client sent.
    expect(captured!.autoStart).toBe(false);
    expect(captured!.armedAt).toBeNull();
    expect(captured!.armedBy).toBeNull();
    expect(captured!.armedLadderDigest).toBeNull();
  });
});
