# Dmitri Voloshyn — Daily DX Audit

**Date:** 2026-05-01
**Scope:** Hot-reload, type-check, CI duration, hard-fail vs soft-warn, preview envs, pre-commit, bundle-size gating, migration discipline, deploy-from-merge time
**Previous wave (Reza):** Confirmed `continue-on-error: true` on lint, decorative `--max-warnings 0`, dead `test:bundle-size` script. I'm picking up the pieces and proposing a one-week sprint.

---

## 1. One-line verdict

The CI is theatre, the migration story is held together by a hand-rolled idempotent ALTER script in production, and there is no PR-level preview environment — but the dev-loop itself (Vite HMR, Fly deploy) is genuinely fast, so a focused week of work would compound for the rest of the company's life.

---

## 2. DX timing audit

All numbers below are estimated from the source tree (613 client `.ts/.tsx`, 649 server `.ts`, 1,410 `as any`, 32 migration files) cross-referenced with the workflow files. Where I write "measured" I mean the number is derivable from the file shape; where I write "estimated" I mean a reasonable bound for a project of this size.

| Stage | Tool | Estimate | Notes |
|---|---|---|---|
| Cold dev start | `vite` (root: `client/`) | ~3.5 s | Vite 7, no SSR, simple plugin set. Fine. |
| HMR — leaf component edit | Vite + react-fast-refresh | <200 ms | Will degrade in components that mix exports (see §2a) |
| HMR — `client/src/lib/queryClient.ts` edit | Vite | full reload | Module is imported by ~every page; HMR boundary not isolated |
| HMR — context provider edit | Vite | full reload | Same — root-level providers force full refresh |
| `npm run check` (`tsc -p tsconfig.check.json`) | TS 6.0.2 | 18–35 s warm, 45–70 s cold | `tsBuildInfoFile` is configured but not consistently reused across hook + CI |
| `npm run lint` (eslint, --max-warnings 0) | eslint 9 | 25–40 s | Currently `continue-on-error: true` in CI — output ignored |
| `npm test` (vitest run) | vitest 4 | 60–180 s | Spans unit + integration + simulation; some tests use postgres |
| `npm run build` | tsx → esbuild + vite | 35–60 s | 290 chunks, 8.5 MB total client JS |
| `npm run test:e2e` (playwright) | playwright | 90–240 s | Browsers re-downloaded every CI run (no cache) |
| Pre-commit hook | full-project tsc + filter | 25–45 s | Reza flagged: hook shells `npx tsc --noEmit` on whole project, not `tsconfig.check.json` |
| **CI total per PR — `ci.yml`** | sequential w/ needs | **~14–20 min** | lint+typecheck+coverage+build+e2e then CodeQL then build+docker |
| **CI total per PR — `test.yml`** | parallel | ~6–10 min | Duplicates tsc + npm ci with own postgres |
| **CI total per PR — `security.yml`** | parallel | ~10–18 min | npm audit + CodeQL + 2× Trivy scans |
| **Wall-clock for a PR's "all checks green"** | max of above | **~18–22 min** | Three workflows, each running its own `npm ci` + `tsc` |
| Fly deploy (build → release → 2 machines healthy) | flyctl | ~4–8 min | `--remote-only`, `min_machines_running = 2` |
| **Merge-to-prod-live** | deploy.yml: test gate + build + Sentry upload + flyctl + health | **~12–18 min** | This is the headline DX number |

### 2a. HMR pitfalls already in the tree

React Fast Refresh requires that a module export only React components (or only non-component bindings) for a "true" hot edit; otherwise it falls back to a full reload. Two patterns in this repo will quietly degrade HMR:

- Files that export **both** a hook *and* a component (common in `client/src/components/onboarding/` and `client/src/hooks/use-*` consumers) — Fast Refresh sees a non-component export and bails to full reload. Recommendation: enforce via `react-refresh/only-export-components` (eslint plugin) once lint is hard-fail.
- `client/src/lib/queryClient.ts` is imported transitively by hundreds of files. Editing it is a full reload — that's fine, but engineers will start avoiding edits to it which calcifies architecture. Wall it off behind a versioned re-export so the leaf hook becomes the HMR boundary.

