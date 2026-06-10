/**
 * T0-11 (2026-06-10) — SSRF guard on the jobQueue webhook handler.
 *
 * The handler previously fetched job.payload.url with no validation — a
 * queued job could reach cloud metadata or private ranges from the worker.
 * It now runs the shared validateUrl() guard (the same one used by
 * /api/webhooks/test and webhookDispatcher) and fails terminally on a
 * blocked URL (attempts pinned to maxAttempts → no retry storm).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleWebhookJob } from "../../server/jobs/webhookJobHandler";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeJob(url: string) {
  return {
    payload: { url, method: "POST", payload: { hello: "world" } },
    attempts: 1,
    maxAttempts: 3,
  };
}

describe("handleWebhookJob — SSRF guard", () => {
  it("blocks the AWS metadata endpoint and never touches the network", async () => {
    const job = makeJob("http://169.254.169.254/latest/meta-data/");
    await expect(handleWebhookJob(job)).rejects.toThrow(/SSRF guard/);
    expect(fetchMock).not.toHaveBeenCalled();
    // Terminal failure: attempts pinned so neither queue impl retries.
    expect(job.maxAttempts).toBe(job.attempts);
  });

  it("blocks private-range and loopback URLs", async () => {
    for (const url of [
      "http://10.0.0.5/internal",
      "http://192.168.1.1/admin",
      "http://127.0.0.1:8080/",
      "http://localhost:5432/",
    ]) {
      const job = makeJob(url);
      await expect(handleWebhookJob(job)).rejects.toThrow(/SSRF guard/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks non-http(s) schemes", async () => {
    const job = makeJob("file:///etc/passwd");
    await expect(handleWebhookJob(job)).rejects.toThrow(/SSRF guard/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still delivers to a public address", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    // Literal public IP — skips the DNS-rebinding lookup, no network needed.
    const job = makeJob("http://93.184.216.34/webhook");
    const result = await handleWebhookJob(job);
    expect(result).toEqual({ statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Retry budget untouched on the success path.
    expect(job.maxAttempts).toBe(3);
  });

  it("propagates HTTP failures as retryable errors (maxAttempts untouched)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" });
    const job = makeJob("http://93.184.216.34/webhook");
    await expect(handleWebhookJob(job)).rejects.toThrow(/HTTP 503/);
    expect(job.maxAttempts).toBe(3);
  });
});
