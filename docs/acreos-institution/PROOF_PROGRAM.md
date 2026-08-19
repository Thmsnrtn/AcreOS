# Proof program

What counts as proven here, what the gates actually certify, and the one boundary
that bounds every claim in this repository. Verified at `10447296`, 2026-08-19.

---

## The boundary, first

**No test in this repository ever executes SQL.**

`tests/setup.ts` sets `process.env.DATABASE_URL` unconditionally, for every one
of the 924 test files, to a database that does not exist. `.github/workflows/ci.yml`
— the gate that decides whether a change merges — provisions no database service.

So the suite verifies **source shape, pure functions, and hand-rolled in-memory
doubles.** Migration 0238's BEFORE-UPDATE trigger has never fired. Its four
`NOT VALID` CHECK constraints have never been validated. Every Drizzle query in
the repository is unverified by the merge gate.

This makes *"all tests pass"* the most dangerous true statement in the codebase.
It is true — 924 files, 12,444 passing, exit 0 — and it certifies zero database
behaviour. A test named `parcelObservationsAppendOnly` parses migration TEXT; the
trigger it describes is untested.

Nor can a steward run the product here: `DATABASE_URL` is unset, there is no
`.env`, and the README's Quick Start was written for the founder's laptop. Every
conclusion reachable in this environment is static — source reading, the 25
gates, and the mocked suite.

**Plan accordingly.** Anything needing a query plan, an index, a constraint
validation, a migration ordering, or real provider behaviour under failure is
EXTERNAL-EVIDENCE-GATED and must be handed over with a runbook, not attempted and
declared done. The one real-database verification on record is the manual
two-half DR rebuild on PostgreSQL 16, 2026-08-17.

## Proof levels

Never use test count as maturity. Say which of these a claim has reached:

IMPLEMENTED · TESTED · LOCALLY PROVEN · INTEGRATION PROVEN · GOLDEN-JOURNEY
PROVEN · EXTERNAL-PROVIDER PROVEN · CUSTOMER VALIDATED · PRODUCTION PROVEN ·
OUTCOME VALIDATED · ECONOMICALLY VALIDATED

At HEAD, essentially everything is at **LOCALLY PROVEN** and nothing is past
EXTERNAL-PROVIDER PROVEN. That is honest for a pre-customer product; stating it
is what keeps the next steward from inferring more.

## The surface

`npm run check` is **25 steps**: one `tsc --noEmit` plus 24 lint/check gates.
**14 JSON-configured ratchets** live in `scripts/ratchets/`. The suite is 924
files / 12,444 tests. "The gates" means these 25 — nothing else.

`npm run check` takes about ten minutes and the suite about five. Background both;
a foreground `sleep` is blocked. Commit with `--no-verify` — the pre-commit hook
runs a full `tsc` and times out.

## Ratchet discipline

Every register is **bidirectionally** enforced:

- `count > baseline` → FAIL, a new offender.
- `count < baseline` → FAIL, **stale-high**. The reduction must be locked into
  the commit that earned it.

The second direction is the one that does the work. Without it a register drifts
upward invisibly whenever something else drifts down.

**Fix the occurrence, not the baseline.** Raising a baseline to make a gate green
is the one move that turns the whole apparatus into decoration.

## Vacuity guards run FIRST

A green result over an empty population reads as a clean bill of health. Every
gate must assert its scan population is non-empty and plausible **before** it
reports a verdict, and print what it walked.

The canonical statement of why lives in `scripts/ratchets/table-count.json`'s
`minimaNote`. The pattern in practice: `check-measurement-defaults.mjs` prints
"walked 1505 server files; 2010 expressions considered" on every run, and
`check-org-scoped-fetch.mjs` prints "declarations whose body could not be
located: 0" — a number that was once 335, which meant a third of the codebase was
invisible to the tenancy gate while it reported PASS.

## Falsify against the semantic defect

**Mutate the thing the gate GOVERNS, not the thing it MENTIONS**, and watch it
fail. If it stays green, the gate is decoration.

Every one of these was green while the defect it guarded was reintroducible:
forbidding the identifier `PLATFORM_ORG_ID` while permitting a literal `0` in the
same query; pinning a trigger by name, which survived renaming it `…_RENAMED`
because the old name is a substring; an exemption register keyed on a substring
of an expression; a public-claim gate mapping the registry through its own
projection while scanning no actual public surface; a push test asserting
`organizationId === 0` as the expected contract; a nudger mock resolving
`undefined`, so the suite agreed with any implementation.

Prioritise this where a false green would certify security, tenant isolation,
public truth, consequential action, data deletion, billing, or authority.

**When a mutation does NOT fire, establish which of three is true before changing
anything:** the gate is weak, the mutation was semantically null, or the mutated
code is unreachable. Only the first calls for a stronger gate. Recording the
second or third is a result.

Two recurring traps, each found more than once:

- **A source gate that reads its own fix comments is matching prose, not
  behaviour.** Strip comments before scanning, with a floor on the stripped size
  so the stripping itself cannot silently empty the file.
- **A stubbed safety predicate makes a suite agree with any implementation of
  it, including an inverted one.** Import the real function into the mock.

## Canonical requires three things

**Authoritative semantics + real production adoption + drift prevention.**

`publicMaturityOf()` had the first and third and zero production callers — the
landing re-implemented its one-line body inline, so anything added to the
function would never have reached the only surface it existed for. It now has
real callers and its test anchors rendered DOM rather than the registry, so
deleting a demotion fails instead of moving expectation and DOM together.

This trap is live and recent: a fix to the trust-authority read passed every
behavioural test while either authority reader could be reverted to the stored
column, because no test pinned the call sites. Two thirds is not canonical.

## What is genuinely well protected

- **Fabrication.** `lint:no-fabrication` plus `check-measurement-defaults.mjs`,
  which self-tests its own predicate in both directions on every run (9/9) and
  flags a measured field being replaced by a plausible constant.
- **Tenancy shape.** Five down-only registers, with rule 3 added specifically
  because rules 1 and 2 both passed a live cross-tenant read.
- **The door models.** Both customer and founder nav ratchets derive the door set
  from the real nav rather than re-listing it.
- **Architecture drift.** `canonicalArchitecture.test.ts` proves every table
  canon names exists and every enforcement pointer resolves.
- **Public claims.** Anchored against rendered DOM, not against the map that
  produces it.

## Standing proof debt

- **The database boundary above** — the largest single item, and structural.
- `lint-reachability` does not scan `shared/**`. A new shared module with no
  production caller is invisible to the built-but-unwired gate. Measured: the
  gate stayed at baseline with six new unadopted exports in the tree.
- The S3 fetch half of the DR RTO is unmeasured — no bucket access here.
- `constitution.ts` still carries prose-only hard stops. The ratchet holds the
  count of unenforced ones at or below baseline; when you add real enforcement,
  reclassify it there and lower the count in the same commit.

## A deliberate negative result

The fail-open catch class was surveyed — 524 empty catches, 133 in gate context —
and is handled correctly almost everywhere. **No gate was built.** A register of
133 mostly-correct sites would freeze noise and make the real ones harder to see.
Individual instances get fixed as found, which is how the confidence-cascade
fail-open was closed. Recorded here so it is not re-litigated as an oversight.
