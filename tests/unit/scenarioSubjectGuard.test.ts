/**
 * A scenario is never RECORDED on a subject its engine is not about.
 *
 * THE DEFECT (independent audit of PR #488, 2026-11-08). Registering
 * `note_pricing` in ALL_ENGINES made it recordable through the generic
 * POST /api/scenarios. That route resolves any registered engine, takes a
 * subject as property/opportunity/deal plus an integer id, and inserts it. A
 * note is keyed by a uuid, so the note's economics would have been recorded on
 * whichever integer property or deal the caller named. That is the mis-keying
 * the slice's own STOP exists to prevent.
 *
 * THE RULE is a property of the EngineSpec (`subjectKind`), enforced by
 * `assertRecordableSubject` inside `recordScenario`, the only writer of the
 * scenarios table. The population of record paths is therefore every writer of
 * that table, and the last describe pins that there is exactly one.
 *
 * The db is a stub: `insert` records the call and returns the row, so the
 * positive control shows that a refusal here comes from the guard and not from
 * the stub. Without the guard, every refusal below turns into an insert.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// This file walks server/ and shared/ (the single-writer pin). Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => ({ inserts: [] as unknown[], decisions: 0 }));
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserts.push(v);
        return { returning: async () => [{ id: 1, computedAt: new Date(0), ...v }] };
      },
    }),
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: vi.fn(async () => {
    h.decisions += 1;
    return { id: 11, decidedAt: new Date(0), body: {} };
  }),
}));

import router from "../../server/routes-scenarios";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { recordUnderwrittenDecision } from "../../server/services/underwriting/verticalDecision";
import {
  SCENARIO_SUBJECT_TYPES,
  ScenarioSubjectRefused,
  assertRecordableSubject,
  type EngineSpec,
} from "../../shared/economics/scenario";
import { LAND_DEAL_ENGINE_ID } from "../../shared/calculators/landDeal";

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } };
function handler(p: string) {
  const l = (router as unknown as { stack: Layer[] }).stack.find((x) => x.route?.path === p && x.route.methods.post);
  if (!l) throw new Error(`POST ${p} is not mounted on the scenarios router`);
  return l.route!.stack[0].handle;
}
async function post(p: string, body: unknown) {
  const req: any = { body, organizationId: 7, organization: { id: 7 } };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  await handler(p)(req, res, () => undefined);
  return res;
}

// Valid note inputs: a refusal cannot be the engine refusing its inputs.
const NOTE = {
  upbCents: 100_000, noteRateBps: 1200, paymentCents: 50_751, remainingTermMonths: 2, status: "performing",
  targetYieldBps: 2400, servicingMonthlyCents: 1000, acquisitionCostsCents: 1500,
};
const LAND = {
  purchaseCents: 1_000_000, closingAtBuyCents: 50_000, holdingPerMonthCents: 10_000, holdMonths: 6,
  marketingCents: 20_000, salePriceCents: 2_000_000, closingAtSaleCents: 100_000,
};
const KEYABLE: readonly string[] = SCENARIO_SUBJECT_TYPES;
// Every registered engine whose subject the store cannot key at all.
const UNKEYABLE = ALL_ENGINES.filter((e) => e.subjectKind !== undefined && !KEYABLE.includes(e.subjectKind));

beforeEach(() => {
  h.inserts.length = 0;
  h.decisions = 0;
});

describe("POST /api/scenarios refuses an engine whose subject the store cannot key", () => {
  it("the population is not empty, and note_pricing is in it (vacuity)", () => {
    expect(UNKEYABLE.map((e) => e.id)).toContain("note_pricing");
  });

  for (const engine of UNKEYABLE) {
    it.each(SCENARIO_SUBJECT_TYPES)(`${engine.id} on subject type %s: 422 with the refusal named, nothing inserted`, async (subjectType) => {
      const res = await post("/", { subjectType, subjectId: 42, label: "bid", engineId: engine.id, inputs: NOTE });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toBe("UNPROCESSABLE"); // not zod's VALIDATION_FAILED
      expect(res.body.details).toEqual({
        refusal: "scenario_subject_mismatch", // the wire name, pinned literally
        engineId: engine.id,
        engineSubjectKind: engine.subjectKind,
        subjectType,
      });
      expect(res.body.message).toMatch(/wrong record/);
      expect(h.inserts).toEqual([]);
    });
  }

  it("positive control: the same route records a land-deal scenario (the guard is not refusing everything)", async () => {
    const res = await post("/", { subjectType: "property", subjectId: 42, label: "base", engineId: LAND_DEAL_ENGINE_ID, inputs: LAND });
    expect(res.statusCode).toBe(200);
    expect(h.inserts).toHaveLength(1);
    expect(res.body.scenario.engineId).toBe(LAND_DEAL_ENGINE_ID);
  });
});

describe("the vertical kit inherits the refusal from the store", () => {
  it("note_pricing under note_investor passes the ownership guard and is refused before either write", async () => {
    await expect(
      recordUnderwrittenDecision(9, {
        subjectType: "property", subjectId: 42, engineId: "note_pricing", strategyPackId: "note_investor",
        inputs: NOTE, scenarioLabel: "bid", kind: "offer", choice: "bid", rationale: "subject guard test",
        actorRef: "user-1", authority: "org_member:test", reviewDueAt: null,
      }),
    ).rejects.toThrow(ScenarioSubjectRefused);
    expect(h.inserts).toEqual([]);
    expect(h.decisions).toBe(0);
  });
});

describe("preview is unaffected: it computes the note and records nothing", () => {
  it("POST /api/scenarios/preview prices it", async () => {
    const res = await post("/preview", { engineId: "note_pricing", inputs: NOTE });
    expect(res.statusCode).toBe(200);
    expect(res.body.metrics.find((m: { id: string }) => m.id === "max_allowable_offer")?.value).toBe(95_094);
    expect(h.inserts).toEqual([]);
  });
});

describe("the declaration covers every note-acquisition engine", () => {
  it("every engine that underwrites note_investor declares subjectKind 'note'", () => {
    const note = ALL_ENGINES.filter((e) => (e.verticals ?? []).includes("note_investor"));
    expect(note.length).toBeGreaterThan(0);
    for (const e of note) expect(e.subjectKind, e.id).toBe("note");
  });
});

describe("the rule itself", () => {
  const spec = (subjectKind?: EngineSpec["subjectKind"]): EngineSpec =>
    ({ id: "x", version: "1", label: "x", produces: [], subjectKind, compute: () => ({ metrics: [], normalisedInputs: {} }) });
  it("absent: any subject the store keys", () => {
    for (const t of SCENARIO_SUBJECT_TYPES) expect(() => assertRecordableSubject(spec(), t)).not.toThrow();
  });
  it("a keyable kind: that kind only", () => {
    expect(() => assertRecordableSubject(spec("property"), "property")).not.toThrow();
    expect(() => assertRecordableSubject(spec("property"), "deal")).toThrow(ScenarioSubjectRefused);
  });
  it("an unkeyable kind: nothing", () => {
    for (const t of SCENARIO_SUBJECT_TYPES) expect(() => assertRecordableSubject(spec("note"), t)).toThrow(ScenarioSubjectRefused);
  });
});

describe("the store's recordScenario is the only writer of the scenarios table (the guard's population)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const STORE = "server/services/economics/scenarioStore.ts";
  function files(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) files(rel, out);
      else if (/\.(?:ts|mjs)$/.test(e.name) && !/\.(?:test|spec)\./.test(e.name)) out.push(rel);
    }
    return out;
  }
  function writersOf(src: string): boolean {
    const names = ["scenarios", "schema\\.scenarios"];
    for (const m of src.matchAll(/\bscenarios\s+as\s+(\w+)/g)) names.push(m[1]);
    return (
      names.some((n) => new RegExp(`\\.insert\\(\\s*${n}\\s*\\)`).test(src)) ||
      /insert\s+into\s+"?scenarios"?[\s(]/i.test(src)
    );
  }

  it("exactly one writer, and it is the guarded store", () => {
    const writers: string[] = [];
    for (const rel of [...files("server"), ...files("shared"), ...files("scripts")]) {
      const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (!raw.includes("scenarios")) continue;
      if (writersOf(stripComments(raw))) writers.push(rel.split(path.sep).join("/"));
    }
    // Vacuity: if the predicate stopped matching, the store itself would vanish from this list.
    expect(writers).toEqual([STORE]);
  });
});
