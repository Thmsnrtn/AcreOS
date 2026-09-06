# AcreOS Engineering Standards

## Request Types

Always use `AuthenticatedRequest` from `server/types/request.ts` in route handlers.
Never use `(req as any)` — the Express request is augmented with `organization`, `organizationId`, `permissionContext`, and `isFounder`.

Helper functions available:
- `getOrganization(req)` — throws if org missing
- `getUserId(req)` — throws if user missing
- `getOrganizationId(req)` — throws if org missing

## Error Responses

Always use `Errors.*` helpers from `server/utils/errors.ts` instead of raw `res.status(X).json(...)`.

Available helpers:
- `Errors.notFound(res, "Lead")` — 404
- `Errors.badRequest(res, "Invalid input", details?)` — 400
- `Errors.validationFailed(res, zodErrors)` — 422
- `Errors.unauthorized(res)` — 401
- `Errors.forbidden(res, message?)` — 403
- `Errors.limitExceeded(res, details)` — 429
- `Errors.internal(res, error)` — 500 (auto-logs)

All responses conform to `{ error, message, details?, statusCode }`.

## Logging

Always use structured `logger` from `server/utils/logger.ts`. Never use `console.log/warn/error` in production server code.

## UI Patterns

- **Loading states**: Use `Skeleton` components matching the content shape, not spinners
- **Empty states**: Use the `EmptyState` component with purposeful CTAs
- **Error states**: Use `QueryErrorState` component with retry support
- **Animation**: Use `staggerContainer` + `staggerItem` from `client/src/lib/animations.ts`
- **Components**: Use shadcn/ui components and Tailwind design tokens — never hardcode colors

## Accessibility

- Every icon-only button must have `aria-label`
- Every interactive element must have visible focus state
- Every form input must have an associated label

## Data Providers

All external data flows through the provider registry (`server/services/providers/`).
Providers are registered by category and priority. The registry handles:
- Tier-based filtering
- Credit deduction on paid lookups
- Circuit breaking (3 failures in 5 min = skip)
- Response caching via `provider_cache` table

## Known monoliths

- The founder-dashboard.tsx monolith (7,379 lines) was fully decomposed across commits `f0787190` (keys) → `3ef1efed` (readiness) → `f01e5fb3` (todo merge) → `bf12d8b7` (customers/health) → `be9e37c7` (growth wizard) and ultimately retired by `f2801428` (3-screen Pulse/Cost/Customers model). The file has since been fully deleted from the repo (the `.DELETED.bak` residue is gone too); the canonical founder surface is the focused `/founder/*` route set. No new code should reference founder-dashboard.tsx — add new founder surfaces as their own route.

## Commands

- `npm test` — run all tests
- `npm run check` — TypeScript type checking
- `npm run dev` — start development server

## Customer navigation — five fixed doors

The customer-facing nav is exactly five doors, identical for every persona and on every device:

**Today · Map · Deals · Finance · Pax** — plus **Inbox** and **Settings**, reachable from the top bar.

Persona changes only the CONTENT behind each door (persona-gated sections, vocabulary, Finance tabs, the `businessTypeOnly` verticals), never the doors themselves. Any new customer surface must live behind one of these doors as a child/section/tab — never as a new top-level nav entry. The desktop sidebar (`NAV_MODULES` in `client/src/components/layout-sidebar.tsx`), the mobile bottom nav (`MOBILE_DOORS`), and `DEFAULT_SIDEBAR_ITEMS` in `client/src/lib/nav-items.ts` must all reflect this model. Founder-only and `businessTypeOnly` modules are the only exceptions, and they remain gated.

## Founder navigation — four fixed doors

The founder surface follows the SAME discipline as the customer side — the more the autopilot operates the business, the FEWER doors the founder needs. The canonical model (`FOUNDER_DOORS` in `client/src/lib/founder-doors.ts`) is exactly four primary doors plus one deliberate admin namespace:

**The Letter (`/founder`) · Decisions (`/founder/decisions`) · Controls (`/founder/autopilot/control`) · Story (`/founder/autopilot/story`)** — plus the `/founder/admin/*` instrument namespace for deep panels (telemetry, costs, ETL, prompts, ML snapshots) visited deliberately. (`/founder/autopilot` is a legacy alias that redirects to `/founder`; the earlier Lens-4 "Bridge" home at `/founder/bridge` is now a deep chat+telemetry tool, not a home.)

