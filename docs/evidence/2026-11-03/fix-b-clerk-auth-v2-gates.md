# Fix B — server auth reads @clerk/express 2.x's callable `req.auth` — gates

Branch `claude/fix-b-clerk-auth-v2`, off main `29a1755`. Package:
`claude-package-fix-b-clerk-auth-v2-2026-11.md` (2026-11-02). Measured
2026-11-03 (EST) in a 2-CPU / 8 GB container. Every verdict below was read
from a file and an exit status, never through a pipe.

## Census, re-measured

- main `29a1755` = census commit `40462db3` (#443) + 9 commits; none touch
  `server/auth`, `server/types` or `requireClerkMFA.ts`.
- Direct reads: 6 lines in 4 files, as the package states. Helper call
  sites: 21 lines in 17 files, as stated. MFA cast: 1.
- **Census gap: 2 more broken reads**, spelled through a type cast, which a
  `req.auth?.` grep cannot see:
  `server/middleware/requirePaxDisclosure.ts:31–32` (mounted on
  `POST /api/ai/chat` and `/api/ai/chat/stream`; 401'd every Pax chat turn)
  and `server/routes-pax-disclosure.ts:77`. Fixed in their own commit.

## Installed types (verified in node_modules, not from memory)

@clerk/express 2.1.85, @clerk/backend 3.26.4, @clerk/shared 4.43.0.

- `ExpressRequestWithAuth.auth: (options?) => SignedInAuthObject | SignedOutAuthObject`
  (`express/dist/types-*.d.ts`). Runtime: `Object.assign(request, { auth })`
  with a branded function; there is no property proxy, so `req.auth.userId`
  is `undefined`.
- `userId: string` / `null`, `sessionId: string` / `null`,
  `factorVerificationAge: [firstFactorAge, secondFactorAge] | null` in
  MINUTES (`shared/dist/types/authObject.d.ts`,
  `backend/dist/tokens/authObjects.d.ts`). Neither stop condition fired.

## Falsification

New tests run against UNFIXED main (`29a1755` + only the test files):

- The middleware path with `CLERK_JWT_KEY` unset → **401** (the regression),
  and the callable-shape MFA cases, the callable bypass, `requireFounder`,
  the Pax gate, the real-SDK test and the sweep all fail. The sweep names
  every broken read, the two Pax sites and the object-shaped bypass included.
- Fallback-preservation cases pass on BOTH pre-fix and fixed code: the bare
  cookie name, the 30 s grace (10 s accepted / 31 s refused), a bad
  signature, no `sub`, a revoked sid, and both no-key 401s (same body).

Mutants on the fixed tree (`fix-b-mutants.py`, output `fix-b-mutants.log`), all caught:

| Mutant | Result |
|---|---|
| M1 helper stops invoking the callable | 20 failed |
| M2 hydrateUser reads `req.auth` as an object | 6 failed |
| M3 bypass reverted to a plain object | 2 failed |
| M4 signed-out verdict treated as final (rejects before the fallback) | 3 failed |
| M5 MFA reverted to the inline cast | 9 failed |
| M6 Pax gate drops the `req.user` fallback | 1 failed |
| M7 cast-form read reintroduced in `routes-setup.ts` | 2 failed |
| M8 fallback grace widened 30 s → 300 s | 1 failed |

## Gates

| Gate | main `29a1755` | branch |
|---|---|---|
| `npm run check` (36 chained gates incl. `check:app`) | — | exit 0 |
| `check:tests` ratchet | 151 (package figure) | **151** (baseline 151), 9249 files (floor 6000) |
| `npm run lint` | — | exit 0 |
| `npm run build` | exit 0 | exit 0 |
| Bundle (`CI=1 check-bundle-size.js`) | 9798 KB / 509 chunks | **9798 KB / 509 chunks** (limit 9823); all 509 chunk sizes byte-identical → client delta 0 KB. Server `dist/index.cjs` +251 B. |
| Full vitest at `f296aaf` | 19,599 tests: 19,386 passed, **2 failed**, 211 skipped | 19,650 tests: 19,437 passed, **2 failed**, 211 skipped |

The 2 failures are the same tests on both trees and are date-dependent, not
auth: `forecastIsContractNotAssumption` (expects 3 months in a window, gets
2 in 2026-11) and `noteRecordPanels` (a date-format match). The final
full-suite run at the PR head is in the PR description.

`check:tests` / `check:app` OOM-killed (status 137) at the container's
memory-cgroup cap until an 8 GB swapfile was added; the gate correctly
refused to report a count on the killed runs. No baseline was changed.

## Independent audit

A fresh agent that did not build the change audited `f296aaf`: MERGEABLE.
Its medium finding (the sweep only knew receiver `req`: it missed
`request.auth`, `({ auth }) =>`, `Reflect.get(req, "auth")` and a reverted
object-shaped bypass) and its low finding (the tests hand-modelled the SDK
shape) are fixed in `910ab41`.

## Not done here, by design

- Staging proof (package Rollout §3) runs after merge; it is not in this
  session's remit. No deploy, no merge.
- Production deploy is a separate founder dispatch (Rollout §4).
