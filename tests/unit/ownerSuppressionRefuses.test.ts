/**
 * Each outreach chokepoint REFUSES a suppressed owner before its vendor is
 * reached — behaviour, not source text. The guard module is replaced by one
 * that suppresses a fixed phone / email / address (its own semantics are
 * proven in ownerSuppressionCore.test.ts); each test then asserts the vendor
 * hook was never called. Remove the guard call from any of these chokepoints
 * and its test goes red (mutation-checked 2026-10-11).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SUPPRESSED = { phone: "4235550100", email: "owner@example.com", line1: "123 n main st", zip: "37402" };
const guardCalls: Array<{ channel: string; ids: Record<string, unknown> }> = [];

function isSuppressed(ids: { phone?: string | null; email?: string | null; addressLine1?: string | null; zip?: string | null }): boolean {
  const phone = (ids.phone ?? "").replace(/\D/g, "").slice(-10);
  const email = (ids.email ?? "").trim().toLowerCase();
  const line1 = (ids.addressLine1 ?? "").toLowerCase().replace(/[.,]/g, "").replace(/\bnorth\b/, "n").replace(/\bstreet\b/, "st");
  return phone === SUPPRESSED.phone || email === SUPPRESSED.email || (line1 === SUPPRESSED.line1 && (ids.zip ?? "").slice(0, 5) === SUPPRESSED.zip);
}

vi.mock("../../server/services/trust/ownerSuppression", async () => {
  const { ProviderNotContactedError } = await import("../../server/services/actions/outwardAction");
  class OwnerSuppressedError extends ProviderNotContactedError {
    constructor(channel: string) {
      super(`Not sent: this owner asked AcreOS to stop all contact (${channel}).`);
      this.name = "OwnerSuppressedError";
    }
  }
  return {
    OwnerSuppressedError,
    OWNER_OPTOUT_REASON: "Owner opt-out request on file with AcreOS",
    assertOwnerContactAllowed: vi.fn(async (channel: string, ids: any) => {
      guardCalls.push({ channel, ids });
      if (isSuppressed(ids)) throw new OwnerSuppressedError(channel);
    }),
    ownerContactRefusal: vi.fn(async (channel: string, ids: any) => {
      guardCalls.push({ channel, ids });
      return isSuppressed(ids) ? `Not sent: this owner asked AcreOS to stop all contact (${channel}).` : null;
    }),
    stampOwnerSuppression: vi.fn(async (rows: any[]) => {
      let suppressedCount = 0;
      const out = rows.map((r) => {
        if (!isSuppressed({ email: r.email, phone: r.phone, addressLine1: r.address, zip: r.zip })) return r;
        suppressedCount += 1;
        return { ...r, doNotContact: true, optOutReason: "Owner opt-out request on file with AcreOS" };
      });
      return { rows: out, suppressedCount };
    }),
  };
});

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/simulationMode", () => ({ shouldSimulate: () => false, recordSimulatedAction: vi.fn() }));

const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
beforeEach(() => {
  guardCalls.length = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("SMS and voice: the comms router", () => {
  it("never reaches a carrier for a suppressed number", async () => {
    const { CommsRouter } = await import("../../server/services/comms/router");
    const sendSms = vi.fn(async () => ({ sid: "SM1", costCents: 1 }));
    const initiateCall = vi.fn(async () => ({ sid: "CA1" }));
    const provider: any = { name: "twilio", isConfigured: () => true, sendSms, initiateCall, estimateCostCents: () => 1 };
    const router = new CommsRouter(new Map([["twilio", provider]]) as any);
    await expect(router.route({ to: "+1 423-555-0100", body: "hi", preferredProvider: "twilio" })).rejects.toThrow(/stop all contact/);
    expect(sendSms).not.toHaveBeenCalled();
    // …and a number that is not suppressed still goes out.
    await expect(router.route({ to: "+1 423-555-0199", body: "hi", preferredProvider: "twilio" })).resolves.toMatchObject({ sid: "SM1" });
  });

  it("never places a call to a suppressed number", async () => {
    const { CommsRouter } = await import("../../server/services/comms/router");
    const initiateCall = vi.fn(async () => ({ sid: "CA1" }));
    const provider: any = { name: "twilio", isConfigured: () => true, sendSms: vi.fn(), initiateCall, estimateCostCents: () => 1 };
    const router = new CommsRouter(new Map([["twilio", provider]]) as any);
    await expect(router.initiateCall({ to: "4235550100", voice: { kind: "human" }, preferredProvider: "twilio" })).rejects.toThrow(/stop all contact/);
    expect(initiateCall).not.toHaveBeenCalled();
  });
});

describe("physical mail", () => {
  it("directMailService.sendPostcard refuses before Lob, credits or simulation", async () => {
    const mod = await import("../../server/services/directMailService");
    const err = await mod
      .sendPostcard({
        organizationId: 1,
        senderIdentity: {} as any,
        recipientName: "Jane Owner",
        recipientAddress: { line1: "123 North Main Street", city: "Chattanooga", state: "TN", zip: "37402" },
        frontHtml: "<p/>",
        backHtml: "<p/>",
      } as any)
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("OwnerSuppressedError");
    expect(guardCalls.some((c) => c.channel === "mail")).toBe(true);
  });

  it("PostGrid refuses the whole shipment before the first piece is sent", async () => {
    process.env.POSTGRID_API_KEY = "test_pg_key";
    const { postgridAdapter } = await import("../../server/services/mail/providers/postgrid");
    const err = await postgridAdapter
      .send({
        customerId: 1,
        organizationId: 1,
        speed: "standard",
        personalizationRequired: false,
        pieces: [
          { recipient: { address1: "9 Oak Ave", city: "X", state: "TN", zip: "37402" }, pieceType: "postcard_4x6" },
          { recipient: { address1: "123 N. Main St", city: "X", state: "TN", zip: "37402" }, pieceType: "postcard_4x6" },
        ],
      } as any)
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("OwnerSuppressedError");
    expect(fetchSpy).not.toHaveBeenCalled();
    delete process.env.POSTGRID_API_KEY;
  });
});

describe("email: the org's own mailbox", () => {
  it("sendMessage refuses before a token is fetched", async () => {
    const tokenSpy = vi.fn(async () => "tok");
    vi.doMock("../../server/services/mailbox/clerkMailbox", () => ({ getMailboxAccessToken: tokenSpy }));
    const { sendMessage } = await import("../../server/services/mailbox/mailboxClient");
    const err = await sendMessage({ userId: "u", provider: "gmail", emailAddress: "me@org.com" } as any, { to: "Owner@Example.com", subject: "s", body: "b" }).catch(
      (e: unknown) => e,
    );
    expect((err as Error).name).toBe("OwnerSuppressedError");
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("skip-trace", () => {
  it("trace() says plainly the owner opted out, and calls no vendor", async () => {
    process.env.BATCH_SKIP_TRACING_API_KEY = "k";
    const { skipTracingService } = await import("../../server/services/skipTracingService");
    const r = await skipTracingService.trace({ firstName: "Jane", lastName: "Owner", address: "123 North Main Street", zip: "37402" }, 1, { ledgerId: 1, surface: "skip_trace_call", organizationId: 1 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/stop all contact/);
    expect(fetchSpy).not.toHaveBeenCalled();
    delete process.env.BATCH_SKIP_TRACING_API_KEY;
  });
});
