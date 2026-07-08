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

const state = {
  byokKey: null as string | null,
  byokToggleActive: false,
  platformKey: { apiKey: "test_platform_key", isTestKey: true },
  hasCredits: true,
  simulate: false,
  lobCreateCalls: [] as any[],
  usageRecorded: [] as any[],
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
  },
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: () => ({ apiKey: null }),
}));

vi.mock("../../server/services/mail/liveSendInterlock", () => ({
  resolvePlatformLobKey: () => state.platformKey,
}));

vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async () => state.byokKey,
}));

vi.mock("../../server/services/byok/toggle", () => ({
  isByokEnabled: async () => state.byokToggleActive,
}));

vi.mock("../../server/services/credits", () => ({
  creditService: {
    hasEnoughCredits: async () => state.hasCredits,
    getBalance: async () => 120,
  },
  usageMeteringService: {
    calculateCost: async () => 89,
    recordUsage: async (...args: any[]) => {
      state.usageRecorded.push(args);
    },
  },
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

const BASE_OPTIONS = {
  organizationId: 42,
  senderIdentity: {
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
  state.hasCredits = true;
  state.simulate = false;
  state.lobCreateCalls = [];
  state.usageRecorded = [];
  state.opexPosts = [];
});

describe("sendPostcard — payer + ledger semantics", () => {
  it("BYOK org key: customer's key used, credits skipped, NO opex ledger row", async () => {
    state.byokKey = "live_customer_key";
    state.byokToggleActive = true;

    const result = await sendPostcard(BASE_OPTIONS);

    expect(state.lobCreateCalls[0].apiKey).toBe("live_customer_key");
    expect(result.credentialSource).toBe("organization");
    expect(result.testMode).toBe(false); // live customer key = real mail
    expect(state.usageRecorded).toHaveLength(0); // their key, no platform credits
    expect(state.opexPosts).toHaveLength(0); // their Lob bill, not our COGS
  });

  it("platform key (interlock unarmed): send succeeds but is honestly testMode", async () => {
    const result = await sendPostcard(BASE_OPTIONS);

    expect(state.lobCreateCalls[0].apiKey).toBe("test_platform_key");
    expect(result.credentialSource).toBe("platform");
    expect(result.testMode).toBe(true); // NEVER present a test send as real mail
    // Platform pays → credits recorded AND COGS posted with idempotent key.
    expect(state.usageRecorded).toHaveLength(1);
    expect(state.opexPosts).toHaveLength(1);
    expect(state.opexPosts[0].externalEventId).toBe("lob:postcard:psc_123");
    expect(state.opexPosts[0].organizationId).toBe(42);
  });

  it("platform send with insufficient credits refuses BEFORE any Lob call", async () => {
    state.hasCredits = false;

    await expect(sendPostcard(BASE_OPTIONS)).rejects.toThrow(/Insufficient credits/);
    expect(state.lobCreateCalls).toHaveLength(0); // nothing printed
    expect(state.opexPosts).toHaveLength(0);
  });

  it("passes use_type to Lob (defaults to marketing)", async () => {
    await sendPostcard(BASE_OPTIONS);
    expect(state.lobCreateCalls[0].params.use_type).toBe("marketing");
  });

  it("simulation mode: no Lob client, no billing, honest testMode", async () => {
    state.simulate = true;

    const result = await sendPostcard(BASE_OPTIONS);

    expect(result.credentialSource).toBe("simulation");
    expect(result.testMode).toBe(true);
    expect(state.lobCreateCalls).toHaveLength(0);
    expect(state.usageRecorded).toHaveLength(0);
    expect(state.opexPosts).toHaveLength(0);
  });
});
