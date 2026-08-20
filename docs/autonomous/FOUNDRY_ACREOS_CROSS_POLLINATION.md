# Foundry → AcreOS cross-pollination ledger

**Started 2026-08-17. Foundry re-read 2026-08-18 at `b8ed2fa` on
`claude/foundry-autonomous-continuation-0gents`, which is 538 commits and 291
files AHEAD of the merged `master` (`abfe96c`) — the named continuation branch
is still the truth, and assuming master was current would have missed every
transfer below entry 3.**

One line per candidate invariant, with its disposition and the evidence behind
it. Read-only throughout: no commit, no branch, no test run, no migration on the
Foundry side.

## The rule this ledger exists to enforce

**Do not make AcreOS into Foundry.** Foundry is a general Adaptive Company
Institution; AcreOS is an opinionated property-investment OS. What may cross is
an *invariant* or a *failure-mode discovery* — a thing Foundry learned the hard
way about how systems lie to their operators. What may never cross is a noun: no
Foundry table, migration, ontology, brand name, or runtime dependency. AcreOS
gains no import from Foundry, and Foundry is read-only throughout.

Consequence in practice: every accepted transfer below lands as AcreOS-native
code against structures AcreOS already owns, and at least one deliberately
*inverts* Foundry's implementation because AcreOS's obligations differ.

Traffic already runs both ways — Foundry's `scripts/ratchet.mjs` says in its own
header that it was ported FROM AcreOS. This is an exchange between two
codebases, not an upstream and a downstream.

## Admission test

A candidate is only imported if it passes all of these. Any failure means
**DO NOT IMPORT**, and the reason is recorded rather than argued away.

1. Names a defect that exists in AcreOS *today*, citable by file and line.
2. Transfers an invariant, not a noun.
3. Creates no parallel architecture — it narrows or hardens something AcreOS
   already has.
4. Introduces no second authority model, vocabulary, or maturity ladder.
5. No Foundry runtime dependency, import, or schema.
6. Does not touch money custody, or the founder-only hard-stops.
7. Does not increase owner burden.
8. Testable locally, without production access.
9. Fits the doors model — no new top-level surface, customer or founder.
10. The AcreOS version would still be right if Foundry disappeared tomorrow.

---

## Ledger

| # | Invariant | Disposition | Landed as |
|---|---|---|---|
| 1 | A caller cannot declare its own safety | **ALREADY PRESENT — retired** | — |
| 2 | Maturity is a projection of evidence | **ADAPTED** | `shared/business-types/readiness.ts`, `verticalReadiness.test.ts` (`73dc6924`) |
| 3 | An epistemic vocabulary is real only when the store refuses violations | **ADAPTED, PARTLY INVERTED** | `migrations/0238`, `0239`, `evidenceClaimsIntegrity.test.ts` (`708542d2`) |
| 4 | Company authority is not authority over any person's phone | **ADAPTED** | `sendPushToPerson` recipient check, `pushDispatchSemantics.test.ts` (`a37affc8`) |
| 5 | A receipt must not claim more than the effect achieved | **ADAPTED** | `PushResult` status vocabulary, nudger retry (`a37affc8`) |
| 6 | A gate must be falsified against the semantic defect, not the symbol | **ALREADY LEARNED HERE — recorded** | `CLAUDE.md` "The two laws that cost the most to learn" (`f8332db1`) |
| 7 | Operating state is one predicate, not a hand-copied fragment | **ADAPTED** | `server/services/orgOperating.ts`, `orgOperating.test.ts` (`7cf0cef8`) |
| 8 | A ceiling belongs to the action class, not to whoever issues the grant | **ADAPTED** | `isNeverPromote()` in `agentAuthorityGate.ts`, `agentAuthorityCeiling.test.ts` (`740deb35`) |
| 9 | A carrier's acceptance is not a delivery, on a regulated record | **ADAPTED — second application of #5** | `"sent"` in `PERIODIC_STATEMENT_DELIVERY_STATUSES` (`21ecc76d`) |
| 10 | An omitted risk flag is not a declaration of safety | **ADAPTED** | required `movesMoney` / `outwardClass` on `HandSpec`, `handRiskDeclaration.test.ts` (`835e0e9c`) |
| 11 | A guess is not a known value, on the path the law governs | **ADAPTED** | `resolveZoneForPhone()` in `tcpaCompliance.ts`, `tcpaZoneGuess.test.ts` (`a6df3b60`) |
| 12 | A verifier may only report an outcome it observed | **ADAPTED** | `recordSelfReport()` in `outcomeVerificationLoop.ts`, `outcomeVerificationObservation.test.ts` (`c937eb2e`) |
| 13 | A dispatch receipt is not evidence the action worked | **ADAPTED — second layer of #12** | `outcomeOf` rule 4 + `outcomeBasis` adoption, `outcomeObservationVote.test.tsx` (`1674e2f5`) |
| 14 | Provenance travels with the value, not with the lookup | **ADAPTED** | `eitherField()` in `landProfile.ts`, `landProfileProvenance.test.ts` (`8b4740a5`) |
| 15 | Authority belongs to the source, not to the transport | **ADAPTED** | `SOURCE_AUTHORITY_DEMOTIONS` in `enrichmentToClaims.ts`, `claimAuthoritySource.test.ts` (`96b0b3ad`) |
| 16 | A cost bound must measure the thing it bounds | **ADAPTED** | `server/jobs/decisionExecutorTick.ts`, `decisionExecutorSpendScope.test.ts` (`893da34a`) |
| 17 | A secret is never compared with `===` | **ADAPTED** | `server/utils/secretEquals.ts`, `secretComparison.test.ts` (`bb6c4182`) |
| 18 | A route no flag governs is not a route that is off | **ADAPTED** | `controlledRoutes` in `/api/config/features` + `resolveRouteEnabled`, `featureFlagControlScope.test.ts` (`daa749b6`) |
| 19 | A route's auth must not depend on its line number | **PARTIALLY ADAPTED — trap frozen, not removed** | `apiCatchAllOrdering.test.ts` (`226e071f`) |
| 20 | Trust may only be granted by evidence the agent did not author | **ADAPTED** | `server/services/trustDelta.ts`, `trustFromEvidence.test.ts` (`f84c4f4a`) |
| 21 | A frozen record cannot promise a distinction its input type forbids | **ADAPTED** | required-nullable `reviewDueAt`, `decisionSnapshotFidelity.test.ts` (`0fd28602`) |
| 22 | A measurement that failed is not a measurement of zero | **ADAPTED** | `getAdPerformance` refuses, `adPerformanceMeasurement.test.ts` (this commit) |

---

### 1 — "A caller cannot declare its own safety" → RETIRED, already present

**Foundry's version.** Derive policy from trusted server context; fail closed on
missing facts; refuse a caller's conflicting assertion.

**The AcreOS surface tested.** `emailService.ts` takes `purpose?: 'system' |
'counterparty'` from the caller, which looks exactly like the defect: a caller
declaring the lane that decides whether BYO identity is required.

**Why it was retired, not imported.** Two findings, both against HEAD:

- The founder has **explicitly ruled** that `purpose` stays optional and that
  "an explicit declaration is a decision of record and the guard does not
  second-guess it." Importing the invariant here would relitigate a standing
  decision — out of bounds regardless of merit.
- `disclosureTimingDispatcher.ts:104` already derives `purpose: recipient.lane`
  from server-side resolution, with the comment that it is done so the two
  "cannot drift apart." That is *better* than the fix the transfer would have
  proposed, and it was already there.

**Recording a retirement is the point.** A ledger that only lists accepted
transfers overstates what the exercise found.

---

### 2 — "Maturity is a projection of evidence" → ADAPTED

**Foundry's version.** An E0–E6 evidence ladder (`PROOF_PROGRAM.md`), with the
governing rule that "a test proves only its stated boundary." Notably, Foundry's
ladder is **documented only** — no type, no column, no ratchet. Its value is the
discipline it produced, not the vocabulary.

**The AcreOS defect.** All 15 verticals declare `maturity: "core"`. Exactly two
can show it. The guard that should have caught this — `customerPersonas.test.ts`
— asserts maturity only inside `if (displayName.includes("(waitlist)"))` /
`("(beta)")`, and measured, no persona display name contains either: 30 personas
iterated, 0 assertions made.

**What crossed:** the law that a declared level must be a projection of
evidence, and the discipline of refusing to promote on constructed rather than
executed proof.

**What did NOT cross:** E0–E6 itself. AcreOS gets four tiers named for what this
repository can actually demonstrate — `declared` / `surfaced` / `underwritten` /
`decided` — because a level AcreOS could never award from source would be
decoration. There is deliberately no `learning` tier: grading needs realized
outcomes, and `calibration.ts` already refuses a direction below six
comparisons.

**Result.** 13 of 15 overclaim; frozen and down-only. The useful finding is the
*shape*: every vertical has a real surface (4–7 modules, 2–5 templates, no
dangling ids) and thirteen stop dead before a recorded decision. **The gap is
the loop, not the surface**, so building more screens moves none of it.

The label is not rewritten automatically — that is a customer-facing claim and
therefore a founder decision (OD-5). What is not a founder decision is whether
the gap is visible and counted.

---

### 3 — "An epistemic vocabulary is real only when the store refuses violations" → ADAPTED, PARTLY INVERTED

**Foundry's version.** `reconstruction_claims` carries a closed status set as a
CHECK plus a BEFORE INSERT trigger enforcing the vocabulary's semantics, and its
judgment ledger is append-only via BEFORE UPDATE **and** DELETE aborts.

**The AcreOS defect.** `shared/schema/evidence.ts` declares "APPEND-ONLY BY
CONTRACT" and argues it correctly — "a row that can be updated is a row whose
history can be rewritten" — while `migrations/0227` created the table with **zero
constraints**. `authority = 'guess'` inserted cleanly. The immutability promise
rested entirely on the absence of an `updated_at` column, and Law 6 plus the
frozen `RESOLUTION_POLICY_VERSION` in decision snapshots both depend on it.

**What crossed:** put the vocabulary in the write path.

**WHERE ACREOS MUST NOT FOLLOW FOUNDRY.** Foundry blocks UPDATE *and* DELETE.
AcreOS must not: `evidence_claims.organization_id` carries `ON DELETE CASCADE`,
so a DELETE-refusing trigger makes a tenant permanently undeletable and puts the
table beyond reach of GDPR erasure. Copying the ledger wholesale would have
built an unerasable store of third-party personal data. **Erasing a record and
rewriting one are different acts.** UPDATE is refused; DELETE is not.

**And the analysis that proposed it was wrong on a detail that mattered.** The
suggested "exactly one value column is populated" constraint would have refused
the live writer on its next insert — `evidenceStore.ts:73-76` sets `value_text`
alongside `value_number`/`value_bool` as a human-readable rendering. The shipped
rule is derived from the reader at `:89-93` instead. Verifying against code
rather than the report is what caught it.

**What the same test then found.** `earnest_money_events` had implemented
append-only with rewrite RULES (`DO INSTEAD NOTHING`). A rewrite rule rewrites
PostgreSQL's own foreign-key check queries, so **`DELETE FROM organizations`
aborted for an organization with zero escrow rows** — the GDPR erasure path
(`orgDeletion.ts:122`) could not succeed for any customer, ever. Replaced with a
trigger; org deletion verified working. The retention question that exposes is
OD-6.

---

### 4 — "Company authority is not authority over any person's phone" → ADAPTED

**Foundry source.** `962ee94` (2026-08-17), `src/services/notifications/push.ts`.
Its gateway established the COMPANY, while `founder_id` arrived in the payload
and was used unchecked — so a caller holding one company's authority could push
to anybody's device. Fixed by requiring the recipient to be the product's owner
or an active team member (`belongsToCompany`).

**AcreOS defect.** `sendPushToPerson(userId)` deliberately ignores org scope,
which made its single argument the entire security boundary: whoever it named
got a notification on their phone. `team_members` is keyed
`(organization_id, user_id)`, so a person id is a GLOBAL identity spanning orgs
— reaching all of one human's devices is right for founder-plane content;
letting a caller name that human is not.

**AcreOS primitive reused.** `isFounderUserId()` from `server/services/founder.ts`.

**Smallest implementation.** One guard returning `not_permitted`. No Foundry noun
crossed — `belongsToCompany`, `products` and `team_members` stayed there.

**Complexity change.** +1 branch. **Liability change.** Strictly down: an
unauthenticated recipient argument on a channel that reaches a pocket.
**Founder burden.** Unchanged.

**Exit test.** `sendPushToPerson(<non-founder>)` returns `not_permitted`, not a
quiet zero — `pushDispatchSemantics.test.ts`.

**Cutover obligation.** Discharged: `isFounderUserId` had ZERO production callers
before this. Reachability ratchet 1401 → 1400, lowered in the same commit, and
not by a deletion — a governance primitive got its first consumer.

---

### 5 — "A receipt must not claim more than the effect achieved" → ADAPTED

**Foundry source.** Same commit. Both platform senders returned quietly when
credentials were unset, the caller counted that as delivery, and a `push_log` row
said `sent`. "A receipt for something that never left the building is worse than
no receipt, because it is the record anybody would check." Its senders now report
whether they dispatched, and the log says `not_configured`.

**AcreOS defect.** `{ sent: 0, failed: 0 }` meant four things and read as success
in all of them. `atlasPendingConfirmationNudger` stamped `pushedAt` on any call
that did not THROW — and none of the four throws — so the founder was never told
AND the row was never retried. The failure consumed its own retry.

**AcreOS primitive reused.** The existing `{ sent, failed }` return, extended
additively so the four existing callers are untouched.

**Smallest implementation.** A `status` discriminant with six values, each
distinguishing a case some caller in this repository actually behaves differently
about. AcreOS's `sendToSubscription` already returned `false` when VAPID was
unset — better than Foundry's pre-fix state — so only the caller-visible half
was missing.

**Complexity change.** One type, one pure `classify()`. **Liability change.**
Down: a founder-approval nudge that silently reached nobody now retries.

**Exit test.** A push with no registered device returns `no_destination` and the
nudger does not stamp `pushedAt` — `pushDispatchSemantics.test.ts` plus the four
non-delivering statuses swept in `atlas-pending-confirmation-nudger.test.ts`.

**NOT generalised.** §6 warns against a universal status vocabulary built for
symmetry. Other effect families (email, SMS, mail, Stripe, ads) are under
separate assessment and get their own distinctions only where a real consumer
branches on them.

---

### 6 — "Prove the semantic defect, not the symbol" → ALREADY LEARNED HERE

**Foundry source.** `6d7b3d3` "the discriminant decides, not the presence of a
field"; `5eaf7da` "the deputy gate could not see through a generic cast".

**Disposition: not imported — independently derived, and recorded as AcreOS's
own law.** AcreOS's completeness audit found six instances in one session
(name-keyed gates, a substring exemption, a projection compared against itself).
Foundry reached the same law from the other direction. Written into `CLAUDE.md`
rather than the constitution registry, because that registry holds FOUNDER
product decisions and this is engineering method — putting method there would
have been the same category error as importing a Foundry noun.

**Exit test.** For a consequential gate, a representative adversarial mutation
that changes REPRESENTATION while preserving the forbidden behaviour must fail
it. Applied so far to: the tenancy literal-0 check, the append-only trigger
shape, the public-claim scan, and the rendered landing proof.

---

---

### 7 — "Operating state is one predicate" → ADAPTED

**Foundry source.** `afbac4a` (2026-08-18): `companyMayIncurCost` read `status`
and `scp_status` directly — "complete when written, stale the moment migration
145 gave commercial entitlement its own field" — and the decision now comes from
one `operatingProduct()` predicate.

**AcreOS defect.** Three orthogonal columns decide whether AcreOS may act for an
org, and nothing read all three. The two newer axes were enforced only in the
HTTP path, chained from the session chokepoint a cron never traverses. Fifteen
background queries used a fragment predating both. So `subscriptionPauseGate`
promised "no new actions allowed (no new mail, no new comps, no Pax messages)"
while `paxNudges`, `autonomousDealMachine`, `growthAutomation` and
`lifecycleDispatch` kept sending — to exactly the customers told the product had
gone read-only.

**AcreOS primitive reused.** AcreOS's own three columns. No Foundry noun, and NO
NEW COLUMN — a fourth "operating" column would be the parallel truth this
removes.

**Smallest implementation.** One `orgActRefusal()` returning the reason, one
`orgMayActFilter()` Drizzle predicate. The HTTP gate now calls the same
function; its twenty existing tests pass unchanged, which is the
behavioural-equivalence check.

**Complexity change.** One module, minus a monolith section (extraction earned
`run-scheduled-jobs-linecount` 5823 → 5786). **Liability change.** Down.

**Exit test.** `orgOperating.test.ts` — mutation-tested 4/4, including the
symmetric half-resume bug the same reading found (an expired pause left a
webhook-written `'paused'` status forever).

**NOT generalised.** "May we ACT for this org" is deliberately NOT "is this org
a live customer". Eight counting sites — analytics, revenue, the fair-lending
audit — keep their own filter, and the test pins that split by name, so
converting one fails it too.

---

### 8 — "A ceiling belongs to the action class" → ADAPTED

**Foundry source.** §14/§15 — authority, expiry and re-grant; a grant may not
widen its own reach.

**AcreOS defect.** `checkAuthority`'s temporary-delegation block sat ABOVE the
`NEVER_PROMOTE` list and returned `allowed: true` for ANY action, so an "I'm
away, act for me" grant silently conveyed `modify_pricing_plans`,
`legal_document_change`, `process_refund_over_500` and `change_payment_processor`
— founder-only FOREVER in the DO-NOT-DO list. The list was a `const` declared
inside the function BELOW that early return: a ceiling only one branch can see
is not a ceiling.

**Smallest implementation.** The list hoisted to module scope behind one
`isNeverPromote()`, consulted by every path that raises authority. The guard
NARROWS the delegation rather than disabling it — an ordinary action still gets
the delegated level, or the fix would have removed a feature the founder uses.

**Complexity change.** One predicate, one `else if`. **Liability change.** Down,
sharply: this is the constitution's hard-stop list becoming enforceable rather
than documented.

**Exit test.** `agentAuthorityCeiling.test.ts` — a delegation must not convey a
hard stop, and trust may promote at most one step per call.

---

### 9 — "A carrier's acceptance is not a delivery" → ADAPTED, second application of #5

**Foundry source.** The same commit as #5: "a receipt for something that never
left the building is worse than no receipt, because it is the record anybody
would check."

