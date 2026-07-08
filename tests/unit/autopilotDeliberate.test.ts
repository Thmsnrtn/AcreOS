import { describe, it, expect } from "vitest";
import {
  shouldDeliberate,
  buildCouncilPrompt,
  parseCouncil,
  applyDeliberation,
  deliberateWithModel,
} from "../../server/services/autopilot/deliberate";
import type { RankedMove, DecisionSenses } from "../../server/services/autopilot/decide";

const move = (kind: string, priority: number): RankedMove => ({ kind, priority, domain: "growth", rationale: `${kind} rationale` });
const senses: DecisionSenses = {
  openIncidents: 0,
  complianceOpenCount: 0,
  envelopeStatus: "green",
  supportBacklog: 0,
  trials: 0,
  activationStalled: false,
  mrr: 0,
  dispatchBacklog: 0,
};

describe("autopilot deliberation — neuro-symbolic, model proposes within the lines", () => {
  it("warrants deliberation only for a genuine close contest (≥2 discretionary, ≤1 apart)", () => {
    // a clear single top + optimize default → no contest
    expect(shouldDeliberate([move("grow_owned_channels", 4), move("optimize", 5)])).toBe(false);
    // two discretionary moves one priority apart → contest
    expect(shouldDeliberate([move("clear_support_backlog", 2), move("unblock_activation", 3), move("optimize", 5)])).toBe(true);
    // far apart → no contest
    expect(shouldDeliberate([move("clear_support_backlog", 2), move("grow_owned_channels", 4)])).toBe(false);
  });

  it("the council prompt lists ONLY the real candidates and forbids inventing actions", () => {
    const p = buildCouncilPrompt(senses, [move("clear_support_backlog", 2), move("grow_owned_channels", 4)]);
    expect(p).toContain("clear_support_backlog");
    expect(p).toContain("grow_owned_channels");
    expect(p).toMatch(/may only recommend a move from the candidate list/i);
  });

  it("parseCouncil extracts JSON, validates shape, and rejects garbage", () => {
    expect(parseCouncil('noise {"recommendedKind":"grow_owned_channels","rationale":"go"} tail')?.recommendedKind).toBe("grow_owned_channels");
    expect(parseCouncil("not json at all")).toBeNull();
    expect(parseCouncil('{"rationale":"missing kind"}')).toBeNull();
  });

  it("SAFETY: applyDeliberation only reorders to a REAL candidate; an invented kind is ignored", () => {
    const moves = [move("clear_support_backlog", 2), move("unblock_activation", 3)];
    // valid pick → moves to front
    const reordered = applyDeliberation(moves, { recommendedKind: "unblock_activation", rationale: "" });
    expect(reordered[0].kind).toBe("unblock_activation");
    // invented kind → unchanged (the LLM cannot create a new action)
    const unchanged = applyDeliberation(moves, { recommendedKind: "launch_nukes", rationale: "" });
    expect(unchanged).toEqual(moves);
    // null verdict → unchanged
    expect(applyDeliberation(moves, null)).toEqual(moves);
  });

  it("deliberateWithModel falls back to the deterministic ranking on a bad/erroring model", async () => {
    const moves = [move("clear_support_backlog", 2), move("unblock_activation", 3)];
    const errored = await deliberateWithModel(senses, moves, { callModel: async () => { throw new Error("no key"); } });
    expect(errored.moves).toEqual(moves);
    expect(errored.deliberated).toBe(false);
    const garbage = await deliberateWithModel(senses, moves, { callModel: async () => "garbage" });
    expect(garbage.moves).toEqual(moves);
  });

  it("deliberateWithModel applies a valid recommendation to lead the ranking", async () => {
    const moves = [move("clear_support_backlog", 2), move("unblock_activation", 3)];
    const result = await deliberateWithModel(senses, moves, {
      callModel: async () => '{"recommendedKind":"unblock_activation","rationale":"fix the leak first"}',
    });
    expect(result.deliberated).toBe(true);
    expect(result.moves[0].kind).toBe("unblock_activation");
  });

  it("does not call the model when there's no contest (cost discipline)", async () => {
    let called = 0;
    const result = await deliberateWithModel(senses, [move("grow_owned_channels", 4), move("optimize", 5)], {
      callModel: async () => { called++; return ""; },
    });
    expect(called).toBe(0);
    expect(result.deliberated).toBe(false);
  });
});
