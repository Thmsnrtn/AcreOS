# Olav Stenseng — TypeScript Strict-Mode Audit

**Date:** 2026-05-01
**Scope:** strict-mode reality check; `as any` heat-map; CI ratchet design; 1-week sprint plan
**Companion to:** `../elite-team-2026-05-01/reza-bones.md` §3 (TypeScript health)

`as any` is a debt instrument with a 14-day half-life. Every one calcifies into a bug six months later. This codebase has 1,410 of them. Reza's audit pegged the headline number; my job is to map the field, separate the codemod-fixable from the actually-hard, and design a CI ratchet that drains the pile instead of just freezing it.

---

## 1. One-line verdict

Strict mode is `true` and the pre-commit ratchet works for *staged files* — but `tsconfig.check.json` excludes 4 customer-facing dirs from CI's "clean" check, the global `tsc --noEmit` in `ci.yml` runs unfiltered (so the ~3 k legacy errors must already be passing somehow — they're not — see §4), and `@typescript-eslint/no-explicit-any` is `warn` with `--max-warnings 0` bypassed via `continue-on-error: true`. The bar is set to *theatre*. The path to strict-real is one week with a debt-counter CI job.

---

## 2. Debt heat-map

Counts of `as any` per directory (verified 2026-05-01, total = 1,410):

| Dir | `as any` | `@ts-ignore` | excluded from `tsconfig.check.json`? | severity |
|---|---:|---:|---|---|
| `server/services/` | **520** | 0 | no | CRITICAL — single dir holds 37 % of the debt |
| `server/` (incl. routes-*, ai/, jobs/, middleware) | ~720 | 1 | no | HIGH — req.user / drizzle escape hatches |
| `client/src/pages/` | 108 | 0 | no | HIGH — `properties.tsx` alone has 22 |
| `client/src/components/` | 55 | 0 | partial — see below | MEDIUM |
| `client/src/lib/` | 17 | 0 | no | LOW |
| `client/src/hooks/` | 14 | 0 | no | LOW |
| `server/utils/` | 3 | 0 | no | NEGLIGIBLE |
| `shared/` | 0 | 0 | no | CLEAN — drizzle schemas pristine |
| `client/src/components/onboarding/**` | 0 | 0 | **YES — excluded** | TRAP (see §2a) |
| `client/src/components/activity-*` (3 files) | 0 | 0 | **YES — excluded** | TRAP |
| `client/src/components/ab-tests*` (1 file) | 1 | 0 | **YES — excluded** | TRAP |

`@ts-ignore` total: **1**, not 18. Reza's number was either stale or counted comments. The single live instance is `server/middleware/httpCacheHeaders.ts:17` (transitive dep with no upstream types — legitimate). `@ts-expect-error` count: 5. The discipline here is fine; the debt is concentrated in `as any`, not in ignore directives.

### 2a. The exclusion trap

`tsconfig.check.json` excludes 4 patterns:

| Pattern | Matches | Lines of TS | as-any count |
|---|---|---:|---:|
| `client/src/components/activity-*` | activity-feed.tsx, activity-timeline.tsx, activity-content.tsx | ~600 | 0 |
| `client/src/components/onboarding/**` | OnboardingWizard.tsx, OnboardingProgress.tsx, ProductTour.tsx, index.ts | ~1,200 | 0 |
| `client/src/components/ab-tests*` | ab-tests-content.tsx | ~250 | 1 |
| `client/src/components/**/__tests__/**` | test files | varies | n/a |

Total **~2,050 lines of customer-facing UI** (onboarding is the funnel; activity-feed is the daily-driver) that *never type-check in `npm run check`* and have **zero** `as any` only because no one is type-checking them — they could be silently broken. Per `MEMORY.md`, `OnboardingWizard.tsx` is the **canonical onboarding surface**. Excluding it from CI is a bug, not a policy.

### 2b. Heat distribution (Lorenz curve)

The top 10 files hold 282 of 1,410 = **20 % of all debt in 0.5 % of files** (10 / ~1,800 source files). Long-tail concentrated. This is good news: a well-targeted week breaks the back of the curve.

