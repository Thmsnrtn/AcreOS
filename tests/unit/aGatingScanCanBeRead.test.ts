/**
 * A GATE WHOSE FAILURE CANNOT BE READ IS A GATE THAT GETS IGNORED.
 *
 * ── WHAT THIS WAS WRITTEN FOR ─────────────────────────────────────────────
 * Measured 2026-09-05 against the GitHub Actions API:
 *
 *   Security Scanning #1467  deaa5191  2026-09-02 19:04   success  (last green)
 *   Security Scanning #1468  7e6d53c4  2026-09-04 05:05   failure
 *   … 37 consecutive failures, every push to main in between …
 *
 * The failing job was "Trivy Filesystem & Secret Scan". npm audit, CodeQL and
 * the container scan were all green throughout, so the finding was fs-scope —
 * and NOBODY COULD SAY WHICH FINDING, from the log, for two days. The gating
 * step writes SARIF to a file and exits 1; it prints nothing about what it
 * found. Reading it required the code-scanning UI, which is closed to
 * integration tokens ("403 Resource not accessible by integration").
 *
 * `.trivyignore`'s own header states the policy this violated: "a
 * permanently-red Security Gate trains everyone to ignore it, so we keep the
 * gate GREEN and document each exception here instead." You cannot document an
 * exception you cannot read, and you cannot fix a CVE you cannot name.
 *
 * ── WHY A TEST AND NOT A ONE-LINE FIX ─────────────────────────────────────
 * Because the one-line fix ALREADY EXISTED, on the other job.
 *
 * The container-scan job got its non-gating findings table on 2026-07-08, with
 * a comment giving exactly this reason ("every gate failure sent someone
 * spelunking the code-scanning UI"). Whoever wrote it fixed the job in front
 * of them. The sibling job, four sections down the same file, running the same
 * action in the same silent mode, was never touched — and it is the one that
 * went red for 37 runs.
 *
 * That is this repo's third law: a gate proves its property only over the
 * POPULATION IT ACTUALLY READS, and here the population was one job because a
 * human enumerated it from memory. So this test enumerates instead. It walks
 * every workflow file, finds every trivy-action step that GATES (exit-code 1),
 * and requires each one to be preceded in the SAME JOB by a readable one. A
 * third scan job added next year without a table is what fails here.
 *
 * ── AND THE TABLE MUST BE AS WIDE AS THE GATE ─────────────────────────────
 * A table narrower than the gate is worse than no table: it prints "no
 * findings" on a job that just went red, and sends the reader looking for a
 * bug in the scanner. So severity and scanner sets are compared, not merely
 * required to exist.
 */
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const WORKFLOW_DIR = path.resolve(process.cwd(), ".github/workflows");
const SCAN_ACTION = "aquasecurity/trivy-action";

type Step = {
  workflow: string;
  job: string;
  index: number;
  name: string;
  uses: string;
  with: Record<string, string>;
};

/** Parse — not scan. The parser never visits a comment, so the whole class of
 *  "the gate matched the comment explaining the fix" cannot arise here. */
function scanSteps(): { steps: Step[]; workflowsRead: number; jobsRead: number } {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));
  const steps: Step[] = [];
  let jobsRead = 0;

  for (const file of files) {
    const raw = readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
    const doc = yaml.load(raw) as { jobs?: Record<string, { steps?: unknown[] }> };
    // A workflow that does not parse is a POPULATION FAILURE, not a pass.
    expect(doc, `${file} did not parse as YAML`).toBeTruthy();
    const jobs = doc.jobs ?? {};
    for (const [jobId, job] of Object.entries(jobs)) {
      jobsRead += 1;
      const jobSteps = Array.isArray(job?.steps) ? job.steps : [];
      jobSteps.forEach((s, i) => {
        const step = s as { name?: string; uses?: string; with?: Record<string, unknown> };
        if (typeof step?.uses !== "string") return;
        if (!step.uses.startsWith(SCAN_ACTION)) return;
        const withMap: Record<string, string> = {};
        for (const [k, v] of Object.entries(step.with ?? {})) withMap[k] = String(v);
        steps.push({
          workflow: file,
          job: jobId,
          index: i,
          name: step.name ?? "(unnamed)",
          uses: step.uses,
          with: withMap,
        });
      });
    }
  }
  return { steps, workflowsRead: files.length, jobsRead };
}

