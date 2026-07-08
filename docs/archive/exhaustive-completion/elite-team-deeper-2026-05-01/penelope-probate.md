# Penelope Fairweather — Probate-Attorney Audit, AcreOS

**Lens:** I am Penelope Fairweather, 53, partner at Fairweather & Iversen LLP in Annapolis, MD. Thirty-one years of probate, trust administration, and fiduciary litigation. The case at hand: my firm represents the Estate of Cornelius "Neil" Whitford — a Land Investor who operated through AcreOS until his death from pancreatic cancer on March 14, 2026. He left a 2019 pour-over will, a revocable trust amended four times (last amendment 2024), and an account containing **47 active seller-financed notes and 12 wholly-owned parcels** spread across MD, VA, WV, and a single tract in Cumberland County, PA. I was engaged April 2 by his daughter, Adrienne, who is the named successor trustee and one of three residuary beneficiaries. Martin Holbrook's executor-side audit (`martin-estate-executor.md`) is sitting on my desk; I read it before writing this. He is correct that AcreOS has no estate-access surface. I will not re-litigate that. My job here is the **next ring out** — what the platform does (and does not do) once the executor is *in*. Inventory. Valuation as of date-of-death. Beneficiary distributions. Court reports. The will-vs-trust split. The quiet edge cases (intestate, ancillary probate, disclaimer, minor beneficiaries) that account for most of my malpractice exposure.

---

## 1. One-line verdict

**AcreOS has the data a probate inventory needs but no concept of a probate event.** Cost-basis tracking exists (`shared/schema.ts:10378`); date-of-death basis step-up does not. Per-property current-value fields exist (`shared/schema.ts:13041`); a frozen "as-of DoD" snapshot does not. The org can have one or many users; it cannot have a *successor* — only a transferee. Beneficiaries are not a first-class entity, so there is nowhere to record that Parcel 7 passes to Adrienne under the trust, Parcels 8–9 pass per stirpes to two grandchildren under the will, and the remaining 9 parcels are residuary and subject to a pending disclaimer. The platform produces no probate-court-ready inventory document, no Form 706 worksheet, no fiduciary accounting, no K-1 surface for Form 1041 distributions, and has no awareness of multi-state ancillary probate even though one of Neil's parcels triggers it. Will-versus-trust handling is non-existent: AcreOS cannot tell me which assets were titled in the trust on March 14 and which were not, because **it does not store title-vesting at all**. I can extract everything I need from CSV exports and rebuild it in Excel — which is precisely what every probate attorney working an AcreOS estate will do, every time, until the team builds the surface.

---

## 2. The probate timeline AcreOS does not know exists

Probate, simplified, is six phases. I'll mark each one with what AcreOS gives me and what it doesn't.

| Phase | Statutory window (typical) | What I need from the platform | What AcreOS provides |
|---|---|---|---|
| 1. Open the estate | Within 30–90 days of death | Letters Testamentary intake, account-access transfer | Nothing (per Holbrook §3.1) |
| 2. Inventory & appraise | 60–120 days from Letters | Asset list with DoD fair-market value, segregated by trust vs. probate, by jurisdiction | Partial — see §3 |
| 3. Notify creditors / claims period | 4–6 months (varies by state) | List of accounts payable, contingent liabilities, pending litigation | Partial — see §6 |
| 4. Tax filings | Final 1040, Form 1041 (estate income), Form 706 (estate tax) if over exemption | DoD-split income reporting, fiduciary tax workpapers, K-1 generation | Effectively none — see §5 |
| 5. Distribute to beneficiaries | After claims period closes | Distribution worksheet, beneficiary ledgers, partial-distribution tracking | None — see §7 |
| 6. Close the estate | Final accounting → court approval → discharge | Court-formatted accounting, audit trail, signed receipts | None — see §8 |

The tax phase and the distribution phase are where my malpractice carrier's premium is set. They are also where AcreOS contributes the least.

---

## 3. Inventory generation — what's there, what's missing

