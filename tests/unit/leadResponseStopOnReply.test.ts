/**
 * Stop-on-reply (autonomy gap slice 1, defect CR-036) — behaviour.
 *
 *  1. checkLeadResponded is TRUE for every RESPONSE_SOURCES type and FALSE for
 *     non-response activity (attempts, outcomes, sends) and for responses
 *     older than the window.
 *  2. pauseEnrollmentOnResponse pauses every ACTIVE enrollment of the lead and
 *     only those.
 *  3. The call-outcome line: hot/warm/cold are responses; no_answer /
 *     wrong_number / absent are not.
 *
 * The writers' calls into the pause are pinned in smsGateAndCapture.test.ts
 * (SMS), inboundEmailService.broadcast.test.ts (email) and, for the route, by
 * the source census in leadResponseSources.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  activities: [] as any[],
  enrollments: [] as any[],
  pauseEnrollment: vi.fn(async (_orgId: number, _id: number, _reason: string) => undefined),
  getLeadActivities: vi.fn(async (_orgId: number, _leadId: number) => [] as any[]),
  getLeadEnrollments: vi.fn(async (_orgId: number, _leadId: number) => [] as any[]),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getLeadActivities: H.getLeadActivities,
    getLeadEnrollments: H.getLeadEnrollments,
    pauseEnrollment: H.pauseEnrollment,
  },
  db: { insert: () => ({ values: async () => undefined }) },
}));
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
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: async () => ({ written: true }) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sequenceProcessorService } from "../../server/services/sequenceProcessor";
import {
  RESPONSE_SOURCES,
  RESPONSE_CALL_OUTCOMES,
  callOutcomeIsResponse,
  isResponseActivityType,
  pauseSequencesOnResponse,
} from "../../server/services/leadResponse";

const ORG = 7;
const LEAD = 42;
const recent = () => new Date(Date.now() - 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  H.getLeadActivities.mockImplementation(async () => H.activities);
  H.getLeadEnrollments.mockImplementation(async () => H.enrollments);
  H.activities = [];
  H.enrollments = [];
});

describe("checkLeadResponded reads RESPONSE_SOURCES", () => {
  it.each([...RESPONSE_SOURCES])("is true for a recent %s activity", async (type) => {
    H.activities = [{ type, createdAt: recent() }];
    expect(await sequenceProcessorService.checkLeadResponded(LEAD, ORG, 3)).toBe(true);
    expect(H.getLeadActivities).toHaveBeenCalledWith(ORG, LEAD);
  });

  it.each([
    "email_sent",
    "sms_sent",
    "phone_attempt",
    "sms_attempt",
    "phone_outcome",
    "sms_outcome",
    "note",
    // the legacy names nothing ever wrote — no longer a response
    "email_reply",
    "sms_reply",
    "call",
    "response",
  ])("is false for a %s activity", async (type) => {
    H.activities = [{ type, createdAt: recent() }];
    expect(await sequenceProcessorService.checkLeadResponded(LEAD, ORG, 3)).toBe(false);
  });

  it("is false for a response older than the window", async () => {
    H.activities = [{ type: "email_received", createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }];
    expect(await sequenceProcessorService.checkLeadResponded(LEAD, ORG, 3)).toBe(false);
  });

  it("fails soft (false) when the read throws", async () => {
    H.getLeadActivities.mockImplementation(async () => {
      throw new Error("db down");
    });
    expect(await sequenceProcessorService.checkLeadResponded(LEAD, ORG, 3)).toBe(false);
  });

  it("isResponseActivityType agrees with the list, and rejects empties", () => {
    for (const t of RESPONSE_SOURCES) expect(isResponseActivityType(t)).toBe(true);
    expect(isResponseActivityType("email_sent")).toBe(false);
    expect(isResponseActivityType(null)).toBe(false);
    expect(isResponseActivityType("")).toBe(false);
  });
});

describe("pauseEnrollmentOnResponse / pauseSequencesOnResponse", () => {
  it("pauses every active enrollment of the lead and nothing else", async () => {
    H.enrollments = [
      { id: 1, status: "active" },
      { id: 2, status: "paused" },
      { id: 3, status: "active" },
      { id: 4, status: "completed" },
    ];
    await sequenceProcessorService.pauseEnrollmentOnResponse(ORG, LEAD);
    expect(H.getLeadEnrollments).toHaveBeenCalledWith(ORG, LEAD);
    expect(H.pauseEnrollment.mock.calls.map((c) => c[1]).sort()).toEqual([1, 3]);
    expect(H.pauseEnrollment).toHaveBeenCalledWith(ORG, 1, "Lead responded");
  });

  it("the writers' helper reaches the processor and pauses (end to end through the lazy import)", async () => {
    H.enrollments = [{ id: 9, status: "active" }];
    await pauseSequencesOnResponse(ORG, LEAD);
    expect(H.pauseEnrollment).toHaveBeenCalledWith(ORG, 9, "Lead responded");
  });

  it("the helper never throws when the pause fails", async () => {
    H.getLeadEnrollments.mockImplementation(async () => {
      throw new Error("db down");
    });
    await expect(pauseSequencesOnResponse(ORG, LEAD)).resolves.toBeUndefined();
  });
});

describe("the call-outcome line", () => {
  it.each(["hot", "warm", "cold"])("%s means a human engaged — a response", (o) => {
    expect(callOutcomeIsResponse(o)).toBe(true);
  });
  it.each(["no_answer", "wrong_number", "", null, undefined])("%s is not a response", (o) => {
    expect(callOutcomeIsResponse(o as any)).toBe(false);
  });
  it("lists exactly hot/warm/cold", () => {
    expect([...RESPONSE_CALL_OUTCOMES]).toEqual(["hot", "warm", "cold"]);
  });
});
