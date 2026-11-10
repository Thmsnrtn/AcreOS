/**
 * PKG-6b — the SES suppression path, end to end against a REAL Postgres.
 *
 * Other suites mock emailSuppressions, so nothing proved the real chain:
 *   SES notification → real ingestSesNotification → real email_suppressions rows
 *   → real emailService.sendEmail filtering → SES. Only the SES client and the
 *   SNS signature/topic checks are mocked; no live sends, synthetic
 *   @example.test recipients only. Skips without ACREOS_REAL_DATABASE_URL (the
 *   route/retry arc that needs no DB lives in sesSuppressionRoute.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("sesSuppressionPath.realdb.test.ts");

vi.hoisted(() => {
  process.env.UNSUBSCRIBE_MAILTO = "unsubscribe@example.test";
});
vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/autopilot/perception", () => ({ recordSense: vi.fn() }));
vi.mock("../../server/services/autopilot/experienceLog", () => ({ recordConsequenceByTarget: vi.fn() }));

const sends = vi.hoisted(() => ({ raw: [] as string[] }));
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    async send(cmd: any) {
      if (cmd?.input?.RawMessage?.Data) sends.raw.push(Buffer.from(cmd.input.RawMessage.Data).toString("utf8"));
      return { MessageId: "m-1" };
    }
  },
  SendEmailCommand: class { constructor(public input: unknown) {} },
  SendRawEmailCommand: class { constructor(public input: unknown) {} },
  GetSendQuotaCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("../../server/storage", () => ({
  storage: new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) }),
  db: {},
}));
vi.mock("../../server/services/orgEmailIdentity", () => ({ getIdentityForSend: vi.fn().mockResolvedValue(null) }));
vi.mock("../../server/services/emailWarmup", () => ({ reserveSend: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://example.test/u/tok"),
}));

const V = vi.hoisted(() => ({ sigOk: true }));
vi.mock("../../server/middleware/snsVerification", async (orig) => ({
  ...(await orig<typeof import("../../server/middleware/snsVerification")>()),
  verifySnsMessage: vi.fn(async () => (V.sigOk ? { ok: true } : { ok: false, reason: "bad signature" })),
  snsTopicAllowed: vi.fn(() => ({ ok: true, pinned: "arn:aws:sns:us-east-1:000000000000:ses-test" })),
}));

const tag = `ses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const addr = (k: string) => `${tag}-${k}@example.test`;
const bounce = (type: string, ...to: string[]) => ({
  notificationType: "Bounce",
  bounce: { bounceType: type, bounceSubType: "General", bouncedRecipients: to.map((emailAddress) => ({ emailAddress })) },
});
const complaint = (to: string) => ({
  notificationType: "Complaint",
  complaint: { complainedRecipients: [{ emailAddress: to }], complaintFeedbackType: "abuse" },
});

describe.runIf(realDbAvailable)("SES suppression path (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  let ingest: typeof import("../../server/routes-ses-events").ingestSesNotification;
  let register: typeof import("../../server/routes-ses-events").registerSesEventRoutes;
  let emailService: typeof import("../../server/services/emailService").emailService;
  let db: typeof import("../../server/db").db;
  let table: typeof import("@shared/schema").emailSuppressions;
  let logger: typeof import("../../server/utils/logger").logger;
  let resetReplay: () => void;
  let eq: typeof import("drizzle-orm").eq;

  const row = async (email: string) => (await db.select().from(table).where(eq(table.email, email)))[0];
  const send = (to: string | string[]) =>
    emailService.sendEmail({ to, subject: "Synthetic", html: "<p>hi</p>", purpose: "system" } as never);

  beforeAll(async () => {
    ({ ingestSesNotification: ingest, registerSesEventRoutes: register } = await import("../../server/routes-ses-events"));
    ({ emailService } = await import("../../server/services/emailService"));
    ({ db } = await import("../../server/db"));
    ({ emailSuppressions: table } = await import("@shared/schema"));
    ({ logger } = await import("../../server/utils/logger"));
    ({ eq } = await import("drizzle-orm"));
    resetReplay = (await import("../../server/middleware/snsVerification"))._resetReplayCache;
  });
  afterAll(async () => {
    if (!db) return;
    const { like } = await import("drizzle-orm");
    await db.delete(table).where(like(table.email, `${tag}-%`));
  });
  beforeEach(() => {
    sends.raw.length = 0;
    V.sigOk = true;
    resetReplay();
    vi.mocked(logger.warn).mockClear();
    process.env.AWS_ACCESS_KEY_ID = "platform-key";
    process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
    process.env.AWS_SES_FROM_EMAIL = "no-reply@example.test";
  });

  it("VACUITY: an unsuppressed recipient really reaches SES", async () => {
    const r = await send(addr("clean"));
    expect(r.success).toBe(true);
    expect(sends.raw).toHaveLength(1);
  });

  it("Permanent bounce writes a hard suppression and the send makes zero SES calls", async () => {
    await ingest(bounce("Permanent", addr("hard").toUpperCase()));
    const r = await row(addr("hard"));
    expect(r).toMatchObject({ source: "bounce", bounceCategory: "hard" });
    const out = await send(addr("hard"));
    expect(out.success).toBe(false);
    expect(out.errorType).toBe("recipient_rejected");
    expect(sends.raw).toHaveLength(0);
  });

  it("mixed recipient lists are filtered, not blocked wholesale", async () => {
    await ingest(bounce("Permanent", addr("mixbad")));
    const out = await send([addr("mixbad"), addr("mixgood")]);
    expect(out.success).toBe(true);
    expect(sends.raw).toHaveLength(1);
    expect(sends.raw[0]).toContain(addr("mixgood"));
    expect(sends.raw[0]).not.toContain(addr("mixbad"));
  });

  it("soft bounces: 2 strikes still send, the 3rd suppresses", async () => {
    const e = addr("soft");
    for (const n of [1, 2]) {
      const res = await ingest(bounce("Transient", e));
      expect(res).toMatchObject({ softStrikes: 1, suppressed: 0 });
      expect((await row(e)).source).toBe("tracking");
      expect((await row(e)).softBounceCount).toBe(n);
      sends.raw.length = 0;
      expect((await send(e)).success).toBe(true);
      expect(sends.raw).toHaveLength(1);
    }
    expect(await ingest(bounce("Undetermined", e))).toMatchObject({ suppressed: 1 });
    expect(await row(e)).toMatchObject({ source: "bounce", softBounceCount: 3 });
    sends.raw.length = 0;
    expect((await send(e)).success).toBe(false);
    expect(sends.raw).toHaveLength(0);
  });

  it("a complaint suppresses AND raises the founder alert", async () => {
    await ingest(complaint(addr("spam")));
    expect(await row(addr("spam"))).toMatchObject({ source: "spam", bounceCategory: "complaint" });
    expect(vi.mocked(logger.warn).mock.calls.some(([, meta]: any) => meta?.metadata?.kind === "founder_alert" && meta.metadata.email === addr("spam"))).toBe(true);
    expect((await send(addr("spam"))).success).toBe(false);
    expect(sends.raw).toHaveLength(0);
  });

  it("a Delivery event suppresses nothing", async () => {
    const res = await ingest({ notificationType: "Delivery", delivery: { recipients: [addr("deliv")] } } as never);
    expect(res).toMatchObject({ suppressed: 0, softStrikes: 0 });
    expect(await row(addr("deliv"))).toBeUndefined();
    expect((await send(addr("deliv"))).success).toBe(true);
  });

  it("FORMAT GAP: an event-destination payload (eventType) writes no row", async () => {
    // Production format is unverifiable from the repo; dual-format acceptance
    // is a design call and is NOT built here. See also sesSuppressionRoute.test.ts.
    await ingest({ eventType: "Bounce", bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: addr("gap") }] } } as never);
    expect(await row(addr("gap"))).toBeUndefined();
  });

  describe("route + retry arc against the real store", () => {
    const handler = () => {
      const routes: Array<{ path: string; args: unknown[] }> = [];
      register({ post: (path: string, ...args: unknown[]) => routes.push({ path, args }) } as never);
      return routes[0].args[routes[0].args.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
    };
    const post = async (id: string, inner: unknown) => {
      const r: any = { statusCode: 200, body: undefined };
      r.status = (c: number) => ((r.statusCode = c), r);
      r.json = (b: unknown) => ((r.body = b), r);
      await handler()(
        { body: JSON.stringify({ Type: "Notification", MessageId: id, TopicArn: "arn:aws:sns:us-east-1:000000000000:ses-test", Message: JSON.stringify(inner) }) },
        r,
      );
      return r;
    };

    it("bad signature → 401, no row", async () => {
      V.sigOk = false;
      expect((await post(`${tag}-sig`, bounce("Permanent", addr("sig")))).statusCode).toBe(401);
      expect(await row(addr("sig"))).toBeUndefined();
    });

    it("forced DB failure → non-200 and not suppressed; retry of same MessageId suppresses; later replay is deduped", async () => {
      const e = addr("arc");
      const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
        throw new Error("forced db failure");
      });
      const first = await post(`${tag}-arc`, bounce("Permanent", e));
      spy.mockRestore();
      expect(first.statusCode).toBeGreaterThanOrEqual(500);
      expect(await row(e)).toBeUndefined();

      const retry = await post(`${tag}-arc`, bounce("Permanent", e));
      expect(retry.statusCode).toBe(200);
      expect(retry.body.deduped).toBeUndefined();
      expect(await row(e)).toMatchObject({ source: "bounce", bounceCategory: "hard" });

      // Successful ingest stays deduped: a replayed soft bounce is not re-counted.
      const s = addr("arcsoft");
      await post(`${tag}-arcsoft`, bounce("Transient", s));
      const dup = await post(`${tag}-arcsoft`, bounce("Transient", s));
      expect(dup.body).toEqual({ deduped: true });
      expect((await row(s)).softBounceCount).toBe(1);
    });
  });
});
