/**
 * The statutory clock on owner deletion requests (W5a): warn once inside the
 * last 10 days, then every day once overdue; closed requests never alert. The
 * job that runs it is CRITICAL on the deadman roster, and its public form
 * never asks for a government identifier.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { requestsNeedingDeadlineAlert } from "../../server/services/trust/ownerOptOut";
import { DEADLINE_WARNING_DAYS, statutoryDaysFor } from "../../shared/trust/ownerIdentifiers";
import { JOB_ROSTER } from "../../server/jobs/jobRegistry";
import { ownerOptOutSubmitSchema } from "../../server/routes-owner-optout";

const NOW = new Date("2026-10-11T08:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("the statutory window", () => {
  it("is 45 days, California and elsewhere", () => {
    expect(statutoryDaysFor("CA")).toBe(45);
    expect(statutoryDaysFor(null)).toBe(45);
    expect(statutoryDaysFor("tx")).toBe(45);
  });

  it("warns once inside the last 10 days, re-raises daily once overdue, ignores closed", () => {
    const rows = [
      { id: 1, status: "verified" as const, dueAt: day(20), deadlineAlertedAt: null },
      { id: 2, status: "verified" as const, dueAt: day(DEADLINE_WARNING_DAYS - 1), deadlineAlertedAt: null },
      { id: 3, status: "verified" as const, dueAt: day(5), deadlineAlertedAt: day(-1) },
      { id: 4, status: "pending_verification" as const, dueAt: day(-2), deadlineAlertedAt: day(-0.5) },
      { id: 5, status: "verified" as const, dueAt: day(-2), deadlineAlertedAt: day(-1.5) },
      { id: 6, status: "completed" as const, dueAt: day(-30), deadlineAlertedAt: null },
      { id: 7, status: "expired" as const, dueAt: day(-30), deadlineAlertedAt: null },
    ];
    const due = requestsNeedingDeadlineAlert(rows, NOW);
    expect(due.map((d) => d.id)).toEqual([2, 5]);
    expect(due.find((d) => d.id === 5)!.overdue).toBe(true);
  });
});

describe("wiring", () => {
  it("the deadline job is on the deadman roster as CRITICAL, daily", () => {
    const e = JOB_ROSTER.find((j) => j.name === "owner_optout_deadlines");
    expect(e).toMatchObject({ critical: true, intervalMs: 86_400_000 });
    expect(JOB_ROSTER.find((j) => j.name === "giving_monthly")).toBeTruthy();
    expect(JOB_ROSTER.find((j) => j.name === "collateral_watch")).toBeTruthy();
  });

  it("the public form never accepts a government identifier", () => {
    const keys = Object.keys(ownerOptOutSubmitSchema.shape);
    for (const k of keys) expect(k).not.toMatch(/ssn|social|tin|taxId|license|passport|dob|birth/i);
    expect(ownerOptOutSubmitSchema.safeParse({ verification: "email", email: "a@b.co", ssn: "123-45-6789" }).success).toBe(false);
  });

  it("the public routes are mounted ahead of the /api auth gate", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../server/routes.ts"), "utf8");
    const pub = src.indexOf("registerPublicOwnerOptOutRoutes(app)");
    const gate = src.indexOf("app.use('/api', isAuthenticated");
    expect(pub).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(0);
    expect(pub).toBeLessThan(gate);
  });
});
