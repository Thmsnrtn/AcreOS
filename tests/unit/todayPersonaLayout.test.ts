/**
 * Today persona → layout resolution (Maren CPO #3 / Krieger UX).
 *
 * The core promise of the persona-deepened Today is that each investor
 * archetype gets its OWN lede — not a relabeled clone. These tests lock that
 * in at the resolver boundary:
 *
 *   1. each persona we tailor resolves to a DISTINCT lede component + key
 *      (land / note_investor / note_originator / note_servicer / tax_delinquent),
 *      so note_originator and note_servicer can never silently collapse back
 *      onto the note_investor tape again.
 *   2. untailored personas + undefined fall through to the generic default
 *      (no lede), so nobody is ever worse off than before.
 */

import { describe, it, expect } from "vitest";
import { getTodayLayout } from "../../client/src/components/today/TodayLayout";
import type { Persona } from "../../shared/models/auth";

describe("getTodayLayout — each persona gets its own lede", () => {
  it("resolves the four note/land personas to four DISTINCT ledes", () => {
    const land = getTodayLayout("land_investor");
    const investor = getTodayLayout("note_investor");
    const originator = getTodayLayout("note_originator");
    const servicer = getTodayLayout("note_servicer");

    // Every tailored persona has a lede (not the generic null).
    expect(land.Lede).not.toBeNull();
    expect(investor.Lede).not.toBeNull();
    expect(originator.Lede).not.toBeNull();
    expect(servicer.Lede).not.toBeNull();

    // The keys are all distinct.
    const keys = [land.key, investor.key, originator.key, servicer.key];
    expect(new Set(keys).size).toBe(4);

    // The lede COMPONENTS are distinct references — this is the regression
    // guard: originator/servicer must not reuse the investor lede.
    const ledes = [land.Lede, investor.Lede, originator.Lede, servicer.Lede];
    expect(new Set(ledes).size).toBe(4);
  });

  it("gives note_originator and note_servicer their own ledes, NOT the investor tape", () => {
    const investor = getTodayLayout("note_investor");
    const originator = getTodayLayout("note_originator");
    const servicer = getTodayLayout("note_servicer");

    expect(originator.Lede).not.toBe(investor.Lede);
    expect(servicer.Lede).not.toBe(investor.Lede);
    expect(originator.Lede).not.toBe(servicer.Lede);

    expect(originator.key).toBe("note_originator");
    expect(servicer.key).toBe("note_servicer");
    expect(investor.key).toBe("note_investor");
  });

  it("resolves tax_delinquent to the redemption-clock lede", () => {
    const tax = getTodayLayout("tax_delinquent");
    expect(tax.Lede).not.toBeNull();
    expect(tax.key).toBe("tax_lien");
  });

  it("gives the deal-driven verticals their OWN ledes too (no persona left generic)", () => {
    const dealVerticals: Persona[] = ["wholesaler", "subdivider", "fix_flipper", "landlord"];
    for (const p of dealVerticals) {
      const layout = getTodayLayout(p);
      expect(layout.Lede, `${p} should have its own lede`).not.toBeNull();
      expect(layout.key, `${p} should not be generic`).not.toBe("generic");
    }
  });

  it("gives all nine personas DISTINCT lede components", () => {
    const all: Persona[] = [
      "land_investor", "note_investor", "note_originator", "note_servicer",
      "tax_delinquent", "wholesaler", "subdivider", "fix_flipper", "landlord",
    ];
    const ledes = all.map((p) => getTodayLayout(p).Lede);
    expect(ledes.every((l) => l !== null)).toBe(true);
    expect(new Set(ledes).size).toBe(9); // no two personas share a lede component
  });

  it("falls through to the generic default (no lede) only for undefined persona", () => {
    const layout = getTodayLayout(undefined);
    expect(layout.key).toBe("generic");
    expect(layout.Lede).toBeNull();
  });
});
