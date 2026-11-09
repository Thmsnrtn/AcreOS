# Wholesale journey walk — the Leg 5 staging proof (script)

**What this is.** The scripted walk that is the evidence for a later, separate
PR lifting `residential_wholesaler`'s `beta` demotion. It runs on **staging
only**, after Legs 1–4 merge and staging deploys. The walk needs a
staging session, which this build session did not have. The same API sequence
was rehearsed against a local database built from this repo
(`tests/unit/wholesaleJourney.realdb.test.ts`). That rehearsal proves the
walk is possible in code; it is not the staging proof.

**Fences for the walker.**
- Staging host only (`acreos-staging`). Never production.
- A fresh, synthetic org, with no sample data (skip onboarding step 2).
- **No production send of any kind.** The blast is previewed only (`dryRun:
  true`). No real buyer, seller or counterparty email is used anywhere.
- No Stripe. Every fee is a record.
- The e-sign step uses the org's own connected rail, signed by test identities
  the walker controls.

**PASS** requires every row below observed and recorded in the Readiness
Atlas row: the run id, the time in ET and the staging image. Any FAIL row
stops the walk. The lift PR is not opened on a partial walk.

| # | Step | How | Must observe |
|---|------|-----|--------------|
| 1 | Activate | Sign up a fresh user → `/onboarding-v2` → business type **Residential wholesaler** → skip sample data → finish | Lands on Today; the Wholesale module shows **Underwrite an offer**; no sample rows exist |
| 2 | Buy box | State a numeric buy box for the proof org (set the org's buy-box criteria through the buy-box page or API) | The buy box persists: re-read it (reload / GET) and the values come back as entered, and a version record for the box exists |
| 3 | Candidate | Add a property by hand (Map or Deals door). Use a **TX** address for the pass leg and an **IL** address for the block leg. Set status **under contract**. Add an acquisition deal with an accepted price | Two properties, each with one deal and an accepted amount |
| 4 | Decision | `/wholesale/underwrite?propertyId=<TX>`: fill all seven numbers, ≥1 sold comp, ARV basis, fee basis; call **Offer**; review in 14 days; Record | "Recorded as decision #N". Decision Memory shows the decision citing a `wholesale_mao` scenario. The comps and both bases are on the scenario as "Your input"; the binding side is "Derived" |
| 5 | Contract | Deal → contract preview → draft (`assignment_of_contract`) | Preview writes nothing; the draft is created only after the hash is echoed back; nothing is sent |
| 6a | Compliance — block | IL property: blast preview, listing create, listing publish dry run, flyer, and a generated assignment document | Every one returns `wholesaler_compliance_blocked` (409). No listing, blast row, flyer or document is produced. **The IL contract-chain draft is refused EARLIER** (`STATE_NOT_CONFIGURED`), because no reviewed IL assignment template exists. That is expected; record it, and note it is not the state-rule gate |
| 6b | Compliance — pass | TX property: the same four | None is refused on compliance |
| 6c | Compliance — warn | **Only if** staging has a warn-state row (CA / SC / PA in the repo seed): blast preview shows the warning; a send without the ack is refused; ticking the ack records one `audit_log` row (`wholesale.compliance_ack`). **Do not send:** stop at the preview, and prove the ack through the contract-draft path instead | One ack row per acknowledged action, naming the surface and the state |
| 7 | Match / packet / blast preview | TX property: buyer blasts → New blast → property id → **Fill from disposition packet** → **Preview** | Packet price = accepted price + underwritten fee. Change the deal's accepted price, re-fill, and the price moves. Preview lists recipients. **Never press Send** |
| 8 | Assignment via the e-sign rail | Deal → Assignment → end buyer → generate the assignment → send for signature on the org's own rail → both test signers sign | `contract_assignments` moves draft → doc_generated → sent_for_signature → signed. AcreOS never attests a signature it did not capture |
| 9 | Outcome | `POST /api/wholesale/decisions/<N>/outcome` with `{ exit: "assignment", assignmentId, closedOn }` (or the Today prompt) | `201`. The realised fee equals the signed assignment's fee. Days-to-close is derived. `GET /api/decisions/<N>/outcomes` shows `profit` **compared** against the frozen prediction |
| 10 | Bundle evidence | After the walk, (a) record the bundle measurement of the merged tree (total JS KB from the bundle-size check) against the 9,823 KB ceiling, and (b) re-inspect the bundles staging actually serves for the new wholesale surfaces' strings (e.g. buy-box / underwrite strings) to prove the release is in what staging runs, not only in source | The measured total is at or under the 9,823 KB ceiling, the new surfaces' strings are present in the deployed staging bundle, and both figures are recorded in the walk's proof record (the Readiness Atlas row) |

**Before declaring PASS, also record:**
- the count of `wholesaler_state_rules` rows on staging, and which states have
  them (Step 0 could not read staging; the repo seed holds 13);
- that no `buyer_blast_recipients` row was written for the proof org;
- that Stripe shows no object created for the proof org.
