# Solene Failure-Mode Library

A structurally consulted ledger of every past failure pattern. Each entry
captures a concrete way a dispatched agent (or a human pairing with one) has
gotten work wrong in this codebase, and what to do instead. The
dispatch system injects the most-relevant entries into every dispatched
agent's system prompt *before* it starts work, so the same failure mode
doesn't re-ship.

## How it's used

- `server/services/solene/failureModeLibrary.ts` reads every `.md` file in
  this directory (excluding this README), parses the YAML frontmatter +
  markdown body, and caches the result in-process for 60s.
- `server/services/solene/dispatchRunner.ts`'s `buildSystemPrompt` calls
  `loadFailureModePreambleFor(role, plannedFiles?)` and prepends the
  rendered preamble between the active-claims block and the role brief.
- The same data is mirrored into the `solene_failure_modes` Postgres table
  by `seedFailureModesFromDisk()` so analytics / founder UIs can query it.
- The disk files are the **source of truth**. The DB is a query mirror.

## How to add an entry

1. Create a new file `NNNN-kebab-case-slug.md` in this directory. Number
   sequentially so chronology is grep-able.
2. The frontmatter must be:
   ```yaml
   ---
   slug: kebab-case-slug          # must match the filename stem
   title: One-line human title
   severity: low | medium | high | critical
   category: credential_handling | dispatch_collision | scope_drift | regression_class | ux_regression | other
   trigger_patterns:
     - "regex- or substring-friendly pattern"
   prevention: |
     One-or-two-sentence prevention rule.
   example_incident_refs:
     - feedback_*.md filename, git SHA, or memory-file ref
   ---
   ```
3. The markdown body below the frontmatter is the human-readable narrative
   — what went wrong, how it was discovered, what changed.
4. Severity rules:
   - `critical` — has caused founder-trust damage (credentials leaked,
     work destroyed, regression shipped to prod) at least once.
   - `high` — has caused a wasted-dispatch-cost incident or a near miss on
     the above.
   - `medium` / `low` — documented for awareness but no concrete incident
     yet, OR caught before any real damage.

## Why disk and not DB-only?

Because the source-of-truth needs to be diffable + commit-traceable. When
a new failure mode is added, that's a code-review-able change — it shows
up in `git log`, gets a SHA, and survives database resets. The DB mirror
exists for query performance + future surfaces (e.g. founder UI listing
all entries by category), but if it ever drifts from disk, disk wins.
