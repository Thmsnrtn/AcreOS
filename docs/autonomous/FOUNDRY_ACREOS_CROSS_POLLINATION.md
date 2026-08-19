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

## Status

**All 32 admitted candidates are now dispositioned** — implemented, adapted,
retired as already-present, or checked and REJECTED with the evidence recorded.
The three rejections are in entries 14, 16 and 18.


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
