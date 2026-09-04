/**
 * Pax controls — the sequence processor honours the pause (AUTONOMY_SPEC.md
 * §4.4 "Campaign sequences": `nextStepScheduledAt = pausedUntil`,
 * `recordStepSkip(..., "deferred_paused")` — deferred, never dropped;
 * frequency cap + quiet hours still meter on resume).
 *
 * Drip sequences send email / SMS / direct mail to leads on a 60-second
 * scheduler with nobody watching. What is asserted against the REAL
 * processor, with the ONE reader (getPaxControls) controllable:
 *   1. While paused, sendStep DEFERS the step — status "deferred", retryAt =
 *      the pause expiry — and touches no rail. The non-send is recorded on
 *      the delivery timeline as `deferred_paused` with the glossary reason
 *      (a local time, the holder, never an ISO string), never as "sent".
 *   2. A failed controls read fails CLOSED: deferred ~15 minutes out with
 *      the "could not verify" reason.
 *   3. Defer, not consume: through processEnrollment the enrollment is
 *      rescheduled for the pause expiry with currentStep UNCHANGED and no
 *      lastStepSentAt stamp — the drip resumes where it left off.
 *   4. Unpaused, the same step sends as before at EITHER stance (a rule the
 *      customer turned on is outside the stance) and leaves a receipt.
 *   5. RESUME STILL METERS: thirty steps deferred by a pause, released
 *      together, still pass one by one through the contact-frequency cap —
 *      the cap allows five and defers the other twenty-five with their own
 *      retry time. A pause never converts into a burst.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  getPaxControls: vi.fn(async (_orgId: number) => ({}) as unknown as PaxControlsState),
  recordPaxEffect: vi.fn(async (_effect: PaxEffect) => ({ written: true })),
  insertValues: vi.fn(async (_row: any) => undefined),
  sendEmail: vi.fn(async (_opts: any) => ({ success: true, messageId: "m1" })),
  getSequenceSteps: vi.fn(async (_sequenceId: number) => [] as any[]),
  updateSequenceEnrollment: vi.fn(async (_id: number, _updates: any) => undefined),
  completeEnrollment: vi.fn(async (_id: number) => undefined),
  pauseEnrollment: vi.fn(async (_id: number, _reason: string) => undefined),
  frequencyGateForLead: vi.fn(async (_orgId: number, _leadId: number) => ({ allowed: true }) as any),
}));

vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
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
// Every downstream gate ALLOWS unless a case says otherwise, so the only
// thing that can stop a send here is the pause — and the unpaused case
// proves the rail is really reached.
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: () => ({ blocked: false }),
  canSendViaChannel: () => ({ allowed: true }),
  isWithinQuietHoursForLead: () => ({ blocked: false }),
}));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: H.frequencyGateForLead,
  describeFrequencySkip: (f: any) => `frequency cap: next eligible ${f.nextEligibleAt?.toISOString?.() ?? "later"}`,
  recordContactTouch: async () => undefined,
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { isConfigured: async () => true, sendEmail: H.sendEmail },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sequenceProcessorService } from "../../server/services/sequenceProcessor";
import type { PaxControlsState } from "../../server/services/paxControls";
import type { PaxEffect } from "../../server/services/paxReceipts";
import { OFFERED_STANCES } from "../../shared/pax-controls";

/** The delivery-timeline status of a pause deferral (registry pausedReason for "sequences"). */
const STEP_SKIP_DEFERRED_PAUSED = "deferred_paused";

const ORG_ID = 7;
const PAUSED_UNTIL = new Date(Date.now() + 6 * 60 * 60 * 1000);
const FIFTEEN_MIN = 15 * 60 * 1000;

function controls(over: Partial<PaxControlsState> = {}): PaxControlsState {
  return {
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null as { userId: string; name: string } | null,
    checkFailed: false,
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    timezone: "America/Chicago",
    ...over,
  };
}

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

