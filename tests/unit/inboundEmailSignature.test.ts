import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

import {
  verifyInboundEmailSignature,
  isReplay,
  _resetReplayCache,
  _setCertFetcherForTests,
  _setSubscribeConfirmerForTests,
  _resetTestOverrides,
} from "../../server/middleware/inboundEmailSignature";

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function mockRes(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn();
  const json = vi.fn();
  const res = {
    status: status.mockImplementation(() => res),
    json: json.mockImplementation(() => res),
  } as unknown as Response;
  return { res, status, json };
}

function mockNext(): NextFunction & { called: boolean } {
  const fn = vi.fn() as unknown as NextFunction & { called: boolean };
  return fn;
}

function makeHmacReq(opts: {
  body: unknown;
  secret: string;
  timestamp?: number;
  tamperBody?: boolean;
}): Request {
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const raw = Buffer.from(JSON.stringify(opts.body));
  const signed = opts.tamperBody ? Buffer.from(JSON.stringify({ ...(opts.body as object), evil: 1 })) : raw;
  const signature = crypto
    .createHmac("sha256", opts.secret)
    .update(`${ts}.`)
    .update(signed)
    .digest("hex");

  return {
    headers: {
      "x-acreos-timestamp": ts,
      "x-acreos-signature": signature,
    },
    body: opts.body,
    rawBody: raw,
  } as unknown as Request;
}

// ────────────────────────────────────────────────────────────────────────
// HMAC fallback tests
// ────────────────────────────────────────────────────────────────────────

