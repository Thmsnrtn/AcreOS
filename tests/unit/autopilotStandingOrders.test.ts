import { describe, it, expect } from "vitest";
import {
  composeStandingOrdersBlock,
  STANDING_ORDER_KINDS,
} from "../../server/services/autopilot/standingOrders";

describe("autopilot standing orders — Your Voice, composed into every action", () => {
  it("no active orders → empty block (nothing injected)", () => {
    expect(composeStandingOrdersBlock([])).toBe("");
    expect(composeStandingOrdersBlock([{ kind: "standing_order", body: "   " }])).toBe("");
  });

  it("labels intents (direction) and standing orders (hard rules) distinctly", () => {
    const block = composeStandingOrdersBlock([
      { kind: "intent", body: "Reach $1k MRR sustainably" },
      { kind: "standing_order", body: "Never email anyone twice in a week" },
    ]);
    expect(block).toMatch(/Intents \(the why/i);
    expect(block).toMatch(/Reach \$1k MRR sustainably/);
    expect(block).toMatch(/Standing orders \(hard rules — never violate\)/i);
    expect(block).toMatch(/Never email anyone twice in a week/);
  });

  it("renders only the kinds present (rules-only, no empty Intents header)", () => {
    const block = composeStandingOrdersBlock([
      { kind: "standing_order", body: "Prioritize Texas tax-delinquent investors" },
    ]);
    expect(block).toMatch(/Standing orders/);
    expect(block).not.toMatch(/Intents/);
  });

  it("trims bodies and drops blank ones", () => {
    const block = composeStandingOrdersBlock([
      { kind: "intent", body: "  Stay lean + legal  " },
      { kind: "intent", body: "" },
    ]);
    expect(block).toContain("• Stay lean + legal");
    expect(block.match(/•/g)?.length).toBe(1);
  });

  it("exposes the two valid kinds", () => {
    expect([...STANDING_ORDER_KINDS]).toEqual(["standing_order", "intent"]);
  });
});
