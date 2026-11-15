/**
 * SES webhook route — auth + the retry arc (no database needed).
 *
 * Only verifySnsMessage and snsTopicAllowed are mocked (signature crypto is
 * covered by the snsVerification tests). isReplay/releaseReplay are the REAL
 * in-memory guard, and ingestSesNotification is real; the suppression store is
 * a controllable stub here (the real-DB chain is sesSuppressionPath.realdb.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/autopilot/perception", () => ({ recordSense: vi.fn() }));
vi.mock("../../server/services/autopilot/experienceLog", () => ({ recordConsequenceByTarget: vi.fn() }));

const V = vi.hoisted(() => ({ sigOk: true }));
vi.mock("../../server/middleware/snsVerification", async (orig) => ({
  ...(await orig<typeof import("../../server/middleware/snsVerification")>()),
  verifySnsMessage: vi.fn(async () => (V.sigOk ? { ok: true } : { ok: false, reason: "bad signature" })),
  snsTopicAllowed: vi.fn(() => ({ ok: true, pinned: "arn:aws:sns:us-east-1:000000000000:ses-test" })),
}));

const S = vi.hoisted(() => ({ failWrites: false, suppressed: new Set<string>() }));
vi.mock("../../server/services/emailSuppressions", () => ({
  suppress: vi.fn(async (email: string) => {
    if (S.failWrites) throw new Error("db down");
    S.suppressed.add(email);
  }),
  recordSoftBounce: vi.fn(async () => {
    if (S.failWrites) throw new Error("db down");
    return { suppressed: false, strikes: 1 };
  }),
  alertFounderOnComplaint: vi.fn(async () => {}),
}));

import { registerSesEventRoutes, ingestSesNotification } from "../../server/routes-ses-events";
import { _resetReplayCache } from "../../server/middleware/snsVerification";

function handler() {
  const routes: Array<{ path: string; args: unknown[] }> = [];
  registerSesEventRoutes({ post: (path: string, ...args: unknown[]) => routes.push({ path, args }) } as never);
  const r = routes.find((x) => x.path === "/api/webhooks/ses/events")!;
  return r.args[r.args.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}
const bounce = (to: string) => ({
  notificationType: "Bounce",
  bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: to }] },
});
const envelope = (id: string, inner: unknown) =>
  JSON.stringify({ Type: "Notification", MessageId: id, TopicArn: "arn:aws:sns:us-east-1:000000000000:ses-test", Message: JSON.stringify(inner) });
async function post(id: string, inner: unknown) {
  const r = res();
  await handler()({ body: envelope(id, inner) }, r);
  return r;
}

beforeEach(() => {
  V.sigOk = true;
  S.failWrites = false;
  S.suppressed.clear();
  _resetReplayCache();
});

describe("SES events route", () => {
  it("a bad SNS signature gets 401 and suppresses nothing", async () => {
    V.sigOk = false;
    const r = await post("m-bad", bounce("nope@example.test"));
    expect(r.statusCode).toBe(401);
    expect(S.suppressed.size).toBe(0);
  });

  it("ingest no longer swallows a failed write (rethrows)", async () => {
    S.failWrites = true;
    await expect(ingestSesNotification(bounce("a@example.test"))).rejects.toThrow("db down");
  });

  it("write failure → non-200, nothing suppressed; retry of same MessageId then ingests", async () => {
    S.failWrites = true;
    const first = await post("m-1", bounce("a@example.test"));
    expect(first.statusCode).toBeGreaterThanOrEqual(500);
    expect(S.suppressed.has("a@example.test")).toBe(false);

    S.failWrites = false;
    const retry = await post("m-1", bounce("a@example.test"));
    expect(retry.statusCode).toBe(200);
    expect(retry.body.deduped).toBeUndefined();
    expect(S.suppressed.has("a@example.test")).toBe(true);
  });

  it("a retry after a SUCCESSFUL ingest is still deduped", async () => {
    const first = await post("m-2", bounce("b@example.test"));
    expect(first.statusCode).toBe(200);
    S.suppressed.clear();
    const again = await post("m-2", bounce("b@example.test"));
    expect(again.body).toEqual({ deduped: true });
    expect(S.suppressed.size).toBe(0); // not re-processed
  });
});

describe("FORMAT GAP (documented, not fixed)", () => {
  // The route reads `notificationType` (SES notification format). SES
  // EVENT-DESTINATION publishing uses `eventType` instead. Which format
  // production uses is unverifiable from the repo; accepting both is a design
  // call and is deliberately NOT built here. This pins the current behaviour.
  it("an event-destination-shaped payload (eventType) suppresses nothing", async () => {
    const r = await post("m-evt", {
      eventType: "Bounce",
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "gap@example.test" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body.suppressed).toBe(0);
    expect(S.suppressed.size).toBe(0);
  });
});
