/**
 * The persona walks (tests/simulation/walks/persona-walks.ts) are the one
 * measurement of whether a customer can FINISH a job on a phone and a desktop.
 * They need a running world, so CI cannot run them; this file keeps the walk
 * itself honest so that the numbers it reports mean what they say.
 *
 * 2026-10-08 the walks found eight dead ends — import a list and send
 * postcards on a phone, send postcards on desktop, record a borrower payment
 * on both, invite a VA on a phone, see what the VA did on both — and 93
 * serious/critical axe nodes. All eight were text-only targets: a campaign
 * NAMED "Postcards d4" in a list satisfied "send postcards". So:
 *
 *   1. every one of the eight jobs asserts the CONTROL that does it (role +
 *      accessible name), not a word on the page;
 *   2. the walk compares itself with walk-baseline.json and exits non-zero on
 *      any number that grew — dead ends, axe nodes, unlabelled controls,
 *      empty states without a call to action;
 *   3. the baseline's numbers are pinned here, so they can only go down.
 *
 * Mutations (each red): delete the `control` of "Record a borrower payment";
 * raise deadEnds in walk-baseline.json; drop `process.exitCode = 1` from the
 * ratchet branch.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const WALK = "tests/simulation/walks/persona-walks.ts";
const src = fs.readFileSync(path.join(ROOT, WALK), "utf8");
const sf = ts.createSourceFile(WALK, src, ts.ScriptTarget.Latest, true);

/** The eight jobs that were dead ends on 2026-10-08. */
const FORMER_DEAD_ENDS = [
  "Import my list of owners",
  "Send postcards to my leads",
  "Record a borrower payment",
  "Invite my VA",
  "See what my VA did today",
];

function customerTasks(): Array<{ question: string; hasControl: boolean }> {
  const out: Array<{ question: string; hasControl: boolean }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "CUSTOMER_TASKS" && n.initializer) {
      const walk = (m: ts.Node) => {
        if (ts.isObjectLiteralExpression(m)) {
          const props = new Map<string, ts.Expression>();
          for (const p of m.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p.initializer);
          const q = props.get("question");
          if (q && ts.isStringLiteral(q)) {
            const c = props.get("control");
            out.push({ question: q.text, hasControl: !!c && ts.isObjectLiteralExpression(c) && c.properties.length >= 2 });
          }
        }
        ts.forEachChild(m, walk);
      };
      walk(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("the persona walks guard the jobs they found broken", () => {
  const tasks = customerTasks();

  it("vacuity: the customer tasks are read", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(7);
  });

  it.each(FORMER_DEAD_ENDS)("“%s” passes only when the control that does it is on screen", (question) => {
    const t = tasks.find((x) => x.question === question);
    expect(t, `${question} is no longer walked`).toBeDefined();
    expect(t!.hasControl, `${question} has no control assertion — a word on the page is not a finished job`).toBe(true);
  });

  it("a job is reached only through the control check, not the text alone", () => {
    expect(src).toMatch(/async function reached\(page: Page, t: Task\)/);
    expect(src).toMatch(/getByRole\(t\.control\.role, \{ name: t\.control\.name \}\)/);
    expect((src.match(/await reached\(page, t\)/g) ?? []).length).toBe(2);
  });
});

describe("the walk is a ratchet", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/simulation/walks/walk-baseline.json"), "utf8"));

  it("its numbers are pinned and may only go down", () => {
    // 2026-10-08: 93 axe nodes, 8 dead ends, 7 unlabelled, 3 empty states without a CTA.
    // 2026-10-10 (this wave): measured on seed 11, 21 simulated days, both viewports.
    expect(baseline).toMatchObject({ axeSeriousCritical: 0, deadEnds: 0, unlabelled: 0, emptyStatesWithoutCta: 2 });
    expect(baseline.pagesFloor).toBeGreaterThanOrEqual(18);
  });

  it("the walk reads the baseline and fails when a number grows", () => {
    expect(src).toContain('new URL("./walk-baseline.json", import.meta.url)');
    const branch = src.slice(src.indexOf("if (grew.length) {"), src.indexOf("if (grew.length) {") + 400);
    expect(branch).toContain("process.exitCode = 1");
  });
});