### 2b. The duplicated work

`tsc --noEmit` runs in **three** workflows on every push to main:
- `ci.yml` (raw `npx tsc --noEmit`, no project flag)
- `test.yml` (raw `npx tsc --noEmit`, no project flag)
- `staging.yml` (raw `npx tsc --noEmit`, no project flag)
- `deploy.yml` runs `npm run check` (which uses `tsconfig.check.json`)

That's three full-project type-checks plus one excluded type-check, on every merge to `main`. Three of them race; the strictest one is the one nobody respects (`ci.yml` runs raw tsc against the full repo with strict mode and ~3,000 known errors — must currently be passing only because the legacy errors are tolerated somehow, or this leg is silently red and ignored).

I would bet against this CI being "green" in any meaningful sense. The lint-and-typecheck job in `ci.yml` runs `npx tsc --noEmit` (full project, no exclusions) — that should be exploding on the 1,410 `as any` plus excluded directories, unless they happen to compile clean even with `strict: true`. Worth a one-line audit: re-run that job locally and see what falls out. My prediction: it has been red for weeks and nobody notices because lint after it is `continue-on-error` and the failure surface blends in.

---

## 3. Hard-fail vs soft-warn — concrete CI policy proposal

The current setup is **inverted**: things that should be hard-fail are soft-warn (lint, type-check on full project, bundle size, e2e), and things that nobody can act on quickly are blocking (CodeQL, Trivy). Below is the policy I'd push.

| Check | Today | Proposed | Reason |
|---|---|---|---|
| `tsc -p tsconfig.check.json` | duplicated, no enforcement consistency | **Hard-fail, single source** | Type-check is the cheapest correctness signal; pick one project file and enforce it everywhere |
| `eslint --max-warnings 0` | `continue-on-error: true` | **Hard-fail** after a one-PR amnesty pass | The `--max-warnings 0` flag is decorative until the workflow respects it |
| `vitest run` (unit + integration) | `continue-on-error: true` in deploy.yml | **Hard-fail on PR**, soft-warn on push to `main` only if a known-fixture-drift label is set | Fixture drift is a real problem but flipping the whole gate off is wrong. Quarantine flaky tests in `tests/quarantine/` and require a TODO date |
| Playwright e2e | runs without DB/health-check | **Either run with proper services, or remove** | Currently this is flake-bait; an e2e suite that can't reach a DB doesn't test e2e |
| `test:bundle-size` | script exists, never invoked | **Hard-fail on PR** with a 600 KB single-chunk + 3 MB total budget | The script is already written; just call it |
| `npm audit` (high/critical) | hard-fail | Keep | Fine as-is |
| CodeQL | hard-fail | **Soft-warn on PR, hard-fail on schedule** | CodeQL false-positives are common; blocking PR review on them creates pressure to disable the job |
| Trivy fs (secret scan) | hard-fail | Keep — escalate | Secret detection is high-value; never relax this |
| Trivy image (CRITICAL,HIGH) | hard-fail | Keep | Container CVE gate is correct |
| Accessibility | `|| true` (soft-warn) | **Soft-warn → hard-fail by 2026-07-01** | Set a date; commit to it |
| Health check post-deploy | `continue-on-error: true` | **Hard-fail with auto-rollback** | The whole point. `staging.yml` already has this pattern — port to `deploy.yml` |
| Sentry source-map upload | `continue-on-error: true` | Keep soft | Correct: deploy proceeds, Sentry catches up async |

The principle: **anything a developer can fix in their PR before merge should be hard-fail.** Anything that requires triage from a different team (CodeQL false-positive, accessibility regression that needs design input) should be soft-warn with a calendar deadline to upgrade.

### 3a. The CI amnesty pattern

