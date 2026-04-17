# Lens 10 -- DevOps and Fly.io Specialist

**Auditor perspective:** Deployment pipeline, Docker build, CI/CD, environment management, secrets handling, monitoring, and operational readiness.

**Date:** 2026-04-15

---

## Executive Summary

AcreOS has a multi-stage Dockerfile, Fly.io configuration with 2-machine HA, a staging pipeline with auto-rollback, security scanning workflows (CodeQL, Trivy, npm audit), and Sentry integration. However, production deploys lack an automated rollback mechanism, the CI pipeline references non-existent job targets (`unit-tests`, `integration-tests`, `e2e-tests`), Node version drift between Dockerfile (22) and CI (20) risks "works in CI, breaks in prod" failures, the Dockerfile deletes the lockfile and runs `npm install` (non-deterministic), and database migrations run at application startup with no pre-deploy gate or rollback strategy. Redis/ioredis is imported at runtime but absent from `package.json` dependencies, and the production health check step is `continue-on-error: true` meaning deploys succeed even when health is broken.

---

## Findings

### DO-01: CI pipeline `ci.yml` build job depends on non-existent jobs
**Severity:** P0

**Description:** The `build` job in `.github/workflows/ci.yml` line 94 specifies `needs: [unit-tests, integration-tests, e2e-tests]`, but no jobs with those names exist in the file. The only defined jobs are `lint-and-typecheck`, `security-scan`, and `build`. This means the `build` job (and therefore the Docker image build verification) will never run.

**Evidence:**
- `.github/workflows/ci.yml` line 94: `needs: [unit-tests, integration-tests, e2e-tests]`
- The file defines only: `lint-and-typecheck`, `security-scan`, `build`

**Remediation:** Fix the `needs` array to reference actual job IDs, or add the missing job definitions. The `build` job should depend on `lint-and-typecheck` at minimum.

---

### DO-02: Node.js version mismatch -- Dockerfile 22 vs CI 20
**Severity:** P0

**Description:** The Dockerfile uses Node 22.21.1 (`ARG NODE_VERSION=22.21.1`), but all CI workflows (ci.yml, deploy.yml, test.yml, staging.yml, security.yml) use `node-version: 20`. Code that passes tests in CI on Node 20 may behave differently in the production container running Node 22. There is no `.nvmrc` or `engines` field in `package.json` to enforce a canonical version.

**Evidence:**
- `Dockerfile` line 7: `ARG NODE_VERSION=22.21.1`
- `.github/workflows/deploy.yml` line 42: `node-version: "20"`
- `.github/workflows/test.yml` line 41: `node-version: "20"`
- `package.json`: no `engines` field

**Remediation:** Pin all environments to the same Node major version. Add an `engines` field to `package.json` and a `.nvmrc` file. Update either the Dockerfile or CI to match. Node 22 is the LTS choice going forward.

---

### DO-03: Dockerfile deletes lockfile -- non-deterministic production builds
**Severity:** P0

**Description:** The Dockerfile on line 23 runs `rm -f package-lock.json && npm install --include=dev --legacy-peer-deps`. Deleting the lockfile and using `npm install` instead of `npm ci` means every build resolves fresh dependency versions. This makes builds non-reproducible and risks shipping untested dependency versions to production.

**Evidence:**
- `Dockerfile` line 23: `RUN rm -f package-lock.json && npm install --include=dev --legacy-peer-deps`
- Comment says "Lock file generated on macOS" which is the stated rationale, but `npm ci` handles cross-platform installs correctly since npm v7.

**Remediation:** Stop deleting the lockfile. Use `npm ci --legacy-peer-deps` instead. If macOS-generated lockfiles cause issues, generate the lockfile in CI on Linux and commit it.

---

### DO-04: Production deploy has no automated rollback
**Severity:** P1

**Description:** The production deploy workflow (`.github/workflows/deploy.yml`) has no rollback step. The post-deploy health check is marked `continue-on-error: true`, meaning deploys are marked successful even when the health check fails. The only "rollback" is a console log: `echo "Deploy failed -- check Fly.io dashboard for rollback options"`. By contrast, the staging workflow has a proper auto-rollback job. The production deploy also omits the `--strategy rolling` flag that staging uses.

