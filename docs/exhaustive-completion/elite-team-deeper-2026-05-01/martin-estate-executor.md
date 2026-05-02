# Martin Holbrook — Estate-Executor Access Audit, AcreOS

**Lens:** I am Martin Holbrook, 54, Newark NJ. I sell commercial HVAC, not software. Two weeks ago my father — Raymond Holbrook, 78, of Wilmington DE — died of a hemorrhagic stroke at his kitchen table. He had no will-trust setup despite us nagging him for ten years; he had a thirteen-year-old "I'll get to it" will naming me as executor. He spent his last decade running a small seller-financing business out of a spare bedroom — buying 1–10 ac rural lots in DE, MD, PA, VA, and selling them on land contracts to working-class buyers. **47 active notes** as of his date of death. His operating platform was AcreOS — Pro tier, sole owner of the org, no co-admin, no documented passwords, MFA enabled on a phone that was wiped by Verizon when I called to suspend the line. I was granted Letters Testamentary by New Castle County Register of Wills on April 24, 2026. I have a Surrogate-issued death certificate, his attorney (Lipscomb & Veal, RE practice in Wilmington), his CPA (a sole practitioner named Dorothea Klima who has been doing his Schedule C and 1099-INTs for nine years), and 47 borrowers who don't know he's dead and whose May 1 payments are due in two days. **My one job in this audit: find out whether AcreOS, the company, has any defined process for me. Because if it doesn't, I have to invent one — under estate-court timeline pressure, with strangers' housing payments at stake.**

---

## 1. One-line verdict

**AcreOS has a GDPR endpoint for the dead user themselves and a "transfer ownership" warning string in the team-roles route — and that is the entirety of the estate-access surface.** There is no documented executor process, no fiduciary-access policy, no support runbook for "owner is deceased," no in-app provision for designating a successor or fiduciary contact, no death-certificate intake mechanism, no escrowed recovery codes, no notice-to-borrowers of servicer change template, and no holdback on automated dunning during the gap between date-of-death and ownership transfer. The platform also generates 1099-INT forms with **`payerEin: "00-0000000"` hardcoded** (`server/services/bookkeeping.ts:262`) — meaning even if I get in, the forms my CPA needs for the estate's 2026 partial-year filing will need every EIN field hand-corrected. **Forty-seven borrowers are about to autopay an account my father can no longer legally accept funds into**, and AcreOS has no concept of "deposits to this account must pause pending Letters Testamentary." This is a significant operational gap, and it is the kind of gap that turns one bereaved family into a class-action plaintiff if mishandled. None of this is unfixable; most of it is a 2-week project. But on May 1, 2026, it's not built.

---

## 2. What I needed in the first 48 hours, and what AcreOS gave me

