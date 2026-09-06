/**
 * The helper 91 gates depend on was blanking live code in 232 of 3,692 files.
 *
 * ── WHAT WAS MEASURED (2026-09-06) ────────────────────────────────────────
 * `stripComments` was written to end a specific class of bug: the two-regex
 * idiom (`src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"")`), which
 * eats whole files when a line comment contains `/*`. Its replacement was a
 * single left-to-right scan that understood strings, templates and comments.
 *
 * It did not understand REGEX LITERALS. So this line, from a gate written the
 * same week —
 *
 *     return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
 *
 * — holds THREE double quotes. The scan opened a string at the third and ran
 * to the next `"` anywhere in the file: comment markers crossed on the way
 * were swallowed (so comments SURVIVED, unstripped) and live code was treated
 * as string (so it was never examined). Measured across the repo, 232 files
 * ended the scan mid-token; `server/ai/supportAgent.ts` — the 91-case dispatch
 * switch this codebase names as a load-bearing population — lost 15,762
 * characters to it, silently, in every gate that read it.
 *
 * CLAUDE.md names this exact class and says it was already paid for once, "and
 * did it inside `maskComments` itself". The canonical replacement had it too.
 *
 * ── WHY IT PARSES NOW ─────────────────────────────────────────────────────
 * Teaching the scan about regexes was tried and abandoned: `/` versus division
 * needs the previous significant token; TypeScript's postfix `!`
 * (`cac.cacUsd! / n`) inverts that rule; `[...]` classes make `/[/*]/` both a
 * valid regex and a block comment; nested `${}` needs a depth stack; and JSX
 * is full of slashes no expression lexer will ever get right. The hand-rolled
 * version refused 720 files.
 *
 * TypeScript's parser has already resolved every one of those in order to
 * build a tree at all. So the helper asks it where the comments are — the
 * fourth law's own advice ("prefer a parse to a scan") applied to the tool the
 * fourth law is about.
 *
 * ── WHAT THIS FILE HOLDS ──────────────────────────────────────────────────
 * One fixture per trap, each hiding the defect inside the exact shape the
 * helper relies on. A shape with no fixture is a shape the helper is free to
 * stop reading — and the repo-wide floor at the end is what says the fixtures
 * are not the only thing being read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

/** The comment must be gone, and every other character must be untouched. */
function check(source: string, opts: { comment: string; keep: string[] }) {
  const out = stripComments(source);
  expect(out.length, "offsets must be preserved — comments become spaces").toBe(source.length);
  expect(out, `the comment survived: ${opts.comment}`).not.toContain(opts.comment);
  for (const k of opts.keep) {
    expect(out, `live code was eaten: ${k}`).toContain(k);
  }
  return out;
}

describe("stripComments — the traps that made the previous version wrong", () => {
  it("a regex holding an ODD number of quotes does not open a string", () => {
    // The exact line that cost 232 files.
    check(
      [
        'const values = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);',
        "// EATEN",
        'const live = "kept";',
      ].join("\n"),
      { comment: "EATEN", keep: ['const live = "kept";', "matchAll("] },
    );
  });

  it("a regex holding an apostrophe does not open a string either", () => {
    check(
      ["const re = /[<>&'\"]/g;", "// EATEN", "const live = 1;"].join("\n"),
      { comment: "EATEN", keep: ["const live = 1;", "const re ="] },
    );
  });

  it("a `/*` inside a character class is not a block comment", () => {
    check(
      ["const re = /[/*]/g;", "// EATEN", "const live = 2;"].join("\n"),
      { comment: "EATEN", keep: ["const live = 2;"] },
    );
  });

  it("division is not a regex — the text between two slashes survives", () => {
    check(
      ["const ratio = a / b; const other = c / d;", "// EATEN", "const live = 3;"].join("\n"),
      { comment: "EATEN", keep: ["const ratio = a / b;", "const other = c / d;", "const live = 3;"] },
    );
  });

  it("TypeScript's POSTFIX ! leaves a division, not a regex", () => {
    // CLAUDE.md: "the fix for the second introduced a fourth: TypeScript's
    // postfix `!` (`cac.cacUsd! / n`) read as a prefix logical-not, turning a
    // division into a regex that swallowed the rest of the handler."
    check(
      ["const perUnit = cac.cacUsd! / n; const also = x!.y! / 2;", "// EATEN", "const live = 4;"].join("\n"),
      { comment: "EATEN", keep: ["cac.cacUsd! / n", "x!.y! / 2", "const live = 4;"] },
    );
  });

  it("a PREFIX ! before a regex is still a regex", () => {
    check(
      ["const bad = !/^[a-z]+$/.test(s);", "// EATEN", "const live = 5;"].join("\n"),
      { comment: "EATEN", keep: ["!/^[a-z]+$/.test(s)", "const live = 5;"] },
    );
  });

  it("a NESTED template does not close the outer one", () => {
    check(
      ["const s = `a ${`b ${c} d`} e`;", "// EATEN", "const live = 6;"].join("\n"),
      { comment: "EATEN", keep: ["const live = 6;"] },
    );
  });

  it("an apostrophe in a line comment does not open a string", () => {
    // The trap the previous version WAS written for; it must not regress.
    check(
      ["// deployment doesn't carry it", 'const live = "kept";', "// EATEN"].join("\n"),
      { comment: "EATEN", keep: ['const live = "kept";'] },
    );
  });

  it("a `/*` inside a LINE comment does not open a block comment", () => {
    // The original two-regex defect: this swallowed 3,000 lines of
    // server/routes-borrower.ts.
    check(
      ["// retired in favour of /api/borrower/*. Per RFC", 'const live = "kept";', "// EATEN"].join("\n"),
      { comment: "EATEN", keep: ['const live = "kept";'] },
    );
  });

  it("JSX slashes are not regexes", () => {
    check(
      [
        "const el = <div className=\"x\"><br /><span>{a < b ? 1 : 2}</span></div>;",
        "// EATEN",
        "const live = 7;",
      ].join("\n"),
      { comment: "EATEN", keep: ["<br />", "const live = 7;"] },
    );
  });

  it("a .ts generic call is not JSX", () => {
    // The mirror of the previous case: forcing TSX on a plain .ts file turns
    // `db.select<Row>()` into an unclosed JSX element and the trivia lands
    // somewhere else entirely.
    check(
      ["const rows = db.select<Row>().from(t); const c = a < b && c > d;", "// EATEN", "const live = 8;"].join("\n"),
      { comment: "EATEN", keep: ["db.select<Row>()", "const live = 8;"] },
    );
  });

  it("a URL inside a string keeps its slashes", () => {
    const out = check(
      ['const u = "https://example.com/a//b";', "// EATEN", "const live = 9;"].join("\n"),
      { comment: "EATEN", keep: ['"https://example.com/a//b"', "const live = 9;"] },
    );
    expect(out).toContain("//b");
  });

  it("block comments go, and only they", () => {
    check(
      ["/* EATEN */ const live = 10; /* EATEN2 */", "const also = 11;"].join("\n"),
      { comment: "EATEN", keep: ["const live = 10;", "const also = 11;"] },
    );
  });
});

