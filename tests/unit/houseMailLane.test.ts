/**
 * The physical-mail lane rule (founder decision 2026-10-17,
 * docs/company/founder-decisions-2026-10-17.md), driven through the real send
 * chokepoints with only their collaborators faked:
 *
 *   - own Lob key  → the org's key prints the piece; NO credit charge; the
 *                    platform key is never even resolved.
 *   - house mail   → AcreOS's Lob account, PRE-PAID for exactly ONE piece
 *                    from PURCHASED credits (chargeHouseMail — never the
 *                    credit pool) at the canonical house price, and only
 *                    under the org's own VERIFIED sender identity, which is
 *                    the return address printed.
 *   - neither      → refused before any charge or provider call.
 *   - refunds      → only for a piece Lob certainly did not bill (rejected,
 *                    or never reached); a timeout / 5xx keeps the charge.
 *
 * Covered surfaces: directMailService (router-sent pieces: outreach queue,
 * sequences), directMail.ts (campaign sends), mailProvider (autopilot
 * send_letter), lobService, and verifyAddress. Email and SMS are not touched
 * by any of this — emailPurposeEnforcement.test.ts keeps email BYO-only, and
 * the last block pins that the lane module never decides an email/SMS send.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CREDIT_WEIGHTS } from "@shared/billing/credit-weights";
import { financialLedger, organizations, creditTransactions } from "@shared/schema";
import { stripComments } from "../helpers/stripComments";
import { fakeSafeFetch } from "../helpers/fakeSafeFetch";

// The campaign class builds its env clients at import; give it a sandbox key.
vi.hoisted(() => {
  process.env.LOB_TEST_API_KEY = "test_env_key";
  process.env.LOB_LIVE_API_KEY = "live_env_key";
});

vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);

type Identity = {
  id: number;
  organizationId: number;
  name: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  status: string;
  isActive: boolean;
  isDefault: boolean;
};

const ORG = 42;

function identity(over: Partial<Identity> = {}): Identity {
  return {
    id: 7,
    organizationId: ORG,
    name: "Main office",
    companyName: "Brazos Land Partners",
    addressLine1: "1 Main St",
    addressLine2: null,
    city: "Austin",
    state: "TX",
    zipCode: "78701",
    country: "US",
    status: "verified",
    isActive: true,
    isDefault: true,
    ...over,
  };
}

const state = {
  ownLobKey: null as string | null,
  identity: identity() as Identity | null,
  /** Purchased credits the fake balance can pay (grants are the realdb test's job). */
  purchased: 10_000,
  platformResolves: 0,
  /** Every house charge taken: the ledger claim + the balance debit. */
  charges: [] as Array<{ externalEventId: string; credits: number; organizationId: number }>,
  /** Any draw on the monthly credit pool — house mail must never make one. */
  poolDebits: [] as Array<{ action: string; units: number }>,
  refunds: [] as Array<{ originalEventId: string; amountCents: number; refundKey?: string }>,
  lobCalls: [] as Array<{ kind: string; apiKey: string; params: any }>,
  /** A Lob failure to throw: an error object carrying a status, or a plain Error. */
  lobError: null as unknown,
  creditOverride: null as number | null,
  platformMissing: false,
  /** The live-send interlock (house mail requires it armed with a live key). */
  armed: true,
  /** founder_settings rows (unset unless a test sets one). */
  settings: {} as Record<string, number>,
  renders: 0,
  lastRendered: null as Buffer | null,
  /** Trailing bytes the renderer mock appends (a large render). */
  padBytes: 0,
  /** The platform key reports live whatever the interlock says (misconfiguration). */
  keyClaimsLive: false,
};

/** HTML that the renderer mock lays out as exactly `n` pages. */
function htmlOfPages(n: number): string {
  return `<html><body data-pages="${n}">Dear owner</body></html>`;
}

/** A letter whose length can be confirmed: a PDF on an https URL (served by the fetch stub). */
const PDF_URL = "https://files.example.com/letter.pdf";

/**
 * A fake transaction that answers the three statements chargeHouseMail runs:
 * the ledger claim (unique on externalEventId), the conditional balance
 * UPDATE (only when purchased credits cover it), and the debit row.
 */
function fakeTx() {
  const claimed = new Map<string, number>();
  return {
    insert(table: unknown) {
      return {
        values(v: any) {
          if (table === creditTransactions) return Promise.resolve([]);
          if (table !== financialLedger) throw new Error("unexpected insert");
          const chain = {
            onConflictDoNothing: () => chain,
            returning: async () => {
              if (claimed.has(v.externalEventId) || state.charges.some((c) => c.externalEventId === v.externalEventId)) return [];
              claimed.set(v.externalEventId, -v.amountCents);
              pending = { externalEventId: v.externalEventId, credits: -v.amountCents, organizationId: v.organizationId };
              return [{ id: 1 }];
            },
          };
          return chain;
        },
      };
    },
    select() {
      const chain: any = { from: () => chain, where: () => chain, limit: async () => [] };
      return chain;
    },
    update(table: unknown) {
      if (table !== organizations) throw new Error("unexpected update");
      const chain: any = {
        set: () => chain,
        where: () => chain,
        returning: async () => {
          if (!pending || state.purchased < pending.credits) return [];
          state.purchased -= pending.credits;
          state.charges.push(pending);
          pending = null;
          return [{ newBalance: state.purchased }];
        },
      };
      return chain;
    },
  };
}
let pending: { externalEventId: string; credits: number; organizationId: number } | null = null;

