/**
 * The platform's in-process pieces, in the default CI run (seconds, no app):
 *  - the collector classifies Stripe traffic by what the money IS, so a
 *    customer's money on the platform account cannot read as a subscription;
 *  - the collector reads only complete log lines and survives a truncated log;
 *  - the long run is opt-in: montecarlo.sh refuses a year without SIMPLAT_LONG.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Collector, moneyKindOf } from "./collector";

describe("collector", () => {
  it("knows customer money from AcreOS's own", () => {
    expect(moneyKindOf("/v1/subscriptions", "")).toBe("subscription");
    expect(moneyKindOf("/v1/refunds", "")).toBe("refund");
    expect(moneyKindOf("/v1/transfers", "")).toBe("customer_money");
    expect(moneyKindOf("/v1/payment_links", "")).toBe("customer_money");
    expect(moneyKindOf("/v1/payment_intents", "metadata[note_id]=4&description=borrower payment")).toBe("customer_money");
    expect(moneyKindOf("/v1/payment_intents", "application_fee_amount=30")).toBe("customer_money");
  });

  it("observes only what arrived since the last tick, and a partial line waits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "simplat-col-"));
    const rows: Record<string, unknown[]> = {};
    const q = async (sql: string) => {
      if (/max\(id\)/.test(sql)) return [{ m: 0 }] as any[];
      if (/count\(\*\) from organizations/.test(sql)) return [{ o: 1, u: 1 }] as any[];
      return (rows[sql] ?? []) as any[];
    };
    const c = new Collector(q as any, dir);
    await c.init();
    const truth = { revokedAtVirtual: new Map(), outages: [], founderTaps: [], approvalsShown: new Map(), screens: [] };
    writeFileSync(join(dir, "dbtap.jsonl"), JSON.stringify({ actorOrg: 3, kind: "read", rowOrgs: [4], sql: "select" }) + "\n" + '{"actorOrg": 3, "kind": "re');
    const o1 = await c.observe("2026-10-08T00:00:00Z", truth as any, 0);
    expect(o1.queries).toHaveLength(1);
    appendFileSync(join(dir, "dbtap.jsonl"), 'ad", "rowOrgs": [5]}\n');
    const o2 = await c.observe("2026-10-09T00:00:00Z", truth as any, 0);
    expect(o2.queries).toHaveLength(1);
    expect(o2.queries![0].rowOrgs).toEqual([5]);
    const o3 = await c.observe("2026-10-10T00:00:00Z", truth as any, 0);
    expect(o3.queries).toHaveLength(0);
    expect(readFileSync(join(dir, "dbtap.jsonl"), "utf8").length).toBeGreaterThan(0);
  });
});

describe("long runs are opt-in", () => {
  it("montecarlo.sh refuses a year without SIMPLAT_LONG", () => {
    const r = spawnSync("bash", ["tests/simulation/platform/montecarlo.sh", "A", "365", "1"], { encoding: "utf8", env: { ...process.env, SIMPLAT_LONG: "" } });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/opt-in long run/);
  });
});
