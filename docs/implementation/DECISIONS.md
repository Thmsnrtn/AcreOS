# DECISIONS — architectural choices made during this program

Each entry states the choice, the alternative rejected, and why. Recorded so a
later session does not relitigate a settled question.

---

## D1 — Architecture law is a registry, not prose

**Choice:** `shared/architecture/canon.ts` + a ratchet test.

**Rejected:** a `docs/` markdown summary of the Master Audit.

**Why:** the repo already learned this lesson. `shared/governance/constitution.ts`
exists precisely because the ">$500 founder-only" hard stop lived as prose while
the code quietly allowed $500–$50K to auto-execute, and nothing cross-checked
them. Doctrine kept in prose rots silently. The registry pattern (registry +
ratchet + honest "unenforced" flag) was reused deliberately rather than
reinvented.

## D2 — Architecture law is SEPARATE from founder business decisions

**Choice:** two registries — `governance/constitution.ts` (founder decisions:
pricing, money custody, nav doors) and `architecture/canon.ts` (architectural
law: one owner, deterministic math, immutable decisions).

**Rejected:** merging them into one constitution.

**Why:** different authorities and different change processes. Only the founder
may rescind a business decision; architectural law changes with an ADR. Merging
them would blur who may change what.

## D3 — The Evidence Fabric persists claims; it does NOT re-acquire data

**Choice:** record what the provider registry already learned.

**Rejected:** an evidence-acquisition subsystem alongside the provider registry.

**Why:** the audit describes "Evidence Fabric" and "Open Data Fabric" as if they
were two systems; BI15 resolves it — the Open Data Fabric is the *acquisition
side* of the Evidence Fabric, not a separate platform. The existing registry
already does caching, circuit breaking, credit deduction and licence gating well.
Duplicating it would have created exactly the second truth store BI1 forbids.

## D4 — One table for the Evidence Fabric, one for Decision Memory

**Choice:** `evidence_claims` and `decision_snapshots`. No source-registry,
predicate, resolved-value or decision-index tables.

**Rejected:** the fuller schema the audit's prose implies.

**Why:** `scripts/ratchets/table-count.json` is a strict down-only ratchet whose
north star is a **smaller** schema (≤450 against 756 at start). Sources already
live in code (`data-licenses.ts`), predicates are a typed registry, and the
resolved value is a pure recomputable projection (BI14). Law 11: infrastructure
complexity must be earned by measured need. Each bump carries a written
justification in the ratchet file.

## D5 — Append-only means no `updatedAt` column

**Choice:** neither new table has an `updatedAt`; neither store has an
UPDATE/DELETE path; the decisions API has no PUT/PATCH/DELETE. Each pinned by a
test.

**Rejected:** a convention documented in comments.

**Why:** the failure mode is not malice. It is an ordinary
`UPDATE ... SET rationale = ...` written two years from now by someone fixing a
typo, silently changing what the record says a customer believed. A column that
cannot be updated cannot be updated by accident.

## D6 — `subject_id` carries no foreign key on either new table

**Choice:** deliberate, for two different reasons.

- `evidence_claims`: `subjectType` may be `parcel`, which has no table yet.
  Recording the parcel subject from day one makes the eventual Parcel/Property
  split a **backfill**, not a re-interpretation of recorded history.
- `decision_snapshots`: a snapshot must **survive its subject**. An investor who
  passed on a property and later deleted it still needs the record of why, and a
  cascade would erase precisely the decisions worth keeping.

`organization_id` remains a real FK with ON DELETE CASCADE on both, so
customer-data deletion stays complete.

## D7 — Unknowns are derived, not supplied by the caller

**Choice:** `freezeDecision()` reads unknowns and conflicts out of the resolved
evidence itself.

**Rejected:** an `unknowns` parameter the caller fills in.

**Why:** the honest half of a decision record is exactly what a hurried caller
omits. A caller that assembles its own list can leave out the inconvenient parts,
and six months later nothing distinguishes "we knew the flood zone" from "we
never looked". Deriving it makes the frozen state a fact about the system rather
than a claim by the caller.

## D8 — The speculative batch reader was deleted, not kept

**Choice:** when `lint:reachability` flagged `resolveFactForSubjects` as having
no consumer, it was deleted rather than wired to a hypothetical list view.

**Rejected:** keeping it "for later", or adding it to the reachability baseline.

**Why:** the gate's own message says deletion is the cheapest way to satisfy it,
and BI151 says a subsystem that owns no canonical state is probably not a
subsystem. It can return when a real consumer exists — that is a five-minute
change.

## D9 — Corrections to the Master Audit are recorded, not silently applied

**Choice:** where HEAD disproves an audit claim, the correction is written into
the commit message, `NEXT_UP.md` §6 and `canon.ts` prose.

**Why:** the mission's source-of-truth order says the live repo wins on current
fact, and that "never blindly implement an audit recommendation whose premise is
no longer true". A future session reading the audit will hit the same false
premises; the corrections have to be findable from the repo, not re-derived.
