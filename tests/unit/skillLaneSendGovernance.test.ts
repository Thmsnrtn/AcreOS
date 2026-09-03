/**
 * The skill lane's sendEmail has no one to approve it — so it refuses.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Stage-4 turn 1's census named `agent-skills.ts`'s sendEmail the least
 * governed send lane in the repo: a MODEL-COMPOSED free-form recipient with
 * no approval gate. Turn 9 gave it the pax lane's belts (level, envelope,
 * TCPA). The customer autonomy clarity program (2026-09-02) removed the
 * level altogether: every message Pax writes waits for a tap at every
 * stance (founder decision 1), and every caller of the skill registry is an
 * unattended engine (task-runner, workflow-engine, company agents) — there
 * is nobody in the loop to tap. A belt that lets a send through when "the
 * level is high enough" is the lever the founder declined to offer.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * sendEmail REFUSES, plainly, before touching anything: no config check, no
 * envelope, no rail. The sentence names the one lane that works ("send via
 * Pax", where the draft waits for a tap) and says nothing was sent. The
 * skill stays registered so the pause / risk classification ratchets keep
 * seeing it as a send.
 *
 * Falsification: every case asserts emailService.sendEmail was NEVER called
 * and isConfigured was never consulted; restore any belt that can pass and
 * the "all green" case goes red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = 7;

async function runSendEmail(args: Record<string, unknown> = {}) {
  vi.resetModules();

  const sendEmail = vi.fn(async (_args: Record<string, unknown>) => ({ success: true, messageId: "m-1" }));
  const isConfigured = vi.fn(async () => true);
  const recordAutonomousSend = vi.fn(async () => {});
  const checkSendRateLimit = vi.fn(async () => ({ allowed: true }));
  const checkTcpaBeforeSend = vi.fn(async () => ({ allowed: true }));

  vi.doMock("../../server/services/emailService", () => ({
    emailService: { isConfigured, sendEmail },
  }));
  vi.doMock("../../server/services/autonomyGuardrails", () => ({
    checkSendRateLimit,
    checkTcpaBeforeSend,
    recordAutonomousSend,
  }));
  vi.doMock("../../server/db", () => ({ db: {} }));
  vi.doMock("../../server/utils/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));

  const { skillRegistry } = await import("../../server/services/agent-skills");
  const skill = skillRegistry.getSkillById("sendEmail");
  if (!skill) throw new Error("sendEmail skill is not registered");
  const result = await skill.execute(
    { to: "seller@example.com", subject: "Hi", body: "Hello", ...args },
    { organizationId: ORG },
  );
  return { result, sendEmail, isConfigured, recordAutonomousSend, checkSendRateLimit, checkTcpaBeforeSend };
}

describe("skill-lane sendEmail refuses — there is no one to approve it", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("all green (configured, envelope open, consent on file) still refuses — the belts are not the gate, the tap is", async () => {
    const r = await runSendEmail({ leadId: 12 });
    expect(r.result.success).toBe(false);
    expect(r.result.error ?? "").toMatch(/^Email from a skill has no one to approve it/);
    expect(r.result.error ?? "").toMatch(/send via Pax/);
    expect(r.result.error ?? "").toMatch(/Nothing was sent/);
    expect(r.sendEmail).not.toHaveBeenCalled();
    expect(r.isConfigured).not.toHaveBeenCalled();
    expect(r.recordAutonomousSend).not.toHaveBeenCalled();
    expect(r.checkSendRateLimit).not.toHaveBeenCalled();
    expect(r.checkTcpaBeforeSend).not.toHaveBeenCalled();
  });

  it("without a leadId (a bare address) it refuses the same way", async () => {
    const r = await runSendEmail();
    expect(r.result.success).toBe(false);
    expect(r.result.error ?? "").toMatch(/^Email from a skill has no one to approve it/);
    expect(r.sendEmail).not.toHaveBeenCalled();
  });

  it("the refusal names no level and no threshold — there is nothing to raise", async () => {
    const r = await runSendEmail();
    expect(r.result.error ?? "").not.toMatch(/level|assisted|supervised|autonom/i);
  });

  it("the skill stays registered as a communications send (the classification ratchets read it)", async () => {
    vi.doMock("../../server/db", () => ({ db: {} }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    const { skillRegistry } = await import("../../server/services/agent-skills");
    const skill = skillRegistry.getSkillById("sendEmail");
    expect(skill).toBeDefined();
    expect(skill!.agentTypes).toContain("communications");
  });
});
