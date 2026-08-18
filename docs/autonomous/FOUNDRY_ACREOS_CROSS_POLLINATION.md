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
| 18 | A route no flag governs is not a route that is off | **ADAPTED** | `controlledRoutes` in `/api/config/features` + `resolveRouteEnabled`, `featureFlagControlScope.test.ts` (this commit) |

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
- **Deny-dominant, bidirectional authority scoping** — a grant may not widen its
  own reach, checked in both directions (`120_development_authority.sql`).
- **Refusing promotion into an unproven state at the write**
  (`115_operating_promotion_freeze.sql`).
- **Owner direction that is structurally non-authoritative** — a disposition
  ledger with no consent/scope/capability column, so no later authority lookup
  can read it (`118_judgment_owner_disposition.sql`).
- **Public-claim auditing against code-derived sources** (`audit-public-claims.mjs`).
  Closest AcreOS analogue is the `lint:no-fabrication` gate plus OD-5's finding
  that two public surfaces publish vertical maturity and can already drift.

Each still has to pass the ten-point test on its own evidence. None is admitted
by association with the three that did.
