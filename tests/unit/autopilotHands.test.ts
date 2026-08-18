import { describe, it, expect, beforeEach } from "vitest";
import {
  registerHand,
  getHand,
  isHandName,
  listHandSchemas,
  listHandSpecs,
} from "../../server/services/autopilot/hands/registry";
import { __resetHandsForTest } from "../../server/services/autopilot/hands/registry";
import type { HandSpec } from "../../server/services/autopilot/hands/types";
import { executeDispatchTool } from "../../server/services/solene/dispatchToolExecutor";

function makeHand(overrides: Partial<HandSpec> = {}): HandSpec {
  return {
    name: "test_hand",
    schema: { name: "test_hand", description: "a test hand", input_schema: { type: "object", properties: {} } },
    domain: "ops",
    isCustomerFacing: false,
    // Both are REQUIRED on HandSpec as of 2026-08-18, so the fixture must state
    // them like any real hand. That is the point: an omitted risk flag used to
    // read as `no risk`, and a test fixture that could skip them was modelling
    // a shape production can no longer produce.
    movesMoney: false,
    outwardClass: "none",
    requiresApproval: false,
    surface: "generic",
    handler: async () => ({ success: true, output: "ran", durationMs: 1 }),
    ...overrides,
  };
}

describe("autopilot hand registry", () => {
  beforeEach(() => __resetHandsForTest());

  it("starts empty (inert by default)", () => {
    expect(listHandSpecs()).toHaveLength(0);
    expect(listHandSchemas()).toHaveLength(0);
  });

  it("registers + looks up a hand by name", () => {
    registerHand(makeHand());
    expect(isHandName("test_hand")).toBe(true);
    expect(getHand("test_hand")?.domain).toBe("ops");
    expect(listHandSchemas()).toHaveLength(1);
  });

  it("rejects a spec whose name disagrees with its schema name", () => {
    expect(() =>
      registerHand(makeHand({ name: "a", schema: { name: "b", description: "", input_schema: {} } })),
    ).toThrow(/name mismatch/);
  });

  it("REFUSES to register a hand implementing a hard-stop class — even witnessed", () => {
    // Hard-stops (pricing changes / legal signing / customer-data deletion)
    // may never gain an actuator. Enforced at boot, not by convention.
    const hardStopNames = [
      "pricing_change",
      "update_pricing",
      "legal_sign_contract",
      "sign_agreement",
      "delete_customer_data",
      "customer_data_purge",
    ];
    for (const name of hardStopNames) {
      expect(() =>
        registerHand(
          makeHand({
            name,
            requiresApproval: true, // a founder tap does NOT rescue a hard-stop class
            schema: { name, description: "does the thing", input_schema: { type: "object", properties: {} } },
          }),
        ),
        `expected '${name}' to be refused`,
      ).toThrow(/hard-stop/);
    }
    // ...and a matching DESCRIPTION is caught even when the name is innocuous.
    expect(() =>
      registerHand(
        makeHand({
          name: "adjust_tier",
          requiresApproval: true,
          schema: { name: "adjust_tier", description: "change pricing for a tier", input_schema: { type: "object", properties: {} } },
        }),
      ),
    ).toThrow(/hard-stop/);
    // Ordinary hands are unaffected.
    expect(() => registerHand(makeHand())).not.toThrow();
  });
});

describe("executor-layer witnessed-send wall (the invariant)", () => {
  beforeEach(() => __resetHandsForTest());

  it("runs a non-approval hand directly", async () => {
    registerHand(makeHand({ name: "do_internal", schema: { name: "do_internal", description: "", input_schema: { type: "object", properties: {} } } }));
    const r = await executeDispatchTool("do_internal", {});
    expect(r.success).toBe(true);
    expect(r.output).toBe("ran");
  });

  it("REFUSES to execute an approval-required hand directly from a dispatch", async () => {
    let handlerRan = false;
    registerHand(
      makeHand({
        name: "send_thing",
        schema: { name: "send_thing", description: "", input_schema: { type: "object", properties: {} } },
        requiresApproval: true,
        isCustomerFacing: true,
        handler: async () => {
          handlerRan = true;
          return { success: true, output: "SENT", durationMs: 1 };
        },
      }),
    );
    const r = await executeDispatchTool("send_thing", {});
    expect(r.success).toBe(false);
    expect(r.output).toContain("WITNESSED-SEND");
    expect(handlerRan).toBe(false); // the underlying send NEVER ran
  });

  it("still reports unknown tools for unregistered names", async () => {
    const r = await executeDispatchTool("nonexistent_tool", {});
    expect(r.success).toBe(false);
    expect(r.output).toContain("unknown tool");
  });
});
