/**
 * Quality directive 2026-09-29 — the external MCP surface is a POSITIVE
 * allowlist, checked against the REAL intent catalog.
 *
 * The rule it replaced ("scope is null or ends in _read, minus a deny-list")
 * read `scope: null` as read-only. `remember_fact` (writes a Pax memory row)
 * and `spawn_subagent` (runs a billed model loop) both have `scope: null`, so
 * both were exposed — to a key holding NO scopes, because null also meant
 * "ungated". This test builds every intent from `INTENT_META` (the catalog's
 * own door/scope table) rather than a fixture, so a new intent that would slip
 * through is caught by name, not by a hand-picked sample.
 */
import { describe, it, expect } from "vitest";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";
import { isExternalSafeIntent, keyMaySatisfyIntent } from "../../server/mcp/safeIntents";

type IntentLike = Parameters<typeof isExternalSafeIntent>[0];

function intentFor(name: string): IntentLike {
  const meta = INTENT_META[name];
  return {
    name,
    description: name,
    door: meta.door,
    requiredScope: meta.scope,
    approvalRequired: false,
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({ success: true }),
  } as unknown as IntentLike;
}

const ALL = Object.keys(INTENT_META);
const EXTERNAL = ALL.filter((n) => isExternalSafeIntent(intentFor(n)));

describe("the external MCP surface over the real catalog", () => {
  it("reads the catalog (vacuity: a moved table cannot pass as an empty one)", () => {
    expect(ALL.length).toBeGreaterThan(50);
    expect(EXTERNAL.length).toBeGreaterThan(10);
  });

  it("never exposes the null-scope intents that write or spend", () => {
    for (const n of ["remember_fact", "spawn_subagent"]) {
      expect(INTENT_META[n]).toBeDefined();
      expect(INTENT_META[n].scope).toBeNull(); // the shape that fooled the old rule
      expect(EXTERNAL).not.toContain(n);
    }
  });

  it("is exactly the reviewed list of bounded reads", () => {
    expect([...EXTERNAL].sort()).toEqual(
      [
        "calculate_amortization",
        "calculate_payment_schedule",
        "calculate_roi",
        "get_cashflow_summary",
        "get_dashboard_stats",
        "get_deals",
        "get_lead_details",
        "get_leads",
        "get_notes",
        "get_pipeline_summary",
        "get_properties",
        "get_property_details",
        "get_stale_leads",
        "get_system_context",
        "get_tasks",
        "recall_facts",
        "retrieve_land_knowledge",
      ].sort(),
    );
  });

  it("an approval-gated or write-scoped intent drops out even if it is on the list", () => {
    const gated = { ...intentFor("get_leads"), approvalRequired: true } as IntentLike;
    expect(isExternalSafeIntent(gated)).toBe(false);
    const writes = { ...intentFor("get_leads"), requiredScope: "deal_write" } as unknown as IntentLike;
    expect(isExternalSafeIntent(writes)).toBe(false);
  });

  it("a key with no scopes may call none of them", () => {
    for (const n of EXTERNAL) expect(keyMaySatisfyIntent(intentFor(n), [])).toBe(false);
  });
});
