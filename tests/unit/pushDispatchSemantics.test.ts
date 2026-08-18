/**
 * A push says what actually happened, and a person id is not a tenant scope.
 *
 * ── THE TWO DEFECTS THIS PINS ───────────────────────────────────────────────
 *
 * 1. ZERO RECIPIENTS WAS SUCCESS. `sendPushToUser`/`sendPushToPerson` returned
 *    `{ sent: 0, failed: 0 }` for four different situations — nobody had a
 *    device, the platform had no VAPID keys, the recipient was not ours to
 *    notify, or nothing was attempted — and every one of them read as a
 *    delivery. `atlasPendingConfirmationNudger` consumed exactly that: it
 *    stamped `pushedAt` on any call that did not THROW, so a founder who was
 *    never reachable was recorded as nudged and never nudged again. The
 *    suppressed retry is what made it durable rather than merely missed.
 *
 * 2. THE RECIPIENT WAS TAKEN ON TRUST. `sendPushToPerson(userId)` deliberately
 *    ignores organization scope, which makes its one argument the entire
 *    security boundary: whoever it names gets a notification on their phone.
 *    `team_members` is keyed (organization_id, user_id), so a person id is a
 *    GLOBAL identity spanning orgs — it is not a tenant scope and cannot stand
 *    in for one.
 *
 * ── WHERE THE SECOND ONE CAME FROM ──────────────────────────────────────────
 * Foundry hit the identical shape and named it well: "company authority is not
 * authority over any person's phone" (962ee94, 2026-08-17). Its gateway
 * established the COMPANY while `founder_id` arrived in the payload unchecked,
 * so a caller holding one company's authority could push to anybody's device.
 * Its fix requires the recipient to be the product's owner or an active team
 * member. The invariant transferred; the mechanism is AcreOS's own — this
 * channel exists only for the founder plane, so `isFounderUserId` is the check,
 * and `belongsToCompany`/`products`/`team_members` did not come with it.
 *
 * Foundry's same commit fixed the receipt lying when VAPID was unset. AcreOS's
 * `sendToSubscription` already returned false there, so only the CALLER-visible
 * half of that was missing: `not_configured` is now distinguishable from a
 * recipient-side failure, because the two call for different actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FOUNDER = "user_founder_1";
const STRANGER = "user_stranger_9";

/** Rows the fake `push_subscriptions` table returns, keyed loosely by SQL text. */
let subscriptionRows: Array<Record<string, unknown>> = [];
/** Endpoints the provider accepts; anything else "fails". */
let acceptingEndpoints = new Set<string>();
let vapidPresent = true;

vi.mock("../../server/db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: subscriptionRows })),
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/founder", () => ({
  isFounderUserId: (id: string | null | undefined) => id === FOUNDER,
}));

// The optional `web-push` package, stubbed at the specifier the service uses.
vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(async (sub: { endpoint: string }) => {
    if (!acceptingEndpoints.has(sub.endpoint)) {
      const err: Error & { statusCode?: number } = new Error("rejected");
      err.statusCode = 500;
      throw err;
    }
    return { statusCode: 201 };
  }),
}));

