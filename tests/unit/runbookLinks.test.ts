/**
 * runbookLinks.test.ts — master-handoff O3: the runbook link-lint stays
 * honest and stays wired.
 *
 * scripts/check-runbook-links.mjs is the gate (mirrors check-ledger-refs.mjs,
 * F-17-1): every repo-relative path a runbook cites must resolve on disk, and
 * every claim of an executed drill must cite a dated block in one of the
 * append-only ledgers — or say "NONE"/"never" honestly. This suite:
 *
 *  1. Runs the check in-process against the REAL docs/runbooks — the tree
 *     must be clean (zero un-allowlisted dangling refs, zero unbacked drill
 *     claims, zero stale allowlist entries). This is the same assertion CI
 *     makes via `npm run lint:runbook-links`.
 *  2. Proves the gate can actually FAIL: a tempdir fixture with a broken
 *     link must produce a dangling ref, and a fabricated drill claim must
 *     produce a claim violation. A lint that cannot fail is decoration.
 *  3. Pins the drill-claim grammar to the ledgers' own format (line-leading
 *     `YYYY-MM-DD` block) so "cite a ledger row" means a row that exists.
 *  4. Pins the wiring (built-but-unwired defence): `lint:runbook-links`
 *     exists in package.json AND runs inside the `check` chain.
 *
 * idempotent: true — pure fs + tempdir fixtures, no DB, no network.
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The script is the single source of truth — the test imports its engine
// rather than re-implementing the walk, so the two can never disagree.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module, no type declarations (vitest transpiles it)
import { checkRunbookLinks, RUNBOOK_ALLOWLIST } from "../../scripts/check-runbook-links.mjs";

const root = path.resolve(__dirname, "../..");
const SCRIPT = path.join(root, "scripts", "check-runbook-links.mjs");

const fixtures: string[] = [];
function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "runbook-links-"));
  fixtures.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

describe("real docs/runbooks tree is clean", () => {
  const result = checkRunbookLinks({ repoRoot: root });

  it("scans the actual runbook set", () => {
    expect(result.filesScanned).toBeGreaterThanOrEqual(30);
  });

  it("has zero un-allowlisted dangling path references", () => {
    expect(result.dangling).toEqual([]);
  });

  it("has zero drill claims without a ledger row behind them", () => {
    expect(result.claimViolations).toEqual([]);
  });

  it("has zero stale allowlist entries (an exemption whose file returned must be removed)", () => {
    expect(result.staleAllow).toEqual([]);
  });

  it("every allowlist entry carries a dated reason", () => {
    for (const entry of RUNBOOK_ALLOWLIST) {
      expect(entry.ref, "allowlist entries need a ref").toBeTruthy();
      expect(entry.reason?.length ?? 0, `${entry.ref} needs a real reason`).toBeGreaterThan(20);
      expect(entry.date, `${entry.ref} needs a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the CLI entry point agrees (exit 0 at the fixed tree)", () => {
    const stdout = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(stdout).toContain("[runbook-links] OK");
  });
});

describe("the gate can fail: broken link fixture", () => {
  it("a runbook citing a nonexistent path is a dangling ref", () => {
    const dir = makeFixture({
      "docs/runbooks/broken.md": [
        "# Broken runbook",
        "Edit the config in `server/nope.ts` before restarting.",
        "Real companion: `docs/runbooks/ok.md` must NOT be flagged.",
      ].join("\n"),
      "docs/runbooks/ok.md": "# OK\nNothing cited here.\n",
    });
    const result = checkRunbookLinks({ repoRoot: dir });
    expect(result.filesScanned).toBe(2);
    // The broken ref fails…
    expect(result.dangling).toContainEqual({ ref: "server/nope.ts", file: "docs/runbooks/broken.md" });
    // …and ONLY the broken ref fails — resolution genuinely works in fixture
    // mode, so the failure above is the lint working, not everything dangling.
    const nonAllowlisted = result.dangling.filter(
      (d: { ref: string }) => !RUNBOOK_ALLOWLIST.some((a: { ref: string }) => a.ref === d.ref),
    );
    expect(nonAllowlisted.map((d: { ref: string }) => d.ref)).toEqual(["server/nope.ts"]);
  });

  it("template placeholders (YYYY-MM-DD, <angle>) are conventions, not existence claims", () => {
    const dir = makeFixture({
      "docs/runbooks/template.md":
        "Copy this file to `docs/incidents/YYYY-MM-DD-slug.md` and fill in `<path>`.\n",
    });
    const result = checkRunbookLinks({ repoRoot: dir });
    expect(result.dangling).toEqual([]);
  });
});

describe("the gate can fail: drill-claim grammar", () => {
  const LEDGER = "docs/runbooks/dr-drill-history.md";

  it("an honest 'never'/'NONE' claim passes without a citation", () => {
    const dir = makeFixture({
      "docs/runbooks/drill.md": "Last walked: never (execution sits in the founder queue).\n",
    });
    expect(checkRunbookLinks({ repoRoot: dir }).claimViolations).toEqual([]);
  });

  it("a dated claim with no ledger citation fails", () => {
    const dir = makeFixture({
      "docs/runbooks/drill.md": "Last walked: 2026-01-05, went fine.\n",
    });
    const { claimViolations } = checkRunbookLinks({ repoRoot: dir });
    expect(claimViolations).toHaveLength(1);
    expect(claimViolations[0].reason).toContain("cites no ledger");
  });

  it("a dated claim citing a ledger with NO matching dated block fails — a drill nobody logged did not happen", () => {
    const dir = makeFixture({
      "docs/runbooks/drill.md": "Last walked: 2026-01-05 (ledger: dr-drill-history.md).\n",
      [LEDGER]: "# DR drill history\n\n(no drills recorded yet)\n",
    });
    const { claimViolations } = checkRunbookLinks({ repoRoot: dir });
    expect(claimViolations).toHaveLength(1);
    expect(claimViolations[0].reason).toContain("no block starting");
  });

  it("a dated claim whose cited ledger holds the matching line-leading block passes", () => {
    const dir = makeFixture({
      "docs/runbooks/drill.md": "Last walked: 2026-01-05 (ledger: dr-drill-history.md).\n",
      [LEDGER]: "# DR drill history\n\n2026-01-05  ran-by=founder\n            total-rto=38  passed=true\n",
    });
    expect(checkRunbookLinks({ repoRoot: dir }).claimViolations).toEqual([]);
  });

  it("a claim without a date and without an honest NONE fails as unparseable", () => {
    const dir = makeFixture({
      "docs/runbooks/drill.md": "Last walked: recently, trust me.\n",
    });
    const { claimViolations } = checkRunbookLinks({ repoRoot: dir });
    expect(claimViolations).toHaveLength(1);
    expect(claimViolations[0].reason).toContain("neither a YYYY-MM-DD date nor an honest");
  });
});

describe("wiring (built-but-unwired defence)", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  it("lint:runbook-links exists and points at the script", () => {
    expect(pkg.scripts["lint:runbook-links"]).toBe("node scripts/check-runbook-links.mjs");
  });

  it("the check chain actually runs it", () => {
    expect(pkg.scripts.check).toContain("npm run lint:runbook-links");
  });
});
