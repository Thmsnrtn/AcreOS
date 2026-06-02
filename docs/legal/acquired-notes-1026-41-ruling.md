# Acquired Notes — §1026.41 Periodic-Statement Coverage Ruling

**Author:** Beatrice Whitfield, CRO
**Date:** 2026-06-02
**Subject:** When the periodic-statement generator must fire for an `acquired_notes` row
**Status:** Binding ruling. Iris implements the predicate below; no other interpretation may be used until this memo is superseded in writing.

---

## 1. The rule, walked

**12 C.F.R. §1026.41(a)(2)** scopes the obligation: "a *servicer* of a transaction subject to this section shall provide the consumer, for each billing cycle, a periodic statement…" The duty attaches to the **servicer**, not the holder, not the investor, not the originator. Identify the servicer correctly and the rest of the analysis collapses out.

**12 C.F.R. §1026.36(a)(4)** defines servicer by reference to **RESPA §6(i)(2)** and **12 C.F.R. §1024.2(b)** (Reg X): a servicer is "the person responsible for the servicing of a federally related mortgage loan (including the person who makes or holds such loan if such person also services the loan)." Servicing means "receiving any scheduled periodic payments from a borrower… and making the payments to the owner of the loan or other third parties of principal and interest and such other payments…" Three elements: (a) receipt of payments, (b) application/posting, (c) remittance/disbursement.

**Official Staff Commentary 41(a)-1, 41(a)-4** confirms that when servicing transfers, the **transferee servicer** owes the next statement; the transferor's duty ends the cycle the transfer is effective. There is no "holder also sends one" double-statement rule. Exactly one servicer per cycle, exactly one statement.

**Scope exclusions** — §1026.41 only applies to closed-end consumer-credit transactions secured by a dwelling. The following acquired notes are **out of Reg-Z scope entirely**:

- **§1026.3(a)** — business-purpose loans (a note acquired against a commercial borrower).
- **§1026.3(b)** — loans where the credit exceeds the threshold ($69,500 for 2026) AND are not secured by real property or a dwelling. (Bare-land notes secured only by raw land that does NOT contain a dwelling fall here. The "dwelling" hook is determinative — see §1026.2(a)(19).)
- **§1026.41(e)(4)** — small-servicer exemption (5,000-or-fewer loans, all serviced by the same entity that owns them). AcreOS does **not** elect this exemption; we generate statements regardless.
- **§1026.41(e)(5)** — fixed-rate loans where coupon book is supplied (we do not issue coupon books; not invocable).
- **Tax-deed certificates / tax-lien certificates** — not consumer credit. Out of scope.
- **Land contracts / contracts-for-deed** — covered by §1026.41 only when they meet "dwelling-secured closed-end consumer credit" — i.e., the underlying parcel contains a dwelling and the buyer is a consumer. Raw-land contracts-for-deed (the typical AcreOS originated note) are **outside** §1026.41.

---

## 2. Case-by-case ruling

| # | Scenario | Statement obligation attaches to AcreOS org? |
|---|----------|----------------------------------------------|
| 1 | **Whole-loan purchase, seller retains servicing** (sub-servicing agreement back to seller, or a third-party master-servicer remains in place) | **No.** Seller-servicer continues. AcreOS is a passive investor. §1026.41(a) duty stays with the contractual servicer. |
| 2 | **Whole-loan purchase, servicing-released, AcreOS becomes servicer-of-record** | **Yes.** Duty attaches the cycle after assignment of servicing is effective. First statement covers the first full billing cycle post-transfer. (Comment 41(a)-4.) |
| 3 | **Whole-loan purchase, servicing assigned to third-party sub-servicer** (AcreOS hires a licensed sub-servicer) | **No** to AcreOS directly. The sub-servicer is the §1024.2 "servicer." AcreOS retains oversight + audit duty under the sub-servicing agreement but does not generate the statement. |
| 4 | **Participation interest / fractional interest in a note** (AcreOS owns < 100% of cashflow but is the servicer-of-record per the participation agreement) | **Yes.** Servicing role, not ownership %, controls. If the participation agreement names another party servicer, **no**. |
| 5 | **Passively held acquired note** (AcreOS holds paper but no payment processing, no borrower comms, servicing contracted out) | **No.** Holder ≠ servicer under §1024.2(b). |
| 6 | **Acquired non-performing note in workout / pre-charge-off** | **Yes IF** AcreOS is servicer-of-record. The 45-day delinquency block (§1026.41(d)(8)) becomes mandatory content. |
| 7 | **Tax-deed certificate / tax-lien purchase** | **No.** Out of Reg-Z scope (not consumer credit). |
| 8 | **Acquired note secured by raw land only, no dwelling** | **No** under federal §1026.41 (dwelling-secured trigger fails). State-overlay rules may still apply — see §6. |
| 9 | **Acquired note where collateral is a parcel containing a dwelling** (mobile home affixed, single-family on-site) AND borrower is a consumer | **Yes**, when AcreOS is servicer-of-record. |
| 10 | **Acquired note, business-purpose borrower** (LLC borrower, commercial use of parcel) | **No.** §1026.3(a) exemption. |

