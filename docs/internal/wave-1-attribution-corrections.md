# Wave-1 attribution corrections (2026-06-03)

The agentic-evolution Layer-2-through-6 expansion wave on 2026-06-03
shipped four capabilities in parallel:

- **L1.4** — persistent agent identity
- **L3.12** — failure-mode library
- **L2.8** — multi-agent code review
- **L4.18** — model-upgrade path on anthropic-watch
- **L6.29** — constitutional self-defense at the tool-call layer

(L1.4 and L3.12 were bundled into a single agent because both extend
`dispatchRunner.buildSystemPrompt`; the four parallel agents covered
the five capabilities.)

All code landed cleanly to disk. All tests pass. `npm run check` is
green.

However, three sibling agents `git add`-ing roughly simultaneously
triggered the exact failure mode that L3.12 was seeding into the
library on this same wave —
`docs/internal/failure-modes/0003-agent-add-sweep-collision.md`. The
result: **commit messages are scrambled relative to file contents**.

## The map

| Commit SHA  | Message says     | Actually contains                                                                                              | Verified |
|-------------|------------------|----------------------------------------------------------------------------------------------------------------|----------|
| `5fb4def0`  | L2.8             | L2.8 (codeReviewQueue + dispatchQueue hook + dispatch-queue schema additions) **plus** the L4.18 `solene_model_upgrade_recommendations` table mirror in `scripts/migrate.mjs`. | ✓ |
| `dfed80f4`  | L6.29            | **L4.18** — `modelUpgradePath.ts` + `modelUpgradePath.test.ts` + `anthropicWatch.ts` additive hook + `shared/schema/solene-model-upgrade.ts`.                                | ✓ |
| `dcafcec0`  | L4.18            | **L1.4 + L3.12** — `agentIdentity.ts` + `failureModeLibrary.ts` + `dispatchRunner.ts` prompt-build extension + `dispatchRunner.test.ts` extensions + `docs/internal/failure-modes/{README,0001,0002,0003}.md` + `shared/schema/solene-agent-identity.ts` + `shared/schema/solene-failure-modes.ts`. | ✓ |
| `17f0bfd4`  | L6.29 (cont)     | L6.29 (correct) — Sibling D detected the swept-out state and recovered by re-staging + re-committing its guard service + executor hook + violations schema. The header refers back to `dfed80f4` thinking that was its own first L6.29 commit, but `dfed80f4` is actually L4.18. | ⚠ See note. |

## Why this was not history-rewritten

Per Solene's engineering discipline (`CLAUDE.md` + the agent
operating standards), destructive ops including `git reset --hard`,
force-push, and amending committed work are forbidden absent
explicit Tom approval. The functional surface — code + tests — is
correct on disk. Rewriting history to align commit messages with
contents would be cosmetic, would risk drop-on-the-floor on a
near-122-commit unpushed branch, and would mask the very failure
mode the library was just seeded to teach future agents about.

This doc is the durable record of what actually shipped where, so
post-deploy attribution, post-deploy debugging, and future
git-blame reads have a reliable map.

## How to read commit messages in this branch going forward

- For the **L1.4 + L3.12 work** — start at `dcafcec0` (despite its
  message). Files include `server/services/solene/agentIdentity.ts`,
  `server/services/solene/failureModeLibrary.ts`, the
  `docs/internal/failure-modes/` directory.
- For the **L4.18 work** — start at `dfed80f4` (despite its
  message). Files include
  `server/services/external-watch/modelUpgradePath.ts` and the
  `solene_model_upgrade_recommendations` schema.
- For the **L2.8 work** — `5fb4def0` is mostly correct; reads
  `codeReviewQueue.ts` + dispatch-queue schema additions there
  plus the L4.18 migrate row.
- For the **L6.29 work** — primary content is in `17f0bfd4`
  (`constitutionalGuard.ts` + `dispatchToolExecutor.ts` hook +
  `solene_constitutional_violations` schema). `dfed80f4` despite
  its message is L4.18, not L6.29.

## Root-cause analysis

K2 (cross-agent coordination, shipped in `cd290f4c`) introduced
`solene_agent_claims` + the pre-commit hook to prevent exactly this
collision. **But K2 only protects the autonomous-dispatch path** —
the worker process consuming `solene_dispatch_queue` rows. The
interactive Agent-tool path (Solene dispatching sibling agents
from a Claude Code session, sharing one working tree) has no
equivalent registry.

Hand-enforcement via prompt-level DO-NOT-TOUCH lists is what we
had on this wave. It works most of the time but fails when stage-
and-commit timing overlaps within a few seconds across siblings.

The structural fix is tracked as an L1.5 candidate in
`docs/internal/failure-modes/0003-agent-add-sweep-collision.md`
(the "Structural gap surfaced by these manifestations" section).
Solene will propose it in the next planning review.

## Tests + tsc state at end of wave 1

- `npm run check` — exit 0
- `vitest run` of the four capability test suites — all green
  - `codeReviewQueue.test.ts`: 13/13
  - `agentIdentity.test.ts`: full file pass
  - `failureModeLibrary.test.ts`: full file pass
  - `dispatchRunner.test.ts`: extended file pass
  - `modelUpgradePath.test.ts`: 24/24
  - `anthropicWatch.test.ts`: 14/14 (preserved)
  - `constitutionalGuard.test.ts`: full file pass
- `git status` — clean
- Branch is now 123 commits ahead of `origin/main`. Not pushed.
