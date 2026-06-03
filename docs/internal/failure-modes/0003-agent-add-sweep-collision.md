---
slug: agent-add-sweep-collision
title: Agent A's `git add` sweep pulled agent B's untracked files into A's commit
severity: critical
category: dispatch_collision
trigger_patterns:
  - "git add -A"
  - "git add ."
  - "git add --all"
  - "git commit -am"
  - "untracked"
prevention: |
  Stage files by exact name, never `git add -A` / `git add .` / `git
  commit -am`. Read the active claims list before staging — if another
  agent has claimed a surface that intersects yours, coordinate before
  committing.
example_incident_refs:
  - shared/schema/solene-agent-claims.ts:13
  - aff4c273
  - 5fb4def0
  - dcafcec0
  - dfed80f4
---

# Agent-add-sweep collision (Krieger sweeping Soren)

## What went wrong

On 2026-06-02 (commit `aff4c273`), Krieger and Soren were dispatched in
parallel. Soren's dispatch was mid-way through writing several untracked
files to its claimed surface (`client/src/pages/landing/*`). Krieger's
dispatch reached its commit step first and ran `git add -A`, which swept
in **all** untracked files in the working tree — including Soren's
half-written drafts that were not yet ready to ship.

Krieger then committed those files as part of Krieger's commit, with
Krieger's commit message. Soren's dispatch finished, tried to commit its
own work, and found nothing to commit — its files were already in
Krieger's commit, under Krieger's authorship, with Krieger's message.

## Why it kept happening

`git add -A` and `git commit -am` are the natural, ergonomic incantations.
Every solo-engineer's muscle memory reaches for them. But in a
multi-agent context where parallel dispatches share the same working
tree, they're hand grenades — a single agent's sweep can destroy another
agent's in-flight work + attribution + commit message.

## What changed

- **Layer 1 capability #2 — agent claims** (commit `33639996`, shipped
  `shared/schema/solene-agent-claims.ts` + `agentClaims.ts`). Every
  dispatched agent registers its file-surface claim BEFORE work begins.
- **Pre-commit hook** reads active claims; staging files outside your
  claim → block + escalate.
- **Dispatch system prompt** injects the active-claims block: "DO NOT
  TOUCH files matching these patterns".
- **This failure-mode entry** is now in every dispatch's system prompt
  before the role brief, so the incident itself is structural context.

## Forbidden flow

```sh
git add -A
git commit -m "shipped feature X"
```

## Required flow

```sh
# Stage by exact path. Globs OK if they match your claim only.
git add server/services/iris/perfBudgets.ts
git add server/services/iris/perfBudgets.test.ts

# Or use the dispatch-tool wrapper, which calls isFileUnderClaim() on
# every staged path before letting the add through.
git_add server/services/iris/perfBudgets.ts

git commit -m "iris: ship perf budgets"
```

## How an agent verifies safety before committing

1. `git status` — list every file you're about to stage. Read it.
2. Compare against your claim's `file_surface_patterns`. Any path outside
   your patterns is a stop-and-coordinate moment.
3. Stage by exact name. Never `-A`, never `.`, never `-am`.

## Real-world manifestations after this entry was seeded

This failure mode was seeded into the library on 2026-06-03 in the same
wave it manifested. Three sibling agents shipping in parallel
(L1.4+L3.12, L2.8, L4.18, L6.29) cross-wired commit messages with file
contents because the **interactive Agent-tool dispatch path does not
yet enforce K2 agent_claims**. Hand-enforcement via prompt-level
DO-NOT-TOUCH lists is not sufficient when sibling agents `git add`
roughly simultaneously.

The scrambled map for that wave:

