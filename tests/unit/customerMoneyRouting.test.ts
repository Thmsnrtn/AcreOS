/**
 * customerMoneyRouting.test.ts — the BEHAVIOURAL half of
 * `hard-stop.no-platform-money-custody`.
 *
 * The structural half (`tests/unit/moneyCustodyHardStop.test.ts`) proves the
 * platform-take SHAPES appear nowhere. This file proves the runtime behaviour
 * at the two live customer-money call paths, because the defects found on
 * 2026-07-29 were not misspelled parameters — they were *omissions*:
 *
 *   V1  `routes-borrower.ts` called `stripe.checkout.sessions.create(params)`
 *       with NO second argument. Consumer mortgage payments settled into
 *       AcreOS's own platform balance with no payout path, for any org — even
 *       one that had never connected Stripe. A grep for banned parameter names
 *       finds nothing wrong with a missing argument.
 *
 *   V2  `stripeConnect.createPaymentIntent` built `transfer_data.destination`
 *       plus a 2.5% `application_fee_amount` without `on_behalf_of`, making
 *       AcreOS the settlement merchant AND taking a cut.
 *
 * So the four properties pinned here are the ones an omission breaks:
 *
 *   1. A customer-money charge is ALWAYS scoped to the org's OWN account —
 *      asserted on the request OPTIONS actually handed to Stripe, not on a
 *      comment claiming it.
 *   2. An org with no usable processor is REFUSED with a typed reason, and
 *      ZERO Stripe charge calls are made. No platform fallback exists.
 *   3. No customer-money call carries a platform take, at any nesting depth.
 *   4. AcreOS-as-vendor subscription billing is UNCHANGED — it still charges
 *      on AcreOS's own account with no `stripeAccount` scope, because AcreOS
 *      really is the merchant for its own subscriptions.
 *
 * Everything runs against injected ports and a fake Stripe: no DATABASE_URL
 * beyond the dummy in tests/setup.ts, and no live Stripe call ever.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake Stripe ────────────────────────────────────────────────────────────
// Records (params, options) for every create call so the tests can assert on
// what would ACTUALLY have gone over the wire.

type Recorded = { resource: string; params: any; options: any };

const stripeCalls = vi.hoisted(() => ({ list: [] as Recorded[] }));

function record(resource: string) {
  return vi.fn(async (params: any, options?: any) => {
    stripeCalls.list.push({ resource, params, options });
    return {
      id: `${resource}_fake_1`,
      client_secret: `${resource}_fake_secret`,
      url: `https://buy.stripe.com/fake_${resource}`,
      amount: params?.amount ?? params?.unit_amount ?? 0,
    };
  });
}

/**
 * Shared across every `new Stripe(...)` — `stripeConnect.getStripeClient()`
 * constructs a fresh client per call, so per-instance mocks would be
 * unreachable from the test.
 */
const accountsRetrieve = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => {
  const shared = {
    paymentIntents: { create: record("payment_intent") },
    prices: { create: record("price") },
    paymentLinks: { create: record("payment_link") },
    checkout: { sessions: { create: record("checkout_session") } },
    accounts: { retrieve: accountsRetrieve },
  };
  class FakeStripe {
    paymentIntents = shared.paymentIntents;
    prices = shared.prices;
    paymentLinks = shared.paymentLinks;
    checkout = shared.checkout;
    accounts = shared.accounts;
    constructor(_key: string, _opts: unknown) {}
  }
  return { default: FakeStripe };
});

/** A connected account that is fully cleared for cards. */
function accountCardReady() {
  accountsRetrieve.mockResolvedValue({
    id: ORG_ACCOUNT,
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: "active", transfers: "active" },
  });
}

// ── Storage double ─────────────────────────────────────────────────────────

const storageState = vi.hoisted(() => ({
  integration: null as any,
  note: null as any,
  org: null as any,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: vi.fn(async () => storageState.integration),
    getNote: vi.fn(async () => storageState.note),
    getOrganization: vi.fn(async () => storageState.org),
  },
}));

