/**
 * A comms provider is "configured" only when it can actually send.
 *
 * ── THE DEFECT (audit 2026-10) ──────────────────────────────────────────────
 * TelnyxProvider.isConfigured() returned `!!process.env.TELNYX_API_KEY`, while
 * every method threw TELNYX_NOT_CONFIGURED. The router (comms/router.ts) reads
 * isConfigured() to decide who may carry a send and sorts by cost — Telnyx
 * quotes cheaper than Twilio — so the moment someone set the key, Telnyx would
 * have been chosen FIRST for sends it could only fail.
 *
 * The invariant pinned here is the semantic one, not the flag: with the key
 * set, either isConfigured() is false, or the methods do not throw the
 * not-configured error. Implementing the adapter (and flipping
 * TELNYX_ADAPTER_IMPLEMENTED) satisfies it; setting a key never can.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);
vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async () => JSON.stringify(["twilio", "telnyx"])),
  getNumberSetting: vi.fn(async (_k: string, fallback: number) => fallback),
}));

import { CommsRouter, type CommsProvider, type CommsProviderName } from "../../server/services/comms/router";
import { telnyxProvider } from "../../server/services/comms/providers/telnyx";

const prev = process.env.TELNYX_API_KEY;
afterEach(() => {
  if (prev === undefined) delete process.env.TELNYX_API_KEY;
  else process.env.TELNYX_API_KEY = prev;
});

async function throwsNotConfigured(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return /TELNYX_NOT_CONFIGURED/.test(String((e as Error)?.message ?? e));
  }
}

describe("Telnyx reads as available only when it can send", () => {
  it("with TELNYX_API_KEY set, a configured provider must not throw not-configured", async () => {
    process.env.TELNYX_API_KEY = "KEY0123-test";
    const configured = telnyxProvider.isConfigured();
    const stubbed = [
      await throwsNotConfigured(() => telnyxProvider.sendSms({ to: "+15555550100", body: "x" })),
      await throwsNotConfigured(() => telnyxProvider.initiateCall({ to: "+15555550100", voice: { kind: "human" } } as any)),
      await throwsNotConfigured(() => telnyxProvider.rentNumber({})),
      await throwsNotConfigured(() => telnyxProvider.releaseNumber("+15555550100")),
    ];
    // Vacuity: today every method is a stub — if this flips, the adapter
    // landed and the next assertion is what keeps it honest.
    if (stubbed.some(Boolean)) {
      expect(configured, "Telnyx reports configured while its methods throw TELNYX_NOT_CONFIGURED").toBe(false);
    }
  });

  it("the real router never quotes or routes to the stubbed adapter, key or not", async () => {
    process.env.TELNYX_API_KEY = "KEY0123-test";
    const twilio: CommsProvider = {
      name: "twilio",
      isConfigured: () => true,
      sendSms: async () => ({ sid: "tw-1", costCents: 5 }),
      initiateCall: async () => ({ sid: "tw-call" }),
      rentNumber: async () => ({ number: "+15555550101", costCentsPerMonth: 115 }),
      releaseNumber: async () => {},
      webhookSignatureValid: () => true,
      estimateCostCents: () => 5,
    };
    const registry = new Map<CommsProviderName, CommsProvider>([
      ["twilio", twilio],
      ["telnyx", telnyxProvider],
    ]);
    const router = new CommsRouter(registry);
    const quotes = await router.quote({ kind: "sms" });
    expect(quotes.map((q) => q.provider)).toEqual(["twilio"]);
  });
});
