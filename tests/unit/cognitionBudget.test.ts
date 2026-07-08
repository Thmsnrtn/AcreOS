import { describe, it, expect, vi } from "vitest";
import { CognitionBudget } from "../../server/services/autopilot/cognitionBudget";

describe("CognitionBudget — per-tick cognition ceiling (T2.1 backpressure)", () => {
  it("allows up to the ceiling, then refuses", () => {
    const b = new CognitionBudget(3);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false); // ceiling reached
    expect(b.exhausted).toBe(true);
    expect(b.used).toBe(3);
    expect(b.remaining()).toBe(0);
  });

  it("wrap() runs the real fn while budget remains, then degrades to '' (deterministic fallback)", async () => {
    const raw = vi.fn(async (p: string) => `answer:${p}`);
    const exhausted = vi.fn();
    const b = new CognitionBudget(2);
    const call = b.wrap(raw, exhausted)!;
    expect(await call("a")).toBe("answer:a");
    expect(await call("b")).toBe("answer:b");
    expect(await call("c")).toBe(""); // over ceiling → empty, no real call
    expect(raw).toHaveBeenCalledTimes(2);
    expect(exhausted).toHaveBeenCalledTimes(1);
  });

  it("wrap(null) stays null (no cognition available)", () => {
    expect(new CognitionBudget(5).wrap(null)).toBeNull();
  });
});
