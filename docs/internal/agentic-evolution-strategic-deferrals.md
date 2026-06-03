# Agentic-evolution strategic deferrals

This document records three Layer-5 capabilities from
`feedback_agentic_evolution_north_star.md` that **should not be built
now** — not for scope reasons but for strategic ones. They're recorded
here so future sessions don't repeatedly re-decide whether to dispatch
them.

Last reviewed: 2026-06-03.

---

## L5.22 — Knowledge graph of company state

**What it is.** Entities (customers, deals, properties, agents, decisions,
commits, audit findings) made explicit and queryable. Replaces ad-hoc
`grep` with structured graph queries. Edges: who decided what, what
shipped, what customer paid for what, what commit closed what audit
finding, what deal led to what dispute.

**Why defer.** Three reasons:

1. **Time to value is long.** A useful knowledge graph requires
   ingestion across ~8 entity types (customers, deals, properties,
   agents, decisions, commits, audit findings, capital events) +
   schema + retrieval + a query language + a founder UI to actually
   use it. Realistic build: 3–4 weeks of focused work. The 32-capability
   architecture doesn't bottleneck on it until Layer 5 maturity, which
   isn't load-bearing for the team's day-to-day operation today.

2. **Premature integration risk.** A knowledge graph that's wrong in
   subtle ways (e.g., entity merges that collapse two customers into
   one) creates downstream errors that are very hard to detect. Until
   we have meaningful customer + deal volume to validate against, the
   graph would be exercising the structure with too little data to
   surface those errors.

3. **Cheaper alternatives exist today.** For "what shipped this
   week" — `git log` works. For "what's the current state of customer
   X" — direct DB queries via Drizzle work. For "which audit findings
   are still open" — the existing audit-findings table + a query
   surface works. The marginal value of a knowledge graph over these
   is real but not load-bearing.

**When to revisit.** When we hit one of:
- 100+ paying customers (graph queries become faster than direct DB
  queries for cross-entity questions)
- A reproducible class of bug where the team would have caught it
  earlier with structured cross-entity inspection
- The founder review surface starts having "I want to ask N
  questions but can't formulate the query" friction

---

## L5.25 — Cross-session continuity

**What it is.** Solene's mental model persists across Claude sessions —
not just the memory files, but the full state snapshot (in-flight
work, current priorities, pending decisions).

**Why defer.** This **overlaps substantially with L1.4 (persistent
agent identity)** which already shipped on 2026-06-03. L1.4 persists
each agent's decisions across sessions; Solene's own decisions are
persisted via the team-state map (auto-regenerated every 15m) +
weekly retro skeleton + monthly review skeleton + the memory dir
itself.

**The remaining gap** is "Solene's working-memory state at the
moment a session ends" — the half-formed thought, the queue of
agents in flight, the open question being weighed. Today these
get reconstructed at session-start from git log + the team-state
map + memory + agent-claims state. Reconstruction is ~30 seconds
of context-loading per session. That's acceptable.

**A genuine L5.25 capability** would add:
- A `solene_session_state` snapshot table — explicit dump of
  Solene's working memory at session-end
- An auto-load step at session-start that hydrates the working
  memory before responding to the first prompt
- A "session continuation" UX where the new session opens with
  "previously, I was working on X and about to do Y"

**When to revisit.** When session-start context reconstruction
takes longer than 2 minutes consistently, OR when something
load-bearing has been lost on session boundary that the existing
infrastructure didn't preserve. Neither has happened.

---

## L5.26 — Multi-tenant agent isolation

**What it is.** When paying customers arrive, each org gets its own
isolated Pax + agent memory + decision history. Required for the
regulated note-servicing wedge — a Pax conversation for org A must
not leak context into org B's conversation.

**Why defer.** **It's premature.** AcreOS is currently Phase Zero-Zero
(per `acreos_company_charter.md`) — no paying customers yet. Phase 1
trigger is $200 MRR sustained 30 days. Phase 2 trigger is $1k MRR.
Multi-tenant isolation is load-bearing at Phase 3 (~$5k MRR / 50+
paying customers) when the volume of org-scoped traffic actually
risks contamination.

Building it now would:
- Add complexity to surfaces (Pax, memory, audit logs) that today are
  single-org with `tom@acreos.io`'s test org as the only meaningful
  data
- Force us to choose isolation primitives (schema-per-org vs
  row-level-security vs separate clusters) without the constraint of
  real production load to inform the choice
- Be untestable end-to-end — there's no second org to exercise the
  isolation against

**Beatrice's compliance posture** (per `feedback_credential_value_handling.md`
+ the constitution): customer data must never leak across customers. This
is currently enforced by the org_id-scoping pattern that runs through
every table (verified by F3.4 review on 2026-06-03 — the auth path is
clean; one unrelated borrower-statement leak surfaced and is tracked
separately). Multi-tenant isolation as a *first-class capability* is
the next layer of defense, not the first one.

**When to revisit.** **Phase 3 trigger.** $5k MRR sustained 30 days
per the charter. At that point, Quinn (Chief of Alignment) activates +
the multi-tenant isolation work becomes part of her brief.

---

## Sequencing implication

After this document, the 32-capability architecture's effective scope
becomes **29 capabilities** for the near term (L5.22 + L5.25 + L5.26
deferred). Of those 29:

- 21 shipped as of 2026-06-03 (+ L1.5 bonus gap-fill)
- 4 in flight today (L2.7 / L3.15 / L4.21 / L5.24 — Wave 4)
- 4 queued for follow-up today (L3.10 / L3.14 — pgvector-dependent;
  L6.31 / L6.32 — founder-touching, building with reasonable defaults
  per Tom's "best judgement" authorization on 2026-06-03)

After the queued 8 land, the architecture is effectively complete
for the operating envelope AcreOS is in. The 3 deferred items
re-enter the queue at their respective triggers above.

---

## Related memory

`feedback_agentic_evolution_north_star.md` (the 32-capability source)
`acreos_company_charter.md` (the phase triggers)
`feedback_solene_self_development.md` (the disciplines around how
Solene reviews her own capability set)