const set = (csv: string | undefined) =>
  new Set(
    (csv ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const isGating = (s: Step) => s.with["exit-code"] === "1";
const isReadable = (s: Step) => s.with["format"] === "table" && s.with["exit-code"] === "0";

describe("a gating scan can be read from its own job log", () => {
  const { steps, workflowsRead, jobsRead } = scanSteps();

  // ── FLOOR ONE: the population is non-empty and plausible ────────────────
  // A parser that silently stops matching reads exactly like a repo with no
  // scanners in it. These floors are what tells the two apart.
  it("read every workflow file and found the scan steps", () => {
    expect(workflowsRead).toBeGreaterThanOrEqual(20);
    expect(jobsRead).toBeGreaterThanOrEqual(30);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    // The two known scanning jobs must both be in the population by name.
    const jobs = new Set(steps.map((s) => `${s.workflow}:${s.job}`));
    expect(jobs).toContain("security.yml:trivy-image");
    expect(jobs).toContain("security.yml:trivy-fs");
  });

  it("found at least two GATING scans — the shape this rule governs", () => {
    const gating = steps.filter(isGating);
    expect(gating.length).toBeGreaterThanOrEqual(2);
  });

  // ── THE RULE ────────────────────────────────────────────────────────────
  it("every gating scan is preceded in its own job by a readable one", () => {
    const gating = steps.filter(isGating);
    const unreadable = gating.filter((g) => {
      const siblings = steps.filter(
        (s) => s.workflow === g.workflow && s.job === g.job && s.index < g.index,
      );
      return !siblings.some(isReadable);
    });
    expect(
      unreadable.map((s) => `${s.workflow}:${s.job} step ${s.index} "${s.name}"`),
      "a gating scan with no table step before it — its failure prints nothing " +
        "about what it found, which is the 37-run blind spot of 2026-09-04",
    ).toEqual([]);
  });

  it("the readable scan is at least as wide as the gate it explains", () => {
    const gating = steps.filter(isGating);
    const tooNarrow: string[] = [];

    for (const g of gating) {
      const table = steps.find(
        (s) => s.workflow === g.workflow && s.job === g.job && s.index < g.index && isReadable(s),
      );
      if (!table) continue; // already reported by the rule above

      // Same target: an fs table cannot explain an image gate, or vice versa.
      if ((table.with["scan-type"] ?? "image") !== (g.with["scan-type"] ?? "image")) {
        tooNarrow.push(`${g.workflow}:${g.job} — table scans a different target than the gate`);
      }
      for (const key of ["severity", "scanners", "vuln-type"]) {
        const gateSet = set(g.with[key]);
        const tableSet = set(table.with[key]);
        if (gateSet.size === 0) continue;
        const missing = [...gateSet].filter((v) => !tableSet.has(v));
        if (missing.length > 0) {
          tooNarrow.push(
            `${g.workflow}:${g.job} — table omits ${key}: ${missing.join(",")} that the gate enforces`,
          );
        }
      }
    }

    expect(
      tooNarrow,
      "a table narrower than its gate prints 'no findings' on a red job — " +
        "worse than no table, because it accuses the scanner instead of the code",
    ).toEqual([]);
  });

  // ── FLOOR TWO: the extraction shapes are the ones we think they are ─────
  // Per-shape canaries. Each hides the defect inside the exact YAML shape the
  // walk relies on and confirms the predicate goes red on it. A shape with no
  // canary is a shape the parser is free to stop reading.
  describe("canaries — the predicates fire on the shapes actually used", () => {
    const parse = (src: string) => {
      const doc = yaml.load(src) as { jobs: Record<string, { steps: any[] }> };
      const out: Step[] = [];
      for (const [jobId, job] of Object.entries(doc.jobs)) {
        job.steps.forEach((step, i) => {
          if (typeof step?.uses !== "string" || !step.uses.startsWith(SCAN_ACTION)) return;
          const withMap: Record<string, string> = {};
          for (const [k, v] of Object.entries(step.with ?? {})) withMap[k] = String(v);
          out.push({
            workflow: "fixture",
            job: jobId,
            index: i,
            name: step.name ?? "",
            uses: step.uses,
            with: withMap,
          });
        });
      }
      return out;
    };

    it("a SHA-pinned `uses:` is still recognised as the scan action", () => {
      const s = parse(`
jobs:
  j:
    steps:
      - uses: aquasecurity/trivy-action@d2a0b60797ff03db6132bd4e2b293f9b37081297
        with:
          exit-code: "1"
`);
      expect(s).toHaveLength(1);
      expect(isGating(s[0])).toBe(true);
    });

    it("a comment naming the missing table does NOT satisfy the rule", () => {
      // The fourth law, as a fixture: the record of a fix reads like the fix.
      const s = parse(`
jobs:
  j:
    steps:
      # - name: Print Trivy findings table (non-gating, for the job log)
      #   with: { format: "table", exit-code: "0" }
      - uses: aquasecurity/trivy-action@sha
        with:
          exit-code: "1"
          severity: "HIGH"
`);
      expect(s.filter(isReadable)).toHaveLength(0);
      expect(s.filter(isGating)).toHaveLength(1);
    });

    it("a table AFTER the gate does not count — the gate never reaches it", () => {
      const s = parse(`
jobs:
  j:
    steps:
      - uses: aquasecurity/trivy-action@sha
        with:
          exit-code: "1"
      - uses: aquasecurity/trivy-action@sha
        with:
          format: "table"
          exit-code: "0"
`);
      const g = s.find(isGating)!;
      const before = s.filter((x) => x.job === g.job && x.index < g.index && isReadable(x));
      expect(before).toHaveLength(0);
    });

    it("a table in a DIFFERENT job does not count", () => {
      const s = parse(`
jobs:
  a:
    steps:
      - uses: aquasecurity/trivy-action@sha
        with:
          format: "table"
          exit-code: "0"
  b:
    steps:
      - uses: aquasecurity/trivy-action@sha
        with:
          exit-code: "1"
`);
      const g = s.find(isGating)!;
      expect(s.filter((x) => x.job === g.job && x.index < g.index && isReadable(x))).toHaveLength(0);
    });

    it("YAML's unquoted booleans/numbers do not break the exit-code compare", () => {
      // `exit-code: 1` (no quotes) parses as a NUMBER. String(v) is what keeps
      // the predicate honest; without it this gating step reads as non-gating.
      const s = parse(`
jobs:
  j:
    steps:
      - uses: aquasecurity/trivy-action@sha
        with:
          exit-code: 1
`);
      expect(isGating(s[0])).toBe(true);
    });

    it("a narrower table is detected, per compared key", () => {
      const gate = { with: { severity: "CRITICAL,HIGH,MEDIUM" } } as unknown as Step;
      const table = { with: { severity: "CRITICAL,HIGH" } } as unknown as Step;
      const missing = [...set(gate.with.severity)].filter((v) => !set(table.with.severity).has(v));
      expect(missing).toEqual(["MEDIUM"]);
    });
  });
});
