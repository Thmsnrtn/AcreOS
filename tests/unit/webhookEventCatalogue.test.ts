/**
 * Six of the fifteen webhook events a customer could subscribe to did not exist.
 *
 * `server/services/webhookDispatcher.ts` declared a 36-member event union.
 * `client/src/pages/webhooks.tsx` offered a hand-written 15-event picker. They
 * overlapped by nine, so ticking `offer.accepted`, `offer.sent`,
 * `deal.status_changed`, `payment.late`, `property.updated` or `task.created`
 * stored a string nothing would ever match — and the panel showed it ticked.
 *
 * FOUR OF THE SIX WERE NEAR-MISS RENAMES of real events: the wire names are
 * `deal.offer_accepted`, `deal.offer_sent`, `deal.stage_changed` and
 * `payment.overdue`. That is what let it survive — the list looked right, every
 * name was plausible, and nothing anywhere compared the two.
 *
 * AND THEN THE LARGER FACT. Of the 36 declared events, exactly ONE has a
 * dispatch call site: `lead.created`, from `server/routes-leads.ts`. The
 * dispatcher exports five more convenience wrappers — webhookLeadStatusChanged,
 * webhookDealCreated, webhookDealStageChanged, webhookPaymentReceived,
 * webhookCampaignResponse — and **none of them is called from anywhere**. So
 * even after unit 41 made endpoints capable of firing, thirteen of the picker's
 * thirteen boxes but one describe an event that cannot arrive.
 *
 * The fix is not to hide them; a customer may reasonably subscribe now to
 * something that ships later, which is exactly what the workflow builder
 * allows. The fix is to SAY SO — the panel badges every non-live event — and to
 * make the liveness claim underivable from a hand-maintained list.
 *
 * THAT IS THE POINT OF THIS FILE. `CLAUDE.md` records the failure it exists to
 * prevent: Wave B wired four event lanes but added only one to
 * `shared/workflow-live-triggers.ts`, so six genuinely-firing triggers stayed
 * badged "Not yet live" and every agent involved reported success. The lesson
 * taken was that the live set must be DERIVED FROM CALL SITES, not listed. So
 * the assertions below derive the emitting set by scanning `server/` and
 * require `LIVE_WEBHOOK_EVENTS` to equal it exactly — in both directions. It
 * cannot go stale in either direction: shipping an emitter without updating the
 * catalogue fails, and claiming an event is live without an emitter fails.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
import {
  WEBHOOK_EVENT_IDS,
  WEBHOOK_EVENT_CHOICES,
  WEBHOOK_EVENT_GROUPS,
  LIVE_WEBHOOK_EVENTS,
  LEGACY_EVENT_RENAMES,
  LEGACY_EVENTS_DROPPED,
  isKnownWebhookEvent,
  isLiveWebhookEvent,
  normalizeSubscribedEvents,
} from "@shared/webhooks/catalogue";

const ROOT = path.resolve(__dirname, "../..");
const DISPATCHER = "server/services/webhookDispatcher.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/**
 * The events with a REAL dispatch call site, derived from source.
 *
 * Two ways an event reaches the wire, and both are followed:
 *   1. `dispatchWebhook(orgId, 'event.name', …)` directly.
 *   2. one of the dispatcher's convenience wrappers, each of which hardcodes
 *      exactly one event — so the wrapper counts only where it is CALLED, never
 *      where it is defined.
 *
 * Call sites inside the dispatcher module itself are excluded, because that is
 * where the wrappers are defined; counting them would make every wrapper look
 * live and defeat the entire check.
 */
