# Turn-19 Closing Audit — Charter

**Status:** PREPARED 2026-08-31, not yet fired. Fires only after turns 12–13
resolve (flip on durable shadow evidence maturing ~2026-09-07, or an explicit
refusal recorded with the divergence data). The audit closes the stage-4
consolidation program; it does not run inside it.

**How to fire:**
`Workflow({ scriptPath: "docs/autonomous/workflows/stage4-turn19-audit.workflow.js" })`.
The committed copy under `docs/autonomous/workflows/` is the durable source of
truth (`.claude/` is gitignored and dies with the container; a copy may also
sit at `.claude/workflows/stage4-turn19-audit.js` for name-based firing within
a live session, but never rely on it surviving).

## Mandate

Wave discipline (CLAUDE.md): *never trust a wave's self-report.* Stage 4 was
executed and self-annotated by the same institution now holding the pen, so
its DONE annotations are hypotheses, not facts. The closing audit is an
independent completeness pass in which no auditing agent authored the work it
judges, per the amendment's rule that the implementation author is never the
sole judge of quality.

## Population

1. Every DONE turn annotation and decision record (A–G) in
   `docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md`, decomposed into discrete
   checkable claims — one auditor per turn, adversarial stance.
2. Three cross-cuts no per-turn auditor owns:
   - **Evidence integrity** — the trust-seam durable shadow mechanism itself
     (persistence mutation-killable, aggregation cannot double-count,
     flip consumed durable evidence or seamVerdict carries no authority yet).
   - **Count coherence** — every ratchet baseline stage 4 claims to have
     lowered matches the current measured count; the OD-8 ledger block still
     enumerates exactly the dropped tables; nothing re-added a model for the
     23 absent tables.
   - **Record truthfulness** — the founder-facing story docs contain no
     stale or code-contradicted sentence (the record propagates across
     compactions; a false line there compounds).

## Verdicts and closure rule

Per claim: **HOLDS** / **RESIDUE** (true but with unwired, stale-pinned, or
source-shape-only residue) / **FALSE**. The program does not close while any
FALSE finding stands unrepaired; RESIDUE findings are either repaired in the
audit cycle or recorded as owned follow-ups with a named trigger. The
synthesis ends with a plain-language closure statement for the founder.

## Method constraints (binding on every auditor)

- Verify against code and executed gates, never against reports.
- Deleted routes: grep the **URL path string**, not just symbols (turn-14's
  Delegation-tab miss is the precedent).
- "Pinned" claims: read the test; a source-shape pin over a behavioral claim
  is RESIDUE. Prefer demonstrating the pin fails under mutation.
- Hunt built-but-unwired first — it is this codebase's signature defect.
- Vacuity check every extraction: a parser matching nothing reads exactly
  like a clean population.

## After closure

Closure triggers the automatic transition into the Production Experience &
Quality Program (master-directive amendment 2026-08-30) — no further founder
instruction required. The E-1/E-2 remediation maps in
`DECISION_OVERLOAD_RECON.md` and `IOS_SAFARI_PERF_RECON.md` are the opening
queue.
