/**
 * guidedResume.test.ts — the staged, honest way back from the panic stop.
 *
 * Coverage:
 *  - stage ordering is fixed: cognition → observe → dispatch
 *  - preflight composition (pure): env-override honesty ("you cannot clear it
 *    from this app"), trip-reason discoverability limits (the receipt seals a
 *    hash, not the words), unreadable safety checks are never shown green
 *  - narration honesty: stage 2 changes nothing and says so; stage 3 never
 *    guesses publish back on; every stage says trust is re-granted from the
 *    ledger ("restarts cautious")
 *  - resumeStage (mocked writes): refuses under the env stop, enables exactly
 *    one switch per stage, NEVER touches publishEnabled, fails honestly
 *  - source shape: the Control Center page carries the staged card + the
 *    cautious-restart sentence
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── togglable world state for the async wrappers ────────────────────────────
let panicStopped = false;
let setThrows = false;
let setCalls: Array<{ key: string; value: boolean; by?: string }> = [];
let ledger: Array<{ domain: string; level: string; cleanCycleCount: number; threshold: number; lastPromotedAt: null; lastDemotedAt: null; lastDemotionReason: string | null }> = [];
let receiptRows: Array<{ issuedAt: string; by: string }> = [];
let readinessChecks: Array<{ key: string; title: string; status: string; detail: string; fix?: string; critical: boolean }> = [];
let readinessThrows = false;

vi.mock("../../server/services/autopilot/settings", () => ({
  isPanicStopped: () => panicStopped,
  setAutopilotSetting: async (key: string, value: boolean, by?: string) => {
    if (setThrows) throw new Error("db down");
    setCalls.push({ key, value, by });
  },
}));
vi.mock("../../server/services/autopilot/domainAutonomy", () => ({
  getTrustLedger: async () => ledger,
}));
vi.mock("../../server/services/autopilot/stepAwayReadiness", () => ({
  buildStepAwayReadiness: async () => {
    if (readinessThrows) throw new Error("readiness unreadable");
    return { verdict: "ready", headline: "", horizonDays: 1, readyCount: 0, totalCount: 0, checks: readinessChecks };
  },
}));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(receiptRows) }),
        }),
      }),
    }),
  },
}));
vi.mock("@shared/schema", () => ({
  proofReceipts: { id: {}, actionKind: {}, issuedAt: {}, accountableHumanId: {} },
}));

import {
  RESUME_STAGES,
  isResumeStage,
  resumeStageIndex,
  composeResumePreflight,
  narrateResumeStage,
  resumePreflight,
  resumeStage,
} from "../../server/services/autopilot/guidedResume";

const observeLedgerRow = (domain: string, level = "observe", lastDemotionReason: string | null = null) => ({
  domain, level, cleanCycleCount: 0, threshold: 10, lastPromotedAt: null, lastDemotedAt: null, lastDemotionReason,
});

beforeEach(() => {
  panicStopped = false;
  setThrows = false;
  setCalls = [];
  ledger = ["growth", "support", "deploy", "ops", "finance"].map((d) => observeLedgerRow(d));
  receiptRows = [{ issuedAt: "2026-07-28T03:00:00.000Z", by: "founder-1" }];
  readinessChecks = [
    { key: "panic_stop", title: "Emergency stop", status: "ready", detail: "Disengaged.", critical: true },
    { key: "paging", title: "It can reach you", status: "ready", detail: "Two channels.", critical: true },
    { key: "loop_health", title: "The brain is alive", status: "ready", detail: "loop healthy", critical: true },
    { key: "budget", title: "Spending is bounded", status: "ready", detail: "$1 of $50 used.", critical: true },
    { key: "delegation", title: "It can act while you're gone", status: "action_needed", detail: "No grants.", critical: false },
  ];
  readinessThrows = false;
});

// ── Stage ordering (pure) ───────────────────────────────────────────────────

describe("stage ordering", () => {
  it("the three stages run in one fixed order: cognition → observe → dispatch", () => {
    expect(RESUME_STAGES).toEqual(["cognition", "observe", "dispatch"]);
    expect(resumeStageIndex("cognition")).toBeLessThan(resumeStageIndex("observe"));
    expect(resumeStageIndex("observe")).toBeLessThan(resumeStageIndex("dispatch"));
  });

  it("isResumeStage accepts only the three known stages", () => {
    for (const s of RESUME_STAGES) expect(isResumeStage(s)).toBe(true);
    expect(isResumeStage("publish")).toBe(false);
    expect(isResumeStage("")).toBe(false);
    expect(isResumeStage(undefined)).toBe(false);
  });
});

// ── Preflight composition (pure) ────────────────────────────────────────────

describe("composeResumePreflight", () => {
  const baseFacts = {
    envStopEngaged: false,
    stoppedAt: "2026-07-28T03:00:00.000Z" as string | null,
    stoppedBy: "founder-1" as string | null,
    tripReason: null as string | null,
    readiness: [{ label: "It can reach you", ok: true, detail: "Two channels." }] as
      | Array<{ label: string; ok: boolean; detail: string }>
      | null,
  };

  it("all clear → ok true with a plain-words item per check", () => {
    const p = composeResumePreflight(baseFacts);
    expect(p.ok).toBe(true);
    expect(p.items.length).toBeGreaterThanOrEqual(3);
    for (const i of p.items) {
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.detail.length).toBeGreaterThan(0);
    }
  });

  it("the env override blocks AND says honestly it cannot be cleared from the app", () => {
    const p = composeResumePreflight({ ...baseFacts, envStopEngaged: true });
    expect(p.ok).toBe(false);
    const env = p.items.find((i) => i.label === "Server-level stop")!;
    expect(env.ok).toBe(false);
    expect(env.detail).toContain("SOLENE_PANIC_STOP");
    expect(env.detail).toMatch(/cannot clear it from this app/i);
  });

  it("a recovered trip reason is quoted; without one the hash-only honesty is stated", () => {
    const withReason = composeResumePreflight({ ...baseFacts, tripReason: "drift sentinel tripped" });
    expect(withReason.items.find((i) => i.label === "What tripped the stop")!.detail).toContain("drift sentinel tripped");

    const without = composeResumePreflight(baseFacts);
    const item = without.items.find((i) => i.label === "What tripped the stop")!;
    expect(item.detail).toMatch(/isn't recoverable/i);
    expect(item.detail).toMatch(/hash/i);
    // The receipt still gives when + who.
    expect(item.detail).toContain("founder-1");
  });

  it("no receipt at all → says the switches may have been flipped by hand, never invents a stop", () => {
    const p = composeResumePreflight({ ...baseFacts, stoppedAt: null, stoppedBy: null });
    expect(p.items.find((i) => i.label === "What tripped the stop")!.detail).toMatch(/by hand/i);
  });

  it("unreadable safety checks are never shown green — they block", () => {
    const p = composeResumePreflight({ ...baseFacts, readiness: null });
    expect(p.ok).toBe(false);
    const safety = p.items.find((i) => i.label === "Safety checks")!;
    expect(safety.ok).toBe(false);
    expect(safety.detail).toMatch(/never shown green/i);
  });

  it("a failing readiness item fails the overall verdict", () => {
    const p = composeResumePreflight({
      ...baseFacts,
      readiness: [{ label: "It can reach you", ok: false, detail: "No page channel configured." }],
    });
    expect(p.ok).toBe(false);
  });
});

// ── Narration honesty (pure) ────────────────────────────────────────────────

describe("narrateResumeStage", () => {
  it("every stage's narration says trust is re-granted from the ledger (restarts cautious)", () => {
    for (const s of RESUME_STAGES) {
      const n = narrateResumeStage(s, [{ domain: "growth", level: "observe" }]);
      expect(n).toMatch(/watching-only/);
      expect(n).toMatch(/trust ledger/i);
      expect(n).toMatch(/restarts cautious/i);
    }
  });

  it("stage 1 says hands are still off", () => {
    const n = narrateResumeStage("cognition");
    expect(n).toMatch(/brain is back on/i);
    expect(n).toMatch(/hands are still off/i);
  });

  it("stage 2 is truthful: it changes nothing when quarantine already holds", () => {
    const n = narrateResumeStage("observe", [
      { domain: "growth", level: "observe" },
      { domain: "support", level: "observe" },
    ]);
    expect(n).toMatch(/changes nothing/i);
    expect(n).toContain("growth");
  });

  it("stage 2 is truthful about domains re-granted since the stop, and never moves them", () => {
    const n = narrateResumeStage("observe", [
      { domain: "growth", level: "observe" },
      { domain: "support", level: "draft" },
    ]);
    expect(n).toContain("support: draft");
    expect(n).toMatch(/never raises or lowers trust/i);
  });

  it("stage 3 says publish stays OFF because the pre-stop state is unrecorded", () => {
    const n = narrateResumeStage("dispatch");
    expect(n).toMatch(/Auto-publish stays OFF/);
    expect(n).toMatch(/doesn't record whether it was on before the stop/i);
    expect(n).toMatch(/rather than guess/i);
  });
});

// ── resumePreflight (async, mocked reads) ───────────────────────────────────

describe("resumePreflight", () => {
  it("wires the receipt (when/who), ledger trip reason, and reused readiness checks", async () => {
    ledger[1] = observeLedgerRow("support", "observe", "founder: panic stop: drift sentinel tripped");
    const p = await resumePreflight();
    expect(p.ok).toBe(true);
    const trip = p.items.find((i) => i.label === "What tripped the stop")!;
    expect(trip.detail).toContain("drift sentinel tripped");
    expect(trip.detail).toContain("2026-07-28T03:00:00.000Z");
    // Only the resume-relevant readiness checks ride along (not panic_stop —
    // the env item covers that with the honest wording — nor optional items).
    const labels = p.items.map((i) => i.label);
    expect(labels).toContain("It can reach you");
    expect(labels).toContain("The brain is alive");
    expect(labels).toContain("Spending is bounded");
    expect(labels).not.toContain("Emergency stop");
    expect(labels).not.toContain("It can act while you're gone");
  });

  it("readiness machinery failing → honest not-ok, never green", async () => {
    readinessThrows = true;
    const p = await resumePreflight();
    expect(p.ok).toBe(false);
    expect(p.items.find((i) => i.label === "Safety checks")!.ok).toBe(false);
  });

  it("engaged env stop → overall not-ok", async () => {
    panicStopped = true;
    const p = await resumePreflight();
    expect(p.ok).toBe(false);
  });
});

// ── resumeStage (async, mocked writes) ──────────────────────────────────────

describe("resumeStage", () => {
  it("refuses every stage while the env stop is engaged, with the cannot-clear honesty", async () => {
    panicStopped = true;
    for (const s of RESUME_STAGES) {
      const r = await resumeStage(s, "founder-1");
      expect(r.done).toBe(false);
      expect(r.narration).toMatch(/cannot clear it from this app/i);
    }
    expect(setCalls).toEqual([]);
  });

  it("stage 1 enables cognition only", async () => {
    const r = await resumeStage("cognition", "founder-1");
    expect(r.done).toBe(true);
    expect(setCalls).toEqual([{ key: "cognitionEnabled", value: true, by: "founder-1" }]);
  });

  it("stage 2 writes NOTHING — it verifies and narrates", async () => {
    const r = await resumeStage("observe", "founder-1");
    expect(r.done).toBe(true);
    expect(setCalls).toEqual([]);
    expect(r.narration).toMatch(/changes nothing/i);
  });

  it("stage 3 enables dispatch and NEVER touches publish (prior state unrecoverable)", async () => {
    const r = await resumeStage("dispatch", "founder-1");
    expect(r.done).toBe(true);
    expect(setCalls).toEqual([{ key: "dispatchEnabled", value: true, by: "founder-1" }]);
    expect(setCalls.some((c) => c.key === "publishEnabled")).toBe(false);
    expect(r.narration).toMatch(/Auto-publish stays OFF/);
  });

  it("a failed write comes back done:false with plain words, never a throw", async () => {
    setThrows = true;
    const r = await resumeStage("cognition", "founder-1");
    expect(r.done).toBe(false);
    expect(r.narration).toMatch(/Couldn't complete this step/i);
    expect(r.narration).toContain("db down");
  });
});

// ── Source shape — the Control Center carries the staged card ───────────────

describe("autopilot-control.tsx — staged come-back-online card", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../client/src/pages/founder/autopilot-control.tsx"),
    "utf-8",
  );

  it("renders the 'Come back online' card with the preflight checklist", () => {
    expect(src).toContain("Come back online");
    expect(src).toContain("/api/founder/autopilot/resume/preflight");
    expect(src).toContain("/api/founder/autopilot/resume/stage");
    expect(src).toContain('data-testid="resume-preflight"');
  });

  it("carries the exact cautious-restart sentence", () => {
    expect(src).toContain(
      "Coming back is staged and cautious: everything restarts in watching-only; you re-grant",
    );
    expect(src).toContain("autonomy from the trust ledger below when you're ready.");
  });

  it("the three stage buttons appear in the mandatory order", () => {
    const iCog = src.indexOf('id: "cognition"');
    const iObs = src.indexOf('id: "observe"');
    const iDis = src.indexOf('id: "dispatch"');
    expect(iCog).toBeGreaterThan(-1);
    expect(iCog).toBeLessThan(iObs);
    expect(iObs).toBeLessThan(iDis);
    // Sequential unlock — a stage is enabled only when its predecessor is done.
    expect(src).toContain("doneStages.includes(RESUME_STAGE_STEPS[i - 1].id)");
  });

  it("shows stage narrations and errors honestly", () => {
    expect(src).toContain("resume-narration-");
    expect(src).toContain('data-testid="resume-stage-error"');
  });
});
