# Data, AI and economics

One truth architecture, the provider doctrine, Pax's boundaries, and cost as a
design constraint. Verified at `10447296`, 2026-08-19.

---

## Evidence is a claim, not a field

**A material fact is stored as an append-only, source-backed CLAIM — never as an
overwritten column.** One table, `evidence_claims`, carries subject / predicate /
value plus provider, source, authority, `observedAt` (the source's time),
`fetchedAt` (ours), provider confidence, licence, and cost.

The current answer is a **pure recomputable projection** over claims, not a
stored field. That is what makes three things possible at once: freshness is
knowable, provenance travels with the value, and disagreement between two sources
is representable rather than resolved by last-write-wins.

`shared/evidence/claim.ts` defines the laws. **Unknown and conflict are valid
resolved states.** Migration 0238 adds the integrity constraints — as `NOT VALID`,
because no session has ever had a database (see `PROOF_PROGRAM.md`).

The rules that follow from this, each of which was learned the hard way:

- **An evidence claim is not a resolved fact.**
- **A seller or user assertion is not verified property truth.**
- **Provenance travels with the value, not with the lookup.**
- **A measurement that failed is not a measurement of zero.**
- **Parcel snapshots, provider responses, Pax memory and cached values must
  never become unexamined parallel truth owners.**

**The live gap:** conflict is computed, persisted and served, and no client
consumes it. The evidence endpoint has zero callers in `client/src`.

## Providers

The registry (`server/services/providers/`) is documented as owning tier
filtering, credit deduction on paid lookups, circuit breaking (3 failures in 5
minutes) and response caching.

**Two things about it are true and easy to miss.** It is the minority path —
2 production call sites against `dataSourceBroker`'s 71 across 14 files. And its
headline capability has never run: both callers hardcode the tier argument, so
tier-based filtering has never once been driven by a customer's actual plan. The
two tier vocabularies cannot even meet — billing says `starter|pro|scale`, the
registry says `free|starter|pro|enterprise`, and no mapping function exists.

Doctrine regardless of the current wiring: free and open data first where it is
trustworthy; paid data when it creates enough value to pay for itself; and for
any material fact, preserve source, retrieval time, provenance, uncertainty,
freshness, conflict, and redistribution posture.

## Pax

**Pax is the ambient intelligent interface over canonical state. It is not a
layer, not a source of truth, and not an authority system.** `canon.ts` declares
it a NON-layer explicitly.

Pax may explain, synthesize, propose, compare and reason. Pax output does **not**
automatically become evidence, durable policy, a decision snapshot, authority, or
an external action. Every one of those transitions is explicit.

The enforcement that makes this real rather than aspirational, in `server/ai/tools.ts`:

- The approval kernel gate runs **before** the pause gate in `executeTool`, and
  `APPROVAL_REQUIRED_TOOLS` has exactly five entries.
- `_approved` is **stripped from args** — it was once a field the model could
  emit for itself, which is the purest form of a caller declaring its own safety.
- At the `assisted` autonomy level a send returns a DRAFT and sends nothing
  unless trusted server code passed `trustedApproval`, which only the
  approve-and-send endpoint sets after a human taps Send.
- `unattendedSendPermitted(level)` asks which levels MAY send rather than which
  one must not, so a level added later sends nothing until someone says so.

**Do not expose dozens of raw table-query tools when a semantic capability is
better.** Pax reasoning over Property, Evidence Claims, Scenario, Decision
Memory, Workflow, Action, Receipt and Outcome is the destination; a SQL surface
with a chat box on it is not.

## Fabrication is structurally prevented

Two gates, both self-testing:

- **`lint:no-fabrication`** — no invented numbers, no fake activity, no
  placeholder presented as real.
- **`check-measurement-defaults.mjs`** — flags a value read from a data source
  being replaced by a plausible constant. It walks ~1505 server files and ~2010
  expressions, runs a **9-case predicate self-test in both directions on every
  run**, and is down-only.

The discriminator that matters is **where the value came from**: a caller-supplied
knob may have a default; a measurement read from a data source may not. `|| 5` on
an acreage read from a parcel record is fabrication. `?? 30` on a caller's
requested page size is not.

The remedy is always the same: make absence representable (`number | null`) and
let the caller render or refuse.

## Cost

Cost is a first-class design constraint, not an afterthought.

Seek cheap deterministic computation before a model; model routing by task
complexity; caching; shared enrichment across tenants where rights allow; free
and open data; provider substitution; attribution; bounded retries; and — the one
most often missed — **no dark AI calls**, results computed and never rendered.

Where it earns its keep, understand cost per tenant, per Strategy Pack, per
workflow, and per successful outcome. **Do not build elaborate cost systems
without real consumers** — a cost dashboard nothing reads is itself a cost.

A high-value capability should earn its complexity economically as well as
technically.

## Deterministic truth stays deterministic

Financial and geometric truth is versioned, testable, and computed — never
inferred by a model. Amortisation, payoff, acreage, distance, tax proration:
these have right answers, and a model that is usually right is worse than useless
in a path where the customer will act on the number.
