/**
 * PARITY: the Founder Autopilot send_letter hand after K7-2a.
 *
 * The hand used to call mailProvider.sendLetter — a {success,error} result
 * contract over its own Lob send implementation. K7-2a retired that
 * implementation onto the canonical operation in directMailService.ts,
 * which THROWS. This file pins that the HAND's contract to its caller is
 * unchanged across the migration, driving the real hand (registry →
 * handler) with only its collaborators faked — Lob is a mock, no real
 * mail is ever sent:
 *
 *   · org house send succeeds → {success:true, mailingId, isTestMode,
 *     cost, expectedDelivery}; the house charge is taken ONCE (the hand's
 *     lane pre-resolution never charges) and the VERIFIED identity is the
 *     printed return address, not the typed `from`;
 *   · org Lob rejection → {success:false} naming the failure; the charge
 *     is refunded by the canonical operation's billing verdict;
 *   · org send that stalls past the timeout → {success:false,
 *     'lob timeout'} — the retired path's distinct retryable signal,
 *     carried into the hand;
 *   · org house send with the interlock disarmed → {success:false} with
 *     the lane's refusal; nothing charged, Lob never called;
 *   · org-less system send → succeeds on the platform key with the typed
 *     `from` printed exactly as given (no org, no lane, no charge);
 *   · org-less with nothing configured → {success:false,
 *     'mail provider not configured'} — the retired path's exact refusal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeSafeFetch } from "../helpers/fakeSafeFetch";
import { houseMail } from "../helpers/fakeHouseMailDb";

vi.mock("../../server/services/mail/safeFetch", async () => (await import("../helpers/fakeSafeFetch")).fakeSafeFetchModule());
vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);

const ORG = 42;

const state = {
  ownLobKey: null as string | null,
  identity: null as Record<string, unknown> | null,
  platformKey: { apiKey: "test_platform_key", isTestKey: true } as { apiKey: string; isTestKey: boolean } | null,
  armed: true,
  lobCalls: [] as Array<{ kind: string; apiKey: string; params: any }>,
  lobBehavior: "ok" as "ok" | "reject" | "hang",
  refunds: [] as Array<{ originalEventId: string; amountCents: number }>,
};

function verifiedIdentity() {
  return {
    id: 7, organizationId: ORG, name: "Main office", companyName: "Brazos Land Partners",
    addressLine1: "1 Main St", addressLine2: null, city: "Austin", state: "TX",
    zipCode: "78701", country: "US", status: "verified", isActive: true, isDefault: true,
  };
}

vi.mock("lob", () => ({
  default: class MockLob {
    apiKey: string;
    constructor(opts: { apiKey: string }) { this.apiKey = opts.apiKey; }
    letters = {
      create: async (params: any) => {
        state.lobCalls.push({ kind: "letter", apiKey: this.apiKey, params });
        if (state.lobBehavior === "reject") throw Object.assign(new Error("rejected"), { status_code: 403 });
        if (state.lobBehavior === "hang") return new Promise(() => {});
        return { id: "ltr_1", url: "", expected_delivery_date: "2026-10-30" };
      },
    };
    postcards = {
      create: async (params: any) => {
        state.lobCalls.push({ kind: "postcard", apiKey: this.apiKey, params });
        return { id: "psc_1", url: "", expected_delivery_date: "2026-10-30" };
      },
    };
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async () => state.ownLobKey,
}));
vi.mock("../../server/services/byok/toggle", () => ({ isByokEnabled: async () => state.ownLobKey !== null }));
vi.mock("../../server/services/financial-ledger", () => ({ postOpexSpent: async () => undefined }));
vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => false,
  recordSimulatedAction: async () => ({ id: "sim" }),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: async () => null,
    getOrganization: async () => ({ id: ORG, name: "Brazos Land Partners", settings: {} }),
    getDefaultMailSenderIdentity: async () => state.identity ?? undefined,
    getMailSenderIdentities: async () => (state.identity ? [state.identity] : []),
    logApiUsage: async () => undefined,
  },
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: () => ({}),
  encryptJsonCredentials: () => "enc:v1:mock",
}));

vi.mock("../../server/services/mail/liveSendInterlock", () => ({
  resolvePlatformLobKey: () => {
    if (!state.platformKey) throw new Error("Lob test key not configured.");
    // Models the real interlock: armed + live key → live; else the test key.
    return state.armed && !state.platformKey.isTestKey
      ? state.platformKey
      : { apiKey: state.platformKey.apiKey, isTestKey: state.platformKey.isTestKey };
  },
  isLiveSendArmed: () => state.armed,
}));

vi.mock("../../server/services/creditCost", async () => {
  const { CREDIT_WEIGHTS } = await import("@shared/billing/credit-weights");
  return { creditCost: async (action: keyof typeof CREDIT_WEIGHTS) => CREDIT_WEIGHTS[action] };
});
vi.mock("../../server/db", async () => (await import("../helpers/fakeHouseMailDb")).fakeHouseMailDbModule);
vi.mock("../../server/services/settings", () => ({ getSetting: async (_k: string, fallback: unknown) => fallback, getStringSetting: async () => null, getNumberSetting: async (_k: string, f: number) => f }));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async () => { throw new Error("house mail must never draw the pool"); },
  refundPoolDebit: async (args: { originalEventId: string; amountCents: number }) => {
    state.refunds.push({ originalEventId: args.originalEventId, amountCents: args.amountCents });
  },
}));
vi.mock("../../server/services/credits", () => ({ creditService: { afterDebitCommitted: () => undefined } }));
vi.mock("../../server/services/mail/letterRender", () => ({
  renderLetterHtmlToPdf: async () => { throw new Error("no HTML letters in this suite"); },
}));

import "../../server/services/autopilot/hands/send-letter";
import { getHand } from "../../server/services/autopilot/hands/registry";

const TO = { name: "Lee Owner", address_line1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };
const FROM = { name: "Typed Sender", address_line1: "9 Fake St", city: "X", state: "TX", zip: "1" };
const PDF_URL = "https://files.example.com/letter.pdf";

async function runHand(input: Record<string, unknown>) {
  const hand = getHand("send_letter");
  expect(hand, "send_letter hand registered").toBeDefined();
  return hand!.handler(input, {});
}

beforeEach(() => {
  fakeSafeFetch.reset();
  houseMail.reset();
  state.ownLobKey = null;
  state.identity = verifiedIdentity();
  state.platformKey = { apiKey: "live_platform_key", isTestKey: false };
  state.armed = true;
  state.lobCalls = [];
  state.lobBehavior = "ok";
  state.refunds = [];
  delete process.env.MAIL_MOCK;
  delete process.env.LOB_API_KEY;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("send_letter hand parity after the K7-2a migration", () => {
  it("org house send: succeeds, charges once, and prints the VERIFIED identity — not the typed from", async () => {
    const r = await runHand({ to: TO, from: FROM, file: PDF_URL, organization_id: ORG });

    expect(r.success).toBe(true);
    const out = JSON.parse(r.output);
    expect(out.mailingId).toBe("ltr_1");
    expect(out.isTestMode).toBe(false);
    expect(out.cost).toBe(0.85);
    expect(houseMail.charges.map((c) => c.credits)).toEqual([120]);
    expect(state.lobCalls).toHaveLength(1);
    expect(state.lobCalls[0].params.from).toMatchObject({ name: "Brazos Land Partners", address_line1: "1 Main St" });
    expect(Buffer.isBuffer(state.lobCalls[0].params.file?.value)).toBe(true);
  });

  it("org Lob rejection: failure result, and the house charge is refunded (billing verdict)", async () => {
    state.lobBehavior = "reject";
    const r = await runHand({ to: TO, from: FROM, file: PDF_URL, organization_id: ORG });

    expect(r.success).toBe(false);
    expect(r.output).toMatch(/send_letter failed: Failed to send letter/);
    expect(state.refunds).toHaveLength(1);
  });

  it("org send that stalls: the distinct 'lob timeout' failure, as the retired path reported it", async () => {
    vi.useFakeTimers();
    state.lobBehavior = "hang";
    const pending = runHand({ to: TO, from: FROM, file: PDF_URL, organization_id: ORG });
    await vi.advanceTimersByTimeAsync(18_001);
    const r = await pending;

    expect(r.success).toBe(false);
    expect(r.output).toBe("send_letter failed: lob timeout");
    // Billing unknown on a timeout — the charge is NOT refunded.
    expect(state.refunds).toEqual([]);
  });

  it("org house send with the interlock disarmed: refused before any charge or Lob call", async () => {
    state.armed = false;
    state.platformKey = { apiKey: "test_platform_key", isTestKey: true };
    const r = await runHand({ to: TO, from: FROM, file: PDF_URL, organization_id: ORG });

    expect(r.success).toBe(false);
    expect(r.output).toMatch(/not available on this deployment/);
    expect(houseMail.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("org-less system send: succeeds on the platform key, typed from printed as given, no charge", async () => {
    state.platformKey = { apiKey: "test_platform_key", isTestKey: true };
    const r = await runHand({ to: TO, from: FROM, file: PDF_URL });

    expect(r.success).toBe(true);
    const out = JSON.parse(r.output);
    expect(out.mailingId).toBe("ltr_1");
    expect(out.isTestMode).toBe(true);
    expect(state.lobCalls).toHaveLength(1);
    expect(state.lobCalls[0].apiKey).toBe("test_platform_key");
    expect(state.lobCalls[0].params.from).toMatchObject({ name: "Typed Sender", address_line1: "9 Fake St" });
    expect(houseMail.charges).toEqual([]);
  });

  it("org-less with nothing configured: the retired path's exact refusal", async () => {
    state.platformKey = null;
    const r = await runHand({ to: TO, from: FROM, file: PDF_URL });

    expect(r.success).toBe(false);
    expect(r.output).toBe("send_letter failed: mail provider not configured");
    expect(state.lobCalls).toEqual([]);
  });
});