---

## 3. Decision tree

```
acquired_note evaluated:
├─ Is the borrower a consumer (natural person, consumer purpose)?
│    └─ No  → OUT OF SCOPE. Skip.
├─ Is the collateral a dwelling (or a parcel containing a dwelling)?
│    └─ No  → OUT OF FEDERAL §1026.41 SCOPE. Apply state-overlay matrix (§6).
├─ Is AcreOS org the servicer-of-record for this cycle?
│    │   (per note_ownership_of_record + servicing assignment)
│    └─ No  → DUTY LIES WITH ACTUAL SERVICER. Skip.
└─ All three yes → GENERATE STATEMENT.
```

---

## 4. Code-level predicate (TypeScript pseudocode)

The schema today does not carry an explicit `acts_as_servicer` boolean on `acquired_notes`. The cleanest derivation uses `noteOwnershipOfRecord` plus three new columns Iris should add to `acquired_notes`:

```ts
// New columns on acquired_notes (migration required):
//   isConsumerPurpose: boolean           // default false; set at import / acquisition
//   collateralIsDwelling: boolean        // default false; derived from property type
//   servicingArrangement: text           // 'self_serviced' | 'sub_serviced' |
//                                        // 'seller_retained' | 'passive_holder'

export async function shouldGeneratePeriodicStatement(
  note: AcquiredNote,
  orgId: number,
  db: Database,
): Promise<{ generate: boolean; reason: string; citation: string }> {
  // Reg-Z scope gates — these MUST pass before any state-overlay analysis.
  if (!note.isConsumerPurpose) {
    return { generate: false, reason: "business-purpose loan", citation: "§1026.3(a)" };
  }
  if (!note.collateralIsDwelling) {
    return {
      generate: false,
      reason: "collateral is not a dwelling; check state overlay",
      citation: "§1026.2(a)(19), §1026.41(a)",
    };
  }

  // Servicer-of-record gate. The org generates only when it IS the servicer.
  // 'self_serviced' = AcreOS org services notes it also holds.
  // Any other value = duty lies elsewhere.
  if (note.servicingArrangement !== "self_serviced") {
    return {
      generate: false,
      reason: `servicing arrangement '${note.servicingArrangement}' delegates duty`,
      citation: "§1026.36(a)(4), §1024.2(b)",
    };
  }

  // Defensive double-check: confirm ownership-of-record row names this org as
  // servicer (not just owner). If a future sub-servicer arrangement was added
  // and servicingArrangement wasn't updated, this catches the drift.
  const activeOwnership = await db
    .select()
    .from(noteOwnershipOfRecord)
    .where(
      and(
        eq(noteOwnershipOfRecord.noteId, note.id),
        eq(noteOwnershipOfRecord.organizationId, orgId),
        isNull(noteOwnershipOfRecord.supersededAt),
      ),
    )
    .limit(1);

  if (activeOwnership.length === 0) {
    return {
      generate: false,
      reason: "no active ownership-of-record row; cannot confirm servicer",
      citation: "§1026.36(a)(4)",
    };
  }

  return {
    generate: true,
    reason: "consumer-purpose, dwelling-secured, AcreOS is servicer-of-record",
    citation: "§1026.41(a), §1026.41(b)",
  };
}
```

**Audit primitive.** Every skip MUST persist `{noteId, cycleStart, reason, citation}` to a `periodic_statement_skips` ledger table (Iris to add). When the CFPB examiner asks "why didn't AcreOS send a statement for loan X in April," the ledger is the answer. **A skip without a logged reason is indistinguishable from negligence** — Iris, this is the door we close against the plaintiff's-bar attorney.

---

## 5. Piggyback obligations (same predicate)

When `shouldGeneratePeriodicStatement → generate: true`, the following also attach to AcreOS for that note:

