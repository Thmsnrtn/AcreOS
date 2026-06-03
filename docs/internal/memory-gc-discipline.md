# Memory GC discipline

The memory dir at `/Users/user/.claude/projects/.../memory/` is append-only by
default — we never auto-delete a memory because past mistakes are visible in
git history but past memories that have been silently removed are not.

## Cadence
- `scripts/memory-gc.mjs scan` runs weekly (Sunday 04:00 UTC, after the
  weekly retro generation). Report lands at
  `docs/internal/memory-gc-report-<YYYY-MM-DD>.md`.
- Solene reviews each section during her end-of-week digest pass.

## Categories + actions

### Potentially stale (dated)
A memory's description contains a date >30 days ago. Likely state has
changed.
**Action**: Solene re-reads the memory + the current code/state. If stale,
either UPDATE the memory with current state + new date, or RETIRE (move
to `memory/_retired/<slug>.md` with a stamp explaining why).

### Likely stale (temporal language)
A memory contains words like "today", "in flight", "this week" that almost
always go stale within days.
**Action**: Same as above. Stronger bias toward retiring.

### Duplicate candidates
Two memories with high Jaccard overlap in their descriptions.
**Action**: MERGE — pick the canonical name, fold contents, update
references via `[[old-name]] → [[new-name]]` find/replace. Add the old
name as an alias note in the new memory body.

### Contradiction candidates
Two memories whose descriptions contain antonyms in similar context.
**Action**: READ BOTH. Resolve which is current truth. UPDATE one to
match the other OR retire the obsolete one.

### Orphaned references
A `[[some-name]]` link in a body has no corresponding `name: some-name`
in any memory file.
**Action**: Either CREATE the linked memory (the link was a TODO marker)
or FIX the link to point at the right slug.

### MEMORY.md hygiene
- Dead index entry: line in MEMORY.md points at a file that doesn't
  exist. Remove the line.
- Unindexed memory: file exists but isn't in MEMORY.md. Add a one-line
  pointer.

## Auto-pruning posture
We do NOT auto-prune. The scan surfaces; Solene decides.

The exception is the future `--apply` mode, which performs RETIRE moves
(file → `_retired/` subfolder, never delete) — and only with explicit
flag. Even then, every retire is logged in `_retired/RETIREMENT_LEDGER.md`
with date + reason + diff snapshot.
