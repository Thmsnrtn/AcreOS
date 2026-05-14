# Pillar Q — Self-healing autonomy

The existing codebase-monitor (`server/services/codebaseMonitor.ts`)
scans two signal sources today:

1. **npm outdated** — proposes dependency bumps.
2. **`tsc --noEmit` errors** — proposes file-level cleanup when ≥5
   errors cluster.

Pillar Q wires the bug-class detectors built in Pillar I into the
same flow so the agent proactively shrinks the legacy bug baseline
without operator-by-hand fixes.

---

## What's shipped

### A. Schema-column-baseline scanner

Pillar I shipped a 230-violation baseline. Pillar Q wires a third
scanner into the codebase monitor that reads that baseline and
proposes file-level fix bundles for the agent-queue.

- New `CodebaseMonitorOptions.scanSchemaColumns` flag (default
  `true`).
- New `proposeSchemaColumnFixes()` — groups violations by file,
  caps at 3 proposals per run (smallest files first), and writes
  each as a draft `agent_code_proposal` for the founder to review.
- Inherits the existing simulation-mode gating from
  `requiresSimulation("codebase_monitor", "schema_column_fix")`.

Result: the daily codebase-monitor cron now shrinks the 230-violation
baseline over time without requiring the founder to hand-fix each
one. Once the baseline drops to 0, future violations are caught
on PR by the schema-validation CI gate.

---

## Action queue (follow-ups)

1. **Bug-class detectors** — formalize the other audit passes from
   session 2026-05-14 into scanners that fit the same shape:
   - `useDocumentTitle`-in-formatter scanner (ESLint rule + codebase-
     monitor wrapper)
   - `queryKey` with object missing `queryFn` scanner
   - `.where(undefined)` with leftJoin scanner
   - `Object.entries(undefined)` risk scanner

2. **Auto-PR generation** — when a detector finds a high-confidence
   fix, draft a real PR (gh-CLI plumbing already exists per
   `routes-agent-prereqs.ts`).

3. **Regression test auto-gen** — for every closed bug PR, the
   codebase-monitor writes the Playwright assertion that proves it
   stays fixed.

4. **Anomaly pager** — page founder when fly logs match a
   known-bad pattern (the "Cannot convert undefined or null to
   object" family, NOT NULL violations, React error #310, etc.).
   Today the operator finds these by manually grepping fly logs.

5. **Decision-log RAG** — embed founder approve/reject decisions on
   prior PRs; retrieve at proposal-time so future proposals align
   with the operator's pattern. Reduces the founder's review load
   over time.

6. **Multi-week planner** — long-horizon planner that reads pillar
   progress and re-prioritizes the queue weekly. The `agent_pillar_
   weekly_digest` cron exists; this is the planning agent that
   reads from it.

7. **Simulation → live promotion gate** — every new agent capability
   spends ≥2 weeks in simulation and accumulates ≥20 simulated
   decisions before flipping live. Manual founder gate.
