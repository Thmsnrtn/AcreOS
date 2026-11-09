/**
 * Team notification sender (Slack / Teams) — outbound request behaviour.
 *
 * `dispatchTeamEvent` posts to the webhook URL an org admin saved in
 * Settings → Integrations. Each delivery:
 *   - runs the shared outbound URL check (`validateUrl`), the same check the
 *     customer webhook dispatcher runs per delivery, and records a URL it
 *     does not accept on the integration instead of fetching it;
 *   - does not follow redirects;
 *   - is bounded by the same 10s request timeout as the customer dispatcher;
 *   - never rejects, so the business operation that emitted the event
 *     (closing a deal, creating a lead or an offer) is unaffected.
 *
 * The URL check itself is the real one; only DNS, the database and `fetch`
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const H = vi.hoisted(() => ({
  rows: [] as any[],
  updates: [] as Array<Record<string, unknown>>,
  selectThrows: false,
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  default: { lookup: (...a: any[]) => H.lookup(...a) },
  lookup: (...a: any[]) => H.lookup(...a),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/storage", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (H.selectThrows) throw new Error("db unavailable");
          return H.rows;
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          H.updates.push(v);
        },
      }),
    }),
  },
}));

import { dispatchTeamEvent } from "../../server/services/teamWebhookDispatcher";

/** The customer webhook dispatcher's per-request bound. */
const TIMEOUT_MS = 10_000;

const fetchMock = vi.fn();

function integration(webhookUrl: string, provider = "slack") {
  return {
    id: 1,
    organizationId: 7,
    provider,
    webhookUrl,
    eventTypes: ["deal_closed"],
    isActive: true,
  };
}

const EVENT = { title: "Deal closed", body: "Deal #1 closed." };

function lastError(): unknown {
  const withError = H.updates.filter((u) => "lastError" in u);
  return withError.at(-1)?.lastError;
}

beforeEach(() => {
  H.rows = [];
  H.updates = [];
  H.selectThrows = false;
  H.lookup.mockReset();
  H.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dispatchTeamEvent — outbound URL check", () => {
  it("does not fetch a private-address URL and records why on the integration", async () => {
    H.rows = [integration("http://10.0.0.5/hook")];
    await expect(dispatchTeamEvent(7, "deal_closed", EVENT)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(lastError())).toMatch(/^Webhook URL not accepted/);
  });

  it("does not fetch a hostname whose address resolves to a private range", async () => {
    H.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    H.rows = [integration("https://hooks.example.com/services/T/B/X")];
    await dispatchTeamEvent(7, "deal_closed", EVENT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(lastError())).toMatch(/^Webhook URL not accepted/);
  });

  it("does not fetch a non-http(s) URL", async () => {
    H.rows = [integration("file:///etc/hosts")];
    await dispatchTeamEvent(7, "deal_closed", EVENT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers to a public URL with a timeout signal and without following redirects", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    H.rows = [integration("https://hooks.example.com/services/T/B/X")];
    await dispatchTeamEvent(7, "deal_closed", EVENT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/services/T/B/X");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(H.updates.at(-1)).toEqual(expect.objectContaining({ lastError: null }));
  });

  it("records a redirect response as an error and does not mark it delivered", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/" } }),
    );
    H.rows = [integration("https://hooks.example.com/services/T/B/X")];
    await dispatchTeamEvent(7, "deal_closed", EVENT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(lastError())).toMatch(/^HTTP 302/);
    expect(H.updates.some((u) => "lastDispatchedAt" in u)).toBe(false);
  });
});

describe("dispatchTeamEvent — request timeout", () => {
  it("aborts a request that does not answer within 10s and resolves with the timeout recorded", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    H.rows = [integration("https://hooks.example.com/services/T/B/X")];
    let settled = false;
    const run = dispatchTeamEvent(7, "deal_closed", EVENT).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await run;
    expect(settled).toBe(true);
    expect(String(lastError())).toMatch(/^Timed out after 10s/);
  });
});

describe("dispatchTeamEvent — failures stay out of the caller's way", () => {
  it("resolves when the integration lookup fails", async () => {
    H.selectThrows = true;
    await expect(dispatchTeamEvent(7, "deal_closed", EVENT)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves when the request itself fails, and records the error", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    H.rows = [integration("https://hooks.example.com/services/T/B/X", "teams")];
    await expect(dispatchTeamEvent(7, "deal_closed", EVENT)).resolves.toBeUndefined();
    expect(String(lastError())).toMatch(/ECONNREFUSED/);
  });
});
