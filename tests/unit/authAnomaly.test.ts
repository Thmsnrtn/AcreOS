import { describe, it, expect } from "vitest";
import {
  evaluateAuthEvents,
  subnetOf,
  IDENTIFIER_BURST_MIN_FAILURES as A_N,
  IDENTIFIER_BURST_WINDOW_MS as A_W,
  IP_BURST_MIN_FAILURES as B_N,
  IP_BURST_MIN_DISTINCT_IDENTIFIERS as B_IDS,
  IP_BURST_WINDOW_MS as B_W,
  SUCCESS_AFTER_BURST_WINDOW_MS as C_W,
  type AuthEvent,
} from "../../shared/security/authAnomaly";

const T0 = Date.parse("2026-11-10T12:00:00.000Z");
const fail = (id: string, ip: string, offMs: number): AuthEvent => ({
  kind: "sign_in_failure", identifier: id, ip, occurredAt: new Date(T0 + offMs),
});
const ok = (id: string, ip: string, offMs: number): AuthEvent => ({
  kind: "sign_in_success", identifier: id, ip, occurredAt: new Date(T0 + offMs),
});
/** n failures for one identifier spread evenly across [0, span]. */
const idBurst = (n: number, span: number, id = "a@x.com", ip = "1.2.3.4") =>
  Array.from({ length: n }, (_, i) => fail(id, ip, n === 1 ? 0 : Math.round((span * i) / (n - 1))));
const rules = (e: AuthEvent[]) => evaluateAuthEvents(e).map((f) => f.rule);

