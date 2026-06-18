/**
 * Founder four-door doctrine ratchet (Hands roadmap P6).
 *
 * Mirrors the customer five-door lock (mobileNavFixedDoors.test.ts). The founder
 * surface should SHRINK as autonomy grows, never grow. This locks the canonical
 * four doors to real routes and ratchets the total /founder/* route count so the
 * 88-door sprawl can only go DOWN — a new top-level founder route trips the test.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { FOUNDER_DOORS, FOUNDER_ADMIN_NAMESPACE, founderDoorByHref } from "@/lib/founder-doors";

const APP = fs.readFileSync(path.resolve(__dirname, "../../client/src/App.tsx"), "utf-8");

/** Current count — the ratchet baseline. Consolidation may only LOWER this. */
const FOUNDER_ROUTE_BASELINE = 88;

function founderRouteCount(): number {
  return (APP.match(/path="\/founder/g) ?? []).length;
}

describe("founder four-door doctrine", () => {
  it("FOUNDER_DOORS is exactly the four canonical doors, in order", () => {
    expect(FOUNDER_DOORS.map((d) => d.id)).toEqual(["letter", "decisions", "controls", "story"]);
  });

  it("every door resolves to a real /founder route that exists in App.tsx", () => {
    for (const door of FOUNDER_DOORS) {
      expect(door.href).toMatch(/^\/founder/);
      expect(APP.includes(`path="${door.href}"`), `route ${door.href} must exist`).toBe(true);
    }
  });

  it("founderDoorByHref resolves a door and null otherwise", () => {
    expect(founderDoorByHref("/founder")?.id).toBe("letter");
    expect(founderDoorByHref("/founder/nope")).toBeNull();
  });

  it("reserves /founder/admin for the deliberate instrument namespace", () => {
    expect(FOUNDER_ADMIN_NAMESPACE).toBe("/founder/admin");
  });
});

describe("founder route-sprawl ratchet", () => {
  it("the /founder/* route count never exceeds the baseline (it may only shrink)", () => {
    const count = founderRouteCount();
    expect(
      count,
      `founder routes (${count}) exceed the baseline (${FOUNDER_ROUTE_BASELINE}). New founder ` +
        `surfaces must live behind one of the four doors as a child/section/tab, not a new ` +
        `top-level route. If you are CONSOLIDATING, lower FOUNDER_ROUTE_BASELINE to the new count.`,
    ).toBeLessThanOrEqual(FOUNDER_ROUTE_BASELINE);
  });
});
