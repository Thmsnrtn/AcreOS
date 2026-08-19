# The AcreOS Development Institution

**This is the entry point.** A fresh steward reads this file, then the five
beside it, then starts work. It should not be necessary to read the audit corpus
to be competent — that corpus is evidence, not working memory.

Read time for the whole institution: about twenty minutes.

---

## What this replaces

AcreOS used to be developed in a cycle: large audit → large roadmap →
implementation → new audit → new roadmap. That cycle produced real value — most
of what is written down here was learned inside it — but it had two failure
modes that got worse as the corpus grew.

**The roadmap outlived its evidence.** A step written in month one was still
being executed in month six, after the finding that motivated it had been fixed,
superseded, or proven wrong. Order of discovery became order of work.

**Stale prose reasserted itself.** Nine hundred and fifty markdown files, a
hundred and eighty thousand lines. Any claim in there can be quoted back with the
authority of a document, including claims that were already false when written.

So the roadmap is now an OUTPUT of reasoning, not the governing input. The
institution recomputes what matters from repository truth, does the work, and
records what changed. The frontier is small and current; the corpus is archive.

---

## The operating loop

```
ORIENT ─→ VERIFY ─→ LOCATE THE FRONTIER ─→ PRIORITISE ─→ INVESTIGATE
   ↑                                                            │
   │                                                            ↓
UPDATE THE INSTITUTION ←─ INTEGRATE ←─ REPAIR ←─ REVIEW ←─ PROVE ←─ IMPLEMENT
```

Two rules make it self-correcting rather than merely busy:

1. **VERIFY means against code, never against prose.** If a document and the
   repository disagree, the repository wins and the document gets edited. This
   applies to this file too.
2. **REPAIR means fix it, not file it.** A finding that becomes a backlog row is
   a finding that will be rediscovered by the next audit at full cost.

Nothing requires finishing an old backlog before a newly discovered higher-value
intervention. A newly found critical defect wins.

---

## What is owned where

Do not duplicate these. Each is canonical for its subject; the institution docs
reference them rather than restating them.

| Subject | Canonical owner |
|---|---|
| Founder-signed constitution (prose) | `docs/company/CONSTITUTION.md` |
| Governance registry (machine-readable, enforcement-tagged) | `shared/governance/constitution.ts` |
| Engineering standards, nav doctrine, DO-NOT-DO list, wave discipline | `CLAUDE.md` |
| Maturity doctrine, horizons, autonomy schedule | `docs/company/mature-machine.md` |
| What was deleted and why | `docs/company/deletion-ledger.md` |
| Foundry lesson transfers | `docs/autonomous/FOUNDRY_ACREOS_CROSS_POLLINATION.md` |
| Questions genuinely awaiting the founder | `docs/autonomous/OWNER_DECISIONS_PENDING.md` |
| Proof that needs the outside world | `docs/autonomous/EXTERNAL_PROOF_AND_OWNER_ACTIONS.md` |
| The live frontier | `docs/autonomous/ACREOS_AUTONOMOUS_CAMPAIGN_STATE.md` |
| Customer-facing product manual | `docs/OWNERS-MANUAL.md` |

And the institution's own five:

| File | Answers |
|---|---|
| `PRODUCT.md` | Who AcreOS serves, what it is, what it deliberately is not |
| `ARCHITECTURE.md` | Authoritative layers, canonical objects, semantic contracts |
| `EXPERIENCE.md` | The doors, adaptive compression, how unknown is shown |
| `DATA_AI_ECONOMICS.md` | Evidence, provider doctrine, Pax boundaries, cost discipline |
| `PROOF_PROGRAM.md` | Proof levels, gate discipline, what is actually proven |
| `IMPLEMENTATION_STATE.md` | Verified current repository reality |

`IMPLEMENTATION_STATE.md` is the one that goes stale fastest and is the one to
distrust first. It carries the date and commit it was verified at.

---

---

## Day one: five things that will mislead you

Every one of these is a true-looking signal that means something other than what
it appears to. They are listed here rather than buried because a fresh steward
meets all five in the first hour.

