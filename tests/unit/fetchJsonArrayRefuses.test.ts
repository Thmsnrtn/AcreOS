/**
 * The array helper 47 call sites use was the one doing the lying.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `client/src/lib/fetch-honesty.ts` was written to stop `if (!res.ok) return []`
 * — a line whose own docblock records what it cost: a customer with two hundred
 * parcels shown the NEW-USER ONBOARDING STATE during an API blip and invited to
 * add their first parcels.
 *
 * Four files adopted its helpers.
 *
 * `fetchJsonArray` in `client/src/lib/queryClient.ts` — 47 call sites across 15
 * files, in the same directory — did the opposite, and said so in its own
 * docstring: "empty fallback on network failure". A 500, an unparseable body
 * and an unrecognised shape all returned `[]`: "you have no deals", "no
 * results", "nothing in your pipeline", stated as fact out of a failure to read.
 *
 * That is the second law in CLAUDE.md exactly. Authoritative semantics with no
 * adoption is not canonical, and the surface everyone actually calls is the one
 * that decides product truth.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The distinction, in both directions. A failure must throw so react-query
 * lands in its error state; an EMPTY SUCCESSFUL RESPONSE must still return an
 * empty array, because that is a real answer and always was. A helper that
 * threw on both would be just as wrong, one register louder.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJsonArray } from "../../client/src/lib/queryClient";
import { RequestFailedError } from "../../client/src/lib/fetch-honesty";

function respond(status: number, body: unknown, raw?: string): Response {
  return new Response(status === 204 ? null : (raw ?? JSON.stringify(body)), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Replace global fetch for one assertion. */
function servesOnce(r: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => r),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJsonArray refuses rather than emptying", () => {
  it("returns the list on a 200", async () => {
    servesOnce(respond(200, [{ id: 1 }, { id: 2 }]));
    await expect(fetchJsonArray("/api/deals")).resolves.toHaveLength(2);
  });

  it("unwraps both envelope shapes this API uses", async () => {
    servesOnce(respond(200, { data: [{ id: 1 }] }));
    await expect(fetchJsonArray("/api/deals")).resolves.toHaveLength(1);
    servesOnce(respond(200, { items: [{ id: 1 }, { id: 2 }] }));
    await expect(fetchJsonArray("/api/deals")).resolves.toHaveLength(2);
  });

  it("STILL returns [] for a genuinely empty successful response", async () => {
    // The half that must not change. "You have none" is a real answer, and a
    // helper that threw on it would be as wrong as one that invented it.
    servesOnce(respond(200, []));
    await expect(fetchJsonArray("/api/deals")).resolves.toEqual([]);
    servesOnce(respond(200, { data: [] }));
    await expect(fetchJsonArray("/api/deals")).resolves.toEqual([]);
  });

  it("throws on a 500 — the case that rendered as 'you have none'", async () => {
    servesOnce(respond(500, { error: "boom" }));
    await expect(fetchJsonArray("/api/deals")).rejects.toBeInstanceOf(RequestFailedError);
  });

  it("throws on a 403 and a 404 — neither is emptiness", async () => {
    servesOnce(respond(403, { error: "nope" }));
    await expect(fetchJsonArray("/api/deals")).rejects.toBeInstanceOf(RequestFailedError);
    servesOnce(respond(404, { error: "gone" }));
    await expect(fetchJsonArray("/api/deals")).rejects.toBeInstanceOf(RequestFailedError);
  });

  it("throws on a body that will not parse", async () => {
    // A 200 whose body is truncated HTML — a proxy error page, say — used to
    // land in the `catch { return [] }` and render as an empty list.
    servesOnce(respond(200, null, "<html>502 Bad Gateway"));
    await expect(fetchJsonArray("/api/deals")).rejects.toBeInstanceOf(RequestFailedError);
  });

  it("throws on a shape it does not recognise, rather than returning []", async () => {
    // `{ deals: [...] }` is not a shape this helper knows. Returning [] there
    // is a contract failure reported as emptiness.
    servesOnce(respond(200, { deals: [{ id: 1 }] }));
    await expect(fetchJsonArray("/api/deals")).rejects.toThrow(/Expected a list/);
  });
});