function deriveLiveEvents(): { events: string[]; sites: Map<string, string[]> } {
  const dispatcherSrc = stripComments(
    fs.readFileSync(path.join(ROOT, DISPATCHER), "utf8"),
  );

  // wrapper name → the single event literal its body passes.
  const wrapperEvent = new Map<string, string>();
  const decl =
    /export async function (webhook\w+)\s*\([\s\S]{0,400}?dispatchWebhook\(\s*\w+\s*,\s*['"]([\w.]+)['"]/g;
  for (const m of dispatcherSrc.matchAll(decl)) wrapperEvent.set(m[1], m[2]);

  const sites = new Map<string, string[]>();
  const record = (event: string, where: string) => {
    if (!sites.has(event)) sites.set(event, []);
    if (!sites.get(event)!.includes(where)) sites.get(event)!.push(where);
  };

  for (const abs of walk(path.join(ROOT, "server"))) {
    const rel = path.relative(ROOT, abs);
    if (rel === DISPATCHER) continue;
    const src = stripComments(fs.readFileSync(abs, "utf8"));

    for (const m of src.matchAll(/dispatchWebhook\(\s*[\w.()]+\s*,\s*['"]([\w.]+)['"]/g)) {
      record(m[1], rel);
    }
    for (const [wrapper, event] of wrapperEvent) {
      // The CALL, not the import. `await webhookLeadCreated(org.id, lead)`.
      if (new RegExp(`\\b${wrapper}\\s*\\(`).test(src)) record(event, rel);
    }
  }
  return { events: [...sites.keys()].sort(), sites };
}

describe("the live set is derived from emitters, not maintained by hand", () => {
  const { events: derived, sites } = deriveLiveEvents();

  it("derives something at all (vacuity guard)", () => {
    // A derived ratchet that derives nothing green-lights anything. If the
    // dispatch call shape changes, this fails first and loudly.
    expect(
      derived.length,
      "no webhook dispatch call sites found in server/ — has the call shape changed?",
    ).toBeGreaterThan(0);
  });

  it("finds the wrapper definitions it relies on (vacuity guard)", () => {
    // The wrapper→event map is half the derivation. If the regex stopped
    // matching, every wrapper call site would silently stop counting.
    const dispatcherSrc = fs.readFileSync(path.join(ROOT, DISPATCHER), "utf8");
    expect(dispatcherSrc).toContain("export async function webhookLeadCreated");
    expect(
      derived.includes("lead.created"),
      "lead.created is dispatched from routes-leads.ts via webhookLeadCreated — " +
        "if this fails the wrapper derivation is broken, not the code",
    ).toBe(true);
  });

  it("LIVE_WEBHOOK_EVENTS is EXACTLY the derived set", () => {
    // Both directions on purpose. Wave B's defect was the missing direction:
    // it shipped emitters and left the list short, so real events stayed
    // badged "Not yet live" and every agent reported success.
    const listed = [...LIVE_WEBHOOK_EVENTS].sort();
    expect(
      listed,
      `Derived from call sites:\n` +
        derived.map((e) => `  ${e}  ← ${sites.get(e)!.join(", ")}`).join("\n") +
        `\n\nIf you wired a new emitter, add its event to LIVE_WEBHOOK_EVENTS in ` +
        `shared/webhooks/catalogue.ts (with the call site named in the comment). ` +
        `If you removed one, take it out — an event badged live that nothing ` +
        `emits promises a delivery that cannot happen.`,
    ).toEqual(derived);
  });

  it("isLiveWebhookEvent agrees with the derived set", () => {
    for (const e of derived) expect(isLiveWebhookEvent(e)).toBe(true);
    for (const e of WEBHOOK_EVENT_IDS.filter((x) => !derived.includes(x))) {
      expect(isLiveWebhookEvent(e), `${e} is badged live with no emitter`).toBe(false);
    }
  });

  it("every live event is in the vocabulary", () => {
    for (const e of LIVE_WEBHOOK_EVENTS) {
      expect(isKnownWebhookEvent(e), `${e} fires but is not a known event`).toBe(true);
    }
  });
});

/**
 * B8's ONE STANDING RULE, enforced (founder ruling 2026-08-13: keep deferring).
 *
 * There are two webhook rails. The legacy one — `organization_integrations.
 * credentials.endpoints`, 36 declared events, 3 in-process retries, no DLQ, no
 * delivery log — is mounted and emits exactly ONE event. The `server/api-v1/*`
 * rail — real `webhook_subscriptions` rows, 5 attempts with backoff, a DLQ, a
 * `webhook_delivery_log`, Stripe-style signatures — is complete and **entirely
 * unmounted**, which is the expansion ladder behaving correctly: *no public API
 * before ~50 customers*.
 *
 * Asked which rail survives, the founder ruled: **keep deferring.** The trigger
 * has not fired, and deferred infrastructure is not rot.
 *
 * That ruling has exactly one consequence for today's code, and B8 states it:
 * *"Do not wire the five uncalled convenience wrappers into product code before
 * this is decided. Adding emitters to the legacy rail is precisely the change
 * that would make it expensive to retire."* Every new emitter is another
 * integration to migrate on the day the better rail is mounted.
 *
 * So the emitter set is pinned at one. This is an INVERTED assertion, like
 * `FOUNDER_ROUTE_BASELINE`: it does not say the count is right, it says the
 * count must not grow without the decision being made. Wiring
 * `webhookDealCreated` — a two-line change that looks like an improvement —
 * fails here and asks for B8 instead.
 */
describe("the legacy rail does not grow emitters while B8 is deferred", () => {
  const { events: derived, sites } = deriveLiveEvents();

  it("still exactly one emitter, on the legacy rail", () => {
    expect(
      derived,
      `Derived from call sites:\n` +
        derived.map((e) => `  ${e}  ← ${sites.get(e)!.join(", ")}`).join("\n") +
        `\n\nA new emitter was wired onto the LEGACY webhook rail. That is the ` +
        `one change BLOCKERS B8 asks you not to make while the rail question is ` +
        `deferred (founder ruling 2026-08-13): every emitter is another live ` +
        `integration to migrate when the api-v1 rail — which already has ` +
        `retries, a DLQ and a delivery log — is mounted at the ~50-customer ` +
        `trigger.\n\nIf the event genuinely needs to fire now, say so in B8 and ` +
        `raise this list in the same commit. If the rail decision has been made, ` +
        `replace this check with the migration plan.`,
    ).toEqual(["lead.created"]);
  });

  it("the better rail is still unmounted, which is why the pin holds", () => {
    // The premise. If someone mounts registerPublicApiV1, the ladder trigger has
    // fired, the deferral is over, and this whole block should be revisited
    // rather than maintained out of habit.
    const routes = stripComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));
    expect(
      routes,
      "registerPublicApiV1 is mounted — the public API is live, so B8's " +
        "deferral has ended. Decide which rail owns customer webhooks and " +
        "replace the emitter pin above with the migration.",
    ).not.toContain("registerPublicApiV1(");
  });

  it("the five uncalled wrappers still exist, uncalled", () => {
    // Both directions. They are correct code and the survivor rail will want
    // their shapes; the rule is about CALLING them, not about keeping them.
    const dispatcher = fs.readFileSync(path.join(ROOT, DISPATCHER), "utf8");
    for (const w of [
      "webhookLeadStatusChanged",
      "webhookDealCreated",
      "webhookDealStageChanged",
      "webhookPaymentReceived",
      "webhookCampaignResponse",
    ]) {
      expect(dispatcher, `${w} was deleted — B8 defers the rail choice, it does ` +
        `not retire the wrappers`).toContain(`export async function ${w}`);
    }
  });
});

describe("the picker cannot offer an event the wire does not carry", () => {
  it("every offered event is in the vocabulary", () => {
    // The original defect, stated directly. Six of fifteen failed this.
    for (const c of WEBHOOK_EVENT_CHOICES) {
      expect(
        isKnownWebhookEvent(c.id),
        `the panel offers "${c.id}", which the dispatcher has never heard of — ` +
          `subscribing to it stores a string nothing will ever match`,
      ).toBe(true);
    }
  });

  it("offers a real choice (vacuity guard)", () => {
    expect(WEBHOOK_EVENT_CHOICES.length).toBeGreaterThan(5);
    expect(WEBHOOK_EVENT_GROUPS.length).toBeGreaterThan(1);
  });

  it("every offered event carries a label and a group", () => {
    for (const c of WEBHOOK_EVENT_CHOICES) {
      expect(c.label.length, `${c.id} has no label`).toBeGreaterThan(0);
      expect(c.group.length, `${c.id} has no group`).toBeGreaterThan(0);
    }
  });

  it("the client builds its picker FROM the catalogue", () => {
    // A source assertion because the defect was a second hand-written copy.
    // Nothing about the catalogue prevents someone pasting a new list beside it.
    const page = fs.readFileSync(
      path.join(ROOT, "client/src/pages/webhooks.tsx"),
      "utf8",
    );
    expect(page).toContain("@shared/webhooks/catalogue");
    expect(page).toContain("const ALL_EVENTS = WEBHOOK_EVENT_CHOICES;");
    const code = stripComments(page);
    expect(
      /id:\s*["']\w+\.\w+["']/.test(code),
      "the page declares event ids inline again — that is the second list this " +
        "catalogue exists to remove",
    ).toBe(false);
  });

  it("the panel badges what is not live", () => {
    const page = fs.readFileSync(
      path.join(ROOT, "client/src/pages/webhooks.tsx"),
      "utf8",
    );
    expect(page).toContain("isLiveWebhookEvent");
    expect(page).toContain("Not yet live");
  });
});

describe("names the old picker offered are repaired, not silently kept", () => {
  it("maps each near-miss rename onto a real event", () => {
    for (const [legacy, real] of Object.entries(LEGACY_EVENT_RENAMES)) {
      expect(isKnownWebhookEvent(legacy), `${legacy} is a real event, not a legacy name`).toBe(false);
      expect(isKnownWebhookEvent(real), `${legacy} maps to "${real}", which is not real either`).toBe(true);
    }
  });

  it("normalises a stored subscription to today's vocabulary", () => {
    expect(normalizeSubscribedEvents(["offer.accepted", "payment.late"])).toEqual([
      "deal.offer_accepted",
      "payment.overdue",
    ]);
  });

  it("drops only the names with no counterpart", () => {
    for (const e of LEGACY_EVENTS_DROPPED) {
      expect(isKnownWebhookEvent(e), `${e} has a real counterpart — map it instead of dropping it`).toBe(false);
      expect(LEGACY_EVENT_RENAMES[e]).toBeUndefined();
    }
    expect(normalizeSubscribedEvents(["property.updated", "lead.created"])).toEqual([
      "lead.created",
    ]);
  });

  it("KEEPS an unrecognised name rather than discarding it", () => {
    // This function repairs names THIS codebase got wrong. Something it simply
    // does not recognise is the customer's, and quietly deleting a customer's
    // configuration is a worse failure than leaving it unmatched.
    expect(normalizeSubscribedEvents(["something.custom"])).toEqual(["something.custom"]);
  });

  it("does not duplicate when a rename collides with the real name", () => {
    expect(normalizeSubscribedEvents(["offer.sent", "deal.offer_sent"])).toEqual([
      "deal.offer_sent",
    ]);
  });

  it("the save route refuses a genuinely unknown event", () => {
    const route = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-integrations.ts"), "utf8"),
    );
    const at = route.indexOf('api.put("/api/webhooks"');
    expect(at, "the webhook save route is gone — renamed?").toBeGreaterThan(-1);
    const handler = route.slice(at, at + 3000);
    expect(handler).toContain("isKnownWebhookEvent");
    expect(handler).toContain("Unknown webhook event(s)");
  });
});