function enrollment(id = 11, leadId = 42) {
  return {
    id,
    sequenceId: 3,
    leadId,
    currentStep: 0,
    status: "active",
    nextStepScheduledAt: new Date(),
    sequence: { id: 3, organizationId: ORG_ID, name: "seller-drip" },
    lead: {
      id: leadId,
      organizationId: ORG_ID,
      email: `lead${leadId}@example.com`,
      firstName: "Dana",
      campaignId: 5,
      sourceCampaignId: null,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.getPaxControls.mockResolvedValue(controls());
  H.frequencyGateForLead.mockResolvedValue({ allowed: true });
  H.getSequenceSteps.mockResolvedValue([STEP_1, { ...STEP_1, id: 2, stepNumber: 2 }]);
});

describe("paused org — sequence steps are deferred as deferred_paused, never sent, never consumed", () => {
  it("sendStep defers to the pause expiry with the glossary reason and touches no rail", async () => {
    H.getPaxControls.mockResolvedValue(
      controls({ paused: true, pausedUntil: PAUSED_UNTIL, pausedBy: { userId: "u-2", name: "Maria Lopez" } }),
    );

    const outcome = await sequenceProcessorService.sendStep(enrollment(), STEP_1);

    expect(outcome.status).toBe("deferred");
    expect(outcome.retryAt).toEqual(PAUSED_UNTIL);
    expect(outcome.reason).toContain("Pax is paused until");
    expect(outcome.reason).toContain("paused by Maria Lopez");
    expect(outcome.reason).toMatch(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (am|pm)\b/);
    expect(outcome.reason).not.toContain(PAUSED_UNTIL.toISOString());
    expect(outcome.reason).toMatch(/Settings → Pax\b/);
    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
    expect(H.getPaxControls).toHaveBeenCalledWith(ORG_ID);

    // Recorded on the delivery timeline as what it was — not as "sent".
    expect(H.insertValues).toHaveBeenCalledTimes(1);
    const row = H.insertValues.mock.calls[0][0];
    expect(row.status).toBe(STEP_SKIP_DEFERRED_PAUSED);
    expect(row.status).toBe("deferred_paused");
    expect(row.sentAt).toBeNull();
    expect(row.leadId).toBe(42);
    expect(row.metadata.skipReason).toContain("Pax is paused until");
  });

  it("FAILS CLOSED on a failed controls read — deferred ~15 minutes out with 'could not verify'", async () => {
    H.getPaxControls.mockResolvedValue(controls({ paused: true, checkFailed: true, stance: "ask_before_everything" }));
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
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL }));

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

describe("unpaused org — the same step sends as before, at either stance, and leaves a receipt", () => {
  it.each(OFFERED_STANCES)("stance %s: sendStep reaches the email rail on the counterparty lane and reports 'sent'", async (stance) => {
    H.getPaxControls.mockResolvedValue(controls({ stance }));

    const outcome = await sequenceProcessorService.sendStep(enrollment(), STEP_1);

    expect(outcome.status).toBe("sent");
    expect(H.sendEmail).toHaveBeenCalledTimes(1);
    const opts = H.sendEmail.mock.calls[0][0];
    expect(opts.to).toBe("lead42@example.com");
    expect(opts.purpose).toBe("counterparty");
    expect(opts.organizationId).toBe(ORG_ID);
    // The gate DID consult the reader.
    expect(H.getPaxControls).toHaveBeenCalledWith(ORG_ID);
    // And the delivery event says "sent" only because a send happened.
    const sentRow = H.insertValues.mock.calls.map((c) => c[0]).find((r) => r.status === "sent");
    expect(sentRow).toBeTruthy();
    // "What Pax did": one receipt, actor rule, the org's stance, the lead as the record.
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(1);
    expect(H.recordPaxEffect.mock.calls[0][0]).toMatchObject({
      orgId: ORG_ID,
      actor: "rule",
      origin: "engine",
      engine: "sequences",
      stance,
      entityType: "lead",
      entityId: 42,
      enrollmentId: 11,
      witnessed: false,
    });
  });

  it("no receipt for a step that did not send (frequency-deferred)", async () => {
    H.frequencyGateForLead.mockResolvedValue({ allowed: false, nextEligibleAt: new Date(Date.now() + 2 * 60 * 60 * 1000) });
    const outcome = await sequenceProcessorService.sendStep(enrollment(), STEP_1);
    expect(outcome.status).toBe("deferred");
    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
  });
});

describe("resume still meters — thirty steps deferred by a pause go through the frequency cap one by one", () => {
  it("the cap allows five; the other twenty-five are deferred with their own retry time, none dropped, none consumed", async () => {
    const CAP = 5;
    const NEXT_ELIGIBLE = new Date(Date.now() + 3 * 60 * 60 * 1000);
    // While paused: thirty enrollments each defer as deferred_paused.
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL }));
    const enrollments = Array.from({ length: 30 }, (_, i) => enrollment(100 + i, 1000 + i));
    for (const e of enrollments) await sequenceProcessorService.processEnrollment(e);
    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.insertValues.mock.calls.filter((c) => c[0].status === "deferred_paused")).toHaveLength(30);
    expect(H.updateSequenceEnrollment).toHaveBeenCalledTimes(30);
    for (const [, updates] of H.updateSequenceEnrollment.mock.calls) {
      expect(updates.nextStepScheduledAt).toEqual(PAUSED_UNTIL);
      expect(updates).not.toHaveProperty("currentStep");
    }

    // The pause lifts; the cap allows CAP sends and then says "later".
    vi.clearAllMocks();
    H.getPaxControls.mockResolvedValue(controls());
    let allowed = 0;
    H.frequencyGateForLead.mockImplementation(async () => {
      if (allowed < CAP) {
        allowed++;
        return { allowed: true };
      }
      return { allowed: false, nextEligibleAt: NEXT_ELIGIBLE };
    });

    for (const e of enrollments) await sequenceProcessorService.processEnrollment(e);

    expect(H.sendEmail).toHaveBeenCalledTimes(CAP);
    // Every enrollment was rescheduled; the sent ones advanced, the capped ones did not.
    expect(H.updateSequenceEnrollment).toHaveBeenCalledTimes(30);
    const advanced = H.updateSequenceEnrollment.mock.calls.filter(([, u]) => u.currentStep === 1);
    const deferred = H.updateSequenceEnrollment.mock.calls.filter(([, u]) => !("currentStep" in u));
    expect(advanced).toHaveLength(CAP);
    expect(deferred).toHaveLength(30 - CAP);
    for (const [, u] of deferred) expect(u.nextStepScheduledAt).toEqual(NEXT_ELIGIBLE);
    for (const [, u] of advanced) expect(u.lastStepSentAt).toBeInstanceOf(Date);
    // Nothing was completed, paused or failed by the burst.
    expect(H.completeEnrollment).not.toHaveBeenCalled();
    expect(H.pauseEnrollment).not.toHaveBeenCalled();
    // Exactly CAP receipts — one per real send.
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(CAP);
  });
});