**Evidence:**
- `.github/workflows/deploy.yml` line 117: `continue-on-error: true` on health check
- `.github/workflows/deploy.yml` line 121: `echo "Deploy failed -- check Fly.io dashboard for rollback options"`
- `.github/workflows/deploy.yml` line 105: `flyctl deploy --remote-only --wait-timeout 300` (no `--strategy rolling`)
- `.github/workflows/staging.yml` lines 138-165: proper auto-rollback job exists for staging

**Remediation:** Port the staging workflow's auto-rollback job to the production deploy workflow. Remove `continue-on-error: true` from the health check step. Add `--strategy rolling` to the deploy command.

---

### DO-05: Database migrations run at application startup with no pre-deploy gate
**Severity:** P1

**Description:** Migrations are applied inside the Express application startup code (`server/index.ts` lines 318-331) rather than via a Fly.io `release_command`. This means both machines in the 2-machine HA setup race to apply migrations simultaneously on deploy. The migration failure is caught and logged as a "warning" -- the server continues to run even if migrations fail. There is no `release_command` in `fly.toml`.

**Evidence:**
- `server/index.ts` lines 318-331: migrations run inside the async IIFE at startup
- `fly.toml`: no `[deploy]` section with `release_command`
- `server/index.ts` line 329: `// Non-fatal -- server continues even if migration check fails`

**Remediation:** Add a `[deploy]` section to `fly.toml` with `release_command = "node -e \"...\""` that runs migrations before the new image is deployed. This runs exactly once, before any machines are replaced. Remove the migration code from the application startup path.

---

### DO-06: Migration journal is out of sync with migration files
**Severity:** P1

**Description:** The `migrations/` directory contains 35 SQL files, but `migrations/meta/_journal.json` only tracks 7 entries. Several migrations have duplicate numeric prefixes (e.g., `0003_enrichment_columns.sql` and `0003_robust_namora.sql`, `0007_composite_indexes.sql` and `0007_password_reset_tokens.sql`, multiple `0008_*`, `0009_*`, `0010_*`, `0011_*`, `0012_*`, `0013_*`, `0015_*`, `0016_*`, `0017_*`, `0018_*` files). This suggests migrations may have been applied ad-hoc with `db:push` rather than through the versioned migration system.

**Evidence:**
- `migrations/meta/_journal.json`: 7 entries (last: `0017_pax_next_gen`)
- `migrations/` directory: 35 SQL files with colliding numeric prefixes
- Multiple prefix collisions: 0003, 0007, 0008, 0009, 0010, 0011, 0012, 0013, 0015, 0016, 0017, 0018

**Remediation:** Audit which migrations have actually been applied to production. Re-sequence or consolidate the migration files. Ensure the journal accurately reflects the applied state.

---

### DO-07: Redis/ioredis not in package.json -- production health check failure
**Severity:** P1

**Description:** `server/utils/redis.ts` dynamically imports `ioredis`, and `bullmq` (which is in `package.json`) depends on `ioredis` as a peer dependency. However, `ioredis` is not a direct dependency in `package.json`. The orientation doc confirms: health check shows "Cannot find package 'redis' in production." The Dockerfile's `npm prune --omit=dev` step may remove transitive dependencies that are only resolved through peer-dep hoisting. Additionally, `REDIS_URL` is documented in `.env.example` but there is no Fly Redis addon configured in `fly.toml`.

**Evidence:**
- `package.json`: no `ioredis` or `redis` in dependencies
- `server/utils/redis.ts` line 33: `const IORedis = (await import("ioredis")).default;`
- `package.json` line 96: `"bullmq": "^5.71.1"` (peer-depends on ioredis)
- Orientation doc item 4: "Redis package missing -- Cannot find package 'redis' in production"

**Remediation:** Add `ioredis` as a direct dependency in `package.json`. Provision a Fly Redis instance or Upstash Redis and set `REDIS_URL` as a Fly secret.

---

### DO-08: Docker image copies entire /app including node_modules from build stage
**Severity:** P2

