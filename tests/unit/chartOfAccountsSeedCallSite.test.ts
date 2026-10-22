/**
 * The chart-of-accounts seed runs once per CREATED org — founder orgs included.
 *
 * getOrCreateOrg provisions inside a coalescing lock (#394): every concurrent
 * request for a new user reaches the creation path, but only the one whose
 * transaction inserted the row sees `provisioned.created === true`. The seed
 * belongs in that branch, and outside its nested `if (!isFounder)` guard —
 * startJourney is customer-only, a chart of accounts is not.
 *
 * WHY THIS TEST EXISTS: refreshing #395 onto #394 merged textually clean and
 * left the call after the provisioning try/finally, outside the created branch.
 * Nothing went red. The seed is idempotent, so the misplacement was harmless
 * that time, but placement is the property and only a structural read pins it.
 * The file is parsed, never string-scanned, so the comments that name the call
 * cannot satisfy it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const FILE = path.join(process.cwd(), "server", "middleware", "getOrCreateOrg.ts");

/** Text of the `if` conditions whose THEN branch encloses `node` (outermost first). */
function enclosingThenConditions(node: ts.Node, sf: ts.SourceFile): string[] {
  const out: string[] = [];
  let child: ts.Node = node;
  let parent = node.parent;
  while (parent) {
    if (ts.isIfStatement(parent) && parent.thenStatement === child) {
      out.unshift(parent.expression.getText(sf).replace(/\s+/g, ""));
    }
    child = parent;
    parent = parent.parent;
  }
  return out;
}

function seedCalls(src: string): string[][] {
  const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: string[][] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "seedChartOfAccountsForOrg") {
      sites.push(enclosingThenConditions(n, sf));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

describe("getOrCreateOrg seeds the chart of accounts for every created org", () => {
  const sites = seedCalls(readFileSync(FILE, "utf8"));

  it("calls the seed exactly once", () => {
    expect(sites).toHaveLength(1);
  });

  it("inside `if (provisioned.created)`, and not behind the customer-only `!isFounder` guard", () => {
    const conditions = sites[0] ?? [];
    expect(conditions).toContain("provisioned.created");
    expect(conditions).not.toContain("!isFounder");
  });

  // Canaries: the reader must reject both misplacements, or the checks above
  // pass vacuously over a parser that stopped finding the call.
  it("rejects a call outside the created branch, and one inside the !isFounder guard", () => {
    const outside = `async function f(){ if (provisioned.created) { x(); } seedChartOfAccountsForOrg(id); }`;
    const guarded = `async function f(){ if (provisioned.created) { if (!isFounder) { seedChartOfAccountsForOrg(id); } } }`;
    expect(seedCalls(outside)[0]).not.toContain("provisioned.created");
    expect(seedCalls(guarded)[0]).toContain("!isFounder");
  });
});
