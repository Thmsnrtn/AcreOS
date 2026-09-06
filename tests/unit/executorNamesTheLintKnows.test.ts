/**
 * Rename the executor and the tenancy lint stops seeing the query.
 *
 * `check-org-scoped-fetch.mjs` finds writes with
 *
 *     /\b(?:from|(?:db|tx)\s*\.\s*update|(?:db|tx)\s*\.\s*delete)\s*\(…/
 *
 * — an enumeration of executor SPELLINGS. On 2026-09-06, threading an optional
 * executor through the audit chain as `exec: PrimaryDb = db` made
 * `exec.update(auditLog)` invisible to it. The lint did not go red; it went
 * QUIET, and then reported a burn-down entry that "no longer matches anything —
 * they were fixed or deleted (good!)". Deleting that entry, as instructed, would
 * have recorded a blind spot as a win.
 *
 * That is the third law aimed at a lint's population predicate: the set of
 * executor names is an assumption, invisible in a green result. This test makes
 * a new name fail loudly instead of silently.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * Any parameter typed `PrimaryDb` is a query executor. Its name must be one the
 * lint's own regex recognises — and the recognised set is READ OUT OF THE LINT,
 * not restated here, so widening the regex automatically widens what is allowed
 * and the two cannot drift apart.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const LINT = path.join(ROOT, "scripts", "check-org-scoped-fetch.mjs");

/** The executor names the lint's write-detection regex actually accepts. */
function executorNamesTheLintKnows(): string[] {
  const src = readFileSync(LINT, "utf8");
  // The alternation inside the update/delete branch, e.g. `(?:db|tx)`.
  const m = /\(\?:([A-Za-z0-9_|]+)\)\\s\*\\\.\\s\*update/.exec(src);
  expect(m, "the lint's write-access regex has changed shape — re-derive this list from it")
    .toBeTruthy();
  return m![1].split("|").filter(Boolean);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", "build"].includes(e)) continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) out.push(abs);
  }
  return out;
}

/** `PrimaryDb`, or a union of it with null/undefined — not a function type. */
function isExecutorType(node: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(node)) {
    return node.typeName.getText().split(".").pop() === "PrimaryDb";
  }
  if (ts.isUnionTypeNode(node)) {
    return node.types.some((t) => isExecutorType(t));
  }
  return false;
}

type Offence = { file: string; fn: string; param: string; line: number };

function executorParams(src: string, file: string): Offence[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Offence[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n)
    ) {
      for (const p of n.parameters) {
        // The parameter must BE an executor, not merely mention one in its type.
        // `withTransaction(fn: (tx: PrimaryDb) => Promise<T>)` takes a CALLBACK;
        // the executor there is the callback's own parameter, which this walk
        // reaches on its own when it visits that function.
        if (!p.type || !isExecutorType(p.type)) continue;
        const name = p.name.getText(sf);
        // `this: DatabaseStorage`-style pseudo-params are not executors.
        if (name === "this") continue;
        const owner =
          (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name
            ? n.name.getText(sf)
            : "(anonymous)";
        found.push({
          file,
          fn: owner,
          param: name,
          line: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

const serverFiles = walk(path.join(ROOT, "server"));

describe("an executor parameter is named something the tenancy lint can see", () => {
  it("the lint's known-name set is derivable and non-empty", () => {
    const names = executorNamesTheLintKnows();
    expect(names.length, "the lint recognises no executor names at all").toBeGreaterThan(0);
    expect(names, "`db` must always be recognised").toContain("db");
  });

  it("the population is real", () => {
    expect(serverFiles.length, "the server walk found almost nothing").toBeGreaterThan(500);
    const withExecutors = serverFiles.filter((abs) =>
      executorParams(stripComments(readFileSync(abs, "utf8")), abs).length > 0,
    );
    expect(
      withExecutors.length,
      "no executor parameters found anywhere — the detector has stopped matching " +
        "and the rule below is vacuous",
    ).toBeGreaterThan(0);
  });

  it("every PrimaryDb parameter uses a name the lint recognises", () => {
    const known = new Set(executorNamesTheLintKnows());
    const offenders: string[] = [];
    for (const abs of serverFiles) {
      // Comments stripped: a doc comment naming a rejected parameter name is a
      // record of the decision, not the decision.
      for (const o of executorParams(stripComments(readFileSync(abs, "utf8")), abs)) {
        if (!known.has(o.param)) {
          offenders.push(`${path.relative(ROOT, abs)}:${o.line}  ${o.fn}(… ${o.param}: PrimaryDb)`);
        }
      }
    }
    expect(
      offenders,
      `check-org-scoped-fetch.mjs detects writes only through [${[...known].join(", ")}]. ` +
        "A query on an executor it does not know is not flagged — it is NOT SEEN, " +
        "and the lint stays green over it. Either name the parameter one of those, " +
        "or widen the lint's regex (this test reads the set from the lint, so both " +
        "move together).",
    ).toEqual([]);
  });
});
