# Team roster overview

The 12 members of AcreOS's operating team — phased activation, scope, and the elite-bar each holds in their domain.

Last refreshed: 2026-06-03.

---

## Activation timeline

| Phase | Trigger | Members activated | Cumulative |
|---|---|---|---|
| **Phase 0** | Tom says "go" (current) | Solene, Iris, Soren, Beatrice, Krieger | 5 |
| **Phase 1** | $200 MRR sustained 30 days | + Maren, Lena | 7 |
| **Phase 2** | $1k MRR sustained 30 days | + Rafe, Andrei | 9 |
| **Phase 3** | $5k MRR sustained 30 days | + Tess, Iyari, Quinn, Henrik (optional) | 12-13 |
| **Phase 4+** | Scale | Existing members deepen; team-shape evolves | 12-13 |

Henrik is the only optionally-activated member. Engagement is Tom's call.

---

## Org chart

```
                              Tom (CEO)
                                  │
                                  │
                            Solene (COO)
                       ┌────────────────────────────┐
                       │                            │
            Iris (CTO)            Soren (CGO)    Beatrice (CRO)
            │   │   │                                │
        Tess  Andrei  ...                         Quinn (Phase 3+, indep. escalation to Tom)
   Phase3+   Phase2+
                                                 
   Krieger    Maren     Lena       Rafe       Iyari      Henrik
   (Phase 0) (Phase 1) (Phase 1) (Phase 2)  (Phase 3)  (Phase 3, optional)
```

Quinn has independent-escalation authority bypassing Solene to Tom directly when constitutional drift warrants it. This is the only role with that bypass.

Henrik has no operational coordination — engagement is conversation-only with Tom, monthly cadence default.

---

## Scope at a glance

| Member | Domain | Most-used existing infra | Continuous-audit detector ledger |
|---|---|---|---|
| **Solene** | Team orchestration, founder-surface, capital, decisions | `solene_audit_findings`, `solene_capital_events`, `solene_decisions` | `solene_audit` (8 detectors), live |
| **Iris** | Architecture, engineering, deploys, performance | `iris_perf_samples`, `iris_perf_baseline` | `iris_perf_monitor` (regression detector), live |
| **Soren** | Brand, content, acquisition, SEO | `soren_seo_rankings`, `/learn` content set | `soren_seo_tracker` (daily SERP scrape), live |
| **Beatrice** | Compliance, legal, security, AI safety | `pax_audit_findings`, `beatrice_reg_events` | `pax_continuous_audit` (6 detectors), live |
| **Krieger** | Mobile UX, customer-surface parity | `tests/e2e-mobile/*` matrix | `krieger_audit_findings` (6 detectors), to-be-built |
| **Maren** | Product strategy, customer research, prioritization | n/a (Phase 1) | `maren_audit_findings` (6 detectors), to-be-built |
| **Lena** | Capital allocation, unit economics, runway | `solene_capital_events` (consumer + author) | `lena_audit_findings` (7 detectors), to-be-built |
| **Rafe** | Customer success, support, retention | n/a (Phase 2) | `rafe_audit_findings` (7 detectors), to-be-built |
| **Andrei** | Pax, prompts, model selection, embedding infra | `solene_embedded_records`, `solene_dispatch_results` | `andrei_audit_findings` (7 detectors), to-be-built |
| **Tess** | Reliability, observability, incident response | `iris_perf_samples` (consumer), Sentry | `tess_audit_findings` (8 detectors), to-be-built |
| **Iyari** | R&D, horizon scanning, prototype-grade experimentation | `external_watch_events` (consumer) | `iyari_audit_findings` (6 detectors), to-be-built |
| **Quinn** | Constitutional drift, alignment audit, ethics oversight | `solene_constitutional_violations`, `solene_decisions` (consumer) | `quinn_audit_findings` (8 detectors), to-be-built |
| **Henrik** | Founder thinking partner (optional engagement) | none — intentionally non-instrumented | none — intentionally non-instrumented |

---

## How each member operates

Every team member's brief (`team_<name>.md` in `/Users/user/.claude/projects/.../memory/`) contains:

1. **Role + identity & voice** — how they think + how they speak.
2. **Scope** — explicit ownership boundaries.
3. **Decision authority** — what they decide vs. what they escalate.
4. **Activation first task** — day-1 concrete action when they snap on.
5. **Ongoing operational tasks** — daily / weekly / monthly / quarterly rhythms.
6. **Hard rules** — including constitutional + operational guardrails.
7. **The elite bar** — domain-specific standard they enforce.
8. **Coordination protocol** — pairs with which other members on what.
9. **Continuous-monitoring infrastructure** — the detector ledger they own.
10. **Self-development arc** — tranche-by-tranche role deepening as the company grows.
11. **What this is NOT** — the explicit non-scope.
12. **When Tom invokes them** — the response pattern.

Each brief is between 150 and 350 lines. They're loaded at activation + on every Tom-invocation.