**Description:** The Dockerfile uses `COPY --from=build /app /app` which copies everything from the build stage: source code, `node_modules`, `dist/`, tests, docs, scripts, and all other files. After `npm prune --omit=dev`, the image is leaner than the build stage, but still includes significant unnecessary content (all source `.ts` files, test files, docs, scripts). Combined with Chromium installation, the image is likely 1.5-2+ GB.

**Evidence:**
- `Dockerfile` line 37: `COPY --from=build /app /app`
- No selective `COPY` of only `dist/`, `node_modules/`, `package.json`, and `migrations/`
- `Dockerfile` lines 33-35: Chromium installed in production stage

**Remediation:** Replace the blanket `COPY --from=build /app /app` with selective copies: `COPY --from=build /app/dist /app/dist`, `COPY --from=build /app/node_modules /app/node_modules`, `COPY --from=build /app/package.json /app/package.json`, `COPY --from=build /app/migrations /app/migrations`. This will significantly reduce image size and attack surface.

---

### DO-09: Deploy workflow pre-deploy TypeScript check will always fail
**Severity:** P1

**Description:** The deploy workflow (`deploy.yml`) runs `npx tsc --noEmit` as a pre-deploy gate (line 49). The orientation document states there are 1,815 TypeScript errors. This means the deploy workflow's test job will always fail, blocking all production deployments through CI. Deploys must currently be done manually, bypassing the CI gate entirely.

**Evidence:**
- `.github/workflows/deploy.yml` line 49: `npx tsc --noEmit`
- Orientation doc item 2: "1,815 TypeScript errors -- tsc --noEmit fails massively"
- The `test` job in deploy.yml does not have `continue-on-error: true` on the tsc step
- The `deploy` job has `needs: test`

**Remediation:** Either fix the TypeScript errors or remove the `tsc --noEmit` step from the deploy gate (matching the current build pipeline which uses esbuild without type checking). Alternatively, switch to `tsc --noEmit --skipLibCheck` or a scoped config that excludes known-broken files.

---

### DO-10: No database backup verification
**Severity:** P1

**Description:** A backup job exists (`server/jobs/dbBackup.ts`) that runs `pg_dump` and optionally uploads to S3. However: (1) `pg_dump` is not installed in the Docker image (only Node.js slim + Chromium), so the backup job will fail in production; (2) `DB_BACKUP_S3_BUCKET` is commented out in `.env.example`; (3) there is no backup restoration test or verification job; (4) BullMQ (the job scheduler) requires Redis which is missing in production.

**Evidence:**
- `server/jobs/dbBackup.ts` line 38: `await execAsync(\`pg_dump --no-owner --no-acl "${dbUrl}" -f "${outputPath}"\`)`
- `Dockerfile`: `node:22-slim` base has no `postgresql-client` package installed
- `.env.example` line 219: `# DB_BACKUP_S3_BUCKET=acreos-db-backups` (commented out)
- No backup restore test in CI or runbooks

**Remediation:** Either install `postgresql-client` in the Docker image or move database backups to an external cron job / Fly.io scheduled machine. Configure `DB_BACKUP_S3_BUCKET` as a Fly secret. Add a periodic backup restoration test.

---

### DO-11: No source maps generated in production build
**Severity:** P2

**Description:** The `script/build.ts` esbuild configuration does not include `sourcemap: true`. The deploy workflow uploads source maps to Sentry, but the build step does not generate them. The Sentry source map upload step will silently succeed with no maps to upload (since `continue-on-error: true`).

**Evidence:**
- `script/build.ts` lines 50-62: no `sourcemap` option in esbuild config
- `.github/workflows/deploy.yml` lines 79-92: Sentry source map upload step
- `.github/workflows/deploy.yml` line 92: `continue-on-error: true`

**Remediation:** Add `sourcemap: true` to the esbuild configuration. Ensure the Sentry upload step references the correct source map paths.

---

### DO-12: Staging and production share the same FLY_API_TOKEN secret
**Severity:** P2

**Description:** Both `deploy.yml` and `staging.yml` reference `${{ secrets.FLY_API_TOKEN }}`. If this is the same token, it grants staging workflow access to production infrastructure and vice versa. The staging workflow's rollback job uses `flyctl deploy --image` which could accidentally target the wrong app if the variable resolution fails.