Maryland Estates & Trusts §7-201 requires an inventory within **three months** of Letters. The inventory must list, per asset: description, fair-market value as of date-of-death, manner of valuation, and (for real property) recordation reference. AcreOS data assets that map to this:

**Usable as-is (with effort):**
- `properties` table (`shared/schema.ts:561`) — gives me parcel identity, APN, county, acreage, recorded deed reference if attached as a document
- `notes` table (`shared/schema.ts:813`) and `notesReceivable` (`shared/schema.ts:11685`) — gives me note ID, borrower, balance, rate, maturity. I can compute principal balance as of DoD if there are no payments between DoD and inventory date.
- `costBasis` table (`shared/schema.ts:10378`) — gives me acquisition price, improvement costs, adjusted basis. **Not** what the inventory wants (which is *fair-market value*, not basis), but useful for the gain/loss calculation that follows distribution.
- `documents` linked to properties — recorded deeds, deeds of trust, original notes. Necessary for the Register of Wills filing.

**Conspicuously missing:**
- **No `dateOfDeathValue` field** on properties or notes. The inventory uses DoD value; this is the single most important number in probate, and AcreOS has no place to put it. Today I would add a `valuations` row per property, dated DoD, source = "appraisal" / "BPO" / "AVM" / "tax-assessor" / "stipulated", with an optional `appraiserCredentials` text and a `supportingDocId` FK. Same for notes (note FMV is not face value — it is discounted by remaining term, rate vs. market, and borrower credit; a 47-note book may need a *bulk valuation* by a note broker). The platform's existing AVM (`server/services/acreOSValuation.ts`) is configured for live underwriting, not retrospective DoD valuation; it would need a "value as of date X" mode, with model lockdown so the number is reproducible if the IRS audits the 706.
- **No "title vesting" field.** Every property and note needs to know: was this titled in the name of (a) Neil individually, (b) the Whitford Family Revocable Trust, (c) Neil & Adrienne JTWROS, (d) Whitford Holdings LLC, (e) tenants-in-common? This determines whether the asset goes through probate at all. AcreOS today has `ownerEntityName` as free text on some property records and nothing on notes. Add a `titleVesting` JSONB with `{ entityType, entityName, percentInterest, recordedReference }` and validate against a per-org list of vesting entities. Then a single query gives me "everything in the trust" vs. "everything in probate."
- **No probate inventory export.** I want a button: `Inventory → Maryland ROW Form 1100`, `Virginia Form CC-1670`, `Pennsylvania REV-1500 (Inheritance Tax + Inventory)`, `West Virginia Appraisement of Estate`. Each has a different schema; each is mechanical. Today, I am hand-typing Neil's into Adobe-Acrobat-fillable PDFs from the four jurisdictions while looking at four CSVs from `routes-import-export.ts`.

---

## 4. Date-of-death valuation — the alternate-valuation-date problem

IRC §2032 lets the executor elect to value the estate either at DoD **or** six months after DoD, whichever produces less estate tax — but the election is **all-or-nothing across the entire estate** and is irrevocable. Land prices are volatile in the Mid-Atlantic right now (high rates, slow buyers, tax-deed redemption activity in the West Virginia counties). My election decision turns on whether the 12 parcels and 47 notes, in aggregate, are worth more or less on September 14, 2026 than on March 14, 2026.

**What AcreOS would need to support this competently:**

- A `valuations` table with `(propertyId | noteId, valuationDate, fairMarketValue, methodology, source, supportingDocId)` rows.
- The ability to pin two snapshots — DoD and DoD+6 — and emit a side-by-side comparison.
- A locked, signed export so the comparison is reproducible. A 706 is audited five years out; the methodology must survive that long.
- Note-specific FMV: a discounted-cash-flow worksheet at each valuation date, with the discount rate driven by then-current note-pricing comps (which AcreOS has on the buy side via `routes-deals.ts` but does not surface for valuation).

Today the platform gives me current values that are **mutated in place**. If a parcel is reassessed by the county on April 30, the `currentValue` field updates and I lose my March 14 number unless I screenshot the dashboard. I am screenshotting the dashboard. This is not a defensible audit posture.

