/**
 * Connector webhook senders — Slack, Zapier, Make (server/services/connectors/executor.ts).
 *
 * Pax tools reach these three, and each posts to a webhook URL the customer
 * saved on the connector. Every request:
 *   - runs the shared outbound URL check (`validateUrl`) first, and a URL it
 *     does not accept is answered with a plain-words refusal and not fetched;
 *   - does not follow redirects (a 3xx is answered with a refusal);
 *   - is bounded by the customer webhook dispatcher's 10s timeout;
 *   - returns a result and never throws into the tool switch.
 *
 * The URL check is the real one; DNS, the connector store and `fetch` are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { judgeRefusal } from "../../shared/refusal/plainRefusal";

const H = vi.hoisted(() => ({ webhookUrl: "", lookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  default: { lookup: (...a: any[]) => H.lookup(...a) },
  lookup: (...a: any[]) => H.lookup(...a),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getPaxConnector: async () => ({
      status: "connected",
      credentialsEncrypted: JSON.stringify({ webhookUrl: H.webhookUrl }),
    }),
  },
}));
vi.mock("../../server/services/fieldEncryption", () => ({
  decryptCredentials: (s: string) => s,
}));

import { sendSlackMessage, triggerZapier, triggerMake } from "../../server/services/connectors/executor";

const ORG = { id: 7 } as any;
const PUBLIC_URL = "https://hooks.example.com/services/T/B/X";
const TIMEOUT_MS = 10_000;

const SENDERS = [
  { name: "Slack", send: () => sendSlackMessage(ORG, { message: "Deal #1 closed" }) },
  { name: "Zapier", send: () => triggerZapier(ORG, { data: { dealId: 1 } }) },
  { name: "Make", send: () => triggerMake(ORG, { data: { dealId: 1 } }) },
] as const;

const fetchMock = vi.fn();

beforeEach(() => {
  H.webhookUrl = PUBLIC_URL;
  H.lookup.mockReset();
  H.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function expectPlainRefusal(result: any) {
  expect(result.success).toBe(false);
  expect(judgeRefusal(String(result.error))).toEqual({ plain: true, problems: [] });
}

describe.each(SENDERS)("$name connector sender", ({ name, send }) => {
  it("does not fetch a private-address URL and answers with a plain refusal", async () => {
    H.webhookUrl = "http://10.0.0.5/hook";
    const result = await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expectPlainRefusal(result);
    expect(String((result as any).error)).toContain(`Nothing was sent to ${name}`);
  });

  it("does not fetch a hostname whose address resolves to a private range", async () => {
    H.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const result = await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expectPlainRefusal(result);
  });

  it("posts to a public URL with a timeout signal and without following redirects", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await send();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PUBLIC_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((result as any).success).toBe(true);
  });

  it("answers a redirect with a plain refusal instead of success", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/" } }),
    );
    const result = await send();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPlainRefusal(result);
    expect(String((result as any).error)).toContain("does not follow it");
  });

  it("stops waiting after 10s and answers with a plain refusal", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    let result: any;
    const run = send().then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    await run;
    expectPlainRefusal(result);
    expect(String(result.error)).toContain(`${name} did not answer within 10 seconds`);
  });

  it("returns a refusal rather than throwing when the connection fails", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const result = await send();
    expectPlainRefusal(result);
    expect(String((result as any).error)).not.toMatch(/ECONNREFUSED/);
  });
});
