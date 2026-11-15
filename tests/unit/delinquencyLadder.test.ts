/**
 * Notes V2 Leg 1 — the pure parts of the delinquency ladder.
 *
 *   1. Stage boundaries: 0 / 1 / 29 / 30 / 59 / 60 / 89 / 90 days land exactly
 *      on the stages the amended §3.1 table names (both sides of each edge).
 *      Default review is not a stage at any age (ruling 1, 2026-11-05).
 *   6. Extend-and-pretend from recorded payments: interest-only shows the
 *      pattern with its numbers; principal-reducing does not; short history is
 *      not determinable — never a clean pass.
 *   -  The no-sends fence, statically: the ladder service and route import no
 *      send, dunning, notice, outbox or workflow module.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LADDER_STAGES, ladderStageEscalates, ladderStageFor } from "@shared/notes/delinquency";
import { checkExtendAndPretend } from "@shared/notes/extendAndPretend";
import { stripComments } from "../helpers/stripComments";

describe("ladder stages (1)", () => {
  it.each([
    [0, "current"],
    [1, "past_due_under_30"],
    [29, "past_due_under_30"],
    [30, "stage_30"],
    [59, "stage_30"],
    [60, "stage_60"],
    [89, "stage_60"],
    [90, "stage_90_plus"],
    [400, "stage_90_plus"],
  ])("%i days → %s", (days, stage) => {
    expect(ladderStageFor(days)).toBe(stage);
  });

  it("default review is not a derivable stage at any age", () => {
    expect(LADDER_STAGES).not.toContain("default_review");
    for (let d = 0; d <= 1_000; d++) expect(ladderStageFor(d)).not.toMatch(/default/);
  });

  it("escalation bundles start at 30 days", () => {
    expect(LADDER_STAGES.filter(ladderStageEscalates)).toEqual(["stage_30", "stage_60", "stage_90_plus"]);
  });
});

describe("extend-and-pretend (6)", () => {
  const pay = (date: string, principal: number, interest: number, type = "regular") => ({ paymentDate: date, principalCents: principal, interestCents: interest, paymentType: type });

  it("interest-only payments show the pattern with correct window math", () => {
    const r = checkExtendAndPretend([pay("2026-06-05", 0, 7_500), pay("2026-07-05", 0, 7_500), pay("2026-08-05", 0, 7_500), pay("2025-01-05", 9_000, 6_000)], "2026-09-30");
    expect(r).toMatchObject({ status: "pattern", paymentsInWindow: 3, interestReceivedCents: 22_500, principalDeltaCents: 0, window: { from: "2026-04-04", to: "2026-09-30" } });
  });

  it("principal-reducing payments do not", () => {
    const r = checkExtendAndPretend([pay("2026-06-05", 1_200, 7_500), pay("2026-07-05", 1_210, 7_490), pay("2026-08-05", 1_220, 7_480)], "2026-09-30");
    expect(r.status).toBe("no_pattern");
  });

  it("a reversal that cancels the principal shows the pattern (negative delta counts)", () => {
    const r = checkExtendAndPretend([pay("2026-06-05", 1_200, 7_500), pay("2026-07-05", 0, 7_500), pay("2026-08-05", 0, 7_500), pay("2026-08-20", -1_200, 0, "nsf_reversal")], "2026-09-30");
    expect(r).toMatchObject({ status: "pattern", principalDeltaCents: 0 });
  });

  it("short history is not determinable, and says why", () => {
    const r = checkExtendAndPretend([pay("2026-08-05", 0, 7_500), pay("2026-09-05", 0, 7_500)], "2026-09-30");
    expect(r.status).toBe("not_determinable");
    expect(r.status === "not_determinable" && r.reason).toContain("2 interest-bearing payment(s)");
  });

  it("partial payments are not interest-bearing for the count", () => {
    const r = checkExtendAndPretend([pay("2026-06-05", 0, 0, "partial"), pay("2026-07-05", 0, 0, "partial"), pay("2026-08-05", 0, 0, "partial")], "2026-09-30");
    expect(r.status).toBe("not_determinable");
  });
});

describe("the no-sends fence — module boundary, statically", () => {
  const FILES = ["server/services/notes/delinquencyLadder.ts", "server/routes-note-delinquency.ts", "shared/notes/delinquency.ts", "shared/notes/extendAndPretend.ts"];
  const FORBIDDEN = /borrowerDunningLadder|borrowerNotices|emailService|smsService|smsProvider|\/email\/|\/sms\/|workflowOutbox|workflow-engine|emitDurable|pendingHands|lob|postgrid|twilio|sendgrid|resend/i;
  for (const f of FILES) {
    it(`${f} imports nothing that can send, notify or enqueue`, () => {
      const src = stripComments(readFileSync(path.join(__dirname, "../..", f), "utf8"));
      const imports = [...src.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
      expect(imports.length).toBeGreaterThan(0); // vacuity: the parser read the imports
      expect(imports.filter((i) => FORBIDDEN.test(i))).toEqual([]);
    });
  }
});