const processBorrowerPortalPayment = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../server/webhookHandlers", () => ({
  WebhookHandlers: { processBorrowerPortalPayment },
}));

import {
  resolveOrgCardProcessor,
  prepareCustomerMoneyCall,
  customerMoneyReadOptions,
  buildBorrowerCardCheckoutParams,
  assertNoPlatformTake,
  PlatformTakeError,
  UnscopedCustomerMoneyCallError,
  PLATFORM_TAKE_PARAM_KEYS,
  CONNECT_PROCESSOR_PATH,
  type CustomerMoneyRoutingDeps,
} from "../../server/services/customerMoneyRouting";

const ORG_ACCOUNT = "acct_lender_own_account";

function deps(overrides: Partial<CustomerMoneyRoutingDeps> = {}): CustomerMoneyRoutingDeps {
  return {
    getConnectedAccountId: async () => ORG_ACCOUNT,
    getAccountStatus: async () => ({ chargesEnabled: true, cardPayments: "active" }),
    isSimulated: () => false,
    ...overrides,
  };
}

beforeEach(() => {
  stripeCalls.list.length = 0;
  storageState.integration = null;
  storageState.note = null;
  storageState.org = null;
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_not_a_real_key";
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Resolver — refuse, never fall back
// ───────────────────────────────────────────────────────────────────────────

describe("resolveOrgCardProcessor — refuses instead of falling back", () => {
  it("resolves the ORG'S OWN account when it is connected and card-capable", async () => {
    const routing = await resolveOrgCardProcessor(7, deps());
    expect(routing.ok).toBe(true);
    if (routing.ok) expect(routing.processor.accountId).toBe(ORG_ACCOUNT);
  });

  it("refuses with `processor_not_connected` and never probes Stripe", async () => {
    const getAccountStatus = vi.fn(async () => ({ chargesEnabled: true, cardPayments: "active" }));
    const routing = await resolveOrgCardProcessor(
      7,
      deps({ getConnectedAccountId: async () => null, getAccountStatus }),
    );
    expect(routing.ok).toBe(false);
    if (!routing.ok) {
      expect(routing.reason).toBe("processor_not_connected");
      expect(routing.connectPath).toBe(CONNECT_PROCESSOR_PATH);
    }
    // The common unconfigured case stays a single lookup — no Stripe round-trip.
    expect(getAccountStatus).not.toHaveBeenCalled();
  });

  it("refuses with `processor_charges_disabled` when Stripe hasn't cleared the account", async () => {
    const routing = await resolveOrgCardProcessor(
      7,
      deps({ getAccountStatus: async () => ({ chargesEnabled: false, cardPayments: "active" }) }),
    );
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.reason).toBe("processor_charges_disabled");
  });

  it("refuses with `card_capability_inactive` when card_payments is not active", async () => {
    const routing = await resolveOrgCardProcessor(
      7,
      deps({ getAccountStatus: async () => ({ chargesEnabled: true, cardPayments: "pending" }) }),
    );
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.reason).toBe("card_capability_inactive");
  });

  it("refuses with `processor_check_failed` when the status read throws — never assumes yes", async () => {
    const routing = await resolveOrgCardProcessor(
      7,
      deps({
        getAccountStatus: async () => {
          throw new Error("stripe down");
        },
      }),
    );
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.reason).toBe("processor_check_failed");
  });

  it("refuses with `simulated` on a simulation environment", async () => {
    const routing = await resolveOrgCardProcessor(7, deps({ isSimulated: () => true }));
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.reason).toBe("simulated");
  });

  it("has no branch that returns a platform account — every refusal stays a refusal", async () => {
    // Exhaustive over the failure states: none of them may hand back an
    // account id, and in particular none may hand back AcreOS's.
    const failures: CustomerMoneyRoutingDeps[] = [
      deps({ isSimulated: () => true }),
      deps({ getConnectedAccountId: async () => null }),
      deps({ getAccountStatus: async () => ({ chargesEnabled: false }) }),
      deps({ getAccountStatus: async () => ({ chargesEnabled: true, cardPayments: "inactive" }) }),
      deps({
        getAccountStatus: async () => {
          throw new Error("boom");
        },
      }),
    ];
    for (const d of failures) {
      const routing = await resolveOrgCardProcessor(7, d);
      expect(routing.ok).toBe(false);
      expect(routing).not.toHaveProperty("processor");
    }
  });

  it("tells the BORROWER what's unavailable without telling them to connect Stripe", async () => {
    // A borrower cannot connect their lender's processor. Sending them to
    // AcreOS settings would be both useless and a hint that AcreOS collects.
    const routing = await resolveOrgCardProcessor(
      7,
      deps({ getConnectedAccountId: async () => null }),
    );
    expect(routing.ok).toBe(false);
    if (!routing.ok) {
      expect(routing.borrowerMessage).toMatch(/lender/i);
      expect(routing.borrowerMessage).not.toMatch(/\/settings|Settings →|connect your/i);
      // And it must say nothing was charged.
      expect(routing.borrowerMessage).toMatch(/no card was charged/i);
      // The operator, who CAN fix it, is told exactly where.
      expect(routing.operatorMessage).toContain(CONNECT_PROCESSOR_PATH);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The chokepoint
// ───────────────────────────────────────────────────────────────────────────

describe("prepareCustomerMoneyCall — scope is mandatory, a platform take is fatal", () => {
  it("always returns options carrying the ORG'S account id", () => {
    const { options } = prepareCustomerMoneyCall(
      "t",
      { amount: 1000, currency: "usd" },
      { accountId: ORG_ACCOUNT },
    );
    expect(options.stripeAccount).toBe(ORG_ACCOUNT);
  });

  it("preserves caller options (e.g. idempotencyKey) but never lets them drop the scope", () => {
    const { options } = prepareCustomerMoneyCall(
      "t",
      { amount: 1000 },
      { accountId: ORG_ACCOUNT },
      { idempotencyKey: "key_1" },
    );
    expect(options).toEqual({ idempotencyKey: "key_1", stripeAccount: ORG_ACCOUNT });
  });

  it("throws UnscopedCustomerMoneyCallError rather than building an unscoped call", () => {
    expect(() =>
      prepareCustomerMoneyCall("borrower.card", { amount: 1 }, { accountId: "" }),
    ).toThrow(UnscopedCustomerMoneyCallError);
  });

  it("throws PlatformTakeError for every banned key", () => {
    for (const key of PLATFORM_TAKE_PARAM_KEYS) {
      expect(
        () =>
          prepareCustomerMoneyCall("t", { amount: 1, [key]: key === "transfer_data" ? { destination: ORG_ACCOUNT } : 25 }, {
            accountId: ORG_ACCOUNT,
          }),
        `${key} must be rejected`,
      ).toThrow(PlatformTakeError);
    }
  });

  it("finds a platform take NESTED inside payment_intent_data (how Checkout hides it)", () => {
    expect(() =>
      prepareCustomerMoneyCall(
        "t",
        { mode: "payment", payment_intent_data: { application_fee_amount: 250 } },
        { accountId: ORG_ACCOUNT },
      ),
    ).toThrow(PlatformTakeError);
  });

  it("finds a platform take nested inside an array element", () => {
    expect(() =>
      prepareCustomerMoneyCall(
        "t",
        { line_items: [{ price: "price_1", transfer_data: { destination: "acct_x" } }] },
        { accountId: ORG_ACCOUNT },
      ),
    ).toThrow(PlatformTakeError);
  });

  it("names the offending path in the error, so the fix is obvious", () => {
    try {
      assertNoPlatformTake("t", { payment_intent_data: { application_fee_amount: 1 } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PlatformTakeError);
      expect((e as PlatformTakeError).keyPath).toBe("payment_intent_data.application_fee_amount");
    }
  });

  it("treats an explicitly-undefined optional field as no take", () => {
    expect(() => assertNoPlatformTake("t", { amount: 1, application_fee_amount: undefined })).not.toThrow();
  });

  it("survives cleanly on primitives, nulls and empty shapes", () => {
    for (const v of [null, undefined, 1, "s", true, {}, []]) {
      expect(() => assertNoPlatformTake("t", v)).not.toThrow();
    }
  });
});

describe("customerMoneyReadOptions — reads are scoped too", () => {
  it("scopes the read to the org's account", () => {
    expect(customerMoneyReadOptions({ accountId: ORG_ACCOUNT }, "t")).toEqual({
      stripeAccount: ORG_ACCOUNT,
    });
  });

  it("refuses an unscoped read (an unscoped retrieve would report a real payment as missing)", () => {
    expect(() => customerMoneyReadOptions({ accountId: "" }, "t")).toThrow(
      UnscopedCustomerMoneyCallError,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The borrower checkout params
// ───────────────────────────────────────────────────────────────────────────

describe("buildBorrowerCardCheckoutParams", () => {
  const input = {
    noteId: 42,
    organizationId: 7,
    lenderName: "Cedar Ridge Land Co.",
    borrowerName: "Dana Reyes",
    borrowerEmail: "dana@example.com",
    amountCents: 123_456,
    baseUrl: "https://app.example.com",
    accessToken: "tok_abc",
    source: "session" as const,
  };

  it("carries no platform take of any kind", () => {
    expect(() => assertNoPlatformTake("borrower.card", buildBorrowerCardCheckoutParams(input))).not.toThrow();
  });

  it("names the LENDER as the collector in what the borrower reads", () => {
    const params = buildBorrowerCardCheckoutParams(input);
    const item = (params.line_items ?? [])[0] as any;
    expect(item.price_data.product_data.name).toContain("Cedar Ridge Land Co.");
    expect(item.price_data.product_data.description).toContain("Cedar Ridge Land Co.");
    expect(item.price_data.product_data.description).toMatch(/does not take a cut/i);
  });

  it("passes the amount through in cents, unrounded and unaltered", () => {
    const item = (buildBorrowerCardCheckoutParams(input).line_items ?? [])[0] as any;
    expect(item.price_data.unit_amount).toBe(123_456);
  });

  it("stamps the metadata the webhook needs to attribute the payment", () => {
    const params = buildBorrowerCardCheckoutParams(input);
    expect(params.metadata).toMatchObject({
      type: "borrower_portal_payment",
      noteId: "42",
      organizationId: "7",
      accessToken: "tok_abc",
      source: "session",
    });
  });

  it("omits customer_email entirely rather than sending an empty one", () => {
    const params = buildBorrowerCardCheckoutParams({ ...input, borrowerEmail: undefined });
    expect(params).not.toHaveProperty("customer_email");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The real service call paths, against a fake Stripe
// ───────────────────────────────────────────────────────────────────────────

describe("stripeConnect customer-money calls — scoped, feeless, refusing", () => {
  async function service() {
    const mod = await import("../../server/services/stripeConnect");
    return mod;
  }

  function connectedOrg() {
    storageState.integration = {
      organizationId: 7,
      credentials: { stripeConnectAccountId: ORG_ACCOUNT },
      settings: {},
    };
    storageState.org = { id: 7, name: "Cedar Ridge Land Co." };
    storageState.note = { id: 42, organizationId: 7, monthlyPayment: "1200.00" };
  }

  it("createCustomerMoneyPaymentIntent charges on the ORG'S account, with no fee", async () => {
    connectedOrg();
    const { stripeConnectService } = await service();
    // Card capability comes from accounts.retrieve via getAccountStatus.
    accountCardReady();
    stripeCalls.list.length = 0;

    const result = await stripeConnectService.createCustomerMoneyPaymentIntent(7, 120_000, "usd", {
      noteId: 42,
      paymentType: "note_payment",
    });

    expect(result.ok).toBe(true);
    const call = stripeCalls.list.find((c) => c.resource === "payment_intent");
    expect(call, "a PaymentIntent must have been created").toBeDefined();
    // (1) scoped to the org's own account …
    expect(call!.options?.stripeAccount).toBe(ORG_ACCOUNT);
    // (2) … and carrying no take of any kind.
    expect(() => assertNoPlatformTake("payment_intent", call!.params)).not.toThrow();
    expect(call!.params).not.toHaveProperty("application_fee_amount");
    expect(call!.params).not.toHaveProperty("transfer_data");
    if (result.ok) expect(result.connectedAccountId).toBe(ORG_ACCOUNT);
  });

  it("makes ZERO Stripe charge calls when the org has no connected processor", async () => {
    storageState.integration = null; // never connected
    storageState.org = { id: 7, name: "Cedar Ridge Land Co." };
    storageState.note = { id: 42, organizationId: 7, monthlyPayment: "1200.00" };
    const { stripeConnectService } = await service();
    stripeCalls.list.length = 0;

    const result = await stripeConnectService.createCustomerMoneyPaymentIntent(7, 120_000, "usd", {
      noteId: 42,
      paymentType: "note_payment",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("processor_not_connected");
      expect(result.operatorMessage).toContain(CONNECT_PROCESSOR_PATH);
    }
    // The whole point: nothing was charged anywhere, least of all on AcreOS.
    expect(stripeCalls.list).toEqual([]);
  });

  it("createPaymentIntent (throwing wrapper) refuses with a typed error, not a platform charge", async () => {
    storageState.integration = null;
    const { stripeConnectService, CustomerMoneyRefusedError } = await service();
    stripeCalls.list.length = 0;

    await expect(
      stripeConnectService.createPaymentIntent(7, 120_000, "usd", { paymentType: "cash_sale" }),
    ).rejects.toBeInstanceOf(CustomerMoneyRefusedError);
    expect(stripeCalls.list).toEqual([]);
  });

  it("getPaymentLink returns a REAL Stripe-hosted link on the org's account (no dead /pay route, no dangling intent)", async () => {
    connectedOrg();
    const { stripeConnectService } = await service();
    accountCardReady();
    stripeCalls.list.length = 0;

    const link = await stripeConnectService.getPaymentLink(7, 42, 1200);

    // Stripe hosts it — not an AcreOS route, and definitely not /pay/<secret>.
    expect(link.url).toMatch(/^https:\/\/buy\.stripe\.com\//);
    expect(link.url).not.toContain("/pay/");
    expect(link.url).not.toContain("client_secret");

    // Both objects were created on the ORG'S account, and no PaymentIntent was
    // minted just to make a URL (the old bug left a live chargeable intent
    // behind a route that did not exist).
    const price = stripeCalls.list.find((c) => c.resource === "price");
    const paymentLink = stripeCalls.list.find((c) => c.resource === "payment_link");
    expect(price!.options?.stripeAccount).toBe(ORG_ACCOUNT);
    expect(paymentLink!.options?.stripeAccount).toBe(ORG_ACCOUNT);
    expect(stripeCalls.list.some((c) => c.resource === "payment_intent")).toBe(false);
    for (const c of stripeCalls.list) {
      expect(() => assertNoPlatformTake(c.resource, c.params)).not.toThrow();
    }
  });

  it("getPaymentLink refuses (and creates nothing) without a connected processor", async () => {
    storageState.integration = null;
    storageState.note = { id: 42, organizationId: 7, monthlyPayment: "1200.00" };
    const { stripeConnectService, CustomerMoneyRefusedError } = await service();
    stripeCalls.list.length = 0;

    await expect(stripeConnectService.getPaymentLink(7, 42, 1200)).rejects.toBeInstanceOf(
      CustomerMoneyRefusedError,
    );
    expect(stripeCalls.list).toEqual([]);
  });

  it("stores no application-fee percent when an account is connected", async () => {
    // `saveConnectedAccount` used to seed `stripeApplicationFeePercent: 2.5`,
    // which is what made the destination charge look sanctioned.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/services/stripeConnect.ts", "utf8"),
    );
    const codeOnly = src
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(codeOnly).not.toContain("stripeApplicationFeePercent");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Moving the charge onto the connected account MOVES THE WEBHOOK TOO
// ───────────────────────────────────────────────────────────────────────────

describe("Connect webhook dispatch — the ledger writer follows the charge", () => {
  // This repo's most common defect is "built but unwired". Scoping the borrower
  // Checkout to the lender's account moves its `checkout.session.completed`
  // from the PLATFORM webhook endpoint to the CONNECT one. Without a branch
  // there, every borrower card payment would succeed at Stripe and silently
  // never post to the ledger.
  beforeEach(() => processBorrowerPortalPayment.mockClear());

  function connectEvent(metadata: Record<string, string>) {
    return {
      id: "evt_connect_1",
      type: "checkout.session.completed",
      account: ORG_ACCOUNT,
      data: { object: { id: "cs_connect_1", metadata } },
    } as any;
  }

  it("posts a borrower portal payment that completed on the lender's account", async () => {
    const { stripeConnectService } = await import("../../server/services/stripeConnect");
    await stripeConnectService.handleWebhookEvent(
      connectEvent({ type: "borrower_portal_payment", noteId: "42", accessToken: "tok_abc" }),
    );
    expect(processBorrowerPortalPayment).toHaveBeenCalledTimes(1);
    expect(processBorrowerPortalPayment.mock.calls[0][0]).toMatchObject({ id: "cs_connect_1" });
  });

  it("ignores a completed checkout that isn't a borrower payment", async () => {
    const { stripeConnectService } = await import("../../server/services/stripeConnect");
    await stripeConnectService.handleWebhookEvent(connectEvent({ type: "credit_purchase" }));
    expect(processBorrowerPortalPayment).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Ratchet — no customer-money Stripe call anywhere without org scoping
// ───────────────────────────────────────────────────────────────────────────

describe("ratchet — every customer-money Stripe call is org-scoped", () => {
  /**
   * V1 was a MISSING SECOND ARGUMENT. No banned identifier appears in
   * `stripe.checkout.sessions.create(params)` — the defect is the absence of
   * something. So this scans the customer-money files and asserts that every
   * money-moving Stripe call passes a scope.
   *
   * Account LIFECYCLE calls (`accounts.*`, `accountLinks.*`) are deliberately
   * out of scope: you create and read a connected account FROM the platform
   * account, and they move no money.
   */
  const CUSTOMER_MONEY_FILES = [
    "server/routes-borrower.ts",
    "server/services/stripeConnect.ts",
    // Wave C's ACH lane already complied; included so it can't regress.
    "server/services/achMandateSetup.ts",
    "server/services/achAutopay.ts",
  ];

  const MONEY_RESOURCES =
    /stripe\.(checkout\.sessions|paymentIntents|setupIntents|paymentMethods|paymentLinks|prices|charges|customers|subscriptions|invoices|refunds|transfers|payouts)\.(create|retrieve|confirm|capture|update|cancel)\s*\(/g;

  /** The whole argument list of a call starting at `openParenIdx`. */
  function callArgs(src: string, openParenIdx: number): string {
    let depth = 0;
    for (let i = openParenIdx; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) return src.slice(openParenIdx + 1, i);
      }
    }
    return src.slice(openParenIdx + 1);
  }

  /**
   * Sanctioned ways to carry the org's account onto the call: the header
   * itself, or an options object produced by the chokepoint.
   */
  const SCOPED = /stripeAccount|customerMoneyReadOptions|\boptions\b/;

  it("passes a stripeAccount scope on every money-moving call", async () => {
    const fs = await import("node:fs");
    const offenders: string[] = [];
    for (const rel of CUSTOMER_MONEY_FILES) {
      const src = fs.readFileSync(rel, "utf8");
      MONEY_RESOURCES.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MONEY_RESOURCES.exec(src)) !== null) {
        const open = m.index + m[0].length - 1;
        const args = callArgs(src, open);
        if (!SCOPED.test(args)) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${rel}:${line}: ${m[0]} — no stripeAccount scope`);
        }
      }
    }
    expect(
      offenders,
      "A customer-money Stripe call with no `stripeAccount` scope settles into " +
        "AcreOS's own platform balance — the exact V1 defect (a missing second " +
        "argument, which no banned-identifier grep can catch). Build it with " +
        `prepareCustomerMoneyCall() / customerMoneyReadOptions().\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("finds real call sites to check (the scan can't pass by matching nothing)", async () => {
    const fs = await import("node:fs");
    let found = 0;
    for (const rel of CUSTOMER_MONEY_FILES) {
      const src = fs.readFileSync(rel, "utf8");
      found += src.match(MONEY_RESOURCES)?.length ?? 0;
    }
    // routes-borrower: 2 Checkout creates + 2 Checkout retrieves.
    // stripeConnect: 1 PaymentIntent + 1 Price + 1 PaymentLink + 1 SetupIntent
    //   + 1 Customer.
    // achMandateSetup: 1 Checkout retrieve + 1 PaymentMethod retrieve
    //   (+ its Checkout create).
    // achAutopay: 1 PaymentIntent create + 1 retrieve.
    // A drop below this means the scan stopped seeing real call sites — i.e.
    // it started passing by matching nothing.
    expect(found).toBeGreaterThanOrEqual(14);
  });

  it("refuses before charging: each borrower payment route resolves a processor first", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes-borrower.ts", "utf8");
    // Every Checkout create/retrieve in the borrower routes must be preceded by
    // a resolver call, so there is no path that charges without one.
    const resolves = src.match(/resolveOrgCardProcessor\(/g)?.length ?? 0;
    const stripeTouches =
      (src.match(/stripe\.checkout\.sessions\.(create|retrieve)\s*\(/g)?.length ?? 0);
    expect(resolves).toBeGreaterThanOrEqual(stripeTouches);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. AcreOS-as-vendor billing is a DIFFERENT lane and must stay unchanged
// ───────────────────────────────────────────────────────────────────────────

describe("AcreOS-as-vendor subscription billing is untouched", () => {
  it("subscription checkout still charges on AcreOS's own account (no stripeAccount scope)", async () => {
    // AcreOS really IS the merchant for its own subscriptions — this lane is
    // doctrine-permitted, and scoping it to a customer's account would break
    // AcreOS's revenue. Pinned so a future custody sweep doesn't "fix" it.
    vi.doMock("../../server/stripeClient", () => ({
      STRIPE_API_VERSION: "2026-02-25.clover",
      getUncachableStripeClient: async () => ({
        checkout: { sessions: { create: record("subscription_checkout") } },
      }),
    }));
    stripeCalls.list.length = 0;

    const { stripeService } = await import("../../server/stripeService");
    await stripeService.createCheckoutSession(
      "cus_acreos_customer",
      "price_pro_monthly",
      "https://app.example.com/ok",
      "https://app.example.com/no",
      { organizationId: "7" },
    );

    const call = stripeCalls.list.find((c) => c.resource === "subscription_checkout");
    expect(call, "the subscription checkout must still be created").toBeDefined();
    expect(call!.options?.stripeAccount).toBeUndefined();
    expect(call!.params.mode).toBe("subscription");
    // Vendor billing carries no application fee either — there is no third
    // party to split with; AcreOS is simply the merchant.
    expect(() => assertNoPlatformTake("subscription_checkout", call!.params)).not.toThrow();
    vi.doUnmock("../../server/stripeClient");
  });
});
