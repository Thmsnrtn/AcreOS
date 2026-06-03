# Iris — role evolution log

_Append-only ledger. Newest at the top._

## 2026-06-02 — Baseline tranche 1 development shipped

Iris's role evolved from "ships work when dispatched" to "ships work
with continuous-monitoring infrastructure backing the discipline." The
foundational pieces:

- **Continuous p95 baseline** — `server/services/iris/perfMonitor.ts`
  + 30-minute sampler + regression detector (commit `64cd00f3`). Iris
  now sees latency regressions in code, not in user complaints.
- **ADR framework** — `docs/adr/README.md` + `docs/adr/_template.md`
  seeded. ADR-0001 back-filled (polymorphic `note_table` discriminator
  on `periodic_statement_skips`). Going forward, every constraining
  decision gets an ADR with reasoning at decision-time.

What this *does not* yet close (queued for tranche 2): tech-debt
ledger, sub-agent code-review framework, deploy-readiness checklist.
