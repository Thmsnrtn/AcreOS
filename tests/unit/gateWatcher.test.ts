/**
 * Gate-Watcher (Launch-Week WS4) — pure-evaluator tests.
 *
 * Coverage:
 *  - the machine-encoded schedule is COMPLETE (every mature-machine §4 row +
 *    every launch-week WS4 phase trigger has a gate, thresholds pinned);
 *  - evaluateGate ripens exactly at each threshold, never below;
 *  - unknown (null) inputs keep gates CLOSED with the reason stated —
 *    honesty: an unreadable input is never treated as a pass;
 *  - held-30d logic: needs window-start evidence, no in-window dip, and a
 *    current reading; insufficient history is an honest "not provable yet";
 *  - dedup (resolveFireDecision): open/answered asks and completed
 *    auto-executions never re-fire; expired asks re-raise; unknown ask
 *    status fails closed;
 *  - hard-stops can NEVER auto-execute (pinned for every hardStop gate,
 *    even against a maximally permissive dial), and the >$500 spend
 *    hard-stop blocks auto-execution regardless of autoApprove.
 */

import { describe, it, expect } from "vitest";
import {
  GATES,
  HARD_STOPS,
  HARD_STOP_SPEND_LIMIT_USD,
  evaluateGate,
  normalizeDialRows,
  resolveExecutionMode,
  resolveFireDecision,
  type GateDefinition,
  type GateInputs,
  type MrrHistoryPoint,
  type NormalizedDialRow,
} from "../../server/services/autopilot/gateWatcher";

const NOW = new Date("2026-07-08T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY_MS);

function inputs(partial: Partial<GateInputs>): GateInputs {
  return { now: NOW, mrrCents: null, payingOrgs: null, mrrHistory: null, ...partial };
}

function gateById(id: string): GateDefinition {
  const g = GATES.find((x) => x.id === id);
  if (!g) throw new Error(`gate ${id} not encoded`);
  return g;
}

// ── The schedule is complete and thresholds are pinned ──────────────────────

describe("the machine-encoded schedule (mature-machine §4 + launch-week WS4)", () => {
  it("encodes every §4 switch row and every WS4 phase trigger", () => {
    const ids = GATES.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        // WS4 phase triggers
        "phase1_runbook",
        "sentry_paid_rung",
        "telnyx_migration_eval",
        // §4 switch schedule, row by row
        "switch_support_auto_resolve",
        "switch_dunning_billing_recovery",
        "switch_deliverability_compliance",
        "switch_content_seo",
        "switch_paid_ads_gated",
        "switch_paid_ads_execute",
        "switch_self_patch_pr_mode",
        "switch_self_patch_auto_merge",
        "switch_incident_response_ga",
        // §4 final row — the permanent hard-stops
        "hard_stop_pricing_legal_spend_deletion",
      ]),
    );
    expect(new Set(ids).size).toBe(GATES.length); // no duplicate ids
  });

  it("pins the ratified thresholds", () => {
    expect(gateById("phase1_runbook").condition).toEqual({
      kind: "mrr_held_at_least",
      thresholdCents: 200_00,
      heldDays: 30,
    });
    expect(gateById("sentry_paid_rung").condition).toEqual({ kind: "mrr_at_least", thresholdCents: 500_00 });
    expect(gateById("telnyx_migration_eval").condition).toEqual({ kind: "mrr_at_least", thresholdCents: 3_000_00 });
    // First paying cohort (G1) = 25; G2 = 100; G3 = 500.
    for (const id of ["switch_support_auto_resolve", "switch_dunning_billing_recovery", "switch_deliverability_compliance", "switch_self_patch_pr_mode"]) {
      expect(gateById(id).condition, id).toEqual({ kind: "paying_orgs_at_least", threshold: 25 });
    }
    for (const id of ["switch_content_seo", "switch_paid_ads_gated"]) {
      expect(gateById(id).condition, id).toEqual({ kind: "paying_orgs_at_least", threshold: 100 });
    }
    for (const id of ["switch_paid_ads_execute", "switch_self_patch_auto_merge", "switch_incident_response_ga"]) {
      expect(gateById(id).condition, id).toEqual({ kind: "paying_orgs_at_least", threshold: 500 });
    }
  });

  it("encodes the permanent hard-stop list verbatim, flagged hardStop with a never-ripening condition", () => {
    expect([...HARD_STOPS]).toEqual([
      "pricing_changes",
      "legal_signing",
      "spend_over_500_usd",
      "customer_data_deletion",
    ]);
    const hs = gateById("hard_stop_pricing_legal_spend_deletion");
    expect(hs.hardStop).toBe(true);
    expect(hs.condition.kind).toBe("never");
  });
});