**Evidence:**
- `.github/workflows/deploy.yml` line 107: `FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}`
- `.github/workflows/staging.yml` line 84: `FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}`
- Staging uses `${{ vars.FLY_STAGING_APP || 'acreos-staging' }}` with a fallback

**Remediation:** Use separate Fly API tokens per environment: `FLY_PRODUCTION_API_TOKEN` and `FLY_STAGING_API_TOKEN`, each scoped to the respective Fly app. Use GitHub environment secrets (the `environment:` key is already set) to enforce isolation.

---

### DO-13: ESLint in CI is `continue-on-error: true`
**Severity:** P3

**Description:** The CI workflow allows ESLint failures to pass silently. This means code quality regressions are not caught before merge.

**Evidence:**
- `.github/workflows/ci.yml` line 31: `continue-on-error: true` on the ESLint step

**Remediation:** Fix existing lint errors and remove `continue-on-error: true`. Alternatively, use `--max-warnings` to set a decreasing threshold.

---

### DO-14: Pre-commit hook type check is non-blocking
**Severity:** P3

**Description:** The `.githooks/pre-commit` hook runs `npx tsc --noEmit` but pipes output through `tail -3` and catches failures with a non-blocking warning. The comment says "temporarily disabled" due to dependency type regressions. This means TypeScript errors are not caught locally before push.

**Evidence:**
- `.githooks/pre-commit` lines 16-18: tsc runs but failure does not block the commit

**Remediation:** Once TypeScript errors are resolved, make the pre-commit hook blocking again.

---

### DO-15: Chromium installed in production image for limited use
**Severity:** P3

**Description:** Full Chromium is installed in the production Docker image for `puppeteer-core`, used by only 2 service files (`dealHunter.ts`, `browserAutomation.ts`). This adds ~300-400MB to the image and increases the attack surface. If browser automation is a rarely used feature, consider moving it to a separate worker.

**Evidence:**
- `Dockerfile` lines 33-35: `apt-get install --no-install-recommends -y chromium chromium-sandbox`
- Only 2 files import puppeteer: `server/services/dealHunter.ts`, `server/services/browserAutomation.ts`

**Remediation:** Move browser automation to a dedicated Fly.io machine or a separate Docker image. Use a sidecar architecture where the main app calls the browser worker via HTTP.

---

### DO-16: No `.dockerignore` exclusion for .env.example and sensitive patterns
**Severity:** P3

**Description:** The `.dockerignore` excludes `.env` and `.env.*` but does not exclude `.env.example` explicitly (it matches via the `.env.*` pattern, but `COPY . .` in the build stage still copies docs, tests, PDFs, and git metadata). The `.dockerignore` does not exclude `.git/`, `tests/`, `docs/`, `*.pdf`, or `*.md` files.

**Evidence:**
- `.dockerignore`: 20 lines, no exclusion of `.git/`, `tests/`, `docs/`, `*.pdf`, `README.md`, `CLAUDE.md`

**Remediation:** Add `.git/`, `tests/`, `docs/`, `*.pdf`, `*.md`, `.github/`, `oz/` to `.dockerignore`.

---

### DO-17: 30+ background jobs start on every instance -- no worker separation
**Severity:** P2

**Description:** The `server/index.ts` startup path (lines 460-730+) starts 30+ background jobs (lead nurturing, campaign optimization, deal hunter scraping, agent evolution, event mesh drain, etc.) on every machine. With 2 machines, each job runs twice. The `withJobLock` mechanism provides deduplication via DB advisory locks, but this adds load to the database and means both machines are doing scheduling overhead for every job.

**Evidence:**
- `server/index.ts` lines 466-598: 30+ `start*Job()` calls
- `server/index.ts` lines 100-156: `withJobLock` uses DB-level locking
- `fly.toml`: `min_machines_running = 2` with no process group separation

**Remediation:** Separate web and worker processes using Fly.io process groups. Define `[processes]` in `fly.toml`: `web = "node dist/index.cjs"` and `worker = "node dist/worker.cjs"`. This eliminates lock contention and allows independent scaling.

---

### DO-18: Fly.io configuration has no stagger or canary deploy strategy
**Severity:** P3

