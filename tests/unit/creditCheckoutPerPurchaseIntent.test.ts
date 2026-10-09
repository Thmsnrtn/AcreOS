/**
 * A credit checkout is idempotent per PURCHASE INTENT, not per pack.
 *
 * The key was customer + pack + org. Stripe keeps idempotency keys for 24h, so
 * a second deliberate purchase of the same mail pack that day got the first —
 * already paid — session back: the customer could not buy it again. Now the
 * key carries the purchase intent (the client's Idempotency-Key, held for the
 * life of one in-flight purchase), or a 10-second window when none is sent.
 *
 *   double-click (same intent, or no intent within the window) → one session
 *   second deliberate purchase (new intent, or a later window) → a new one
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const H = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    checkout: {
      sessions: {
        create: async (_params: any, opts: any) => {
          H.keys.push(opts.idempotencyKey);
          return { id: `cs_${H.keys.length}`, url: "https://checkout.example/" + opts.idempotencyKey.slice(0, 8) };
        },
      },
    },
  }),
}));

import { StripeService, creditCheckoutIdempotencyKey, CREDIT_CHECKOUT_DEDUPE_WINDOW_MS } from "../../server/stripeService";
import { setSimulatedClockOffset } from "../../server/utils/clock";
import { beginPurchaseIntent, settlePurchaseIntent } from "../../client/src/lib/purchaseIntent";

const svc = new StripeService();
const buy = (intent?: string | null, pack = "mail-credits-2000") =>
  svc.createCreditPurchaseCheckout("cus_1", pack, 2000, "$20 Mail Credit Pack", "s", "c", { organizationId: "7" }, intent);

beforeEach(() => {
  H.keys.length = 0;
  setSimulatedClockOffset(0);
});

describe("the Stripe idempotency key of a credit checkout", () => {
  it("a double-click (the same intent) dedupes to one session", async () => {
    await buy("intent-aaaaaaaa");
    await buy("intent-aaaaaaaa");
    expect(new Set(H.keys).size).toBe(1);
  });

  it("a second deliberate purchase of the same pack (a new intent) is a new session", async () => {
    await buy("intent-aaaaaaaa");
    await buy("intent-bbbbbbbb");
    expect(new Set(H.keys).size).toBe(2);
  });

  it("…even hours later on the same day, where the old key collided for 24h", async () => {
    await buy("intent-aaaaaaaa");
    setSimulatedClockOffset(3 * 60 * 60 * 1000);
    await buy("intent-cccccccc");
    expect(new Set(H.keys).size).toBe(2);
  });

  it("with no intent: a double-click inside the window dedupes, a later purchase does not", () => {
    const t = 1_700_000_000_000 - (1_700_000_000_000 % CREDIT_CHECKOUT_DEDUPE_WINDOW_MS);
    const k = (nowMs: number, purchaseIntent?: string | null) =>
      creditCheckoutIdempotencyKey({ customerId: "cus_1", packId: "p", organizationId: "7", purchaseIntent, nowMs });
    expect(k(t + 100)).toBe(k(t + 900));
    expect(k(t + 100)).not.toBe(k(t + CREDIT_CHECKOUT_DEDUPE_WINDOW_MS + 100));
    // a malformed intent is not trusted as one — it falls back to the window
    expect(k(t + 100, "x")).toBe(k(t + 100));
    expect(k(t + 100, "x")).not.toBe(k(t + 100, "intent-aaaaaaaa"));
  });

  it("different packs and different orgs never share a key", () => {
    const base = { customerId: "cus_1", packId: "p1", organizationId: "7", purchaseIntent: "intent-aaaaaaaa" };
    expect(creditCheckoutIdempotencyKey(base)).not.toBe(creditCheckoutIdempotencyKey({ ...base, packId: "p2" }));
    expect(creditCheckoutIdempotencyKey(base)).not.toBe(creditCheckoutIdempotencyKey({ ...base, organizationId: "8" }));
  });
});

describe("the client holds one intent per in-flight purchase", () => {
  it("concurrent calls for a pack share a key; after it settles, the next purchase gets a new one", () => {
    const a = beginPurchaseIntent("mail-credits:2000");
    const b = beginPurchaseIntent("mail-credits:2000"); // the double-click
    expect(b).toBe(a);
    expect(beginPurchaseIntent("mail-credits:5000")).not.toBe(a);
    settlePurchaseIntent("mail-credits:5000");
    settlePurchaseIntent("mail-credits:2000");
    settlePurchaseIntent("mail-credits:2000");
    const c = beginPurchaseIntent("mail-credits:2000");
    expect(c).not.toBe(a);
    settlePurchaseIntent("mail-credits:2000");
  });
});

describe("population: every checkout call passes the request's purchase intent", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const CALLERS = ["server/routes-billing.ts", "server/routes-outreach-mail.ts"];
  const CLIENT = ["client/src/components/credit-purchase-modal.tsx", "client/src/hooks/use-outreach-mail.ts"];

  function checkoutCalls(file: string) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const calls: ts.CallExpression[] = [];
    const v = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "createCreditPurchaseCheckout") calls.push(n);
      ts.forEachChild(n, v);
    };
    v(sf);
    return { sf, calls };
  }

  it("the callers are exactly the enumerated routes", () => {
    const all = (require("node:child_process").execSync("git ls-files server", { cwd: ROOT, encoding: "utf8" }) as string)
      .split("\n")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "server/stripeService.ts")
      .filter((f) => checkoutCalls(f).calls.length > 0);
    expect(all.sort()).toEqual([...CALLERS].sort());
  });

  it.each(CALLERS)("%s passes the Idempotency-Key header as the intent", (file) => {
    const { sf, calls } = checkoutCalls(file);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.arguments.length).toBe(8);
      expect(c.arguments[7].getText(sf)).toMatch(/Idempotency-Key/);
    }
  });

  it.each(CLIENT)("%s sends a held purchase intent, not a fresh key per call", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(text).toMatch(/beginPurchaseIntent\(/);
    expect(text).toMatch(/settlePurchaseIntent\(/);
    expect(text).toMatch(/idempotencyKey: intent/);
  });
});
