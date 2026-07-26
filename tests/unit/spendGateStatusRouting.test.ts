/**
 * Regression guard for the graduated-financial-authority gate → executor
 * status contract.
 *
 * The autonomous decision executor used to branch on gate statuses
 * "founder_required" and "pending_approval" — strings the gate NEVER
 * returns. Every non-Tier-1 spend therefore fell through to execution,
 * letting $500–$50K spends fire before their multi-agent consensus was
 * gathered, and even letting hard-cap-"blocked" spends go through.
 *
 * classifySpendGateStatus() is now the single source of truth for that
 * mapping. These tests pin it exhaustively so the mismatch cannot silently
 * return: ONLY the literal "approved" may execute; every other status —
 * including any future/unknown one — must fail safe.
 */

import { describe, expect, it } from "vitest";
import { classifySpendGateStatus } from "../../server/services/autonomousDecisionExecutor";

describe("classifySpendGateStatus — gate→executor status contract", () => {
  it("executes only on an explicit 'approved' (Tier 1 auto-approval)", () => {
    expect(classifySpendGateStatus("approved")).toBe("execute");
  });

  it("hard-stops Tier 5 (>$50K) 'awaiting_founder'", () => {
    expect(classifySpendGateStatus("awaiting_founder")).toBe("hard_stop");
  });

  it("hard-stops an absolute-hard-cap 'blocked' spend", () => {
    expect(classifySpendGateStatus("blocked")).toBe("hard_stop");
  });

  it("defers a 'pending' spend — multi-agent consensus not yet gathered", () => {
    // The critical regression: 'pending' must NEVER map to 'execute'. (With the
    // >$500 hard stop active, tiers 2-4 route to the founder rather than emit
    // 'pending', but the mapping must stay safe if consensus mode is restored.)
    expect(classifySpendGateStatus("pending")).toBe("defer");
  });

  it("defers an 'expired' request (aged out without consensus)", () => {
    expect(classifySpendGateStatus("expired")).toBe("defer");
  });

  it("fails safe on the phantom statuses the old executor keyed on", () => {
    // These are the strings the buggy executor checked for. The gate never
    // emits them, but if some caller ever did, they must not execute.
    expect(classifySpendGateStatus("founder_required")).toBe("defer");
    expect(classifySpendGateStatus("pending_approval")).toBe("defer");
  });

  it("fails safe on any unrecognized/future status", () => {
    for (const status of ["", "unknown", "APPROVED", "approve", "ok", "queued"]) {
      expect(classifySpendGateStatus(status)).not.toBe("execute");
    }
  });
});
