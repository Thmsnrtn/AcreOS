/**
 * Pax pause — the sequence processor honours it (pause coverage, 2026-09-02).
 *
 * Drip sequences send email / SMS / direct mail to leads on a 60-second
 * scheduler with nobody watching. Before Gate 0 a paused org's sequences kept
 * sending. What is asserted against the REAL processor:
 *   1. While paused, sendStep DEFERS the step — status "deferred", retryAt =
 *      the pause expiry — and touches no rail. The non-send is recorded on
 *      the delivery timeline with the honest reason, never as "sent".
 *   2. A failed pause read fails CLOSED: deferred ~15 minutes out with the
 *      "could not verify" reason.
 *   3. Defer, not consume: through processEnrollment the enrollment is
 *      rescheduled for the pause expiry with currentStep UNCHANGED and no
 *      lastStepSentAt stamp — the drip resumes where it left off.
 *   4. Unpaused, the same step sends as before.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  getPaxPauseState: vi.fn(async (_orgId: number) => ({
    paused: false,
    pausedUntil: null as Date | null,
    checkFailed: false,
  })),
  insertValues: vi.fn(async (_row: any) => undefined),
  sendEmail: vi.fn(async (_opts: any) => ({ success: true, messageId: "m1" })),
  getSequenceSteps: vi.fn(async (_sequenceId: number) => [] as any[]),
  updateSequenceEnrollment: vi.fn(async (_id: number, _updates: any) => undefined),
  completeEnrollment: vi.fn(async (_id: number) => undefined),
  pauseEnrollment: vi.fn(async (_id: number, _reason: string) => undefined),
}));

vi.mock("../../server/services/paxPause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxPause")>();
  return { ...actual, getPaxPauseState: H.getPaxPauseState };
});
vi.mock("../../server/storage", () => ({
  storage: {
    getSequenceSteps: H.getSequenceSteps,
    updateSequenceEnrollment: H.updateSequenceEnrollment,
    completeEnrollment: H.completeEnrollment,
    pauseEnrollment: H.pauseEnrollment,
    getLeadActivities: async () => [],
  },
  db: { insert: () => ({ values: H.insertValues }) },
}));
// Every downstream gate ALLOWS, so the only thing that can stop a send here
// is the pause — and the unpaused case proves the rail is really reached.
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: () => ({ blocked: false }),
  canSendViaChannel: () => ({ allowed: true }),
  isWithinQuietHoursForLead: () => ({ blocked: false }),
}));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "",
  recordContactTouch: async () => undefined,
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { isConfigured: async () => true, sendEmail: H.sendEmail },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sequenceProcessorService } from "../../server/services/sequenceProcessor";

const ORG_ID = 7;
const PAUSED_UNTIL = new Date(Date.now() + 6 * 60 * 60 * 1000);
const FIFTEEN_MIN = 15 * 60 * 1000;

const STEP_1 = {
  id: 1,
  sequenceId: 3,
  stepNumber: 1,
  channel: "email",
  subject: "Hi {{firstName}}",
  content: "Body",
  delayDays: 2,
  conditionType: "always",
  conditionDays: null,
} as any;

function enrollment() {
  return {
    id: 11,
    sequenceId: 3,
    leadId: 42,
    currentStep: 0,
    status: "active",
    nextStepScheduledAt: new Date(),
    sequence: { id: 3, organizationId: ORG_ID, name: "seller-drip" },
    lead: {
      id: 42,
      organizationId: ORG_ID,
      email: "lead@example.com",
      firstName: "Dana",
      campaignId: 5,
      sourceCampaignId: null,
    },
  } as any;
}

function setPause(state: { paused: boolean; pausedUntil: Date | null; checkFailed: boolean }) {
  H.getPaxPauseState.mockResolvedValue(state);
}

beforeEach(() => {
  vi.clearAllMocks();
  setPause({ paused: false, pausedUntil: null, checkFailed: false });
  H.getSequenceSteps.mockResolvedValue([STEP_1, { ...STEP_1, id: 2, stepNumber: 2 }]);
});

describe("paused org — sequence steps are deferred, never sent, never consumed", () => {
  it("sendStep defers to the pause expiry with the honest reason and touches no rail", async () => {
    setPause({ paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false });

    const outcome = await sequenceProcessorService.sendStep(enrollment(), STEP_1);

    expect(outcome.status).toBe("deferred");
    expect(outcome.retryAt).toEqual(PAUSED_UNTIL);
    expect(outcome.reason).toContain("Pax is paused until");
    expect(outcome.reason).toContain(PAUSED_UNTIL.toISOString());
    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);

    // Recorded on the delivery timeline as what it was — not as "sent".
    expect(H.insertValues).toHaveBeenCalledTimes(1);
    const row = H.insertValues.mock.calls[0][0];
    expect(row.status).toBe("deferred");
    expect(row.sentAt).toBeNull();
    expect(row.leadId).toBe(42);
    expect(row.metadata.skipReason).toContain("Pax is paused until");
  });

  it("FAILS CLOSED on a failed pause read — deferred ~15 minutes out with 'could not verify'", async () => {
    setPause({ paused: true, pausedUntil: null, checkFailed: true });
    const before = Date.now();

    const outcome = await sequenceProcessorService.sendStep(enrollment(), STEP_1);

    const after = Date.now();
    expect(outcome.status).toBe("deferred");
    expect(outcome.reason).toContain("could not verify");
    expect(outcome.retryAt!.getTime()).toBeGreaterThanOrEqual(before + FIFTEEN_MIN - 1000);
    expect(outcome.retryAt!.getTime()).toBeLessThanOrEqual(after + FIFTEEN_MIN + 1000);
    expect(H.sendEmail).not.toHaveBeenCalled();
  });

  it("through processEnrollment the step is NOT consumed: rescheduled to the pause expiry, currentStep unchanged", async () => {
    setPause({ paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false });

    await sequenceProcessorService.processEnrollment(enrollment());

    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.completeEnrollment).not.toHaveBeenCalled();
    expect(H.pauseEnrollment).not.toHaveBeenCalled();
    expect(H.updateSequenceEnrollment).toHaveBeenCalledTimes(1);
    const [id, updates] = H.updateSequenceEnrollment.mock.calls[0];
    expect(id).toBe(11);
    expect(updates.nextStepScheduledAt).toEqual(PAUSED_UNTIL);
    expect(updates).not.toHaveProperty("currentStep");
    expect(updates).not.toHaveProperty("lastStepSentAt");
  });
});

describe("unpaused org — the same step sends as before", () => {
  it("sendStep reaches the email rail on the counterparty lane and reports 'sent'", async () => {
    const outcome = await sequenceProcessorService.sendStep(enrollment(), STEP_1);

    expect(outcome.status).toBe("sent");
    expect(H.sendEmail).toHaveBeenCalledTimes(1);
    const opts = H.sendEmail.mock.calls[0][0];
    expect(opts.to).toBe("lead@example.com");
    expect(opts.purpose).toBe("counterparty");
    expect(opts.organizationId).toBe(ORG_ID);
    // The gate DID consult the switch.
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
    // And the delivery event says "sent" only because a send happened.
    const sentRow = H.insertValues.mock.calls.map((c) => c[0]).find((r) => r.status === "sent");
    expect(sentRow).toBeTruthy();
  });
});
