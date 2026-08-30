/**
 * The skill lane's sendEmail wears the same belts as the pax lane.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Stage-4 turn 1's census named `agent-skills.ts`'s sendEmail the least
 * governed send lane in the repo: a MODEL-COMPOSED free-form recipient with
 * no autonomy gate, no rate envelope, no TCPA check — while the same
 * recipients reached through pax's send_email carry all three
 * (ai/tools.ts:1950-1985). Turn 9 reclassified the lane counterparty-byo
 * (purpose:"counterparty" makes emailService refuse without the org's own
 * identity) and recorded the residual gap as skill-lane follow-up. This is
 * that follow-up, and this file pins it.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * Every skill caller is an autonomous engine (task-runner, workflow-engine,
 * autonomousTaskProcessor, companyAgents) — no human is present to approve a
 * draft. So, unlike pax chat's draft-for-approval:
 *   - assisted autonomy       → REFUSE, naming the level and the route.
 *   - rate envelope exhausted → REFUSE.
 *   - TCPA-blocked lead       → REFUSE.
 *   - all green               → send with purpose:"counterparty" AND record
 *                               into the autonomous-send audit envelope, so
 *                               the rate limiter and daily briefing count it.
 *
 * Falsification: each refusal case asserts emailService.sendEmail was NEVER
 * called — deleting a belt turns exactly that case red; the all-green case
 * is the vacuity guard proving the refusals aren't "refuse everything".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = 7;

interface Knobs {
  level?: "assisted" | "supervised" | "autonomous";
  rateAllowed?: boolean;
  tcpaAllowed?: boolean;
  leadId?: number;
}

async function runSendEmail(knobs: Knobs) {
  vi.resetModules();

  const sendEmail = vi.fn(async (_args: Record<string, unknown>) => ({ success: true, messageId: "m-1" }));
  const recordAutonomousSend = vi.fn(async () => {});

  vi.doMock("../../server/services/emailService", () => ({
    emailService: {
      isConfigured: async () => true,
      sendEmail,
    },
  }));
  vi.doMock("../../server/services/autonomyGuardrails", () => ({
    getOrgAutonomyLevel: async () => knobs.level ?? "autonomous",
    unattendedSendPermitted: (level: string) => level !== "assisted",
    checkSendRateLimit: async () => (knobs.rateAllowed === false
      ? { allowed: false, reason: "Daily send envelope reached (test)" }
      : { allowed: true }),
    checkTcpaBeforeSend: async () => (knobs.tcpaAllowed === false
      ? { allowed: false, reason: "lead opted out (test)" }
      : { allowed: true }),
    recordAutonomousSend,
  }));

  const { skillRegistry } = await import("../../server/services/agent-skills");
  const skill = skillRegistry.getSkillById("sendEmail");
  if (!skill) throw new Error("sendEmail skill is not registered");
  const result = await skill.execute(
    { to: "seller@example.com", subject: "Hi", body: "Hello", ...(knobs.leadId ? { leadId: knobs.leadId } : {}) },
    { organizationId: ORG },
  );
  return { result, sendEmail, recordAutonomousSend };
}

describe("skill-lane sendEmail wears the pax lane's belts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("vacuity guard: all green → sends as counterparty and records into the audit envelope", async () => {
    const { result, sendEmail, recordAutonomousSend } = await runSendEmail({ leadId: 12 });
    expect(result.success, result.error).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0]).toMatchObject({ purpose: "counterparty", organizationId: ORG });
    expect(recordAutonomousSend).toHaveBeenCalledTimes(1);
  });

  it("assisted autonomy refuses without sending, naming the level and a route", async () => {
    const { result, sendEmail } = await runSendEmail({ level: "assisted" });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/assisted/);
    expect(result.error ?? "").toMatch(/no send was made/i);
    expect(result.error ?? "").toMatch(/Pax/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("an exhausted daily envelope refuses without sending", async () => {
    const { result, sendEmail } = await runSendEmail({ rateAllowed: false });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/envelope/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a TCPA-blocked lead refuses without sending", async () => {
    const { result, sendEmail } = await runSendEmail({ tcpaAllowed: false, leadId: 12 });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/opted out/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("without a leadId the TCPA gate has nothing to check and the send proceeds", async () => {
    // Pins the conditional: the lead consent check applies when a lead is
    // named; a bare address still passes the level + envelope gates above.
    const { result, sendEmail } = await runSendEmail({ tcpaAllowed: false });
    expect(result.success, result.error).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
