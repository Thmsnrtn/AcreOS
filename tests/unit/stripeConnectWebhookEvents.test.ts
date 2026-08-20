/**
 * THE CONNECT ENDPOINT MUST BE SUBSCRIBED TO EVERY EVENT IT HANDLES.
 *
 * THE DEFECT THIS GATE EXISTS FOR
 * ───────────────────────────────
 * `routes-setup.ts` provisions the Stripe webhook endpoint that points at
 * `/api/stripe/connect/webhook` — the route `stripeConnect.handleWebhookEvent`
 * serves. Stripe delivers ONLY the event types named in that endpoint's
 * `enabled_events`, so a handled event missing from the list is "built but
 * unwired" with every gate green: the branch exists, a unit test can reach it,
 * and in production the event never arrives.
 *
 * The list had drifted in both directions at once. `charge.refunded` — the
 * branch that keeps a refunded borrower payment off Form 1098 Box 1 — was
 * handled and NOT subscribed, and so were `account.updated`,
 * `checkout.session.completed` and `invoice.paid`; meanwhile
 * `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded`
 * and `charge.dispute.created` were subscribed with no branch to receive them.
 *
 * WHY THIS IS NOT "THE STRING charge.refunded APPEARS SOMEWHERE"
 * ─────────────────────────────────────────────────────────────
 * That gate would pass for a list that named the event while the switch had
 * dropped its branch, and for a switch that grew a branch nobody subscribed.
 * So the handled set is DERIVED from the real `case` labels inside
 * `handleWebhookEvent`, compared against the exported constant, and the
 * provisioning site is checked to CONSUME that constant rather than restate
 * it — the only arrangement in which the two cannot drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STRIPE_CONNECT_WEBHOOK_EVENTS } from "../../server/services/stripeConnect";

const repoRoot = resolve(__dirname, "../..");
const connectSrc = readFileSync(resolve(repoRoot, "server/services/stripeConnect.ts"), "utf8");
const setupSrc = readFileSync(resolve(repoRoot, "server/routes-setup.ts"), "utf8");

/** The body of `handleWebhookEvent`, by brace matching from its signature. */
function handleWebhookEventBody(): string {
  const at = connectSrc.indexOf("async handleWebhookEvent(");
  if (at < 0) throw new Error("handleWebhookEvent not found — this gate is scanning the wrong thing");
  const open = connectSrc.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < connectSrc.length; i++) {
    const ch = connectSrc[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return connectSrc.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces in handleWebhookEvent");
}

/** Event types the dispatcher actually branches on. */
function handledEventTypes(): string[] {
  const body = handleWebhookEventBody();
  return [...body.matchAll(/^\s*case\s+"([^"]+)":/gm)].map((m) => m[1]);
}

describe("the endpoint can actually RECEIVE what it subscribes to", () => {
  /**
   * The first version of this file asserted that "charge.refunded" appears in
   * the provisioned `enabled_events`. It was green over a live defect: the
   * endpoint was created WITHOUT `connect: true`, which makes it an ACCOUNT
   * endpoint — it receives events for AcreOS's own platform account and nothing
   * whatsoever from connected accounts.
   *
   * Every event this dispatcher exists for is a connected-account event:
   * borrower card payments are DIRECT charges on the lender's account. So the
   * subscription list was correct, the handlers were wired, and not one event
   * could ever be delivered. Subscribing to an event on an endpoint that cannot
   * receive it is a list that looks right.
   *
   * That is CLAUDE.md's first law in miniature — the gate proved the SYMBOL
   * ("the string is in the array") where the defect was the SEMANTICS ("the
   * branch can fire"). These cases assert deliverability.
   */
  const SETUP = setupSrc;

  it("VACUITY: the provisioning call is found", () => {
    expect(SETUP, "webhookEndpoints.create moved — re-anchor this").toMatch(
      /stripe\.webhookEndpoints\.create\(/,
    );
  });

  it("creates a CONNECT endpoint, not an account endpoint", () => {
    const at = SETUP.indexOf("stripe.webhookEndpoints.create(");
    const call = SETUP.slice(at, SETUP.indexOf("});", at) + 3);
    expect(
      /connect:\s*true/.test(call),
      "the Connect webhook endpoint is provisioned without `connect: true`, so Stripe " +
        "creates an ACCOUNT endpoint. It will receive nothing from connected accounts — " +
        "which is every event this dispatcher handles, because borrower card payments are " +
        "direct charges on the lender's account. The handlers would be wired and never fed.",
    ).toBe(true);
  });

  it("does not treat an ACCOUNT endpoint at the same URL as already-registered", () => {
    // Otherwise a deployment provisioned before this fix reports "already
    // registered" forever and the dispatcher stays permanently unfed.
    expect(SETUP).toMatch(/ACCOUNT endpoint, not a\s*\n?\s*"?\s*Connect endpoint|is an ACCOUNT endpoint/);
    expect(SETUP).toMatch(/accountEndpointAtSameUrl/);
  });
});

describe("the Connect webhook subscription mirrors the Connect dispatcher", () => {
  it("VACUITY: the scan finds a real dispatcher with real branches", () => {
    // If the extraction ever silently returns nothing, every set comparison
    // below passes on empty inputs. Pin real, non-empty structure first.
    const body = handleWebhookEventBody();
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain("default:");
    const handled = handledEventTypes();
    expect(handled.length).toBeGreaterThanOrEqual(7);
    expect(handled).toContain("checkout.session.completed");
    expect(new Set(handled).size).toBe(handled.length); // no duplicate branches
  });

  it("subscribes to exactly the events the dispatcher handles — no more, no less", () => {
    const handled: string[] = [...handledEventTypes()].sort();
    // Widened deliberately: the constant is a readonly tuple of literals, and
    // comparing it against strings scraped from source is the whole point.
    const subscribed: string[] = [...STRIPE_CONNECT_WEBHOOK_EVENTS].sort();
    // Named explicitly so a failure says WHICH side drifted.
    expect(subscribed.filter((e) => !handled.includes(e))).toEqual([]); // subscribed, unhandled
    expect(handled.filter((e) => !subscribed.includes(e))).toEqual([]); // handled, undeliverable
    expect(subscribed).toEqual(handled);
  });

  it("includes charge.refunded — the branch that keeps refunded interest off Form 1098", () => {
    // The specific regression: handled, and previously undeliverable.
    expect(handledEventTypes()).toContain("charge.refunded");
    expect([...STRIPE_CONNECT_WEBHOOK_EVENTS] as string[]).toContain("charge.refunded");
  });

  it("provisions the endpoint FROM the constant, never from a restated list", () => {
    // Adoption, not just agreement: if routes-setup.ts goes back to its own
    // literal array, the two agree today and drift tomorrow. The whole point
    // of the constant is that the provisioning site consumes it.
    const create = setupSrc.slice(
      setupSrc.indexOf("stripe.webhookEndpoints.create("),
      setupSrc.indexOf("stripe.webhookEndpoints.create(") + 400,
    );
    expect(create).toContain("STRIPE_CONNECT_WEBHOOK_EVENTS");
    expect(create).toMatch(/enabled_events:\s*\[\s*\.\.\.STRIPE_CONNECT_WEBHOOK_EVENTS\s*\]/);
    // No hand-written event strings survive next to it.
    expect(create).not.toMatch(/enabled_events:\s*\[\s*"/);
  });

  it("points at the Connect route, so the dispatcher this mirrors is the right one", () => {
    expect(setupSrc).toContain("/api/stripe/connect/webhook");
  });
});
