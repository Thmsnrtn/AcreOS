/**
 * Pillar 5 — Communications Router unit tests.
 *
 * We exercise the router with a hand-rolled in-memory registry so the
 * test never touches Twilio, Telnyx, or the database. The point is to
 * pin the policy: cheapest-first, fall back to next on failure, honour
 * preferredProvider override.
 */
import { describe, it, expect, vi } from "vitest";
import {
  CommsRouter,
  type CommsProvider,
  type CommsProviderName,
} from "../../server/services/comms/router";

vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async () => JSON.stringify(["twilio", "telnyx"])),
  getNumberSetting: vi.fn(async (_k: string, fallback: number) => fallback),
}));

function makeProvider(
  name: CommsProviderName,
  cost: number,
  opts: { send?: () => Promise<{ sid: string; costCents: number }>; configured?: boolean } = {},
): CommsProvider {
  return {
    name,
    isConfigured: () => opts.configured !== false,
    sendSms: opts.send ?? (async () => ({ sid: `${name}-sid`, costCents: cost })),
    initiateCall: async () => ({ sid: `${name}-call` }),
    rentNumber: async () => ({ number: `+1555${Math.floor(Math.random() * 1e7)}`, costCentsPerMonth: 115 }),
    releaseNumber: async () => {},
    webhookSignatureValid: () => true,
    estimateCostCents: () => cost,
  };
}

describe("CommsRouter", () => {
  it("quote() returns providers cheapest-first", async () => {
    const registry = new Map<CommsProviderName, CommsProvider>();
    registry.set("twilio", makeProvider("twilio", 5));
    registry.set("telnyx", makeProvider("telnyx", 2));
    const router = new CommsRouter(registry);
    const quotes = await router.quote({ kind: "sms" });
    expect(quotes.map((q) => q.provider)).toEqual(["telnyx", "twilio"]);
  });

  it("route() picks the cheapest provider", async () => {
    const sendCheap = vi.fn(async () => ({ sid: "telnyx-1", costCents: 2 }));
    const sendExpensive = vi.fn(async () => ({ sid: "twilio-1", costCents: 5 }));
    const registry = new Map<CommsProviderName, CommsProvider>();
    registry.set("twilio", makeProvider("twilio", 5, { send: sendExpensive }));
    registry.set("telnyx", makeProvider("telnyx", 2, { send: sendCheap }));
    const router = new CommsRouter(registry);
    const result = await router.route({ to: "+15551234567", body: "hi" });
    expect(result.provider).toBe("telnyx");
    expect(result.sid).toBe("telnyx-1");
    expect(sendCheap).toHaveBeenCalledOnce();
    expect(sendExpensive).not.toHaveBeenCalled();
  });

  it("route() falls back to next provider when primary throws", async () => {
    const sendCheap = vi.fn(async () => {
      const err: any = new Error("Twilio 503");
      err.status = 503;
      throw err;
    });
    const sendBackup = vi.fn(async () => ({ sid: "twilio-2", costCents: 5 }));
    const registry = new Map<CommsProviderName, CommsProvider>();
    registry.set("twilio", makeProvider("twilio", 5, { send: sendBackup }));
    registry.set("telnyx", makeProvider("telnyx", 2, { send: sendCheap }));
    const router = new CommsRouter(registry);
    const result = await router.route({ to: "+15551234567", body: "hi" });
    expect(sendCheap).toHaveBeenCalledOnce();
    expect(sendBackup).toHaveBeenCalledOnce();
    expect(result.provider).toBe("twilio");
  });

  it("route() honours preferredProvider override", async () => {
    const sendCheap = vi.fn(async () => ({ sid: "cheap", costCents: 2 }));
    const sendExpensive = vi.fn(async () => ({ sid: "twilio-forced", costCents: 5 }));
    const registry = new Map<CommsProviderName, CommsProvider>();
    registry.set("twilio", makeProvider("twilio", 5, { send: sendExpensive }));
    registry.set("telnyx", makeProvider("telnyx", 2, { send: sendCheap }));
    const router = new CommsRouter(registry);
    const result = await router.route({
      to: "+1",
      body: "x",
      preferredProvider: "twilio",
    });
    expect(result.provider).toBe("twilio");
    expect(sendCheap).not.toHaveBeenCalled();
  });

  it("route() throws when every provider fails", async () => {
    const fail = async () => {
      throw new Error("down");
    };
    const registry = new Map<CommsProviderName, CommsProvider>();
    registry.set("twilio", makeProvider("twilio", 5, { send: fail }));
    registry.set("telnyx", makeProvider("telnyx", 2, { send: fail }));
    const router = new CommsRouter(registry);
    await expect(router.route({ to: "+1", body: "x" })).rejects.toThrow();
  });

  it("quote() excludes providers that aren't configured", async () => {
    const registry = new Map<CommsProviderName, CommsProvider>();
    registry.set("twilio", makeProvider("twilio", 5));
    registry.set("telnyx", makeProvider("telnyx", 2, { configured: false }));
    const router = new CommsRouter(registry);
    const quotes = await router.quote({ kind: "sms" });
    expect(quotes.map((q) => q.provider)).toEqual(["twilio"]);
  });
});

describe("Telnyx adapter (disabled stub)", () => {
  it("throws TELNYX_NOT_CONFIGURED when env var unset", async () => {
    const prev = process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_API_KEY;
    const { telnyxProvider } = await import("../../server/services/comms/providers/telnyx");
    expect(telnyxProvider.isConfigured()).toBe(false);
    await expect(
      telnyxProvider.sendSms({ to: "+1", body: "x" }),
    ).rejects.toThrow(/TELNYX_NOT_CONFIGURED/);
    await expect(telnyxProvider.rentNumber({})).rejects.toThrow(/TELNYX_NOT_CONFIGURED/);
    await expect(telnyxProvider.initiateCall({ to: "+1" })).rejects.toThrow(
      /TELNYX_NOT_CONFIGURED/,
    );
    if (prev !== undefined) process.env.TELNYX_API_KEY = prev;
  });
});