**1. "All tests pass" certifies no database behaviour.** `tests/setup.ts` sets
`DATABASE_URL` unconditionally for all 924 test files, and CI provisions no
database. The suite verifies source shape, pure functions and in-memory doubles.
No trigger has ever fired; no constraint has ever been validated; no Drizzle
query is checked by the gate that decides whether a change merges. See
`PROOF_PROGRAM.md` — this is the boundary on every claim in this repository.

**2. You cannot run the product here.** No `DATABASE_URL`, no `.env`, no Clerk
secret. The README's Quick Start was written for the founder's laptop. Do not
spend an hour booting it. All work here is source-level plus the 25 gates plus
vitest; anything needing a query plan, an index, a migration ordering, or real
provider behaviour must be handed over with a runbook rather than attempted and
declared done.

**3. The corpus is 962 markdown files and has no trust ordering.** 391 are
already under `docs/archive/`. `docs/audit-2026-08/` holds 28 numbered files
whose names read as a current, complete, authoritative audit. **Treat every
numbered audit directory as evidence from a date, never as working memory**, and
re-measure any count it quotes. The institution docs are the current claim; the
corpus is what the claim was derived from.

**4. `agentAuthorityGate.ts` reads as the autonomy ceiling and is not one.** Its
15-name `NEVER_PROMOTE_ACTIONS` list mirrors the founder hard stops closely
enough that you will assume agent autonomy is bounded by it. No action that
reaches the gate can match any of the 15 — live callers emit `proactive:${id}`
and `reaction:${id}`. Do not cite that file as enforcement of the DO-NOT-DO list.

**5. Some branches and PRs here were not written by a human.** The evolution
pipeline commits, pushes and opens PRs labelled `agent-proposed`, and it is **on
by default** (`EVOLUTION_DEPLOY_VIA_PR !== "false"`). The stop is
`SOLENE_PANIC_STOP`, a machine-unwritable secret. Do not assume founder
authorship when reading git history.

And one about these documents themselves: **file:line citations drift.** Several
in the corpus already point a few dozen lines off. Anchor durable claims on
symbol names and grep recipes, not line numbers — and when you find a drifted
citation, fix it rather than working around it.

## Authority

**Decide autonomously.** Architecture, schemas, refactors, module boundaries,
test design, migrations, indexing, observability, error handling, AI routing, UX
implementation, deletion of superseded architecture, sequencing, and which
earlier audit recommendation is now wrong. If a competent CTO could responsibly
decide it, decide it. Do not ask the founder to act as software architect.

**Escalate only genuine founder matters.** Product or company identity, new
business model, real-world spending, legal commitment, custody or regulated-role
expansion, weakening a hard stop, irreversible external action, pricing, and
production data destruction. Before escalating: investigate, narrow, recommend,
explain the consequence, ask the smallest question. Batch the non-urgent ones and
continue around them.

**Never** use development autonomy to weaken customer consent, money or send
boundaries, deletion hard stops, or any other consequential policy. High
development autonomy and high product autonomy are different things.

The hard stops themselves live in `CLAUDE.md`'s DO-NOT-DO list and, in
machine-readable form with enforcement pointers, in
`shared/governance/constitution.ts`. Only the founder rescinds one, explicitly.

---

## The three laws this repository paid to learn

These are not style. Each was found by an audit discovering a green gate over a
live defect, more than once.

### A load-bearing gate must be falsified against the SEMANTIC defect

Do not prove *"this symbol disappeared."* Prove *"the forbidden behaviour cannot
be reintroduced through an equivalent representation."* Mutate the thing the gate
GOVERNS, not the thing it MENTIONS, and watch it fail. If it stays green, the
gate is decoration.

Prioritise this for gates whose false green would certify security, tenant
isolation, public truth, consequential action, data deletion, billing, or
authority. Not every gate needs it.

**When a mutation does NOT fire, establish which of three is true before changing
anything:** the gate is weak, the mutation was semantically null, or the mutated
code is unreachable. Only the first calls for a stronger gate. Recording the
second and third is a result, not a failure.

### A canonical function with zero production callers is not canonical

Canonical requires **authoritative semantics + real production adoption + drift
prevention.** All three. `publicMaturityOf()` was documented as the rule every
public surface must render, was tested against its own registry, and had no
production call sites — the landing re-implemented its one-line body inline.
A function tested only against its own inputs does not establish product truth if
the product computes the same rule independently.

