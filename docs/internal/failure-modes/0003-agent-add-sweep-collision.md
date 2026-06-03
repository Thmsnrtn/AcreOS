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
