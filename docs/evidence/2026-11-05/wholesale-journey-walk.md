# Wholesale journey walk — the Leg 5 staging proof (script)

**What this is.** The scripted walk that is the evidence for a later, separate
PR lifting `residential_wholesaler`'s `beta` demotion. It runs on **staging
only**, after Legs 1–4 merge and staging deploys. The walk needs a
staging session, which this build session did not have. The same API sequence
is rehearsed against a real database on main, with all four legs landed
(`tests/unit/wholesaleJourney.realdb.test.ts`).
That rehearsal proves the walk is possible in code; it is not the staging
proof.

**Fences for the walker.**
- Staging host only (`acreos-staging`). Never production.
- A fresh, synthetic org, with no sample data (skip onboarding step 2).
- **No production send of any kind.** The blast is previewed only (`dryRun:
  true`). Seller follow-ups are drafts only. No real buyer, seller or
  counterparty email is used anywhere.
- No Stripe. Every fee is a record.
- The e-sign step uses the org's own connected rail, signed by test identities
  the walker controls.

**PASS** requires every row below observed and recorded in the Readiness
Atlas row: the run id, the time in ET and the staging image. Any FAIL row
stops the walk. The lift PR is not opened on a partial walk.

| # | Step | How | Must observe |
|---|------|-----|--------------|
| 1 | Activate | Sign up a fresh user → `/onboarding-v2` → business type **Residential wholesaler** → skip sample data → finish | Lands on Today; the Wholesale module shows **Underwrite an offer** and **Buy box**; no sample rows exist |
| 2 | Buy box | Wholesale module → **Buy box** (`/wholesale/buy-box`). Enter states `TX`, a max contract price of $200,000 and a retire window of 30 days → **Save as a new version**. Change one field and save again | "Version 2 is current (2 saved)." `GET /api/wholesale/buy-box` lists versions 2 and 1, newest first, and version 1 is unchanged. Nothing outside the buy box is written: no list, no owner, no skip-trace |
| 3 | Candidates | Add two properties by hand (Map or Deals door): a **TX** one for the pass leg and an **IL** one for the block leg, both status **prospect**, each with an acquisition deal carrying an offer under $200,000. Open the buy-box triage | Triage reads only the org's own candidates (status prospect / due diligence / offer sent). TX: **Fits**. IL: **Doesn't fit**, "In IL, outside your states (TX)." Triage writes nothing |
| 4 | Decision | `/wholesale/underwrite?propertyId=<TX>`: fill all seven numbers, ≥1 sold comp, ARV basis, fee basis; call **Offer**; review in 14 days; Record | "Recorded as decision #N". Decision Memory shows the decision citing a `wholesale_mao` scenario. The comps and both bases are on the scenario as "Your input"; the binding side is "Derived" |
| 4b | Under contract | The seller accepts: on both deals set the accepted price and a closing date, and set both properties to **under contract** | Both properties leave triage (no longer candidates). From here they are assignable contract rights, which is the state the compliance gate governs |
| 5 | Contract | Deal → contract preview → draft (`assignment_of_contract`) | Preview writes nothing; the draft is created only after the hash is echoed back; nothing is sent |
| 6a | Compliance — block | IL property: blast preview, listing create, listing publish dry run, flyer, and a generated assignment document | Every one returns `wholesaler_compliance_blocked` (409). No listing, blast row, flyer or document is produced. **The IL contract-chain draft is refused EARLIER** (`STATE_NOT_CONFIGURED`), because no reviewed IL assignment template exists. That is expected; record it, and note it is not the state-rule gate |
| 6b | Compliance — pass | TX property: the same five | None is refused on compliance |
| 6c | Compliance — warn | **Only if** staging has a warn-state row (CA / SC / PA in the repo seed): blast preview shows the warning; a send without the ack is refused; ticking the ack records one `audit_log` row (`wholesale.compliance_ack`). **Do not send:** stop at the preview, and prove the ack through the contract-draft path instead | One ack row per acknowledged action, naming the surface and the state |
| 7 | Packet / blast preview | TX property: buyer blasts → New blast → property id → **Fill from disposition packet** → **Preview** | Packet price = accepted price + underwritten fee. Change the deal's accepted price, re-fill, and the price moves. Preview lists recipients. **Never press Send** |
| 7b | Seller follow-up draft | Offers page → write a template of type **Follow-up**. TX deal → **Prepare a follow-up draft** → choose the template → review the preview → **Create draft (sends nothing)** → copy it | The preview writes nothing ("Preview — nothing created yet"). Create writes exactly one `generated_documents` draft row on the deal; the toast says nothing was sent. No email, SMS or mail row exists for the proof org. `POST /api/signatures` refuses the draft |
| 8 | Assignment via the e-sign rail | Deal → Assignment → end buyer → generate the assignment → send for signature on the org's own rail → both test signers sign | `contract_assignments` moves draft → doc_generated → sent_for_signature → signed. AcreOS never attests a signature it did not capture |
| 9 | Outcome | `POST /api/wholesale/decisions/<N>/outcome` with `{ exit: "assignment", assignmentId, closedOn }` | `200`. The realised fee equals the signed assignment's fee. Days-to-close is derived from the dates. `GET /api/decisions/<N>/outcomes` shows `profit` **compared** against the frozen prediction |
| 10 | Bundle evidence | (a) For the exact SHA staging serves, read the Build job's bundle-size step (or run `node scripts/check-bundle-size.js` on that SHA). (b) Fetch the JS staging actually serves and search it for the new surfaces' strings (`Version`…`is current`, `Fill from disposition packet`, `Create draft (sends nothing)`) | (a) `PASS`, with the total JS figure recorded against the customer-bundle ceiling in `scripts/bundle-budget.json` (`ceilings.totalKB`) **as of the SHA walked** — read it from that file at that SHA, never from this script, so the criterion cannot go stale (it is 8,639 KB at the SHA this script was last corrected on); a figure from any other SHA does not count. (b) All three strings are present in the deployed bundle, proving the release is in what staging runs, not only in source |

**Before declaring PASS, also record:**
- the count of `wholesaler_state_rules` rows on staging, and which states have
  them (Step 0 could not read staging; the repo seed holds 13);
- that no `buyer_blast_recipients` row was written for the proof org;
- that Stripe shows no object created for the proof org.

**What changed from the #478 version (2026-11-14).** Step 2 is the concrete
buy-box script; the earlier version told the walker to set criteria "through
the page or API" and then put both properties under contract in step 3, which
triage never reads, so the buy box touched nothing in the walk. Step 3 now
uses prospects and checks triage; the acceptance moved to a new step 4b. Step
6b says five surfaces, matching 6a. Step 7b is new: the §6.2 seller follow-up
drafts, which joined Leg 4 in #533. Step 9 expects `200` (the route returns
200). Step 10 requires the bundle figure for the exact SHA walked as well as
the served-string check.
