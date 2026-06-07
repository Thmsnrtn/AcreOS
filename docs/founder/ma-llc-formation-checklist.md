# AcreOS — Massachusetts LLC Formation Checklist (Same-Day Runbook)

**Author:** Beatrice Whitfield (Chief Risk Officer)
**For:** Tom Norton, Founder/CEO
**Date:** 2026-06-06
**Status:** ⬜ Not started — execute when Tom says "go" (timed to just before the first paying customer)

---

## When to run this

Per Tom's 2026-06-06 decision: **form the MA LLC timed to just before the first customer — not now.** The reasoning is sound: a Massachusetts LLC costs **$500 to file plus $500/year** to maintain, and the liability shield does nothing until there is an actual customer relationship that could create a liability. Until then, the false entity language is the only real exposure, and that has already been fixed (see "Doc-string swap," below — it's already truthful today).

**Trigger to run this runbook:** a real prospect is about to pay (S13 first-customer, per the Tahoe H1 decisions). When that's imminent, this is a same-day, ~$500, half-a-day-of-attention task. Do it the week before, not the day of, so the EIN and bank account exist before money moves.

> **Honest scope note.** The team can prepare every artifact below and walk you through each click. We cannot *be your lawyer* and cannot file on your behalf — the Certificate of Organization names you as organizer and must be your action. One optional lawyer hour (~$200–300) to skim the operating agreement is worth it but not required to form.

---

## Cost summary (so there are no surprises)

| Item | Cost | Cadence |
|---|---|---|
| Certificate of Organization filing (MA) | **$500** | one-time |
| MA LLC Annual Report | **$500** | every year, by the anniversary |
| Registered agent (if you use a commercial service) | ~$100–125 | per year (optional — you can be your own, see 3 below) |
| EIN from the IRS | **$0** | one-time |
| Operating agreement (template) | $0–300 | one-time (lawyer review optional) |

The unavoidable floor is **$500 now + $500/year**. Everything else is optional or free.

---

## The runbook — in order

### 1. Pick the LLC name and confirm it's available — 10 min
- Proposed legal name: **AcreOS LLC**.
- Check availability in the MA Secretary of the Commonwealth (Corporations Division) business-entity search: <https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx>.
- The name must contain "Limited Liability Company," "LLC," or "L.L.C." MA will reject a name confusingly similar to an existing entity.
- ⬜ Confirm "AcreOS LLC" is clear. If taken, fall back to a distinguishable variant and tell the team so the doc-string (step 8) matches exactly.

### 2. Decide the principal office address — 5 min
- The Certificate of Organization requires a **principal office address** (this becomes semi-public).
- ⚠️ **Founder-privacy flag:** do not use the Marlborough home address if you can avoid it. Use the registered agent's commercial address (step 3) or a commercial mailing address. The 2026-05-31 legal audit flagged the home-address exposure specifically.

### 3. Choose a registered agent (in MA, called the "resident agent") — 10 min
- Every MA LLC must name a **resident agent** with a Massachusetts street address (no PO boxes) available during business hours to receive legal service.
- Two options:
  - **(a) Commercial service** (Northwest Registered Agent, Stripe Atlas, etc.) — ~$100–125/yr, keeps your home address off the public record, forwards mail. **Recommended** for privacy.
  - **(b) Be your own agent** — free, but your name and a MA street address (likely home) go on the public record during business hours. Only if privacy isn't a concern.
- ⬜ Pick one and have the agent's name + MA street address ready for the filing.

### 4. File the Certificate of Organization — 20 min — **$500**
- File online at the MA Corporations Division: <https://corp.sec.state.ma.us/CorpWeb/Login/Login.aspx> (online is fastest; same-day to a few business days).
- Information the form asks for:
  - Exact LLC name (step 1)
  - Principal office address (step 2)
  - Resident agent name + MA address (step 3)
  - General character of business (e.g., "software-as-a-service platform for land investors")
  - Name/signature of the **authorized organizer** (you)
  - Name(s) of any manager(s) — for a single-member LLC, you
- Pay the **$500** filing fee.
- ⬜ Save the stamped Certificate of Organization PDF and the entity ID number. **You are now an LLC the moment this is accepted.**

