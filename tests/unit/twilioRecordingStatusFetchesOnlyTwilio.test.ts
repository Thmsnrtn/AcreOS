/**
 * POST /api/webhooks/twilio/recording-status downloads only a Twilio
 * recording. The real route (registerTwilioWebhookRoutes), signed the way
 * Twilio signs it; the database, dedup and transcriber are stubbed so the
 * assertion is purely "which URL, if any, was handed to the transcriber".
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";

const transcribeCall = vi.fn(async () => undefined);
vi.mock("../../server/services/voiceCallAI", () => ({ voiceCallAIService: { transcribeCall } }));
vi.mock("../../server/services/webhook-idempotency", () => ({
  withIdempotency: async () => ({ duplicate: false }),
}));
vi.mock("../../server/storage", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const chain: any = {};
  for (const m of ["select", "from", "where", "update", "set"]) chain[m] = () => chain;
  chain.limit = async () => [{ id: 7 }];
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(undefined).then(ok);
  return { ...actual, db: chain };
});

const TOKEN = "twilio-test-token";
const AC = "AC" + "0123456789abcdef".repeat(2);
const RE = "RE" + "fedcba9876543210".repeat(2);
const TWILIO_URL = `https://api.twilio.com/2010-04-01/Accounts/${AC}/Recordings/${RE}`;

let app: express.Express;
const saved = process.env.TWILIO_AUTH_TOKEN;

beforeAll(async () => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  const { registerTwilioWebhookRoutes } = await import("../../server/routes-misc");
  app = express();
  app.use(express.urlencoded({ extended: false }));
  await registerTwilioWebhookRoutes(app);
}, 120_000);

afterAll(() => {
  if (saved === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = saved;
});

beforeEach(() => transcribeCall.mockClear());

async function post(recordingUrl: string) {
  const params: Record<string, string> = {
    CallSid: "CA" + "1".repeat(32),
    RecordingSid: "RE" + crypto.randomBytes(16).toString("hex"),
    RecordingStatus: "completed",
    RecordingUrl: recordingUrl,
  };
  const path = "/api/webhooks/twilio/recording-status";
  const toSign =
    `http://twilio.test${path}` + Object.keys(params).sort().reduce((s, k) => s + k + params[k], "");
  const sig = crypto.createHmac("sha1", TOKEN).update(Buffer.from(toSign, "utf-8")).digest("base64");
  const res = await request(app)
    .post(path)
    .set("Host", "twilio.test")
    .set("X-Twilio-Signature", sig)
    .type("form")
    .send(new URLSearchParams(params).toString());
  // The route answers 200 first, then works; let it finish.
  await new Promise((r) => setTimeout(r, 50));
  return res;
}

describe("recording-status hands the transcriber only a Twilio recording URL", () => {
  it("a Twilio recording is transcribed from api.twilio.com as .mp3", async () => {
    const res = await post(TWILIO_URL);
    expect(res.status).toBe(200);
    expect(transcribeCall).toHaveBeenCalledWith(7, `${TWILIO_URL}.mp3`);
  });

  it("any other URL in a signed callback is never fetched", async () => {
    for (const bad of ["https://169.254.169.254/latest/meta-data", "https://example.com/a.mp3", `http://api.twilio.com/x`]) {
      const res = await post(bad);
      expect(res.status).toBe(200);
    }
    expect(transcribeCall).not.toHaveBeenCalled();
  });
});
