# Onboarding bounce — Step 0, fix, proof (2026-11-05)

Branch `claude/onboarding-bounce-fix`, off main `c8fa715`. Package: "Onboarding bounce: a
just-completed user can be routed back into the wizard". All times Eastern.

## Step 0 — verify before build

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | RC-1: gate redirects on a stale cached `true` | **Reproduced. Not a surprise.** | `tests/unit/onboardingGateStaleCache.test.tsx` on the pre-fix gate: the cache is primed with `{needsOnboarding:true}` and invalidated while nothing is mounted. Invalidation fetched nothing (`fetchCount 0`) and left the cached `true`. Mounting `OnboardingGate` starts the refetch, and the deferred endpoint has not answered. The gate still rendered `<Redirect to="/onboarding-v2">` from the stale value: 3 red (in-flight → false, in-flight → true re-confirm, in-flight → error), each failing at "not redirected while the refetch is in flight". The 4 behaviours that should already hold are green. The redirect is synchronous on remount; the corrective answer cannot win. |
| 2 | RC-2: a completed org that loads `/onboarding-v2` gets step 1 with no redirect | **Confirmed at component level.** | `/onboarding-v2` is a bare `ProtectedRoute` (App.tsx `<Route path="/onboarding-v2">`) with no completion guard. `onboarding-v2.tsx` read `/api/onboarding/status` only for `resolveWizardPrefill`. `tests/unit/onboardingWizardReleasesCompletedOrg.test.tsx` on the pre-fix page: status settles `completed: true`, step 1 (`input-org-name`) renders, and the location never leaves `/onboarding-v2`. A browser load against a real completed org on staging is in the coordinator's post-merge proof. This session had no staging access. |
| 3 | RC-3: seeded vs unseeded `POST /complete` timing | **Delta measured, not material (< ~500 ms).** Leg 3 was built anyway for durability. See below. | Real `/complete` handler (express + supertest), real Postgres 16 built by `npm run db:build-from-repo` on this machine. One pgvector-only table, `solene_embedded_records`, was absent locally and is not on this path. Fresh org per request, n=10 each, interleaved. **seedSampleData=true: median 54 ms (min 40, max 108). false: median 10 ms (min 7, max 21). Delta ≈ 44 ms median.** Postgres statement log: seeded request 41 statements, unseeded 8 (3 of each are harness org/user setup), so seeding is ~33 extra round-trips. At a pessimistic 5 ms per round-trip to staging Postgres that is ~165 ms + ~44 ms compute ≈ 200–250 ms, under the package's ~500 ms bar. The latency half of RC-3 does not hold. The durability half does, independent of latency: a seed that hangs or a process that dies mid-seed left a finished org with no completion record. The harness was a temporary vitest file, not committed. |
| 4 | Preserved behaviours | **Hold, each named below.** | Founder bypass: server-side and unchanged, `tests/unit/needsOnboarding.test.ts` "returns false for founders regardless of org state". The gate's settled-false path is `onboardingGateStaleCache` "renders the page on a settled false". Error fall-through: `onboardingGateStaleCache` "renders the page (never the wizard) when the endpoint errors" and "…when the stale true's refetch errors". `critical-path-render.test.ts` §6b (4 source pins on App.tsx) passes unchanged. Skip parity: `/skip` still calls `completeOnboarding` before answering (`routes-onboarding.test.ts` "POST /api/onboarding/skip marks complete…"), and the wizard's skip `onSuccess` invalidates the same three keys and navigates to `/today`, the same arrival path the gate fix covers. |
| 5 | Leg 2 cannot release a genuinely incomplete user; Settings re-run ordering | **Holds. The release rests on the read, not on timing.** | The release condition is `onboardingStatus.completed === true && !isFetching && !finishing`. `completed` is `org.onboardingCompleted || false` (`OnboardingService.getOnboardingStatus`). The flag flips true only in `completeOnboarding`, reached only from `POST /complete` and `POST /skip`. Mid-wizard writes cannot flip it: `updateOnboardingStep` (complete-step) writes `onboardingData` only, and the wizard's `PATCH /api/organization` sends `{ name }` only. So an incomplete org reads `completed: false` on every settled read and is never released, however slow. Cached data alone never releases: a cached `true` with a refetch in flight holds the skeleton and waits. **Settings "Re-run onboarding" ordering** (`client/src/pages/settings.tsx`, button `button-restart-onboarding`): it `await`s `POST /api/onboarding/reset`, throws unless `res.ok`, then invalidates `/api/organization`, `/api/onboarding/status` and `/api/me/needs-onboarding`, and only then calls `setLocation("/onboarding-v2")`. `resetOnboarding` writes `onboardingCompleted: false` (and `settings.onboardingCompleted: false`). The flag is false on the server before the user reaches the wizard, so the wizard's refetch answers false and it runs. Pinned by `onboardingWizardReleasesCompletedOrg` "Settings re-run: a cached pre-reset completed: true does not release…". |