// ── evaluateGate: exact-threshold ripening + honest unknowns ─────────────────

describe("evaluateGate — mrr_at_least", () => {
  const sentry = gateById("sentry_paid_rung");

  it("ripens exactly at the threshold, not one cent below", () => {
    expect(evaluateGate(sentry, inputs({ mrrCents: 500_00 })).ripe).toBe(true);
    expect(evaluateGate(sentry, inputs({ mrrCents: 500_00 - 1 })).ripe).toBe(false);
  });

  it("stays closed with the reason stated when MRR is unknown — never fabricated", () => {
    const ev = evaluateGate(sentry, inputs({ mrrCents: null }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/unknown/i);
  });
});

describe("evaluateGate — paying_orgs_at_least", () => {
  const g1 = gateById("switch_support_auto_resolve");

  it("ripens exactly at 25 paying customers", () => {
    expect(evaluateGate(g1, inputs({ payingOrgs: 25 })).ripe).toBe(true);
    expect(evaluateGate(g1, inputs({ payingOrgs: 24 })).ripe).toBe(false);
  });

  it("stays closed when the paying-org count is unknown", () => {
    const ev = evaluateGate(g1, inputs({ payingOrgs: null }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/unknown/i);
  });
});

describe("evaluateGate — the never condition (hard-stop row)", () => {
  it("never ripens, even with maximal inputs", () => {
    const hs = gateById("hard_stop_pricing_legal_spend_deletion");
    const history: MrrHistoryPoint[] = [{ capturedAt: daysAgo(60), mrrCents: 10_000_000 }];
    const ev = evaluateGate(hs, inputs({ mrrCents: 10_000_000, payingOrgs: 100_000, mrrHistory: history }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/never ripens/);
  });
});

describe("evaluateGate — mrr_held_at_least (the Phase-1 runbook trigger)", () => {
  const phase1 = gateById("phase1_runbook");
  const T = 200_00;
  // Weekly snapshots covering the whole 30d window, all at/above threshold.
  const heldHistory: MrrHistoryPoint[] = [35, 28, 21, 14, 7, 1].map((d) => ({
    capturedAt: daysAgo(d),
    mrrCents: T,
  }));

  it("ripens when MRR held at threshold for 30 days (window-start evidence + no dip + current reading)", () => {
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: heldHistory }));
    expect(ev.ripe).toBe(true);
  });

  it("holding EXACTLY at the threshold counts (≥, not >)", () => {
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: heldHistory }));
    expect(ev.ripe).toBe(true);
    const evBelow = evaluateGate(phase1, inputs({ mrrCents: T - 1, mrrHistory: heldHistory }));
    expect(evBelow.ripe).toBe(false);
  });

  it("stays closed with INSUFFICIENT history — no snapshot at/older than 30d means the hold cannot be proven", () => {
    const young: MrrHistoryPoint[] = [{ capturedAt: daysAgo(10), mrrCents: T }, { capturedAt: daysAgo(3), mrrCents: T }];
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: young }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/insufficient history/i);
  });

  it("stays closed when history is EMPTY", () => {
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: [] }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/insufficient history/i);
  });

  it("stays closed when history is UNREADABLE (null) — never guessed", () => {
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: null }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/unreadable/i);
  });

  it("a dip below the threshold inside the window breaks the hold", () => {
    const dipped = heldHistory.map((p, i) => (i === 3 ? { ...p, mrrCents: T - 100 } : p)); // dip 14d ago
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: dipped }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/dipped/i);
  });

  it("MRR below threshold at the window START means the hold is not yet 30 days old", () => {
    const lateStart = heldHistory.map((p, i) => (i === 0 ? { ...p, mrrCents: T - 100 } : p)); // 35d-ago point below
    const ev = evaluateGate(phase1, inputs({ mrrCents: T, mrrHistory: lateStart }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/start of the 30d window/i);
  });

  it("CURRENT MRR below threshold closes the gate even with a clean 30d history", () => {
    const ev = evaluateGate(phase1, inputs({ mrrCents: T - 1, mrrHistory: heldHistory }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/current MRR/i);
  });

  it("current MRR unknown closes the gate even with clean history", () => {
    const ev = evaluateGate(phase1, inputs({ mrrCents: null, mrrHistory: heldHistory }));
    expect(ev.ripe).toBe(false);
    expect(ev.reason).toMatch(/unknown/i);
  });
});

