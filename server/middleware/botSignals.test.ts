/**
 * botSignals tests — capture-only signup fingerprinting.
 *
 * Covers:
 *   - honeypot detection (field 'website' filled)
 *   - time-to-fill detection (< 2s suspicious)
 *   - crawler-UA detection
 *   - captcha gate when ENABLE_CAPTCHA=1
 *   - always-next-call (collection should never block legitimate signup)
 *
 * The db.insert call is mocked so the test stays a pure unit.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

const { insertSpy } = vi.hoisted(() => {
  return {
    insertSpy: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  };
});

vi.mock("../db", () => ({
  db: { insert: insertSpy },
}));

import { captureSignupSignals, requireCaptchaIfEnabled } from "./botSignals";

function mockReq(opts: {
  email?: string;
  website?: string;
  formRenderedAt?: number;
  ua?: string;
  ip?: string;
  captchaToken?: string;
} = {}): Request {
  return {
    body: {
      email: opts.email,
      website: opts.website,
      formRenderedAt: opts.formRenderedAt,
      captchaToken: opts.captchaToken,
    },
    headers: { "user-agent": opts.ua ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)" },
    ip: opts.ip ?? "203.0.113.20",
    socket: { remoteAddress: opts.ip ?? "203.0.113.20" },
  } as unknown as Request;
}

function mockRes(): { res: Response; getStatus: () => number; getBody: () => any } {
  let status = 200;
  let body: any = null;
  const res = {
    setHeader() { return this; },
    status(c: number) { status = c; (this as any).statusCode = c; return this; },
    json(b: any) { body = b; return this; },
    end() { return this; },
  } as unknown as Response;
  return { res, getStatus: () => status, getBody: () => body };
}

describe("captureSignupSignals", () => {
  beforeEach(() => {
    insertSpy.mockClear();
    insertSpy.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    delete process.env.ENABLE_CAPTCHA;
  });

  it("always calls next() on a clean signup", async () => {
    const req = mockReq({ email: "real@example.com", formRenderedAt: Date.now() - 8000 });
    const { res } = mockRes();
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      captureSignupSignals(req, res, () => {
        if (Date.now() - start > 100) reject(new Error("unexpected delay on clean signup"));
        else resolve();
      });
    });
    // db.insert was called (capture happens)
    expect(insertSpy).toHaveBeenCalled();
  });

  it("flags honeypot but still passes through (with delay)", async () => {
    const req = mockReq({
      email: "bot@example.com",
      website: "https://spam.example.com",
      formRenderedAt: Date.now() - 5000,
    });
    const { res } = mockRes();
    const start = Date.now();
    await new Promise<void>((resolve) => {
      captureSignupSignals(req, res, () => resolve());
    });
    // Honeypot delays for 500ms to avoid leaking detection signal.
    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
  });

  it("flags TTF < 2s", async () => {
    const req = mockReq({ email: "fast@example.com", formRenderedAt: Date.now() - 100 });
    const { res } = mockRes();
    await new Promise<void>((resolve) => {
      captureSignupSignals(req, res, () => resolve());
    });
    expect(insertSpy).toHaveBeenCalled();
    // Inspect the values() call payload
    const valuesArg = insertSpy.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesArg.isSuspicious).toBe(true);
    expect(valuesArg.reasons).toContain("ttf-too-fast");
  });

  it("flags known crawler UA", async () => {
    const req = mockReq({ email: "crawl@example.com", ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    const { res } = mockRes();
    await new Promise<void>((resolve) => {
      captureSignupSignals(req, res, () => resolve());
    });
    const valuesArg = insertSpy.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesArg.reasons).toContain("crawler-ua");
    expect(valuesArg.isSuspicious).toBe(true);
  });

  it("collapses signups behind one CGNAT IP into the same ip_bucket", async () => {
    // Two signups from same /24, distinct full IPs.
    for (const ip of ["100.64.5.10", "100.64.5.250"]) {
      const req = mockReq({ email: `u@example.com`, ip });
      const { res } = mockRes();
      await new Promise<void>((resolve) => {
        captureSignupSignals(req, res, () => resolve());
      });
    }
    const calls = insertSpy.mock.results.map((r) => r.value.values.mock.calls[0][0]);
    expect(calls[0].ipBucket).toBe("v4:100.64.5.0/24");
    expect(calls[1].ipBucket).toBe("v4:100.64.5.0/24");
  });
});

describe("requireCaptchaIfEnabled", () => {
  beforeEach(() => {
    delete process.env.ENABLE_CAPTCHA;
    delete process.env.CAPTCHA_SECRET_KEY;
  });

  it("noops when ENABLE_CAPTCHA is unset", async () => {
    const req = mockReq({ email: "x@x.com" });
    const { res } = mockRes();
    await new Promise<void>((resolve) => {
      requireCaptchaIfEnabled(req, res, () => resolve());
    });
    // pass-through; no status set
  });

  it("blocks when ENABLE_CAPTCHA=1 and no token + no secret", async () => {
    process.env.ENABLE_CAPTCHA = "1";
    const req = mockReq({ email: "x@x.com" });
    const wrap = mockRes();
    let nextCalled = false;
    await new Promise<void>((resolve) => {
      requireCaptchaIfEnabled(req, wrap.res, () => { nextCalled = true; resolve(); });
      setTimeout(resolve, 50);
    });
    // Without a token, the verifier returns false → 400.
    expect(wrap.getStatus()).toBe(400);
    expect(wrap.getBody().error).toBe("CAPTCHA_REQUIRED");
    expect(nextCalled).toBe(false);
  });
});
