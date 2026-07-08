import { describe, it, expect } from "vitest";
import { supportPlayRationale, SUPPORT_BATCH_SIZE } from "../../server/services/autopilot/supportPlaybook";

describe("autopilot support playbook — drafts behind a human tap", () => {
  it("with cases waiting, names the real count and caps the batch", () => {
    const r = supportPlayRationale(12);
    expect(r).toMatch(/12 support cases are waiting/);
    expect(r).toMatch(new RegExp(`draft.*${SUPPORT_BATCH_SIZE} oldest`, "i"));
  });

  it("singular grammar for a single waiting case", () => {
    const r = supportPlayRationale(1);
    expect(r).toMatch(/1 support case is waiting/);
  });

  it("an empty queue is honest — confirm clear, don't invent work", () => {
    const r = supportPlayRationale(0);
    expect(r).toMatch(/No open support cases are waiting/i);
  });

  it("ALWAYS states the witnessed-send guarantee — nothing reaches a customer without approval", () => {
    for (const n of [0, 1, 8]) {
      expect(supportPlayRationale(n)).toMatch(/DRAFT for the founder's approval|witnessed-send/i);
    }
  });

  it("forbids over-promising / guessing — the craft bar in the brief itself", () => {
    expect(supportPlayRationale(3)).toMatch(/never over-promise/i);
    expect(supportPlayRationale(3)).toMatch(/never guess at facts/i);
  });

  it("is total over messy input (negatives, fractions) without throwing", () => {
    expect(() => supportPlayRationale(-4)).not.toThrow();
    expect(supportPlayRationale(-4)).toMatch(/No open support cases/i);
    expect(() => supportPlayRationale(3.7)).not.toThrow();
  });
});