When you flip lint from soft-warn to hard-fail, you'll surface 50–500 errors. The amnesty pattern:

1. Run `npm run lint --output-file _eslint-baseline.json` once on `main`.
2. Wrap the lint command in a script that diffs current run against the baseline; only **new** errors fail.
3. Each PR can opt to lower the baseline; nobody can raise it.
4. Sunset the baseline file in 90 days — by then the baseline should be empty.

This is the same shape as Reza's "type ratchet" but for lint, and it lets you flip `continue-on-error: false` *today* without a 200-file drive-by PR.

---

## 4. Preview-environment recommendation

**Today:** No PR previews exist. `staging.yml` deploys `main` to a single Fly app (`acreos-staging`). PRs are reviewed against screenshots and local runs. This is a tax on every reviewer and it scales linearly with team size.

### Three options, in order of recommendation:

#### Option A — **Fly review apps (recommended)**

Fly has a first-class "review apps" pattern where each PR gets its own Fly app named `acreos-pr-<num>`, deployed via `flyctl deploy --app acreos-pr-${PR_NUMBER} --remote-only`. The PR comment workflow already exists in `staging.yml` (lines 168–227) — port it to a new `preview.yml` triggered on `pull_request: [opened, synchronize]`. Spin up minimal: 1 machine, 256 MB, suspend after 30 min idle, destroy on PR close.

Pros:
- Same runtime as production — no surprises
- DB strategy: shared staging DB with PR-scoped org seed data, OR per-PR pg.fly.dev (more cost, more realism)
- Cost: ~$2–4/PR/day with auto-suspend. Cap to PRs labelled `needs-preview` if cost matters.

Cons:
- Cold start ~10 s when a reviewer opens the URL after suspend
- Per-PR DB story is genuinely hard; share the staging DB initially

#### Option B — Vercel previews

Pros: Best-in-class PR preview UX, comment automation, screenshot diffing.
Cons: This is an Express + Fly app; moving to Vercel requires re-platforming the server. **Not worth the migration just for previews.** Skip.

#### Option C — Render / Railway / Coolify

Same trade-offs as Fly review apps, less integrated with your existing infra. Fly wins on incumbent-advantage.

### What I'd ship

- `.github/workflows/preview.yml` triggered on `pull_request`
- A `flyctl deploy` step parameterized by `${{ github.event.pull_request.number }}`
- Fly app config inheriting from `fly.toml` but with `min_machines_running = 0`, `auto_stop_machines = 'suspend'`
- A cleanup workflow on `pull_request: [closed]` that runs `flyctl apps destroy acreos-pr-${PR_NUMBER} --yes`
- The PR comment from `staging.yml:200–227` — reuse it verbatim with `acreos-pr-<num>.fly.dev`

That's a one-day spike. Reviewers stop reviewing screenshots.

---

## 5. Pre-commit policy

Current hook (`.githooks/pre-commit`) runs `npx tsc --noEmit` on the **full project**, captures all output, then greps for staged files. The mechanism is correct (drain the legacy debt without blocking new work) but the implementation is wasteful: 25–45 s of full-project type-check on every commit, most of it discarded. This trains engineers to use `--no-verify`, which defeats the whole hook.

### What it should do

| Stage | Tool | Why |
|---|---|---|
| `tsc --build` with `tsBuildInfoFile` consumed | TS incremental | First commit pays full cost; subsequent commits ~3–8 s |
| `tsc -p tsconfig.check.json` (not full project) | TS | Excludes the same dirs CI excludes — symmetry |
| `eslint --max-warnings 0` on staged files only | lint-staged | ~1–3 s; fast feedback on the file the engineer is touching |
| `prettier --check` on staged files | lint-staged | Already enforced via `format:check` script; nobody runs it |
| Forbidden-strings scan | grep | Block `console.log`, `(req as any)`, raw `res.status(`, hardcoded API keys (regex on common formats) |
| Commit-message lint | commitlint conventional | Aligns with current `feat()/fix()/docs()` convention seen in git log |

