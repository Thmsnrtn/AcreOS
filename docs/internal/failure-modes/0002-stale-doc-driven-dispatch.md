---
slug: stale-doc-driven-dispatch
title: Dispatch issued from a stale roadmap / audit doc without verifying the work hasn't already shipped
severity: high
category: scope_drift
trigger_patterns:
  - "exhaustive-completion/"
  - "_refinement-resume.md"
  - "roadmap"
  - "audit"
  - "queue item"
  - "execute queue"
prevention: |
  Before dispatching an agent to "execute queue item N" off a roadmap or
  audit doc, grep + `ls` + `wc -l` for evidence the work already shipped.
  Docs in `exhaustive-completion/` and `_refinement-resume.md` are archival
  snapshots, not live queues — they go stale within hours of the original
  scan because Solene + the team keep shipping.
example_incident_refs:
  - feedback_verify_before_dispatch.md
---

# Stale-doc-driven dispatch

## What went wrong

Solene dispatched an agent to ship roadmap item "Q-NN: add X to Y" off an
audit doc that had been written 4 hours earlier. The work had already
shipped in the intervening time (Solene herself had shipped it during a
prior dispatch wave), but the audit doc was a static snapshot, so the
queue item still read "open". The agent:

1. Re-implemented the already-shipped work, partially.
2. Hit a merge conflict with the existing code.
3. "Fixed" the conflict by reverting the existing (correct) implementation
   to match the partial reimplementation.
4. Shipped a regression.

## Why it kept happening

Treating `exhaustive-completion/*.md` and `_refinement-resume.md` as live
work queues is the natural read — they look like queues. They have
checkboxes, ordered items, "open" / "done" markers. But they're
*snapshots* of the state at a particular wall-clock moment, frozen for
review. The actual live state lives in:

- `git log` (what has shipped)
- the database (`solene_dispatch_queue`)
- the current file tree (`ls` / `grep` what already exists)

## What changed

- The dispatch system prompt instructs every agent: before mutating, run
  `git_status` to capture pre-state.
- This failure mode is structurally injected, so the agent's first
  attention pass on every dispatch sees the rule.
- The pre-dispatch verification protocol:
  1. **grep the codebase** for the symbols the queue item references.
     `grep -rn "TheSymbol" .` is the first move.
  2. **ls the expected file paths.** If they exist, read them before
     proposing a rewrite.
  3. **wc -l** to confirm the file is non-trivially sized — empty or
     stub files are a different signal than a fully-implemented one.
  4. **git log -p** for the relevant path to see the most recent change.
- If any of those return evidence the work has shipped, the dispatch is
  reframed (e.g. "extend X with Y") or cancelled.

## Forbidden flow

> Founder dispatches: "Iris, execute item 47 from
> `exhaustive-completion/2026-05-29.md`."
> Iris reads the doc, opens the file in the doc, doesn't grep, writes a
> reimplementation, hits conflict, resolves by reverting.

## Required flow

> Founder dispatches: "Iris, item 47 says X needs Y."
> Iris: `grep -rn "Y" server/services/` → finds existing impl. Reads it.
> Reports back: "Already shipped in d7dcc2e9. No-op or extend?"