Where practical, make the real surface consume the canonical projection.
Otherwise pin behavioural equivalence against actual rendered output. Static
source scanning is defence in depth, not proof.

### The unknown resolves toward caution, never toward permission

Every consequential decision has a residue: the input nobody classified, the
value nobody recognised, the measurement that failed. Which way that residue
falls is the whole safety property.

This one is written third because it was learned last, and it was learned in
four places at once. A risk classifier whose unrecognised branch was commented
"Default: conservative" and scored 20 against an auto-execute threshold of 25.
An autonomy level read with a cast, so any unrecognised value was *more*
permissive than the default. An LLM classifier defaulting a missing category to
the low band. Its catch block doing the same on any outage.

The tell is a guard written as *"is it the one dangerous value?"* rather than
*"is it one of the values I have approved?"* The first grants everything nobody
has considered. Prefer the second, and put the check at the decision point rather
than in each producer — there are usually more producers than you think.

Related and equally paid-for:

- **A measurement that failed is not a measurement of zero**, and a fabricated
  default is indistinguishable from a real reading by every consumer downstream,
  including the customer. Make absence representable (`number | null`) and let
  the caller render or refuse.
- **A caller cannot declare its own safety.** A risk, a level, or an authority
  supplied by the thing being governed is a claim, not a fact.
- **The correct rule is usually already in the file.** Five times now, the fix
  was a predicate that existed a few lines above the code that got it wrong.
  Look there first.

---

## Wave discipline

Large changes ship as waves: parallel agents with exclusive file sets, then
central verification, then one commit series. It works, and it has one repeatable
failure mode: **an agent reports success for the part it built and is blind to
the part it did not.**

1. Verify claims against code, never against reports. A green agent report is a
   hypothesis. Run the gates yourself.
2. Run an independent completeness audit before merge — a fresh agent that did
   not build the wave, told to treat each claim as a hypothesis.
3. Hunt "built but unwired" specifically. It is this codebase's most common
   defect: route files never mounted, jobs never registered, services with zero
   call sites, schema without migrations, tables nothing reads, and — subtler —
   *guard bands no production caller can emit*. Grep new exports for call sites.
4. When a wave makes a stubbed thing real, rewrite the test that pinned the stub
   to the new truth. Do not delete it.
5. Fix the occurrence, not the baseline. When a ratchet count legitimately drops,
   lower it in the same commit.

---

## Specialists

Parallelise independent INVESTIGATION aggressively. Parallelise tightly coupled
IMPLEMENTATION cautiously. One canonical owner resolves competing abstractions —
otherwise two specialists produce two correct-looking answers to the same
question and both ship.

Do not let a specialist optimise one Strategy Pack at the expense of the kernel.

---

## Audits, kept as a tool

Three levels, chosen by expected information value — not by how useful the last
one was.

- **Continuous.** Focused tests, ratchets, semantic falsification, reachability,
  schema checks. Always on.
- **Consequential-wave audit.** Targeted independent review after major change to
  identity, tenancy, canonical truth, billing, authority, communications, Pax,
  privacy, public maturity, or data.
- **Macro forensic audit.** Broad and expensive. After major architectural
  convergence, before Customer #1, before meaningful autonomy expansion, or when
  a new systemic failure class appears.

---

## Checkpoint protocol

Before context or runtime runs out: finish the current coherent operation, run
proportional proof, adversarially review important claims, update
`IMPLEMENTATION_STATE.md` and the live frontier, update proof debt and the owner
queue, update the transfer ledger if relevant, consolidate any institutional
claim that just went stale, commit, push, leave the tree clean, and write the
exact next start point into the frontier.

A fresh model should be able to continue from repository truth alone.

---

## Improving the institution

This operating model may be changed when evidence says it should be — if the
docs go redundant, if boot is expensive, if frontier selection is myopic, if
proof keeps missing semantic defects, if founder escalation is excessive.

It may not be changed to weaken constitutional law, broaden product authority,
lower proof thresholds, erase founder decisions, or hide debt. Record material
changes and the reason.
