# Cascade + Autonomy Calibration Log

Monthly gate check for the two observation-only systems described in
`_AUTONOMOUS-RUN-SUMMARY.md` (scheduled review 2026-05-15) and
`JUDGMENT-CALL-RECOMMENDATIONS.md` items #3 (cascade filter) and #14 (autonomy matrix).

Each entry is append-only. The analysis runs in full only when a snapshot
file exists at `data/calibration-snapshot-YYYY-MM-DD.json` with sufficient
counts (cascade annotations ≥ 50, distinct annotation days ≥ 7, agent
attempts ≥ 30). Once a full analysis runs successfully, this job has done
its work and should be disabled — or kept as a quarterly re-check if usage
patterns shift significantly.

---

## 2026-06-01

**Status:** No snapshot file present. Analysis cannot run.

**Last customer-usage signal:** Active in last 30 days — commits reference
UTM capture at signup (`feat(analytics): UTM capture at signup →
users.acquisitionUtm`), named users Hank and Joanna in feature commits,
and `/founder/customers` viewer scaffolded. Customer activity is plausible
but unconfirmed from a telemetry-count perspective.

**Cascade observability:** Shipped ~2026-04-30 (`d801660` per
`_AUTONOMOUS-RUN-SUMMARY.md` Wave 2). Observability layer has been live
~32 days, enough for meaningful data IF real usage occurred — but without
a snapshot we cannot verify the `cascadeAnnotations`, `distinctAnnotationDays`,
or `agent_llm_traces` counts that gate the calibration.

**founderTodo.ts observability:** Confirmed active (cascade-aware annotations
shipped; non-destructive, no items filtered). The cutover to active filtering
remains paused pending calibration.

**Decision:** STEP 2a — sleeping until next month.

**Blocking gap:** No mechanism exists to export a calibration snapshot.
To enable next month's run, add a one-time export endpoint or script:

```ts
// Suggested: server/scripts/export-calibration-snapshot.ts
// Queries system_activity, founder_todo_items, agent_llm_traces
// and writes data/calibration-snapshot-YYYY-MM-DD.json with:
//   { cascadeAnnotations, distinctAnnotationDays, agentAttemptsByAgent }
// Run manually or via a cron job before each monthly check.
```

Without this, the monthly check will keep writing "no snapshot" entries
indefinitely even if real usage data exists in the DB.

**Next check:** 2026-07-01 (or whenever a snapshot file is committed).
