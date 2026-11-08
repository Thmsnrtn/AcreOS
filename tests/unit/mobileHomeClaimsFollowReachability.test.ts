/**
 * Mobile-home home-side claims follow REACHABILITY (W2-MHP, 2026-11-06).
 *
 * Wave 5 built three home-side capabilities server-side — the lot-vs-home rent
 * split, the utility billback, and the home/chattel-title record with meter
 * reads — and the Pax mobile-homes voice told customers all three were real.
 * No client file called any of their routes. W2-MHP lit up the RECORD half (a
 * pad's "Home & meters" dialog on the Units tab) and stopped the split and the
 * billback for a founder call, so the voice may not offer those two.
 *
 * The rule is DERIVED, not a word ban (the STR precedent,
 * strCopyPromisesOnlyWhatShips.test.ts): a capability may be stated
 * affirmatively the moment some client file calls the route that delivers it.
 * Until then every clause that mentions it must be a negated one ("does not
 * compute …", "Never imply …").
 *
 * CLAUSES, not sentences: the Wave 5 overclaim sat in ONE sentence that also
 * held "never inferred" and "moves no money", so a sentence-level negation test
 * reads it as a disclosure. The canary pins that exact text as a violation.
 *
 * Population: every string the MOBILE_HOMES persona hands Pax, the mobile_home
 * onboarding copy, and the rendered copy of the two components that show the
 * home side — taken by PARSING them (string literals + JSX text), so a comment
 * or an identifier is never read as a claim. Callers: every .ts/.tsx under
 * client/src, comment-stripped.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { PERSONAS } from "../../server/services/pax/personas";
import { VERTICAL_ONBOARDING } from "../../client/src/lib/onboarding-verticals";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const clientFiles = walk(resolve(ROOT, "client/src"));
const clientSrc = clientFiles.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");

/** Every string value in a persona/copy object, however deeply nested. */
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v]
    : Array.isArray(v) ? v.flatMap(strings)
      : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

/** What a component RENDERS: its string literals and JSX text, by parse. */
function renderedCopy(rel: string): string {
  const sf = ts.createSourceFile(rel, readFileSync(resolve(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) return; // module specifiers are code, not copy
    if (ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.join(". ");
}

/**
 * capability → how copy mentions it, and the client call that delivers it.
 * "split" alone is not the capability (the bulk-paste help says "commas and
 * semicolons also split"); the rent split is a split named with lot/home/POH/TOH.
 */
const CAPS = {
  split: {
    name: "lot-vs-home rent split",
    mention: /^(?=.*\bsplit\b)(?=.*\b(?:lot|home|POH|TOH)\b)/i,
    caller: /\/mobile-home\/lot-rent-split/,
  },
  billback: { name: "utility billback", mention: /billback|pass-through|\bRUBS\b/i, caller: /\/utility-billback\/generate/ },
  record: { name: "home + chattel-title record", mention: /chattel titles? (?:is|are) RECORDED|who owns the home/i, caller: /\/mobile-home[`"']/ },
  meters: { name: "meter reads", mention: /meter reads?\b/i, caller: /\/meter-reads[`"']/ },
} as const;

const NEGATED = /\b(?:not|never|no|nor|cannot)\b|n't\b/i;
/** Clauses: split on sentence ends AND the punctuation prose hangs asides off. */
const clauses = (text: string) =>
  text.replace(/\s+/g, " ").split(/[.;:()—]+/).map((c) => c.trim()).filter(Boolean);
/** Clauses that state the capability WITHOUT negating it. */
const affirmative = (text: string, mention: RegExp) => clauses(text).filter((c) => mention.test(c) && !NEGATED.test(c));

/** Verbatim from main before W2-MHP — the overclaim this file exists to keep out. */
const WAVE5_OVERCLAIM =
  "AcreOS now models the home side too: the home-vs-lot rent split and POH/TOH mix are computed from the " +
  "operator's OWN recorded rents (refused per lease when the split isn't recorded, never inferred); chattel " +
  "titles are RECORDED (title type, VIN, status) — a record they enter, never a DMV/registry verification or a " +
  "lien assertion; and utilities pass-through is billed by submeter (current minus prior read × rate) or RUBS " +
  "(a master bill allocated across pads by a recorded basis), written as a frozen statement and proposed per pad " +
  "— it posts no charge and moves no money.";

const flat = (s: string) => s.replace(/\s+/g, " ");
const SOURCES: Array<[string, string]> = [
  ["Pax mobile-homes persona", flat(strings(PERSONAS.mobile_homes).join(". "))],
  ["mobile_home onboarding copy", flat(strings(VERTICAL_ONBOARDING.mobile_home).join(". "))],
  ["pad home dialog", flat(renderedCopy("client/src/components/rentals/pad-home-dialog.tsx"))],
  ["units panel", flat(renderedCopy("client/src/components/rentals/units-panel.tsx"))],
];
const voice = SOURCES[0][1];
/** Boolean, so a failure names the claim instead of printing all of client/src. */
const called = (caller: RegExp) => caller.test(clientSrc);

describe("mobile-home home-side claims", () => {
  it("reads its population (vacuity floor)", () => {
    expect(clientFiles.length).toBeGreaterThan(500);
    for (const [name, text] of SOURCES) expect(clauses(text).length, name).toBeGreaterThan(5);
    expect(voice).toMatch(/AcreOS models pad inventory/);
    expect(SOURCES[1][1]).toMatch(/lot rent/);
    // The parse reached rendered copy, not just imports.
    expect(SOURCES[2][1]).toMatch(/Save home record/);
    expect(SOURCES[3][1]).toMatch(/Rentable slots/);
  });

  it("the detector is falsified against the overclaim it guards (canaries)", () => {
    expect(affirmative(WAVE5_OVERCLAIM, CAPS.split.mention), "the Wave 5 split claim must read as a claim").not.toEqual([]);
    expect(affirmative(WAVE5_OVERCLAIM, CAPS.billback.mention), "the Wave 5 billback claim must read as a claim").not.toEqual([]);
    expect(affirmative("AcreOS computes each park's POH/TOH split.", CAPS.split.mention)).not.toEqual([]);
    // …and reads a disclosure as a disclosure.
    expect(affirmative("AcreOS does not compute the lot-vs-home rent split or a utility billback in the product.", CAPS.split.mention)).toEqual([]);
    expect(affirmative("Never imply an in-product split or billback.", CAPS.billback.mention)).toEqual([]);
  });

  for (const [source, text] of SOURCES) {
    for (const cap of Object.values(CAPS)) {
      it(`${source}: states "${cap.name}" only if a client file calls its route`, () => {
        const claims = affirmative(text, cap.mention);
        if (claims.length === 0) return;
        expect(called(cap.caller), `${source} states ${cap.name} ("${claims[0]}") but no client file calls its route`).toBe(true);
      });
    }
  }

  it("the reachable record half is offered by the voice AND called by the client", () => {
    for (const cap of [CAPS.record, CAPS.meters]) {
      expect(affirmative(voice, cap.mention), `the voice should offer the ${cap.name}`).not.toEqual([]);
      expect(called(cap.caller), `no client file calls the ${cap.name} route`).toBe(true);
    }
  });

  it("while the split and the billback have no caller, the voice says AcreOS does not compute them", () => {
    if (!called(CAPS.split.caller)) expect(voice).toMatch(/does not compute the lot-vs-home rent split/i);
    if (!called(CAPS.billback.caller)) expect(voice).toMatch(/or a utility billback in the product/i);
  });
});