async function loadService() {
  vi.resetModules();
  if (vapidPresent) {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
  } else {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
  return import("../../server/services/pushNotificationService");
}

const sub = (id: number, organizationId: number, userId: string, endpoint: string) => ({
  id,
  organizationId,
  userId,
  endpoint,
  p256dh: "k",
  auth: "a",
});

beforeEach(() => {
  subscriptionRows = [];
  acceptingEndpoints = new Set();
  vapidPresent = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("a push reports what actually happened", () => {
  it("no registered device is `no_destination`, NOT a delivery", async () => {
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [];

    const r = await sendPushToPerson(FOUNDER, { title: "t", body: "b" });

    expect(r.status).toBe("no_destination");
    expect(r.sent).toBe(0);
    // The counts are unchanged — which is exactly why they could not be the
    // signal. `{sent:0,failed:0}` is what the nudger read as success.
    expect(r.failed).toBe(0);
  });

  it("an unconfigured platform is `not_configured`, distinct from a failure", async () => {
    vapidPresent = false;
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [sub(1, 3, FOUNDER, "https://push.example/a")];

    const r = await sendPushToPerson(FOUNDER, { title: "t", body: "b" });

    // Ours to fix, not the recipient's. Collapsing it into `failed` would send
    // an operator hunting for a broken device.
    expect(r.status).toBe("not_configured");
  });

  it("a real dispatch is `delivered`", async () => {
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [sub(1, 3, FOUNDER, "https://push.example/a")];
    acceptingEndpoints.add("https://push.example/a");

    const r = await sendPushToPerson(FOUNDER, { title: "t", body: "b" });

    expect(r.status).toBe("delivered");
    expect(r.sent).toBe(1);
  });

  it("every endpoint rejecting is `failed`, which is retryable — unlike `no_destination`", async () => {
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [sub(1, 3, FOUNDER, "https://push.example/a")];
    acceptingEndpoints.clear();

    const r = await sendPushToPerson(FOUNDER, { title: "t", body: "b" });

    expect(r.status).toBe("failed");
    expect(r.failed).toBe(1);
  });

  it("some accepting and some not is `partial` — the person probably saw it", async () => {
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [
      sub(1, 3, FOUNDER, "https://push.example/ok"),
      sub(2, 3, FOUNDER, "https://push.example/dead"),
    ];
    acceptingEndpoints.add("https://push.example/ok");

    const r = await sendPushToPerson(FOUNDER, { title: "t", body: "b" });

    expect(r.status).toBe("partial");
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
  });
});

describe("a person id is not a tenant scope", () => {
  it("reaches the founder's devices across EVERY org they belong to", async () => {
    // The multi-organization human the person/tenant distinction is about.
    // `team_members` is keyed (organization_id, user_id), so this is the normal
    // case, not an exotic one. All three rows are the same human's own devices,
    // so there is no other party for the payload to leak to.
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [
      sub(1, 3, FOUNDER, "https://push.example/laptop"),
      sub(2, 8, FOUNDER, "https://push.example/phone"),
      sub(3, 12, FOUNDER, "https://push.example/tablet"),
    ];
    acceptingEndpoints = new Set([
      "https://push.example/laptop",
      "https://push.example/phone",
      "https://push.example/tablet",
    ]);

    const r = await sendPushToPerson(FOUNDER, { title: "t", body: "b" });

    expect(r.status).toBe("delivered");
    expect(r.sent).toBe(3);
  });

  it("REFUSES a recipient who is not the founder, rather than returning a quiet zero", async () => {
    // The security boundary. Without this the one argument decides who gets a
    // notification on their phone, which is what "a caller cannot declare its
    // own safety" forbids. It must be distinguishable from `no_destination`:
    // one is a refusal, the other is an absence.
    const { sendPushToPerson } = await loadService();
    subscriptionRows = [sub(1, 3, STRANGER, "https://push.example/stranger")];
    acceptingEndpoints.add("https://push.example/stranger");

    const r = await sendPushToPerson(STRANGER, { title: "secret", body: "b" });

    expect(r.status).toBe("not_permitted");
    expect(r.sent).toBe(0);
  });

  it("the org-scoped sender still filters by org — person-global is the exception", async () => {
    // `sendPushToUser` keeps its tenant filter. The person-global path is a
    // deliberate, narrow escape hatch for the founder plane; it must not become
    // the way ordinary callers address people.
    const { sendPushToUser } = await loadService();
    subscriptionRows = [sub(1, 3, FOUNDER, "https://push.example/a")];
    acceptingEndpoints.add("https://push.example/a");

    const r = await sendPushToUser(3, FOUNDER, { title: "t", body: "b" });

    expect(r.status).toBe("delivered");
    expect(r.sent).toBe(1);
  });

  it("never depends on organization 0", async () => {
    // The original defect: org 0 cannot exist (organizations.id is a serial
    // starting at 1), so every founder push matched nothing. Pinned as a
    // SEMANTIC property — no literal 0 reaches a tenant filter — rather than by
    // forbidding a constant name, which is the mistake this repo keeps making.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../..");
    const code = (p: string) =>
      fs
        .readFileSync(path.join(root, p), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");

    for (const f of [
      "server/jobs/atlasPendingConfirmationNudger.ts",
      "server/jobs/founderChatBackgroundTaskRunner.ts",
    ]) {
      expect(
        /sendPushTo\w+\(\s*0\b/.test(code(f)),
        `${f} passes a literal 0 as a tenant id to a push sender`,
      ).toBe(false);
    }
  });
});
