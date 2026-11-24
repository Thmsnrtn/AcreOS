/**
 * The wholesale journey — rehearsed end to end through the journey-proof
 * harness (tests/journey), against a REAL database built from this
 * repository. This test REPLACES tests/unit/wholesaleJourney.realdb.test.ts:
 * the same API sequence and the same observations, now driven by the
 * declarative spec (tests/journey/specs/wholesale.ts) instead of a
 * hand-written test body.
 *
 * The walk is PARTIAL by design, not green: the Pax leg is blocked (no
 * wholesale tools exist in server/ai/tools.ts yet), so the report's verdict
 * is PARTIAL and `passed` is false. Every executable leg must pass, and the
 * walk must send nothing. When the Pax tools land, the spec's Pax leg
 * flips to exercised and this test's expectation flips with it — the
 * blocked leg is a named gap, never a silent pass.
 *
 * NO SEND: the email transport is a spy that must never be called.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
import { runWalk, renderWalkRecord } from "./runner";
import { validateWalkSpec } from "./walk-spec";
import { RealDbDriver } from "./drivers/realdb";
import { wholesaleWalk } from "./specs/wholesale";

useRealDb("wholesale.harness.test.ts");

const sent = vi.hoisted(() => ({ emails: 0 }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/emailService", () => ({
  sendEmail: vi.fn(async () => {
    sent.emails += 1;
    return { success: true };
  }),
  // W-DEF-1: the blast route preflights the org's sending identity through
  // the same resolver the (here stubbed) transport would use; the stubbed
  // transport accepts, so the preflight answers canSend.
  counterpartyEmailIdentityStatus: vi.fn(async () => ({ canSend: true, ownSesCredentials: false, verifiedDomain: true })),
}));

describe.runIf(realDbAvailable)("the wholesale journey — harness rehearsal on a real database", () => {
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    await pool.end();
  });

  it("the spec is valid", () => {
    expect(validateWalkSpec(wholesaleWalk)).toEqual([]);
  });

  it("walks the whole journey through the harness, and never sends", async () => {
    const driver = new RealDbDriver({ sentCount: () => sent.emails });
    const report = await runWalk(wholesaleWalk, driver);

    const passed = report.steps.filter((s) => s.status === "pass");
    const blocked = report.steps.filter((s) => s.status === "blocked");
    expect(passed.map((s) => s.id)).toEqual([
      "activate",
      "buy-box",
      "candidates-seed",
      "triage",
      "decision",
      "under-contract",
      "assignments-draft",
      "contract-compliance",
      "buyer-seed",
      "packet-blast-preview",
      "assignment-signed",
      "outcome",
    ]);
    expect(blocked.map((s) => s.id)).toEqual(["pax-wholesale"]);
    expect(report.steps.filter((s) => s.status === "fail")).toEqual([]);
    expect(report.sentCount, "the journey sends nothing").toBe(0);
    expect(report.passed).toBe(false);
    expect(report.verdict).toMatch(/^PARTIAL — Pax leg blocked \(pax-wholesale\)/);

    // The record renders from this same report — the in-repo evidence path
    // works, without this test writing any file.
    const record = renderWalkRecord(report);
    expect(record).toContain(report.runId);
    expect(record).toContain("PARTIAL — Pax leg blocked");
    expect(record).toContain("No wholesale tools in server/ai/tools.ts");
  });
});