- **§1026.36(c)(1)(i) — prompt crediting.** Posting date = receipt date for a conforming payment. Already implemented for originated notes; extend `paymentApplications` write path to acquired-note payments.
- **§1026.36(c)(1)(ii) — partial-payment / suspense handling.** Already implemented; extend to `note_payments` ingestion when `paymentType='partial'`.
- **§1026.36(c)(2) — late-fee non-pyramiding.** Already implemented for originated notes; extend `lateFeeAssessments` to acquired notes with `loanType='acquired_note'`.
- **12 C.F.R. §1024.39 (RESPA) — early-intervention.** Live contact attempt by day 36 of delinquency + written notice by day 45. **Same predicate gates this** — only when AcreOS is servicer. Workflow event needed: `note.delinquent_36d`.
- **12 C.F.R. §1024.40 (RESPA) — continuity of contact.** Assigned personnel reachable by day 45 of delinquency. Operational, not just code — staff assignment needed on each delinquent acquired note.
- **12 C.F.R. §1024.41 (RESPA) — loss mitigation procedures.** Triggers at day 45. AcreOS already has a `note_loss_mit_cases` table; wire it to the same gate.

---

## 6. State-overlay flags (matrix cells to expand separately)

These states impose servicing-disclosure or statement obligations on **holders** (or on servicers regardless of dwelling status) where federal Reg-Z is silent. **Do not** treat a federal "No" as a global "No" — the state-overlay matrix runs after federal.

| State | Overlay |
|-------|---------|
| **CA** | Cal. Civ. Code §2954, §2966 (all-due-now notices); Cal. Fin. Code §22000 et seq. CFL servicer licensing applies to consumer loans regardless of federal dwelling hook. **Statement-like quarterly disclosure required for non-dwelling consumer loans.** |
| **NY** | NY Banking Law Art. 12-D — mortgage loan servicer registration; 3 NYCRR Part 419 servicing-business-conduct rules require monthly statements for residential mortgages and **separately impose disclosure on note holders** purchasing distressed mortgage loans. |
| **TX** | Tex. Fin. Code §156 (mortgage servicer registration); Tex. Prop. Code §5.077 — **annual statement required on every land contract / contract-for-deed**, federal scope notwithstanding. |
| **IL** | 765 ILCS 67/ (Installment Sales Contract Act) — contract-for-deed disclosure obligations independent of federal Reg-Z. |
| **MN** | Minn. Stat. §47.205, §58.13 — residential mortgage servicer licensing; statement obligations track federal but state penalties are independent. |
| **OK** | Okla. Stat. tit. 14A §3-403 — periodic statement requirement for consumer credit sales, broader than federal scope. |

Full per-state ruling tracked separately at `docs/legal/state-matrix-2026-06.md`. **Until those cells are populated, the conservative default for a multi-state portfolio is: generate.** Over-disclosing is never a violation; under-disclosing is.

---

## 7. Constitutional check

The generator's output is a **statement of fact** (balances, transactions, dates). It MUST NOT include advisory tone, recommendations, "you should…" language, or projection of borrower behavior. Where §1026.41(d)(8) requires the delinquency block, AcreOS shows: amount owed, days delinquent, HUD hotline (800-569-4287), and the foreclosure-risk notice template **verbatim** from the rule. **No paraphrasing.** No Pax voice. The PDF renderer must lock this template to a constant string and any drift surfaces as a test failure. Beatrice audits the rendered template quarterly.

---

## 8. Adversarial scrutiny — closing the misclassification door

A plaintiff's-bar attorney reading this memo will ask: *"Is AcreOS skipping statements by gaming `servicingArrangement` to 'passive_holder'?"* Three defenses, all required:

1. **`servicingArrangement` is set at acquisition time** based on the assignment paperwork, not on a user toggle later. Changing it post-acquisition requires an ops user with the `compliance_officer` role and writes an audit-log row with reason. Iris: enforce in the route layer.
2. **The `periodic_statement_skips` ledger is monotonic + immutable**. Every skip is logged with the reason at the time. Backfilling skipped cycles is operationally cheap; backfilling missing skip-reasons is impossible. Defensible record from day one.
3. **Quarterly sample audit by Beatrice.** Random 5% of `servicingArrangement != 'self_serviced'` rows reviewed for paperwork match. Documented in `docs/legal/audit-2026-XX-XX.md`.

---

**Ruling effective 2026-06-02. Supersedes nothing (first ruling on this question).**
*— Beatrice Whitfield, CRO*
