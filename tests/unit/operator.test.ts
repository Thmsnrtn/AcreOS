import { describe, it, expect } from "vitest";
import { parseOperatingPlan, planToActions, buildOperatorPrompt, type OperatingPlan } from "../../server/services/autopilot/operator";
import type { RankedMove } from "../../server/services/autopilot/decide";

const incident: RankedMove = { priority: 0, domain: "deploy", kind: "resolve_incident", rationale: "incident open" };
const grow: RankedMove = { priority: 4, domain: "growth", kind: "grow_owned_channels", rationale: "stable" };
const support: RankedMove = { priority: 2, domain: "support", kind: "clear_support_backlog", rationale: "2 waiting" };

const planGrowFirst: OperatingPlan = {
  assessment: "grow harder",
  moves: [{ kind: "grow_owned_channels", isNetNew: false, rationale: "push growth" }],
  escalations: [],
  watchItems: [],
};

describe("planToActions — the safety-floor invariant (the audit's keystone)", () => {
  it("NEVER promotes a discretionary move above the mandatory floor (growth can't beat an incident)", () => {
    const r = planToActions([incident, grow], planGrowFirst);
    expect(r.topMove?.kind).toBe("resolve_incident"); // floor stays on top no matter what the Operator says
    expect(r.fellBack).toBe(false);
  });

  it("injects net-new moves BELOW the floor and flags them for forced witnessed-send", () => {
    const plan: OperatingPlan = {
      assessment: "test price",
      moves: [{ kind: "run_price_experiment", isNetNew: true, rationale: "pricing is the highest-EV lever", proposedBinding: { domain: "finance", isCustomerFacing: true } }],
      escalations: [], watchItems: [],
    };
    const r = planToActions([incident, grow], plan);
    expect(r.topMove?.kind).toBe("resolve_incident"); // floor first
    const netNew = r.moves.find((m) => m.kind === "run_price_experiment");
    expect(netNew).toBeTruthy();
    expect(netNew!.priority).toBeGreaterThan(incident.priority); // below the floor
    expect(r.netNewKinds).toContain("run_price_experiment");
  });

  it("lets the Operator reorder the DISCRETIONARY space (support before growth when no mandatory floor)", () => {
    const plan: OperatingPlan = {
      assessment: "serve first", moves: [{ kind: "clear_support_backlog", isNetNew: false, rationale: "retention" }, { kind: "grow_owned_channels", isNetNew: false, rationale: "" }], escalations: [], watchItems: [],
    };
    const r = planToActions([grow, support], plan); // floor here is support (priority 2 < 4)
    expect(r.topMove?.kind).toBe("clear_support_backlog");
  });

  it("never drops a deterministic move the Operator didn't mention", () => {
    const r = planToActions([incident, grow, support], planGrowFirst);
    const kinds = r.moves.map((m) => m.kind);
    expect(kinds).toContain("resolve_incident");
    expect(kinds).toContain("grow_owned_channels");
    expect(kinds).toContain("clear_support_backlog");
  });

  it("drops a hallucinated unknown (non-net-new) kind", () => {
    const plan: OperatingPlan = { assessment: "x", moves: [{ kind: "teleport_to_mars", isNetNew: false, rationale: "" }], escalations: [], watchItems: [] };
    const r = planToActions([incident], plan);
    expect(r.moves.map((m) => m.kind)).not.toContain("teleport_to_mars");
  });

  it("falls back to the deterministic ranking on a null/empty plan", () => {
    expect(planToActions([incident, grow], null).fellBack).toBe(true);
    expect(planToActions([incident, grow], null).topMove?.kind).toBe("resolve_incident");
    expect(planToActions([], planGrowFirst).topMove).toBeNull();
  });
});

describe("parseOperatingPlan — tolerant validation", () => {
  it("parses a valid plan (with surrounding prose)", () => {
    const raw = 'Here is my plan: {"assessment":"steady","moves":[{"kind":"grow_owned_channels","isNetNew":false,"rationale":"go"}],"escalations":[],"watchItems":["watch CAC"]}';
    const p = parseOperatingPlan(raw);
    expect(p?.assessment).toBe("steady");
    expect(p?.moves[0].kind).toBe("grow_owned_channels");
    expect(p?.watchItems).toEqual(["watch CAC"]);
  });
  it("returns null on malformed / empty-moves output", () => {
    expect(parseOperatingPlan("no json here")).toBeNull();
    expect(parseOperatingPlan('{"assessment":"x","moves":[]}')).toBeNull();
    expect(parseOperatingPlan('{"moves":[{"kind":"a"}]}')).toBeNull(); // no assessment
  });
});

describe("buildOperatorPrompt — encodes the hard rules", () => {
  it("includes the safety ladder rule and the net-new affordance", () => {
    const prompt = buildOperatorPrompt("BRIEF", ["grow_owned_channels", "resolve_incident"]);
    expect(prompt).toMatch(/stabilize>serve>grow|stabilize > serve > grow/i);
    expect(prompt).toMatch(/net-new/i);
    expect(prompt).toContain("grow_owned_channels");
  });
});