---

## 5. Will, trust, and the title-vesting question AcreOS cannot answer

Neil's estate plan is a **pour-over will + revocable trust** — the most common middle-class structure. The trust holds whatever was retitled into it during life; the will pours residuary probate assets into the trust at death; the trust then governs distribution.

This means every asset in AcreOS belongs to one of four buckets on March 15, 2026:

1. **In the trust on DoD** → not probate. Adrienne, as successor trustee, controls without court supervision. Inventory still required for tax purposes (Form 706 if over exemption) but not for the Register of Wills.
2. **Titled to Neil individually** → probate. Goes through Maryland (his domicile), with ancillary probate in any state where real property sits.
3. **Titled to the LLC** (Whitford Holdings LLC, MD) → the *membership interest* in the LLC is the probate asset, valued in aggregate; the underlying parcels are not individually probated. This is a meaningfully different inventory line.
4. **Titled JTWROS with Adrienne** (one parcel, the family hunting tract) → passes by operation of law, outside probate, recorded by a Survivorship Affidavit.

**AcreOS today cannot tell me which bucket any asset is in.** I am cross-referencing 12 recorded deeds in four counties' land records against AcreOS's parcel list manually. For the notes, it is worse — I need to look at each original note and deed of trust to see whether the *payee* on the note was Neil individually, the trust, or the LLC. AcreOS stores the note but not the payee-of-record.

**What I'd build:** a `titleVesting` and `payeeOfRecord` field on properties and notes respectively, plus an org-level `vestingEntities` table listing each entity with its TIN, formation jurisdiction, and (for trusts) trustee succession order. Then on a "Probate Mode" toggle, the dashboard segregates assets by bucket and produces a per-bucket inventory.

---

## 6. Beneficiary distribution flow — there is no "beneficiary" in AcreOS

Neil's trust distributes:
- 50% residuary to Adrienne outright
- 25% residuary to son Garrett, but in continuing trust until age 35 (he is 31)
- 25% residuary to a Special Needs Trust for daughter Lenore (intellectually disabled, on Medicaid; outright distribution would disqualify her — this is the malpractice landmine)
- Specific bequest of the hunting tract to Adrienne (already JTWROS, so moot)
- Specific bequest of $50,000 cash to St. Anne's Episcopal Church, Annapolis

**AcreOS has no beneficiary entity.** There is no table that says "this person/trust receives this asset or this share." There is no concept of a *partial distribution* (giving Adrienne her two parcels in June 2026 while the SNT funding waits on a special-needs trust establishment in October). There is no tracking of *cumulative distributions* against each beneficiary's share, which is what the final accounting must reconcile.

What I want:

- A `beneficiaries` table: `(orgId, name, type: individual|trust|charity|entity, taxId, address, share: percent | specific, conditionsText, contingentBeneficiaryId)`.
- A `distributions` table: `(orgId, beneficiaryId, assetType: property|note|cash, assetId, distributionDate, valueAtDistribution, methodology, supportingDocId)`.
- A "distribute parcel" action on the property page that prompts for beneficiary, generates a draft deed (the platform already has `routes-closing.ts` and document generation), records the distribution, and decrements that beneficiary's residuary share.
- A "distribute note" action that produces an Allonge endorsement and a Notice of Servicing Transfer to the borrower (this overlaps with Holbrook §3.4).
- A *running residuary ledger* that always shows me each beneficiary's claim in dollars at current values, what's been distributed, and what's left.

Without this I am running parallel spreadsheets. The fee cost to the estate of my doing this manually is roughly **$8,000–$14,000** per estate at my rate. AcreOS could deliver the entire surface in three engineering weeks and amortize across every estate event the platform ever sees. The market for "land investor estate planning" is non-trivial; many of these owners are 65+.

---

## 7. Probate-court reports — a gap with concrete forms

Each jurisdiction has specific forms. None of them are produced by AcreOS. The minimum set for Neil:

