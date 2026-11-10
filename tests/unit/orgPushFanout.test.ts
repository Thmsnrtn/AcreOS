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

vi.mock("../../server/db", () => ({
  db: {
    execute: (...args: unknown[]) => executeSpy(...args),
  },
}));

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