// ── Dedup: resolveFireDecision ───────────────────────────────────────────────

describe("resolveFireDecision — a gate never nags and never double-fires", () => {
  const state = (status: "ask_raised" | "auto_executed", askId: number | null = 7) => ({
    status,
    askId,
    at: "2026-07-01T09:00:00Z",
  });

  it("a gate that is not ripe never fires", () => {
    expect(resolveFireDecision({ ripe: false, state: null }).fire).toBe(false);
  });

  it("a newly ripened gate with no prior state fires", () => {
    const d = resolveFireDecision({ ripe: true, state: null });
    expect(d.fire).toBe(true);
    expect(d.reason).toMatch(/newly ripened/);
  });

  it("an OPEN ask blocks re-firing (the escalation ladder re-pages, not us)", () => {
    expect(resolveFireDecision({ ripe: true, state: state("ask_raised"), askStatus: "open" }).fire).toBe(false);
  });

  it("an ANSWERED ask blocks re-firing forever — the founder decided", () => {
    const d = resolveFireDecision({ ripe: true, state: state("ask_raised"), askStatus: "answered" });
    expect(d.fire).toBe(false);
    expect(d.reason).toMatch(/already decided/);
  });

  it("an auto-executed gate never re-fires", () => {
    expect(resolveFireDecision({ ripe: true, state: state("auto_executed", null) }).fire).toBe(false);
  });

  it("a timed-out or superseded ask re-raises while the gate is still ripe (safe side of a timeout was not-acting)", () => {
    expect(resolveFireDecision({ ripe: true, state: state("ask_raised"), askStatus: "timed_out" }).fire).toBe(true);
    expect(resolveFireDecision({ ripe: true, state: state("ask_raised"), askStatus: "superseded" }).fire).toBe(true);
    expect(resolveFireDecision({ ripe: true, state: state("ask_raised"), askStatus: "missing" }).fire).toBe(true);
  });

  it("an UNKNOWN prior-ask status fails closed (skip, retry next run)", () => {
    const d = resolveFireDecision({ ripe: true, state: state("ask_raised"), askStatus: null });
    expect(d.fire).toBe(false);
    expect(d.reason).toMatch(/failing closed/i);
  });
});

// ── Hard-stops can never auto-execute; dials fail closed ────────────────────