**AcreOS defect.** `periodicStatements.deliveryStatus` was written `"delivered"`
on `result.success` — SES accepting a `SendRawEmailCommand`, custody and nothing
more. A §1026.41 periodic statement is a REGULATED record asserting a borrower
received their statement. `bounced` was in the vocabulary and nothing could ever
write it. And `delivered` is TERMINAL, so a bounced statement was recorded
delivered AND never re-attempted: the false record suppressed its own remedy.

**AcreOS primitive reused.** The vocabulary's own documented extension path —
`sent` added to `PERIODIC_STATEMENT_DELIVERY_STATUSES`, no migration needed
because the column is plain text and the set is declared in one place.

**Complexity change.** One value. **Liability change.** Down, on a regulated
record.

**NOT generalised.** One value in an existing enum, not a new status vocabulary
built for symmetry — §6.

---

### 10 — "An omitted risk flag is not a declaration of safety" → ADAPTED

**Foundry source.** §13 — maturity follows proof; absence of a claim is not a
claim of absence.

**AcreOS defect.** `HandSpec.movesMoney` and `outwardClass` were optional while
their siblings `isCustomerFacing` and `requiresApproval` were required, and
`witnessGrant.ts:112` reads exactly that field: `if (req.movesMoney &&
grant.bounds.denyMoney) return DENY(...)`. Omission meant both "this hand does
not move money" and "nobody declared", and the second was read as the first. Six
of ten hand files never mentioned either flag.

**Smallest implementation.** Both fields made required, so the compiler asks.
All six filled in explicitly with the reason at each site.

**Complexity change.** None — two `?` removed. **Liability change.** Down: the
money-custody hard stop now sees a declared answer rather than a default.

**Exit test.** `handRiskDeclaration.test.ts`.

---

### 11 — "A guess is not a known value, on the path the law governs" → ADAPTED

**Foundry source.** §12 — reachability has dimensions; a value that arrives by
inference is not the same value.

**AcreOS defect.** `tcpaCompliance` inferred a recipient's timezone from area
code and fell back to `America/New_York` for anything unmapped, then applied the
8 AM–9 PM window to the GUESS as if it were known. Measured: at 12:30 UTC New
York is 08:30 and Los Angeles is 05:30, so an unmapped area code cleared a send
at 05:30 recipient-local — violating §64.1200(c)(1) and contradicting the file
header's own promise that "when in doubt, it skews toward blocking". `907` and
`808` were unmapped, so 8 AM Eastern was 2 AM in Honolulu.

**Smallest implementation.** `resolveZoneForPhone()` returns `{ zone, inferred }`;
a continental-extremes envelope check applies ONLY when `inferred`. Known zones
are unaffected.

**Complexity change.** One returned boolean. **Liability change.** Down, on a
statutory path.

**Exit test.** `tcpaZoneGuess.test.ts`, mutation-tested 3/3.

---

### 12 — "A verifier may only report an outcome it observed" → ADAPTED

**Foundry source.** §16 — an effect receipt is not an outcome; and the
"observer independence" theme listed below as untested
(`119_development_observation_independence.sql`): a verification observation
whose payload carries its own expectation is self-confirming. This closes that
item.

**AcreOS defect.** `outcomeVerificationLoop` decides whether an autonomous
action HELPED, and `autonomyScoreV14` turns the answer into a 0.5–1.5 multiplier
on the autonomy score — the trust metric. Its fall-through branch produced that
verdict by re-reading `agentActionLog`, the ACTOR'S OWN record of its own
execution: `logEntry.outcome === "success" ? "positive" : "negative"`. Three
defects in one line.

1. Eight of the ten sites that write that column write the literal `"success"`
   at ISSUE time — `predictiveAutoscaler` writes it beside
   `output: { scheduled: true }, durationMs: 0` — so a dispatch receipt scored
   equal in weight to "the lead progressed to qualified after our follow-up".
2. The column's domain is `success | failure | escalated | pending` and
   `agentAuthorityGate` writes all four, so everything not exactly `"success"`
   fell into the false branch: an action correctly ESCALATED to a human became a
   NEGATIVE outcome that lowered the autonomy score. The loop put downward
   pressure on the one behaviour the constitution most requires.
3. `agent_action_log` has no `organization_id` at all; the driving query had no
   organization predicate; entity lookups matched on primary key alone. Each
   org's multiplier was computed from every other org's actions.

**Corroboration.** `check-org-scoped-fetch` had ALREADY baselined
`verifyFollowUp` and `verifyDealRiskFlag` under rule 2, "has an org, resolves by
id anyway". The tenant half was a known, registered defect; both entries are
deleted in this commit.

**AcreOS primitive reused.** The existing `VerificationResult` shape. The
never-produced `"pending"` member is replaced by `"unverified"`, a state that is
actually produced.

**Smallest implementation.** The fall-through branch returns `"unverified"` and
records the self-report in the reason string, plainly labelled as testimony
about EXECUTION. `unverified` is excluded from the quality denominator rather
than averaged in — "we could not look" is not "it had no effect".

**Complexity change.** One interface replacing four `any` parameter lists
(`colon-any` 2950 → 2942). **Liability change.** Down. This LOWERS autonomy
scores that self-report had inflated; that is the correction, not a regression.

**Exit test.** `outcomeVerificationObservation.test.ts`, mutation-tested 7/7 —
including restoring the ternary, fixing only the escalation half, averaging
`unverified` back into the denominator, and dropping either tenant predicate.

**NOT generalised.** No universal observation framework. The four typed
verifiers already observed real world state and are unchanged apart from tenant
scoping; only the branch that invented a verdict was replaced.


---

### 13 — "A dispatch receipt is not evidence the action worked" → ADAPTED, second layer of #12

**Foundry source.** §16 again, and §18 (learning does not create authority).
Entry 12 fixed a verifier that re-read the actor's log; this is the same
invariant one layer down, where the actor's own dispatch result votes on its own
efficacy.

**AcreOS defect.** `outcomeOf` rule 4 — whose own docstring calls it "did it
even run" — returned a full-weight `"success"` for `dispatchSuccess === true`,
the same vote weight as a founder's explicit approval, and
`statsFromExperiences` counts every non-pending vote once. Those votes become
`PlayStats`, and `efficacy.ts` samples a Beta-Bernoulli posterior over them to
PICK THE NEXT PLAY. A play that mailed two hundred people who all ignored it
accrued two hundred successes and a posterior mean near 1.0, beating a play with
one real founder approval at 0.67. The system learned to prefer whatever
dispatches cleanly. The same vote reaches `domainAutonomy`, so the receipt also
fed autonomy promotion.

**The more instructive half.** `outcomeBasis()` already drew the correct
distinction — "lets callers refine the causal model from real CONSEQUENCE only,
never the execution proxy" — and had ZERO production callers. The repository had
written the rule down in a function nothing called while breaking it in the
function everything called. Third recorded instance of CLAUDE.md's second law,
after `publicMaturityOf` and `isFounderUserId`.

**AcreOS primitive reused.** The existing three-value `ExperienceVote` and the
existing `outcomeBasis`. No weighting system was added to `PlayStats`: a
weighted vote would have been a second learning architecture, and §5's warning
against building one applies here as much as it did to push.

**Smallest implementation.** One branch deleted. `dispatchSuccess === true`
returns `pending`; `dispatchSuccess === false` still votes `failure`.

**The asymmetry is the point, not an oversight.** A send that never left
conclusively did not help; a send that left proves only that it left. The eval
gate above rule 4 was ALREADY asymmetric in exactly this way — a failing score
votes, a passing score never voted on its own — so rule 4 was the single rule
that let a proxy vote in the positive direction. It now matches its neighbours.

**Complexity change.** Down, one branch. **Liability change.** Down. Far fewer
success votes, so most plays sit near the uniform `Beta(1,1)` prior for longer
— which is this model's own documented cold-start behaviour and the honest
description of a system that has dispatched a lot and confirmed little.

**Adoption, not just semantics.** `getRecentStory` now returns `basis`, the
founder's story renders it as the badge's attribution, and `unreached-exports`
dropped 1400 → 1399. The rule is consulted by the product, not only by a test.

**Downstream state proved (§8, §25).** Making a clean dispatch non-voting turns
`pending` from an edge case into the majority state, and `voteBadge` returned
`null` for it — a silently absent badge reads as a rendering fault, not as "we
don't know yet". The row now says "too soon to tell", asserted against the
rendered DOM rather than the component source.

**Exit test.** `outcomeObservationVote.test.tsx`, mutation-tested 6/6 —
restoring rule 4's success half; over-correcting into symmetry by silencing the
failed-dispatch vote; reverting `outcomeBasis` to its presence check; dropping
the basis from the story; re-hiding the pending badge; and a vacuity mutation
that renders the pending badge for every vote.


---

### 14 — "Provenance travels with the value, not with the lookup" → ADAPTED

**Foundry source.** §17 — an assertion is not canonical truth. Here the
assertion is the source label, and nothing checked it against the value it
described.

**AcreOS defect.** `landProfile.ts` opens with an honesty contract: "we NEVER
fabricate a value. If a field cannot be honestly populated it is OMITTED." That
covered the VALUE and said nothing about where it came from, which left the more
dangerous half open — a REAL value wearing the wrong source label passes every
"did we invent a number" check while telling the customer to trust it as county
data.

`LandField.source` is documented as "what the provenance chip shows the
customer", `asOf` as "the date the AUTHORITATIVE source last updated this fact",
and `confidence` is DERIVED from the source label (`/county|assessor|gis/i` →
80). So a mislabel publishes a customer-typed value back to that customer as an
authoritative county record, dated to the county's refresh, at 80% confidence.

Two fields could take their value from the county parcel OR the customer's own
property record:

- `legalDescription` used `parcel.legalDescription ?? property.legalDescription`
  under an unconditional "County GIS" / "authoritative".
- `acreage` DID branch its label and classification on which value it got — the
  author knew the rule — but still passed `prov["parcel_data"]`
  unconditionally, and `field()` prefers `prov.source` over `fallbackSource`.
  When a parcel lookup returned provenance but no acreage, the owner's own
  number went out with the county's source, confidence and date. **The site that
  looked correct was wrong in a narrower window than the one that looked wrong**,
  which is why the fix is a helper rather than two edits.

**Smallest implementation.** `eitherField()`: the enriched value and its
provenance are passed together, the owned value is passed with no provenance at
all. Passing value and provenance as independent arguments is what made both
defects expressible.

**Complexity change.** One helper, two call sites simplified. **Liability
change.** Down, on a customer-facing data surface governed by the DO-NOT-DO
list's fabrication hard-stop.

**Exit test.** `landProfileProvenance.test.ts`, mutation-tested 4/4 — restoring
either call site, leaking the enriched provenance onto the owned value, and an
over-correction that labels everything "Owner-entered". The general rule is
swept across the whole profile (no `authoritative` field may carry a
customer-supplied value) rather than pinned to the two known sites, with a
vacuity guard proving the fields are still present.

**Claims I checked and did NOT act on.** `routes-properties.ts:428-443` was
flagged for letting customer-typed values into evidence. It does — deliberately
and correctly: `source: "customer_edit"` is explicit, the observation log stores
it verbatim with no authority inference, both readers (`parcel-biography`,
`parcelDeltaDetector`) carry `source` through rather than collapsing it, and the
one consumer that could raise an alert is documented as READ-ONLY pending
false-positive review. A customer correcting a wrong county record is the stated
design intent, and the provenance says so.

The same read flagged
`enrichmentToClaims.ts:217/239/255` for discarding provenance by writing
`observedAt: null`. False positive: the `wildfireHazard` and `broadband`
sub-objects carry only `source`, with no date field anywhere in their types, so
there is no `asOf` to discard and `null` is the honest answer — the file's own
header says resolution then ages the claim from `fetchedAt`, which is also
conservative. Recorded here because a transfer ledger that lists only the
findings that survived is a biased record of the reading.


---

### 15 — "Authority belongs to the source, not to the transport" → ADAPTED

**Foundry source.** §17 again — an assertion is not canonical truth. In entry 14
the assertion was where a value came from; here it is how far the source may be
trusted.

**AcreOS defect.** `enrichmentToClaims` is the anti-corruption boundary where a
provider-shaped result becomes AcreOS evidence. It stamped every claim with one
module constant, `BROKER_AUTHORITY = "authoritative"`, justified as "open
government layers are systems of record for the facts they publish". True of
most of them — and the constant named the PIPE rather than the publisher, so it
could not express the case where it is not.

One category is not. The FCC Broadband Data Collection is the federal system of
record for availability FILINGS, but the coverage it publishes is
ISP-SELF-REPORTED and known to overstate service. **The repository already knew
this**: `landProfile.ts` scores it 75, below county GIS at 80, and says so in a
comment. The evidence layer contradicted that assessment in the same repo.

And this is not a display concern. `authorityRank` puts `authoritative` (3)
above `estimate` (2) and resolution takes the higher, so a carrier's own filing
about its own coverage WON against an honest estimate of the same fact.

**AcreOS primitive reused.** The existing `EvidenceAuthority` domain, which
already had `estimate` for exactly this. No new tier, no new column.

**Smallest implementation.** A dated demotion register plus
`authorityForSource()`. One entry. The default stays `authoritative`, because
demoting the genuine systems of record (FEMA, SSURGO, NWI, 3DEP, PLSS, county
assessor) would be the same error pointing the other way.

**Kept private.** An earlier draft exported the helper and the register so the
test could read them, and the reachability gate named that shape: a symbol whose
only consumer is its own test. Both are module-private; the assertions run
through `claimsFromEnrichment`, which is also the stronger surface — it catches
an emission site that hardcodes an authority rather than deriving one.

**Complexity change.** One register, one function. **Liability change.** Down,
on the boundary that decides what AcreOS treats as fact.

**Exit test.** `claimAuthoritySource.test.ts`, mutation-tested 5/5 — restoring
the transport-wide constant; demoting only one of the two broadband claims; a
register pattern that matches nothing the broker emits; an over-correction that
demotes every source; and the broker silently renaming its own label, which
would otherwise make the demotion stop applying with no test noticing.

**Deliberately NOT decided here.** USFS Wildfire Hazard Potential is a MODELED
raster, and `EvidenceAuthority` has a `modeled` tier it is not using. Unlike
broadband, nothing in the repository contradicts its current `authoritative`
label — `landProfile.ts` groups it with the system-of-record layers at 85. That is a
domain judgement, not a defect this reading can evidence, so it is left alone
and recorded rather than silently changed.


---

### 16 — "A cost bound must measure the thing it bounds" → ADAPTED

**Foundry source.** §16 read from the cost side: a measurement attributed to an
actor must be a measurement OF that actor.

**AcreOS defect.** The autonomous decision executor runs under a per-tick spend
ceiling added by a 2026-06-05 cost audit that named this job "the single
most-likely $30/day burn source". The ceiling was enforced against
`sumAiSpendUsdSince`, which summed EVERY row in `ai_telemetry_events` in the
window — Pax chat, enrichment summarisation, the CMO pipeline, all of it.

1. The executor deferred on spend it did not cause. On the $1.00 / 30-min
   default, a busy Pax hour starves it — silently, one log line.
2. The post-tick line read "this tick spent $X across N items" when $X was all
   platform AI spend in the window. That is the number a human reads to decide
   whether the executor is the burn source, so a misattributing measurement is
   exactly what would confirm the wrong diagnosis.

**AcreOS primitive reused.** `intelligence/budget.ts` already maps task types to
budget categories and has an `executor` bucket, consulted inside `aiRouter`
before every call. The scheduler was not using it. `EXECUTOR_TASK_TYPES` is now
the list `categoryFor` itself branches on — not a copy, so the SQL filter and
the category function cannot disagree about what "executor" means.

**Not a fifth gate.** The stack documented in `aiCostCeiling.ts` (per-category
soft budget, per-org soft quota, platform daily fail-closed ceiling) is
untouched. This is the scheduler's own admission control, now measuring the
subsystem it admits.

**A claim I checked and REJECTED.** The reading flagged this site as "sums
platform-wide with no org predicate", implying a tenancy defect. It is not one.
This bounds AcreOS's OWN AI spend on its OWN autonomous work — not customer
money — so platform-wide is the correct scope, and the test now PINS the absence
of an org predicate so nobody adds one by analogy with the tenant-scoping work
in entries 7 and 12.

**Ratchet earned, locked in.** `run-scheduled-jobs-linecount` 5786 → 5721. The
bound was module-private inside the monolith, which is precisely why nobody
could assert on what it measured; adding a test seam in place would have pushed
the count UP. Extraction is what the ratchet asks for.

**Exit test.** `decisionExecutorSpendScope.test.ts`, mutation-tested 4/4 through
the production entry point — summing every AI call again, failing closed on
unreadable telemetry, dropping the deferral, and always deferring. Both the
window constant and the sum are module-private: an earlier draft exported them
for the test and the reachability gate named that shape.


---

### 17 — "A secret is never compared with `===`" → ADAPTED

**Foundry source.** §11 (semantic mutation — falsify the shape, not the
identifier) and §13 (absence of a claim is not a claim of absence — here, an
unconfigured secret must not authenticate).

**AcreOS defect, part one.** Secrets were compared in two shapes, treated
differently for no reason anyone chose. HMAC digests — Twilio, Meta webhook
signatures, inbound email, signing tokens, wire instructions, API keys — went
through `crypto.timingSafeEqual` at eight sites, consistently. Plain header
tokens — `DEPLOY_BOT_TOKEN`, `METRICS_TOKEN`, `PULSE_SHARED_SECRET`,
`UPTIME_PROBE_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN` — used `===` at five,
consistently. The distinction was how the secret is ENCODED, not whether it is a
secret, and the naive half was the half compared directly against
caller-supplied bytes.

**Part two, which is the serious one.** `===` also accepts
`undefined === undefined`. `verifyMetaWebhook` compared
`token === process.env.META_WEBHOOK_VERIFY_TOKEN` with no truthiness guard, and
its caller passes `req.query["hub.verify_token"] as string` — a cast, not a
check. Env var unset plus query param absent means both sides are `undefined`,
the comparison passes, and the handler echoes `req.query["hub.challenge"]`
through `res.send()`, which Express serves as `text/html`. An unauthenticated
reflected-content endpoint on the AcreOS origin. The other four sites guarded
with `if (expected)` first; nothing made that guard mandatory, which is why one
site did not have it.

**What held it shut, and why that is not reassuring.**
`registerEliteFeatureRoutes` runs at `routes.ts:2630`, after the
`app.use('/api', isAuthenticated, …)` catch-all at `:1572`, so an
unauthenticated GET is 401'd before the handler runs. Two consequences, both
worse than they look:

- **The Meta lead-ads webhook cannot work at all.** Meta's servers carry no
  Clerk session, so the verification GET and the signed POST are both 401'd.