- **Maryland (domicile, Anne Arundel County):** ROW-1100 Inventory; ROW-1112 First & Final Account; Information Report (ROW-1126).
- **Virginia (1 parcel, Frederick County):** Form CC-1670 Inventory for Decedent's Estate; CC-1680 Account for Decedent's Estate.
- **West Virginia (4 parcels, Hampshire & Hardy counties):** Appraisement of Estate; Final Settlement.
- **Pennsylvania (1 parcel, Cumberland County):** REV-1500 Inheritance Tax Return (PA has inheritance tax, not estate tax — this is the trap); ancillary letters via Register of Wills.

A "Probate Reports" surface that emits these as filled PDFs from the platform's data, flagging missing fields, would replace **8–12 hours of paralegal time per estate** (~$1,800–$2,700 at our rates). The forms are stable, mechanical, and public-domain. Build them once.

The critical correctness requirement is *internal consistency* — the inventory, the account, and the tax returns must reconcile, and the values shown must match the supporting valuations. Today nothing in AcreOS enforces or even surfaces that constraint.

---

## 8. Fiduciary accounting and the audit-log gap

A fiduciary accounting is a closed-system bookkeeping artifact: receipts + disbursements + gains + losses = beginning balance to ending balance, with each line tied to a voucher. Maryland accepts the National Fiduciary Accounting Standards format. The accounting must show every dollar that flowed through the estate, with supporting documents.

AcreOS's `auditLog` (`shared/schema.ts:4149`, also called out in Holbrook §4) is an *operational* audit log — who edited what record. It is not a *financial* audit log — what cash moved on what day, sourced where, applied to what. The two are different artifacts; the platform conflates them.

**What I'd add:** a `fiduciaryLedger` view, generated from existing `payments`, `expenses`, and `distributions`, formatted as Schedule A (receipts), Schedule B (disbursements), Schedule C (gains on sale), Schedule D (losses), Schedule E (distributions to beneficiaries), with a closing reconciliation. Court-grade. Exportable to PDF with the firm's letterhead applied.

Without this, my paralegal Devon spends roughly **20 hours rebuilding the same data** the platform already holds — into Excel, then into the court's format. That's $3,000 per estate at our blended rate that AcreOS could eliminate.

---

## 9. The edge cases the team will not have considered

These are the cases where probate attorneys earn fees and platforms learn from litigation.

- **Intestate succession.** Holbrook's case (no will, just Letters of Administration). State intestacy statutes vary materially. Maryland's per-stirpes-by-representation differs from Pennsylvania's. The platform should not try to interpret intestacy law, but it should flag "no will on file" and prompt for a state-of-domicile, which drives downstream form selection.
- **Disclaimer.** A beneficiary may file a qualified disclaimer (IRC §2518) within 9 months of DoD; the disclaimed share passes as if the beneficiary predeceased. This rewires the distribution graph mid-administration. The platform must support a "beneficiary disclaimed on date X, redirect to contingent" without rewriting history — append-only.
- **Minor or incapacitated beneficiary.** Distributions cannot go directly to minors (UTMA/UGMA accounts) or to Medicaid recipients (special-needs trust). The platform must allow a beneficiary record to point to a *receiving entity* distinct from the beneficiary's personal name.
- **Spousal elective share.** Surviving spouses in many states can elect against the will (Maryland: 1/3 or 1/2 of augmented estate). This recasts the entire distribution. The platform should not compute this — the lawyer does — but should not lock distributions until elective-share window passes (typically 9 months).
- **Ancillary probate.** Neil's PA parcel requires ancillary probate in Cumberland County even though he died domiciled in MD. The platform should detect "real property in jurisdiction other than decedent's domicile" and flag the ancillary requirement.
- **Pretermitted heir.** A child born or adopted after the will was executed gets an intestate share. Flag any beneficiary added to the family record after the will date.
- **Slayer rule.** A beneficiary who unlawfully kills the decedent forfeits their share. Rare. Worth a manual override field, no auto-detection.
- **Ademption.** A specifically devised asset not in the estate at death is "adeemed" — the gift fails. If Neil specifically devised "my truck" and sold the truck in February 2026, Adrienne (the legatee) takes nothing for that gift. The platform sees the disposition; it should flag "specific bequest to X is no longer in estate."
- **Abatement.** When the estate is insufficient to satisfy all bequests, statutory abatement order applies (residuary first, then general, then specific). The platform should support an "abatement scenario" view.
- **Simultaneous death.** USDA / state simultaneous-death statutes assume each predeceased the other for purposes of their estate. Edge but real (car accident, joint owners). Flagging is enough.

