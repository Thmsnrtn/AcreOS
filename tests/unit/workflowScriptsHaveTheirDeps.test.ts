/**
 * A workflow that runs a repo script must install what that script imports.
 *
 * `voice-lint.yml` ran `node scripts/voice-lint.mjs --all` on bare Node, and
 * said so in a comment: "the linter is dependency-free (pure Node + fs/regex) —
 * no npm install needed, which keeps this gate fast (<10s)." That was true until
 * the linter was migrated onto the shared parser-based comment stripper, which
 * imports TypeScript. The workflow then died on ERR_MODULE_NOT_FOUND.
 *
 * Nothing caught it before `main`, because this workflow does not run on branch
 * pushes — the population CLAUDE.md names: "before fast-forwarding main,
 * enumerate EVERY workflow run for the SHA."
 *
 * ── WHAT THIS CHECKS ──────────────────────────────────────────────────────
 * For every workflow step that invokes `node scripts/<x>`, follow that script's
 * static imports transitively through `scripts/` and ask whether any of them
 * reaches a BARE specifier — a package, not a relative path. If it does, the job
 * must contain an install step. Following the import graph rather than the
 * entry file is the point: voice-lint.mjs itself imports nothing external; it
 * reaches TypeScript one hop away through scripts/lib/strip-comments.mjs.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { stripYamlComments } from "../helpers/stripYamlComments";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = process.cwd();
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");

/** Node built-ins are always available; they are not dependencies. */
const BUILTIN = /^node:|^(fs|path|url|os|child_process|crypto|util|assert|process|module|events|stream|zlib|http|https|readline|worker_threads|perf_hooks)$/;

/** Bare package specifiers reachable from `entry`, following relative imports. */
function externalDepsOf(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry) || !existsSync(entry)) return [];
  seen.add(entry);
  const src = readFileSync(entry, "utf8");
  const out: string[] = [];
  const specifiers = [
    ...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm),
    ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);

  for (const spec of specifiers) {
    if (spec.startsWith(".")) {
      const resolved = path.resolve(path.dirname(entry), spec);
      for (const candidate of [resolved, `${resolved}.mjs`, `${resolved}.js`, `${resolved}.ts`]) {
        if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
          out.push(...externalDepsOf(candidate, seen));
          break;
        }
      }
    } else if (!BUILTIN.test(spec)) {
      out.push(spec);
    }
  }
  return [...new Set(out)];
}

type Job = { name: string; body: string };

/** Split a workflow into jobs, comments stripped so prose is never read as YAML. */
function jobsOf(yaml: string): Job[] {
  const lines = stripYamlComments(yaml).split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs: Job[] = [];
  let current: Job | null = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      if (current) jobs.push(current);
      current = { name: header[1], body: "" };
      continue;
    }
    if (current) current.body += line + "\n";
  }
  if (current) jobs.push(current);
  return jobs;
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ rel: `.github/workflows/${f}`, yaml: readFileSync(path.join(WORKFLOW_DIR, f), "utf8") }));

describe("a workflow installs what the scripts it runs import", () => {
  it("the population is real", () => {
    expect(workflows.length, "no workflows found — this is vacuous").toBeGreaterThan(10);
    const named = workflows.map((w) => w.rel);
    expect(named).toContain(".github/workflows/voice-lint.yml");
    // Every workflow must parse into at least one job, or jobsOf silently
    // returns nothing and every rule below passes over an empty set.
    const jobless = workflows.filter((w) => jobsOf(w.yaml).length === 0).map((w) => w.rel);
    expect(jobless, "these workflows parsed into zero jobs — the extractor is broken").toEqual([]);
  });

  it("every job running a repo script that needs packages also installs them", () => {
    const offenders: string[] = [];
    for (const { rel, yaml } of workflows) {
      for (const job of jobsOf(yaml)) {
        const scripts = [...job.body.matchAll(/\bnode\s+(scripts\/[A-Za-z0-9_./-]+\.m?js)/g)].map((m) => m[1]);
        if (scripts.length === 0) continue;
        const installs = /\bnpm\s+(ci|install|i)\b/.test(job.body);
        if (installs) continue;
        for (const script of scripts) {
          const deps = externalDepsOf(path.join(ROOT, script));
          if (deps.length > 0) {
            offenders.push(`${rel} :: job "${job.name}" runs ${script}, which needs [${deps.join(", ")}], with no install step`);
          }
        }
      }
    }
    expect(
      offenders,
      "these jobs run a script that imports a package, on a runner that never " +
        "installed one. The job dies on ERR_MODULE_NOT_FOUND — and if the " +
        "workflow does not run on branch pushes, nothing sees it until main.",
    ).toEqual([]);
  });

  it("the import walk actually follows a hop, and does not just read the entry file", () => {
    // voice-lint.mjs imports nothing external itself; it reaches TypeScript one
    // hop away via scripts/lib/strip-comments.mjs. A walk that read only the
    // entry file would report zero here and pass over the very defect this
    // gate exists for.
    const direct = readFileSync(path.join(ROOT, "scripts/voice-lint.mjs"), "utf8");
    expect(
      /^\s*import\s[^;]*?from\s+["']typescript["']/m.test(direct),
      "voice-lint.mjs imports typescript directly now — pick a different fixture, " +
        "this one no longer proves the walk is transitive",
    ).toBe(false);
    expect(externalDepsOf(path.join(ROOT, "scripts/voice-lint.mjs"))).toContain("typescript");
  });
});