| Commit SHA  | Message says     | Actually contains                                    |
|-------------|------------------|------------------------------------------------------|
| `5fb4def0`  | L2.8             | L2.8 (correct) **plus** L4.18 migrate.mjs row swept in |
| `dfed80f4`  | L6.29            | **L4.18** (modelUpgradePath + anthropicWatch hook + schema) |
| `dcafcec0`  | L4.18            | **L1.4 + L3.12** (agentIdentity + failureModeLibrary + dispatchRunner + this file's siblings) |
| `17f0bfd4`  | L6.29 (cont)     | L6.29 (correct — recovery commit after Sibling D detected the swept-out state) |

All code landed cleanly to disk. All tests pass. Only commit-message-to-
content mapping is scrambled. Cosmetic; no rewrite-history performed
(amends/reverts would risk losing work for a non-functional issue).

## Structural gap surfaced by these manifestations [RESOLVED 2026-06-03]

**K2 agent_claims (`shared/schema/solene-agent-claims.ts` + the
pre-commit hook in `.githooks/pre-commit`) only protects the
autonomous-dispatch path** — the worker loop that consumes
`solene_dispatch_queue` rows and runs `dispatchRunner.ts`.

**It does NOT protect the interactive Agent-tool dispatch path** —
i.e., when Solene is in a Claude Code session and dispatches sibling
agents via the `Agent` tool. Those agents run in parallel sub-sessions
of the same Claude Code conversation, share the same working tree,
and have no shared registry. Hand-enforcement via prompt-level
DO-NOT-TOUCH lists works *probabilistically* but breaks when stage-
and-commit timing overlaps within a few seconds.

The fix is a **Solene-side dispatch-claims primitive** for the
interactive path. Options:

1. **Filesystem-level lock per agent** — `.solene-locks/<agent-id>.lock`
   files describing the file-surface globs the agent has claimed. A
   wrapper `git-add` script (or pre-commit hook extension) reads all
   locks and blocks any `git add` whose paths intersect another
   agent's lock. Locks expire by TTL.
2. **Shared SQLite or text-file claims register** in
   `.solene/claims.jsonl`, scanned by the pre-commit hook. Same
   semantics as K2 but without requiring the live Postgres DB.
3. **Sequential dispatch** for surfaces with overlap risk — accept
   slower throughput in exchange for clean attribution. Already
   workable today; just requires Solene to not parallel-dispatch
   when surfaces are adjacent.

This is a candidate L1.5 capability to add to
`feedback_agentic_evolution_north_star.md`. Tracked separately from
the 32 capabilities currently enumerated.

## Resolved (L1.5 shipped 2026-06-03)

The filesystem-lock primitive landed in the wave-1 expansion:

- `scripts/check-interactive-claims.mjs` — pre-commit guard. Walks
  staged files, matches them against active `.solene-locks/*.json`,
  blocks on cross-agent overlap. Self-agent overlap allowed via
  `SOLENE_AGENT_ID` env var. Expired locks (now > claimedAt +
  ttlMinutes) are ignored automatically.
- `scripts/solene-lock.mjs` — CLI for claim / release / list / sweep.
- `.githooks/pre-commit` step 4 — invokes the new guard in addition to
  K2 (step 3). Both fire; both must pass.
- `.solene-locks/` — gitignored lock directory in repo root.
- Bypass env: `SOLENE_BYPASS_INTERACTIVE_CLAIMS=1` (mirrors K2).

### How to use it (per-dispatch)

When Solene dispatches a sibling agent from a Claude Code session, the
agent (or Solene on its behalf) runs:

```sh
node scripts/solene-lock.mjs claim \
  --agent-id "iris-2026-06-03-perfbudgets" \
  --role iris \
  --patterns "server/services/iris/perfBudgets.ts,server/services/iris/perfBudgets.test.ts" \
  --ttl-min 30 \
  --note "Iris perf-budgets feature"
```

The agent then exports `SOLENE_AGENT_ID=iris-2026-06-03-perfbudgets` for
its session so its own commits aren't blocked.

When the work commits cleanly:

```sh
node scripts/solene-lock.mjs release --agent-id "iris-2026-06-03-perfbudgets"
```

Solene can audit at any time:

```sh
node scripts/solene-lock.mjs list
node scripts/solene-lock.mjs sweep   # drop expired locks
```

### Why filesystem (and not DB)

K2 `solene_agent_claims` already exists and works for the autonomous
dispatch path — but it requires a live Postgres. The interactive
Agent-tool path runs in the local sandbox where the dev DB is often
down. The filesystem-lock primitive has identical semantics
(agentId / patterns / ttl / role / note) and zero infrastructure
dependencies, so it works in any environment. The two checks fire
side-by-side in the pre-commit hook — belt-and-suspenders.
