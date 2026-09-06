/**
 * The time budget a repository-wide sweep declares for itself.
 *
 * A gate that walks the source tree costs time proportional to the tree, and
 * the failure mode when it runs out is not a red test that names a defect —
 * it is vitest killing the gate, which then reports nothing about the thing it
 * guards. A killed gate and a clean gate look identical in a green run.
 *
 * This constant lives in its own module, imported by nothing else, because the
 * budget is not a property of comment-stripping. It used to live in
 * tests/helpers/stripComments.ts, and the gate that enforced it therefore
 * defined "repo sweep" as "imports the stripper AND walks a directory". On
 * 2026-09-06 tests/unit/transactionsAreRealTransactions.test.ts turned `main`
 * red by timing out under the coverage run: it walks the whole repo and it
 * DOES import the stripper — but with `await import(...)` inside the test body
 * rather than a static `from "../helpers/stripComments"`, so the population
 * predicate never saw it. Sixty-five further sweeps were outside that
 * population for the same class of reason.
 *
 * The rule now keys on the cost itself — walking a source directory — not on
 * which helper the sweep happens to use.
 */
export const REPO_SWEEP_TIMEOUT_MS = 120_000;
