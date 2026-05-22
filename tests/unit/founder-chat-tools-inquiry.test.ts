/**
 * Phase B — inquiry-tool registration shape tests.
 *
 * We don't run the SQL — that's an integration-test concern. These tests
 * verify each inquiry tool was registered with the correct shape (tier 1,
 * non-destructive, correct category, parseable schema) so the registry
 * stays in lockstep with the plan.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  getTool,
  listTools,
  __resetRegistryForTests,
} from "../../server/services/founder-chat/tool-registry";

const INQUIRY_TOOLS = [
  "get_buckets",
  "get_mrr_trend",
  "get_contribution_margin_per_org",
  "get_cost_mix",
  "get_active_triggers",
  "get_dlq_items",
  "get_org_cost_detail",
  "get_provider_summary",
  "get_cost_event_provenance",
  "get_decision_queue",
  "get_agent_status",
  "search_orgs",
  "search_cost_events",
  "get_infra_status",
  "get_audit_log",
  "get_morning_brief",
];

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/inquiry");
});

describe("founder-chat inquiry tools", () => {
  it("registers all 16 inquiry tools", () => {
    const names = listTools({ category: "inquiry" }).map((t) => t.name).sort();
    expect(names).toEqual([...INQUIRY_TOOLS].sort());
  });

  it("every inquiry tool is tier-1 and non-destructive", () => {
    for (const name of INQUIRY_TOOLS) {
      const t = getTool(name);
      expect(t, `${name} should be registered`).toBeDefined();
      expect(t!.tier).toBe(1);
      expect(t!.destructive).toBe(false);
      expect(t!.category).toBe("inquiry");
    }
  });

  it("get_mrr_trend schema accepts optional days", () => {
    const t = getTool("get_mrr_trend")!;
    expect(t.schema.safeParse({}).success).toBe(true);
    expect(t.schema.safeParse({ days: 30 }).success).toBe(true);
    expect(t.schema.safeParse({ days: -1 }).success).toBe(false);
  });

  it("get_contribution_margin_per_org rejects invalid filter", () => {
    const t = getTool("get_contribution_margin_per_org")!;
    expect(t.schema.safeParse({}).success).toBe(true);
    expect(t.schema.safeParse({ filter: "net_negative" }).success).toBe(true);
    expect(t.schema.safeParse({ filter: "garbage" }).success).toBe(false);
  });

  it("slash aliases route to the right tool", () => {
    expect(getTool("get_buckets")?.slashAliases).toContain("buckets");
    expect(getTool("get_morning_brief")?.slashAliases).toContain("brief");
    expect(getTool("get_dlq_items")?.slashAliases).toContain("dlq");
  });
});
