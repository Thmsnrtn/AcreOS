/**
 * `OrgScopedDb` calls itself "the one true entry point". Four of its six
 * helpers had never been called.
 *
 * ── WHAT WAS MEASURED (2026-09-06) ────────────────────────────────────────
 * The class's doc comment says route handlers call `forOrg(getOrganizationId(
 * req))` "and from then on every query through the returned handle is
 * tenant-pinned by construction," and the escape hatch below it says "never
 * call this from a customer route handler — use `forOrg()` there."
 *
 * Production reality: THIRTEEN call sites across EIGHT files, none of them in
 * a route handler — every one is in server/storage/*Repo.ts — and every one
 * calls the same method, `findById`. `scope`, `existsById`, `listWhere`,
 * `updateById` and `deleteById` had zero production callers between them.
 *
 * That is this repo's second law, verbatim: "a canonical function with zero
 * production callers is not canonical… Authoritative semantics are only one
 * third of it. Canonical requires authoritative semantics + real production
 * adoption + drift prevention." `publicMaturityOf()` was documented as the
 * rule every public surface must render, was tested against its own registry,
 * and had zero production call sites — so anything added to it would silently
 * never have reached the only surface it existed for. Five helpers here are in
 * exactly that state: a change to the org predicate inside `listWhere` reaches
 * nothing at all.
 *
 * ── WHY A RATCHET AND NOT A DELETION ──────────────────────────────────────
 * Deletion is a founder call under the deletion ledger, and these five are not
 * obviously wrong — they are the migration target the header describes, whose
 * migration stalled after `findById`. So this file holds the FACT instead, in
 * a form that cannot go stale:
 *
 *   - ADOPTED methods must keep at least one production caller. If a refactor
 *     takes `findById` to zero, the class becomes entirely decorative and this
 *     goes red rather than passing quietly.
 *   - The UNADOPTED set may only SHRINK. Adopting one and removing it from the
 *     list is the intended move; adding a sixth never-called helper is not.
 *   - A method in neither list fails, so the class cannot grow past this file.
 *
 * ── AND THE SCAN STRIPS COMMENTS ──────────────────────────────────────────
 * Non-negotiable here, because the file being scanned NAMES every one of these
 * methods in its own prose, and so does this header. A substring scan that
 * reads comments would find `listWhere` "used" in the paragraph explaining
 * that it is not. That is the fourth law — a gate reads its own documentation
 * as the defect — and it has cost this repo four green-over-live-defect
 * predicates in a single day.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = process.cwd();
const SOURCE = "server/utils/orgScopedDb.ts";

/** Methods with at least one production caller today. */
const ADOPTED = ["findById"] as const;

/**
 * Methods with ZERO production callers, measured 2026-09-06.
 * This list may only shrink. To remove an entry, adopt the method.
 */
const UNADOPTED = ["scope", "existsById", "listWhere", "updateById", "deleteById"] as const;

const PRODUCTION_ROOTS = ["server", "shared", "client/src", "packages"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === "build") continue;
    const abs = path.join(dir, e);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(abs);
  }
  return out;
}

const productionFiles = PRODUCTION_ROOTS.flatMap((r) => walk(path.join(ROOT, r)));

/**
 * Call sites of `.<method>(` in production code, comments stripped, excluding
 * the declaring file. Returns the FILES and the total CALL COUNT — they differ
 * (mailRepo alone holds four `findById` calls), and reporting one as the other
 * is how a number in a comment goes quietly wrong.
 */
const STRIPPED: Array<{ rel: string; code: string }> = productionFiles
  .map((abs) => ({ rel: path.relative(ROOT, abs), abs }))
  .filter((f) => f.rel !== SOURCE)
  .map((f) => ({ rel: f.rel, code: stripComments(readFileSync(f.abs, "utf8")) }));

