# Pillar U — Pillar review automation

**Goal:** the system shouldn't accumulate dead pillars. Once a quarter,
an agent walks every `docs/exhaustive-completion/pillar-*.md` file,
scores the pillar on whether the shipped surface area is actually
being used, and queues the dead ones for archival.

This is the quarterly upkeep that prevents the codebase from rotting.
Today it's manual ("Thomas, when was the last time you used
`/founder/letter`?"); tomorrow it's a cron.

---

## What ships in this PR

1. **`scripts/pillar-review.ts`** — node script that:
   - Reads every `docs/exhaustive-completion/pillar-*.md`.
   - For each, extracts shipped artifacts (file paths mentioned in the
     "Shipped:" section).
   - Cross-references against:
     - Last-modified date of each artifact file
     - Last reference in git log
     - For routes, last hit time in audit_events / agentEvents
   - Scores each pillar on (a) usage activity, (b) recency of edits,
     (c) was-it-ever-shipped-in-prod (deploy log presence).
   - Outputs a structured report to
     `docs/exhaustive-completion/pillar-review-{YYYY-MM-DD}.md`.

2. **Doc-consolidation script** — `scripts/consolidate-docs.ts` —
   reads `docs/exhaustive-completion/pillar-*.md` and produces
   a single `STATE.md` summary the next session can read in 30 seconds
   instead of the 25 individual docs.

3. **Founder inbox surface** — when the cron runs, it writes a
   `medium`-urgency inbox item to `/founder/now` summarizing the
   pillars that scored "stale" (no usage, no edits, no deploy).

4. **Monthly cron registration** — runs the first Sunday of every
   month at 8am UTC.

The agent never auto-deletes. It surfaces "consider archiving Pillar X"
in the inbox; founder approves or rejects.

---

## Queued

- **MEMORY.md audit cron** — same shape, applied to your auto-memory.
  Quarterly prune of stale memories. Lower priority because memory
  doesn't degrade the codebase, just the LLM's context.

- **Pillar-success scoring telemetry** — today the score is rough
  (file activity, route hits). A future pass could measure customer
  outcomes per pillar (did revenue grow? did Pax response quality go
  up after Pillar F shipped?) for a more rigorous "is this pillar
  paying off" signal.

- **Auto-archival** — once scoring is rigorous, advance from "surface
  to founder" to "auto-archive with founder veto window" similar to
  the Pillar R graduation pattern.