describe("verifyInboundEmailSignature — HMAC fallback", () => {
  const secret = "super-secret-test-key-with-enough-entropy-1234";
  const validEmail = {
    from: "sender@example.com",
    to: "inbox+1-abcdef@replies.acreos.io",
    subject: "Re: deal",
    textBody: "hello",
    messageId: `<msg-${Math.random().toString(36).slice(2)}@example.com>`,
  };

  beforeEach(() => {
    _resetReplayCache();
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  });

  it("accepts a properly signed request and calls next()", async () => {
    const req = makeHmacReq({ body: validEmail, secret });
    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects an unsigned request with 401", async () => {
    const req = {
      headers: {},
      body: validEmail,
      rawBody: Buffer.from(JSON.stringify(validEmail)),
    } as unknown as Request;
    const { res, status, json } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/signature/i) }),
    );
  });

  it("rejects when env secret is missing (fail-closed)", async () => {
    delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    const req = makeHmacReq({ body: validEmail, secret });
    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects an expired timestamp (outside 5-min window)", async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 60 * 60; // 1h ago
    const req = makeHmacReq({ body: validEmail, secret, timestamp: oldTs });
    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    // Sign one body but send a different rawBody
    const sig = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.`)
      .update(Buffer.from(JSON.stringify({ from: "good@example.com" })))
      .digest("hex");
    const req = {
      headers: { "x-acreos-timestamp": ts, "x-acreos-signature": sig },
      body: { from: "evil@example.com" },
      rawBody: Buffer.from(JSON.stringify({ from: "evil@example.com" })),
    } as unknown as Request;
    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("drops a duplicate Message-ID as 200 dedup", async () => {
    const messageId = "<dup-msg@example.com>";
    const body = { ...validEmail, messageId };

    // First request
    const req1 = makeHmacReq({ body, secret });
    const r1 = mockRes();
    const n1 = mockNext();
    verifyInboundEmailSignature(req1, r1.res, n1);
    await new Promise((r) => setImmediate(r));
    expect(n1).toHaveBeenCalledTimes(1);

    // Second identical body, fresh timestamp + signature
    const req2 = makeHmacReq({ body, secret });
    const r2 = mockRes();
    const n2 = mockNext();
    verifyInboundEmailSignature(req2, r2.res, n2);
    await new Promise((r) => setImmediate(r));
    expect(n2).not.toHaveBeenCalled();
    expect(r2.status).toHaveBeenCalledWith(200);
    expect(r2.json).toHaveBeenCalledWith(expect.objectContaining({ deduped: true }));
  });
});

// ────────────────────────────────────────────────────────────────────────
// Replay cache primitives
// ────────────────────────────────────────────────────────────────────────

describe("isReplay", () => {
  beforeEach(() => _resetReplayCache());

  it("returns false on first sight then true on duplicate", () => {
    expect(isReplay("foo")).toBe(false);
    expect(isReplay("foo")).toBe(true);
    expect(isReplay("bar")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// SNS path tests — generate a real RSA key + signature so the verifier
// exercises the canonical-string + crypto.verify code paths.
// ────────────────────────────────────────────────────────────────────────

describe("verifyInboundEmailSignature — SNS path", () => {
  let publicPem: string;
  let privateKey: crypto.KeyObject;
  let publicKey: crypto.KeyObject;

  beforeEach(() => {
    _resetReplayCache();
    const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    publicKey = pub;
    privateKey = priv;
    publicPem = pub.export({ type: "spki", format: "pem" }).toString();

    // Override cert fetcher to return our generated public key (skips network).
    _setCertFetcherForTests(async () => publicPem);
    _setSubscribeConfirmerForTests(async () => {
      /* no-op for tests */
    });
  });

  afterEach(() => {
    _resetTestOverrides();
  });

  function buildCanonicalNotification(msg: {
    Message: string;
    MessageId: string;
    Subject?: string;
    Timestamp: string;
    TopicArn: string;
  }): string {
    const lines = ["Message", msg.Message, "MessageId", msg.MessageId];
    if (msg.Subject !== undefined) lines.push("Subject", msg.Subject);
    lines.push(
      "Timestamp",
      msg.Timestamp,
      "TopicArn",
      msg.TopicArn,
      "Type",
      "Notification",
    );
    return lines.join("\n") + "\n";
  }

  it("accepts a properly signed SNS Notification and forwards inner Message", async () => {
    const inner = {
      from: "sender@example.com",
      to: "inbox+1-abc@replies.acreos.io",
      subject: "Hello",
      textBody: "body",
      messageId: "<inner-1@x>",
    };
    const env = {
      Message: JSON.stringify(inner),
      MessageId: "sns-msg-1",
      Subject: "n/a",
      Timestamp: new Date().toISOString(),
      TopicArn: "arn:aws:sns:us-east-1:123:inbound-email",
    };
    const canonical = buildCanonicalNotification(env);
    const signature = crypto.sign("RSA-SHA1", Buffer.from(canonical, "utf8"), privateKey);

    const req = {
      headers: { "x-amz-sns-message-type": "Notification" },
      body: {
        Type: "Notification",
        ...env,
        SignatureVersion: "1",
        Signature: signature.toString("base64"),
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
      },
    } as unknown as Request;

    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    // allow async cert fetch + verify
    await new Promise((r) => setTimeout(r, 0));
    expect(next).toHaveBeenCalledTimes(1);
    // The middleware unwraps Message into req.body
    expect((req.body as { from: string }).from).toBe(inner.from);
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects an SNS message with a bad signature as 401", async () => {
    const env = {
      Message: JSON.stringify({ hello: "world" }),
      MessageId: "sns-msg-bad",
      Timestamp: new Date().toISOString(),
      TopicArn: "arn:aws:sns:us-east-1:123:inbound-email",
    };
    const req = {
      headers: { "x-amz-sns-message-type": "Notification" },
      body: {
        Type: "Notification",
        ...env,
        SignatureVersion: "1",
        // garbage signature
        Signature: Buffer.from("not-a-valid-signature").toString("base64"),
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
      },
    } as unknown as Request;
    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects an SNS SigningCertURL on a non-AWS host", async () => {
    // Restore the real cert fetcher so the host check runs.
    _resetTestOverrides();

    const env = {
      Message: JSON.stringify({ hello: "world" }),
      MessageId: "sns-msg-evil-host",
      Timestamp: new Date().toISOString(),
      TopicArn: "arn:aws:sns:us-east-1:123:inbound-email",
    };
    const canonical = buildCanonicalNotification(env);
    const signature = crypto.sign("RSA-SHA1", Buffer.from(canonical, "utf8"), privateKey);
    const req = {
      headers: { "x-amz-sns-message-type": "Notification" },
      body: {
        Type: "Notification",
        ...env,
        SignatureVersion: "1",
        Signature: signature.toString("base64"),
        SigningCertURL: "https://evil.attacker.com/cert.pem",
      },
    } as unknown as Request;
    const { res, status } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("auto-confirms SubscriptionConfirmation messages", async () => {
    const confirmer = vi.fn(async () => {});
    _setSubscribeConfirmerForTests(confirmer);

    const env = {
      Message: "You have chosen to subscribe...",
      MessageId: "sns-sub-1",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=xyz",
      Timestamp: new Date().toISOString(),
      Token: "tok",
      TopicArn: "arn:aws:sns:us-east-1:123:inbound-email",
    };
    // Build canonical for SubscriptionConfirmation
    const canonical = [
      "Message",
      env.Message,
      "MessageId",
      env.MessageId,
      "SubscribeURL",
      env.SubscribeURL,
      "Timestamp",
      env.Timestamp,
      "Token",
      env.Token,
      "TopicArn",
      env.TopicArn,
      "Type",
      "SubscriptionConfirmation",
    ].join("\n") + "\n";
    const signature = crypto.sign("RSA-SHA1", Buffer.from(canonical, "utf8"), privateKey);

    const req = {
      headers: { "x-amz-sns-message-type": "SubscriptionConfirmation" },
      body: {
        Type: "SubscriptionConfirmation",
        ...env,
        SignatureVersion: "1",
        Signature: signature.toString("base64"),
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
      },
    } as unknown as Request;
    const { res, status, json } = mockRes();
    const next = mockNext();
    verifyInboundEmailSignature(req, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmer).toHaveBeenCalledWith(env.SubscribeURL);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
  });

  it("dedupes a duplicate SNS MessageId", async () => {
    const env = {
      Message: JSON.stringify({ hello: "world" }),
      MessageId: "sns-msg-dup",
      Timestamp: new Date().toISOString(),
      TopicArn: "arn:aws:sns:us-east-1:123:inbound-email",
    };
    const canonical = buildCanonicalNotification(env);
    const signature = crypto.sign("RSA-SHA1", Buffer.from(canonical, "utf8"), privateKey);
    const body = {
      Type: "Notification",
      ...env,
      SignatureVersion: "1",
      Signature: signature.toString("base64"),
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
    };
    const headers = { "x-amz-sns-message-type": "Notification" };

    const req1 = { headers, body: { ...body } } as unknown as Request;
    const r1 = mockRes();
    const n1 = mockNext();
    verifyInboundEmailSignature(req1, r1.res, n1);
    await new Promise((r) => setTimeout(r, 0));
    expect(n1).toHaveBeenCalledTimes(1);

    const req2 = { headers, body: { ...body } } as unknown as Request;
    const r2 = mockRes();
    const n2 = mockNext();
    verifyInboundEmailSignature(req2, r2.res, n2);
    await new Promise((r) => setTimeout(r, 0));
    expect(n2).not.toHaveBeenCalled();
    expect(r2.status).toHaveBeenCalledWith(200);
    expect(r2.json).toHaveBeenCalledWith(expect.objectContaining({ deduped: true }));
  });
});