describe("and nothing goes back to hand-rolling it", () => {
  const ROOT = process.cwd();
  function walkTests(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (["node_modules", "fixtures", "__snapshots__"].includes(e)) continue;
      const abs = path.join(dir, e);
      if (statSync(abs).isDirectory()) walkTests(abs, out);
      else if (/\.(ts|tsx)$/.test(e)) out.push(abs);
    }
    return out;
  }

  it("no test hand-rolls the block-comment strip", () => {
    // 36 gates were migrated off this idiom on 2026-09-06, after measuring
    // that it disagrees with a correct strip on 1,057 of 2,543 production
    // files. Without this, the 37th arrives by copy-paste from the 36th.
    //
    // The scan strips comments before looking — with the helper under test —
    // because this file's own header quotes the idiom, and a gate that reads
    // its own documentation as the defect is the fourth law's shape.
    const files = walkTests(path.join(ROOT, "tests"));
    expect(files.length, "the test walk found nothing — this is vacuous")
      .toBeGreaterThan(500);

    const offenders: string[] = [];
    for (const abs of files) {
      const code = stripComments(readFileSync(abs, "utf8"));
      // The block-comment regex, in the spellings this repo used.
      if (/\.replace\(\s*\/\\\/\\\*\[\\s\\S\]/.test(code)) {
        offenders.push(path.relative(ROOT, abs));
      }
    }
    expect(
      offenders,
      "these files strip comments by regex instead of importing " +
        "tests/helpers/stripComments — which disagrees with a correct strip on " +
        "42% of this repo's source files, in both directions",
    ).toEqual([]);
  });
});

describe("and it is right about the whole repository, not just the fixtures", () => {
  const ROOT = process.cwd();
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (["node_modules", "dist", "build", ".git"].includes(e)) continue;
      const abs = path.join(dir, e);
      if (statSync(abs).isDirectory()) walk(abs, out);
      else if (/\.(ts|tsx)$/.test(e)) out.push(abs);
    }
    return out;
  }
  const files = ["server", "shared", "scripts"].flatMap((r) => walk(path.join(ROOT, r)));

  it("never ends mid-token on any source file", () => {
    // THE MEASUREMENT THAT FOUND THIS. Append a comment; if it survives, the
    // scan finished inside a string, template, regex or comment, and every
    // byte from there back to wherever that state opened was read wrong.
    //
    // 232 files failed this before the rewrite. The count is asserted at zero
    // rather than ratcheted: there is no such thing as an acceptable number of
    // files a comment-stripper silently corrupts.
    expect(files.length, "the file walk found nothing — this test is vacuous")
      .toBeGreaterThan(1000);

    const CANARY = "\n// CANARY_SENTINEL_DO_NOT_MATCH\n";
    const broken: string[] = [];
    for (const abs of files) {
      const src = readFileSync(abs, "utf8");
      if (stripComments(src + CANARY).includes("CANARY_SENTINEL_DO_NOT_MATCH")) {
        broken.push(path.relative(ROOT, abs));
      }
    }
    expect(broken.slice(0, 10), `${broken.length} file(s) end the strip mid-token`).toEqual([]);
  });

  it("never changes a file's length", () => {
    // Comments become SPACES so every offset still matches the original. A
    // caller measuring a distance between two anchors depends on it.
    const changed = files.filter((abs) => {
      const src = readFileSync(abs, "utf8");
      return stripComments(src).length !== src.length;
    });
    expect(changed.map((f) => path.relative(ROOT, f)).slice(0, 10)).toEqual([]);
  });
});
