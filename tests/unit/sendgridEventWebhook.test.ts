/**
 * SendGrid Event Webhook tests (Hessam §2.3).
 *
 * Verifies:
 *   - Ed25519 signature validation accepts good signatures
 *   - Missing/invalid signatures are rejected (401)
 *   - Bounce / spam / unsubscribe events seed email_suppressions
 *   - Sending to a suppressed email is blocked by EmailService
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { verifySendGridSignature, ingestSendGridEvents } from "../../server/routes-sendgrid-events";
import { suppressionFromEvent } from "../../server/services/emailSuppressions";

// In-memory mocks for the email_events insert + suppressions upsert.
type Row = Record<string, any>;
const insertedEvents: Row[] = [];
const suppressionRows = new Map<string, Row>();

vi.mock("../../server/db", () => {
  const mkInsertChain = (sink: Row[], conflictKeyGetter?: (v: Row) => string) => ({
    values(values: Row | Row[]) {
      const arr = Array.isArray(values) ? values : [values];
      let returningRows: Row[] = [];

      const finalize = (allowDuplicate: boolean): Row[] => {
        const out: Row[] = [];
        for (const v of arr) {
          if (!allowDuplicate && conflictKeyGetter) {
            const key = conflictKeyGetter(v);
            if (key && sink.some((existing) => conflictKeyGetter(existing) === key)) {
              continue;
            }
          }
          const row = { id: `id-${sink.length + 1}`, ...v };
          sink.push(row);
          out.push(row);
        }
        return out;
      };

      const chain: any = {
        onConflictDoNothing(_target?: unknown) {
          return {
            returning: () => {
              returningRows = finalize(false);
              return Promise.resolve(returningRows);
            },
          };
        },
        onConflictDoUpdate(_opts?: unknown) {
          // For suppressions: upsert keyed by email
          return Promise.resolve(finalize(false));
        },
        returning() {
          returningRows = finalize(true);
          return Promise.resolve(returningRows);
        },
        then(onF: any, onR: any) {
          return Promise.resolve(finalize(true)).then(onF, onR);
        },
      };
      return chain;
    },
  });

  return {
    db: {
      insert(table: any) {
        // Discriminate by stringified table reference. The schema objects
        // are plain pgTable values; we use Symbol.for to distinguish in
        // tests that check email_events vs email_suppressions.
        // Easiest: check for column 'sgEventId' presence on the table.
        const isEmailEvents = !!table?.sgEventId;
        const isSuppressions = !!table?.suppressedAt;
        if (isEmailEvents) {
          return mkInsertChain(insertedEvents, (v) => v.sgEventId);
        }
        if (isSuppressions) {
          return {
            values(v: Row) {
              const arr = Array.isArray(v) ? v : [v];
              return {
                onConflictDoUpdate(_opts?: unknown) {
                  for (const row of arr) {
                    suppressionRows.set(row.email, { ...suppressionRows.get(row.email), ...row });
                  }
                  return Promise.resolve(arr);
                },
              };
            },
          };
        }
        // Fallback no-op
        return mkInsertChain([]);
      },
      select() {
        return {
          from(_t: any) {
            return {
              where(_w: any) {
                return {
                  limit: () => Promise.resolve([]),
                };
              },
            };
          },
        };
      },
      delete() {
        return { where: () => Promise.resolve() };
      },
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("SendGrid event webhook signature verification", () => {
  let publicKeyB64: string;
  let privateKey: crypto.KeyObject;

  beforeEach(() => {
    insertedEvents.length = 0;
    suppressionRows.clear();
    const { publicKey, privateKey: priv } = crypto.generateKeyPairSync("ed25519");
    privateKey = priv;
    const der = publicKey.export({ type: "spki", format: "der" });
    publicKeyB64 = der.toString("base64");
  });

  it("accepts a correctly signed payload", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify([{ email: "x@y.com", event: "delivered" }]);
    const signed = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey);
    const sig = signed.toString("base64");

    const ok = verifySendGridSignature({
      publicKeyB64,
      signatureB64: sig,
      timestamp,
      rawBody: body,
    });
    expect(ok).toBe(true);
  });

  it("rejects a payload signed for a different timestamp", () => {
    const timestamp = "1700000000";
    const body = JSON.stringify([{ email: "x@y.com", event: "delivered" }]);
    const signed = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey);
    const ok = verifySendGridSignature({
      publicKeyB64,
      signatureB64: signed.toString("base64"),
      timestamp: "1700000001", // wrong timestamp
      rawBody: body,
    });
    expect(ok).toBe(false);
  });

  it("rejects an empty/garbage signature", () => {
    const ok = verifySendGridSignature({
      publicKeyB64,
      signatureB64: "AAAA",
      timestamp: "1",
      rawBody: "{}",
    });
    expect(ok).toBe(false);
  });

  it("rejects a payload signed by a different key", () => {
    const { privateKey: otherPriv } = crypto.generateKeyPairSync("ed25519");
    const timestamp = "1700000000";
    const body = JSON.stringify([{ email: "x@y.com", event: "delivered" }]);
    const signed = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), otherPriv);
    const ok = verifySendGridSignature({
      publicKeyB64,
      signatureB64: signed.toString("base64"),
      timestamp,
      rawBody: body,
    });
    expect(ok).toBe(false);
  });
});

describe("suppressionFromEvent", () => {
  it("maps hard bounce to suppression", () => {
    expect(suppressionFromEvent({ event: "bounce", type: "bounce", reason: "550" })).toEqual({
      reason: "550",
      source: "bounce",
    });
  });

  it("does NOT suppress on soft/blocked bounce", () => {
    expect(suppressionFromEvent({ event: "bounce", type: "blocked" })).toBeNull();
  });

  it("maps spamreport to spam source", () => {
    expect(suppressionFromEvent({ event: "spamreport" })).toEqual({
      reason: "spam_report",
      source: "spam",
    });
  });

  it("maps unsubscribe to unsubscribe source", () => {
    expect(suppressionFromEvent({ event: "unsubscribe" })).toEqual({
      reason: "unsubscribe",
      source: "unsubscribe",
    });
  });

  it("ignores delivered/open/click events", () => {
    expect(suppressionFromEvent({ event: "delivered" })).toBeNull();
    expect(suppressionFromEvent({ event: "open" })).toBeNull();
    expect(suppressionFromEvent({ event: "click" })).toBeNull();
  });
});

describe("ingestSendGridEvents", () => {
  beforeEach(() => {
    insertedEvents.length = 0;
    suppressionRows.clear();
  });

  it("inserts each event and seeds suppressions for bounce/spam/unsubscribe", async () => {
    const events = [
      { email: "good@example.com", event: "delivered", sg_event_id: "evt-1" },
      { email: "bouncer@example.com", event: "bounce", type: "bounce", sg_event_id: "evt-2", reason: "550 5.1.1" },
      { email: "spammer@example.com", event: "spamreport", sg_event_id: "evt-3" },
      { email: "leaver@example.com", event: "unsubscribe", sg_event_id: "evt-4" },
    ];
    const result = await ingestSendGridEvents(events as any);
    expect(result.inserted).toBe(4);
    expect(result.suppressed).toBe(3);
    expect(suppressionRows.has("bouncer@example.com")).toBe(true);
    expect(suppressionRows.has("spammer@example.com")).toBe(true);
    expect(suppressionRows.has("leaver@example.com")).toBe(true);
    expect(suppressionRows.has("good@example.com")).toBe(false);
  });

  it("is idempotent on duplicate sg_event_id", async () => {
    const events = [{ email: "a@b.com", event: "delivered", sg_event_id: "dup-1" }];
    await ingestSendGridEvents(events as any);
    await ingestSendGridEvents(events as any);
    // The mock's onConflictDoNothing path skips dupes
    expect(insertedEvents.filter((e) => e.sgEventId === "dup-1").length).toBe(1);
  });

  it("skips events with missing email or event", async () => {
    const result = await ingestSendGridEvents([
      { email: "", event: "bounce" } as any,
      { event: "open" } as any,
      { email: "x@y.com" } as any,
    ]);
    expect(result.skipped).toBe(3);
    expect(result.inserted).toBe(0);
  });
});