| Need | What I needed | What AcreOS provides | Gap |
|---|---|---|---|
| Pause autopay until court-authorized | One toggle, all 47 notes, halts ACH pulls | None — autopay runs per-note via `borrowerPaymentProfiles.autopayEnabled` (`shared/schema.ts:304`); no org-level pause | **Critical.** I cannot legally accept estate funds until Letters issue. |
| Notify borrowers father is deceased + servicing transition | Bulk-message template, with required statutory notice text (RESPA §6 servicer-transfer when applicable, state-equivalent for raw-land notes) | None. Borrower portal exists (`client/src/pages/borrower-portal.tsx`) but no "notice from servicer" channel | **High.** I will end up doing 47 hand-typed letters. |
| Prove I am the executor → unlock account | Death certificate upload + Letters Testamentary upload + ID verification flow | None. Support email only. No documented SLA, no fiduciary-access page, not in `/api/privacy` routes | **Critical.** I emailed support April 26; received a templated reply quoting the password-reset KB article. |
| Transfer org ownership without losing data | Documented "deceased owner" flow that re-roots ownership to a vetted estate party | Code path exists (`server/routes-organization.ts:881-883` blocks removing the only owner) but no mechanism for an outsider to *become* an owner without the existing owner's cooperation | **Critical.** The only-owner guard is correct; the missing piece is a court-document-based override. |
| Export everything for the estate inventory | One-click "everything in this org" archive — leads, deals, notes, payments, documents, contracts, audit log | `gdprService.exportUserData(userId)` exists (`server/routes-gdpr.ts:20`) but it's *user-scoped*, not org-scoped, and runs as the user — which I am not, because I cannot log in as my dead father without committing CFAA fraud | **Critical.** The right export exists, behind the wrong door. |
| Generate corrected tax docs (1099-INT, 1098, year-of-death partial) | Output with the *estate's* EIN (Form SS-4 issued for "Estate of Raymond Holbrook"), not the decedent's SSN, for post-DoD interest | `generate1099IntForms()` hardcodes `payerEin: "00-0000000"` and `recipientTin: "000-00-0000"` (`server/services/bookkeeping.ts:262,266`) | **High.** Every form will need hand-edit before filing. |
| Designate a co-fiduciary (the attorney) for read-only legal access | Fiduciary role distinct from "admin" — read-only, audit-trailed, time-limited | Roles are `owner | admin | member | viewer` (`server/utils/permissions.ts:7`); no fiduciary or estate-counsel role | **Medium.** I gave the attorney a viewer seat, but every action they take logs as me. |
| Audit log defensible in Probate Court | Immutable log of who-did-what-when, exportable, hash-chained or at least append-only | `auditLog` table exists (`shared/schema.ts:4149`); no export endpoint; not hash-chained; mutability via direct DB access not addressed in any policy I can find | **Medium.** Sufficient for ordinary disputes; not yet "court-grade." |

The honest read: AcreOS is built for a healthy, present, single-operator owner. It has not yet absorbed the actuarial truth that **a non-trivial fraction of its serious users will die while owning the account.** Land Investors skew older; my father was modal, not exceptional.

---

## 3. The seven specific things I needed in week 1

### 3.1 A "Deceased Owner — Executor Access" intake form

Path I want: `/estate-access` (public, no auth required). Inputs:
- Decedent's account email
- Executor's name, address, phone, email
- Scan of death certificate (PDF/image)
- Scan of Letters Testamentary / Letters of Administration (PDF/image)
- Scan of executor's photo ID
- Attorney contact (optional)

Backend: drop into a dedicated queue reviewed by a real human within 3 business days, with a stated SLA on the page. On approval, a privileged support tool re-roots ownership, sets the new owner's role to `estate_executor` (a new role — see §3.5), forces a password reset on next login, and freezes outbound automated communications for 30 days while the executor configures things.

**Currently:** none of this exists. I am corresponding with `support@` from a personal Gmail. There is no place on the public site for "a person who is not the account holder needs lawful access."

### 3.2 An org-level "estate hold" mode

When the deceased-owner flow completes intake (even before approval), the org should enter **estate hold**:

- All `autopayEnabled` flags forced to false until executor explicitly re-enables per-note (writes audit-log entry "executor M. Holbrook re-enabled autopay 2026-05-08 with court authorization")
- All scheduled outbound emails to borrowers paused (no dunning, no late notices, no marketing)
- Inbound payments still accepted but routed to a held-funds ledger (not auto-distributed to operating account)
- All AI agent autonomy (`agentInitiativeEngine.ts`, `agentLifecycleRuntimeV12.ts`) suspended — I do not need a Sophie-or-Forge-or-whoever sending offers to leads on my dead father's behalf
- Banner at top of every page: "This organization is in estate hold. Authorized executor: Martin Holbrook. Restored: pending."

**Currently:** I had to manually toggle off 47 autopays on April 27 (my father died April 19, so payments pulled on April 25 for two borrowers — those funds are now estate property and I needed to refund them, see §3.3).

### 3.3 A held-funds / refund-to-estate workflow

