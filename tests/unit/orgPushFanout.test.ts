/**
 * Push revival (autonomy gap slice 7): the three event families reach the
 * org's phones — org-scoped, best-effort, and a clean no-op when unconfigured.
 *
 * Behavioural here: the fan-out helper, the org-scoped sender, and the Pax
 * nudge creation point. The redemption job and the borrower ladder are pinned
 * in `pushFanoutCreationSites.test.ts` (their bodies need a full DB to run).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Rows the fake `push_subscriptions` table returns. */
let subscriptionRows: Array<Record<string, unknown>> = [];
let acceptingEndpoints = new Set<string>();
let vapidPresent = true;
const executeSpy = vi.fn();

vi.mock("../../server/db", () => {
  // Thenable chainable drizzle-select stub for the users preference read
  // (notificationPrefsService.getPushEligibility) — this suite assigns
  // `prefRows` per test. Real drizzle queries are thenable at every step (the
  // await may land on .where() with no .limit()), so the chain resolves
  // prefRows from any link. Assertions run on sends, not on this stub.
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(prefRows).then(resolve, reject);
  return {
    db: {
      execute: (...args: unknown[]) => executeSpy(...args),
      select: () => chain,
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/founder", () => ({
  isFounderUserId: () => false,
}));

const sendNotificationSpy = vi.fn(async (sub: { endpoint: string }) => {
  if (!acceptingEndpoints.has(sub.endpoint)) {
    const err: Error & { statusCode?: number } = new Error("rejected");
    err.statusCode = 500;
    throw err;
  }
  return { statusCode: 201 };
});

vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: (...args: [{ endpoint: string }]) => sendNotificationSpy(...args),
}));

/** Numbers bound as parameters in a drizzle `sql` template passed to db.execute. */
function boundNumbers(query: unknown): number[] {
  const chunks: unknown[] = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) => (c && typeof c === "object" && "value" in (c as object) ? (c as { value: unknown }).value : c))
    .filter((v): v is number => typeof v === "number");
}

const sub = (id: number, organizationId: number, userId: string, endpoint: string) => ({
  id,
  organizationId,
  userId,
  endpoint,
  p256dh: "k",
  auth: "a",
});

/** Rows the fake `users` table returns for the preference read: stored prefs per user. */
let prefRows: Array<{ id: string; notificationPrefs: Record<string, unknown> | null }> = [];
const prefRow = (id: string, notificationPrefs: Record<string, unknown> | null) => ({
  id,
  notificationPrefs,
});

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

