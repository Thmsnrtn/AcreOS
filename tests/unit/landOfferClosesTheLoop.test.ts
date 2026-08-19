/**
 * The land vertical enters the canonical loop.
 *
 * THE GAP
 * ───────
 * `recordDecision` had exactly two non-generic production call sites — the flip
 * analyzer and lot pricing — so of fifteen verticals only fix_and_flip and
 * subdivider reached the `decided` evidence tier. Land, the wedge and the
 * broadest feature surface, recorded nothing: its Today outcome prompt
 * (`/api/decisions/due`) was structurally empty and forecast calibration had
 * nothing to grade.
 *
 * THE DELIBERATE ACT
 * ──────────────────
 * Drafting an offer letter, not computing one. `POST /api/data-intel/blind-offer`
 * is a CALCULATION the wizard re-runs as the operator tunes inputs; recording
 * there would fill decision memory with keystrokes. `POST /api/offer-letters/batch`
 * is where the number becomes a document addressed to an owner — the same
 * moment, and the same stated reason, as the flip analyzer.
 *
 * WHAT IS ASSERTED
 * ────────────────
 * The wiring, and the four properties that make the record honest rather than
 * merely present:
 *   - it records once per LETTER, and only for letters with a property;
 *   - the authority names the real grant, not a generic "system";
 *   - `reviewDueAt` is the offer's own expiry, because the type is
 *     required-nullable precisely so "never reviewed" and "review forgotten"
 *     stay distinguishable;
 *   - it is best-effort, so a bookkeeping failure cannot turn a created batch
 *     into a 500 the operator reads as "nothing happened".
 *
 * Asserted against the route source with comments stripped and a floor, because
 * the handler is registered on an Express app behind two middlewares and is not
 * exported. The behaviour of `recordDecision` itself is proven by its own suite;
 * what is unproven without this file is that LAND reaches it at all — the
 * adoption half of canonical, which this repository has been bitten by twice.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function strippedRoute(): string {
  const raw = readFileSync(
    resolve(__dirname, "../../server/routes-team-messaging.ts"), "utf8",
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  expect(code.length, "comment stripping removed the file").toBeGreaterThan(raw.length * 0.3);
  const start = code.indexOf('"/api/offer-letters/batch"');
  expect(start, "the batch route moved or was renamed").toBeGreaterThan(-1);
  const body = code.slice(start, start + 6000);
  expect(body.length, "the route body is too short to be the real one").toBeGreaterThan(1500);
  return body;
}

describe("an offer letter batch records a decision", () => {
  it("vacuity: the route body is the real one and still creates letters", () => {
    const body = strippedRoute();
    expect(body).toContain("createOfferLettersBatch");
  });

  it("reaches the canonical decision store", () => {
    const body = strippedRoute();
    expect(body, "land does not record a decision — the loop is open again")
      .toContain("recordDecision");
    // The CANONICAL one. Three other functions in this repo are also called
    // `recordDecision`, all on founder routes; importing one of those here
    // would look identical in a naive grep.
    expect(body).toContain("services/decisions/decisionStore");
  });

  it("records per letter, and skips a letter with no property", () => {
    const body = strippedRoute();
    expect(body).toMatch(/for\s*\(\s*const letter of createdLetters\s*\)/);
    expect(body, "a letter with no property must not be recorded against property 0")
      .toMatch(/if\s*\(\s*!letter\.propertyId\s*\)\s*continue/);
  });

  it("names the real authority, not a generic one", () => {
    const body = strippedRoute();
    expect(body).toContain("org_member:offer_letter_batch");
    // The failure this avoids is recorded in the decision contract itself:
    // automation must name the capability grant, never a global mode flag.
    expect(body).not.toMatch(/authority:\s*["'](system|autonomous|automation)["']/);
  });

  it("sets a review date rather than passing null", () => {
    const body = strippedRoute();
    expect(body).toMatch(/reviewDueAt:\s*expirationDate/);
  });

  it("is best-effort — a failed record cannot cost the operator the batch", () => {
    const body = strippedRoute();
    const recordAt = body.indexOf("recordDecision");
    const createAt = body.indexOf("createOfferLettersBatch");
    // Recorded AFTER the letters exist, so a throw cannot prevent them.
    expect(createAt).toBeLessThan(recordAt);
    // And inside a catch that logs rather than rethrows.
    const after = body.slice(recordAt);
    expect(after).toMatch(/catch\s*\(\s*err\s*\)/);
    expect(after).toContain("the offers stand, the loop entry did not");
  });

  it("cites no scenario it did not run", () => {
    const body = strippedRoute();
    // The batch prices from assessed value and a percent; it computes no exit
    // model. Freezing a scenario reference here would cite economics that were
    // never calculated — worse than citing none.
    expect(body).not.toMatch(/recordScenario/);
  });
});
