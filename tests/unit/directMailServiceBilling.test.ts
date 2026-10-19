/**
 * W5.2 — directMailService billing + safety semantics (2026-07 audit).
 *
 * The send path decides four money/safety questions on every piece:
 *   1. WHO pays the printer — org's own Lob key (BYOK) vs platform key.
 *   2. WHETHER platform credits are debited (skipped entirely on BYOK).
 *   3. WHETHER our opex ledger gets the COGS row (never for BYOK sends).
 *   4. WHETHER the result is honestly marked testMode (live-send interlock:
 *      the platform key is Lob TEST env unless explicitly armed — a test
 *      send must never present as real mail).
 *
 * None of this had direct coverage. Simulation mode is also locked: no Lob
 * client construction, no billing, honest testMode.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// W5a: the owner opt-out list is empty for this test (the guard is proven elsewhere).
vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);

const state = {
  byokKey: null as string | null,
  byokToggleActive: false,
  platformKey: { apiKey: "test_platform_key", isTestKey: true },
  armed: false,
  simulate: false,
  lobCreateCalls: [] as any[],
  poolDebits: [] as any[],
  opexPosts: [] as any[],
};

vi.mock("lob", () => ({
  default: class MockLob {
    apiKey: string;
    postcards = {
      create: async (params: any) => {
        state.lobCreateCalls.push({ kind: "postcard", apiKey: this.apiKey, params });
        return { id: "psc_123", url: "https://lob.test/psc_123", expected_delivery_date: "2026-07-10" };
      },
    };
    letters = {
      create: async (params: any) => {
        state.lobCreateCalls.push({ kind: "letter", apiKey: this.apiKey, params });
        return { id: "ltr_456", url: "https://lob.test/ltr_456", expected_delivery_date: "2026-07-10" };
      },
    };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: async () => null, // legacy path unused here
    getOrganization: async () => ({ id: 42, settings: {} }),
    getDefaultMailSenderIdentity: async () => undefined,
  },
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: () => ({ apiKey: null }),
}));

vi.mock("../../server/services/mail/liveSendInterlock", () => ({
  resolvePlatformLobKey: () => state.platformKey,
  isLiveSendArmed: () => state.armed,
}));

vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async () => state.byokKey,
}));

vi.mock("../../server/services/byok/toggle", () => ({
  isByokEnabled: async () => state.byokToggleActive,
}));

// House mail (founder decisions 2026-10-17) is pre-paid from PURCHASED
// credits (mail/mailLane.ts chargeHouseMail) at the canonical house price —
// one piece per send. The charge's SQL is faked (tests/helpers/fakeHouseMailDb);
// the pool is never consulted, so any poolDebit is recorded as a defect.
vi.mock("../../server/services/creditCost", () => ({ creditCost: async () => 75 }));
vi.mock("../../server/services/settings", () => ({ getSetting: async (_k: string, fallback: unknown) => fallback }));
vi.mock("../../server/services/credits", () => ({ creditService: { afterDebitCommitted: () => undefined } }));
vi.mock("../../server/db", async () => (await import("../helpers/fakeHouseMailDb")).fakeHouseMailDbModule);
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async (args: any) => {
    state.poolDebits.push(args);
    return { allowed: true, debitedCents: 75, remaining: 1, poolMonthly: 1, ledgerRowId: 1, overPool: false };
  },
  refundPoolDebit: async () => undefined,
}));

vi.mock("../../server/services/financial-ledger", () => ({
  postOpexSpent: async (args: any) => {
    state.opexPosts.push(args);
  },
}));

vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => state.simulate,
  recordSimulatedAction: async () => ({ id: "sim_1" }),
}));

import { sendPostcard } from "../../server/services/directMailService";
import { houseMail } from "../helpers/fakeHouseMailDb";

const BASE_OPTIONS = {
  organizationId: 42,
  senderIdentity: {
    organizationId: 42,
    status: "verified",
    isActive: true,
    name: "Main",
    companyName: "Test Land Co",
    addressLine1: "1 Main St",
    city: "Austin",
    state: "TX",
    zipCode: "78701",
  } as any,
  recipientName: "Lee Owner",
  recipientAddress: { line1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" },
  frontHtml: "<h1>front</h1>",
  backHtml: "<h1>back</h1>",
};

beforeEach(() => {
  state.byokKey = null;
  state.byokToggleActive = false;
  state.platformKey = { apiKey: "test_platform_key", isTestKey: true };
  state.armed = false;
  state.simulate = false;
  state.lobCreateCalls = [];
  state.poolDebits = [];
  state.opexPosts = [];
  houseMail.reset();
});

describe("sendPostcard — payer + ledger semantics", () => {
  it("BYOK org key: customer's key used, credits skipped, NO opex ledger row", async () => {
    state.byokKey = "live_customer_key";
    state.byokToggleActive = true;

    const result = await sendPostcard(BASE_OPTIONS);

    expect(state.lobCreateCalls[0].apiKey).toBe("live_customer_key");
    expect(result.credentialSource).toBe("organization");
    expect(result.testMode).toBe(false); // live customer key = real mail
    expect(houseMail.charges).toHaveLength(0); // their key, no AcreOS credits
    expect(state.opexPosts).toHaveLength(0); // their Lob bill, not our COGS
  });

  // Audit 2026-10-18: this case used to send on the TEST platform key and
  // still charge purchased credits for a piece Lob's test environment never
  // printed. House mail now requires the interlock ARMED and a LIVE key.
  it("platform key (interlock unarmed): house mail is refused — nothing sent, nothing charged", async () => {
    await expect(sendPostcard(BASE_OPTIONS)).rejects.toThrow(/AcreOS mail is not available on this deployment/);
    expect(state.lobCreateCalls).toHaveLength(0);
    expect(houseMail.charges).toHaveLength(0);
    expect(state.opexPosts).toHaveLength(0);
  });

  it("armed but only a TEST platform key: still refused, never charged", async () => {
    state.armed = true;
    await expect(sendPostcard(BASE_OPTIONS)).rejects.toThrow(/AcreOS mail is not available on this deployment/);
    expect(state.lobCreateCalls).toHaveLength(0);
    expect(houseMail.charges).toHaveLength(0);
  });

  it("armed with a LIVE platform key: real mail, pre-paid from purchased credits", async () => {
    state.armed = true;
    state.platformKey = { apiKey: "live_platform_key", isTestKey: false };
    const result = await sendPostcard(BASE_OPTIONS);

    expect(state.lobCreateCalls[0].apiKey).toBe("live_platform_key");
    expect(result.credentialSource).toBe("platform");
    expect(result.testMode).toBe(false);
    // Platform pays → one house piece pre-paid from purchased credits AND COGS posted.
    expect(houseMail.charges.map((c) => c.credits)).toEqual([75]);
    expect(state.poolDebits).toEqual([]); // never the monthly pool
    expect(state.opexPosts).toHaveLength(1);
    expect(state.opexPosts[0].amountCents).toBe(92); // the canonical cost table: Lob's 4x6 list price
    expect(state.opexPosts[0].externalEventId).toBe("lob:postcard:psc_123");
    expect(state.opexPosts[0].organizationId).toBe(42);
  });

  it("platform send with insufficient credits refuses BEFORE any Lob call", async () => {
    state.armed = true;
    state.platformKey = { apiKey: "live_platform_key", isTestKey: false };
    houseMail.reset(10); // purchased credits cannot pay a 75-credit piece

    await expect(sendPostcard(BASE_OPTIONS)).rejects.toThrow(/purchased credits only/);
    expect(state.poolDebits).toEqual([]); // the pool is not a fallback
    expect(state.lobCreateCalls).toHaveLength(0); // nothing printed
    expect(state.opexPosts).toHaveLength(0);
  });

  it("passes use_type to Lob (defaults to marketing)", async () => {
    state.armed = true;
    state.platformKey = { apiKey: "live_platform_key", isTestKey: false };
    await sendPostcard(BASE_OPTIONS);
    expect(state.lobCreateCalls[0].params.use_type).toBe("marketing");
  });

  it("simulation mode: no Lob client, no billing, honest testMode", async () => {
    state.simulate = true;

    const result = await sendPostcard(BASE_OPTIONS);

    expect(result.credentialSource).toBe("simulation");
    expect(result.testMode).toBe(true);
    expect(state.lobCreateCalls).toHaveLength(0);
    expect(houseMail.charges).toHaveLength(0);
    expect(state.opexPosts).toHaveLength(0);
  });
});