vi.mock("lob", () => ({
  default: class MockLob {
    apiKey: string;
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
    postcards = {
      create: async (params: any) => {
        state.lobCalls.push({ kind: "postcard", apiKey: this.apiKey, params });
        if (state.lobError) throw state.lobError;
        return { id: "psc_1", url: "", expected_delivery_date: "2026-10-30" };
      },
    };
    letters = {
      create: async (params: any) => {
        state.lobCalls.push({ kind: "letter", apiKey: this.apiKey, params });
        if (state.lobError) throw state.lobError;
        return { id: "ltr_1", url: "", expected_delivery_date: "2026-10-30" };
      },
    };
    usVerifications = {
      verify: async (params: any) => {
        state.lobCalls.push({ kind: "verify", apiKey: this.apiKey, params });
        return { deliverability: "deliverable", components: {}, id: "adr_1" };
      },
    };
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async (args: { channel: string }) => (args.channel === "lob" ? state.ownLobKey : null),
}));
vi.mock("../../server/services/byok/toggle", () => ({ isByokEnabled: async () => state.ownLobKey !== null }));
vi.mock("../../server/services/financial-ledger", () => ({ postOpexSpent: async () => undefined }));
vi.mock("../../server/services/outreachStopLoss", () => ({ assertOutreachNotPaused: async () => undefined }));
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
    state.platformResolves++;
    if (state.platformMissing) throw new Error("Lob test key not configured.");
    // Models the real interlock: armed → the live key; disarmed → test key only.
    if (state.keyClaimsLive) return { apiKey: "live_platform_key", isTestKey: false };
    return state.armed ? { apiKey: "live_platform_key", isTestKey: false } : { apiKey: "live_platform_key", isTestKey: true };
  },
  isLiveSendArmed: () => state.armed,
}));

vi.mock("../../server/services/creditCost", () => ({
  creditCost: async (action: keyof typeof CREDIT_WEIGHTS) => state.creditOverride ?? CREDIT_WEIGHTS[action],
}));

vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async (args: { action: string; units: number }) => {
    state.poolDebits.push({ action: args.action, units: args.units });
    return { allowed: true, debitedCents: 75, remaining: 100, poolMonthly: 750, ledgerRowId: 1, overPool: false };
  },
  refundPoolDebit: async (args: { originalEventId: string; amountCents: number; refundKey?: string }) => {
    state.refunds.push({ originalEventId: args.originalEventId, amountCents: args.amountCents, refundKey: args.refundKey });
  },
}));
vi.mock("../../server/services/credits", () => ({ creditService: { afterDebitCommitted: () => undefined } }));
// PDF fetches keep the real address checks but serve a fixture PDF (no network).
vi.mock("../../server/services/mail/safeFetch", async () => (await import("../helpers/fakeSafeFetch")).fakeSafeFetchModule());
// The renderer is faked here (real Chromium: houseLetterRenderReal.test.ts):
// it returns a real PDF of the page count the HTML asks for, or fails.
vi.mock("../../server/services/mail/letterRender", () => ({
  renderLetterHtmlToPdf: async (html: string) => {
    state.renders++;
    if (html.includes("RENDER_FAIL")) throw new Error("chromium crashed");
    const n = Number(/data-pages="(\d+)"/.exec(html)?.[1] ?? 1);
    const { makePdf } = await import("../helpers/pdfFixture");
    const pdf = await makePdf(n);
    state.lastRendered = state.padBytes ? Buffer.concat([pdf, Buffer.alloc(state.padBytes, 0x20)]) : pdf;
    return state.lastRendered;
  },
}));
vi.mock("../../server/services/settings", () => ({ getSetting: async (k: string, fallback: unknown) => state.settings[k] ?? fallback }));

// The outward-action boundary needs a database; letters in this file carry no
// idempotency key, so it is never entered. Its error type is real. The house
// charge runs in withTransaction against the fake transaction above.
vi.mock("../../server/db", () => ({ db: {}, withTransaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx()) }));

import * as dms from "../../server/services/directMailService";
import {
  resolveMailLane,
  resolveAddressCheckLane,
  postcardSpec,
  letterSpec,
  providerDidNotBill,
  letterRenderCacheBytes,
} from "../../server/services/mail/mailLane";

/** Lob's own error shape for a rejected request (lob/lib/resources/resourceBase.js). */
function lobRejection(status: number, message = "rejected"): Error {
  return Object.assign(new Error(message), { status_code: status });
}

const TO = { line1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };

