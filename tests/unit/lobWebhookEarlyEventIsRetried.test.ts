/**
 * Quality directive 2026-09-29 (first-mail wedge) — a Lob delivery event is
 * not lost because it arrived before the piece's provider id was written back,
 * and Lob accepting a job is not "printed".
 *
 *  - The flusher writes provider ids after the whole send returns; Lob can
 *    post the first events before that. The webhook acknowledged an unmatched
 *    event (200, applied:false) — so Lob never retried, and the stage was
 *    lost for a piece that would have matched a minute later. A RECENT
 *    unmatched event now gets a retryable 503; an old one (another
 *    environment's mail) is still acknowledged.
 *  - `created` (and `rendered_pdf`) stamped printedAt. Neither is paper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";

const S = vi.hoisted(() => ({
  piece: null as null | { id: number; organizationId: number; shipmentId: number; status: string },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (S.piece ? [S.piece] : []) }) }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          S.updates.push(v);
        },
      }),
    }),
  },
}));

import { registerLobWebhookRoutes } from "../../server/routes/lob-webhooks";

const SECRET = "whsec_early";
function app() {
  const a = express();
  a.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  registerLobWebhookRoutes(a);
  return a;
}
function post(event: string, dateCreated: Date) {
  const body = JSON.stringify({ event_type: { id: `letter.${event}` }, reference_id: "ltr_1", date_created: dateCreated.toISOString() });
  const ts = String(Date.now());
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return request(app())
    .post("/api/webhooks/lob")
    .set("Content-Type", "application/json")
    .set("lob-signature", sig)
    .set("lob-signature-timestamp", ts)
    .send(body);
}

const prev = process.env.LOB_WEBHOOK_SECRET;
beforeEach(() => {
  process.env.LOB_WEBHOOK_SECRET = SECRET;
  S.piece = null;
  S.updates = [];
});
afterEach(() => {
  if (prev === undefined) delete process.env.LOB_WEBHOOK_SECRET;
  else process.env.LOB_WEBHOOK_SECRET = prev;
});

describe("an event that beats the provider-id write-back is retried, not lost", () => {
  it("recent + unmatched: 503 so Lob retries", async () => {
    const r = await post("mailed", new Date(Date.now() - 60_000));
    expect(r.status).toBe(503);
    expect(r.headers["retry-after"]).toBe("120");
    expect(S.updates).toEqual([]);
  });

  it("…and once the id is written, the retry applies", async () => {
    S.piece = { id: 1, organizationId: 5, shipmentId: 9, status: "sent" };
    const r = await post("mailed", new Date(Date.now() - 120_000));
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(true);
    expect(S.updates[0].status).toBe("in_transit");
  });

  it("old + unmatched (another environment's mail): acknowledged, not retried forever", async () => {
    const r = await post("mailed", new Date(Date.now() - 3 * 60 * 60 * 1000));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ applied: false, reason: "unknown_piece" });
  });
});

describe("accepted is not printed", () => {
  it("created confirms acceptance and stamps no printedAt", async () => {
    S.piece = { id: 1, organizationId: 5, shipmentId: 9, status: "pending" };
    await post("created", new Date());
    expect(S.updates[0].status).toBe("sent");
    expect(S.updates[0]).not.toHaveProperty("printedAt");
  });

  it("a later stage is never walked back by a late created event", async () => {
    S.piece = { id: 1, organizationId: 5, shipmentId: 9, status: "in_transit" };
    await post("created", new Date());
    expect(S.updates[0]).not.toHaveProperty("status");
  });
});