function productionCallers(method: string): { files: string[]; calls: number } {
  const re = new RegExp(`\\.\\s*${method}\\s*\\(`, "g");
  const files: string[] = [];
  let calls = 0;
  // Read and stripped ONCE, above. Stripping is a parse now (~6ms per file),
  // and re-stripping 2,600 files once per method took this suite past vitest's
  // 30s ceiling the day that landed.
  for (const { rel, code } of STRIPPED) {
    const found = code.match(re);
    if (found) {
      files.push(rel);
      calls += found.length;
    }
  }
  return { files, calls };
}

/** Public instance methods declared on `class OrgScopedDb`. */
function declaredMethods(): string[] {
  const src = stripComments(readFileSync(path.join(ROOT, SOURCE), "utf8"));
  const start = src.indexOf("export class OrgScopedDb");
  expect(start, "class OrgScopedDb is gone — this file is scanning nothing").toBeGreaterThan(-1);
  // Brace-match the class body so a helper declared after it is not counted.
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  expect(end, "could not brace-match the class body — the walk stopped, it did not find zero")
    .toBeGreaterThan(open);
  const body = src.slice(open + 1, end);
  const names = new Set<string>();
  // `  async name<T…>(` or `  name<T…>(` at method indentation.
  const re = /^\s{2}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1];
    if (name === "constructor" || name === "if" || name === "for" || name === "while") continue;
    names.add(name);
  }
  // `static forOrg` is construction, not a query helper.
  names.delete("forOrg");
  return [...names];
}

describe("OrgScopedDb — canonical requires adoption, not just semantics", () => {
  const methods = declaredMethods();

  it("finds the class's methods at all — a zero here is a broken scan, not a clean one", () => {
    expect(methods.length).toBeGreaterThanOrEqual(6);
    expect(productionFiles.length).toBeGreaterThanOrEqual(1000);
    for (const m of [...ADOPTED, ...UNADOPTED]) {
      expect(methods, `${m} is listed here but no longer declared on the class`).toContain(m);
    }
  });

  it("every declared method is accounted for — the class cannot grow past this file", () => {
    const known = new Set<string>([...ADOPTED, ...UNADOPTED]);
    const unaccounted = methods.filter((m) => !known.has(m));
    expect(
      unaccounted,
      "a new OrgScopedDb helper was added without recording whether anything calls it. " +
        "Add it to ADOPTED (with a caller) or to UNADOPTED (and say so in the header).",
    ).toEqual([]);
  });

  it("the adopted methods still have production callers", () => {
    for (const m of ADOPTED) {
      const callers = productionCallers(m).calls;
      expect(
        callers,
        `${m} has no production caller left. OrgScopedDb is now entirely decorative: ` +
          `a change to its org predicate would reach nothing.`,
      ).toBeGreaterThan(0);
    }
  });

  it("the unadopted set only shrinks — a listed method that gained a caller must be promoted", () => {
    const stillDead = UNADOPTED.filter((m) => productionCallers(m).calls === 0);
    const promoted = UNADOPTED.filter((m) => !stillDead.includes(m));
    expect(
      promoted,
      "these methods now HAVE production callers — move them to ADOPTED and delete them from " +
        "UNADOPTED, so the recorded adoption gap keeps matching reality",
    ).toEqual([]);
  });

  it("records the shape of the adoption that exists — none of it in a route handler", () => {
    const { files: callerFiles, calls } = productionCallers("findById");
    // The header says route handlers are the caller. They are not: every one
    // is a storage repo. Pinned so that if the migration the header describes
    // ever actually happens, this assertion is what makes someone update it.
    expect(calls, "findById call sites").toBeGreaterThanOrEqual(13);
    expect(callerFiles.length, "files holding them").toBeGreaterThanOrEqual(8);
    const nonRepo = callerFiles.filter((f) => !/^server\/storage\//.test(f));
    expect(
      nonRepo,
      "findById gained a caller outside server/storage/ — good, the migration moved. " +
        "Update the header in server/utils/orgScopedDb.ts, which still describes an " +
        "adoption pattern that had not happened as of 2026-09-06.",
    ).toEqual([]);
  });
});