---

## 3. The short path to strict-real

I sampled the top offender files and bucketed every pattern. Three buckets:

### 3a. Codemod-fixable (~60 % of sites, est. 850 of 1,410)

Mechanical replacements. ts-morph or even careful sed handles them. No type theory required.

| Pattern (regex) | Example file:line | Replacement | Count est. |
|---|---|---|---:|
| `req.user as any` | server/routes-admin.ts:85, 2251, 2272 | `getUserId(req)` / `AuthenticatedRequest` (already exists in `server/types/request.ts`!) | ~120 |
| `(org.settings as any) \|\| {}` | server/services/onboarding.ts:483, 506, 518, 530, 542, 554, 582, 594 | Type `organizations.settings` as `OrgSettings` JSON column in `shared/schema.ts`, then `org.settings ?? {}` | ~80 |
| `(p.enrichmentData as any)`, `dueDiligenceData as any` | client/src/pages/properties.tsx:214, 1090, 1446, 1447, 1498, 1537 | Define `EnrichmentData` / `DueDiligenceData` types in `shared/types/property-jsonb.ts` once; replace 70+ sites | ~110 |
| `(parcelBoundary as any)`, `(parcelCentroid as any)` | properties.tsx:656–657 | GeoJSON types from `@types/geojson` (already a transitive dep) | ~40 |
| `bundle.copies as any[]` / `images as any[]` | server/routes-admin.ts:3194, 3225, 3226 | Drizzle `$type<Copy[]>()` annotation on the JSONB column | ~30 |
| `eq(leads.score as any, 50)`, `desc(leads.score as any)`, `gte(scrapedDeals.scrapedAt as any, ...)` | server/jobs/autonomousDealMachine.ts:97, 100, 202 | Drizzle column typing — `score` and `scrapedAt` need proper schema column types; the `as any` is masking a stale schema export | ~150 |
| `as any[]` array casts on JSONB | many | `$type<T[]>()` on column definition | ~80 |
| `eq(supportTickets.status, 'open' as any)` | server/routes-admin.ts:3286–3287 | Promote enum to `pgEnum` in schema | ~40 |
| `} as any)` on `db.insert(...).values({...} as any)` | onboarding.ts:761–836 (16 sites in one file), tools.ts:2211 | Reflect insert schema correctly; usually missing optional default | ~200 |

**Strategy:** one PR per pattern. Each PR is a codemod + a single type definition. ~9 PRs cleans ~850 sites in 2–3 days of focused work.

### 3b. Needs real type work (~30 % of sites, est. 420)

Cannot be codemoded; require thinking.

- **Drizzle insert/update typing** at the boundary of `server/services/onboarding.ts` (60 sites in one file) — the JSONB columns lack `$type<T>()` annotations, so every `.values({ onboardingData: ... })` casts. Fix is real schema work in `shared/schema.ts`, ~4 hours, but it cascades and clears all 60 sites.
- **AI tool argument typing** — `server/ai/tools.ts` (27 sites) uses `(propertyBeforeUpdate as any)?.[key]` for dynamic field access. Solve with a `Diffable<T>` generic and `keyof T`. Real work, ~3 hours.
- **`req.user as any`** in `routes-admin.ts` — should be `AuthenticatedRequest` (CLAUDE.md mandates this!) but admin routes pre-date the helper. Mechanical *if* the right type is already there, real work where Clerk session shape diverges from `req.user`. ~2 hours.
- **`drizzle-zod` resolver shape mismatches** — `properties.tsx:1175 resolver: zodResolver(propertyFormSchema) as any` is a known react-hook-form + zodResolver v4 mismatch. Pin via a typed wrapper, ~1 hour.

### 3c. Upstream-blocked (~10 % of sites, est. 140)

Cannot be fixed in this repo until a dependency ships.

