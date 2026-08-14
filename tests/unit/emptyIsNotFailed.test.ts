/**
 * A customer with 200 parcels was shown the new-user onboarding panel.
 *
 * `LandSourcingWidgets` — on the customer's own dashboard — fetched properties
 * and leads, turned any failure into two empty arrays, and then fell through to:
 *
 *     if (properties.length === 0 && ownerTargets === 0)
 *       return <EmptyState headline="Start sourcing parcels"
 *                subtitle="… Add your first parcels or owner targets …" />
 *
 * So during an API blip a customer with a full pipeline was told to add their
 * first parcels. Not merely *"you have none"* — **an instruction to redo work
 * they had already done**, on the first screen they look at. The two note
 * widgets had the same shape: *"Import the notes you've acquired"* and
 * *"Originate your first note"*, to people whose books were already full.
 *
 * The mechanism is one line, copied 32 times across `client/src`:
 *
 *     if (!res.ok) return [];      // …or `return null`
 *
 * `!res.ok` collapses two answers that mean opposite things. A **404** on an
 * optional record is a real answer — *this property has no compliance record* —
 * and `null` is honest. A **500** is not an answer, and `[]` states a fact about
 * the customer's own data out of a failure to read it.
 *
 * THIS IS UNIT 89's DEFECT ON THE OTHER SIDE OF THE WIRE, and finding it there
 * first is why it was worth looking here: unit 89 fixed seven server catches
 * that answered 200 with emptiness, and noted that the client carried the same
 * lie independently. `useJobHealthLogs` proved it — the server fix alone changed
 * nothing on screen because the hook re-fabricated the empty list.
 *
 * WHAT THIS FILE PINS. The dashboard widgets specifically, because that is where
 * an empty list is rendered as ONBOARDING COPY rather than as a bare zero, and
 * the ordering that makes it safe: **the error branch must come before the
 * empty-state branch.** A page that checks `length === 0` first is one where
 * every failure is an empty state again, no matter how honest the fetch became.
 *
 * NOT SWEPT HERE, deliberately: the remaining call sites. Several are correct —
 * `compliance-badge`, `land-credit-badge` and the AVM comps genuinely mean "no
 * record for this property" — and the rest need the 404/5xx distinction made per
 * site, which `!res.ok` cannot make for them. `client/src/lib/fetch-honesty.ts`
 * is the pair of helpers that lets each site say which it means; converting them
 * is a later unit, and a blanket change would break the honest ones.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { okOrThrow, nullOn404, listFrom, RequestFailedError } from "../../client/src/lib/fetch-honesty";

const ROOT = path.resolve(__dirname, "../..");

function res(status: number, body: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("okOrThrow — for anything answering \"what do I have\"", () => {
  it("passes a 200 through", async () => {
    const r = res(200, [1, 2]);
    await expect(okOrThrow(r)).resolves.toBe(r);
  });

  it("throws on a 500, carrying the status", async () => {
    await expect(okOrThrow(res(500))).rejects.toBeInstanceOf(RequestFailedError);
    await expect(okOrThrow(res(500))).rejects.toMatchObject({ status: 500 });
  });

  it("throws on a 404 too — a missing LIST is not an empty one", async () => {
    // The distinction this helper exists for runs the other way as well: for a
    // collection, a 404 means the thing that owns it is gone, which is not the
    // same as owning zero of them.
    await expect(okOrThrow(res(404))).rejects.toBeInstanceOf(RequestFailedError);
  });

  it("throws on 401 and 403, which are not emptiness either", async () => {
    for (const s of [401, 403]) {
      await expect(okOrThrow(res(s))).rejects.toMatchObject({ status: s });
    }
  });
});

describe("nullOn404 — for an OPTIONAL single record", () => {
  it("returns null for a 404, because that is a real answer", async () => {
    // `this property has no compliance record` is a fact the server can state,
    // and the badge should render nothing rather than an error.
    await expect(nullOn404(res(404))).resolves.toBeNull();
  });

  it("still throws on a 500 — the half the old line gave away", async () => {
    await expect(nullOn404(res(500))).rejects.toBeInstanceOf(RequestFailedError);
  });

  it("returns the parsed body on success", async () => {
    await expect(nullOn404<{ score: number }>(res(200, { score: 7 }))).resolves.toEqual({
      score: 7,
    });
  });
});

describe("listFrom — the unwrapping is not a place for a fallback either", () => {
  it("accepts both envelope shapes this API uses", () => {
    expect(listFrom<number>([1, 2])).toEqual([1, 2]);
    expect(listFrom<number>({ data: [3] })).toEqual([3]);
  });

  it("THROWS on a shape it does not recognise, rather than returning []", () => {
    // The old code ended `: []`, so a body that failed to parse became an empty
    // collection — the same lie one layer in.
    expect(() => listFrom({ oops: true })).toThrow();
    expect(() => listFrom(null)).toThrow();
  });
});

describe("the core-data doors distinguish empty from failed", () => {
  // The Map door and the properties hook, converted in the same thread. The map
  // is the sharpest of the three: its zero-state INSTRUCTS the customer to go
  // geocode parcels — "Click Fetch boundaries on the Inventory page to
  // auto-geocode your properties" — so a failed read told someone whose parcels
  // were already geocoded to do it again, with `retry: false` so it did not even
  // recover on its own.
  const maps = fs.readFileSync(path.join(ROOT, "client/src/pages/maps.tsx"), "utf8");
  const props = fs.readFileSync(path.join(ROOT, "client/src/hooks/use-properties.ts"), "utf8");

  it("the map's parcel read throws instead of emptying the map", () => {
    const at = maps.indexOf('queryKey: ["/api/properties"]');
    expect(at, "the map's properties query is gone").toBeGreaterThan(-1);
    const body = maps.slice(at, maps.indexOf("});", at));
    expect(body, "the map swallows a failed parcel read into [] again").not.toContain(
      "if (!res.ok) return []",
    );
    expect(body).toContain("okOrThrow(");
  });

  it("the map shows the error BEFORE the geocoding zero-state", () => {
    const err = maps.indexOf("propsError ?");
    const zero = maps.indexOf("filteredProperties.length === 0 ?");
    expect(err, "the map has no error branch").toBeGreaterThan(-1);
    expect(
      err,
      "the map checks for zero parcels before it checks for a failure, so an " +
        "outage still renders 'No parcel coordinates yet' with instructions to " +
        "geocode properties the customer may already have geocoded",
    ).toBeLessThan(zero);
  });

  it("useProperties throws — it feeds Finance and the document generator", () => {
    expect(props, "useProperties returns [] on failure again").not.toContain(
      "if (!res.ok) return []",
    );
    expect(props).toContain("okOrThrow(");
  });
});

describe("the dashboard widgets distinguish empty from failed", () => {
  const widgets = fs.readFileSync(
    path.join(ROOT, "client/src/components/dashboard/type-specific-widgets.tsx"),
    "utf8",
  );

  it("no query in the file swallows a failure into an empty list", () => {
    expect(
      widgets,
      "a widget query turns a failed request back into []. The customer's own " +
        "core data then reads as zero, and these widgets render onboarding copy " +
        "at zero — so the failure state becomes 'add your first parcels'.",
    ).not.toMatch(/if \(!res\.ok\) return (\[\]|null)/);
    expect(widgets, "the honest helpers are not being used").toContain("okOrThrow(");
  });

  it("every widget that renders an EmptyState has an error branch BEFORE it", () => {
    // The ordering is the fix. An honest fetch changes nothing if the component
    // still checks `length === 0` first — every failure is an empty state again.
    const fns = [...widgets.matchAll(/function (\w+Widgets)\(\)/g)].map((m) => m[1]);
    expect(fns.length, "no widget components parsed").toBeGreaterThan(3);

    for (const fn of fns) {
      const start = widgets.indexOf(`function ${fn}()`);
      const next = fns
        .map((o) => widgets.indexOf(`function ${o}()`))
        .filter((i) => i > start)
        .sort((a, b) => a - b)[0];
      const body = widgets.slice(start, next === undefined ? undefined : next);
      if (!body.includes("<EmptyState")) continue;
      if (!/isError/.test(body)) continue; // widget reads a shared/live query — covered elsewhere
      expect(
        body.indexOf("if (isError)") >= 0 || body.indexOf("if (pError || lError)") >= 0,
        `${fn} renders an EmptyState but has no error branch`,
      ).toBe(true);
      const errAt = Math.max(body.indexOf("if (isError)"), body.indexOf("if (pError || lError)"));
      expect(
        errAt,
        `${fn} checks for an empty list BEFORE it checks for a failure, so an ` +
          `outage still renders the onboarding panel`,
      ).toBeLessThan(body.indexOf("<EmptyState"));
    }
  });

  it("the error copy says what is unknown, not just that something broke", () => {
    // "Couldn't load" and "you have none" are the two readings this whole unit
    // exists to keep apart, so the copy has to make the distinction out loud.
    expect(widgets).toMatch(/not the same as having none/i);
    expect(widgets).toMatch(/not the same as holding no notes/i);
  });
});