### 5. Get the EIN from the IRS — 10 min — **free**
- Apply online at <https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online> (free; issued immediately; available weekdays).
- A single-member LLC is a disregarded entity by default for federal tax; you'll still want the EIN to keep your SSN off Stripe, the bank, and contracts.
- ⚠️ The IRS site is the **only** official, free source. Ignore any third-party "EIN service" that charges a fee.
- ⬜ Record the EIN somewhere secure (not in a public repo, not in plaintext logs).

### 6. Adopt a single-member operating agreement — 20 min
- Even a single-member LLC should have one — it's what a court reads to confirm the LLC is a real, separate entity (this is what preserves the liability shield against "piercing the veil").
- A formation service includes a template; a clean single-member MA template is fine at this stage.
- ⬜ Sign and date it. Store it with the Certificate of Organization. (Optional: one lawyer hour to skim — ~$200–300.)

### 7. Open the business bank account + wire it into Stripe — 30 min
- Open a business checking account under "AcreOS LLC" using the EIN and the stamped Certificate.
- Update Stripe's business profile to the LLC name + EIN so payouts and 1099-K reporting are under the entity, not your SSN.
- ⬜ Confirm payouts route to the LLC account **before** the first customer charge.

### 8. Flip the doc-strings — 5 min (team action) — **already prepared**
The app's legal entity language is centralized so this is a **one-line edit**:
- File: `client/src/lib/legal-entity.ts` — change `ENTITY_STATUS` from `"sole-proprietor"` to `"llc"`.
- That single change updates, automatically and everywhere:
  - Terms of Service "operated by" sentence, governing-law state, arbitration venue, and footer
  - Privacy Policy intro + footer
  - Landing footer copyright
- Then update the source-of-truth markdown to match (mechanical find/replace; the constants file is the runtime source):
  - `docs/legal/terms-of-service.md`
  - `docs/legal/privacy-policy.md`
  - `docs/legal/data-processing-agreement.md` (Processor name + signature block)
- Also drop the new registered-agent address into the ToS contact section, Privacy contact section, and the email footer (`emailService.ts`) — see launch-readiness-checklist items 1.4 and 5(a)(3).
- ⬜ Bump the ToS/Privacy version + effective date when these flip, since the operator identity is a material change (existing customers get the standard 30-day notice per ToS §16).

### 9. Set the annual-report reminder — 5 min
- MA LLCs must file an **Annual Report** every year (**$500**), due on or before the anniversary of formation.
- ⚠️ Missing it leads to administrative dissolution — which **destroys the liability shield retroactively**. This is the most-missed obligation.
- ⬜ Create a recurring calendar reminder (annual, ~30 days before the formation anniversary) and note the date in the launch-readiness checklist.

### 10. Note the deferred items (do NOT do these now)
- **C-corp / Delaware conversion** — explicitly **deferred** by Tom's 2026-06-06 decision. Do not convert. Revisit only on a VC conversation, an MRR threshold, or Tom's say-so. The QSBS clock starting later is a known, accepted tradeoff.
- **Foreign qualification in other states** — generally not required for a SaaS LLC just because you have customers in other states; revisit only if you establish physical nexus or an accountant flags it.

---

## Same-day critical path (the minimum to be "an LLC with a bank account")

1. Name check (step 1) → 2. Address + agent (steps 2–3) → 3. **File Certificate, pay $500 (step 4)** → 4. **EIN, free (step 5)** → 5. Operating agreement (step 6) → 6. Bank + Stripe (step 7) → 7. Flip the doc-string (step 8) → 8. Set the annual reminder (step 9).

Realistic time: a focused **half day**, plus a few business days of waiting if the filing isn't accepted same-day. Run it the week before the first customer pays.

---

## What's already done (so you don't redo it)

- ✅ The false "AcreOS, Inc., a Delaware corporation" language has been **removed** from all customer-facing and legal surfaces and replaced with the truthful current status (sole proprietorship, MA, LLC pending).
- ✅ The entity name is **centralized** in `client/src/lib/legal-entity.ts` so the LLC swap is one edit.
- ✅ A **30-day money-back refund policy** is now in the Terms (§5A) with FTC-compliant auto-renewal disclosure (§5).
- ✅ Governing law / arbitration venue moved from Delaware (false) to **Massachusetts** (true).
