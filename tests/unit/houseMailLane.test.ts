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

// The campaign class builds its env clients at import; give it a sandbox key.
vi.hoisted(() => {
  process.env.LOB_TEST_API_KEY = "test_env_key";
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
};

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
    return { apiKey: "test_platform_key", isTestKey: true };
  },
  isLiveSendArmed: () => false,
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
vi.mock("../../server/services/settings", () => ({ getSetting: async (_k: string, fallback: unknown) => fallback }));

// The outward-action boundary needs a database; letters in this file carry no
// idempotency key, so it is never entered. Its error type is real. The house
// charge runs in withTransaction against the fake transaction above.
vi.mock("../../server/db", () => ({ db: {}, withTransaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx()) }));

import * as dms from "../../server/services/directMailService";
import { resolveMailLane, postcardSpec, letterSpec, providerDidNotBill } from "../../server/services/mail/mailLane";

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
    htmlContent: "<p>hello</p>",
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
    expect(state.lobCalls[0].apiKey).toBe("test_platform_key");
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

  it("a 6x11 postcard is charged the self-funding minimum (86), not the 75 weight", async () => {
    await postcard({ size: "6x11" });
    expect(charged()).toEqual([86]);
  });

  it("house prices come from the weights, raised to the floor; founder overrides of the weight included", async () => {
    const p = await resolveMailLane(ORG, postcardSpec("4x6"));
    const l = await resolveMailLane(ORG, letterSpec());
    expect(p).toMatchObject({ lane: "house", creditsPerPiece: CREDIT_WEIGHTS.postcard_lob });
    expect(l).toMatchObject({ lane: "house", creditsPerPiece: CREDIT_WEIGHTS.letter_lob });

    state.creditOverride = 99;
    expect(await resolveMailLane(ORG, postcardSpec("4x6"))).toMatchObject({ creditsPerPiece: 99 });
    // An override BELOW the cost is lifted to the self-funding minimum.
    state.creditOverride = 10;
    expect(await resolveMailLane(ORG, postcardSpec("6x9"))).toMatchObject({ creditsPerPiece: 74 });
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
    const r = await dms.verifyAddress(TO, ORG);
    expect(r.isValid).toBe(true);
    expect(state.lobCalls.map((c) => [c.kind, c.apiKey])).toEqual([["verify", "live_org_key"]]);
    expect(state.platformResolves).toBe(0);
  });

  it("an org with no own key verifies on AcreOS's account (vacuity for the case above)", async () => {
    await dms.verifyAddress(TO, ORG);
    expect(state.lobCalls[0].apiKey).toBe("test_platform_key");
  });
});