### Pre-push hook (separate, harder gate)

A pre-commit that runs lint+typecheck on staged files is fast but local. A **pre-push** hook that runs `npm run check` + `npm run lint --max-warnings 0` (full project) catches what staged-only would miss and runs only at push time, not commit time. Combined with the pre-commit, you get:

- Commit feedback in 3–8 s
- Push feedback in 30–60 s, only when actually pushing
- CI feedback in ~18 min — but CI now rarely catches anything because the local hooks already did

That last part is the prize: CI failure rate drops to ~0, "PR went red 20 minutes after I left for lunch" becomes rare, the team starts trusting the pipeline.

---

## 6. Migration discipline — drizzle-kit deploy story

This is the section with the smoking gun.

### What's there

- `migrations/` contains 32+ `.sql` files
- `drizzle.config.ts` outputs to `./migrations` and reads schema from `shared/schema.ts`
- `fly.toml` `[deploy] release_command = "node scripts/migrate.mjs"`
- `scripts/migrate.mjs` is a **hand-rolled idempotent ALTER TABLE IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING** script. It does **not** invoke `drizzle-kit migrate`.

### What the script's own comment says

> We deliberately avoid drizzle-orm's migrator here because the local `_journal.json` is out of sync with what's actually been applied to prod (many migration files live outside the journal), and running a migrator against drifted state risks re-applying already-applied migrations.

### What this means

The `drizzle-kit` migration system is dead. It's been bypassed. Production schema is patched by an artisanal `STATEMENTS = [...]` array that someone appends to whenever they remember a missed column. Two parallel migration numbering tracks exist in `migrations/` (e.g. `0007_composite_indexes.sql` AND `0007_password_reset_tokens.sql`, same for `0008`, `0009`, `0010`, `0011`, `0012`, `0013`, `0015`, `0016`, `0017`, `0018`) — the journal is unrecoverable as-is.

### The reconciliation plan (one-week project, parallel to DX sprint)

1. **Day 1 — Schema-truth dump.** `pg_dump --schema-only` from production into a checked-in `migrations/_baseline.sql`. This is the new ground truth.
2. **Day 1 — New `drizzle.config.ts` strategy.** Switch from numeric migrations to **timestamped** migrations (`drizzle-kit generate` already supports this — change `out`-folder convention to `migrations/_v2/` and start fresh).
3. **Day 2 — Drift-detection CI.** Add a workflow step that runs `drizzle-kit check` against the production schema dump on every PR; fail if `shared/schema.ts` drifts from the recorded migration set. This is the *only* way to prevent the `migrate.mjs` pattern from re-emerging.
4. **Day 3 — Staging-first migration runs.** Migrations should land on `staging` 24–48 h before production. Today, `staging.yml` doesn't run `release_command` at all because the staging Fly app config is unclear from the workflow. Audit and fix.
5. **Day 4 — Replace `migrate.mjs`.** Once `_v2/` is the source of truth, retire the hand-rolled idempotent script. Keep it around for one more deploy as a safety net, then delete.
6. **Day 5 — Backups + restore drill.** Take a Fly Postgres snapshot, restore it to a scratch app, run a fake migration, roll back. Document the procedure in a runbook. Today this is folklore.

The `migrate.mjs` script is a confession written into the codebase. Until it's gone, the migration story is "we've stopped trusting our migration tool." That's a fixable problem but it doesn't fix itself.

---

## 7. The DX sprint — 1 week of changes that compound

This is the prioritized week. One engineer, full-time. Each day produces a working PR; the week as a whole is non-breaking.

### Day 1 — Wire the bundle-size gate (+ delete duplicated CI work)

- Add `npm run test:bundle-size` to `ci.yml` after `Build`. Hard-fail.
- Refactor `ci.yml`, `test.yml`, `staging.yml`, `deploy.yml` to use a **reusable workflow** (`.github/workflows/_setup.yml`) that does `actions/checkout` → `setup-node` → `npm ci` → `tsc -p tsconfig.check.json`. Cuts ~3× redundant `npm ci` work on every push.
- Cache `~/.cache/ms-playwright` in workflow. ~30 s saved per CI run that uses Playwright.