beforeEach(() => {
  subscriptionRows = [];
  prefRows = [];
  acceptingEndpoints = new Set();
  vapidPresent = true;
  executeSpy.mockReset();
  executeSpy.mockImplementation(async () => ({ rows: subscriptionRows }));
  sendNotificationSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sendPushToOrg — org-scoped and honest", () => {
  it("queries ONLY the given org's subscriptions", async () => {
    const { sendPushToOrg } = await loadService();
    subscriptionRows = [sub(1, 3, "u1", "https://push.example/a")];
    acceptingEndpoints.add("https://push.example/a");

    const r = await sendPushToOrg(3, { title: "t", body: "b" });

    expect(r.status).toBe("delivered");
    expect(r.sent).toBe(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(boundNumbers(executeSpy.mock.calls[0][0])).toEqual([3]);
  });

  it("unconfigured VAPID is a clean no-op: no DB read, no send, no throw", async () => {
    vapidPresent = false;
    const { sendPushToOrg } = await loadService();
    subscriptionRows = [sub(1, 3, "u1", "https://push.example/a")];

    const r = await sendPushToOrg(3, { title: "t", body: "b" });

    expect(r).toEqual({ status: "not_configured", sent: 0, failed: 0 });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(sendNotificationSpy).not.toHaveBeenCalled();
  });

  it("sends the deep link in the service's payload shape", async () => {
    const { sendPushToOrg } = await loadService();
    subscriptionRows = [sub(1, 3, "u1", "https://push.example/a")];
    acceptingEndpoints.add("https://push.example/a");

    await sendPushToOrg(3, { title: "T", body: "B", url: "/finance", tag: "x" });

    const body = JSON.parse(String((sendNotificationSpy.mock.calls[0] as unknown[])[1]));
    expect(body).toMatchObject({ title: "T", body: "B", url: "/finance", tag: "x" });
  });

});

describe("sendPushToOrg — recipient gate (respect mute)", () => {
  it("a user the gate refuses is skipped; their device counts as neither sent nor failed", async () => {
    const { sendPushToOrg } = await loadService();
    subscriptionRows = [
      sub(1, 3, "uMuted", "https://push.example/muted"),
      sub(2, 3, "uOk", "https://push.example/ok"),
    ];
    acceptingEndpoints.add("https://push.example/muted");
    acceptingEndpoints.add("https://push.example/ok");

    const r = await sendPushToOrg(3, { title: "t", body: "b" }, {
      mayPushToUser: async () => new Map([["uMuted", false]]),
    });

    expect(r).toEqual({ status: "delivered", sent: 1, failed: 0 });
    expect(sendNotificationSpy).toHaveBeenCalledTimes(1);
    expect((sendNotificationSpy.mock.calls[0][0] as { endpoint: string }).endpoint).toBe(
      "https://push.example/ok",
    );
  });

  it("with every user refused the result is no_destination, not a silent success", async () => {
    const { sendPushToOrg } = await loadService();
    subscriptionRows = [sub(1, 3, "uMuted", "https://push.example/muted")];
    acceptingEndpoints.add("https://push.example/muted");

    const r = await sendPushToOrg(3, { title: "t", body: "b" }, {
      mayPushToUser: async () => new Map([["uMuted", false]]),
    });

    expect(r).toEqual({ status: "no_destination", sent: 0, failed: 0 });
    expect(sendNotificationSpy).not.toHaveBeenCalled();
  });

  it("a throwing gate fails OPEN: the send proceeds ungated and nothing throws", async () => {
    const { sendPushToOrg } = await loadService();
    subscriptionRows = [sub(1, 3, "u1", "https://push.example/a")];
    acceptingEndpoints.add("https://push.example/a");

    const r = await sendPushToOrg(3, { title: "t", body: "b" }, {
      mayPushToUser: async () => {
        throw new Error("prefs read exploded");
      },
    });

    expect(r).toEqual({ status: "delivered", sent: 1, failed: 0 });
  });
});

describe("pushOrgEvent — best effort", () => {
  const event = {
    family: "ladder_ready" as const,
    title: "t",
    body: "b",
    url: "/finance",
    tag: "k",
  };

  it("sends to the org it is given, carrying title/body/url/tag", async () => {
    subscriptionRows = [sub(1, 7, "u1", "https://push.example/a")];
    acceptingEndpoints.add("https://push.example/a");
    await loadService(); // resets modules + sets VAPID env; helper below imports the same fresh graph
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    const ok = await pushOrgEvent(7, event);

    expect(ok).toBe(true);
    expect(boundNumbers(executeSpy.mock.calls.at(-1)?.[0])).toEqual([7]);
    const body = JSON.parse(String((sendNotificationSpy.mock.calls[0] as unknown[])[1]));
    expect(body).toMatchObject({ title: "t", body: "b", url: "/finance", tag: "k" });
  });

  it("unconfigured VAPID resolves false without touching the DB or throwing", async () => {
    vapidPresent = false;
    await loadService();
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    await expect(pushOrgEvent(7, event)).resolves.toBe(false);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("a push-service failure never propagates", async () => {
    vi.resetModules();
    vi.doMock("../../server/services/pushNotificationService", () => ({
      sendPushToOrg: vi.fn(async () => {
        throw new Error("push transport exploded");
      }),
    }));
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    await expect(pushOrgEvent(7, event)).resolves.toBe(false);
    vi.doUnmock("../../server/services/pushNotificationService");
  });

  it("refuses a non-tenant org id instead of fanning out to nobody-knows-whom", async () => {
    vi.resetModules();
    const sendPushToOrg = vi.fn(async () => ({ status: "delivered", sent: 1, failed: 0 }));
    vi.doMock("../../server/services/pushNotificationService", () => ({ sendPushToOrg }));
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    expect(await pushOrgEvent(0, event)).toBe(false);
    expect(await pushOrgEvent(-1, event)).toBe(false);
    expect(await pushOrgEvent(Number.NaN, event)).toBe(false);
    expect(sendPushToOrg).not.toHaveBeenCalled();
    vi.doUnmock("../../server/services/pushNotificationService");
  });
});

describe("pushOrgEvent — stored preferences gate the fan-out (founder decision 2026-11-10: respect mute)", () => {
  const event = {
    family: "ladder_ready" as const, // maps to finance.payment_missed
    title: "t",
    body: "b",
    url: "/finance",
    tag: "k",
  };
  const twoUsers = () => {
    subscriptionRows = [
      sub(1, 7, "uMuted", "https://push.example/muted"),
      sub(2, 7, "uOk", "https://push.example/ok"),
    ];
    acceptingEndpoints.add("https://push.example/muted");
    acceptingEndpoints.add("https://push.example/ok");
  };
  const sentEndpoints = () =>
    sendNotificationSpy.mock.calls.map(
      (c) => (c[0] as unknown as { endpoint: string }).endpoint,
    );

  it("a globally muted user gets no push; an unmuted user in the same org still does", async () => {
    twoUsers();
    prefRows = [
      prefRow("uMuted", { globalMute: true }),
      prefRow("uOk", { globalMute: false }),
    ];
    await loadService();
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    const ok = await pushOrgEvent(7, event);

    expect(ok).toBe(true);
    expect(sentEndpoints()).toEqual(["https://push.example/ok"]);
  });

  it("push off for the family's event skips that family only — the same user receives another family", async () => {
    twoUsers();
    // uOk muted nothing; the second subscription belongs to a user who turned
    // push off for finance.payment_missed (the ladder family) only.
    subscriptionRows = [
      sub(1, 7, "uTyped", "https://push.example/typed"),
      sub(2, 7, "uOk", "https://push.example/ok"),
    ];
    prefRows = [
      prefRow("uTyped", { overrides: { "finance.payment_missed": { push: false } } }),
      prefRow("uOk", {}),
    ];
    await loadService();
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    expect(await pushOrgEvent(7, event)).toBe(true);
    expect(sentEndpoints()).toEqual(["https://push.example/ok"]);

    sendNotificationSpy.mockClear();
    expect(await pushOrgEvent(7, { ...event, family: "pax_nudge" })).toBe(true);
    expect(sentEndpoints().sort()).toEqual([
      "https://push.example/ok",
      "https://push.example/typed",
    ]);
  });

  it("an explicit push ON override beats a schema default of push OFF", async () => {
    // pax.ask_expired defaults push:false in the schema; ladder_ready's mapped
    // event (finance.payment_missed) defaults push:true — use the fan-out's own
    // resolution through getPushEligibility on pax.ask_expired directly.
    prefRows = [prefRow("uOn", { overrides: { "pax.ask_expired": { push: true } } })];
    await loadService();
    const { notificationPrefsService } = await import("../../server/services/notificationPreferences");

    const eligibility = await notificationPrefsService.getPushEligibility(["uOn"], "pax.ask_expired");

    expect(eligibility.get("uOn")).toBe(true);
  });

  it("pax_nudge: no override keeps the shipped push (family default ON), an explicit OFF is honoured", async () => {
    // pax.needs_you's schema default is push:false (it predates this lane's
    // proof), but slice 7 shipped urgent-nudge push live — the family default
    // keeps no-override users receiving, per the named divergence in
    // orgPushFanout. globalMute still wins over everything.
    subscriptionRows = [
      sub(1, 7, "uPlain", "https://push.example/plain"),
      sub(2, 7, "uOff", "https://push.example/off"),
      sub(3, 7, "uMuted", "https://push.example/muted"),
    ];
    acceptingEndpoints.add("https://push.example/plain");
    acceptingEndpoints.add("https://push.example/off");
    acceptingEndpoints.add("https://push.example/muted");
    prefRows = [
      prefRow("uPlain", {}),
      prefRow("uOff", { overrides: { "pax.needs_you": { push: false } } }),
      prefRow("uMuted", { globalMute: true }),
    ];
    await loadService();
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    expect(await pushOrgEvent(7, { ...event, family: "pax_nudge" })).toBe(true);
    expect(sentEndpoints()).toEqual(["https://push.example/plain"]);
  });

  it("a user with no stored preference row keeps the default and receives the push", async () => {
    subscriptionRows = [sub(1, 7, "uNew", "https://push.example/new")];
    acceptingEndpoints.add("https://push.example/new");
    prefRows = []; // no users row read back for uNew
    await loadService();
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    expect(await pushOrgEvent(7, event)).toBe(true);
    expect(sentEndpoints()).toEqual(["https://push.example/new"]);
  });

  it("when the only subscriber is muted, pushOrgEvent resolves false (nothing buzzed)", async () => {
    subscriptionRows = [sub(1, 7, "uMuted", "https://push.example/muted")];
    acceptingEndpoints.add("https://push.example/muted");
    prefRows = [prefRow("uMuted", { globalMute: true })];
    await loadService();
    const { pushOrgEvent } = await import("../../server/services/orgPushFanout");

    expect(await pushOrgEvent(7, event)).toBe(false);
    expect(sendNotificationSpy).not.toHaveBeenCalled();
  });
});

describe("Pax nudges fan out to the phone at creation", () => {
  const pushOrgEvent = vi.fn(async () => true);
  const insertValues = vi.fn(async () => undefined);

  async function loadNudges() {
    vi.resetModules();
    pushOrgEvent.mockClear();
    insertValues.mockClear();
    vi.doMock("../../server/services/orgPushFanout", () => ({ pushOrgEvent }));
    vi.doMock("../../server/db", () => ({
      db: { insert: () => ({ values: insertValues }) },
    }));
    vi.doMock("../../server/services/orgOperating", () => ({ orgMayActFilter: () => undefined }));
    vi.doMock("../../server/services/paxControls", () => ({ getPaxControls: async () => ({ paused: false }) }));
    vi.doMock("../../server/services/onboarding/sampleFilters", () => ({
      realDeal: () => undefined,
      realLead: () => undefined,
    }));
    vi.doMock("../../server/routes-ai", () => ({ pushObservationSSE: vi.fn() }));
    return import("../../server/services/paxNudges");
  }

  it("an urgent event card (payment.missed) pushes to ITS org, after the insert", async () => {
    const { handleDomainEvent } = await loadNudges();

    await handleDomainEvent({ organizationId: 42, eventType: "payment.missed", payload: { dealId: 9 } });

    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(pushOrgEvent).toHaveBeenCalledTimes(1);
    const [orgId, ev] = pushOrgEvent.mock.calls[0] as unknown as [number, Record<string, string>];
    expect(orgId).toBe(42);
    expect(ev.family).toBe("pax_nudge");
    expect(ev.url).toBe("/deals/9");
    expect(ev.body).toContain("Payment missed");
    expect(ev.title).toBeTruthy();
  });

  it("a non-urgent card (lead.created) is created but does NOT buzz a phone", async () => {
    const { handleDomainEvent } = await loadNudges();

    await handleDomainEvent({ organizationId: 42, eventType: "lead.created", payload: { leadId: 5 } });

    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(pushOrgEvent).not.toHaveBeenCalled();
  });

  it("an unknown event creates nothing and pushes nothing", async () => {
    const { handleDomainEvent } = await loadNudges();

    await handleDomainEvent({ organizationId: 42, eventType: "nope" });

    expect(insertValues).not.toHaveBeenCalled();
    expect(pushOrgEvent).not.toHaveBeenCalled();
  });

  it("a push failure does not fail or undo card creation", async () => {
    const { handleDomainEvent } = await loadNudges();
    pushOrgEvent.mockRejectedValueOnce(new Error("push down"));

    await expect(
      handleDomainEvent({ organizationId: 42, eventType: "lead.responded", payload: { leadId: 5 } }),
    ).resolves.toBeUndefined();

    expect(insertValues).toHaveBeenCalledTimes(1);
  });
});