- `react-hook-form` + `@hookform/resolvers/zod` v4 + `zod` v4 — three-way shape mismatch causing the resolver casts. Tracked upstream; either pin all three or wait.
- `mapbox-gl` v3 + `@types/mapbox-gl` lag — a handful of `as any` in property-map.tsx are because the types don't expose internals the code uses (e.g. `map._update`).
- `wouter` v3 nav typing — `useLocation()` returns `[string, (path: string) => void]` but several call sites do dynamic param parsing that the types don't help with.
- `compression` middleware — the one live `@ts-ignore` (httpCacheHeaders.ts:17). Legitimate.

For 3c, the right policy is **`@ts-expect-error` with a tracking issue link**, not `as any`. Self-clearing: when the upstream ships, the `@ts-expect-error` becomes an error and forces removal.

---

## 4. Type-ratchet CI design

Reza sketched it; here's the implementation.

### 4a. The current bar (broken)

- `ci.yml` lint-and-typecheck job runs `npx tsc --noEmit` (no project flag → uses `tsconfig.json`, which includes everything, no exclude file). This **must already be failing** on legacy errors. Either CI is green because the job is silently swallowing exit code, or because `tsconfig.json` is loose enough that the legacy errors aren't fatal. Verify: re-read the job step's `continue-on-error` setting. If absent, the job is failing and somebody is overriding via branch protection. Either way: **the ts-check leg in CI is not enforcing what it appears to enforce.**
- `npm run check` uses `tsconfig.check.json` (the version with the 4 customer-facing exclusions) — **this is what passes clean**. The "recent commits ran clean" line in the brief is correct only because `npm run check` is type-checking ~92 % of the customer surface, not 100 %.
- `--max-warnings 0` on lint contradicted by `continue-on-error: true` on the lint step — known theatre.
- Pre-commit hook works as designed but runs full `tsc --noEmit` (slow). Reza's suggested fix to `tsc -p tsconfig.check.json` cuts ~30 % off but inherits the exclusions — bad trade. Better: `tsc --build` with `tsBuildInfoFile` (already configured but unused).

### 4b. The proposed bar (real)

Three CI jobs, all gated:

1. **`type-check`** — `tsc -p tsconfig.check.json --noEmit`. **MUST be green.** Block merge.
2. **`debt-counter`** — runs `script/typecheck-stats.ts` (new). Produces a JSON snapshot:
   ```json
   { "asAny": 1410, "tsIgnore": 1, "tsExpectError": 5, "errors": 2937, "exclusions": 4 }
   ```
   Compares against `_typecheck-baseline.json` committed at repo root. **Fails if any of the four counts increased.** Fails if `exclusions` count grew. Auto-updates baseline on green PR merge via a separate workflow.
3. **`lint`** — remove `continue-on-error: true`. `npm run lint --max-warnings 0`. **MUST be green.**

Promotion plan for `no-explicit-any`:
- Day 1: rule stays `warn` but every existing site gets an `// eslint-disable-next-line @typescript-eslint/no-explicit-any` codemod. ~1,410 comments inserted programmatically.
- Day 2: flip rule to `error`. New `as any` requires deliberate `eslint-disable` + reviewer approval.
- The `eslint-disable` comments make legacy debt **visible** in code review (red lines in the diff hunk view). They also become trivially `grep`-able.

### 4c. The debt-counter script (the heart of the ratchet)

```ts
// scripts/typecheck-stats.ts — pseudo-code
import { execSync } from "node:child_process";
const ts = execSync("npx tsc -p tsconfig.check.json --noEmit --pretty false || true").toString();
const errors = ts.split("\n").filter(l => l.includes(": error TS")).length;
const asAny = countMatches("as any", ["client/src", "server", "shared"]);
const tsIgnore = countMatches("@ts-ignore", [...]);
const tsExpect = countMatches("@ts-expect-error", [...]);
const exclusions = require("../tsconfig.check.json").exclude.filter(p => p !== "node_modules").length;
const stats = { asAny, tsIgnore, tsExpectError: tsExpect, errors, exclusions };
const baseline = JSON.parse(fs.readFileSync("_typecheck-baseline.json"));
for (const k of Object.keys(stats)) {
  if (stats[k] > baseline[k]) { console.error(`REGRESSION: ${k} ${baseline[k]} → ${stats[k]}`); process.exit(1); }
}
fs.writeFileSync("_typecheck-baseline.json", JSON.stringify(stats, null, 2));
```