**Description:** The `fly.toml` does not configure a `[deploy]` section with stagger settings. The production deploy command omits `--strategy rolling` (though staging includes it). Without stagger, both machines are replaced simultaneously, causing a brief outage window.

**Evidence:**
- `fly.toml`: no `[deploy]` section
- `.github/workflows/deploy.yml` line 105: `flyctl deploy --remote-only --wait-timeout 300` (no strategy flag)
- `.github/workflows/staging.yml` line 81: `--strategy rolling` (present for staging)

**Remediation:** Add `--strategy rolling` to the production deploy command. Consider adding `[deploy]` with `strategy = "rolling"` and stagger settings to `fly.toml`.

---

### DO-19: Metrics endpoint exposed without authentication
**Severity:** P2

**Description:** The `/metrics` Prometheus endpoint is exposed without authentication (`server/index.ts` line 406: `app.get("/metrics", metricsHandler)`). This endpoint is mounted before route authentication middleware and can be scraped by anyone, leaking internal performance data, request counts, error rates, and potentially endpoint paths.

**Evidence:**
- `server/index.ts` line 406: `app.get("/metrics", metricsHandler)` -- no auth middleware

**Remediation:** Gate the `/metrics` endpoint behind a bearer token or restrict it to internal Fly.io private networking (e.g., check for `Fly-Client-IP` header or bind to the `.internal` hostname).

---

### DO-20: OpenTelemetry/observability configuration is entirely optional with no defaults
**Severity:** P2

**Description:** All observability environment variables (OTEL, Sentry, metrics) are commented out or optional in `.env.example`. The `initTracing()` call catches and swallows errors. There is no indication that any observability backend is actually configured in production. Without tracing, metrics, and alerting, there is no way to diagnose issues in production beyond reading Fly.io logs.

**Evidence:**
- `.env.example` lines 258-264: all OTEL variables commented out
- `.env.example` lines 150-161: Sentry variables commented out
- `server/index.ts` lines 409-413: tracing init failure is silently swallowed
- No alerting integration (PagerDuty, OpsGenie, Slack webhook) in any workflow or config

**Remediation:** Configure Sentry DSN as a minimum. Set up Fly.io log shipping to a central logging service. Configure at least Sentry alerts for error spikes. Add a Slack/PagerDuty notification step to the deploy workflow failure path.

---

## Embarrassment Test

**Would a competent DevOps engineer be embarrassed by this deployment setup?**

Yes, on several fronts:
1. The production deploy health check is `continue-on-error: true` -- a broken deploy is silently marked as successful.
2. The Dockerfile deletes the lockfile and runs `npm install` -- builds are non-reproducible.
3. Node 22 in Docker vs Node 20 in CI -- a classic environment drift problem.
4. The `ci.yml` build job references three non-existent dependency jobs and therefore never executes.
5. There is no automated rollback for production despite one existing for staging.
6. 1,815 TypeScript errors mean the deploy workflow's type-check gate always fails, so production deploys presumably bypass CI entirely.

## Pride Test

**What would a competent DevOps engineer point to with pride?**

1. **Staging pipeline with auto-rollback** -- The staging workflow has a proper health check, smoke test, and automatic rollback job with PR commenting. This is well-designed.
2. **Security scanning pipeline** -- CodeQL SAST, Trivy container and filesystem scans, npm audit with severity gating, and a security gate job that aggregates results. This is thorough.
3. **Graceful shutdown handling** -- The SIGTERM/SIGINT handler with 30-second timeout and HTTP server draining is correctly implemented for Fly.io rolling deploys.
4. **Health check architecture** -- Multi-service health checks (Stripe, OpenAI, DB, Redis) with cached and deep variants, proper Fly.io health check configuration with grace period.
5. **Rate limiting by category** -- Auth, AI, webhook, import, and general API endpoints each have appropriate rate limits.
6. **Secrets validation at startup** -- Two layers of env validation (`validateEnv()` and `validateSecrets()`) with clear error messages and production-only enforcement.
7. **Non-root container execution** -- `USER node` in Dockerfile is a security best practice.
8. **PII masking in logs** -- Console interceptor prevents leaking sensitive data to log aggregators.
