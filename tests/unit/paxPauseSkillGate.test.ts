/**
 * Pax pause — the skill registry honours it (pause coverage, 2026-09-02).
 *
 * `skillRegistry.executeSkill` is the ONE dispatch point every unattended
 * engine ends in (workflow engine, task runner, autonomous task processor,
 * company agents). Gating it here means a skill cannot act during a pause
 * no matter which engine — or which future engine — asked for it.
 *
 * Against the REAL registry:
 *   1. Paused + side-effecting skill (sendEmail) → refused with the honest
 *      message; the email rail is never touched.
 *   2. Paused + pause-safe skill (a pure calculation) → runs, and the pause
 *      state is not even consulted (the allowlist is what makes "read-only
 *      lookups and drafts still work" true).
 *   3. Failed pause read → fails CLOSED with "could not verify".
 *   4. Unpaused + gated skill → the gate consults the switch and lets the
 *      skill proceed to its own logic.
 *   5. An unknown skill id is "Skill not found" before any pause read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  getPaxPauseState: vi.fn(async (_orgId: number) => ({
    paused: false,
    pausedUntil: null as Date | null,
    checkFailed: false,
  })),
  sendEmail: vi.fn(async (_opts: any) => ({ success: true, messageId: "m1" })),
  isConfigured: vi.fn(async () => true),
  getLead: vi.fn(async (_orgId: number, _leadId: number) => null as any),
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({
  storage: { getLead: H.getLead },
  db: {},
}));
vi.mock("../../server/services/paxPause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxPause")>();
  return { ...actual, getPaxPauseState: H.getPaxPauseState };
});
vi.mock("../../server/services/emailService", () => ({
  emailService: { isConfigured: H.isConfigured, sendEmail: H.sendEmail },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { skillRegistry } from "../../server/services/agent-skills";
import { PAX_PAUSE_COPY } from "../../shared/pax-glossary";

const ORG_ID = 7;
const ctx = { organizationId: ORG_ID };
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  H.getPaxPauseState.mockResolvedValue({ paused: false, pausedUntil: null, checkFailed: false });
});

describe("paused org — side-effecting skills are refused for every caller", () => {
  it("refuses sendEmail with the honest message; the email rail is never touched", async () => {
    H.getPaxPauseState.mockResolvedValue({ paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false });

    const result = await skillRegistry.executeSkill(
      "sendEmail",
      { to: "seller@example.com", subject: "s", body: "b" },
      ctx,
    );

    expect(result.success).toBe(false);
    // The glossary line (spec §4.6): a humanised time, never an ISO string.
    expect(result.error).toBe(PAX_PAUSE_COPY.refusal({ until: PAUSED_UNTIL, byName: null }));
    expect(result.error).toContain("Pax is paused until");
    expect(result.error).not.toContain(PAUSED_UNTIL.toISOString());
    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.isConfigured).not.toHaveBeenCalled();
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
  });

  it("still runs a pause-safe skill (pure calculation) without consulting the switch", async () => {
    H.getPaxPauseState.mockResolvedValue({ paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false });

    const result = await skillRegistry.executeSkill(
      "calculateFinancing",
      { principal: 50000, interestRate: 10, termMonths: 60 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.monthlyPayment).toBeGreaterThan(0);
    expect(H.getPaxPauseState).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a failed pause read — refuses a record-writing skill with 'could not verify'", async () => {
    H.getPaxPauseState.mockResolvedValue({ paused: true, pausedUntil: null, checkFailed: true });

    const result = await skillRegistry.executeSkill("enrichLead", { leadId: 42 }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe(PAX_PAUSE_COPY.checkFailedRefusal);
    expect(result.error).toContain("could not verify");
    expect(H.getLead).not.toHaveBeenCalled();
  });
});

describe("unpaused org — gated skills proceed to their own logic", () => {
  it("enrichLead consults the switch, then runs (reaches its lead lookup)", async () => {
    const result = await skillRegistry.executeSkill("enrichLead", { leadId: 42 }, ctx);

    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
    expect(H.getLead).toHaveBeenCalledWith(ORG_ID, 42);
    // The skill's OWN outcome, not the pause's: the lookup returned nothing.
    expect(result.success).toBe(false);
    expect(result.error).toBe("Lead not found");
  });

  it("an unknown skill id is 'Skill not found' before any pause read", async () => {
    const result = await skillRegistry.executeSkill("noSuchSkill", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Skill not found");
    expect(H.getPaxPauseState).not.toHaveBeenCalled();
  });
});
