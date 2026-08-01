# Calibration Log — Cascade Filter & Autonomy Level Analysis

This file is maintained by the monthly calibration routine. It records each
run's data-volume gate result and, once customers are active, the full
cascade and autonomy analysis.

---

## 2026-08-01

**Status:** No snapshot file present. Last customer-usage signal: none in 30d. Sleeping until next month.

**Gate details:**
- `data/calibration-snapshot*.json`: not found
- `data/usage-snapshot*.json`: not found
- Customer/signup signals in git log (last 30d): none
  - `production-ready` and `Production-gate` appear in 60d window, but these
    refer to the platform being production-capable, not to live paying customers
- founderTodo.ts + cascade code paths: active (Wave A `45b95bc`, Wave B `86e46f5`
  confirm observability layer was built ~60d ago)
- Development velocity: 50 commits in last 30 days (healthy pre-launch cadence)

**Decision rule applied:** No snapshot file AND no customer/signup/live signals in 30d → INSUFFICIENT DATA → log and sleep.

**Next action:** Routine will re-run next month. Once the founder commits a
`data/calibration-snapshot.json` with real cascade-annotation and agent-attempt
counts, the routine will run the full analysis automatically.

**Note for founder:** The observability layer is live (Wave A + B shipped). The
platform just needs real customers using it before this analysis is meaningful.
This routine costs almost nothing while there are no users — it gates itself
and exits in under 2 minutes. Once it runs the full analysis (Step 2b) one
successful time, disable it.