**Compound effect:** Every future CI run is ~2 min faster. The bundle-size budget catches the next 480 KB schema-on-client regression before merge.

### Day 2 — Hard-fail lint with the amnesty pattern

- Run lint on `main`, save baseline JSON.
- Add `script/lint-diff.ts` that compares HEAD lint output to baseline; only new errors fail.
- Flip `continue-on-error: true` → remove. Lint is now hard-fail.
- Calendar event: 2026-08-01, delete the baseline file. Force the count to zero by then.

**Compound effect:** Lint rules become real. Engineers stop introducing `console.*` and `as any` in new code (paired with Reza's type ratchet, this is decisive).

### Day 3 — Fly review apps for PR previews

- New workflow `preview.yml`. Deploys `acreos-pr-<num>` on `pull_request: [opened, synchronize]`.
- Cleanup workflow on `pull_request: [closed]`.
- PR comment with the URL — copy-paste from `staging.yml`.
- Per-PR DB strategy v1: shared staging DB. v2 (later): per-PR ephemeral pg.

**Compound effect:** Reviewers click a URL instead of cloning a branch. Design review on real DOM not screenshots. Activation friction for new engineers drops from "set up local Postgres + Clerk + Mapbox keys" to "open the URL."

### Day 4 — Pre-commit + pre-push tuning

- Pre-commit: switch to `tsconfig.check.json`, add `lint-staged` for eslint + prettier on staged files only, add forbidden-string grep (`console.log`, `req as any`, `res.status(`).
- Pre-push: full `npm run check` + `npm run lint --max-warnings 0`.
- Measure: pre-commit < 8 s, pre-push < 60 s. Document in a one-line `CONTRIBUTING.md`.

**Compound effect:** `--no-verify` usage drops. Local feedback replaces CI feedback for 80% of failure modes.

### Day 5 — The migration reconciliation start

- Production `pg_dump --schema-only` checked in as `migrations/_baseline_2026_05.sql`.
- New `drizzle-kit` config writing to `migrations/_v2/`.
- Drift-detection step in CI (PR-level): regenerate schema from `shared/schema.ts`, compare to baseline + new migrations. Fail if mismatch.
- Don't delete `migrate.mjs` yet — that's next week.

**Compound effect:** Schema drift becomes a CI failure instead of a production pager event. The team stops being scared of touching `shared/schema.ts`.

---

## DX-budget summary table

| Metric | Today | After sprint | Delta |
|---|---|---|---|
| Pre-commit hook | 25–45 s | 5–8 s | **5×** |
| CI wall-clock per PR | ~18–22 min | ~10–14 min | **~40%** |
| Merge-to-prod-live | 12–18 min | 12–18 min | unchanged (already fast) |
| PR review with running app | screenshots only | live URL in PR comment | **categorically new** |
| Lint enforcement | decorative | hard-fail w/ amnesty | **enforced** |
| Bundle-size enforcement | none | 600 KB / 3 MB hard gate | **enforced** |
| Schema drift detection | none (`migrate.mjs` papering over) | CI fails on drift | **enforced** |
| New `console.*` introduced | unbounded (warn) | blocked | **enforced** |
| Engineers using `--no-verify` | high (slow hook) | low (fast hook) | **trust restored** |

The headline isn't a single number — it's that each of these compounds. A team that trusts CI is a team that ships faster. A team that previews PRs is a team that catches design regressions before merge. A team whose pre-commit is 8 s instead of 45 s is a team that commits in smaller, reviewable chunks.

The dev-loop primitives here are good: Vite, Fly, drizzle-kit, vitest, eslint 9, TS 6 are all current. The gap isn't the tools — it's that nobody has spent a week wiring them together with intent. A week, one engineer, the team gets back hours per week forever.

— Dmitri
