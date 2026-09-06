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
import ts from "typescript";
import {
  REPO_SWEEP_TIMEOUT_MS,
  stripComments,
  stripCommentsReference,
} from "../helpers/stripComments";
import {
  localStripperFindings,
  parseSource,
  type StripperExemption,
} from "../helpers/handRolledStripper";

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

  /**
   * THE POPULATION IS SPELLINGS, NOT JUST FILES.
   *
   * The first version of this gate forbade one string — the two-regex idiom —
   * and was green while 42 test files and 7 lint scripts stripped comments with
   * EIGHT other hand-rolled spellings. Measured 2026-09-06 against the canonical
   * strip over 2,588 source files, each of those spellings read a different
   * repository than the one on disk:
   *
   *   line-based, no guard            336 files disagree
   *   line-based, structural guard    293 files disagree   (31 test files)
   *   hand-rolled lexer, no regexes   382 files disagree, 153 end MID-TOKEN
   *   line comments only            2,296 files disagree   (block comments SURVIVE)
   *   block+line, no string state     514 files disagree
   *   the unhardened `maskComments`   168 files disagree, 150 end MID-TOKEN
   *                                   — shared by 5 scripts inside `npm run check`
   *
   * So the rule is about the SHAPE of a comment stripper, not any one way of
   * writing one. The detector lives in `tests/helpers/handRolledStripper.ts`
   * and has three independent arms; a gate that names its forbidden string can
   * always be defeated by writing the string differently.
   */
  const REGISTER: ReadonlyArray<StripperExemption> = [
    {
      file: "tests/helpers/stripComments.ts",
      fn: "stripComments",
      why: "the canonical implementation for tests — the thing everything else must import",
    },
    {
      file: "tests/helpers/stripComments.ts",
      fn: "stripCommentsUncached",
      why: "the uncached inner half of the canonical implementation",
    },
    {
      file: "tests/helpers/stripComments.ts",
      fn: "stripCommentsReference",
      why: "the tree-walking implementation the fast path is pinned against. A second implementation on purpose — kept slow and obvious so the fast one has something to disagree with; \"agrees with the tree-walking reference on a real sample\" below is what makes it load-bearing rather than dead weight.",
    },
    {
      file: "scripts/lib/strip-comments.mjs",
      fn: "stripCommentsPreservingLines",
      why: "the canonical implementation for the lint scripts, which run under plain node with no build step",
    },
    {
      file: "tests/helpers/handRolledStripper.ts",
      fn: "localStripperFindings",
      why: "the detector below. To find delimiter surgery it must name the delimiters, so it is an offender by its own arm 2. Exempted by name rather than hidden by string concatenation, so this hole is one a reader can see.",
    },
    {
      file: "tests/helpers/stripYamlComments.ts",
      fn: "stripYamlComments",
      why: "YAML, not TypeScript. The canonical stripper is a TS parser and cannot read a workflow file; this is the one shared copy the three workflow gates use.",
    },
    {
      file: "scripts/lint-css-hover.mjs",
      fn: "maskCssComments",
      why: "CSS, not TypeScript. The canonical stripper is a TS parser and cannot read a stylesheet; CSS has no line comments and no regex literals, so the class of bug this gate exists for does not arise there.",
    },
  ];

  function walkGates(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (["node_modules", "fixtures", "__snapshots__", "dist", "build"].includes(e)) continue;
      const abs = path.join(dir, e);
      if (statSync(abs).isDirectory()) walkGates(abs, out);
      else if (/\.(ts|tsx|mts|mjs)$/.test(e) && !/\.d\.m?ts$/.test(e)) out.push(abs);
    }
    return out;
  }

  const gateFiles = [
    ...walkGates(path.join(ROOT, "tests")),
    ...walkGates(path.join(ROOT, "scripts")),
  ];

  it("every register entry still names a function that exists", () => {
    // An exemption that has outlived its subject exempts nothing and says
    // nothing — but it reads, to the next author, like a considered decision.
    for (const r of REGISTER) {
      const abs = path.join(ROOT, r.file);
      const src = readFileSync(abs, "utf8");
      const sf = parseSource(src, abs);
      let found = false;
      const visit = (n: ts.Node) => {
        if (ts.isFunctionDeclaration(n) && n.name?.getText(sf) === r.fn) found = true;
        if (
          ts.isVariableDeclaration(n) &&
          n.name.getText(sf) === r.fn &&
          n.initializer &&
          (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
        ) {
          found = true;
        }
        ts.forEachChild(n, visit);
      };
      ts.forEachChild(sf, visit);
      expect(found, `${r.file} no longer defines ${r.fn} — stale exemption: ${r.why}`).toBe(true);
    }
  });

  it("no gate hand-rolls comment stripping, in any spelling", () => {
    expect(
      gateFiles.length,
      "the gate walk found almost nothing — this assertion would be vacuous",
    ).toBeGreaterThan(900);

    const offenders: string[] = [];
    for (const abs of gateFiles) {
      for (const f of localStripperFindings(readFileSync(abs, "utf8"), abs, REGISTER)) {
        offenders.push(`${path.relative(ROOT, abs)}  [${f.arm}] ${f.detail}`);
      }
    }
    expect(
      offenders,
      "these gates strip comments themselves instead of importing the one shared " +
        "implementation (tests/helpers/stripComments for tests, " +
        "scripts/lib/strip-comments.mjs for lint scripts). Every hand-rolled " +
        "spelling measured on 2026-09-06 read a different repository than the one " +
        "on disk — see this describe block's header for the numbers.",
    ).toEqual([]);
  });

  describe("and each arm is falsifiable on its own", () => {
    // A gate with three arms and one fixture is a gate with one arm and two
    // decorations: an arm that silently stops matching reads exactly like a
    // repository that is clean. One planted defect per arm, and one honest
    // shape per arm that must NOT fire.
    const FIXTURE = "fixture.ts";
    const find = (src: string) => localStripperFindings(src, FIXTURE, REGISTER);

    it("arm 1 catches a stripper under any name", () => {
      expect(find(`function scrubTheComments(src: string): string { return src; }`).map((x) => x.arm))
        .toContain("named");
    });

    it("arm 2 catches delimiter surgery under an innocent name", () => {
      // One template literal, not an array of them: a fixture assembled from
      // pieces would put bare delimiter literals in THIS file, and this file is
      // inside the population the gate above reads.
      const src =
        `function tidy(src) { const a = src.indexOf("/*"); ` +
        `const b = src.indexOf("*/"); return src.slice(0, a) + src.slice(b + 2); }`;
      expect(find(src).map((x) => x.arm)).toContain("delimiter-literals");
    });

    it("arm 3 catches the two-regex idiom however it is assigned", () => {
      expect(find(String.raw`const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "");`).map((x) => x.arm))
        .toContain("delimiter-regex");
      // `.` wildcards too — a different spelling of the same matcher.
      expect(find(String.raw`const c2 = raw.replace(/\/\*.*?\*\//gs, " ");`).map((x) => x.arm))
        .toContain("delimiter-regex");
    });

    it("a wrapper that delegates to the canonical implementation is not an offender", () => {
      const src = [
        `import { stripCommentsPreservingLines } from "./lib/strip-comments.mjs";`,
        `function maskComments(src) { return stripCommentsPreservingLines(src); }`,
      ].join("\n");
      expect(find(src)).toEqual([]);
    });

    it("a glob is not delimiter surgery", () => {
      // `server/**/*.ts` contains a block-comment opener. Dozens of honest
      // files in tests/ and scripts/ hold one; a gate that flagged them would
      // be turned off inside a week.
      expect(find(`const files = glob("server/**/*.ts", { cwd: "/a/*/b" });`)).toEqual([]);
    });

    it("a regex looking for one PARTICULAR comment is not a comment stripper", () => {
      // A real one, from phase-zero-one-remediation.test.ts.
      expect(find(String.raw`const hidden = /\{\/\*\s*Activity feed: hidden on mobile\s*\*\/\}/;`))
        .toEqual([]);
    });
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

  /**
   * ONE strip per file, serving both assertions.
   *
   * These were two sweeps, each parsing every source file — and after the
   * stripper became a parser that was 2× the repository's cost for one
   * measurement, which is how both of them ended up timing out on main while
   * passing locally. Appending the canary first makes the SAME strip answer
   * both questions: did the scan run off the end, and did it move any offset.
   */
  const CANARY = "\n// CANARY_SENTINEL_DO_NOT_MATCH\n";
  const swept = (() => {
    const ranAway: string[] = [];
    const resized: string[] = [];
    for (const abs of files) {
      const withCanary = readFileSync(abs, "utf8") + CANARY;
      const out = stripComments(withCanary);
      if (out.includes("CANARY_SENTINEL_DO_NOT_MATCH")) ranAway.push(path.relative(ROOT, abs));
      if (out.length !== withCanary.length) resized.push(path.relative(ROOT, abs));
    }
    return { ranAway, resized };
  })();

  it("the sweep is over the real repository", () => {
    // Named separately so a walk that finds nothing fails HERE, loudly, rather
    // than making the two assertions below pass over an empty list.
    expect(files.length).toBeGreaterThan(1000);
  });

  it("never ends mid-token on any source file", () => {
    // THE MEASUREMENT THAT FOUND THIS. Append a comment; if it survives, the
    // scan finished inside a string, template, regex or comment, and every byte
    // from there back to wherever that state opened was read wrong.
    //
    // 232 files failed this before the rewrite. The count is asserted at zero
    // rather than ratcheted: there is no such thing as an acceptable number of
    // files a comment-stripper silently corrupts.
    expect(
      swept.ranAway.slice(0, 10),
      `${swept.ranAway.length} file(s) end the strip mid-token`,
    ).toEqual([]);
  }, REPO_SWEEP_TIMEOUT_MS);

  it("never changes a file's length", () => {
    // Comments become SPACES so every offset still matches the original. A
    // caller measuring a distance between two anchors depends on it.
    expect(swept.resized.slice(0, 10)).toEqual([]);
  }, REPO_SWEEP_TIMEOUT_MS);

  /**
   * The fast path is not the only implementation, and that is the point.
   *
   * `stripComments` stopped walking the tree for speed; `stripCommentsReference`
   * still does. A fast path with no slow path to disagree with is a fast path
   * nobody can check, so pin them against each other on real files — a bounded
   * sample, because running the slow one over the whole repository is the cost
   * the fast one exists to avoid.
   */
  it("agrees with the tree-walking reference on a real sample", () => {
    const SAMPLE = 250;
    const step = Math.max(1, Math.floor(files.length / SAMPLE));
    const sample = files.filter((_, i) => i % step === 0).slice(0, SAMPLE);
    expect(sample.length, "the sample is empty — this is vacuous").toBeGreaterThan(200);
    const disagree: string[] = [];
    for (const abs of sample) {
      const src = readFileSync(abs, "utf8");
      if (stripComments(src) !== stripCommentsReference(src)) disagree.push(path.relative(ROOT, abs));
    }
    expect(
      disagree,
      "the fast literal-span scan and the tree walk disagree about where the " +
        "comments are; one of them is reading a different file than the one on disk",
    ).toEqual([]);
  }, REPO_SWEEP_TIMEOUT_MS);
});