describe("resolveExecutionMode — no silent flips, ever", () => {
  const sentry = gateById("sentry_paid_rung");
  const permissiveDial = (over: Partial<NormalizedDialRow> = {}): NormalizedDialRow => ({
    action: "Sentry team tier + alerting",
    thresholdUsd: 500,
    autoApprove: true,
    status: "pending",
    oneTimeCostUsd: 0,
    recurringCostUsd: 26,
    ...over,
  });

  it("PIN: every hardStop gate may ONLY ask — even against a maximally permissive dial", () => {
    // A dial that would auto-approve anything, matched by any pattern.
    const anythingGoes: NormalizedDialRow[] = GATES.map((g) => ({
      action: `${g.action.dialActionPattern ?? g.id} anything`,
      thresholdUsd: 0,
      autoApprove: true,
      status: "pending",
      oneTimeCostUsd: 0,
      recurringCostUsd: 0,
    }));
    for (const gate of GATES.filter((g) => g.hardStop)) {
      const d = resolveExecutionMode(gate, anythingGoes);
      expect(d.mode, gate.id).toBe("ask");
      expect(d.reason, gate.id).toMatch(/hard-stop/i);
    }
    // And the hard-stop row is genuinely in the encoded set.
    expect(GATES.some((g) => g.hardStop)).toBe(true);
  });

  it("founder_ask gates always ask — switch flips are Decisions by design", () => {
    for (const gate of GATES.filter((g) => g.action.kind === "founder_ask" && !g.hardStop)) {
      expect(resolveExecutionMode(gate, [permissiveDial()]).mode, gate.id).toBe("ask");
    }
  });

  it("a studio_trigger gate auto-executes ONLY when the dial says autoApprove", () => {
    expect(resolveExecutionMode(sentry, [permissiveDial()]).mode).toBe("auto_execute");
    expect(resolveExecutionMode(sentry, [permissiveDial({ autoApprove: false })]).mode).toBe("ask");
  });

  it("an unreadable or unmatched dial fails closed to an ask", () => {
    expect(resolveExecutionMode(sentry, null).mode).toBe("ask");
    expect(resolveExecutionMode(sentry, []).mode).toBe("ask");
    expect(resolveExecutionMode(sentry, [permissiveDial({ action: "fly_app_redundancy" })]).mode).toBe("ask");
  });

  it("a non-pending dial row does not auto-execute again", () => {
    expect(resolveExecutionMode(sentry, [permissiveDial({ status: "active" })]).mode).toBe("ask");
  });

  it(">$500 spend can never auto-execute, even with autoApprove (the permanent spend hard-stop)", () => {
    const oneTime = resolveExecutionMode(sentry, [permissiveDial({ oneTimeCostUsd: HARD_STOP_SPEND_LIMIT_USD + 1 })]);
    expect(oneTime.mode).toBe("ask");
    expect(oneTime.reason).toMatch(/hard-stop/i);
    const recurring = resolveExecutionMode(sentry, [permissiveDial({ recurringCostUsd: HARD_STOP_SPEND_LIMIT_USD + 1 })]);
    expect(recurring.mode).toBe("ask");
  });

  it("UNKNOWN cost fails closed — cannot prove the spend hard-stop is respected", () => {
    const d = resolveExecutionMode(sentry, [permissiveDial({ oneTimeCostUsd: null, recurringCostUsd: null })]);
    expect(d.mode).toBe("ask");
    expect(d.reason).toMatch(/cost/i);
  });
});

// ── Dial normalization handles both historical shapes ───────────────────────

describe("normalizeDialRows — both revenue.triggers shapes", () => {
  it("reads the /founder/studio shape (mrr in USD, costs, status)", () => {
    const rows = normalizeDialRows([
      { mrr: 500, action: "Sentry team tier + alerting", oneTimeCost: 0, recurringCost: 26, status: "pending", autoApprove: true },
    ]);
    expect(rows).toEqual([
      {
        action: "Sentry team tier + alerting",
        thresholdUsd: 500,
        autoApprove: true,
        status: "pending",
        oneTimeCostUsd: 0,
        recurringCostUsd: 26,
      },
    ]);
  });

  it("reads the seeded shape (threshold in cents, no costs) with honest nulls", () => {
    const rows = normalizeDialRows([{ threshold: 500_00, action: "sentry_starter", autoApprove: false }]);
    expect(rows).toEqual([
      {
        action: "sentry_starter",
        thresholdUsd: 500,
        autoApprove: false,
        status: "pending",
        oneTimeCostUsd: null,
        recurringCostUsd: null,
      },
    ]);
  });

  it("tolerates garbage without throwing", () => {
    expect(normalizeDialRows(null)).toEqual([]);
    expect(normalizeDialRows("nope")).toEqual([]);
    expect(normalizeDialRows([null, 42, { noAction: true }])).toEqual([]);
  });
});
