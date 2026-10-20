/**
 * STR copy promises only what a customer-reachable screen delivers (P1-C item 9).
 *
 * The onboarding persona card promised "channel-CSV import, per-stay P&L,
 * turnovers, and your own nightly pricing", and the Bookings empty state said
 * "Record a stay, or import your own Airbnb/VRBO CSV export" — while the
 * Bookings panel issues two GETs and nothing else, and no client file calls
 * the import / P&L / turnovers / pricing / create-reservation routes.
 *
 * The rule is DERIVED, not a word ban: each promise is allowed back the moment
 * some client file actually calls the route that delivers it. Population: the
 * STR description in onboarding-v2.tsx and every non-comment line of
 * bookings-panel.tsx; callers: every .ts/.tsx under client/src.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), "utf8"));

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

/** promise in copy → evidence a client screen delivers it. */
const PROMISES: Array<{ name: string; copy: RegExp; caller: RegExp }> = [
  { name: "CSV / channel import", copy: /\bcsv\b|\bimport\b/i, caller: /\/reservations\/import/ },
  { name: "per-stay P&L", copy: /p&l|profit and loss/i, caller: /\/reservations\/[^"'`]*\/pnl|\/pnl[`"']/ },
  { name: "turnovers", copy: /turnover/i, caller: /\/turnovers/ },
  { name: "operator nightly pricing", copy: /nightly pricing|your own .*pricing|set .*nightly rate/i, caller: /\/reservations\/[^"'`]*\/pricing/ },
  { name: "record a stay", copy: /record a stay/i, caller: /method:\s*["']POST["'][\s\S]{0,200}\/reservations[`"']|apiRequest\(\s*["']POST["'],\s*`[^`]*\/reservations`/ },
];

function strDescription(): string {
  const src = read("client/src/pages/onboarding-v2.tsx");
  const m = src.match(/value:\s*"short_term_rental"[^}]*?description:\s*"([^"]*)"/);
  expect(m, "STR onboarding option found").not.toBeNull();
  return m![1];
}

describe("STR copy", () => {
  it("reads its population (vacuity floor)", () => {
    expect(clientFiles.length).toBeGreaterThan(500);
    expect(strDescription().length).toBeGreaterThan(10);
    expect(read("client/src/components/rentals/bookings-panel.tsx")).toMatch(/testId="bookings-empty"/);
  });

  const surfaces: Array<[string, () => string]> = [
    ["onboarding STR description", strDescription],
    // Module import declarations are code, not copy.
    ["bookings panel", () => read("client/src/components/rentals/bookings-panel.tsx")
      .replace(/^\s*import\b[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")],
  ];

  for (const [surface, text] of surfaces) {
    for (const p of PROMISES) {
      it(`${surface}: promises "${p.name}" only if a client screen calls its route`, () => {
        if (!p.copy.test(text())) return;
        expect(clientSrc, `${surface} promises ${p.name} but no client file calls its route`).toMatch(p.caller);
      });
    }
  }
});
