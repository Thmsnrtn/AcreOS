/**
 * Tier 2C — server-side funnel truth.
 *
 * `trial_to_paid` and `first_value_reached` moved from spoofable /
 * ad-blockable client PostHog events to server-truth activation_events:
 *
 *   trial_to_paid       — Stripe webhook (processSubscriptionCheckoutCompleted),
 *                         where the money actually moves.
 *   first_value_reached — approval kernel at the org's first witnessed send
 *                         (the append-only pax_sends insert).
 *
 * Two layers of coverage:
 *   1. Behavioral — recordActivationEvent is first-occurrence idempotent on
 *      (organizationId, eventName) via ON CONFLICT DO NOTHING, exercised
 *      against an in-memory mock that honors the unique index.
 *   2. Structural — the emission sites are wired where they must be, and the
 *      client CanonicalEvent union can no longer express either event (the
 *      by-construction guard against re-introducing client emission). Source
 *      assertions follow the approvalKernel.test.ts readFileSync pattern.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mem = vi.hoisted(() => ({
  rows: [] as Array<{
    organizationId: number;
    userId: string | null;
    eventName: string;
    eventValue: Record<string, unknown>;
  }>,
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (vals: any) => ({
        onConflictDoNothing: async (_opts: unknown) => {
          // Honor the (organization_id, event_name) unique index.
          const dup = mem.rows.some(
            (r) =>
              r.organizationId === vals.organizationId &&
              r.eventName === vals.eventName,
          );
          if (!dup) mem.rows.push({ ...vals });
        },
      }),
    }),
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { recordActivationEvent } from "../../server/services/activation";
import { ACTIVATION_EVENTS } from "../../shared/schema";

const REPO_ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

beforeEach(() => {
  mem.rows = [];
});

describe("server-truth activation events", () => {
  it("trial_to_paid and first_value_reached are canonical ACTIVATION_EVENTS", () => {
    expect(ACTIVATION_EVENTS).toContain("trial_to_paid");
    expect(ACTIVATION_EVENTS).toContain("first_value_reached");
  });

  it("records trial_to_paid once per org — webhook retries cannot double-count", async () => {
    await recordActivationEvent({
      orgId: 7,
      userId: null,
      eventName: "trial_to_paid",
      eventValue: { stripeSubscriptionId: "sub_x", source: "webhook:checkout.session.completed" },
    });
    // Stripe redelivers webhooks; the second recording must be a no-op.
    await recordActivationEvent({
      orgId: 7,
      userId: null,
      eventName: "trial_to_paid",
      eventValue: { stripeSubscriptionId: "sub_x", source: "webhook:checkout.session.completed" },
    });

    const rows = mem.rows.filter((r) => r.eventName === "trial_to_paid");
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(7);
  });

  it("records first_value_reached once per org — only the FIRST witnessed send counts", async () => {
    await recordActivationEvent({
      orgId: 9,
      userId: "user_1",
      eventName: "first_value_reached",
      eventValue: { source: "pax_witnessed_send", toolName: "send_email", pendingActionId: 1 },
    });
    await recordActivationEvent({
      orgId: 9,
      userId: "user_1",
      eventName: "first_value_reached",
      eventValue: { source: "pax_witnessed_send", toolName: "send_email", pendingActionId: 2 },
    });

    const rows = mem.rows.filter((r) => r.eventName === "first_value_reached");
    expect(rows).toHaveLength(1);
    expect(rows[0].eventValue.pendingActionId).toBe(1);
  });

  it("different orgs each get their own first occurrence", async () => {
    await recordActivationEvent({ orgId: 1, eventName: "trial_to_paid" });
    await recordActivationEvent({ orgId: 2, eventName: "trial_to_paid" });
    expect(mem.rows.filter((r) => r.eventName === "trial_to_paid")).toHaveLength(2);
  });
});

describe("emission-site wiring (structural)", () => {
  it("the Stripe webhook emits trial_to_paid where the money moves", () => {
    const src = read("server/webhookHandlers.ts");
    expect(src).toContain("'trial_to_paid'");
    expect(src).toContain("recordActivationEventAsync");
  });

  it("the approval kernel emits first_value_reached at the witnessed send", () => {
    const src = read("server/services/approvalKernel.ts");
    expect(src).toContain('"first_value_reached"');
    expect(src).toContain("pax_witnessed_send");
  });

  it("the client CanonicalEvent union can no longer express either event", () => {
    const src = read("client/src/lib/analytics.ts");
    // The union is the block between `export type CanonicalEvent =` and the
    // terminating semicolon; neither event may appear as a union member.
    const unionMatch = src.match(/export type CanonicalEvent =([\s\S]*?);/);
    expect(unionMatch).not.toBeNull();
    expect(unionMatch![1]).not.toContain('"trial_to_paid"');
    expect(unionMatch![1]).not.toContain('"first_value_reached"');
  });

  it("the old client call sites were demoted to supplemental events", () => {
    const onboarding = read("client/src/hooks/use-onboarding.ts");
    expect(onboarding).not.toContain('trackCanonicalEvent("first_value_reached"');
    expect(onboarding).toContain('trackEvent("onboarding_completed"');

    // Wave 1.5 settings decomposition: the checkout-return effect moved
    // from the settings.tsx monolith into the routed Billing section.
    const settings = read("client/src/pages/settings/billing-section.tsx");
    expect(settings).not.toContain('trackCanonicalEvent("trial_to_paid"');
    expect(settings).toContain('trackEvent("stripe_checkout_return"');
  });
});