---

## The Solene-as-right-hand pattern

Tom talks to Solene by default. The rest of the team operates through Solene's coordination:

- **Detectors fire** (Iris's perf samples, Beatrice's Pax audit, Soren's SEO tracker, Krieger's mobile-feel gate, etc.).
- **Detectors enqueue dispatches** into `solene_dispatch_queue` (the L1.1 + Phase A α wiring shipped 2026-06-03).
- **Workers drain the queue** and produce code, content, audits, decisions.
- **The L2.8 code-reviewer auto-reviews** every code-producing dispatch.
- **The L6.28 pre-call + L6.29 tool-call constitutional guards** prevent constitutional violations at both upstream and downstream layers.
- **The L3.13 self-debugger** loops flagged work back to the original agent for introspection + fix.
- **The L3.10 + L3.14 learning loop + cross-namespace memory retrieval** inject relevant historical context into every dispatch's system prompt.
- **The L1.4 persistent agent identity + L4.19 time-aware decisions** mean each member remembers what they decided last Tuesday and revisits at the right horizon.
- **Solene synthesizes** the daily activity into the 7am ET morning one-line + the Sunday weekly digest.
- **Tom reads the digest** and intervenes only when something is constitution-locked / strategic-founder-only.

Tom's role compresses to **vision setting + strategic founder-gated decisions + final approval on constitutional changes**. The team operates the company.

---

## Activation playbook (when a phase trigger fires)

When MRR crosses a phase threshold and sustains 30 days, Solene:

1. **Verifies the threshold** (revenue ledger reconciled with bank).
2. **Re-reads each newly-activating member's brief** to load their full operating context.
3. **Dispatches each new member's "activation first task"** via the live `solene_dispatch_queue` — that's their day-1 concrete action from the brief.
4. **Updates the morning one-line format** to include the new member's pulse signal (e.g., when Lena activates, runway-months joins the one-line).
5. **Adds the new member's continuous-audit-detector wire-in to `runScheduledJobs.ts`** in a single follow-up commit.
6. **Notifies Tom** via the daily pulse: *"Phase N triggered: <member> activated; activation task in flight as dispatch #X."*

The activation is automated. Tom can override (delay a member, skip Henrik, etc.) but the default is automatic snap-on at threshold.

---

## Cross-member coordination patterns

Some recurring multi-member coordination patterns:

**New feature lifecycle:**
- Maren proposes hypothesis + customer-research justification.
- Lena models unit-economics impact.
- Beatrice gates compliance pre-clearance.
- Iris evaluates build cost + dispatches implementation.
- Andrei advises on Pax-touching aspects (if any).
- Krieger gates mobile-feel acceptance.
- Tess gates production-readiness.
- Rafe owns customer-rollout communication.
- Quinn watches the post-ship behavior for drift.

**Incident response:**
- Tess detects + declares severity.
- Beatrice gates customer-data-affecting decisions + breach-notification timeline.
- Rafe owns customer communication tone.
- Iris coordinates the technical mitigation.
- Solene synthesizes for Tom.
- Quinn audits the post-mortem for constitutional alignment.

**Annual rhythm:**
- Quinn coordinates the external-firm ethics audit.
- Lena closes the books + signs off on the year.
- Iyari refreshes the 10-year vision.
- Maren proposes the next-year OKR set.
- Solene runs the constitutional-review session with Tom + Beatrice.
- Tom signs the next-year direction.

---

## Self-improvement, by design

Per [[feedback_team_development_arc]] and [[feedback_continuous_improvement_cadence]]:

- Each member's brief contains a **self-development arc** (tranches by phase) — the role deepens as AcreOS grows.
- Each member has a **continuous-audit detector ledger** that auto-fires findings — they don't drift silently.
- Each member's findings flow into Solene's **monthly rotating team-member review** and the team-system-audit infrastructure (the [[feedback_implicit_trust_and_overarching_perspective]] dimensions).
- Each member can have their prompts evolved via the prompt-evolution meta-agent (live for some members today, scaling across all members at Phase 2+).

The team isn't static. It grows with the company. The structure here is the floor.

---

## Related memory

[[team-solene-chief-of-staff]] [[team-iris-cto]] [[team-soren-cgo]] [[team-beatrice-cro]] [[team-krieger-mobile-ux]] [[team-maren-cpo]] [[team-lena-cfo-cio]] [[team-rafe-cco]] [[team-andrei-ai-ml-engineer]] [[team-tess-reliability]] [[team-iyari-chief-of-future]] [[team-quinn-chief-of-alignment]] [[team-henrik-founder-coach]] [[acreos-constitution]] [[acreos-company-charter]] [[feedback-coo-authority]] [[feedback-team-development-arc]] [[feedback-elite-multi-dimensional]] [[feedback-continuous-improvement-cadence]] [[feedback-implicit-trust-and-overarching-perspective]]
