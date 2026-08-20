# Proof program

What counts as proven here, what the gates actually certify, and the one boundary
that bounds every claim in this repository. Verified at `10447296`, 2026-08-19.

---

## The boundary, first

**No VITEST test executes SQL — and vitest is the merge gate.**

The wording matters, because the blunt version of this claim ("no test ever
executes SQL") is false and was in this document until the bootstrap test caught
it. There are two test layers here and they are easy to conflate:

| layer | files | database |
|---|---|---|
| **vitest** — `*.test.ts` | 924 files, 12,447 tests | none, ever |
| **Playwright** — `*.spec.ts` | 49 files | a real PostgreSQL 16 in CI |

`vitest.config.ts` includes only `**/*.test.{ts,tsx,mjs}`, so the 49 `.spec.ts`
files are invisible to it. Six workflows provision `postgres:16` or
`pgvector/pgvector:pg16`, and `tests/e2e-mobile/global-setup.ts` creates the
`vector` extension, runs `drizzle-kit push --force` to build every table, and
`INSERT`s real rows. That layer is real proof.

What remains true, and is the load-bearing part:

- **`tests/setup.ts` overwrites `DATABASE_URL` unconditionally**, for every
  vitest file, with credentials CI does not provision. So the vitest half is
  redirected to a database that cannot authenticate — and passes, because
  everything is mocked. All 924 files pass with no PostgreSQL running at all.
- The e2e layer builds the schema with **`drizzle-kit push` from
  `shared/schema`, not from `migrations/*.sql`**. So migration 0238's
  BEFORE-UPDATE trigger has still never fired and its four `NOT VALID` CHECK
  constraints have still never been validated — the *migrations* are unproven
  even though the *schema* is exercised.
- Vitest is what gates a merge on most paths. A change can be green there and
  have had no query, index, constraint or trigger tested at all.

So: **"all vitest tests pass" certifies source shape, pure functions and
in-memory doubles.** Say which layer you mean when you claim something is
proven.

Nor can a steward run the product in the dev container: `DATABASE_URL` is unset,
there is no `.env`, and the README's Quick Start was written for the founder's
laptop. Anything needing a query plan, an index, a migration ordering, or real
provider behaviour is EXTERNAL-EVIDENCE-GATED *here* and must be handed over
with a runbook — though the CI e2e layer can prove more than this container can,
which is worth reaching for before declaring something unprovable.

A staging deployment exists (`acreos-staging` on Fly) alongside production. That
bears directly on the "blast radius is zero" framing: pre-customer is not the
same as no deployed environment.

## Proof levels

Never use test count as maturity. Say which of these a claim has reached:

IMPLEMENTED · TESTED · LOCALLY PROVEN · INTEGRATION PROVEN · GOLDEN-JOURNEY
PROVEN · EXTERNAL-PROVIDER PROVEN · CUSTOMER VALIDATED · PRODUCTION PROVEN ·
OUTCOME VALIDATED · ECONOMICALLY VALIDATED

At HEAD, most things are at **LOCALLY PROVEN**; the surfaces the e2e specs cover
reach INTEGRATION PROVEN; nothing is past EXTERNAL-PROVIDER PROVEN. That is honest for a pre-customer product; stating it
is what keeps the next steward from inferring more.

## The surface

`npm run check` is **26 steps**: one `tsc --noEmit` plus 25 lint/check gates.
**14 JSON-configured ratchets** live in `scripts/ratchets/`. The suite is 924
files / 12,444 tests. "The gates" means these 25 — nothing else.

`npm run check` takes about ten minutes and the suite about five. Background both;
a foreground `sleep` is blocked. Commit with `--no-verify` — the pre-commit hook
runs a full `tsc` and times out.

## Ratchet discipline

The **intent** is bidirectional enforcement:

- `count > baseline` → FAIL, a new offender.
- `count < baseline` → FAIL, **stale-high**. The reduction must be locked into
  the commit that earned it.

The second direction is the one that does the work. Without it a register drifts
upward invisibly whenever something else drifts down.

**But bidirectionality is per-gate, not a property of the apparatus** — every
`scripts/ratchets/*.json` register enforces both directions, while hand-written
test baselines each decide for themselves. A survey on 2026-08-19 found four
one-directional registers and fixed the two that mattered most:

- `FOUNDER_ROUTE_BASELINE` — the worst case, because the count equalled the
  baseline at 82. A consolidation to 78 would have passed silently and handed
  the next session four free slots for new top-level founder routes, exactly the
  sprawl the four-door doctrine exists to prevent.
- `statuteRegister`'s `UNREVIEWED` / `PROSE_ONLY` / `REFUSAL_ONLY` — the count of
  laws AcreOS implements that no lawyer has read. Getting five reviewed created
  five unclaimed slots for new unreviewed implementations.

Both now fail stale-high, both falsified by simulating the consolidation.
`orgScopedFetchCoverage` asserts only an upper bound in the test, but the script
it wraps enforces both directions itself, so it is sound.

**Do not assume a baseline you see is self-ratcheting; check the assertion.**
That is the general lesson, and it is why the survey mattered more than either
individual fix.

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

  This has a mirror image, found 2026-08-19: `aiPromptLeakage.test.ts` scanned
  every line for founder POV, so a docblock *explaining why a founder-only
  boundary exists* was reported as a leak of it. A comment cannot reach a
  customer. The gate now skips whole-line comments — and carries the floor,
  because a comment detector that swallowed a file would silently stop scanning
  it. Both mutations fire: a real leak in a string is still caught, and
  disabling the detector trips the floor.

  And a THIRD face of it, closed 2026-08-20, which is the one to remember when
  the fix looks like a one-line change. A gate that scans source has scans that
  EXEMPT and scans that ACCUSE, and they are not the same risk: a comment
  wrongly granting an exemption hides a finding, while a comment wrongly counted
  as a call site clears innocent code — and stripping comments from an accusing
  scan means every symbol it newly names must be adjudicated at once, because
  the ratchet is down-only. `lint-reachability` therefore ran comment-free on
  its two exempting scans for a full day while its identifier pass still read
  prose. What unblocked it was reading the revealed population instead of
  counting it: all 86 symbols searched by hand, zero false accusations, and two
  thirds of them turning out to be a DIFFERENT RULE that then needed its own
  family and its own baseline. Sizing a gate change by the count of new findings
  is how it stays unstarted; sizing it by what the findings ARE is how it lands.
- **A stubbed safety predicate makes a suite agree with any implementation of
  it, including an inverted one.** Import the real function into the mock.
- **An adjective is not a measurement.** `DEFAULT_RATE` — the price the AI cost
  ceiling applies to a model it does not recognise — was `{input: 1.0, output:
  3.0}` under a comment reading "Conservative fallback … better to slightly
  overcount". It sat below ten of its own table's rows, so the ceiling
  under-counted the spend it exists to bound by up to 8× (ledger 46). The word
  had been reviewed; the number never was. Worse, the value had already crossed
  a refactor that fixed it: the router's docblock names `{input:1,output:3}` as
  the defect it replaced with "the central *conservative* DEFAULT_RATE", and
  that constant was `{input:1,output:3}`.

  Two habits fall out. When a constant is described by a property —
  conservative, safe, minimal, strict — CHECK IT AGAINST THE POPULATION IT IS
  SUPPOSED TO DOMINATE, not against the sentence. And where the property is a
  relationship to other values, DERIVE it rather than set it: a `Math.max` over
  the table cannot fall behind the table, and a literal always eventually does.

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
- `lint-reachability` does not treat `shared/**` as a source of export
  CANDIDATES. `shared` *is* in `PRODUCTION_ROOTS`, so shared files count as call
  sites; it is `EXPORT_SOURCE_DIRS` — `server/services`, `server/jobs` — that
  bounds what can be reported unreached. A new shared module with no production
  caller is therefore invisible to the built-but-unwired gate, and widening
  `PRODUCTION_ROOTS` would change nothing. Measured: the gate stayed at baseline
  with six new unadopted exports in the tree.
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
