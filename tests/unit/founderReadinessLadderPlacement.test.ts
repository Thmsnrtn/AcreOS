/**
 * Placement ratchet for the founder Readiness Ladder (founder ask 2026-07-30).
 *
 * The ladder is the founder's OWN onboarding. The obvious way to build such a
 * thing — a "/founder/setup" wizard route — is exactly what the four-door
 * doctrine forbids, and it is how the historical ~88-route sprawl happened.
 * This file pins the alternative that was actually built:
 *
 *   1. The founder route count did NOT change (82, the ratchet baseline) —
 *      the ladder added ZERO routes.
 *   2. The ladder lives as a SECTION of the existing Controls door, and its
 *      API hangs off the existing /api/founder/autopilot/* router.
 *   3. Every rung's fix link points INTO one of the four doors.
 *   4. The Letter gained at most ONE setup line, and it is not a checklist.
 *
 * If a future session is tempted to promote the ladder to its own door, this
 * test is the argument against it.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { RUNG_SPECS, orderRungs, RUNG_STAGES } from "../../server/services/founder/readinessLadder";
import { FOUNDER_DOORS } from "@/lib/founder-doors";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

const APP = read("client/src/App.tsx");
const CONTROLS = read("client/src/pages/founder/autopilot-control.tsx");
const LETTER = read("client/src/pages/founder/home.tsx");
const AUTOPILOT_ROUTES = read("server/routes-autopilot.ts");

/**
 * The founder route count at the moment the ladder shipped. This MUST equal
 * FOUNDER_ROUTE_BASELINE in founderFourDoors.test.ts — the ladder is proof that
 * a whole new founder experience can ship without adding a single route.
 */
const FOUNDER_ROUTE_COUNT_AT_LADDER_SHIP = 82;

describe("the readiness ladder added ZERO founder routes", () => {
  it("the /founder/* route count is unchanged from the ratchet baseline", () => {
    const count = (APP.match(/path="\/founder/g) ?? []).length;
    expect(
      count,
      `founder routes moved to ${count}; the ladder must not add (or silently remove) a route. ` +
        `If you consolidated deliberately, lower FOUNDER_ROUTE_BASELINE in founderFourDoors.test.ts too.`,
    ).toBe(FOUNDER_ROUTE_COUNT_AT_LADDER_SHIP);
  });

  it("agrees with the founderFourDoors ratchet baseline (one number, not two)", () => {
    const ratchet = read("tests/unit/founderFourDoors.test.ts");
    const m = ratchet.match(/FOUNDER_ROUTE_BASELINE\s*=\s*(\d+)/);
    expect(m, "FOUNDER_ROUTE_BASELINE must be readable").toBeTruthy();
    expect(Number(m![1])).toBe(FOUNDER_ROUTE_COUNT_AT_LADDER_SHIP);
  });

  it("no founder route is a founder SETUP surface — the ladder lives inside Controls", () => {
    // Two routes are deliberately exempt because they OBSERVE customers'
    // onboarding rather than configure the founder's own platform:
    //   /founder/onboarding         — every customer org's journey and where it stalled
    //   /founder/onboarding-funnel  — signup-to-first-value conversion analytics
    // Both are permanent instruments about other people. What this test guards
    // against is a founder SETUP surface: the founder's own setup experience
    // must live inside Controls and consume itself as the autopilot takes over,
    // because a setup door that never closes contradicts the four-door model.
    // The list is explicit rather than a looser pattern so that adding a third
    // exemption forces someone to justify it here.
    const CUSTOMER_ONBOARDING_OBSERVABILITY = new Set([
      "/founder/onboarding",
      "/founder/onboarding-funnel",
    ]);
    const founderPaths = [...APP.matchAll(/path="(\/founder[^"]*)"/g)]
      .map((m) => m[1])
      .filter((p) => !CUSTOMER_ONBOARDING_OBSERVABILITY.has(p));
    for (const p of founderPaths) {
      expect(p, `${p} looks like a founder setup route — the ladder lives inside Controls`).not.toMatch(
        /setup|onboard|wizard|getting-started/i,
      );
    }
  });
});

describe("the ladder lives inside the Controls door", () => {
  it("the Controls page renders the ladder section", () => {
    expect(CONTROLS).toContain("ReadinessLadderSection");
    expect(CONTROLS).toContain('from "@/components/founder/ReadinessLadderSection"');
  });

  it("Controls is still one of the four canonical doors", () => {
    const controls = FOUNDER_DOORS.find((d) => d.id === "controls");
    expect(controls?.href).toBe("/founder/autopilot/control");
    expect(APP).toContain(`path="${controls!.href}"`);
  });

  it("the ladder API hangs off the EXISTING /api/founder/autopilot router", () => {
    expect(AUTOPILOT_ROUTES).toContain('"/api/founder/autopilot/readiness-ladder"');
    // Same founder gating as its neighbours on this router.
    const idx = AUTOPILOT_ROUTES.indexOf('"/api/founder/autopilot/readiness-ladder"');
    const window = AUTOPILOT_ROUTES.slice(idx, idx + 400);
    expect(window).toContain("isAuthenticated");
    expect(window).toContain("requireFounder");
    expect(window).toContain("Errors.internal");
  });

  it("mutations that change measured state invalidate the ladder query", () => {
    // "Built but unwired" is this repo's most common defect: a ladder that
    // never refreshes after a key is pasted would be worse than none.
    const hits = (CONTROLS.match(/READINESS_LADDER_KEY/g) ?? []).length;
    expect(hits, "the ladder key must be invalidated by the mutations that move it").toBeGreaterThanOrEqual(6);
  });

  it("every rung's fix link points into one of the four doors", () => {
    const doorHrefs = FOUNDER_DOORS.map((d) => d.href);
    for (const r of RUNG_SPECS) {
      expect(doorHrefs, `${r.key} → ${r.href}`).toContain(r.href);
    }
  });
});

describe("The Letter gained exactly one setup line", () => {
  it("renders the single-line component, not the ladder itself", () => {
    expect(LETTER).toContain("ReadinessLadderLetterLine");
    expect(LETTER).not.toContain("<ReadinessLadderSection");
  });

  it("the line appears in both the quiet-day and full letter, and nowhere else", () => {
    const hits = (LETTER.match(/<ReadinessLadderLetterLine \/>/g) ?? []).length;
    expect(hits).toBe(2);
  });
});

describe("the rung catalogue is coherent", () => {
  it("rung keys are unique", () => {
    const keys = RUNG_SPECS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every rung sits in a declared stage", () => {
    for (const r of RUNG_SPECS) expect(RUNG_STAGES).toContain(r.stage);
  });

  it("ordering is total — no rung is dropped or duplicated", () => {
    const ordered = orderRungs([...RUNG_SPECS]);
    expect(new Set(ordered.map((r) => r.key)).size).toBe(RUNG_SPECS.length);
  });

  it("at least one rung in every stage, so no stage is dead weight", () => {
    for (const stage of RUNG_STAGES) {
      expect(RUNG_SPECS.some((r) => r.stage === stage), stage).toBe(true);
    }
  });
});