- **The documented fix for that would open the bypass.** The comment block at
  `routes.ts:1551-1568` tells developers to register exactly this kind of route
  BEFORE the catch-all, and it has already been done three times (`/api/docs`,
  e-sign, transparency).

A latent vulnerability held shut by an unrelated bug, where fixing the bug the
documented way opens the vulnerability. So the fix went into the comparison, not
the routing.

**Smallest implementation.** One `secretEquals()`: hash both sides to a fixed 32
bytes, `timingSafeEqual`, and refuse non-string or empty input on either side.
Hash-then-compare is the pattern `services/apiKeys.ts` already documents, and it
avoids the length check that raw-byte comparison needs (`timingSafeEqual` throws
on length mismatch). Failing closed on an unconfigured secret is structural
rather than a convention every call site must remember — which fixes both parts
with one property.

**Complexity change.** One 12-line function; five call sites got shorter.
**Liability change.** Down, on authentication.

**Exit test.** `secretComparison.test.ts`, mutation-tested 5/5: the Meta webhook
back to `===`; `secretEquals` treating undefined as a match; always-true;
always-false (which breaks the integration and is caught by the vacuity guard);
and a brand-new naive comparison appearing in an unrelated file. The scan
targets the SHAPE — a variable bound from a secret-looking `process.env.*`,
later compared with `===`/`!==` — not the five known identifiers, so renaming a
token or adding a sixth fails it. Its own vacuity guard runs first, against a
synthetic file.

**Deliberately NOT changed.** The route ordering. Moving the Meta webhook above
the `/api` catch-all would make lead-ads ingestion live — a functional change to
an outward integration, on a surface the constitution makes founder-only. That
is a product decision, not a defect fix. Recorded here instead, with the fact
that the webhook is currently non-functional.


---

### 18 — "A route no flag governs is not a route that is off" → ADAPTED

**Foundry source.** §13 — absence of a claim is not a claim of absence. Same
shape as the autopilot hands' optional `movesMoney` (entry 10): a missing value
standing in for a decided one, here on the path that decides what a person sees.

**AcreOS defect.** `/api/config/features` returns `enabledRoutes` — the union of
routes controlled by flags whose state is `'on'`. The client read it as an
app-wide ALLOW-LIST:

```
if (data.enabledRoutes.length === 0) return true;   // "flags unused"
return data.enabledRoutes.includes(route);          // otherwise allow-list
```

So the moment ANY single flag was switched on, the list became non-empty and
every route missing from it was denied — including every route no flag has ever
governed. `layout-sidebar.tsx:939` drops such a module from the nav and
`App.tsx:615` renders `<NotFound />`, so **turning on one feature flag would
have hidden all five customer doors and 404'd them.**

The empty-list heuristic is exactly true while nothing is enabled, which is the
only state anyone had been in — so the defect was invisible and untested.

**Smallest implementation.** The server sends `controlledKeys` /
`controlledRoutes` — every key and route any flag governs, whatever its state —
so the client can tell "no flag governs this" from "a flag governs it and it is
off". No new table, no new flag state.

**Deliberately unchanged.** Flags in `tier:X` / `beta` / `founder-only` are in
neither the enabled nor the disabled list, because that endpoint has no user
context to resolve them. They are therefore CONTROLLED and NOT ENABLED, so their
routes stay hidden for everyone — the same conservative answer the nav gave
before any flag was on, with audience resolution still server-side.

**Complexity change.** Two derived arrays; the client rule got one line longer
and one heuristic shorter. **Liability change.** Down, on total product
availability.

**Exit test.** `featureFlagControlScope.test.ts`, mutation-tested 7/7 —
restoring the allow-list heuristic, over-correcting to show everything, the same
defect on the key path, deriving `controlledRoutes` from enabled flags only,
dropping the fields from the response, dropping them from the catch path only,
and the legacy fallback falling shut instead of open. The five doors are derived
from `MOBILE_DOORS` + `NAV_ITEM_MAP`, not typed into the test, and a vacuity
guard proves that derivation still yields five.

**One of those mutations initially survived, in my own gate.** The "server sends
the field" check searched the whole handler body, so dropping the fields from
`res.json()` while leaving their `const` declarations kept it green — the
identifier was present, the behaviour was not. Rewritten to assert on every
`res.json()` payload the handler can return. The first law, caught applying to
the gate written to enforce it.

**Noted, not fixed.** `routes-admin.ts:3031` declares a SECOND
`/api/config/features` handler. `routes.ts:405` registers first and wins, so the
admin one is dead code that would serve a response without the deny-lists or the
new fields if the order ever changed.


---

### 19 — "A route's auth must not depend on its line number" → PARTIALLY ADAPTED

**Foundry source.** §12 — reachability has dimensions; a thing reachable by one
path is not thereby reachable by another.

**AcreOS defect.** `server/routes.ts` mounts two routers with
`app.use('/api', isAuthenticated, getOrCreateOrg, <router>)`. Express runs
`app.use(path, …)` middleware for EVERY request under that path, matching route
or not — so both lines apply auth to every `/api/*` route registered after them.
A route's real auth depends on where in a 5,000-line file it was registered,
which is invisible at the route's own definition site.

**It has already bitten three times.** `/api/docs`, the public e-sign endpoints
and the transparency report were each registered after the catch-all, each 401'd
anonymous callers, and each was fixed by moving the registration earlier. The
file carries three comment blocks saying so. Comments are not a gate.

**And it is currently shielding a bug.** It 401s
`GET /api/webhooks/meta-lead-ads` before the handler runs, which hid the
fail-open comparison fixed in entry 17 — and means the Meta lead-ads webhook
cannot function at all, since Meta's servers carry no Clerk session.

**Why this is PARTIAL.** The structural fix is to mount each router at the
prefixes it actually owns. `epicServicesRouter` has six clean ones, but
`fieldScoutRouter` spans `/properties`, `/leads`, `/voice` and `/field-scout`,
and scoping the catch-all would strip accidental auth from every later route
that never declared its own. Doing that safely means auditing all of them first
— its own wave, not a tail-end addition to this one. Shipping the risky half of
a fix because the safe half was easy is how a wave reports success for the part
it built.

**What landed.** `apiCatchAllOrdering.test.ts` freezes the trap: exactly two
catch-alls (a third would extend the region silently), and the three
anonymous-by-design registrations pinned ahead of them so the regression that
has happened three times cannot happen a fourth. The file states plainly that it
is a source-order check and not a request-level proof.

**Exit test.** Mutation-tested 4/4 — moving `/api/docs` below the catch-all,
moving the e-sign registration below it, adding a third catch-all, and deleting
the transparency registration outright. A fifth mutation changed only quoting
and correctly stays green: the scan is quote-agnostic, so that is a control on
the gate rather than a miss.


---

### 20 — "Trust may only be granted by evidence the agent did not author" → ADAPTED

**Foundry source.** §18 — learning does not create authority. Third and most
consequential instance in this phase, after the outcome verifier (entry 12) and
the autopilot efficacy vote (entry 13). **This is the one that actually moves
authority**: `agentAuthorityGate.checkAuthority` promotes a level-2 action
("recommend and wait") to level 1, and level 1 to level 0 (full autonomy), on
`trustScore` alone.

**AcreOS defect, dimension 2.** `+1` trust when `agentActionLog.outcome =
'success'` covered ≥80% of an agent's actions that day, then ×1.5 on a
three-day streak. That column is the actor's OWN receipt — eight of the ten
sites that write it write the literal `"success"` at ISSUE time
(`predictiveAutoscaler` beside `output: { scheduled: true }, durationMs: 0`),
and the tenth writes `result.success`, "the executor did not throw". An agent
earned authority by asserting its own success.

The file already carried the argument against itself: dimension 3 was added
"NEW in v5" under the comment *"Real outcome verification: did the action
actually HELP?"*, reading `outcomeVerificationQueue`, whose verifiers check
actual database state. Dimension 2 was left granting the same +1.

**Dimension 1.** Accuracy counted `status = 'approved' OR status =
'auto_resolved'` over ALL items. `auto_resolved` means the autonomous executor
closed it with no human involved, so an agent that never escalated scored 100%
and gained trust — downward pressure on escalation, the same defect entry 12
found pointing the other way. Auto-resolution is now excluded from the numerator
AND the denominator: it is not evidence of correctness and not evidence of
error, and averaging it in either direction invents a result. Excluding it from
the denominator too is the point — the mirror-image error would punish an agent
for working, and a mutation proves the test catches that.

**AcreOS primitive reused.** Its own three dimensions and its own thresholds.
Nothing new was scored; two sources stopped granting.

**The asymmetry is deliberate, again.** A run of FAILED actions still costs
trust: a failed action is conclusive, a succeeded one proves only that it ran.
Same rule as entry 13, and a mutation that removes the penalty for symmetry's
sake fails.

**Smallest implementation.** `trustDeltaFrom` — pure, no DB, no clock — is now
the only place the three dimensions are weighed. It lives in its own module
because an exported symbol whose only non-local consumer is a test is what the
reachability gate calls built-but-unwired; `trustEvolution.ts` imports it, so
the rule has a real cross-module production caller.

**Complexity change.** One pure function extracted; `trustEvolution.ts` 301 →
279 lines. **Liability change.** Down, on the number that decides what the
system may do without asking.

**Exit test.** `trustFromEvidence.test.ts`, mutation-tested 5/5 — self-reported
successes granting trust again, `auto_resolved` counted as approval,
`auto_resolved` in the denominator only, the caller bypassing the rule, and
dropping the failure penalty. Plus a vacuity guard that the rule can produce a
positive delta at all, so a broken always-zero implementation cannot pass the
first two groups.

