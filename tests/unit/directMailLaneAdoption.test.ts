/**
 * ADOPTION: the production direct-mail call site actually DECLARES the
 * counterparty lane.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM tests/unit/lobCounterpartyLane.test.ts.
 * That file proves `lobService` routes a counterparty send through the org's
 * own Lob account. It proves nothing about whether anything in production ever
 * ASKS for that. A lane parameter that no caller passes is the "canonical
 * function with zero production callers" failure this repo has already paid
 * for twice: authoritative semantics, tested against their own inputs, reached
 * by nobody.
 *
 * `CommunicationsService.sendDirectMailToLead` is THE production path that
 * prints letters to leads — a customer's sellers. So this file drives that
 * real method, with only its collaborators faked, and asserts on the context
 * it hands `lobService.sendLetter`. Drop `{ organizationId, purpose }` at the
 * call site and this goes red even though every assertion in the other file
 * still passes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendLetter = vi.fn();
const isConfiguredForOrg = vi.fn();

vi.mock("../../server/services/lobService", () => ({
  lobService: {
    sendLetter: (...args: unknown[]) => sendLetter(...args),
    sendPostcard: vi.fn(),
    isConfigured: () => true,
    isConfiguredForOrg: (...args: unknown[]) => isConfiguredForOrg(...args),
    isRetryableError: () => false,
  },
}));

const org = {
  value: {
    id: 42,
    name: "Brazos Land Partners",
    settings: {
      mailMode: "live",
      companyAddress: "1 Main St",
      companyCity: "Austin",
      companyState: "TX",
      companyZip: "78701",
    },
  } as any,
};

vi.mock("../../server/storage", () => ({
  storage: new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "getLead") {
        return async () => ({
          id: 7,
          firstName: "Lee",
          lastName: "Owner",
          address: "2 Dirt Rd",
          city: "Llano",
          state: "TX",
          zip: "78643",
        });
      }
      if (prop === "getOrganization") return async () => org.value;
      return vi.fn().mockResolvedValue(undefined);
    },
  }),
  db: {},
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: vi.fn() } }));
vi.mock("../../server/services/smsService", () => ({ smsService: { sendSms: vi.fn() } }));
vi.mock("../../server/services/tcpaCompliance", () => ({
  canSendViaChannel: () => ({ allowed: true }),
  checkTcpaConsent: async () => ({ allowed: true }),
  checkTcpaConsentFromLead: () => ({ allowed: true }),
}));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "",
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { communicationsService } from "../../server/services/communications";

const CONTENT = { subject: "About your parcel", body: "Hello", htmlContent: "<p>Hello</p>" };

beforeEach(() => {
  sendLetter.mockReset().mockResolvedValue({
    success: true,
    lobMailingId: "ltr_1",
    expectedDeliveryDate: "2026-08-27",
    isTestMode: false,
  });
  isConfiguredForOrg.mockReset().mockResolvedValue(true);
  org.value.name = "Brazos Land Partners";
});

describe("sendDirectMailToLead declares the counterparty lane", () => {
  it("VACUITY — the send actually happens and lobService.sendLetter is reached", async () => {
    const result = await communicationsService.sendDirectMailToLead(7, 42, CONTENT);

    expect(result.success).toBe(true);
    expect(sendLetter).toHaveBeenCalledTimes(1);
  });

  it("passes the org id AND purpose 'counterparty' so the org's own Lob account is resolved", async () => {
    await communicationsService.sendDirectMailToLead(7, 42, CONTENT);

    const ctx = sendLetter.mock.calls[0][2];
    expect(ctx, "no send context passed — lobService would fall back to the platform env key").toBeTruthy();
    expect(ctx.organizationId).toBe(42);
    expect(ctx.purpose).toBe("counterparty");
  });

  it("the return address carries the ORG's name, never AcreOS's", async () => {
    await communicationsService.sendDirectMailToLead(7, 42, CONTENT);

    expect(sendLetter.mock.calls[0][0].from.name).toBe("Brazos Land Partners");
  });

  it("refuses rather than signing the letter 'AcreOS' when the org name is unavailable", async () => {
    org.value = { id: 42, settings: org.value.settings };

    const result = await communicationsService.sendDirectMailToLead(7, 42, CONTENT);

    expect(result.success).toBe(false);
    expect(sendLetter).not.toHaveBeenCalled();
  });

  it("the availability precheck is TENANT-AWARE — a BYOK org is not refused by a platform-only probe", async () => {
    isConfiguredForOrg.mockResolvedValue(false);

    const result = await communicationsService.sendDirectMailToLead(7, 42, CONTENT);

    expect(isConfiguredForOrg).toHaveBeenCalledWith(42);
    expect(result.success).toBe(false);
    expect(sendLetter).not.toHaveBeenCalled();
  });
});
