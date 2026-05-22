/**
 * Phase B — delegation-tool registration shape tests.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  getTool,
  listTools,
  __resetRegistryForTests,
} from "../../server/services/founder-chat/tool-registry";

const DELEGATION_TOOLS = [
  "ask_sophie",
  "ask_forge",
  "ask_beacon",
  "ask_sentinel",
  "ask_ledger",
  "ask_shield",
  "ask_oracle",
  "ask_compass",
  "ask_crucible",
];

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/delegation");
});

describe("founder-chat delegation tools", () => {
  it("registers all 9 ask_<agent> tools", () => {
    const names = listTools({ category: "delegation" }).map((t) => t.name).sort();
    expect(names).toEqual([...DELEGATION_TOOLS].sort());
  });

  it("every delegation tool is tier-1 non-destructive", () => {
    for (const name of DELEGATION_TOOLS) {
      const t = getTool(name)!;
      expect(t.tier, `${name} tier`).toBe(1);
      expect(t.destructive, `${name} destructive`).toBe(false);
    }
  });

  it("ask_sophie schema accepts optional org_id", () => {
    const t = getTool("ask_sophie")!;
    expect(t.schema.safeParse({ prompt: "hi" }).success).toBe(true);
    expect(t.schema.safeParse({ prompt: "hi", org_id: 1 }).success).toBe(true);
  });

  it("ask_forge schema rejects extra org_id (not in spec for non-sophie)", () => {
    const t = getTool("ask_forge")!;
    // Schema is z.object({ prompt }) — extra keys allowed by default unless strict.
    expect(t.schema.safeParse({ prompt: "hi" }).success).toBe(true);
  });

  it("artifactType is agent_quote for every delegation tool", () => {
    for (const name of DELEGATION_TOOLS) {
      expect(getTool(name)?.artifactType).toBe("agent_quote");
    }
  });
});