The historical `/founder/*` set grew to ~88 routes (≥10 overlapping overviews) precisely because this rule didn't exist. Any new founder surface must live behind one of the four doors as a child/section/tab — never a new top-level overview route. The `founderFourDoors.test.ts` ratchet bounds the total `/founder/*` route count: it may only SHRINK as consolidation proceeds. When you consolidate, lower `FOUNDER_ROUTE_BASELINE` to the new count.

## The DO-NOT-DO list (standing founder decisions — do not relitigate)

Each line below is an existing decision recorded in `docs/company/roadmap-2026-07.md`, the deletion ledger, or a dated founder decision. Future sessions enforce them; only the founder can rescind one, explicitly.

These decisions are also mirrored, machine-readable, in `shared/governance/constitution.ts` — each tagged with *how* it is enforced (code-invariant / ratchet-test / lint / prose-only). The `constitution.test.ts` ratchet checks every enforcement pointer still resolves and holds the count of **unenforced hard-stops** at ≤ its baseline (it may only shrink). When you add real enforcement for a prose-only hard-stop, reclassify it there and lower the baseline. Keep the registry in sync with this list — the registry is the checkable form of what's written here.

- **No marketplace before ~25 customers; no public API before ~50** (the approved expansion ladder).
- **No new persona verticals**, and **no new top-level nav entries EVER** — customer or founder side. New surfaces live behind existing doors (see the two doors sections above). The five customer doors may never be hidden per-persona (`PROTECTED_DOOR_ROUTES` in `client/src/lib/sidebar-hidden-routes.ts` + `sidebarHiddenRoutes.test.ts` ratchet).
- **No re-fronting platform send rails**: counterparty mail requires the org's own connected identity (BYO); the platform sender is for system mail only (`emailService` purpose lanes, founder decision 2026-07-17).
- **Be the rail, not the provider — customer money never moves on AcreOS's own account** (founder ruling 2026-07-29). Subscription payments TO AcreOS are the only payments AcreOS is a party to; any customer-managed money movement (borrower note payments, rent, escrow, distributions) runs on the customer's OWN connected processor account or is routed out entirely — no platform-account fallback, no application fee, no funds transiting AcreOS's balance (`customerMoneyRouting.ts` chokepoint + `moneyCustodyHardStop.test.ts` ratchet).
- **Paid advertising is a founder instrument, never a customer feature** (founder ruling 2026-08-13). Meta ads run on AcreOS's OWN ad account, spending AcreOS's own money on AcreOS's own advertising, and only the founder may reach them — `/api/founder/meta-ads/*`, `requireFounder` on creation, catalog sync AND stats reads, no client caller (`metaAdsFounderOnly.test.ts` + `adSpendAuthority.test.ts` ratchets). This is the mirror image of the money-custody ban, not an exception to it: one platform account is fatal when it holds CUSTOMER money and fine when it spends AcreOS's own. If an org is ever to advertise, it runs on the org's OWN connected ad account.
- **The e-sign ceremony is not ours to run** (founder ruling 2026-08-20, *orchestrate not build*). AcreOS owns document intelligence, canonical deal/document state, preparation, workflow, authority checks, provider orchestration, receipts and sealed-artifact references; signer authentication, signature capture and provider-specific mechanics belong to a customer-controlled specialist rail. Two corollaries are already enforced: AcreOS never attests that a counterparty signed when only an operator was present (`POST /api/signatures` records the signed-in user only), and it never banks a credential for an integration it has not built (`ConnectorDef.availability` + the connect-route refusal, `connectorCatalogIsHonest.test.ts`). The canonical model stays provider-agnostic — no `SigningRail` interface until a second rail exists to constrain it (`docs/esign/PROVIDER_BOUNDARY.md`).
- **No residential-comps data plane** before its revenue trigger.
- **No new AI destinations** — Pax stays ambient fabric behind the doors, never a separate app-within-the-app.
- **Fabrication is never acceptable**: no invented numbers, no fake activity, no placeholder data presented as real. Refuse-not-fabricate everywhere (`lint:no-fabrication` gate).
- **Hard-stops stay founder-only forever**: pricing changes, legal signing, spends >$500, customer-data deletion.

