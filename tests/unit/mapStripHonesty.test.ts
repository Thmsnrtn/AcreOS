/**
 * Map-strip vocabulary honesty (wave V2, founder ruling #11).
 *
 * The V1 audit found fix_flipper, subdivider, and landlord all sharing
 * InventoryStrip with flipper vocabulary ("Reno", "Listed") — the wrong
 * words for two of the three personas. The cure, pinned here:
 *
 *   - subdivider gets its own SubdividerStrip fed by the REAL
 *     /api/subdivider/dashboard rollup (parent parcels / lots sold / basis
 *     recovered / stalled permit gates) instead of the flipper framing.
 *   - fix_flipper keeps InventoryStrip with flip vocabulary — correct for
 *     that persona.
 *   - landlord keeps InventoryStrip (owned-door counts are real for them)
 *     but with landlord-honest labels: `owned` is "Owned", NOT
 *     "Occupied"/"Vacant" — occupancy lives in rental_leases, not on
 *     properties.status, so an occupancy word over a status count would
 *     present a number as a fact the data doesn't contain. The sold pip
 *     stays "Sold" (not the registry's "Leased") for the same reason.
 *
 * Component files (.tsx) are asserted via source-shape contracts — same
 * pattern as landlordFamilyGates.test.ts — because these run in node env
 * with no DOM.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getTerm } from "../../client/src/lib/personaVocabulary";
import { stripComments } from "../helpers/stripComments";

const STRIP_PATH = path.resolve(
  __dirname,
  "../../client/src/components/maps/PersonaMapStrip.tsx",
);
const src = fs.readFileSync(STRIP_PATH, "utf-8");

/**
 * Strip block + line comments: the honesty assertions govern what the strip
 * can RENDER, and comments are allowed to explain why a word is banned.
 */
const code = stripComments(src);

describe("PersonaMapStrip — persona dispatch honesty", () => {
  it("routes subdivider to SubdividerStrip, not the flipper InventoryStrip", () => {
    const block = src.match(/case "subdivider":([\s\S]*?)case "/);
    expect(block, 'a case "subdivider" branch must exist').toBeTruthy();
    expect(block![1]).toContain("SubdividerStrip");
    expect(block![1]).not.toContain("InventoryStrip");
  });

  it("routes fix_flipper and landlord to InventoryStrip (real owned-inventory counts)", () => {
    const flipper = src.match(/case "fix_flipper":([\s\S]*?)case "/);
    expect(flipper).toBeTruthy();
    expect(flipper![1]).toContain("InventoryStrip");

    const landlord = src.match(/case "landlord":([\s\S]*?)default:/);
    expect(landlord).toBeTruthy();
    expect(landlord![1]).toContain("InventoryStrip");
  });
});

describe("SubdividerStrip — real subdivision data, honest empties", () => {
  it("reads the real org-scoped subdivider rollup endpoint", () => {
    expect(src).toContain('"/api/subdivider/dashboard"');
  });

  it("renders nothing while loading or on fetch failure — never placeholder numbers", () => {
    expect(src).toMatch(/if \(isLoading \|\| isError \|\| !live\) return null;/);
  });

  it("renders an honest EmptyState when the org has no subdivision yet (hasData=false)", () => {
    const fn = src.match(/function SubdividerStrip\([\s\S]*?\nfunction /);
    expect(fn, "SubdividerStrip must exist").toBeTruthy();
    const body = fn![0];
    expect(body).toContain("!live.hasData");
    expect(body).toContain("EmptyState");
  });

  it("only shows basis-recovered when a parent basis is actually recorded", () => {
    // 0% against an unrecorded basis would be a fake stat.
    expect(src).toMatch(/totalParentBasisCents \?\? 0\) > 0/);
  });
});

describe("InventoryStrip — persona-aware labels that stay honest to properties.status", () => {
  it("has a persona-keyed pip-label map covering fix_flipper and landlord", () => {
    expect(src).toContain("INVENTORY_PIP_LABELS");
    expect(src).toMatch(/fix_flipper:\s*\{[^}]*owned:\s*"Reno"/);
    expect(src).toMatch(/landlord:\s*\{[^}]*owned:\s*"Owned"/);
  });

  it("landlord labels never claim occupancy — the strip's data cannot distinguish it", () => {
    // properties.status is prospect…sold (shared/schema.ts); occupancy lives
    // in rental_leases. These words rendering from the strip would be a lie.
    expect(code).not.toMatch(/\bOccupied\b/);
    expect(code).not.toMatch(/\bVacant\b/);
  });

  it('landlord sold pip stays "Sold" — never relabeled "Leased" over a status === "sold" count', () => {
    expect(src).toMatch(/landlord:\s*\{[^}]*sold:\s*"Sold"/);
    expect(code).not.toMatch(/sold:\s*"Leased"/);
  });

  it("uses the personaVocabulary registry for the entity labels it renders", () => {
    expect(src).toContain('useTerm("entity.property")');
    expect(src).toContain('useTerm("entity.property.plural")');
    // Cross-check the registry itself still speaks each persona's language
    // for the shared entity key this strip leans on.
    expect(getTerm("entity.property", "landlord")).toBe("Rental");
    expect(getTerm("entity.property", "subdivider")).toBe("Parent parcel");
    expect(getTerm("entity.property", "fix_flipper")).toBe("Project");
  });

  it("top-spread requires BOTH purchase and list price — no fabricated negative spread", () => {
    // A missing listPrice used to read as a $0 sale and rank a fabricated
    // negative "top" number for landlords holding unlisted doors.
    expect(src).toMatch(/Number\(p\.purchasePrice \|\| 0\) > 0/);
    expect(src).toMatch(/Number\(p\.listPrice \|\| 0\) > 0/);
  });
});