None of these need to be automated. They need to be **named** in the platform so the executor and counsel have a checklist that doesn't depend on attorney memory.

---

## 10. Multi-jurisdictional probate — the silent fee multiplier

Neil's estate touches four states with four different statutory schemes. The platform today is jurisdiction-agnostic; that is correct as a product principle and inadequate as a probate posture. Specifically:

- **Different valuation rules.** PA inheritance tax values differently than MD estate tax. WV has neither but requires appraisement. Same parcel, three valuations.
- **Different filing fees and bonds.** WV requires a fiduciary bond unless waived; the bond premium is an estate expense. Track it.
- **Different creditor-claim windows.** MD: 6 months. VA: 1 year. PA: 1 year. WV: 60 days from notice. The platform should know per-jurisdiction windows and warn before they close.
- **Different recording requirements for distribution.** Each state has its own Survivorship Affidavit, Personal Representative's Deed, or Trustee's Deed. AcreOS's document generation (`routes-documents.ts`) could template these.

The pattern: probate is *always* multi-jurisdictional for any operator who lent across state lines. AcreOS already knows the state; what it lacks is the per-state probate metadata.

---

## 11. What I would ship, ranked

1. **`titleVesting` + `payeeOfRecord` fields** — 2 weeks. Without this, no probate function works correctly. Highest dependency, smallest footprint.
2. **`valuations` table with DoD snapshot lock** — 2 weeks. Required for inventory, 706, and §2032 alternate-date election. Reproducibility for IRS audit.
3. **`beneficiaries` and `distributions` tables, with running residuary ledger** — 3 weeks. Replaces $8K–$14K of attorney time per estate.
4. **Probate inventory & accounting export** — per-jurisdiction templates, 4 weeks for the four mid-Atlantic states alone. Ship MD first, expand by state cohort.
5. **DoD-aware tax forms** — overlaps with Holbrook §3.6. K-1 generation for Form 1041 distributions. 3 weeks.
6. **Edge-case checklist surface** — disclaimer, ancillary, pretermitted heir, ademption, elective share. Not logic, just flags. 1 week.
7. **Multi-jurisdictional probate metadata** (claim windows, bond requirements, filing fees) — 2 weeks. Reusable across every estate.

Total: roughly **17 engineering weeks** to take AcreOS from "probate-hostile" to "probate-competent." The TAM justifies it: every Land Investor over 60 will eventually be in this position, and probate is a moment where retention is determined by whether the heirs experience the platform as competent or as an obstacle.

---

## 12. The thing I want said plainly

Cornelius Whitford did the right things. He had a will. He had a trust. He had a CPA, a lawyer, and a successor trustee who is functional, sober, and present. His estate is, by my standards, **easy.** And AcreOS is making it hard — not maliciously, not even negligently, but because the team has not yet realized that *every account they sell will eventually transition through probate or trust administration*, and the platform's silence on that transition forces every estate to be administered out-of-band, in spreadsheets, by lawyers and CPAs who are billing the heirs.

Holbrook needed a door. I need the rooms behind the door. Build the inventory. Build the valuations. Build the beneficiaries. Build the distributions. The rest is jurisdiction-specific paperwork, which is mechanical, and once you have the data structures right, the paperwork is a templating exercise.

I have administered four AcreOS estates in the last fourteen months. Each one cost the heirs, on average, **$11,000 more in professional fees** than it would have if the platform had any of what's described above. That's $44,000 across four families that paid for nothing except the absence of a feature. Build it.

— Penelope Fairweather, Esq.
   Fairweather & Iversen LLP, Annapolis, Maryland — May 1, 2026
