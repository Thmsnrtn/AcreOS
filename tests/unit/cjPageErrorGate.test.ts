/**
 * The CJ1 page-error gate (tests/e2e-customer-journey/page-error-gate.ts)
 * may dismiss ONE thing: a same-origin WebKit "due to access control checks"
 * error whose path completed 2xx in the same attempt. Every negative control
 * below must still FAIL the gate. If one of them goes green, the gate has
 * become a signature exclusion and is hiding real defects.
 *
 * The raw strings are verbatim from proof run 42151652145 (iPhone 12 light,
 * retry 2), clipped prefixes included.
 */
import { describe, expect, it } from "vitest";
import {
  gatePageErrors,
  parseAccessControlTarget,
  pathKey,
} from "../e2e-customer-journey/page-error-gate";

const HOST = "acreos-staging.fly.dev";
const RAW = {
  notifications: "/acreos-staging.fly.dev/api/notifications due to access control checks.",
  observations: "/acreos-staging.fly.dev/api/pax/observations?unread=true due to access control checks.",
  todayPoll: "/acreos-staging.fly.dev/api/today/?since=1793933093769&tz=0 due to access control checks.",
  blob: "ttps://acreos-staging.fly.dev/767f47f1-a1a5-488b-9941-96498599d225 due to access control checks.",
};

function seen(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries.map(([path, status]) => [pathKey(HOST, path), status] as [string, number]));
}

describe("parseAccessControlTarget", () => {
  it("reads host + path from the clipped WebKit forms and the full form", () => {
    expect(parseAccessControlTarget(RAW.notifications)).toEqual({ host: HOST, pathname: "/api/notifications" });
    expect(parseAccessControlTarget(RAW.todayPoll)).toEqual({ host: HOST, pathname: "/api/today/" });
    expect(parseAccessControlTarget(RAW.blob)).toEqual({
      host: HOST,
      pathname: "/767f47f1-a1a5-488b-9941-96498599d225",
    });
    expect(
      parseAccessControlTarget(
        "Fetch API cannot load https://acreos-staging.fly.dev/api/today due to access control checks.",
      ),
    ).toEqual({ host: HOST, pathname: "/api/today" });
  });

  it("returns null for anything that is not the access-control shape", () => {
    expect(parseAccessControlTarget("TypeError: undefined is not an object")).toBeNull();
    expect(parseAccessControlTarget("due to access control checks.")).toBeNull();
  });
});

describe("gatePageErrors", () => {
  it("dismisses an access-control error whose path completed 2xx (query ignored), and records it", () => {
    const v = gatePageErrors(
      [RAW.notifications, RAW.todayPoll],
      seen([["/api/notifications", 200], ["/api/today/", 200]]),
      HOST,
    );
    expect(v.failing).toEqual([]);
    expect(v.corroborated).toEqual([
      { raw: RAW.notifications, key: pathKey(HOST, "/api/notifications"), status: 200 },
      { raw: RAW.todayPoll, key: pathKey(HOST, "/api/today/"), status: 200 },
    ]);
  });

  // ── Negative controls: each MUST fail the gate ─────────────────────────
  it("NEGATIVE: no response at all for the path (e.g. blob:, never on the wire) fails", () => {
    const v = gatePageErrors([RAW.blob], seen([["/api/notifications", 200]]), HOST);
    expect(v.failing).toEqual([RAW.blob]);
    expect(v.corroborated).toEqual([]);
  });

  it("NEGATIVE: forced 500 on the path fails (a non-2xx is never recorded as corroboration)", () => {
    // The spec's response listener records ONLY 2xx; a 500 leaves the map
    // without the key. This also pins the gate's own range check.
    const v = gatePageErrors([RAW.notifications], seen([["/api/notifications", 500]]), HOST);
    expect(v.failing).toEqual([RAW.notifications]);
  });

  it("NEGATIVE: revoked token (401) on the path fails", () => {
    const v = gatePageErrors([RAW.observations], seen([["/api/pax/observations", 401]]), HOST);
    expect(v.failing).toEqual([RAW.observations]);
  });

  it("NEGATIVE: a 2xx on a DIFFERENT path does not corroborate", () => {
    const v = gatePageErrors([RAW.observations], seen([["/api/pax/observations/extra", 200], ["/api/notifications", 200]]), HOST);
    expect(v.failing).toEqual([RAW.observations]);
  });

  it("NEGATIVE: a cross-origin access-control error fails even with a 2xx (a real CORS block)", () => {
    const raw = "/api.thirdparty.example/v1/data due to access control checks.";
    const ok = new Map([[pathKey("api.thirdparty.example", "/v1/data"), 200]]);
    const v = gatePageErrors([raw], ok, HOST);
    expect(v.failing).toEqual([raw]);
  });

  it("NEGATIVE: any other page error fails regardless of network state", () => {
    const raw = "TypeError: undefined is not an object (evaluating 'C.scope')";
    const v = gatePageErrors([raw, RAW.notifications], seen([["/api/notifications", 200]]), HOST);
    expect(v.failing).toEqual([raw]);
    expect(v.corroborated).toHaveLength(1);
  });

  it("NEGATIVE: an unparseable access-control message fails", () => {
    const raw = "something due to access control checks.";
    const v = gatePageErrors([raw], seen([["/api/notifications", 200]]), HOST);
    expect(v.failing).toEqual([raw]);
  });
});