describe("authAnomaly", () => {
  it("VACUITY CANARY: a synthetic burst produces findings", () => {
    const f = evaluateAuthEvents(idBurst(A_N + 3, 60_000));
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].rule).toBe("identifier_burst");
    const ips = Array.from({ length: B_N }, (_, i) => fail(`u${i % B_IDS}@x.com`, "9.9.9.9", i * 1000));
    expect(rules(ips)).toContain("ip_burst");
  });

  it("empty input → no findings", () => {
    expect(evaluateAuthEvents([])).toEqual([]);
  });

  describe("rule (a) identifier burst", () => {
    it("exactly at threshold fires; one below does not", () => {
      expect(rules(idBurst(A_N, 1000))).toEqual(["identifier_burst"]);
      expect(rules(idBurst(A_N - 1, 1000))).toEqual([]);
    });
    it("window edge: span exactly the window fires, 1ms over does not", () => {
      expect(rules(idBurst(A_N, A_W))).toEqual(["identifier_burst"]);
      expect(rules(idBurst(A_N, A_W + 1))).toEqual([]);
    });
    it("is per identifier (case/space-insensitive), not pooled", () => {
      const mixed = [
        ...idBurst(A_N - 1, 1000, "a@x.com"),
        ...idBurst(A_N - 1, 1000, "b@x.com"),
      ];
      expect(rules(mixed)).toEqual([]);
      const folded = [...idBurst(3, 1000, "A@X.com"), ...idBurst(2, 1000, " a@x.com ")];
      expect(rules(folded)).toEqual(["identifier_burst"]);
    });
    it("successes do not count toward the burst", () => {
      const e = [...idBurst(A_N - 1, 1000), ok("a@x.com", "1.2.3.4", 500)];
      expect(rules(e)).toEqual([]);
    });
    it("events after `now` are ignored", () => {
      const e = idBurst(A_N, 1000);
      expect(evaluateAuthEvents(e, new Date(T0 + 500))).toEqual([]);
      expect(evaluateAuthEvents(e, new Date(T0 + 1000)).length).toBe(1);
    });
    it("accepts ISO strings and rejects unparseable times", () => {
      const e = idBurst(A_N, 1000).map((x) => ({ ...x, occurredAt: (x.occurredAt as Date).toISOString() }));
      expect(rules(e)).toEqual(["identifier_burst"]);
      expect(() => evaluateAuthEvents([{ ...e[0], occurredAt: "nope" }])).toThrow(RangeError);
    });
  });

  describe("rule (b) ip burst", () => {
    const spread = (n: number, ids: number, span = 1000, prefix = "7.7.7.") =>
      Array.from({ length: n }, (_, i) =>
        fail(`u${i % ids}@x.com`, `${prefix}${i % 250}`, Math.round((span * i) / Math.max(n - 1, 1))));
    it("exactly at both thresholds fires; one below either does not", () => {
      expect(rules(spread(B_N, B_IDS))).toEqual(["ip_burst"]);
      expect(rules(spread(B_N - 1, B_IDS))).toEqual([]);
      expect(rules(spread(B_N, B_IDS - 1))).not.toContain("ip_burst"); // (a) may fire per identifier; (b) must not
    });
    it("one identifier × many failures from one IP is rule (a), not (b)", () => {
      const e = idBurst(B_N, 1000, "solo@x.com", "7.7.7.7");
      expect(rules(e)).toEqual(["identifier_burst"]);
    });
    it("window edge", () => {
      expect(rules(spread(B_N, B_IDS, B_W))).toEqual(["ip_burst"]);
      expect(rules(spread(B_N, B_IDS, B_W + 1))).toEqual([]);
    });
    it("groups by /24, not across /24s", () => {
      const e = spread(B_N, B_IDS).map((x, i) => ({ ...x, ip: i % 2 ? "7.7.7.1" : "7.7.8.1" }));
      expect(rules(e).filter((r) => r === "ip_burst")).toEqual([]);
      expect(evaluateAuthEvents(spread(B_N, B_IDS))[0].ip).toBe("7.7.7.0/24");
    });
    it("IPv6 groups by /64", () => {
      const mk = (suffix: (i: number) => string) =>
        Array.from({ length: B_N }, (_, i) => fail(`u${i % B_IDS}@x.com`, suffix(i), i * 100));
      const same = evaluateAuthEvents(mk((i) => `2001:db8:1:2::${i + 1}`));
      expect(same.find((f) => f.rule === "ip_burst")?.ip).toBe("2001:db8:1:2::/64");
      const diff = evaluateAuthEvents(mk((i) => `2001:db8:1:${i % 2}::1`));
      expect(diff.find((f) => f.rule === "ip_burst")).toBeUndefined();
    });
    it("subnetOf handles mapped, compressed and invalid addresses", () => {
      expect(subnetOf("::ffff:10.1.2.3")).toBe("10.1.2.0/24");
      expect(subnetOf("2001:DB8::1")).toBe("2001:db8:0:0::/64");
      expect(subnetOf("999.1.1.1")).toBeNull();
      expect(subnetOf("not-an-ip")).toBeNull();
    });
  });

  describe("rule (c) success after burst", () => {
    const burst = () => idBurst(A_N, 1000); // threshold reached at T0+1000
    const met = 1000;
    it("success shortly after the burst fires", () => {
      const f = evaluateAuthEvents([...burst(), ok("a@x.com", "5.5.5.5", met + 1)]);
      expect(f.map((x) => x.rule)).toEqual(["identifier_burst", "success_after_burst"]);
      expect(f[1].ip).toBe("5.5.5.5");
      expect(f[1].evidence.successCount).toBe(1);
    });
    it("window edge: exactly 15 min after fires, 1ms later does not", () => {
      expect(rules([...burst(), ok("a@x.com", "5.5.5.5", met + C_W)])).toContain("success_after_burst");
      expect(rules([...burst(), ok("a@x.com", "5.5.5.5", met + C_W + 1)])).not.toContain("success_after_burst");
    });
    it("a success at/before the moment the burst was met does not fire", () => {
      expect(rules([...burst(), ok("a@x.com", "5.5.5.5", met)])).not.toContain("success_after_burst");
      expect(rules([...burst(), ok("a@x.com", "5.5.5.5", -5)])).not.toContain("success_after_burst");
    });
    it("requires the SAME identifier", () => {
      expect(rules([...burst(), ok("other@x.com", "1.2.3.4", met + 1000)])).toEqual(["identifier_burst"]);
    });
    it("no burst → a success alone is nothing", () => {
      expect(rules([...idBurst(A_N - 1, 1000), ok("a@x.com", "1.2.3.4", 5000)])).toEqual([]);
    });
  });

  it("output is sorted and independent of input order", () => {
    const e = [
      ...idBurst(A_N, 1000, "z@x.com", "1.1.1.1").map((x) => ({ ...x, occurredAt: new Date((x.occurredAt as Date).getTime() + 60_000) })),
      ...idBurst(A_N, 1000, "b@x.com", "2.2.2.2"),
      ...idBurst(A_N, 1000, "a@x.com", "3.3.3.3"),
    ];
    const a = evaluateAuthEvents(e);
    const b = evaluateAuthEvents([...e].reverse());
    expect(b).toEqual(a);
    expect(a.map((f) => f.identifier)).toEqual(["a@x.com", "b@x.com", "z@x.com"]);
  });
});
