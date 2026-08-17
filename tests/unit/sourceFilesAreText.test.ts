/**
 * No source file may be BINARY to text tooling.
 *
 * ── WHAT THIS CAUGHT ────────────────────────────────────────────────────────
 * `shared/evidence/claim.ts` contained one literal NUL byte, inside a string
 * literal used as a grouping sentinel (`valueKey(null)`). The runtime value was
 * correct and no test failed. What it did instead was make the file binary:
 *
 *   grep -n valueKey shared/evidence/claim.ts   → "binary file matches", no lines
 *   rg -l valueKey shared/                      → NOTHING AT ALL
 *
 * ripgrep skips binary files when it traverses a directory. So the file was
 * invisible to every repository-wide search that did not name it explicitly.
 *
 * That matters here more than it would almost anywhere else. This repository
 * audits itself by scanning: the ratchets, the forensic passes, the
 * "grep the new exports for call sites" discipline in CLAUDE.md. And the file
 * in question defines the Evidence Fabric's canonical laws — what counts as
 * evidence, how conflicts resolve, when an answer is stale. One byte made the
 * most consequential file in the subsystem unsearchable.
 *
 * None of the lint gates read files through grep (they use fs.readFileSync,
 * which handles NUL fine), so CI never noticed and no gate was actually
 * bypassed. The cost was borne by every human and agent who searched the repo
 * and silently got no hits.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A source file must be readable as text by the tools this codebase is audited
 * with. NUL is the byte that decides that for both grep and ripgrep, so NUL is
 * what this forbids — write `\u0000` as an escape when the runtime value is
 * genuinely needed. The value is identical; the file stays searchable.
 *
 * This file itself must obey the rule it enforces, so its own positive control
 * builds the NUL with String.fromCharCode(0) rather than embedding one.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

const SCAN_DIRS = ["shared", "server", "client/src", "scripts", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql", ".json", ".md"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

/** Every text-source file in the audited tree. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (EXTENSIONS.has(path.extname(e.name))) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
  return out;
}

const files = sourceFiles();

/**
 * Files carrying a NUL byte — the exact condition that makes grep print
 * "binary file matches" and makes ripgrep skip the file during a directory
 * walk.
 */
const binaryFiles = files.filter((f) => fs.readFileSync(f).includes(0x00));

describe("the scan is real (vacuity guard, first)", () => {
  it("walked the source tree", () => {
    // A walker that silently found nothing would report zero binary files,
    // which is the same answer as a perfectly clean tree.
    expect(
      files.length,
      "no source files found — the walk broke; the zero below proves nothing",
    ).toBeGreaterThan(2000);
  });

  it("detects a NUL when one is present (positive control)", () => {
    // Synthetic, so it cannot go vacuous the way a scan over real files can.
    const withNul = Buffer.from(`const sentinel = "${String.fromCharCode(0)}null";`, "utf8");
    expect(withNul.includes(0x00)).toBe(true);
    const withEscape = Buffer.from(`const sentinel = "\\u0000null";`, "utf8");
    expect(
      withEscape.includes(0x00),
      "the escape form must NOT put a NUL in the file — that is the whole fix",
    ).toBe(false);
  });
});

describe("every source file is searchable", () => {
  it("contains no literal NUL byte", () => {
    const listing = binaryFiles.map((f) => `  ${path.relative(ROOT, f)}`).join("\n");
    expect(
      binaryFiles.map((f) => path.relative(ROOT, f)),
      "These files are BINARY to grep and are SKIPPED ENTIRELY by ripgrep when " +
        "it walks a directory, so every repo-wide search silently misses them:\n" +
        listing +
        "\n\nWrite the escape `\\u0000` instead of a literal NUL byte. The " +
        "runtime value is identical and the file stays searchable.",
    ).toEqual([]);
  });
});