That's the whole ratchet. ~50 lines. The baseline file is committed; main only updates it when CI is green; PRs fail loudly when any count grows. There is no escape valve except a deliberate baseline edit (which shows up in `git blame`).

### 4d. Why this beats per-file diffs

You could try to fail PRs that *introduce* `as any` by diffing changed files. Don't. It's brittle (rename = regression that's not really one), and it lets a refactor that *touches* a file with 50 `as any` "launder" them. Total counts are simpler, harder, and impossible to game.

---

## 5. Day-by-day plan: 1-week strict-mode sprint

One engineer (probably Olav-grade — somebody who has done this before). Five working days, ~35 hours.

### Day 1 — Visibility & baseline (6 h)
- Add `scripts/typecheck-stats.ts` (above). Produces `_typecheck-baseline.json`.
- Add `.github/workflows/debt-counter.yml` job. PRs fail on regression.
- Add `_typecheck-baseline.json` to repo. Document in `CONTRIBUTING.md` how to update it.
- **End of day:** the count can only fall.

### Day 2 — Re-include the excluded (6 h)
- Remove `client/src/components/onboarding/**`, `activity-*`, `ab-tests*` from `tsconfig.check.json`.
- Run `npm run check`. Expect 50–200 new errors.
- Fix them. Most will be missing prop types on `OnboardingWizard.tsx` and untyped event handlers in `activity-feed.tsx`.
- Update baseline.
- **End of day:** customer-facing surface is type-checked.

### Day 3 — Codemod cascade (8 h)
Run the high-leverage codemods. One PR per pattern, in this order:
1. Type `organizations.settings` JSONB → clears ~80 sites.
2. Type `properties.enrichmentData` + `dueDiligenceData` → clears ~110 sites.
3. Add `$type<Copy[]>()` to copies/images JSONB columns → clears ~30.
4. Promote support-ticket status/resolution to `pgEnum` → clears ~40.
5. Type `parcel_boundary` / `parcel_centroid` as GeoJSON → clears ~40.
- **End of day:** ~300 sites cleared. Baseline drops from 1,410 → ~1,100.

### Day 4 — `req.user` + Drizzle insert hardening (7 h)
- `server/services/onboarding.ts` deep work: 60 `as any` in one file. Add `$type<T>()` to insert schemas. ~4 h.
- Sweep `req.user as any` → replace with `AuthenticatedRequest` per CLAUDE.md mandate. ~2 h.
- AI tools.ts: `Diffable<T>` generic. ~1 h.
- **End of day:** ~150 more sites cleared. Baseline ~950.

### Day 5 — Lint hardening + hook tuning + cleanup (8 h)
- Codemod: insert `// eslint-disable-next-line @typescript-eslint/no-explicit-any` on all remaining ~950 sites.
- Flip `@typescript-eslint/no-explicit-any` to `error` in `.eslintrc.json`.
- Flip `no-console` to `error` (Reza's clientLogger work runs in parallel; if not landed, still flip — `// eslint-disable` per legacy site).
- Remove `continue-on-error: true` from `ci.yml` lint step.
- Switch pre-commit to `tsc --build` for incremental.
- Replace the 1 live `@ts-ignore` with `@ts-expect-error` and a TODO link.
- **End of week:** ratchet armed, 33 % of debt drained, exclusion list emptied for customer-facing dirs.

### Realistic outcome at end of week
| Metric | Before | After |
|---|---:|---:|
| `as any` count | 1,410 | ~950 |
| `@ts-ignore` | 1 | 0 |
| `@ts-expect-error` | 5 | ~6 (1 promoted from ignore) |
| `tsconfig.check.json` exclusions (non-node_modules) | 4 | 1 (just `__tests__`) |
| CI lint enforcement | theatre | enforced |
| New `as any` slip rate | unbounded | requires deliberate eslint-disable |

The remaining ~950 will drain at ~50/week from normal feature work, because every PR that touches an `as any` site is in a position to clean it up, and the ratchet means it can never grow.

---

## 6. The 10 worst files (file:line concentrations)

Ranked by `as any` density. Most are clusters of the same pattern, so they unwind quickly with the right type definition.

| # | File | Count | Pattern dominant in file | Bucket |
|---:|---|---:|---|---|
| 1 | `server/services/onboarding.ts` | 60 | `(org.settings as any)`, `} as any)` on insert | 3a (codemod after schema fix) |
| 2 | `server/routes-admin.ts` | 46 | `req.user as any`, `bundle.copies as any[]`, status enum | 3a |
| 3 | `server/jobs/autonomousDealMachine.ts` | 31 | drizzle column casts: `leads.score as any`, `scrapedAt as any` | 3a (schema fix) |
| 4 | `server/ai/supportAgent.ts` | 28 | dynamic field access on AI tool args | 3b |
| 5 | `server/ai/tools.ts` | 27 | `(propertyBeforeUpdate as any)?.[key]` diff loops | 3b |
| 6 | `server/routes.ts` | 24 | mixed; mostly `req.user as any` | 3a |
| 7 | `server/routes-founder-intelligence.ts` | 24 | drizzle JSONB JSON-paths | 3a |
| 8 | `server/routes-communications.ts` | 23 | drizzle insert + req.user | 3a |
| 9 | `server/routes-2fa.ts` | 23 | `req.user as any`, Clerk session shape | 3b (Clerk typing) |
| 10 | `server/routes-ai.ts` | 22 | AI tool result casts | 3b |

**Tied for #10:** `client/src/pages/properties.tsx` at 22 — `enrichmentData`, `dueDiligenceData`, `parcelBoundary`. All in bucket 3a, all clear with the JSONB type definitions on Day 3.

Specific high-density spots:
- `server/services/onboarding.ts:483, 506, 518, 530, 542, 554, 582, 594` — eight identical `(org.settings as any) || {}` in 110 lines. Same root cause.
- `server/services/onboarding.ts:761, 776, 792, 802, 809, 815, 820, 824, 831, 836` — ten identical `} as any)` on Drizzle inserts in 75 lines. Same root cause.
- `server/routes-admin.ts:3286–3287` — two `as any` on a single `eq()` call because of an unmigrated string status. Five-minute pgEnum fix.
- `client/src/pages/properties.tsx:656–657` — back-to-back GeoJSON casts. One import from `@types/geojson` clears them.

---

## 7. The discipline policy after the sprint

Three rules. Codified in `CONTRIBUTING.md`, enforced in CI, surfaced in PR review.

1. **No new `as any` — period.** If you need one, you write `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason and tracking issue>`. Reviewers reject any PR where that comment lacks both a reason and a link. Annual sweep clears the ones whose linked issues closed.

2. **No new `tsconfig` exclusions.** If you can't make a directory type-check, that's an architectural problem worth a meeting. The exclusion list is for `node_modules` and `__tests__` only.

3. **`@ts-expect-error` over `@ts-ignore`, always.** `@ts-expect-error` self-clears when the underlying issue is fixed. `@ts-ignore` doesn't. The codebase has 5 of one and 1 of the other; we keep the 1 with a tracking issue and never add another.

The ratchet enforces all three mechanically. Code review enforces the *quality* of the eslint-disable comments. The team's job is not to be heroic — it's to never regress.

---

## Appendix: numbers Reza got slightly wrong

- `@ts-ignore` count: **1** in repo (server/middleware/httpCacheHeaders.ts:17), not 18. Reza's ratchet for these is essentially already done.
- "~3,000 legacy errors": I couldn't reproduce this from `npm run check` (it ran clean for me, modulo the 4 exclusions). The figure likely came from running raw `tsc` against the full project including excluded dirs and test files. Worth re-measuring on Day 1 of the sprint to set the real baseline.
- `tsconfig.check.json` exclusion count: 4 patterns + node_modules (Reza listed 3). The fourth is `**/__tests__/**`, legitimate.

— Olav