## Fix

- **Leg 1, `client/src/App.tsx` `OnboardingGate`.** Adds `if (data.needsOnboarding && isFetching) return <PageLoader />;` before the redirect. While a newer answer is being fetched, the gate does not act on a held `true`; it acts on `true` only when no fetch is in flight, so the answer is settled and current. A fresh cached `true` (within `staleTime`, no refetch) still redirects immediately. Unchanged: the error fall-through (checked first), the endpoint, the response shape, the founder bypass, `staleTime`. `OnboardingGate` is now `export`ed so the test renders the real component; it was not moved, so the §6b source pins still read it in App.tsx. The optional `setQueryData({needsOnboarding:false})` in the wizard's `onSuccess` was **not** added. The gate is correct on its own for every arrival path (finish, skip, re-run reset, second tab).
- **Leg 2, `client/src/pages/onboarding-v2.tsx`.** Destructures `isLoading`/`isFetching` from the existing status query. `releaseCompleted` navigates `/today` with `replace`, so Back does not return to the wizard. `holdForStatus` keeps the existing skeleton up during the first read, and during a refetch over a cached `completed: true`, so step 1 never flashes for a completed org. `finishing` (the page's own complete/skip pending or succeeded) suppresses both, so the release never races the wizard's own finish navigation to the vertical's destination. No new copy: the hold reuses the existing loading skeleton.
- **Leg 3, `server/routes-onboarding.ts` `POST /complete`.** `completeOnboarding` moved from after the seed block to immediately before it, after the `onboardingData` write and the persona reconcile. The response contract is unchanged: a seed failure still yields `incomplete: ["sample data"]`, `success: false`, `completed: true`.

No schema, endpoint, response-shape, auth/session or copy changes. The disclosure gate, wizard steps, finish destinations and CJ harness are untouched.

## Tests (all new; no existing assertion changed)

| File | Tests | Pre-fix |
|------|-------|---------|
| `tests/unit/onboardingGateStaleCache.test.tsx` | 7 (both directions + preserved behaviours) | 3 red |
| `tests/unit/onboardingWizardReleasesCompletedOrg.test.tsx` | 3 (release; incomplete runs wizard; re-run with stale cached true) | 2 red |
| `tests/unit/onboardingCompleteFlipsBeforeSeeding.test.ts` | 3 (seed fails; seed hangs; contract) | 2 red |

Mutants (each restored after):

| Mutant | Caught by |
|--------|-----------|
| M1 Leg 2 releases on cached data (drop `!isFetching`) | wizard "Settings re-run" |
| M2 Leg 1 never redirects on `true` (always loader) | gate: 3 red (settled true, re-confirmed true, fresh true) |
| M3 Leg 1 error fall-through removed | gate "stale true's refetch errors" |
| M4 Leg 2 hold removed (step 1 shows while the read is pending) | wizard "completed: true" + "Settings re-run" |
| Pre-fix gate / wizard / route | see table above |

M4 first survived. The wizard test's "while pending" check was vacuous because the AI-disclosure read's own skeleton was hiding step 1. The test now waits for the disclosure read to settle and lets React commit before it asserts the hold. Flake check: the three new files ran 5× back to back, 13/13 each time.

## Gates (read from files, not through a pipe)

- `npm run check`: exit 0. `check:tests` ratchet **151 test type errors (baseline 151)**, 9,277 files loaded. The first run was OOM-killed (tsc status 137) on this 7 GB machine, and the gate correctly refused to count it. It was re-run with swap added. One intermediate run read 153 because both new `.tsx` tests passed wouter's `Router` through `createElement` without `children` in props. They were switched to JSX, back to 151. The baseline was not touched.
- `npm run lint`: exit 0.
- `npm run build`: exit 0. `scripts/check-bundle-size.js`: **9,816 KB of 9,823**. Main `c8fa715` built on the same machine: 9,815 KB. Delta +1 KB.
- Named onboarding suites (146 tests, 8 files, all green): needsOnboarding 5, routes-onboarding 18, onboardingChecklist 30, onboardingVerticals 20, critical-path-render 60, onboardingGateStaleCache 7, onboardingWizardReleasesCompletedOrg 3, onboardingCompleteFlipsBeforeSeeding 3.
- Full vitest: see the PR body. Measured after this file was written.

## Proof still owed (coordinator, after merge + staging deploy)

Targeted fresh-user repro on staging under CPU/network throttling. Direct-load checks in both directions (completed org → `/onboarding-v2` lands on `/today`; incomplete org → wizard). A CJ run with zero onboarding-bounce signatures. If CJ is red only on harness buckets (install-prompt etc.), it is reported as exactly that.
