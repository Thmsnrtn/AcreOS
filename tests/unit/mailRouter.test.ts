/**
 * Pillar 2 — MailRouter unit tests.
 *
 * Strategy: don't load the real provider adapters at all — they pull in
 * the DB, simulationMode, storage, the Lob SDK, etc. Instead we use the
 * test-only __setMailRouterRegistry hook to swap in pure in-memory
 * adapters, then exercise the router's selection + fallback logic.
 *
 * Coverage:
 *   1. picks the cheapest viable provider (postgrid beats lob)
 *   2. falls through to the next-cheapest viable provider on send failure
 *   3. PostGrid throws when POSTGRID_API_KEY is unset (verified against
 *      the real adapter — env-gated isConfigured)
 *   4. EDDM/presort/lettrlabs return meetsConstraints=false
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async () => null), // default → ["lob"], but tests override via registry
}));

import {
  MailRouter,
  __resetMailRouterRegistry,
  __setMailRouterRegistry,
  type MailProvider,
  type MailShipment,
  type ProviderQuote,
  type ProviderSendResult,
} from "../../server/services/mail/router";
import { getSetting } from "../../server/services/founderSettings";

function makeAdapter(opts: {
  name: MailProvider["name"];
  costPerPieceCents: number;
  configured?: boolean;
  meetsConstraints?: boolean;
  minVolume?: number;
  sendImpl?: (s: MailShipment) => Promise<ProviderSendResult>;
}): MailProvider {
  return {
    name: opts.name,
    isConfigured: () => opts.configured ?? true,
    async quote(_s: MailShipment): Promise<ProviderQuote> {
      return {
        provider: opts.name,
        costPerPieceCents: opts.costPerPieceCents,
        deliveryEtaDays: 5,
        minVolume: opts.minVolume ?? 1,
        meetsConstraints: opts.meetsConstraints ?? true,
        reasonIfNot: (opts.meetsConstraints ?? true) ? undefined : "test disabled",
      };
    },
    async send(s: MailShipment): Promise<ProviderSendResult> {
      if (opts.sendImpl) return opts.sendImpl(s);
      return {
        provider: opts.name,
        providerEventId: `${opts.name}_shipment_1`,
        pieces: s.pieces.map((_, i) => ({ providerPieceId: `${opts.name}_p${i}`, recipientRef: `${s.customerId}` })),
        totalCostCents: opts.costPerPieceCents * s.pieces.length,
      };
    },
  };
}

function shipment(overrides: Partial<MailShipment> = {}): MailShipment {
  return {
    customerId: 1,
    organizationId: 42,
    pieces: [
      {
        recipient: { firstName: "Pat", lastName: "Land", address1: "1 Acre Rd", city: "Austin", state: "TX", zip: "78701" },
        pieceType: "postcard_4x6",
      },
    ],
    speed: "standard",
    personalizationRequired: false,
    ...overrides,
  };
}

beforeEach(() => {
  __resetMailRouterRegistry();
  vi.mocked(getSetting).mockResolvedValue(JSON.stringify(["lob", "postgrid", "eddm", "presort", "lettrlabs"]));
});

describe("MailRouter.route", () => {
  it("selects the cheapest viable provider (postgrid over lob)", async () => {
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({ name: "postgrid", costPerPieceCents: 55 }),
    ]);

    const router = new MailRouter();
    const result = await router.route(shipment());

    expect(result.chosenProvider).toBe("postgrid");
    expect(result.result.totalCostCents).toBe(55);
    // Saving = lob baseline (75) - postgrid actual (55) = 20¢ on a 1-piece shipment
    expect(result.savedVsLobCents).toBe(20);
  });

  it("falls back to next-cheapest viable when primary send fails", async () => {
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({
        name: "postgrid",
        costPerPieceCents: 55,
        sendImpl: async () => {
          throw new Error("postgrid 503");
        },
      }),
    ]);

    const router = new MailRouter();
    const result = await router.route(shipment());

    expect(result.chosenProvider).toBe("lob");
    expect(result.result.totalCostCents).toBe(75);
    // No savings — Lob baseline equals actual cost.
    expect(result.savedVsLobCents).toBe(0);
  });

  it("filters out providers below min volume", async () => {
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({ name: "presort", costPerPieceCents: 30, minVolume: 500 }),
    ]);

    const router = new MailRouter();
    const result = await router.route(shipment()); // 1 piece — below presort's 500

    expect(result.chosenProvider).toBe("lob");
  });

  it("respects per-piece budget", async () => {
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({ name: "postgrid", costPerPieceCents: 55 }),
    ]);

    const router = new MailRouter();
    const result = await router.route(shipment({ budgetCentsPerPiece: 60 }));

    // Only postgrid (55) is within the 60¢ budget; lob (75) is excluded.
    expect(result.chosenProvider).toBe("postgrid");
  });

  it("throws when no viable provider matches constraints", async () => {
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({ name: "postgrid", costPerPieceCents: 55 }),
    ]);

    const router = new MailRouter();
    await expect(router.route(shipment({ budgetCentsPerPiece: 10 }))).rejects.toThrow(/no viable provider/i);
  });

  it("throws when no providers are configured at all", async () => {
    __setMailRouterRegistry([makeAdapter({ name: "lob", costPerPieceCents: 75, configured: false })]);

    const router = new MailRouter();
    await expect(router.route(shipment())).rejects.toThrow(/no providers available/i);
  });
});

describe("MailRouter.quote", () => {
  it("returns one quote per enabled+configured provider", async () => {
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({ name: "postgrid", costPerPieceCents: 55 }),
      makeAdapter({ name: "eddm", costPerPieceCents: 17, configured: false }),
    ]);

    const router = new MailRouter();
    const quotes = await router.quote(shipment());

    // eddm is not configured → silently skipped
    expect(quotes.map((q) => q.provider).sort()).toEqual(["lob", "postgrid"]);
  });

  it("honors mail.providers.enabled override (only lob enabled today)", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(JSON.stringify(["lob"]));
    __setMailRouterRegistry([
      makeAdapter({ name: "lob", costPerPieceCents: 75 }),
      makeAdapter({ name: "postgrid", costPerPieceCents: 55 }),
    ]);

    const router = new MailRouter();
    const quotes = await router.quote(shipment());

    expect(quotes.map((q) => q.provider)).toEqual(["lob"]);
  });
});

describe("PostGrid adapter (real, env-gated)", () => {
  it("isConfigured() returns false when POSTGRID_API_KEY is unset", async () => {
    const prev = process.env.POSTGRID_API_KEY;
    delete process.env.POSTGRID_API_KEY;
    try {
      const { postgridAdapter } = await import("../../server/services/mail/providers/postgrid");
      expect(postgridAdapter.isConfigured()).toBe(false);
      await expect(postgridAdapter.send(shipment())).rejects.toThrow(/POSTGRID_API_KEY/i);
    } finally {
      if (prev !== undefined) process.env.POSTGRID_API_KEY = prev;
    }
  });
});

describe("Disabled stubs (EDDM, presort, lettrlabs)", () => {
  it("EDDM returns meetsConstraints=false with revenue-trigger reason", async () => {
    const { eddmAdapter } = await import("../../server/services/mail/providers/eddm");
    expect(eddmAdapter.isConfigured()).toBe(false);
    const q = await eddmAdapter.quote(shipment());
    expect(q.meetsConstraints).toBe(false);
    expect(q.reasonIfNot).toMatch(/revenue trigger/i);
    await expect(eddmAdapter.send(shipment())).rejects.toThrow(/not activated/i);
  });

  it("presort returns meetsConstraints=false", async () => {
    const { presortAdapter } = await import("../../server/services/mail/providers/presort");
    expect(presortAdapter.isConfigured()).toBe(false);
    const q = await presortAdapter.quote(shipment());
    expect(q.meetsConstraints).toBe(false);
    expect(q.reasonIfNot).toMatch(/revenue trigger/i);
    await expect(presortAdapter.send(shipment())).rejects.toThrow(/not activated/i);
  });

  it("lettrlabs returns meetsConstraints=false", async () => {
    const { lettrlabsAdapter } = await import("../../server/services/mail/providers/lettrlabs");
    expect(lettrlabsAdapter.isConfigured()).toBe(false);
    const q = await lettrlabsAdapter.quote(shipment());
    expect(q.meetsConstraints).toBe(false);
    expect(q.reasonIfNot).toMatch(/revenue trigger/i);
    await expect(lettrlabsAdapter.send(shipment())).rejects.toThrow(/not activated/i);
  });
});
