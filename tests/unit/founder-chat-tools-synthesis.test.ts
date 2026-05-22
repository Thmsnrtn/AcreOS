/**
 * Phase B — synthesis-tool registration shape tests.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  getTool,
  listTools,
  __resetRegistryForTests,
} from "../../server/services/founder-chat/tool-registry";

const SYNTHESIS_TOOLS = [
  "draft_weekly_money_letter",
  "propose_action_for_org",
  "summarize_audit_log",
  "audit_provider_savings",
  "compare_templates",
  "forecast_runout",
];

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          limit: vi.fn().mockResolvedValue([]),
          groupBy: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
        }),
        groupBy: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
      }),
    }),
  },
}));

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/synthesis");
});

describe("founder-chat synthesis tools", () => {
  it("registers all 6 synthesis tools", () => {
    const names = listTools({ category: "synthesis" }).map((t) => t.name).sort();
    expect(names).toEqual([...SYNTHESIS_TOOLS].sort());
  });

  it("draft_weekly_money_letter is tier-2 destructive (writes a draft)", () => {
    const t = getTool("draft_weekly_money_letter")!;
    expect(t.tier).toBe(2);
    expect(t.destructive).toBe(true);
  });

  it("read-only synthesis tools are tier-1 non-destructive", () => {
    for (const name of ["propose_action_for_org", "summarize_audit_log", "audit_provider_savings", "compare_templates", "forecast_runout"]) {
      const t = getTool(name)!;
      expect(t.tier, `${name} tier`).toBe(1);
      expect(t.destructive, `${name} destructive`).toBe(false);
    }
  });

  it("propose_action_for_org schema requires org_id + intent", () => {
    const t = getTool("propose_action_for_org")!;
    expect(t.schema.safeParse({}).success).toBe(false);
    expect(t.schema.safeParse({ org_id: 1 }).success).toBe(false);
    expect(t.schema.safeParse({ org_id: 1, intent: "fix churn" }).success).toBe(true);
  });
});