function postcard(over: Record<string, unknown> = {}) {
  return dms.sendPostcard({
    organizationId: ORG,
    senderIdentity: state.identity as any,
    recipientName: "Lee Owner",
    recipientAddress: TO,
    frontHtml: "<p>front</p>",
    backHtml: "<p>back</p>",
    ...over,
  } as any);
}

function letter(over: Record<string, unknown> = {}) {
  return dms.sendLetter({
    organizationId: ORG,
    senderIdentity: state.identity as any,
    recipientName: "Lee Owner",
    recipientAddress: TO,
    htmlContent: PDF_URL,
    ...over,
  } as any);
}

beforeEach(() => {
  state.ownLobKey = null;
  state.identity = identity();
  state.purchased = 10_000;
  state.platformResolves = 0;
  state.charges = [];
  state.poolDebits = [];
  state.refunds = [];
  state.lobCalls = [];
  state.lobError = null;
  state.creditOverride = null;
  state.settings = {};
  state.renders = 0;
  state.padBytes = 0;
  state.keyClaimsLive = false;
  state.lastRendered = null;
  fakeSafeFetch.reset();
  state.armed = true;
  state.platformMissing = false;
  pending = null;
});

const charged = () => state.charges.map((c) => c.credits);

describe("house lane — AcreOS's Lob account, purchased credits, verified identity", () => {
  it("a 4x6 postcard is pre-paid ONE piece from purchased credits (75) and prints on the platform key", async () => {
    const result = await postcard();

    expect(charged()).toEqual([75]);
    expect(state.purchased).toBe(10_000 - 75);
    expect(state.poolDebits).toEqual([]); // never the monthly pool
    expect(state.lobCalls).toHaveLength(1);
    expect(state.lobCalls[0].apiKey).toBe("live_platform_key");
    expect(result.credentialSource).toBe("platform");
  });

  it("the charge is taken BEFORE Lob is called", async () => {
    let chargesWhenLobCalled = -1;
    state.lobError = null;
    const origPush = state.lobCalls.push.bind(state.lobCalls);
    state.lobCalls.push = (...items: any[]) => {
      chargesWhenLobCalled = state.charges.length;
      return origPush(...items);
    };
    await letter();
    expect(chargesWhenLobCalled).toBe(1);
  });

  it("a letter is pre-paid at the letter price (120)", async () => {
    await letter();
    expect(charged()).toEqual([120]);
    expect(state.lobCalls[0].kind).toBe("letter");
  });

  it("a 6x11 postcard is charged the self-funding minimum (101 at Lob's 130¢ list price), not the 75 weight", async () => {
    await postcard({ size: "6x11" });
    expect(charged()).toEqual([101]);
  });

  it("house prices come from the weights, raised to the floor; founder overrides of the weight included", async () => {
    const p = await resolveMailLane(ORG, postcardSpec("4x6"));
    const l = await resolveMailLane(ORG, letterSpec({ pages: 1 }));
    expect(p).toMatchObject({ lane: "house", creditsPerPiece: CREDIT_WEIGHTS.postcard_lob });
    expect(l).toMatchObject({ lane: "house", creditsPerPiece: CREDIT_WEIGHTS.letter_lob });

    state.creditOverride = 99;
    expect(await resolveMailLane(ORG, postcardSpec("4x6"))).toMatchObject({ creditsPerPiece: 99 });
    // An override BELOW the cost is lifted to the self-funding minimum.
    state.creditOverride = 10;
    expect(await resolveMailLane(ORG, postcardSpec("6x9"))).toMatchObject({ creditsPerPiece: 81 });
  });

  it("the return address printed is the org's verified identity", async () => {
    await postcard();
    expect(state.lobCalls[0].params.from).toMatchObject({
      name: "Brazos Land Partners",
      address_line1: "1 Main St",
      address_city: "Austin",
      address_zip: "78701",
    });
  });

  it("an UNVERIFIED identity is refused: no charge, no Lob call, no platform key", async () => {
    state.identity = identity({ status: "pending_verification" });
    const err = await postcard().catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("ProviderNotContactedError");
    expect((err as Error).message).toMatch(/verified return address/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
    expect(state.platformResolves).toBe(0);
  });

  it("an identity belonging to ANOTHER org is refused", async () => {
    state.identity = identity({ organizationId: 9 });
    await expect(letter()).rejects.toThrow(/verified return address/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("an inactive identity is refused", async () => {
    state.identity = identity({ isActive: false });
    await expect(postcard()).rejects.toThrow(/verified return address/);
    expect(state.lobCalls).toEqual([]);
  });

  it("no identity at all is refused", async () => {
    state.identity = null;
    const err = await dms
      .sendPostcard({ organizationId: ORG, senderIdentity: null as any, recipientName: "x", recipientAddress: TO, frontHtml: "a", backHtml: "b" })
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/return address/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("purchased credits short: refused before Lob, names both ways forward, and the pool is NOT tapped", async () => {
    state.purchased = 74;
    const err = await postcard().catch((e: unknown) => e as Error);
    expect((err as Error).name).toBe("ProviderNotContactedError");
    expect((err as Error).message).toMatch(/purchased credits only/);
    expect((err as Error).message).toMatch(/Buy credits/);
    expect((err as Error).message).toMatch(/your own Lob key/);
    expect(state.lobCalls).toEqual([]);
    expect(state.charges).toEqual([]);
    expect(state.poolDebits).toEqual([]);
  });

  it("an unpriced spec (a 5x7 postcard) is refused — never guessed — before any charge", async () => {
    const err = await postcard({ size: "5x7" }).catch((e: unknown) => e as Error);
    expect((err as Error).name).toBe("ProviderNotContactedError");
    expect((err as Error).message).toMatch(/no recorded price/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("a piece Lob REJECTED (4xx) is refunded its charge", async () => {
    state.lobError = lobRejection(422, "address invalid");
    await expect(postcard()).rejects.toThrow(/Failed to send postcard/);
    expect(charged()).toEqual([75]);
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0].amountCents).toBe(75);
    expect(state.refunds[0].originalEventId).toBe(state.charges[0].externalEventId);
  });

  it("a piece whose outcome is UNKNOWN (5xx, timeout, network) is NOT refunded — Lob may have billed it", async () => {
    for (const e of [lobRejection(500, "lob 500"), new Error("ETIMEDOUT"), Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })]) {
      state.lobError = e;
      state.refunds = [];
      await expect(letter()).rejects.toThrow(/Failed to send letter/);
      expect(state.refunds, (e as Error).message).toEqual([]);
    }
    expect(state.charges).toHaveLength(3);
  });

  it("the thrown send error carries the billing verdict the queue's refund reads", async () => {
    state.lobError = lobRejection(400);
    const rejected = await letter().catch((e: unknown) => e);
    expect(providerDidNotBill(rejected)).toBe(true);
    state.lobError = lobRejection(503);
    const unknown = await letter().catch((e: unknown) => e);
    expect(providerDidNotBill(unknown)).toBe(false);
  });

  it("a prepaid piece (outreach queue) is not charged again — but still needs the verified identity", async () => {
    await postcard({ housePrepaid: true });
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toHaveLength(1);

    state.lobCalls = [];
    state.identity = identity({ status: "failed" });
    await expect(postcard({ housePrepaid: true })).rejects.toThrow(/verified return address/);
    expect(state.lobCalls).toEqual([]);
  });
});

describe("own-key lane — the org's own Lob account, no credits, platform key untouched", () => {
  it("prints on the org's key, charges nothing, never resolves the platform key", async () => {
    state.ownLobKey = "live_org_key";
    const result = await postcard();

    expect(state.lobCalls[0].apiKey).toBe("live_org_key");
    expect(result.credentialSource).toBe("organization");
    expect(state.charges).toEqual([]);
    expect(state.poolDebits).toEqual([]);
    expect(state.platformResolves).toBe(0);
  });

  it("does not require the house identity gate or a priced spec (BYO behaviour unchanged)", async () => {
    state.ownLobKey = "test_org_key";
    state.identity = identity({ status: "draft" });
    await letter();
    await postcard({ size: "5x7" });
    expect(state.lobCalls.map((c) => c.apiKey)).toEqual(["test_org_key", "test_org_key"]);
    expect(state.charges).toEqual([]);
  });

  it("address verification runs on the org's own key, not AcreOS's", async () => {
    state.ownLobKey = "live_org_key";
    const r = await dms.verifyAddress(TO, ORG, { purpose: "lead_address", lane: { lane: "own_account" } });
    expect(r.isValid).toBe(true);
    expect(state.lobCalls.map((c) => [c.kind, c.apiKey])).toEqual([["verify", "live_org_key"]]);
    expect(state.platformResolves).toBe(0);
  });

  it("an org with no own key checks its RETURN address free on AcreOS's account (vacuity for the case above)", async () => {
    await dms.verifyAddress(TO, ORG, { purpose: "sender_identity" });
    expect(state.lobCalls[0].apiKey).toBe("live_platform_key");
  });
});

describe("the other send chokepoints follow the same lane", () => {
  it("campaign class (directMail.ts): house piece carries the verified identity and is pre-paid unless prepaid", async () => {
    const { directMailService } = await import("../../server/services/directMail");
    const from = { name: "Typed Name", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };
    const to = { name: "Lee", addressLine1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };

    await directMailService.sendPostcard({ size: "6x9", front: "a", back: "b", to, from }, "live", ORG);
    expect(charged()).toEqual([81]); // Lob's 104¢ list price lifts the 75 weight to the floor
    expect(state.lobCalls[0].params.from).toMatchObject({ name: "Brazos Land Partners", address_line1: "1 Main St" });

    state.charges = [];
    await directMailService.sendLetter({ file: PDF_URL, to, from, housePrepaid: true }, "live", ORG);
    expect(state.charges).toEqual([]);

    // A caller's pageCount is a claim, not a confirmation: the HTML is
    // rendered and its REAL page count decides (the caller declared 1; the
    // render is 3 pages, and 3 pages is what Lob is sent).
    state.lobCalls = [];
    state.charges = [];
    await directMailService.sendLetter({ file: htmlOfPages(3), to, from, pageCount: 1 }, "live", ORG);
    expect(charged()).toEqual([120]); // 107 + 2 × 11 = 129¢ → minimum 101; the 120 listing stands
    expect(state.lobCalls[0].params.file.value.equals(state.lastRendered)).toBe(true);
    state.lobCalls = [];

    state.identity = identity({ status: "pending_verification" });
    await expect(directMailService.sendLetter({ file: PDF_URL, to, from }, "live", ORG)).rejects.toThrow(/verified return address/);
    expect(state.lobCalls).toEqual([]);
  });

  it("campaign class: a rejected piece is refunded, an unknown outcome is not", async () => {
    const { directMailService } = await import("../../server/services/directMail");
    const a = { name: "A", addressLine1: "1 A St", city: "X", state: "TX", zip: "1" };
    state.lobError = lobRejection(422);
    await expect(directMailService.sendPostcard({ size: "4x6", front: "a", back: "b", to: a, from: a }, "live", ORG)).rejects.toThrow();
    expect(state.refunds).toHaveLength(1);
    state.lobError = lobRejection(502);
    await expect(directMailService.sendPostcard({ size: "4x6", front: "a", back: "b", to: a, from: a }, "live", ORG)).rejects.toThrow();
    expect(state.refunds).toHaveLength(1);
  });

  it("campaign class: a TEST-mode house send goes to Lob's test environment and is never charged", async () => {
    const { directMailService } = await import("../../server/services/directMail");
    const a = { name: "A", addressLine1: "1 A St", city: "X", state: "TX", zip: "1" };
    const r = await directMailService.sendPostcard({ size: "4x6", front: "a", back: "b", to: a, from: a }, "test", ORG);
    expect(r.isTestMode).toBe(true);
    expect(state.lobCalls[0].apiKey).toBe("test_env_key");
    expect(state.charges).toEqual([]);
  });

  it("campaign class: an org-less send is refused instead of using AcreOS's account", async () => {
    const { directMailService } = await import("../../server/services/directMail");
    const a = { name: "A", addressLine1: "1 A St", city: "X", state: "TX", zip: "1" };
    await expect(directMailService.sendPostcard({ size: "4x6", front: "a", back: "b", to: a, from: a }, "test")).rejects.toThrow(/requires an organization/);
    expect(state.lobCalls).toEqual([]);
  });

  it("campaign class: own key charges nothing and never resolves the platform key", async () => {
    state.ownLobKey = "live_org_key";
    const { directMailService } = await import("../../server/services/directMail");
    const a = { name: "A", addressLine1: "1 A St", city: "X", state: "TX", zip: "1" };
    await directMailService.sendLetter({ file: PDF_URL, to: a, from: a }, "live", ORG);
    expect(state.lobCalls[0].apiKey).toBe("live_org_key");
    expect(state.charges).toEqual([]);
    expect(state.platformResolves).toBe(0);
  });

  it("autopilot send_letter (mailProvider): house pre-pays the letter and replaces the typed return address", async () => {
    const { sendLetter } = await import("../../server/services/mailProvider");
    const typed = { name: "Someone Else", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };
    const result = await sendLetter({ to: typed, from: typed, file: PDF_URL, organizationId: ORG });

    expect(result.success).toBe(true);
    expect(charged()).toEqual([120]);
    expect(state.lobCalls[0].params.from).toMatchObject({ name: "Brazos Land Partners", address_line1: "1 Main St" });
    // The PDF fetched and counted is the PDF Lob prints (never the URL again).
    expect(Buffer.isBuffer(state.lobCalls[0].params.file?.value)).toBe(true);

    // Rejected → refunded; unknown → kept.
    state.lobError = lobRejection(403);
    expect((await sendLetter({ to: typed, from: typed, file: PDF_URL, organizationId: ORG })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
    state.lobError = lobRejection(500);
    expect((await sendLetter({ to: typed, from: typed, file: PDF_URL, organizationId: ORG })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
    state.lobError = null;

    state.identity = null;
    state.lobCalls = [];
    const refused = await sendLetter({ to: typed, from: typed, file: PDF_URL, organizationId: ORG });
    expect(refused.success).toBe(false);
    expect(state.lobCalls).toEqual([]);
  });

  it("lobService live counterparty send: own key → no charge; house → pre-paid + verified identity", async () => {
    const { lobService } = await import("../../server/services/lobService");
    const a = { name: "Typed", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };

    state.ownLobKey = "live_org_key";
    const own = await lobService.sendLetter({ to: a, from: a, file: PDF_URL }, "live", { organizationId: ORG, purpose: "counterparty" });
    expect(own.success).toBe(true);
    expect(state.lobCalls[0].apiKey).toBe("live_org_key");
    expect(state.charges).toEqual([]);
    expect(state.platformResolves).toBe(0);

    state.ownLobKey = null;
    state.lobCalls = [];
    const house = await lobService.sendLetter({ to: a, from: a, file: PDF_URL }, "live", { organizationId: ORG, purpose: "counterparty" });
    expect(house.success).toBe(true);
    expect(charged()).toEqual([120]);
    expect(state.lobCalls[0].params.from.name).toBe("Brazos Land Partners");
    expect(Buffer.isBuffer(state.lobCalls[0].params.file?.value)).toBe(true);

    state.lobError = lobRejection(429);
    expect((await lobService.sendLetter({ to: a, from: a, file: PDF_URL }, "live", { organizationId: ORG, purpose: "counterparty" })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
    state.lobError = lobRejection(500);
    expect((await lobService.sendLetter({ to: a, from: a, file: PDF_URL }, "live", { organizationId: ORG, purpose: "counterparty" })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
  });
});

describe("house mail never charges for a piece that will not print (audit 2026-10-18)", () => {
  it("interlock DISARMED: no house lane — refused, no charge, no Lob call", async () => {
    state.armed = false;
    expect(await resolveMailLane(ORG, postcardSpec("4x6"))).toMatchObject({ lane: "refused", reason: "house_mail_unavailable" });
    await expect(postcard()).rejects.toThrow(/not available on this deployment/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("disarmed: autopilot (mailProvider) and lobService refuse too — nothing charged", async () => {
    state.armed = false;
    const { sendLetter } = await import("../../server/services/mailProvider");
    const typed = { name: "X", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };
    expect((await sendLetter({ to: typed, from: typed, file: PDF_URL, organizationId: ORG })).success).toBe(false);
    const { lobService } = await import("../../server/services/lobService");
    expect((await lobService.sendLetter({ to: typed, from: typed, file: PDF_URL }, "live", { organizationId: ORG, purpose: "counterparty" })).success).toBe(false);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("DISARMED is refused even when the platform key reports live — both conditions are required", async () => {
    state.armed = false;
    state.keyClaimsLive = true;
    expect(await resolveMailLane(ORG, postcardSpec("4x6"))).toMatchObject({ lane: "refused", reason: "house_mail_unavailable" });
    expect(state.charges).toEqual([]);
  });

  it("a stop-loss pause (nothing sent) counts as not billed, so a pre-paid piece is refunded", () => {
    expect(providerDidNotBill(Object.assign(new Error("paused"), { code: "OUTREACH_STOPLOSS_PAUSED" }))).toBe(true);
  });

  it("the rendered-letter cache is bounded by BYTES: an oversized render is not kept, and the total stays under budget", async () => {
    state.padBytes = 3 * 1024 * 1024; // over the per-entry cap
    const big = htmlOfPages(1).replace("Dear owner", "Dear big owner");
    await resolveMailLane(ORG, letterSpec({ file: big }));
    await resolveMailLane(ORG, letterSpec({ file: big }));
    expect(state.renders).toBe(2); // rendered again: never cached
    state.padBytes = 1_500_000;
    for (let i = 0; i < 14; i++) await resolveMailLane(ORG, letterSpec({ file: htmlOfPages(1).replace("Dear owner", `Dear owner ${i}`) }));
    expect(letterRenderCacheBytes()).toBeGreaterThan(0);
    expect(letterRenderCacheBytes()).toBeLessThanOrEqual(16 * 1024 * 1024);
    state.padBytes = 0;
  });

  it("an unreadable key vault refuses the send — it never falls to the house lane", async () => {
    const vault = await import("../../server/services/byok/key-vault");
    const spy = vi.spyOn(vault, "getByokCredential").mockRejectedValueOnce(new Error("vault down"));
    await expect(postcard()).rejects.toThrow(/provider keys could not be read/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
    spy.mockRestore();
  });
});

describe("resolveMailLane decisions", () => {
  it("own key wins and costs nothing", async () => {
    state.ownLobKey = "live_org_key";
    expect(await resolveMailLane(ORG, postcardSpec("4x6"))).toEqual({ lane: "own_account", provider: "lob", creditsPerPiece: 0 });
  });

  it("house requires a configured house account (probed only after the identity passes)", async () => {
    state.platformMissing = true;
    expect(await resolveMailLane(ORG, postcardSpec("4x6"))).toMatchObject({ lane: "refused", reason: "house_mail_unavailable" });
  });

  it("an unpriced spec is refused with its own reason", async () => {
    expect(await resolveMailLane(ORG, letterSpec({ pages: 7 }))).toMatchObject({ lane: "refused", reason: "letter_over_max" });
    expect(await resolveMailLane(ORG, { kind: "letter", extraService: "certified" })).toMatchObject({ lane: "refused", reason: "unknown_spec" });
  });

  it("PostGrid without the org's own PostGrid key is refused (house mail is Lob only)", async () => {
    expect(await resolveMailLane(ORG, postcardSpec("4x6"), { via: "postgrid" })).toMatchObject({ lane: "refused" });
  });

  it("house carries the identity it was given", async () => {
    const lane = await resolveMailLane(ORG, postcardSpec("4x6"), { senderIdentity: identity({ id: 99 }) as any });
    expect(lane).toMatchObject({ lane: "house", creditsPerPiece: 75 });
    expect(lane.lane === "house" && lane.senderIdentity.id).toBe(99);
  });

  it("a surface's own listed price passes through the same floor", async () => {
    expect(await resolveMailLane(ORG, postcardSpec("6x11"), { listedCredits: 115 })).toMatchObject({ creditsPerPiece: 115 });
    expect(await resolveMailLane(ORG, postcardSpec("6x11"), { listedCredits: 50 })).toMatchObject({ creditsPerPiece: 101 });
  });
});

describe("providerDidNotBill — the only door to a refund", () => {
  it("certain rejections and never-contacted are unbilled; everything else is unknown", async () => {
    const { ProviderNotContactedError } = await import("../../server/services/actions/outwardAction");
    expect(providerDidNotBill(new ProviderNotContactedError("refused"))).toBe(true);
    for (const s of [400, 401, 403, 404, 422, 429]) expect(providerDidNotBill(lobRejection(s)), String(s)).toBe(true);
    expect(providerDidNotBill(Object.assign(new Error("x"), { _response: { statusCode: 422 } }))).toBe(true);
    for (const s of [409, 500, 502, 503, 504]) expect(providerDidNotBill(lobRejection(s)), String(s)).toBe(false);
    expect(providerDidNotBill(new Error("ETIMEDOUT"))).toBe(false);
    expect(providerDidNotBill(undefined)).toBe(false);
    expect(providerDidNotBill({ providerNotBilled: true })).toBe(true);
  });
});

describe("letters: render to PDF, then count, then charge, then print THAT PDF (founder decisions 2026-10-18)", () => {
  const lobFilePages = async (call: { params: any }) => {
    const file = call.params.file;
    expect(Buffer.isBuffer(file?.value), "Lob must be sent the counted PDF, not HTML or a URL").toBe(true);
    const { PDFParse } = await import("pdf-parse");
    const p = new PDFParse({ data: new Uint8Array(file.value) });
    try {
      return (await p.getInfo()).total;
    } finally {
      await p.destroy();
    }
  };

  it("a one-page PDF URL is fetched, counted, pre-paid at the letter price, and those bytes are what Lob prints", async () => {
    await letter();
    expect(fakeSafeFetch.fetched).toEqual([PDF_URL]);
    expect(charged()).toEqual([120]);
    expect(await lobFilePages(state.lobCalls[0])).toBe(1);
  });

  it("an HTML letter is rendered by AcreOS BEFORE the charge, and the rendered PDF is what Lob prints", async () => {
    await letter({ htmlContent: htmlOfPages(1) });
    expect(state.renders).toBe(1);
    expect(charged()).toEqual([120]);
    expect(state.lobCalls[0].params.file.value.equals(state.lastRendered)).toBe(true);
    expect(await lobFilePages(state.lobCalls[0])).toBe(1);
  });

  it.each([
    [1, 107, 120], // the 120 listing covers it
    [2, 107 + 11, 120], // 118¢ → minimum 92; listing stands
    [6, 107 + 5 * 11, 126], // 162¢ → ⌈162 × 1.059 × 1.1 / 1.5⌉ = 126
  ])("at Lob's list prices: a %i-page render is charged for exactly that page count", async (pages, cost, credits) => {
    await letter({ htmlContent: htmlOfPages(pages) });
    expect(charged()).toEqual([credits]);
    expect(await lobFilePages(state.lobCalls[0])).toBe(pages);
    const lane = await resolveMailLane(ORG, letterSpec({ pages }));
    expect(lane).toMatchObject({ lane: "house", creditsPerPiece: credits, price: { providerCostCents: cost } });
  });

  it("a colour letter's extra pages cost Lob's colour price (6 pages: 123 + 5 × 21 = 228¢ → 178 credits)", async () => {
    const lane = await resolveMailLane(ORG, letterSpec({ pages: 6, color: true }));
    expect(lane).toMatchObject({ lane: "house", creditsPerPiece: 178, price: { providerCostCents: 228 } });
  });

  it.each([
    [2, 107 + 20, 120], // 127¢ → minimum 99; listing stands
    [6, 107 + 5 * 20, 161], // 207¢ → ⌈207 × 1.1649 / 1.5⌉ = 161
  ])("founder-set extra-page cost: a %i-page render is charged through it", async (pages, cost, credits) => {
    state.settings["mail.house.cost_cents.letter_extra_page"] = 20;
    await letter({ htmlContent: htmlOfPages(pages) });
    expect(charged()).toEqual([credits]);
    expect(await lobFilePages(state.lobCalls[0])).toBe(pages);
    const lane = await resolveMailLane(ORG, letterSpec({ pages }));
    expect(lane).toMatchObject({ lane: "house", creditsPerPiece: credits, price: { providerCostCents: cost } });
  });

  it("over the cap (default 6): a 7-page letter is refused — use your own Lob key — even with the extra-page cost set", async () => {
    state.settings["mail.house.cost_cents.letter_extra_page"] = 20;
    const err = await letter({ htmlContent: htmlOfPages(7) }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/up to 6 pages, and this letter is 7/);
    expect((err as Error).message).toMatch(/Use your own Lob key/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("the cap is founder-settable", async () => {
    state.settings["mail.house.cost_cents.letter_extra_page"] = 20;
    state.settings["mail.house.max_letter_pages"] = 3;
    await expect(letter({ htmlContent: htmlOfPages(4) })).rejects.toThrow(/up to 3 pages, and this letter is 4/);
    await letter({ htmlContent: htmlOfPages(3) });
    expect(state.charges).toHaveLength(1);
  });

  it("a render that fails refuses the send honestly — nothing debited, nothing printed", async () => {
    const err = await letter({ htmlContent: "<p>RENDER_FAIL</p>" }).catch((e: unknown) => e as Error);
    expect((err as Error).name).toBe("ProviderNotContactedError");
    expect((err as Error).message).toMatch(/couldn't lay this letter out/);
    expect(state.charges).toEqual([]);
    expect(state.lobCalls).toEqual([]);
  });

  it("content that is neither HTML nor a fetchable PDF is unknown, and refused", async () => {
    await expect(letter({ htmlContent: "just plain words" })).rejects.toThrow(/length it can confirm/);
    fakeSafeFetch.pdfPages = null;
    await expect(letter()).rejects.toThrow(/length it can confirm/);
    expect(state.charges).toEqual([]);
  });

  it("a non-https or private-network URL is never fetched", async () => {
    for (const url of ["http://files.example.com/a.pdf", "https://127.0.0.1/a.pdf", "https://169.254.169.254/a.pdf"]) {
      await expect(letter({ htmlContent: url }), url).rejects.toThrow(/length it can confirm/);
    }
    expect(fakeSafeFetch.fetched).toEqual([]);
    expect(state.charges).toEqual([]);
  });

  it("the own-key lane prints any letter, of any length, as written — nothing rendered or counted", async () => {
    state.ownLobKey = "live_org_key";
    await letter({ htmlContent: htmlOfPages(9) });
    expect(state.renders).toBe(0);
    expect(fakeSafeFetch.fetched).toEqual([]);
    expect(typeof state.lobCalls[0].params.file).toBe("string");
  });
});

describe("address checks (founder decision 2026-10-18)", () => {
  it("the org's own RETURN address is checked free on AcreOS's account", async () => {
    const r = await dms.verifyAddress(TO, ORG, { purpose: "sender_identity" });
    expect(r.isValid).toBe(true);
    expect(state.lobCalls.map((c) => [c.kind, c.apiKey])).toEqual([["verify", "live_platform_key"]]);
    expect(state.charges).toEqual([]);
  });

  it("per-check cost UNSET: lead addresses run only on the org's own key — refused on house, Lob never called", async () => {
    const lane = await resolveAddressCheckLane(ORG);
    expect(lane).toMatchObject({ lane: "refused" });
    expect(lane.lane === "refused" && lane.message).toMatch(/connect your own Lob key/i);
    const r = await dms.verifyAddress(TO, ORG, { purpose: "lead_address", lane });
    expect(r).toMatchObject({ isValid: false, refused: true });
    expect(state.lobCalls).toEqual([]);
  });

  it("per-check cost SET: a house lane priced at the self-funding minimum (5¢ → 4 credits)", async () => {
    state.settings["mail.house.cost_cents.address_check"] = 5;
    const lane = await resolveAddressCheckLane(ORG);
    expect(lane).toMatchObject({ lane: "house", creditsPerPiece: 4, providerCostCents: 5, price: { key: "address_check" } });
    const r = await dms.verifyAddress(TO, ORG, { purpose: "lead_address", lane });
    expect(r.isValid).toBe(true);
    expect(state.lobCalls[0].apiKey).toBe("live_platform_key");
  });

  it("the org's own key checks lead addresses whatever the setting", async () => {
    state.ownLobKey = "live_org_key";
    expect(await resolveAddressCheckLane(ORG)).toEqual({ lane: "own_account" });
  });
});

describe("scope: physical mail only — email and SMS stay BYO", () => {
  const ROOT = path.resolve(__dirname, "../..");
  it("the lane module never touches an email or SMS sender", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/services/mail/mailLane.ts"), "utf8"));
    expect(src).toContain("resolveMailLane"); // vacuity
    expect(src).not.toMatch(/emailService|smsService|sendEmail|sendSms|twilio|sendgrid|\bses\b/i);
  });

  it("the email BYO test still exists and still asserts the counterparty refusal", () => {
    const t = fs.readFileSync(path.join(ROOT, "tests/unit/emailPurposeEnforcement.test.ts"), "utf8");
    expect(t).toMatch(/counterparty/);
    expect(t).toMatch(/expect\(/);
  });
});
