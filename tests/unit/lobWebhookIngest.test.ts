/**
 * Lob delivery-event ingest — signature verification + reachability.
 *
 * Wave B ("Wire the engine", 2026-07-29) added POST /api/webhooks/lob to fill
 * the piece timestamps (printed / in transit / delivered) that the In-Flight
 * tracker had been rendering over permanent NULLs. The 2026-07-29 completeness
 * audit found the route was MOUNTED but UNREACHABLE: `app.use("/api",
 * csrfProtection)` runs first and Lob, posting server-to-server, cannot carry
 * our double-submit token — so every real delivery event 403'd before the
 * handler saw it, and the timestamps would have stayed NULL forever while the
 * code that fills them looked complete.
 *
 * Two things are pinned here:
 *   1. the HMAC verification itself (it is the ONLY authentication this route
 *      has — a hole in it lets anyone fabricate deliveries for any campaign);
 *   2. structurally, that every /api/webhooks/* POST route in the codebase is
 *      CSRF-exempt, so the next external webhook cannot be added dead.
 *
 * No DATABASE_URL: both exports under test are pure, and the reachability
 * check reads source text.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { createHmac } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { verifyLobSignature, readLobEvent } from "../../server/routes/lob-webhooks";
import { isCsrfExemptPath } from "../../server/middleware/csrf";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const SECRET = "whsec_test_secret";

function sign(body: string, timestamp: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

describe("verifyLobSignature", () => {
  const now = 1_800_000_000_000;
  const ts = String(now);
  const body = JSON.stringify({ event_type: { id: "postcard.delivered" } });

  it("accepts a correctly signed, fresh post", () => {
    expect(
      verifyLobSignature({
        secret: SECRET,
        signature: sign(body, ts),
        timestamp: ts,
        rawBody: Buffer.from(body),
        now,
      }),
    ).toBeNull();
  });

  it("rejects everything when no secret is configured", () => {
    // The dangerous default. An unauthenticated writer into the attribution
    // tables could fabricate deliveries, so "no secret" must mean "no ingest",
    // never "accept anything".
    expect(
      verifyLobSignature({
        secret: undefined,
        signature: sign(body, ts),
        timestamp: ts,
        rawBody: Buffer.from(body),
        now,
      }),
    ).toBe("webhook_secret_not_configured");
  });

  it("rejects a wrong signature, a wrong-key signature, and a tampered body", () => {
    expect(
      verifyLobSignature({ secret: SECRET, signature: "deadbeef", timestamp: ts, rawBody: body, now }),
    ).toBe("signature_mismatch");
    expect(
      verifyLobSignature({
        secret: SECRET,
        signature: sign(body, ts, "another_secret"),
        timestamp: ts,
        rawBody: body,
        now,
      }),
    ).toBe("signature_mismatch");
    expect(
      verifyLobSignature({
        secret: SECRET,
        signature: sign(body, ts),
        timestamp: ts,
        rawBody: body.replace("delivered", "returned_to_sender"),
        now,
      }),
    ).toBe("signature_mismatch");
  });

  it("rejects missing headers and a missing raw body", () => {
    expect(
      verifyLobSignature({ secret: SECRET, signature: undefined, timestamp: ts, rawBody: body, now }),
    ).toBe("missing_signature_headers");
    expect(
      verifyLobSignature({ secret: SECRET, signature: sign(body, ts), timestamp: undefined, rawBody: body, now }),
    ).toBe("missing_signature_headers");
    // A missing rawBody means the body parser is misconfigured — verifying
    // against a re-serialised object would be verifying nothing.
    expect(
      verifyLobSignature({ secret: SECRET, signature: sign(body, ts), timestamp: ts, rawBody: undefined, now }),
    ).toBe("missing_raw_body");
  });

  it("rejects a replayed (stale) timestamp", () => {
    const oldTs = String(now - 10 * 60 * 1000);
    expect(
      verifyLobSignature({
        secret: SECRET,
        signature: sign(body, oldTs),
        timestamp: oldTs,
        rawBody: body,
        now,
      }),
    ).toBe("stale_timestamp");
  });

  it("rejects a non-numeric timestamp", () => {
    expect(
      verifyLobSignature({ secret: SECRET, signature: sign(body, "nope"), timestamp: "nope", rawBody: body, now }),
    ).toBe("invalid_timestamp");
  });
});

describe("readLobEvent", () => {
  it("normalises the resource-prefixed event id and reads the piece reference", () => {
    const parsed = readLobEvent({
      event_type: { id: "postcard.processed_for_delivery" },
      reference_id: "psc_abc123",
      date_created: "2026-07-20T12:00:00.000Z",
      body: { id: "psc_abc123", expected_delivery_date: "2026-07-24" },
    });
    expect(parsed.eventType).toBe("processed_for_delivery");
    expect(parsed.providerPieceId).toBe("psc_abc123");
    expect(parsed.occurredAt.toISOString()).toBe("2026-07-20T12:00:00.000Z");
    expect(parsed.expectedDeliveryAt?.toISOString().slice(0, 10)).toBe("2026-07-24");
  });

  it("falls back to the resource id and never invents a piece reference", () => {
    const parsed = readLobEvent({ event_type: { id: "letter.mailed" }, body: { id: "ltr_9" } });
    expect(parsed.eventType).toBe("mailed");
    expect(parsed.providerPieceId).toBe("ltr_9");

    const empty = readLobEvent({});
    expect(empty.eventType).toBeNull();
    expect(empty.providerPieceId).toBeNull();
    expect(empty.expectedDeliveryAt).toBeNull();
  });

  it("ignores an unparseable date rather than emitting an Invalid Date", () => {
    const parsed = readLobEvent({ event_type: { id: "postcard.delivered" }, reference_id: "p1", date_created: "not-a-date" });
    expect(Number.isNaN(parsed.occurredAt.getTime())).toBe(false);
  });
});

describe("external webhook routes are reachable (CSRF exemption)", () => {
  const SERVER_DIR = resolve(__dirname, "../../server");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full, out);
        continue;
      }
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  const webhookRoutes: Array<{ file: string; path: string }> = [];
  for (const file of walk(SERVER_DIR)) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/\bapp\.post\(\s*["'](\/api\/webhooks\/[^"']+)["']/g)) {
      webhookRoutes.push({ file, path: m[1] });
    }
  }

  it("finds webhook routes at all (guards the guard)", () => {
    expect(webhookRoutes.length).toBeGreaterThan(0);
  });

  it("every /api/webhooks POST route is CSRF-exempt", () => {
    // csrfProtection is mounted at /api, so express strips the prefix before
    // the exemption check — entries are written WITHOUT /api. Route params are
    // instantiated with a concrete segment, which is what a real post carries.
    const missing = webhookRoutes
      .filter(
        ({ path }) =>
          !isCsrfExemptPath(path.replace(/^\/api/, "").replace(/:[A-Za-z0-9_]+/g, "sample")),
      )
      .map(({ file, path }) => `${path} (${file})`);
    expect(
      missing,
      `These external webhook routes are mounted but every POST to them 403s ` +
        `at the CSRF middleware before reaching the handler — a third party ` +
        `cannot supply our double-submit token. Add the /api-stripped path to ` +
        `CSRF_EXEMPT_PATHS in server/middleware/csrf.ts:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
