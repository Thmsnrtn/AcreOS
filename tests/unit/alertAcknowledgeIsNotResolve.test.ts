/**
 * DEFECT-0135 — the executor's "acknowledge" does not close the alert.
 *
 * executeAlertAcknowledgement wrote status "resolved" (closing an alert whose
 * cause nobody fixed), put the reasoning in `resolutionNotes` — a column
 * system_alerts does not have, hidden by an `as any` — and returned success
 * when no row matched. This pins the unit's shape: the executor is driven by
 * a model decision, so the body is read here, comment-stripped. The removed
 * `as any` is the other half: an unknown column now fails `npm run check`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/autonomousDecisionExecutor.ts"), "utf8"));
const start = src.indexOf("async function executeAlertAcknowledgement(");
const end = src.indexOf("async function executeFeatureRequestApproval(");
const body = src.slice(start, end);

describe("DEFECT-0135 — alert acknowledgement", () => {
  it("reads the unit (vacuity)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).toMatch(/db\.update\(systemAlerts\)/);
  });

  it("acknowledges, never resolves", () => {
    expect(body).toMatch(/status: "acknowledged"/);
    expect(body).toMatch(/acknowledgedAt: new Date\(\)/);
    expect(body).not.toMatch(/"resolved"|resolvedAt|resolutionNotes/);
  });

  it("moves only a new alert, and zero rows is not success", () => {
    expect(body).toMatch(/eq\(systemAlerts\.status, "new"\)/);
    expect(body).toMatch(/\.returning\(/);
    expect(body).toMatch(/if \(updated\.length === 0\)[\s\S]*?success: false/);
  });

  it("carries no cast that could hide a nonexistent column", () => {
    expect(body).not.toMatch(/as any/);
  });
});
