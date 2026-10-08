import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import {
  buildSnsCanonicalString,
  verifySnsMessage,
  confirmSubscription,
  snsTopicAllowed,
  type PinnedSnsTopic,
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

const TOPIC = "arn:aws:sns:us-east-1:123456789012:ours";
/** Pinned the way production pins it: from the configured allowlist. */
function pinnedFor(arn: string): PinnedSnsTopic {
  process.env.SNS_TEST_TOPIC_ARNS = arn;
  const r = snsTopicAllowed(arn, "SNS_TEST_TOPIC_ARNS");
  delete process.env.SNS_TEST_TOPIC_ARNS;
  if (!r.ok) throw new Error(r.reason);
  return r.pinned;
}

describe("snsTopicAllowed", () => {
  afterEach(() => {
    delete process.env.SNS_TEST_TOPIC_ARNS;
  });

  it("pins the configured topic and its regional endpoint", () => {
    expect(pinnedFor(TOPIC)).toEqual({ topicArn: TOPIC, host: "sns.us-east-1.amazonaws.com" });
  });

  it("refuses an unlisted topic, and everything when nothing is configured", () => {
    process.env.SNS_TEST_TOPIC_ARNS = TOPIC;
    expect(snsTopicAllowed("arn:aws:sns:us-east-1:999:other", "SNS_TEST_TOPIC_ARNS").ok).toBe(false);
    expect(snsTopicAllowed(undefined, "SNS_TEST_TOPIC_ARNS").ok).toBe(false);
    delete process.env.SNS_TEST_TOPIC_ARNS;
    expect(snsTopicAllowed(TOPIC, "SNS_TEST_TOPIC_ARNS").ok).toBe(false);
  });
});

describe("confirmSubscription only ever makes the pinned topic's ConfirmSubscription call", () => {
  afterEach(() => _resetTestOverrides());
  const good = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=t`;

  it("refuses a SubscribeURL on a non-AWS host without fetching it", async () => {
    const confirmer = vi.fn(async () => {});
    _setSubscribeConfirmerForTests(confirmer);
    await expect(confirmSubscription("https://evil.example.com/confirm", pinnedFor(TOPIC))).rejects.toThrow(/not allowed/);
    expect(confirmer).not.toHaveBeenCalled();
  });

  it("refuses a non-HTTPS SubscribeURL", async () => {
    await expect(confirmSubscription(good.replace("https:", "http:"), pinnedFor(TOPIC))).rejects.toThrow(/not allowed/);
  });

  it("refuses anything but the pinned topic's ConfirmSubscription call on its regional endpoint", async () => {
    const confirmer = vi.fn(async () => {});
    _setSubscribeConfirmerForTests(confirmer);
    for (const bad of [
      good.replace("Action=ConfirmSubscription", "Action=Publish"),
      good.replace("amazonaws.com/?", "amazonaws.com/other?"),
      good.replace("https://", "https://user:pw@"),
      good.replace("amazonaws.com/", "amazonaws.com:8443/"),
      good.replace("sns.us-east-1", "sns.eu-west-1"),
      good.replace(encodeURIComponent(TOPIC), encodeURIComponent("arn:aws:sns:us-east-1:999:other")),
    ]) {
      await expect(confirmSubscription(bad, pinnedFor(TOPIC)), bad).rejects.toThrow(/not allowed/);
    }
    expect(confirmer).not.toHaveBeenCalled();
  });

  it("confirms the canonical call, rebuilt from the pinned topic and the token", async () => {
    const confirmer = vi.fn(async (_url: string) => {});
    _setSubscribeConfirmerForTests(confirmer);
    await confirmSubscription(`${good}&Extra=1`, pinnedFor(TOPIC));
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(confirmer.mock.calls[0][0]).toBe(good);
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
      TopicArn: TOPIC,
      SignatureVersion: "1",
      Signature: "",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef.pem",
      ...over,
    };
    const canonical = buildSnsCanonicalString(base);
    base.Signature = crypto.sign("RSA-SHA1", Buffer.from(canonical, "utf8"), privateKey).toString("base64");
    return base;
  }

  it("accepts a correctly signed message", async () => {
    const res = await verifySnsMessage(signed(), pinnedFor(TOPIC));
    expect(res.ok).toBe(true);
  });

  it("rejects a tampered message", async () => {
    const msg = signed();
    msg.Message = JSON.stringify({ notificationType: "Complaint" }); // changed after signing
    const res = await verifySnsMessage(msg, pinnedFor(TOPIC));
    expect(res.ok).toBe(false);
  });

  it("rejects missing required fields", async () => {
    const res = await verifySnsMessage({ Type: "Notification" } as SnsMessage, pinnedFor(TOPIC));
    expect(res.ok).toBe(false);
  });

  it("fetches the certificate only from the pinned region's endpoint, at SimpleNotificationService-<hex>.pem", async () => {
    const ok = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123abcd.pem";
    const fetcher = vi.fn(async (_url: string) => publicPem);
    _setCertFetcherForTests(fetcher);
    expect((await verifySnsMessage(signed({ SigningCertURL: ok }), pinnedFor(TOPIC))).ok).toBe(true);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([ok]);
    fetcher.mockClear();
    for (const bad of [
      "https://sns.us-east-1.amazonaws.com/anything.pem",
      "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123abcd.pem?x=1",
      "http://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123abcd.pem",
      "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-0123abcd.pem",
      "https://sns.us-east-1.amazonaws.com.example.com/SimpleNotificationService-0123abcd.pem",
      "https://sns.us-east-1.amazonaws.com:444/SimpleNotificationService-0123abcd.pem",
      "not a url",
    ]) {
      const res = await verifySnsMessage(signed({ SigningCertURL: bad }), pinnedFor(TOPIC));
      expect(res.ok, bad).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a SigningCertURL off the SNS certificate path without fetching it", async () => {
    const fetcher = vi.fn(async () => publicPem);
    _setCertFetcherForTests(fetcher);
    const res = await verifySnsMessage(signed({ SigningCertURL: "https://sns.us-east-1.amazonaws.com/whatever" }), pinnedFor(TOPIC));
    expect(res.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a message whose topic is not the pinned one", async () => {
    const res = await verifySnsMessage(signed({ TopicArn: "arn:aws:sns:us-east-1:999:other" }), pinnedFor(TOPIC));
    expect(res.ok).toBe(false);
  });

  it("rejects an unsupported SignatureVersion", async () => {
    const res = await verifySnsMessage(signed({ SignatureVersion: "9" }), pinnedFor(TOPIC));
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
