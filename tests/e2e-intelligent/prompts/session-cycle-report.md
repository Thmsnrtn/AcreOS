# AcreOS E2E — Cycle Report Session

**Cycle:** {{CYCLE_ID}} (e.g., cycle-1)

## Your Role

You are aggregating findings from all completed persona-journey runs in this cycle into a single report.

## Steps

1. Read all transcript and findings files in `tests/e2e-intelligent/runs/` that belong to this cycle
2. Read `tests/e2e-intelligent/evaluators/aggregator-rubric.md` for severity rules
3. Read `tests/e2e-intelligent/FINDINGS-FORMAT.md` for the findings schema

4. Produce `tests/e2e-intelligent/reports/{{CYCLE_ID}}-report.md`:

   - Summary table: persona × journey × outcome × satisfaction
   - Top findings across all runs (deduplicated by root cause)
   - Patterns: issues hit by 3+ personas
   - Per-persona sentiment overview
   - Per-journey completion rates
   - AI output credibility distribution (how many CREDIBLE / QUESTIONABLE / NOT_CREDIBLE)
   - Critical issues that would block launch

5. Produce `tests/e2e-intelligent/reports/{{CYCLE_ID}}-founder-letter.md`:

   One-page letter to the founder summarizing:
   - How many personas completed their journeys satisfied
   - The 5 most impactful findings across all runs
   - Whether the product is ready for the intended launch audience
   - What to fix before launch vs what can wait

6. Update `tests/e2e-intelligent/reports/findings-registry.md`:

   Persistent deduplicated registry. Each finding:
   - ID (FIND-NNN)
   - Title, severity, category
   - Which runs surfaced it
   - Status: OPEN | FIXED | WONTFIX

7. Commit all reports.