## Wave discipline — never trust a wave's self-report

Large changes ship as "waves": a fleet of parallel agents with exclusive file
sets, then central verification, then one PR. This works, but it has one
repeatable failure mode, and it has bitten this repo more than once:

**An agent reports success for the part it built, and is blind to the part it
didn't.** Wave B ("Wire the engine", `86e46f59`) wired workflow emitters for
deal/property/payment but added only the *lead* lane to
`shared/workflow-live-triggers.ts` — so six triggers that genuinely fired were
still badged "Not yet live" in the builder. Every agent involved reported
success. In the same program a schema table shipped with no migration (would
have 500'd on deploy), a *selected* DNC provider without credentials silently
collapsed to "no vendor configured" and passed every number, and an `as any`
widened `leads.organizationId` — a `NOT NULL` tenant key — to
`number | undefined`.

So, for every wave:

1. **Verify claims against code, never against reports.** Run the gates
   yourself (`npm run check`, `npm test`, `npm run build`). A green agent
   report is a hypothesis.
2. **Run an independent completeness audit before the PR merges** — a fresh
   agent that did not build the wave, told to treat each claim as a hypothesis
   and hunt for residue. Cheap relative to shipping a lie.
3. **Hunt "built but unwired" specifically.** It is this codebase's single most
   common defect: new route files never mounted, jobs never registered,
   services with zero call sites, schema without migrations, tables nothing
   reads. Grep new exports for call sites.
4. **When a wave makes a stubbed thing real, update the test that pinned the
   stub — do not delete it.** Rewrite the assertion to the new truth so the
   original invariant survives (see `workflowActionHonesty.test.ts`, whose
   live-trigger check is now *derived* from real emitter call sites rather than
   a hardcoded list, so it cannot go stale again).
5. **Fix the occurrence, not the baseline.** Ratchets are load-bearing; when a
   count legitimately drops, lower it in the same commit.

## The three laws that cost the most to learn

These are not style. Each was discovered by an audit finding a green gate over
a live defect, more than once. They are three different questions about the
same green result: is the gate measuring the right PROPERTY, does the canonical
rule have real ADOPTION, and did the gate read the whole POPULATION.

### A load-bearing gate must be falsified against the SEMANTIC defect

Do not prove *"this symbol disappeared."* Prove *"the forbidden behaviour cannot
be reintroduced through an equivalent representation."*

Every one of these was green while the defect it guarded was reintroducible:

- forbidding the identifier `PLATFORM_ORG_ID` while permitting a literal `0` in
  the same query;
- pinning a trigger by name, which survived renaming it `…_RENAMED` because the
  old name is a substring of the new one;
- an exemption register keyed on a substring of an expression;
- the OD-5 public-claim gate mapping the registry through its own projection
  while scanning no actual public surface;
- a push test asserting `organizationId === 0` as the *expected contract*;
- a nudger mock resolving `undefined`, so the suite agreed with any
  implementation of a status it never read.

So: when you write a gate for something consequential, **mutate the thing it
governs, not the thing it mentions** — then watch it fail. If it stays green,
the gate is decoration. Prioritise this for gates whose false green would
certify security, tenant isolation, public truth, consequential action, data
deletion, billing, or authority. Not every gate needs it.

### A canonical function with zero production callers is not canonical

Authoritative semantics are only one third of it. Canonical requires
**authoritative semantics + real production adoption + drift prevention.**

`publicMaturityOf()` was documented as the rule every public surface must
render, was tested against its own registry, and had **zero production call
sites** — the landing re-implemented its one-line body inline, so anything added
to the function would silently never have reached the only surface it existed
for. `isFounderUserId()` was the canonical founder check and enforced nothing
anywhere until a push recipient needed authorizing.

A function tested only against its own inputs does not establish product truth
if the product computes the same rule independently. Where practical, make the
real surface consume the canonical projection; otherwise pin behavioural
equivalence against actual rendered or serialized output. Static source scanning
is defence in depth, not proof.

### A gate proves its property only over the population it actually reads

The population is an assumption, exactly like the predicate — and it is
invisible in a green result. A rule installed on one file is a claim about that
file, not about the defect it names.

`paxToolsReportRealEffects.test.ts` was written to enforce "a tool may not
report an effect it did not have," after `schedule_background_job` told a
customer their campaign was queued and queued nothing. It read
`server/ai/tools.ts`. `executeSupportTool` in `server/ai/supportAgent.ts` is a
second dispatch switch with **76 more cases**, driven by a model talking to a
paying customer, and no gate had ever looked at it — it held two handlers of the
identical shape. The same day, the org-scope lint was found blind to Drizzle's
relational-query API: every `db.query.*.findMany` in the repo was outside the
population it scanned, so a third of its register was its own blind spot.

Both were green. Neither was wrong about what it measured.

So, when you install a rule: **enumerate every place the shape it forbids can
occur, and put the enumeration in the test** — a `TOOL_SWITCHES` list, a
directory glob, a registry — so that adding a seventh dispatch switch without
adding it to the list is the thing that fails. Then add a per-member vacuity
assertion, because a parser that silently stops matching one member reads
exactly like that member being clean. Ask of any gate you rely on: *what would
have to exist for this to be green and the defect still present?* Usually the
answer is a file it never opened.

#### The population is not just WHICH files — it is where each unit begins and ends

The file can be in the population and still be unread, because a gate does not
scan files, it scans UNITS, and a unit boundary is a parse decision that fails
silently.

The tenancy lint (`scripts/check-org-scoped-fetch.mjs`) was widened to route
files, whose queries all live inside inline `(req, res)` callbacks. Its handler
extractor took *"the last `async (` inside the registration call"* as the
handler. But the call text spans the handler's whole body, so a nested
`db.transaction(async (tx) => …)` sits later in the string and wins: the unit
became the INNER callback and the outer body — the part with the queries —
went unread. Three sibling assumptions failed the same way. A trailing comma
before the closing paren (`},\n);`) made the final argument resolve to
whitespace. A wrapper (`asyncHandler(async (req, res) => …)`) meant the final
argument was not an inline function. And requiring `async` dropped sync
handlers, though an unawaited `db.select()` chain reads exactly as many rows.

Measured 2026-09-04: 51 + 432 + 40 handlers, and the verdict line printed a
healthy route count the whole time. Fixing the boundaries took the readable
population from 2,142 to 2,668 handlers and the rule-3 chain walk from 1,831 to
2,040 — surfacing eight findings that had been invisible.

And the boundary is only as good as the TOKENIZER that finds it. The same gate
was silently dropping whole declarations because its bracket walkers were not
real lexers:

- an APOSTROPHE IN A COMMENT (`// deployment doesn't carry it`) opened a string
  that ran to the next apostrophe anywhere in the file;
- a REGEX LITERAL holding a quote (`s.replace(/[<>&'"]/g, …)`) did the same —
  and did it inside `maskComments` itself, so the mask then blanked live code
  it mistook for comments and left comments unblanked, for every extractor
  downstream;
- a NESTED TEMPLATE LITERAL closed the outer template on the inner one, after
  which every brace and paren sat at the wrong nesting;
- and the fix for the second introduced a fourth: TypeScript's postfix `!`
  (`cac.cacUsd! / n`) read as a prefix logical-not, turning a division into a
  regex that swallowed the rest of the handler.

Four registrations were being dropped, and with them `executeSupportTool` —
the 91-case switch a model drives while talking to a paying customer, which
this gate had never once read. Reading it found four cross-org reads of
`support_resolution_history` returning another tenant's free text into that
model's context.

The lesson is not "write a real parser". It is that **a walker that cannot
complete must COUNT the declaration, never skip it** — every one of these was
an unlogged `continue`. Once the gate printed "declarations whose body could
not be located", the four became visible in one run.

So a population claim needs TWO floors, not one: how many units were found, and
that the units are the right spans. The first is a count you can assert
(`ROUTE_SCAN_FLOOR`). The second only a canary can prove — write a fixture per
extraction shape you rely on, hide the defect inside it, and confirm the gate
goes red; then break each shape deliberately and confirm the matching canary
goes green-to-red on its own. A shape you never wrote a fixture for is a shape
the gate is free to stop reading.

#### And a gate reads its own documentation as the defect

The most reliable way to write a green gate over a live defect is to forbid a
string, then explain in a comment which string you forbade. Every fix worth
making leaves a record of what it removed and why — that record is the thing
that stops the next author reinstating it — and a substring scan cannot tell
the record from the thing.

Measured 2026-09-04: FOUR predicates in one day, all of them written that day.
A workflow scan forbidding `find drizzle` matched the comment explaining why
`find drizzle` was removed. Its POPULATION predicate — `includes("npm run
check")` — pulled an unrelated e2e workflow into the gated set on a header
comment mentioning the command. A mount check, `toContain("app.use(terminal
ErrorHandler)")`, stayed green with the mount commented out, because the line
above it names the mount. And a check that `projectedRevenue: totalRevenue *
1.1` was gone matched the comment recording its deletion.

Three things follow.

**Strip comments before any source predicate, and strip them with a real
scan** — the two-regex idiom (block comments first, then line comments) eats
whole files when a `//` line contains `/*`, which this repo has already paid
for (`tests/helpers/stripComments.ts`).

**A population predicate is a predicate.** It reads comments exactly as
eagerly as the rule does, and it fails silently in the more dangerous
direction: a rule that matches a comment goes red and gets fixed, while a
population that matches a comment goes green over files it should never have
included, or — worse — a population predicate pinned to a literal (`image:
postgres:16`) silently empties when that literal changes and the gate passes
over nothing at all.

**Prefer a parse to a scan where one is available.** Walking `data-testid` JSX
attributes distinguishes a rendered control from a selector that targets one;
walking string literals distinguishes a vendor a page NAMES from a vendor a
comment says was removed. The parser never visits a comment, so the whole
class disappears rather than being defended against case by case.

#### And a verdict you read through a pipe is the pipe's verdict

`npm run check 2>&1 | tail -12` reports `tail`'s exit status. It is 0 whether the
gate passed, failed, or never ran. The failure text scrolls past in the output
you are reading, which is what makes it survive: the eye reads "…and 136 more /
Do NOT raise the baseline" as the familiar informational tail of a passing run,
because on a passing run that is exactly what it is.

Measured 2026-09-06: two commits went to the branch reported as "npm run check
exit 0" when `check:tests` was failing 161 > 160 in both. Branch CI caught it —
the point of the CI-as-verifier loop — but the local gate had been decorative for
the whole session, and the same pipe had been used to "verify" every commit
before them.

So: never read a gate's verdict through a pipe. Redirect to a file and echo `$?`,
or `set -o pipefail` first. And when a gate prints its failures to stdout rather
than stderr, a `grep -c "FAIL"` on the captured file is worth more than the tail.

The sibling mistake, same day: running `npm run check` while still editing files.
The result then describes a tree that no longer exists — a gate cannot be trusted
about a file it read before you wrote it. Finish editing, then measure.

#### The population includes the CI runs you did not look at

The same law governs how you verify a merge, and it is easier to break there
because the population is invisible by default.

A push to a feature branch triggers three workflows in this repo. A push to
`main` triggers thirteen. Watching a branch's three, then fast-forwarding, is a
verification that is *complete over the population it reads* and blind to ten
workflows — including `Security Scanning`, which does not run on branches at
all.

Measured 2026-09-05: that gap hid a red security gate for two days and
37 consecutive runs, across nine fast-forwards. Every one of them was reported
green, and every report was true about the three runs it had read.

So: before fast-forwarding `main`, enumerate EVERY workflow run for the SHA and
assert the set of non-success conclusions is empty. Not the three you know
about — the ones the API returns. And when one is red, read it before merging,
because "it was already red" is a claim about history that has to be checked
against the run list, not remembered.

A corollary for any gate whose verdict depends on an external database — a CVE
feed, a licence list, a blocklist: it can go red with no commit, which is the
point of it. That makes such a gate's failure output load-bearing in a way an
ordinary test's is not. If it fails and the log does not say what it found, the
gate has no path to green except deleting it. Make it print.
