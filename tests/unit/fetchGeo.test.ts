import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  fetchGeo,
  GEO_USER_AGENT,
  __resetFetchGeoLimiters,
} from "../../server/services/providers/fetchGeo";

function mockResponse(status = 200, headers: Record<string, string> = {}): Response {
  return new Response("ok", { status, headers });
}

describe("fetchGeo", () => {
  beforeEach(() => {
    __resetFetchGeoLimiters();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a contactable AcreOS-DataBot User-Agent by default", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse(200));
    await fetchGeo("https://example.gov/x", { ratePerSec: 1000 });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("user-agent")).toBe(GEO_USER_AGENT);
    expect(GEO_USER_AGENT).toMatch(/^AcreOS-DataBot \(.+\)$/);
  });

  it("does not override a caller-supplied User-Agent", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse(200));
    await fetchGeo("https://example.gov/x", {
      headers: { "User-Agent": "Custom/1.0" },
      ratePerSec: 1000,
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("user-agent")).toBe("Custom/1.0");
  });

  it("passes an AbortSignal (timeout) on every attempt", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse(200));
    await fetchGeo("https://example.gov/x", { timeoutMs: 50, ratePerSec: 1000 });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries on a network/timeout error then succeeds", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(mockResponse(200));
    const res = await fetchGeo("https://example.gov/x", { retries: 2, ratePerSec: 1000 });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("down"));
    await expect(
      fetchGeo("https://example.gov/x", { retries: 1, ratePerSec: 1000 }),
    ).rejects.toThrow("down");
    expect(spy).toHaveBeenCalledTimes(2); // first attempt + 1 retry
  });

  it("retries on a 503 and honors a numeric Retry-After header", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockResponse(503, { "retry-after": "0" }))
      .mockResolvedValueOnce(mockResponse(200));
    const res = await fetchGeo("https://example.gov/x", { retries: 2, ratePerSec: 1000 });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns a non-retryable 404 without retrying", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse(404));
    const res = await fetchGeo("https://example.gov/x", { retries: 3, ratePerSec: 1000 });
    expect(res.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("blocks an SSRF URL (private/loopback) before fetching", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse(200));
    await expect(fetchGeo("https://10.0.0.1/internal")).rejects.toThrow(/SSRF/);
    await expect(fetchGeo("http://example.gov/x")).rejects.toThrow(/SSRF/); // non-https
    expect(spy).not.toHaveBeenCalled();
  });

  it("rate-limits per host: a tight budget slows concurrent calls", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => mockResponse(200));
    // capacity = ratePerSec*2 = 4 tokens for rate 2. Fire 6 -> the last two
    // must wait for the bucket to refill (~0.5s per token at 2/s).
    const start = Date.now();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        fetchGeo(`https://slowhost.gov/${i}`, { ratePerSec: 2, maxConcurrentPerHost: 10 }),
      ),
    );
    const elapsed = Date.now() - start;
    // 4 burst tokens immediate; remaining 2 need ~0.5s each at 2/s => >=~300ms.
    expect(elapsed).toBeGreaterThanOrEqual(300);
  });

  it("limits in-flight concurrency per host", async () => {
    let active = 0;
    let maxActive = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return mockResponse(200);
    });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        fetchGeo(`https://conc.gov/${i}`, {
          ratePerSec: 1000,
          maxConcurrentPerHost: 2,
        }),
      ),
    );
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