**A second gate of mine that a mutation survived.** The adoption check asserted
`code.toContain("trustDeltaFrom(")`, which the function's own `export function
trustDeltaFrom(` satisfies — replacing the call site with an inline lambda left
it green. Same first-law failure as the `featureFlagControlScope` one, in the
same phase: **an identifier's declaration is not its use.** Now scoped to the
body of `runTrustEvolution`.


---

### 21 — "A frozen record cannot promise a distinction its input type forbids" → ADAPTED

**Foundry source.** §13 — absence of a claim is not a claim of absence. Third
instance of that shape in this phase, after the hands' `movesMoney` (entry 10)
and the feature-flag allow-list (entry 18).

**AcreOS defect.** `DecisionSnapshotBody.reviewDueAt: Date | null` is documented
as *"recorded explicitly, so a decision that will never be reviewed is
distinguishable from one whose review was forgotten"*. But
`DecisionSnapshotInput.reviewDueAt` was `?: Date | null` and `freezeDecision`
wrote `input.reviewDueAt ?? null` — so an omitted input became `null`, and the
two states the body promises to distinguish were the same value. The record's
own docstring described a property the writer removed.

Its sibling two fields up already had the answer: `strategyPackId: string | null`
is required-nullable, "recorded as null rather than omitted, so 'no pack' is
explicit".

**Smallest implementation.** The input field is required-nullable, and
`freezeDecision` no longer coalesces. The HTTP boundary in `routes-decisions.ts`
keeps the wire field optional for back-compat and normalises there — one visible
place, rather than silently inside the writer.

**Complexity change.** One `?` removed, one explicit normalisation added.
**Liability change.** Small and real: the compiler now asks at each site, and
five test fixtures had to say which they meant.

**The interesting part is that my first version had NO GATE.** Both mutations —
reverting the field to `?:` and restoring the coalesce — passed, because every
call site now supplies the field anyway, so an optional type compiles
identically. A type-level invariant needs a type-level assertion: a
`@ts-expect-error` on a call that omits the field. Revert the type and the
directive becomes unused, tsc emits `TS2578`, and `check-tests-typecheck` fails.
The runtime half asserts `freezeDecision` returns `undefined` rather than
manufacturing `null` when the field is absent, with a vacuity guard that an
explicit `null` still travels as `null`.

**Exit test.** `decisionSnapshotFidelity.test.ts`, mutation-tested 2/2 after the
gates were added — and 0/2 before them, which is why they exist.


---

### 22 — "A measurement that failed is not a measurement of zero" → ADAPTED

**Foundry source.** §16 once more, from the measurement side — and AcreOS's own
standing rule: refuse, do not fabricate.

**AcreOS defect.** `getAdPerformance` caught every Meta Insights API error and
returned `{ impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0, cpl: 0,
ctr: 0 }`. Its only caller is the founder-only stats route, which passes the
object straight to `res.json()`. So an unreachable API rendered as "0
impressions, 0 clicks, 0 leads, $0 spend" — indistinguishable from a campaign
that genuinely delivered nothing, and on the field that matters most it asserted
the OPPOSITE of the dangerous case: AcreOS's own ad account can be spending
while this reports it spent nothing.

Paid advertising is a founder instrument spending AcreOS's own money (founder
ruling 2026-08-13), and this is the surface the founder reads it on.

**Smallest implementation.** Throw instead of swallowing. The route already had
`catch (err) { Errors.internal(res, err) }`; swallowing in the service is what
made that catch dead code for this path. No new error type, no new status
vocabulary, no client change.

**The distinction that must survive.** A SUCCESSFUL call returning no rows still
yields zeros, and should — `data.data?.[0] || {}` is a real "no delivery in the
window". A mutation that throws on an empty result too fails the suite.

**Complexity change.** None. **Liability change.** Down, on the founder's view
of AcreOS's own ad spend.

**Exit test.** `adPerformanceMeasurement.test.ts`, mutation-tested 3/3 —
restoring the zero-fabricating catch, throwing without naming the campaign or
the upstream reason, and over-correcting into throwing on a genuine empty
result. The tests drive the real code path by answering its one outbound
`fetch`, and a vacuity guard reads real figures back so an always-throwing
implementation cannot pass.

### 23 — "A grant may not widen its own reach" → ADAPTED

**Foundry shape.** `120_development_authority.sql` refuses a development grant
whose path prefixes touch the constitutional ring, and the containment test is
written in both directions:

```sql
WHERE substr(g.value,1,length(r.value))=r.value
   OR substr(r.value,1,length(g.value))=g.value
```

A prefix inside the ring is refused, and so is a broad prefix that would
*contain* part of the ring. The point is not the SQL; it is that a scope entry
is checked at an explicit boundary rather than by string prefix, so no entry can
enlarge what it reaches by being written more loosely.

**The AcreOS instance.** Not authority grants — *exemption* lists. Three posture
gates each carried their own copy of the same loop:

```ts
for (const prefix of EXEMPT) if (path.startsWith(prefix)) return next();
```

- `server/middleware/subscriptionPauseGate.ts`
- `server/middleware/dunningAccessGate.ts`
- `server/middleware/viewerReadOnlyGate.ts`

`startsWith` reads an entry as a TEXTUAL prefix, not a PATH prefix. So
`"/api/health"` exempted `/api/healthz` and `/api/health-anything`;
`"/api/audit/export"` exempted `/api/audit/export-everything`; and a future
`"/api/deal"` — a plausible typo for `/api/deals/` — would have silently
exempted every write behind the Deals door from the viewer read-only
guarantee, which is a security guarantee: the org owner's own configuration of
who may write.

**Was it live?** No, and that was checked rather than assumed. The only mutating
route whose path shares one of these prefixes is
`POST /api/health/uptime-probe` (`server/routes.ts:551`), and it is
token-gated via `secretEquals` and never traverses `getOrCreateOrg`, so these
gates never ran on it. Recorded as a *foreclosure*, not an incident — under the
standing rule that a mutation which does not fire must be classified before
anything is changed, this is "the code is unreachable", not "the gate is weak".
The class is still real and one line wide, and the guarantee it protects is
consequential, which is why it was closed anyway.

**What was built.** `server/middleware/gateExemptions.ts` — one containment
predicate, consumed by all three gates (three production call sites, per the
standing law that a canonical function with zero production callers is not
canonical):

```ts
prefix.endsWith("/") ? path.startsWith(prefix)
                     : path === prefix || path.startsWith(prefix + "/")
```

The rule is strictly NARROWER than `startsWith` for every possible entry and
path — it can only ever remove an exemption, never add one. A predicate that
could widen under a refactor is the defect; the fix is not permitted to widen
either. No live route changed behaviour (verified: no mutating route sits at any
bare exempt path).

**How it is falsified.** `tests/unit/gateExemptionBoundary.test.ts` derives
hostile sibling paths from each gate's REAL exemption list and drives the REAL
middleware, so a gate that re-inlines `startsWith` tomorrow fails even though a
test of the helper alone would still pass. Mutation-tested: reverting
`dunningAccessGate` to the raw loop fails two assertions, naming all four leaked
paths. The reverse direction is asserted too — a rule that refused everything
would satisfy the boundary cases and brick billing, support and logout for
exactly the customers who most need them reachable.

**What it found on the way.** `viewerReadOnlyGate.test.ts` was pinning the
defect as the contract: it asserted `POST /api/user/preferencesanything` must be
allowed for a read-only account. Rewritten to the new truth rather than deleted,
per the wave-discipline rule — the invariant it was written for (every entry
reaches something) survives; only the false half is gone.

### 24 — "Refusing promotion into an unproven state at the write" → ADAPTED, and it found something worse

**Foundry shape.** `115_operating_promotion_freeze.sql` is four lines:

```sql
CREATE TRIGGER responsibility_operating_promotion_freeze
BEFORE INSERT ON responsibility_transitions WHEN NEW.to_state='operating'
BEGIN SELECT RAISE(ABORT,'responsibility_operating:not_earned'); END;
```

`operating` is documented as unproven, so no caller string and no successful
assisted action may advance into it — and the refusal is at the WRITE, not in
whichever service happens to be the only known writer today.

**What AcreOS had.** Two autonomy lanes, and the theme landed differently in each.

*Lane 1 — Pax send autonomy (`organizations.paxAutonomyLevel`).* The Foundry
shape held: `autonomous` is marked "(future)" in `autonomyGuardrails.ts`'s own
header and there is no promotion path in the codebase at all — the single write
is the circuit-breaker DOWNGRADE. Refused by absence. But the READ was the
inverse of safe:

```ts
return (org?.paxAutonomyLevel as AutonomyLevel) ?? "assisted";   // a cast, not a check
```

`??` catches only null/undefined, so `""`, a typo, or anything a later code path
wrote came back unchanged. Every consumer then asked
`if (level === "assisted" && !trustedApproval)` — a check for the ONE level that
must not send. So an unrecognised level was read as MORE permission than the
default and fell straight through to the guarded send, contradicting the
invariant those same call sites state in capitals. Fixed by parsing rather than
casting, and by replacing the polarity with one predicate,
`unattendedSendPermitted(level)`, consumed by all three send paths
(`server/ai/tools.ts` email + SMS, `financeAgent.ts` borrower notices). Asking
which levels MAY send means a level added later sends nothing until someone says
so; the old spelling would have granted it unattended sending on the day it was
added, silently, at every call site at once.

*Lane 2 — the VA agent engine. This is where the real defect was.* Not a
promotion into an unproven state: a CLASSIFIER that resolved the unknown
downward.

`inferRiskProfile` (`server/jobs/autonomousTaskProcessor.ts`) ended with a branch
commented **"Default: conservative"** returning `category: "data_write"` — base
risk 20 — for any action string it had no branch for. It was the opposite:

| | |
|---|---|
| `THRESHOLDS.supervised` | `{ auto: 25 }` |
| `evaluate()` | `if (riskScore <= thresholds.auto) → auto_execute` |
| `getAutonomyLevel()` with no config row | `"supervised"` |
| `vaAgents.autonomyLevel` column | `default("supervised")` |

20 ≤ 25, so **every unrecognised action auto-executed unattended at the DEFAULT
autonomy level.** Among the actions taking that branch was `execute_skill` — the
most general action the engine accepts, which dispatches an arbitrary skill id
through `skillRegistry.executeSkill`. The registry holds `sendEmail`,
`startCollectionSequence`, `processPayoff` and `prepareContract`.

**Reachability, read rather than assumed.** `POST /api/agents/tasks`
(`routes-ai.ts:53`, authenticated and org-scoped) inserts an `agentTasks` row
whose `input` is a free-form JSON column. `processBatch()` selects
`WHERE status='pending' AND requiresReview=false` — nothing excludes such a row.
`startAutonomousTaskProcessor()` is started at boot with no env gate
(`runScheduledJobs.ts:4028`); its own comment says the loop "AUTO-EXECUTES agent
actions". Three further enqueue paths exist (`queueDirectorGoal`, the
orchestration `create_task` trigger whose `taskInput` is org-configurable, and
`storage.createAgentTask`).

An independent adversarial pass — three skeptics, each assigned to REFUTE the
finding on reachability, consequence and scoring grounds — returned 0 of 3
refuted, and corrected the account in two ways worth keeping. First, there is a
MORE direct path than the one above: `POST /api/autonomous/tasks`
(`routes-autonomous-agent.ts:224`) validates `action` as `z.string().min(1)` and
calls `queueAgentTask`, which hardcodes `requiresReview: false`; the same router
exposes `POST /trigger-processor`, which calls `runOnce()` synchronously, so the
30-second poll was not even a delay. Second, the job is not merely ungated but
rostered `critical: true` with no `disabledWhen` clause (`jobRegistry.ts:177`),
unlike three of its neighbours — the deadman pages if it goes dark, so
production expects it continuously alive.

**A second defect fell out of the same reading.** `inferRiskProfile` could only
ever emit `offer`, `draft`, `research` and `data_write`. The `communication`
(40), `financial` (70) and `contract` (90) bands were declared in
`CATEGORY_BASE_RISK` and **dead** — no production caller could reach them. A
guard band nothing can emit is a guard that looks stronger than it is, which is
this repository's named signature defect in a new place.

**The adaptation.** The refusal went at the DECISION point rather than into each
classifier, because there turned out to be four of them:

1. `evaluate()` escalates any profile that is not explicitly `classified: true`,
   at every autonomy level. The flag is optional so existing callers compile, and
   *absent reads as unclassified* — a caller who forgets gets the cautious
   answer. The check sits ABOVE the auto-approve list on purpose: that list is
   keyed on `category`, and an unclassified profile's category is a guess, so an
   org that auto-approves `data_write` must not thereby launder everything nobody
   has classified.
2. It escalates rather than denies. The human sees it in the approval queue and
   the work still happens on a tap; denying would cancel legitimate tasks and
   remove a capability instead of governing it.
3. `SKILL_RISK` classifies `execute_skill` by the SKILL, since the risk is a
   property of the skill and a single answer for `execute_skill` would be either
   a lie about `sendEmail` or a lie about `lookupParcel`. It is cross-checked
   against `skillRegistry.getAllSkills()` in both directions, so a newly
   registered skill cannot inherit a classification nobody chose for it — until
   it is added it is unclassified and escalates. This is also what made the three
   dead bands reachable.
4. `classifyAction()` — the LLM classifier behind the preview route — had the
   same two shapes: `parsed.category || "data_write"` (a cast that also accepted
   categories outside the union, which index `CATEGORY_BASE_RISK` to `undefined`)
   and `catch { /* Fallback to conservative profile */ ... }`, so one malformed
   response or an LLM outage reclassified every action as safe enough to
   auto-execute. Now parsed against `KNOWN_CATEGORIES` (derived from the risk
   table, not re-listed), and the catch returns an explicitly unclassified
   profile: a classification that FAILED is not a classification of "low risk" —
   the second application of ledger entry 22.

**Exit test.** `autonomyRiskClassification.test.ts` drives the real classifier
into the real `evaluate()`. Falsified against four mutations, each of which
fires: re-spelling the fallback as a different low band, moving the check below
the auto-approve list, marking the unmapped-skill residue classified, and
dropping one skill from the map. `autonomyLevelFailsClosed.test.ts` covers lane 1
and is falsified against both the cast and the old polarity. `paxWitnessedSend`
and `paxPauseToolGate` now mock `unattendedSendPermitted` with the REAL
implementation rather than a stub, because a stubbed safety predicate makes a
suite agree with any implementation of it, including an inverted one.

**Complexity change.** One flag, one predicate, one map. **Liability change.**
Down, sharply, and pre-customer: the blast radius today is zero, which is exactly
why this was the moment to fix it rather than after Customer #1.

### 25 — "A ceiling belongs to the action class" → SECOND APPLICATION, in the autonomy engine

Ledger entry 8 established `isNeverPromote()` for agent authority: a ceiling is a
property of the ACTION CLASS, not of whoever issues the grant. The same sweep
that produced entry 24 found the rule had been learned there and not applied one
module over.

**The defect.** `evaluate()` consulted the org's `autoApproveCategories` list
BEFORE the score bands, and nothing capped what could go in it. The zod enum on
`PUT /agents/:type/config` admits all nine categories, `contract` included, and
that route carries `isAuthenticated + getOrCreateOrg` and no role check at all.
So `autoApproveCategories: ["contract"]` made `prepareContract` — base risk 90,
scoring 100 with its boosts — return `auto_execute`. For any org that set the
field, `CATEGORY_BASE_RISK` and `THRESHOLDS` were both entirely dead: the 0–100
score became a display value and the approval band an opt-out.

It held at autonomy level `manual` too, whose own comment reads "never
auto-executes" — `manual` + `autoApprove["contract"]` returned `auto_execute`
for a score-100 profile. A stated contract that the code contradicts is the
shape this repository keeps finding.

**The adaptation.** The cap is the level's own auto threshold:
`CATEGORY_BASE_RISK[category] <= thresholds.auto`. That preserves what the list
is FOR — letting a category skip the `+external` / `+irreversible` boosts that
push it over the line — while making it impossible to grant a category the level
would refuse at base risk. `manual` has an auto threshold of 0, so nothing is
auto-approvable there. Above the cap it falls THROUGH to the score bands rather
than escalating early, because the score may still permit the action on its own
merits; the list loses its override, not the action its chance.

No new hand-maintained list, which matters: a `NEVER_AUTO_APPROVE` register would
be a second thing to keep in sync with `CATEGORY_BASE_RISK`, and the whole defect
class here is a second source of truth for the same question.

**Exit test.** Three cases in `autonomyRiskClassification.test.ts`, driving the
real engine: the list cannot grant above the level at any of the three levels;
`manual` auto-executes nothing even with all nine categories approved; and the
convenience still works (`data_write` + boosts = 45 is auto-approvable at
supervised because its base 20 is under the 25 ceiling). Falsified by removing
the cap — two cases fire. The pre-existing test that pinned the neighbouring
claim ("contract stays above full_auto's threshold") passed throughout, because
it used the DEFAULT empty auto-approve list: the gate was real and simply never
asked this question.

### 26 — "A grant may not outlive its expiry" → ADAPTED, and the previous fix created it

**Foundry source.** §14/§15 grant expiry and revocation semantics, the same
family as ledger entry 8.

**The defect, and its provenance.** `ceoAbsenceService.activate()` materialised
its trust boost into `companyAgents.trustScore` — the permanent column that IS
the authority input, read by `trustAuthorityEscalation.getTier()` from
`executionEngine.validateSafetyGates` and `agentInitiativeEngine`.

An earlier session had already fixed the neighbouring half of this: `getCurrent()`
used to select on `isActive` alone, so an absence once switched on was active
forever. It now also refuses any row whose `endsAt` has passed. That fix is
correct, and it is what made this one live — `deactivate()` opens with
`const current = await this.getCurrent(); if (!current) return null;`, and it is
the only thing that subtracts the boost. After natural expiry the reversal became
**structurally unreachable**: the absence ends, the authority it conveyed stays.
`activate()` also opens by calling `deactivate()`, so a second activation stacked
a boost on top of one never taken away.

Seeded agents start at 50 = Observer, allowed only `generate_report` /
`store_learning`. 65 = Assistant unlocks `send_follow_up` and `send_alert`;
80 = Operator unlocks `send_churn_intervention`, a real customer contact;
95 = Director unlocks `advance_deal_stage`. Three "I'm away" commands walked an
agent the whole way with no path back. `updateTrustScore` clamps at 100 besides,
so even a reversal that DID run returned less than it took.

The module header asserted `activate()` had no production caller. It has one:
`ceoCommandBridge.ts` handles the `activate_absence` command, reached from
`POST /api/founder/intelligence/command`. Stale prose over live code — the exact
failure the institution's VERIFY step exists to catch, found by an adversarial
sweep that read the callers rather than the comment.

**The adaptation.** Stop materialising. `ceoAbsenceService.activeTrustBoosts()`
reports what an active, unexpired absence currently confers, and
`companyAgentService.effectiveTrustScore(codename)` adds it at the point of
authority. `companyAgents.trustScore` returns to meaning the agent's EARNED
standing and is never written by a grant. Expiry then needs no reversal to work,
which is the only kind of expiry worth having, and `deactivate()` becomes the
same code path as natural expiry rather than a second one to remember.

Both readers were rewired, because a derived score nothing consumes is the
canonical-with-no-adoption failure in a new place.

**Exit test.** `absenceGrantExpires.test.ts`. The ratchet case is stated as an
equality against the ORIGINAL score across three activate/expire cycles, so any
residue fails it. Falsified against three mutations: an `effectiveTrustScore`
that ignores the clock, an `activate()` that materialises again, and — the one
the first pass MISSED — either authority reader reverting to `agent.trustScore`.
That third mutation stayed green until a call-site assertion was added, which is
the two-thirds-of-canonical trap: authoritative semantics and drift prevention
without production adoption.

### 27 — "A check that cannot run is not a check that passed" → SECOND APPLICATION

Ledger entry 20's fix taught `executionEngine.validateSafetyGates` to record an
`unevaluable(...)` violation instead of swallowing a failed gate. The same sweep
found the rule had been applied in that file and not in its sibling.

**The defect.** `agentActionExecutors.executeAction` is the function behind every
real side effect the company-agent fleet produces — 28 registered executors,
including a live retention email (`emailService.sendEmail`), a trial extension
that writes `organizations.trialEndsAt`, and a feature unlock that writes
`organizations.featureOverrides`. Its only pre-execution gate is the confidence
cascade, and the entire gate ended in:

```ts
} catch {
  // Cascade check failure is non-blocking — proceed with execution
}
```

An unavailable cascade service was therefore permission.

The same ten lines carried a second instance of a different recorded rule:
`const orgId = ctx.input.orgId || 0`. The cascade is evaluated FOR A TENANT, and
`|| 0` invented org 0 — the sentinel this repository forbids by name elsewhere —
so an action with no organization resolved its cascade against a tenant that does
not exist, and that answer was read as a pass.

**The adaptation.** Both refuse now, with the reason in the returned detail so it
reaches the caller rather than only the log. The refusal is narrow on purpose: it
applies only where the gate already applied — `isSignificantAction` — so a
routine action is not dragged into a check that never governed it.

**Exit test.** `cascadeFailsClosed.test.ts`, falsified against both reversions.
Its vacuity case is load-bearing here: an action name with no registered executor
returns early and never reaches the cascade, and a non-significant name skips the
gate entirely, so the test asserts the cascade was actually consulted before
trusting anything else it observes.

**Recorded, not fixed.** `isSignificantAction` covers 13 names; actions outside
that set (`restart_failed_job`, `resolve_stale_ticket`, `acknowledge_incident`,
`clear_cache`, `update_roadmap_priority`) get no check at all. That is the gate's
SCOPE, which is a product decision about which actions warrant a cascade, not a
defect in its mechanism — widening it silently would be the same mistake in the
other direction. It belongs on the frontier, not in this fix.

Also noted and deliberately not chased: `governedExecute` — the wrapper that adds
the governanceBrain policy check before delegating to `executeAction` — has zero
call sites, and every live path calls the bare `executeAction`. That is a
built-but-unwired candidate for the deletion ledger or for wiring, and it is a
separate decision from making the gate that IS wired fail closed.

### 28 — "A receipt must not claim more than the effect achieved" → THIRD APPLICATION

Ledger entry 5 established the rule and entry 9 applied it a second time to
carrier acceptance. Pulling the thread on the agent-authority vocabularies found
it broken again, in the place where the reader is the founder.

**The defect.** Two of the 28 company-agent executors returned `success: true`
with a receipt describing an effect they never produced.

`forge_revenue:apply_discount` returned
`"Discount offer created: 20% off for 3 months for <org>"` and created nothing —
no Stripe coupon, no billing change, no row anywhere. Its own comment said the
coupon *"requires Stripe API key"* while the receipt claimed the effect anyway.
`verifyAfterMs: 30 days` then scheduled the outcome loop to verify a discount
that was never applied, so the loop would have graded a fiction and moved the
agent's trust score on it.

`sentinel_devops:toggle_data_source` returned `'Data source "X" enabled'` with no
write, no config change and no call. The receipt WAS the implementation. The
claimed effect is not cosmetic: enabling a source can turn on a PAID provider,
so the reader believes both that it is live and that its spend has started.

Both are reachable through the decisions inbox and the CEO command bridge, which
means the person acting on the false receipt is the founder.

**The second rule `apply_discount` broke.** Pricing changes are founder-only
FOREVER (DO-NOT-DO list). So the fix is not a better receipt — an agent applying
a discount is a boundary, not a missing feature.

**The adaptation.** Both refuse, and each refusal names what did not happen and
where the authority is: `apply_discount` points at `escalate_to_founder` (now
permitted at every trust tier, which is what makes that advice actionable), and
`toggle_data_source` says the source is unchanged and provider enablement has to
happen where the configuration lives. `verifyAfterMs` is gone from both — nothing
happened, so there is nothing to verify. The `percentOff` / `durationMonths` caps
are KEPT: they encode a real decision about how large a discount may ever be, and
a refusal that swallowed them would lose it.

**Exit test.** `executorReceiptHonesty.test.ts`, driving the real `executeAction`
dispatcher. Falsified by restoring the old receipt — three cases fire. The
opposite direction is asserted through `clear_cache`, which really does clear a
cache and must still report success, so a change that refused everything cannot
pass.

**Checked and clean:** `extend_trial`, `unlock_feature_temporarily`,
`pause_campaign`, `restart_failed_job` and `clear_cache` all perform their effect
before reporting it. Two offenders out of twenty-eight, which is why this is a
fix rather than a new gate — a register of twenty-six correct executors would
freeze noise.

### 29 — The receipt defect was a CLASS, so it got a gate

Entry 28 fixed two executors that reported effects they never had. Sweeping the
other twenty-six — mechanically, on the body of each `registerExecutor` block
rather than by eye — found **five of twenty-eight**, and the three it added are
worse than the two that started it.

`crucible_qa:run_data_quality_check` returned
*"Data quality check completed. All critical data integrity constraints
passing."* with `{ checksRun: 12, passed: 12, failed: 0 }` and ran nothing.
Twelve is an invented number and zero failures is an invented finding, on a
surface whose entire purpose is to say whether the data is sound.

`shield_legal:run_compliance_check` returned *"No violations found"* with
`violations: 0` and performed no check — a clean compliance bill of health from
a function that does not look. (Real compliance enforcement exists elsewhere and
is unaffected: the `complianceGate` middleware runs in strict mode and refuses
rather than warns. This action was never part of it.)

`compass_pm:update_roadmap_priority` returned *"Roadmap priority updated for
feature #7: high"* with no query and no write — it did not even check the
feature exists.

A fabricated ZERO is worse than a fabricated sentence: no consumer can
distinguish it from a measured one, and the consumer here is the person deciding
whether the company has a problem.

**Why a gate this time.** Ledger discipline says a register of mostly-correct
sites freezes noise — that is why the 133-site fail-open catch class got fixes
and no gate. Five of twenty-eight is 18%, every one sits on the owner's decision
surface, and the shape is mechanically detectable, which is a different case.

`executorReceiptHonesty.test.ts` DERIVES the population from source at run time —
every `registerExecutor` block — classifies each body as acting or inert on any
database call, mail/SMS send, or service import, then DRIVES each inert one
through the real dispatcher and requires `success: false`. So an executor added
tomorrow is covered the day it lands, and the assertion is about the result it
returns rather than the shape of its body. Falsified by adding a new inert
executor that reports success, and by restoring `violations: 0`.

**And the significance list had the polarity backwards.** `SIGNIFICANT_ACTIONS`
was a 13-name allowlist deciding which actions the confidence cascade gates, so
a new executor skipped the gate by default. It was also wrong in both
directions: `draft_social_post` — which drafts and sends nothing — was gated,
while `pause_campaign`, which UPDATEs a customer's live campaign, and
`resolve_stale_ticket`, which writes into a customer's support thread, were not.

Now `CASCADE_EXEMPT_ACTIONS`: an action is significant unless someone exempts it
on purpose. Thirteen exemptions, of two kinds only — internal records and
reports, and the two incident-response actions (`restart_failed_job`,
`clear_cache`), because recovery must not need a cascade to run and an outage is
exactly when the cascade is least likely to be evaluable. The exempt set is
checked against the real registry in both directions, so an exemption for a
deleted executor fails and a new executor cannot inherit one nobody chose.

### 30 — "Deterministic economics have ONE implementation" → NATIVE, no Foundry lesson needed

Recorded here because the ledger is where transfer discipline lives, and this
entry is the discipline working in the negative: the defect was found by AcreOS
evidence, the fix is AcreOS-native, and Foundry contributed nothing. Not every
defect needs an import.

**The defect.** `computeLandDeal` (`shared/calculators/landDeal.ts`) is a
registered scenario engine — `land_deal`, in `CORE_ENGINES`, producing
total_cost / net_proceeds / profit / roi / annualized_return / irr /
breakeven_sale. It had **zero production callers**; grep across `server/` and
`client/src` returned nothing, and the only generic path to it,
`POST /api/scenarios`, has no client caller either.

`buildCashFlipScenario` in `blindOfferCalculator.ts` computed the same
quantities independently, was live, and was what the customer saw at
`POST /api/data-intel/blind-offer`. Canonical law 1 forbids exactly this, and
the flip adapter's own header states it: two implementations of one money
formula is duplication. **The canonical one was the unreached one** — on the
wedge vertical.

Its inputs were four constants compiled into the function: carry as
`acquisition*0.02 + salePrice*0.01`, disposition as `salePrice*0.08`, a 45-day
hold. Fix-and-flip reads every equivalent from `underwritingDefaults.flip` and
stamps each `org_rule` or `platform_default` — and `underwritingDefaults` had an
`ownerFinance` section and a `flip` section and **nothing for land**.

**Two customer-visible numbers were wrong, both in the optimistic direction.**
ROI was `netProfit / acquisition`; the money actually at risk is total cost in,
so the old figure read HIGH by construction — the same flaw the flip adapter
calls out about the legacy `calculateFlipAnalysis`. And ROI was `0` when there
was no cost basis, presenting an undefined return as a measured break-even.

**The adaptation.** `landDealDefaults.ts` mirrors `resolveFlipDefaults` rather
than inventing a second shape, `underwritingDefaults.landDeal` joins the same
jsonb with no migration, and `buildCashFlipScenario` DELEGATES to
`computeLandDeal`. The platform defaults are the old hardcodes **unchanged in
value** — the defect was that they were invisible and unoverridable, not that
they were wrong, and inventing fresher figures would be the same mistake with
new digits. The scenario now returns its assumptions with provenance, and the
wizard badges each "Your rule" or "Our default".

A stale sentence went with it: the recommendation prose said "ROI in ~45 days"
against a hold that is now settable, and compared `ownerFinance.roi >
cashFlip.roi * 1.5` — where `null * 1.5` is 0 in JavaScript, so an unknown ROI
would have silently recommended owner finance while printing "null% ROI" in the
sentence justifying it. It now says the comparison cannot be made.

**Exit tests, and why there are two.** `landDealEconomicsCanonical.test.ts`
proves the engine behaves and — the load-bearing case — recomputes the OLD
formula inline and requires agreement, so "adopting this moved no customer's
number" is checkable rather than claimed in a comment. `landExitModelDelegates.
test.ts` drives the REAL `calculateBlindOffer` and asserts on properties only
the engine path can produce, because a test that exercises the canonical
function while the product still runs the other one is the adoption trap this
repository has hit twice. Four mutations, all firing: tidying a platform
default, adopting a non-finite stored value, and reverting the calculator to its
inline formula.

**What this unblocks.** `land_deal` now has a real production caller, so a land
scenario is recordable for the first time — which is the prerequisite for land
closing the canonical loop. That is the next unit, and it is deliberately NOT
this one: recording a scenario before fixing its inputs would have frozen
invented numbers into decision memory.

### 31 — "A measurement's absence is not zero" → ON A DOCUMENT THIS TIME

The same rule as entries 24 and 29, found on the highest-consequence surface it
has appeared on yet: a document meant to be sent to a property owner.

**The defect.** `POST /api/offer-letters/batch` priced every selected lead as

```ts
const assessedValue = property?.assessedValue ? Number(property.assessedValue) : 0;
const offerAmount = Math.round(assessedValue * (offerPercent / 100));
```

A lead with no linked property, or a property whose assessed value the county
has not published, therefore produced `offerAmount: "0"` and
`assessedValue: "0"` — and a real `offer_letters` row was created for it, in
`draft`, in the same batch as the genuine ones.

Zero is a PRICE here. It lands in the same column as every real offer, is
indistinguishable from one downstream, and sits on an instrument whose whole
purpose is to reach an owner. The discriminator this repository already uses
applies cleanly: `offerPercent` is a caller-supplied knob and rightly has a
value; `assessedValue` is a MEASUREMENT read from a property record, and its
absence is the reason the lead cannot be priced.

**The adaptation.** The batch partitions rather than defaults. A lead is
unpriceable when there is no property, no assessed value, a non-finite one, or
a non-positive one; those are skipped with a per-lead reason and returned as
`skipped` rather than silently dropped, because the operator chose them and is
owed an account. A batch where nothing can be priced is a 400 rather than a
batch of zero-dollar letters.

The client's success toast said letters "have been generated for selected
leads" whatever happened. It now reports the real count and names why the rest
were skipped — a count in front of the operator that disagrees with the count
they chose is its own small lie.

**And the same idiom, on the PDF.** Sweeping the sibling offer paths for the
same shape found `generateOfferLetter` in `services/documents.ts` deriving

```ts
offerDetails?.offerAmount || Number(property.assessedValue || 0) * 0.3
```

so a caller supplying no amount got one of two fabrications printed on a
document meant to reach a seller: **30% of assessed value** — an invented
pricing rule with no provenance and no operator override — or, with no assessed
value on file, `formatCurrency(0)`, putting **"$0.00" in the Offer Price field**
of a signed-looking instrument. `POST /api/documents/offer-letter` did not
require the field either, and charged a five-cent credit before finding out.

The generator now refuses — the price is the document's whole point and a
document generator has no standing to choose it — and the route requires a
positive amount BEFORE the credit pre-check, so a caller never pays for a
document that will be refused a few lines later.

**Exit test.** `offerLetterPricingHonesty.test.ts` exercises the batch selection
rule over null / missing / zero / garbage assessed values, asserts the opposite
direction (an all-priceable batch loses nothing), and pins that both the batch
route and the document generator still run their rules — comments stripped with
a floor, so the explanation of a fix cannot satisfy the scan for the fix. Three
mutations fire: restoring the `: 0` default in the batch, restoring the
assessed-value derivation in the generator, and moving the route's guard after
the credit charge — the last because ORDER is part of the fix, not decoration.

**Checked and clean in the same sweep:** `ai/tools.ts:1723` maps a missing
assessed value to `undefined` rather than 0, which is the correct shape.
Two further instances are recorded on the frontier rather than fixed here
(`cashFlowForecaster.ts:361`, `dueDiligenceReportGenerator.ts:381`) — both real,
neither on a document that leaves the building, and bundling them would have
made this unit about four files instead of one defect class.

### 32 — Land enters the canonical loop, and the ratchet is NOT gamed to say so

Entry 30 gave `computeLandDeal` its first production caller. This is the loop
entry it unblocked — and the more useful half of the entry is what was
deliberately not claimed.

**The gap.** `recordDecision` had exactly two non-generic production call sites,
the flip analyzer and lot pricing, so of fifteen verticals only fix_and_flip and
subdivider reached the `decided` evidence tier. Land recorded nothing: its Today
outcome prompt (`/api/decisions/due`) was structurally empty and forecast
calibration had nothing to grade.

**Choosing the deliberate act.** Not `POST /api/data-intel/blind-offer` — that is
a CALCULATION the wizard re-runs as the operator tunes inputs, and recording
there would fill decision memory with keystrokes. `POST /api/offer-letters/batch`
is where the number becomes a document addressed to an owner, which is the same
moment and the same stated reason the flip analyzer records on.

**Two departures from the flip precedent, both deliberate.** Flip records BEFORE
its insert so the offer row can carry `decision_snapshot_id` in the same INSERT;
`offer_letters` has no such column, so there is nothing to order against and the
safer direction — after the letters exist, so a bookkeeping throw cannot turn a
created batch into a 500 the operator reads as "nothing happened" — wins. And no
scenario is frozen: the batch prices from assessed value and an operator-supplied
percent and computes no exit model, so citing economics it never ran would be
worse than citing none. `reviewDueAt` is the offer's own expiry, because that
field is required-nullable precisely so "never reviewed" stays distinguishable
from "review forgotten".

**WHAT WAS NOT CLAIMED.** `tests/support/verticalEvidence.ts` derives the
`decided` tier from `DECISION_ROUTE_OWNER`, a map of vertical-OWNED route files.
Adding `routes-team-messaging.ts` to it would have promoted land_flipper to
`decided` and dropped the overclaim count the ratchet pins at exactly 13 — a
visible, satisfying number moving in the right direction.

It would also have been false. `/offers/batches` and `/blind-offer-wizard` sit
under Deals with no `businessTypeOnly`: they are SHARED surfaces every persona
uses, not any vertical's own loop. Promoting land on the strength of a shared CRM
surface is exactly the overclaim that map exists to prevent. The map now carries
a note saying the file is deliberately absent and what would legitimately promote
land — a land-owned surface that records a decision, the way flip-analyzer does
for fix_and_flip.

So: land OPERATORS now have decision memory for the offers they send, and the
vertical readiness measure is unchanged. Both statements are true and the second
one is the one a ratchet would have let me skip.

**Exit test.** `landOfferClosesTheLoop.test.ts` pins the wiring and the four
properties that make the record honest rather than merely present: once per
letter, never against a null property, the real authority grant rather than a
generic "system", and best-effort placement. Falsified by removing the recording
and by making the catch rethrow.

### 33 — "Silence is not a clean bill of health" → THE FORECAST AND THE PROJECTION PAGE

The rule from the climate-risk fix (entry recorded 2026-08-18), applied to the
two remaining money sites the offer-pricing sweep found and deliberately did not
bundle.

**The cash-flow forecast omitted the carry instead of naming it.**
`projectExpenses` derived tax, insurance and maintenance as percentages of
`assessedValue`, read as `property.assessedValue ? parseFloat(...) : 0`. A
property with no assessed value therefore produced three costs of exactly zero,
and the `> 0` guards below then skipped pushing them at all — so the forecast
came out with NO carrying costs and no indication any were missing. That reads
as "this property costs nothing to hold" and makes projected cash flow look
better than it is. Silence, not a zero, was the failure mode.

It now emits one row, amount 0, whose entire purpose is to carry the sentence:
carrying costs are NOT included, no assessed value is on file, and this forecast
understates holding cost by an unknown amount. A labelled gap, the same shape
`LandProfileGap` uses on the parcel surface.

**The due-diligence report projected from a value it did not have.** The whole
Financial Projections page derived from
`valuation?.estimatedValue || (property?.marketValue ? Number(...) : 0)`, so a
parcel with neither printed, in a document headed "due diligence":

```
Aggressive (25%):  Buy $0 → Sell $0 → Profit $0 (N/A% ROI)
7% / 84mo:         Down $0 + $0/mo = $0 total
```

An entire page of figures nobody computed. This is the same document whose
CLIMATE section carried the same defect until 2026-08-18, and it takes the same
answer: the page now says the projections were not made, and that this is the
absence of a valuation rather than a valuation of zero.

Worth noting for whoever reads that file next: line 375, the "Estimated Value"
row, already got this right — it passes `undefined` through to `fmt$` rather
than substituting 0. The honest version and the dishonest one sat six lines
apart, which is the pattern this repository keeps finding: the correct rule is
usually already in the file.

**Exit test.** `forecastAbsenceIsVisible.test.ts`, both directions on both
surfaces — the gap is stated AND the real projections still print when a value
exists, so a guard that suppressed everything cannot pass. Falsified by
restoring each `: 0`.

**The test caught something about itself**, which is worth recording because it
is a trap for source-scanning gates generally: the asserted sentence is built by
string concatenation, so "absence of " and "a valuation" sit on different source
lines and a regex spanning them finds nothing even though the rendered text is
correct. The assertion now matches a phrase contained within a single literal.

### 34 — "A price row is not an existence proof" → THE CHEAP TIER WAS PINNED TO MODELS THAT DO NOT EXIST

Found by a deliberate whole-product reassessment rather than by following the
previous thread — six lenses over dimensions this campaign had not examined
(Pax, UX, cost, tenancy rule 2, Customer #1, simplification), then one owner
ranking by consequence-over-effort with instructions to spot-check and demolish.
It demolished one finding, corrected a count, and refused to endorse five it had
not verified. Recording that here because the reassessment is the transferable
part: the previous thread was still producing findings, and they were smaller
than this.

**The defect.** Every id in `MODELS` (`server/services/models.ts`) that names an
Anthropic model was absent from OpenRouter's catalogue, and so was the reasoning
model. Measured against the live catalogue on 2026-08-19 (415 models):

| pinned | status | catalogue's string |
|---|---|---|
| `anthropic/claude-opus-4-8` | absent | `anthropic/claude-opus-4.8` |
| `anthropic/claude-sonnet-4-6` | absent | `anthropic/claude-sonnet-4.6` |
| `anthropic/claude-haiku-4-5-20251001` | absent, 404s outright | `anthropic/claude-haiku-4.5` |
| `deepseek/deepseek-reasoner` | absent | `deepseek/deepseek-r1` |

Two independent naming errors. **Versions are DOTTED, not hyphenated** — 18
dotted Anthropic ids in the catalogue, zero hyphenated. And **slugs are
UNDATED** — Anthropic's own API pins a dated id for Haiku, no catalogue slug
carries a date.

`MODELS.HAIKU` is `MODEL_MODERATE`, returned by `modelForTier` for `standard`
and `background` and by `selectProviderAndModel` for `TaskComplexity.MODERATE` —
and the primary completion's catch RETHROWS rather than falling back.

**The guard that looked like it checked this.** `models.ts` throws at boot if an
id has no row in `AI_COST_RATES`. So the only thing it ever proved was that
somebody had written down a PRICE — and `aiCostRates` dutifully carried one for
every non-existent id. A price table is a LEDGER of what was charged, not a
catalogue of what can be called; it can never be the existence check, and the
new test says so beside the restated price guard so the distinction is visible.

**A correction I made to my own fix, mid-unit, worth recording.** The first pass
changed only Haiku, on the strength of probing
`/models/{id}/endpoints` per id — which returned **200 for
`anthropic/claude-haiku-4-5`** and 404 for the dated form. That endpoint
normalises hyphens to dots; the catalogue LISTING does not contain the
hyphenated form at all. Probing ids one at a time confirmed the wrong thing, and
only listing the catalogue revealed that Opus and Sonnet were wrong too. The
per-id probe is the kind of check that agrees with you.

**Honest limit on the claim.** These are the catalogue's canonical strings,
verified present. Whether the old hyphenated forms would ALSO have been accepted
by the completions endpoint could not be tested — that needs a provider API key,
and inventing one is not available. The dated Haiku id is unambiguously broken
either way. Pinning canonical strings is the conservative choice: a no-op if
normalisation exists, the fix if it does not.

**Two gates, and the split is the point.**
`scripts/check-model-ids.mjs` probes the live catalogue and REFUSES when it
cannot reach it, because an unreachable catalogue is not a catalogue saying
everything is fine. It is a script and not a test precisely because a vitest case
that fetches would pass whenever the network is down — green in exactly the
environment that cannot check.
`tests/unit/modelIdsAreReal.test.ts` carries the offline, deterministic rules the
probe's findings imply: every id prefixed, no dated Anthropic slug, no
hyphenated version, and the dead ids named individually. Falsified three ways —
restoring the derivation, hyphenating a version, dropping a prefix.

Rule 1 alone would have passed `anthropic/claude-haiku-4-5-20251001` happily:
its shape is fine. That is the difference between proving the symbol and proving
the behaviour, on this repository's own terms.

### 35 — THE GATE WAS READING COMMENTS: three dead services certified as wired by their own docblocks

Not a Foundry transfer. Found by accident, and the accident is the finding.

**How it surfaced.** Entry 34 removed a vestigial `await import()` from
`scripts/check-model-ids.mjs` and wrote a comment explaining why. Two
reachability counters had moved when the line was added; deleting it did not
move them back. The hypothesis that the dynamic import caused the movement was
already disproven at that point — and the actual cause was the *sentence*: the
comment SPELLED the call it was describing, and `lint-reachability` scans raw
source with regexes that have no idea what a comment is. Rewording the comment
moved the counters. Nothing else changed.

**What that bought anyone who wanted it.** This gate's two strongest exemptions
were available to prose:

- a dynamic-import specifier inside a comment marks the whole target module
  `opaque` — *every* export in it becomes unassertable and drops out of the
  unreached count. One sentence, one module's worth of exemption.
- a `from "./x"` inside a comment records x as imported, so `isModuleOrphan(x)`
  returns false and a file nothing loads stops reading as a file nothing loads.

**The three it was hiding.** `stripCommentsPreservingLines()` now feeds both
import scans. Line structure is preserved, so every reported line number still
points where it did, and a 10-case self-test prints on every run — a stripper
that quietly returned `""` would empty both scans and turn the whole gate green.
Stripping revealed three service modules that NOTHING in the repository loads:

| module | LOC | why it read as imported |
|---|---|---|
| `atlasContextInjector.ts` | 344 | ` *   import { buildAtlasContextBlock } from "./atlasContextInjector";` |
| `communicationDeduplication.ts` | 132 | ` *   import { commDedup } from "./communicationDeduplication";` |
| `userAiCostControls.ts` | 234 | ` *   import { userAiCostControls } from "./userAiCostControls";` |

Each is a **usage example in the module's own header** — the scanner read it as
the module importing itself. The gate whose entire purpose is finding
built-and-unwired code was certifying it wired, on the strength of the sentence
explaining how one day it might be.

**None of the three was a close call.** The 2026-08 audit had already reviewed
two: `09-correctness.md:68` reviewed `communicationDeduplication` and recorded
"**zero callers** (dead code, TOCTOU moot; handed to slice 04, not reported
here)"; `16-cost.md` F-16-3 said of `userAiCostControls` "either wire
`checkBudget` into the shared AI entry path or delete it and correct the
registry entry." Both were handed onward and neither was actioned — the gate
that should have kept them visible was reporting them as fine. And each
duplicated a live canonical owner with a **weaker** mechanism:

- `commDedup` is a Redis-or-in-memory-`Map` check-then-act (`isDuplicate` →
  `fn()` → `markSent`, not atomic, `catch { return false; // fail open }`)
  beside the DB-backed outward-action ledger + `idempotencyKey` that
  `emailService` and `directMailService` already run on, which raises
  `LetterAlreadySentError` rather than racing.
- `userAiCostControls` is a spend cap whose usage read catches everything and
  falls back to a per-process `Map`: with Redis down it reads 0 and the cap
  never fires; with no `REDIS_URL` it is per-instance and resets on restart. It
  fails OPEN — the third law from this campaign inverted, the unknown resolving
  toward permission — beside the DB-backed `intelligence/budget`,
  `founderInboxBudget`, `credits` and `outreachStopLoss`.
- `atlasContextInjector` eagerly assembled portfolio state into *every* Pax turn
  (~9 sequential DB reads) that Pax already fetches on demand through
  `get_deals` / `get_stale_leads` / `get_tasks` / `get_pipeline_summary` /
  `get_notes`. Wiring it would have been strictly worse than the tool surface it
  duplicates.

**The cascade, and why it was followed.** Deleting the injector revealed its own
dependency: `buildPaxSystemPromptAddition` in `paxRelationshipArc.ts` had
exactly one production consumer, and it was the dead injector. Deleted too,
rather than left counted — and it is the most consequential line in this entry.
The block it rendered for Pax's system prompt said:

> "You MAY take autonomous actions (create tasks, flag deals) without explicit
> permission."

granted on a relationship "stage" that advances on an **interaction counter**.
It had never appeared in a prompt. Wiring it would put a permission grant in a
channel with no authority to issue one: autonomy here is decided by
`autonomyGuardrails` / `autonomousAgentEngine.evaluate` and enforced inside
`executeTool`'s approval kernel, so the sentence could not widen authority — it
could only make Pax attempt actions the kernel then refuses, and make the next
reader believe usage buys authority. `getRelationshipState`, `getStageBehavior`
and `recordPaxInteraction` are live behind `/api/pax/relationship` and stay;
only the prompt projection went, with a tombstone in its place.

**Exit test.** Four fixtures in `reachabilityGate.test.ts`, mutating where a
specifier SITS — code or prose — rather than which symbol it names. Falsified
against the un-hardened linter: the two defect cases fail (a self-importing
docblock reads as imported; a commented dynamic import confers opacity) and the
two negative controls pass unchanged (a real import beside a comment about it
still counts; `//` inside a URL string is not a comment). The self-test line is
asserted full, with a floor on its case count.

**Still open, measured the same day and deliberately not taken.** The
IDENTIFIER pass still reads raw source, so a comment merely NAMING a symbol
still counts as a production use of it. That is documented in the linter's own
allowlist (`InvestorVerificationService`, whose only consumer was a stale
`TODO`), so it is a known property — but it had never been sized. Stripping
comments there too moves `unreachedExports` 1398 → **1478**: eighty exports are
currently certified reached by a sentence. The ratchet is down-only, so that
cannot land in halves; it is an 80-item adjudication and it is on the frontier.

**The general form.** This repository's first law says a load-bearing gate must
be falsified against the semantic defect, not the symbol. This is the same law
one level down: the gate was falsified against symbols in *text*, and text
includes the part of the file that is not code. Any scanner that reads raw
source shares the defect — `check-org-scoped-fetch.mjs` is already in
`SYMBOL_REGISTERS` for the mirror-image reason, and `aiPromptLeakage.test.ts`
once flagged a docblock *explaining* a founder-only boundary as a leak of it. A
comment cannot import, cannot call, and cannot reach a customer.


### 36 — `getOpenAIClient()` RETURNS AN OPENROUTER CLIENT, and fifty-nine call sites believed the name

Continues entry 34, and is the half that entry did not fix. Ledger 34 corrected
the central `MODELS` registry. A registry is only authoritative over the call
sites that USE it, and most did not.

**The defect.** `server/utils/openaiClient.ts` exports `getOpenAIClient()` and
`requireOpenAIClient()`. Both return an **OpenRouter** client — built from
`AI_INTEGRATIONS_OPENROUTER_API_KEY`, based at `https://openrouter.ai/api/v1`,
under a docblock that says "Platform AI is OpenRouter-only … the previous
OpenAI fallback was a cost trap". Fifty-nine model literals across thirty-one
files passed it OpenAI's *bare* ids.

Measured against the live catalogue on 2026-08-19, and both halves matter:

| id | in catalogue (415) | `/models/{id}/endpoints` |
|---|---|---|
| `gpt-4o` | absent | **404** |
| `gpt-4o-mini` | absent | **404** |
| `openai/gpt-4o` | present | 200 |
| `openai/gpt-4o-mini` | present | 200 |

That endpoint normalises hyphens to dots — which is what made entry 34's
first pass wrong — but it does **not** supply a missing author prefix. So this
is not a naming nicety; the request 404s.

`server/ai/paxSupportResolver.ts` is the clearest illustration: its own header
reads "getOpenAIClient() — the SAME OpenRouter-backed client wrapper the rest of
…", and two lines later it sends `model: "gpt-4o"`. The file knew which provider
it was talking to and still used the other provider's name for the model.

**A methodology error of my own, worth recording because it nearly shipped.**
The first inventory grepped `model: "gpt-4o"` — double quotes — and produced
"57 sites across 25 files". Nine more files use single quotes
(`negotiationOrchestrator`, `acreOSValuation`, `voiceLearning`,
`portfolioOptimizer`, `atlasMemory`, `complianceAI`, `routes-realtime`, and two
more literals in files already on the list). They surfaced only because
`complianceAI.ts:403` had a double-quoted `modelKey` two lines under a
single-quoted `model`, and the mismatch was visible. **A quote-biased grep is a
sampling method presented as a census** — the frontier's "52 sites" was that
number, and the real figure was fifty-nine. The gate that replaced the grep
matches on the KEY and accepts either quote.

**Where a bare id is genuinely correct, and why that made this harder.**
`byok/aiByok.ts:98` strips `openai/` and returns the bare name — correctly: that
client is bound to the CUSTOMER's own OpenAI key. The repository already knew
the two namespaces differ; it just did not apply that knowledge on the platform
side.

**The runtime-decided cases.** Three places build their own client from
`AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` —
`ai/vaService.ts`, `services/supportBrain.ts`, and `aiRouter`'s direct-OpenAI
fallback — plus two autopilot deliberation call sites. That base URL has **no
default**, so which provider they reach, and therefore which of the two names is
correct, is decided by a secret this repository cannot read.

It is not hypothetical that the secret moves. `docs/runbooks/ai-quota-exceeded.md`
Option 3 instructs the operator to point it at OpenRouter during a quota
incident — which, before this commit, silently 404'd every call in all three, at
the one moment anyone runs that runbook. The id now follows the client:
`openAiModelIdFor(baseURL, bareId)` in `services/models.ts`, read from the same
env var the client is constructed from, so the two cannot disagree. The runbook
now says so.

`aiRouter.ts` carried the comment `// Kept for backward compat but routes to
OpenRouter` on that client. It does not — it reads
`AI_INTEGRATIONS_OPENAI_BASE_URL`, and with the secret unset the OpenAI SDK's
own default applies. Same species as the defect beside it: a name (and a
comment) asserting a provider the code does not use.

**MEASURED BUT NOT SETTLED — registered, not rewritten.** Four call sites use
non-chat OpenAI endpoints on the platform client, which `openaiClient.ts`'s own
docblock forbids ("OpenRouter does not proxy /v1/audio/transcriptions … do not
route those through this helper"; `routes-field-scout.ts` is named as the
sanctioned pattern and correctly reads `OPENAI_API_KEY` directly). Probing
OpenRouter unauthenticated:

| endpoint | status | reading |
|---|---|---|
| `POST /api/v1/chat/completions` | 401 | route exists |
| `POST /api/v1/embeddings` | 401 | route exists |
| `POST /api/v1/audio/transcriptions` | 401 | route exists |
| `POST /api/v1/images/generations` | 400 (ZodError) | route exists |
| `POST /api/v1/models` | **404** | control — this is what absence looks like |

So the docblock's premise is stale: those routes DO exist. But no `whisper-*`,
`dall-e-*` or `text-embedding-*` id appears in the 415-model catalogue, and the
ids those endpoints accept cannot be enumerated without a key. **Both possible
rewrites are guesses**: prefixing them guesses at ids nothing lists, and moving
them to a direct OpenAI client moves spend to a key that may not be configured
(the deploy log records `AI_INTEGRATIONS_OPENAI_API_KEY` failing its health
check). Registered in the gate with the measurement and its limit, and on the
frontier. Refusing to guess is the finding, not a gap in it.

**Two gates, same split as entry 34.**
`scripts/check-model-prefix.mjs` is the OFFLINE half and the new 26th step of
`npm run check`: every model-carrying key in `server/**` must hold an
`author/slug` id or appear in a register whose entries name the client and the
reason, three of them scoped to a single file. It strips comments first — a
docblock showing a caller how to pass a model id is documentation, not a
request, which is entry 35's lesson applied prospectively rather than after the
fact. `scripts/lib/strip-comments.mjs` is now shared by three scanners instead
of copied into each.
`scripts/check-model-ids.mjs` (live, refuses when it cannot reach the catalogue)
now probes **every prefixed literal in `server/`**, not just the registry — 6
registry ids plus 2 distinct literals across 56 sites — because the defect was
never "the registry is wrong", it was "an id that does not exist reached a
provider", and a literal reaches one just as well.

**Exit test.** `modelPrefixGate.test.ts` writes a probe into the real tree and
runs the real gate: it fires on the exact defect, on an EQUIVALENT
representation (different key, different model family, single quotes), and on a
registered id used outside the file it was registered for. Two negative controls
— a prefixed id, and a bare id inside a comment — must not fire. Plus a vacuity
case on the walk, the literal count and the stripper's own score.
`modelIdsAreReal.test.ts` pins `openAiModelIdFor` in both directions with a
vacuity guard, because a resolver that returned its input unchanged would pass
every bare-side assertion.

**What this does not claim.** That these calls were failing in production cannot
be shown from the repository — it depends on secrets and on traffic. What is
shown is that the id sent does not exist at the provider the client points at.


### 37 — A CUSTOMER FIELD OUTRANKED THE PAID-TIER CEILING, and nobody could reach it to find out

Found while tracing entry 36's model ids into the surfaces that choose them.
Owner decision OD-7; the founder returned it with "use your best and highest
judgement and decide", so the call below is mine and recorded as such.

**Two defects on the same field, and each hid the other.**

*The visible one.* `client/src/components/pax-copilot-rail.tsx` offered a model
picker — `Auto · Fast · Balanced · Powerful · Reasoning · Claude` — and posted
the raw string as `modelOverride`. `server/routes-ai.ts` accepted a `z.enum` of
raw model ids: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`,
`claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`,
`deepseek/deepseek-chat`. **The two sets do not intersect at any value.** The
route `safeParse`s, so every selection except "Auto" returned a **422 and no
answer** — on the primary AI surface, with the choice persisted to
`localStorage`, so it kept failing on every subsequent message until the user
set it back.

*The one underneath.* `ai/executive.ts` resolved
`options.modelOverride || visionFallback || costRoutedCeiling || result.model`
— the request field sat **ahead of the tier ceiling**, i.e. ahead of
`pickPaxModelForOrg` and its monthly soft-cap downgrade. That is the margin
guard this codebase built on purpose; `campaignOptimizer.ts:186` carries the
note explaining why ("the optimizer used to hardcode gpt-4o for every org — the
Scale/Pro tier-downgrade ladder covered ONLY Pax chat, so heavy free/capped orgs
billed premium-model COGS invisibly").

**Each defect was the other's camouflage.** Six of the seven enum ids were names
no provider in this system serves (bare or dated — entry 36's family), and the
seventh, `deepseek/deepseek-chat`, is the CHEAPEST model in the registry. So the
only value that both passed validation and existed made the org cheaper, never
dearer. The ceiling bypass was real and unreachable at once, and it would have
become reachable the moment someone "fixed" the enum to match the picker —
which is the obvious repair, and the wrong one.

**The comment that made it look intentional.** executive.ts described the branch
as "Explicit modelOverride (founder dashboard, eval harness)". Grep across
`server/`, `client/src` and `tests/` found **one** setter: the customer-facing
`POST /api/ai/chat/stream`. `processChat` has four callers and the other three
(`tools.ts` sub-agent, `paxScheduler`, `/api/ai/chat`) never set it. The
founder dashboard and eval harness the comment names do not exist. Same species
as entry 36's `getOpenAIClient` and aiRouter's "routes to OpenRouter" comment:
a note asserting a caller, a provider, or an intent that the code does not have.

**Decision: remove it, rather than clamp it.** The alternative was to accept the
client's tier vocabulary and clamp it to the org's ceiling. Rejected on three
grounds. The product already promises the opposite — the picker's own tooltip
says "Auto picks the right brain for each question", and `routePaxModelForTurn`
does exactly that per turn under the ceiling. The labels are not something a
land investor can reason about ("Claude" is a vendor name). And a clamp is
machinery that must stay correct as tiers change, built to preserve a control
that has never once worked for anyone — there is no regression to weigh against
it, because there is no working behaviour to lose. If a model choice should
exist, "Fast vs Thorough" as an explicit latency/cost trade is a better product
and a design task, not a repair. Removing the field also removes the bypass
outright rather than bounding it, which is the difference between a hole with a
guard on it and no hole.

Removed: the `Select` and its `localStorage` preference from the rail, the
`modelOverride` key from the stream schema, the field from `ChatOptions`, and
the branch from both resolution chains. `resolveModel` (the unified resolver,
deliberately in SHADOW MODE) is untouched.

**Exit test.** `paxTierCeilingIsTheCeiling.test.ts` pins the SHAPE, not the
identifier — renaming `modelOverride` would satisfy a word-matching gate while
reintroducing the defect exactly. Every operand of every multi-alternative
`model = …` chain must be in a server-sourced set; the two chat schemas must
carry no key matching `/model/i`; `ChatOptions` likewise; the rail must post no
model field and keep no model preference. Each predicate runs twice — once on
the real source, once on a mutation that reintroduces the defect **under a
different name** (`options.tierBoost`, `preferredModel`, `pinnedModel`) — plus a
negative control that merely REORDERS the legitimate operands and must stay
green, and vacuity guards on every scan.

Then falsified against the real thing rather than only against synthetic
mutations: run against `HEAD~1`'s source, the predicates report
`['options.modelOverride', 'options.modelOverride']` and
`['aiChatStreamSchema.modelOverride']`. The gate catches the defect that
actually existed.


### 38 — TWO DOORS ON THE SAME OPERATION, and only one was guarded

The frontier's top-ranked security item, verified and closed. Not a Foundry
transfer.

**The defect.** Skip-trace is FCRA-adjacent under §1681b(a)(3)(F), and AcreOS
has two doors to it.

The REST door (`POST /api/skip-traces`, `routes-leads.ts:1806`) requires
`requireScope("tenant_pii_write")` — a scope `member`, `va`, `viewer` and
`intern` do not hold — plus a purpose from a closed enum, a justification of at
least ten characters, and a current annual attestation, all persisted on a
`skip_traces` row whose stated reason for existing is *"class-action defense
audit trail"*.

The Pax door (`ai/tools.ts:2767` → `connectors/executor.batchLeadsSkipTrace`)
required none of it. No scope, no purpose, no attestation, no audit row, no
credit ledger. A `member` typed a sentence and got a third party's phone
numbers, emails and prior addresses. It also sat on `PAUSE_SAFE_TOOLS`, so it
ran while the customer had Pax paused.

**Underneath it, the general hole.** The App Intent registry declares a
`requiredScope` for every one of its ~60 intents. Nothing on the Pax path read
it. The only consumer was `mcp/safeIntents.ts`, which uses it to decide which
intents an EXTERNAL agent may SEE — visibility, not authority. Sixty
declarations, zero enforcement: CLAUDE.md's second law again, and this instance
had a structural cause worth recording. `appIntents/catalog.ts` imports
`executeTool` from `ai/tools.ts`, so `tools.ts` importing the catalog back would
have been a cycle — **the declarations sat in a module the chokepoint could not
import.** Fixed by extracting the table into `appIntents/intentScopes.ts`, a
leaf that imports types only, so both sides can have it. One table, two readers.

**And the declaration itself was wrong.** `batch_leads_skip_trace` was tagged
`{ door: "map", scope: "deal_read" }` — the weakest scope in the ladder, held by
every role including `intern`. A consumer-report lookup declared as a deal read.
Corrected to `tenant_pii_write`, matching the REST door for the same operation.
Worth noting for its own sake: the registry was not merely unenforced, it was
unenforced AND untrue, and the second is what would have made a naive
"enforce the declarations" change ineffective.

**The permission ladder could not answer the question.** `hasRoleScope(req,
scope)` took an Express request. `executeTool` has an `Organization` and
sometimes a user id, never a `req`. Extracted `userHasScope(org, userId, scope)`
with `hasRoleScope` delegating to it, so there is one implementation rather than
two that drift. The FOUNDER bypass deliberately stays in the request-shaped
wrapper — it reads `req.isFounder`, which upstream middleware establishes; a
caller with only a user id gets the org-membership answer and no ambient
elevation from a path that cannot prove it.

**Two rules at the chokepoint, and the asymmetry is the design.**

1. An **identified** caller is held to the declared scope. `ai/executive.ts`
   passes `userId` on all four of its call sites, so the customer-facing surface
   is covered.
2. An **unidentified** caller — `vaService`'s org-level agent loop, the
   registry's own `handler(args, org)`, the approved-send replay — may act as
   the org for ordinary scopes, because there is no user to hold one and
   refusing would break automation that has always run this way. It is REFUSED
   for the PII scopes, where *"the org did it"* is not an answer anyone can give
   a regulator.

`trustedApproval` does **not** bypass this. A human tapping "Send" on a frozen
action is a witnessed send; it is not evidence that they hold
`tenant_pii_write`.

**The FCRA gate refuses rather than collecting.** Skip-trace needs three things
the Pax path could plausibly have gathered: the purpose is enum-constrained and
checkable, the attestation is a stored human act and checkable — and the
JUSTIFICATION would be a sentence the MODEL wrote, persisted as the operator's
stated reason in a legal record. That is where "fabrication is never acceptable"
is at its sharpest: an audit trail exists to show that a PERSON claimed a
purpose, and a model claiming one on their behalf is the exact thing it is
supposed to disprove. So Pax refuses, names all three requirements, and points
at the surface that records them. If skip-trace through Pax is wanted it needs a
purpose-capture step the human completes — the pending-action approval flow is
the natural place — not a wider tool schema.

**Exit test.** `paxToolScopeAndFcra.test.ts`, driving the REAL `userHasScope`
and the REAL `ROLE_SCOPES`; only the `team_members` row is a fixture, because a
mock standing in for the predicate would make the suite agree with any
implementation of it — including one with the polarity inverted, which is the
mistake `paxPauseToolGate.test.ts` records for `unattendedSendPermitted`. The
connector mock THROWS rather than returning "not connected", so a bypass cannot
look like a refusal.

The case that matters most is the one that gives the caller everything: a
`screening_specialist` — who genuinely holds `tenant_pii_write` — is still
refused, and so is the org OWNER, and so is a call carrying `trustedApproval`.
Holding every scope is not an attestation. Without those three, the refusal
would prove nothing about FCRA, because the scope gate fires first and the two
messages differ. Both directions on the ladder as well: a `viewer` is refused
`create_lead` and a `member` is permitted it, a `bookkeeper` is refused
`draft_outreach_message` on a different scope so the pair cannot both be passing
for a reason peculiar to `deal_write`, an unidentified caller still gets the
non-PII intent through, and the membership read throwing fails CLOSED.

**Found alongside, recorded not fixed.** `batchLeadsSkipTrace` calls BatchLeads
with `fetch` directly — no provider registry, so no credit deduction, no
`provider_cache` row, no circuit breaker, contrary to CLAUDE.md's "all external
data flows through the provider registry". The same is true of
`propstreamLookup`, `propstreamComps`, `searchMlsListings` and `getMlsComps` in
that file. On the frontier.


### 39 — `status: "queued"`, and nothing was queued

Frontier item 2, closed. Small, and worth its own entry for what the survey
around it settled.

**The defect.** `schedule_background_job` advertised an enum of four job types —
`bulk_property_import`, `bulk_lead_import`, `campaign_send`,
`report_generation` — and its entire implementation was one `logger.info`
followed by `{ success: true, data: { …, status: "queued" } }`. A user who asked
Pax to run the overnight campaign send was told it was queued. None of those
four job types exists anywhere in `server/jobs` or the outbox.

It is a purer instance of the class than most: not a stub that returns nothing,
but a stub that returns a **status field**. `"queued"` is the word a real queue
would use, in the place a real queue would put it.

**Deleted, not wired.** Wiring it means BUILDING four job types, and the defect
is that it claimed to already have them. Removed from `toolDefinitions`, from
the dispatch, and from the App Intent table — the last of those being the
residue this repository leaves most often, where a deleted tool keeps a door
and a scope declared for something nobody can call.

**The survey is the part worth keeping.** Rather than fixing the one, I scanned
all 61 switch cases for the shape: returns `success: true`, calls nothing that
can have an effect. Exactly one offender, and the other four candidates were
three pure calculators and `get_system_context` (which awaits a real read). So
the class was bounded at one — which is precisely when a rule is cheap enough to
install, rather than after the second occurrence.

**The predicate, and why `await` carries it.** Every handler in this file that
reads or writes anything awaits something — storage, the db, a service, a
dynamic import, a fetch. A case that returns success having awaited nothing has,
by construction, done nothing beyond arithmetic on its own arguments. The first
version of the rule listed effect-shaped identifiers instead (`storage.`,
`Service.`, `emit…`, `send…`) and immediately produced a false positive on
`get_system_context`, whose effect is a plain call to a statically imported
function. Enumerating the ways code can have an effect is a losing game;
`await` is the one signal that generalises.

**Exit test.** `paxToolsReportRealEffects.test.ts` scans the switch and asserts
no unregistered case claims success without effect. Falsified by re-inserting
**the real deleted handler** into a copy of the source — not a synthetic shape,
the code that actually shipped — and by a negative control on the same site: a
handler that awaits a storage write must NOT be flagged. Plus a vacuity guard
(>50 cases parsed, four known tools present, and every name in the
pure-computation register must be a real tool).

**And the register that named it.** `paxPauseToolGate.test.ts` asserted
`schedule_background_job` is not pause-safe. `PAUSE_SAFE_TOOLS.has(name) ===
false` is satisfied trivially by a name that no longer exists, so the list would
have kept reading as "these tools exist and are correctly not pause-safe" while
one of them did not exist at all. Per CLAUDE.md's rule about tests that pinned a
stub: the entry was removed and a mirror hygiene case added — every name in that
list must be a real tool — so the next deletion cannot leave a ghost.


### 40 — THE GUARD DID NOT MATCH THE AUTHORITY: an IDOR the debt register already named, and a workspace wipe anyone could call

Frontier items 4 and 5, closed together because they are one rule seen twice.

**Proving you own row 41 of one table is not owning row 41 of another.**
`GET /api/buyer-qualification/:id/probability` verified that `:id` was a
`buyer_qualifications` row belonging to the caller's org — carefully, through a
helper whose own comment calls out the IDOR it prevents — and then passed that
same integer into `estimateClosingProbability(buyerProfileId, propertyId)`,
which resolved `eq(buyerProfiles.id, <a qualification id>)` with **no org
predicate**. Two tables, two independent serial sequences. Whenever they lined
up, the caller read another tenant's buyer profile: budget band, `preApproved`,
urgency, financing type, acreage preferences. The `propertyId` argument on the
same call came off the query string and was never checked at all, so any
authenticated user could also reach any property row in the database.

The fix is the shape, not the patch: the ownership helper now returns the ROW
rather than the id. The id-only version was an IDOR generator by construction —
`:id` is one table's key, and every caller needing anything else about the
qualification had to GUESS. Returning the row means `owned.buyerProfileId` is
there to be used, and there is nothing to guess.

**The repository's own register already had it.** `check-org-scoped-fetch.mjs`
carried `"server/services/buyerQualificationBot.ts::estimateClosingProbability"`
in `BASELINE_UNUSED_ORG` — one of the 539 baselined tenancy entries. Frozen debt
is a list of live defects with the alarm turned off. That is also how the fix
was CONFIRMED, and it is better evidence than any mock: adding the org predicate
made the entry stale, the gate failed demanding its removal, and deleting it
dropped the register to **538**. The gate reported the fix without being asked
to.

**The bulk form of a delete was reachable by people denied its unit form.**
`POST /api/clear-demo-data` carried `isAuthenticated, getOrCreateOrg` and
nothing else. It deletes the org's ENTIRE FK closure — leads, properties, deals,
notes, payments, activity log, and every table that transitively blocks them.
`member`, `va` and `viewer` are each blocked from deleting a single lead
(`canDeleteLeads: false`) and could all call it. The confirmation lived in the
client, which is a dialog, not a permission.

Guarded with `requirePermission("canDeleteOrg")` — owner-only, and deliberately
not `canDeleteProperties`: this exceeds any per-entity delete, it takes payments
with it, and it is irreversible. An ADMIN may delete properties one at a time
and still cannot empty the workspace in one call. That asymmetry is the intent,
not an oversight.

Worth recording without acting on it: the endpoint does not clear "demo data",
it clears all data. The Settings UI and its toast are honest about that ("All
leads, properties, deals, notes, and payments were removed from your
workspace"); only the path is legacy. Left alone because renaming a route the
client calls buys nothing — but the path is not a description of the blast
radius, and the comment now says so at the site.

**Exit test.** `routeGuardMatchesAuthority.test.ts`. The IDOR half runs the REAL
router under supertest with the service mocked, and asserts the arguments: the
org is passed, the second argument is the buyer profile id (77), and it is NOT
the qualification id (41). A vacuity case pins that the two differ in the
fixture, because if they were equal the assertion would pass against the
defective implementation too. Two regression cases hold the pre-existing guard:
a foreign qualification still 404s and a missing `propertyId` still 400s, both
before the service is reached.

The permission half pins the RULE rather than the route: over the real
permission table, every role denied the unit delete must also be denied
`canDeleteOrg` — with a counter asserting that some role IS denied the unit
delete, or the loop would be checking nothing. Plus both vacuity directions on
the permission itself (not held by everyone, not held by no one), and a source
case falsified by stripping the guard from a copy of the registration.


### 41 — THE CLIENT SAID DELETED; THE SERVER SAID QUEUED; THE FULFILLER THROWS

Frontier item 6, closed on the half that is unambiguous. Two customer-facing
claims, both contradicted by the response they were reading.

**The export downloaded a receipt.** `POST /api/privacy/export` returns **202**
with `{ requestId, status: "queued", eta: "24h", message: "…queued. You will
receive an email within 24 hours when it is ready." }`. Settings → Privacy
called `res.blob()` on that, saved it as `acreOS-data-export-<date>.json`, and
toasted **"Data export downloaded"**. The user got a file named as their
personal data containing a queue receipt — worse than an error, because it is a
plausible artefact they may never open. Under GDPR Article 15 it is also a
subject-access request the user believes was answered.

**The deletion signed them out.** `POST /api/privacy/delete` returns 202 and
says, in its own message, *"Your account remains active until then."* The same
page toasted **"Account anonymized — Your personal data has been deleted"** and
called `logout()` three seconds later. It asserted the opposite of what the
server said, and then removed the one way the user could have checked.

**Nothing had been deleted, and the founder end already said so.** The erasure
fulfiller `runErasureStub` (`routes-dsar.ts:105`) throws by design, and the
founder fulfilment endpoint returns **501 NOT_IMPLEMENTED** with the message
"Implement: erasure (legal-hold check + soft-delete)". Its comment reads
"Stubbing keeps the operator UI honest about its current capability" — which it
does. The operator surface was honest about a capability the customer surface
was claiming.

**The honest version was one page over.** `pages/privacy-settings.tsx` reads the
JSON, toasts "Export queued" / "Deletion queued", quotes the server's own eta
and does not sign anyone out. Both surfaces are live — `/privacy-settings` as a
route and `PrivacyDataSettings` inside Settings — on the same two endpoints. The
fix is the sibling's shape, adopted. This is the pattern this campaign keeps
finding, one file further out than usual: *the correct rule is already in the
codebase, and the defect is a second implementation of the same thing.*

**Deliberately NOT changed.** The server's "within 24 hours" is a promise
nothing currently fulfils. Softening it is a policy statement with legal weight
— GDPR allows a month, AcreOS chose to advertise a day — and the SLA row
(`slaDeadlineAt`) exists so a human can act. That is a founder/counsel call, not
an engineering one, and it is on the frontier rather than in this commit.

**Exit test.** `privacyRightsSurfaceIsHonest.test.tsx` MOUNTS the component
under jsdom, stubs `fetch` to return the real 202 receipt, clicks the real
button, and asserts the behaviour rather than the copy: `URL.createObjectURL` is
never called and no anchor is ever clicked. Copy is asserted second ("queued",
never "downloaded"), with a vacuity case proving the request actually went out —
otherwise two absence checks would pass over a page that does nothing. A source
half pins BOTH surfaces, because one being honest and one not is exactly how
this happened.

**A second thing this unit exposed, in the gates rather than the product.**
The full suite went red on `modelPrefixGate.test.ts` with an `fs` stack trace —
not an assertion, a crash. Three gates in this repository (`check-model-prefix`,
`check-measurement-defaults`, `lint-reachability`) walk `server/**` and read
every file, and three test files WRITE a probe into `server/services`, run the
real gate, and delete it again. vitest runs test files in parallel, so a path
listed by a walk can be gone by the time it is read. `readFileSync` threw
ENOENT and the gate died mid-scan.

The failure mode is worse than flakiness: a gate that crashes produces a RED
that reads as a finding, and the natural response to an intermittent red is to
stop believing the gate. All four walkers (those three plus the live
`check-model-ids` probe) now tolerate a vanished file — and COUNT it, with a
ceiling of five and a printed tally, because one or two is a concurrent
self-test and dozens means the tree moved underneath the scan. A verdict over a
moving tree is not a verdict.

**And that source half caught me doing ledger 35's defect.** Its first draft
failed — on the fix's OWN comments, which quote the old strings ("Account
anonymized", "res.blob()") to explain what went wrong. A scanner reading prose
as code, inside a test about honesty, hours after I extracted the stripper that
prevents it. It now calls `stripCommentsPreservingLines`, and the incident is
recorded in the file rather than quietly fixed: the failure mode is not rare
enough to trust anyone to remember it, including whoever just wrote the fix.


### 42 — "CONSERVATIVE ESTIMATE" IS STILL A NUMBER NOBODY SPENT

Frontier item 13, closed. The Settings card that tells a customer what their AI
cost them was computing three of its inputs.

**The defect.** `GET /api/ai/cost-savings` backs `AICostDashboard` — "Actual
Cost / What you paid", "Without smart routing / What the same work would have
cost". Its loop:

```ts
const provider = metadata.provider || "openai";
const model = metadata.model || "gpt-4o";
…
} else {
  const AVG_TOKENS_PER_CALL = 1000; // Conservative estimate
  actualCost = (AVG_TOKENS_PER_CALL * modelRate) / 1_000_000;
```

A usage row carrying neither a recorded cost nor token counts was priced at an
assumed thousand tokens on an assumed model from an assumed provider, and the
result was added to the figure labelled as money the customer actually spent.
*Conservative* is not a defence — nobody asked for a conservative estimate of
their bill, they were shown a number.

**The two errors pointed the same way.** `MODEL_COSTS[model] || GPT4O_RATE`
priced an unknown model at the premium rate, which inflated the spend AND the
"savings" computed against it. The card read as both more expensive and more
impressive than the truth.

**And it was a second cost table.** Four hardcoded blended rates declared inline
in the route, two keyed on ids no provider serves — `gpt-4o` and `gpt-4o-mini`
are OpenAI's bare names and this platform calls OpenRouter (ledger 36) — and one
on the retired `deepseek/deepseek-reasoner` (ledger 34). All of it sitting
beneath `services/models.ts`, whose `priceFor` docblock reads: *"This is the
ONLY price surface callers should use — there is no second cost table."* There
was, and it had been wrong for two model generations, because the canonical
table's boot guard cannot see a copy.

**The fix, and why it moved out of the route.** `summariseCostSavings` in
`services/aiCostSavings.ts` is a pure function over usage rows. It refuses to
price a call with no model, an unknown model, no provider, or no evidence, and
returns `unpricedCalls` alongside the totals — because a total that silently
covers fewer calls than were made is the same lie one step quieter. The card
now says "N not priced" and explains why. Where token counts exist it prices
input and output at their real separate rates instead of a 1:1 blend, which the
old code applied even when it had both counts.

Extracting it was not tidying. Inline, the money arithmetic on a
customer-facing surface could only be tested by mounting the whole AI router,
which is why it never was. Out here every rule is checkable with no mocks at
all, and the route is four lines.

**`estimatedCost: 0` is not evidence.** It means nobody wrote a cost down, not
that the call was free, so it is unpriced. The old code's `> 0` check already
had this right and then fell through to the fabricating branch; now it falls
through to the refusal.

**Exit test.** `aiCostSavingsRefusesToGuess.test.ts`, thirteen cases against the
real function and the real price table. The load-bearing ones are the refusals,
each asserting **exactly zero** dollars — the assertion the old implementation
could not pass. Both directions on the pricing: an input-only call and an
output-only call must NOT cost the same (the blend is gone), the premium model
saves nothing against itself, per-provider calls reconcile with the priced
total, and an empty month is zeroes rather than `NaN`. Plus a source case that
the second table and the thousand-token assumption have not come back — comments
stripped, per ledger 35.


### 43 — LAND COULD CALCULATE BUT NOT DECIDE

Frontier item 7, and the one the campaign's own §19 asks for: make land
demonstrate AcreOS's canonical thesis rather than be the strategy that misses
it.

**The gap.** `POST /api/data-intel/blind-offer` computed a full report — comp
analysis, three offer tiers, a cash-flip exit, an owner-finance exit, a letter —
and returned it. Nothing was persisted. Land was the only strategy in AcreOS
that could produce a number and never a DECISION: the operator calculated, the
report evaporated, and when the offer landed or died there was nothing to attach
that outcome to. The fix-and-flip analyzer has written into the canonical loop
since it became the first customer surface to do so; land had the economics
(ledger 30 gave it `computeLandDeal`) and no commit point.

**Found on the way in: the parcel identity was crossing the link and landing
nowhere.** `maps.tsx` and `parcel-detail.tsx` have always linked in as
`/blind-offer-wizard?propertyId=<id>`, and `SnapshotPrefill` did not carry
`propertyId` — so the wizard read state, county and acres and dropped the one
field identifying WHICH parcel. An operator who clicked "make an offer" on a
specific parcel re-entered its details by hand. Harmless while the wizard only
calculated; fatal to a commit point, because a decision is ABOUT a subject and
that was the subject.

**One mapping, two callers, deliberately.** The wizard's numbers come from
`buildCashFlipScenario`; the commit's come from `recordScenario` running the
registered `land_deal` engine, which recomputes rather than accepting figures
(a caller that hands over pre-computed numbers can hand over any numbers at
all, and the stored `engine_version` would then be a claim rather than a fact).
Those are two paths to the same arithmetic, and if they drift the record of a
decision does not match the screen it was made on — the single failure a frozen
scenario exists to prevent. So `landDealEngineInputs` is shared by both rather
than copied into the new endpoint, which is what the seven-line conversion was
one commit away from becoming.

**Three things unlike the flip analyzer's version, each on purpose.**

*It is not best-effort.* There the decision record is a bonus attached to an
offer row created regardless, so a bookkeeping failure must not cost the
operator their draft. Here the decision IS the deliverable — the endpoint
produces nothing else — so a failed write fails the request. Saying "Decision
recorded" over a write that did not happen is exactly the defect ledger 41
closed one surface over, and this is the shape that would have reproduced it.

*The alternatives are real.* The report offers three tiers; committing to one
means declining two, and `FrozenAlternative` exists precisely for that. The flip
analyzer passes an empty array because it has no rival option to name.

*The land-status guard applies.* `POST /blind-offer` refuses to CALCULATE on an
Indian-Country or federal-trust parcel. A decision to OFFER on one is refused by
the same `assertFeeSimpleOrThrow`. A guard covering the calculator and not the
commitment is worse than none, because it reads as covered.

**The refusal in the UI is the honest half.** A wizard session that began from a
county rather than a parcel has nothing to decide about, and the commit card
says so in those words instead of hiding, disabling silently, or inventing a
subject. County-level exploration is a legitimate way to use this wizard; it is
simply not a decision.

**And a second race, found because the first fix was incomplete.** Ledger 41
hardened four gate SCRIPTS against a file vanishing mid-walk. The next full
suite went red anyway — in `moneyCustodyHardStop.test.ts`, whose own source walk
hit the same ENOENT. The class is broader than the scripts: **~69 test files
walk `server/**` and read every file**, and three test files write a probe into
`server/services`, run the real gate, and delete it. Tolerating ENOENT in the
readers is sixty-nine edits that will drift; not creating and destroying files
inside the tree everything else is reading is the fix.

`check-measurement-defaults.mjs` and `check-model-prefix.mjs` now take
`--root DIR` — the flag `lint-reachability` has always had, which is exactly why
its self-test never had this problem — and their self-tests build a throwaway
tree. Two of the three probe writers are gone from the live tree, and their
`.gitignore` entries with them. The third (`orgScopedFetchCoverage`'s rule-3
canary) needs the same flag on a gate with five registers and two vacuity
blocks; it is on the frontier rather than half-done here.

Worth naming the general shape, because it recurs: a self-test that proves a
gate FIRES has to put something wrong into the world for a moment, and "the
world" was shared mutable state. The fixture tree is the same fix as passing a
registry into `computeScenario` instead of reading a global — give the check its
own world rather than borrowing everyone's.

**Exit test, in two files because the risks are different.**
`blindOfferCommitsADecision.test.ts` pins the ARITHMETIC with no mocks at all:
the shared mapping's outputs spelled out rather than recomputed with the same
expression, the registered engine's `profit` equal to the direct calculator's,
an org rule visibly moving the frozen inputs and marked `user` while an untouched
field stays `platform-default`, `marketingCents` held at zero against the
double-count that would understate every land decision ever frozen, and a
vacuity case proving the mapping depends on BOTH dollar figures — without it,
one fixture could hide a mapping that ignored the sale price.

`blindOfferCommitRoute.test.ts` pins the route's obligations: the scenario is
written first and cited by the decision, the authority is
`org_member:blind_offer_commit` and the actor the real user (a generic
"autonomous" would be false), the review date is never manufactured, a foreign
parcel is a 404 with nothing recorded, a trust parcel is refused, a malformed
body never reaches the database, and — the one that matters most — **a failing
decision write returns 5xx rather than a 201 with no decision behind it**.


### 44 — TWO SKIP-TRACE PATHS, ONE GOVERNED, AND THE UNGOVERNED ONE WAS THE REACHABLE ONE

A short entry, and half of it is a correction to my own frontier claim.

**The deletion.** `batchLeadsSkipTrace` (`services/connectors/executor.ts`) ran
a consumer-report lookup with a bare `fetch` to `api.batchleads.io`: no provider
registry, so no `provider_cache`, no circuit breaker, no telemetry, no cost
accounting, and no license check. AcreOS already had a governed skip-trace path
— `services/providers/batchdata-provider.ts` registers the `skip_trace`
category with a cost of 15, a circuit breaker, and `license: "proprietary"`
marking the feed as non-redistributable. Two implementations of the same
regulated lookup, one governed and one not, and the ungoverned one was the one a
customer could reach by typing a sentence to Pax. Their credentials did not even
come from the same store.

Deletion-revealed rather than hunted: ledger 38's FCRA gate returns before the
dispatch switch, so the branch was unreachable the moment that landed, and Pax
was the executor's only caller — two references in the whole repository, the
dynamic import and the call, both in one file. The TOOL stays and still refuses;
a refusal that names what it needs and where to do it beats a tool that vanishes
and leaves Pax improvising.

**The correction, which matters more than the deletion.** The frontier entry I
wrote for this said FIVE executors bypass the registry and framed the gap as
*"the missing half is the customer's money"*. Checked against the registry: it
explicitly supports BYO keys — *"runs on their account, platform COGS $0, pool
never debited"* — so a BYO connector not debiting the credit pool is CORRECT.
The framing was wrong for four of the five. What those four genuinely lack is
caching (the org pays its vendor twice for the same lookup), circuit breaking,
telemetry and license flags; and routing them through the registry means writing
two new providers AND migrating their credentials between two stores. Real work,
correctly sized on the frontier now instead of under-described.

The framing DID hold for the one deleted: a proprietary, non-redistributable
consumer-report feed with no license check on it.

**Recorded because it is the same failure mode this campaign keeps finding, one
level up.** A frontier entry is a hypothesis. I wrote "five … the customer's
money" from a grep and a rule in CLAUDE.md, without checking whether the rule
applied to a BYO key. Had I "fixed" it as written, four connectors would have
been routed through a credit path they should not be on. The audit of one's own
backlog is the same discipline as the audit of one's own code, and it is easier
to skip because a backlog entry feels like a note rather than a claim.

**Exit test.** No new file. `paxToolScopeAndFcra.test.ts` kept a throwing mock
asserting the executor was never called; with nothing left to call, that
assertion would have been true no matter what the gate did — decoration by
deletion. Replaced with a source case asserting the dispatch branch and the
export are actually gone, and that the TOOL still exists so the refusal still
has a voice.


### 45 — THE ACCUSING SCAN WAS THE ONE STILL READING PROSE, AND FIXING IT SPLIT THE FAMILY IN TWO

Ledger 35 caught `lint-reachability` reading comments and fixed it — halfway, on
purpose. It stripped the two scans that grant EXEMPTIONS (a dynamic-import
specifier in a comment marked a whole module unassertable; a `from "./x"` in a
comment suppressed an orphan) and left the identifier pass — the scan that
ACCUSES — reading raw source. The asymmetry was deliberate and written down at
the time: a wrong exemption hides a finding, a wrong accusation names innocent
code, and this gate's standing posture is that a miss beats a false accusation.

So for a further day the gate still counted a symbol NAMED IN PROSE as a
production use of it. `InvestorVerificationService` had sat in this linter's own
allowlist for exactly that reason — its only consumer anywhere in the repository
was a stale `TODO`.

**WHAT MADE IT LANDABLE WAS READING THE POPULATION, NOT COUNTING IT.** The
frontier had carried "88 exports are certified reached by a COMMENT" since
2026-08-19 as one indivisible cost, because the down-only ratchet means every
revealed item must be adjudicated in the landing commit. All 86 newly-revealed
symbols were searched by hand across `server/`, `client/src/`, `shared/` and
`scripts/`, comments stripped, tests excluded, and the two files that ENUMERATE
symbols excluded for the reason the linter itself excludes them. Three buckets:

- **0** had an external reference the pass would now miss. That is the number
  that mattered: the strip produces no false accusations, so it needed no
  smarter resolver.
- **20** were the accusation — declared, and referenced nowhere.
- **66** were something else entirely: exported, then used only inside their own
  module.

**THE 66 ARE A DIFFERENT RULE, AND THAT IS THE ENTRY.** "Nothing anywhere
touches this" and "exported wider than it is used" have different remedies
(delete the code / delete the keyword), different risk (dead weight / none at
runtime), and — applied to the whole repo, not just the newly revealed — wildly
different sizes: **1,188 against 390**. Merged, the real accusations sat under
harmless over-exports four to one, and a gate whose findings are mostly noise
teaches its readers to skim it. So the strip landed WITH a split:
`internal-only-exports` is now its own family with its own down-only baseline.

`unreachedExports` therefore reads 1395 → 390 and **nothing was deleted**. The
ratchet note says so in its first line, because a future reader finding that drop
in the history would otherwise credit a cleanup that never happened.

**THE ASYMMETRY, AGAIN, ONE LEVEL DOWN.** Opacity (a dynamically-imported module's
exports are never called dead) is an exemption from the DEATH accusation and only
that. `internal-only` proposes something weaker — keep the code, drop the keyword
— whose cost when wrong is a compile error on the next build, so it looks through
the exemption while the accusation still never does. That reclaimed **97 of the
120 opaque exports**: they were exports the module itself used, which opacity was
never protecting. The blind spot is now 23, and every one of those is what the
name always promised.

**THE THREE THINGS IT REVEALED.** Nine of the twenty accusations have real
behavioural tests exercising them and no production caller at all — a green unit
test is the strongest possible evidence that code WORKS and no evidence whatever
that anything RUNS it, which is this codebase's most common defect wearing its
most convincing disguise. Two are copy constants for compliance surfaces
(`AUDIT_CHAIN_TAMPER_EVIDENCE_COPY`, `SCREENING_ADVISORY_COPY`) — a product gap
in a dead-code costume, to be read before being deleted. And five are the webhook
convenience wrappers whose deadness `webhookEventCatalogue.test.ts` already states
in its own docblock, so their adjudication was already made and only needed
finding.

**THE ONE RAISE, AND WHY IT IS NOT LAUNDERING.** `moduleOrphans` 28 → 30. Two
files stopped being certified by a sentence: `agentOrchestration.ts` (1,317 lines,
zero importers, zero tests) and `lateFees/index.ts` — the 12 C.F.R.
§1026.36(c)(2) non-pyramiding assessor named in this very gate's description as
the original worked example of built-but-unwired. Both were ALWAYS orphans; the
gate simply could not see them. Neither is allowlisted, because neither is a
deliberately-staged seam and an allowlist entry that means "TODO" is the gate
laundering its own findings. They are recorded on the frontier as two separate
decisions of different kinds: deleting `agentOrchestration` orphans two tables it
exclusively owns and the honest version includes a DROP migration on data nobody
has inspected; `lateFees` is a REGULATED obligation whose remedy is WIRING, and
the live path is advisory BY DESIGN — `acquiredNoteAging.ts` says in its header
that it "touches no ledger, and moves nothing" — so turning an advisory into a
ledger-writing assessment is a product ruling, not a gate fix.

**AND IT DID NOT FULLY CLOSE.** The identifier pass now skips comments and still
reads STRING LITERALS, so the same concealment survives one representation over —
which is the first law of this repo's gates arriving on schedule. The worked
example is the same symbol as the one that motivated the comment fix:
`constitution.ts`'s hard-stop entry names `spendIsAutonomous()` three times in a
`note:` string, and that symbol has one occurrence in its own module and no
production caller. A regex strip of string literals was written, measured
(unreached 390 → 1526) and thrown away in the same hour: it trips on the first
apostrophe inside a double-quoted sentence and swallows code to the next one, so
the number is noise, not a finding. Frontier item 18, unmeasured on purpose
rather than measured badly, and harder than its predecessor because SOME string
references are genuine — a string-keyed registry really does reach a symbol — so
that direction produces false accusations where this one produced none.

**Exit test.** Three fixtures, each mutating the thing the gate GOVERNS and
watched failing first: prose vs. code for the same symbol in the same file on
adjacent lines; the internal/unreached split (with the remedy text read off the
FAILING path, since remedies do not print on a pass); and opacity, carrying one
symbol on each side of the asymmetry. A fourth pins the trap the split created —
`module-orphans` derives from the export findings, so a file whose exports all
call each other would have silently dropped out of it. That fixture's first
version passed against the broken code because it still contained one
declaration-only export; it is now written so every export is internal, and the
mutation fails it. `reachabilityBlindSpot.test.ts`'s "opacity is decided per
MODULE" assertion was REWRITTEN rather than deleted, per the wave rule: the
internal-use selector is now the only symbol-level condition permitted in front
of the module test, so pushing a symbol test into `isDynamicallyImported` still
trips it.


### 46 — THE UNKNOWN MODEL WAS THE CHEAPEST THING IN THE LEDGER

`DEFAULT_RATE` is the per-million price applied to any model id the platform
does not recognise. It read:

```ts
// Conservative fallback for unknown models — assume mid-tier pricing.
// Better to slightly overcount than to silently $0 a real call.
export const DEFAULT_RATE: AICostRate = { input: 1.0, output: 3.0 };
```

$1/$3 sits BELOW ten of that table's rows on input and twelve on output. Against
Opus it is one fifth of input and one eighth of output. The comment states the
posture the file wants; the number implements its opposite.

**It is not a display.** `computeCostUsd` writes this figure into
`ai_telemetry_events.estimated_cost_cents`, and `aiCostCeiling.sumCostCentsSince`
SUMS that column to decide whether an org has passed its daily and monthly AI
ceiling. So an unrecognised model drew down a FREE org's $2/day allowance at a
fifth of its true rate — on the order of $16/day of real Opus-equivalent COGS
before the gate tripped — and every gate in the stack reported green throughout.
`predictCostCents` reads the same table to forecast whether the next call fits
under the ceiling, so the unknown model also looked like the cheap one to route
to. The undercount fed the router that chose it.

**AND IT HAD ALREADY SURVIVED ITS OWN FIX.** `aiRouter.estimateCost` once kept a
private cost table. Its docblock still records the repair, and this is the whole
entry in one sentence:

> "unkeyed models fell back to a silent {input:1,output:3}. Now … costed via the
> central **conservative** DEFAULT_RATE."

The central DEFAULT_RATE *was* `{input:1, output:3}`. The centralisation was
real and worth doing — one table, no second copy to drift — and the SEMANTIC
defect crossed straight through it, unchanged, reached by a different route, and
came out wearing an adjective that asserted the opposite. CLAUDE.md's first law
says to prove the forbidden behaviour cannot be reintroduced through an
equivalent representation. Here the equivalent representation was the same
literal in a better location, and the word "conservative" is what stopped anyone
looking again.

**Everything else in that file already resolved toward caution**, which is what
makes the exception legible rather than a general sloppiness: `CHARS_PER_TOKEN`
is padded to 4.0 "so the predictor never under-bills"; `outputTokens` falls back
to the `maxTokens` ceiling as "a deliberately conservative upper bound"; Haiku is
metered at first-party $1/$5 rather than OpenRouter's cheaper listing, citing
"this file's own philosophy (better to slightly overcount)". Every knob was set
cautiously except the one governing a model nobody recognised — the case where
least is known and caution matters most.

**The fix is a derivation, not a bigger number.** `DEFAULT_RATE` is now
`Math.max` over the table on each axis independently, so there is no longer a
value anyone can set below the rows it is supposed to dominate. `cachedInput`
stays undefined: we cannot know an unrecognised model supports prompt caching,
so its cached portion bills at the full input rate. Today it resolves to
$15.00/$75.00 — the legacy `anthropic/claude-opus-4` row, a real price that was
really billed. If that is judged too punitive, the answer is to retire that row
on purpose, never to reintroduce a floor beneath the table.

Overcounting an unknown model pauses AI early: visible, complained about, and
fixed by adding one line to the table. Undercounting spends real money and
reports green.

**This does NOT contradict ledger 42**, and the difference is the point. There,
`summariseCostSavings` was made to REFUSE to price an unknown model and report
`unpricedCalls` instead. Here the ceiling prices one at the dearest known rate.
Both follow the same rule from opposite sides: 42's number is a CLAIM MADE TO A
CUSTOMER about what they saved, and a guess presented as a measurement is
fabrication; 46's number is a SAFETY LIMIT, and refusing to price would mean not
counting, which unbounds the thing the limit exists to bound. Checked rather than
assumed: `summariseCostSavings` guards every record with `isKnownModel` before it
reaches `priceFor`, so it never touches `DEFAULT_RATE` and this change does not
move a single figure on the customer-facing savings card.

**Exit test.** `unknownModelCostsTheMost.test.ts`, falsified four ways, each
watched failing first:

1. restore `{1.0, 3.0}` → three cases fail;
2. replace the derivation with `{15.0, 75.0}`, correct TODAY → only the
   derivation case fails, which is precisely its job;
3. add a dearer row while the value is derived → all eight still pass, because
   the value follows the table;
4. **(2) and (3) together — the actual drift** → three fail.

The rule is checked through `computeCostUsd` across six token mixes including a
fully cache-warmed call (the cheapest a known row ever gets), not against the
constant alone, because the constant does not cover the cached-input path. Two
vacuity cases run first: the table has more than eight rows, the id used as
"unknown" really is absent, and more than five rows are dearer than the old
default — without that last one the rule could be satisfied by a table where
nothing costs more than $1/$3.

The source case that pins the derivation strips comments before scanning. It has
to: the note explaining this defect quotes `{ input: 1.0, output: 3.0 }`
verbatim, and a scan that reads prose would match the explanation of the defect
and call it the defect. Ledger 35's lesson, arriving as a practical constraint
two commits after ledger 45 generalised it.

**A correction this turned up.** Frontier item 16 claimed AcreOS had "no per-ORG
cap" on the VA path and needed one built. False at HEAD: `assertWithinAiCostCeiling`
enforces per-org daily AND monthly ceilings with tier-proportional defaults,
founder overrides, a last-known-good spend cache, and a fail-closed posture for
autonomous callers. Acting on the entry would have built a second copy of a
control that already exists — the exact defect this ledger entry is about, one
layer up. The entry is corrected in place. Second time a frontier claim has been
wrong (ledger 44 was the first); both times it read as a note rather than a
claim.


## Status

**All 34 admitted candidates are now dispositioned** — implemented, adapted,
retired as already-present, or checked and REJECTED with the evidence recorded.
The three rejections are in entries 14, 16 and 18.

Entries numbered above 34 are NOT Foundry candidates. They are findings this
ledger's own work turned up and which belong beside it because the reasoning
continues from an entry here; each says so in its first line. Do not read the
entry count as a transfer count.


## Not yet dispositioned

The 2026-08-17 read produced seven Foundry themes; the three above are closed.
The full agent output is large and lives outside the repo — re-derive from
Foundry directly rather than trusting a summary, per the wave-discipline rule
that a report is a hypothesis.

Themes noted but not yet tested against AcreOS HEAD:

- ~~**Observer independence**~~ — CLOSED as ledger entry 12. It was relevant to
  the outcome-grading path, and worse than the Foundry shape: AcreOS's verifier
  did not merely carry its own expectation, it re-read the actor's own execution
  record and called that an outcome.
- ~~**Deny-dominant, bidirectional authority scoping**~~ — CLOSED as ledger
  entry 23. AcreOS has no path-scoped authority *grants*, but it had three
  copies of the same containment mistake in its posture-gate *exemption* lists,
  where the guarantee at stake (viewer read-only) is a security one. The
  client-side analogue was checked and REJECTED: `resolveHiddenRoutes` matches
  doors by exact string, not prefix, and `sidebarHiddenRoutes.test.ts` already
  derives the protected door set from the parsed `NAV_MODULES` rather than
  re-listing it, so a door cannot be hidden by a broader entry and the door set
  cannot drift.
- ~~**Refusing promotion into an unproven state at the write**~~ — CLOSED as
  ledger entry 24. AcreOS refused the unproven Pax level by ABSENCE, which held,
  but its READ of the level was a cast that made any unrecognised value more
  permissive than the default. Testing the theme against the sibling VA-agent
  lane found the larger defect: a risk classifier whose residue resolved
  DOWNWARD, so any action it did not recognise auto-executed at the default
  autonomy level.
- **Owner direction that is structurally non-authoritative** — a disposition
  ledger with no consent/scope/capability column, so no later authority lookup
  can read it (`118_judgment_owner_disposition.sql`).
- **Public-claim auditing against code-derived sources** (`audit-public-claims.mjs`).
  Closest AcreOS analogue is the `lint:no-fabrication` gate plus OD-5's finding
  that two public surfaces publish vertical maturity and can already drift.

Each still has to pass the ten-point test on its own evidence. None is admitted
by association with the three that did.