describe("the other send chokepoints follow the same lane", () => {
  it("campaign class (directMail.ts): house piece carries the verified identity and is pre-paid unless prepaid", async () => {
    const { directMailService } = await import("../../server/services/directMail");
    const from = { name: "Typed Name", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };
    const to = { name: "Lee", addressLine1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };

    await directMailService.sendPostcard({ size: "6x9", front: "a", back: "b", to, from }, "test", ORG);
    expect(charged()).toEqual([75]);
    expect(state.lobCalls[0].params.from).toMatchObject({ name: "Brazos Land Partners", address_line1: "1 Main St" });

    state.charges = [];
    await directMailService.sendLetter({ file: "x", to, from, housePrepaid: true }, "test", ORG);
    expect(state.charges).toEqual([]);

    // A two-page letter has no recorded house cost: refused, not guessed.
    state.lobCalls = [];
    await expect(directMailService.sendLetter({ file: "x", to, from, pageCount: 2 }, "test", ORG)).rejects.toThrow(/no recorded price/);
    expect(state.lobCalls).toEqual([]);

    state.identity = identity({ status: "pending_verification" });
    await expect(directMailService.sendLetter({ file: "x", to, from }, "test", ORG)).rejects.toThrow(/verified return address/);
    expect(state.lobCalls).toEqual([]);
  });

  it("campaign class: a rejected piece is refunded, an unknown outcome is not", async () => {
    const { directMailService } = await import("../../server/services/directMail");
    const a = { name: "A", addressLine1: "1 A St", city: "X", state: "TX", zip: "1" };
    state.lobError = lobRejection(422);
    await expect(directMailService.sendPostcard({ size: "4x6", front: "a", back: "b", to: a, from: a }, "test", ORG)).rejects.toThrow();
    expect(state.refunds).toHaveLength(1);
    state.lobError = lobRejection(502);
    await expect(directMailService.sendPostcard({ size: "4x6", front: "a", back: "b", to: a, from: a }, "test", ORG)).rejects.toThrow();
    expect(state.refunds).toHaveLength(1);
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
    await directMailService.sendLetter({ file: "x", to: a, from: a }, "live", ORG);
    expect(state.lobCalls[0].apiKey).toBe("live_org_key");
    expect(state.charges).toEqual([]);
    expect(state.platformResolves).toBe(0);
  });

  it("autopilot send_letter (mailProvider): house pre-pays the letter and replaces the typed return address", async () => {
    const { sendLetter } = await import("../../server/services/mailProvider");
    const typed = { name: "Someone Else", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };
    const result = await sendLetter({ to: typed, from: typed, file: "https://x/l.pdf", organizationId: ORG });

    expect(result.success).toBe(true);
    expect(charged()).toEqual([120]);
    expect(state.lobCalls[0].params.from).toMatchObject({ name: "Brazos Land Partners", address_line1: "1 Main St" });

    // Rejected → refunded; unknown → kept.
    state.lobError = lobRejection(403);
    expect((await sendLetter({ to: typed, from: typed, file: "https://x/l.pdf", organizationId: ORG })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
    state.lobError = lobRejection(500);
    expect((await sendLetter({ to: typed, from: typed, file: "https://x/l.pdf", organizationId: ORG })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
    state.lobError = null;

    state.identity = null;
    state.lobCalls = [];
    const refused = await sendLetter({ to: typed, from: typed, file: "https://x/l.pdf", organizationId: ORG });
    expect(refused.success).toBe(false);
    expect(state.lobCalls).toEqual([]);
  });

  it("lobService live counterparty send: own key → no charge; house → pre-paid + verified identity", async () => {
    const { lobService } = await import("../../server/services/lobService");
    const a = { name: "Typed", addressLine1: "9 Fake St", city: "X", state: "TX", zip: "1" };

    state.ownLobKey = "live_org_key";
    const own = await lobService.sendLetter({ to: a, from: a, file: "x" }, "live", { organizationId: ORG, purpose: "counterparty" });
    expect(own.success).toBe(true);
    expect(state.lobCalls[0].apiKey).toBe("live_org_key");
    expect(state.charges).toEqual([]);
    expect(state.platformResolves).toBe(0);

    state.ownLobKey = null;
    state.lobCalls = [];
    const house = await lobService.sendLetter({ to: a, from: a, file: "x" }, "live", { organizationId: ORG, purpose: "counterparty" });
    expect(house.success).toBe(true);
    expect(charged()).toEqual([120]);
    expect(state.lobCalls[0].params.from.name).toBe("Brazos Land Partners");

    state.lobError = lobRejection(429);
    expect((await lobService.sendLetter({ to: a, from: a, file: "x" }, "live", { organizationId: ORG, purpose: "counterparty" })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
    state.lobError = lobRejection(500);
    expect((await lobService.sendLetter({ to: a, from: a, file: "x" }, "live", { organizationId: ORG, purpose: "counterparty" })).success).toBe(false);
    expect(state.refunds).toHaveLength(1);
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
    expect(await resolveMailLane(ORG, letterSpec({ pages: 3 }))).toMatchObject({ lane: "refused", reason: "unknown_spec" });
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
    expect(await resolveMailLane(ORG, postcardSpec("6x11"), { listedCredits: 50 })).toMatchObject({ creditsPerPiece: 86 });
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