Two ACH pulls hit on April 25 — six days post-death — for $487 and $612. Those funds belong to Raymond's *estate*, not Raymond, but they were deposited to his pre-death Stripe Connect account (`server/services/stripeConnect.ts`). I need:

- A "this payment was received post-DoD" flag on individual payments
- A bulk refund tool that reverses to the borrower with a templated explanation
- An accounting export that segregates pre-DoD (decedent income, on his final 1040) from post-DoD (estate income, on Form 1041)

**Currently:** payments table has no `receivedAt vs heldAs` distinction. My CPA Dorothea has to back this out manually for the 1041. Estimated additional CPA cost: $400–$600.

### 3.4 A borrower-notice template engine

The borrowers — and this is a moral issue, not a feature request — **deserve to know.** Several have called my father's number wondering why their portal shows different ACH timing. Some are panicked: "did my payment go through? am I in default?" One borrower in Sussex County DE is convinced the change in routing means a scam. I need:

- A "Notice of Servicing Continuity" template, mail-merged with each borrower's name, note ID, current balance, my contact info, attorney contact, and a clear statement that **payment terms are unchanged** (the note is an estate asset; it does not accelerate on the lender's death; borrowers must continue performing per the contract)
- Bulk send via existing `emailService.ts` and `lobService.ts` (Lob for physical mail to borrowers without email — and many of my father's are without email)
- State-by-state checklist: in DE, MD, PA, VA, what notice is required, what is best-practice, what timing applies. (My father lent across four states.)

**Currently:** I am drafting this myself in Word. The attorney will charge me $1,200 to review the template. AcreOS could ship the template once and amortize across every estate event, ever.

### 3.5 An `estate_executor` role

Distinct from `owner`. Powers:
- Read everything in the org
- Mutate notes/payments only with elevated confirmation ("I confirm this action is within executor authority")
- Cannot delete data (immutability is a *feature* during probate)
- Cannot disable audit log
- Every action emits an `auditLog` entry tagged `estate_executor`
- Time-bounded: role auto-expires 24 months from grant unless renewed with re-uploaded Letters

**Currently:** I'm using `owner`. There is no role that says to the platform "this user is acting in a fiduciary capacity, treat their actions accordingly." Add to `ROLES` in `server/utils/permissions.ts:7`; thread through `getUserPermissionContext`.

### 3.6 A tax-doc generator that knows about death

The 2026 1099-INT for each borrower, when issued in January 2027, must split:
- Interest paid 1/1/2026 → 4/19/2026 → reportable to *Raymond Holbrook, SSN xxx-xx-xxxx* (decedent's final 1040)
- Interest paid 4/20/2026 → 12/31/2026 → reportable to *Estate of Raymond Holbrook, EIN xx-xxxxxxx* (Form 1041)

The platform needs:
- A "date of death" field on the org (or on the owner user record, propagated)
- 1099-INT generation that produces *two* forms per qualifying borrower in the year of death, split at DoD
- Same for 1098 mortgage-interest statements to borrowers (so their Schedule A claims are clean)
- The hardcoded `00-0000000` / `000-00-0000` placeholders in `bookkeeping.ts:262,266` replaced with stored, per-org values entered during onboarding (and per-borrower TIN collected at note origination)

**Currently:** the placeholder EINs alone disqualify the existing output for IRS use. My CPA will regenerate from the raw payments table. AcreOS is doing nothing for me here that a CSV export wouldn't.

### 3.7 A counsel-collaboration surface

Lipscomb & Veal needs to see:
- The 47 notes with current balances, accrued interest as of DoD, maturity dates, and originals of the security instruments (deed of trust / land contract recorded versions)
- The borrower contact list with last-payment status
- The audit log for any post-DoD activity (proving I haven't been self-dealing)

Today I'm sending the attorney CSV exports from `routes-import-export.ts` and zipped PDFs from `documents/`. A "Share with counsel" button — generates a read-only, time-limited link to a curated subset, all access logged — would replace four hours of my labor and reduce the chance I leak something I shouldn't.

**Currently:** ad hoc. The viewer-role seat works but exposes everything (lead funnel, marketing campaigns, AI agent traces) the attorney has zero need to see and arguably should not see.

---

## 4. What worked

In fairness:

- **Pro-tier audit log** (`auditLog` table, `routes-organization.ts:888-901`) captured the role-change attempts I made and gave me a defensible record I can hand the Probate Court. It's not hash-chained, but it's append-only via the route layer and I can attest to non-tampering.
- **Borrower portal with 1098 generation** (`routes-borrower.ts:770-799`) means each borrower can pull their own interest statement; this offloads work from me.
- **GDPR export** (`gdprService.exportUserData`) — once I get authenticated as my father (see §3.1), this gives me a complete data archive for the estate inventory. The architecture is right; the access path is wrong.
- **Stripe Connect separation** (`borrowerPaymentProfiles` joining to `stripeConnectAccountId`) means borrower payment methods are not commingled with my father's general operating account. Cleaner unwind than I feared.
- **The only-owner guard** (`routes-organization.ts:881-883`) prevented some prior support agent from "fixing" my situation by demoting my dead father, which would have been catastrophic. Keep this.

These are real. They tell me the platform was built by people who think about state integrity. The gap is that they have not yet thought about *who reaches for that integrity when the principal is gone.*

---

## 5. Ranked recommendations — what I'd ship, in what order

1. **Public `/estate-access` intake page + support runbook** — 1 week. Gives bereaved families a defined door to knock on. No code, mostly process + form + queue. **Highest leverage; lowest cost.**
2. **Org-level "estate hold" mode** — 2 weeks. Pauses autopay, dunning, agent autonomy. Prevents the platform from doing harm during the gap. **Highest moral urgency.**
3. **`estate_executor` role + 24-month time-bound** — 1 week. Bolt onto existing `ROLES` enum and permission context. **Smallest engineering footprint of the policy items.**
4. **Borrower notice templates (state-by-state, mail-merged)** — 2 weeks (legal review is the long pole). Replaces $1,200 of attorney time per estate. **Recurring savings.**
5. **Date-of-death-aware 1099-INT and 1098 generation + replace hardcoded EIN/TIN placeholders** — 3 weeks (the placeholder fix alone is 1 day; the DoD-split is the real work). **Tax-correctness floor.**
6. **Held-funds ledger / post-DoD payment segregation** — 3 weeks. Touches Stripe Connect reconciliation. **Material; can be deferred behind manual workaround.**
7. **Counsel-share surface (curated read-only links, scoped)** — 4 weeks. Useful but lowest urgency; a viewer seat plus a CSV is workable. **Polish.**

Beyond the executor case, every one of these compounds into adjacent scenarios — incapacitated owner (power of attorney instead of Letters), dissolved partnership, court-ordered receivership, divorce-court asset transfer. The shape is the same: **somebody who is not the account holder needs lawful access, with proof, on a timeline.** Build the framework once.

---

## 6. The thing I want said plainly

My father trusted this product with the income that's now feeding my mother. Forty-seven families trusted him to be a fair lender, and they're still owed clarity. AcreOS did not cause any of this — but the platform sits exactly at the seam where one family's tragedy turns into forty-seven families' confusion, and right now that seam has no thread. Build the estate-access workflow. It will be used more often than the team thinks, by people who are having the worst month of their lives, and the difference between "we have a process" and "email support and hope" is the difference between a reference customer and a regulatory complaint.

I am not angry at AcreOS. I am angry at the situation, and tired, and behind on my actual job. But the next Martin Holbrook should not have to write this audit. He should land on `/estate-access`, upload three PDFs, and be told what happens next.

— Martin Holbrook, Executor of the Estate of Raymond P. Holbrook
   New Castle County, Delaware — May 1, 2026
