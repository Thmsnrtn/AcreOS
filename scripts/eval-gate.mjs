#!/usr/bin/env node
/**
 * scripts/eval-gate.mjs — Tahoe E7 (2026-06-06).
 *
 * The prompt-change eval GATE — the CI entrypoint. Runs the curated Pax golden
 * set through the LLM-judge harness and FAILS NON-ZERO when the judge score
 * drops below an absolute threshold (EVAL_GATE_THRESHOLD, default 0.65).
 *
 * Wired into:
 *   • package.json   → `npm run eval:gate`
 *   • .github/workflows/eval.yml → `eval-gate` job on prompt-touching PRs
 *
 * This is a thin spawner: the real work lives in evals/run-gate.ts (so it can
 * reuse the repo's Anthropic client wrapper, the scoring helpers, and the pure
 * gate logic). We forward all CLI args and propagate the child's exit code,
 * so a non-zero exit from run-gate.ts (EvalGateRejectedError) blocks the build.
 *
 * Graceful skip: with no ANTHROPIC_API_KEY the runner scores against stub
 * output and exits 0 with a clear message (the LLM-judge threshold is not
 * enforced without a key). See evals/run-gate.ts for the skip contract.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const runner = join(repoRoot, "evals", "run-gate.ts");
const forwarded = process.argv.slice(2);

// Prefer the locally-installed tsx (same interpreter `npm run eval` uses); fall
// back to `npx tsx` when the bin isn't hoisted into this checkout's node_modules
// (e.g. git worktrees). CI's `npm ci` always populates node_modules/.bin/tsx.
const localTsx = join(repoRoot, "node_modules", ".bin", "tsx");
const useLocal = existsSync(localTsx);
const cmd = useLocal ? localTsx : "npx";
const cmdArgs = useLocal ? [runner, ...forwarded] : ["--yes", "tsx", runner, ...forwarded];

const result = spawnSync(cmd, cmdArgs, {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
});

if (result.error) {
  console.error(`[eval-gate] failed to launch tsx runner: ${result.error.message}`);
  process.exit(2);
}

// Propagate the runner's exit code verbatim: 0 PASS/SKIP, 1 gate-rejected,
// 2 harness fault. Signal termination → non-zero.
process.exit(result.status === null ? 2 : result.status);
