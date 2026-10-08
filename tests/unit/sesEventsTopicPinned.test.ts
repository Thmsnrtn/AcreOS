/**
 * POST /api/webhooks/ses/events accepts SNS messages only from OUR topics.
 *
 * A valid SNS signature identifies Amazon SNS as the sender, not which topic
 * the message belongs to. The route therefore accepts only the topic ARNs
 * configured for it (SES_EVENTS_SNS_TOPIC_ARNS), fail closed — the same
 * rule the inbound-email webhook applies (inboundEmailSignature.test.ts).
 *
 * The happy path is a Delivery notification, which implies no suppression and
 * so touches no table: the assertion is purely "did the route accept it".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { registerSesEventRoutes } from "../../server/routes-ses-events";
import {
  buildSnsCanonicalString,
  _resetReplayCache,
  _setCertFetcherForTests,
  _setSubscribeConfirmerForTests,
  _resetTestOverrides,
  type SnsMessage,
} from "../../server/middleware/snsVerification";

const OURS = "arn:aws:sns:us-east-1:123:ses-events";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signed(topicArn: string, messageId: string, type = "Notification"): SnsMessage {
  const msg = {
    Type: type,
    MessageId: messageId,
    Message: JSON.stringify({ notificationType: "Delivery" }),
    Timestamp: new Date().toISOString(),
    TopicArn: topicArn,
    ...(type === "SubscriptionConfirmation"
      ? { SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription", Token: "t" }
      : {}),
  } as SnsMessage;
  const signature = crypto.sign("RSA-SHA1", Buffer.from(buildSnsCanonicalString(msg), "utf8"), privateKey);
  return {
    ...msg,
    SignatureVersion: "1",
    Signature: signature.toString("base64"),
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
  } as SnsMessage;
}

let confirmed: string[] = [];
const app = express();
registerSesEventRoutes(app);

const post = (msg: SnsMessage) =>
  request(app).post("/api/webhooks/ses/events").set("Content-Type", "text/plain").send(JSON.stringify(msg));

beforeEach(() => {
  _resetReplayCache();
  confirmed = [];
  _setCertFetcherForTests(async () => publicPem);
  _setSubscribeConfirmerForTests(async (url) => {
    confirmed.push(url);
  });
  process.env.SES_EVENTS_SNS_TOPIC_ARNS = OURS;
});

afterEach(() => {
  _resetTestOverrides();
  delete process.env.SES_EVENTS_SNS_TOPIC_ARNS;
});

describe("SES events webhook: topic pinning", () => {
  it("accepts a signed notification from our own topic", async () => {
    const res = await post(signed(OURS, "m-ours"));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("refuses a validly signed notification from a foreign topic", async () => {
    const res = await post(signed("arn:aws:sns:us-east-1:999:not-ours", "m-foreign"));
    expect(res.status).toBe(401);
  });

  it("does not confirm a subscription request from a foreign topic", async () => {
    const res = await post(signed("arn:aws:sns:us-east-1:999:not-ours", "m-sub", "SubscriptionConfirmation"));
    expect(res.status).toBe(401);
    expect(confirmed).toEqual([]);
  });

  it("refuses everything when no topic allowlist is configured (fail closed)", async () => {
    delete process.env.SES_EVENTS_SNS_TOPIC_ARNS;
    const res = await post(signed(OURS, "m-unpinned"));
    expect(res.status).toBe(401);
  });

  it("still refuses a bad signature from our own topic", async () => {
    const msg = { ...signed(OURS, "m-badsig"), Signature: Buffer.from("nope").toString("base64") };
    const res = await post(msg as SnsMessage);
    expect(res.status).toBe(401);
  });
});
