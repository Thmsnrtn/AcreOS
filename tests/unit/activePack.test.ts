import { describe, it, expect } from "vitest";
import { resolveActivePack } from "../../server/services/autopilot/activePack";
import { evidenceByLever } from "../../server/services/autopilot/worldModel";
import type { DomainPack } from "../../server/services/autopilot/domainPack";

// Frontier #1 — the loop is now pack-AGNOSTIC: it resolves the active pack
// through one injection point, and the consequence→evidence aggregation is a
// generic kernel function the pack only parameterizes.

describe("resolveActivePack — the single vertical injection point", () => {
  it("returns a well-formed DomainPack (today: land)", () => {
    const pack: DomainPack = resolveActivePack();
    expect(pack.id).toBe("land");
    expect(pack.causalModel.variables.length).toBeGreaterThan(0);
    expect(Object.keys(pack.moveToLever).length).toBeGreaterThan(0);
  });

  it("accepts a scope arg (call sites are already scope-shaped for a 2nd vertical)", () => {
    expect(resolveActivePack(undefined).id).toBe("land");
  });
});

describe("evidenceByLever — generic over ANY pack's move→lever map", () => {
  it("aggregates consequence-grounded outcomes to arbitrary levers", () => {
    const moveToLever = { do_x: "lever_x", do_y: "lever_y" };
    const ev = evidenceByLever(
      [
        { moveKind: "do_x", paymentRecovered: true },
        { moveKind: "do_x", deliveryBounced: true },
        { moveKind: "do_y", paymentRecovered: true },
        { moveKind: "unmapped", paymentRecovered: true }, // ignored
        { moveKind: "do_x", paymentRecovered: null, deliveryBounced: null }, // no consequence → abstain
      ],
      moveToLever,
    );
    expect(ev.lever_x).toEqual({ successes: 1, failures: 1 });
    expect(ev.lever_y).toEqual({ successes: 1, failures: 0 });
    expect(ev.unmapped).toBeUndefined();
  });

  it("caps evidence per lever (poisoning resistance, parameterized)", () => {
    const flood = Array.from({ length: 200 }, () => ({ moveKind: "m", paymentRecovered: true }));
    expect(evidenceByLever(flood, { m: "L" }, 50).L.successes).toBe(50);
  });
});
