/**
 * Tahoe E8 — App Intent registry parity + integrity tests.
 *
 * Proves the registry is the single source of truth the Pax loop consumes:
 *   1. The OpenAI tool list the Pax loop now reads (getToolsForRoleFromRegistry)
 *      is byte-equivalent to the legacy getToolsForRole it replaced — same
 *      tools, same names, same parameter schemas, for every role.
 *   2. Every legacy tool in toolDefinitions is registered as an intent.
 *   3. Every intent is tagged with one of the five customer-nav doors.
 *   4. Anthropic input_schema definitions derive correctly from the registry.
 *   5. The zod→json-schema util handles the shapes external-agent intents use.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toolDefinitions, getToolsForRole, APPROVAL_REQUIRED_TOOLS } from "../../server/ai/tools";
import {
  getToolsForRoleFromRegistry,
  getAnthropicToolsForRoleFromRegistry,
} from "../../server/services/appIntents";
import {
  intentNames,
  getIntent,
  listIntents,
  getAnthropicToolDefinitions,
  registerIntent,
  resolveInputSchema,
  type AppIntent,
} from "../../server/services/appIntents/registry";
import { zodToJsonSchema } from "../../server/utils/zodToJsonSchema";

const ROLES = [
  "executive", "assistant", "acquisitions", "underwriting",
  "marketing", "research", "documents",
];

const FIVE_DOORS = ["today", "map", "deals", "finance", "pax"];

describe("App Intent registry — Pax loop parity", () => {
  for (const role of ROLES) {
    it(`role "${role}" — registry tool list matches the legacy getToolsForRole`, () => {
      const legacy = getToolsForRole(role);
      const fromRegistry = getToolsForRoleFromRegistry(role);

      // Same set of tool names, order-independent.
      const legacyNames = legacy.map((t) => t.function.name).sort();
      const registryNames = fromRegistry.map((t) => t.function.name).sort();
      expect(registryNames).toEqual(legacyNames);

      // Same parameter schema + description per tool.
      const legacyByName = new Map(legacy.map((t) => [t.function.name, t.function]));
      for (const t of fromRegistry) {
        const legacyFn = legacyByName.get(t.function.name)!;
        expect(t.function.description).toBe(legacyFn.description);
        expect(t.function.parameters).toEqual(legacyFn.parameters);
        expect(t.type).toBe("function");
      }
    });
  }

  it("registers every legacy tool as an intent", () => {
    const legacyNames = Object.keys(toolDefinitions).sort();
    const intents = intentNames().sort();
    expect(intents).toEqual(legacyNames);
  });

  it("tags every intent with one of the five customer-nav doors", () => {
    for (const intent of listIntents()) {
      expect(FIVE_DOORS).toContain(intent.door);
    }
  });

  it("preserves the approval-required flag from APPROVAL_REQUIRED_TOOLS", () => {
    for (const name of APPROVAL_REQUIRED_TOOLS) {
      const intent = getIntent(name);
      expect(intent).toBeDefined();
      expect(intent!.approvalRequired).toBe(true);
    }
    // Sanity: a read-only intent is not approval-gated.
    expect(getIntent("get_leads")!.approvalRequired).toBe(false);
  });
});

describe("App Intent registry — Anthropic projection", () => {
  it("derives Anthropic tool definitions from the registry", () => {
    const defs = getAnthropicToolsForRoleFromRegistry("executive");
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d).toHaveProperty("name");
      expect(d).toHaveProperty("description");
      expect(d).toHaveProperty("input_schema");
      // input_schema mirrors the OpenAI parameters for the same intent.
      const intent = getIntent(d.name)!;
      expect(d.input_schema).toEqual(resolveInputSchema(intent));
    }
  });

  it("selects a subset by name", () => {
    const defs = getAnthropicToolDefinitions(["get_leads", "get_deals"]);
    expect(defs.map((d) => d.name)).toEqual(["get_leads", "get_deals"]);
  });
});

describe("zodToJsonSchema — external-agent intent schemas", () => {
  it("converts a zod object schema with describe/optional/enum/array", () => {
    const schema = z.object({
      query: z.string().describe("Search term"),
      limit: z.number().optional(),
      mode: z.enum(["fast", "deep"]),
      tags: z.array(z.string()),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe("object");
    const props = json.properties as Record<string, any>;
    expect(props.query).toEqual({ type: "string", description: "Search term" });
    expect(props.limit).toEqual({ type: "number" });
    expect(props.mode).toEqual({ type: "string", enum: ["fast", "deep"] });
    expect(props.tags).toEqual({ type: "array", items: { type: "string" } });
    // optional field excluded from required; the rest included.
    expect(json.required).toEqual(["query", "mode", "tags"]);
  });

  it("a zod-backed intent resolves its input_schema via the zod util", () => {
    const intent: AppIntent = {
      name: "__test_zod_intent",
      description: "test",
      door: "today",
      requiredScope: null,
      approvalRequired: false,
      inputSchema: z.object({ city: z.string().describe("City") }),
      handler: async () => ({ success: true }),
    };
    registerIntent(intent);
    expect(resolveInputSchema(intent)).toEqual({
      type: "object",
      properties: { city: { type: "string", description: "City" } },
      required: ["city"],
    });
  });
});
