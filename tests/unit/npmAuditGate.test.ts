/**
 * The npm-audit gate: prints what it found, and accepts only assessed,
 * expiring, dev-only advisories.
 *
 * 2026-10-04: a new braces advisory (GHSA-vfj7-8cjw-p6xm, no patched release)
 * blocked the main deploy of d2f46b3. The old inline gate printed only
 * "high: 5". It never named the package, and it had no assessed-exception
 * channel, so a build-time-only finding could only be fixed by a Tailwind 4
 * migration or by deleting the gate.
 *
 * Each rule below is pinned by the case that would break it: an accepted
 * advisory reaching a PRODUCTION package, an expired acceptance, a stale one,
 * a thin justification, and a second unaccepted finding next to an accepted
 * one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { evaluate, type AcceptedAdvisory } from "../../scripts/npm-audit-gate.mjs";

const ROOT = path.resolve(process.cwd());
const GHSA = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const OTHER = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc";

const advisory = (url: string, name: string, severity = "high") => ({ source: 1, name, url, severity, title: "t", range: "*" });
/** The shape npm audit emitted on 2026-10-04: one advisory, four packages reaching it by name. */
const report = (extra: Record<string, unknown> = {}) => ({
  metadata: { vulnerabilities: { critical: 0, high: 5, moderate: 0, low: 0, info: 0 } },
  vulnerabilities: {
    braces: { name: "braces", severity: "high", via: [advisory(GHSA, "braces")] },
    micromatch: { name: "micromatch", severity: "high", via: ["braces"] },
    chokidar: { name: "chokidar", severity: "high", via: ["braces"] },
    "fast-glob": { name: "fast-glob", severity: "high", via: ["micromatch"] },
    tailwindcss: { name: "tailwindcss", severity: "high", via: ["chokidar", "fast-glob", "micromatch"] },
    ...extra,
  },
});
const devLock = (overrides: Record<string, { dev?: boolean }> = {}) => ({
  "node_modules/braces": { dev: true },
  "node_modules/micromatch": { dev: true },
  "node_modules/chokidar": { dev: true },
  "node_modules/fast-glob": { dev: true },
  "node_modules/tailwindcss": { dev: true },
  ...overrides,
});
const accept = (over: Partial<AcceptedAdvisory> = {}): AcceptedAdvisory => ({
  advisory: GHSA,
  justification: "Build-time only, dev-only, pruned from the production image; expands repo-owned globs only.",
  reviewTrigger: "a patched braces or tailwindcss 4",
  reviewBy: "2099-01-01",
  ...over,
});
const TODAY = "2026-10-04";

describe("the npm audit gate", () => {
  it("names every blocking finding, with advisory and scope — never just a count", () => {
    const { lines, failures } = evaluate(report(), [], devLock(), TODAY);
    expect(failures).toHaveLength(5);
    expect(lines.join("\n")).toContain("braces");
    expect(lines.join("\n")).toContain(GHSA);
    expect(lines.join("\n")).toMatch(/tailwindcss\s+dev/);
  });

  it("passes when the only advisory is accepted and reaches dev-only packages", () => {
    expect(evaluate(report(), [accept()], devLock(), TODAY).failures).toEqual([]);
  });

  it("an accepted advisory that reaches a PRODUCTION package still blocks", () => {
    const { failures } = evaluate(report(), [accept()], devLock({ "node_modules/braces": {} }), TODAY);
    expect(failures.join("\n")).toMatch(/braces: BLOCKING — accepted advisory reaches a PRODUCTION package/);
  });

  it("a package installed twice blocks if EITHER copy ships to production", () => {
    const lock = { ...devLock(), "node_modules/foo/node_modules/braces": {} };
    expect(evaluate(report(), [accept()], lock, TODAY).failures.join("\n")).toMatch(/braces: BLOCKING/);
  });

  it("a second, unaccepted advisory beside an accepted one blocks", () => {
    const r = report({ undici: { name: "undici", severity: "critical", via: [advisory(OTHER, "undici", "critical")] } });
    const { failures } = evaluate(r, [accept()], devLock({ "node_modules/undici": {} }), TODAY);
    expect(failures).toEqual(["critical undici: BLOCKING"]);
  });

  it("a package reaching an accepted AND an unaccepted advisory blocks", () => {
    const r = report({ tailwindcss: { name: "tailwindcss", severity: "high", via: ["chokidar", advisory(OTHER, "tailwindcss")] } });
    expect(evaluate(r, [accept()], devLock(), TODAY).failures).toEqual(["high tailwindcss: BLOCKING"]);
  });

  it("an acceptance expires", () => {
    expect(evaluate(report(), [accept({ reviewBy: "2026-10-03" })], devLock(), TODAY).failures.join("\n")).toMatch(/expired on 2026-10-03/);
  });

  it("a stale acceptance — advisory no longer reported — fails until removed", () => {
    const clean = { metadata: { vulnerabilities: {} }, vulnerabilities: {} };
    expect(evaluate(clean, [accept()], devLock(), TODAY).failures.join("\n")).toMatch(/no longer reported/);
  });

  it("an acceptance needs a real justification, a trigger and a GHSA url", () => {
    const failures = evaluate(report(), [accept({ justification: "dev only", reviewTrigger: " ", advisory: "CVE-1" })], devLock(), TODAY).failures.join("\n");
    expect(failures).toMatch(/justification missing or too thin/);
    expect(failures).toMatch(/no reviewTrigger/);
    expect(failures).toMatch(/no GHSA advisory URL/);
  });

  it("moderates and lows never block", () => {
    const r = { metadata: { vulnerabilities: { moderate: 2 } }, vulnerabilities: { x: { name: "x", severity: "moderate", via: [advisory(OTHER, "x", "moderate")] } } };
    expect(evaluate(r, [], {}, TODAY).failures).toEqual([]);
  });
});

describe("the gate is the one security.yml runs, over the real register", () => {
  it("security.yml's npm-audit job calls the script with the register and the lockfile", () => {
    const wf = yaml.load(readFileSync(path.join(ROOT, ".github/workflows/security.yml"), "utf8")) as {
      jobs: Record<string, { steps: Array<{ run?: string }> }>;
    };
    const runs = wf.jobs["npm-audit"].steps.map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/node scripts\/npm-audit-gate\.mjs npm-audit-report\.json security\/npm-audit-accepted\.json package-lock\.json/);
    expect(runs).not.toMatch(/python3/);
  });

  it("every entry in the real register is well-formed and reaches only dev packages in the real lockfile", () => {
    const accepted = JSON.parse(readFileSync(path.join(ROOT, "security/npm-audit-accepted.json"), "utf8")).accepted as AcceptedAdvisory[];
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")).packages;
    expect(accepted.length).toBeGreaterThan(0);
    // The register's own structure, judged against a report that still names each advisory.
    for (const a of accepted) {
      const r = { metadata: { vulnerabilities: {} }, vulnerabilities: { braces: { name: "braces", severity: "high", via: [advisory(a.advisory, "braces")] } } };
      const { failures } = evaluate(r, [a], lock, TODAY);
      expect(failures, a.advisory).toEqual([]);
    }
  });
});
