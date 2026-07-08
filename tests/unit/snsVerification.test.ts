import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import {
  buildSnsCanonicalString,
  verifySnsMessage,
  confirmSubscription,
  isReplay,
  _resetReplayCache,
  _setCertFetcherForTests,
  _setSubscribeConfirmerForTests,
  _resetTestOverrides,
  type SnsMessage,
} from "../../server/middleware/snsVerification";

describe("buildSnsCanonicalString", () => {
  it("orders Notification fields per the AWS spec (Subject included when present)", () => {
    const canonical = buildSnsCanonicalString({
      Type: "Notification",
      MessageId: "m1",
      Message: "hello",
      Subject: "subj",
      Timestamp: "2026-01-01T00:00:00.000Z",
      TopicArn: "arn:topic",
    } as SnsMessage);
    expect(canonical).toBe(
      ["Message", "hello", "MessageId", "m1", "Subject", "subj", "Timestamp", "2026-01-01T00:00:00.000Z", "TopicArn", "arn:topic", "Type", "Notification", ""].join("\n"),
    );
  });

  it("omits Subject when absent", () => {
    const canonical = buildSnsCanonicalString({
      Type: "Notification",
      MessageId: "m1",
      Message: "hello",
      Timestamp: "t",
      TopicArn: "arn",
    } as SnsMessage);
    expect(canonical).not.toContain("Subject");
  });

  it("throws on an unknown message type", () => {
    expect(() => buildSnsCanonicalString({ Type: "Nonsense" } as SnsMessage)).toThrow(/Unknown SNS/);
  });
});

describe("confirmSubscription host allowlist", () => {
  afterEach(() => _resetTestOverrides());

  it("rejects a SubscribeURL on a non-AWS host without fetching it", async () => {
    const confirmer = vi.fn(async () => {});
    _setSubscribeConfirmerForTests(confirmer);
    await expect(confirmSubscription("https://evil.attacker.com/confirm")).rejects.toThrow(/host not allowed/);
    expect(confirmer).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTPS SubscribeURL", async () => {
    await expect(confirmSubscription("http://sns.us-east-1.amazonaws.com/x")).rejects.toThrow();
  });

  it("confirms a valid sns.*.amazonaws.com SubscribeURL", async () => {
    const confirmer = vi.fn(async () => {});
    _setSubscribeConfirmerForTests(confirmer);
    await confirmSubscription("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=t");
    expect(confirmer).toHaveBeenCalledTimes(1);
  });
});

describe("verifySnsMessage", () => {
  let privateKey: crypto.KeyObject;
  let publicPem: string;

  beforeEach(() => {
    const { publicKey, privateKey: priv } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    privateKey = priv;
    publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    _setCertFetcherForTests(async () => publicPem);
  });
  afterEach(() => _resetTestOverrides());

  function signed(over: Partial<SnsMessage> = {}): SnsMessage {
    const base: SnsMessage = {
      Type: "Notification",
      MessageId: "m1",
      Message: JSON.stringify({ notificationType: "Bounce" }),
      Timestamp: "2026-01-01T00:00:00.000Z",
      TopicArn: "arn:topic",
      SignatureVersion: "1",
      Signature: "",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/c.pem",
      ...over,
    };
    const canonical = buildSnsCanonicalString(base);
    base.Signature = crypto.sign("RSA-SHA1", Buffer.from(canonical, "utf8"), privateKey).toString("base64");
    return base;
  }

  it("accepts a correctly signed message", async () => {
    const res = await verifySnsMessage(signed());
    expect(res.ok).toBe(true);
  });

  it("rejects a tampered message", async () => {
    const msg = signed();
    msg.Message = JSON.stringify({ notificationType: "Complaint" }); // changed after signing
    const res = await verifySnsMessage(msg);
    expect(res.ok).toBe(false);
  });

  it("rejects missing required fields", async () => {
    const res = await verifySnsMessage({ Type: "Notification" } as SnsMessage);
    expect(res.ok).toBe(false);
  });

  it("rejects an unsupported SignatureVersion", async () => {
    const res = await verifySnsMessage(signed({ SignatureVersion: "9" }));
    expect(res.ok).toBe(false);
  });
});

describe("isReplay", () => {
  beforeEach(() => _resetReplayCache());
  it("returns false then true on the same id", () => {
    expect(isReplay("x")).toBe(false);
    expect(isReplay("x")).toBe(true);
  });
});
