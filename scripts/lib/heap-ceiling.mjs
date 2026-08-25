// ============================================================================
// scripts/lib/heap-ceiling.mjs — the heap ceiling, as a value a CHILD receives.
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS, in one sentence: `npm run check` was written as
//
//     NODE_OPTIONS=--max-old-space-size=6144 tsc … && npm run check:tests && …
//
// and in POSIX sh a `VAR=x` assignment prefix binds to that ONE simple command.
// The ceiling reached the FIRST tsc — over `tsconfig.json`, which EXCLUDES
// `**/*.test.ts` — and never reached the second, over `tsconfig.tests.json`,
// which is a strict SUPERSET of it and the largest program in the repo. The
// bigger program ran unprotected. Every deploy.yml run on main from 2026-08-17
// died there with exit 134 (V8 heap abort); steps 7 (vitest) and 8 (build) were
// SKIPPED, and nothing reached Fly.
//
// It survived because it was INVISIBLE LOCALLY: dev containers ship an ambient
// NODE_OPTIONS=--max-old-space-size=8192, which every command after the `&&`
// silently inherited, so `npm run check` exits 0 here at the very commit CI
// aborts on. The command that reproduces CI is:
//
//     env -u NODE_OPTIONS npm run check
//
// MEASURED 2026-08-25 at 1a43a355, `npx tsc --noEmit -p tsconfig.tests.json
// --extendedDiagnostics` (7,963 files, 14.5M instantiations):
//     2048 → abort 134 at  25s     6144 → exit 2, 162 errors, 222s,
//     3072 → abort 134 at  99s            "Memory used" 5,104 MB, peak RSS 5,463 MB
//     4096 → abort 134 at 187s     8192 → exit 2, 162 errors, 320s,
//                                         "Memory used" 5,859 MB, peak RSS 5,971 MB
// Node's own default here is 2,096 MB (measured with NODE_OPTIONS stripped), so
// the unprotected program was ~2.5x over its ceiling.
//
// 6144 is ~20% above measured need and stays under the smallest GitHub runner
// tier's RAM. That is deliberate: exceeding a V8 ceiling is a loud, attributable
// abort that this repo's gates already refuse to interpret, while exceeding the
// machine's RAM is a kernel SIGKILL. Prefer the loud failure.
//
// RE-MEASURE and raise this when the reported "Memory used" passes ~5,500 MB.
// Do not raise it speculatively: 8192 raised peak RSS to 5,971 MB, which is
// worse on a small runner, and ci.yml records that an 8192 bump "invited the
// OOM-killer that broke deploys Jun 6-8".
// ============================================================================

/**
 * Single source of truth. Mirrored in package.json's `check:app` prefix, and
 * tests/unit/testsAreTypeChecked.test.ts fails if the two ever disagree.
 */
export const HEAP_CEILING_MB = 6144;

/** The `--max-old-space-size` already present in a NODE_OPTIONS string, or 0. */
export function ceilingOf(nodeOptions) {
  const m = /--max-old-space-size[= ](\d+)/.exec(nodeOptions ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * `env` with the ceiling guaranteed present. RAISE-ONLY: a caller who already
 * asked for MORE keeps it — the same rule `.githooks/pre-commit` follows, which
 * respects an existing NODE_OPTIONS rather than clobbering it. V8 honours the
 * LAST `--max-old-space-size`, so appending overrides a smaller pre-existing one.
 */
export function withHeapCeiling(env = process.env) {
  if (ceilingOf(env.NODE_OPTIONS) >= HEAP_CEILING_MB) return env;
  return {
    ...env,
    NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --max-old-space-size=${HEAP_CEILING_MB}`.trim(),
  };
}
